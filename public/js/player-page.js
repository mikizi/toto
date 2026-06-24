const PLAYER_DATA_URL = "data/latest.json";

/** @param {string} text */
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/** @returns {{ id: string, name: string }} */
function playerParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    id: params.get("id") || "",
    name: params.get("name") || "",
  };
}

/** @param {Array<{ id: string, name: string }>} players */
function findPlayer(players) {
  const params = playerParams();
  if (params.id) {
    const byId = players.find((player) => String(player.id) === params.id);
    if (byId) {
      return byId;
    }
  }
  if (params.name) {
    return players.find((player) => player.name === params.name) || null;
  }
  return null;
}

/** @param {number | null | undefined} home @param {number | null | undefined} away */
function scoreText(home, away) {
  if (home === null || home === undefined || away === null || away === undefined) {
    return "-";
  }
  return `${home} - ${away}`;
}

/** @param {number | null | undefined} points */
function pointsClass(points) {
  if (points === null || points === undefined) {
    return "player-points--pending";
  }
  if (points >= 5) {
    return "player-points--full";
  }
  if (points > 0) {
    return "player-points--some";
  }
  return "player-points--zero";
}

function rowResultClass(played, points) {
  if (!played || points === null || points === undefined) {
    return "player-bet-row--pending";
  }
  if (Number(points) >= 5) {
    return "player-bet-row--full";
  }
  if (Number(points) > 0) {
    return "player-bet-row--some";
  }
  return "player-bet-row--zero";
}

