/** World Cup 2026 scoreboard — reads data/latest.json */

const LEADERBOARD_PREVIEW_ROWS = 8;
const SHOW_LEADERBOARD_ROWS = true;
const LEADERBOARD_TAB_STORAGE_KEY = "wc26-leaderboard-tab";
const CHAMPION_FILTER_STORAGE_KEY = "wc26-champion-filter";
const FOLLOWED_PLAYERS_STORAGE_KEY = "wc26-followed-players";
const LEADERBOARD_TABS = new Set(["full", "following", "champion"]);

const DATA_URL = "data/latest.json";
const VERSION_URL = "data/version.json";
const IS_LOCAL_HOST =
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1";
const PRESENCE_URL = IS_LOCAL_HOST
  ? "http://127.0.0.1:8090/presence"
  : "https://toto-admin-publish.mikizi-toto.workers.dev/presence";
const LIVE_POLL_MS = 60000;
const PRESENCE_POLL_MS = 300000;
const PRESENCE_FAILURE_BACKOFF_MS = 30 * 60 * 1000;
const PRESENCE_RATE_LIMIT_BACKOFF_MS = 6 * 60 * 60 * 1000;
const UPDATE_TOAST_MS = 6000;

const CROWN_SVG = `<svg class="crown-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 18h16l1-11-5.2 4.1L12 4 8.2 11.1 3 7l1 11Z" fill="currentColor"/><path d="M5 20h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
const STAR_SVG = `<svg class="lb-follow-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m12 2.6 2.86 5.8 6.4.93-4.63 4.52 1.1 6.38L12 17.22l-5.73 3.01 1.1-6.38-4.63-4.52 6.4-.93L12 2.6Z"/></svg>`;

/** @typedef {{ matchId: number, homePick: number | null, awayPick: number | null, points: number | null }} PlayerPick */
/** @typedef {{ id: string, name: string, points: number, rank: number | null, rankLabel?: string | null, champion: string | null, movement: string, picks?: PlayerPick[] }} LeaderboardEntry */
/** @typedef {{ id: number, teams: string, home: string, away: string, homeScore: number | null, awayScore: number | null, played: boolean, kickoffAt: string | null }} MatchEntry */
/** @typedef {{ mode: "auto" | "manual", openMatchIds: number[], suppressAuto: boolean, autoPilot: boolean }} BroadcastState */
/** @typedef {{ version: string, generatedAt: string, gamesPlayed: number, lastResult: object | null, leaderboard: LeaderboardEntry[], matches: MatchEntry[], broadcast?: BroadcastState, registration?: unknown }} TotoData */

/** @type {number | undefined} */
let countdownTimerId;

/** @type {TotoData | null} */
let cachedData = null;

const leaderboardState = {
  tab: getStoredLeaderboardTab(),
  champion: getStoredChampionFilter(),
};

/** @type {string | null} */
let knownVersion = null;

/** @type {number | undefined} */
let livePollTimerId;

/** @type {number | undefined} */
let presencePollTimerId;

/** @type {number} */
let presenceBackoffUntilMs = 0;

/** @type {number} */
let lastPresenceAttemptMs = 0;

/** @type {number | undefined} */
let updateToastTimerId;

/** @type {boolean} */
let entrancePlayed = false;

/** @returns {boolean} */
function shouldPlayEntrance() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return false;
  }
  return !entrancePlayed;
}

/** @param {boolean} play */
function triggerEntrance(play) {
  const app = document.querySelector(".app");
  if (!app || !play) {
    return;
  }

  entrancePlayed = true;

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      app.classList.remove("await-enter");
      app.classList.add("enter-play");
    });
  });
}

/** @returns {boolean} */
function isDebugMode() {
  const debug = new URLSearchParams(window.location.search).get("debug");
  return debug === "1" || debug === "true";
}

/** @param {TotoData} data @returns {boolean} */
function shouldShowLiveBadge(data) {
  if (isDebugMode()) {
    return false;
  }
  return manualLiveMatchIds(data).length > 0;
}

/** @param {TotoData} data */
function updateLiveIndicator(data) {
  const badge = document.getElementById("liveBadge");
  const statusDot = document.getElementById("statusDot");
  const card = document.querySelector(".scoreboard-card");
  const showLive = shouldShowLiveBadge(data);

  badge?.classList.toggle("hidden", !showLive);
  card?.classList.toggle("is-live", showLive);
  statusDot?.classList.toggle("is-live", showLive);
  statusDot?.classList.toggle("hidden", showLive);
}


/** @param {TotoData} data */
function applyViewMode(data) {
  const scoreboardApp = document.getElementById("scoreboardApp");
  const comingSoon = document.getElementById("comingSoon");
  const refreshBtn = document.getElementById("refreshBtn");
  const topBarLabel = document.getElementById("topBarLabel");
  const live = isScoreboardLive(data, isDebugMode());

  if (live) {
    comingSoon?.classList.add("hidden");
    scoreboardApp?.classList.remove("hidden");
    refreshBtn?.classList.remove("hidden");
    if (topBarLabel) {
      topBarLabel.textContent = "Last updated";
    }
    return;
  }

  comingSoon?.classList.remove("hidden");
  scoreboardApp?.classList.add("hidden");
  refreshBtn?.classList.add("hidden");
  if (topBarLabel) {
    topBarLabel.textContent = "Next match";
  }
}

/** @param {number} value @param {number} goal */
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

const REG_PROGRESS_RING_R = 78;

/** @type {number | null} */
let lastRegProgressPct = null;

/** @returns {boolean} */
function shouldAnimateRegistration() {
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Ease-in-out cubic — slow start, fast middle, slow finish.
 * @param {number} t 0..1
 */
function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/**
 * @param {SVGCircleElement | null} circle
 * @param {number} radius
 * @param {number} pct
 */
function setRingProgress(circle, radius, pct) {
  if (!circle) {
    return;
  }
  const clamped = Math.min(100, Math.max(0, pct));
  const circumference = 2 * Math.PI * radius;
  circle.style.strokeDasharray = `${circumference}`;
  circle.style.strokeDashoffset = `${circumference * (1 - clamped / 100)}`;
}

/**
 * @param {SVGCircleElement | null} circle
 * @param {number} radius
 * @param {HTMLElement | null} pctEl
 * @param {number} fromPct
 * @param {number} toPct
 * @param {number} [durationMs]
 */
function animateRingProgress(circle, radius, pctEl, fromPct, toPct, durationMs = 1400) {
  if (!circle) {
    return;
  }
  const circumference = 2 * Math.PI * radius;
  circle.style.strokeDasharray = `${circumference}`;
  circle.style.strokeDashoffset = `${circumference * (1 - fromPct / 100)}`;

  const start = performance.now();

  /** @param {number} now */
  function tick(now) {
    const t = Math.min(1, (now - start) / durationMs);
    const eased = easeInOutCubic(t);
    const currentPct = fromPct + (toPct - fromPct) * eased;
    circle.style.strokeDashoffset = `${circumference * (1 - currentPct / 100)}`;
    if (pctEl) {
      pctEl.textContent = `${Math.round(currentPct)}%`;
    }
    if (t < 1) {
      requestAnimationFrame(tick);
      return;
    }
    setRingProgress(circle, radius, toPct);
    if (pctEl) {
      pctEl.textContent = `${toPct}%`;
    }
  }

  requestAnimationFrame(tick);
}

/** @param {TotoData} data */
function renderRegistrationCounter(data) {
  const counter = document.getElementById("regCounter");
  if (!counter) {
    return;
  }

  const registration = normalizeRegistration(data.registration, data.matches);
  const open = isRegistrationOpen(registration);
  counter.classList.toggle("hidden", !open);
  if (!open) {
    return;
  }

  const pctEl = document.getElementById("regPublicPct");
  const progressRing = /** @type {SVGCircleElement | null} */ (document.getElementById("regPublicProgressRing"));
  const progressWrap = document.getElementById("regProgressWrap");
  const goalTitle = document.getElementById("regPublicGoalTitle");
  const summary = document.getElementById("regPublicSummary");
  const participants = document.getElementById("regPublicParticipants");
  const deadline = document.getElementById("regPublicDeadline");

  const progressPct = progressPercent(registration.prizePool, registration.goalPrize);
  const animate = shouldAnimateRegistration() && lastRegProgressPct !== progressPct;
  const fromPct = lastRegProgressPct ?? 0;

  if (animate) {
    animateRingProgress(progressRing, REG_PROGRESS_RING_R, pctEl, fromPct, progressPct);
  } else {
    if (pctEl) {
      pctEl.textContent = `${progressPct}%`;
    }
    setRingProgress(progressRing, REG_PROGRESS_RING_R, progressPct);
  }
  if (progressWrap) {
    progressWrap.setAttribute("aria-valuenow", String(progressPct));
  }
  if (goalTitle) {
    goalTitle.textContent = `${formatMoney(registration.goalPrize)} Goal`;
  }
  if (summary) {
    summary.textContent = `${formatMoney(registration.prizePool)} raised so far · ${formatMoney(registration.entryFee)} per player`;
  }
  if (participants) {
    participants.textContent = `${registration.count} of ${registration.goalUsers} participants registered`;
  }
  if (deadline) {
    deadline.textContent = formatRegistrationDeadline(registration.closesAt);
  }
  lastRegProgressPct = progressPct;
}

function onKickoffReached() {
  if (!cachedData || isScoreboardLive(cachedData, isDebugMode())) {
    return;
  }
  loadData(false);
}

/**
 * @param {string} eventName
 * @param {Record<string, unknown>} [properties]
 */
function trackAnalytics(eventName, properties = {}) {
  window.totoAnalytics?.track(eventName, properties);
}

/**
 * @param {TotoData} data
 * @returns {Record<string, unknown>}
 */
function scoreboardAnalyticsProps(data) {
  const registration = normalizeRegistration(data.registration, data.matches);
  const liveMatchIds = heroLiveMatchIds(data);
  return {
    view_mode: isScoreboardLive(data, isDebugMode()) ? "scoreboard" : "countdown",
    games_played: data.gamesPlayed,
    matches_count: data.matches.length,
    leaderboard_count: data.leaderboard.length,
    has_live_match: liveMatchIds.length > 0,
    live_match_count: liveMatchIds.length,
    registration_open: isRegistrationOpen(registration),
    registration_count: registration.count,
    prize_pool: registration.prizePool,
  };
}

/** @param {HTMLElement} row */
function trackLeaderboardRowOpen(row) {
  trackAnalytics("player_profile_opened", {
    source: "leaderboard",
    rank: Number(row.dataset.rank),
    points: Number(row.dataset.points),
    has_champion_pick: row.dataset.hasChampion === "true",
    games_played: cachedData?.gamesPlayed,
  });
}

/** @param {HTMLElement} row */
function openLeaderboardRow(row) {
  const href = row.dataset.href;
  if (!href) {
    return;
  }
  trackLeaderboardRowOpen(row);
  window.location.href = href;
}

/** @param {MouseEvent} event */
function handleLeaderboardBodyClick(event) {
  const target = event.target instanceof Element ? event.target : null;
  const followBtn = target?.closest(".lb-follow-btn");
  if (followBtn instanceof HTMLButtonElement) {
    toggleFollowedPlayer(followBtn.dataset.playerKey || "");
    return;
  }

  const row = target?.closest(".lb-row");
  if (row instanceof HTMLElement) {
    openLeaderboardRow(row);
  }
}

/** @param {KeyboardEvent} event */
function handleLeaderboardBodyKeydown(event) {
  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }
  const target = event.target instanceof Element ? event.target : null;
  const row = target?.closest(".lb-row");
  if (!(row instanceof HTMLElement) || target?.closest(".lb-follow-btn")) {
    return;
  }
  event.preventDefault();
  openLeaderboardRow(row);
}

document.addEventListener("DOMContentLoaded", () => {
  const refreshBtn = document.getElementById("refreshBtn");
  refreshBtn?.addEventListener("click", () => loadData(true));
  document.getElementById("viewFixturesBtn")?.addEventListener("click", toggleFixturesPanel);
  document.getElementById("viewStandingsBtn")?.addEventListener("click", toggleStandingsPanel);
  document.getElementById("betsTable")?.addEventListener("click", handleLeaderboardBodyClick);
  document.getElementById("betsTable")?.addEventListener("keydown", handleLeaderboardBodyKeydown);
  document.getElementById("leaderboardTabs")?.addEventListener("click", handleLeaderboardTabClick);
  document.getElementById("championFilterSelect")?.addEventListener("change", handleChampionFilterChange);
  document.getElementById("nextGamesScroll")?.addEventListener("scroll", (event) => {
    const scroll = event.currentTarget;
    if (scroll instanceof HTMLElement) {
      updateNextGamesScrollHint(scroll);
    }
  });
  document.getElementById("updateToastDismiss")?.addEventListener("click", hideUpdateToast);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopLivePolling();
      stopPresencePolling();
      return;
    }
    startPresencePolling();
    if (knownVersion) {
      void pollForUpdates();
      startLivePolling();
    }
  });
  loadData(false);
});

/** @returns {string} */
function getPresenceClientId() {
  const key = "wc26-presence-id";
  const existing = window.localStorage.getItem(key);
  if (existing) {
    return existing;
  }
  const id =
    window.crypto?.randomUUID?.() ||
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  window.localStorage.setItem(key, id);
  return id;
}

/** @param {number} viewers */
function renderViewerCount(viewers) {
  const el = document.getElementById("viewerCount");
  if (!el) {
    return;
  }
  const safeCount = Math.max(1, Math.round(viewers));
  el.textContent = `${safeCount} viewing`;
  el.classList.remove("hidden");
}

function hideViewerCount() {
  document.getElementById("viewerCount")?.classList.add("hidden");
}

/** @returns {boolean} */
function shouldTrackPresence() {
  return cachedData ? isScoreboardLive(cachedData, isDebugMode()) : false;
}

/** @param {Response} response @returns {number} */
function presenceRetryDelayMs(response) {
  const retryAfter = response.headers.get("Retry-After");
  if (!retryAfter) {
    return response.status === 429
      ? PRESENCE_RATE_LIMIT_BACKOFF_MS
      : PRESENCE_FAILURE_BACKOFF_MS;
  }

  const retrySeconds = Number(retryAfter);
  if (Number.isFinite(retrySeconds) && retrySeconds > 0) {
    return retrySeconds * 1000;
  }

  const retryAtMs = Date.parse(retryAfter);
  if (!Number.isNaN(retryAtMs)) {
    return Math.max(0, retryAtMs - Date.now());
  }

  return response.status === 429
    ? PRESENCE_RATE_LIMIT_BACKOFF_MS
    : PRESENCE_FAILURE_BACKOFF_MS;
}

async function updatePresence() {
  if (document.hidden || !shouldTrackPresence()) {
    return;
  }
  const nowMs = Date.now();
  if (nowMs < presenceBackoffUntilMs) {
    return;
  }
  if (nowMs - lastPresenceAttemptMs < PRESENCE_POLL_MS) {
    return;
  }
  lastPresenceAttemptMs = nowMs;
  try {
    const response = await fetch(PRESENCE_URL, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: getPresenceClientId() }),
    });
    if (!response.ok) {
      presenceBackoffUntilMs = Date.now() + presenceRetryDelayMs(response);
      hideViewerCount();
      return;
    }
    presenceBackoffUntilMs = 0;
    const payload = await response.json();
    if (payload && payload.ok === true && Number.isFinite(Number(payload.viewers))) {
      renderViewerCount(Number(payload.viewers));
      return;
    }
    hideViewerCount();
  } catch (err) {
    presenceBackoffUntilMs = Date.now() + PRESENCE_FAILURE_BACKOFF_MS;
    hideViewerCount();
  }
}

function startPresencePolling() {
  if (!shouldTrackPresence()) {
    hideViewerCount();
    return;
  }
  void updatePresence();
  if (presencePollTimerId !== undefined) {
    return;
  }
  presencePollTimerId = window.setInterval(() => {
    void updatePresence();
  }, PRESENCE_POLL_MS);
}

function stopPresencePolling() {
  if (presencePollTimerId === undefined) {
    return;
  }
  window.clearInterval(presencePollTimerId);
  presencePollTimerId = undefined;
}

/** @param {TotoData} data @param {number} [limit] */
function upcomingMatches(data, limit = 3) {
  return data.matches
    .filter((m) => !m.played)
    .sort(compareMatchesByKickoff)
    .slice(0, limit);
}

/** @param {TotoData} data */
function allUpcomingMatches(data) {
  return data.matches
    .filter((m) => !m.played)
    .sort(compareMatchesByKickoff);
}

/** @param {TotoData} data @returns {MatchEntry[]} */
function allFixturesMatches(data) {
  return chronologicalMatches(data.matches || []);
}

/** @param {MatchEntry} match @param {number} [index] @param {boolean} [animate] @param {boolean} [isNext] @param {boolean} [isLive] */
function fixtureItemHtml(match, index = 0, animate = false, isNext = false, isLive = false) {
  const home = shortTeamName(match.home);
  const away = shortTeamName(match.away);
  const enterClass = animate ? " next-game-item--enter" : "";
  const playedClass = match.played ? " next-game-item--played" : "";
  const nextClass = isNext ? " next-game-item--next" : "";
  const stagger = animate ? ` style="--enter-i: ${index}"` : "";

  let centerBadge;
  let meta;
  if (match.played) {
    const homeScore = match.homeScore ?? 0;
    const awayScore = match.awayScore ?? 0;
    centerBadge = `${homeScore}&nbsp;–&nbsp;${awayScore}`;
    meta = match.kickoffAt ? formatNextGameKickoff(match.kickoffAt) : `Match ${match.id}`;
  } else if (isLive) {
    centerBadge = `${match.homeScore ?? 0}&nbsp;–&nbsp;${match.awayScore ?? 0}`;
    meta = "Live";
  } else {
    centerBadge = "vs";
    meta = match.kickoffAt
      ? formatNextGameKickoff(match.kickoffAt)
      : `Match ${match.id} · TBD`;
  }

  const badgeClass = match.played || isLive
    ? "next-game-vs-badge next-game-score-badge"
    : "next-game-vs-badge";

  return `
    <div class="next-game-item${enterClass}${playedClass}${nextClass}" data-played="${match.played ? "1" : "0"}" data-current="${isLive ? "1" : "0"}"${stagger}>
      <div class="next-game-matchup">
        <div class="next-game-team next-game-team--home" title="${escapeHtml(match.home)}">
          ${flagHtml(match.home, "sm")}
          <span class="next-game-team-name">${escapeHtml(home)}</span>
        </div>
        <span class="${badgeClass}" aria-hidden="true">${centerBadge}</span>
        <div class="next-game-team next-game-team--away" title="${escapeHtml(match.away)}">
          ${flagHtml(match.away, "sm")}
          <span class="next-game-team-name">${escapeHtml(away)}</span>
        </div>
      </div>
      <div class="next-game-meta">${escapeHtml(meta)}</div>
    </div>`;
}

/** @param {MatchEntry} match @param {number} [index] @param {boolean} [animate] */
function nextGameItemHtml(match, index = 0, animate = false) {
  return fixtureItemHtml(match, index, animate, false);
}

/** @param {string} iso */
function formatNextGameKickoff(iso) {
  const d = new Date(iso);
  const date = d.toLocaleString("en-US", { month: "short", day: "numeric" });
  const time = d.toLocaleString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${date} · ${time}`;
}

