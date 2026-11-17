const $ = (s) => document.querySelector(s),
  esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    ),
  id = () =>
    crypto.randomUUID?.() ||
    Date.now().toString(36) + Math.random().toString(36).slice(2),
  date = (d = new Date()) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
  initialDate = date();
let today = initialDate;
const ex = (name, block, type, target, sets, rest) => ({
  id: id(),
  name,
  block,
  type,
  target,
  sets,
  rest,
});
function defaults() {
  const warm = () => [
    ex("Polichinelo", "Aquecimento", "time", "30", 2, 60),
    ex("Corrida Estacionária", "Aquecimento", "time", "25", 2, 60),
  ];
  const c = id();
  return {
    profile: { height: 1.7, weight: 69, notes: "", weights: [] },
    currentCycle: c,
    cycles: [
      {
        id: c,
        name: "Mês 1 — Adaptação",
        goal: 20,
        start: today,
        workouts: [
          {
            id: id(),
            name: "Treino A",
            schedule: "Seg / Qua / Sex",
            exercises: [
              ...warm(),
              ex("Flexão de Braço", "Força", "reps", "10-12", 2, 75),
              ex("Superman Pull sem toalha", "Força", "reps", "15", 2, 75),
              ex(
                "Back Widow / Empurrada de Cotovelos",
                "Força",
                "reps",
                "15",
                2,
                75,
              ),
              ex("Prancha", "Finalizador", "time", "30", 2, 60),
              ex("Escalador", "Finalizador", "time", "25", 2, 60),
            ],
          },
          {
            id: id(),
            name: "Treino B",
            schedule: "Ter / Qui",
            exercises: [
              ...warm(),
              ex("Agachamento Controlado", "Força", "reps", "15-18", 2, 75),
              ex("Afundo no lugar", "Força", "reps", "8-10 reps/perna", 2, 75),
              ex("Ponte de Glúteo", "Força", "reps", "20", 2, 75),
              ex("Abdominal Bicicleta", "Finalizador", "reps", "20", 2, 60),
              ex("Prancha", "Finalizador", "time", "30", 2, 60),
            ],
          },
        ],
      },
    ],
    history: [],
    diary: {},
    goals: [
      { id: id(), name: "Bati proteína nas refeições" },
      { id: id(), name: "Controlei o óleo" },
    ],
  };
}
let state,
  revision = 0,
  page = "dashboard",
  busy = false,
  editing = null,
  session = null,
  mealDate = today,
  reportRange = "week",
  reportDate = today,
  timerInterval,
  wake,
  audioCtx;
const clone = (value) => structuredClone(value);
const cache = {
  get(key) {
    try {
      return JSON.parse(localStorage.getItem("routine:" + key));
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem("routine:" + key, JSON.stringify(value));
      return true;
    } catch {
      window.RoutineDiagnostics?.record("R-STORE-001", "storage");
      toast(
        "Não foi possível guardar a recuperação local. Salve antes de fechar.",
      );
      return false;
    }
  },
  remove(key) {
    try {
      localStorage.removeItem("routine:" + key);
    } catch {}
  },
};
let diaryBase = null,
  diaryDirty = false,
  editingBase = null,
  editingCycleId = null;
let alertVolume = Math.min(
  1,
  Math.max(0.2, Number(cache.get("alert-volume")) || 0.8),
);
function setAlertVolume(value) {
  alertVolume = Math.min(1, Math.max(0.2, Number(value) || 0.8));
  cache.set("alert-volume", alertVolume);
  if ($("#alertVolumeValue"))
    $("#alertVolumeValue").textContent = Math.round(alertVolume * 100) + "%";
}
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
function captureDiary() {
  if (!$("#diaryForm") || !diaryDirty) return;
  const checks = {};
  document
    .querySelectorAll("[data-goal]")
    .forEach((el) => (checks[el.dataset.goal] = el.checked));
  cache.set("diary:" + mealDate, {
    base: diaryBase,
    entry: {
      meals: Object.fromEntries(meals.map((m, i) => [m, $("#meal" + i).value])),
      checks,
      goalNames: Object.fromEntries(state.goals.map((g) => [g.id, g.name])),
      status: "draft",
    },
  });
}
function persistSession() {
  if (session) cache.set("session", { session, timer });
  else cache.remove("session");
}
function preserveWork() {
  if (page === "diary") captureDiary();
  if (editing && $("#editorForm")) {
    readEditor();
    cache.set("editor", {
      editing,
      base: editingBase,
      cycleId: editingCycleId,
    });
  }
  if (session) {
    if ($("#sessionNotes")) session.notes = $("#sessionNotes").value;
    if ($("#actual")) session.actual = $("#actual").value;
    persistSession();
  }
}
window.addEventListener("pagehide", preserveWork);
document.addEventListener("input", () => {
  if (session) preserveWork();
  if (editing && $("#editorForm")) preserveWork();
  updateSyncStatus();
});
const cycle = () =>
  state.cycles.find((c) => c.id === state.currentCycle) || state.cycles[0];
function toast(s) {
  $("#toast").textContent = s;
  $("#toast").hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => {
    RoutineMotion.snapshot($("#toast"));
    $("#toast").hidden = true;
  }, 5500);
}
async function save(next) {
  return saveState(next);
}

