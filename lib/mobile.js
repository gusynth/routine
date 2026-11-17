const { isIP } = require("node:net");
const QRCode = require("qrcode");
function mobileUrl(ip, port = 3000) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  if (typeof ip !== "string" || isIP(ip) !== 4) return null;
  const b = ip.split(".").map(Number);
  if (
    b[0] === 0 ||
    b[0] === 127 ||
    b[0] >= 224 ||
    (b[0] === 169 && b[1] === 254)
  )
    return null;
  return `http://${ip}:${port}`;
}
async function mobileQr(ip, port = 3000) {
  const url = mobileUrl(ip, port);
  if (!url) throw new TypeError("Endereço de rede inválido");
  return QRCode.toBuffer(url, {
    type: "png",
    width: 256,
    margin: 4,
    errorCorrectionLevel: "M",
    color: { dark: "#000000", light: "#ffffff" },
  });
}
function mobileNetworks(
  interfaces = require("node:os").networkInterfaces(),
  port = 3000,
) {
  const found = new Map();
  for (const [name, addresses] of Object.entries(interfaces))
    for (const address of addresses || []) {
      if (address.internal || !["IPv4", 4].includes(address.family)) continue;
      const ip = address.address,
        parts = ip.split(".").map(Number);
      if (!(
        parts[0] === 10 ||
        (parts[0] === 192 && parts[1] === 168) ||
        (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
      ))
        continue;
      const url = mobileUrl(ip, port);
      if (url && !found.has(ip)) found.set(ip, { name, ip, url });
    }
  return [...found.values()].sort(
    (a, b) =>
      Number(
        /virtual|vethernet|vpn|docker|vmware|wsl|tailscale/i.test(a.name),
      ) -
        Number(
          /virtual|vethernet|vpn|docker|vmware|wsl|tailscale/i.test(b.name),
        ) || a.name.localeCompare(b.name),
  );
}
module.exports = { mobileUrl, mobileQr, mobileNetworks };
