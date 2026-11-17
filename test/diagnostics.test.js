const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { JSDOM } = require("jsdom");

function scene(t, query = "") {
  const dom = new JSDOM(fs.readFileSync("public/scene/index.html", "utf8"), {
    url: "http://routine.test/scene/index.html" + query,
    runScripts: "outside-only",
  });
  t.after(() => dom.window.close());
  dom.window.eval(fs.readFileSync("public/scene/guard.js", "utf8"));
  return dom.window;
}
test("a scene keeps its poster until an actual frame, then restores it on context loss", (t) => {
  const w = scene(t, "?view=workout&palette=1"),
    root = w.document.querySelector("#routine-raycast-glass-final");
  assert.equal(root.classList.contains("rr-rendered"), false);
  assert.match(
    w.document.querySelector(".rr-poster").src,
    /workout-banner-1.svg/,
  );
  w.RoutineSceneGuard.ready();
  assert.equal(root.classList.contains("rr-rendered"), true);
  w.RoutineSceneGuard.pending();
  assert.equal(root.classList.contains("rr-rendered"), true);
  w.RoutineSceneGuard.ready();
  assert.equal(root.classList.contains("rr-rendered"), true);
  const event = new w.Event("webglcontextlost", { cancelable: true });
  w.document.querySelector("canvas").dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  assert.equal(root.classList.contains("rr-rendered"), false);
  assert.match(w.document.querySelector(".rr-status").textContent, /R-GFX-002/);
  assert.equal(
    w.document.querySelector(".rr-play").textContent,
    "Tentar animação",
  );
  w.RoutineSceneGuard.ready();
  assert.equal(root.classList.contains("rr-rendered"), false);
});
test("initialization and shader failures preserve a local poster and an actionable code", (t) => {
  const w = scene(t);
  w.RoutineSceneGuard.fail("R-GFX-005");
  assert.equal(w.RoutineSceneGuard.failed, true);
  assert.match(
    w.document.querySelector(".rr-poster").src,
    /routine-symbol.svg/,
  );
  assert.equal(w.document.querySelector(".rr-status").hidden, false);
  assert.match(w.document.querySelector(".rr-status").textContent, /R-GFX-005/);
});
test("diagnostics bound and deduplicate local entries, never capturing API bodies", async (t) => {
  const dom = new JSDOM("", {
    url: "http://routine.test",
    runScripts: "outside-only",
  });
  t.after(() => dom.window.close());
  const w = dom.window;
  w.fetch = async () => ({
    ok: false,
    status: 503,
    json: async () => ({ private: "meal text" }),
  });
  w.eval(fs.readFileSync("public/diagnostics.js", "utf8"));
  await w.fetch("/api/state", { body: '{"meals":"private diary"}' });
  const diag = w.RoutineDiagnostics;
  assert.equal(diag.report().events[0].code, "R-HTTP-503");
  diag.record("R-GFX-002", "graphics");
  diag.record("R-GFX-002", "graphics");
  assert.equal(diag.report().events.length, 2);
  for (let i = 0; i < 200; i++)
    diag.record(`R-TEST-${String(i).padStart(3, "0")}`, "test");
  assert.equal(diag.report().events.length, 80);
  assert.doesNotMatch(
    w.localStorage.getItem("routine:diagnostics"),
    /private|meal text|meals/,
  );
  diag.clear();
  assert.equal(diag.report().events.length, 0);
});
