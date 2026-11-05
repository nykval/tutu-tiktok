const feedStartedAt = Date.now();
let FEED = DEFAULT_FEED.slice();
let feedEnabled = true;

const feed = document.getElementById("feed");
const status = document.getElementById("status");
let scrub = document.getElementById("scrub");
let seek = document.getElementById("seek");
const retry = document.getElementById("retry");
const sharedPlayerSlot = document.getElementById("shared-player-slot");
const firstPlayButton = document.getElementById("first-play-button");
const offerViewer = document.getElementById("offer-viewer");
const offerViewerClose = document.getElementById("offer-viewer-close");
const offerViewerFrame = document.getElementById("offer-viewer-frame");
const offerViewerExternal = document.getElementById("offer-viewer-external");
const LIKE_COUNTS_KEY = "tututiktok-like-counts-v1";
const RETURN_VIDEO_KEY = "tututiktok-return-video-v1";

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
let offerViewerWasPlaying = false;
let active = 0;
let muted = false;
let soundWanted = true;
let soundUnlocked = false;
let generation = 0;
let feedReady = false;
let analyticsReady = false;
let hasFrame = false;
let userPaused = false;
let awaitingFirstPlay = true;
let visibilityPaused = false;
let seeking = false;
let currentTime = 0;
let currentDuration = 0;
let lastTimeUpdateAt = 0;
const pendingProgressReads = new WeakSet();
let playbackTimeout = 0;
let playbackRetryTimer = 0;
let playbackTapTimer = 0;
let lastPlaybackTap = null;
const DOUBLE_TAP_MS = 320;
let playbackAttempts = 0;
let playbackConfirmed = false;
let recoveryCount = 0;
let bandwidthTimer = 0;
let bufferedUntil = 0;
let lastBufferReportAt = 0;
let playingSince = 0;
let everPlayedCurrent = false;
let constrainedUntil = 0;
let playbackStartedAt = 0;
let switchStartedAt = 0;

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

const TRANSPORT_ART_PATHS = {
  airplane: "transport-airplane.png",
  bus: "transport-bus.png",
  car: "transport-car.png",
  train: "transport-train.png",
};

const TRANSPORT_ICON_ALIASES = {
  airplane: "airplane", plane: "airplane", flight: "airplane", avia: "airplane", air: "airplane",
  самолет: "airplane", самолёт: "airplane", авиа: "airplane", авиабилет: "airplane", рейс: "airplane",
  bus: "bus", автобус: "bus", coach: "bus",
  car: "car", auto: "car", автомобиль: "car", машина: "car", такси: "car", taxi: "car", авто: "car",
  train: "train", rail: "train", railway: "train", поезд: "train", "ж/д": "train", ржд: "train",
};

function normalizedTransportKind(value) {
  const key = String(value || "").trim().toLocaleLowerCase("ru").replace(/[ё]/g, "е");
  if (!key) return "";
  if (TRANSPORT_ICON_ALIASES[key]) return TRANSPORT_ICON_ALIASES[key];
  return Object.entries(TRANSPORT_ICON_ALIASES).find(([alias]) => key.includes(alias))?.[1] || "";
}

function transportKindFor(offer) {
  const explicit = offer.transportType || offer.transportMode || offer.vehicleType || offer.transportIcon || offer.icon;
  const explicitKind = normalizedTransportKind(explicit);
  if (explicitKind) return explicitKind;

  const text = [offer.title, offer.label, offer.description, offer.sku, offer.href].filter(Boolean).join(" ").toLocaleLowerCase("ru");
  if (/(самол|авиа|рейс|flight|avia|airline|airport)/i.test(text)) return "airplane";
  if (/(поезд|ж\/?д|ржд|train|railway|rail\b)/i.test(text)) return "train";
  if (/(автобус|bus|coach)/i.test(text)) return "bus";
  if (/(автомобил|машин|такси|авто|car|auto|taxi)/i.test(text)) return "car";
  return "airplane";
}

function isTransportOffer(offer) {
  if (offer.type === "transport") return true;
  const explicit = offer.transportType || offer.transportMode || offer.vehicleType || offer.transportIcon;
  if (normalizedTransportKind(explicit)) return true;
  try {
    const hostname = new URL(offer.href).hostname;
    if (/(avia|train|bus|car|transport|poezd|railway|rzd)\.tutu\.ru$/i.test(hostname)) return true;
  } catch (error) { /* ручной оффер может быть без корректного URL */ }
  return !!transportKindFor(offer) && /(самол|авиа|рейс|поезд|ж\/?д|ржд|train|rail|автобус|bus|coach|автомобил|машин|такси|авто|car|auto|taxi)/i.test(
    [offer.title, offer.label, offer.description, offer.sku].filter(Boolean).join(" "),
  );
}

function transportIcon(kind) {
  const image = document.createElement("img");
  image.className = "offer-icon";
  image.src = `assets/transport-art/${TRANSPORT_ART_PATHS[kind] || TRANSPORT_ART_PATHS.airplane}`;
  image.alt = "";
  image.setAttribute("aria-hidden", "true");
  return image;
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
    slide.className = "slide" + (item.source !== "upload" ? " is-shared-player" : "") + (index === active ? " is-active" : "");
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

    // On pause keep the iframe visible. These transparent shields route
    // swipes to the feed while leaving its native centre Play button exposed.
    for (const side of ["top", "bottom", "left", "right"]) {
      const shield = document.createElement("div");
      shield.className = `native-play-shield native-play-shield--${side}`;
      shield.setAttribute("aria-hidden", "true");
      slide.appendChild(shield);
    }

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

    const offers = document.createElement("div");
    const itemOffers = (item.offers || []).slice(0, 1);
    offers.className = `offers offers--${itemOffers.length}`;

    itemOffers.forEach((offer) => {
      const card = document.createElement("a");
      const hotelOffer = isHotelOffer(offer);
      const transportOffer = !hotelOffer && isTransportOffer(offer);
      card.className = ["offer", hotelOffer && "offer--hotel", transportOffer && "offer--transport"].filter(Boolean).join(" ");
      card.href = offer.href;
      card.setAttribute("aria-label", offer.label || offer.title);

      let thumb;
      if (transportOffer) {
        thumb = transportIcon(transportKindFor(offer));
      } else {
        thumb = document.createElement("img");
        thumb.className = "thumb";
        thumb.alt = "";
        const thumbUrl = offer.image || posterFor(item);
        if (index === active) thumb.src = thumbUrl;
        else thumb.dataset.src = thumbUrl;
        thumb.loading = index === active ? "eager" : "lazy";
        thumb.decoding = "async";
        thumb.fetchPriority = "low";
      }

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
      offers.appendChild(card);
    });

    if (itemOffers.length) dock.appendChild(offers);

    slide.appendChild(dock);
    const progress = document.createElement("div");
    progress.className = "scrub";
    progress.innerHTML = '<div class="scrub-bar"><div class="scrub-fill"></div><input class="seek" type="range" min="0" max="1000" value="0" aria-label="Перемотать видео" /></div>';
    bindSeek(progress.querySelector(".seek"), index, progress.querySelector(".scrub-fill"));
    slide.appendChild(progress);
    feed.appendChild(slide);
  });
  selectProgress(active);
}

