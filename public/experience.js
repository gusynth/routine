let settingsSection = "appearance";
function applyExperience() {
  document.body.classList.toggle("graphics-safe", graphicsSafeMode());
  document.body.classList.toggle(
    "quiet-motion",
    cache.get("reduce-motion") === true,
  );
  document.body.classList.toggle(
    "quiet-glass",
    cache.get("reduce-glass") === true,
  );
  document.body.dataset.page = page;
}
function preference(key, value) {
  cache.set(key, value);
  applyExperience();
}
function moreMenu() {
  openModal(
    '<h2>Seu espaço</h2><div class="settings-actions"><button class="btn" onclick="closeModal();nav(\'report\')">Relatórios</button><button class="btn" onclick="closeModal();nav(\'mobile\')">Usar no celular</button><button class="btn" onclick="closeModal();nav(\'settings\')">Configurações</button></div>',
  );
}
const workoutWeek = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
function scheduledDays(schedule = "") {
  const words = schedule
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z]+/);
  const aliases = [
    ["dom", "domingo"],
    ["seg", "segunda"],
    ["ter", "terca"],
    ["qua", "quar", "quarta"],
    ["qui", "quinta"],
    ["sex", "sexta"],
    ["sab", "sabado"],
  ];
  return aliases.flatMap((names, day) =>
    names.some((name) => words.includes(name)) ? [day] : [],
  );
}
function workoutDayPicker(schedule) {
  const days = scheduledDays(schedule);
  return `<fieldset class="workout-week"><legend>Dias da semana</legend><div>${[1, 2, 3, 4, 5, 6, 0].map((day) => `<label><input type="checkbox" data-workout-day="${day}" ${days.includes(day) ? "checked" : ""} onchange="updateWorkoutDays()"><span>${workoutWeek[day]}</span></label>`).join("")}</div><p class="footnote">O início sugere automaticamente o treino marcado para hoje. Sem dias selecionados, ele fica disponível para escolha manual.</p></fieldset>`;
}
function updateWorkoutDays() {
  $("#wschedule").value = [
    ...document.querySelectorAll("[data-workout-day]:checked"),
  ]
    .map((el) => workoutWeek[Number(el.dataset.workoutDay)])
    .join(" / ");
  preserveWork();
}
function syncWorkoutDays() {
  const days = scheduledDays($("#wschedule").value);
  document
    .querySelectorAll("[data-workout-day]")
    .forEach(
      (el) => (el.checked = days.includes(Number(el.dataset.workoutDay))),
    );
}
function homeWorkoutPlan(c, day = date()) {
  const scheduled = c.workouts.filter((w) =>
    scheduledDays(w.schedule).includes(new Date(day + "T12:00:00").getDay()),
  );
  const completed = new Set(
    state.history
      .filter((h) => h.cycleId === c.id && h.date === day)
      .map((h) => h.workout?.id),
  );
  const choice = cache.get("home-choice-" + c.id);
  const selected =
    c.workouts.find((w) => choice?.date === day && choice.id === w.id) ||
    scheduled.find((w) => !completed.has(w.id)) ||
    scheduled[0] ||
    c.workouts[0];
  return { scheduled, selected, completed };
}
function chooseHomeWorkout(wid) {
  cache.set("home-choice-" + cycle().id, { date: date(), id: wid });
  dashboard();
}
let homeDayTimer;
let disposeHomeScenes = () => {};
function graphicsSafeMode() {
  try {
    return sessionStorage.getItem("routine:graphics-safe") === "true";
  } catch {
    return false;
  }
}
function useGraphicsSafeMode() {
  document.body.classList.add("graphics-safe");
  try {
    sessionStorage.setItem("routine:graphics-safe", "true");
  } catch {}
  window.RoutineDiagnostics?.record("R-GFX-006", "desktop");
  disposeHomeScenes();
  document.querySelectorAll(".home-layout iframe").forEach((frame) => {
    const poster = document.createElement("img");
    const query = new URL(frame.src).searchParams;
    poster.src = frame.closest(".workout-banner")
      ? `/brand/workout-banner-${Math.max(0, Math.min(2, Number(query.get("palette")) || 0))}.svg`
      : "/brand/routine-symbol.svg";
    poster.alt = "Routine · visual estático";
    poster.style.cssText =
      "display:block;width:100%;height:100%;object-fit:contain";
    frame.replaceWith(poster);
  });
}
window.addEventListener("routine:graphics-safe-mode", useGraphicsSafeMode);
function diagnosticsDialog() {
  const report = window.RoutineDiagnostics?.report() || { events: [] };
  openModal(
    `<h2>Diagnóstico do Routine</h2><p class="footnote">Códigos e horários deste aparelho. Não inclui refeições, perfil ou conteúdo dos treinos.</p><pre class="diagnostics-report" tabindex="0">${esc(JSON.stringify(report, null, 2))}</pre><div class="settings-actions"><button class="btn" onclick="copyDiagnostics()">Copiar diagnóstico</button><button class="btn" onclick="useGraphicsSafeMode();closeModal();toast('Efeitos desativados nesta sessão.')">Usar visual estático nesta sessão</button><button class="btn" onclick="closeModal()">Fechar</button></div>`,
  );
}
async function copyDiagnostics() {
  try {
    await navigator.clipboard.writeText(
      JSON.stringify(window.RoutineDiagnostics?.report(), null, 2),
    );
    toast("Diagnóstico copiado.");
  } catch {
    document.querySelector(".diagnostics-report")?.focus();
    toast("Selecione e copie o texto do diagnóstico.");
  }
}
function sceneDissolve() {
  return (
    '<div class="scene-dissolve" aria-hidden="true">' +
    "<i></i>".repeat(6) +
    "</div>"
  );
}
function workoutBannerMarkup(index, name) {
  const image = `<img src="/brand/workout-banner-${index}.svg" width="1200" height="420" alt="">`;
  return `<div class="workout-banner">${cache.get("reduce-glass") === true || graphicsSafeMode() ? image : `<iframe src="/scene/index.html?view=workout&palette=${index}${cache.get("reduce-motion") === true ? "&motion=off" : ""}" title="${esc(name || "Treino")} — vidro e cores em movimento" loading="lazy" referrerpolicy="no-referrer"></iframe>`}<span aria-hidden="true">${String(index + 1).padStart(2, "0")}</span></div>`;
}
function manageHomeScenes() {
  disposeHomeScenes();
  const frames = [...document.querySelectorAll(".home-layout iframe")];
  const ratios = new Map(frames.map((frame) => [frame, 1]));
  function onSceneMessage(event) {
    if (
      event.origin !== location.origin ||
      !frames.some((f) => f.contentWindow === event.source)
    )
      return;
    if (event.data?.type === "routine:scene-ready") update();
    if (event.data?.type === "routine:scene-state") {
      const data = event.data;
      if (
        [data.paused, data.hostActive, data.running, data.failed].every(
          (v) => typeof v === "boolean",
        ) &&
        Number.isFinite(data.elapsed)
      ) {
        window.RoutineSceneStatuses ||= [];
        window.RoutineSceneStatuses[
          frames.findIndex((f) => f.contentWindow === event.source)
        ] = {
          time: new Date().toISOString(),
          paused: data.paused,
          hostActive: data.hostActive,
          running: data.running,
          documentHidden: data.documentHidden === true,
          visible: data.visible !== false,
          failed: data.failed,
          elapsed: data.elapsed,
        };
      }
    }
    if (event.data?.type === "routine:scene-error")
      window.RoutineDiagnostics?.record(event.data.code, "graphics");
    if (event.data?.type === "routine:scene-metrics") {
      const index = frames.findIndex((f) => f.contentWindow === event.source);
      const data = event.data;
      if (
        [data.fps, data.width, data.height, data.quality].every(Number.isFinite)
      ) {
        window.RoutineSceneMetrics ||= [];
        window.RoutineSceneMetrics[index] = {
          time: new Date().toISOString(),
          fps: data.fps,
          width: data.width,
          height: data.height,
          quality: data.quality,
        };
      }
    }
  }
  window.addEventListener("message", onSceneMessage);
  function update() {
    const candidates = frames.filter((frame) => {
      const bounds = frame.getBoundingClientRect();
      // Recheck actual layout on readiness/focus, not a stale initial IO result.
      if (bounds.width && bounds.height)
        return (
          bounds.bottom > 0 &&
          bounds.right > 0 &&
          bounds.top < innerHeight &&
          bounds.left < innerWidth
        );
      return ratios.get(frame) > 0;
    });
    for (const frame of frames) {
      const active = !document.hidden && candidates.includes(frame);
      frame.contentWindow?.postMessage(
        {
          type: "routine:scene-visibility",
          active,
          compact: innerWidth <= 640,
        },
        location.origin,
      );
    }
  }
  const observer =
    typeof IntersectionObserver === "function"
      ? new IntersectionObserver(
          (entries) => {
            for (const entry of entries)
              ratios.set(
                entry.target,
                entry.isIntersecting ? entry.intersectionRatio : 0,
              );
            update();
          },
          { threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] },
        )
      : null;
  frames.forEach((frame) => {
    observer?.observe(frame);
    frame.addEventListener("load", update);
  });
  document.addEventListener("visibilitychange", update);
  window.addEventListener("pageshow", update);
  window.addEventListener("focus", update);
  update();
  disposeHomeScenes = () => {
    observer?.disconnect();
    frames.forEach((frame) => {
      frame.removeEventListener("load", update);
    });
    window.removeEventListener("message", onSceneMessage);
    document.removeEventListener("visibilitychange", update);
    window.removeEventListener("pageshow", update);
    window.removeEventListener("focus", update);
    disposeHomeScenes = () => {};
  };
}
function dashboard() {
  disposeHomeScenes();
  today = date();
  clearTimeout(homeDayTimer);
  const midnight = new Date();
  midnight.setHours(24, 0, 0, 50);
  homeDayTimer = setTimeout(() => {
    if (page === "dashboard") render();
  }, midnight - new Date());
  const c = cycle(),
    records = state.history.filter((h) => h.cycleId === c.id),
    pct = Math.min(100, Math.round((records.length / c.goal) * 100));
  const { selected, scheduled, completed } = homeWorkoutPlan(c);
  const isScheduled = selected && scheduled.some((w) => w.id === selected.id);
  const status = !selected
    ? "Seu plano começa aqui"
    : isScheduled
      ? completed.has(selected.id)
        ? "Treino de hoje concluído"
        : `Hoje é dia de ${selected.name}`
      : scheduled.length
        ? "Outro treino, no seu ritmo"
        : "Hoje é dia de descanso";
  const banner = Math.max(0, c.workouts.indexOf(selected)) % 3;
  $("#app").innerHTML =
    `<section class="home-intro"><div><span class="eyebrow">SEU RITMO, TODO DIA</span><h1>Sua rotina.<br>Em movimento<span>.</span></h1><p>Treine. Registre. Continue evoluindo.</p></div><button class="btn cycle-chip" onclick="cycleDialog()">${esc(c.name)} ▾</button></section><div class="home-layout"><section class="training-hero">${workoutBannerMarkup(banner, selected?.name)}<div class="hero-content">${sceneDissolve()}<span class="eyebrow">${esc(status)}</span><h2>${esc(selected?.name || "Seu plano começa aqui")}</h2><p>${esc(selected?.schedule || "Escolha seu ritmo e construa sua rotina.")}</p>${!scheduled.length && selected ? '<p class="home-schedule-note">Nenhum treino marcado para hoje. Descanse ou escolha um treino abaixo.</p>' : scheduled.length > 1 ? `<p class="home-schedule-note">${scheduled.length} treinos marcados para hoje. Escolha qual fazer.</p>` : ""}${selected ? `<label for="homeWorkout">Escolher treino</label><select id="homeWorkout" onchange="chooseHomeWorkout(this.value)">${c.workouts.map((w) => `<option value="${w.id}" ${selected.id === w.id ? "selected" : ""}>${esc(w.name)} · ${w.exercises.reduce((n, e) => n + e.sets, 0)} séries</option>`).join("")}</select><button class="btn primary hero-start" onclick="configureTraining('${selected.id}')">Treinar agora ↗</button>` : '<button class="btn primary" onclick="nav(\'workouts\')">Criar meu treino</button>'}<button class="hero-link" onclick="nav('workouts')">Explorar meus treinos →</button></div></section><section class="cycle-panel"><div class="sectionhead"><span class="eyebrow">CONSTÂNCIA</span><button class="btn small" onclick="nav('history')">Ver evolução ↗</button></div>${cache.get("reduce-glass") === true || graphicsSafeMode() ? '<div class="routine-scene-static"><img src="/brand/routine-symbol.svg" alt="Routine" width="160" height="160"></div>' : `<div class="routine-scene-frame"><iframe src="/scene/index.html${cache.get("reduce-motion") === true ? "?motion=off" : ""}" title="Routine: logo de vidro e cores em movimento" loading="lazy" referrerpolicy="no-referrer"></iframe></div>`}<div class="cycle-total">${sceneDissolve()}<strong>${records.length}</strong><span>de ${c.goal} treinos</span></div><div class="progress" role="progressbar" aria-label="Progresso dos treinos no ciclo" aria-valuemin="0" aria-valuemax="${c.goal}" aria-valuenow="${Math.min(records.length, c.goal)}"><i style="width:${pct}%"></i></div><h2>Consistência conta.</h2><p>${pct}% do objetivo concluído.</p><div class="cycle-facts"><div><b>${streak()}</b><span>dias de sequência</span></div><div><b>${state.profile.weightKnown === false ? "—" : esc(state.profile.weight)}</b><button onclick="profileDialog()">Peso em kg · editar</button></div></div></section><section class="daily-lanes"><button onclick="nav('diary')"><span class="lane-icon">◷</span><span><small>NO SEU TEMPO</small><b>Como foi sua alimentação?</b><em>${state.diary[today]?.status === "complete" ? "Diário finalizado" : "Complete seu diário de hoje"}</em></span><i>↗</i></button><button onclick="nav('report')"><span class="lane-icon">↗</span><span><small>ALÉM DOS NÚMEROS</small><b>Sua evolução tem história.</b><em>Guarde e compartilhe seu progresso</em></span><i>↗</i></button></section></div>`;
  manageHomeScenes();
}
function settings() {
  closeControlPopover();
  paintSettings();
}
function paintSettings() {
  const sections = [
    ["profile", "Seu perfil"],
    ["sound", "Som e música"],
    ["appearance", "Aparência"],
    ["training", "Treino"],
    ["data", "Dados e backups"],
    ["help", "Conhecer o Routine"],
  ];
  if (!$("#settingsContent"))
    $("#app").innerHTML =
      heading(
        "DO SEU JEITO",
        "Seu espaço. Suas escolhas.",
        "Ajustes simples para uma rotina que funciona para você.",
      ) +
      `<div class="settings-layout"><nav class="settings-nav" aria-label="Seções de configurações">${sections.map(([key, name]) => `<button class="${key === settingsSection ? "active" : ""}" data-settings-section="${key}">${name}<span>›</span></button>`).join("")}</nav><section id="settingsContent" class="settings-surface"></section></div>`;
  document.querySelectorAll("[data-settings-section]").forEach((button) => {
    button.onclick = () => {
      if (settingsSection === button.dataset.settingsSection) return;
      settingsSection = button.dataset.settingsSection;
      settings();
    };
    const selected = button.dataset.settingsSection === settingsSection;
    button.classList.toggle("active", selected);
    if (selected) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  const content = document.createElement("div");
  content.className = "settings-body";
  if (settingsSection === "profile")
    content.innerHTML = `<span class="eyebrow">PERFIL</span><h2>Seu ponto de partida.</h2><p class="muted">Informações opcionais, guardadas no banco local do Routine.</p><div class="settings-actions"><button class="btn" onclick="profileDialog()">Registrar peso e percepção</button><button class="btn" onclick="welcomeRoutine()">Editar idade, altura e apresentação</button></div>`;
  if (settingsSection === "appearance")
    content.innerHTML = `<span class="eyebrow">CONFORTO VISUAL</span><h2>Mais leve, do seu jeito.</h2><p class="muted">O Routine respeita o movimento reduzido do sistema. Você pode reduzir os efeitos também neste aparelho.</p><label class="setting-switch"><span><b>Reduzir animações</b><small>Transições imediatas, com menos movimento.</small></span><input type="checkbox" ${cache.get("reduce-motion") ? "checked" : ""} onchange="preference('reduce-motion',this.checked)"></label><label class="setting-switch"><span><b>Reduzir transparência</b><small>Superfícies sólidas e sem blur.</small></span><input type="checkbox" ${cache.get("reduce-glass") ? "checked" : ""} onchange="preference('reduce-glass',this.checked)"></label><div class="settings-actions"><button class="btn" onclick="preference('reduce-motion',true);preference('reduce-glass',true);settings()">Ativar modo econômico</button><button class="btn" onclick="resetPreferences()">Restaurar preferências</button></div>`;
  if (settingsSection === "sound")
    content.innerHTML = `<span class="eyebrow">ESCUTE SEU RITMO</span><h2>Um aviso na hora certa.</h2><p class="muted">Teste com a música tocando e o Routine na tela. O comportamento de mistura depende do aparelho e navegador; não podemos garantir que a música nunca será interrompida.</p>${audioControls()}<div class="settings-actions"><button class="btn" onclick="navigator.vibrate?.(200);toast('Vibração solicitada, se disponível no aparelho.')">Testar vibração</button><button class="btn" onclick="testScreenActive()">Testar tela ativa</button></div><details class="sequence-panel"><summary>Guia para meu aparelho</summary><p class="footnote"><b>Android:</b> confira o volume de mídia e teste no navegador que vai usar no treino.<br><b>iPhone/iPad:</b> confira o volume e o modo silencioso; o modo ambiente pode respeitá-lo.<br><b>Windows:</b> confira a saída de áudio e o volume do aplicativo no mixer.<br>Mantenha a música em segundo plano e o Routine visível. Tela ativa exige suporte do navegador e contexto seguro (HTTPS ou localhost). Não desativamos o bloqueio do sistema automaticamente.</p></details>`;
  if (settingsSection === "training") {
    const value = trainingSettings();
    content.innerHTML = `<span class="eyebrow">PREFERÊNCIAS</span><h2>Seu ritmo de treino.</h2><p class="muted">Repetições sempre esperam sua confirmação. Estes padrões ficam neste aparelho.</p><label for="defaultMode">Exercícios por tempo</label><select id="defaultMode"><option value="manual">Iniciar e concluir manualmente</option><option value="auto">Avançar com os cronômetros</option></select><label for="defaultTransition">Preparação entre exercícios por tempo (s)</label><input id="defaultTransition" type="number" min="0" max="30" value="${value.transition}"><label for="defaultRest">Aquecimento e finalizador</label><select id="defaultRest"><option value="round">Descansar ao fim da volta</option><option value="exercise">Descansar após cada exercício</option></select><div class="settings-actions"><button class="btn primary" onclick="saveTrainingDefaults()">Salvar preferências</button></div>`;
    content.querySelector("#defaultMode").value = value.mode;
    content.querySelector("#defaultRest").value = value.circuitRest;
  }
  if (settingsSection === "data")
    content.innerHTML = `<span class="eyebrow">SEUS REGISTROS</span><h2>Guarde o que você construiu.</h2><p class="muted">Exporte uma cópia, confira os backups e acompanhe a sincronização. Restaurar sempre exige uma prévia.</p><div class="settings-actions"><button class="btn primary" onclick="backupDialog()">Dados e backups</button><button class="btn" onclick="diagnosticsDialog()">Diagnóstico e códigos de erro</button><button class="btn" onclick="outbox ? showPendingConflict() : toast('Tudo sincronizado. Nenhuma alteração pendente.')">Revisar sincronização pendente</button></div><p class="footnote">${esc(syncLabel())}</p>`;
  if (settingsSection === "help")
    content.innerHTML = `<span class="eyebrow">BEM-VINDO AO ROUTINE</span><h2>Pequenos passos. Seu caminho.</h2><p class="muted">Crie treinos A, B, C… e personalize exercícios, séries, metas e descanso. Registre suas refeições e acompanhe a evolução pelos ciclos.</p><div class="settings-actions"><button class="btn primary" onclick="welcomeRoutine()">Conhecer o Routine</button><button class="btn" onclick="nav('workouts')">Organizar meus treinos</button></div>${aiExplanation()}<p class="footnote">Acesso pelo celular: no launcher, abra o QR Code na mesma rede Wi-Fi. Seus registros ficam no PC e os rascunhos neste aparelho; nenhum conteúdo é enviado automaticamente a uma IA.</p>`;
  RoutineMotion.replaceContent($("#settingsContent"), content);
}
function aiExplanation() {
  return '<div class="ai-context"><h3>Seu progresso, sempre em mãos.</h3><p>Guarde um relatório mensal ou copie seus registros para o Gemini ou outro chat de IA e converse sobre sua evolução. Essa é uma forma opcional de organizar e revisar seu acompanhamento.</p><p>Uma IA não substitui um profissional de educação física ou nutricionista. Nada é enviado automaticamente: você escolhe o que compartilhar.</p></div>';
}
function saveTrainingDefaults() {
  const transition = Number($("#defaultTransition").value);
  if (!Number.isInteger(transition) || transition < 0 || transition > 30)
    return toast("Use de 0 a 30 segundos.");
  cache.set("training-settings", {
    mode: $("#defaultMode").value,
    transition,
    circuitRest: $("#defaultRest").value,
  });
  toast("Preferências salvas neste aparelho.");
}
function resetPreferences() {
  for (const key of [
    "reduce-motion",
    "reduce-glass",
    "training-settings",
    "show-previous",
    "sidebar-collapsed",
    "alert-volume",
  ])
    cache.remove(key);
  alertVolume = 0.8;
  applyExperience();
  applySidebar();
  settings();
  toast("Preferências restauradas. Seus registros foram preservados.");
}
async function testScreenActive() {
  if (!navigator.wakeLock)
    return toast("Tela ativa indisponível neste navegador.");
  try {
    const testLock = await navigator.wakeLock.request("screen");
    await testLock.release();
    toast("Tela ativa disponível. Será mantida durante o treino.");
  } catch {
    toast(
      "Não foi possível ativar a tela. Confira o suporte e use HTTPS no celular.",
    );
  }
}
function skipWelcomeRoutine() {
  cache.set("welcome-seen", true);
  closeModal();
}
function welcomeRoutine() {
  openModal(
    `<span class="eyebrow">SEU PRIMEIRO PASSO</span><h2>Uma rotina com a sua cara.</h2><p class="footnote">Conte um pouco sobre você, se quiser. Esses dados não são usados para prescrever um treino.</p><form id="welcomeForm"><div class="formgrid"><div><label for="welcomeAge">Idade, opcional</label><input id="welcomeAge" type="number" min="1" max="120" value="${state.profile.age ?? ""}"></div><div><label for="welcomeWeight">Peso em kg, opcional</label><input id="welcomeWeight" type="number" step="0.1" min="1" max="500" value="${state.profile.setupComplete && state.profile.weightKnown !== false ? state.profile.weight : ""}"></div><div><label for="welcomeHeight">Altura em metros, opcional</label><input id="welcomeHeight" type="number" step="0.01" min="0.5" max="2.8" value="${state.profile.setupComplete ? state.profile.height : ""}"></div></div><label for="welcomePlan">Como quer começar?</label><select id="welcomePlan"><option value="existing">Explorar meu plano atual / exemplo A e B</option><option value="custom">Criar meu próprio treino</option></select><p class="footnote">O modelo inicial é um exemplo editável, não uma recomendação individual. Seus treinos e seu histórico existentes serão preservados.</p><div class="timeractions"><button type="button" class="btn" onclick="skipWelcomeRoutine()">Agora não</button><button class="btn primary">Continuar</button></div></form>`,
  );
  $("#welcomeForm").onsubmit = async (event) => {
    event.preventDefault();
    if (busy) return;
    const next = clone(state),
      age = $("#welcomeAge").value,
      weight = $("#welcomeWeight").value,
      height = $("#welcomeHeight").value,
      custom = $("#welcomePlan").value === "custom";
    if (age && (!Number.isInteger(+age) || +age < 1 || +age > 120))
      return toast("Confira a idade.");
    if (weight && (+weight <= 0 || +weight > 500))
      return toast("Confira o peso.");
    if (height && (+height < 0.5 || +height > 2.8))
      return toast("Confira a altura.");
    if (age) next.profile.age = +age;
    else delete next.profile.age;
    if (weight) {
      next.profile.weight = +weight;
      next.profile.weightKnown = true;
    } else if (!next.profile.setupComplete && !next.history.length)
      next.profile.weightKnown = false;
    if (height) next.profile.height = +height;
    next.profile.setupComplete = true;
    if (await save(next)) {
      cache.set("welcome-seen", true);
      closeModal();
      nav("workouts");
      if (custom) editWorkout();
      else
        toast(
          "Use Criar treino para adicionar A, B, C… ou Editar para ajustar o plano.",
        );
    }
  };
}
