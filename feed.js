let FEED = DEFAULT_FEED.slice();
let feedEnabled = true;

const feed = document.getElementById("feed");
const status = document.getElementById("status");
const scrub = document.getElementById("scrub");
const buffered = document.getElementById("buffered");
const seek = document.getElementById("seek");
const timeLabel = document.getElementById("time");
const retry = document.getElementById("retry");

const ICONS = {
  soundOff: '<svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10h3l4-4v12l-4-4H4zM16 9l5 6M21 9l-5 6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/></svg>',
  soundOn: '<svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10h3l4-4v12l-4-4H4zM16 9a4 4 0 0 1 0 6M18.5 7a7 7 0 0 1 0 10" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  heart: '<svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19s-7-4.4-7-9a4 4 0 0 1 7-2 4 4 0 0 1 7 2c0 4.6-7 9-7 9z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
  heartOn: '<svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19s-7-4.4-7-9a4 4 0 0 1 7-2 4 4 0 0 1 7 2c0 4.6-7 9-7 9z" fill="currentColor" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
  comment: '<svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 17l-2 3V7a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H6z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
  share: '<svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v10M8 8l4-4 4 4M6 13v5a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  chevron: '<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

let player = null;
let active = 0;
let muted = false;
let soundWanted = true;
let generation = 0;
let feedReady = false;
let analyticsReady = false;
let hasFrame = false;
let userPaused = false;
let visibilityPaused = false;
let seeking = false;
let currentTime = 0;
let currentDuration = 0;
let bufferedSeconds = 0;
let lastTimeUpdateAt = 0;
let playbackTimeout = 0;
let playbackRetryTimer = 0;
let playbackAttempts = 0;
let playbackConfirmed = false;

function recordEvent(type, item = FEED[active]) {
  if (!analyticsReady || !item) return;
  fetch("/api/events", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, videoId: item.id }), keepalive: true,
  }).catch(() => {});
}

function posterUrl(id) {
  return "https://kinescope.io/" + id + "/poster.jpg";
}

const LOCAL_POSTER = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="450" height="800"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#6d4aff"/><stop offset="1" stop-color="#171226"/></linearGradient></defs><rect width="450" height="800" fill="url(#g)"/><circle cx="225" cy="400" r="38" fill="none" stroke="white" stroke-width="3"/><path d="m215 380 31 20-31 20z" fill="white"/></svg>');

function posterFor(item) {
  return item.posterUrl || (item.source === "upload" ? LOCAL_POSTER : posterUrl(item.id));
}

function iconButton(action, label, svg) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "rail-btn";
  button.dataset.action = action;
  button.setAttribute("aria-label", label);
  button.innerHTML = svg;
  return button;
}