function selectProgress(index) {
  const slide = slides()[index];
  if (!slide) return;
  scrub = slide.querySelector(".scrub-fill");
  seek = slide.querySelector(".seek");
}

function setLikeState(action, on) {
  action.classList.toggle("is-on", on);
  action.setAttribute("aria-pressed", String(on));
  const slide = action.closest(".slide");
  const item = FEED[Number(slide?.dataset.index)];
  if (!item) return;
  likeCounts[item.id] = Math.max(11, likeCountFor(item.id) + (on ? 1 : -1));
  action.querySelector(".rail-count").textContent = String(likeCounts[item.id]);
  action.setAttribute("aria-label", `Нравится: ${likeCounts[item.id]}`);
  saveLikeCounts();
  if (on) recordEvent("like", item);
}

function closeOfferViewer(fromHistory = false) {
  if (offerViewer.hidden) return;
  if (!fromHistory && history.state?.offerViewer) {
    history.back();
    return;
  }
  offerViewer.hidden = true;
  offerViewerFrame.src = "about:blank";
  offerViewerExternal.href = "#";
  const shouldResume = offerViewerWasPlaying;
  offerViewerWasPlaying = false;
  if (shouldResume && player && !document.hidden) {
    userPaused = false;
    playbackConfirmed = false;
    playbackAttempts = 0;
    playbackState("buffering");
    watchForStall(generation);
    void startPlayback(player);
  }
}

function isTutuDeeplink(value) {
  try {
    const url = new URL(value);
    return /^tutu[a-z0-9+.-]*:$/i.test(url.protocol) && !!(url.host || url.pathname);
  } catch (error) {
    return false;
  }
}

function openTutuDeeplink(url) {
  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.click();
}

function openOfferViewer(url, item) {
  if (!url || !item) return;
  if (isTutuDeeplink(url)) {
    openTutuDeeplink(url);
    return;
  }
  const returnUrl = new URL(location.href);
  returnUrl.searchParams.set("video", item.id);
  returnUrl.searchParams.set("offer", "1");
  history.pushState({ ...(history.state || {}), offerViewer: true }, "", returnUrl);
  offerViewerWasPlaying = !userPaused;
  offerViewer.hidden = false;
  releasePreloads();
  clearTimeout(playbackTimeout);
  playbackTimeout = 0;
  clearTimeout(playbackRetryTimer);
  clearTimeout(bandwidthTimer);
  bandwidthTimer = 0;
  if (player) player.pause().catch(() => {});
  offerViewerExternal.href = url;
  offerViewerFrame.src = url;
  offerViewer.hidden = false;
}

offerViewerClose.addEventListener("click", () => closeOfferViewer());
window.addEventListener("popstate", () => {
  if (offerViewer.hidden) return;
  closeOfferViewer(true);
});

