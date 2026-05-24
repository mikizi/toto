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

/** @param {string | null | undefined} teamName @returns {string} */
function championCell(teamName) {
  if (!teamName) {
    return '<span class="lb-champion-empty">—</span>';
  }
  return `
    <span class="lb-champion">
      ${flagHtml(teamName, "sm")}
      <span class="lb-champion-name">${escapeHtml(teamName.toUpperCase())}</span>
    </span>`;
}

/** @param {string} text */
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
