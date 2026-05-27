/** Admin — publish results locally (dev) or via GitHub Actions (production) */

const DATA_URL = "../data/latest.json";
const LOCAL_API = "http://127.0.0.1:8090/publish";
const LOCAL_RESTORE_API = "http://127.0.0.1:8090/restore";
const LOCAL_BROADCAST_API = "http://127.0.0.1:8090/broadcast";
const LOCAL_REGISTRATION_API = "http://127.0.0.1:8090/registration";
const LOCAL_XLSX_API = "http://127.0.0.1:8090/xlsx";
const XLSX_FILENAME = "Master WorldCup26.xlsx";
const PUBLISH_PROXY_URL =
  "https://toto-admin-publish.mikizi-toto.workers.dev/publish";
const RESTORE_PROXY_URL =
  "https://toto-admin-publish.mikizi-toto.workers.dev/restore";
const BROADCAST_PROXY_URL =
  "https://toto-admin-publish.mikizi-toto.workers.dev/broadcast";
const REGISTRATION_PROXY_URL =
  "https://toto-admin-publish.mikizi-toto.workers.dev/registration";
const XLSX_PROXY_URL = "https://toto-admin-publish.mikizi-toto.workers.dev/xlsx";
const ADMIN_PASSWORD_STORAGE_KEY = "wc26-admin-password";

const IS_LOCAL =
  location.hostname === "localhost" || location.hostname === "127.0.0.1";

/** @typedef {{ id: number, teams: string, home: string, away: string, homeScore: number | null, awayScore: number | null, played: boolean, kickoffAt?: string | null }} AdminMatch */
/** @typedef {{ mode: string, openMatchIds: number[], suppressAuto: boolean }} BroadcastState */
/** @typedef {{ users: string[], count: number, entryFee: number, goalUsers: number, goalPrize: number, prizePool: number, closesAt: string | null }} RegistrationState */

/** @type {AdminMatch[]} */
let cachedMatches = [];

/** @type {BroadcastState | null} */
let cachedBroadcast = null;

/** @type {RegistrationState | null} */
let cachedRegistration = null;

/** @type {number | null} */
let selectedMatchId = null;

/** @type {"match" | "players" | "standings"} */
let activeAdminTab = "match";

/** @type {string[]} */
let registrationDraftUsers = [];

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("loginForm")?.addEventListener("submit", onLogin);
  document.getElementById("publishForm")?.addEventListener("submit", onPublish);
  document.getElementById("refreshBtn")?.addEventListener("click", loadData);
  document.getElementById("downloadXlsxBtn")?.addEventListener("click", () => void downloadXlsx());
  document.getElementById("logoutBtn")?.addEventListener("click", onLogout);
  document.getElementById("modeBannerToggle")?.addEventListener("click", toggleModeBanner);
  document.getElementById("matchesList")?.addEventListener("click", onMatchesListClick);
  document.getElementById("matchesList")?.addEventListener("keydown", onMatchesListKeydown);
  document.getElementById("saveRegBtn")?.addEventListener("click", saveRegistration);
  document.getElementById("addRegPlayerBtn")?.addEventListener("click", addRegistrationNameFromInput);
  document.getElementById("regPlayerNameInput")?.addEventListener("keydown", onRegistrationNameKeydown);
  document.getElementById("regPlayerNameInput")?.addEventListener("paste", onRegistrationNamePaste);
  document.getElementById("regPlayerChips")?.addEventListener("click", onRegistrationChipClick);
  document.querySelectorAll(".admin-tab").forEach((btn) => {
    btn.addEventListener("click", onAdminTabClick);
  });
  setupModeBanner();
  initAuth();
});

/** @param {MouseEvent} event */
function onAdminTabClick(event) {
  const btn = event.currentTarget;
  if (!(btn instanceof HTMLButtonElement)) {
    return;
  }
  const tab = btn.getAttribute("data-tab");
  if (tab === "match" || tab === "players" || tab === "standings") {
    setAdminTab(tab);
  }
}

