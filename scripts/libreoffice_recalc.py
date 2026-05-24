#!/usr/bin/env python3
"""Recalculate xlsx formulas using headless LibreOffice."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path

from scripts.paths import XLSX_PATH

# Lazy import — avoid circular import at module load
_assert_recalc_cached = None

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_XLSX = XLSX_PATH
_MAX_ATTEMPTS = 3


def _verify_recalc_cached(xlsx_path: Path) -> bool:
    global _assert_recalc_cached
    if _assert_recalc_cached is None:
        from scripts.export_summary import assert_recalc_cached

        _assert_recalc_cached = assert_recalc_cached

    try:
        from scripts.export_summary import count_played_matches

        played = count_played_matches(xlsx_path)
        if played == 0:
            return True
        _assert_recalc_cached(xlsx_path, games_played=played)
        return True
    except RuntimeError:
        return False


def _soffice_binary() -> str:
    for candidate in ("soffice", "libreoffice"):
        path = shutil.which(candidate)
        if path:
            return path
    raise RuntimeError("LibreOffice not found (install soffice or libreoffice)")


def _lo_env(profile_dir: Path | None = None) -> dict[str, str]:
    env = os.environ.copy()
    env.setdefault("HOME", str(Path(tempfile.gettempdir())))
    env.setdefault("SAL_USE_VCLPLUGIN", _vcl_plugin())
    env.setdefault("SAL_DISABLE_OPENCL", "1")
    env.setdefault("LANG", "C.UTF-8")
    if profile_dir is not None:
        env["UserInstallation"] = profile_dir.resolve().as_uri()
    return env


def _vcl_plugin() -> str:
    """Use the X11 plugin with xvfb on CI; svp-only headless can leave formulas as #N/A."""
    return "gen" if shutil.which("xvfb-run") else "svp"


def _uno_available() -> bool:
    try:
        import uno  # noqa: F401

        return True
    except ImportError:
        return False


def _system_python_with_uno() -> str | None:
    for candidate in ("/usr/bin/python3", "/usr/local/bin/python3"):
        if not Path(candidate).is_file():
            continue
        if Path(candidate).resolve() == Path(sys.executable).resolve():
            continue
        probe = subprocess.run(
            [candidate, "-c", "import uno"],
            capture_output=True,
            timeout=10,
        )
        if probe.returncode == 0:
            return candidate
    return None


def _recalc_via_system_uno(source: Path, profile_dir: Path) -> tuple[bool, str]:
    """Run only the UNO recalc worker under system python, keeping openpyxl in this process."""
    system_python = _system_python_with_uno()
    if system_python is None:
        return False, "python3-uno is not available"

    worker = r"""
import os
import subprocess
import sys
import time
from pathlib import Path

import uno
from com.sun.star.beans import PropertyValue


def wrap_xvfb(command):
    xvfb = "/usr/bin/xvfb-run"
    if Path(xvfb).is_file():
        return [xvfb, "-a", *command]
    return command


source = Path(sys.argv[1]).resolve()
profile_dir = Path(sys.argv[2]).resolve()
port = int(sys.argv[3])
soffice = "/usr/bin/soffice" if Path("/usr/bin/soffice").is_file() else "soffice"
env = os.environ.copy()
env["UserInstallation"] = profile_dir.as_uri()
command = wrap_xvfb(
    [
        soffice,
        "--headless",
        "--invisible",
        "--norestore",
        "--nologo",
        "--nodefault",
        f"-env:UserInstallation={profile_dir.as_uri()}",
        f"--accept=socket,host=127.0.0.1,port={port};urp;StarOffice.ComponentContext",
    ]
)
proc = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
try:
    time.sleep(3)
    local_context = uno.getComponentContext()
    resolver = local_context.ServiceManager.createInstanceWithContext(
        "com.sun.star.bridge.UnoUrlResolver", local_context
    )
    ctx = None
    for _ in range(40):
        try:
            ctx = resolver.resolve(
                f"uno:socket,host=127.0.0.1,port={port};urp;StarOffice.ComponentContext"
            )
            break
        except Exception:
            time.sleep(0.25)
    if ctx is None:
        raise RuntimeError("UNO connect timeout")

    desktop = ctx.ServiceManager.createInstanceWithContext("com.sun.star.frame.Desktop", ctx)
    doc = desktop.loadComponentFromURL(
        uno.systemPathToFileUrl(str(source)), "_blank", 0, (PropertyValue("Hidden", 0, True, 0),)
    )
    if doc is None:
        raise RuntimeError("loadComponentFromURL returned None")
    try:
        doc.calculateAll()
        doc.store()
    finally:
        doc.close(True)
finally:
    proc.terminate()
    try:
        proc.wait(timeout=15)
    except subprocess.TimeoutExpired:
        proc.kill()
"""
    port = 3000 + (os.getpid() % 60000)
    result = subprocess.run(
        [system_python, "-c", worker, str(source), str(profile_dir), str(port)],
        capture_output=True,
        text=True,
        timeout=600,
        env=_lo_env(profile_dir),
    )
    if result.returncode == 0:
        return True, ""
    return False, "\n".join(
        part
        for part in [result.stderr.strip(), result.stdout.strip(), f"exit {result.returncode}"]
        if part
    )


def _wrap_xvfb(command: list[str]) -> list[str]:
    xvfb = shutil.which("xvfb-run")
    if xvfb:
        return [xvfb, "-a", *command]
    return command


