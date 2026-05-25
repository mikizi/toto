/** World Cup 2026 scoreboard — reads data/latest.json */

const LEADERBOARD_PREVIEW_ROWS = 10;

const DATA_URL = "data/latest.json";
const VERSION_URL = "data/version.json";
const LIVE_POLL_MS = 20000;
const UPDATE_TOAST_MS = 6000;

const CROWN_SVG = `<svg class="crown-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5 19h14v2H5v-2zm1.6-9.2L12 4l5.4 5.8L19 8l1 9H4l1.6-8.2z"/></svg>`;

/** @typedef {{ id: string, name: string, points: number, rank: number | null, champion: string | null, movement: string }} LeaderboardEntry */
/** @typedef {{ id: number, teams: string, home: string, away: string, homeScore: number | null, awayScore: number | null, played: boolean, kickoffAt: string | null }} MatchEntry */
/** @typedef {{ mode: "auto" | "manual", openMatchIds: number[], suppressAuto: boolean }} BroadcastState */
/** @typedef {{ version: string, generatedAt: string, gamesPlayed: number, lastResult: object | null, leaderboard: LeaderboardEntry[], matches: MatchEntry[], broadcast?: BroadcastState, registration?: unknown }} TotoData */

/** @type {number | undefined} */
let countdownTimerId;

/** @type {TotoData | null} */
let cachedData = null;

/** @type {string | null} */
let knownVersion = null;

/** @type {number | undefined} */
let livePollTimerId;

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
  return isScoreboardLive(data, isDebugMode());
}

/** @param {TotoData} data */
function updateLiveIndicator(data) {
  const badge = document.getElementById("liveBadge");
  const statusDot = document.getElementById("statusDot");
  const card = document.querySelector(".scoreboard-card");
  const showLive = shouldShowLiveBadge(data);
  const inProgress = isMatchInProgress(data, isDebugMode());

  badge?.classList.toggle("hidden", !showLive);
  card?.classList.toggle("is-live", showLive);
  statusDot?.classList.toggle("is-live", inProgress);
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

document.addEventListener("DOMContentLoaded", () => {
  const refreshBtn = document.getElementById("refreshBtn");
  refreshBtn?.addEventListener("click", () => loadData(true));
  document.getElementById("viewFixturesBtn")?.addEventListener("click", toggleFixturesPanel);
  document.getElementById("viewStandingsBtn")?.addEventListener("click", toggleStandingsPanel);
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
      return;
    }
    if (knownVersion) {
      void pollForUpdates();
      startLivePolling();
    }
  });
  loadData(false);
});

/** @param {TotoData} data @param {number} [limit] */
function upcomingMatches(data, limit = 3) {
  return data.matches
    .filter((m) => !m.played)
    .sort((a, b) => {
      const ta = a.kickoffAt ? Date.parse(a.kickoffAt) : Number.POSITIVE_INFINITY;
      const tb = b.kickoffAt ? Date.parse(b.kickoffAt) : Number.POSITIVE_INFINITY;
      if (ta !== tb) {
        return ta - tb;
      }
      return a.id - b.id;
    })
    .slice(0, limit);
}

/** @param {TotoData} data */
function allUpcomingMatches(data) {
  return data.matches
    .filter((m) => !m.played)
    .sort((a, b) => {
      const ta = a.kickoffAt ? Date.parse(a.kickoffAt) : Number.POSITIVE_INFINITY;
      const tb = b.kickoffAt ? Date.parse(b.kickoffAt) : Number.POSITIVE_INFINITY;
      if (ta !== tb) {
        return ta - tb;
      }
      return a.id - b.id;
    });
}

/** @param {TotoData} data @returns {MatchEntry[]} */
function allFixturesMatches(data) {
  return [...data.matches].sort((a, b) => {
    const ta = a.kickoffAt ? Date.parse(a.kickoffAt) : Number.POSITIVE_INFINITY;
    const tb = b.kickoffAt ? Date.parse(b.kickoffAt) : Number.POSITIVE_INFINITY;
    if (ta !== tb) {
      return ta - tb;
    }
    return a.id - b.id;
  });
}

