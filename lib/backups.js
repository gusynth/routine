const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { validateState } = require("./state");
const KEEP = { auto: 14, manual: 5, restore: 5 };
function validateBackup(value) {
  if (
    !value ||
    !Number.isInteger(value.revision) ||
    value.revision < 0 ||
    !validateState(value.state)
  )
    throw Error("Backup inválido. Nenhum dado foi alterado.");
  return { state: value.state, revision: value.revision };
}
function summary(state) {
  return {
    cycles: state?.cycles.length || 0,
    workouts: state?.cycles.reduce((sum, c) => sum + c.workouts.length, 0) || 0,
    sessions: state?.history.length || 0,
    diaryDays: Object.keys(state?.diary || {}).length,
  };
}
function createBackups(database) {
  const directory = path.join(path.dirname(database), "backups");
  const validId = (name) =>
    /^(auto|manual|restore)-\d{4}-\d{2}-\d{2}(?:T[0-9-]+Z-[a-f0-9]{12})?\.json$/.test(
      name,
    );
  async function files() {
    try {
      return (await fs.readdir(directory)).filter(validId).sort().reverse();
    } catch (e) {
      if (e.code === "ENOENT") return [];
      throw e;
    }
  }
  async function prune(type) {
    const candidates = (await files()).filter((name) =>
      name.startsWith(type + "-"),
    );
    for (const name of candidates.slice(KEEP[type]))
      await fs.unlink(path.join(directory, name));
  }
  async function write(payload, type = "manual") {
    validateBackup(payload);
    await fs.mkdir(directory, { recursive: true });
    const now = new Date().toISOString(),
      name =
        type === "auto"
          ? `auto-${now.slice(0, 10)}.json`
          : `${type}-${now.replace(/[:.]/g, "-")}-${crypto.randomBytes(6).toString("hex")}.json`;
    let destination = name;
    if (type === "auto") {
      for (const candidate of (await files()).filter((n) =>
        n.startsWith(`auto-${now.slice(0, 10)}`),
      )) {
        try {
          await read(candidate);
          return candidate;
        } catch {}
      }
      try {
        await fs.access(path.join(directory, destination));
        destination = `auto-${now.replace(/[:.]/g, "-")}-${crypto.randomBytes(6).toString("hex")}.json`;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    const temporary = path.join(
      directory,
      `.${destination}-${crypto.randomBytes(6).toString("hex")}.tmp`,
    );
    try {
      await fs.writeFile(
        temporary,
        JSON.stringify(
          { format: "routine-backup-v1", createdAt: now, ...payload },
          null,
          2,
        ),
        { encoding: "utf8", flag: "wx" },
      );
      await fs.rename(temporary, path.join(directory, destination));
    } finally {
      await fs.unlink(temporary).catch(() => {});
    }
    await prune(type);
    return destination;
  }
  async function read(name) {
    if (!validId(name)) throw Error("Identificador de backup inválido.");
    const value = JSON.parse(
      await fs.readFile(path.join(directory, name), "utf8"),
    );
    validateBackup(value);
    return value;
  }
  async function list() {
    const results = [];
    for (const name of await files()) {
      try {
        const value = await read(name);
        results.push({
          id: name,
          createdAt: value.createdAt,
          revision: value.revision,
          type: name.split("-")[0],
          summary: summary(value.state),
        });
      } catch {
        results.push({ id: name, invalid: true });
      }
    }
    return results.sort((a, b) =>
      (b.createdAt || b.id).localeCompare(a.createdAt || a.id),
    );
  }
  return { write, read, list, directory };
}
module.exports = { createBackups, validateBackup, summary, KEEP };