function render() {
  feed.replaceChildren();
  FEED.forEach((item, index) => {
    const slide = document.createElement("section");
    slide.className = "slide" + (index === active ? " is-active" : "");
    slide.dataset.index = String(index);

    const img = document.createElement("img");
    img.className = "poster";
    img.alt = "";
    img.loading = Math.abs(index - active) <= 1 ? "eager" : "lazy";
    if (index === active) img.fetchPriority = "high";
    else img.fetchPriority = "low";
    img.decoding = "async";
    img.src = posterFor(item);
    slide.appendChild(img);

    const slot = document.createElement("div");
    slot.className = "player-slot";
    slide.appendChild(slot);

    const shade = document.createElement("div");
    shade.className = "shade";
    slide.appendChild(shade);

    const playbackState = document.createElement("div");
    playbackState.className = "playback-state";
    playbackState.setAttribute("aria-hidden", "true");
    playbackState.innerHTML = '<span class="playback-pause-icon"></span>';
    slide.appendChild(playbackState);

    const rail = document.createElement("div");
    rail.className = "rail";
    rail.append(
      iconButton("sound", "Звук", ICONS.soundOn),
      iconButton("like", "Нравится", ICONS.heart),
      iconButton("comment", "Комментарии", ICONS.comment),
      iconButton("share", "Поделиться", ICONS.share)
    );
    slide.appendChild(rail);

    const dock = document.createElement("div");
    dock.className = "dock";

    const author = document.createElement("div");
    author.className = "author";
    const avatar = document.createElement("span");
    avatar.className = "avatar";
    avatar.textContent = (item.streamerName || "Б").slice(0, 1).toUpperCase();
    if (item.streamerAvatar) {
      const picture = document.createElement("img");
      picture.src = item.streamerAvatar; picture.alt = "";
      picture.loading = "lazy";
      avatar.replaceChildren(picture);
    }
    const who = document.createElement("div");
    who.className = "bio";
    const name = document.createElement("p");
    name.className = "name";
    name.textContent = item.streamerName || "Блогеры рекомендуют";
    const caption = document.createElement("p");
    caption.className = "caption";
    caption.textContent = item.text;
    const more = document.createElement("button");
    more.type = "button";
    more.className = "more";
    more.dataset.action = "more";
    more.hidden = true;
    more.textContent = "ещё";
    who.append(name, caption, more);
    author.append(avatar, who);
    dock.appendChild(author);

    (item.offers || []).forEach((offer) => {
      const card = document.createElement("a");
      card.className = "offer";
      card.href = offer.href;
      card.target = "_blank";
      card.rel = "noopener noreferrer";
      card.setAttribute("aria-label", offer.label);

      const thumb = document.createElement("img");
      thumb.className = "thumb";
      thumb.alt = "";
      thumb.src = offer.image || posterFor(item);
      thumb.loading = "lazy";
      thumb.decoding = "async";
      thumb.fetchPriority = "low";

      const text = document.createElement("span");
      text.className = "offer-text";
      const offerTitle = document.createElement("span");
      offerTitle.className = "offer-title";
      offerTitle.textContent = offer.title;
      const offerPrice = document.createElement("span");
      offerPrice.className = "offer-price";
      offerPrice.textContent = offer.price;
      text.append(offerTitle, offerPrice);

      const chevron = document.createElement("span");
      chevron.className = "chevron";
      chevron.innerHTML = ICONS.chevron;

      card.append(thumb, text, chevron);
      dock.appendChild(card);
    });

    slide.appendChild(dock);
    feed.appendChild(slide);
  });
}

function slides() {
  return [...feed.querySelectorAll(".slide")];
}

function revealActive() {
  slides().forEach((slide, index) => {
    slide.classList.toggle("is-revealed", index === active && hasFrame);
  });
}

function playbackState(kind) {
  slides().forEach((slide, index) => {
    slide.classList.toggle("is-buffering", index === active && kind === "buffering");
    slide.classList.toggle("is-paused", index === active && kind === "paused");
  });
  document.documentElement.dataset.playback = kind;
}

function paintSound() {
  document.querySelectorAll('[data-action="sound"]').forEach((button) => {
    button.innerHTML = muted ? ICONS.soundOff : ICONS.soundOn;
    button.setAttribute("aria-pressed", String(!muted));
    button.setAttribute("aria-label", muted ? "Включить звук" : "Выключить звук");
    button.classList.toggle("needs-tap", muted && soundWanted && button.closest(".slide")?.classList.contains("is-active"));
  });
}

async function applyMute() {
  const current = player;
  if (!current) { paintSound(); return; }
  try {
    if (soundWanted) await current.unmute();
    else await current.mute();
    if (current === player) muted = await current.isMuted();
  } catch (error) {
    if (current === player && soundWanted) muted = true;
  }
  paintSound();
}

let factory = null;
let cachedPrevious = null;
let playerIndex = -1;
let hostSerial = 0;

function playerOptions(id, autoPlay = false) {
  return {
    url: "https://kinescope.io/" + id,
    size: { width: "100%", height: "100%" },
    behavior: {
      autoPlay,
      muted: !soundWanted,
      loop: true,
      playsInline: true,
      preload: "auto",
      keyboard: false,
      autoPause: true,
      localStorage: { time: false, quality: false },
    },
    ui: {
      language: "ru",
      controls: false,
      mainPlayButton: false,
    },
  };
}

function createLocalPlayer(host, item, autoPlay = false) {
  const video = document.createElement("video");
  video.src = item.mediaUrl;
  video.muted = !soundWanted;
  video.autoplay = autoPlay;
  video.loop = true;
  video.playsInline = true;
  video.preload = "auto";
  host.appendChild(video);
  return {
    Events: { Playing: "playing", Pause: "pause", Error: "error", Loaded: "loadeddata", Waiting: "waiting", Progress: "progress", TimeUpdate: "timeupdate", DurationChange: "durationchange", VolumeChange: "volumechange" },
    on: (event, callback) => video.addEventListener(event, callback),
    once: (event, callback) => video.addEventListener(event, callback, { once: true }),
    mute: async () => { video.muted = true; },
    unmute: async () => { video.muted = false; },
    isMuted: async () => video.muted,
    play: () => video.play(),
    pause: async () => { video.pause(); },
    isPaused: async () => video.paused,
    getCurrentTime: async () => video.currentTime,
    getDuration: async () => video.duration,
    seekTo: async (time) => { video.currentTime = time; },
    destroy: async () => { video.pause(); video.removeAttribute("src"); video.load(); host.remove(); },
  };
}

