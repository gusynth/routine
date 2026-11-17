const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

function resolvePaths(root, env = process.env, platform = process.platform) {
  const marker = path.join(root, "routine.install.json");
  const installed = fs.existsSync(marker);
  if (installed) {
    const config = JSON.parse(
      fs.readFileSync(marker, "utf8").replace(/^\uFEFF/, ""),
    );
    if (config.appId !== "Routine" || config.layoutVersion !== 1)
      throw Error("Layout de instalação Routine inválido.");
  }
  let dataDir;
  if (env.ROUTINE_DB) dataDir = path.dirname(path.resolve(env.ROUTINE_DB));
  else if (env.ROUTINE_DATA_DIR) dataDir = path.resolve(env.ROUTINE_DATA_DIR);
  else {
    const base =
      platform === "win32"
        ? env.LOCALAPPDATA
        : env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
    if (!base) throw Error("Pasta de dados do usuário indisponível.");
    dataDir = path.join(base, "Routine");
  }
  const database = env.ROUTINE_DB
    ? path.resolve(env.ROUTINE_DB)
    : path.join(dataDir, "database.json");
  return {
    installed,
    dataDir: path.dirname(database),
    database,
    runtime: path.join(path.dirname(database), ".runtime"),
  };
}
module.exports = { resolvePaths };
