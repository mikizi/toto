(function () {
  const CARD_ACCENTS = ["#63c7ff", "#f4c84b", "#37d67a", "#f15b4a"];

  const state = {
    scenarios: [],
    activeId: "",
  };

  const els = {
    scenarioGrid: document.getElementById("scenarioGrid"),
    toast: document.getElementById("toast"),
    copyPageBtn: document.getElementById("copyPageBtn"),
  };

  function fmt(points) {
    return Number(points).toFixed(2).replace(/\.00$/, "");
  }

  function html(text) {
    const div = document.createElement("div");
    div.textContent = String(text ?? "");
    return div.innerHTML;
  }

  function teamMarkup(teamName) {
    const flag = typeof flagHtml === "function" ? flagHtml(teamName, "sm") : "";
    return `${flag}<span class="team-name">${html(teamName)}</span>`;
  }

  function scenarioCard(scenario) {
    const finalistText = `${scenario.finalists[0]} x ${scenario.finalists[1]}`;
    const topTen = scenario.rows.slice(0, 10);
    return `
      <button class="scenario-card" type="button" data-scenario-id="${html(scenario.id)}" style="--accent: ${CARD_ACCENTS[scenario.index % CARD_ACCENTS.length]}">
        <span class="card-kicker">Outcome ${scenario.index + 1}</span>
        <div>
          <h3 class="card-title">${html(finalistText)}</h3>
          <div class="winner-row">${teamMarkup(scenario.champion)}</div>
        </div>
          <div class="card-path">
          <span>${html(scenario.semiOneWinner)} wins semi-final 1</span>
          <span>${html(scenario.semiTwoWinner)} wins semi-final 2</span>
        </div>
        <div class="scenario-top" aria-label="Projected top 10">
          <div class="scenario-top-head">
            <span>Pos</span>
            <span>Player</span>
            <span>Pts</span>
          </div>
          ${topTen
            .map(
              (row) => `
                <div class="scenario-top-row">
                  <span class="scenario-rank">#${row.projectedRank}</span>
                  <span class="scenario-player">${html(row.name)}</span>
                  <span class="scenario-total">${fmt(row.projected)}</span>
                </div>
              `
            )
            .join("")}
        </div>
      </button>
    `;
  }

  function setActiveScenario(id, shouldPushUrl) {
    const scenario = state.scenarios.find((item) => item.id === id) || state.scenarios[0];
    if (!scenario) return;
    state.activeId = scenario.id;

    document.querySelectorAll(".scenario-card").forEach((card) => {
      card.classList.toggle("is-active", card.dataset.scenarioId === scenario.id);
    });

    if (shouldPushUrl) {
      const url = new URL(window.location.href);
      url.searchParams.set("scenario", scenario.id);
      window.history.replaceState({}, "", url);
    }
  }

  function renderScenarioGrid() {
    els.scenarioGrid.innerHTML = state.scenarios.map(scenarioCard).join("");
    els.scenarioGrid.addEventListener("click", (event) => {
      const card = event.target.closest("[data-scenario-id]");
      if (!card) return;
      setActiveScenario(card.dataset.scenarioId, true);
    });
  }

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.add("is-visible");
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => {
      els.toast.classList.remove("is-visible");
    }, 1800);
  }

  async function copyCurrentUrl() {
    const url = new URL(window.location.href);
    if (state.activeId) {
      url.searchParams.set("scenario", state.activeId);
    }
    try {
      if (navigator.share) {
        await navigator.share({
          title: "World Cup Pool: Final Scenarios",
          text: "Eight possible paths for the prediction pool.",
          url: url.toString(),
        });
        return;
      }
      await navigator.clipboard.writeText(url.toString());
      showToast("Share link copied");
    } catch (error) {
      try {
        await navigator.clipboard.writeText(url.toString());
        showToast("Share link copied");
      } catch (copyError) {
        showToast("Could not copy link");
      }
    }
  }

  async function init() {
    els.scenarioGrid.innerHTML = '<div class="loading">Loading simulation snapshot...</div>';
    els.copyPageBtn.addEventListener("click", copyCurrentUrl);

    if (window.FINAL_SCENARIO_SNAPSHOT?.scenarios?.length) {
      state.scenarios = window.FINAL_SCENARIO_SNAPSHOT.scenarios;
      renderReadyState();
    } else {
      els.scenarioGrid.innerHTML =
        '<div class="error">Could not load the simulation snapshot.</div>';
    }
  }

  function renderReadyState() {
    renderScenarioGrid();
    const requested = new URLSearchParams(window.location.search).get("scenario");
    const initial = state.scenarios.some((scenario) => scenario.id === requested)
      ? requested
      : state.scenarios[0].id;
    setActiveScenario(initial, Boolean(requested));
  }

  init();
})();
