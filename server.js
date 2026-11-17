const express = require("express");
const fs = require("node:fs/promises");
const path = require("node:path");
const { validateState } = require("./lib/state");
const { mobileUrl, mobileQr } = require("./lib/mobile");
const { createBackups, validateBackup, summary } = require("./lib/backups");
const app = express();
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Referrer-Policy", "same-origin");
  next();
});
app.use(
  require("./lib/network-guard").networkGuard(
    process.env.ROUTINE_ALLOWED_HOSTS,
  ),
);
const projectId = require("node:crypto")
  .createHash("sha256")
  .update(path.resolve(__dirname).toLowerCase())
  .digest("hex");
const file = require("./lib/paths").resolvePaths(__dirname).database;
const controlFile = path.join(
  path.dirname(file),
  ".runtime",
  "server-control.json",
);
const backups = createBackups(file);
const devices = new Map(),
  restorePreviews = new Map();
function pendingDevices(exclude) {
  const now = Date.now();
  for (const [id, device] of devices)
    if (now - device.seen > 45000) devices.delete(id);
  return [...devices.entries()]
    .filter(([id, d]) => id !== exclude && d.pending)
    .map(([, d]) => d.description);
}
function authorizedLocal(req) {
  return (
    ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
      req.socket.remoteAddress,
    ) && req.get("X-Routine-Token") === shutdownToken
  );
}
function enqueue(task, res) {
  queue = queue.then(task).catch((error) => {
    console.error(error);
    if (!res.headersSent)
      res.status(500).json({
        error:
          "Não foi possível salvar no disco. Nenhuma restauração foi concluída.",
        code: "R-DISK-001",
      });
  });
}
async function writeState(next) {
  const payload = { state: next, revision: revision + 1 };
  await backups.write(state ? { state, revision } : payload, "auto");
  await fs.writeFile(file + ".tmp", JSON.stringify(payload, null, 2), "utf8");
  await fs.rename(file + ".tmp", file);
  state = next;
  revision = payload.revision;
  for (const client of clients) client.write(`data: ${revision}\n\n`);
  return payload;
}
const shutdownToken = require("node:crypto").randomBytes(32).toString("hex");
let activeServer,
  closing = false;
let state = null,
  revision = 0;
const clients = new Set();
let queue = Promise.resolve();
// Stable error codes on every JSON API failure, without recording request bodies.
app.use("/api", (req, res, next) => {
  const json = res.json.bind(res);
  res.json = (payload) => {
    if (payload?.error && !payload.code)
      payload = { ...payload, code: `R-HTTP-${res.statusCode}` };
    return json(payload);
  };
  next();
});
app.use(express.json({ limit: "2mb" }));
app.use("/api", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
app.get("/api/state", (req, res) => res.json({ state, revision }));
app.get("/api/mobile", (req, res) =>
  res.json({
    active: true,
    port: req.socket.localPort,
    networks: require("./lib/mobile").mobileNetworks(
      undefined,
      req.socket.localPort,
    ),
  }),
);
app.get("/api/mobile/qr", async (req, res, next) => {
  if (!mobileUrl(req.query.ip))
    return res.status(400).json({ error: "Endereço de rede inválido" });
  try {
    res.type("png").send(await mobileQr(req.query.ip, req.socket.localPort));
  } catch (error) {
    next(error);
  }
});
app.get("/api/health", (req, res) =>
  res.json({
    app: "routine",
    projectId,
    pid: process.pid,
    version: require("./package.json").version,
  }),
);
app.post("/api/presence", (req, res) => {
  const { id, pending, description } = req.body || {};
  if (
    typeof id !== "string" ||
    !/^[a-zA-Z0-9_-]{1,100}$/.test(id) ||
    typeof pending !== "boolean"
  )
    return res.status(400).json({ error: "Presença inválida" });
  pendingDevices();
  if (devices.size >= 200 && !devices.has(id))
    return res.status(429).json({ error: "Muitos dispositivos" });
  devices.set(id, {
    seen: Date.now(),
    pending,
    description: [
      "treino em andamento",
      "registros aguardando sincronização",
    ].includes(description)
      ? description
      : "preenchimento local",
  });
  res.json({ ok: true });
});
app.get("/api/shutdown-check", (req, res) => {
  if (!authorizedLocal(req))
    return res.status(403).json({ error: "Não autorizado" });
  const pending = pendingDevices();
  res.json({ pending: pending.length, descriptions: [...new Set(pending)] });
});
app.get("/api/backups", async (req, res, next) => {
  try {
    res.json({ backups: await backups.list() });
  } catch (e) {
    next(e);
  }
});
app.post("/api/backups", (req, res) => {
  if (closing)
    return res.status(503).json({ error: "Routine está encerrando" });
  enqueue(async () => {
    if (!state)
      return res.status(400).json({
        error: "Salve seu primeiro registro antes de criar um backup.",
      });
    const id = await backups.write({ state, revision }, "manual");
    res.json({ id });
  }, res);
});
app.get("/api/backups/export", (req, res) => {
  if (!state) return res.status(400).json({ error: "Nenhum registro salvo" });
  res
    .attachment(`routine-backup-${new Date().toISOString().slice(0, 10)}.json`)
    .json({
      format: "routine-backup-v1",
      createdAt: new Date().toISOString(),
      state,
      revision,
    });
});
app.post("/api/backups/preview", async (req, res) => {
  try {
    const payload = validateBackup(
      req.body?.backupId
        ? await backups.read(req.body.backupId)
        : req.body?.backup,
    );
    for (const [token, preview] of restorePreviews)
      if (Date.now() - preview.created > 600000) restorePreviews.delete(token);
    if (restorePreviews.size >= 10)
      return res.status(429).json({
        error: "Feche as prévias antigas e tente novamente em alguns minutos.",
      });
    const token = require("node:crypto").randomBytes(24).toString("hex"),
      deviceId = req.body?.deviceId;
    restorePreviews.set(token, {
      payload,
      revision,
      created: Date.now(),
      deviceId,
    });
    res.json({
      token,
      revision,
      current: summary(state),
      backup: summary(payload.state),
      pendingDevices: pendingDevices(deviceId).length,
    });
  } catch {
    res.status(400).json({
      error: "Backup inválido ou indisponível. Nenhum dado foi alterado.",
    });
  }
});
app.post("/api/backups/restore", (req, res) => {
  if (closing)
    return res.status(503).json({ error: "Routine está encerrando" });
  enqueue(async () => {
    const preview = restorePreviews.get(req.body?.token);
    if (!preview || Date.now() - preview.created > 600000)
      return res
        .status(400)
        .json({ error: "Prévia expirada. Confira o backup novamente." });
    if (req.body.revision !== revision || preview.revision !== revision)
      return res.status(409).json({
        error: "O banco mudou. Reabra a prévia antes de restaurar.",
        state,
        revision,
      });
    if (pendingDevices(preview.deviceId).length)
      return res.status(409).json({
        error:
          "Há outro aparelho com alterações pendentes. Termine esse uso antes de restaurar.",
      });
    if (state) await backups.write({ state, revision }, "restore");
    const result = await writeState(preview.payload.state);
    restorePreviews.delete(req.body.token);
    res.json(result);
  }, res);
});
app.post("/api/shutdown", (req, res) => {
  if (!authorizedLocal(req))
    return res.status(403).json({ error: "Não autorizado" });
  if (closing) return res.status(409).json({ error: "Encerrando" });
  closing = true;
  res.json({ closing: true });
  // Finish accepted disk writes before disconnecting devices and releasing the port.
  queue.finally(() => {
    for (const client of clients) client.end();
    activeServer.close();
    activeServer.closeAllConnections();
  });
});
app.get("/api/events", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders();
  res.write(`data: ${revision}\n\n`);
  clients.add(res);
  const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 20000);
  req.on("close", () => {
    clearInterval(heartbeat);
    clients.delete(res);
  });
});
app.post("/api/state", (req, res) => {
  if (closing)
    return res
      .status(503)
      .json({ error: "Routine está encerrando. Reabra pelo atalho do aplicativo." });
  const task = async () => {
    if (!req.body || !Number.isInteger(req.body.revision))
      return res.status(400).json({ error: "Revisão inválida" });
    if (req.body.revision !== revision)
      return res.status(409).json({
        error:
          "Os dados mudaram em outro dispositivo. Recarregue e tente novamente.",
        state,
        revision,
      });
    const next = req.body.state;
    if (!validateState(next))
      return res.status(400).json({ error: "Estado inválido" });
    const payload = await writeState(next);
    res.json(payload);
  };
  enqueue(task, res);
});