function showDoubleTapLike(slide, event) {
  const burst = document.createElement("span");
  burst.className = "double-tap-like";
  burst.setAttribute("aria-hidden", "true");
  const bounds = slide.getBoundingClientRect?.();
  if (bounds && Number.isFinite(event?.clientX) && Number.isFinite(event?.clientY)) {
    burst.style.left = `${event.clientX - bounds.left}px`;
    burst.style.top = `${event.clientY - bounds.top}px`;
  }
  slide.appendChild(burst);
  requestAnimationFrame(() => burst.classList.add("is-visible"));
  setTimeout(() => burst.remove(), 720);
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
let sharedPlayer = null;
let sharedPlayerPromise = null;
let sharedTrackIndex = -1;
let sharedPlaybackToken = 0;
let sharedFrameToken = 0;
let sharedMediaReadyToken = 0;
let sharedRevealToken = 0;
let sharedSwitchQueue = Promise.resolve();
let preferSharedPlayback = false;
const preloadedNeighbors = new Map();
let preloadTimer = 0;
let playerIndex = -1;
let hostSerial = 0;
let scrollDirection = 1;
let pendingMountHost = null;
const pendingCreations = new WeakMap();
const playerHosts = new WeakMap();
const destroyRequests = new WeakMap();

function destroyPlayer(instance) {
  if (!instance) return Promise.resolve();
  if (destroyRequests.has(instance)) return destroyRequests.get(instance);
  const request = Promise.resolve().then(() => instance.destroy()).catch(() => {}).finally(() => {
    playerHosts.get(instance)?.remove();
    playerHosts.delete(instance);
  });
  destroyRequests.set(instance, request);
  return request;
}

function cancelPlayerCreation(host) {
  if (!host) return;
  pendingCreations.get(host)?.();
}

function qualityCap() {
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (connection?.saveData || /2g/.test(connection?.effectiveType || "")) return 360;
  if (recoveryCount || Date.now() < constrainedUntil || connection?.effectiveType === "3g") return 480;
  if (Number.isFinite(connection?.downlink) && connection.downlink > 0 && connection.downlink < 1.5) return 480;
  return 720;
}

function playerOptions(id, autoPlay = false, preload = "auto") {
  return {
    url: "https://kinescope.io/" + id,
    size: { width: "100%", height: "100%" },
    behavior: {
      autoPlay,
      // Prefer sound. The browser may still require a direct user gesture.
      muted: !soundWanted,
      loop: true,
      playsInline: true,
      preload,
      maxAbrQuality: qualityCap(),
      keyboard: false,
      autoPause: false,
      playlist: { autoSwitch: false, loop: false },
      // Also disable remembered playlist selection: restoring a different
      // track desynchronizes next()/previous() from the feed's active index.
      localStorage: false,
    },
    ui: {
      language: "ru",
      controls: true,
      title: false,
      controlBar: false,
      progressBar: false,
      previousButton: false,
      nextButton: false,
      playButton: false,
      volumeButton: false,
      settingsButton: false,
      fullscreenButton: false,
      pipButton: false,
      mainPlayButton: true,
    },
  };
}

function createLocalPlayer(host, item, autoPlay = false, preload = "auto") {
  const video = document.createElement("video");
  // Set the autoplay policy before assigning the source or starting a load.
  video.muted = !soundWanted;
  video.defaultMuted = video.muted;
  video.src = item.mediaUrl;
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
  if (!entry || entry.cancelled) return;
  entry.cancelled = true;
  if (entry.player) void destroyPlayer(entry.player);
  else cancelPlayerCreation(entry.host);
  // Keep a wrapper around the SDK's replaceable iframe target so cancelling
  // an unfinished creation really removes its network-heavy document.
  if (!entry.player) entry.host.remove();
}

async function createKinescopePlayer(host, options, timeoutMs) {
  const target = document.createElement("div");
  target.id = host.id + "-iframe";
  host.appendChild(target);
  let timer = 0;
  let abandoned = false;
  const pending = factory.create(target.id, options);
  const deadline = new Promise((_, reject) => {
    const abandon = (message) => {
      abandoned = true;
      host.remove();
      const error = new Error(message);
      if (message === "Загрузка отменена") error.name = "AbortError";
      reject(error);
    };
    pendingCreations.set(host, () => abandon("Загрузка отменена"));
    timer = setTimeout(() => abandon("Плеер не ответил вовремя"), timeoutMs);
  });
  try {
    const instance = await Promise.race([pending, deadline]);
    playerHosts.set(instance, host);
    return instance;
  } finally {
    clearTimeout(timer);
    pendingCreations.delete(host);
    if (abandoned) pending.then((instance) => destroyPlayer(instance)).catch(() => {});
  }
}

async function takePreparedPlayer(entry) {
  // Creation already has an 8s deadline. Reuse the in-flight request rather
  // than restarting the iframe and its network downloads after 2.4s.
  return entry.player || await entry.promise;
}

function preloadOffsets() {
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const limited = connection?.saveData || /(^|slow-)2g|3g/.test(connection?.effectiveType || "") ||
    Date.now() < constrainedUntil || (navigator.deviceMemory && navigator.deviceMemory <= 2);
  return limited ? [scrollDirection] : [scrollDirection, -scrollDirection, scrollDirection * 2];
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
  const entry = { index, host, player: null, ready: false, cancelled: false, promise: null };
  preloadedNeighbors.set(index, entry);
  const initialSoundWanted = soundWanted;
  const preload = offset * scrollDirection > 0 ? "auto" : "metadata";
  entry.promise = (async () => {
    try {
      const instance = FEED[index].source === "upload"
        ? createLocalPlayer(host, FEED[index], false, preload)
        : await createKinescopePlayer(host, playerOptions(FEED[index].id, false, true), 8000);
      if (entry.cancelled) {
        await destroyPlayer(instance).catch(() => {});
        host.remove();
        return null;
      }
      entry.player = instance;
      // Creating the iframe alone does not mean video data is buffered.
      // Loaded confirms that the driver has media ready for playback.
      if (instance.Events.Loaded) instance.on(instance.Events.Loaded, () => {
        if (!entry.cancelled) entry.ready = true;
      });
      if (initialSoundWanted !== soundWanted) {
        (soundWanted && soundUnlocked ? instance.unmute() : instance.mute()).catch(() => {});
      }
      instance.on(instance.Events.Playing, () => {
        if (instance !== player) instance.pause().catch(() => {});
      });
      return instance;
    } catch (error) {
      host.remove();
      if (preloadedNeighbors.get(index) === entry) preloadedNeighbors.delete(index);
      if (!entry.cancelled && error.name !== "AbortError") failedPreloads.add(index);
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
    if (!entry.cancelled && token === generation && playbackConfirmed && !document.hidden) schedulePreload(token, 150);
  });
}

function prewarmNeighbors() {
  const token = generation;
  const pending = [...preloadedNeighbors.values()].find((entry) => !entry.player && !entry.cancelled);
  if (pending) {
    continuePreloading(pending, token);
    return;
  }
  const offsets = preloadOffsets();
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
    if (preloadOffsets().some((offset) => preparedIndex === index + offset) &&
        preparedIndex !== cachedPrevious?.index) continue;
    preloadedNeighbors.delete(preparedIndex);
    discardPreload(entry);
  }
}

function schedulePreload(token, delay = 250) {
  clearTimeout(preloadTimer);
  preloadTimer = setTimeout(() => {
    preloadTimer = 0;
    if (token !== generation || !player || !playbackConfirmed || userPaused || document.hidden || !offerViewer.hidden) return;
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
  if (token !== generation || !offerViewer.hidden) return;
  playbackConfirmed = false;
  playbackState("buffering");
  clearTimeout(preloadTimer);
  preloadTimer = 0;
  watchForStall(token);
  if (!bandwidthTimer) bandwidthTimer = setTimeout(() => {
    bandwidthTimer = 0;
    if (token === generation && !playbackConfirmed && !document.hidden) {
      if (everPlayedCurrent) constrainedUntil = Date.now() + 30000;
      releasePreloads();
    }
  }, 1800);
}

const boundPlayerTokens = new WeakMap();
const observedPlayerTimes = new WeakMap();

function bindPlayer(instance, token) {
  if (boundPlayerTokens.has(instance)) {
    boundPlayerTokens.set(instance, token);
    return;
  }
  boundPlayerTokens.set(instance, token);
  const currentToken = () => instance === sharedPlayer && sharedPlaybackToken !== boundPlayerTokens.get(instance)
    ? -1 : boundPlayerTokens.get(instance);
  if (instance.Events.VolumeChange) instance.on(instance.Events.VolumeChange, (event) => {
    if (currentToken() !== generation || instance !== player) return;
    if (typeof event.data?.muted === "boolean") {
      muted = event.data.muted;
      updateSoundState();
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
    if (token !== generation || instance !== player) return;
    if (userPaused || visibilityPaused || document.hidden) playbackState("paused");
    else if (instance === player) {
      beginBuffering(token);
      schedulePlaybackCheck(instance, token, 350);
    }
  });
  if (instance.Events.Waiting) instance.on(instance.Events.Waiting, () => {
    const token = currentToken();
    if (token === generation && instance === player && !userPaused && !document.hidden) {
      beginBuffering(token);
    }
  });
  if (instance.Events.TimeUpdate) instance.on(instance.Events.TimeUpdate, (event) => {
    const time = event.data?.currentTime ?? event.target?.currentTime;
    const previousTime = observedPlayerTimes.get(instance);
    if (Number.isFinite(time)) observedPlayerTimes.set(instance, time);
    if (currentToken() !== generation || instance !== player) return;
    if (Number.isFinite(time)) {
      lastTimeUpdateAt = Date.now();
      paintProgress(time);
      if (time > previousTime + 0.01 && !userPaused && !document.hidden) {
        if (instance === sharedPlayer) sharedFrameToken = currentToken();
        if (!playbackConfirmed || !hasFrame) markPlaying(instance, currentToken());
      }
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
    if (currentToken() !== generation || instance !== player) return;
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

function revealSharedFrame(token) {
  if (sharedRevealToken === token) return;
  sharedRevealToken = token;
  // Let the iframe compositor present its decoded frame before lifting
  // the opaque cover. A newer swipe invalidates both animation callbacks.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (sharedRevealToken === token) sharedRevealToken = 0;
    if (token !== generation || sharedFrameToken !== token || player !== sharedPlayer) return;
    hasFrame = true;
    sharedPlayerSlot.parentElement.classList.remove("is-shared-switching");
    revealActive();
  }));
}

function markPlaying(instance, token) {
  if (token !== generation || instance !== player) return;
  const slide = slides()[active];
  if (awaitingFirstPlay && !slide?.classList.contains("is-gesture-required")) {
    instance.pause().catch(() => {});
    return;
  }
  if (slide?.classList.contains("is-gesture-required")) {
    slide.classList.remove("is-gesture-required");
    awaitingFirstPlay = false;
    firstPlayButton.hidden = true;
    userPaused = false;
    sharedPlayerSlot.parentElement.classList.remove("is-shared-native-play");
  }
  const firstConfirmation = !playbackConfirmed;
  if (firstConfirmation) {
    playingSince = Date.now();
    if (switchStartedAt && !everPlayedCurrent) {
      document.documentElement.dataset.startupMs = String(playingSince - switchStartedAt);
      if (token === 1) document.documentElement.dataset.firstPlaybackMs = String(playingSince - feedStartedAt);
    }
  }
  clearTimeout(playbackTimeout);
  playbackTimeout = 0;
  clearTimeout(playbackRetryTimer);
  clearTimeout(bandwidthTimer);
  bandwidthTimer = 0;
  playbackAttempts = 0;
  playbackConfirmed = true;
  everPlayedCurrent = true;
  if (instance !== sharedPlayer) hasFrame = true;
  else {
    // Playing belongs to the selected media only after its transition has
    // completed. There is no need to wait for two periodic TimeUpdate events.
    if (sharedMediaReadyToken === token) sharedFrameToken = token;
    if (sharedFrameToken === token && !hasFrame) revealSharedFrame(token);
  }
  playbackState(userPaused || document.hidden || !offerViewer.hidden ? "paused" : "playing");
  status.hidden = true;
  retry.hidden = true;
  revealActive();
  if (firstConfirmation) {
    schedulePreload(token, recoveryCount ? 2000 : 250);
  }
  refreshProgress(instance, token);
  if (userPaused || document.hidden || !offerViewer.hidden) instance.pause().catch(() => {});
  else instance.isMuted().then((value) => {
    if (token === generation && instance === player) {
      muted = value;
      if (value && soundWanted && !userPaused && fallBackToSharedPlayer(instance)) return;
      if (!value) soundUnlocked = true;
      updateSoundState();
    }
  }).catch(() => {});
}

function offerDirectPlay(instance, token) {
  if (token !== generation || instance !== player) return;
  if (fallBackToSharedPlayer(instance)) return;
  userPaused = true;
  clearTimeout(playbackTimeout);
  playbackTimeout = 0;
  clearTimeout(playbackRetryTimer);
  playbackRetryTimer = 0;
  const slide = slides()[active];
  slide?.appendChild(firstPlayButton);
  firstPlayButton.hidden = false;
  firstPlayButton.disabled = false;
  const native = FEED[active]?.source !== "upload";
  firstPlayButton.dataset.native = String(native);
  if (native) slide?.classList.add("is-gesture-required");
  if (native && instance === sharedPlayer) sharedPlayerSlot.parentElement.classList.remove("is-shared-switching");
  sharedPlayerSlot.parentElement.classList.toggle("is-shared-native-play", native && instance === sharedPlayer);
  status.hidden = true;
  retry.hidden = true;
  playbackState("paused");
}

function fallBackToSharedPlayer(instance) {
  if (awaitingFirstPlay || instance !== player || instance === sharedPlayer ||
      FEED[active]?.source === "upload" || !sharedPlayer) return false;
  // Some browsers authorize sound for only the iframe that received the
  // opening gesture. Keep that iframe as an automatic fallback for the feed.
  preferSharedPlayback = true;
  userPaused = false;
  hasFrame = false;
  revealActive();
  mount(active);
  return true;
}

function isIOS() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent || "") ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function schedulePlaybackCheck(instance, token, delay = 1200) {
  clearTimeout(playbackRetryTimer);
  playbackRetryTimer = setTimeout(async () => {
    if (token !== generation || instance !== player || userPaused || document.hidden || !offerViewer.hidden) return;
    try {
      if (!(await instance.isPaused())) {
        if (token !== generation || instance !== player || userPaused || document.hidden || !offerViewer.hidden) return;
        const time = await instance.getCurrentTime();
        if (token !== generation || instance !== player || userPaused || document.hidden || !offerViewer.hidden) return;
        const previousTime = observedPlayerTimes.get(instance);
        if (Number.isFinite(time)) observedPlayerTimes.set(instance, time);
        if (Number.isFinite(time) && time > previousTime + 0.01) {
          markPlaying(instance, token);
          paintProgress(time);
          return;
        }
        if (isIOS() && playbackStartedAt && Date.now() - playbackStartedAt > 5000) {
          offerDirectPlay(instance, token);
          return;
        }
        schedulePlaybackCheck(instance, token, 500);
        return;
      }
    } catch (error) { /* плеер может ещё загружаться */ }
    if (token !== generation || instance !== player || userPaused || document.hidden || !offerViewer.hidden) return;
    playbackAttempts += 1;
    if (playbackAttempts >= 3) {
      offerDirectPlay(instance, token);
      return;
    }
    void startPlayback(instance);
    schedulePlaybackCheck(instance, token, 1000);
  }, delay);
}

function showPlaybackError(message) {
  firstPlayButton.hidden = true;
  delete status.dataset.kind;
  retry.textContent = "Повторить";
  releasePreloads();
  if (cachedPrevious) {
    destroyPlayer(cachedPrevious.player).catch(() => {});
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
    if (cachedPrevious) destroyPlayer(cachedPrevious.player).catch(() => {});
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
    if (token !== generation || userPaused || document.hidden || !offerViewer.hidden) return;
    if (!everPlayedCurrent && player) offerDirectPlay(player, token);
    else failPlayback("Видео загружается слишком долго.");
  }, recoveryCount ? 16000 : 12000);
}

let mountingIndex = -1;

function show(index) {
  const next = Math.max(0, Math.min(FEED.length - 1, index));
  if (next === active && (player || mountingIndex === next)) {
    return;
  }
  cancelPlaybackTap();
  lastPlaybackTap = null;
  if (next !== active) scrollDirection = next > active ? 1 : -1;
  if (next !== active) {
    recoveryCount = 0;
    failedPreloads.clear();
  }
  const previous = player;
  // Shared playlist transitions own their pause/play calls. An old swipe
  // must not pause a new track that is still loading inside the same iframe.
  if (previous && previous !== sharedPlayer) previous.pause().catch(() => {});
  clearTimeout(preloadTimer);
  const cachedReturn = cachedPrevious?.index === next;
  active = next;
  seeking = false;
  selectProgress(active);
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
  scrub.style.transform = "scaleX(0)";
  recordEvent("view");
  slides().forEach((slide, i) => slide.classList.toggle("is-active", i === active));
  slides().forEach((slide) => slide.classList.remove("is-gesture-required"));
  loadOfferImages(active);
  muted = !soundWanted || !soundUnlocked;
  revealActive();
  playbackState("buffering");
  status.hidden = true;
  retry.hidden = true;
  mount(active);
}

function mount(index) {
  const token = ++generation;
  sharedPlaybackToken = 0;
  sharedFrameToken = 0;
  sharedMediaReadyToken = 0;
  sharedPlayerSlot.parentElement.classList.toggle("is-shared-switching", FEED[index]?.source !== "upload");
  sharedPlayerSlot.parentElement.classList.remove("is-shared-native-play");
  cancelPlayerCreation(pendingMountHost);
  pendingMountHost = null;
  slides()[index]?.classList.remove("is-gesture-required");
  slides()[index]?.appendChild(firstPlayButton);
  firstPlayButton.hidden = !awaitingFirstPlay;
  firstPlayButton.dataset.native = "false";
  mountingIndex = index;
  if (awaitingFirstPlay) {
    userPaused = true;
    firstPlayButton.hidden = false;
    firstPlayButton.disabled = true;
  }
  document.documentElement.dataset.playerSource = preloadedNeighbors.has(index) ? "preloaded" : cachedPrevious?.index === index ? "cached" : "new";
  delete document.documentElement.dataset.startupMs;
  delete document.documentElement.dataset.playerReadyMs;
  document.documentElement.dataset.player = "loading";
  switchStartedAt = Date.now();
  playbackAttempts = 0;
  playbackStartedAt = 0;
  playbackConfirmed = false;
  bufferedUntil = 0;
  lastBufferReportAt = 0;
  playingSince = 0;
  clearTimeout(playbackRetryTimer);
  clearTimeout(playbackTimeout);
  playbackTimeout = 0;
  clearTimeout(bandwidthTimer);
  bandwidthTimer = 0;
  if (awaitingFirstPlay) playbackState("paused");
  else { watchForStall(token); beginBuffering(token); }
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
  if (awaitingFirstPlay || userPaused || document.hidden || !offerViewer.hidden || instance !== player) return;
  const token = generation;
  if (startRequest?.instance === instance && startRequest.token === token) return startRequest.promise;
  if (!playbackStartedAt) playbackStartedAt = Date.now();
  // Some WebViews leave play() pending when user interaction is required.
  // Monitor independently of the promise so the native Play button appears.
  schedulePlaybackCheck(instance, token, 1000);
  const promise = (async () => {
    try { await instance.play(); }
    catch (error) {
      if (token === generation && instance === player && error?.name === "NotAllowedError") {
        offerDirectPlay(instance, token);
      }
    }
    if (token !== generation) {
      if (instance !== player) try { await instance.pause(); } catch (error) { /* ролик уже закрыт */ }
      return;
    }
    if (instance !== player || userPaused || document.hidden || !offerViewer.hidden) {
      try { await instance.pause(); } catch (error) { /* ролик уже закрыт */ }
      return;
    }
  })();
  startRequest = { instance, token, promise };
  try { await promise; }
  finally {
    if (startRequest?.promise === promise) startRequest = null;
    if (token === generation && instance === player && !userPaused && !document.hidden && offerViewer.hidden && !playbackConfirmed) schedulePlaybackCheck(instance, token);
  }
}

async function sharedTrackId(instance) {
  if (typeof instance.getPlaylistItem !== "function") return null;
  let timer;
  try {
    const item = await Promise.race([
      instance.getPlaylistItem(),
      new Promise((resolve) => { timer = setTimeout(() => resolve(null), 2000); }),
    ]);
    return item?.id || null;
  } catch (error) { return null; }
  finally { clearTimeout(timer); }
}

async function moveSharedTrack(instance, direction, onTrackChanged = () => {}) {
  const events = instance.Events;
  // Acknowledgement of next()/previous() is not proof that the new media is
  // loaded. Never overlap commands while the driver is replacing its source.
  if (!events.Loaded || typeof instance.off !== "function") {
    await (direction > 0 ? instance.next() : instance.previous());
    onTrackChanged();
    return;
  }
  let timer;
  let changed = !events.CurrentTrackChanged;
  const previousId = typeof instance.getPlaylistItem === "function" ? await sharedTrackId(instance) : null;
  let disposed = false;
  let playing = false;
  let resolveLoaded, rejectLoaded;
  const loaded = new Promise((resolve, reject) => { resolveLoaded = resolve; rejectLoaded = reject; });
  let recorded = false;
  const recordChange = () => { if (!recorded) { recorded = true; onTrackChanged(); } };
  const onChanged = () => { changed = true; recordChange(); };
  const onLoaded = () => { if (changed) { recordChange(); resolveLoaded(); } };
  let checking = false;
  const onPlaybackReady = async () => {
    if (checking) return;
    checking = true;
    try {
      // Some driver versions emit Playing/TimeUpdate for playlist changes
      // without another Loaded event. Confirm the new track in that case.
      const id = previousId ? await sharedTrackId(instance) : null;
      if (disposed) return;
      if (previousId ? id && id !== previousId : changed) {
        playing = true;
        recordChange();
        resolveLoaded();
      }
    } catch (error) { /* the bounded deadline handles a silent driver */ }
    finally { checking = false; }
  };
  const onTime = (event) => { if (event.data?.currentTime > 0) void onPlaybackReady(); };
  const onError = () => rejectLoaded(new Error("Не удалось подготовить следующий ролик"));
  instance.on(events.Loaded, onLoaded);
  if (events.Playing) instance.on(events.Playing, onPlaybackReady);
  if (events.TimeUpdate) instance.on(events.TimeUpdate, onTime);
  if (events.CurrentTrackChanged) instance.on(events.CurrentTrackChanged, onChanged);
  if (events.Error) instance.on(events.Error, onError);
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("Переход к ролику занял слишком много времени")), 10000);
  });
  try {
    const command = direction > 0 ? instance.next() : instance.previous();
    await Promise.race([Promise.all([command, loaded]), deadline]);
    return playing;
  } finally {
    disposed = true;
    clearTimeout(timer);
    instance.off(events.Loaded, onLoaded);
    if (events.Playing) instance.off(events.Playing, onPlaybackReady);
    if (events.TimeUpdate) instance.off(events.TimeUpdate, onTime);
    if (events.CurrentTrackChanged) instance.off(events.CurrentTrackChanged, onChanged);
    if (events.Error) instance.off(events.Error, onError);
  }
}

