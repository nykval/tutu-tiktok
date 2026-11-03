const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function harness() {
  const classes = () => {
    const values = new Set();
    return {
      add(value) { values.add(value); },
      remove(value) { values.delete(value); },
      contains(value) { return values.has(value); },
      toggle(value, force) {
        const enabled = force === undefined ? !values.has(value) : force;
        if (enabled) values.add(value);
        else values.delete(value);
        return enabled;
      },
    };
  };
  const slides = Array.from({ length: 3 }, () => ({
    appendChild() {},
    querySelector() { return { appendChild() {} }; },
    classList: classes(),
  }));
  const element = () => ({
    hidden: false, style: {}, dataset: {},
    appendChild() {}, parentElement: { classList: classes() },
    addEventListener() {}, setAttribute() {},
    classList: classes(),
    querySelectorAll() { return slides; },
  });
  const nodes = new Map();
  const document = {
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, element());
      return nodes.get(id);
    },
    createElement() { return { id: "", appendChild() {}, remove() {} }; },
    addEventListener() {},
    documentElement: { dataset: {} },
    hidden: false,
  };
  const timers = new Map();
  let timerId = 0;
  const context = vm.createContext({
    DEFAULT_FEED: [], document,
    window: { addEventListener() {} },
    location: { hostname: "github.io", search: "" },
    navigator: { connection: { effectiveType: "4g" } },
    URLSearchParams, console, requestAnimationFrame(fn) { fn(); return 1; },
    setTimeout(fn, delay) { timers.set(++timerId, { fn, delay }); return timerId; },
    clearTimeout(id) { timers.delete(id); }, setInterval() { return 1; },
  });
  vm.runInContext(fs.readFileSync("feed.js", "utf8"), context);
  document.getElementById("offer-viewer").hidden = true;
  vm.runInContext("awaitingFirstPlay = false", context);
  context.testTimers = timers;
  context.testSlides = slides;
  return context;
}

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

test("neighbor players are created one at a time", async () => {
  const context = harness();
  const pending = [];
  context.createPlayer = () => new Promise((resolve) => pending.push(resolve));
  vm.runInContext(`
    FEED = [{ id: "one" }, { id: "two" }, { id: "three" }];
    factory = { create: createPlayer };
    active = 0;
    prewarmNeighbors();
    prewarmNeighbors();
  `, context);
  assert.equal(pending.length, 1);

  pending[0]({ Events: { Playing: "playing" }, on() {}, pause: async () => {}, destroy: async () => {} });
  await tick();
  vm.runInContext("prewarmNeighbors()", context);
  assert.equal(pending.length, 2);
});

test("cancelled neighbor is destroyed if its creation finishes later", async () => {
  const context = harness();
  let finishCreation;
  let destroys = 0;
  context.createPlayer = () => new Promise((resolve) => { finishCreation = resolve; });
  vm.runInContext(`
    FEED = [{ id: "one" }, { id: "two" }, { id: "three" }];
    factory = { create: createPlayer };
    prewarmNeighbors();
    releasePreloads();
  `, context);
  finishCreation({ destroy: async () => { destroys += 1; } });
  await tick();
  assert.equal(destroys, 1);
});

test("quality cap adapts after a stall", () => {
  const context = harness();
  assert.equal(vm.runInContext("qualityCap()", context), 720);
  vm.runInContext("constrainedUntil = Date.now() + 30000", context);
  assert.equal(vm.runInContext("qualityCap()", context), 480);
});

