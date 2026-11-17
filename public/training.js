// Session player. A single absolute deadline drives each phase; no per-second saves.
let timer;
let resultEdit = null;
function trainingSettings() {
  const value = {
    mode: "manual",
    transition: 5,
    circuitRest: "round",
    ...cache.get("training-settings"),
  };
  value.mode = value.mode === "auto" ? "auto" : "manual";
  if (
    !Number.isInteger(value.transition) ||
    value.transition < 0 ||
    value.transition > 30
  )
    value.transition = 5;
  value.circuitRest = value.circuitRest === "exercise" ? "exercise" : "round";
  return {
    mode: value.mode,
    transition: value.transition,
    circuitRest: value.circuitRest,
  };
}
function defaultActual(e) {
  return Number((e.target.match(/\d+/g) || ["0"]).at(-1));
}
function buildWorkoutSteps(workout, config = trainingSettings()) {
  const steps = [];
  for (const block of ["Aquecimento", "Força", "Finalizador"]) {
    const exercises = workout.exercises.filter((e) => e.block === block);
    if (block === "Força") {
      exercises.forEach((e) => {
        for (let s = 1; s <= e.sets; s++)
          steps.push({
            e,
            s,
            round: s,
            rounds: e.sets,
            position: 1,
            roundSize: 1,
            restAfter: e.rest,
          });
      });
    } else {
      const rounds = Math.max(0, ...exercises.map((e) => e.sets));
      for (let round = 1; round <= rounds; round++) {
        const members = exercises.filter((e) => e.sets >= round);
        members.forEach((e, i) =>
          steps.push({
            e,
            s: round,
            round,
            rounds,
            position: i + 1,
            roundSize: members.length,
            restAfter:
              config.circuitRest === "exercise" || i === members.length - 1
                ? e.rest
                : 0,
          }),
        );
      }
    }
  }
  return steps;
}
function configureTraining(wid) {
  if (session) return toast("Já existe um treino em andamento.");
  const w = cycle().workouts.find((w) => w.id === wid),
    settings = trainingSettings();
  if (!w?.exercises.length) return toast("Adicione exercícios primeiro.");
  const overview = ["Aquecimento", "Força", "Finalizador"]
    .map((block) => {
      const es = w.exercises.filter((e) => e.block === block);
      if (!es.length) return "";
      return `<div class="plan-block"><b>${block}</b><p>${es.map((e) => esc(e.name)).join(' <span aria-hidden="true">→</span> ')}</p><small>${block === "Força" ? "Séries de cada exercício" : Math.max(...es.map((e) => e.sets)) + " voltas, alternando os exercícios"}</small></div>`;
    })
    .join("");
  openModal(
    `<h2>${esc(w.name)}</h2><p class="muted modal-intro">Confira a sequência e escolha como seguir.</p>${overview}<form id="trainingSetup"><label for="trainingMode">Modo de treino</label><select id="trainingMode" onchange="document.querySelector('#autoSettings').hidden=this.value!=='auto'"><option value="manual" ${settings.mode === "manual" ? "selected" : ""}>Manual · eu concluo cada série</option><option value="auto" ${settings.mode === "auto" ? "selected" : ""}>Automático · só exercícios por tempo</option></select><div id="autoSettings" ${settings.mode !== "auto" ? "hidden" : ""}><div class="formgrid"><div><label for="transitionSeconds">Preparação para exercícios por tempo (s)</label><input id="transitionSeconds" required type="number" min="0" max="30" value="${settings.transition}"></div></div><p class="footnote">Exercícios por tempo avançam ao terminar o cronômetro. Nas repetições, faça no seu ritmo, informe quantas fez e toque em Concluir série. O descanso começa após a confirmação.</p></div><label for="circuitRest">Descanso no aquecimento e finalizador</label><select id="circuitRest"><option value="round" ${settings.circuitRest === "round" ? "selected" : ""}>Ao final de cada volta</option><option value="exercise" ${settings.circuitRest === "exercise" ? "selected" : ""}>Após cada exercício</option></select><div class="timeractions"><button type="button" class="btn" onclick="closeModal()">Voltar</button><button class="btn primary">Iniciar treino</button></div></form>`,
  );
  $("#trainingSetup").onsubmit = (event) => {
    event.preventDefault();
    const config = {
      mode: $("#trainingMode").value,
      transition: Number($("#transitionSeconds").value),
      circuitRest: $("#circuitRest").value,
    };
    if (
      !Number.isInteger(config.transition) ||
      config.transition < 0 ||
      config.transition > 30
    )
      return toast("Confira os tempos antes de iniciar.");
    cache.set("training-settings", config);
    closeModal();
    startTraining(wid, config);
  };
}
function startTraining(wid, options = {}) {
  if (session) return toast("Já existe um treino em andamento.");
  const workout = cycle().workouts.find((w) => w.id === wid);
  if (!workout?.exercises.length) return toast("Adicione exercícios primeiro.");
  const config = { ...trainingSettings(), mode: "manual", ...options };
  delete config.repSeconds;
  audio();
  lock();
  session = {
    id: id(),
    cycleId: cycle().id,
    cycleName: cycle().name,
    workout: clone(workout),
    date: date(),
    started: Date.now(),
    step: 0,
    results: [],
    config,
    notes: "",
  };
  session.steps = buildWorkoutSteps(session.workout, config);
  page = "session";
  persistSession();
  render();
  window.scrollTo({ top: 0, behavior: "instant" });
  if (config.mode === "auto" && session.steps[0].e.type === "time")
    startTimer(5, "prepare");
}
function phaseLabel() {
  return !timer
    ? session?.steps[session.step]?.e.type === "reps"
      ? "No seu ritmo"
      : "Sua série"
    : timer.kind === "rest"
      ? "Descanso"
      : timer.kind === "prepare"
        ? "Prepare-se"
        : timer.kind === "transition"
          ? "Próximo movimento"
          : "Em movimento";
}
function stepLabel(step) {
  return step.e.block === "Força"
    ? `Série ${step.s} de ${step.e.sets}`
    : `Volta ${step.round} de ${step.rounds} · exercício ${step.position} de ${step.roundSize}`;
}
function formatSeconds(value) {
  const s = Math.max(0, Math.ceil(value));
  return (
    String(Math.floor(s / 60)).padStart(2, "0") +
    ":" +
    String(s % 60).padStart(2, "0")
  );
}
function nextDescription() {
  if (!session) return "";
  const index = ["rest", "prepare", "transition"].includes(timer?.kind)
    ? session.step
    : session.step + 1;
  const next = session.steps[index];
  if (!next) return "Revisar resultados e salvar o treino";
  return `${next.e.name} · ${stepLabel(next)}`;
}
function sequenceMarkup(step) {
  const peers = session.steps.filter(
    (p) =>
      p.e.block === step.e.block &&
      (step.e.block === "Força"
        ? p.e.id === step.e.id
        : p.round === step.round),
  );
  const currentIndex = session.steps.indexOf(step);
  return `<details class="sequence-panel"><summary>Sequência ${step.e.block === "Força" ? "das séries" : "desta volta"}</summary><ol>${peers
    .map((p) => {
      const i = session.steps.indexOf(p),
        status =
          i < session.step
            ? "done"
            : i === currentIndex
              ? "current"
              : "pending";
      return `<li class="${status}"><span class="sequence-dot" aria-hidden="true">${status === "done" ? "✓" : peers.indexOf(p) + 1}</span><div><b>${step.e.block === "Força" ? "Série " + p.s : esc(p.e.name)}</b><small>${esc(p.e.target)} ${p.e.type === "time" ? "segundos" : /reps/i.test(p.e.target) ? "" : "repetições"}${p.restAfter ? " · depois " + p.restAfter + "s de descanso" : ""}</small></div>${i === session.step && timer?.kind !== "rest" ? '<span class="tag">Agora</span>' : ""}</li>`;
    })
    .join("")}</ol></details>`;
}
function circuitRoute(step) {
  if (step.e.block === "Força") return "";
  const members = session.steps.filter(
    (p) => p.e.block === step.e.block && p.round === step.round,
  );
  const visible =
    members.length <= 3
      ? members
      : members.filter((p) => Math.abs(p.position - step.position) <= 1);
  return `<div class="circuit-route" aria-label="Ordem da volta">${visible.map((p) => `<span class="${p.position === step.position ? "route-current" : ""}">${p.position}. ${esc(p.e.name)}</span>`).join('<i aria-hidden="true">→</i>')}</div>`;
}
function canUndoSet() {
  const last = session?.results.at(-1),
    step = session?.steps[session.step - 1];
  return !!last && !!step && last.id === step.e.id && last.series === step.s;
}
function undoControl() {
  return canUndoSet()
    ? `<button class="btn small undo-series" onclick="undoLastSet('${session.id}',${session.step})">${uiIcon("undo")}<span>Desfazer última série</span></button>`
    : "";
}
function undoLastSet(expectedId = session?.id, expectedStep = session?.step) {
  if (
    !session ||
    busy ||
    expectedId !== session.id ||
    expectedStep !== session.step ||
    !canUndoSet()
  )
    return;
  preserveWork();
  stopTrainingTimer();
  const last = session.results.pop();
  session.step--;
  session.actual = String(last.actual);
  session.redo = true;
  delete session.completed;
  persistSession();
  training();
  toast("Última série desfeita. Confira o valor ou repita no seu ritmo.");
}
function transitionMessage() {
  const current = session.steps[session.step],
    previous = session.steps[session.step - 1];
  if (!current)
    return "Todas as séries concluídas. Revise os resultados antes de salvar.";
  if (session.redo)
    return "Série desfeita. O valor anterior foi recuperado; corrija ou repita antes de confirmar.";
  if (!previous)
    return `Início do treino · ${current.e.block}. ${current.e.type === "reps" ? "Faça no seu ritmo e confirme cada série." : "Confira a sequência antes de começar."}`;
  if (previous.e.block !== current.e.block)
    return `${previous.e.block} concluído · próximo bloco: ${current.e.block}.`;
  if (previous.e.block !== "Força" && previous.round !== current.round)
    return `Volta ${previous.round} concluída · próxima: volta ${current.round} de ${current.rounds}.`;
  if (previous.e.block === "Força" && previous.e.id !== current.e.id)
    return `${previous.e.name} concluído · próximo: ${current.e.name}.`;
  if (previous.e.block !== "Força")
    return `Continue a volta ${current.round}: ${previous.e.name} → ${current.e.name}.`;
  return `Série ${previous.s} concluída · próxima: série ${current.s} de ${current.e.sets}.`;
}
function training() {
  if (!session) return;
  const s = session,
    step = s.steps[s.step];
  document.body.classList.add("training-view");
  if ($("#app").dataset.trainingStep !== String(s.step) && !$("#modal").open)
    window.scrollTo({ top: 0, behavior: "instant" });
  $("#app").dataset.trainingStep = String(s.step);
  if (!step) {
    const pending = s.results.filter((r) => r.estimated).length;
    $("#app").innerHTML =
      `<div class="session">${heading("TREINO CONCLUÍDO", "Mais um passo dado.", "Revise os resultados e registre como você se sentiu.")}<div class="card"><div class="completion-stats"><b>${s.results.length}<small>séries realizadas</small></b><b>${Math.round(((s.completed || Date.now()) - s.started) / 60000)}<small>minutos</small></b></div>${pending ? `<p class="estimate-note">${pending} série(s) com repetições estimadas. Você pode corrigir agora ou depois no histórico.</p>` : ""}${resultsPreview(s.results)}<div class="completion-actions" aria-label="Ajustar resultados do treino">${undoControl()}<button class="btn completion-review" onclick="editSessionResults()">${uiIcon("edit")}<span>Revisar resultados</span></button></div><label for="sessionNotes">Observações de sensação / força</label><textarea id="sessionNotes" placeholder="Como estavam sua força e seu cansaço?">${esc(s.notes || "")}</textarea><div class="player-actions"><button class="btn primary" onclick="finishTraining()">Finalizar e salvar treino ✓</button><button class="btn danger" onclick="cancelTraining()">Encerrar sem salvar</button></div></div></div>`;
    return;
  }
  const { e } = step,
    auto = s.config?.mode === "auto",
    isRest = timer?.kind === "rest",
    phase = timer?.kind || "ready";
  const contextStep = isRest ? s.steps[Math.max(0, s.step - 1)] : step;
  const title = isRest ? "Recupere o fôlego." : e.name;
  const subtitle = isRest
    ? "Série concluída. O próximo exercício está logo abaixo."
    : stepLabel(step);
  const controls = timer
    ? `<div class="timer-controls"><button class="btn" onclick="toggleTimer()">${timer.paused ? "Retomar" : "Pausar"}</button><button class="btn" onclick="endTimer(false,'${timer.id}')">${isRest ? "Pular descanso" : phase === "prepare" || phase === "transition" ? "Começar agora" : auto ? "Avançar série" : "Parar cronômetro"}</button><button class="btn restart-timer" onclick="restartTimer('${timer.id}')">${uiIcon("undo")}<span>${isRest ? "Reiniciar descanso" : phase === "exercise" ? "Reiniciar série" : "Reiniciar contagem"}</span></button></div>${isRest ? '<div class="rest-adjust"><button class="btn small" onclick="adjustTimer(-15)">−15s</button><button class="btn small" onclick="adjustTimer(15)">+15s</button></div>' : ""}`
    : auto && e.type === "time" && !s.redo
      ? '<button class="btn primary" onclick="beginAutomaticStep()">Continuar treino automático</button>'
      : `${e.type === "reps" ? '<p class="footnote">Sem cronômetro. Confirme quando terminar.</p>' : ""}${e.type === "time" ? `<button class="btn primary" onclick="startTimer(${Number(e.target)},'exercise')">Iniciar (${esc(e.target)}s) ▷</button>` : ""}<label for="actual">${e.type === "time" ? "Quantos segundos você realizou?" : "Quantas repetições você fez?"}</label><input id="actual" type="number" inputmode="numeric" min="0" max="100000" step="1" value="${esc(s.actual ?? defaultActual(e))}">${/perna/i.test(e.target) ? '<p class="footnote">Registre o resultado por perna, como na meta.</p>' : ""}<button class="btn primary" onclick="completeSet('${s.id}',${s.step})">Concluir série ✓</button>`;
  $("#app").innerHTML =
    `<div class="session"><div class="session-top"><span>${esc(s.workout.name)}</span><span class="tag">${auto ? "Timers automáticos" : "Manual"}</span></div><div class="session-progress"><span>${s.step} de ${s.steps.length} séries concluídas</span><div class="progress"><i style="width:${(s.step / s.steps.length) * 100}%"></i></div></div><p class="transition-notice" role="status">${esc(transitionMessage())}</p><section class="player" data-phase="${phase}"><div class="player-meta"><span class="phase-label" role="status">${phaseLabel()}${timer?.paused ? " · pausado" : ""}</span><span>${esc(contextStep.e.block)}</span></div><h1>${esc(title)}</h1><p class="player-subtitle">${esc(subtitle)}</p>${!isRest ? circuitRoute(step) : ""}${timer ? '<div class="timer" id="countdown" aria-live="off"></div><div class="timer-ring" aria-hidden="true"><i id="timerProgress"></i></div>' : `<div class="target-display"><strong>${esc(e.target.replace(/\s*reps/gi, ""))}</strong><span>${e.type === "time" ? "segundos" : "repetições · meta"}</span></div>`}<div class="next-exercise"><span>A seguir</span><b>${esc(nextDescription())}</b></div>${controls}${!isRest ? `<p class="rest-explanation">${s.step === s.steps.length - 1 ? "Depois: revisar resultados e salvar o treino." : step.restAfter ? `Depois desta série: ${step.restAfter}s de descanso.` : "Depois: próximo exercício da volta, sem descanso."}</p>` : ""}</section>${!isRest ? previousExerciseReference(e) : ""}${sequenceMarkup(contextStep)}<div class="session-tools">${undoControl()}${s.results.length ? '<button class="btn small" onclick="editSessionResults()">Editar séries concluídas</button>' : ""}<button class="btn small danger" onclick="cancelTraining()">Encerrar treino</button></div>${audioControls()}<label class="check"><input type="checkbox" ${cache.get("show-previous") !== false ? "checked" : ""} onchange="cache.set('show-previous',this.checked);training()">Mostrar referência da última sessão</label></div>`;
  if (timer) paintTimer();
}
function beginAutomaticStep() {
  if (timer) return;
  if (!session || session.step >= session.steps.length) {
    training();
    return;
  }
  const e = session.steps[session.step].e;
  if (e.type === "reps") {
    training();
    persistSession();
    return;
  }
  startTimer(Number(e.target), "exercise");
}
function startTimer(seconds, kind) {
  if (
    !session ||
    (kind === "exercise" &&
      (timer || session.steps[session.step]?.e.type !== "time"))
  )
    return;
  audio();
  clearInterval(timerInterval);
  timer = {
    id: id(),
    end: Date.now() + seconds * 1000,
    total: seconds * 1000,
    kind,
    last: null,
    paused: false,
  };
  if (
    kind === "exercise" &&
    session.config?.mode === "auto" &&
    document.visibilityState === "hidden"
  ) {
    timer.paused = true;
    timer.remaining = timer.total;
    timer.waitingForScreen = true;
  }
  training();
  if (!timer.paused) timerInterval = setInterval(tick, 200);
  persistSession();
  tick();
}
function paintTimer() {
  if (!timer || !$("#countdown")) return;
  const remaining = timer.paused
    ? timer.remaining
    : Math.max(0, timer.end - Date.now());
  $("#countdown").textContent = formatSeconds(remaining / 1000);
  $("#timerProgress").style.width =
    Math.min(100, (remaining / timer.total) * 100) + "%";
}
function tick() {
  if (!timer || timer.paused) return;
  const n = Math.max(0, Math.ceil((timer.end - Date.now()) / 1000));
  if (n !== timer.last) {
    paintTimer();
    if (n > 0 && n <= 3) beep();
    timer.last = n;
  }
  if (n === 0) endTimer(true);
}
function toggleTimer() {
  if (!timer) return;
  preserveWork();
  if (timer.paused) {
    timer.end = Date.now() + timer.remaining;
    timer.paused = false;
    delete timer.waitingForScreen;
    audio();
    timerInterval = setInterval(tick, 200);
  } else {
    timer.remaining = Math.max(0, timer.end - Date.now());
    timer.paused = true;
    clearInterval(timerInterval);
  }
  persistSession();
  training();
  if (!timer.paused) tick();
}
function adjustTimer(seconds) {
  if (!timer || timer.kind !== "rest") return;
  if (timer.paused)
    timer.remaining = Math.max(0, timer.remaining + seconds * 1000);
  else timer.end = Math.max(Date.now(), timer.end + seconds * 1000);
  timer.total = Math.max(
    timer.total,
    timer.paused ? timer.remaining : timer.end - Date.now(),
  );
  persistSession();
  paintTimer();
  if (!timer.paused) tick();
}
async function restartTimer(expectedId = timer?.id) {
  if (!session || !timer || busy || $("#modal").open || timer.id !== expectedId)
    return;
  const current = timer,
    sessionId = session.id,
    step = session.step;
  const wasRunning = !current.paused;
  if (wasRunning) toggleTimer();
  const label =
    current.kind === "rest"
      ? "descanso"
      : current.kind === "exercise"
        ? "série"
        : "contagem";
  const seconds = current.total / 1000;
  const confirmed = await confirmRoutine(
    `Reiniciar ${label}?`,
    `Esta ${label === "descanso" ? "pausa" : label} voltará para ${seconds} segundos. O tempo atual será descartado. As séries já concluídas serão mantidas.`,
    `Reiniciar ${label}`,
  );
  // A stale dialog or double tap cannot restart a different set/session.
  if (
    !session ||
    session.id !== sessionId ||
    session.step !== step ||
    timer !== current
  )
    return;
  if (!confirmed) {
    if (wasRunning && timer.paused && document.visibilityState !== "hidden")
      toggleTimer();
    return;
  }
  clearInterval(timerInterval);
  const paused = !wasRunning || document.visibilityState === "hidden";
  timer = {
    id: id(),
    kind: current.kind,
    total: current.total,
    end: Date.now() + current.total,
    last: null,
    paused,
  };
  if (paused) timer.remaining = timer.total;
  if (document.visibilityState === "hidden") timer.waitingForScreen = true;
  persistSession();
  training();
  RoutineMotion.animate(
    $("#countdown"),
    [{ opacity: 0.4 }, { opacity: 1 }],
    420,
  );
  if (!paused) {
    audio();
    timerInterval = setInterval(tick, 200);
    tick();
  }
  toast(
    `${label === "série" ? "Série reiniciada" : label === "descanso" ? "Descanso reiniciado" : "Contagem reiniciada"}: ${seconds}s${paused ? " · em pausa" : ""}.`,
  );
}
function stopTrainingTimer() {
  clearInterval(timerInterval);
  timer = null;
}
function cancelTraining() {
  if (!session || busy || $("#modal").open) return;
  const wasRunning = timer && !timer.paused;
  if (wasRunning) toggleTimer();
  openModal(
    '<h2>Encerrar este treino?</h2><p class="muted modal-intro">As séries desta sessão não serão salvas no histórico. Seus treinos anteriores continuam guardados.</p><div class="timeractions"><button class="btn" id="returnToTraining">Voltar ao treino</button><button class="btn danger" id="discardSession">Encerrar sem salvar</button></div>',
  );
  const goBack = () => {
    closeModal();
    if (wasRunning && timer?.paused) toggleTimer();
  };
  $("#returnToTraining").onclick = goBack;
  $("#modal").oncancel = (event) => {
    event.preventDefault();
    goBack();
  };
  $("#discardSession").onclick = () => {
    stopTrainingTimer();
    session = null;
    persistSession();
    wake?.release().catch(() => {});
    page = "workouts";
    closeModal();
    render();
  };
}
function endTimer(natural, expectedTimerId = timer?.id) {
  if (!timer || !session || timer.id !== expectedTimerId) return;
  const ended = timer,
    remaining = ended.paused
      ? ended.remaining
      : Math.max(0, ended.end - Date.now());
  stopTrainingTimer();
  if (natural) beep(true);
  if (ended.kind === "prepare" || ended.kind === "transition") {
    beginAutomaticStep();
    return;
  }
  if (ended.kind === "rest") {
    if (session.config?.mode === "auto") beginAutomaticStep();
    else training();
    persistSession();
    return;
  }
  const step = session.steps[session.step];
  // Older saved sessions may contain a timer for a repetition set.
  if (step.e.type === "reps") {
    training();
    persistSession();
    return;
  }
  if (session.config?.mode === "auto") {
    const actual = Math.min(
      Number(step.e.target),
      Math.max(0, Math.round((ended.total - remaining) / 1000)),
    );
    recordTrainingSet(actual);
  } else {
    if (step.e.type === "time")
      session.actual = String(
        Math.min(
          Number(step.e.target),
          Math.max(0, Math.round((ended.total - remaining) / 1000)),
        ),
      );
    training();
    if (natural)
      toast("Tempo concluído. Confira o resultado e conclua a série.");
    persistSession();
  }
}
function completeSet(expectedId = session?.id, expectedStep = session?.step) {
  if (
    !session ||
    timer ||
    busy ||
    session.id !== expectedId ||
    session.step !== expectedStep
  )
    return;
  const value = $("#actual")?.value,
    actual = Number(value);
  if (
    !value?.trim() ||
    !Number.isInteger(actual) ||
    actual < 0 ||
    actual > 100000
  )
    return toast("Informe um valor inteiro válido.");
  recordTrainingSet(actual);
}
function recordTrainingSet(actual) {
  const step = session.steps[session.step];
  if (!step) return;
  session.results.push({
    ...clone(step.e),
    series: step.s,
    actual,
    estimated: false,
    round: step.round,
  });
  session.step++;
  if (session.step === session.steps.length) session.completed = Date.now();
  delete session.actual;
  delete session.redo;
  persistSession();
  if (session.step === session.steps.length) {
    if (session.config?.mode !== "auto" || step.e.type === "reps") beep(true);
    training();
    return;
  }
  if (step.restAfter > 0) startTimer(step.restAfter, "rest");
  else if (session.config?.mode === "auto") {
    if (
      session.steps[session.step].e.type === "time" &&
      session.config.transition > 0
    )
      startTimer(session.config.transition, "transition");
    else beginAutomaticStep();
  } else training();
}
function restoreTraining(saved) {
  if (!session) return;
  session.config ||= {
    mode: "manual",
    transition: 5,
    circuitRest: "exercise",
  };
  session.steps = buildWorkoutSteps(session.workout, session.config);
  delete session.config.repSeconds;
  if (
    saved &&
    saved.kind !== "rest" &&
    session.steps[session.step]?.e.type === "reps"
  ) {
    stopTrainingTimer();
    persistSession();
    toast(
      "Série recuperada. Faça as repetições no seu ritmo e confirme ao terminar.",
    );
    return;
  }
  if (saved) {
    timer = {
      ...saved,
      id: saved.id || id(),
      remaining: saved.paused
        ? saved.remaining
        : Math.max(0, saved.end - Date.now()),
      paused: true,
      last: null,
    };
    training();
    persistSession();
    toast(
      "Treino recuperado em pausa. Toque em Retomar quando estiver pronto.",
    );
  }
}
function resultsPreview(results) {
  return `<div class="results-preview">${results.map((r) => `<div><span>${esc(r.name)}<small>Série ${r.series} · meta ${esc(r.target)}${r.estimated ? " · estimativa" : ""}</small></span><b>${r.actual}<small>${r.type === "time" ? "s" : "reps"}</small></b></div>`).join("")}</div>`;
}
function editSessionResults() {
  preserveWork();
  openResultsEditor("session", session);
}
function editHistoryResults(hid) {
  const entry = state.history.find((h) => h.id === hid);
  if (entry) openResultsEditor(hid, entry);
}
function openResultsEditor(key, record) {
  resultEdit = { key, base: clone(record), count: record.results.length };
  openModal(
    `<h2>Revisar resultados</h2><p class="muted modal-intro">${esc(record.workout.name)} · corrija o que você realizou em cada série.</p><form id="resultForm">${record.results.map((r, i) => `<div class="result-edit-row"><div><b>${esc(r.name)}</b><small>Série ${r.series} · meta ${esc(r.target)}${r.estimated ? " · estimativa" : ""}</small></div><div><label for="result-${i}" class="sr-only">${esc(r.name)}, série ${r.series}, ${r.type === "time" ? "segundos" : "repetições"} realizados</label><input id="result-${i}" data-result="${i}" type="number" min="0" max="100000" step="1" required value="${r.actual}"><span>${r.type === "time" ? "segundos" : "reps"}</span></div></div>`).join("")}<label for="resultNotes">Observações de sensação / força</label><textarea id="resultNotes">${esc(record.notes || "")}</textarea><p class="footnote">Ao salvar, você confirma os valores apresentados. O histórico e os relatórios usarão os resultados corrigidos.</p><div class="timeractions"><button class="btn" type="button" onclick="closeModal()">Voltar</button><button class="btn primary">Salvar e confirmar valores</button></div></form>`,
  );
  $("#resultForm").onsubmit = saveResultEdits;
}
async function saveResultEdits(event) {
  event.preventDefault();
  if (!resultEdit) return;
  const values = [...document.querySelectorAll("[data-result]")].map((el) =>
    el.value.trim() ? Number(el.value) : NaN,
  );
  if (values.some((v) => !Number.isInteger(v) || v < 0 || v > 100000))
    return toast("Confira os resultados de todas as séries.");
  const apply = (record) => {
    values.forEach((actual, i) => {
      record.results[i].actual = actual;
      record.results[i].estimated = false;
    });
    record.notes = $("#resultNotes").value;
    record.updatedAt = new Date().toISOString();
  };
  if (resultEdit.key === "session") {
    if (!session || session.id !== resultEdit.base.id)
      return toast("Essa sessão não está mais aberta.");
    apply(session);
    persistSession();
    closeModal();
    training();
    toast("Resultados corrigidos.");
  } else {
    const current = state.history.find((h) => h.id === resultEdit.key);
    if (!same(current, resultEdit.base))
      return toast(
        "Este treino mudou na rede. Reabra a revisão para conferir os dados atualizados.",
      );
    const next = clone(state);
    apply(next.history.find((h) => h.id === resultEdit.key));
    if (await save(next)) {
      closeModal();
      render();
      toast("Histórico e relatório atualizados.");
    }
  }
}
