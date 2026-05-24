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

- Scoreboard: http://localhost:8080/
- Admin: http://localhost:8080/admin/

### Test score changes via admin (local)

1. Run `make dev` (starts site + admin API on port 8090).
2. Open **Admin** → pick match → enter scores → **Publish locally**.
3. Open **Scoreboard** and refresh — hero + points should update.

CLI equivalent:

```sh
PYTHONPATH=. python3 scripts/publish_match.py 1 0 1
```

### Test score changes via admin (production, after merge to main)

1. Open https://mikizi.github.io/toto/admin/
2. Enter the shared admin password → **Publish**
3. Wait ~1–2 min for Actions + Pages deploy.

### One-time admin proxy setup

The production admin uses a free Cloudflare Worker so admins do not need GitHub tokens.

1. Create a GitHub token for the worker:
   - Classic token: `repo` scope, or fine-grained token with access to `mikizi/toto`
   - Store it only in Cloudflare, not in `public/`
2. Log in to Cloudflare and deploy:

```sh
npx wrangler login
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put ADMIN_PASSWORD
npx wrangler deploy
```

3. Copy the Worker URL from deploy output, for example:

```text
https://toto-admin-publish.your-subdomain.workers.dev
```

4. Update `PUBLISH_PROXY_URL` in `public/admin/admin.js` to:

```text
https://toto-admin-publish.your-subdomain.workers.dev/publish
```

5. Commit and push. Admins can then publish with the shared password only.

## Local tests

```sh
python scripts/run_local_tests.py
```

## Kickoff simulation (local)

Simulate the first match kicking off in 5 minutes. Before kickoff you see coming soon; when the countdown hits zero the scoreboard appears.

```sh
make simulate    # reset scores, move match 1 kickoff +5 min, export JSON
make serve       # in another terminal
open http://localhost:8080/
```

Restore the real schedule when done:

```sh
make simulate-restore
```

## Score simulation (local)

Verify that patching a result recalculates points and export correctly:

```sh
make simulate-scores
```

This runs day zero → 1-0 → 0-1 → 1-0 on a temp copy and checks real-user points after each step.

Apply a result to your local xlsx + site JSON (example: South Africa win 0-1):

```sh
make simulate-scores-apply
make serve
```

CI runs score + kickoff checks after merge via `.github/workflows/kickoff-simulation.yml`.

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
