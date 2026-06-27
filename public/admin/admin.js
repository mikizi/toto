/** Admin — publish results locally (dev) or via GitHub Actions (production) */

const DATA_URL = "../data/latest.json";
const LOCAL_API = "http://127.0.0.1:8090/publish";
const LOCAL_RESTORE_API = "http://127.0.0.1:8090/restore";
const LOCAL_BROADCAST_API = "http://127.0.0.1:8090/broadcast";
const LOCAL_REGISTRATION_API = "http://127.0.0.1:8090/registration";
const LOCAL_KNOCKOUT_API = "http://127.0.0.1:8090/knockout";
const LOCAL_XLSX_API = "http://127.0.0.1:8090/xlsx";
const LOCAL_API_SCORES_URL = "http://127.0.0.1:8090/api-scores";
const XLSX_FILENAME = "Master WorldCup26.xlsx";
const PUBLISH_PROXY_URL =
  "https://toto-admin-publish.mikizi-toto.workers.dev/publish";
const RESTORE_PROXY_URL =
  "https://toto-admin-publish.mikizi-toto.workers.dev/restore";
const BROADCAST_PROXY_URL =
  "https://toto-admin-publish.mikizi-toto.workers.dev/broadcast";
const REGISTRATION_PROXY_URL =
  "https://toto-admin-publish.mikizi-toto.workers.dev/registration";
const KNOCKOUT_PROXY_URL =
  "https://toto-admin-publish.mikizi-toto.workers.dev/knockout";
const XLSX_PROXY_URL = "https://toto-admin-publish.mikizi-toto.workers.dev/xlsx";
const ADMIN_PASSWORD_STORAGE_KEY = "wc26-admin-password";

const IS_LOCAL =
  location.hostname === "localhost" || location.hostname === "127.0.0.1";

/** @typedef {{ id: number, teams: string, home: string, away: string, homeScore: number | null, awayScore: number | null, played: boolean, kickoffAt?: string | null }} AdminMatch */
/** @typedef {{ mode: string, openMatchIds: number[], suppressAuto: boolean, autoPilot: boolean }} BroadcastState */
/** @typedef {{ users: string[], count: number, entryFee: number, goalUsers: number, goalPrize: number, prizePool: number, closesAt: string | null }} RegistrationState */
/** @typedef {{ id: number, roundId: string, roundLabel: string, kickoffAt: string, homeSlot: string, awaySlot: string, home: string, away: string, homeScore: number | null, awayScore: number | null, isLive: boolean, isLocked: boolean, winner: string, isScoring: boolean, apiSource?: string, apiEventId?: string, apiHome?: string, apiAway?: string, apiKickoffAt?: string, apiState?: string }} KnockoutMatch */

/** @type {AdminMatch[]} */
let cachedMatches = [];

/** @type {BroadcastState | null} */
let cachedBroadcast = null;

/** @type {RegistrationState | null} */
let cachedRegistration = null;

/** @type {{ matches?: KnockoutMatch[], actual?: Record<string, string[]> } | null} */
let cachedKnockout = null;

/** @type {number | null} */
let selectedMatchId = null;

/** @type {"match" | "players" | "knockout" | "standings"} */
let activeAdminTab = "match";

/** @type {string[]} */
let registrationDraftUsers = [];

/**
 * @param {string} eventName
 * @param {Record<string, unknown>} [properties]
 */
function trackAdminAnalytics(eventName, properties = {}) {
  window.totoAnalytics?.track(eventName, {
    surface: "admin",
    admin_mode: IS_LOCAL ? "local" : "production",
    active_admin_tab: activeAdminTab,
    ...properties,
  });
}

/**
 * @param {number} matchId
 * @param {Record<string, unknown>} [properties]
 * @returns {Record<string, unknown>}
 */
