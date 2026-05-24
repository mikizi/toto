/** Admin — view matches and trigger GitHub Actions publish workflow */

const DATA_URL = "../data/latest.json";
const REPO = "mikizi/toto";
const WORKFLOW_FILE = "publish-results.yml";

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("publishForm")?.addEventListener("submit", onPublish);
  document.getElementById("refreshBtn")?.addEventListener("click", loadData);
  loadData();
});

async function loadData() {
  const status = document.getElementById("statusMsg");
  try {
    const response = await fetch(DATA_URL, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    renderMatches(data.matches);
    renderLeaderboard(data.leaderboard);
    if (status) {
      status.textContent = `${data.gamesPlayed} game(s) played · version ${data.version}`;
    }
  } catch (err) {
    console.error(err);
    if (status) {
      status.textContent = "Could not load data.";
    }
  }
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

  select.innerHTML = sorted
    .map(
      (m) =>
        `<option value="${m.id}">Match ${m.id}: ${escapeHtml(m.teams)}${
          m.played ? ` (${m.homeScore}-${m.awayScore})` : ""
        }</option>`
    )
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
  const token = document.getElementById("githubToken")?.value.trim();
  const matchId = Number(document.getElementById("matchSelect")?.value);
  const homeScore = Number(document.getElementById("homeScore")?.value);
  const awayScore = Number(document.getElementById("awayScore")?.value);
  const msg = document.getElementById("publishMsg");

  if (!token) {
    if (msg) {
      msg.textContent =
        "Add a GitHub token with repo scope, or use Actions → Publish match result on github.com.";
    }
    return;
  }

  if (msg) {
    msg.textContent = "Publishing…";
  }

  try {
    const response = await fetch(
      `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({
          ref: "main",
          inputs: {
            match_id: matchId,
            home_score: homeScore,
            away_score: awayScore,
          },
        }),
      }
    );
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`${response.status}: ${text}`);
    }
    if (msg) {
      msg.textContent = "Published! Site updates in ~1–2 min.";
    }
  } catch (err) {
    console.error(err);
    if (msg) {
      msg.textContent = `Failed: ${err instanceof Error ? err.message : "unknown error"}`;
    }
  }
}

/** @param {string} text */
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