function applySidebar() {
  const compact = cache.get("sidebar-collapsed") === true;
  document.body.classList.toggle("sidebar-collapsed", compact);
  const toggle = $("#sidebarToggle");
  if (toggle) {
    toggle.setAttribute("aria-expanded", String(!compact));
    toggle.title = compact
      ? "Expandir barra lateral"
      : "Recolher barra lateral";
    toggle.setAttribute("aria-label", toggle.title);
  }
}
function toggleSidebar() {
  cache.set("sidebar-collapsed", cache.get("sidebar-collapsed") !== true);
  applySidebar();
}
function nav(p) {
  closeControlPopover();
  if (busy) {
    toast("Aguarde o salvamento antes de trocar de tela.");
    return;
  }
  if (session && p !== "session") {
    toast("Finalize ou encerre o treino em andamento.");
    return;
  }
  clearTimeout(diaryAutoTimer);
  preserveWork();
  page = p;
  editing = null;
  render();
  window.scrollTo({ top: 0, behavior: "instant" });
}
function heading(k, t, sub, action = "") {
  return `<div class="heading"><div><div class="eyebrow" style="margin-bottom:12px">${k}</div><h1>${t}</h1><p>${sub}</p></div>${action}</div>`;
}
const icons = {
  mobile:
    '<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 18h4"/>',
  settings:
    '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="10" cy="18" r="2"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  dashboard:
    '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  workouts: '<path d="m6 6 12 12M4 9l5-5m6 16 5-5M2 7l5-5m10 20 5-5"/>',
  diary: '<path d="M8 3v5a3 3 0 0 1-6 0V3m3 0v18m14 0V3c-4 2-6 9 0 10"/>',
  history: '<path d="M3 3v18h18M7 15l4-5 4 3 6-8"/>',
  report:
    '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zm0 0v6h6M8 13h8m-8 4h5"/>',
};
function decorate() {
  document.querySelectorAll("input,textarea,select").forEach((el) => {
    const label = el.previousElementSibling;
    if (label?.tagName === "LABEL") {
      el.id ||= "field-" + id();
      label.htmlFor = el.id;
    }
  });
  document
    .querySelectorAll("input[type=number]")
    .forEach(
      (el) => (el.inputMode = el.step === "0.1" ? "decimal" : "numeric"),
    );
  document.querySelectorAll("#nav button").forEach((el) => {
    if (el.classList.contains("active"))
      el.setAttribute("aria-current", "page");
  });
  refineControls();
}
function observeControls() {
  for (const selector of ["#app", "#modal"])
    observer.observe($(selector), { childList: true, subtree: true });
}
const observer = new MutationObserver((records) => {
  // Timer digits and status text do not require a complete controls scan.
  // Disconnect while decorating so generated icons cannot trigger another scan.
  if (
    !records.some((record) =>
      [...record.addedNodes].some(
        (node) =>
          node.nodeType === 1 ||
          (node.nodeType === 3 && /[↗→←▾›▷✓♪]/.test(node.textContent)),
      ),
    )
  )
    return;
  observer.disconnect();
  try {
    decorate();
  } finally {
    observeControls();
  }
});
observeControls();
function render() {
  if (page !== "mobile") mobileRequest?.abort();
  clearTimeout(homeDayTimer);
  disposeHomeScenes();
  applySidebar();
  applyExperience();
  document.body.classList.toggle("training-view", page === "session");
  today = date();
  $("#app").classList.remove("page-enter");
  void $("#app").offsetWidth;
  $("#app").classList.add("page-enter");
  $("#nav").innerHTML = [
    ["dashboard", "◫", "Visão geral"],
    ["workouts", "⌁", "Meus treinos"],
    ["diary", "▤", "Diário alimentar"],
    ["history", "↗", "Evolução"],
    ["report", "▧", "Relatórios"],
    ["mobile", "▯", "Usar no celular"],
    ["settings", "⚙", "Configurações"],
    ["more", "…", "Mais"],
  ]
    .map(
      ([p, i, n]) =>
        `<button title="${n}" aria-label="${n}" class="${page === p || (p === "more" && ["settings", "report", "mobile"].includes(page)) || (page === "session" && p === "workouts") ? "active" : ""}" onclick="${p === "more" ? "moreMenu()" : `nav('${p}')`}"><b aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">${icons[p]}</svg></b><span class="nav-label-full">${n}</span><span class="nav-label-short" aria-hidden="true">${{ dashboard: "Início", workouts: "Treinos", diary: "Diário", history: "Evolução", report: "Relatório", mobile: "Celular", settings: "Ajustes", more: "Mais" }[p]}</span></button>`,
    )
    .join("");
  $("#dateLabel").textContent = new Date().toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  if (page === "dashboard") dashboard();
  if (page === "workouts") workouts();
  if (page === "diary") diary();
  if (page === "history") renderHistory();
  if (page === "report") report();
  if (page === "settings") settings();
  if (page === "mobile") mobileAccess();
  if (page === "session") training();
  updateSyncStatus();
}
function streak() {
  const days = new Set(state.history.map((h) => h.date));
  let d = new Date();
  if (!days.has(date(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (days.has(date(d))) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}
function openModal(html) {
  closeControlPopover();
  $("#modal").classList.remove("command-dialog");
  $("#modal").oncancel = null;
  if ($("#modal").open) $("#modal").close();
  $("#modal").innerHTML = html;
  $("#modal").showModal();
  $("#modal").scrollTop = 0;
  $("#modal").addEventListener("cancel", modalEscape, { once: true });
}
function modalEscape(event) {
  event.preventDefault();
  closeModal();
}
function closeModal() {
  closeControlPopover();
  const modal = $("#modal");
  if (modal.open) RoutineMotion.snapshot(modal, true);
  modal.removeEventListener("cancel", modalEscape);
  modal.close();
}
function cycleDialog() {
  openModal(
    `<h2>Seus ciclos</h2><label>Ciclo atual</label><select id="cycleSelect">${state.cycles.map((c) => `<option value="${c.id}" ${c.id === cycle().id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select><button class="btn action-after" onclick="selectCycle()">Selecionar</button><label>Nome do ciclo atual</label><input id="cycleName" value="${esc(cycle().name)}"><label>Meta de treinos</label><input id="cycleGoal" type="number" min="1" max="999" value="${cycle().goal}"><div class="timeractions"><button class="btn" onclick="closeModal()">Cancelar</button><button class="btn" onclick="newCycle()">+ Novo ciclo</button><button class="btn primary" onclick="updateCycle()">Salvar ciclo</button></div><p class="footnote">Novos ciclos copiam os treinos atuais para você ajustar a progressão. O histórico é preservado.</p>`,
  );
}
async function selectCycle() {
  let n = structuredClone(state);
  n.currentCycle = $("#cycleSelect").value;
  if (await save(n)) {
    closeModal();
    render();
  }
}
async function updateCycle() {
  let name = $("#cycleName").value.trim(),
    goal = +$("#cycleGoal").value;
  if (!name || !Number.isInteger(goal) || goal < 1 || goal > 999)
    return toast("Informe nome e meta entre 1 e 999.");
  let n = structuredClone(state),
    c = n.cycles.find((c) => c.id === n.currentCycle);
  Object.assign(c, { name, goal });
  if (await save(n)) {
    closeModal();
    render();
  }
}
async function newCycle() {
  let n = structuredClone(state),
    c = structuredClone(cycle());
  c.id = id();
  c.name = `Mês ${n.cycles.length + 1} — Progressão`;
  c.start = today;
  n.cycles.push(c);
  n.currentCycle = c.id;
  if (await save(n)) {
    closeModal();
    render();
    cycleDialog();
  }
}
function profileDialog() {
  openModal(
    `<h2>Como você está evoluindo?</h2><p class="muted">Registro opcional. Observe também sua força e suas roupas.</p><label>Peso (kg)</label><input id="weight" type="number" step="0.1" min="1" max="500" value="${state.profile.weight}"><label>Data do registro</label><input id="weightDate" type="date" value="${today}"><label>Percepção visual / roupas / anotações gerais</label><textarea id="profileNotes">${esc(state.profile.notes)}</textarea><div class="timeractions"><button class="btn" onclick="closeModal()">Cancelar</button><button class="btn primary" onclick="saveProfile()">Salvar registro</button></div>`,
  );
}
async function saveProfile() {
  const weight = +$("#weight").value,
    d = $("#weightDate").value;
  if (!d || !Number.isFinite(weight) || weight <= 0 || weight > 500)
    return toast("Informe data e peso válido.");
  let n = structuredClone(state);
  n.profile.weight = weight;
  n.profile.weightKnown = true;
  n.profile.notes = $("#profileNotes").value;
  n.profile.weights.push({ date: d, weight, notes: n.profile.notes });
  if (await save(n)) {
    closeModal();
    render();
  }
}
function resumeEditor() {
  const saved = cache.get("editor");
  if (!saved || saved.cycleId !== cycle().id) return;
  editing = saved.editing;
  editingBase = saved.base;
  editingCycleId = saved.cycleId;
  editor();
}
async function cancelEditor() {
  if (
    await confirmRoutine(
      "Descartar esta edição?",
      "As alterações não salvas serão removidas. O treino salvo continua no seu plano.",
      "Descartar edição",
    )
  ) {
    cache.remove("editor");
    editing = null;
    workouts();
  }
}
function workouts() {
  if (editing) return editor();
  RoutineMotion.swap($("#app"), paintWorkouts);
}
function paintWorkouts() {
  $("#app").innerHTML =
    heading(
      "SEU PLANO, SUAS REGRAS",
      "Meus treinos.",
      esc(cycle().name),
      '<button class="btn primary" onclick="editWorkout()">+ Criar treino</button>',
    ) +
    audioControls() +
    `<div class="grid workout-library">${
      cycle()
        .workouts.map(
          (w) =>
            `<div class="card workout-library-card"><div class="row"><div><span class="eyebrow">${esc(w.schedule)}</span><h2>${esc(w.name)}</h2></div><button class="btn" onclick="editWorkout('${w.id}')">Editar ↗</button></div><details class="workout-outline"><summary>${w.exercises.length} exercícios · conferir sequência</summary>${w.exercises.map((e) => `<div class="line row"><div><span class="tag">${esc(e.block)}</span><p style="margin-top:9px">${esc(e.name)}</p></div><span class="muted">${e.sets} × ${esc(e.target)}${e.type === "time" ? "s" : /reps/i.test(e.target) ? "" : " reps"}<br>${e.rest}s descanso</span></div>`).join("")}</details><div class="row action-after"><button class="btn danger" onclick="deleteWorkout('${w.id}')">Excluir treino</button><button class="btn primary" onclick="configureTraining('${w.id}')">Treinar agora ↗</button></div></div>`,
        )
        .join("") ||
      '<p class="empty">Nenhum treino. Crie um plano para começar.</p>'
    }</div>`;
  if (cache.get("editor")?.cycleId === cycle().id) {
    $("#app").insertAdjacentHTML(
      "afterbegin",
      '<div class="recovery-banner"><span>Você tem uma edição de treino guardada neste dispositivo.</span><button class="btn small" onclick="resumeEditor()">Retomar edição</button></div>',
    );
  }
}
async function editWorkout(wid) {
  const initialCycleId = cycle().id;
  const pending = cache.get("editor");
  if (pending && pending.cycleId === cycle().id) {
    if (
      !(await confirmRoutine(
        "Você tem uma edição guardada.",
        "Deseja descartar esse rascunho para abrir outro treino?",
        "Descartar e abrir",
      ))
    )
      return;
    if (cycle().id !== initialCycleId || busy)
      return toast(
        "O ciclo mudou ou há um salvamento em andamento. Tente novamente.",
      );
    cache.remove("editor");
  }
  editingCycleId = cycle().id;
  editingBase = clone(cycle().workouts.find((w) => w.id === wid) || null);

  editing = wid
    ? structuredClone(cycle().workouts.find((w) => w.id === wid))
    : { id: id(), name: "Novo treino", schedule: "", exercises: [] };
  editor();
}
function editor() {
  const entering = !$("#editorForm");
  $("#app").innerHTML =
    heading(
      "EDITOR DE TREINO",
      "Seu plano em movimento.",
      "Ajuste séries, metas e descanso para seu momento.",
    ) +
    `<form id="editorForm"><div class="card"><div class="formgrid"><div><label>Nome do treino</label><input id="wname" required value="${esc(editing.name)}"></div><div><label for="wschedule">Dias / programação</label><input id="wschedule" oninput="syncWorkoutDays()" value="${esc(editing.schedule)}" placeholder="Seg / Qua / Sex"></div></div>${workoutDayPicker(editing.schedule)}<div id="exercises">${editing.exercises.map((e, i) => `<div class="exercise" data-index="${i}"><div class="row"><span class="eyebrow">EXERCÍCIO ${i + 1}</span><button type="button" class="btn small danger" onclick="removeExercise(${i})">Remover</button></div><div class="formgrid"><div><label>Exercício</label><input name="name" required value="${esc(e.name)}"></div><div><label>Bloco</label><select name="block">${["Aquecimento", "Força", "Finalizador"].map((b) => `<option ${b === e.block ? "selected" : ""}>${b}</option>`).join("")}</select></div><div><label>Tipo</label><select name="type"><option value="reps" ${e.type === "reps" ? "selected" : ""}>Repetições</option><option value="time" ${e.type === "time" ? "selected" : ""}>Segundos</option></select></div><div><label>Meta (ex: 10-12 ou 30)</label><input name="target" required value="${esc(e.target)}"></div><div><label>Séries / voltas</label><input name="sets" required type="number" min="1" max="30" value="${e.sets}"></div><div><label>Descanso (segundos)</label><input name="rest" required type="number" min="0" max="3600" value="${e.rest}"></div></div></div>`).join("")}</div><button type="button" class="btn action-after" onclick="addExercise()">+ Adicionar exercício</button><div class="timeractions"><button type="button" class="btn" onclick="cancelEditor()">Cancelar</button><button class="btn primary">Salvar treino</button></div></div></form>`;
  $("#editorForm").onsubmit = saveWorkout;
  if (entering) RoutineMotion.enter($("#app"));
}
function readEditor() {
  editing.name = $("#wname").value;
  editing.schedule = $("#wschedule").value;
  document.querySelectorAll(".exercise").forEach((el) => {
    let e = editing.exercises[+el.dataset.index];
    ["name", "block", "type", "target", "sets", "rest"].forEach(
      (k) =>
        (e[k] = ["sets", "rest"].includes(k)
          ? +el.querySelector(`[name=${k}]`).value
          : el.querySelector(`[name=${k}]`).value),
    );
    delete e.autoSeconds;
  });
}
function addExercise() {
  readEditor();
  editing.exercises.push(ex("", "Força", "reps", "12", 2, 75));
  editor();
  RoutineMotion.enter(document.querySelector(".exercise:last-child"));
  preserveWork();
}
function removeExercise(i) {
  readEditor();
  editing.exercises.splice(i, 1);
  editor();
  preserveWork();
}
async function saveWorkout(ev) {
  ev.preventDefault();
  readEditor();
  editing.name = editing.name.trim();
  editing.exercises.forEach((e) => {
    e.name = e.name.trim();
    e.target = e.target.trim();
  });
  if (
    !editing.name ||
    editing.exercises.some(
      (e) =>
        !e.name ||
        !e.target ||
        !Number.isInteger(e.sets) ||
        e.sets < 1 ||
        e.sets > 30 ||
        !Number.isInteger(e.rest) ||
        e.rest < 0 ||
        e.rest > 3600,
    )
  )
    return toast("Confira nomes, séries (1–30) e descanso (0–3600s).");
  const latest =
    state.cycles
      .find((c) => c.id === editingCycleId)
      ?.workouts.find((w) => w.id === editing.id) || null;
  if (!same(latest, editingBase)) {
    preserveWork();
    return toast(
      "Este treino mudou em outro dispositivo. Sua edição foi guardada; reabra o treino atualizado antes de salvar.",
    );
  }
  if (!editing.exercises.length)
    return toast("Adicione ao menos um exercício.");
  if (
    editing.exercises.some(
      (e) =>
        e.type === "time" &&
        (!Number.isInteger(+e.target) || +e.target < 1 || +e.target > 3600),
    )
  )
    return toast("Metas por tempo: use segundos inteiros entre 1 e 3600.");
  let n = structuredClone(state),
    ws = n.cycles.find((c) => c.id === editingCycleId).workouts,
    index = ws.findIndex((w) => w.id === editing.id);
  if (index < 0) ws.push(editing);
  else ws[index] = editing;
  if (await save(n)) {
    cache.remove("editor");
    editing = null;
    render();
    toast("Treino salvo.");
  }
}
async function deleteWorkout(wid) {
  const cycleId = cycle().id;
  if (
    !(await confirmRoutine(
      "Excluir este treino?",
      "O plano será removido deste ciclo. As sessões já realizadas continuam no histórico.",
      "Excluir treino",
    ))
  )
    return;
  if (cycle().id !== cycleId || busy)
    return toast(
      "O ciclo mudou ou há um salvamento em andamento. Tente novamente.",
    );
  let n = structuredClone(state);
  n.cycles.find((c) => c.id === n.currentCycle).workouts =
    cycle().workouts.filter((w) => w.id !== wid);
  if (await save(n)) render();
}
async function lock() {
  try {
    if (wake && !wake.released) return;
    if (navigator.wakeLock) wake = await navigator.wakeLock.request("screen");
    else toast("Tela ativa indisponível neste navegador.");
  } catch {
    toast("Tela ativa exige HTTPS no celular. Use o endereço HTTPS do Ngrok.");
  }
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") preserveWork();
  if (
    document.visibilityState === "visible" &&
    page === "dashboard" &&
    today !== date()
  )
    render();
  if (document.visibilityState === "visible" && session) lock();
  if (document.visibilityState === "visible" && timer) {
    tick();
    if (timer?.waitingForScreen)
      toast(
        "Próximo exercício em pausa. Toque em Retomar quando estiver pronto.",
      );
  }
});
function audio() {
  try {
    // Ambient is mixable: do not request an exclusive playback/music session.
    try {
      if (navigator.audioSession) navigator.audioSession.type = "ambient";
    } catch {}
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    audioCtx.resume().catch(() => {});
    return audioCtx;
  } catch {}
  return null;
}
function beep(long = false) {
  try {
    audio();
    const o = audioCtx.createOscillator(),
      g = audioCtx.createGain();
    o.connect(g);
    g.connect(audioCtx.destination);
    o.frequency.value = long ? 1500 : 1100;
    o.type = "sine";
    g.gain.setValueAtTime(0.001, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(
      alertVolume,
      audioCtx.currentTime + 0.015,
    );
    g.gain.exponentialRampToValueAtTime(
      0.001,
      audioCtx.currentTime + (long ? 1 : 0.15),
    );
    o.start();
    o.stop(audioCtx.currentTime + (long ? 1 : 0.15));
  } catch {}
  if (long) {
    try {
      navigator.vibrate?.([300, 100, 300]);
    } catch {}
  }
}
async function testSound() {
  const context = audio();
  if (!context) {
    toast(
      "Este navegador não conseguiu ativar o áudio. Tente Chrome ou Safari atualizado.",
    );
    return;
  }
  try {
    await context.resume();
    if (context.state !== "running") {
      toast(
        "O áudio está bloqueado. Toque novamente e confira o volume de mídia.",
      );
      return;
    }
    beep(true);
    toast("Apito disparado. Confira se ouviu por cima da música.");
  } catch {
    toast(
      "Não foi possível ativar o som. Confira o volume de mídia do celular.",
    );
  }
}
function audioControls() {
  return `<details class="audio-settings"><summary>Apito e música</summary><div class="row" style="margin-top:12px"><label for="alertVolume" style="margin:0">Volume do apito</label><output id="alertVolumeValue" for="alertVolume">${Math.round(alertVolume * 100)}%</output></div><input id="alertVolume" aria-label="Volume do apito" type="range" min="0.2" max="1" step="0.05" value="${alertVolume}" oninput="setAlertVolume(this.value)"><button type="button" class="btn" onclick="testSound()">Testar apito ♪</button><p class="footnote">Toque para testar com sua música tocando. Deixe o Routine na tela e a música em segundo plano. O modo de áudio pede mistura com a música quando o navegador oferece suporte. Com tela bloqueada ou navegador em segundo plano, os alertas podem atrasar. No iPhone, confira também o modo silencioso.</p></details>`;
}
async function finishTraining() {
  if (!session || busy || session.step < session.steps.length) return;
  session.notes = $("#sessionNotes").value;
  persistSession();
  let n = structuredClone(state);
  const { steps, ...record } = session;
  record.duration = Math.round(
    ((record.completed || Date.now()) - record.started) / 1000,
  );
  if (!n.history.some((h) => h.id === record.id)) n.history.push(record);
  if (await save(n)) {
    wake?.release().catch(() => {});
    stopTrainingTimer();
    session = null;
    persistSession();
    page = "dashboard";
    render();
    toast("Treino registrado. Mais um passo dado.");
  }
}
const meals = [
  "Café da Manhã",
  "Almoço",
  "Café da Tarde",
  "Janta",
  "Lanches/Doces extras",
];
function diaryStatus(entry) {
  if (!entry?.updatedAt)
    return entry?.status === "draft"
      ? "Rascunho salvo"
      : entry?.meals
        ? "Diário salvo"
        : "Preencha aos poucos e salve para continuar depois.";
  const stamp = new Date(entry.updatedAt).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${entry.status === "draft" ? "Rascunho salvo" : "Diário finalizado"} · ${stamp}`;
}
function changeDiaryDate(value) {
  clearTimeout(diaryAutoTimer);
  captureDiary();
  mealDate = value || date();
  diary();
}
function useRemoteDiary() {
  cache.remove("diary:" + mealDate);
  diaryDirty = false;
  closeModal();
  diary();
}
async function overwriteDiary(status) {
  diaryBase = clone(state.diary[mealDate] || null);
  closeModal();
  await saveDiary(status);
}
function diary() {
  let saved = cache.get("diary:" + mealDate);
  const remote = state.diary[mealDate];
  if (
    saved &&
    remote &&
    same(saved.entry.meals, remote.meals) &&
    same(saved.entry.checks, remote.checks) &&
    same(saved.entry.goalNames, remote.goalNames)
  ) {
    cache.remove("diary:" + mealDate);
    saved = null;
  }
  diaryDirty = !!saved;
  diaryBase = clone(saved ? saved.base : state.diary[mealDate] || null);
  const d = saved?.entry || state.diary[mealDate] || {};
  $("#app").innerHTML =
    heading(
      "COMIDA DE VERDADE. REGISTRO SIMPLES.",
      "Diário alimentar.",
      "Preencha no seu tempo. O rascunho é salvo automaticamente.",
    ) +
    `<form id="diaryForm" class="card"><div class="diary-state"><span class="tag">${d.status === "draft" ? "RASCUNHO" : d.meals ? "DIÁRIO SALVO" : "SEU DIA"}</span><span id="diarySaveStatus" class="muted" role="status" aria-live="polite">${esc(saved ? "Recuperado neste dispositivo — salve para sincronizar." : diaryStatus(d))}</span></div><label>Data</label><input id="mealDate" type="date" value="${mealDate}" onchange="changeDiaryDate(this.value)"><div class="formgrid">${meals.map((m, i) => `<div class="meal-card ${d.meals?.[m]?.trim() ? "has-entry" : ""}"><div class="meal-card-head"><label for="meal${i}">${m}</label><span class="meal-status">${d.meals?.[m]?.trim() ? "Preenchido" : "Em aberto"}</span></div><textarea id="meal${i}" placeholder="O que você comeu?">${esc(d.meals?.[m] || "")}</textarea></div>`).join("")}</div><div class="sectionhead" style="margin-top:24px"><h3>Pequenos compromissos</h3><button type="button" class="btn small" onclick="goalDialog()">Personalizar</button></div>${state.goals.map((g) => `<label class="check"><input type="checkbox" data-goal="${g.id}" ${d.checks?.[g.id] ? "checked" : ""}>${esc(g.name)}</label>`).join("")}<div class="diary-savebar"><button type="submit" class="btn" data-status="draft">Salvar rascunho</button><button type="submit" class="btn primary" data-status="complete">Finalizar diário ✓</button><button type="button" id="copyDiaryButton" class="btn" onclick="copyDiaryForGemini()">Copiar relatório para IA ↗</button></div><p class="footnote">O rascunho mantém refeições e metas preenchidas, mesmo com campos vazios. Após salvar, você pode fechar o app e continuar nesta data pelo PC ou celular. O diário finalizado também pode ser editado.</p></form>`;
  $("#diaryForm").onsubmit = (ev) => {
    ev.preventDefault();
    saveDiary(ev.submitter?.dataset.status || "draft");
  };
  $("#diaryForm").addEventListener("input", (ev) => {
    if (ev.target.id !== "mealDate") {
      diaryDirty = true;
      const card = ev.target.closest(".meal-card");
      if (card) {
        const filled = ev.target.value.trim().length > 0;
        card.classList.toggle("has-entry", filled);
        card.querySelector(".meal-status").textContent = filled
          ? "Preenchido"
          : "Em aberto";
      }
      captureDiary();
      $("#diarySaveStatus").textContent =
        "Guardado neste aparelho. Salvando rascunho automaticamente…";
      scheduleDiaryAutosave();
    }
  });
  enhanceDiary();
}

function diaryMarkdown() {
  const form = $("#diaryForm");
  const lines = [
    `# Routine — Diário alimentar`,
    `Data: ${mealDate}`,
    "Conteúdo atual do diário (pode estar em preenchimento).",
    "",
    "## Refeições",
  ];
  for (const [i, meal] of meals.entries())
    lines.push(
      `### ${meal}`,
      $("#meal" + i).value.trim() || "Não registrado.",
      "",
    );
  lines.push("## Metas diárias");
  for (const goal of state.goals) {
    const checked = [...form.querySelectorAll("[data-goal]")].some(
      (el) => el.dataset.goal === goal.id && el.checked,
    );
    lines.push(`- [${checked ? "x" : " "}] ${goal.name}`);
  }
  return lines.join("\n");
}
async function copyDiaryForGemini() {
  const text = diaryMarkdown();
  try {
    await navigator.clipboard.writeText(text);
    toast("Diário copiado. Pronto para colar no Gemini.");
  } catch {
    openModal(
      `<h2>Copiar diário</h2><p class="footnote">Use Copiar no menu do celular ou Ctrl+C. O conteúdo inclui os campos atuais, mesmo sem salvar.</p><textarea id="diaryCopyText" class="report" readonly aria-label="Diário em Markdown">${esc(text)}</textarea><button class="btn primary action-after" onclick="closeModal()">Fechar</button>`,
    );
    $("#diaryCopyText").focus();
    $("#diaryCopyText").select();
  }
}
async function saveDiary(status, automatic = false) {
  clearTimeout(diaryAutoTimer);
  if (busy) {
    toast("Aguarde o salvamento em andamento e tente novamente.");
    return;
  }
  const form = $("#diaryForm");
  if (!same(state.diary[mealDate] || null, diaryBase)) {
    diaryDirty = true;
    captureDiary();
    const remote = state.diary[mealDate];
    openModal(
      `<h2>Este dia mudou na rede</h2><p class="footnote">Outro dispositivo atualizou o diário. Seu texto está guardado neste dispositivo. Escolha qual versão manter.</p><label>Versão da rede</label><textarea readonly>${esc(meals.map((m) => m + ": " + (remote?.meals?.[m] || "Não registrado")).join("\n"))}</textarea><div class="timeractions"><button class="btn" onclick="useRemoteDiary()">Usar versão da rede</button><button class="btn primary" onclick="overwriteDiary('${status}')">Salvar minha versão</button></div>`,
    );
    return;
  }
  const entryDate = mealDate,
    checks = {};
  form
    .querySelectorAll("[data-goal]")
    .forEach((el) => (checks[el.dataset.goal] = el.checked));
  const entry = {
    meals: Object.fromEntries(meals.map((m, i) => [m, $("#meal" + i).value])),
    checks,
    goalNames: Object.fromEntries(state.goals.map((g) => [g.id, g.name])),
    status,
    updatedAt: new Date().toISOString(),
  };
  const n = structuredClone(state);
  n.diary[entryDate] = entry;
  const controls = [...form.querySelectorAll("[data-status]")];
  if (!automatic) controls.forEach((el) => (el.disabled = true));
  $("#diarySaveStatus").textContent = "Salvando…";
  const ok = await save(n);
  controls.forEach((el) => (el.disabled = false));
  if ($("#diaryForm") !== form) return;
  if (ok) {
    diaryBase = clone(entry);
    const changed =
      !same(
        entry.meals,
        Object.fromEntries(meals.map((m, i) => [m, $("#meal" + i).value])),
      ) ||
      [...form.querySelectorAll("[data-goal]")].some(
        (el) => entry.checks[el.dataset.goal] !== el.checked,
      );
    diaryDirty = changed;
    cache.remove("diary:" + entryDate);
    if (changed) {
      captureDiary();
      scheduleDiaryAutosave();
    }
    $("#diarySaveStatus").textContent = outbox
      ? syncLabel()
      : changed
        ? "Novas alterações guardadas; salvando novamente…"
        : diaryStatus(entry);
    form.querySelector(".diary-state .tag").textContent =
      status === "draft" ? "RASCUNHO" : "DIÁRIO SALVO";
    if (!automatic) {
      const button = form.querySelector(`[data-status="${status}"]`);
      if (button) {
        clearTimeout(button._feedbackTimer);
        button._label ||=
          status === "draft" ? "Salvar rascunho" : "Finalizar diário ✓";
        button.textContent = outbox
          ? "✓ Guardado neste aparelho"
          : status === "draft"
            ? "✓ Rascunho salvo"
            : "✓ Diário finalizado";
        button.dataset.saved = "true";
        RoutineMotion.animate(
          button,
          [{ transform: "scale(.98)" }, { transform: "scale(1)" }],
          420,
        );
        button._feedbackTimer = setTimeout(() => {
          if (button.isConnected) {
            button.textContent = button._label;
            delete button.dataset.saved;
          }
        }, 2200);
      }
      toast(
        status === "draft"
          ? "Rascunho salvo. Continue quando quiser."
          : "Diário finalizado e salvo.",
      );
    }
  } else
    $("#diarySaveStatus").textContent =
      "Não foi possível salvar. Seus campos foram preservados; tente novamente.";
  updateSyncStatus();
}

function goalDialog() {
  openModal(
    `<h2>Metas diárias</h2><p class="footnote">Uma meta por linha. Salve o diário antes de editar metas.</p><textarea id="goalNames" style="margin-top:18px">${esc(state.goals.map((g) => g.name).join("\n"))}</textarea><div class="timeractions"><button class="btn" onclick="closeModal()">Cancelar</button><button class="btn primary" onclick="saveGoals()">Salvar metas</button></div>`,
  );
}
async function saveGoals() {
  captureDiary();
  let n = structuredClone(state);
  n.goals = [
    ...new Set(
      $("#goalNames")
        .value.split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ].map(
    (name) => state.goals.find((g) => g.name === name) || { id: id(), name },
  );
  if (await save(n)) {
    closeModal();
    diary();
  }
}
function renderHistory() {
  const records = state.history
    .filter((h) => h.cycleId === cycle().id)
    .slice()
    .reverse();
  $("#app").innerHTML =
    heading(
      "EVOLUÇÃO",
      "O que você construiu.",
      esc(cycle().name),
      '<button class="btn" onclick="profileDialog()">+ Registrar peso</button>',
    ) +
    `<div class="grid twocol"><section class="card"><h2>Histórico de treinos</h2>${records.map((h) => `<details class="history-entry"><summary><span><b>${esc(h.workout.name)}</b><small>${esc(h.date.split("-").reverse().join("/"))} · ${Math.round(h.duration / 60)} min · ${h.results.length} séries</small></span>${h.results.some((r) => r.estimated) ? '<span class="tag pending-tag">Revisar</span>' : ""}</summary>${resultsPreview(h.results)}<p class="history-note">${esc(h.notes || "Sem observações.")}</p><button class="btn small" onclick="editHistoryResults('${h.id}')">Editar resultados</button></details>`).join("") || '<p class="empty">Seu próximo treino começa este histórico.</p>'}</section><section class="card"><h2>Além dos números</h2><p class="muted" style="margin:16px 0">${esc(state.profile.notes || "Observe sua força, suas roupas e como você se sente.")}</p>${state.profile.weights
      .slice()
      .reverse()
      .map(
        (w) =>
          `<div class="line"><div class="row"><span>${esc(w.date.split("-").reverse().join("/"))}</span><b>${w.weight} kg</b></div><p class="footnote">${esc(w.notes)}</p></div>`,
      )
      .join("")}</section></div>`;
  renderInsights();
}

function changeReportRange(value) {
  reportRange = value;
  generateReport();
}
function changeReportDate(value) {
  reportDate = value || date();
  generateReport();
}
function report() {
  $("#app").innerHTML =
    heading(
      "CONTEXTO PARA O PRÓXIMO PASSO",
      "Seu relatório.",
      "Leve seus registros para conversar com o Gemini.",
    ) +
    `<div class="card"><div class="formgrid"><div><label>Período</label><select id="range" onchange="changeReportRange(this.value)"><option value="day">Dia</option><option value="week" ${reportRange === "week" ? "selected" : ""}>Últimos 7 dias</option><option value="month" ${reportRange === "month" ? "selected" : ""}>Mês completo</option></select></div><div><label>Data de referência (ou mês desejado)</label><input id="reportDate" type="date" value="${reportDate}" onchange="changeReportDate(this.value)"></div></div><div class="report-toolbar"><span class="eyebrow">SEU PROGRESSO, EM PERSPECTIVA</span><button type="button" class="btn small" id="reportSourceButton" onclick="toggleReportSource()">Ver Markdown</button></div><article id="reportPreview" class="report-document" aria-label="Relatório formatado"></article><textarea class="report" id="reportText" aria-label="Relatório em Markdown" readonly hidden></textarea><button class="btn primary action-after" onclick="copyReport()">Copiar relatório para IA ↗</button><p class="footnote">O relatório fica aqui até você copiá-lo. Nenhum dado é enviado ao Gemini automaticamente.</p></div>`;
  $("#app").insertAdjacentHTML("beforeend", aiExplanation());
  $("#range").value = reportRange;
  generateReport();
}
function generateReport() {
  const ref = $("#reportDate").value;
  if (!ref) return;
  let start = ref,
    end = ref;
  if (reportRange === "week") {
    let d = new Date(ref + "T12:00:00");
    d.setDate(d.getDate() - 6);
    start = date(d);
  }
  if (reportRange === "month") {
    start = ref.slice(0, 7) + "-01";
    end = date(new Date(+ref.slice(0, 4), +ref.slice(5, 7), 0));
  }
  const hs = state.history.filter((h) => h.date >= start && h.date <= end);
  let text = `# Routine — Relatório\nPeríodo: ${start} a ${end}\nPerfil: ${state.profile.height.toFixed(2)} m | Peso atual: ${state.profile.weightKnown === false ? "Não informado" : state.profile.weight + " kg"}\nPercepções gerais atuais: ${state.profile.notes || "Não registradas"}\n\n## Treinos (${hs.length})\n`;
  for (const h of hs) {
    text += `\n### ${h.date} — ${h.workout.name} (${h.cycleName})\n`;
    for (const e of h.results)
      text += `- ${e.block} / ${e.name}: série ${e.series}, realizado ${e.actual} ${e.type === "time" ? "s" : "reps"} vs meta ${e.target}; descanso planejado ${e.rest}s${e.estimated ? " [ESTIMATIVA — revisar repetições]" : ""}\n`;
    text += `Observações: ${h.notes || "Sem observações"}\n`;
  }
  if (!hs.length) text += "Nenhum treino registrado.\n";
  text += "\n## Alimentação\n";
  let entries = Object.entries(state.diary)
    .filter(([d]) => d >= start && d <= end)
    .sort();
  for (const [d, v] of entries) {
    text += `\n### ${d}${v.status === "draft" ? " — Rascunho (dia em preenchimento)" : ""}\n`;
    for (const m of meals)
      text += `- ${m}: ${v.meals?.[m] || "Não registrado"}\n`;
    for (const [gid, name] of Object.entries(v.goalNames || {}))
      text += `- [${v.checks?.[gid] ? "x" : " "}] ${name}\n`;
  }
  if (!entries.length) text += "Nenhuma refeição registrada.\n";
  text += "\n## Registros de peso no período\n";
  text +=
    state.profile.weights
      .filter((w) => w.date >= start && w.date <= end)
      .map((w) => `- ${w.date}: ${w.weight} kg; ${w.notes}`)
      .join("\n") || "Nenhum registro.";
  text += reportComparison(start, end);
  $("#reportText").value = text;
  renderMarkdownPreview(text);
}
async function copyReport() {
  try {
    await navigator.clipboard.writeText($("#reportText").value);
    toast("Copiado. Pronto para colar no Gemini.");
  } catch {
    $("#reportText").hidden = false;
    $("#reportPreview").hidden = true;
    $("#reportSourceButton").textContent = "Ver relatório formatado";
    $("#reportText").focus();
    $("#reportText").select();
    toast("Selecionei o relatório. Use Copiar no menu do celular ou Ctrl+C.");
  }
}
async function refresh() {
  const r = await fetch("/api/state", { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw Error("Servidor indisponível");
  const data = await r.json();
  cacheServerState(data);
  return data;
}
(async () => {
  initSync();
  try {
    let d;
    try {
      d = await refresh();
    } catch (error) {
      d = cache.get("last-state");
      if (!d?.state && !outbox?.next) throw error;
      connected = false;
      d ||= { state: outbox.next, revision: 0 };
    }
    state = outbox?.next || d.state;
    revision = d.revision;
    if (!state) {
      if (!(await save(defaults()))) {
        d = await refresh();
        state = d.state;
        revision = d.revision;
        if (!state) throw Error("Falha ao iniciar banco de dados");
      }
    }
    const recovered = cache.get("session");
    if (
      recovered?.session?.steps?.length &&
      !state.history.some((h) => h.id === recovered.session.id)
    ) {
      session = recovered.session;
      page = "session";
      toast("Treino recuperado. Continue de onde parou.");
    } else cache.remove("session");
    render();
    if (session) {
      lock();
      restoreTraining(recovered.timer);
      training();
    }
    const events = new EventSource("/api/events");
    events.onopen = () => {
      connected = true;
      updateSyncStatus();
      if (outbox) retryPending();
    };
    events.onerror = () => {
      window.RoutineDiagnostics?.record("R-SYNC-001", "sync");
      connected = false;
      updateSyncStatus();
    };
    events.onmessage = async (ev) => {
      if (outbox) {
        await retryPending();
        return;
      }
      if (+ev.data <= revision) return;
      if (busy) {
        setTimeout(() => events.onmessage(ev), 350);
        return;
      }
      try {
        const d = await refresh();
        if (d.revision <= revision) return;
        state = d.state;
        revision = d.revision;
        if (
          !session &&
          !editing &&
          !$("#modal").open &&
          (page !== "diary" || !diaryDirty)
        )
          render();
        else
          toast(
            "Dados atualizados em outro dispositivo. Seu formulário foi preservado.",
          );
      } catch {
        toast("Sem conexão. Reconectando…");
      }
    };
    updateSyncStatus();
    if (outbox && connected) retryPending();
    if (
      !session &&
      !state.history.length &&
      !state.profile.setupComplete &&
      !cache.get("welcome-seen")
    )
      welcomeRoutine();
  } catch (e) {
    window.RoutineDiagnostics?.record("R-INIT-001", "startup");
    $("#app").innerHTML =
      '<div class="card">R-INIT-001 · Não foi possível conectar ao servidor. Inicie npm start e recarregue a página.</div>';
    toast(e.message);
  }
})();
