/** World Cup story modal — animated recap shown on scoreboard load. */

(() => {
  const SCENE_DURATION_MS = 4800;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  const scenes = [
    {
      label: "Kickoff",
      tone: "opening",
      kicker: "June 11 · Before the first whistle",
      title: "It started with belief",
      copy: "Eighty-nine entries, hundreds of predictions, and the feeling that any one of us could win it all.",
      leader: "Players dreaming",
      points: "89",
      meta: "entries, all level",
    },
    {
      label: "Early lead",
      tone: "groups",
      kicker: "After 24 matches",
      title: "Pini2 made the first move",
      copy: "Twenty-four matches in, the table finally had a shape. Pini2 was the first to make the rest of us chase.",
      leader: "Pini2",
      points: "62",
      meta: "points",
    },
    {
      label: "Group stage",
      tone: "groups",
      kicker: "After 60 matches",
      title: "Then the rhythm changed",
      copy: "The group stage kept surprising us. SharonWisman found the run that carried the lead into the knockouts.",
      leader: "SharonWisman",
      points: "142",
      meta: "points",
    },
    {
      label: "Last 32",
      tone: "knockout",
      kicker: "July 3 · Knockouts begin",
      title: "The knockouts blew it open",
      copy: "One night rewrote everything. Qualifiers landed, points surged, and N_RoeiShemesh climbed above the noise.",
      leader: "N_RoeiShemesh",
      points: "393.56",
      meta: "points",
    },
    {
      label: "Round of 16",
      tone: "knockout",
      kicker: "July 7 · Round of 16",
      title: "Three points became everything",
      copy: "Every qualifier felt personal now. LironShmueli2 reached the top with the whole chasing pack breathing behind.",
      leader: "LironShmueli2",
      points: "502",
      meta: "points",
    },
    {
      label: "Quarter-finals",
      tone: "knockout",
      kicker: "July 12 · Quarter-finals",
      title: "One last turn before the final",
      copy: "France, Spain, England and Argentina survived. YogevTzur2 led, but nobody at the top could feel safe.",
      leader: "YogevTzur2",
      points: "594",
      meta: "points",
    },
    {
      label: "The final",
      tone: "final",
      kicker: "Today · One match remains",
      title: "Everything comes down to this",
      copy: "A month of guesses, shocks and late-night score checks leaves nine points between the top two. One final decides our story.",
      leader: "ItayGriner",
      points: "635",
      meta: "N_NirPeleg follows on 626",
      finalMatch: true,
    },
  ];

  let currentIndex = 0;
  let elapsedMs = 0;
  let sceneStartedAt = 0;
  let frameId = 0;
  let pointsFrameId = 0;
  let playing = false;
  let lastFocused = null;

  const modal = document.getElementById("worldCupStoryModal");
  const card = modal?.querySelector(".story-modal-card");
  const stage = document.getElementById("storyStage");
  const kicker = document.getElementById("storySceneKicker");
  const sceneNumber = document.getElementById("storySceneNumber");
  const sceneLabel = document.getElementById("storySceneLabel");
  const title = document.getElementById("storySceneTitle");
  const copy = document.getElementById("storySceneCopy");
  const leader = document.getElementById("storySceneLeader");
  const points = document.getElementById("storyScenePoints");
  const meta = document.getElementById("storySceneMeta");
  const finalMatch = document.getElementById("storyFinalMatch");
  const progressBar = document.getElementById("storyProgressBar");
  const timeline = document.getElementById("storyTimeline");
  const timeLabel = document.getElementById("storyTimeLabel");
  const playBtn = document.getElementById("storyPlayBtn");
  const prevBtn = document.getElementById("storyPrevBtn");
  const nextBtn = document.getElementById("storyNextBtn");
  const replayBtn = document.getElementById("storyReplayBtn");
  const previousLeader = document.getElementById("storyPreviousLeader");
  const currentLeader = document.getElementById("storyCurrentLeader");
  const nextLeader = document.getElementById("storyNextLeader");
  const closeBtn = document.getElementById("storyCloseBtn");
  const skipBtn = document.getElementById("storySkipBtn");
  const soundBtn = document.getElementById("storySoundBtn");
  const soundLabel = document.getElementById("storySoundLabel");
  const audio = document.getElementById("storyAudio");

  if (!(modal instanceof HTMLElement) || !(card instanceof HTMLElement)) {
    return;
  }

  function updateSoundControl() {
    const soundOn = audio instanceof HTMLAudioElement && !audio.muted;
    soundBtn?.setAttribute("aria-pressed", String(soundOn));
    if (soundLabel) soundLabel.textContent = soundOn ? "Sound off" : "Sound on";
    soundBtn?.setAttribute("aria-label", soundOn ? "Turn story sound off" : "Turn story sound on");
  }

  function resumeStoryAudio() {
    if (!(audio instanceof HTMLAudioElement)) return;
    void audio.play().catch(() => {
      audio.muted = true;
      updateSoundControl();
    });
  }

  function pauseStoryAudio() {
    if (audio instanceof HTMLAudioElement) audio.pause();
  }

  function resetStoryAudio() {
    if (!(audio instanceof HTMLAudioElement)) return;
    audio.pause();
    audio.currentTime = 0;
    audio.muted = true;
    updateSoundControl();
  }

  function toggleSound() {
    if (!(audio instanceof HTMLAudioElement)) return;
    audio.volume = 0.34;
    audio.muted = !audio.muted;
    if (!audio.muted) {
      if (audio.paused && Number.isFinite(audio.duration)) {
        const storyTime = currentIndex * SCENE_DURATION_MS / 1000 + elapsedMs / 1000;
        audio.currentTime = Math.min(storyTime, Math.max(0, audio.duration - 0.1));
      }
      resumeStoryAudio();
    }
    updateSoundControl();
  }

  function renderTimeline() {
    if (!timeline) return;
    timeline.innerHTML = scenes.map((scene, index) => `
      <button class="story-step" type="button" data-story-index="${index}" aria-label="Open chapter ${index + 1}: ${scene.label}">
        <span class="story-step-dot" aria-hidden="true"></span>
        <span class="story-step-label">${scene.label}</span>
      </button>`).join("");
  }

  function updateProgress(progressWithinScene = 0) {
    const totalProgress = ((currentIndex + progressWithinScene) / scenes.length) * 100;
    if (progressBar) {
      progressBar.style.width = `${Math.min(100, Math.max(0, totalProgress))}%`;
    }
  }

  function updateControlState() {
    if (playBtn) {
      playBtn.textContent = playing ? "Pause" : "Play";
      playBtn.setAttribute("aria-label", playing ? "Pause story" : "Play story");
    }
    if (prevBtn) prevBtn.disabled = currentIndex === 0;
    if (nextBtn) nextBtn.disabled = currentIndex === scenes.length - 1;
    if (timeLabel) timeLabel.textContent = `Chapter ${currentIndex + 1} of ${scenes.length}`;
  }

  function animatePoints(targetText) {
    if (!points) return;
    if (pointsFrameId) window.cancelAnimationFrame(pointsFrameId);
    const target = Number(targetText);
    if (!Number.isFinite(target) || reducedMotion.matches) {
      points.textContent = targetText;
      return;
    }
    const startValue = Number(points.textContent) || 0;
    const decimals = targetText.includes(".") ? 2 : 0;
    const startedAt = performance.now();
    const duration = 900;
    const tick = (now) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const value = startValue + (target - startValue) * eased;
      points.textContent = value.toFixed(decimals);
      if (progress < 1) pointsFrameId = window.requestAnimationFrame(tick);
      else pointsFrameId = 0;
    };
    pointsFrameId = window.requestAnimationFrame(tick);
  }

  function renderScene(index) {
    currentIndex = Math.min(scenes.length - 1, Math.max(0, index));
    const scene = scenes[currentIndex];
    stage?.classList.remove("is-entering");
    if (stage) {
      stage.dataset.tone = scene.tone;
      void stage.offsetWidth;
      stage.classList.add("is-entering");
    }
    if (sceneNumber) sceneNumber.textContent = String(currentIndex + 1).padStart(2, "0");
    if (sceneLabel) sceneLabel.textContent = scene.label;
    if (kicker) kicker.textContent = scene.kicker;
    if (title) title.textContent = scene.title;
    if (copy) copy.textContent = scene.copy;
    if (leader) leader.textContent = scene.leader;
    animatePoints(scene.points);
    if (meta) meta.textContent = scene.meta;
    if (finalMatch) finalMatch.hidden = !scene.finalMatch;
    if (previousLeader) previousLeader.textContent = currentIndex === 0 ? "The beginning" : scenes[currentIndex - 1].leader;
    if (currentLeader) currentLeader.textContent = scene.leader;
    if (nextLeader) nextLeader.textContent = currentIndex === scenes.length - 1 ? "The final whistle" : scenes[currentIndex + 1].leader;

    timeline?.querySelectorAll(".story-step").forEach((step, stepIndex) => {
      step.classList.toggle("is-active", stepIndex === currentIndex);
      step.classList.toggle("is-complete", stepIndex < currentIndex);
      step.setAttribute("aria-current", stepIndex === currentIndex ? "step" : "false");
    });
    updateControlState();
  }

  function stopAnimation() {
    if (frameId) {
      window.cancelAnimationFrame(frameId);
      frameId = 0;
    }
  }

  function finishStory() {
    playing = false;
    elapsedMs = SCENE_DURATION_MS;
    updateProgress(1);
    updateControlState();
    stopAnimation();
    pauseStoryAudio();
  }

  function animationFrame(now) {
    if (!playing) return;
    elapsedMs = now - sceneStartedAt;
    const sceneProgress = Math.min(1, elapsedMs / SCENE_DURATION_MS);
    updateProgress(sceneProgress);

    if (sceneProgress >= 1) {
      if (currentIndex >= scenes.length - 1) {
        finishStory();
        return;
      }
      currentIndex += 1;
      elapsedMs = 0;
      sceneStartedAt = now;
      renderScene(currentIndex);
    }
    frameId = window.requestAnimationFrame(animationFrame);
  }

  function play() {
    if (currentIndex === scenes.length - 1 && elapsedMs >= SCENE_DURATION_MS) {
      currentIndex = 0;
      elapsedMs = 0;
      renderScene(0);
    }
    playing = true;
    sceneStartedAt = performance.now() - elapsedMs;
    updateControlState();
    stopAnimation();
    frameId = window.requestAnimationFrame(animationFrame);
    resumeStoryAudio();
  }

  function pause() {
    playing = false;
    stopAnimation();
    updateControlState();
    pauseStoryAudio();
  }

  function goToScene(index, keepPlaying = playing) {
    const nextIndex = Math.min(scenes.length - 1, Math.max(0, index));
    currentIndex = nextIndex;
    elapsedMs = 0;
    renderScene(currentIndex);
    updateProgress(0);
    if (audio instanceof HTMLAudioElement && Number.isFinite(audio.duration)) {
      audio.currentTime = Math.min(currentIndex * SCENE_DURATION_MS / 1000, Math.max(0, audio.duration - 0.1));
    }
    if (keepPlaying) play();
    else pause();
  }

  function replay() {
    goToScene(0, !reducedMotion.matches);
  }

  function closeStory() {
    pause();
    resetStoryAudio();
    if (pointsFrameId) {
      window.cancelAnimationFrame(pointsFrameId);
      pointsFrameId = 0;
    }
    modal.classList.remove("is-open");
    modal.hidden = true;
    document.body.classList.remove("story-modal-open");
    document.dispatchEvent(new CustomEvent("toto:story-close"));
    if (lastFocused instanceof HTMLElement) lastFocused.focus();
  }

  function openStory() {
    if (!modal.hidden) return;
    lastFocused = document.activeElement;
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    modal.hidden = false;
    document.body.classList.add("story-modal-open");
    document.dispatchEvent(new CustomEvent("toto:story-open"));
    if (audio instanceof HTMLAudioElement) {
      audio.volume = 0.34;
      audio.muted = true;
      audio.currentTime = 0;
      updateSoundControl();
    }
    renderScene(0);
    updateProgress(0);
    window.requestAnimationFrame(() => modal.classList.add("is-open"));
    closeBtn?.focus();
    if (reducedMotion.matches) pause();
    else play();
  }

  function trapFocus(event) {
    if (event.key !== "Tab") return;
    const focusable = Array.from(card.querySelectorAll("button:not([disabled])"));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  renderTimeline();
  closeBtn?.addEventListener("click", closeStory);
  skipBtn?.addEventListener("click", closeStory);
  soundBtn?.addEventListener("click", toggleSound);
  modal.querySelector("[data-story-close]")?.addEventListener("click", closeStory);
  playBtn?.addEventListener("click", () => playing ? pause() : play());
  prevBtn?.addEventListener("click", () => goToScene(currentIndex - 1));
  nextBtn?.addEventListener("click", () => goToScene(currentIndex + 1));
  replayBtn?.addEventListener("click", replay);
  timeline?.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target.closest("[data-story-index]") : null;
    if (!(target instanceof HTMLButtonElement)) return;
    goToScene(Number(target.dataset.storyIndex));
  });
  card.addEventListener("keydown", trapFocus);
  document.addEventListener("keydown", (event) => {
    if (modal.hidden) return;
    if (event.key === "Escape") closeStory();
    if (event.key === "ArrowLeft") goToScene(currentIndex - 1);
    if (event.key === "ArrowRight") goToScene(currentIndex + 1);
  });

  function openWhenScoreboardIsReady() {
    const app = document.querySelector(".app");
    if (app?.classList.contains("loaded")) {
      window.setTimeout(openStory, 350);
      return;
    }
    if (!app) {
      window.setTimeout(openStory, 500);
      return;
    }
    const observer = new MutationObserver(() => {
      if (!app.classList.contains("loaded")) return;
      observer.disconnect();
      window.setTimeout(openStory, 350);
    });
    observer.observe(app, { attributes: true, attributeFilter: ["class"] });
  }

  openWhenScoreboardIsReady();
})();
