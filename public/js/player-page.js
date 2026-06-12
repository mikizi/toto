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

/** @param {any} player @param {any[]} leaderboard */
function playerRankText(player, leaderboard) {
  const index = leaderboard.findIndex((entry) => (
    String(entry.id) === String(player.id) ||
    (entry.name && player.name && entry.name === player.name)
  ));
  if (index >= 0) {
    return String(index + 1);
  }
  return player.rank ? String(player.rank) : "-";
}

/** @param {any} player @param {any[]} matches */
function renderBets(player, matches) {
  const list = document.getElementById("playerBetsList");
  if (!list) {
    return;
  }
  const picks = new Map((player.picks || []).map((pick) => [Number(pick.matchId), pick]));
  list.innerHTML = matches
    .map((match) => {
      const pick = picks.get(Number(match.id)) || {};
      const points = pick.points;
      const playedClass = match.played ? " player-bet-row--played" : "";
      const resultClass = rowResultClass(Boolean(match.played), points);
      const pointClass = pointsClass(points);
      return `
        <div class="player-bet-row${playedClass} ${resultClass}">
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
  renderBets(player, data.matches || []);
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
      return;
    }
    renderPlayer(player, data);
  } catch (err) {
    console.error(err);
    document.getElementById("playerName").textContent = "Could not load player";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  void loadPlayerPage();
});
