let FEED = DEFAULT_FEED.slice();
let feedEnabled = true;

const feed = document.getElementById("feed");
const status = document.getElementById("status");
const scrub = document.getElementById("scrub");
const seek = document.getElementById("seek");
const retry = document.getElementById("retry");
const LIKE_COUNTS_KEY = "tututiktok-like-counts-v1";

function loadLikeCounts() {
  try {
    const value = JSON.parse(localStorage.getItem(LIKE_COUNTS_KEY) || "{}");
    return value && typeof value === "object" ? value : {};
  } catch (error) { return {}; }
}

const likeCounts = loadLikeCounts();

function likeCountFor(videoId) {
  const stored = Number(likeCounts[videoId]);
  if (Number.isInteger(stored) && stored >= 11) return stored;
  const initial = 11 + Math.floor(Math.random() * 40);
  likeCounts[videoId] = initial;
  try { localStorage.setItem(LIKE_COUNTS_KEY, JSON.stringify(likeCounts)); } catch (error) { /* storage may be unavailable */ }
  return initial;
}

function saveLikeCounts() {
  try { localStorage.setItem(LIKE_COUNTS_KEY, JSON.stringify(likeCounts)); } catch (error) { /* storage may be unavailable */ }
}

const ICONS = {
  heart: '<span class="heart-icon" aria-hidden="true"></span>',
  share: '<span class="share-icon" aria-hidden="true"></span>',
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
let lastTimeUpdateAt = 0;
const pendingProgressReads = new WeakSet();
let playbackTimeout = 0;
let playbackRetryTimer = 0;
let playbackAttempts = 0;
let playbackConfirmed = false;
let mutedAutoplayFallbackTried = false;
let recoveryCount = 0;
let bandwidthTimer = 0;
let bufferedUntil = 0;
let lastBufferReportAt = 0;
let playingSince = 0;
let everPlayedCurrent = false;
let constrainedUntil = 0;

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

function hotelStay(offer) {
  try {
    const url = new URL(offer.href);
    const checkIn = url.searchParams.get("check_in");
    const checkOut = url.searchParams.get("check_out");
    const guests = Number(url.searchParams.get("room[0]"));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(checkIn || "") || !/^\d{4}-\d{2}-\d{2}$/.test(checkOut || "")) return "";
    const format = (value) => {
      const date = new Date(`${value}T12:00:00Z`);
      if (Number.isNaN(date.getTime())) return "";
      const parts = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" }).formatToParts(date);
      const day = parts.find((part) => part.type === "day")?.value;
      const month = parts.find((part) => part.type === "month")?.value;
      return day && month ? `${day} ${month.slice(0, 3)}` : "";
    };
    const dates = `${format(checkIn)} — ${format(checkOut)}`;
    if (dates.startsWith(" — ") || dates.endsWith(" — ")) return "";
    if (!Number.isInteger(guests) || guests < 1) return dates;
    const form = guests % 10 === 1 && guests % 100 !== 11 ? "гость"
      : guests % 10 >= 2 && guests % 10 <= 4 && (guests % 100 < 12 || guests % 100 > 14) ? "гостя" : "гостей";
    return `${dates}, ${guests} ${form}`;
  } catch (error) {
    return "";
  }
}

function isHotelOffer(offer) {
  if (offer.type === "hotel") return true;
  try { return new URL(offer.href).hostname === "hotel.tutu.ru"; }
  catch (error) { return false; }
}

