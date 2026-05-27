/** Live match + scoreboard visibility (mirrors scripts/live_state.py). */

/** @typedef {{ mode: "auto" | "manual", openMatchIds: number[], suppressAuto: boolean }} BroadcastState */
/** @typedef {{ id: number, teams: string, home: string, away: string, homeScore: number | null, awayScore: number | null, played: boolean, kickoffAt: string | null }} MatchEntry */
/** @typedef {{ version: string, generatedAt: string, gamesPlayed: number, lastResult: object | null, leaderboard: object[], matches: MatchEntry[], broadcast?: BroadcastState }} TotoData */

const DEFAULT_BROADCAST = /** @type {BroadcastState} */ ({
  mode: "auto",
  openMatchIds: [],
  suppressAuto: false,
});

const MAX_HERO_MATCHES = 2;

/**
 * @param {unknown} raw
 * @returns {BroadcastState}
 */
function normalizeBroadcast(raw) {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_BROADCAST, openMatchIds: [] };
  }
  const obj = /** @type {Record<string, unknown>} */ (raw);
  const openMatchIds = [];
  if (Array.isArray(obj.openMatchIds)) {
    for (const value of obj.openMatchIds) {
      const id = Number(value);
      if (Number.isInteger(id) && id > 0) {
        openMatchIds.push(id);
      }
    }
  }
  const mode = obj.mode === "manual" ? "manual" : "auto";
  return {
    mode,
    openMatchIds: openMatchIds.slice(0, MAX_HERO_MATCHES),
    suppressAuto: Boolean(obj.suppressAuto),
  };
}

/**
 * @param {TotoData} data
 * @returns {Map<number, MatchEntry>}
 */
function matchesById(data) {
  const map = new Map();
  for (const match of data.matches || []) {
    map.set(match.id, match);
  }
  return map;
}

/**
 * @param {MatchEntry[]} matches
 * @param {number} matchId
 */
function previousMatchesAllPlayed(matches, matchId) {
  for (const match of matches) {
    if (match.id >= matchId) {
      continue;
    }
    if (!match.played) {
      return false;
    }
  }
  return true;
}

/**
 * @param {MatchEntry} match
 * @param {number} [nowMs]
 */
function kickoffReached(match, nowMs = Date.now()) {
  if (!match.kickoffAt) {
    return false;
  }
  const kickoffMs = Date.parse(match.kickoffAt);
  return !Number.isNaN(kickoffMs) && kickoffMs <= nowMs;
}

/**
 * @param {MatchEntry} match
 * @param {MatchEntry[]} matches
 * @param {number} [nowMs]
 */
function matchQualifiesForAutoLive(match, matches, nowMs = Date.now()) {
  if (match.played) {
    return false;
  }
  if (!kickoffReached(match, nowMs)) {
    return false;
  }
  return previousMatchesAllPlayed(matches, match.id);
}

/**
 * @param {TotoData} data
 * @param {number} [nowMs]
 * @returns {number[]}
 */
function autoLiveMatchIds(data, nowMs = Date.now()) {
  const broadcast = normalizeBroadcast(data.broadcast);
  if (broadcast.suppressAuto) {
    return [];
  }
  const ids = [];
  for (const match of data.matches || []) {
    if (!matchQualifiesForAutoLive(match, data.matches, nowMs)) {
      continue;
    }
    ids.push(match.id);
    if (ids.length >= MAX_HERO_MATCHES) {
      break;
    }
  }
  return ids;
}

/**
 * @param {TotoData} data
 * @returns {number[]}
 */
function manualLiveMatchIds(data) {
  const broadcast = normalizeBroadcast(data.broadcast);
  const byId = matchesById(data);
  const ids = [];
  for (const matchId of broadcast.openMatchIds) {
    if (!byId.has(matchId)) {
      continue;
    }
    ids.push(matchId);
    if (ids.length >= MAX_HERO_MATCHES) {
      break;
    }
  }
  return ids;
}

/**
 * @param {TotoData} data
 * @param {number} [nowMs]
 * @returns {number[]}
 */
function heroLiveMatchIds(data, nowMs = Date.now()) {
  const manual = manualLiveMatchIds(data);
  if (manual.length > 0) {
    return manual;
  }
  return autoLiveMatchIds(data, nowMs);
}

/**
 * @param {TotoData} data
 * @param {number} [nowMs]
 * @returns {MatchEntry[]}
 */
