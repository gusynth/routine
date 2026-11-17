// Device-local outbox. Replay only changed records, never a stale full database.
let outbox = null,
  connected = true,
  syncConflict = null,
  syncRetry,
  presenceTimer,
  presenceDelay;
let deviceId;
function stateChanges(base, next) {
  const changes = [];
  for (const key of ["profile", "goals", "currentCycle", "favorites"]) {
    if (!same(base?.[key], next?.[key]))
      changes.push({
        key,
        before: base?.[key],
        after: next?.[key],
        label: {
          profile: "Perfil",
          goals: "Metas alimentares",
          favorites: "Refeições favoritas",
          currentCycle: "Ciclo atual",
        }[key],
      });
  }
  for (const key of ["cycles", "history", "diary"]) {
    const entries = (value) =>
      new Map(
        key === "diary"
          ? Object.entries(value || {})
          : (value || []).map((v) => [v.id, v]),
      );
    const old = entries(base?.[key]),
      updated = entries(next?.[key]);
    for (const id of new Set([...old.keys(), ...updated.keys()])) {
      if (!same(old.get(id), updated.get(id)))
        changes.push({
          key,
          id,
          before: old.get(id),
          after: updated.get(id),
          label:
            key === "diary"
              ? `Diário ${id}`
              : key === "history"
                ? `Treino ${updated.get(id)?.workout?.name || old.get(id)?.workout?.name || id}`
                : `Ciclo ${updated.get(id)?.name || old.get(id)?.name || id}`,
        });
    }
  }
  return changes;
}
function mergeState(base, next, remote, choice) {
  if (!remote) return { merged: clone(next), conflicts: [] };
  const merged = clone(remote),
    conflicts = [];
  for (const change of stateChanges(base, next)) {
    const { key, id, after, before } = change;
    const current =
      id === undefined
        ? remote[key]
        : key === "diary"
          ? remote[key][id]
          : remote[key].find((v) => v.id === id);
    const conflict = !same(current, before) && !same(current, after);
    if (conflict) {
      conflicts.push(change);
      if (choice !== "local") continue;
    }
    if (id === undefined) merged[key] = clone(after);
    else if (key === "diary") {
      if (after === undefined) delete merged[key][id];
      else merged[key][id] = clone(after);
    } else {
      const index = merged[key].findIndex((v) => v.id === id);
      if (after === undefined) {
        if (index >= 0) merged[key].splice(index, 1);
      } else if (index < 0) merged[key].push(clone(after));
      else merged[key][index] = clone(after);
    }
  }
  return { merged, conflicts };
}
function localWorkPending(ignoreBusy = false) {
  if (
    session ||
    (busy && !ignoreBusy) ||
    outbox ||
    diaryDirty ||
    (editing && !same(editing, editingBase))
  )
    return true;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (
        key.startsWith("routine:diary:") ||
        key === "routine:editor" ||
        key === "routine:session"
      )
        return true;
    }
  } catch {}
  return false;
}
function syncLabel() {
  if (busy) return "Sincronizando…";
  if (outbox)
    return syncConflict
      ? "Há alterações em conflito · revise antes de sincronizar"
      : "Salvo neste aparelho · aguardando sincronização com o PC";
  if (!connected)
    return "Sem conexão com o PC · preenchimento guardado neste aparelho";
  if (localWorkPending())
    return "Guardado neste aparelho · alterações ainda não enviadas";
  return "Salvo no PC · sincronizado";
}
function updateSyncStatus() {
  const label = syncLabel();
  const clean = connected && !outbox && !localWorkPending(true);
  const panel = $("#syncPanel"),
    nextState = clean ? "clean" : "pending";
  if (panel && panel.dataset.state !== nextState)
    RoutineMotion.sync(panel, () => (panel.dataset.state = nextState));
  if ($("#syncStatus")) {
    const text = clean ? (busy ? "Salvando…" : "Sincronizado") : label;
    if ($("#syncStatus").textContent !== text)
      $("#syncStatus").textContent = text;
    $("#syncStatus").title = label;
  }
  if ($("#connection"))
    $("#connection").textContent = connected
      ? "Conectado ao PC"
      : "Sem conexão com o PC";
  const button = $("#syncAction");
  if (button) {
    button.hidden = !outbox;
    button.textContent = syncConflict ? "Revisar" : "Reenviar";
    button.disabled = busy;
  }
  try {
    window.chrome?.webview?.postMessage({
      type: "routine-pending",
      pending: localWorkPending(),
    });
  } catch {}
  clearTimeout(presenceDelay);
  presenceDelay = setTimeout(reportPresence, 400);
}
async function reportPresence() {
  if (!deviceId || !state) return;
  try {
    await fetch("/api/presence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: deviceId,
        pending: localWorkPending(),
        description: session
          ? "treino em andamento"
          : outbox
            ? "registros aguardando sincronização"
            : "preenchimento local",
      }),
      signal: AbortSignal.timeout(2000),
      keepalive: true,
    });
  } catch {}
}
function initSync() {
  outbox = cache.get("outbox");
  deviceId = cache.get("device-id") || id();
  cache.set("device-id", deviceId);
  presenceTimer = setInterval(reportPresence, 20000);
}
function cacheServerState(data) {
  if (data?.state) cache.set("last-state", data);
}
function retryLater() {
  clearTimeout(syncRetry);
  syncRetry = setTimeout(() => retryPending(), 30000);
}
async function saveState(next) {
  if (busy) {
    toast("Aguarde o salvamento em andamento.");
    return false;
  }
  if (outbox) {
    const pending = { ...outbox, next: clone(next) };
    if (!cache.set("outbox", pending)) return false;
    outbox = pending;
    state = clone(next);
    updateSyncStatus();
    await retryPending();
    return true;
  }
  busy = true;
  updateSyncStatus();
  const base = clone(state);
  try {
    let response;
    try {
      response = await fetch("/api/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: next, revision }),
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      const pending = {
        base,
        next: clone(next),
        createdAt: new Date().toISOString(),
      };
      if (!cache.set("outbox", pending)) return false;
      outbox = pending;
      state = clone(next);
      connected = false;
      retryLater();
      toast("Salvo neste aparelho. Será enviado ao PC ao reconectar.");
      return true;
    }
    const data = await response.json();
    connected = true;
    if (!response.ok) {
      if (response.status === 409) {
        state = data.state;
        revision = data.revision;
        cacheServerState(data);
      }
      throw Error(data.error || "Não foi possível salvar.");
    }
    state = data.state;
    revision = data.revision;
    cacheServerState(data);
    return true;
  } catch (error) {
    toast(
      error.message + " Seus campos continuam disponíveis para tentar de novo.",
    );
    return false;
  } finally {
    busy = false;
    updateSyncStatus();
  }
}
async function retryPending() {
  if (busy || !outbox) return;
  busy = true;
  updateSyncStatus();
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const remote = await refresh();
      connected = true;
      const { merged, conflicts } = mergeState(
        outbox.base,
        outbox.next,
        remote.state,
      );
      if (conflicts.length) {
        syncConflict = { ...remote, conflicts };
        return;
      }
      if (same(merged, remote.state)) {
        state = merged;
        revision = remote.revision;
        cacheServerState(remote);
        outbox = null;
        syncConflict = null;
        cache.remove("outbox");
        break;
      }
      const response = await fetch("/api/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: merged, revision: remote.revision }),
        signal: AbortSignal.timeout(10000),
      });
      if (response.status === 409) continue;
      const data = await response.json();
      if (!response.ok) {
        syncConflict = {
          ...remote,
          conflicts: [],
          error: data.error || "Não foi possível sincronizar.",
        };
        return;
      }
      state = data.state;
      revision = data.revision;
      cacheServerState(data);
      outbox = null;
      syncConflict = null;
      cache.remove("outbox");
      break;
    }
    if (outbox) retryLater();
    else {
      clearTimeout(syncRetry);
      if (!session && !editing && !diaryDirty && !$("#modal").open) render();
    }
  } catch {
    connected = false;
    retryLater();
  } finally {
    busy = false;
    updateSyncStatus();
  }
}
function describeConflictValue(change, value) {
  if (!value) return "Registro ausente.";
  if (change.key === "diary")
    return (
      Object.entries(value.meals || {})
        .map(([meal, text]) => `${meal}: ${text || "Não registrado"}`)
        .join("\n") +
      "\nSituação: " +
      (value.status === "complete" ? "Finalizado" : "Rascunho")
    );
  if (change.key === "profile")
    return `Altura: ${value.height} m\nPeso: ${value.weight} kg\nObservações: ${value.notes || "Sem observações"}`;
  if (change.key === "goals" || change.key === "favorites")
    return value.map((goal) => goal.name).join("\n");
  if (change.key === "cycles")
    return `${value.name} · meta de ${value.goal} treinos\n${value.workouts.map((workout) => workout.name + ": " + workout.exercises.length + " exercícios").join("\n")}`;
  if (change.key === "history")
    return `${value.workout.name} · ${value.date}\n${value.results.map((result) => result.name + ", série " + result.series + ": " + result.actual + (result.type === "time" ? "s" : " reps")).join("\n")}\n${value.notes || "Sem observações"}`;
  return (
    state.cycles.find((cycle) => cycle.id === value)?.name ||
    "Ciclo selecionado"
  );
}
function showPendingConflict() {
  if (!outbox) return;
  if (!syncConflict) {
    retryPending();
    return;
  }
  openModal(
    `<h2>Revisar sincronização</h2><p class="footnote">Seu preenchimento continua salvo neste aparelho. Confira as diferenças antes de escolher. Os demais registros serão preservados.</p>${syncConflict.error ? `<p class="estimate-note">${esc(syncConflict.error)}</p>` : syncConflict.conflicts.map((c) => `<details class="sequence-panel"><summary>${esc(c.label)}</summary><label>Neste aparelho</label><pre class="backup-preview">${esc(describeConflictValue(c, c.after))}</pre><label>Versão do PC</label><pre class="backup-preview">${esc(describeConflictValue(c, c.id === undefined ? syncConflict.state[c.key] : c.key === "diary" ? syncConflict.state[c.key][c.id] : syncConflict.state[c.key].find((v) => v.id === c.id)))}</pre></details>`).join("")}<div class="timeractions"><button class="btn" onclick="closeModal()">Decidir depois</button>${syncConflict.conflicts.length ? '<button class="btn" onclick="resolvePending(\'remote\')">Manter versão do PC nos conflitos</button><button class="btn primary" onclick="resolvePending(\'local\')">Manter minha versão nos conflitos</button>' : ""}</div>`,
  );
}
async function resolvePending(choice) {
  if (busy || !outbox || !syncConflict || !["local", "remote"].includes(choice))
    return;
  const snapshot = syncConflict;
  try {
    const remote = await refresh();
    if (remote.revision !== snapshot.revision) {
      syncConflict = {
        ...remote,
        ...mergeState(outbox.base, outbox.next, remote.state),
      };
      showPendingConflict();
      toast("O PC recebeu novas alterações. Confira novamente.");
      return;
    }
    const { merged } = mergeState(
      outbox.base,
      outbox.next,
      remote.state,
      choice,
    );
    const pending = {
      base: clone(remote.state),
      next: merged,
      createdAt: outbox.createdAt,
    };
    if (!cache.set("outbox", pending)) return;
    outbox = pending;
    state = clone(merged);
    syncConflict = null;
    closeModal();
    await retryPending();
  } catch {
    connected = false;
    toast("Reconecte ao PC antes de resolver o conflito.");
    updateSyncStatus();
  }
}
window.addEventListener("online", () => retryPending());
window.addEventListener("pagehide", () => {
  clearTimeout(syncRetry);
  clearTimeout(presenceDelay);
  clearInterval(presenceTimer);
  reportPresence();
});
window.addEventListener("pageshow", () => {
  if (deviceId) {
    clearInterval(presenceTimer);
    presenceTimer = setInterval(reportPresence, 20000);
    if (outbox) retryPending();
  }
});
