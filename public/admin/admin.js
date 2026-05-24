/** Admin — publish results locally (dev) or via GitHub Actions (production) */

const DATA_URL = "../data/latest.json";
const LOCAL_API = "http://127.0.0.1:8090/publish";
const PUBLISH_PROXY_URL =
  "https://toto-admin-publish.mikizi-toto.workers.dev/publish";
const ADMIN_PASSWORD_STORAGE_KEY = "wc26-admin-password";

const IS_LOCAL =
  location.hostname === "localhost" || location.hostname === "127.0.0.1";

/** @typedef {{ id: number, teams: string, home: string, away: string, homeScore: number | null, awayScore: number | null, played: boolean }} AdminMatch */

/** @type {AdminMatch[]} */
let cachedMatches = [];

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("loginForm")?.addEventListener("submit", onLogin);
  document.getElementById("publishForm")?.addEventListener("submit", onPublish);
  document.getElementById("refreshBtn")?.addEventListener("click", loadData);
  document.getElementById("matchSelect")?.addEventListener("change", onMatchSelect);
  document.getElementById("logoutBtn")?.addEventListener("click", onLogout);
  setupModeBanner();
  initAuth();
});

function initAuth() {
  if (IS_LOCAL) {
    showAdminApp();
    return;
  }
  if (getSavedAdminPassword()) {
    showAdminApp();
    return;
  }
  showLoginScreen();
}

function showLoginScreen(message = "") {
  document.getElementById("loginScreen")?.classList.remove("hidden");
  document.getElementById("adminApp")?.classList.add("hidden");
  const loginMsg = document.getElementById("loginMsg");
  if (loginMsg) {
    setMessage(loginMsg, message, message ? "error" : "");
  }
  document.getElementById("loginPassword")?.focus();
}

function showAdminApp() {
  document.getElementById("loginScreen")?.classList.add("hidden");
  const app = document.getElementById("adminApp");
  app?.classList.remove("hidden");
  app?.classList.add("loaded");
  document.getElementById("logoutBtn")?.classList.toggle("hidden", IS_LOCAL);
  loadData();
}

/** @param {SubmitEvent} event */
function onLogin(event) {
  event.preventDefault();
  const input = document.getElementById("loginPassword");
  const loginMsg = document.getElementById("loginMsg");
  const password = input?.value.trim() ?? "";
  if (!password) {
    setMessage(loginMsg, "Enter the admin password.", "error");
    return;
  }
  saveAdminPassword(password);
  if (input) {
    input.value = "";
  }
  showAdminApp();
  setMessage(loginMsg, "", "");
}

function onLogout() {
  clearSavedAdminPassword();
  showLoginScreen();
}

function getSavedAdminPassword() {
  try {
    return localStorage.getItem(ADMIN_PASSWORD_STORAGE_KEY)?.trim() || "";
  } catch {
    return "";
  }
}

/** @param {string} password */
function saveAdminPassword(password) {
  try {
    localStorage.setItem(ADMIN_PASSWORD_STORAGE_KEY, password);
  } catch {
    // ignore quota / private mode
  }
}

function clearSavedAdminPassword() {
  try {
    localStorage.removeItem(ADMIN_PASSWORD_STORAGE_KEY);
  } catch {
    // ignore
  }
}

function setupModeBanner() {
  const localBox = document.getElementById("localModeBox");
  const prodBox = document.getElementById("prodModeBox");
  const modeBadge = document.getElementById("modeBadge");
  const submitBtn = document.getElementById("publishBtn");

  if (IS_LOCAL) {
    localBox?.classList.remove("hidden");
    prodBox?.classList.add("hidden");
    if (modeBadge) {
      modeBadge.textContent = "Local";
      modeBadge.classList.remove("hidden");
    }
    if (submitBtn) {
      submitBtn.textContent = "Publish locally";
    }
    return;
  }

  localBox?.classList.add("hidden");
  prodBox?.classList.remove("hidden");
  if (modeBadge) {
    modeBadge.textContent = "Production";
    modeBadge.classList.remove("hidden");
  }
  if (submitBtn) {
    submitBtn.textContent = "Publish";
  }
}