/** @param {string | null | undefined} iso */
function matchDate(iso) {
  if (!iso) {
    return "TBD";
  }
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** @param {unknown} value */
function formatPoints(value) {
  if (value === null || value === undefined) {
    return "-";
  }
  const num = Number(value);
  return Number.isInteger(num) ? String(num) : num.toFixed(1);
}

/**
 * @param {string} eventName
 * @param {Record<string, unknown>} [properties]
 */
function trackAnalytics(eventName, properties = {}) {
  window.totoAnalytics?.track(eventName, properties);
}

/** @param {any} player @param {any[]} leaderboard */
function playerRankText(player, leaderboard) {
  const index = leaderboard.findIndex((entry) => (
    String(entry.id) === String(player.id) ||
    (entry.name && player.name && entry.name === player.name)
  ));
  if (index >= 0) {
    const entry = leaderboard[index];
    const label = String(entry.rankLabel || "").trim();
    if (label && label !== "-") {
      return label;
    }
    if (label === "-") {
      for (let i = index - 1; i >= 0; i -= 1) {
        const previousLabel = String(leaderboard[i].rankLabel || "").trim();
        if (previousLabel && previousLabel !== "-") {
          return previousLabel;
        }
      }
    }
    if (entry.rank) {
      return String(entry.rank);
    }
    return String(index + 1);
  }
  return player.rank ? String(player.rank) : "-";
}

/** @param {any[]} matches @param {number | null} focusMatchId */
function focusOrderedMatches(matches, focusMatchId) {
  const sortedMatches = typeof chronologicalMatches === "function"
    ? chronologicalMatches(matches)
    : [...matches].sort((a, b) => Number(a.id) - Number(b.id));
  return sortedMatches;
}

/** @param {any} data */
function focusedMatchId(data) {
  const liveIds = typeof heroLiveMatchIds === "function" ? heroLiveMatchIds(data) : [];
  if (liveIds.length > 0) {
    return Number(liveIds[0]);
  }
  const next = typeof nextUnplayedMatch === "function"
    ? nextUnplayedMatch(data)
    : focusOrderedMatches(data.matches || [], null).find((match) => !match.played);
  if (next) {
    return Number(next.id);
  }
  const sortedMatches = focusOrderedMatches(data.matches || [], null);
  const latest = sortedMatches[sortedMatches.length - 1];
  return latest ? Number(latest.id) : null;
}

/** @param {number | null} focusMatchId */
function positionFocusedBet(focusMatchId) {
  if (!focusMatchId) {
    return;
  }
  const row = document.querySelector(".player-bet-row--focus");
  if (!(row instanceof HTMLElement)) {
    return;
  }
  const top = row.getBoundingClientRect().top + window.scrollY - 12;
  window.scrollTo(0, Math.max(0, top));
}

function syncBackToTopButton() {
  const button = document.getElementById("playerBackToTop");
  if (!button) {
    return;
  }
  button.classList.toggle("is-visible", window.scrollY > 420);
}

function initBackToTopButton() {
  const button = document.getElementById("playerBackToTop");
  if (!button) {
    return;
  }
  button.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  window.addEventListener("scroll", syncBackToTopButton, { passive: true });
  syncBackToTopButton();
}

/** @param {any} player @param {any[]} matches @param {number | null} focusMatchId */
function renderBets(player, matches, focusMatchId) {
  const list = document.getElementById("playerBetsList");
  if (!list) {
    return;
  }
  const picks = new Map((player.picks || []).map((pick) => [Number(pick.matchId), pick]));
  const sortedMatches = focusOrderedMatches(matches, focusMatchId);
  list.innerHTML = sortedMatches
    .map((match) => {
      const pick = picks.get(Number(match.id)) || {};
      const points = pick.points;
      const playedClass = match.played ? " player-bet-row--played" : "";
      const focusClass = Number(match.id) === focusMatchId ? " player-bet-row--focus" : "";
      const resultClass = rowResultClass(Boolean(match.played), points);
      const pointClass = pointsClass(points);
      return `
        <div class="player-bet-row${playedClass}${focusClass} ${resultClass}">
          <div class="player-bet-match">
            <div class="player-bet-meta">
              <span class="player-bet-match-num">Match ${match.id}</span>
              <span class="player-bet-date">${escapeHtml(matchDate(match.kickoffAt))}</span>
            </div>
            <div class="player-bet-teams">
              <span class="player-bet-team player-bet-team--home">
                ${flagHtml(match.home, "sm")}
                <span class="player-bet-team-name">${escapeHtml(shortTeamName(match.home))}</span>
              </span>
              <span class="player-bet-mobile-summary" aria-hidden="true">
                <span class="player-bet-mobile-group">Match ${match.id}</span>
                <span class="player-bet-mobile-scoreline">
                  <span class="player-bet-mobile-pick">(${escapeHtml(formatPoints(pick.awayPick))})</span>
                  <span class="player-bet-mobile-score">${escapeHtml(formatPoints(match.awayScore))}</span>
                  <span class="player-bet-mobile-points ${pointClass}">${escapeHtml(formatPoints(points))}</span>
                  <span class="player-bet-mobile-score">${escapeHtml(formatPoints(match.homeScore))}</span>
                  <span class="player-bet-mobile-pick">(${escapeHtml(formatPoints(pick.homePick))})</span>
                </span>
                <span class="player-bet-mobile-label">Pts</span>
              </span>
              <span class="player-bet-vs">vs</span>
              <span class="player-bet-team player-bet-team--away">
                ${flagHtml(match.away, "sm")}
                <span class="player-bet-team-name">${escapeHtml(shortTeamName(match.away))}</span>
              </span>
            </div>
          </div>
          <div class="player-bet-score player-bet-score--pick">
            <span class="player-bet-score-label">Pick</span>
            <span class="player-bet-score-value">${escapeHtml(scoreText(pick.homePick, pick.awayPick))}</span>
          </div>
          <div class="player-bet-score player-bet-score--result">
            <span class="player-bet-score-label">Result</span>
            <span class="player-bet-score-value">${escapeHtml(scoreText(match.homeScore, match.awayScore))}</span>
          </div>
          <div class="player-bet-points ${pointClass}">
            <span class="player-bet-score-label">Pts</span>
            <span class="player-bet-score-value">${escapeHtml(formatPoints(points))}</span>
          </div>
        </div>`;
    })
    .join("");
  positionFocusedBet(focusMatchId);
}

/** @param {any} player @param {any} data */
function renderPlayer(player, data) {
  document.title = `${player.name} · Player Bets`;
  const name = document.getElementById("playerName");
  const summary = document.getElementById("playerSummary");
  const rank = document.getElementById("playerRank");
  const points = document.getElementById("playerPoints");
  const champion = document.getElementById("playerChampion");

  if (name) {
    name.textContent = player.name;
  }
  if (summary) {
    summary.textContent = `${data.gamesPlayed} games played`;
  }
  if (rank) {
    rank.textContent = playerRankText(player, data.leaderboard || []);
  }
  if (points) {
    points.textContent = formatPoints(player.points);
  }
  if (champion) {
    champion.innerHTML = `${flagHtml(player.champion || "", "sm")} <span>${escapeHtml(player.champion || "-")}</span>`;
  }
  renderBets(player, data.matches || [], focusedMatchId(data));
}

async function loadPlayerPage() {
  try {
    const response = await fetch(PLAYER_DATA_URL, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    const player = findPlayer(data.leaderboard || []);
    if (!player) {
      document.getElementById("playerName").textContent = "Player not found";
      trackAnalytics("player_profile_missing", {
        lookup_method: playerParams().id ? "id" : "name",
      });
      return;
    }
    renderPlayer(player, data);
    window.totoAnalytics?.trackPage("player_profile", {
      player_id: String(player.id || ""),
      player_name: String(player.name || ""),
      rank: Number(playerRankText(player, data.leaderboard || [])),
      points: Number(player.points),
      champion_pick: player.champion || "",
      picks_count: Array.isArray(player.picks) ? player.picks.length : 0,
      games_played: data.gamesPlayed,
      matches_count: Array.isArray(data.matches) ? data.matches.length : 0,
      lookup_method: playerParams().id ? "id" : "name",
    });
  } catch (err) {
    console.error(err);
    document.getElementById("playerName").textContent = "Could not load player";
    trackAnalytics("player_profile_load_failed", {
      error_message: err instanceof Error ? err.message : "unknown",
    });
  }
}

document.addEventListener("DOMContentLoaded", () => {
  initBackToTopButton();
  void loadPlayerPage();
});