function matchAnalyticsProps(matchId, properties = {}) {
  const match = cachedMatches.find((item) => item.id === matchId);
  return {
    match_id: matchId,
    home_team: match?.home || "",
    away_team: match?.away || "",
    is_played: Boolean(match?.played),
    ...properties,
  };
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("loginForm")?.addEventListener("submit", onLogin);
  document.getElementById("publishForm")?.addEventListener("submit", onPublish);
  document.getElementById("refreshBtn")?.addEventListener("click", loadData);
  document.getElementById("downloadXlsxBtn")?.addEventListener("click", () => void downloadXlsx());
  document.getElementById("uploadXlsxBtn")?.addEventListener("click", onUploadXlsxClick);
  document.getElementById("uploadXlsxInput")?.addEventListener("change", onXlsxFileSelected);
  document.getElementById("logoutBtn")?.addEventListener("click", onLogout);
  document.getElementById("modeBannerToggle")?.addEventListener("click", toggleModeBanner);
  document.getElementById("matchesList")?.addEventListener("click", onMatchesListClick);
  document.getElementById("matchesList")?.addEventListener("keydown", onMatchesListKeydown);
  document.getElementById("knockoutList")?.addEventListener("click", onKnockoutListClick);
  document.getElementById("syncKnockoutFixturesBtn")?.addEventListener("click", () => {
    void postKnockoutAction({ action: "sync_fixtures" }, document.getElementById("knockoutMsg"));
  });
  document.getElementById("applyR32ScoringBtn")?.addEventListener("click", () => {
    void postKnockoutAction({ action: "apply_r32_scoring" }, document.getElementById("knockoutMsg"));
  });
  document.getElementById("saveRegBtn")?.addEventListener("click", saveRegistration);
  document.getElementById("addRegPlayerBtn")?.addEventListener("click", addRegistrationNameFromInput);
  document.getElementById("regPlayerNameInput")?.addEventListener("keydown", onRegistrationNameKeydown);
  document.getElementById("regPlayerNameInput")?.addEventListener("paste", onRegistrationNamePaste);
  document.getElementById("regPlayerChips")?.addEventListener("click", onRegistrationChipClick);
  initAdminBackToTopButton();
  document.querySelectorAll(".admin-tab").forEach((btn) => {
    btn.addEventListener("click", onAdminTabClick);
  });
  document.getElementById("autopilotToggle")?.addEventListener("click", () => {
    void onAutopilotToggle();
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
  if (tab === "match" || tab === "players" || tab === "knockout" || tab === "standings") {
    setAdminTab(tab);
    trackAdminAnalytics("admin_tab_changed", {
      tab_name: tab,
    });
  }
}

/** @param {"match" | "players" | "knockout" | "standings"} tab */
function setAdminTab(tab) {
  activeAdminTab = tab;
  const panels = {
    match: document.getElementById("tabPanelMatch"),
    players: document.getElementById("tabPanelPlayers"),
    knockout: document.getElementById("tabPanelKnockout"),
    standings: document.getElementById("tabPanelStandings"),
  };
  const buttons = {
    match: document.getElementById("tabBtnMatch"),
    players: document.getElementById("tabBtnPlayers"),
    knockout: document.getElementById("tabBtnKnockout"),
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
  trackAdminAnalytics("admin_signed_in");
}

function onLogout() {
  trackAdminAnalytics("admin_signed_out");
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
    cachedKnockout = data.knockout || null;
    renderAutopilotToggle(cachedBroadcast);
    renderRegistration(cachedRegistration);
    renderMatches(data.matches, cachedBroadcast);
    renderKnockout(cachedKnockout);
    renderLeaderboard(data.leaderboard);
    if (status) {
      status.textContent = `${data.gamesPlayed} game(s) played · version ${data.version}`;
    }
    applySelectedMatch();
    scheduleFocusedMatchScroll();
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
  const publishMatches = getPublishMatches();
  const publishBtn = document.getElementById("publishBtn");
  const publishRow = document.getElementById("publishRow");
  const publishEmpty = document.getElementById("publishEmpty");
  renderPublishMatches(publishMatches);
  publishRow?.classList.toggle("is-empty", !publishMatches.length);
  publishEmpty?.classList.toggle("hidden", Boolean(publishMatches.length));
  updateMatchRowHighlights();
  if (publishBtn) {
    publishBtn.disabled = !publishMatches.length;
    publishBtn.textContent = publishMatches.length > 1 ? `Publish ${publishMatches.length}` : "Publish";
  }
  if (focusScores) {
    document.querySelector("#publishRow input")?.focus();
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
  trackAdminAnalytics("admin_match_selected", matchAnalyticsProps(matchId));
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

function syncAdminBackToTopButton() {
  const button = document.getElementById("adminBackToTop");
  if (!button) {
    return;
  }
  const appVisible = !document.getElementById("adminApp")?.classList.contains("hidden");
  button.classList.toggle("is-visible", appVisible && window.scrollY > 420);
}

function initAdminBackToTopButton() {
  const button = document.getElementById("adminBackToTop");
  if (!button) {
    return;
  }
  button.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  window.addEventListener("scroll", syncAdminBackToTopButton, { passive: true });
  syncAdminBackToTopButton();
}

function scrollFocusedMatchIntoView() {
  if (activeAdminTab !== "match" || !selectedMatchId) {
    return;
  }
  const card = document.querySelector(`#matchesList .admin-match-card[data-match-id="${selectedMatchId}"]`);
  if (!(card instanceof HTMLElement)) {
    return;
  }
  const sticky = document.querySelector(".admin-publish-sticky");
  const stickyHeight = sticky instanceof HTMLElement ? sticky.getBoundingClientRect().height : 0;
  const targetTop = card.getBoundingClientRect().top + window.scrollY - stickyHeight - 14;
  window.scrollTo(0, Math.max(0, targetTop));
  syncAdminBackToTopButton();
}

function scheduleFocusedMatchScroll() {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(scrollFocusedMatchIntoView);
  });
  window.setTimeout(scrollFocusedMatchIntoView, 180);
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

/** @param {AdminMatch[]} matches */
function orderedAdminMatches(matches) {
  if (typeof chronologicalMatches === "function") {
    return chronologicalMatches(matches);
  }
  return [...matches].sort((a, b) => a.id - b.id);
}

/** @param {number[]} matchIds */
function orderedAdminMatchIds(matchIds) {
  const order = new Map(orderedAdminMatches(cachedMatches).map((match, index) => [match.id, index]));
  return [...matchIds].sort((a, b) => {
    const aOrder = order.get(a) ?? Number.MAX_SAFE_INTEGER;
    const bOrder = order.get(b) ?? Number.MAX_SAFE_INTEGER;
    return aOrder - bOrder || a - b;
  });
}

/**
 * @param {AdminMatch[]} matches
 * @returns {AdminMatch | undefined}
 */
function getNextUnplayedMatch(matches) {
  return orderedAdminMatches(matches).find((m) => !m.played);
}

/**
 * @param {AdminMatch[]} matches
 * @param {BroadcastState} broadcast
 * @returns {AdminMatch | undefined}
 */
function getFocusedMatch(matches, broadcast) {
  const sorted = orderedAdminMatches(matches);
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
  return `<span class="admin-publish-flag">${flagHtml(teamName, "sm")}</span><span class="admin-publish-team-name" title="${escapeHtml(teamName)}">${escapeHtml(teamName)}</span>`;
}

/** @returns {AdminMatch[]} */
function getPublishMatches() {
  const selected = cachedMatches.find((match) => match.id === selectedMatchId);
  const matchById = new Map(cachedMatches.map((match) => [match.id, match]));
  const openMatches = orderedAdminMatchIds(cachedBroadcast?.openMatchIds || [])
    .map((matchId) => matchById.get(matchId))
    .filter(Boolean);
  if (openMatches.length && (!selected || openMatches.some((match) => match.id === selected.id))) {
    return openMatches;
  }
  return selected ? [selected] : [];
}

/**
 * @param {number} matchId
 * @param {"home" | "away"} side
 */
function publishScoreInputId(matchId, side) {
  return `publish-${side}-score-${matchId}`;
}

/**
 * @param {AdminMatch} match
 * @param {number} index
 * @param {number} total
 */
function adminPublishMatchHtml(match, index, total) {
  const homeId = publishScoreInputId(match.id, "home");
  const awayId = publishScoreInputId(match.id, "away");
  const homeValue = match.homeScore === null || match.homeScore === undefined ? "" : String(match.homeScore);
  const awayValue = match.awayScore === null || match.awayScore === undefined ? "" : String(match.awayScore);
  const badgeText = total > 1 ? `Game ${index + 1} · #${match.id}` : `#${match.id}`;
  return `<div class="admin-publish-match-item" data-publish-match-id="${match.id}">
    <span class="admin-publish-match-badge">${escapeHtml(badgeText)}</span>
    <div class="admin-publish-match">
      <div class="admin-publish-team admin-publish-team--home">${adminPublishEndHtml(match.home)}</div>
      <div class="admin-publish-scores">
        <label class="admin-sr-only" for="${homeId}">${escapeHtml(match.home)} score</label>
        <input id="${homeId}" type="number" min="0" max="99" class="admin-score-input admin-score-input--inline" inputmode="numeric" placeholder="0" value="${escapeHtml(homeValue)}" required>
        <span class="admin-score-sep" aria-hidden="true">–</span>
        <label class="admin-sr-only" for="${awayId}">${escapeHtml(match.away)} score</label>
        <input id="${awayId}" type="number" min="0" max="99" class="admin-score-input admin-score-input--inline" inputmode="numeric" placeholder="0" value="${escapeHtml(awayValue)}" required>
      </div>
      <div class="admin-publish-team admin-publish-team--away">${adminPublishEndHtml(match.away)}</div>
    </div>
  </div>`;
}

/** @param {AdminMatch[]} matches */
function renderPublishMatches(matches) {
  const num = document.getElementById("publishNum");
  const row = document.getElementById("publishRow");
  if (!num || !row) {
    return;
  }
  if (!matches.length) {
    num.textContent = "—";
    row.innerHTML = "";
    return;
  }
  num.textContent = matches.length > 1 ? matches.map((match) => `#${match.id}`).join(" + ") : `#${matches[0].id}`;
  row.innerHTML = matches.map((match, index) => adminPublishMatchHtml(match, index, matches.length)).join("");
}

/** @param {AdminMatch} match */
function adminMatchScoreText(match) {
  if (match.homeScore !== null && match.homeScore !== undefined && match.awayScore !== null && match.awayScore !== undefined) {
    return `${match.homeScore}–${match.awayScore}`;
  }
  return "—";
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

  const sorted = orderedAdminMatches(matches);
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

/** @returns {string[]} */
function adminTeamOptions() {
  const flagMap = typeof TEAM_FLAGS === "object" && TEAM_FLAGS ? TEAM_FLAGS : {};
  const teams = new Set(Object.keys(flagMap));
  for (const match of cachedMatches || []) {
    if (match.home) {
      teams.add(match.home);
    }
    if (match.away) {
      teams.add(match.away);
    }
  }
  const actual = cachedKnockout?.actual || {};
  for (const values of Object.values(actual)) {
    if (Array.isArray(values)) {
      values.forEach((team) => team && teams.add(String(team)));
    }
  }
  for (const match of cachedKnockout?.matches || []) {
    if (match.home) {
      teams.add(match.home);
    }
    if (match.away) {
      teams.add(match.away);
    }
    if (match.apiHome) {
      teams.add(match.apiHome);
    }
    if (match.apiAway) {
      teams.add(match.apiAway);
    }
  }
  return [...teams].sort((a, b) => a.localeCompare(b));
}

/**
 * @param {string} value
 * @param {string} label
 * @param {string[]} teams
 */
function adminTeamSelectHtml(value, label, teams) {
  return `<label class="admin-sr-only">${escapeHtml(label)}</label>
    <select class="admin-knockout-team-select" data-field="${escapeAttribute(label)}">
      <option value="">${escapeHtml(label)}</option>
      ${teams.map((team) => `<option value="${escapeAttribute(team)}"${team === value ? " selected" : ""}>${escapeHtml(team)}</option>`).join("")}
    </select>`;
}

/** @param {{ matches?: KnockoutMatch[] } | null} knockout */
function renderKnockout(knockout) {
  const list = document.getElementById("knockoutList");
  if (!list) {
    return;
  }
  const applyR32Btn = document.getElementById("applyR32ScoringBtn");
  const r32Applied = Boolean(knockout?.scoringApplied?.r32);
  if (applyR32Btn instanceof HTMLButtonElement) {
    applyR32Btn.disabled = r32Applied;
    applyR32Btn.textContent = r32Applied ? "R32 points applied" : "Apply R32 points";
  }
  const matches = Array.isArray(knockout?.matches)
    ? orderedAdminMatches(knockout.matches)
    : [];
  if (!matches.length) {
    list.innerHTML = '<p class="admin-empty-state">No knockout fixtures loaded yet.</p>';
    return;
  }
  const teams = adminTeamOptions();
  list.innerHTML = matches
    .map((match) => {
      const scoreHome = match.homeScore === null || match.homeScore === undefined ? "" : String(match.homeScore);
      const scoreAway = match.awayScore === null || match.awayScore === undefined ? "" : String(match.awayScore);
      const locked = match.isLocked ? "Locked" : "Draft";
      const live = match.isLive ? '<span class="admin-match-live-badge">LIVE</span>' : "";
      const winnerOptions = [match.home, match.away].filter(Boolean);
      const apiMeta = match.apiSource || match.apiEventId
        ? `<div class="admin-knockout-api-meta">
            <span>${escapeHtml(match.apiSource || "API")}${match.apiEventId ? ` ${escapeHtml(match.apiEventId)}` : ""}</span>
            <span>${escapeHtml([match.apiHome, match.apiAway].filter(Boolean).join(" vs ") || "No API teams yet")}</span>
          </div>`
        : "";
      return `<article class="admin-knockout-card${match.isLive ? " is-live" : ""}${match.winner ? " is-played" : ""}" data-knockout-match-id="${match.id}" role="listitem">
        <div class="admin-knockout-card-head">
          <div>
            <span class="admin-match-num">#${match.id}</span>
            <span class="admin-knockout-round">${escapeHtml(match.roundLabel)}</span>
            ${live}
          </div>
          <span class="admin-knockout-date">${escapeHtml(apiKickoffLabel(match.kickoffAt))}</span>
          <span class="admin-knockout-state">${escapeHtml(locked)}</span>
        </div>
        ${apiMeta}
        <div class="admin-knockout-teams">
          ${adminTeamSelectHtml(match.home || "", match.homeSlot || "Home", teams)}
          <span class="admin-score-sep" aria-hidden="true">vs</span>
          ${adminTeamSelectHtml(match.away || "", match.awaySlot || "Away", teams)}
        </div>
        <div class="admin-knockout-controls">
          <input class="admin-score-input admin-knockout-score" data-score-side="home" type="number" min="0" max="99" placeholder="0" value="${escapeHtml(scoreHome)}" aria-label="Home score">
          <span class="admin-score-sep" aria-hidden="true">–</span>
          <input class="admin-score-input admin-knockout-score" data-score-side="away" type="number" min="0" max="99" placeholder="0" value="${escapeHtml(scoreAway)}" aria-label="Away score">
          <select class="admin-knockout-winner" aria-label="Advancing team">
            <option value="">Advancing team</option>
            ${winnerOptions.map((team) => `<option value="${escapeAttribute(team)}"${team === match.winner ? " selected" : ""}>${escapeHtml(team)}</option>`).join("")}
          </select>
        </div>
        <div class="admin-knockout-actions">
          <button type="button" class="btn-refresh btn-refresh--compact" data-knockout-action="lock_fixture">Lock fixture</button>
          <button type="button" class="btn-refresh btn-refresh--compact" data-knockout-action="live_score">Live score</button>
          <button type="button" class="btn-refresh btn-refresh--compact" data-knockout-action="stop_live">Stop live</button>
          <button type="button" class="btn-gold btn-gold--compact" data-knockout-action="confirm_winner">Confirm advancing team</button>
        </div>
      </article>`;
    })
    .join("");
}

/** @param {MouseEvent} event */
function onKnockoutListClick(event) {
  const button = event.target instanceof Element ? event.target.closest("[data-knockout-action]") : null;
  if (!(button instanceof HTMLButtonElement)) {
    return;
  }
  const card = button.closest("[data-knockout-match-id]");
  if (!(card instanceof HTMLElement)) {
    return;
  }
  const action = button.getAttribute("data-knockout-action") || "";
  const matchId = Number(card.getAttribute("data-knockout-match-id"));
  const selects = card.querySelectorAll(".admin-knockout-team-select");
  const home = selects[0] instanceof HTMLSelectElement ? selects[0].value : "";
  const away = selects[1] instanceof HTMLSelectElement ? selects[1].value : "";
  const homeScoreInput = card.querySelector('[data-score-side="home"]');
  const awayScoreInput = card.querySelector('[data-score-side="away"]');
  const winnerSelect = card.querySelector(".admin-knockout-winner");
  const payload = {
    action,
    matchId,
    home,
    away,
    homeScore: homeScoreInput instanceof HTMLInputElement && homeScoreInput.value !== "" ? Number(homeScoreInput.value) : undefined,
    awayScore: awayScoreInput instanceof HTMLInputElement && awayScoreInput.value !== "" ? Number(awayScoreInput.value) : undefined,
    winner: winnerSelect instanceof HTMLSelectElement ? winnerSelect.value : "",
  };
  void postKnockoutAction(payload, document.getElementById("knockoutMsg"));
}

/**
 * @param {Record<string, unknown>} payload
 * @param {HTMLElement | null} msg
 */
async function postKnockoutAction(payload, msg) {
  setMessage(msg, "Updating knockout…", "");
  try {
    let response;
    if (IS_LOCAL) {
      response = await fetch(LOCAL_KNOCKOUT_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } else {
      const password = getSavedAdminPassword();
      if (!password) {
        showLoginScreen("Sign in to update knockout.");
        return;
      }
      response = await fetch(KNOCKOUT_PROXY_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Admin-Password": password,
        },
        body: JSON.stringify(payload),
      });
      if (response.status === 401) {
        clearSavedAdminPassword();
        showLoginScreen("Wrong password. Try again.");
        return;
      }
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }
    const eventName = payload.action === "lock_fixture"
      ? "knockout_fixture_locked"
      : payload.action === "confirm_winner"
        ? "knockout_winner_confirmed"
        : payload.action === "live_score" || payload.action === "stop_live"
          ? "knockout_live_changed"
          : "";
    if (eventName) {
      trackAdminAnalytics(eventName, {
        match_id: payload.matchId,
        home_team: payload.home || "",
        away_team: payload.away || "",
        winner: payload.winner || "",
      });
    }
    if (IS_LOCAL) {
      await loadData();
      const successMessage = payload.action === "sync_fixtures"
        ? "ESPN fixtures filled as draft. Review each card, then lock the correct fixtures."
        : "Knockout updated.";
      setMessage(msg, successMessage, "success");
    } else {
      setMessage(msg, "Queued. Refresh in ~1 min to verify.", "success");
    }
  } catch (err) {
    console.error(err);
    setMessage(msg, `Knockout update failed. ${err instanceof Error ? err.message : ""}`, "error");
  }
}

/** @param {string} text */
function escapeAttribute(text) {
  return escapeHtml(String(text)).replace(/"/g, "&quot;");
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

async function loadApiScores() {
  const list = document.getElementById("apiScoresList");
  const summary = document.getElementById("apiScoresSummary");
  const msg = document.getElementById("apiScoresMsg");
  const button = document.getElementById("refreshApiScoresBtn");

  if (!IS_LOCAL) {
    if (summary) {
      summary.textContent = "Local API score preview";
    }
    if (list) {
      list.innerHTML = '<p class="admin-api-empty">API preview is available in local admin for phase 1. Run <code>make dev</code>.</p>';
    }
    return;
  }

  if (button) {
    button.disabled = true;
  }
  setMessage(msg, "Checking ESPN API…", "");
  if (summary) {
    summary.textContent = "Loading API score data";
  }

  try {
    const response = await fetch(LOCAL_API_SCORES_URL, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }
    renderApiScores(data);
    setMessage(msg, "", "");
  } catch (err) {
    console.error(err);
    if (summary) {
      summary.textContent = "Could not load API score data";
    }
    if (list) {
      list.innerHTML = '<p class="admin-api-empty">No API data loaded.</p>';
    }
    setMessage(
      msg,
      `API check failed. Restart "make dev" if this endpoint was just added. ${err instanceof Error ? err.message : ""}`,
      "error"
    );
  } finally {
    if (button) {
      button.disabled = false;
    }
  }
}

/**
 * @param {{ source?: string, dates?: string, fetchedAt?: string, eventsCount?: number, updatesCount?: number, rows?: Array<Record<string, unknown>> }} data
 */
function renderApiScores(data) {
  const list = document.getElementById("apiScoresList");
  const summary = document.getElementById("apiScoresSummary");
  if (!list) {
    return;
  }
  const rows = Array.isArray(data.rows) ? data.rows : [];
  if (summary) {
    summary.textContent = `${data.source || "API"} · ${rows.length} event(s) · ${Number(data.updatesCount || 0)} update(s) · ${data.dates || ""}`;
  }
  if (!rows.length) {
    list.innerHTML = '<p class="admin-api-empty">No API events returned.</p>';
    return;
  }
  list.innerHTML = rows.map(apiScoreRowHtml).join("");
}

/** @param {Record<string, unknown>} row */
function apiScoreRowHtml(row) {
  const matchId = Number(row.matchId);
  const hasMatchId = Number.isInteger(matchId) && matchId > 0;
  const isMatched = Boolean(row.isMatched);
  const wouldUpdate = Boolean(row.wouldUpdate);
  const wouldCloseLive = Boolean(row.wouldCloseLive);
  const state = String(row.apiState || "pre");
  const statusClass = wouldUpdate ? "is-update" : isMatched ? "is-synced" : "is-unmatched";
  const statusText = wouldUpdate
    ? (wouldCloseLive ? "Final update" : "Would update")
    : !isMatched
      ? "Unmatched"
      : state === "pre"
        ? "Waiting"
        : "Synced";
  const currentScore = apiScoreText(row.currentHomeScore, row.currentAwayScore);
  const apiScore = apiScoreText(row.apiHomeScore, row.apiAwayScore);
  const home = String(row.home || row.apiHome || "");
  const away = String(row.away || row.apiAway || "");
  return `<article class="admin-api-row ${statusClass}" role="listitem">
    <div class="admin-api-row-head">
      <span class="admin-api-match">${hasMatchId ? `#${matchId}` : "No match"}</span>
      <span class="admin-api-state">${escapeHtml(apiStateLabel(state))}</span>
      <span class="admin-api-status">${escapeHtml(statusText)}</span>
    </div>
    <div class="admin-api-teams">
      <span>${flagHtml(home, "sm")} ${escapeHtml(home || "Unknown")}</span>
      <strong>${escapeHtml(apiScore)}</strong>
      <span>${flagHtml(away, "sm")} ${escapeHtml(away || "Unknown")}</span>
    </div>
    <div class="admin-api-meta">
      <span>Sheet: ${escapeHtml(currentScore)}</span>
      <span>ESPN: ${escapeHtml(String(row.espnEventId || "—"))}</span>
      <span>${escapeHtml(apiKickoffLabel(row.kickoffAt))}</span>
    </div>
  </article>`;
}

/** @param {unknown} home @param {unknown} away */
function apiScoreText(home, away) {
  if (home === null || home === undefined || away === null || away === undefined) {
    return "—";
  }
  return `${Number(home)}–${Number(away)}`;
}

/** @param {string} state */
function apiStateLabel(state) {
  if (state === "in") {
    return "Live";
  }
  if (state === "post") {
    return "Final";
  }
  return "Scheduled";
}

/** @param {unknown} value */
function apiKickoffLabel(value) {
  if (!value) {
    return "No kickoff";
  }
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** @param {SubmitEvent} event */
async function onPublish(event) {
  event.preventDefault();
  const msg = document.getElementById("publishMsg");
  const results = collectPublishResults();

  if (!results.length) {
    setMessage(msg, "Pick a match first.", "error");
    return;
  }
  const invalid = results.find((result) => !result.isValid);
  if (invalid) {
    setMessage(msg, `Enter valid scores for match #${invalid.matchId}.`, "error");
    return;
  }

  if (IS_LOCAL) {
    await publishLocally(results, msg);
    return;
  }

  await publishViaProxy(results, msg);
}

/**
 * @returns {Array<{ matchId: number, homeScore: number, awayScore: number, isValid: boolean }>}
 */
function collectPublishResults() {
  return [...document.querySelectorAll("#publishRow [data-publish-match-id]")].map((row) => {
    const matchId = Number(row.getAttribute("data-publish-match-id"));
    const homeInput = row.querySelector('input[id^="publish-home-score-"]');
    const awayInput = row.querySelector('input[id^="publish-away-score-"]');
    const homeRaw = homeInput instanceof HTMLInputElement ? homeInput.value.trim() : "";
    const awayRaw = awayInput instanceof HTMLInputElement ? awayInput.value.trim() : "";
    const homeScore = Number(homeRaw);
    const awayScore = Number(awayRaw);
    const isValid = Number.isInteger(matchId)
      && homeRaw !== ""
      && awayRaw !== ""
      && Number.isInteger(homeScore)
      && Number.isInteger(awayScore)
      && homeScore >= 0
      && awayScore >= 0
      && homeScore <= 99
      && awayScore <= 99;
    return { matchId, homeScore, awayScore, isValid };
  });
}

/**
 * @param {Array<{ matchId: number, homeScore: number, awayScore: number }>} results
 * @param {HTMLElement | null} msg
 */
async function publishViaProxy(results, msg) {
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
    for (const result of results) {
      setMessage(msg, `Publishing match #${result.matchId}…`, "");
      const response = await fetch(PUBLISH_PROXY_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Admin-Password": password,
        },
        body: JSON.stringify({
          matchId: result.matchId,
          homeScore: result.homeScore,
          awayScore: result.awayScore,
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
      trackAdminAnalytics("match_result_published", matchAnalyticsProps(result.matchId, {
        home_score: result.homeScore,
        away_score: result.awayScore,
      }));
    }
    setMessage(
      msg,
      results.length > 1
        ? `Queued ${results.length} matches. Check GitHub Actions, then refresh the scoreboard in ~2 min.`
        : "Queued! Check GitHub Actions, then refresh the scoreboard in ~2 min.",
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
    trackAdminAnalytics("match_score_restored", matchAnalyticsProps(matchId));
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
    trackAdminAnalytics("match_score_restored", matchAnalyticsProps(matchId));
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
  scheduleFocusedMatchScroll();
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
    trackAdminAnalytics("workbook_downloaded");
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

function onUploadXlsxClick() {
  const input = document.getElementById("uploadXlsxInput");
  if (input instanceof HTMLInputElement) {
    input.click();
  }
}

/** @param {Event} event */
async function onXlsxFileSelected(event) {
  const input = event.currentTarget;
  if (!(input instanceof HTMLInputElement)) {
    return;
  }
  const file = input.files?.[0] || null;
  input.value = "";
  if (!file) {
    return;
  }
  await uploadXlsx(file);
}

/** @param {File} file */
async function uploadXlsx(file) {
  const status = document.getElementById("statusMsg");
  const btn = document.getElementById("uploadXlsxBtn");
  const previousStatus = status?.textContent ?? "";

  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    if (status) {
      status.textContent = "Choose an .xlsx workbook.";
    }
    return;
  }
  if (!window.confirm(`Upload ${file.name} and rebuild the scoreboard data?`)) {
    return;
  }

  if (btn) {
    btn.disabled = true;
  }
  if (status) {
    status.textContent = IS_LOCAL
      ? "Uploading workbook and rebuilding latest.json…"
      : "Uploading workbook and queuing rebuild…";
  }

  try {
    const headers = {
      "Content-Type": file.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "X-File-Name": file.name,
    };
    let response;
    if (IS_LOCAL) {
      response = await fetch(LOCAL_XLSX_API, {
        method: "POST",
        headers,
        body: file,
      });
    } else {
      if (!isProxyConfigured()) {
        if (status) {
          status.textContent = "Admin proxy not configured.";
        }
        return;
      }
      const password = getSavedAdminPassword();
      if (!password) {
        showLoginScreen("Sign in to upload the workbook.");
        return;
      }
      response = await fetch(XLSX_PROXY_URL, {
        method: "POST",
        headers: {
          ...headers,
          "X-Admin-Password": password,
        },
        body: file,
      });
      if (response.status === 401) {
        clearSavedAdminPassword();
        showLoginScreen("Wrong password. Try again.");
        return;
      }
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }

    if (IS_LOCAL) {
      await loadData();
      if (status) {
        status.textContent = `Workbook synced · version ${data.version || "updated"}`;
      }
    } else if (status) {
      status.textContent = "Workbook uploaded. GitHub Actions is rebuilding latest.json; refresh in ~2 min.";
    }
    trackAdminAnalytics("workbook_uploaded", {
      file_size_bytes: file.size,
    });
  } catch (err) {
    console.error(err);
    if (status) {
      const hint = IS_LOCAL ? ' Run "make dev".' : "";
      status.textContent = `Upload failed.${hint} ${err instanceof Error ? err.message : ""}`.trim();
    }
  } finally {
    if (btn) {
      btn.disabled = false;
    }
    if (status && !status.textContent) {
      status.textContent = previousStatus;
    }
  }
}

/**
 * @param {Array<{ matchId: number, homeScore: number, awayScore: number }>} results
 * @param {HTMLElement | null} msg
 */
async function publishLocally(results, msg) {
  setMessage(msg, results.length > 1 ? `Publishing ${results.length} matches locally…` : "Publishing locally (patch → recalc → export)…", "");
  const publishBtn = document.getElementById("publishBtn");
  if (publishBtn) {
    publishBtn.disabled = true;
  }

  try {
    const labels = [];
    for (const result of results) {
      setMessage(msg, `Publishing match #${result.matchId} locally…`, "");
      const response = await fetch(LOCAL_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          match_id: result.matchId,
          home_score: result.homeScore,
          away_score: result.awayScore,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }
      labels.push(`${data.teams} ${data.score}`);
      trackAdminAnalytics("match_result_published", matchAnalyticsProps(result.matchId, {
        home_score: result.homeScore,
        away_score: result.awayScore,
      }));
    }
    await loadData();
    setMessage(msg, `Published ${labels.join(" · ")}. Open scoreboard to verify.`, "success");
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
/**
 * @param {BroadcastState} broadcast
 */
function renderAutopilotToggle(broadcast) {
  const toggle = document.getElementById("autopilotToggle");
  const stateText = document.getElementById("autopilotToggleText");
  if (!toggle) {
    return;
  }
  const enabled = Boolean(broadcast.autoPilot);
  toggle.setAttribute("aria-checked", String(enabled));
  toggle.classList.toggle("is-on", enabled);
  toggle.classList.toggle("is-off", !enabled);
  toggle.disabled = false;
  if (stateText) {
    stateText.textContent = enabled ? "On" : "Off";
  }
}

async function onAutopilotToggle() {
  const toggle = document.getElementById("autopilotToggle");
  const msg = document.getElementById("liveMsg");
  if (!toggle || toggle.disabled) {
    return;
  }
  const enabled = toggle.getAttribute("aria-checked") !== "true";
  await setAutopilot(enabled, msg);
}

/**
 * @param {boolean} enabled
 * @param {HTMLElement | null} msg
 */
async function setAutopilot(enabled, msg) {
  const toggle = document.getElementById("autopilotToggle");
  if (toggle) {
    toggle.disabled = true;
  }
  const payload = {
    action: "set_autopilot",
    autoPilot: enabled,
  };
  if (IS_LOCAL) {
    const updated = await postBroadcastLocally(payload, msg);
    if (updated) {
      trackAdminAnalytics("autopilot_changed", {
        is_enabled: enabled,
      });
    }
    if (toggle) {
      toggle.disabled = false;
    }
    return;
  }
  const queued = await postBroadcastViaProxy(payload, msg);
  if (queued) {
    applyQueuedAutopilot(enabled);
    trackAdminAnalytics("autopilot_changed", {
      is_enabled: enabled,
    });
  }
  if (toggle) {
    toggle.disabled = false;
  }
}

/** @param {boolean} enabled */
function applyQueuedAutopilot(enabled) {
  cachedBroadcast = normalizeBroadcast({
    ...(cachedBroadcast || {}),
    autoPilot: enabled,
    suppressAuto: !enabled,
  });
  renderAutopilotToggle(cachedBroadcast);
  if (cachedMatches.length) {
    renderMatches(cachedMatches, cachedBroadcast);
  }
}

async function setMatchLive(openMatchIds, msg) {
  const orderedOpenMatchIds = orderedAdminMatchIds(openMatchIds).slice(0, 2);
  const payload = {
    action: orderedOpenMatchIds.length === 0 ? "clear_manual" : "set",
    openMatchIds: orderedOpenMatchIds,
  };
  if (IS_LOCAL) {
    const updated = await postBroadcastLocally(payload, msg);
    if (updated) {
      trackAdminAnalytics("match_live_changed", {
        live_match_ids: orderedOpenMatchIds,
        live_match_count: orderedOpenMatchIds.length,
      });
    }
    return;
  }
  const queued = await postBroadcastViaProxy(payload, msg);
  if (queued) {
    applyQueuedBroadcast(orderedOpenMatchIds);
    trackAdminAnalytics("match_live_changed", {
      live_match_ids: orderedOpenMatchIds,
      live_match_count: orderedOpenMatchIds.length,
    });
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
  });
  renderMatches(cachedMatches, cachedBroadcast);
  applySelectedMatch();
  scheduleFocusedMatchScroll();
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
    return true;
  } catch (err) {
    console.error(err);
    setMessage(
      msg,
      `Broadcast update failed. Run "make dev". ${err instanceof Error ? err.message : ""}`,
      "error"
    );
    return false;
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
    trackAdminAnalytics("registration_saved", {
      player_count: data.registration.count,
      prize_pool: data.registration.prizePool,
      save_mode: "local",
    });
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
    trackAdminAnalytics("registration_saved", {
      player_count: users.length,
      save_mode: "production_queue",
    });
  } catch (err) {
    console.error(err);
    setMessage(msg, `Failed: ${err instanceof Error ? err.message : "unknown error"}`, "error");
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
    }
  }
}
