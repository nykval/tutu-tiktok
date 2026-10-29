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
    createElement() { return { id: "", remove() {} }; },
    addEventListener() {},
    documentElement: { dataset: {} },
    hidden: false,
  };
  const context = vm.createContext({
    DEFAULT_FEED: [], document,
    window: { addEventListener() {} },
    location: { hostname: "github.io", search: "" },
    navigator: { connection: { effectiveType: "4g" } },
    URLSearchParams, console,
    setTimeout() { return 1; }, clearTimeout() {}, setInterval() { return 1; },
  });
  vm.runInContext(fs.readFileSync("feed.js", "utf8"), context);
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