/**
 * @param {HTMLElement} scrollEl
 * @param {boolean} instant Skip max-height transition (initial layout / remeasure).
 */
function setScrollHeightInstant(scrollEl, instant) {
  scrollEl.classList.toggle("is-height-instant", instant);
  if (instant) {
    void scrollEl.offsetHeight;
    scrollEl.classList.remove("is-height-instant");
  }
}

/**
 * @param {HTMLElement} listEl
 * @returns {HTMLElement | null}
 */
function firstUpcomingFixtureItem(listEl) {
  const item = listEl.querySelector('.next-game-item[data-current="1"], .next-game-item[data-played="0"]');
  return item instanceof HTMLElement ? item : null;
}

/** @param {HTMLElement} scrollEl */
function updateNextGamesScrollHint(scrollEl) {
  const hint = document.getElementById("nextGamesScrollHint");
  if (!hint) {
    return;
  }
  const show =
    scrollEl.classList.contains("has-past-results") && scrollEl.scrollTop > 6;
  hint.classList.toggle("hidden", !show);
}

/**
 * @param {HTMLElement} scrollEl
 * @param {HTMLElement} listEl
 */
function scrollToFirstUpcoming(scrollEl, listEl) {
  if (scrollEl.classList.contains("is-open")) {
    updateNextGamesScrollHint(scrollEl);
    return;
  }
  const first = firstUpcomingFixtureItem(listEl);
  const hasPast = scrollEl.classList.contains("has-past-results");
  if (first && hasPast) {
    scrollEl.scrollTop = Math.max(0, first.offsetTop - listEl.offsetTop);
  } else {
    scrollEl.scrollTop = 0;
  }
  updateNextGamesScrollHint(scrollEl);
}