async function loadData() {
  const status = document.getElementById("statusMsg");
  try {
    const response = await fetch(DATA_URL, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    cachedMatches = data.matches;
    renderMatches(data.matches);
    renderLeaderboard(data.leaderboard);
    if (status) {
      status.textContent = `${data.gamesPlayed} game(s) played · version ${data.version}`;
    }
    onMatchSelect();
  } catch (err) {
    console.error(err);
    if (status) {
      status.textContent = "Could not load data.";
    }
  }
}

function onMatchSelect() {
  const matchId = Number(document.getElementById("matchSelect")?.value);
  const match = cachedMatches.find((m) => m.id === matchId);
  const homeInput = document.getElementById("homeScore");
  const awayInput = document.getElementById("awayScore");
  renderPublishHero(match);
  if (!match || !homeInput || !awayInput) {
    return;
  }
  if (match.played) {
    homeInput.value = String(match.homeScore ?? 0);
    awayInput.value = String(match.awayScore ?? 0);
    return;
  }
  homeInput.value = "";
  awayInput.value = "";
}

/** @param {AdminMatch | undefined} match */
function renderPublishHero(match) {
  const el = document.getElementById("publishHero");
  if (!el) {
    return;
  }
  if (!match) {
    el.innerHTML = '<div class="hero-empty">Select a match</div>';
    return;
  }
  const played = match.played;
  const centerMain = played
    ? `${match.homeScore}&nbsp;—&nbsp;${match.awayScore}`
    : "VS";
  el.innerHTML = `
    <div class="hero-body-inner">
      <div class="hero-grid">
        ${heroTeamBlock(match.home, "home")}
        ${adminHeroCenter(centerMain, match.id, !played)}
        ${heroTeamBlock(match.away, "away")}
      </div>
    </div>`;
}

/**
 * @param {string} main
 * @param {number} matchId
 * @param {boolean} isVs
 */
function adminHeroCenter(main, matchId, isVs) {
  return `
    <div class="hero-center">
      <div class="hero-score${isVs ? " hero-vs" : ""}">${main}</div>
      <div class="hero-meta">Match ${matchId}</div>
    </div>`;
}

/** @param {AdminMatch[]} matches */
function renderMatches(matches) {
  const tbody = document.getElementById("matchesBody");
  const select = document.getElementById("matchSelect");
  if (!tbody || !select) {
    return;
  }

  const sorted = [...matches].sort((a, b) => a.id - b.id);
  tbody.innerHTML = sorted
    .map((m) => {
      const score = m.played ? `${m.homeScore}–${m.awayScore}` : "—";
      const rowClass = m.played ? "" : "is-unplayed";
      return `<tr class="${rowClass}">
        <td>${m.id}</td>
        <td>
          <div class="admin-match-row">
            <span class="admin-match-side admin-match-side--home">
              ${flagHtml(m.home, "sm")}
              <span>${escapeHtml(m.home)}</span>
            </span>
            <span class="admin-match-vs">vs</span>
            <span class="admin-match-side admin-match-side--away">
              ${flagHtml(m.away, "sm")}
              <span>${escapeHtml(m.away)}</span>
            </span>
          </div>
        </td>
        <td>${score}</td>
      </tr>`;
    })
    .join("");

  const nextUnplayed = sorted.find((m) => !m.played);
  select.innerHTML = sorted
    .map((m) => {
      const selected = nextUnplayed && m.id === nextUnplayed.id ? " selected" : "";
      return `<option value="${m.id}"${selected}>Match ${m.id}: ${escapeHtml(m.home)} vs ${escapeHtml(m.away)}${
        m.played ? ` (${m.homeScore}-${m.awayScore})` : ""
      }</option>`;
    })
    .join("");
}

/** @param {Array<{ rank: number | null, name: string, points: number }>} leaderboard */
function renderLeaderboard(leaderboard) {
  const list = document.getElementById("leaderboardList");
  if (!list) {
    return;
  }
  const sorted = [...leaderboard].sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999));
  list.innerHTML = sorted
    .slice(0, 12)
    .map(
      (e) =>
        `<div class="admin-lb-row">
          <span class="admin-lb-rank">${e.rank ?? "—"}</span>
          <span class="admin-lb-name">${escapeHtml(e.name)}</span>
          <span class="admin-lb-pts">${e.points.toFixed(0)}</span>
        </div>`
    )
    .join("");
}

