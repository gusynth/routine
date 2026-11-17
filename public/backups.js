function backupSummary(s) {
  return `${s.cycles} ciclo(s), ${s.workouts} treino(s), ${s.sessions} sessão(ões) e ${s.diaryDays} dia(s) de alimentação`;
}
async function backupDialog() {
  preserveWork();
  if (session) {
    toast("Finalize ou encerre o treino antes de restaurar dados.");
    return;
  }
  openModal(
    '<h2>Dados e backups</h2><p class="footnote">Carregando seus backups…</p>',
  );
  try {
    const response = await fetch("/api/backups");
    if (!response.ok) throw Error("Servidor indisponível");
    const data = await response.json();
    openModal(
      `<h2>Seus registros, protegidos.</h2><p class="footnote">Os backups ficam na pasta backups do Routine. Guardamos até 14 cópias diárias, 5 manuais e 5 anteriores a restaurações. Exporte também para outro local.</p><div class="backup-actions"><a class="btn" href="/api/backups/export" download>Exportar banco do PC</a><button class="btn" onclick="createManualBackup()">Criar backup agora</button></div><section class="backup-import"><h3>Importar uma cópia</h3><p class="footnote">Selecione um backup do Routine em formato JSON, até 2 MB.</p><input id="backupFile" type="file" accept="application/json,.json" aria-label="Arquivo de backup JSON" hidden onchange="previewImportedBackup(this)"><button type="button" class="btn" onclick="document.querySelector('#backupFile').click()">Selecionar backup</button><span id="backupFileName" class="footnote">Nenhum backup selecionado</span></section><p class="footnote">Importar primeiro mostra uma prévia. Seus dados só mudam depois de confirmar a restauração.</p><div class="backup-list">${data.backups.map((b) => `<div class="line"><b>${b.invalid ? "Backup inválido" : esc(new Date(b.createdAt).toLocaleString("pt-BR"))}</b><p class="footnote">${b.invalid ? esc(b.id) : `${{ auto: "Diário", manual: "Manual", restore: "Antes de restaurar" }[b.type]} · ${backupSummary(b.summary)}`}</p>${b.invalid ? "" : `<button class="btn small" onclick="previewBackup('${b.id}')">Conferir restauração</button>`}</div>`).join("") || '<p class="empty">Seu primeiro backup será criado ao salvar ou ao usar o botão acima.</p>'}</div><button class="btn action-after" onclick="closeModal()">Fechar</button>`,
    );
  } catch {
    openModal(
      '<h2>Backups indisponíveis</h2><p class="footnote">Reconecte ao PC para criar, exportar ou restaurar backups. Seus rascunhos locais continuam guardados.</p><button class="btn" onclick="closeModal()">Fechar</button>',
    );
  }
}
async function createManualBackup() {
  if (busy) return;
  try {
    const r = await fetch("/api/backups", { method: "POST" });
    const data = await r.json();
    if (!r.ok) throw Error(data.error);
    await backupDialog();
    toast("Backup do banco do PC criado.");
  } catch (error) {
    toast(error.message);
  }
}
async function previewImportedBackup(input) {
  const file = input.files?.[0];
  if (!file) return;
  if (document.querySelector("#backupFileName"))
    document.querySelector("#backupFileName").textContent = file.name;
  if (file.size > 2 * 1024 * 1024) {
    toast("Use um backup JSON de até 2 MB.");
    input.value = "";
    return;
  }
  try {
    await previewBackup(null, JSON.parse(await file.text()));
  } catch {
    toast("Arquivo JSON inválido. Nenhum dado foi alterado.");
  }
}
async function previewBackup(backupId, backup) {
  if (localWorkPending()) {
    toast(
      "Sincronize ou resolva os rascunhos e alterações locais antes de restaurar.",
    );
    return;
  }
  try {
    const r = await fetch("/api/backups/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        backupId ? { backupId, deviceId } : { backup, deviceId },
      ),
    });
    const preview = await r.json();
    if (!r.ok) throw Error(preview.error);
    openModal(
      `<h2>Conferir restauração</h2><label>Banco atual do PC</label><p>${backupSummary(preview.current)}</p><label>Conteúdo do backup</label><p>${backupSummary(preview.backup)}</p><p class="estimate-note">Esta ação substitui todo o banco do PC pelo backup. Uma cópia do estado atual será criada antes. ${preview.pendingDevices ? "Há outro aparelho com preenchimento ou treino em andamento. Termine esse uso antes de restaurar." : ""}</p><div class="timeractions"><button class="btn" onclick="backupDialog()">Voltar</button><button class="btn primary" id="restoreBackup" ${preview.pendingDevices ? "disabled" : ""}>Restaurar este backup</button></div>`,
    );
    $("#restoreBackup").onclick = () =>
      restoreBackup(preview.token, preview.revision);
  } catch (error) {
    toast(error.message);
  }
}
async function restoreBackup(token, expectedRevision) {
  if (busy || localWorkPending()) return;
  busy = true;
  updateSyncStatus();
  $("#restoreBackup").disabled = true;
  try {
    const r = await fetch("/api/backups/restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, revision: expectedRevision }),
    });
    const data = await r.json();
    if (!r.ok) throw Error(data.error);
    state = data.state;
    revision = data.revision;
    cacheServerState(data);
    connected = true;
    closeModal();
    render();
    toast(
      "Backup restaurado. O estado anterior foi guardado na pasta backups.",
    );
  } catch (error) {
    toast(error.message);
    if ($("#restoreBackup")) $("#restoreBackup").disabled = false;
  } finally {
    busy = false;
    updateSyncStatus();
  }
}