function heroLiveMatches(data, nowMs = Date.now()) {
  const byId = matchesById(data);
  return heroLiveMatchIds(data, nowMs)
    .map((id) => byId.get(id))
    .filter((match) => match !== undefined);
}

/**
 * @param {TotoData} data
 * @returns {MatchEntry | undefined}
 */
function nextUnplayedMatch(data) {
  return data.matches.find((m) => !m.played);
}

/**
 * @param {TotoData} data
 * @param {boolean} [debug]
 * @param {number} [nowMs]
 */
function isMatchInProgress(data, debug = false, nowMs = Date.now()) {
  if (debug) {
    return false;
  }
  return heroLiveMatchIds(data, nowMs).length > 0;
}

/**
 * @param {TotoData} data
 * @param {boolean} [debug]
 * @param {number} [nowMs]
 */
function isScoreboardLive(data, debug = false, nowMs = Date.now()) {
  if (debug) {
    return true;
  }
  if (data.gamesPlayed > 0) {
    return true;
  }

  const broadcast = normalizeBroadcast(data.broadcast);
  if (broadcast.openMatchIds.length > 0) {
    return true;
  }

  const matches = data.matches || [];
  const next = nextUnplayedMatch(data);
  if (!next) {
    return false;
  }
  if (!kickoffReached(next, nowMs)) {
    return false;
  }
  if (!previousMatchesAllPlayed(matches, next.id)) {
    return false;
  }
  if (broadcast.suppressAuto && data.gamesPlayed === 0) {
    return false;
  }
  return true;
}

/** @typedef {{ users: string[], count: number, entryFee: number, goalUsers: number, goalPrize: number, prizePool: number, closesAt: string | null }} RegistrationState */

const REGISTRATION_CLOSE_MS = 60 * 60 * 1000;

/**
 * @param {unknown} raw
 * @param {MatchEntry[]} [matches]
 * @returns {RegistrationState}
 */
function normalizeRegistration(raw, matches = []) {
  const defaults = {
    users: /** @type {string[]} */ ([]),
    count: 0,
    entryFee: 100,
    goalUsers: 100,
    goalPrize: 10000,
    prizePool: 0,
    closesAt: /** @type {string | null} */ (null),
  };
  if (!raw || typeof raw !== "object") {
    return { ...defaults, closesAt: registrationClosesAt(matches) };
  }
  const obj = /** @type {Record<string, unknown>} */ (raw);
  const users = Array.isArray(obj.users)
    ? obj.users.map((name) => String(name).trim()).filter(Boolean)
    : [];
  const entryFee = Number(obj.entryFee) > 0 ? Number(obj.entryFee) : 100;
  const goalUsers = Number(obj.goalUsers) > 0 ? Number(obj.goalUsers) : 100;
  const goalPrize = Number(obj.goalPrize) > 0 ? Number(obj.goalPrize) : 10000;
  const closesAt =
    typeof obj.closesAt === "string" && obj.closesAt
      ? obj.closesAt
      : registrationClosesAt(matches);
  return {
    users,
    count: users.length,
    entryFee,
    goalUsers,
    goalPrize,
    prizePool: users.length * entryFee,
    closesAt,
  };
}

/**
 * @param {MatchEntry[]} matches
 * @returns {string | null}
 */
function registrationClosesAt(matches) {
  let earliest = Number.POSITIVE_INFINITY;
  for (const match of matches) {
    if (!match.kickoffAt) {
      continue;
    }
    const ms = Date.parse(match.kickoffAt);
    if (!Number.isNaN(ms) && ms < earliest) {
      earliest = ms;
    }
  }
  if (!Number.isFinite(earliest)) {
    return null;
  }
  return new Date(earliest - REGISTRATION_CLOSE_MS).toISOString();
}

/**
 * @param {RegistrationState} registration
 * @param {number} [nowMs]
 */
function isRegistrationOpen(registration, nowMs = Date.now()) {
  if (!registration.closesAt) {
    return true;
  }
  const closesMs = Date.parse(registration.closesAt);
  return !Number.isNaN(closesMs) && nowMs < closesMs;
}

/** @param {number} amount */
function formatMoney(amount) {
  return `${amount.toLocaleString("en-IL")}₪`;
}

/** @param {number} amount */
function formatMoneyCompact(amount) {
  if (amount >= 1000 && amount % 1000 === 0) {
    return `${amount / 1000}k₪`;
  }
  return formatMoney(amount);
}
