const PLAYER_DATA_URL = "data/latest.json";
const KNOCKOUT_QUALIFIER_ROUND_BY_FIXTURE_ROUND = {
  r32_match: "r16",
  r16_match: "quarter",
  quarter_match: "semi",
  semi_match: "final",
  final_match: "champion",
};

/** @type {number | undefined} */
let playerKnockoutTrackTimerId;

/** @type {number | null} */
let activePlayerKnockoutIndex = null;

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

/** @param {string} text */
function escapeAttribute(text) {
  return escapeHtml(String(text)).replace(/"/g, "&quot;");
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

/** @param {number | null | undefined} home @param {number | null | undefined} away */
function scoreDirectionValue(home, away) {
  const homeScore = Number(home);
  const awayScore = Number(away);
  if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) {
    return "";
  }
  if (homeScore > awayScore) {
    return "home";
  }
  if (homeScore < awayScore) {
    return "away";
  }
  return "draw";
}

/** @param {unknown} value */
function hasScoredPickValue(value) {
  return value !== null && value !== undefined && value !== "";
}

/** @param {any} player @param {any[]} matches */
function playerGroupPickStats(player, matches) {
  const picks = new Map((player.picks || []).map((pick) => [Number(pick.matchId), pick]));
  return (matches || []).reduce((stats, match) => {
    if (!match?.played) {
      return stats;
    }
    const pick = picks.get(Number(match.id));
    if (!pick || !hasScoredPickValue(pick.points)) {
      return stats;
    }
    const pickHome = Number(pick.homePick);
    const pickAway = Number(pick.awayPick);
    const resultHome = Number(match.homeScore);
    const resultAway = Number(match.awayScore);
    if (!Number.isFinite(pickHome) || !Number.isFinite(pickAway) || !Number.isFinite(resultHome) || !Number.isFinite(resultAway)) {
      return stats;
    }
    const exact = pickHome === resultHome && pickAway === resultAway;
    const correct = scoreDirectionValue(pickHome, pickAway) === scoreDirectionValue(resultHome, resultAway);
    return {
      played: stats.played + 1,
      exact: stats.exact + (exact ? 1 : 0),
      correct: stats.correct + (correct ? 1 : 0),
    };
  }, { played: 0, exact: 0, correct: 0 });
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
  const matches = Array.isArray(data.matches) ? data.matches : [];
  const groupMatchIds = new Set(matches.map((match) => Number(match.id)));
  const liveIds = typeof heroLiveMatchIds === "function" ? heroLiveMatchIds(data) : [];
  const liveGroupMatchId = liveIds.find((id) => groupMatchIds.has(Number(id)));
  if (liveGroupMatchId) {
    return Number(liveGroupMatchId);
  }
  if (matches.length > 0 && matches.every((match) => match.played)) {
    return null;
  }
  const next = typeof nextUnplayedMatch === "function"
    ? nextUnplayedMatch(data)
    : focusOrderedMatches(matches, null).find((match) => !match.played);
  if (next && groupMatchIds.has(Number(next.id))) {
    return Number(next.id);
  }
  return null;
}

/** @param {number | null} focusMatchId */
function positionFocusedBet(focusMatchId) {
  if (!focusMatchId) {
    window.scrollTo(0, 0);
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

/** @param {any} match */
function liveKnockoutWinner(match) {
  if (!match?.isLive || !match.home || !match.away) {
    return "";
  }
  const home = Number(match.homeScore);
  const away = Number(match.awayScore);
  if (!Number.isFinite(home) || !Number.isFinite(away) || home === away) {
    return "";
  }
  return home > away ? match.home : match.away;
}

/** @param {any} data */
function knockoutResultSets(data) {
  const actual = data.knockout?.actual || {};
  /** @type {Map<string, Set<string>>} */
  const resultSets = new Map();
  if (Array.isArray(data.knockout?.rounds)) {
    for (const round of data.knockout.rounds) {
      const teams = Array.isArray(actual[round.id]) ? actual[round.id].filter(Boolean) : [];
      resultSets.set(round.id, new Set(teams));
    }
  }
  if (Array.isArray(data.knockout?.matches)) {
    for (const match of data.knockout.matches) {
      const winner = liveKnockoutWinner(match);
      const qualifierRoundId = KNOCKOUT_QUALIFIER_ROUND_BY_FIXTURE_ROUND[match.roundId] || match.roundId;
      if (!winner || !qualifierRoundId) {
        continue;
      }
      if (!resultSets.has(qualifierRoundId)) {
        resultSets.set(qualifierRoundId, new Set());
      }
      resultSets.get(qualifierRoundId)?.add(winner);
    }
  }
  return resultSets;
}

/** @param {any} data */
function knockoutVisualResultSets(data) {
  const resultSets = knockoutResultSets(data);
  const r32Set = resultSets.get("r32") || new Set();
  if (Array.isArray(data.knockout?.matches)) {
    for (const match of data.knockout.matches) {
      if (match.roundId !== "r32_match") {
        continue;
      }
      if (isConcreteKnockoutTeam(match.home)) {
        r32Set.add(match.home);
      }
      if (isConcreteKnockoutTeam(match.away)) {
        r32Set.add(match.away);
      }
    }
  }
  if (r32Set.size > 0) {
    resultSets.set("r32", r32Set);
  }
  return resultSets;
}

/** @param {any} data */
function knockoutEliminatedSets(data) {
  const eliminated = data.knockout?.eliminated || {};
  /** @type {Map<string, Set<string>>} */
  const resultSets = new Map();
  if (Array.isArray(data.knockout?.rounds)) {
    for (const round of data.knockout.rounds) {
      const teams = Array.isArray(eliminated[round.id]) ? eliminated[round.id].filter(Boolean) : [];
      resultSets.set(round.id, new Set(teams));
    }
  }
  return resultSets;
}

/** @param {unknown} team */
function isConcreteKnockoutTeam(team) {
  const value = String(team || "").trim();
  if (!value || value === "TBD") {
    return false;
  }
  return !/^(winner|runner-up|best 3rd|round of \d+|match \d+)/i.test(value);
}

/** @param {any} roundPick @param {Set<string> | undefined} resultSet */
function playerKnockoutRoundPoints(roundPick, resultSet) {
  const durable = Number(roundPick.points || 0);
  if (!resultSet || resultSet.size === 0) {
    return durable;
  }
  const pointValue = Number(roundPick.pointsPerTeam || 0);
  const liveOrActual = (roundPick.teams || []).reduce((sum, item) => (
    resultSet.has(item.team) ? sum + pointValue : sum
  ), 0);
  return Math.max(durable, liveOrActual);
}

/**
 * @param {any} item
 * @param {Set<string> | undefined} visualSet
 * @param {Set<string> | undefined} eliminatedSet
 * @param {number} expected
 * @returns {"correct" | "missed" | "pending"}
 */
function playerKnockoutTeamStatus(item, visualSet, eliminatedSet, expected) {
  const team = String(item.team || "");
  if (item.isCorrect || item.isLiveCorrect || visualSet?.has(team)) {
    return "correct";
  }
  const hasFinishedRound = Boolean(visualSet && expected > 0 && visualSet.size >= expected);
  if (item.isEliminated || item.isMissed || eliminatedSet?.has(team) || hasFinishedRound) {
    return "missed";
  }
  return "pending";
}

/**
 * @param {any[]} teams
 * @param {Set<string> | undefined} visualSet
 * @param {Set<string> | undefined} eliminatedSet
 * @param {number} expected
 */
function playerKnockoutStatusCounts(teams, visualSet, eliminatedSet, expected) {
  return teams.reduce((counts, item) => {
    const status = playerKnockoutTeamStatus(item, visualSet, eliminatedSet, expected);
    counts[status] += 1;
    return counts;
  }, { correct: 0, missed: 0, pending: 0 });
}

/**
 * @param {any[]} picks
 * @param {Map<string, Set<string>>} visualResultSets
 * @param {Map<string, Set<string>>} eliminatedSets
 * @param {Map<string, any>} roundDefinitions
 */
function playerKnockoutCorrectSummary(picks, visualResultSets, eliminatedSets, roundDefinitions) {
  return (picks || []).reduce((summary, roundPick) => {
    const roundId = String(roundPick.roundId || "");
    const teams = Array.isArray(roundPick.teams) ? roundPick.teams : [];
    const expected = Number(roundDefinitions.get(roundId)?.expected || teams.length || 0);
    const visualSet = visualResultSets.get(roundId);
    const eliminatedSet = eliminatedSets.get(roundId);
    for (const item of teams) {
      const status = playerKnockoutTeamStatus(item, visualSet, eliminatedSet, expected);
      if (status === "pending") {
        continue;
      }
      summary.decided += 1;
      if (status === "correct") {
        summary.correct += 1;
      }
    }
    return summary;
  }, { correct: 0, decided: 0 });
}

/** @param {string} roundId */
function playerKnockoutRoundBadge(roundId) {
  const labels = {
    r32: "32",
    r16: "16",
    quarter: "QF",
    semi: "SM",
    final: "F",
  };
  return labels[roundId] || "";
}

/**
 * @param {any} roundPick
 * @param {Set<string> | undefined} scoringSet
 * @param {Set<string> | undefined} visualSet
 * @param {Set<string> | undefined} eliminatedSet
 * @param {{ expected?: number } | undefined} roundDefinition
 * @param {{ pick?: any, visualSet?: Set<string>, eliminatedSet?: Set<string>, definition?: { expected?: number } } | undefined} championContext
 */
function playerKnockoutRoundHtml(roundPick, scoringSet, visualSet, eliminatedSet, roundDefinition, championContext) {
  const points = playerKnockoutRoundPoints(roundPick, scoringSet);
  const teams = Array.isArray(roundPick.teams) ? roundPick.teams : [];
  const roundId = String(roundPick.roundId || "");
  const roundBadge = playerKnockoutRoundBadge(roundId);
  const pointValue = Number(roundPick.pointsPerTeam || 0);
  const championPick = championContext?.pick;
  const championItem = championPick?.teams?.[0];
  const championTeam = String(championItem?.team || "");
  const championStatus = championTeam
    ? playerKnockoutTeamStatus(
      championItem,
      championContext?.visualSet,
      championContext?.eliminatedSet,
      Number(championContext?.definition?.expected || 1)
    )
    : "";
  const expected = Number(roundDefinition?.expected || teams.length || 0);
  const maxPoints = pointValue * teams.length;
  const counts = playerKnockoutStatusCounts(teams, visualSet, eliminatedSet, expected);
  const sizeClass = roundId === "final"
      ? " player-knockout-round--final"
      : roundId === "semi"
        ? " player-knockout-round--semi"
        : roundId === "quarter"
          ? " player-knockout-round--quarter"
          : "";
  return `
    <details class="player-knockout-round${sizeClass}" data-knockout-round-id="${escapeAttribute(roundId)}" data-knockout-round-label="${escapeAttribute(roundPick.label || "")}" open>
      <summary class="player-knockout-round-head">
        <span class="player-knockout-round-icon" aria-hidden="true">${escapeHtml(roundBadge)}</span>
        <span class="player-knockout-title-block">
          <span class="player-knockout-kicker">${escapeHtml(formatPoints(pointValue))} pts per correct qualifier</span>
          <span class="player-knockout-title">${escapeHtml(roundPick.label || "Knockout")}</span>
        </span>
        <span class="player-knockout-summary">
          <span class="player-knockout-points">
            <strong>${escapeHtml(formatPoints(points))}</strong>
            <span>/ ${escapeHtml(formatPoints(maxPoints))} pts</span>
          </span>
          <span class="player-knockout-counts" aria-label="${counts.correct} correct, ${counts.missed} missed, ${counts.pending} pending">
            <span class="player-knockout-count player-knockout-count--correct">${counts.correct} Correct</span>
            <span class="player-knockout-count player-knockout-count--missed">${counts.missed} Missed</span>
            <span class="player-knockout-count player-knockout-count--pending">${counts.pending} Pending</span>
          </span>
        </span>
        <span class="player-knockout-toggle" aria-hidden="true"></span>
      </summary>
      <div class="player-knockout-legend" aria-label="Knockout prediction status legend">
        <span class="player-knockout-legend-item player-knockout-legend-item--pending">
          <span><strong>Pending</strong><small>Not decided yet</small></span>
        </span>
        <span class="player-knockout-legend-item player-knockout-legend-item--correct">
          <span><strong>Qualified</strong><small>Your prediction was correct</small></span>
        </span>
        <span class="player-knockout-legend-item player-knockout-legend-item--missed">
          <span><strong>Eliminated</strong><small>Your prediction was wrong</small></span>
        </span>
      </div>
      <div class="player-knockout-teams${teams.length ? "" : " is-empty"}">
        ${teams.length ? teams.map((item) => {
          const status = playerKnockoutTeamStatus(item, visualSet, eliminatedSet, expected);
          const stateClass = ` is-${status}`;
          return `<span class="player-knockout-team${stateClass}">
            ${flagHtml(item.team || "", "sm")}
            <span class="player-knockout-team-name">${escapeHtml(shortTeamName(item.team || ""))}</span>
          </span>`;
        }).join("") : "<p>No picks in this round.</p>"}
      </div>
      ${championTeam ? `
        <div class="player-knockout-winner-pick" aria-label="Winner pick">
          <span class="player-knockout-winner-label">Winner pick</span>
          <span class="player-knockout-team player-knockout-team--winner is-${championStatus || "pending"}">
            ${flagHtml(championTeam, "sm")}
            <span class="player-knockout-team-name">${escapeHtml(shortTeamName(championTeam))}</span>
          </span>
        </div>` : ""}
    </details>`;
}

/** @param {any} player @param {any} data */
function renderPlayerKnockout(player, data) {
  const wrap = document.getElementById("playerKnockoutCarousel");
  const total = document.getElementById("playerKnockoutTotal");
  if (!wrap) {
    return;
  }
  const picks = Array.isArray(player.knockoutPicks) ? player.knockoutPicks : [];
  const scoringResultSets = knockoutResultSets(data);
  const visualResultSets = knockoutVisualResultSets(data);
  const eliminatedSets = knockoutEliminatedSets(data);
  const roundDefinitions = new Map(
    (Array.isArray(data.knockout?.rounds) ? data.knockout.rounds : []).map((round) => [round.id, round])
  );
  const points = picks.reduce((sum, roundPick) => (
    sum + playerKnockoutRoundPoints(roundPick, scoringResultSets.get(roundPick.roundId))
  ), 0);
  const championPick = picks.find((roundPick) => roundPick.roundId === "champion");
  const visiblePicks = picks.filter((roundPick) => roundPick.roundId !== "champion");
  if (total) {
    total.textContent = `${formatPoints(points)} pts`;
  }
  if (!visiblePicks.length) {
    wrap.innerHTML = '<p class="player-knockout-empty">No knockout picks loaded yet.</p>';
    return;
  }
  wrap.innerHTML = visiblePicks
    .map((roundPick) => playerKnockoutRoundHtml(
      roundPick,
      scoringResultSets.get(roundPick.roundId),
      visualResultSets.get(roundPick.roundId),
      eliminatedSets.get(roundPick.roundId),
      roundDefinitions.get(roundPick.roundId),
      roundPick.roundId === "final"
        ? {
          pick: championPick,
          visualSet: visualResultSets.get("champion"),
          eliminatedSet: eliminatedSets.get("champion"),
          definition: roundDefinitions.get("champion"),
        }
        : undefined
    ))
    .join("");
}

function trackPlayerKnockoutRound() {
  const wrap = document.getElementById("playerKnockoutCarousel");
  if (!(wrap instanceof HTMLElement) || wrap.clientWidth <= 0) {
    return;
  }
  const index = Math.round(wrap.scrollLeft / wrap.clientWidth);
  if (index === activePlayerKnockoutIndex) {
    return;
  }
  activePlayerKnockoutIndex = index;
  const round = wrap.querySelectorAll(".player-knockout-round")[index];
  trackAnalytics("knockout_round_changed", {
    round_id: round instanceof HTMLElement ? round.dataset.knockoutRoundId || "" : "",
    round_label: round instanceof HTMLElement ? round.dataset.knockoutRoundLabel || "" : "",
    round_index: index,
    source: "player_page",
  });
}

function handlePlayerKnockoutScroll() {
  if (playerKnockoutTrackTimerId !== undefined) {
    window.clearTimeout(playerKnockoutTrackTimerId);
  }
  playerKnockoutTrackTimerId = window.setTimeout(trackPlayerKnockoutRound, 140);
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
  const exact = document.getElementById("playerExact");
  const correct = document.getElementById("playerCorrect");
  const champion = document.getElementById("playerChampion");
  const knockoutCorrect = document.getElementById("playerKnockoutCorrect");
  const picks = Array.isArray(player.knockoutPicks) ? player.knockoutPicks : [];
  const groupStats = playerGroupPickStats(player, data.matches || []);
  const visualResultSets = knockoutVisualResultSets(data);
  const eliminatedSets = knockoutEliminatedSets(data);
  const roundDefinitions = new Map(
    (Array.isArray(data.knockout?.rounds) ? data.knockout.rounds : []).map((round) => [round.id, round])
  );
  const knockoutSummary = playerKnockoutCorrectSummary(picks, visualResultSets, eliminatedSets, roundDefinitions);

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
  if (exact) {
    exact.textContent = formatPoints(groupStats.exact);
  }
  if (correct) {
    const accuracy = groupStats.played ? Math.round((groupStats.correct / groupStats.played) * 100) : 0;
    correct.innerHTML = `${escapeHtml(`${groupStats.correct}/${groupStats.played}`)} <span class="player-stat-subvalue">${accuracy}%</span>`;
  }
  if (champion) {
    champion.innerHTML = `${flagHtml(player.champion || "", "sm")} <span>${escapeHtml(player.champion || "-")}</span>`;
  }
  if (knockoutCorrect) {
    knockoutCorrect.textContent = `${knockoutSummary.correct}/${knockoutSummary.decided}`;
  }
  renderPlayerKnockout(player, data);
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
  document.getElementById("playerKnockoutCarousel")?.addEventListener("scroll", handlePlayerKnockoutScroll);
  void loadPlayerPage();
});