function syncNextGamesCollapsedHeight(scrollEl, listEl, instant = false) {
  if (instant) {
    scrollEl.classList.add("is-height-instant");
  }

  const items = [...listEl.querySelectorAll(".next-game-item")];
  const startIdx = items.findIndex((el) => (
    el.getAttribute("data-current") === "1" || el.getAttribute("data-played") !== "1"
  ));
  const anchorIdx = startIdx >= 0 ? startIdx : 0;
  const remaining = items.length - anchorIdx;

  if (remaining <= 3) {
    scrollEl.style.removeProperty("--next-games-collapsed-h");
  } else {
    const startItem = items[anchorIdx];
    const lastPreview = items[Math.min(anchorIdx + 2, items.length - 1)];
    if (startItem instanceof HTMLElement && lastPreview instanceof HTMLElement) {
      scrollEl.style.setProperty(
        "--next-games-collapsed-h",
        `${lastPreview.offsetTop + lastPreview.offsetHeight - startItem.offsetTop}px`
      );
    }
  }

  setScrollHeightInstant(scrollEl, instant);
}

/**
 * @param {HTMLElement} scrollEl
 * @param {HTMLElement} listEl
 * @param {boolean} [instant]
 */
function syncLeaderboardCollapsedHeight(scrollEl, listEl, instant = false) {
  if (instant) {
    scrollEl.classList.add("is-height-instant");
  }

  const rows = listEl.querySelectorAll(".lb-row");
  if (rows.length <= LEADERBOARD_PREVIEW_ROWS) {
    scrollEl.style.removeProperty("--lb-scroll-collapsed-h");
  } else {
    const firstPreview = rows[0];
    const lastPreview = rows[LEADERBOARD_PREVIEW_ROWS - 1];
    if (firstPreview instanceof HTMLElement && lastPreview instanceof HTMLElement) {
      scrollEl.style.setProperty(
        "--lb-scroll-collapsed-h",
        `${lastPreview.offsetTop + lastPreview.offsetHeight - firstPreview.offsetTop}px`
      );
    }
  }

  setScrollHeightInstant(scrollEl, instant);
}

function toggleStandingsPanel() {
  const scroll = document.getElementById("betsTable");
  const btn = document.getElementById("viewStandingsBtn");
  if (!scroll || !btn) {
    return;
  }
  scroll.classList.remove("is-expanding");
  const isOpen = scroll.classList.toggle("is-open");
  if (isOpen) {
    void scroll.offsetHeight;
    scroll.classList.add("is-expanding");
    window.setTimeout(() => scroll.classList.remove("is-expanding"), 650);
  }
  if (!isOpen) {
    scroll.scrollTop = 0;
  }
  btn.setAttribute("aria-expanded", String(isOpen));
  btn.textContent = isOpen ? "Hide standings" : "View full standings";
  trackAnalytics("standings_toggled", {
    is_expanded: isOpen,
    visible_rows: LEADERBOARD_PREVIEW_ROWS,
    leaderboard_count: cachedData?.leaderboard.length,
    games_played: cachedData?.gamesPlayed,
  });
}