/** @param {"match" | "players" | "standings"} tab */
function setAdminTab(tab) {
  activeAdminTab = tab;
  const panels = {
    match: document.getElementById("tabPanelMatch"),
    players: document.getElementById("tabPanelPlayers"),
    standings: document.getElementById("tabPanelStandings"),
  };
  const buttons = {
    match: document.getElementById("tabBtnMatch"),
    players: document.getElementById("tabBtnPlayers"),
    standings: document.getElementById("tabBtnStandings"),
  };
  for (const key of Object.keys(panels)) {
    const panel = panels[key];
    const button = buttons[key];
    const isActive = key === tab;
    panel?.classList.toggle("is-active", isActive);
    panel?.classList.toggle("hidden", !isActive);
    if (panel) {
      panel.hidden = !isActive;
    }
    if (button) {
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-selected", String(isActive));
    }
  }
}

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
  const modeToggle = document.getElementById("modeBannerToggle");
  const submitBtn = document.getElementById("publishBtn");

  modeToggle?.classList.remove("hidden");

  if (IS_LOCAL) {
    localBox?.classList.remove("hidden");
    prodBox?.classList.add("hidden");
    if (modeBadge) {
      modeBadge.textContent = "Local";
      modeBadge.classList.add("is-local");
      modeBadge.classList.remove("hidden");
    }
    if (submitBtn) {
      submitBtn.textContent = "Publish";
    }
    return;
  }

  localBox?.classList.add("hidden");
  prodBox?.classList.remove("hidden");
  if (modeBadge) {
    modeBadge.textContent = "Production";
    modeBadge.classList.remove("is-local");
    modeBadge.classList.remove("hidden");
  }
  if (submitBtn) {
    submitBtn.textContent = "Publish";
  }
}

function toggleModeBanner() {
  const detail = document.getElementById("modeBannerDetail");
  const toggle = document.getElementById("modeBannerToggle");
  if (!detail || !toggle) {
    return;
  }
  const isOpen = detail.classList.toggle("hidden") === false;
  toggle.setAttribute("aria-expanded", String(isOpen));
  toggle.textContent = isOpen ? "Hide" : "Info";
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
    cachedBroadcast = normalizeBroadcast(data.broadcast);
    cachedRegistration = normalizeRegistration(data.registration, data.matches);
    renderRegistration(cachedRegistration);
    renderMatches(data.matches, cachedBroadcast);
    renderLeaderboard(data.leaderboard);
    if (status) {
      status.textContent = `${data.gamesPlayed} game(s) played · version ${data.version}`;
    }
    applySelectedMatch();
  } catch (err) {
    console.error(err);
    if (status) {
      status.textContent = "Could not load data.";
    }
  }
}

/**
 * @param {number} matchId
 * @param {{ focusScores?: boolean }} [options]
 */
function selectMatch(matchId, options = {}) {
  if (Number.isNaN(matchId)) {
    return;
  }
  selectedMatchId = matchId;
  applySelectedMatch(options.focusScores ?? false);
}

function applySelectedMatch(focusScores = false) {
  const match = cachedMatches.find((m) => m.id === selectedMatchId);
  const homeInput = document.getElementById("homeScore");
  const awayInput = document.getElementById("awayScore");
  const publishBtn = document.getElementById("publishBtn");
  const publishRow = document.getElementById("publishRow");
  const publishEmpty = document.getElementById("publishEmpty");
  renderPublishMatch(match);
  publishRow?.classList.toggle("is-empty", !match);
  publishEmpty?.classList.toggle("hidden", Boolean(match));
  updateMatchRowHighlights();
  if (publishBtn) {
    publishBtn.disabled = !match;
  }
  if (homeInput && awayInput) {
    homeInput.disabled = !match;
    awayInput.disabled = !match;
  }
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
  if (focusScores) {
    homeInput.focus();
  }
}

/** @param {MouseEvent} event */
function onMatchesListClick(event) {
  const liveBtn = event.target instanceof Element ? event.target.closest(".admin-live-btn") : null;
  if (liveBtn) {
    event.preventDefault();
    event.stopPropagation();
    const matchId = Number(liveBtn.getAttribute("data-match-id"));
    if (!Number.isNaN(matchId)) {
      void toggleMatchLive(matchId);
    }
    return;
  }
  const restoreBtn = event.target instanceof Element ? event.target.closest(".admin-restore-btn") : null;
  if (restoreBtn) {
    event.preventDefault();
    event.stopPropagation();
    const matchId = Number(restoreBtn.getAttribute("data-match-id"));
    if (!Number.isNaN(matchId)) {
      void restoreMatchScore(matchId);
    }
    return;
  }
  onMatchCardClick(event);
}

