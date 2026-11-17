const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os"),
  zlib = require("node:zlib"),
  express = require("express");
const { networkGuard } = require("../lib/network-guard"),
  { compressedAssets } = require("../lib/static-assets");
test("network guard accepts LAN/localhost/tunnels and rejects rebinding or cross-site API requests", () => {
  function check(host, origin, site, extra = "") {
    let status = 200,
      body,
      continued = false;
    networkGuard(extra)(
      {
        path: "/api/state",
        get: (key) => ({ host, origin, "sec-fetch-site": site })[key],
      },
      {
        status(value) {
          status = value;
          return this;
        },
        json(value) {
          body = value;
        },
      },
      () => (continued = true),
    );
    return { status, body, continued };
  }
  for (const host of [
    "localhost:3000",
    "127.0.0.1:3000",
    "192.168.1.2:3000",
    "10.0.0.2:3000",
    "172.20.0.2:3000",
    "abc.ngrok-free.dev",
    "abc.ngrok-free.app",
  ])
    assert.equal(check(host).continued, true);
  assert.equal(check("evil.test").body.code, "R-SEC-001");
  assert.equal(check("abc.ngrok-free.app.evil.test").status, 403);
  assert.equal(
    check("localhost:3000", "https://evil.test").body.code,
    "R-SEC-002",
  );
  assert.equal(check("localhost:3000", "null").status, 403);
  assert.equal(check("localhost:3000", undefined, "cross-site").status, 403);
  assert.equal(
    check("localhost:3000", "http://localhost:3000").continued,
    true,
  );
  assert.equal(
    check("custom.example", undefined, undefined, "custom.example").continued,
    true,
  );
});
test("compressed assets preserve decoded contents, negotiate encoding and never serve a stale build", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "routine-static-"));
  const file = path.join(directory, "scene.bundle.js"),
    source = "console.log('fixture');".repeat(40);
  await fs.writeFile(file, source);
  await fs.writeFile(file + ".br", zlib.brotliCompressSync(source));
  await fs.writeFile(file + ".gz", zlib.gzipSync(source));
  const app = express();
  app.use(compressedAssets(directory));
  app.use(express.static(directory));
  const server = await new Promise((r) => {
    const s = app.listen(0, "127.0.0.1", () => r(s));
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${server.address().port}/scene.bundle.js`;
  for (const encoding of ["br", "gzip"]) {
    const response = await fetch(url, {
      headers: { "Accept-Encoding": encoding },
    });
    assert.equal(response.headers.get("content-encoding"), encoding);
    assert.match(response.headers.get("vary"), /Accept-Encoding/);
    assert.equal(await response.text(), source);
  }
  const identity = await fetch(url, {
    headers: { "Accept-Encoding": "identity" },
  });
  assert.equal(identity.headers.get("content-encoding"), null);
  assert.equal(await identity.text(), source);
  const head = await fetch(url, {
    method: "HEAD",
    headers: { "Accept-Encoding": "br" },
  });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  await fs.writeFile(file, "updated live source");
  const future = new Date(Date.now() + 3000);
  await fs.utimes(file, future, future);
  const updated = await fetch(url, { headers: { "Accept-Encoding": "br" } });
  assert.equal(updated.headers.get("content-encoding"), null);
  assert.equal(await updated.text(), "updated live source");
});