function iconButton(action, label, svg, count) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "rail-btn";
  button.dataset.action = action;
  button.setAttribute("aria-label", count === undefined ? label : `${label}: ${count}`);
  if (action === "like") button.setAttribute("aria-pressed", "false");
  button.innerHTML = svg;
  if (count !== undefined) {
    const countNode = document.createElement("span");
    countNode.className = "rail-count";
    countNode.textContent = String(count);
    button.append(countNode);
  }
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
      iconButton("like", "Нравится", ICONS.heart, likeCountFor(item.id)),
      iconButton("share", "Поделиться", ICONS.share)
    );
    slide.appendChild(rail);

    const dock = document.createElement("div");
    dock.className = "dock";

    const author = document.createElement("div");
    author.className = "author bio";
    const authorLine = document.createElement("div");
    authorLine.className = "author-line";
    const avatar = document.createElement("span");
    avatar.className = "avatar";
    const authorName = item.streamerId ? item.streamerName : "";
    const authorAvatar = item.streamerId ? item.streamerAvatar : "";
    avatar.textContent = (authorName || "Б").slice(0, 1).toUpperCase();
    if (authorAvatar) {
      const picture = document.createElement("img");
      picture.src = authorAvatar; picture.alt = "";
      picture.loading = "lazy";
      avatar.replaceChildren(picture);
    }
    const name = document.createElement("p");
    name.className = "name";
    name.textContent = authorName || "Блогеры рекомендуют";
    const caption = document.createElement("p");
    caption.className = "caption";
    caption.textContent = item.text;
    const captionLine = document.createElement("div");
    captionLine.className = "caption-line";
    const more = document.createElement("button");
    more.type = "button";
    more.className = "more";
    more.dataset.action = "more";
    more.hidden = true;
    more.textContent = "ещё";
    authorLine.append(avatar, name);
    captionLine.append(caption, more);
    author.append(authorLine, captionLine);
    dock.appendChild(author);

    (item.offers || []).forEach((offer) => {
      const card = document.createElement("a");
      const hotelOffer = isHotelOffer(offer);
      card.className = hotelOffer ? "offer offer--hotel" : "offer";
      card.href = offer.href;
      card.target = "_blank";
      card.rel = "noopener noreferrer";
      card.setAttribute("aria-label", offer.label || offer.title);

      const thumb = document.createElement("img");
      thumb.className = "thumb";
      thumb.alt = "";
      const thumbUrl = offer.image || posterFor(item);
      if (index === active) thumb.src = thumbUrl;
      else thumb.dataset.src = thumbUrl;
      thumb.loading = index === active ? "eager" : "lazy";
      thumb.decoding = "async";
      thumb.fetchPriority = "low";

      const text = document.createElement("span");
      text.className = "offer-text";
      const offerTitle = document.createElement("span");
      offerTitle.className = "offer-title";
      offerTitle.textContent = offer.title;
      const offerDetail = document.createElement("span");
      offerDetail.className = hotelOffer ? "offer-stay" : "offer-price";
      offerDetail.textContent = hotelOffer ? hotelStay(offer) || offer.price : offer.price;
      text.append(offerTitle, offerDetail);

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

function loadOfferImages(index) {
  const slide = slides()[index];
  if (!slide) return;
  slide.querySelectorAll(".thumb[data-src]").forEach((image) => {
    image.src = image.dataset.src;
    delete image.dataset.src;
  });
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

let factory = null;
let cachedPrevious = null;
const preloadedNeighbors = new Map();
let preloadTimer = 0;
let playerIndex = -1;
let hostSerial = 0;
let scrollDirection = 1;

function qualityCap() {
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (connection?.saveData || /2g/.test(connection?.effectiveType || "")) return 360;
  if (recoveryCount || Date.now() < constrainedUntil || connection?.effectiveType === "3g") return 480;
  return 720;
}

function playerOptions(id, autoPlay = false, preload = "auto") {
  return {
    url: "https://kinescope.io/" + id,
    size: { width: "100%", height: "100%" },
    behavior: {
      autoPlay,
      muted: !soundWanted,
      loop: true,
      playsInline: true,
      preload,
      maxAbrQuality: qualityCap(),
      keyboard: false,
      autoPause: false,
      localStorage: { time: false, quality: false },
    },
    ui: {
      language: "ru",
      controls: false,
      mainPlayButton: false,
    },
  };
}

function createLocalPlayer(host, item, autoPlay = false, preload = "auto") {
  const video = document.createElement("video");
  video.src = item.mediaUrl;
  video.muted = !soundWanted;
  video.autoplay = autoPlay;
  video.loop = true;
  video.playsInline = true;
  video.preload = preload;
  host.appendChild(video);
  video.load();
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

function discardPreload(entry) {
  if (!entry) return;
  entry.cancelled = true;
  if (entry.player) entry.player.destroy().catch(() => {}).finally(() => entry.host.remove());
  else entry.host.remove();
}

async function createKinescopePlayer(hostId, options, timeoutMs) {
  let timer = 0;
  let expired = false;
  const pending = factory.create(hostId, options);
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      expired = true;
      reject(new Error("Плеер не ответил вовремя"));
    }, timeoutMs);
  });
  try {
    return await Promise.race([pending, deadline]);
  } finally {
    clearTimeout(timer);
    if (expired) pending.then((instance) => instance.destroy().catch(() => {})).catch(() => {});
  }
}