test("blocked autoplay exposes a direct Play tap and resumes after the player starts", async () => {
  const context = harness();
  context.testPlayer = {
    play: async () => { throw Object.assign(new Error("gesture required"), { name: "NotAllowedError" }); },
    mute: async () => {},
    pause: async () => {},
    getCurrentTime: async () => 0,
    getDuration: async () => 30,
    isMuted: async () => true,
  };
  vm.runInContext('FEED = [{ id: "one" }]; player = testPlayer; generation = 1;', context);
  await vm.runInContext("startPlayback(player)", context);
  assert.equal(context.testSlides[0].classList.contains("is-gesture-required"), true);
  assert.equal(vm.runInContext("userPaused", context), true);

  vm.runInContext("markPlaying(player, 1)", context);
  assert.equal(context.testSlides[0].classList.contains("is-gesture-required"), false);
  assert.equal(vm.runInContext("userPaused", context), false);
});


test("second forward video preloads media, including when scrolling backwards", async () => {
  for (const direction of [1, -1]) {
    const context = harness();
    const options = [];
    context.createPlayer = (id, value) => {
      options.push(value);
      return Promise.resolve({ Events: { Playing: "playing" }, on() {}, destroy: async () => {} });
    };
    context.direction = direction;
    vm.runInContext(`
      FEED = [{ id: "one" }, { id: "two" }, { id: "three" }];
      factory = { create: createPlayer };
      active = direction === 1 ? 0 : 2;
      scrollDirection = direction;
      prewarmNeighbor(direction * 2);
    `, context);
    await tick();
    assert.equal(options[0].behavior.preload, "auto");
  }
});

test("preload depth respects data saving, memory and scroll direction", () => {
  const context = harness();
  assert.deepEqual(Array.from(vm.runInContext("preloadOffsets()", context)), [1, 2, -1]);
  vm.runInContext("scrollDirection = -1", context);
  assert.deepEqual(Array.from(vm.runInContext("preloadOffsets()", context)), [-1, -2, 1]);
  for (const setting of ["navigator.connection.saveData = true", "navigator.connection = { effectiveType: '3g' }", "navigator.connection = {}; navigator.deviceMemory = 2"]) {
    vm.runInContext(setting, context);
    assert.deepEqual(Array.from(vm.runInContext("preloadOffsets()", context)), [-1]);
  }
});

test("taking an unfinished preload reuses its creation and does not discard it", async () => {
  const context = harness();
  let finish;
  context.pendingPlayer = new Promise((resolve) => { finish = resolve; });
  vm.runInContext("testEntry = { promise: pendingPlayer, cancelled: false }", context);
  const result = vm.runInContext("takePreparedPlayer(testEntry)", context);
  const instance = {};
  finish(instance);
  assert.equal(await result, instance);
  assert.equal(vm.runInContext("testEntry.cancelled", context), false);
});

test("inactive player events cannot alter the active video's progress or buffering", () => {
  const context = harness();
  const handlers = {};
  context.oldPlayer = {
    Events: { Playing: "playing", Pause: "pause", Waiting: "waiting", TimeUpdate: "timeupdate", DurationChange: "durationchange", Error: "error" },
    on(event, handler) { handlers[event] = handler; },
  };
  vm.runInContext("generation = 1; bindPlayer(oldPlayer, 1); player = {}; currentTime = 8; currentDuration = 30; playbackConfirmed = true", context);
  handlers.timeupdate({ data: { currentTime: 20 } });
  handlers.durationchange({ data: { duration: 90 } });
  handlers.waiting();
  handlers.pause();
  assert.equal(vm.runInContext("currentTime", context), 8);
  assert.equal(vm.runInContext("currentDuration", context), 30);
  assert.equal(vm.runInContext("playbackConfirmed", context), true);
});

test("a cached timestamp does not confirm resumed playback until time advances", () => {
  const context = harness();
  const handlers = {};
  context.testPlayer = {
    Events: { Playing: "playing", Pause: "pause", TimeUpdate: "timeupdate", Error: "error" },
    on(event, handler) { handlers[event] = handler; },
    isMuted: async () => true, getDuration: async () => 30,
  };
  vm.runInContext("generation = 1; player = testPlayer; bindPlayer(player, 1); currentTime = 0; currentDuration = 30", context);
  handlers.timeupdate({ data: { currentTime: 8 } });
  assert.equal(vm.runInContext("playbackConfirmed", context), false);
  handlers.timeupdate({ data: { currentTime: 8.25 } });
  assert.equal(vm.runInContext("playbackConfirmed", context), true);
});