async function openSharedVideo(index, token) {
  // Neighbour iframes warm the media cache; the authorized shared iframe
  // remains responsible for playback and sound on every track.
  const prepared = preloadedNeighbors.get(index);
  if (prepared) {
    preloadedNeighbors.delete(index);
    discardPreload(prepared);
  }
  prunePreloads(index);
  slides()[index]?.classList.add("is-shared-player");
  sharedPlayerSlot.hidden = false;
  sharedPlayerSlot.parentElement.classList.add("is-shared-player-active");
  if (player && player !== sharedPlayer) {
    void destroyPlayer(player);
    player = null;
  }
  if (cachedPrevious) { void destroyPlayer(cachedPrevious.player); cachedPrevious = null; }
  if (!sharedPlayerPromise) {
    const host = document.createElement("div");
    host.id = "shared-play-" + (++hostSerial);
    sharedPlayerSlot.appendChild(host);
    const ids = FEED.filter((item) => item.source !== "upload").map((item) => item.id);
    const options = playerOptions(FEED[index].id, false);
    options.url = "https://kinescope.io/embed/playlist?video_ids=" + ids.map(encodeURIComponent).join(",");
    sharedPlayerPromise = createKinescopePlayer(host, options, 12000).then((instance) => {
      sharedPlayer = instance;
      sharedTrackIndex = FEED.findIndex((item) => item.source !== "upload");
      return instance;
    }).catch((error) => { sharedPlayerPromise = null; host.remove(); throw error; });
  }
  const instance = await sharedPlayerPromise;
  if (token !== generation) return;
  player = instance;
  bindPlayer(instance, token);
  const operation = sharedSwitchQueue.catch(() => {}).then(async () => {
    if (token !== generation) return false;
    // Public embed IDs differ from the playlist's internal UUIDs. Move by
    // playlist position, retaining the same iframe and its audio permission.
    const tracks = FEED.map((item, i) => item.source !== "upload" ? i : -1).filter((i) => i >= 0);
    let playing = false;
    while (sharedTrackIndex !== index) {
      if (token !== generation) return false;
      const position = tracks.indexOf(sharedTrackIndex);
      const target = tracks.indexOf(index);
      const direction = target > position ? 1 : -1;
      const nextIndex = tracks[position + direction];
      playing = await moveSharedTrack(instance, direction, () => { sharedTrackIndex = nextIndex; });
      sharedTrackIndex = nextIndex;
      if (awaitingFirstPlay || token !== generation) await instance.pause();
    }
    if (recoveryCount > 0) { await instance.seekTo(0); playing = false; }
    return token === generation ? { playing } : false;
  });
  sharedSwitchQueue = operation;
  const result = await operation;
  if (!result || token !== generation) return;
  playerIndex = index;
  observedPlayerTimes.set(instance, 0);
  sharedPlaybackToken = token;
  sharedMediaReadyToken = token;
  document.documentElement.dataset.player = "ready";
  document.documentElement.dataset.playerSource = "shared";
  document.documentElement.dataset.playerReadyMs = String(Date.now() - switchStartedAt);
  status.hidden = true;
  refreshProgress(instance, token, true);
  if (awaitingFirstPlay) {
    offerDirectPlay(instance, token);
    return;
  }
  // next()/previous() may already have started the verified new media. Keep
  // that signal instead of waiting for another Playing/TimeUpdate cycle.
  if (result.playing) markPlaying(instance, token);
  if (soundWanted && !soundUnlocked) void instance.unmute().catch(() => {});
  if (token === generation) await startPlayback(instance);
}