async function takePreparedPlayer(entry) {
  let timer = 0;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), 2400);
  });
  try {
    const instance = await Promise.race([entry.promise, deadline]);
    if (!instance) discardPreload(entry);
    return instance;
  } finally {
    clearTimeout(timer);
  }
}

function prewarmNeighbor(offset) {
  const index = active + offset;
  if (index < 0 || index >= FEED.length || cachedPrevious?.index === index) return;
  if (FEED[index].source !== "upload" && !factory) return;
  if (preloadedNeighbors.has(index)) return;
  const hostId = "play-" + (++hostSerial);
  const host = document.createElement("div");
  host.id = hostId;
  slides()[index].querySelector(".player-slot").appendChild(host);
  const entry = { index, host, player: null, cancelled: false, promise: null };
  preloadedNeighbors.set(index, entry);
  const initialSoundWanted = soundWanted;
  const preload = offset === scrollDirection ? "auto" : "metadata";
  entry.promise = (async () => {
    try {
      const instance = FEED[index].source === "upload"
        ? createLocalPlayer(host, FEED[index], false, preload)
        : await createKinescopePlayer(hostId, playerOptions(FEED[index].id, false, preload), 8000);
      if (entry.cancelled) {
        await instance.destroy().catch(() => {});
        host.remove();
        return null;
      }
      entry.player = instance;
      if (initialSoundWanted !== soundWanted) {
        (soundWanted ? instance.unmute() : instance.mute()).catch(() => {});
      }
      instance.on(instance.Events.Playing, () => {
        if (instance !== player) instance.pause().catch(() => {});
      });
      return instance;
    } catch (error) {
      host.remove();
      if (preloadedNeighbors.get(index) === entry) preloadedNeighbors.delete(index);
      if (!entry.cancelled) failedPreloads.add(index);
      return null;
    }
  })();
  return entry;
}

const failedPreloads = new Set();

function continuePreloading(entry, token) {
  if (entry.nextToken === token) return;
  entry.nextToken = token;
  entry.promise.then(() => {
    if (!entry.cancelled && token === generation && playbackConfirmed && !document.hidden) schedulePreload(token, 600);
  });
}

function prewarmNeighbors() {
  const token = generation;
  const pending = [...preloadedNeighbors.values()].find((entry) => !entry.player && !entry.cancelled);
  if (pending) {
    continuePreloading(pending, token);
    return;
  }
  const offsets = scrollDirection < 0 ? [-1, 1, 2] : [1, 2, -1];
  const next = offsets.find((offset) => !hasPreparedNeighbor(active + offset) && !failedPreloads.has(active + offset));
  if (next === undefined) return;
  const entry = prewarmNeighbor(next);
  if (entry) continuePreloading(entry, token);
}

function releasePreloads() {
  clearTimeout(preloadTimer);
  preloadTimer = 0;
  for (const entry of preloadedNeighbors.values()) discardPreload(entry);
  preloadedNeighbors.clear();
}

function prunePreloads(index) {
  for (const [preparedIndex, entry] of preloadedNeighbors) {
    if (preparedIndex !== index && preparedIndex >= index - 1 && preparedIndex <= index + 2 &&
        preparedIndex !== cachedPrevious?.index) continue;
    preloadedNeighbors.delete(preparedIndex);
    discardPreload(entry);
  }
}

