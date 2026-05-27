const DEFAULT_ALLOWED_ORIGIN = "https://mikizi.github.io";
const DEFAULT_REPO = "mikizi/toto";
const DISPATCH_EVENT_TYPE = "update-score";
const RESTORE_EVENT_TYPE = "restore-score";
const BROADCAST_EVENT_TYPE = "update-broadcast";
const REGISTRATION_EVENT_TYPE = "update-registration";
const XLSX_REPO_PATH = "xlsx/Master WorldCup26.xlsx";
const XLSX_DOWNLOAD_NAME = "Master WorldCup26.xlsx";

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowedOrigin = env.ALLOWED_ORIGIN || DEFAULT_ALLOWED_ORIGIN;
    const corsHeaders = buildCorsHeaders(origin, allowedOrigin);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (!isAllowedOrigin(origin, allowedOrigin)) {
      return jsonResponse({ ok: false, error: "Origin not allowed" }, 403, corsHeaders);
    }

    const url = new URL(request.url);
    const allowedPaths = ["/publish", "/restore", "/broadcast", "/registration", "/xlsx"];
    if (!allowedPaths.includes(url.pathname)) {
      return jsonResponse({ ok: false, error: "Not found" }, 404, corsHeaders);
    }

    if (!env.GITHUB_TOKEN || !env.ADMIN_PASSWORD) {
      return jsonResponse({ ok: false, error: "Worker secrets are not configured" }, 500, corsHeaders);
    }

    const password = request.headers.get("X-Admin-Password") || "";
    if (password !== env.ADMIN_PASSWORD) {
      return jsonResponse({ ok: false, error: "Unauthorized" }, 401, corsHeaders);
    }

    if (url.pathname === "/xlsx") {
      if (request.method !== "GET") {
        return jsonResponse({ ok: false, error: "Method not allowed" }, 405, corsHeaders);
      }
      return downloadWorkbook(env, corsHeaders);
    }

    if (request.method !== "POST") {
      return jsonResponse({ ok: false, error: "Method not allowed" }, 405, corsHeaders);
    }

    const payload = await readJson(request);
    const repo = env.GITHUB_REPO || DEFAULT_REPO;

    if (url.pathname === "/broadcast") {
      const action = typeof payload.action === "string" ? payload.action : "set";
      const githubResponse = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${env.GITHUB_TOKEN}`,
          "Content-Type": "application/json",
          "User-Agent": "wc26-toto-admin-worker",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({
          event_type: BROADCAST_EVENT_TYPE,
          client_payload: {
            action,
            openMatchIds: Array.isArray(payload.openMatchIds) ? payload.openMatchIds : undefined,
            suppressAuto: payload.suppressAuto,
          },
        }),
      });

      if (!githubResponse.ok) {
        const errorText = await githubResponse.text();
        return jsonResponse(
          { ok: false, error: `GitHub dispatch failed: ${githubResponse.status} ${errorText}` },
          502,
          corsHeaders
        );
      }

      return jsonResponse({ ok: true, message: "Queued broadcast update" }, 202, corsHeaders);
    }

    if (url.pathname === "/registration") {
      const users = Array.isArray(payload.users)
        ? payload.users.map((name) => String(name).trim()).filter(Boolean)
        : null;
      if (!users) {
        return jsonResponse({ ok: false, error: "users must be a list of names" }, 400, corsHeaders);
      }

      const githubResponse = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${env.GITHUB_TOKEN}`,
          "Content-Type": "application/json",
          "User-Agent": "wc26-toto-admin-worker",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({
          event_type: REGISTRATION_EVENT_TYPE,
          client_payload: { users },
        }),
      });

      if (!githubResponse.ok) {
        const errorText = await githubResponse.text();
        return jsonResponse(
          { ok: false, error: `GitHub dispatch failed: ${githubResponse.status} ${errorText}` },
          502,
          corsHeaders
        );
      }

      return jsonResponse({ ok: true, message: "Queued registration update" }, 202, corsHeaders);
    }

    if (url.pathname === "/restore") {
      const matchId = toNonNegativeInteger(payload.matchId);
      if (matchId === null) {
        return jsonResponse({ ok: false, error: "Invalid matchId" }, 400, corsHeaders);
      }

      const githubResponse = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${env.GITHUB_TOKEN}`,
          "Content-Type": "application/json",
          "User-Agent": "wc26-toto-admin-worker",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({
          event_type: RESTORE_EVENT_TYPE,
          client_payload: { matchId },
        }),
      });

      if (!githubResponse.ok) {
        const errorText = await githubResponse.text();
        return jsonResponse(
          { ok: false, error: `GitHub dispatch failed: ${githubResponse.status} ${errorText}` },
          502,
          corsHeaders
        );
      }

      return jsonResponse({ ok: true, message: `Queued match ${matchId} restore` }, 202, corsHeaders);
    }

    const matchId = toNonNegativeInteger(payload.matchId);
    const homeScore = toNonNegativeInteger(payload.homeScore);
    const awayScore = toNonNegativeInteger(payload.awayScore);

    if (matchId === null || homeScore === null || awayScore === null) {
      return jsonResponse({ ok: false, error: "Invalid matchId, homeScore, or awayScore" }, 400, corsHeaders);
    }

    const githubResponse = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        "Content-Type": "application/json",
        "User-Agent": "wc26-toto-admin-worker",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({
        event_type: DISPATCH_EVENT_TYPE,
        client_payload: {
          matchId,
          home: homeScore,
          away: awayScore,
        },
      }),
    });

    if (!githubResponse.ok) {
      const errorText = await githubResponse.text();
      return jsonResponse(
        { ok: false, error: `GitHub dispatch failed: ${githubResponse.status} ${errorText}` },
        502,
        corsHeaders
      );
    }

    return jsonResponse(
      {
        ok: true,
        message: `Queued match ${matchId}: ${homeScore}-${awayScore}`,
      },
      202,
      corsHeaders
    );
  },
};

async function downloadWorkbook(env, corsHeaders) {
  const repo = env.GITHUB_REPO || DEFAULT_REPO;
  const encodedPath = XLSX_REPO_PATH.split("/").map(encodeURIComponent).join("/");
  const githubResponse = await fetch(
    `https://api.github.com/repos/${repo}/contents/${encodedPath}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        "User-Agent": "wc26-toto-admin-worker",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    }
  );

  if (!githubResponse.ok) {
    const errorText = await githubResponse.text();
    return jsonResponse(
      { ok: false, error: `GitHub file fetch failed: ${githubResponse.status} ${errorText}` },
      githubResponse.status === 404 ? 404 : 502,
      corsHeaders
    );
  }

  const fileMeta = await githubResponse.json();
  if (!fileMeta.content || fileMeta.encoding !== "base64") {
    return jsonResponse({ ok: false, error: "Unexpected GitHub file response" }, 502, corsHeaders);
  }

  const binary = Uint8Array.from(atob(fileMeta.content.replace(/\n/g, "")), (char) => char.charCodeAt(0));
  return new Response(binary, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${XLSX_DOWNLOAD_NAME}"`,
      "Cache-Control": "no-store",
    },
  });
}

function buildCorsHeaders(origin, allowedOrigin) {
  const headers = {
    "Access-Control-Allow-Headers": "Content-Type, X-Admin-Password",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
  };

  if (isAllowedOrigin(origin, allowedOrigin) && origin) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  return headers;
}

function isAllowedOrigin(origin, allowedOrigin) {
  return (
    !origin ||
    origin === allowedOrigin ||
    origin.startsWith("http://localhost:") ||
    origin.startsWith("http://127.0.0.1:")
  );
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function toNonNegativeInteger(value) {
  const numberValue = Number(value);
  if (!Number.isInteger(numberValue) || numberValue < 0) {
    return null;
  }
  return numberValue;
}

function jsonResponse(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
  });
}