/** @param {MatchEntry} match @param {number} [index] @param {boolean} [animate] @param {boolean} [isNext] */
function fixtureItemHtml(match, index = 0, animate = false, isNext = false) {
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
  } else {
    centerBadge = "vs";
    meta = match.kickoffAt
      ? formatNextGameKickoff(match.kickoffAt)
      : `Match ${match.id} · TBD`;
  }

  const badgeClass = match.played
    ? "next-game-vs-badge next-game-score-badge"
    : "next-game-vs-badge";

  return `
    <div class="next-game-item${enterClass}${playedClass}${nextClass}" data-played="${match.played ? "1" : "0"}"${stagger}>
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
  const item = listEl.querySelector('.next-game-item[data-played="0"]');
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
  const startIdx = items.findIndex((el) => el.getAttribute("data-played") !== "1");
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
    const lastPreview = rows[LEADERBOARD_PREVIEW_ROWS - 1];
    if (lastPreview instanceof HTMLElement) {
      scrollEl.style.setProperty(
        "--lb-scroll-collapsed-h",
        `${lastPreview.offsetTop + lastPreview.offsetHeight}px`
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
  const isOpen = scroll.classList.toggle("is-open");
  if (!isOpen) {
    scroll.scrollTop = 0;
  }
  btn.setAttribute("aria-expanded", String(isOpen));
  btn.textContent = isOpen ? "Hide standings" : "View full standings";
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
  const hasPast = fixtures.some((m) => m.played);
  const nextId = upcoming[0]?.id;
  const fixturesBtn = document.getElementById("viewFixturesBtn");

  if (listEl) {
    if (fixtures.length === 0) {
      listEl.innerHTML = '<p class="next-games-empty">No matches</p>';
    } else if (upcoming.length === 0) {
      listEl.innerHTML = fixtures
        .map((m, index) => fixtureItemHtml(m, index, animate, false))
        .join("");
    } else {
      listEl.innerHTML = fixtures
        .map((m, index) => fixtureItemHtml(m, index, animate, m.id === nextId))
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

  renderHeroMatch(hero, data, !live, isMatchInProgress(data, isDebugMode()), animate);
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
      renderLeaderboard(table, data.leaderboard, animate);
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
    }

    const app = document.querySelector(".app");
    if (animate) {
      app?.classList.add("await-enter");
    }
    app?.classList.add("loaded");
    app?.classList.toggle("is-live", isScoreboardLive(data, isDebugMode()));
    triggerEntrance(animate);

    if (isLivePush && previousData) {
      const update = describeLiveUpdate(previousData, data);
      showUpdateToast(update.title, update.message);
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

/** @param {LeaderboardEntry[]} leaderboard @param {boolean} [animate] */
function renderLeaderboard(container, leaderboard, animate = false) {
  if (!container) {
    return;
  }

  const sorted = [...leaderboard].sort((a, b) => {
    const rankA = a.rank ?? 9999;
    const rankB = b.rank ?? 9999;
    if (rankA !== rankB) {
      return rankA - rankB;
    }
    if (b.points !== a.points) {
      return b.points - a.points;
    }
    return a.name.localeCompare(b.name);
  });

  const standingsBtn = document.getElementById("viewStandingsBtn");

  container.innerHTML = sorted
    .map((entry, index) => {
      const displayRank = entry.rank ?? index + 1;
      const rankClass = displayRank <= 5 ? `rank-${displayRank}` : "rank-default";
      const rowClass = displayRank <= 5 ? `rank-${displayRank}` : "";
      const crown = displayRank === 1 ? CROWN_SVG : "";
      const trend = trendHtml(entry.movement);
      const rowFlag = lbRowFlagHtml(entry.champion);
      const championClass = rowFlag ? " lb-row--champion" : "";
      const enterClass = animate ? " lb-row--enter" : "";
      const stagger = animate ? ` style="--enter-i: ${index}"` : "";
      const championLabel = entry.champion
        ? `, champion ${entry.champion}`
        : "";
      const rowTitle = entry.champion
        ? `Champion pick: ${entry.champion}`
        : "";

      return `
    <div class="lb-row ${rowClass}${championClass}${enterClass}"${stagger} title="${escapeHtml(rowTitle)}" aria-label="${escapeHtml(`${entry.name}, ${entry.points.toFixed(0)} points${championLabel}`)}">
      ${rowFlag}
      <div class="lb-rank-cell">
        <span class="rank-badge ${rankClass}">${displayRank}</span>
      </div>
      <div class="lb-trend-cell">${trend}</div>
      <div class="lb-player">
        ${crown}
        <span class="lb-player-name">${escapeHtml(entry.name)}</span>
      </div>
      <div class="lb-pts">${entry.points.toFixed(0)}</div>
    </div>`;
    })
    .join("");

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
 * @param {boolean} showLive
 */
function singleHeroMatchHtml(match, showLive) {
  return `
    <div class="hero-match-slot">
      <div class="hero-grid">
        ${heroTeamBlock(match.home, "home")}
        ${heroCenterBlock("VS", match.id, true, showLive)}
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

  const next = nextUnplayedMatch(data);
  if (next) {
    el.innerHTML = `
      <div class="hero-body-inner">
        ${singleHeroMatchHtml(next, false)}
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
 * @param {boolean} [showLive]
 */
function heroCenterBlock(main, matchId, isVs, showLive = false) {
  const livePill = showLive
    ? '<div class="hero-live-pill"><span class="hero-live-dot" aria-hidden="true"></span>Live</div>'
    : "";
  return `
    <div class="hero-center">
      ${livePill}
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