def _start_soffice_listener(profile_dir: Path, port: int, env: dict[str, str]) -> subprocess.Popen[bytes]:
    command = _wrap_xvfb(
        [
            _soffice_binary(),
            "--headless",
            "--invisible",
            "--norestore",
            "--nologo",
            "--nodefault",
            f"-env:UserInstallation={profile_dir.resolve().as_uri()}",
            f"--accept=socket,host=127.0.0.1,port={port};urp;StarOffice.ComponentContext",
        ]
    )
    return subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
    )


def _recalc_via_uno(source: Path, profile_dir: Path) -> tuple[bool, str]:
    """Force a full formula recalc via LibreOffice UNO (works reliably on Ubuntu CI)."""
    if not _uno_available():
        return _recalc_via_system_uno(source, profile_dir)

    try:
        import uno
        from com.sun.star.beans import PropertyValue
    except ImportError as exc:
        return False, f"uno import failed: {exc}"

    port = 3000 + (os.getpid() % 60000)
    env = _lo_env(profile_dir)
    proc = _start_soffice_listener(profile_dir, port, env)
    stderr_tail = ""
    try:
        time.sleep(3)
        local_context = uno.getComponentContext()
        resolver = local_context.ServiceManager.createInstanceWithContext(
            "com.sun.star.bridge.UnoUrlResolver", local_context
        )
        ctx = None
        for _ in range(40):
            try:
                ctx = resolver.resolve(
                    f"uno:socket,host=127.0.0.1,port={port};urp;StarOffice.ComponentContext"
                )
                break
            except Exception:
                time.sleep(0.25)
        if ctx is None:
            if proc.stderr is not None:
                stderr_tail = proc.stderr.read().decode(errors="replace")[-500:]
            return False, f"uno connect timeout: {stderr_tail}"

        desktop = ctx.ServiceManager.createInstanceWithContext(
            "com.sun.star.frame.Desktop", ctx
        )
        url = uno.systemPathToFileUrl(str(source.resolve()))
        hidden = PropertyValue("Hidden", 0, True, 0)
        doc = desktop.loadComponentFromURL(url, "_blank", 0, (hidden,))
        if doc is None:
            return False, "loadComponentFromURL returned None"
        try:
            if hasattr(doc, "calculateAll"):
                doc.calculateAll()
            doc.store()
        finally:
            doc.close(True)
        return True, ""
    except Exception as exc:
        return False, str(exc)
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=15)
        except subprocess.TimeoutExpired:
            proc.kill()


def _conversion_succeeded(result: subprocess.CompletedProcess[str], output_path: Path) -> bool:
    if result.returncode != 0 or not output_path.exists():
        return False
    combined = f"{result.stdout or ''}\n{result.stderr or ''}".lower()
    return "error:" not in combined and "failed:" not in combined


def _run_soffice_convert(
    source: Path, out_dir: Path, profile_dir: Path
) -> subprocess.CompletedProcess[str]:
    command = _wrap_xvfb(
        [
            _soffice_binary(),
            "--headless",
            "--invisible",
            "--norestore",
            "--nologo",
            "--nodefault",
            "--nofirststartwizard",
            f"-env:UserInstallation={profile_dir.resolve().as_uri()}",
            "--convert-to",
            "xlsx",
            "--outdir",
            str(out_dir),
            str(source),
        ]
    )
    return subprocess.run(
        command,
        capture_output=True,
        text=True,
        timeout=600,
        env=_lo_env(profile_dir),
    )


def recalc(xlsx_path: Path = DEFAULT_XLSX, *, require_cached: bool = True) -> None:
    """Open xlsx in LibreOffice, recalculate formulas, and save in place."""
    xlsx_path = xlsx_path.resolve()
    if not xlsx_path.exists():
        raise FileNotFoundError(xlsx_path)

    work_dir = Path(tempfile.gettempdir()) / f"lo_work_{uuid.uuid4().hex}"
    in_dir = work_dir / "in"
    out_dir = work_dir / "out"
    profile_dir = work_dir / "profile"
    source = in_dir / "workbook.xlsx"
    for directory in (in_dir, out_dir, profile_dir):
        directory.mkdir(parents=True, exist_ok=True)
    shutil.copy2(xlsx_path, source)

    last_error = ""
    try:
        if _uno_available():
            ok, err = _recalc_via_uno(source, profile_dir)
            if ok:
                shutil.copy2(source, xlsx_path)
                if not require_cached:
                    return
                if _verify_recalc_cached(xlsx_path):
                    return
                last_error = "LibreOffice UNO saved the file but formula results were not cached"
            else:
                last_error = f"LibreOffice UNO recalc failed: {err}"

        for attempt in range(1, _MAX_ATTEMPTS + 1):
            shutil.rmtree(out_dir, ignore_errors=True)
            out_dir.mkdir(parents=True, exist_ok=True)
            result = _run_soffice_convert(source, out_dir, profile_dir)
            converted = out_dir / source.name
            stderr = result.stderr or ""
            stdout = result.stdout or ""
            if _conversion_succeeded(result, converted):
                shutil.copy2(converted, xlsx_path)
                if not require_cached:
                    return
                if _verify_recalc_cached(xlsx_path):
                    return
                last_error = "LibreOffice saved the file but formula results were not cached"
            else:
                last_error = "\n".join(
                    part
                    for part in [stderr.strip(), stdout.strip(), f"exit {result.returncode}"]
                    if part
                )
            print(last_error, file=sys.stderr)
            if attempt < _MAX_ATTEMPTS:
                time.sleep(1.5)
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)

    raise RuntimeError(f"LibreOffice recalc failed after {_MAX_ATTEMPTS} attempts: {last_error}")


def main() -> None:
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_XLSX
    recalc(path)
    print(f"Recalculated → {path}")


if __name__ == "__main__":
    main()