test("players request sound at startup and respect an explicit mute preference", () => {
  const context = harness();
  assert.equal(vm.runInContext("playerOptions('one', true).behavior.muted", context), false);
  assert.equal(vm.runInContext("playerOptions('two', false).behavior.muted", context), false);
  vm.runInContext("soundWanted = false", context);
  assert.equal(vm.runInContext("playerOptions('two', false).behavior.muted", context), true);
});

test("uploaded videos request sound and stay inline", () => {
  const context = harness();
  const video = { load() { assert.equal(this.muted, false); assert.equal(this.defaultMuted, false); } };
  context.document.createElement = () => video;
  context.host = { appendChild() {} };
  vm.runInContext("createLocalPlayer(host, { mediaUrl: '/video.mp4' }, true)", context);
  assert.equal(video.autoplay, true);
  assert.equal(video.playsInline, true);
});


test("cancelling an unfinished iframe removes its stable wrapper and destroys a late result once", async () => {
  const context = harness();
  let finish;
  let removed = 0;
  let destroys = 0;
  context.host = { id: "host", appendChild() {}, remove() { removed += 1; } };
  context.createPlayer = () => new Promise((resolve) => { finish = resolve; });
  vm.runInContext("factory = { create: createPlayer }", context);
  const creation = vm.runInContext("createKinescopePlayer(host, {}, 8000)", context);
  vm.runInContext("cancelPlayerCreation(host)", context);
  await assert.rejects(creation, { name: "AbortError" });
  assert.equal(removed, 1);
  finish({ destroy: async () => { destroys += 1; } });
  await tick();
  assert.equal(destroys, 1);
  assert.equal([...context.testTimers.values()].some((timer) => timer.delay === 8000), false);
});

test("destroying a ready iframe is idempotent and removes its wrapper", async () => {
  const context = harness();
  let removed = 0;
  let destroys = 0;
  context.host = { id: "host", appendChild() {}, remove() { removed += 1; } };
  context.instance = { destroy: async () => { destroys += 1; } };
  context.createPlayer = async () => context.instance;
  vm.runInContext("factory = { create: createPlayer }", context);
  await vm.runInContext("createKinescopePlayer(host, {}, 8000)", context);
  await Promise.all([vm.runInContext("destroyPlayer(instance)", context), vm.runInContext("destroyPlayer(instance)", context)]);
  assert.equal(destroys, 1);
  assert.equal(removed, 1);
});

test("unreported network speed does not permanently limit video to 480p", () => {
  const context = harness();
  vm.runInContext("navigator.connection = undefined", context);
  assert.equal(vm.runInContext("qualityCap()", context), 720);
  vm.runInContext("navigator.connection = { effectiveType: '4g', downlink: 0.8 }", context);
  assert.equal(vm.runInContext("qualityCap()", context), 480);
});

test("a timed-out creation destroys its late player and releases the wrapper", async () => {
  const context = harness();
  let finish;
  let destroys = 0;
  let removed = 0;
  context.host = { id: "host", appendChild() {}, remove() { removed += 1; } };
  context.createPlayer = () => new Promise((resolve) => { finish = resolve; });
  vm.runInContext("factory = { create: createPlayer }", context);
  const creation = vm.runInContext("createKinescopePlayer(host, {}, 8000)", context);
  [...context.testTimers.values()].find((timer) => timer.delay === 8000).fn();
  await assert.rejects(creation, /вовремя/);
  finish({ destroy: async () => { destroys += 1; } });
  await tick();
  assert.equal(destroys, 1);
  assert.equal(removed, 1);
});