async function openVideo(index, token) {
  if (token !== generation || (FEED[index].source !== "upload" && !factory)) return;
  if (FEED[index].source !== "upload" && !canUsePreparedPlayer(index)) return openSharedVideo(index, token);
  slides()[index]?.classList.remove("is-shared-player");
  sharedPlayerSlot.hidden = true;
  sharedPlayerSlot.parentElement.classList.remove("is-shared-player-active");
  if (player === sharedPlayer && sharedPlayer) {
    void sharedPlayer.pause().catch(() => {});
    player = null;
    playerIndex = -1;
  }
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
      try { await destroyPlayer(outgoing.player); } catch (error) { /* повторная загрузка */ }
    } else {
      if (cachedPrevious) destroyPlayer(cachedPrevious.player).catch(() => {});
      cachedPrevious = outgoing;
    }
  }
  if (token !== generation) {
    if (warmed) discardPreload(warmed);
    if (returning) destroyPlayer(returning.player).catch(() => {});
    return;
  }
  if (cachedPrevious && Math.abs(cachedPrevious.index - index) > 1) {
    destroyPlayer(cachedPrevious.player).catch(() => {});
    cachedPrevious = null;
  }
  prunePreloads(index);
  pendingMountHost = warmed?.host || null;
  let instance = returning?.player || (warmed ? await takePreparedPlayer(warmed) : null);
  if (token === generation) pendingMountHost = null;
  if (token !== generation) {
    if (instance && !returning) await destroyPlayer(instance).catch(() => {});
    if (returning) await destroyPlayer(returning.player).catch(() => {});
    warmed?.host.remove();
    return;
  }
  if (!instance) {
    const hostId = "play-" + (++hostSerial);
    const host = document.createElement("div");
    host.id = hostId;
    slides()[index].querySelector(".player-slot").appendChild(host);
    pendingMountHost = host;
    try {
      instance = FEED[index].source === "upload"
        ? createLocalPlayer(host, FEED[index], false)
        : await createKinescopePlayer(host, playerOptions(FEED[index].id, false), 12000);
    } catch (error) {
      host.remove();
      throw error;
    }
    if (token !== generation) {
      await destroyPlayer(instance);
      host.remove();
      return;
    }
  }
  pendingMountHost = null;
  player = instance;
  playerIndex = index;
  if (soundWanted && soundUnlocked) instance.unmute().catch(() => {});
  bindPlayer(instance, token);
  refreshProgress(instance, token, true);
  document.documentElement.dataset.player = "ready";
  document.documentElement.dataset.playerReadyMs = String(Date.now() - switchStartedAt);
  status.hidden = true;
  if (awaitingFirstPlay) {
    offerDirectPlay(instance, token);
    await instance.pause().catch(() => {});
    return;
  }
  await startPlayback(instance);
}