/** @param {MouseEvent} event */
function onMatchCardClick(event) {
  const card = event.target instanceof Element ? event.target.closest(".admin-match-card[data-match-id]") : null;
  if (!card) {
    return;
  }
  const matchId = Number(card.getAttribute("data-match-id"));
  if (Number.isNaN(matchId)) {
    return;
  }
  selectMatch(matchId, { focusScores: true });
  scrollToPublish();
}

/** @param {KeyboardEvent} event */
function onMatchesListKeydown(event) {
  const liveBtn = event.target instanceof Element ? event.target.closest(".admin-live-btn") : null;
  if (liveBtn && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    const matchId = Number(liveBtn.getAttribute("data-match-id"));
    if (!Number.isNaN(matchId)) {
      void toggleMatchLive(matchId);
    }
    return;
  }
  const restoreBtn = event.target instanceof Element ? event.target.closest(".admin-restore-btn") : null;
  if (restoreBtn && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    const matchId = Number(restoreBtn.getAttribute("data-match-id"));
    if (!Number.isNaN(matchId)) {
      void restoreMatchScore(matchId);
    }
    return;
  }
  onMatchCardKeydown(event);
}

/** @param {KeyboardEvent} event */
function onMatchCardKeydown(event) {
  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }
  const card = event.target instanceof Element ? event.target.closest(".admin-match-card[data-match-id]") : null;
  if (!card) {
    return;
  }
  event.preventDefault();
  const matchId = Number(card.getAttribute("data-match-id"));
  if (Number.isNaN(matchId)) {
    return;
  }
  selectMatch(matchId, { focusScores: true });
  scrollToPublish();
}

function scrollToPublish() {
  if (activeAdminTab !== "match") {
    setAdminTab("match");
  }
  document.querySelector(".admin-publish-sticky")?.scrollIntoView({ block: "start", behavior: "smooth" });
}

function updateMatchRowHighlights() {
  const nextUnplayed = getNextUnplayedMatch(cachedMatches);
  const openIds = new Set(cachedBroadcast?.openMatchIds || []);
  document.querySelectorAll("#matchesList .admin-match-card[data-match-id]").forEach((card) => {
    const matchId = Number(card.getAttribute("data-match-id"));
    card.classList.toggle("is-selected", matchId === selectedMatchId);
    card.classList.toggle("is-next", Boolean(nextUnplayed && matchId === nextUnplayed.id));
    card.classList.toggle("is-live", openIds.has(matchId));
  });
}

/**
 * @param {AdminMatch[]} matches
 * @returns {AdminMatch | undefined}
 */
function getNextUnplayedMatch(matches) {
  return [...matches].sort((a, b) => a.id - b.id).find((m) => !m.played);
}

/**
 * @param {AdminMatch[]} matches
 * @param {BroadcastState} broadcast
 * @returns {AdminMatch | undefined}
 */
function getFocusedMatch(matches, broadcast) {
  const sorted = [...matches].sort((a, b) => a.id - b.id);
  const openIds = new Set(broadcast.openMatchIds || []);
  return sorted.find((m) => openIds.has(m.id)) || sorted.find((m) => !m.played) || sorted[sorted.length - 1];
}

/** @param {string} teamName */
function adminShortTeamName(teamName) {
  const trimmed = teamName.trim();
  if (trimmed.length <= 18) {
    return trimmed;
  }
  const words = trimmed.split(/\s+/);
  if (words.length === 1) {
    return trimmed.slice(0, 16);
  }
  const abbrev = words.map((word) => word.slice(0, 4)).join(" ");
  return abbrev.length <= 20 ? abbrev : `${words[0].slice(0, 10)}…`;
}

/**
 * @param {string} teamName
 * @param {boolean} [withTitle]
 */
function adminMatchNameHtml(teamName, withTitle = true) {
  const titleAttr = withTitle ? ` title="${escapeHtml(teamName)}"` : "";
  return `<span class="admin-match-name"${titleAttr}>${escapeHtml(teamName)}</span>`;
}

/**
 * @param {string} teamName
 */
