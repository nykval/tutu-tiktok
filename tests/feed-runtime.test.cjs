const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function harness() {
  const slides = Array.from({ length: 3 }, () => ({
    querySelector() { return { appendChild() {} }; },
    classList: { toggle() {} },
  }));
  const element = () => ({
    hidden: false, style: {}, dataset: {},
    addEventListener() {}, setAttribute() {},
    classList: { toggle() {} },
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