function bindPlayer(instance, token) {
  if (instance.Events.VolumeChange) instance.on(instance.Events.VolumeChange, (event) => {
    if (token !== generation || instance !== player) return;
    if (typeof event.data?.muted === "boolean") {
      muted = event.data.muted;
      paintSound();
    }
  });
  if (instance.Events.Loaded) instance.on(instance.Events.Loaded, () => {
    if (token === generation && instance === player && !hasFrame && !userPaused) startPlayback(instance);
  });
  instance.on(instance.Events.Playing, () => {
    if (token !== generation) {
      if (instance !== player) instance.pause().catch(() => {});
      return;
    }
    markPlaying(instance, token);
  });
  instance.on(instance.Events.Pause, () => {
    if (token !== generation) return;
    if (userPaused || visibilityPaused || document.hidden) playbackState("paused");
    else if (instance === player) {
      playbackConfirmed = false;
      playbackState("buffering");
      schedulePlaybackCheck(instance, token, 350);
    }
  });
  if (instance.Events.Waiting) instance.on(instance.Events.Waiting, () => {
    if (token === generation && !userPaused && !document.hidden) {
      playbackState("buffering");
      watchForStall(token);
    }
  });
  if (instance.Events.Progress) instance.on(instance.Events.Progress, (event) => {
    if (token !== generation) return;
    const bufferedTime = event.data?.bufferedTime ?? (event.target?.buffered?.length ? event.target.buffered.end(event.target.buffered.length - 1) : 0);
    if (Number.isFinite(bufferedTime)) bufferedSeconds = bufferedTime;
    paintProgress();
  });
  if (instance.Events.TimeUpdate) instance.on(instance.Events.TimeUpdate, (event) => {
    if (token !== generation) return;
    lastTimeUpdateAt = Date.now();
    paintProgress(event.data?.currentTime ?? event.target?.currentTime);
  });
  if (instance.Events.DurationChange) instance.on(instance.Events.DurationChange, (event) => {
    if (token !== generation) return;
    currentDuration = event.data?.duration ?? event.target?.duration ?? currentDuration;
    paintProgress();
  });
  instance.on(instance.Events.Error, () => {
    if (token !== generation) return;
    showPlaybackError("Не удалось загрузить видео.");
  });
}

function markPlaying(instance, token) {
  if (token !== generation || instance !== player) return;
  clearTimeout(playbackTimeout);
  clearTimeout(playbackRetryTimer);
  playbackAttempts = 0;
  playbackConfirmed = true;
  hasFrame = true;
  playbackState(userPaused || document.hidden ? "paused" : "playing");
  status.hidden = true;
  retry.hidden = true;
  revealActive();
  if (userPaused || document.hidden) instance.pause().catch(() => {});
  else instance.isMuted().then((value) => {
    if (token === generation && instance === player) {
      muted = value;
      paintSound();
    }
  }).catch(() => {});
}

function schedulePlaybackCheck(instance, token, delay = 1200) {
  clearTimeout(playbackRetryTimer);
  playbackRetryTimer = setTimeout(async () => {
    if (token !== generation || instance !== player || userPaused || document.hidden) return;
    try {
      if (!(await instance.isPaused())) {
        markPlaying(instance, token);
        return;
      }
    } catch (error) { /* плеер может ещё загружаться */ }
    if (token !== generation || instance !== player || userPaused || document.hidden) return;
    if (++playbackAttempts >= 3) {
      showPlaybackError("Не удалось запустить видео. Попробуйте ещё раз.");
      return;
    }
    startPlayback(instance);
  }, delay);
}

function showPlaybackError(message) {
  clearTimeout(playbackTimeout);
  clearTimeout(playbackRetryTimer);
  playbackState("error");
  status.textContent = message;
  status.hidden = false;
  retry.hidden = false;
}

