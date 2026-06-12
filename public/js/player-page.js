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
      const pointClass = pointsClass(points);
      return `
        <div class="player-bet-row${playedClass}">
          <div class="player-bet-match">
            <span class="player-bet-match-num">Match ${match.id}</span>
            <span class="player-bet-teams">
              ${flagHtml(match.home, "sm")} ${escapeHtml(shortTeamName(match.home))}
              <span class="player-bet-vs">vs</span>
              ${flagHtml(match.away, "sm")} ${escapeHtml(shortTeamName(match.away))}
            </span>
            <span class="player-bet-date">${escapeHtml(matchDate(match.kickoffAt))}</span>
          </div>
          <div class="player-bet-score">${escapeHtml(scoreText(pick.homePick, pick.awayPick))}</div>
          <div class="player-bet-score">${escapeHtml(scoreText(match.homeScore, match.awayScore))}</div>
          <div class="player-bet-points ${pointClass}">${escapeHtml(formatPoints(points))}</div>
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
    rank.textContent = player.rankLabel || String(player.rank || "-");
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