test("offer overlay prevents playback and neighbor downloads", async () => {
  const context = harness();
  let plays = 0;
  context.testPlayer = { play: async () => { plays += 1; } };
  vm.runInContext("player = testPlayer; playbackConfirmed = true; offerViewer.hidden = false", context);
  await vm.runInContext("startPlayback(player)", context);
  vm.runInContext("schedulePreload(generation)", context);
  [...context.testTimers.values()].find((timer) => timer.delay === 250).fn();
  assert.equal(plays, 0);
  assert.equal(vm.runInContext("preloadedNeighbors.size", context), 0);
});


test("rapid swipes share one creation and only switch to the latest selected track", async () => {
  const context = harness();
  let finish;
  let creations = 0;
  const switched = [];
  let plays = 0;
  context.createPlayer = () => { creations += 1; return new Promise((resolve) => { finish = resolve; }); };
  vm.runInContext(`FEED = [{ id: 'one' }, { id: 'two' }, { id: 'three' }]; factory = { create: createPlayer };
    mount(0); mount(1); mount(2);`, context);
  assert.equal(creations, 1);
  finish({
    Events: { Playing: 'playing', Pause: 'pause', Error: 'error' }, on() {},
    next: async () => { switched.push('next'); }, previous: async () => { switched.push('previous'); },
    unmute: async () => {}, play: async () => { plays += 1; },
    getCurrentTime: async () => 0, getDuration: async () => 30,
  });
  await tick();
  assert.deepEqual(switched, ['next', 'next']);
  assert.equal(plays, 1);
  assert.equal(vm.runInContext('playerIndex', context), 2);
});

test("unresolved play requests still expose the native Play button", async () => {
  const context = harness();
  context.testPlayer = {
    play: () => new Promise(() => {}), isPaused: async () => true,
    mute: async () => {},
  };
  vm.runInContext("FEED = [{ id: 'one' }]; player = testPlayer; generation = 1; startPlayback(player)", context);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const timer = [...context.testTimers.entries()].find(([, timer]) => timer.delay === 1000);
    assert.ok(timer, "playback monitor must run while play() is pending");
    context.testTimers.delete(timer[0]);
    await timer[1].fn();
    await tick();
  }
  assert.equal(context.testSlides[0].classList.contains('is-gesture-required'), true);
  assert.equal(vm.runInContext('userPaused', context), true);
});

test("sound and playback are requested synchronously within the user gesture", async () => {
  const context = harness();
  const calls = [];
  context.testPlayer = {
    unmute() { calls.push('unmute'); return Promise.resolve(); },
    play() { calls.push('play'); return Promise.resolve(); },
    isMuted: async () => false,
  };
  vm.runInContext('player = testPlayer; playFromGesture(player)', context);
  assert.deepEqual(calls, ['unmute', 'play']);
  await tick();
  assert.equal(vm.runInContext('muted', context), false);
});


test("opening the feed prepares a paused player without requesting autoplay", async () => {
  const context = harness();
  let plays = 0;
  let options;
  context.createPlayer = async (id, value) => {
    options = value;
    return {
      Events: { Playing: 'playing', Pause: 'pause', Error: 'error' }, on() {},
      play: async () => { plays += 1; }, pause: async () => {},
      getCurrentTime: async () => 0, getDuration: async () => 30,
    };
  };
  vm.runInContext("FEED = [{ id: 'one' }]; factory = { create: createPlayer }; awaitingFirstPlay = true; mount(0)", context);
  await tick();
  assert.equal(options.behavior.autoPlay, false);
  assert.equal(plays, 0);
  assert.equal(vm.runInContext('userPaused', context), true);
  assert.equal(vm.runInContext('firstPlayButton.disabled', context), false);
  assert.equal(vm.runInContext('firstPlayButton.hidden', context), false);
  await vm.runInContext('startPlayback(player)', context);
  assert.equal(plays, 0);
});

