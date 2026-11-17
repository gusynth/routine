const { test } = require("node:test");
const assert = require("node:assert/strict");
const { PNG } = require("pngjs");
const jsQR = require("jsqr");
const { mobileUrl, mobileQr } = require("../lib/mobile");
test("local QR encodes the exact phone address and rejects invalid hosts", async () => {
  assert.equal(mobileUrl("192.168.1.50"), "http://192.168.1.50:3000");
  for (const ip of [
    "127.0.0.1",
    "0.0.0.0",
    "169.254.1.5",
    "224.0.0.1",
    "::1",
    "https://example.com",
    "192.168.1.50/evil",
    undefined,
    ["10.0.0.1"],
  ])
    assert.equal(mobileUrl(ip), null);
  const buffer = await mobileQr("192.168.1.50"),
    png = PNG.sync.read(buffer);
  assert.equal(png.width, 256);
  assert.equal(png.height, 256);
  const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  assert.equal(decoded.data, "http://192.168.1.50:3000");
  await assert.rejects(mobileQr("127.0.0.1"));
});

test("network discovery prefers physical adapters, excludes public/loopback and encodes alternate ports", async () => {
  const { mobileNetworks } = require("../lib/mobile");
  const entry = (address, extra = {}) => ({
    address,
    family: "IPv4",
    internal: false,
    ...extra,
  });
  const networks = mobileNetworks(
    {
      Docker: [entry("172.20.0.1")],
      "Wi-Fi": [entry("192.168.1.50"), entry("192.168.1.50")],
      Loopback: [entry("127.0.0.1", { internal: true })],
      External: [entry("8.8.8.8"), entry("fe80::1", { family: "IPv6" })],
    },
    4123,
  );
  assert.equal(networks.length, 2);
  assert.equal(networks[0].url, "http://192.168.1.50:4123");
  assert.deepEqual(mobileNetworks({}, 3000), []);
  for (const port of [0, -1, 65536, "3000"])
    assert.equal(mobileUrl("10.0.0.1", port), null);
  const png = PNG.sync.read(await mobileQr("192.168.1.50", 4123));
  assert.equal(
    jsQR(new Uint8ClampedArray(png.data), png.width, png.height).data,
    networks[0].url,
  );
});