function watchForStall(token) {
  clearTimeout(playbackTimeout);
  playbackTimeout = setTimeout(() => {
    if (token === generation && !userPaused && !document.hidden) showPlaybackError("Видео загружается слишком долго.");
  }, 15000);
}

let mountingIndex = -1;

function show(index) {
  const next = Math.max(0, Math.min(FEED.length - 1, index));
  if (next === active && (player || mountingIndex === next)) {
    return;
  }
  const previous = player;
  if (previous) previous.pause().catch(() => {});
  const cachedReturn = cachedPrevious?.index === next;
  active = next;
  hasFrame = cachedReturn;
  playbackConfirmed = false;
  userPaused = false;
  visibilityPaused = false;
  currentDuration = 0;
  currentTime = 0;
  bufferedSeconds = 0;
  lastTimeUpdateAt = 0;
  seek.value = "0";
  scrub.style.width = "0%";
  buffered.style.width = "0%";
  timeLabel.textContent = "00:00";
  recordEvent("view");
  slides().forEach((slide, i) => slide.classList.toggle("is-active", i === active));
  muted = !soundWanted;
  paintSound();
  revealActive();
  playbackState("buffering");
  status.hidden = true;
  retry.hidden = true;
  mount(active);
}

function mount(index) {
  const token = ++generation;
  mountingIndex = index;
  playbackAttempts = 0;
  playbackConfirmed = false;
  clearTimeout(playbackRetryTimer);
  watchForStall(token);
  openVideo(index, token)
    .catch((error) => {
      if (token !== generation) return;
      showPlaybackError("Ролик не открылся.");
      document.documentElement.dataset.playerError = error && error.message ? error.message : String(error);
    })
    .then(() => {
      if (token === generation) mountingIndex = -1;
    });
}

let startRequest = null;

async function startPlayback(instance) {
  if (userPaused || document.hidden || instance !== player) return;
  const token = generation;
  if (startRequest?.instance === instance && startRequest.token === token) return startRequest.promise;
  const promise = (async () => {
    try { await instance.play(); }
    catch (error) {
      if (token === generation && instance === player && error?.name === "NotAllowedError") {
        if (soundWanted) {
          try {
            await instance.mute();
            muted = true;
            paintSound();
            await instance.play();
          } catch (fallbackError) {
            if (fallbackError?.name === "NotAllowedError") {
              userPaused = true;
              clearTimeout(playbackTimeout);
              playbackState("paused");
            }
          }
        } else {
          userPaused = true;
          clearTimeout(playbackTimeout);
          playbackState("paused");
        }
      }
    }
    if (token !== generation) {
      if (instance !== player) try { await instance.pause(); } catch (error) { /* ролик уже закрыт */ }
      return;
    }
    if (instance !== player || userPaused || document.hidden) {
      try { await instance.pause(); } catch (error) { /* ролик уже закрыт */ }
      return;
    }
    if (!playbackConfirmed) {
      try {
        if (!(await instance.isPaused())) markPlaying(instance, token);
      } catch (error) { /* событие Playing подтвердит запуск */ }
    }
  })();
  startRequest = { instance, token, promise };
  try { await promise; }
  finally {
    if (startRequest?.promise === promise) startRequest = null;
    if (token === generation && instance === player && !userPaused && !document.hidden && !playbackConfirmed) schedulePlaybackCheck(instance, token);
  }
}

async function openVideo(index, token) {
  if (token !== generation || (FEED[index].source !== "upload" && !factory)) return;
  const returning = cachedPrevious?.index === index ? cachedPrevious : null;
  if (returning) cachedPrevious = null;
  if (player) {
    const outgoing = { index: playerIndex, player };
    player = null;
    playerIndex = -1;
    if (outgoing.index === index) {
      try { await outgoing.player.destroy(); } catch (error) { /* повторная загрузка */ }
    } else {
      if (cachedPrevious) cachedPrevious.player.destroy().catch(() => {});
      cachedPrevious = outgoing;
    }
  }
  if (token !== generation) return;
  if (returning) {
    player = returning.player;
    playerIndex = index;
    bindPlayer(player, token);
  } else {
    const hostId = "play-" + (++hostSerial);
    const host = document.createElement("div");
    host.id = hostId;
    slides()[index].querySelector(".player-slot").appendChild(host);
    let instance;
    try {
      instance = FEED[index].source === "upload"
        ? createLocalPlayer(host, FEED[index], token === 1)
        : await factory.create(hostId, playerOptions(FEED[index].id, token === 1));
    } catch (error) {
      host.remove();
      throw error;
    }
    if (token !== generation) {
      await instance.destroy();
      host.remove();
      return;
    }
    player = instance;
    playerIndex = index;
    bindPlayer(instance, token);
  }
  const instance = player;
  document.documentElement.dataset.player = "ready";
  status.hidden = true;
  await startPlayback(instance);
}