function adminPublishEndHtml(teamName) {
  return `<span class="admin-publish-flag">${flagHtml(teamName, "sm")}</span><span class="admin-publish-team-name" title="${escapeHtml(teamName)}">${escapeHtml(adminShortTeamName(teamName))}</span>`;
}

/** @param {AdminMatch | undefined} match */
function renderPublishMatch(match) {
  const num = document.getElementById("publishNum");
  const home = document.getElementById("publishHome");
  const away = document.getElementById("publishAway");
  if (!num || !home || !away) {
    return;
  }
  if (!match) {
    num.textContent = "—";
    home.innerHTML = "";
    away.innerHTML = "";
    return;
  }
  num.textContent = `#${match.id}`;
  home.innerHTML = adminPublishEndHtml(match.home);
  away.innerHTML = adminPublishEndHtml(match.away);
}

const LIVE_PLAY_SVG = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7L8 5z"/></svg>`;
const LIVE_STOP_SVG = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 6h12v12H6V6z"/></svg>`;
const RESTORE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 3v6h6"/></svg>`;

/**
 * @param {number} matchId
 * @param {boolean} isLive
 * @param {boolean} isPlayed
 */
function adminLiveButtonHtml(matchId, isLive, isPlayed) {
  if (isLive) {
    return `<button type="button" class="admin-live-btn admin-live-btn--stop" data-match-id="${matchId}" aria-label="Stop live — match ${matchId}">
      ${LIVE_STOP_SVG}
    </button>`;
  }
  if (isPlayed) {
    return "";
  }
  return `<button type="button" class="admin-live-btn admin-live-btn--play" data-match-id="${matchId}" aria-label="Go live — match ${matchId}">
    ${LIVE_PLAY_SVG}
  </button>`;
}

/**
 * @param {number} matchId
 * @param {boolean} isLive
 * @param {boolean} isPlayed
 */
function adminRestoreButtonHtml(matchId, isLive, isPlayed) {
  if (!isPlayed || isLive) {
    return "";
  }
  return `<button type="button" class="admin-restore-btn" data-match-id="${matchId}" aria-label="Restore match ${matchId}">
    ${RESTORE_SVG}
  </button>`;
}

/**
 * @param {AdminMatch[]} matches
 * @param {BroadcastState} broadcast
 */