function canUsePreparedPlayer(index) {
  // Safari ties unmuted autoplay to a particular media element. Retaining
  // the shared iframe there avoids trading a faster swipe for a new Play tap.
  if (awaitingFirstPlay || preferSharedPlayback || isIOS()) return false;
  return cachedPrevious?.index === index || preloadedNeighbors.get(index)?.ready === true;
}

function indexFromScroll() {
  const height = feed.clientHeight || 1;
  return Math.max(0, Math.min(FEED.length - 1, Math.round(feed.scrollTop / height)));
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
  slides()[active]?.appendChild(firstPlayButton);
  playbackState("paused");
  if (active) feed.scrollTop = active * feed.clientHeight;
  feedReady = true;
  requestAnimationFrame(() => requestAnimationFrame(fitCaptions));
  if (window.__kinescopeFactory) boot(window.__kinescopeFactory);
  else if (FEED[active].source === "upload") mount(active);
  recordEvent("view");
}

// Native sheets and Safari toolbars can leave CSS viewport units taller
// than the visible content area. Size the feed from the visible viewport.
let viewportHeight = 0;
function updateViewportHeight() {
  const viewport = window.visualViewport;
  if (viewport && Math.abs((viewport.scale || 1) - 1) > 0.01) return false;
  const heights = [viewport?.height, window.innerHeight, document.documentElement.clientHeight]
    .filter((height) => Number.isFinite(height) && height > 0);
  if (!heights.length) return false;
  const height = Math.floor(Math.min(...heights));
  if (height === viewportHeight) return false;
  viewportHeight = height;
  document.documentElement.style.setProperty("--feed-viewport-height", `${height}px`);
  return true;
}