function indexFromScroll() {
  const height = feed.clientHeight || 1;
  return Math.round(feed.scrollTop / height);
}

function boot(nextFactory) {
  factory = nextFactory;
  if (feedReady && feedEnabled && FEED.length && !player && mountingIndex < 0) {
    status.hidden = true;
    retry.hidden = true;
    playbackState("buffering");
    mount(active);
  }
}

function fitCaptions() {
  document.querySelectorAll(".bio").forEach((bio) => {
    const caption = bio.querySelector(".caption");
    const more = bio.querySelector(".more");
    const wasOpen = bio.classList.contains("is-open");
    bio.classList.remove("is-open");
    const overflow = caption.scrollHeight > caption.clientHeight + 1;
    if (wasOpen) bio.classList.add("is-open");
    more.hidden = !overflow;
  });
}

async function loadFeed() {
  try {
    const response = location.hostname.endsWith("github.io")
      ? null : await fetch("/api/state", { cache: "no-store" });
    if (response?.ok) {
      const state = await response.json();
      const params = new URLSearchParams(location.search);
      const preview = params.get("preview") === "1";
      analyticsReady = !preview;
      feedEnabled = !!state.enabled || preview;
      const requested = params.get("video");
      FEED = DEFAULT_FEED.map((item) => ({ ...item, ...(state.overrides?.[item.id] || {}) }))
        .filter((item) => !state.hiddenIds.includes(item.id) || item.id === requested)
        .concat(state.videos.filter((item) => item.active || item.id === requested));
    }
  } catch (error) { /* GitHub Pages показывает исходную ленту. */ }
  const params = new URLSearchParams(location.search);
  const collection = params.get("collection");
  if (collection) FEED = FEED.filter((item) => item.collection?.toLocaleLowerCase("ru") === collection.toLocaleLowerCase("ru"));
  const requestedIndex = FEED.findIndex((item) => item.id === params.get("video"));
  active = requestedIndex >= 0 ? requestedIndex : 0;
  if (!feedEnabled || !FEED.length) {
    feed.hidden = true;
    status.hidden = false;
    status.textContent = feedEnabled ? "В этой коллекции пока нет видео." : "Тревел лента сейчас выключена.";
    return;
  }
  render();
  playbackState("buffering");
  recordEvent("view");
  if (active) feed.scrollTop = active * feed.clientHeight;
  feedReady = true;
  requestAnimationFrame(() => requestAnimationFrame(fitCaptions));
  if (window.__kinescopeFactory) boot(window.__kinescopeFactory);
  else if (FEED[active].source === "upload") mount(active);
}

loadFeed();
window.addEventListener("resize", fitCaptions);

let scrollTimer = 0;
feed.addEventListener("scroll", () => {
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(() => {
    const index = indexFromScroll();
    const aligned = Math.abs(feed.scrollTop - index * feed.clientHeight) < feed.clientHeight * 0.15;
    if (!aligned) return;
    show(index);
  }, 80);
}, { passive: true });

async function togglePlayback() {
  const currentPlayer = player;
  if (!currentPlayer) return;
  try {
    if (userPaused) {
      userPaused = false;
      playbackConfirmed = false;
      playbackState("buffering");
      watchForStall(generation);
      await startPlayback(currentPlayer);
      return;
    }
    if (await currentPlayer.isPaused()) {
      userPaused = false;
      playbackConfirmed = false;
      playbackState("buffering");
      watchForStall(generation);
      await startPlayback(currentPlayer);
    } else {
      userPaused = true;
      clearTimeout(playbackTimeout);
      await currentPlayer.pause();
      playbackState("paused");
    }
  } catch (error) { showPlaybackError("Не удалось продолжить воспроизведение."); }
}

retry.addEventListener("click", () => {
  if (!factory && FEED[active]?.source !== "upload") { location.reload(); return; }
  status.hidden = true;
  retry.hidden = true;
  userPaused = false;
  hasFrame = false;
  revealActive();
  playbackState("buffering");
  mount(active);
});

