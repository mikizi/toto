/** World Cup 2026 scoreboard — reads data/latest.json */

const DATA_URL = "data/latest.json";

const CROWN_SVG = `<svg class="crown-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5 19h14v2H5v-2zm1.6-9.2L12 4l5.4 5.8L19 8l1 9H4l1.6-8.2z"/></svg>`;

/** @typedef {{ id: string, name: string, points: number, rank: number | null, champion: string | null, movement: string }} LeaderboardEntry */
/** @typedef {{ id: number, teams: string, home: string, away: string, homeScore: number | null, awayScore: number | null, played: boolean, kickoffAt: string | null }} MatchEntry */
/** @typedef {{ version: string, generatedAt: string, gamesPlayed: number, lastResult: object | null, leaderboard: LeaderboardEntry[], matches: MatchEntry[] }} TotoData */

/** @type {number | undefined} */
let countdownTimerId;

/** @type {TotoData | null} */
let cachedData = null;

/** @returns {boolean} */
function isDebugMode() {
  const debug = new URLSearchParams(window.location.search).get("debug");
  return debug === "1" || debug === "true";
}

/** @param {TotoData} data @returns {boolean} */
function isMatchInProgress(data) {
  if (isDebugMode()) {
    return false;
  }
  const next = nextUnplayedMatch(data);
  if (!next?.kickoffAt) {
    return false;
  }
  return Date.parse(next.kickoffAt) <= Date.now();
}

/** @param {TotoData} data @returns {boolean} */
function shouldShowLiveBadge(data) {
  if (isDebugMode()) {
    return false;
  }
  return isScoreboardLive(data);
}

/** @param {TotoData} data */
function updateLiveIndicator(data) {
  const badge = document.getElementById("liveBadge");
  const statusDot = document.getElementById("statusDot");
  const card = document.querySelector(".scoreboard-card");
  const showLive = shouldShowLiveBadge(data);
  const inProgress = isMatchInProgress(data);

  badge?.classList.toggle("hidden", !showLive);
  card?.classList.toggle("is-live", showLive);
  statusDot?.classList.toggle("is-live", inProgress);
  statusDot?.classList.toggle("hidden", showLive);
}

/** @param {TotoData} data @returns {boolean} */
function isScoreboardLive(data) {
  if (isDebugMode()) {
    return true;
  }
  if (data.gamesPlayed > 0) {
    return true;
  }
  const next = nextUnplayedMatch(data);
  if (!next?.kickoffAt) {
    return false;
  }
  return Date.parse(next.kickoffAt) <= Date.now();
}

