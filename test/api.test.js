const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
test("API persists, rejects stale writes, streams updates and survives restart", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "routine-test-"));
  process.env.ROUTINE_DB = path.join(dir, "database.json");
  process.env.PORT = "0";
  const { start } = require("../server");
  let server = await start();
  const request = (route, opts) =>
    fetch(`http://127.0.0.1:${server.address().port}${route}`, opts);
  let stream, reader;
  try {
    assert.equal((await request("/")).status, 200);
    const mobile = await (await request("/api/mobile")).json();
    assert.equal(mobile.active, true);
    assert.equal(mobile.port, server.address().port);
    assert.ok(Array.isArray(mobile.networks));
    for (let i = 0; i < 3; i++) {
      const banner = await request(`/brand/workout-banner-${i}.svg`);
      assert.equal(banner.status, 200);
      assert.match(banner.headers.get("content-type"), /image\/svg\+xml/);
    }
    const scenePage = await request("/scene/index.html");
    assert.equal(scenePage.status, 200);
    const sceneHtml = await scenePage.text();
    assert.match(sceneHtml, /\/scene\/scene\.bundle\.js/);
    assert.doesNotMatch(sceneHtml, /https:\/\/esm\.sh/);
    const sceneBundle = await request("/scene/scene.bundle.js");
    assert.equal(sceneBundle.status, 200);
    assert.match(sceneBundle.headers.get("content-type"), /javascript/);
    const qr = await request("/api/mobile/qr?ip=192.168.1.50");
    assert.equal(qr.status, 200);
    assert.match(qr.headers.get("content-type"), /image\/png/);
    assert.equal((await request("/api/mobile/qr?ip=127.0.0.1")).status, 400);
    assert.equal(
      (await (await request("/api/mobile/qr?ip=127.0.0.1")).json()).code,
      "R-HTTP-400",
    );
    const health = await (await request("/api/health")).json();
    assert.equal(health.app, "routine");
    assert.match(health.projectId, /^[a-f0-9]{64}$/);
    const { promisify } = require("node:util");
    const run = promisify(require("node:child_process").execFile);
    const duplicate = await run(
      process.execPath,
      [path.resolve(__dirname, "../server.js")],
      {
        env: { ...process.env, PORT: String(server.address().port) },
        timeout: 5000,
      },
    );
    assert.match(duplicate.stdout, /Routine já está aberto/);
    assert.deepEqual(await (await request("/api/state")).json(), {
      state: null,
      revision: 0,
    });
    stream = await request("/api/events");
    reader = stream.body.getReader();
    assert.match(
      new TextDecoder().decode((await reader.read()).value),
      /data: 0/,
    );
    const state = {
      currentCycle: "c",
      cycles: [
        { id: "c", name: "Test", start: "2026-11-06", goal: 20, workouts: [] },
      ],
      history: [],
      diary: {},
      profile: { height: 1.7, weight: 69, notes: "", weights: [] },
      goals: [],
    };
    const post = (revision, state) =>
      request("/api/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision, state }),
      });
    assert.equal((await post(0, state)).status, 200);
    assert.match(
      new TextDecoder().decode((await reader.read()).value),
      /data: 1/,
    );
    assert.equal((await post(0, state)).status, 409);
    assert.equal((await post(1, {})).status, 400);
    const invalid = structuredClone(state);
    invalid.cycles[0].goal = 0;
    assert.equal((await post(1, invalid)).status, 400);
    assert.equal(
      (
        await request("/api/state", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{invalid",
        })
      ).status,
      400,
    );
    assert.equal((await request("/.runtime/server-control.json")).status, 404);
    assert.equal(
      (await request("/api/shutdown", { method: "POST" })).status,
      403,
    );
    const writes = await Promise.all([post(1, state), post(1, state)]);
    assert.deepEqual(writes.map((r) => r.status).sort(), [200, 409]);
    assert.equal(
      JSON.parse(await fs.readFile(process.env.ROUTINE_DB)).revision,
      2,
    );
    await reader.cancel();
    reader = null;
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    server = await start();
    assert.equal((await (await request("/api/state")).json()).revision, 2);
    const control = JSON.parse(
      await fs.readFile(path.join(dir, ".runtime", "server-control.json")),
    );
    const stopped = new Promise((resolve) => server.once("close", resolve));
    assert.equal(
      (
        await request("/api/shutdown", {
          method: "POST",
          headers: { "X-Routine-Token": control.token },
        })
      ).status,
      200,
    );
    await stopped;
  } finally {
    if (reader) await reader.cancel();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await fs.rm(dir, { recursive: true, force: true });
  }
});