function renderMatches(matches, broadcast) {
  const list = document.getElementById("matchesList");
  if (!list) {
    return;
  }

  const sorted = [...matches].sort((a, b) => a.id - b.id);
  const nextUnplayed = getNextUnplayedMatch(sorted);
  const openIds = new Set(broadcast.openMatchIds || []);
  selectedMatchId = getFocusedMatch(sorted, broadcast)?.id ?? null;

  list.innerHTML = sorted
    .map((m) => {
      const score = m.played ? `${m.homeScore}–${m.awayScore}` : "—";
      const isLive = openIds.has(m.id);
      const cardClasses = [
        "admin-match-card",
        m.played ? "is-played" : "is-unplayed",
        "is-clickable",
      ];
      if (nextUnplayed && m.id === nextUnplayed.id) {
        cardClasses.push("is-next");
      }
      if (selectedMatchId === m.id) {
        cardClasses.push("is-selected");
      }
      if (isLive) {
        cardClasses.push("is-live");
      }
      const liveBtn = adminLiveButtonHtml(m.id, isLive, m.played);
      const restoreBtn = adminRestoreButtonHtml(m.id, isLive, m.played);
      const liveBadge = isLive ? '<span class="admin-match-live-badge">LIVE</span>' : "";
      return `<article class="${cardClasses.join(" ")}" data-match-id="${m.id}" role="listitem" tabindex="0" aria-label="Match ${m.id}: ${escapeHtml(m.home)} vs ${escapeHtml(m.away)}">
        <span class="admin-match-num">#${m.id}</span>
        <span class="admin-match-team admin-match-team--home">
          <span class="admin-match-flag">${flagHtml(m.home, "sm")}</span>
          ${adminMatchNameHtml(m.home)}
        </span>
        <span class="admin-match-center">
          ${liveBadge}
          <span class="admin-match-score${m.played ? " is-played-score" : ""}">${score}</span>
        </span>
        <span class="admin-match-team admin-match-team--away">
          <span class="admin-match-flag">${flagHtml(m.away, "sm")}</span>
          ${adminMatchNameHtml(m.away)}
        </span>
        ${liveBtn || restoreBtn ? `<span class="admin-match-live">${liveBtn || restoreBtn}</span>` : '<span class="admin-match-live" aria-hidden="true"></span>'}
      </article>`;
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
  const matchId = selectedMatchId;
  const homeScore = Number(document.getElementById("homeScore")?.value);
  const awayScore = Number(document.getElementById("awayScore")?.value);
  const msg = document.getElementById("publishMsg");

  if (!matchId) {
    setMessage(msg, "Pick a match first.", "error");
    return;
  }
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

/** @param {number} matchId */
async function restoreMatchScore(matchId) {
  const match = cachedMatches.find((m) => m.id === matchId);
  const msg = document.getElementById("liveMsg");
  if (!match) {
    setMessage(msg, "Match not found.", "error");
    return;
  }
  if (!window.confirm(`Restore match ${matchId} and clear ${match.home} vs ${match.away} score?`)) {
    return;
  }
  if (IS_LOCAL) {
    await restoreMatchLocally(matchId, msg);
    return;
  }
  await restoreMatchViaProxy(matchId, msg);
}

/**
 * @param {number} matchId
 * @param {HTMLElement | null} msg
 */
async function restoreMatchLocally(matchId, msg) {
  setMessage(msg, "Restoring…", "");
  try {
    const response = await fetch(LOCAL_RESTORE_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ match_id: matchId }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }
    await loadData();
    setMessage(msg, "Restored.", "success");
  } catch (err) {
    console.error(err);
    setMessage(
      msg,
      `Restore failed. Run "make dev". ${err instanceof Error ? err.message : ""}`,
      "error"
    );
  }
}

/**
 * @param {number} matchId
 * @param {HTMLElement | null} msg
 */
async function restoreMatchViaProxy(matchId, msg) {
  if (!isProxyConfigured()) {
    setMessage(msg, "Admin proxy is not configured yet.", "error");
    return;
  }
  const password = getSavedAdminPassword();
  if (!password) {
    showLoginScreen("Sign in to restore a match.");
    return;
  }
  setMessage(msg, "Restoring…", "");
  try {
    const response = await fetch(RESTORE_PROXY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Password": password,
      },
      body: JSON.stringify({ matchId }),
    });
    if (!response.ok) {
      if (response.status === 401) {
        clearSavedAdminPassword();
        showLoginScreen("Wrong password. Try again.");
        return;
      }
      const text = await response.text();
      throw new Error(`${response.status}: ${text}`);
    }
    applyRestoredMatch(matchId);
    setMessage(msg, "Restore queued. Refresh scoreboard in ~1 min.", "success");
  } catch (err) {
    console.error(err);
    setMessage(msg, `Restore failed: ${err instanceof Error ? err.message : "unknown error"}`, "error");
  }
}

/** @param {number} matchId */
function applyRestoredMatch(matchId) {
  cachedMatches = cachedMatches.map((match) =>
    match.id === matchId
      ? { ...match, homeScore: null, awayScore: null, played: false }
      : match
  );
  cachedBroadcast = normalizeBroadcast({
    ...(cachedBroadcast || {}),
    openMatchIds: (cachedBroadcast?.openMatchIds || []).filter((id) => id !== matchId),
  });
  renderMatches(cachedMatches, cachedBroadcast);
  applySelectedMatch();
}

function isProxyConfigured() {
  return !PUBLISH_PROXY_URL.includes("YOUR_WORKERS_SUBDOMAIN");
}

