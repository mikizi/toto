# World Cup 2026 Toto

Private friends pool — scoreboard reads `public/data/latest.json` (exported from `xlsx/Master WorldCup26.xlsx`).

## Public site

Everything the browser loads lives in **`public/`**:

- **Scoreboard:** `public/index.html` → https://mikizi.github.io/toto/
- **Admin:** `public/admin/`

GitHub Pages deploys the `public/` folder (see `.github/workflows/pages.yml`).

## Publish a match result (during tournament)

1. [Actions → Publish match result](https://github.com/mikizi/toto/actions/workflows/publish-results.yml)
2. Run workflow → match #, home score, away score
3. Wait ~1–2 min → site updates (Pages redeploys on push)

## Local dev

```sh
pip install -r requirements.txt
make dev
```

- Scoreboard: http://localhost:8080/index.html
- Admin: http://localhost:8080/admin/

## Local tests

```sh
python scripts/run_local_tests.py
```

## Repo layout

```text
public/                 ← entire client app (GitHub Pages root)
  index.html
  manifest.json         ← PWA
  admin/
  css/styles.css
  js/app.js
  assets/               ← images only
    bg.png, bg-card-header.png, euro2024_bets.png
    icons/
  data/latest.json
xlsx/                   ← Master WorldCup26.xlsx
scripts/                ← patch, recalc, export
tests/
legacy/                 ← old Euro 2024 app
.github/workflows/      ← pages.yml + publish-results.yml
```

## PWA

After merge, set **GitHub Pages → Source: GitHub Actions** in repo settings (one-time).

PWA icons and background images live under `public/assets/`. Replace `euro2024_bets.png` with a WC26 share image when ready.