test("first gesture releases the opening pause and requests sound immediately", async () => {
  const context = harness();
  const calls = [];
  context.instance = {
    unmute() { calls.push('sound'); return Promise.resolve(); },
    play() { calls.push('play'); return Promise.resolve(); },
    isMuted: async () => false,
  };
  vm.runInContext('player = instance; awaitingFirstPlay = true; userPaused = true; playFromGesture(player)', context);
  assert.deepEqual(calls, ['sound', 'play']);
  assert.equal(vm.runInContext('awaitingFirstPlay', context), false);
  assert.equal(vm.runInContext('firstPlayButton.hidden', context), true);
  await tick();
});


test("native iframe Playing releases the opening gate instead of immediately pausing it", () => {
  const context = harness();
  let pauses = 0;
  context.instance = {
    pause: async () => { pauses += 1; },
    isMuted: async () => false, getCurrentTime: async () => 0, getDuration: async () => 30,
  };
  vm.runInContext("FEED = [{ id: 'one' }]; player = instance; generation = 1; awaitingFirstPlay = true; offerDirectPlay(player, 1)", context);
  assert.equal(vm.runInContext('firstPlayButton.dataset.native', context), 'true');
  assert.equal(vm.runInContext('status.hidden', context), true);
  vm.runInContext('markPlaying(player, 1)', context);
  assert.equal(pauses, 0);
  assert.equal(vm.runInContext('awaitingFirstPlay', context), false);
  assert.equal(vm.runInContext('userPaused', context), false);
  assert.equal(vm.runInContext('firstPlayButton.hidden', context), true);
});

test("settling a mobile swipe aligns the feed to a whole card", () => {
  const context = harness();
  const scrolls = [];
  context.scrollTo = (value) => scrolls.push(value.top);
  vm.runInContext(`FEED = [{ id: 'one' }, { id: 'two' }, { id: 'three' }]; feedReady = true;
    feed.clientHeight = 664; feed.scrollTop = 664 + 180; active = 1; feed.scrollTo = scrollTo;
    settleScroll();`, context);
  assert.deepEqual(scrolls, [664]);
  vm.runInContext('touchingFeed = true; feed.scrollTop = 800; settleScroll()', context);
  assert.deepEqual(scrolls, [664], 'never fight a finger that is still touching the feed');
  vm.runInContext('feed.scrollTop = -50', context);
  assert.equal(vm.runInContext('indexFromScroll()', context), 0);
});


test("native sheet height uses the smaller visible viewport instead of the full screen", () => {
  const context = harness();
  const heights = [];
  context.document.documentElement.style = { setProperty(name, value) { heights.push(value); } };
  context.window.innerHeight = 844;
  context.document.documentElement.clientHeight = 844;
  context.window.visualViewport = { height: 696, scale: 1 };
  assert.equal(vm.runInContext('updateViewportHeight()', context), true);
  assert.deepEqual(heights, ['696px']);
  context.window.visualViewport.height = 620;
  vm.runInContext('updateViewportHeight()', context);
  assert.deepEqual(heights, ['696px', '620px']);
  context.window.visualViewport.scale = 2;
  context.window.visualViewport.height = 310;
  assert.equal(vm.runInContext('updateViewportHeight()', context), false);
  assert.deepEqual(heights, ['696px', '620px']);
});