function schedulePreload(token, delay = 500) {
  clearTimeout(preloadTimer);
  preloadTimer = setTimeout(() => {
    preloadTimer = 0;
    if (token !== generation || !player || !playbackConfirmed || userPaused || document.hidden) return;
    const recentBufferReport = Date.now() - lastBufferReportAt < 5000;
    const bufferAhead = bufferedUntil - currentTime;
    if (recentBufferReport && bufferAhead < 3 && Date.now() - playingSince < 5000) {
      schedulePreload(token, 500);
      return;
    }
    prewarmNeighbors();
  }, delay);
}

function hasPreparedNeighbor(index) {
  return index < 0 || index >= FEED.length || cachedPrevious?.index === index ||
    preloadedNeighbors.has(index);
}

function beginBuffering(token) {
  if (token !== generation) return;
  playbackConfirmed = false;
  playbackState("buffering");
  clearTimeout(preloadTimer);
  preloadTimer = 0;
  watchForStall(token);
  if (!bandwidthTimer) {
    bandwidthTimer = setTimeout(() => {
      bandwidthTimer = 0;
      if (token === generation && !playbackConfirmed && !document.hidden) {
        if (everPlayedCurrent) constrainedUntil = Date.now() + 30000;
        releasePreloads();
      }
    }, 1200);
  }
}

const boundPlayerTokens = new WeakMap();

function bindPlayer(instance, token) {
  if (boundPlayerTokens.has(instance)) {
    boundPlayerTokens.set(instance, token);
    return;
  }
  boundPlayerTokens.set(instance, token);
  const currentToken = () => boundPlayerTokens.get(instance);
  if (instance.Events.VolumeChange) instance.on(instance.Events.VolumeChange, (event) => {
    if (currentToken() !== generation || instance !== player) return;
    if (typeof event.data?.muted === "boolean") {
      muted = event.data.muted;
    }
  });
  if (instance.Events.Loaded) instance.on(instance.Events.Loaded, () => {
    if (currentToken() !== generation || instance !== player) return;
    refreshProgress(instance, currentToken());
    if (!hasFrame && !userPaused) startPlayback(instance);
  });
  instance.on(instance.Events.Playing, () => {
    const token = currentToken();
    if (token !== generation) {
      if (instance !== player) instance.pause().catch(() => {});
      return;
    }
    markPlaying(instance, token);
  });
  instance.on(instance.Events.Pause, () => {
    const token = currentToken();
    if (token !== generation) return;
    if (userPaused || visibilityPaused || document.hidden) playbackState("paused");
    else if (instance === player) {
      beginBuffering(token);
      schedulePlaybackCheck(instance, token, 350);
    }
  });
  if (instance.Events.Waiting) instance.on(instance.Events.Waiting, () => {
    const token = currentToken();
    if (token === generation && !userPaused && !document.hidden) {
      beginBuffering(token);
    }
  });
  if (instance.Events.TimeUpdate) instance.on(instance.Events.TimeUpdate, (event) => {
    if (currentToken() !== generation) return;
    const time = event.data?.currentTime ?? event.target?.currentTime;
    if (Number.isFinite(time)) {
      lastTimeUpdateAt = Date.now();
      paintProgress(time);
      if (!playbackConfirmed && time > 0 && !userPaused && instance === player) markPlaying(instance, currentToken());
    }
  });
  if (instance.Events.Progress) instance.on(instance.Events.Progress, (event) => {
    if (currentToken() !== generation || instance !== player) return;
    let buffered = event.data?.bufferedTime;
    const ranges = event.target?.buffered;
    if (!Number.isFinite(buffered) && ranges?.length) buffered = ranges.end(ranges.length - 1);
    if (Number.isFinite(buffered) && buffered > bufferedUntil) {
      bufferedUntil = buffered;
      lastBufferReportAt = Date.now();
      if (!playbackConfirmed && !userPaused && !document.hidden) {
        clearTimeout(playbackTimeout);
        playbackTimeout = 0;
        watchForStall(currentToken());
      }
    }
  });
  if (instance.Events.DurationChange) instance.on(instance.Events.DurationChange, (event) => {
    if (currentToken() !== generation) return;
    const duration = event.data?.duration ?? event.target?.duration;
    if (Number.isFinite(duration) && duration > 0) currentDuration = duration;
    paintProgress();
  });
  instance.on(instance.Events.Error, (event) => {
    if (currentToken() !== generation || instance !== player) return;
    document.documentElement.dataset.playerError = String(event?.data?.error?.message || event?.data?.error || "Kinescope player error");
    failPlayback("Не удалось загрузить видео.");
  });
}