/**
 * @param {HTMLElement | null} listEl
 * @param {HTMLElement | null} scrollEl
 * @param {TotoData} data
 * @param {boolean} [animate]
 */
function renderNextGames(listEl, scrollEl, data, animate = false) {
  const fixtures = allFixturesMatches(data);
  const upcoming = allUpcomingMatches(data);
  const liveIds = new Set(manualLiveMatchIds(data));
  const hasPast = fixtures.some((m) => m.played && !liveIds.has(m.id));
  const nextId = liveIds.size > 0 ? undefined : upcoming[0]?.id;
  const fixturesBtn = document.getElementById("viewFixturesBtn");

  if (listEl) {
    if (fixtures.length === 0) {
      listEl.innerHTML = '<p class="next-games-empty">No matches</p>';
    } else if (upcoming.length === 0) {
      listEl.innerHTML = fixtures
        .map((m, index) => fixtureItemHtml(m, index, animate, false, liveIds.has(m.id)))
        .join("");
    } else {
      listEl.innerHTML = fixtures
        .map((m, index) => fixtureItemHtml(m, index, animate, m.id === nextId, liveIds.has(m.id)))
        .join("");
    }
  }

  if (scrollEl instanceof HTMLElement) {
    scrollEl.classList.toggle("has-past-results", hasPast);
  }

  if (scrollEl instanceof HTMLElement && listEl instanceof HTMLElement) {
    syncNextGamesCollapsedHeight(scrollEl, listEl, true);
    requestAnimationFrame(() => {
      syncNextGamesCollapsedHeight(scrollEl, listEl, true);
      scrollToFirstUpcoming(scrollEl, listEl);
    });
  }

  if (fixturesBtn) {
    fixturesBtn.classList.toggle("hidden", upcoming.length <= 3);
  }

  if (scrollEl && upcoming.length <= 3) {
    scrollEl.classList.remove("is-open");
    fixturesBtn?.setAttribute("aria-expanded", "false");
    if (fixturesBtn) {
      fixturesBtn.textContent = "View all fixtures";
    }
    if (listEl instanceof HTMLElement) {
      scrollToFirstUpcoming(scrollEl, listEl);
    }
  }
}

function toggleFixturesPanel() {
  const scroll = document.getElementById("nextGamesScroll");
  const list = document.getElementById("nextGamesList");
  const btn = document.getElementById("viewFixturesBtn");
  if (!scroll || !btn) {
    return;
  }
  const isOpen = scroll.classList.toggle("is-open");
  if (!isOpen && list instanceof HTMLElement) {
    scrollToFirstUpcoming(scroll, list);
  } else {
    updateNextGamesScrollHint(scroll);
  }
  btn.setAttribute("aria-expanded", String(isOpen));
  btn.textContent = isOpen ? "Hide fixtures" : "View all fixtures";
  trackAnalytics("fixtures_toggled", {
    is_expanded: isOpen,
    matches_count: cachedData?.matches.length,
    games_played: cachedData?.gamesPlayed,
  });
}

/**
 * @param {HTMLElement | null} el
 */
function hideCountdown(el) {
  if (countdownTimerId !== undefined) {
    window.clearInterval(countdownTimerId);
    countdownTimerId = undefined;
  }
  if (el) {
    el.innerHTML = "";
    el.classList.add("hidden");
  }
}

/**
 * @param {TotoData} data
 * @param {boolean} [animate]
 */
function renderHeroAndCountdown(data, animate = false) {
  const hero = document.getElementById("gameInfo");
  const countdown = document.getElementById("countdown");
  const topBarDatetime = document.getElementById("topBarDatetime");
  const next = nextUnplayedMatch(data);
  const live = isScoreboardLive(data, isDebugMode());

  renderHeroMatch(hero, data, !live, shouldShowLiveBadge(data), animate);
  updateLiveIndicator(data);

  if (live) {
    hideCountdown(countdown);
  } else {
    countdown?.classList.remove("hidden");
    startCountdown(countdown, next?.kickoffAt ?? null, onKickoffReached, animate);
  }

  if (topBarDatetime) {
    if (live) {
      topBarDatetime.textContent = formatDateTime(data.generatedAt);
    } else if (next?.kickoffAt) {
      topBarDatetime.textContent = formatKickoffLabel(next.kickoffAt);
    }
  }
}

/**
 * @param {TotoData | null} prev
 * @param {TotoData} next
 * @returns {{ title: string, message: string }}
 */
function describeLiveUpdate(prev, next) {
  if (!prev) {
    return { title: "Updated", message: "Scoreboard refreshed" };
  }

  if (next.gamesPlayed > prev.gamesPlayed && next.lastResult) {
    const result = next.lastResult;
    const home = shortTeamName(result.home);
    const away = shortTeamName(result.away);
    const leader = [...next.leaderboard].sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999))[0];
    const leaderLine = leader ? ` · ${leader.name} leads` : "";
    return {
      title: "New result",
      message: `Match ${result.matchId}: ${home} ${result.homeScore} — ${result.awayScore} ${away}${leaderLine}`,
    };
  }

  const prevReg = normalizeRegistration(prev.registration, prev.matches);
  const nextReg = normalizeRegistration(next.registration, next.matches);
  if (nextReg.count !== prevReg.count) {
    const delta = nextReg.count - prevReg.count;
    const playerLabel = nextReg.count === 1 ? "player" : "players";
    const deltaLabel =
      delta > 0 ? `+${delta} new` : `${Math.abs(delta)} removed`;
    return {
      title: "Registration",
      message: `${nextReg.count} ${playerLabel} · ${deltaLabel}`,
    };
  }

  const prevLive = isScoreboardLive(prev, isDebugMode());
  const nextLive = isScoreboardLive(next, isDebugMode());
  if (prevLive !== nextLive) {
    return {
      title: nextLive ? "Live now" : "Update",
      message: nextLive ? "Scoreboard is live" : "Scoreboard view updated",
    };
  }

  return { title: "Updated", message: "Scoreboard refreshed" };
}

/** @param {string} title @param {string} message */
function showUpdateToast(title, message) {
  const toast = document.getElementById("updateToast");
  const titleEl = document.getElementById("updateToastTitle");
  const messageEl = document.getElementById("updateToastMessage");
  if (!toast || !titleEl || !messageEl) {
    return;
  }

  if (updateToastTimerId !== undefined) {
    window.clearTimeout(updateToastTimerId);
    updateToastTimerId = undefined;
  }

  titleEl.textContent = title;
  messageEl.textContent = message;
  toast.classList.remove("hidden");
  requestAnimationFrame(() => {
    toast.classList.add("is-visible");
  });

  updateToastTimerId = window.setTimeout(() => {
    hideUpdateToast();
  }, UPDATE_TOAST_MS);
}

function hideUpdateToast() {
  const toast = document.getElementById("updateToast");
  if (!toast) {
    return;
  }
  if (updateToastTimerId !== undefined) {
    window.clearTimeout(updateToastTimerId);
    updateToastTimerId = undefined;
  }
  toast.classList.remove("is-visible");
  window.setTimeout(() => {
    if (!toast.classList.contains("is-visible")) {
      toast.classList.add("hidden");
    }
  }, 350);
}

async function pollForUpdates() {
  if (!knownVersion) {
    return;
  }
  try {
    const response = await fetch(VERSION_URL, { cache: "no-store" });
    if (!response.ok) {
      return;
    }
    const payload = await response.json();
    const remoteVersion = typeof payload.version === "string" ? payload.version : "";
    if (!remoteVersion || remoteVersion === knownVersion) {
      return;
    }
    await loadData(false, { livePush: true });
  } catch (err) {
    console.warn("Live update check failed", err);
  }
}