/** @param {SubmitEvent} event */
async function onPublish(event) {
  event.preventDefault();
  const matchId = Number(document.getElementById("matchSelect")?.value);
  const homeScore = Number(document.getElementById("homeScore")?.value);
  const awayScore = Number(document.getElementById("awayScore")?.value);
  const msg = document.getElementById("publishMsg");

  if (Number.isNaN(homeScore) || Number.isNaN(awayScore) || homeScore < 0 || awayScore < 0) {
    setMessage(msg, "Enter valid scores (0 or more).", "error");
    return;
  }

  if (IS_LOCAL) {
    await publishLocally(matchId, homeScore, awayScore, msg);
    return;
  }

  await publishViaProxy(matchId, homeScore, awayScore, msg);
}

/**
 * @param {number} matchId
 * @param {number} homeScore
 * @param {number} awayScore
 * @param {HTMLElement | null} msg
 */
async function publishViaProxy(matchId, homeScore, awayScore, msg) {
  if (!isProxyConfigured()) {
    setMessage(msg, "Admin proxy is not configured yet. Deploy the Cloudflare Worker first.", "error");
    return;
  }

  const password = getSavedAdminPassword();
  if (!password) {
    showLoginScreen("Sign in to publish results.");
    return;
  }

  setMessage(msg, "Publishing…", "");
  const publishBtn = document.getElementById("publishBtn");
  if (publishBtn) {
    publishBtn.disabled = true;
  }

  try {
    const response = await fetch(PUBLISH_PROXY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Password": password,
      },
      body: JSON.stringify({
        matchId,
        homeScore,
        awayScore,
      }),
    });
    if (!response.ok) {
      if (response.status === 401) {
        clearSavedAdminPassword();
        showLoginScreen("Wrong password. Try again.");
        throw new Error("Wrong admin password.");
      }
      const text = await response.text();
      throw new Error(`${response.status}: ${text}`);
    }
    setMessage(
      msg,
      "Queued! Check GitHub Actions, then refresh the scoreboard in ~2 min.",
      "success"
    );
  } catch (err) {
    console.error(err);
    if (err instanceof Error && err.message === "Wrong admin password.") {
      return;
    }
    const message = err instanceof Error ? err.message : "unknown error";
    if (message === "Failed to fetch") {
      setMessage(
        msg,
        "Could not reach the admin proxy. Wait 2–3 min after deploy, refresh, and try again.",
        "error"
      );
    } else {
      setMessage(msg, `Failed: ${message}`, "error");
    }
  } finally {
    if (publishBtn) {
      publishBtn.disabled = false;
    }
  }
}

function isProxyConfigured() {
  return !PUBLISH_PROXY_URL.includes("YOUR_WORKERS_SUBDOMAIN");
}

/**
 * @param {number} matchId
 * @param {number} homeScore
 * @param {number} awayScore
 * @param {HTMLElement | null} msg
 */
async function publishLocally(matchId, homeScore, awayScore, msg) {
  setMessage(msg, "Publishing locally (patch → recalc → export)…", "");
  const publishBtn = document.getElementById("publishBtn");
  if (publishBtn) {
    publishBtn.disabled = true;
  }

  try {
    const response = await fetch(LOCAL_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        match_id: matchId,
        home_score: homeScore,
        away_score: awayScore,
      }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }
    await loadData();
    setMessage(msg, `Published ${data.teams} ${data.score}. Open scoreboard to verify.`, "success");
  } catch (err) {
    console.error(err);
    setMessage(
      msg,
      `Local publish failed. Run "make dev" (starts admin API). ${err instanceof Error ? err.message : ""}`,
      "error"
    );
  } finally {
    if (publishBtn) {
      publishBtn.disabled = false;
    }
  }
}

/**
 * @param {HTMLElement | null} el
 * @param {string} text
 * @param {"" | "error" | "success"} tone
 */
function setMessage(el, text, tone) {
  if (!el) {
    return;
  }
  el.textContent = text;
  el.classList.remove("is-error", "is-success");
  if (tone === "error") {
    el.classList.add("is-error");
  } else if (tone === "success") {
    el.classList.add("is-success");
  }
}
