const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { createBackups, validateBackup, KEEP } = require("../lib/backups");
const seed = () => ({
  currentCycle: "c",
  cycles: [
    { id: "c", name: "Teste", start: "2026-11-09", goal: 20, workouts: [] },
  ],
  history: [],
  diary: {},
  profile: { height: 1.7, weight: 69, notes: "", weights: [] },
  goals: [],
});

test("backups validate, retain limited copies, recover a corrupt daily snapshot and reject paths", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "routine-backup-test-"));
  try {
    const backup = createBackups(path.join(dir, "database.json")),
      payload = { state: seed(), revision: 1 };
    assert.throws(() => validateBackup({ state: {}, revision: 1 }));
    const daily = await backup.write(payload, "auto");
    assert.equal(await backup.write(payload, "auto"), daily);
    await fs.writeFile(path.join(backup.directory, daily), "{broken");
    const repaired = await backup.write(payload, "auto");
    assert.notEqual(repaired, daily);
    assert.equal((await backup.read(repaired)).revision, 1);
    await assert.rejects(backup.read("../database.json"));
    for (let i = 0; i < 9; i++)
      await backup.write({ ...payload, revision: i }, "manual");
    assert.equal(
      (await backup.list()).filter((b) => b.type === "manual").length,
      KEEP.manual,
    );
    for (let i = 0; i < 9; i++)
      await backup.write({ ...payload, revision: i }, "restore");
    assert.equal(
      (await backup.list()).filter((b) => b.type === "restore").length,
      KEEP.restore,
    );
    for (let i = 1; i <= 20; i++)
      await fs.writeFile(
        path.join(
          backup.directory,
          `auto-2020-01-${String(i).padStart(2, "0")}.json`,
        ),
        JSON.stringify(payload),
      );
    // Force the next daily write to run retention by removing today's snapshots.
    await fs.unlink(path.join(backup.directory, daily));
    await fs.unlink(path.join(backup.directory, repaired));
    await backup.write(payload, "auto");
    assert.equal(
      (await backup.list()).filter((b) => b.type === "auto").length,
      KEEP.auto,
    );
    assert.equal(
      (await fs.readdir(backup.directory)).some((name) =>
        name.endsWith(".tmp"),
      ),
      false,
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("backup API exports, previews, prevents stale restores and preserves the replaced database", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "routine-backup-api-"));
  process.env.ROUTINE_DB = path.join(dir, "database.json");
  process.env.PORT = "0";
  const { start } = require("../server");
  const server = await start();
  const request = (route, body) =>
    fetch(
      `http://127.0.0.1:${server.address().port}${route}`,
      body === undefined
        ? {}
        : {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
    );
  try {
    assert.equal((await request("/api/backups/export")).status, 400);
    assert.equal((await request("/api/backups", {})).status, 400);
    const state = seed();
    let result = await (
      await request("/api/state", { state, revision: 0 })
    ).json();
    const automatic = (await (await request("/api/backups")).json()).backups[0];
    assert.equal(automatic.type, "auto");
    const exported = await request("/api/backups/export");
    assert.match(exported.headers.get("content-disposition"), /attachment/);
    assert.equal((await exported.json()).state.profile.weight, 69);
    state.profile.weight = 70;
    result = await (
      await request("/api/state", { state, revision: result.revision })
    ).json();
    assert.equal((await request("/api/backups", {})).status, 200);
    let preview = await (
      await request("/api/backups/preview", { backupId: automatic.id })
    ).json();
    assert.equal(preview.backup.cycles, 1);
    state.profile.weight = 71;
    result = await (
      await request("/api/state", { state, revision: result.revision })
    ).json();
    assert.equal(
      (
        await request("/api/backups/restore", {
          token: preview.token,
          revision: preview.revision,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await request("/api/backups/preview", {
          backup: { state: {}, revision: 0 },
        })
      ).status,
      400,
    );
    assert.equal(
      (await request("/api/backups/preview", { backupId: "../database.json" }))
        .status,
      400,
    );
    await request("/api/presence", {
      id: "phone",
      pending: true,
      description: "treino em andamento",
    });
    preview = await (
      await request("/api/backups/preview", { backupId: automatic.id })
    ).json();
    assert.equal(preview.pendingDevices, 1);
    assert.equal(
      (
        await request("/api/backups/restore", {
          token: preview.token,
          revision: preview.revision,
        })
      ).status,
      409,
    );
    const control = JSON.parse(
      await fs.readFile(path.join(dir, ".runtime/server-control.json"), "utf8"),
    );
    assert.equal((await request("/api/shutdown-check")).status, 403);
    let check = await fetch(
      `http://127.0.0.1:${server.address().port}/api/shutdown-check`,
      { headers: { "X-Routine-Token": control.token } },
    );
    assert.equal((await check.json()).pending, 1);
    await request("/api/presence", { id: "phone", pending: false });
    result = await (
      await request("/api/backups/restore", {
        token: preview.token,
        revision: preview.revision,
      })
    ).json();
    assert.equal(result.state.profile.weight, 69);
    assert.equal(result.revision, 4);
    assert.equal(
      (
        await request("/api/backups/restore", {
          token: preview.token,
          revision: result.revision,
        })
      ).status,
      400,
    );
    const list = (await (await request("/api/backups")).json()).backups;
    const before = list.find((b) => b.type === "restore");
    assert.ok(before);
    const beforeValue = JSON.parse(
      await fs.readFile(path.join(dir, "backups", before.id), "utf8"),
    );
    assert.equal(beforeValue.state.profile.weight, 71);
    assert.equal(
      JSON.parse(await fs.readFile(process.env.ROUTINE_DB, "utf8")).state
        .profile.weight,
      69,
    );
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  }
});