function startLivePolling() {
  if (livePollTimerId !== undefined) {
    return;
  }
  livePollTimerId = window.setInterval(() => {
    void pollForUpdates();
  }, LIVE_POLL_MS);
}

function stopLivePolling() {
  if (livePollTimerId === undefined) {
    return;
  }
  window.clearInterval(livePollTimerId);
  livePollTimerId = undefined;
}

/**
 * @param {boolean} fromUserClick
 * @param {{ livePush?: boolean }} [options]
 */
async function loadData(fromUserClick, options = {}) {
  const table = document.getElementById("betsTable");
  const standingsBtn = document.getElementById("viewStandingsBtn");
  const gamesBadge = document.getElementById("gamesBadge");
  const countdown = document.getElementById("countdown");
  if (gamesBadge && cachedData && isScoreboardLive(cachedData, isDebugMode())) {
    gamesBadge.textContent = "Loading…";
  }
  if (countdown && (!cachedData || !isScoreboardLive(cachedData, isDebugMode()))) {
    if (!countdown.innerHTML) {
      countdown.innerHTML = '<p class="countdown-loading">Loading…</p>';
    }
    countdown.classList.remove("hidden");
  }

  try {
    const response = await fetch(DATA_URL, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    /** @type {TotoData} */
    const data = await response.json();
    const previousData = cachedData;
    const isLivePush = Boolean(options.livePush);
    cachedData = data;
    knownVersion = data.version;
    const animate = shouldPlayEntrance() && !isLivePush;

    applyViewMode(data);
    renderHeroAndCountdown(data, animate);
    renderRegistrationCounter(data);

    if (isScoreboardLive(data, isDebugMode())) {
      renderPredictionsPanel(document.getElementById("predictionsPanel"), data);
      if (SHOW_LEADERBOARD_ROWS) {
        renderLeaderboard(table, data, animate);
      } else {
        renderLeaderboardComingSoon(table);
        standingsBtn?.classList.add("hidden");
      }
      renderNextGames(
        document.getElementById("nextGamesList"),
        document.getElementById("nextGamesScroll"),
        data,
        animate
      );
      if (gamesBadge) {
        gamesBadge.innerHTML = gamesBadgeHtml(data.gamesPlayed, fromUserClick);
        if (fromUserClick) {
          gamesBadge.classList.add("games-badge--pulse");
          window.setTimeout(() => gamesBadge.classList.remove("games-badge--pulse"), 1200);
        }
      }
    } else {
      renderPredictionsPanel(document.getElementById("predictionsPanel"), null);
    }

    const app = document.querySelector(".app");
    if (animate) {
      app?.classList.add("await-enter");
    }
    app?.classList.add("loaded");
    app?.classList.toggle("is-live", isScoreboardLive(data, isDebugMode()));
    triggerEntrance(animate);
    if (shouldTrackPresence()) {
      startPresencePolling();
    } else {
      stopPresencePolling();
      hideViewerCount();
    }

    if (isLivePush && previousData) {
      const update = describeLiveUpdate(previousData, data);
      showUpdateToast(update.title, update.message);
    }

    if (!previousData) {
      window.totoAnalytics?.trackPage("scoreboard", {
        ...scoreboardAnalyticsProps(data),
        load_source: "initial",
      });
    } else if (fromUserClick) {
      trackAnalytics("scoreboard_refreshed", {
        ...scoreboardAnalyticsProps(data),
        load_source: "manual",
      });
    } else if (isLivePush) {
      trackAnalytics("live_update_received", {
        ...scoreboardAnalyticsProps(data),
        previous_games_played: previousData.gamesPlayed,
        previous_version: previousData.version,
        next_version: data.version,
      });
    }

    startLivePolling();
  } catch (err) {
    console.error(err);
    const hero = document.getElementById("gameInfo");
    if (cachedData && isScoreboardLive(cachedData, isDebugMode())) {
      if (gamesBadge) {
        gamesBadge.textContent = "Offline";
      }
      if (hero) {
        hero.innerHTML = '<div class="hero-empty">Results not available — try Refresh</div>';
      }
    } else if (hero) {
      hero.innerHTML = '<div class="hero-empty">Could not load match info</div>';
    }
    if (countdown) {
      hideCountdown(countdown);
    }
    document.querySelector(".app")?.classList.add("loaded");
  }
}

/**
 * @param {HTMLElement | null} el
 * @param {string | null} kickoffAt
 * @param {() => void} [onReached]
 * @param {boolean} [animate]
 */
function startCountdown(el, kickoffAt, onReached, animate = false) {
  if (countdownTimerId !== undefined) {
    window.clearInterval(countdownTimerId);
    countdownTimerId = undefined;
  }
  if (!el) {
    return;
  }
  el.classList.remove("hidden");
  if (!kickoffAt) {
    el.innerHTML = '<p class="countdown-empty">Kickoff time TBD</p>';
    return;
  }

  const targetMs = Date.parse(kickoffAt);
  if (Number.isNaN(targetMs)) {
    el.innerHTML = '<p class="countdown-empty">Kickoff time TBD</p>';
    return;
  }

  /** @param {number} value @param {string} label @param {number} index @param {boolean} withEnter */
  function unit(value, label, index, withEnter) {
    const enterClass = withEnter ? " countdown-unit--enter" : "";
    const stagger = withEnter ? ` style="--enter-i: ${index}"` : "";
    return `
      <div class="countdown-unit${enterClass}"${stagger}>
        <span class="countdown-value">${String(value).padStart(2, "0")}</span>
        <span class="countdown-name">${label}</span>
      </div>`;
  }

  function tick() {
    const diff = targetMs - Date.now();
    if (diff <= 0) {
      hideCountdown(el);
      onReached?.();
      return;
    }

    const totalSeconds = Math.floor(diff / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const animateUnits = animate;
    animate = false;

    el.innerHTML = `
      <div class="countdown-label">Kickoff in</div>
      <div class="countdown-units">
        ${unit(days, "Days", 0, animateUnits)}
        ${unit(hours, "Hrs", 1, animateUnits)}
        ${unit(minutes, "Min", 2, animateUnits)}
        ${unit(seconds, "Sec", 3, animateUnits)}
      </div>`;
  }

  tick();
  countdownTimerId = window.setInterval(tick, 1000);
}

/** @param {string} iso */
function formatKickoffLabel(iso) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * @param {number} count
 * @param {boolean} justUpdated
 */
function gamesBadgeHtml(count, justUpdated) {
  if (justUpdated) {
    return '<span class="games-badge-dot">●</span> Updated';
  }
  const label = count === 1 ? "game played" : "games played";
  if (count === 0) {
    return '<span class="games-badge-dot">●</span> Waiting for kickoff';
  }
  return `<span class="games-badge-dot">●</span> ${count} ${label}`;
}

/** @param {TotoData} data @returns {MatchEntry | null} */
function predictionMatch(data) {
  const live = heroLiveMatches(data)[0];
  if (live) {
    return live;
  }
  const next = nextUnplayedMatch(data);
  if (next) {
    return next;
  }
  const last = data.lastResult;
  if (last && typeof last === "object" && "matchId" in last) {
    const lastId = Number(last.matchId);
    return data.matches.find((match) => Number(match.id) === lastId) || null;
  }
  return null;
}

/**
 * @param {number} count
 * @param {number} total
 */
function predictionPercent(count, total) {
  if (total <= 0) {
    return 0;
  }
  return Math.round((count / total) * 100);
}

/** @param {{ home: number, away: number }} score */
function predictionOutcome(score) {
  if (score.home > score.away) {
    return "home";
  }
  if (score.home < score.away) {
    return "away";
  }
  return "draw";
}

/**
 * @param {{ home: number, away: number, count: number }} a
 * @param {{ home: number, away: number, count: number }} b
 */
function compareUniquePredictionScores(a, b) {
  return (
    a.count - b.count ||
    Math.abs(b.home - b.away) - Math.abs(a.home - a.away) ||
    b.home + b.away - (a.home + a.away) ||
    b.home - a.home ||
    a.away - b.away
  );
}

/**
 * @param {{ homeCount: number, drawCount: number, awayCount: number }} outcome
 * @returns {"home" | "away" | null}
 */
function leadingTeamOutcome(outcome) {
  if (outcome.homeCount > outcome.awayCount && outcome.homeCount > outcome.drawCount) {
    return "home";
  }
  if (outcome.awayCount > outcome.homeCount && outcome.awayCount > outcome.drawCount) {
    return "away";
  }
  return null;
}

/**
 * @param {Array<{ home: number, away: number, count: number, players: string[] }>} scoreRows
 * @param {{ homeCount: number, drawCount: number, awayCount: number }} outcome
 */
function selectUniquePredictionScore(scoreRows, outcome) {
  const rarestOverall = [...scoreRows].sort(compareUniquePredictionScores)[0];
  const leadingTeam = leadingTeamOutcome(outcome);
  if (!leadingTeam) {
    return rarestOverall;
  }

  const oppositeTeam = leadingTeam === "home" ? "away" : "home";
  const oppositeScore = scoreRows
    .filter((score) => predictionOutcome(score) === oppositeTeam)
    .sort(compareUniquePredictionScores)[0];
  if (oppositeScore) {
    return oppositeScore;
  }

  const drawScore = scoreRows
    .filter((score) => predictionOutcome(score) === "draw")
    .sort(compareUniquePredictionScores)[0];
  return drawScore || rarestOverall;
}

/**
 * @param {TotoData} data
 * @param {MatchEntry} match
 */
function predictionStats(data, match) {
  const outcome = { home: 0, draw: 0, away: 0 };
  /** @type {Map<string, { home: number, away: number, count: number, players: string[] }>} */
  const scores = new Map();

  for (const entry of data.leaderboard || []) {
    const pick = (entry.picks || []).find((item) => Number(item.matchId) === Number(match.id));
    if (
      !pick ||
      pick.homePick === null ||
      pick.homePick === undefined ||
      pick.awayPick === null ||
      pick.awayPick === undefined
    ) {
      continue;
    }
    const home = Number(pick?.homePick);
    const away = Number(pick?.awayPick);
    if (!Number.isFinite(home) || !Number.isFinite(away)) {
      continue;
    }
    if (home > away) {
      outcome.home += 1;
    } else if (home < away) {
      outcome.away += 1;
    } else {
      outcome.draw += 1;
    }

    const key = `${home}-${away}`;
    const current = scores.get(key) || { home, away, count: 0, players: [] };
    current.count += 1;
    current.players.push(entry.name);
    scores.set(key, current);
  }

  const total = outcome.home + outcome.draw + outcome.away;
  if (total === 0 || scores.size === 0) {
    return null;
  }

  const scoreRows = [...scores.values()];
  const trending = [...scoreRows].sort((a, b) => (
    b.count - a.count ||
    Math.abs(b.home - b.away) - Math.abs(a.home - a.away) ||
    b.home + b.away - (a.home + a.away) ||
    b.home - a.home ||
    a.away - b.away
  ))[0];
  const outcomeCounts = {
    homeCount: outcome.home,
    drawCount: outcome.draw,
    awayCount: outcome.away,
  };
  const unique = selectUniquePredictionScore(scoreRows, outcomeCounts);

  return {
    match,
    total,
    outcome: {
      home: predictionPercent(outcome.home, total),
      draw: predictionPercent(outcome.draw, total),
      away: predictionPercent(outcome.away, total),
      ...outcomeCounts,
    },
    trending,
    unique,
  };
}

/**
 * @param {{ home: number, away: number, count: number, players: string[] }} score
 * @param {MatchEntry} match
 */
function predictionScoreHtml(score, match) {
  return `
    <div class="prediction-scoreline">
      ${flagHtml(match.home, "sm")}
      <span class="prediction-score">${score.home}&nbsp;—&nbsp;${score.away}</span>
      ${flagHtml(match.away, "sm")}
    </div>`;
}

/**
 * @param {HTMLElement | null} panel
 * @param {TotoData | null} data
 */
function renderPredictionsPanel(panel, data) {
  if (!panel || !data) {
    panel?.classList.add("hidden");
    return;
  }

  const match = predictionMatch(data);
  const stats = match ? predictionStats(data, match) : null;
  if (!match || !stats) {
    panel.classList.add("hidden");
    panel.innerHTML = "";
    return;
  }

  const homePct = stats.outcome.home;
  const drawPct = stats.outcome.draw;
  const awayPct = stats.outcome.away;
  const trendingPct = predictionPercent(stats.trending.count, stats.total);
  const uniquePlayer = stats.unique.count === 1 ? stats.unique.players[0] : "";
  const uniqueMeta = uniquePlayer
    ? `<span>${escapeHtml(uniquePlayer)}</span>`
    : `<span>${stats.unique.count} players</span>`;

  panel.innerHTML = `
    <div class="predictions-summary glass-panel">
      <div class="predictions-head">
        <div>
          <h2 class="predictions-title">Predictions</h2>
          <p class="predictions-sub">How people think ${escapeHtml(shortTeamName(match.home))} vs ${escapeHtml(shortTeamName(match.away))} will end</p>
        </div>
        <span class="predictions-count">${stats.total} picks</span>
      </div>
      <div class="prediction-outcomes" aria-label="Prediction outcome split">
        <div class="prediction-outcome prediction-outcome--home">
          <span class="prediction-pct">${homePct}%</span>
          <span class="prediction-label">Home win</span>
        </div>
        <div class="prediction-outcome prediction-outcome--draw">
          <span class="prediction-pct">${drawPct}%</span>
          <span class="prediction-label">Draw</span>
        </div>
        <div class="prediction-outcome prediction-outcome--away">
          <span class="prediction-pct">${awayPct}%</span>
          <span class="prediction-label">Away win</span>
        </div>
      </div>
      <div class="prediction-bar" aria-hidden="true">
        <span class="prediction-bar-home" style="flex-grow:${stats.outcome.homeCount}"></span>
        <span class="prediction-bar-draw" style="flex-grow:${stats.outcome.drawCount}"></span>
        <span class="prediction-bar-away" style="flex-grow:${stats.outcome.awayCount}"></span>
      </div>
    </div>
    <div class="prediction-cards">
      <article class="prediction-card glass-panel">
        <h3 class="prediction-card-title">Most trending result</h3>
        <p class="prediction-card-sub">Most predicted exact score</p>
        ${predictionScoreHtml(stats.trending, match)}
        <p class="prediction-card-meta">${trendingPct}% of predictions</p>
      </article>
      <article class="prediction-card glass-panel">
        <h3 class="prediction-card-title">Most unique result</h3>
        <p class="prediction-card-sub">Rarest predicted exact score</p>
        ${predictionScoreHtml(stats.unique, match)}
        <p class="prediction-card-meta prediction-card-meta--player">${uniqueMeta}</p>
      </article>
    </div>`;
  panel.classList.remove("hidden");
}

/** @param {HTMLElement | null} container */
function renderLeaderboardComingSoon(container) {
  if (!container) {
    return;
  }
  container.classList.remove("is-open");
  container.scrollTop = 0;
  container.innerHTML = `
    <div class="lb-coming-soon" role="status">
      <span class="lb-coming-soon-title">Coming soon</span>
      <span class="lb-coming-soon-copy">Leaderboard will open when the players table is ready.</span>
    </div>`;
  container.style.removeProperty("--lb-scroll-collapsed-h");
}

/**
 * @param {LeaderboardEntry} entry
 * @param {number | null} matchId
 */
function livePredictionHtml(entry, matchId) {
  if (!matchId) {
    return "";
  }
  const pick = (entry.picks || []).find((item) => Number(item.matchId) === Number(matchId));
  if (!pick || pick.homePick === null || pick.awayPick === null) {
    return '<span class="lb-pick-pill lb-pick-pill--empty">No pick</span>';
  }
  const points = Number(pick.points);
  const accuracyClass = Number.isFinite(points)
    ? points >= 5
      ? " lb-pick-pill--full"
      : points > 0
        ? " lb-pick-pill--some"
        : " lb-pick-pill--zero"
    : "";
  return `<span class="lb-pick-pill${accuracyClass}">${pick.homePick}&nbsp;–&nbsp;${pick.awayPick}</span>`;
}

/** @param {LeaderboardEntry} entry */
function playerHref(entry) {
  const id = entry.id ? `id=${encodeURIComponent(entry.id)}` : "";
  const name = `name=${encodeURIComponent(entry.name)}`;
  return `player.html?${id ? `${id}&` : ""}${name}`;
}

/**
 * @param {LeaderboardEntry} entry
 * @param {LeaderboardEntry[]} leaderboard
 * @returns {string | null}
 */
function inheritedRankLabel(entry, leaderboard) {
  const index = leaderboard.indexOf(entry);
  if (index <= 0) {
    return null;
  }
  for (let i = index - 1; i >= 0; i -= 1) {
    const label = String(leaderboard[i].rankLabel || "").trim();
    if (label && label !== "-") {
      return label;
    }
  }
  return null;
}

/**
 * @param {LeaderboardEntry} entry
 * @param {TotoData} data
 * @param {number} fallbackRank
 */
function leaderboardRankDisplay(entry, data, fallbackRank) {
  const label = String(entry.rankLabel || "").trim();
  const displayLabel = label && label !== "-"
    ? label
    : inheritedRankLabel(entry, data.leaderboard) || "";
  const dataRank = Number(entry.rank);
  const rankFromLabel = Number(displayLabel);
  const displayRank = Number.isFinite(rankFromLabel) && rankFromLabel > 0
    ? rankFromLabel
    : Number.isFinite(dataRank) && dataRank > 0
      ? dataRank
      : fallbackRank;
  return {
    rank: displayRank,
    label: displayLabel || String(displayRank),
  };
}

/** @param {string | null | undefined} tab */
function normalizeLeaderboardTab(tab) {
  return tab && LEADERBOARD_TABS.has(tab) ? tab : "full";
}

/** @returns {string} */
function getStoredLeaderboardTab() {
  try {
    return normalizeLeaderboardTab(window.localStorage.getItem(LEADERBOARD_TAB_STORAGE_KEY));
  } catch (err) {
    return "full";
  }
}

/** @returns {string} */
function getStoredChampionFilter() {
  try {
    return window.localStorage.getItem(CHAMPION_FILTER_STORAGE_KEY) || "";
  } catch (err) {
    return "";
  }
}

/** @returns {Set<string>} */
function getFollowedPlayerKeys() {
  try {
    const raw = window.localStorage.getItem(FOLLOWED_PLAYERS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) {
      return new Set();
    }
    return new Set(parsed.filter((key) => typeof key === "string" && key));
  } catch (err) {
    return new Set();
  }
}

/** @param {Set<string>} keys */
function saveFollowedPlayerKeys(keys) {
  try {
    window.localStorage.setItem(FOLLOWED_PLAYERS_STORAGE_KEY, JSON.stringify([...keys]));
  } catch (err) {
    console.warn("Could not save followed players", err);
  }
}

/** @param {LeaderboardEntry} entry */
function playerFollowKey(entry) {
  return entry.id ? `id:${entry.id}` : `name:${entry.name}`;
}

/** @param {string} playerKey */
function toggleFollowedPlayer(playerKey) {
  if (!playerKey) {
    return;
  }
  const followed = getFollowedPlayerKeys();
  if (followed.has(playerKey)) {
    followed.delete(playerKey);
  } else {
    followed.add(playerKey);
  }
  saveFollowedPlayerKeys(followed);
  if (cachedData) {
    renderLeaderboard(document.getElementById("betsTable"), cachedData);
  }
}

/** @param {MouseEvent} event */
function handleLeaderboardTabClick(event) {
  const btn = event.target instanceof Element ? event.target.closest("[data-leaderboard-tab]") : null;
  if (!(btn instanceof HTMLButtonElement)) {
    return;
  }
  const nextTab = normalizeLeaderboardTab(btn.dataset.leaderboardTab);
  if (leaderboardState.tab === nextTab) {
    return;
  }
  leaderboardState.tab = nextTab;
  try {
    window.localStorage.setItem(LEADERBOARD_TAB_STORAGE_KEY, nextTab);
  } catch (err) {
    // Ignore storage failures; the tab still changes for this session.
  }
  if (cachedData) {
    renderLeaderboard(document.getElementById("betsTable"), cachedData);
  }
}

/** @param {Event} event */
function handleChampionFilterChange(event) {
  const select = event.currentTarget;
  if (!(select instanceof HTMLSelectElement)) {
    return;
  }
  leaderboardState.champion = select.value;
  try {
    window.localStorage.setItem(CHAMPION_FILTER_STORAGE_KEY, leaderboardState.champion);
  } catch (err) {
    // Ignore storage failures; the selected filter still changes for this session.
  }
  if (cachedData) {
    renderLeaderboard(document.getElementById("betsTable"), cachedData);
  }
}

/** @param {TotoData} data */
function championFilterOptions(data) {
  const counts = new Map();
  for (const entry of data.leaderboard || []) {
    const champion = entry.champion || "";
    if (!champion) {
      continue;
    }
    counts.set(champion, (counts.get(champion) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** @param {TotoData} data */
function syncChampionFilter(data) {
  const options = championFilterOptions(data);
  if (!options.some((option) => option.name === leaderboardState.champion)) {
    leaderboardState.champion = options[0]?.name || "";
  }
  return options;
}

/**
 * @param {TotoData} data
 * @param {Set<string>} followed
 */
function visibleLeaderboardEntries(data, followed) {
  const sorted = [...data.leaderboard];
  if (leaderboardState.tab === "following") {
    return sorted.filter((entry) => followed.has(playerFollowKey(entry)));
  }
  if (leaderboardState.tab === "champion") {
    return sorted.filter((entry) => entry.champion === leaderboardState.champion);
  }
  return sorted;
}

/**
 * @param {TotoData} data
 * @param {Set<string>} followed
 * @param {Array<{ name: string, count: number }>} championOptions
 */
function updateLeaderboardControls(data, followed, championOptions) {
  const panel = document.getElementById("standingsPanel");
  const tabs = document.querySelectorAll("[data-leaderboard-tab]");
  const championFilter = document.getElementById("championFilter");
  const championSelect = document.getElementById("championFilterSelect");
  panel?.setAttribute("data-leaderboard-tab", leaderboardState.tab);
  tabs.forEach((tab) => {
    const isActive = tab instanceof HTMLElement && tab.dataset.leaderboardTab === leaderboardState.tab;
    tab.classList.toggle("is-active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
    if (tab instanceof HTMLButtonElement && tab.dataset.leaderboardTab === "following") {
      const count = followed.size;
      tab.textContent = count > 0 ? `Follow (${count})` : "Follow";
    }
  });

  championFilter?.classList.toggle("hidden", leaderboardState.tab !== "champion");
  if (championSelect instanceof HTMLSelectElement) {
    championSelect.innerHTML = championOptions
      .map((option) => (
        `<option value="${escapeAttribute(option.name)}"${option.name === leaderboardState.champion ? " selected" : ""}>${escapeHtml(option.name)} (${option.count})</option>`
      ))
      .join("");
    championSelect.disabled = championOptions.length === 0;
  }
}

/**
 * @param {string} kind
 * @param {TotoData} data
 */
function leaderboardEmptyHtml(kind, data) {
  if (kind === "following") {
    const total = data.leaderboard.length;
    return `
      <div class="lb-empty">
        <span class="lb-empty-title">No followed players yet</span>
        <span class="lb-empty-copy">${total} players in the full standings</span>
      </div>`;
  }
  if (kind === "champion") {
    return `
      <div class="lb-empty">
        <span class="lb-empty-title">No winner picks found</span>
        <span class="lb-empty-copy">Choose another winner above</span>
      </div>`;
  }
  return `
    <div class="lb-empty">
      <span class="lb-empty-title">No standings yet</span>
    </div>`;
}

/** @param {HTMLElement | null} container @param {TotoData} data @param {boolean} [animate] */
function renderLeaderboard(container, data, animate = false) {
  if (!container) {
    return;
  }

  const followed = getFollowedPlayerKeys();
  const championOptions = syncChampionFilter(data);
  updateLeaderboardControls(data, followed, championOptions);
  const sorted = visibleLeaderboardEntries(data, followed);
  const liveMatchId = manualLiveMatchIds(data)[0] ?? null;
  const leaderboardPanel = container.closest(".leaderboard");
  leaderboardPanel?.classList.toggle("has-live-picks", liveMatchId !== null);

  const standingsBtn = document.getElementById("viewStandingsBtn");

  if (sorted.length === 0) {
    container.innerHTML = leaderboardEmptyHtml(leaderboardState.tab, data);
  } else {
    container.innerHTML = sorted
      .map((entry, index) => {
      const { rank: displayRank, label: rankLabel } = leaderboardRankDisplay(
        entry,
        data,
        data.leaderboard.indexOf(entry) + 1
      );
      const rankClass = displayRank <= 5 ? `rank-${displayRank}` : "rank-default";
      const rowClass = displayRank <= 5 ? `rank-${displayRank}` : "";
      const crown = displayRank === 1 ? CROWN_SVG : "";
      const trend = trendHtml(entry.movement);
      const rowFlag = lbRowFlagHtml(entry.champion);
      const championClass = rowFlag ? " lb-row--champion" : "";
      const enterClass = animate && index < LEADERBOARD_PREVIEW_ROWS ? " lb-row--enter" : "";
      const revealIndex = Math.min(index, 16);
      const stagger = ` style="--enter-i: ${index}; --reveal-i: ${revealIndex}"`;
      const followKey = playerFollowKey(entry);
      const isFollowed = followed.has(followKey);
      const followClass = isFollowed ? " is-followed" : "";
      const followAction = isFollowed ? "Unfollow" : "Follow";
      const championLabel = entry.champion
        ? `, champion ${entry.champion}`
        : "";
      const rowTitle = entry.champion
        ? `Champion pick: ${entry.champion}`
        : "";
      const href = playerHref(entry);
      const livePick = livePredictionHtml(entry, liveMatchId);

      return `
    <div class="lb-row ${rowClass}${championClass}${enterClass}" role="link" tabindex="0" data-href="${escapeAttribute(href)}" data-rank="${displayRank}" data-points="${entry.points.toFixed(0)}" data-has-champion="${entry.champion ? "true" : "false"}" title="${escapeAttribute(rowTitle)}" aria-label="${escapeAttribute(`${entry.name}, ${entry.points.toFixed(0)} points${championLabel}`)}"${stagger}>
      ${rowFlag}
      <div class="lb-rank-cell">
        <span class="rank-badge ${rankClass}">${escapeHtml(rankLabel)}</span>
      </div>
      <div class="lb-trend-cell">${trend}</div>
      <div class="lb-player">
        <span class="lb-player-name">${escapeHtml(entry.name)}</span>
        ${crown}
      </div>
      <div class="lb-pick-cell">${livePick}</div>
      <div class="lb-follow-cell">
        <button type="button" class="lb-follow-btn${followClass}" data-player-key="${escapeAttribute(followKey)}" aria-pressed="${isFollowed}" aria-label="${escapeAttribute(`${followAction} ${entry.name}`)}">
          ${STAR_SVG}
        </button>
      </div>
      <div class="lb-pts">${entry.points.toFixed(0)}</div>
    </div>`;
    })
    .join("");
  }

  if (container instanceof HTMLElement) {
    syncLeaderboardCollapsedHeight(container, container, true);
    requestAnimationFrame(() => {
      syncLeaderboardCollapsedHeight(container, container, true);
    });
  }

  if (standingsBtn) {
    standingsBtn.classList.toggle("hidden", sorted.length <= LEADERBOARD_PREVIEW_ROWS);
  }

  if (container && sorted.length <= LEADERBOARD_PREVIEW_ROWS) {
    container.classList.remove("is-open");
    container.scrollTop = 0;
    standingsBtn?.setAttribute("aria-expanded", "false");
    if (standingsBtn) {
      standingsBtn.textContent = "View full standings";
    }
  }
}

/**
 * @param {HTMLElement | null} el
 * @param {TotoData} data
 * @param {boolean} [previewNext]
 * @param {boolean} [showLive]
 */
/**
 * @param {MatchEntry} match
 * @param {boolean} [showScore]
 */
function singleHeroMatchHtml(match, showScore = false) {
  const center = showScore
    ? `${match.homeScore ?? 0}&nbsp;—&nbsp;${match.awayScore ?? 0}`
    : "VS";
  return `
    <div class="hero-match-slot">
      <div class="hero-grid">
        ${heroTeamBlock(match.home, "home")}
        ${heroCenterBlock(center, match.id, !showScore)}
        ${heroTeamBlock(match.away, "away")}
      </div>
    </div>`;
}

/**
 * @param {HTMLElement | null} el
 * @param {TotoData} data
 * @param {boolean} [previewNext]
 * @param {boolean} [showLive]
 */
function renderHeroMatch(el, data, previewNext = false, showLive = false, animate = false) {
  if (!el) {
    return;
  }

  const liveMatches = showLive ? heroLiveMatches(data) : [];
  if (liveMatches.length > 0) {
    const dual = liveMatches.length > 1;
    el.innerHTML = `
      <div class="hero-body-inner${dual ? " hero-body-inner--dual" : ""}">
        <div class="hero-dual-grid">
          ${liveMatches.map((match) => singleHeroMatchHtml(match, true)).join("")}
        </div>
      </div>`;
    el.classList.toggle("hero-animate", animate);
    return;
  }

  const next = nextUnplayedMatch(data);
  if (next) {
    el.innerHTML = `
      <div class="hero-body-inner">
        ${singleHeroMatchHtml(next)}
      </div>`;
    el.classList.toggle("hero-animate", animate);
    return;
  }

  const last = data.lastResult;
  if (last && !previewNext) {
    el.innerHTML = `
      <div class="hero-body-inner">
        <div class="hero-grid">
          ${heroTeamBlock(last.home, "home")}
          ${heroCenterBlock(`${last.homeScore}&nbsp;—&nbsp;${last.awayScore}`, last.matchId, false, false)}
          ${heroTeamBlock(last.away, "away")}
        </div>
      </div>`;
    el.classList.toggle("hero-animate", animate);
    return;
  }

  el.innerHTML = '<div class="hero-empty">No upcoming matches</div>';
  el.classList.remove("hero-animate");
}

/**
 * @param {string} main
 * @param {number} matchId
 * @param {boolean} isVs
 */
function heroCenterBlock(main, matchId, isVs) {
  return `
    <div class="hero-center">
      <div class="hero-score${isVs ? " hero-vs" : ""}">${main}</div>
      <div class="hero-meta">Match ${matchId}</div>
    </div>`;
}

/** @param {string} movement */
function trendHtml(movement) {
  if (movement === "up") {
    return '<span class="trend-badge trend-badge-up" aria-label="Moved up"><span class="trend-icon">▲</span></span>';
  }
  if (movement === "down") {
    return '<span class="trend-badge trend-badge-down" aria-label="Moved down"><span class="trend-icon">▼</span></span>';
  }
  return '<span class="trend-badge trend-badge-same" aria-label="No change"></span>';
}

/** @param {string} iso */
function formatDateTime(iso) {
  const d = new Date(iso);
  const date = d.toLocaleString("en-US", { month: "short", day: "numeric" });
  const time = d.toLocaleString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${date} · ${time}`;
}

/** @param {string} text */
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/** @param {string} text */
function escapeAttribute(text) {
  return escapeHtml(String(text)).replace(/"/g, "&quot;");
}