updateViewportHeight();
loadFeed();
let resizeFrame = 0;
let pendingViewportSync = false;
let layoutHeight = feed.clientHeight;
function syncFeedLayout() {
  const index = feedReady ? indexFromScroll() : active;
  updateViewportHeight();
  if (feedReady && feed.clientHeight !== layoutHeight) {
    layoutHeight = feed.clientHeight;
    feed.scrollTop = index * layoutHeight;
  }
  pendingViewportSync = false;
  fitCaptions();
}
function requestFeedLayout() {
  if (resizeFrame) return;
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = 0;
    if (touchingFeed || scrollSettleTimer) {
      pendingViewportSync = true;
      return;
    }
    syncFeedLayout();
  });
}
window.addEventListener("resize", requestFeedLayout);
window.visualViewport?.addEventListener("resize", requestFeedLayout);

let scrollFrame = 0;
let scrollSettleTimer = 0;
let touchingFeed = false;

function settleScroll() {
  clearTimeout(scrollSettleTimer);
  scrollSettleTimer = 0;
  if (!feedReady || touchingFeed || !FEED.length) return;
  if (pendingViewportSync) syncFeedLayout();
  const index = indexFromScroll();
  const top = index * feed.clientHeight;
  if (Math.abs(feed.scrollTop - top) > 1) {
    feed.scrollTo({ top, behavior: "smooth" });
  }
  if (index !== active) show(index);
}

feed.addEventListener("touchstart", () => { touchingFeed = true; }, { passive: true });
function endFeedTouch() {
  touchingFeed = false;
  clearTimeout(scrollSettleTimer);
  scrollSettleTimer = setTimeout(settleScroll, 180);
}
feed.addEventListener("touchend", endFeedTouch, { passive: true });
feed.addEventListener("touchcancel", endFeedTouch, { passive: true });
feed.addEventListener("scrollend", settleScroll);
feed.addEventListener("scroll", () => {
  cancelPlaybackTap();
  lastPlaybackTap = null;
  clearTimeout(scrollSettleTimer);
  scrollSettleTimer = setTimeout(settleScroll, 180);
  if (scrollFrame) return;
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0;
    const index = indexFromScroll();
    const height = feed.clientHeight || 1;
    if (index !== active && Math.abs(feed.scrollTop / height - active) >= 0.6) show(index);
  });
}, { passive: true });

async function togglePlayback() {
  const currentPlayer = player;
  const token = generation;
  if (!currentPlayer) return;
  try {
    if (userPaused) {
      userPaused = false;
      playbackConfirmed = false;
      playbackAttempts = 0;
      playbackStartedAt = 0;
      playbackState("buffering");
      watchForStall(generation);
      await startPlayback(currentPlayer);
      return;
    }
    const paused = await currentPlayer.isPaused();
    if (token !== generation || currentPlayer !== player) return;
    if (paused) {
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
      clearTimeout(playbackRetryTimer);
      // A regular pause uses our button. Exposing the native iframe here
      // steals centre taps from the feed and can reveal its own pause UI.
      firstPlayButton.dataset.native = "false";
      firstPlayButton.hidden = false;
      firstPlayButton.disabled = false;
      playbackState("paused");
      await currentPlayer.pause();
    }
  } catch (error) { showPlaybackError("Не удалось продолжить воспроизведение."); }
}