document.addEventListener("click", async (event) => {
  if (event.target.closest(".offer")) recordEvent("offer_click");
  const action = event.target.closest("[data-action]");
  if (action) {
    const kind = action.dataset.action;
    if (kind === "sound") {
      soundWanted = muted;
      await applyMute();
    } else if (kind === "like") {
      const on = action.classList.toggle("is-on");
      action.innerHTML = on ? ICONS.heartOn : ICONS.heart;
      if (on) recordEvent("like");
    } else if (kind === "share" && navigator.share) {
      navigator.share({ title: "Тревел лента", url: location.href }).catch(() => {});
    } else if (kind === "more") {
      const bio = action.closest(".bio");
      const open = bio.classList.toggle("is-open");
      action.textContent = open ? "свернуть" : "ещё";
    }
    return;
  }
  if (!event.target.closest("#feed") || event.target.closest("a") || !player) return;
  await togglePlayback();
});

function formatTime(seconds) {
  const whole = Math.max(0, Math.floor(seconds || 0));
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return String(minutes).padStart(2, "0") + ":" + String(rest).padStart(2, "0");
}

function paintProgress(time = currentTime) {
  if (Number.isFinite(time)) currentTime = time;
  buffered.style.width = currentDuration > 0 ? `${Math.max(0, Math.min(100, bufferedSeconds / currentDuration * 100))}%` : "0%";
  if (seeking) return;
  const progress = currentDuration > 0 ? Math.max(0, Math.min(1, currentTime / currentDuration)) : 0;
  timeLabel.textContent = formatTime(currentTime);
  scrub.style.width = `${progress * 100}%`;
  seek.value = String(Math.round(progress * 1000));
}

setInterval(async () => {
  if (!player || document.hidden || Date.now() - lastTimeUpdateAt < 3500) return;
  const currentPlayer = player;
  try {
    const current = await currentPlayer.getCurrentTime();
    const duration = await currentPlayer.getDuration();
    if (currentPlayer !== player) return;
    currentDuration = Number.isFinite(duration) ? duration : 0;
    paintProgress(current);
  } catch (error) {
    /* плеер ещё переключается */
  }
}, 2000);

seek.addEventListener("pointerdown", () => { seeking = true; });
seek.addEventListener("input", () => {
  seeking = true;
  const progress = Number(seek.value) / 1000;
  scrub.style.width = progress * 100 + "%";
  timeLabel.textContent = formatTime(progress * currentDuration);
});
seek.addEventListener("change", async () => {
  const currentPlayer = player;
  if (currentPlayer && currentDuration > 0) {
    try { await currentPlayer.seekTo(Number(seek.value) / 1000 * currentDuration); }
    catch (error) { /* некоторые ролики ещё не допускают перемотку */ }
  }
  seeking = false;
});
seek.addEventListener("pointercancel", () => { seeking = false; });

document.addEventListener("visibilitychange", async () => {
  const currentPlayer = player;
  if (!currentPlayer) return;
  if (document.hidden) {
    visibilityPaused = !userPaused;
    try {
      if (!(await currentPlayer.isPaused())) await currentPlayer.pause();
    } catch (error) { /* плеер уже переключается */ }
  } else if (visibilityPaused && !userPaused && currentPlayer === player) {
    visibilityPaused = false;
    playbackConfirmed = false;
    playbackState("buffering");
    watchForStall(generation);
    await startPlayback(currentPlayer);
  }
});

setInterval(() => {
  if (player && analyticsReady && !document.hidden && document.documentElement.dataset.playback === "playing") recordEvent("watch_tick");
}, 5000);

window.addEventListener("keydown", (event) => {
  if (event.target.closest("input, textarea, select, button, a, [contenteditable]")) return;
  if (event.key === " " || event.key === "Spacebar") {
    event.preventDefault();
    togglePlayback();
    return;
  }
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  event.preventDefault();
  const delta = event.key === "ArrowDown" ? 1 : -1;
  const index = Math.max(0, Math.min(FEED.length - 1, active + delta));
  slides()[index].scrollIntoView({ block: "start" });
});

window.addEventListener("kinescope-ready", () => boot(window.__kinescopeFactory), { once: true });

setTimeout(() => {
  if (feedReady && !player && !factory && FEED[active]?.source !== "upload") showPlaybackError("Плеер Кинескопа не ответил.");
}, 12000);
