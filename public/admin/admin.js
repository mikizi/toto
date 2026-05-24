/** Admin — publish results locally (dev) or via GitHub Actions (production) */

const DATA_URL = "../data/latest.json";
const LOCAL_API = "http://127.0.0.1:8090/publish";
const PUBLISH_PROXY_URL =
  "https://toto-admin-publish.mikizi-toto.workers.dev/publish";

const IS_LOCAL =
  location.hostname === "localhost" || location.hostname === "127.0.0.1";

/** @type {Array<{ id: number, teams: string, homeScore: number | null, awayScore: number | null, played: boolean }>} */
let cachedMatches = [];

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("publishForm")?.addEventListener("submit", onPublish);
  document.getElementById("refreshBtn")?.addEventListener("click", loadData);
  document.getElementById("matchSelect")?.addEventListener("change", onMatchSelect);
  setupModeBanner();
  loadData();
});

function setupModeBanner() {
  const localBox = document.getElementById("localModeBox");
  const prodBox = document.getElementById("prodModeBox");
  const adminPasswordGroup = document.getElementById("adminPasswordGroup");
  const submitBtn = document.getElementById("publishBtn");

  if (IS_LOCAL) {
    localBox?.classList.remove("hidden");
    prodBox?.classList.add("hidden");
    adminPasswordGroup?.classList.add("hidden");
    if (submitBtn) {
      submitBtn.textContent = "Publish locally";
    }
    return;
  }

  localBox?.classList.add("hidden");
  prodBox?.classList.remove("hidden");
  adminPasswordGroup?.classList.remove("hidden");
  if (submitBtn) {
    submitBtn.textContent = "Publish";
  }
}

async function loadData() {
  const status = document.getElementById("statusMsg");
  try {
    const response = await fetch(DATA_URL, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    cachedMatches = data.matches;
    renderMatches(data.matches);
    renderLeaderboard(data.leaderboard);
    if (status) {
      status.textContent = `${data.gamesPlayed} game(s) played · version ${data.version}`;
    }
    onMatchSelect();
  } catch (err) {
    console.error(err);
    if (status) {
      status.textContent = "Could not load data.";
    }
  }
}

function onMatchSelect() {
  const matchId = Number(document.getElementById("matchSelect")?.value);
  const match = cachedMatches.find((m) => m.id === matchId);
  const homeInput = document.getElementById("homeScore");
  const awayInput = document.getElementById("awayScore");
  if (!match || !homeInput || !awayInput) {
    return;
  }
  if (match.played) {
    homeInput.value = String(match.homeScore ?? 0);
    awayInput.value = String(match.awayScore ?? 0);
    return;
  }
  homeInput.value = "";
  awayInput.value = "";
}

/** @param {Array<{ id: number, teams: string, homeScore: number | null, awayScore: number | null, played: boolean }>} matches */
function renderMatches(matches) {
  const tbody = document.getElementById("matchesBody");
  const select = document.getElementById("matchSelect");
  if (!tbody || !select) {
    return;
  }

  const sorted = [...matches].sort((a, b) => a.id - b.id);
  tbody.innerHTML = sorted
    .map((m) => {
      const score = m.played ? `${m.homeScore}–${m.awayScore}` : "—";
      const rowClass = m.played ? "" : "text-muted";
      return `<tr class="${rowClass}">
        <td>${m.id}</td>
        <td>${escapeHtml(m.teams)}</td>
        <td>${score}</td>
      </tr>`;
    })
    .join("");

  const nextUnplayed = sorted.find((m) => !m.played);
  select.innerHTML = sorted
    .map((m) => {
      const selected = nextUnplayed && m.id === nextUnplayed.id ? " selected" : "";
      return `<option value="${m.id}"${selected}>Match ${m.id}: ${escapeHtml(m.teams)}${
        m.played ? ` (${m.homeScore}-${m.awayScore})` : ""
      }</option>`;
    })
    .join("");
}

/** @param {Array<{ rank: number | null, name: string, points: number }>} leaderboard */
function renderLeaderboard(leaderboard) {
  const tbody = document.getElementById("leaderboardBody");
  if (!tbody) {
    return;
  }
  const sorted = [...leaderboard].sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999));
  tbody.innerHTML = sorted
    .slice(0, 15)
    .map(
      (e) =>
        `<tr><td>${e.rank ?? "—"}</td><td>${escapeHtml(e.name)}</td><td>${e.points.toFixed(0)}</td></tr>`
    )
    .join("");
}