function markPlaying(instance, token) {
  if (token !== generation || instance !== player) return;
  const firstConfirmation = !playbackConfirmed;
  if (firstConfirmation) playingSince = Date.now();
  clearTimeout(playbackTimeout);
  playbackTimeout = 0;
  clearTimeout(playbackRetryTimer);
  clearTimeout(bandwidthTimer);
  bandwidthTimer = 0;
  playbackAttempts = 0;
  playbackConfirmed = true;
  everPlayedCurrent = true;
  hasFrame = true;
  playbackState(userPaused || document.hidden ? "paused" : "playing");
  status.hidden = true;
  retry.hidden = true;
  revealActive();
  if (firstConfirmation && (!hasPreparedNeighbor(active + 1) || !hasPreparedNeighbor(active + 2) ||
      !hasPreparedNeighbor(active - 1))) schedulePreload(token, recoveryCount ? 4000 : 1200);
  refreshProgress(instance, token);
  if (userPaused || document.hidden) instance.pause().catch(() => {});
  else instance.isMuted().then((value) => {
    if (token === generation && instance === player) {
      muted = value;
    }
  }).catch(() => {});
}

function schedulePlaybackCheck(instance, token, delay = 1200) {
  clearTimeout(playbackRetryTimer);
  playbackRetryTimer = setTimeout(async () => {
    if (token !== generation || instance !== player || userPaused || document.hidden) return;
    try {
      if (!(await instance.isPaused())) {
        if (token !== generation || instance !== player || userPaused || document.hidden) return;
        const time = await instance.getCurrentTime();
        if (token !== generation || instance !== player || userPaused || document.hidden) return;
        if (Number.isFinite(time) && time > 0) {
          markPlaying(instance, token);
          paintProgress(time);
          return;
        }
        schedulePlaybackCheck(instance, token, 500);
        return;
      }
    } catch (error) { /* плеер может ещё загружаться */ }
    if (token !== generation || instance !== player || userPaused || document.hidden) return;
    playbackAttempts += 1;
    if (playbackAttempts === 2 && soundWanted && !mutedAutoplayFallbackTried) {
      mutedAutoplayFallbackTried = true;
      try {
        await instance.mute();
        if (token !== generation || instance !== player || userPaused || document.hidden) return;
        muted = true;
      } catch (error) { /* плеер может ещё загружаться */ }
    }
    if (playbackAttempts >= 3) {
      // Плеер может оставаться на паузе, пока загружает первый сегмент.
      schedulePlaybackCheck(instance, token, 2000);
      return;
    }
    startPlayback(instance);
  }, delay);
}

function showPlaybackError(message) {
  releasePreloads();
  if (cachedPrevious) {
    cachedPrevious.player.destroy().catch(() => {});
    cachedPrevious = null;
  }
  clearTimeout(playbackTimeout);
  playbackTimeout = 0;
  clearTimeout(playbackRetryTimer);
  clearTimeout(bandwidthTimer);
  bandwidthTimer = 0;
  playbackState("error");
  status.textContent = message;
  status.hidden = false;
  retry.hidden = false;
}

