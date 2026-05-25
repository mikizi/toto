/** Background playlist player — video art + audio from assets/music */

const MUSIC_BASE = "assets/music/";
const STORAGE_KEY = "wc26-player";

/** @type {ReadonlyArray<{ file: string, title: string }>} */
const PLAYLIST = [
  { file: "Triumph_am_Rasen.mp4", title: "Triumph am Rasen" },
  { file: "Victory_Lap.mp4", title: "Victory Lap" },
  { file: "Saturday_Under_the_Lights.mp4", title: "Saturday Under the Lights" },
  { file: "Minuto_Noventa.mp4", title: "Minuto Noventa" },
  { file: "La_Diez_en_la_Espalda.mp4", title: "La Diez en la Espalda" },
  { file: "O_Surdo_no_Peito.mp4", title: "O Surdo no Peito" },
  { file: "arabica.mp4", title: "Arabica" },
];

/** @typedef {{ closed: boolean, paused: boolean, trackIndex: number }} PlayerState */

/** @returns {PlayerState} */
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { closed: false, paused: true, trackIndex: 0 };
    }
    const parsed = JSON.parse(raw);
    const trackIndex = Number(parsed.trackIndex);
    return {
      closed: false,
      paused: parsed.paused === true || parsed.stopped === true,
      trackIndex: Number.isFinite(trackIndex)
        ? Math.min(Math.max(0, trackIndex), PLAYLIST.length - 1)
        : 0,
    };
  } catch {
    return { closed: false, paused: true, trackIndex: 0 };
  }
}

/** @param {PlayerState} state */
function saveState(state) {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      paused: state.paused,
      trackIndex: state.trackIndex,
    })
  );
}

/** @param {number} index */
function normalizeIndex(index) {
  const len = PLAYLIST.length;
  return ((index % len) + len) % len;
}