function playFromGesture(instance) {
  if (!instance || instance !== player || document.hidden || !offerViewer.hidden) return;
  const token = generation;
  slides()[active]?.classList.remove("is-gesture-required");
  sharedPlayerSlot.parentElement.classList.remove("is-shared-native-play");
  firstPlayButton.dataset.native = "false";
  awaitingFirstPlay = false;
  firstPlayButton.hidden = true;
  userPaused = false;
  playbackAttempts = 0;
  playbackConfirmed = false;
  playbackState("buffering");
  watchForStall(token);
  schedulePlaybackCheck(instance, token, 1000);
  // Both calls must be dispatched in the click handler, before timers/awaits.
  const volume = soundWanted ? instance.unmute() : instance.mute();
  const playback = instance.play();
  Promise.resolve(volume).then(async () => {
    const value = await instance.isMuted();
    if (token !== generation || instance !== player) return;
    muted = value;
    if (!value) soundUnlocked = true;
    updateSoundState();
  }).catch(() => {});
  Promise.resolve(playback).catch((error) => {
    if (token === generation && instance === player && error?.name === "NotAllowedError") offerDirectPlay(instance, token);
  });
}

function updateSoundState() {
  document.documentElement.dataset.sound = muted ? "muted" : "on";
}

firstPlayButton.addEventListener("click", (event) => {
  event.stopPropagation();
  handlePlaybackTap(event);
});

function queuePlaybackTap(handler) {
  clearTimeout(playbackTapTimer);
  const token = generation;
  playbackTapTimer = window.setTimeout(() => {
    playbackTapTimer = 0;
    if (token === generation && !document.hidden && offerViewer.hidden) void handler();
  }, DOUBLE_TAP_MS);
}

function cancelPlaybackTap() {
  clearTimeout(playbackTapTimer);
  playbackTapTimer = 0;
}

function likeFromTap(slide, event) {
  const action = slide?.querySelector('[data-action="like"]');
  if (!action) return;
  if (!action.classList.contains("is-on")) setLikeState(action, true);
  showDoubleTapLike(slide, event);
}

function handlePlaybackTap(event) {
  const slide = event.target.closest(".slide");
  if (!player || !slide || slide !== slides()[active]) return;
  const now = Date.now();
  const previous = lastPlaybackTap;
  // Clicks are synthesized on touch screens too; do not depend on a mobile
  // browser emitting dblclick or on both taps hitting the same DOM element.
  if (previous && previous.slide === slide && now - previous.at <= DOUBLE_TAP_MS &&
      Math.hypot(event.clientX - previous.x, event.clientY - previous.y) <= 64) {
    cancelPlaybackTap();
    lastPlaybackTap = null;
    event.preventDefault();
    likeFromTap(slide, event);
    return;
  }
  lastPlaybackTap = { slide, at: now, x: event.clientX, y: event.clientY };
  if (userPaused || (muted && soundWanted)) {
    cancelPlaybackTap();
    playFromGesture(player);
    return;
  }
  queuePlaybackTap(togglePlayback);
}

retry.addEventListener("click", () => {
  if (userPaused && player) { playFromGesture(player); return; }
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
  const offer = event.target.closest(".offer");
  if (offer) {
    event.preventDefault();
    recordEvent("offer_click");
    const item = FEED[Number(offer.closest(".slide")?.dataset.index)];
    if (item) {
      try {
        sessionStorage.setItem(RETURN_VIDEO_KEY, JSON.stringify({ videoId: item.id, at: Date.now() }));
      } catch (error) { /* session storage may be unavailable */ }
      openOfferViewer(offer.href, item);
    }
    return;
  }
  const action = event.target.closest("[data-action]");
  if (action) {
    // Action buttons must never bubble into the feed playback handler.
    event.preventDefault();
    event.stopPropagation();
    cancelPlaybackTap();
    lastPlaybackTap = null;
    const kind = action.dataset.action;
    if (kind === "like") {
      const on = action.classList.toggle("is-on");
      setLikeState(action, on);
    } else if (kind === "share" && navigator.share) {
      navigator.share({ title: "Тревел лента", url: location.href }).catch(() => {});
    } else if (kind === "more") {
      const bio = action.closest(".bio");
      const open = bio.classList.toggle("is-open");
      action.textContent = open ? "свернуть" : "ещё";
    }
    return;
  }
  if (!event.target.closest("#feed") || event.target.closest("a, input, button") || !player) return;
  handlePlaybackTap(event);
});

feed.addEventListener("dblclick", (event) => {
  if (event.target.closest("[data-action], a, input, button:not(.first-play-button)")) return;
  event.preventDefault();
  cancelPlaybackTap();
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
  scrub.style.transform = `scaleX(${progress})`;
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

function bindSeek(input, index, fill) {
  input.addEventListener("click", (event) => event.stopPropagation());
  input.addEventListener("pointerdown", () => { if (index === active) seeking = true; });
  input.addEventListener("input", () => {
    if (index !== active) return;
    seeking = true;
    const progress = Number(input.value) / 1000;
    fill.style.transform = `scaleX(${progress})`;
    input.setAttribute("aria-valuetext", currentDuration > 0 ? `${formatTime(progress * currentDuration)} из ${formatTime(currentDuration)}` : `${Math.round(progress * 100)}%`);
  });
  input.addEventListener("change", async () => {
    if (index !== active) return;
    const token = generation;
    const currentPlayer = player;
    const targetTime = Number(input.value) / 1000 * currentDuration;
    if (currentPlayer && currentDuration > 0) {
      try {
        await currentPlayer.seekTo(targetTime);
        if (token === generation && currentPlayer === player) currentTime = targetTime;
      } catch (error) { /* media may not yet allow seeking */ }
    }
    if (token !== generation) return;
    seeking = false;
    paintProgress();
  });
  input.addEventListener("pointercancel", () => {
    if (index === active) { seeking = false; paintProgress(); }
  });
}

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
  cancelPlayerCreation(pendingMountHost);
  if (player) destroyPlayer(player).catch(() => {});
  if (cachedPrevious) destroyPlayer(cachedPrevious.player).catch(() => {});
  if (sharedPlayer && sharedPlayer !== player) void destroyPlayer(sharedPlayer);
});

window.addEventListener("pageshow", (event) => {
  if (event.persisted) location.reload();
});

setInterval(() => {
  if (player && analyticsReady && !document.hidden && document.documentElement.dataset.playback === "playing") recordEvent("watch_tick");
}, 5000);

window.addEventListener("keydown", (event) => {
  if (event.target.closest("input, textarea, select, button, a, [contenteditable]")) return;
  if (event.key === " " || event.key === "Spacebar") {
    event.preventDefault();
    if (userPaused || awaitingFirstPlay) playFromGesture(player);
    else togglePlayback();
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
