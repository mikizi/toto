/** World Cup 2026 team name → flag-icons ISO code */

/** @type {Readonly<Record<string, string>>} */
const TEAM_FLAGS = {
  Algeria: "dz",
  Argentina: "ar",
  Australia: "au",
  Austria: "at",
  Belgium: "be",
  "Bosnia and Herzegovina": "ba",
  Brazil: "br",
  Canada: "ca",
  "Cape Verde": "cv",
  Colombia: "co",
  Croatia: "hr",
  Curaçao: "cw",
  "Czech Republic": "cz",
  "DR Congo": "cd",
  Ecuador: "ec",
  Egypt: "eg",
  England: "gb-eng",
  France: "fr",
  Germany: "de",
  Ghana: "gh",
  Haiti: "ht",
  Iran: "ir",
  Iraq: "iq",
  "Ivory Coast": "ci",
  Japan: "jp",
  Jordan: "jo",
  "Korea Republic": "kr",
  Mexico: "mx",
  Morocco: "ma",
  Netherlands: "nl",
  "New Zealand": "nz",
  Norway: "no",
  Panama: "pa",
  Paraguay: "py",
  Portugal: "pt",
  Qatar: "qa",
  "Saudi Arabia": "sa",
  Scotland: "gb-sct",
  Senegal: "sn",
  "South Africa": "za",
  Spain: "es",
  Sweden: "se",
  Switzerland: "ch",
  Tunisia: "tn",
  Turkey: "tr",
  "United States": "us",
  Uruguay: "uy",
  Uzbekistan: "uz",
};

/** ASCII / alternate spellings from spreadsheets */
/** @type {Readonly<Record<string, string>>} */
const TEAM_ALIASES = {
  Curacao: "Curaçao",
};

/** Shorter labels for tight columns (Next Games, leaderboard champion) */
/** @type {Readonly<Record<string, string>>} */
const TEAM_DISPLAY_SHORT = {
  "Bosnia and Herzegovina": "Bosnia",
  "Czech Republic": "Czech Rep.",
  "DR Congo": "DR Congo",
  "Ivory Coast": "Ivory Coast",
  "Korea Republic": "Korea Rep.",
  "New Zealand": "N. Zealand",
  "Saudi Arabia": "Saudi",
  "South Africa": "S. Africa",
  "United States": "U.S.A.",
};

/** @param {string} teamName */
function shortTeamName(teamName) {
  return TEAM_DISPLAY_SHORT[teamName] ?? teamName;
}

/** @param {string} teamName */
function normalizeTeamName(teamName) {
  const trimmed = teamName.trim();
  if (TEAM_FLAGS[trimmed]) {
    return trimmed;
  }
  if (TEAM_ALIASES[trimmed]) {
    return TEAM_ALIASES[trimmed];
  }
  const aliasKey = Object.keys(TEAM_ALIASES).find(
    (key) => key.toLowerCase() === trimmed.toLowerCase()
  );
  if (aliasKey) {
    return TEAM_ALIASES[aliasKey];
  }
  const flagKey = Object.keys(TEAM_FLAGS).find(
    (key) => key.toLowerCase() === trimmed.toLowerCase()
  );
  return flagKey ?? trimmed;
}

/** @param {string} teamName */
function getFlagCode(teamName) {
  const normalized = normalizeTeamName(teamName);
  return TEAM_FLAGS[normalized] ?? "";
}

/**
 * Large flag image for row backgrounds (flagcdn.com — no API key).
 * @param {string} teamName
 * @param {number} [width]
 * @returns {string}
 */
function getFlagImageUrl(teamName, width = 640) {
  const code = getFlagCode(teamName);
  if (!code) {
    return "";
  }
  return `https://flagcdn.com/w${width}/${code}.png`;
}

/**
 * Faded champion flag behind a leaderboard row (flagcdn image).
 * @param {string | null | undefined} teamName
 * @returns {string}
 */
function lbRowFlagHtml(teamName) {
  const url = teamName ? getFlagImageUrl(teamName, 640) : "";
  if (!url) {
    return "";
  }
  return `<img class="lb-row-flag" src="${url}" alt="" decoding="async" loading="lazy" aria-hidden="true" /><span class="lb-row-flag-fade" aria-hidden="true"></span>`;
}

/**
 * @param {string} teamName
 * @param {"hero" | "sm"} [size]
 * @returns {string}
 */
function flagHtml(teamName, size = "sm") {
  const code = getFlagCode(teamName);
  if (!code) {
    return "";
  }
  const sizeClass = size === "hero" ? "team-flag--hero" : "team-flag--sm";
  return `<span class="fi fi-${code} fis team-flag ${sizeClass}" aria-hidden="true"></span>`;
}

/**
 * @param {string} teamName
 * @param {"home" | "away"} side
 * @returns {string}
 */
function heroTeamBlock(teamName, side) {
  const label = side === "home" ? "Home" : "Away";
  const flag = flagHtml(teamName, "hero");
  return `
    <div class="hero-team">
      <div class="hero-flag-frame">${flag}</div>
      <div class="hero-team-name">${escapeHtml(teamName.toUpperCase())}</div>
      <div class="hero-team-side">${label}</div>
    </div>`;
}

/** @param {string} text */
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
