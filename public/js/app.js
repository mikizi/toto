/** World Cup 2026 scoreboard — reads data/latest.json */

const DATA_URL = "data/latest.json";

const CROWN_SVG = `<svg class="crown-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5 19h14v2H5v-2zm1.6-9.2L12 4l5.4 5.8L19 8l1 9H4l1.6-8.2z"/></svg>`;

/** @typedef {{ id: string, name: string, points: number, rank: number | null, champion: string | null, movement: string }} LeaderboardEntry */
/** @typedef {{ id: number, teams: string, home: string, away: string, homeScore: number | null, awayScore: number | null, played: boolean, kickoffAt: string | null }} MatchEntry */
/** @typedef {{ version: string, generatedAt: string, gamesPlayed: number, lastResult: object | null, leaderboard: LeaderboardEntry[], matches: MatchEntry[] }} TotoData */

/** @type {number | undefined} */
let countdownTimerId;

/** @returns {boolean} */
function isDebugMode() {
  const debug = new URLSearchParams(window.location.search).get("debug");
  return debug === "1" || debug === "true";
}

document.addEventListener("DOMContentLoaded", () => {
  const scoreboardApp = document.getElementById("scoreboardApp");
  const comingSoon = document.getElementById("comingSoon");
  const refreshBtn = document.getElementById("refreshBtn");
  const topBarLabel = document.getElementById("topBarLabel");
  const debug = isDebugMode();

  if (debug) {
    comingSoon?.classList.add("hidden");
    scoreboardApp?.classList.remove("hidden");
    refreshBtn?.classList.remove("hidden");
    if (topBarLabel) {
      topBarLabel.textContent = "Last updated";
    }
    refreshBtn?.addEventListener("click", () => loadData(true));
    loadData(false);
    return;
  }

  comingSoon?.classList.remove("hidden");
  scoreboardApp?.classList.add("hidden");
  refreshBtn?.classList.add("hidden");
  if (topBarLabel) {
    topBarLabel.textContent = "Next match";
  }
  loadData(false);
});

/** @param {TotoData} data @returns {MatchEntry | undefined} */
function nextUnplayedMatch(data) {
  return data.matches.find((m) => !m.played);
}

/**
 * @param {TotoData} data
 * @param {{ previewNext?: boolean }} [options]
 */
function renderHeroAndCountdown(data, options = {}) {
  const hero = document.getElementById("gameInfo");
  const countdown = document.getElementById("countdown");
  const topBarDatetime = document.getElementById("topBarDatetime");
  const next = nextUnplayedMatch(data);

  renderHeroMatch(hero, data, options.previewNext === true);
  startCountdown(countdown, next?.kickoffAt ?? null);

  if (topBarDatetime && !isDebugMode() && next?.kickoffAt) {
    topBarDatetime.textContent = formatKickoffLabel(next.kickoffAt);
  }
}

/**
 * @param {boolean} fromUserClick
 */
async function loadData(fromUserClick) {
  const table = document.getElementById("betsTable");
  const gamesBadge = document.getElementById("gamesBadge");
  const topBarDatetime = document.getElementById("topBarDatetime");
  const countdown = document.getElementById("countdown");
  const debug = isDebugMode();

  if (debug && gamesBadge) {
    gamesBadge.textContent = "Loading…";
  }
  if (countdown && !countdown.innerHTML) {
    countdown.innerHTML = '<p class="countdown-loading">Loading…</p>';
  }

  try {
    const response = await fetch(DATA_URL, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    /** @type {TotoData} */
    const data = await response.json();

    renderHeroAndCountdown(data, { previewNext: !debug });

    if (debug) {
      renderLeaderboard(table, data.leaderboard);
      if (topBarDatetime) {
        topBarDatetime.textContent = formatDateTime(data.generatedAt);
      }
      if (gamesBadge) {
        gamesBadge.innerHTML = gamesBadgeHtml(data.gamesPlayed, fromUserClick);
      }
    }

    document.querySelector(".app")?.classList.add("loaded");
  } catch (err) {
    console.error(err);
    const hero = document.getElementById("gameInfo");
    if (debug) {
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
      countdown.innerHTML = "";
    }
    document.querySelector(".app")?.classList.add("loaded");
  }
}

/**
 * @param {HTMLElement | null} el
 * @param {string | null} kickoffAt
 */
function startCountdown(el, kickoffAt) {
  if (countdownTimerId !== undefined) {
    window.clearInterval(countdownTimerId);
    countdownTimerId = undefined;
  }
  if (!el) {
    return;
  }
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
      el.innerHTML = `
        <div class="countdown-label">Kickoff</div>
        <div class="countdown-live">Underway!</div>`;
      if (countdownTimerId !== undefined) {
        window.clearInterval(countdownTimerId);
        countdownTimerId = undefined;
      }
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

      return `
    <div class="lb-row ${rowClass}">
      <div class="lb-rank-cell">
        <span class="rank-badge ${rankClass}">${displayRank}</span>
      </div>
      <div class="lb-trend-cell">${trend}</div>
      <div class="lb-player">
        ${crown}
        <span class="lb-player-name">${escapeHtml(entry.name)}</span>
      </div>
      <div class="lb-pts">${entry.points.toFixed(0)}</div>
      <div class="lb-champion-cell">${championCell(entry.champion)}</div>
    </div>`;
    })
    .join("");
}

/**
 * @param {HTMLElement | null} el
 * @param {TotoData} data
 * @param {boolean} [previewNext]
 */
function renderHeroMatch(el, data, previewNext = false) {
  if (!el) {
    return;
  }

  const last = data.lastResult;
  if (last && !previewNext) {
    el.innerHTML = `
      <div class="hero-body-inner">
        <div class="hero-grid">
          ${heroTeamBlock(last.home, "home")}
          ${heroCenterBlock(`${last.homeScore}&nbsp;—&nbsp;${last.awayScore}`, last.matchId, false)}
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
          ${heroCenterBlock("VS", next.id, true)}
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
  const date = d
    .toLocaleString("en-US", { month: "short", day: "numeric" })
    .toUpperCase();
  const time = d
    .toLocaleString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
    .toUpperCase();
  return `${date}, ${time}`;
}

/** @param {string} text */
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
