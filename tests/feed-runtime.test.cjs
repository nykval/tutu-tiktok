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
    querySelector() { return { appendChild() {} }; },
    classList: classes(),
  }));
  const element = () => ({
    hidden: false, style: {}, dataset: {},
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
    URLSearchParams, console,
    setTimeout(fn, delay) { timers.set(++timerId, { fn, delay }); return timerId; },
    clearTimeout(id) { timers.delete(id); }, setInterval() { return 1; },
  });
  vm.runInContext(fs.readFileSync("feed.js", "utf8"), context);
  document.getElementById("offer-viewer").hidden = true;
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


test("rapid mounts cancel obsolete creations and only the last player starts", async () => {
  const context = harness();
  const pending = [];
  const destroyed = [];
  const played = [];
  context.createPlayer = () => new Promise((resolve) => pending.push(resolve));
  vm.runInContext(`FEED = [{ id: 'one' }, { id: 'two' }, { id: 'three' }]; factory = { create: createPlayer };
    mount(0); mount(1); mount(2);`, context);
  assert.equal(pending.length, 3);
  for (const index of [1, 2, 0]) {
    pending[index]({
      Events: { Playing: 'playing', Pause: 'pause', Error: 'error' }, on() {},
      play: async () => { played.push(index); },
      destroy: async () => { destroyed.push(index); },
      getCurrentTime: async () => 0, getDuration: async () => 30,
    });
  }
  await tick();
  assert.deepEqual(played, [2]);
  assert.deepEqual(destroyed.sort(), [0, 1]);
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