async function downloadXlsx() {
  const btn = document.getElementById("downloadXlsxBtn");
  const status = document.getElementById("statusMsg");
  const previousStatus = status?.textContent ?? "";

  if (btn) {
    btn.disabled = true;
  }
  if (status) {
    status.textContent = "Downloading workbook…";
  }

  try {
    let response;
    if (IS_LOCAL) {
      response = await fetch(LOCAL_XLSX_API);
    } else {
      if (!isProxyConfigured()) {
        if (status) {
          status.textContent = "Admin proxy not configured.";
        }
        return;
      }
      const password = getSavedAdminPassword();
      if (!password) {
        showLoginScreen("Sign in to download the workbook.");
        return;
      }
      response = await fetch(XLSX_PROXY_URL, {
        headers: { "X-Admin-Password": password },
      });
      if (response.status === 401) {
        clearSavedAdminPassword();
        showLoginScreen("Wrong password. Try again.");
        return;
      }
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(detail || `HTTP ${response.status}`);
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = XLSX_FILENAME;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    if (status) {
      status.textContent = previousStatus || "Download started.";
    }
  } catch (err) {
    console.error(err);
    if (status) {
      const hint = IS_LOCAL ? ' Run "make dev".' : "";
      status.textContent = `Download failed.${hint} ${err instanceof Error ? err.message : ""}`.trim();
    }
  } finally {
    if (btn) {
      btn.disabled = false;
    }
  }
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
 * @param {number} matchId
 */
async function toggleMatchLive(matchId) {
  const msg = document.getElementById("liveMsg");
  const openIds = [...(cachedBroadcast?.openMatchIds || [])];
  const isLive = openIds.includes(matchId);
  let newIds;
  if (isLive) {
    newIds = openIds.filter((id) => id !== matchId);
  } else {
    if (openIds.length >= 2) {
      setMessage(msg, "At most 2 matches can be live at once.", "error");
      return;
    }
    newIds = [...openIds, matchId];
  }
  await setMatchLive(newIds, msg);
}

/**
 * @param {number[]} openMatchIds
 * @param {HTMLElement | null} msg
 */
async function setMatchLive(openMatchIds, msg) {
  const payload = {
    action: openMatchIds.length === 0 ? "clear_manual" : "set",
    openMatchIds,
    suppressAuto: false,
  };
  if (IS_LOCAL) {
    await postBroadcastLocally(payload, msg);
    return;
  }
  const queued = await postBroadcastViaProxy(payload, msg);
  if (queued) {
    applyQueuedBroadcast(openMatchIds);
  }
}

/** @param {number[]} openMatchIds */
function applyQueuedBroadcast(openMatchIds) {
  const openIdSet = new Set(openMatchIds);
  cachedMatches = cachedMatches.map((match) =>
    openIdSet.has(match.id) && !match.played
      ? { ...match, homeScore: 0, awayScore: 0, played: true }
      : match
  );
  cachedBroadcast = normalizeBroadcast({
    ...(cachedBroadcast || {}),
    openMatchIds,
    suppressAuto: false,
  });
  renderMatches(cachedMatches, cachedBroadcast);
  applySelectedMatch();
}

/**
 * @param {Record<string, unknown>} payload
 * @param {HTMLElement | null} msg
 */
async function postBroadcastLocally(payload, msg) {
  setMessage(msg, "Updating…", "");
  try {
    const response = await fetch(LOCAL_BROADCAST_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }
    await loadData();
    setMessage(msg, "Updated.", "success");
  } catch (err) {
    console.error(err);
    setMessage(
      msg,
      `Broadcast update failed. Run "make dev". ${err instanceof Error ? err.message : ""}`,
      "error"
    );
  }
}

/**
 * @param {Record<string, unknown>} payload
 * @param {HTMLElement | null} msg
 */
async function postBroadcastViaProxy(payload, msg) {
  if (!isProxyConfigured()) {
    setMessage(msg, "Admin proxy is not configured yet.", "error");
    return false;
  }
  const password = getSavedAdminPassword();
  if (!password) {
    showLoginScreen("Sign in to go live.");
    return false;
  }
  setMessage(msg, "Updating…", "");
  try {
    const response = await fetch(BROADCAST_PROXY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Password": password,
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      if (response.status === 401) {
        clearSavedAdminPassword();
        showLoginScreen("Wrong password. Try again.");
        return false;
      }
      const text = await response.text();
      throw new Error(`${response.status}: ${text}`);
    }
    setMessage(msg, "Queued. Refresh scoreboard in ~1 min.", "success");
    return true;
  } catch (err) {
    console.error(err);
    setMessage(msg, `Failed: ${err instanceof Error ? err.message : "unknown error"}`, "error");
    return false;
  }
}

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

/**
 * @param {number} value
 * @param {number} goal
 */
function progressPercent(value, goal) {
  if (goal <= 0) {
    return 0;
  }
  return Math.min(100, Math.round((value / goal) * 100));
}

/** @param {string | null} iso */
function formatRegistrationDeadline(iso) {
  if (!iso) {
    return "Registration closes 1 hour before the first match.";
  }
  const closesMs = Date.parse(iso);
  if (Number.isNaN(closesMs)) {
    return "";
  }
  const formatter = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  return `Registration closes ${formatter.format(new Date(closesMs))}.`;
}

/** @param {RegistrationState} registration */
function renderRegistration(registration) {
  const section = document.getElementById("registrationSection");
  const closedMsg = document.getElementById("registrationClosedMsg");
  const playersTab = document.getElementById("tabBtnPlayers");
  if (!section) {
    return;
  }
  const open = isRegistrationOpen(registration);
  section.classList.toggle("hidden", !open);
  closedMsg?.classList.toggle("hidden", open);
  playersTab?.classList.toggle("hidden", !open);
  if (!open) {
    if (activeAdminTab === "players") {
      setAdminTab("match");
    }
    return;
  }

  const playerCount = document.getElementById("regPlayerCount");
  const playerGoal = document.getElementById("regPlayerGoal");
  const playerBar = document.getElementById("regPlayerBar");
  const playerBarWrap = document.getElementById("regPlayerBarWrap");
  const prizePool = document.getElementById("regPrizePool");
  const prizeGoal = document.getElementById("regPrizeGoal");
  const prizeBar = document.getElementById("regPrizeBar");
  const prizeBarWrap = document.getElementById("regPrizeBarWrap");
  const deadline = document.getElementById("regDeadline");
  const nameInput = document.getElementById("regPlayerNameInput");
  const intro = document.querySelector(".admin-reg-intro");

  const playerPct = progressPercent(registration.count, registration.goalUsers);
  const prizePct = progressPercent(registration.prizePool, registration.goalPrize);

  if (intro) {
    intro.textContent = `${formatMoney(registration.entryFee)}/player · goal ${formatMoney(registration.goalPrize)} · closes 1h before kickoff`;
  }

  if (playerCount) {
    playerCount.textContent = String(registration.count);
  }
  if (playerGoal) {
    playerGoal.textContent = `/ ${registration.goalUsers}`;
  }
  if (playerBar) {
    playerBar.style.width = `${playerPct}%`;
  }
  if (playerBarWrap) {
    playerBarWrap.setAttribute("aria-valuenow", String(registration.count));
    playerBarWrap.setAttribute("aria-valuemax", String(registration.goalUsers));
  }
  if (prizePool) {
    prizePool.textContent = formatMoney(registration.prizePool);
  }
  if (prizeGoal) {
    prizeGoal.textContent = `/ ${formatMoneyCompact(registration.goalPrize)}`;
  }
  if (prizeBar) {
    prizeBar.style.width = `${prizePct}%`;
  }
  if (prizeBarWrap) {
    prizeBarWrap.setAttribute("aria-valuenow", String(registration.prizePool));
    prizeBarWrap.setAttribute("aria-valuemax", String(registration.goalPrize));
  }
  if (deadline) {
    deadline.textContent = formatRegistrationDeadline(registration.closesAt);
  }
  if (document.activeElement !== nameInput) {
    setRegistrationDraftUsers(registration.users);
  } else {
    renderRegistrationDraftUsers();
  }
}

/** @returns {string[]} */
function parseRegistrationUsers() {
  return [...registrationDraftUsers];
}

/** @param {string} raw */
function splitRegistrationNames(raw) {
  return raw.split(/[\n,;]+/).map((name) => name.trim()).filter(Boolean);
}

/** @param {string[]} users */
function setRegistrationDraftUsers(users) {
  const seen = new Set();
  registrationDraftUsers = [];
  for (const rawName of users) {
    const name = rawName.trim();
    if (!name) {
      continue;
    }
    const key = name.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    registrationDraftUsers.push(name);
  }
  renderRegistrationDraftUsers();
}

function renderRegistrationDraftUsers() {
  const chips = document.getElementById("regPlayerChips");
  const count = registrationDraftUsers.length;
  const draftCount = document.getElementById("regDraftCount");
  if (draftCount) {
    draftCount.textContent = `${count} ${count === 1 ? "player" : "players"}`;
  }
  if (!chips) {
    return;
  }
  if (count === 0) {
    chips.innerHTML = '<p class="admin-player-empty">No players yet. Add the first player below.</p>';
    return;
  }
  chips.innerHTML = registrationDraftUsers
    .map(
      (name, index) =>
        `<span class="admin-player-chip" role="listitem">
          <span class="admin-player-chip-name">${escapeHtml(name)}</span>
          <button type="button" class="admin-player-remove" data-player-index="${index}" aria-label="Remove ${escapeHtml(name)}">×</button>
        </span>`
    )
    .join("");
}

function addRegistrationNameFromInput() {
  const input = document.getElementById("regPlayerNameInput");
  if (!(input instanceof HTMLInputElement)) {
    return;
  }
  addRegistrationNames(splitRegistrationNames(input.value));
  input.value = "";
  input.focus();
}

/** @param {KeyboardEvent} event */
function onRegistrationNameKeydown(event) {
  if (event.key !== "Enter" && event.key !== ",") {
    return;
  }
  event.preventDefault();
  addRegistrationNameFromInput();
}

/** @param {ClipboardEvent} event */
function onRegistrationNamePaste(event) {
  const text = event.clipboardData?.getData("text") ?? "";
  const names = splitRegistrationNames(text);
  if (names.length <= 1) {
    return;
  }
  event.preventDefault();
  addRegistrationNames(names);
}

/** @param {MouseEvent} event */
function onRegistrationChipClick(event) {
  const removeBtn = event.target instanceof Element ? event.target.closest(".admin-player-remove") : null;
  if (!(removeBtn instanceof HTMLButtonElement)) {
    return;
  }
  const index = Number(removeBtn.getAttribute("data-player-index"));
  if (Number.isNaN(index)) {
    return;
  }
  registrationDraftUsers.splice(index, 1);
  renderRegistrationDraftUsers();
}

/** @param {string[]} names */
function addRegistrationNames(names) {
  if (names.length === 0) {
    return;
  }
  setRegistrationDraftUsers([...registrationDraftUsers, ...names]);
}

async function saveRegistration() {
  const msg = document.getElementById("regMsg");
  const users = parseRegistrationUsers();
  if (IS_LOCAL) {
    await saveRegistrationLocally(users, msg);
    return;
  }
  await saveRegistrationViaProxy(users, msg);
}

/**
 * @param {string[]} users
 * @param {HTMLElement | null} msg
 */
async function saveRegistrationLocally(users, msg) {
  const saveBtn = document.getElementById("saveRegBtn");
  setMessage(msg, "Saving registration…", "");
  if (saveBtn) {
    saveBtn.disabled = true;
  }
  try {
    const response = await fetch(LOCAL_REGISTRATION_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ users }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }
    await loadData();
    setMessage(
      msg,
      `Saved ${data.registration.count} player(s) · ${formatMoney(data.registration.prizePool)} prize pool.`,
      "success"
    );
  } catch (err) {
    console.error(err);
    setMessage(
      msg,
      `Save failed. Run "make dev" for the admin API. ${err instanceof Error ? err.message : ""}`,
      "error"
    );
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
    }
  }
}

/**
 * @param {string[]} users
 * @param {HTMLElement | null} msg
 */
async function saveRegistrationViaProxy(users, msg) {
  if (!isProxyConfigured()) {
    setMessage(msg, "Admin proxy is not configured yet.", "error");
    return;
  }
  const password = getSavedAdminPassword();
  if (!password) {
    showLoginScreen("Sign in to update registration.");
    return;
  }
  const saveBtn = document.getElementById("saveRegBtn");
  setMessage(msg, "Saving registration…", "");
  if (saveBtn) {
    saveBtn.disabled = true;
  }
  try {
    const response = await fetch(REGISTRATION_PROXY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Password": password,
      },
      body: JSON.stringify({ users }),
    });
    if (!response.ok) {
      if (response.status === 401) {
        clearSavedAdminPassword();
        showLoginScreen("Wrong password. Try again.");
        return;
      }
      const text = await response.text();
      throw new Error(`${response.status}: ${text}`);
    }
    setMessage(msg, "Queued! Refresh in ~1 min to verify.", "success");
  } catch (err) {
    console.error(err);
    setMessage(msg, `Failed: ${err instanceof Error ? err.message : "unknown error"}`, "error");
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
    }
  }
}