test("forward and backward swipes reuse the authorized player, play automatically, and never mute", async () => {
  const context = harness();
  const moves = [];
  let creates = 0, plays = 0, mutes = 0;
  context.createPlayer = async () => {
    creates += 1;
    return {
      Events: { Playing: 'playing', Pause: 'pause', Error: 'error' }, on() {},
      next: async () => { moves.push('next'); }, previous: async () => { moves.push('previous'); },
      play: async () => { plays += 1; }, pause: async () => {},
      unmute: async () => {}, mute: async () => { mutes += 1; },
      getDuration: async () => 30, getCurrentTime: async () => 0,
    };
  };
  vm.runInContext("FEED = [{id:'one'}, {id:'two'}]; factory = {create:createPlayer}; generation = 1", context);
  await vm.runInContext('openVideo(0, 1)', context);
  vm.runInContext('generation = 2; active = 1', context);
  await vm.runInContext('openVideo(1, 2)', context);
  vm.runInContext('generation = 3; active = 0', context);
  await vm.runInContext('openVideo(0, 3)', context);
  assert.deepEqual(moves, ['next', 'previous']);
  assert.equal(creates, 1);
  assert.equal(plays, 3);
  assert.equal(mutes, 0);
  assert.equal(vm.runInContext('player === sharedPlayer', context), true);
});


function delayedPlaylist(context) {
  const handlers = new Map();
  const moves = [];
  let plays = 0;
  const emit = (event) => { for (const fn of [...(handlers.get(event) || [])]) fn({ data: {} }); };
  const instance = {
    Events: { Playing:'playing', Pause:'pause', Error:'error', Loaded:'loaded', CurrentTrackChanged:'track', TimeUpdate:'time' },
    on(event, fn) { if (!handlers.has(event)) handlers.set(event, new Set()); handlers.get(event).add(fn); },
    off(event, fn) { handlers.get(event)?.delete(fn); },
    next: async () => { moves.push('next'); emit('track'); },
    previous: async () => { moves.push('previous'); emit('track'); },
    pause: async () => {}, unmute: async () => {}, isMuted: async () => false,
    play: async () => { plays += 1; }, getDuration: async () => 30, getCurrentTime: async () => 0,
  };
  context.testPlayer = instance;
  return { instance, emit, moves, plays: () => plays, handlers };
}

test("playlist acknowledgement does not allow an overlapping transition before Loaded", async () => {
  const context = harness();
  const media = delayedPlaylist(context);
  let completed = false;
  const pending = vm.runInContext('moveSharedTrack(testPlayer, 1)', context).then(() => { completed = true; });
  await tick();
  assert.equal(completed, false);
  media.emit('loaded');
  await pending;
  assert.equal(completed, true);
  assert.equal(media.handlers.get('loaded').size, 0);
});

test("two fast swipes followed by a reversal converge to the last target without overlapping loads", async () => {
  const context = harness();
  const media = delayedPlaylist(context);
  context.createPlayer = async () => media.instance;
  vm.runInContext("FEED = [{id:'one'}, {id:'two'}, {id:'three'}]; factory={create:createPlayer}; generation=1", context);
  await vm.runInContext('openVideo(0,1)', context);
  vm.runInContext('generation=2; sharedPlaybackToken=0; active=1', context);
  const first = vm.runInContext('openVideo(1,2)', context);
  await tick();
  vm.runInContext('generation=3; sharedPlaybackToken=0; active=2', context);
  const second = vm.runInContext('openVideo(2,3)', context);
  await tick();
  assert.deepEqual(media.moves, ['next']);
  media.emit('loaded'); await tick();
  assert.deepEqual(media.moves, ['next','next']);
  vm.runInContext('generation=4; sharedPlaybackToken=0; active=0', context);
  const last = vm.runInContext('openVideo(0,4)', context);
  media.emit('loaded'); await tick();
  assert.deepEqual(media.moves, ['next','next','previous']);
  media.emit('loaded'); await tick();
  assert.deepEqual(media.moves, ['next','next','previous','previous']);
  media.emit('loaded');
  await Promise.all([first, second, last]);
  assert.equal(vm.runInContext('sharedTrackIndex', context), 0);
  assert.equal(vm.runInContext('playerIndex', context), 0);
  assert.equal(media.plays(), 2, 'only initial and latest targets are started by the feed');
});