app.use(
  require("./lib/static-assets").compressedAssets(
    path.join(__dirname, "public"),
  ),
);
app.use(
  express.static(path.join(__dirname, "public"), {
    setHeaders(res, file) {
      if (/\.(js|css|svg)$/.test(file)) res.vary("Accept-Encoding");
    },
  }),
);
app.get("/favicon.ico", (req, res) =>
  res.sendFile(path.join(__dirname, "assets", "routine.ico")),
);
app.use((err, req, res, next) =>
  res.status(err.status || 500).json({ error: err.message }),
);
async function start() {
  try {
    const data = JSON.parse(await fs.readFile(file, "utf8"));
    if (
      !Number.isInteger(data.revision) ||
      data.revision < 0 ||
      !validateState(data.state)
    )
      throw new Error(
        "O banco de dados é inválido. Restaure um backup; o arquivo não foi alterado.",
      );
    state = data.state;
    revision = data.revision;
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  return new Promise((resolve, reject) => {
    const server = app.listen(process.env.PORT || 3000, "0.0.0.0", async () => {
      activeServer = server;
      closing = false;
      try {
        await fs.mkdir(path.dirname(controlFile), { recursive: true });
        await fs.writeFile(
          controlFile,
          JSON.stringify({
            projectId,
            pid: process.pid,
            token: shutdownToken,
            port: server.address().port,
          }),
          "utf8",
        );
      } catch (err) {
        server.close();
        reject(err);
        return;
      }
      console.log("Routine → http://localhost:" + server.address().port);
      resolve(server);
    });
    server.on("error", reject);
  });
}
if (require.main === module)
  start().catch(async (err) => {
    if (err.code === "EADDRINUSE") {
      try {
        const response = await fetch(
          "http://127.0.0.1:" + (process.env.PORT || 3000) + "/api/health",
          { signal: AbortSignal.timeout(1500) },
        );
        const health = await response.json();
        if (health.app === "routine" && health.projectId === projectId) {
          console.log(
            "Routine já está aberto → http://localhost:" +
              (process.env.PORT || 3000),
          );
          return;
        }
      } catch {}
      console.error(
        "A porta " +
          (process.env.PORT || 3000) +
          " já está ocupada. Abra o Routine pelo atalho do aplicativo para verificar o servidor existente.",
      );
    } else console.error(err);
    process.exitCode = 1;
  });
module.exports = { app, start };