/** @param {TotoData} data */
function applyViewMode(data) {
  const scoreboardApp = document.getElementById("scoreboardApp");
  const comingSoon = document.getElementById("comingSoon");
  const refreshBtn = document.getElementById("refreshBtn");
  const topBarLabel = document.getElementById("topBarLabel");
  const live = isScoreboardLive(data);

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

function onKickoffReached() {
  if (!cachedData || isScoreboardLive(cachedData)) {
    return;
  }
  loadData(false);
}

document.addEventListener("DOMContentLoaded", () => {
  const refreshBtn = document.getElementById("refreshBtn");
  refreshBtn?.addEventListener("click", () => loadData(true));
  document.getElementById("viewFixturesBtn")?.addEventListener("click", toggleFixturesPanel);
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

/** @param {MatchEntry} match */
function nextGameItemHtml(match) {
  const kickoff = match.kickoffAt
    ? formatNextGameKickoff(match.kickoffAt)
    : `Match ${match.id} · TBD`;
  const home = shortTeamName(match.home);
  const away = shortTeamName(match.away);
  return `
    <div class="next-game-item">
      <div class="next-game-matchup">
        <div class="next-game-team next-game-team--home" title="${escapeHtml(match.home)}">
          ${flagHtml(match.home, "sm")}
          <span class="next-game-team-name">${escapeHtml(home)}</span>
        </div>
        <span class="next-game-vs-badge" aria-hidden="true">vs</span>
        <div class="next-game-team next-game-team--away" title="${escapeHtml(match.away)}">
          ${flagHtml(match.away, "sm")}
          <span class="next-game-team-name">${escapeHtml(away)}</span>
        </div>
      </div>
      <div class="next-game-meta">${escapeHtml(kickoff)}</div>
    </div>`;
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
 * @param {HTMLElement | null} listEl
 * @param {HTMLElement | null} fixturesEl
 * @param {TotoData} data
 */
function renderNextGames(listEl, fixturesEl, data) {
  const preview = upcomingMatches(data, 3);
  const all = allUpcomingMatches(data);

  if (listEl) {
    if (preview.length === 0) {
      listEl.innerHTML = '<p class="next-games-empty">No upcoming matches</p>';
    } else {
      listEl.innerHTML = preview.map((m) => nextGameItemHtml(m)).join("");
    }
  }

  if (fixturesEl) {
    if (all.length === 0) {
      fixturesEl.innerHTML = '<p class="next-games-empty">No fixtures left</p>';
    } else {
      fixturesEl.innerHTML = all.map((m) => nextGameItemHtml(m)).join("");
    }
  }
}

function toggleFixturesPanel() {
  const panel = document.getElementById("fixturesPanel");
  const btn = document.getElementById("viewFixturesBtn");
  if (!panel || !btn) {
    return;
  }
  const isOpen = panel.classList.toggle("hidden") === false;
  btn.setAttribute("aria-expanded", String(isOpen));
  btn.textContent = isOpen ? "Hide fixtures" : "View all fixtures";
}

/** @param {TotoData} data @returns {MatchEntry | undefined} */
function nextUnplayedMatch(data) {
  return data.matches.find((m) => !m.played);
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
 */
function renderHeroAndCountdown(data) {
  const hero = document.getElementById("gameInfo");
  const countdown = document.getElementById("countdown");
  const topBarDatetime = document.getElementById("topBarDatetime");
  const next = nextUnplayedMatch(data);
  const live = isScoreboardLive(data);

  renderHeroMatch(hero, data, !live, isMatchInProgress(data));
  updateLiveIndicator(data);

  if (live) {
    hideCountdown(countdown);
  } else {
    countdown?.classList.remove("hidden");
    startCountdown(countdown, next?.kickoffAt ?? null, onKickoffReached);
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
 * @param {boolean} fromUserClick
 */
async function loadData(fromUserClick) {
  const table = document.getElementById("betsTable");
  const gamesBadge = document.getElementById("gamesBadge");
  const countdown = document.getElementById("countdown");
  if (gamesBadge && cachedData && isScoreboardLive(cachedData)) {
    gamesBadge.textContent = "Loading…";
  }
  if (countdown && (!cachedData || !isScoreboardLive(cachedData))) {
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
    cachedData = data;

    applyViewMode(data);
    renderHeroAndCountdown(data);

    if (isScoreboardLive(data)) {
      renderLeaderboard(table, data.leaderboard);
      renderNextGames(
        document.getElementById("nextGamesList"),
        document.getElementById("fixturesPanel"),
        data
      );
      if (gamesBadge) {
        gamesBadge.innerHTML = gamesBadgeHtml(data.gamesPlayed, fromUserClick);
      }
    }

    document.querySelector(".app")?.classList.add("loaded");
  } catch (err) {
    console.error(err);
    const hero = document.getElementById("gameInfo");
    if (cachedData && isScoreboardLive(cachedData)) {
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
 */
function startCountdown(el, kickoffAt, onReached) {
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

  /** @param {number} value @param {string} label */
  function unit(value, label) {
    return `
      <div class="countdown-unit">
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

    el.innerHTML = `
      <div class="countdown-label">Kickoff in</div>
      <div class="countdown-units">
        ${unit(days, "Days")}
        ${unit(hours, "Hrs")}
        ${unit(minutes, "Min")}
        ${unit(seconds, "Sec")}
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

/** @param {LeaderboardEntry[]} leaderboard */
function renderLeaderboard(container, leaderboard) {
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

  container.innerHTML = sorted
    .map((entry, index) => {
      const displayRank = entry.rank ?? index + 1;
      const rankClass = displayRank <= 5 ? `rank-${displayRank}` : "rank-default";
      const rowClass = displayRank <= 5 ? `rank-${displayRank}` : "";
      const crown = displayRank === 1 ? CROWN_SVG : "";
      const trend = trendHtml(entry.movement);
      const rowFlag = lbRowFlagHtml(entry.champion);
      const championClass = rowFlag ? " lb-row--champion" : "";
      const championLabel = entry.champion
        ? `, champion ${entry.champion}`
        : "";
      const rowTitle = entry.champion
        ? `Champion pick: ${entry.champion}`
        : "";

      return `
    <div class="lb-row ${rowClass}${championClass}" title="${escapeHtml(rowTitle)}" aria-label="${escapeHtml(`${entry.name}, ${entry.points.toFixed(0)} points${championLabel}`)}">
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
}

/**
 * @param {HTMLElement | null} el
 * @param {TotoData} data
 * @param {boolean} [previewNext]
 * @param {boolean} [showLive]
 */
function renderHeroMatch(el, data, previewNext = false, showLive = false) {
  if (!el) {
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
    return;
  }

  const next = nextUnplayedMatch(data);
  if (next) {
    el.innerHTML = `
      <div class="hero-body-inner">
        <div class="hero-grid">
          ${heroTeamBlock(next.home, "home")}
          ${heroCenterBlock("VS", next.id, true, showLive)}
          ${heroTeamBlock(next.away, "away")}
        </div>
      </div>`;
    return;
  }

  el.innerHTML = '<div class="hero-empty">No upcoming matches</div>';
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
