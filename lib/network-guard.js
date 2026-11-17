const { isIP } = require("node:net");
function localHost(host) {
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local")
  )
    return true;
  const ip = host.replace(/^\[|\]$/g, "");
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 127 ||
      a === 10 ||
      (a === 192 && b === 168) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 169 && b === 254)
    );
  }
  return ip === "::1" || /^f[cd][0-9a-f:]+$/i.test(ip) || /^fe80:/i.test(ip);
}
function networkGuard(extraHosts = "") {
  const extra = new Set(
    extraHosts
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
  return (req, res, next) => {
    let host;
    try {
      host = new URL("http://" + req.get("host")).hostname.toLowerCase();
    } catch {
      return res
        .status(403)
        .json({ error: "Host inválido", code: "R-SEC-001" });
    }
    const tunnel = [
      "ngrok-free.app",
      "ngrok-free.dev",
      "ngrok.app",
      "ngrok.io",
    ].some((s) => host.endsWith("." + s));
    if (!localHost(host) && !tunnel && !extra.has(host))
      return res.status(403).json({
        error:
          "Host não permitido. Configure ROUTINE_ALLOWED_HOSTS para um domínio próprio.",
        code: "R-SEC-001",
      });
    if (req.path.startsWith("/api/")) {
      const origin = req.get("origin");
      try {
        if (
          req.get("sec-fetch-site") === "cross-site" ||
          (origin &&
            (origin === "null" ||
              new URL(origin).origin !==
                new URL(new URL(origin).protocol + "//" + req.get("host"))
                  .origin))
        )
          return res
            .status(403)
            .json({ error: "Origem não permitida", code: "R-SEC-002" });
      } catch {
        return res
          .status(403)
          .json({ error: "Origem inválida", code: "R-SEC-002" });
      }
    }
    next();
  };
}
module.exports = { networkGuard };