function failPlayback(message) {
  if (recoveryCount === 0 && !userPaused && !document.hidden) {
    recoveryCount = 1;
    constrainedUntil = Date.now() + 60000;
    releasePreloads();
    if (cachedPrevious) cachedPrevious.player.destroy().catch(() => {});
    cachedPrevious = null;
    status.hidden = true;
    retry.hidden = true;
    playbackState("buffering");
    mount(active);
    return;
  }
  showPlaybackError(message);
}

function watchForStall(token) {
  if (playbackTimeout) return;
  playbackTimeout = setTimeout(() => {
    playbackTimeout = 0;
    if (token === generation && !userPaused && !document.hidden) failPlayback("Видео загружается слишком долго.");
  }, recoveryCount ? 16000 : 12000);
}

let mountingIndex = -1;

function show(index) {
  const next = Math.max(0, Math.min(FEED.length - 1, index));
  if (next === active && (player || mountingIndex === next)) {
    return;
  }
  if (next !== active) scrollDirection = next > active ? 1 : -1;
  if (next !== active) {
    recoveryCount = 0;
    failedPreloads.clear();
  }
  const previous = player;
  if (previous) previous.pause().catch(() => {});
  clearTimeout(preloadTimer);
  const cachedReturn = cachedPrevious?.index === next;
  active = next;
  hasFrame = cachedReturn;
  playbackConfirmed = false;
  userPaused = false;
  visibilityPaused = false;
  currentDuration = 0;
  currentTime = 0;
  lastTimeUpdateAt = 0;
  bufferedUntil = 0;
  lastBufferReportAt = 0;
  playingSince = 0;
  everPlayedCurrent = false;
  seek.value = "0";
  seek.setAttribute("aria-valuetext", "Видео загружается");
  scrub.style.width = "0%";
  recordEvent("view");
  slides().forEach((slide, i) => slide.classList.toggle("is-active", i === active));
  loadOfferImages(active);
  muted = !soundWanted;
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
  mutedAutoplayFallbackTried = false;
  bufferedUntil = 0;
  lastBufferReportAt = 0;
  playingSince = 0;
  clearTimeout(playbackRetryTimer);
  clearTimeout(playbackTimeout);
  playbackTimeout = 0;
  watchForStall(token);
  beginBuffering(token);
  openVideo(index, token)
    .catch((error) => {
      if (token !== generation) return;
      document.documentElement.dataset.playerError = error && error.message ? error.message : String(error);
      failPlayback("Ролик не открылся.");
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
            await instance.play();
          } catch (fallbackError) {
            if (fallbackError?.name === "NotAllowedError") {
              userPaused = true;
              clearTimeout(playbackTimeout);
              playbackTimeout = 0;
              playbackState("paused");
            }
          }
        } else {
          userPaused = true;
          clearTimeout(playbackTimeout);
          playbackTimeout = 0;
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
  const prepared = preloadedNeighbors.get(index);
  if (prepared) preloadedNeighbors.delete(index);
  const warmed = returning ? null : prepared;
  if (returning && prepared) discardPreload(prepared);
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
  if (token !== generation) {
    if (warmed) discardPreload(warmed);
    if (returning) returning.player.destroy().catch(() => {});
    return;
  }
  if (cachedPrevious && Math.abs(cachedPrevious.index - index) > 1) {
    cachedPrevious.player.destroy().catch(() => {});
    cachedPrevious = null;
  }
  prunePreloads(index);
  let instance = returning?.player || (warmed ? await takePreparedPlayer(warmed) : null);
  if (token !== generation) {
    if (instance && !returning) await instance.destroy().catch(() => {});
    if (returning) await returning.player.destroy().catch(() => {});
    warmed?.host.remove();
    return;
  }
  if (!instance) {
    const hostId = "play-" + (++hostSerial);
    const host = document.createElement("div");
    host.id = hostId;
    slides()[index].querySelector(".player-slot").appendChild(host);
    try {
      instance = FEED[index].source === "upload"
        ? createLocalPlayer(host, FEED[index], token === 1)
        : await createKinescopePlayer(hostId, playerOptions(FEED[index].id, token === 1), 12000);
    } catch (error) {
      host.remove();
      throw error;
    }
    if (token !== generation) {
      await instance.destroy();
      host.remove();
      return;
    }
  }
  player = instance;
  playerIndex = index;
  bindPlayer(instance, token);
  refreshProgress(instance, token, true);
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
  } else if (player && playbackConfirmed) schedulePreload(generation);
}