test("Playing alone keeps the resetting iframe behind its poster until media time advances", () => {
  const context = harness();
  const media = delayedPlaylist(context);
  vm.runInContext('player=testPlayer; sharedPlayer=testPlayer; generation=1; sharedPlaybackToken=1; bindPlayer(player,1); markPlaying(player,1)', context);
  assert.equal(vm.runInContext('hasFrame', context), false);
  for (const time of [0, 0.25]) {
    for (const fn of media.handlers.get('time')) fn({ data: { currentTime: time } });
  }
  assert.equal(vm.runInContext('hasFrame', context), true);
});

test("a missing Loaded event times out and removes transition listeners", async () => {
  const context = harness();
  const media = delayedPlaylist(context);
  const pending = vm.runInContext('moveSharedTrack(testPlayer,1)', context);
  [...context.testTimers.values()].find(t => t.delay === 10000).fn();
  await assert.rejects(pending, /слишком много времени/);
  assert.equal(media.handlers.get('loaded').size, 0);
  assert.equal(media.handlers.get('track').size, 0);
});


test("drivers that omit Loaded can confirm readiness through the new playing track", async () => {
  const context = harness();
  const media = delayedPlaylist(context);
  let id = 'first';
  media.instance.getPlaylistItem = async () => ({ id });
  const originalNext = media.instance.next;
  media.instance.next = async () => { await originalNext(); id = 'second'; media.emit('playing'); };
  await vm.runInContext('moveSharedTrack(testPlayer,1)', context);
  assert.equal(media.handlers.get('loaded').size, 0);
});

test("a queued compositor reveal cannot uncover a different video's iframe", () => {
  const context = harness();
  const frames = [];
  context.requestAnimationFrame = (fn) => { frames.push(fn); return frames.length; };
  vm.runInContext('sharedPlayer = {}; player = sharedPlayer; generation = 1; sharedFrameToken = 1; hasFrame = false; revealSharedFrame(1)', context);
  frames.shift()();
  vm.runInContext('generation = 2; sharedFrameToken = 0', context);
  frames.shift()();
  assert.equal(vm.runInContext('hasFrame', context), false);
});


test("feed UI hides native title, navigation, and timeline while keeping direct Play available", () => {
  const context = harness();
  const ui = vm.runInContext("playerOptions('one').ui", context);
  assert.equal(ui.controls, true);
  assert.equal(ui.mainPlayButton, true);
  for (const option of ['title','controlBar','progressBar','previousButton','nextButton']) assert.equal(ui[option], false);
});

test("progress updates belong to the active card and preserve the outgoing card's bar", () => {
  const context = harness();
  context.oldFill = { style: { transform: 'scaleX(0.7)' } };
  context.newFill = { style: {} };
  context.newInput = { setAttribute() {} };
  context.testSlides[1].querySelector = (selector) => selector === '.scrub-fill' ? context.newFill : context.newInput;
  vm.runInContext('scrub = oldFill; selectProgress(1); currentDuration = 40; paintProgress(10)', context);
  assert.equal(context.oldFill.style.transform, 'scaleX(0.7)');
  assert.equal(context.newFill.style.transform, 'scaleX(0.25)');
  assert.equal(context.newInput.value, '250');
});

test("a late seek response cannot overwrite progress after swiping to another track", async () => {
  const context = harness();
  const handlers = {};
  let finish;
  context.input = { value:'500', addEventListener(name, fn) { handlers[name] = fn; } };
  context.fill = { style: {} };
  context.instance = { seekTo: () => new Promise(resolve => { finish = resolve; }) };
  vm.runInContext('player = instance; currentDuration = 40; generation = 1; active = 0; bindSeek(input,0,fill)', context);
  const pending = handlers.change();
  vm.runInContext('generation = 2; active = 1; currentTime = 3; seeking = false', context);
  finish(); await pending;
  assert.equal(vm.runInContext('currentTime', context), 3);
  assert.equal(vm.runInContext('seeking', context), false);
});