/** @param {SubmitEvent} event */
async function onPublish(event) {
  event.preventDefault();
  const matchId = Number(document.getElementById("matchSelect")?.value);
  const homeScore = Number(document.getElementById("homeScore")?.value);
  const awayScore = Number(document.getElementById("awayScore")?.value);
  const msg = document.getElementById("publishMsg");

  if (Number.isNaN(homeScore) || Number.isNaN(awayScore) || homeScore < 0 || awayScore < 0) {
    if (msg) {
      msg.textContent = "Enter valid scores (0 or more).";
    }
    return;
  }

  if (IS_LOCAL) {
    await publishLocally(matchId, homeScore, awayScore, msg);
    return;
  }

  await publishViaProxy(matchId, homeScore, awayScore, msg);
}

/**
 * @param {number} matchId
 * @param {number} homeScore
 * @param {number} awayScore
 * @param {HTMLElement | null} msg
 */
async function publishViaProxy(matchId, homeScore, awayScore, msg) {
  if (!isProxyConfigured()) {
    if (msg) {
      msg.textContent = "Admin proxy is not configured yet. Deploy the Cloudflare Worker first.";
    }
    return;
  }

  const password = document.getElementById("adminPassword")?.value.trim();
  if (!password) {
    if (msg) {
      msg.textContent = "Enter the shared admin password.";
    }
    return;
  }

  if (msg) {
    msg.textContent = "Publishing…";
  }

  try {
    const response = await fetch(PUBLISH_PROXY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Password": password,
      },
      body: JSON.stringify({
        matchId,
        homeScore,
        awayScore,
      }),
    });
    if (!response.ok) {
      if (response.status === 401) {
        throw new Error("Wrong admin password.");
      }
      const text = await response.text();
      throw new Error(`${response.status}: ${text}`);
    }
    if (msg) {
      msg.textContent =
        "Queued! Check GitHub Actions for a green checkmark, then refresh the scoreboard in ~2 min.";
    }
  } catch (err) {
    console.error(err);
    if (msg) {
      const message = err instanceof Error ? err.message : "unknown error";
      if (message === "Failed to fetch") {
        msg.textContent =
          "Could not reach the admin proxy. Wait 2–3 min after deploy, refresh, and try again.";
      } else {
        msg.textContent = `Failed: ${message}`;
      }
    }
  }
}

function isProxyConfigured() {
  return !PUBLISH_PROXY_URL.includes("YOUR_WORKERS_SUBDOMAIN");
}

/**
 * @param {number} matchId
 * @param {number} homeScore
 * @param {number} awayScore
 * @param {HTMLElement | null} msg
 */
async function publishLocally(matchId, homeScore, awayScore, msg) {
  if (msg) {
    msg.textContent = "Publishing locally (patch → recalc → export)…";
  }

  try {
    const response = await fetch(LOCAL_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        match_id: matchId,
        home_score: homeScore,
        away_score: awayScore,
      }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }
    await loadData();
    if (msg) {
      msg.textContent = `Published ${data.teams} ${data.score}. Open scoreboard to verify.`;
    }
  } catch (err) {
    console.error(err);
    if (msg) {
      msg.textContent =
        `Local publish failed. Run "make dev" (starts admin API). ${err instanceof Error ? err.message : ""}`;
    }
  }
}

/** @param {string} text */
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