function fitCaptions() {
  document.querySelectorAll(".bio").forEach((bio) => {
    const caption = bio.querySelector(".caption");
    const more = bio.querySelector(".more");
    const wasOpen = bio.classList.contains("is-open");
    bio.classList.remove("is-open");
    more.hidden = true;
    const overflow = caption.scrollWidth > caption.clientWidth + 1;
    if (wasOpen && overflow) bio.classList.add("is-open");
    more.textContent = wasOpen && overflow ? "свернуть" : "ещё";
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
  const requestedIndex = FEED.findIndex((item) => item.id === params.get("video"));
  active = requestedIndex >= 0 ? requestedIndex : 0;
  if (!feedEnabled || !FEED.length) {
    feed.hidden = true;
    status.hidden = false;
    status.textContent = feedEnabled ? "В ленте пока нет видео." : "Тревел лента сейчас выключена.";
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

let scrollFrame = 0;
let scrollSettleTimer = 0;
feed.addEventListener("scroll", () => {
  clearTimeout(scrollSettleTimer);
  scrollSettleTimer = setTimeout(() => {
    scrollSettleTimer = 0;
    const index = indexFromScroll();
    if (index !== active) show(index);
  }, 80);
  if (scrollFrame) return;
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0;
    const index = indexFromScroll();
    const height = feed.clientHeight || 1;
    if (index !== active && Math.abs(feed.scrollTop - index * height) < height * 0.08) {
      clearTimeout(scrollSettleTimer);
      scrollSettleTimer = 0;
      show(index);
    }
  });
}, { passive: true });

async function togglePlayback() {
  const currentPlayer = player;
  if (!currentPlayer) return;
  try {
    if (userPaused) {
      userPaused = false;
      playbackConfirmed = false;
      playbackAttempts = 0;
      playbackState("buffering");
      watchForStall(generation);
      await startPlayback(currentPlayer);
      return;
    }
    if (await currentPlayer.isPaused()) {
      userPaused = false;
      playbackConfirmed = false;
      playbackAttempts = 0;
      playbackState("buffering");
      watchForStall(generation);
      await startPlayback(currentPlayer);
    } else {
      userPaused = true;
      clearTimeout(playbackTimeout);
      playbackTimeout = 0;
      await currentPlayer.pause();
      playbackState("paused");
    }
  } catch (error) { showPlaybackError("Не удалось продолжить воспроизведение."); }
}

retry.addEventListener("click", () => {
  if (!factory && FEED[active]?.source !== "upload") { location.reload(); return; }
  status.hidden = true;
  retry.hidden = true;
  recoveryCount = 0;
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
    if (kind === "like") {
      const on = action.classList.toggle("is-on");
      action.setAttribute("aria-pressed", String(on));
      const slide = action.closest(".slide");
      const item = FEED[Number(slide?.dataset.index)];
      if (item) {
        likeCounts[item.id] = Math.max(0, likeCountFor(item.id) + (on ? 1 : -1));
        action.querySelector(".rail-count").textContent = String(likeCounts[item.id]);
        action.setAttribute("aria-label", `Нравится: ${likeCounts[item.id]}`);
        saveLikeCounts();
      }
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
  if (muted && soundWanted) {
    const currentPlayer = player;
    const shouldResume = userPaused || await currentPlayer.isPaused().catch(() => false);
    if (currentPlayer !== player) return;
    try {
      await currentPlayer.unmute();
      if (currentPlayer === player) muted = await currentPlayer.isMuted();
    } catch (error) { /* браузер может запретить звук до следующего действия */ }
    if (shouldResume && currentPlayer === player) {
      userPaused = false;
      playbackConfirmed = false;
      playbackAttempts = 0;
      playbackState("buffering");
      watchForStall(generation);
      await startPlayback(currentPlayer);
    }
    return;
  }
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
  if (seeking) return;
  const progress = currentDuration > 0 ? Math.max(0, Math.min(1, currentTime / currentDuration)) : 0;
  scrub.style.width = `${progress * 100}%`;
  seek.value = String(Math.round(progress * 1000));
  seek.setAttribute("aria-valuetext", currentDuration > 0 ? `${formatTime(currentTime)} из ${formatTime(currentDuration)}` : "Видео загружается");
}

async function refreshProgress(instance, token, includeTime = false) {
  if (!instance || pendingProgressReads.has(instance)) return;
  pendingProgressReads.add(instance);
  const eventAtStart = lastTimeUpdateAt;
  try {
    const [timeResult, durationResult] = await Promise.allSettled([
      includeTime || Date.now() - lastTimeUpdateAt > 1500 ? instance.getCurrentTime() : Promise.resolve(undefined),
      currentDuration > 0 ? Promise.resolve(undefined) : instance.getDuration(),
    ]);
    if (token !== generation || instance !== player) return;
    const duration = durationResult.status === "fulfilled" ? durationResult.value : undefined;
    if (Number.isFinite(duration) && duration > 0) currentDuration = duration;
    const time = timeResult.status === "fulfilled" ? timeResult.value : undefined;
    if (Number.isFinite(time) && lastTimeUpdateAt === eventAtStart) paintProgress(time);
    else paintProgress();
  } catch (error) {
    /* плеер ещё не готов ответить; следующая проверка повторит запрос */
  } finally {
    pendingProgressReads.delete(instance);
  }
}

setInterval(() => {
  if (!player || document.hidden || (currentDuration > 0 && Date.now() - lastTimeUpdateAt < 1500)) return;
  refreshProgress(player, generation);
}, 1000);

seek.addEventListener("pointerdown", () => { seeking = true; });
seek.addEventListener("input", () => {
  seeking = true;
  const progress = Number(seek.value) / 1000;
  scrub.style.width = progress * 100 + "%";
  seek.setAttribute("aria-valuetext", currentDuration > 0 ? `${formatTime(progress * currentDuration)} из ${formatTime(currentDuration)}` : `${Math.round(progress * 100)}%`);
});
seek.addEventListener("change", async () => {
  const currentPlayer = player;
  const targetTime = Number(seek.value) / 1000 * currentDuration;
  if (currentPlayer && currentDuration > 0) {
    try {
      await currentPlayer.seekTo(targetTime);
      if (currentPlayer === player) currentTime = targetTime;
    }
    catch (error) { /* некоторые ролики ещё не допускают перемотку */ }
  }
  seeking = false;
  if (currentPlayer === player) paintProgress();
});
seek.addEventListener("pointercancel", () => { seeking = false; paintProgress(); });

document.addEventListener("visibilitychange", async () => {
  const currentPlayer = player;
  if (!currentPlayer) return;
  if (document.hidden) {
    visibilityPaused = !userPaused;
    releasePreloads();
    clearTimeout(playbackTimeout);
    playbackTimeout = 0;
    clearTimeout(playbackRetryTimer);
    try {
      if (!(await currentPlayer.isPaused())) await currentPlayer.pause();
    } catch (error) { /* плеер уже переключается */ }
  } else if (visibilityPaused && !userPaused && currentPlayer === player) {
    visibilityPaused = false;
    playbackConfirmed = false;
    playbackAttempts = 0;
    playbackState("buffering");
    watchForStall(generation);
    await startPlayback(currentPlayer);
  }
});

window.addEventListener("online", () => {
  failedPreloads.clear();
  constrainedUntil = 0;
  if (player && playbackConfirmed && !document.hidden) schedulePreload(generation, 900);
});

window.addEventListener("offline", () => {
  releasePreloads();
});

window.addEventListener("pagehide", () => {
  releasePreloads();
  if (player) player.destroy().catch(() => {});
  if (cachedPrevious) cachedPrevious.player.destroy().catch(() => {});
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