function initMusicPlayer() {
  const wrap = document.getElementById("musicPlayerWrap");
  const player = document.getElementById("musicPlayer");
  const reopenBtn = document.getElementById("musicPlayerReopen");
  const art = document.querySelector(".music-player-art");
  const video = document.getElementById("musicVideo");
  const marquee = document.getElementById("musicPlayerMarquee");
  const titleTrack = document.getElementById("musicPlayerTitleTrack");
  const playPauseBtn = document.getElementById("musicPlayPause");
  const prevBtn = document.getElementById("musicPrev");
  const nextBtn = document.getElementById("musicNext");
  const closeBtn = document.getElementById("musicPlayerClose");

  if (
    !wrap ||
    !player ||
    !reopenBtn ||
    !(art instanceof HTMLElement) ||
    !(video instanceof HTMLVideoElement) ||
    !(marquee instanceof HTMLElement) ||
    !(titleTrack instanceof HTMLElement) ||
    !playPauseBtn ||
    !prevBtn ||
    !nextBtn ||
    !closeBtn
  ) {
    return;
  }

  const titleTexts = titleTrack.querySelectorAll(".music-player-title-text");

  /** @type {PlayerState} */
  let state = loadState();

  /** @param {boolean} playing */
  function setPlayingUi(playing) {
    const showPause = playing && !mutedAutoplay;
    playPauseBtn.setAttribute("aria-label", showPause ? "Pause" : "Play");
    playPauseBtn.classList.toggle("is-playing", showPause);
    player.classList.toggle("is-playing", playing);
    updateMarqueeScroll(playing);
  }

  function applyVisibility() {
    wrap.classList.toggle("hidden", state.closed);
    reopenBtn.classList.toggle("hidden", !state.closed);
    document.body.classList.toggle("music-player-visible", !state.closed);
  }

  function resetMarqueePosition() {
    titleTrack.classList.remove("is-scrolling");
    titleTrack.style.removeProperty("--marquee-duration");
    titleTrack.style.transform = "translateX(0)";
  }

  /** @param {boolean} playing @param {boolean} [force] */
  function updateMarqueeScroll(playing, force = false) {
    const primary = titleTexts[0];
    if (!(primary instanceof HTMLElement)) {
      return;
    }

    const needsScroll = playing && primary.scrollWidth > marquee.clientWidth + 2;
    const isScrolling = titleTrack.classList.contains("is-scrolling");
    if (
      !force &&
      needsScroll === isScrolling &&
      (needsScroll || titleTrack.style.transform === "translateX(0px)" || titleTrack.style.transform === "")
    ) {
      return;
    }

    resetMarqueePosition();
    void titleTrack.offsetWidth;

    if (!needsScroll) {
      return;
    }

    requestAnimationFrame(() => {
      if (primary.scrollWidth <= marquee.clientWidth + 2) {
        return;
      }

      const title = primary.textContent ?? "";
      titleTrack.style.removeProperty("transform");
      titleTrack.classList.add("is-scrolling");
      const seconds = Math.max(10, title.length * 0.55);
      titleTrack.style.setProperty("--marquee-duration", `${seconds}s`);
    });
  }

  /** @param {string} title */
  function setMarqueeTitle(title) {
    const primary = titleTexts[0];
    const copy = titleTexts[1];
    if (!(primary instanceof HTMLElement) || !(copy instanceof HTMLElement)) {
      return;
    }

    primary.textContent = title;
    copy.textContent = title;
    marquee.setAttribute("aria-label", `Now playing: ${title}`);
    updateMarqueeScroll(player.classList.contains("is-playing"), true);
  }

  /** @param {number} direction 1 = next, -1 = previous */
  function animateTrackChange(direction) {
    art.classList.remove("is-changing", "is-track-next", "is-track-prev");
    player.classList.remove("is-track-change", "is-track-next", "is-track-prev");
    void art.offsetWidth;
    const dirClass = direction >= 0 ? "is-track-next" : "is-track-prev";
    art.classList.add("is-changing", dirClass);
    player.classList.add("is-track-change", dirClass);
    window.setTimeout(() => {
      art.classList.remove("is-changing", "is-track-next", "is-track-prev");
      player.classList.remove("is-track-change", "is-track-next", "is-track-prev");
    }, 480);
  }

  /** @param {number} index @param {number} [direction] */
  function loadTrack(index, direction = 0) {
    const nextIndex = normalizeIndex(index);
    if (nextIndex !== state.trackIndex) {
      animateTrackChange(direction);
    }
    state.trackIndex = nextIndex;
    const track = PLAYLIST[state.trackIndex];
    video.src = `${MUSIC_BASE}${track.file}`;
    setMarqueeTitle(track.title);
    saveState(state);
    video.load();
  }

  function showArtFrame() {
    if (video.readyState >= 1) {
      video.pause();
      video.currentTime = 0;
    }
  }

  let mutedAutoplay = false;
  let autoplayStartAttempted = false;

  function clearAwaitingPlayUi() {
    player.classList.remove("is-awaiting-play");
  }

  function onPlaybackStarted() {
    state.paused = false;
    clearAwaitingPlayUi();
    setPlayingUi(true);
    saveState(state);
  }

  /**
   * @param {{ userInitiated?: boolean }} [options]
   * @returns {Promise<void>}
   */
  function tryPlay(options = {}) {
    const userInitiated = options.userInitiated === true;

    if (state.closed) {
      return Promise.resolve();
    }

    if (!userInitiated && state.paused) {
      return Promise.resolve();
    }

    if (userInitiated) {
      state.paused = false;
    }

    clearAwaitingPlayUi();
    video.muted = false;
    mutedAutoplay = false;

    return video
      .play()
      .then(onPlaybackStarted)
      .catch(() => {
        video.muted = true;
        return video.play().then(() => {
          mutedAutoplay = true;
          onPlaybackStarted();
        });
      })
      .catch(() => {
        video.muted = false;
        setPlayingUi(false);
        showArtFrame();
        if (userInitiated) {
          state.paused = true;
          saveState(state);
        } else {
          player.classList.add("is-awaiting-play");
        }
        return Promise.reject(new Error("autoplay blocked"));
      });
  }

  function pause() {
    video.pause();
    video.muted = false;
    mutedAutoplay = false;
    clearAwaitingPlayUi();
    state.paused = true;
    setPlayingUi(false);
    saveState(state);
  }

  function unmuteIfNeeded() {
    if (!mutedAutoplay || video.paused) {
      return false;
    }
    video.muted = false;
    mutedAutoplay = false;
    setPlayingUi(true);
    return true;
  }

  function togglePlayPause() {
    if (unmuteIfNeeded()) {
      return;
    }
    if (video.paused) {
      void tryPlay({ userInitiated: true });
    } else {
      pause();
    }
  }

  /** @param {number} delta */
  function skip(delta) {
    loadTrack(state.trackIndex + delta, delta);
    if (!state.paused) {
      tryPlay();
    }
  }

  function closePlayer() {
    video.pause();
    setPlayingUi(false);
    state.closed = true;
    applyVisibility();
    saveState(state);
  }

  function openPlayer() {
    state.closed = false;
    applyVisibility();
    saveState(state);
    if (!state.paused) {
      tryPlay();
    } else {
      showArtFrame();
    }
  }

  playPauseBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    togglePlayPause();
  });
  prevBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    unmuteIfNeeded();
    skip(-1);
  });
  nextBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    unmuteIfNeeded();
    skip(1);
  });

  player.addEventListener("click", (e) => {
    if (e.target.closest("button")) {
      return;
    }
    if (unmuteIfNeeded()) {
      return;
    }
    if (player.classList.contains("is-awaiting-play") && video.paused) {
      void tryPlay({ userInitiated: true });
    }
  });
  closeBtn.addEventListener("click", closePlayer);
  reopenBtn.addEventListener("click", openPlayer);

  video.addEventListener("ended", () => skip(1));

  video.addEventListener("play", () => {
    state.paused = false;
    setPlayingUi(true);
    saveState(state);
  });

  video.addEventListener("loadeddata", () => {
    if (state.paused) {
      showArtFrame();
    }
  });

  loadTrack(state.trackIndex);
  applyVisibility();

  function startAutoplayIfNeeded() {
    if (autoplayStartAttempted || state.paused || state.closed) {
      return;
    }
    autoplayStartAttempted = true;
    tryPlay();
  }

  if (state.paused) {
    setPlayingUi(false);
    showArtFrame();
  } else {
    video.addEventListener("canplay", startAutoplayIfNeeded, { once: true });
    video.addEventListener("loadeddata", startAutoplayIfNeeded, { once: true });
    if (video.readyState >= 2) {
      startAutoplayIfNeeded();
    }
  }
}

document.addEventListener("DOMContentLoaded", initMusicPlayer);
