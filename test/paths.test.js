const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os");
const { resolvePaths } = require("../lib/paths");
test("all modes separate user data from code and validate installed markers", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "routine-layout-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const env = { LOCALAPPDATA: path.join(root, "fake-user") };
  assert.equal(resolvePaths(root, env, "win32").database, path.join(env.LOCALAPPDATA, "Routine", "database.json"));
  assert.throws(() => resolvePaths(root, {}, "win32"), /indisponível/);
  await fs.writeFile(
    path.join(root, "routine.install.json"),
    "\uFEFF" + JSON.stringify({ appId: "Routine", layoutVersion: 1 }),
  );
  const installed = resolvePaths(root, env, "win32");
  assert.equal(
    installed.database,
    path.join(env.LOCALAPPDATA, "Routine", "database.json"),
  );
  assert.equal(
    installed.runtime,
    path.join(env.LOCALAPPDATA, "Routine", ".runtime"),
  );
  assert.equal(
    resolvePaths(
      root,
      { ...env, ROUTINE_DATA_DIR: path.join(root, "custom") },
      "win32",
    ).dataDir,
    path.join(root, "custom"),
  );
  assert.equal(
    resolvePaths(
      root,
      { ROUTINE_DB: path.join(root, "fixture", "qa.json") },
      "win32",
    ).database,
    path.join(root, "fixture", "qa.json"),
  );
  assert.throws(() => resolvePaths(root, {}, "win32"), /indisponível/);
  await fs.writeFile(
    path.join(root, "routine.install.json"),
    '{"appId":"Other","layoutVersion":1}',
  );
  assert.throws(() => resolvePaths(root, env, "win32"), /inválido/);
});
