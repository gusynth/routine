const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { JSDOM, VirtualConsole } = require("jsdom");
const { validateState } = require("../lib/state");
const code = fs.readFileSync("public/app.js", "utf8");
const html = fs
  .readFileSync("public/index.html", "utf8")
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "");
const copy = (v) => JSON.parse(JSON.stringify(v));
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise(setImmediate);
};

test("dashboard embeds the local glass scene, preserves progress and honors economy preferences", async (t) => {
  const c = await client(database());
  t.after(() => c.close());
  const frame = c.$(".routine-scene-frame iframe");
  assert.ok(frame);
  assert.equal(frame.getAttribute("src"), "/scene/index.html");
  assert.equal(frame.getAttribute("loading"), "lazy");
  assert.match(frame.getAttribute("title"), /Routine/);
  assert.equal(c.$('[role="progressbar"]').getAttribute("aria-valuenow"), "0");
  assert.equal(c.$('[role="progressbar"]').getAttribute("aria-valuemax"), "20");
  c.w.nav("diary");
  assert.equal(frame.isConnected, false);

  const quiet = await client(database(), { "routine:reduce-motion": "true" });
  t.after(() => quiet.close());
  assert.equal(
    quiet.$(".routine-scene-frame iframe").getAttribute("src"),
    "/scene/index.html?motion=off",
  );
  const economy = await client(database(), { "routine:reduce-glass": "true" });
  t.after(() => economy.close());
  assert.equal(economy.$(".routine-scene-frame"), null);
  assert.equal(economy.$(".workout-banner iframe"), null);
  assert.ok(economy.$(".workout-banner img"));
  assert.match(
    quiet.$(".workout-banner iframe").getAttribute("src"),
    /motion=off/,
  );
  assert.ok(economy.$(".routine-scene-static img"));
});
test("all visible scenes keep animating; offscreen and hidden scenes suspend", async (t) => {
  const c = await client(database());
  t.after(() => c.close());
  let observerCallback,
    disconnected = false;
  Object.defineProperty(c.w.document, "hidden", {
    configurable: true,
    value: false,
  });
  c.w.matchMedia = () => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  });
  c.w.IntersectionObserver = class {
    constructor(callback) {
      observerCallback = callback;
    }
    observe() {}
    disconnect() {
      disconnected = true;
    }
  };
  c.w.dashboard();
  const frames = [...c.w.document.querySelectorAll(".home-layout iframe")];
  assert.equal(frames.length, 2);
  const messages = new Map();
  frames.forEach(
    (frame) =>
      (frame.contentWindow.postMessage = (message, origin) => {
        assert.equal(origin, "http://routine.test");
        assert.equal(message.type, "routine:scene-visibility");
        messages.set(frame, message.active);
      }),
  );
  observerCallback(
    frames.map((target, index) => ({
      target,
      isIntersecting: true,
      intersectionRatio: index ? 0.2 : 0.9,
    })),
  );
  assert.equal(messages.get(frames[0]), true);
  assert.equal(messages.get(frames[1]), true);
  frames[0].dispatchEvent(new c.w.Event("pointerenter"));
  assert.equal(messages.get(frames[1]), true);
  observerCallback([
    { target: frames[0], isIntersecting: false, intersectionRatio: 0 },
    { target: frames[1], isIntersecting: true, intersectionRatio: 1 },
  ]);
  assert.equal(messages.get(frames[0]), false);
  assert.equal(messages.get(frames[1]), true);
  Object.defineProperty(c.w.document, "hidden", {
    configurable: true,
    value: true,
  });
  c.w.document.dispatchEvent(new c.w.Event("visibilitychange"));
  assert.equal(messages.get(frames[0]), false);
  assert.equal(messages.get(frames[1]), false);
  c.w.nav("diary");
  assert.equal(disconnected, true);
  assert.equal(frames[0].isConnected, false);
});

test("a late scene readiness request receives current activation without another scroll or load", async (t) => {
  const c = await client(database());
  t.after(() => c.close());
  Object.defineProperty(c.w.document, "hidden", {
    configurable: true,
    value: false,
  });
  const frame = c.$(".routine-scene-frame iframe");
  frame.getBoundingClientRect = () => ({
    left: 100,
    right: 400,
    top: 100,
    bottom: 300,
    width: 300,
    height: 200,
  });
  const received = [];
  frame.contentWindow.postMessage = (message) => received.push(message);
  c.w.dispatchEvent(
    new c.w.MessageEvent("message", {
      origin: "http://routine.test",
      source: frame.contentWindow,
      data: { type: "routine:scene-ready" },
    }),
  );
  assert.equal(received.at(-1).active, true);
  received.length = 0;
  c.w.dispatchEvent(
    new c.w.MessageEvent("message", {
      origin: "http://untrusted.test",
      source: frame.contentWindow,
      data: { type: "routine:scene-ready" },
    }),
  );
  assert.equal(received.length, 0);
  c.w.dispatchEvent(
    new c.w.MessageEvent("message", {
      origin: "http://routine.test",
      source: frame.contentWindow,
      data: {
        type: "routine:scene-state",
        paused: false,
        hostActive: true,
        running: true,
        failed: false,
        elapsed: 2.5,
      },
    }),
  );
  assert.equal(c.w.RoutineSceneStatuses[1].running, true);
});

test("a desktop GPU failure preserves the app and switches this session to posters", async (t) => {
  const c = await client(database());
  t.after(() => c.close());
  const before = JSON.stringify(c.w.qa.state);
  c.w.dispatchEvent(new c.w.Event("routine:graphics-safe-mode"));
  assert.equal(c.$(".home-layout iframe"), null);
  assert.ok(c.$(".workout-banner img"));
  assert.equal(JSON.stringify(c.w.qa.state), before);
  c.w.nav("diary");
  c.w.nav("dashboard");
  assert.equal(c.$(".home-layout iframe"), null);
  assert.ok(c.$(".routine-scene-static img"));
});

test("daily workout follows local weekdays, completion and date-scoped manual choices", async (t) => {
  const c = await client(database());
  t.after(() => c.close());
  const cycle = c.w.qa.cycle;
  const [a, b] = cycle.workouts;
  for (const [day, expected] of [
    ["2026-11-16", a],
    ["2026-11-17", b],
    ["2026-11-18", a],
    ["2026-11-19", b],
    ["2026-11-20", a],
  ]) {
    assert.equal(c.w.homeWorkoutPlan(cycle, day).selected.id, expected.id);
  }
  assert.equal(c.w.homeWorkoutPlan(cycle, "2026-11-21").scheduled.length, 0);
  assert.equal(c.w.homeWorkoutPlan(cycle, "2026-11-22").scheduled.length, 0);
  assert.deepEqual(
    Array.from(c.w.scheduledDays("segunda-feira, QUARTA e sexta-feira")),
    [1, 3, 5],
  );
  assert.deepEqual(
    Array.from(c.w.scheduledDays("terça / quinta / sábado / domingo")),
    [0, 2, 4, 6],
  );
  assert.deepEqual(Array.from(c.w.scheduledDays("Sem programação")), []);
  c.w.localStorage.setItem(
    "routine:home-choice-" + cycle.id,
    JSON.stringify({ date: "2026-11-16", id: b.id }),
  );
  assert.equal(c.w.homeWorkoutPlan(cycle, "2026-11-16").selected.id, b.id);
  assert.equal(c.w.homeWorkoutPlan(cycle, "2026-11-18").selected.id, a.id);
  c.w.localStorage.removeItem("routine:home-choice-" + cycle.id);
  b.schedule = "Seg";
  c.w.qa.state.history.push({
    cycleId: cycle.id,
    date: "2026-11-16",
    workout: { id: a.id },
  });
  let plan = c.w.homeWorkoutPlan(cycle, "2026-11-16");
  assert.equal(plan.scheduled.length, 2);
  assert.equal(plan.selected.id, b.id);
  c.w.qa.state.history.push({
    cycleId: cycle.id,
    date: "2026-11-16",
    workout: { id: b.id },
  });
  plan = c.w.homeWorkoutPlan(cycle, "2026-11-16");
  assert.ok(plan.completed.has(plan.selected.id));
  c.w.qa.state.history.length = 0;
  const todayIndex = new c.w.Date(c.w.qa.today + "T12:00:00").getDay();
  const names = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  a.schedule = names[todayIndex];
  b.schedule = "";
  c.w.dashboard();
  assert.match(
    c.$(".hero-content .eyebrow").textContent,
    /Hoje é dia de Treino A/,
  );
  c.w.qa.state.history.push({
    cycleId: cycle.id,
    date: c.w.qa.today,
    workout: { id: a.id },
  });
  c.w.dashboard();
  assert.match(c.$(".hero-content .eyebrow").textContent, /concluído/);
  c.w.chooseHomeWorkout(b.id);
  assert.equal(c.$("#homeWorkout").value, b.id);
  assert.equal(
    c.$(".workout-banner iframe").getAttribute("src"),
    "/scene/index.html?view=workout&palette=1",
  );
  a.schedule = "";
  c.w.dashboard();
  assert.match(c.$(".hero-content .eyebrow").textContent, /descanso/);
  cycle.workouts.length = 0;
  c.w.dashboard();
  assert.equal(c.$("#homeWorkout"), null);
  assert.match(c.$(".hero-content").textContent, /Criar meu treino/);
});

test("returning after a date change refreshes today's automatic workout", async (t) => {
  const c = await client(database());
  t.after(() => c.close());
  const RealDate = c.w.Date;
  let now = new RealDate(2026, 10, 16, 23, 58).getTime();
  c.w.Date = class extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [now]));
    }
    static now() {
      return now;
    }
  };
  c.w.dashboard();
  const [a, b] = c.w.qa.cycle.workouts;
  assert.equal(c.$("#homeWorkout").value, a.id);
  c.w.chooseHomeWorkout(a.id);
  now = new RealDate(2026, 10, 17, 0, 2).getTime();
  Object.defineProperty(c.w.document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  c.w.document.dispatchEvent(new c.w.Event("visibilitychange"));
  assert.equal(c.w.qa.today, "2026-11-17");
  assert.equal(c.$("#homeWorkout").value, b.id);
});

test("weekday picker persists the schedule and synchronizes it across devices", async (t) => {
  const db = database(),
    c = await client(db),
    other = await client(db);
  t.after(() => {
    c.close();
    other.close();
  });
  c.w.nav("workouts");
  c.w.editWorkout(c.w.qa.cycle.workouts[0].id);
  assert.ok(c.$('[data-workout-day="1"]').checked);
  for (const el of c.w.document.querySelectorAll("[data-workout-day]"))
    el.checked = false;
  c.$('[data-workout-day="2"]').checked = true;
  c.$('[data-workout-day="6"]').checked = true;
  c.w.updateWorkoutDays();
  assert.equal(c.$("#wschedule").value, "Ter / Sáb");
  assert.equal(
    JSON.parse(c.storage()["routine:editor"]).editing.schedule,
    "Ter / Sáb",
  );
  await c.w.saveWorkout({ preventDefault() {} });
  await db.notify();
  assert.equal(other.w.qa.cycle.workouts[0].schedule, "Ter / Sáb");
  c.w.editWorkout(c.w.qa.cycle.workouts[0].id);
  assert.ok(c.$('[data-workout-day="6"]').checked);
  c.input("#wschedule", "Domingo / quinta-feira");
  c.w.syncWorkoutDays();
  assert.ok(c.$('[data-workout-day="0"]').checked);
  assert.ok(c.$('[data-workout-day="4"]').checked);
  assert.equal(c.$('[data-workout-day="6"]').checked, false);
});

test("diary arrow navigation preserves drafts and returns to today", async (t) => {
  const c = await client(database());
  t.after(() => c.close());
  c.w.nav("diary");
  const day = c.$("#mealDate").value;
  const buttons = c.$(".diary-calendar > .diary-date-tools");
  assert.equal(buttons.children.length, 3);
  assert.equal(buttons.children[0].getAttribute("aria-label"), "Dia anterior");
  assert.ok(buttons.children[0].querySelector("svg"));
  assert.equal(buttons.children[1].textContent, "Hoje");
  c.input("#meal0", "Rascunho de hoje");
  c.w.shiftDiaryDay(-1);
  assert.notEqual(c.$("#mealDate").value, day);
  c.w.changeDiaryDate(day);
  assert.equal(c.$("#meal0").value, "Rascunho de hoje");
});

function database() {
  return {
    state: null,
    revision: 0,
    clients: [],
    fail: false,
    async notify() {
      await Promise.all(
        this.clients.map((c) => c.onmessage?.({ data: String(this.revision) })),
      );
    },
  };
}
async function client(db, storage = {}) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => errors.push(e.message));
  const dom = new JSDOM(html, {
    url: "http://routine.test",
    runScripts: "outside-only",
    virtualConsole: vc,
  });
  const w = dom.window;
  w.localStorage.setItem("routine:welcome-seen", "true");
  w.structuredClone = structuredClone;
  w.scrollTo = () => {};
  w.confirm = () => true;
  w.document.querySelector("dialog").showModal = function () {
    this.open = true;
  };
  w.document.querySelector("dialog").close = function () {
    this.open = false;
  };
  Object.assign(w.navigator, {
    vibrate: () => true,
    wakeLock: {
      request: async () => ({ released: false, release: async () => {} }),
    },
    clipboard: {
      writeText: async (text) => {
        w.copied = text;
      },
    },
  });
  for (const [k, v] of Object.entries(storage)) w.localStorage.setItem(k, v);
  w.fetch = async (url, opts) => {
    if (url === "/api/presence")
      return { ok: true, json: async () => ({ ok: true }) };
    if (db.offline) throw new TypeError("Failed to fetch");
    if (opts?.method === "POST") {
      if (db.fail)
        return {
          ok: false,
          status: 500,
          json: async () => ({ error: "Falha simulada" }),
        };
      const p = JSON.parse(opts.body);
      if (p.revision !== db.revision)
        return { ok: false, status: 409, json: async () => copy(db) };
      assert.ok(validateState(p.state), "Frontend must produce a valid state");
      db.state = p.state;
      db.revision++;
      if (db.dropNextReply) {
        db.dropNextReply = false;
        throw new TypeError("Connection lost after commit");
      }
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ state: copy(db.state), revision: db.revision }),
    };
  };
  w.EventSource = class {
    constructor() {
      db.clients.push(this);
    }
  };
  w.eval(
    fs.readFileSync("public/motion.js", "utf8") +
      "\n" +
      fs.readFileSync("public/interface.js", "utf8") +
      "\n" +
      fs.readFileSync("public/training.js", "utf8") +
      "\n" +
      fs.readFileSync("public/sync.js", "utf8") +
      "\n" +
      fs.readFileSync("public/backups.js", "utf8") +
      "\n" +
      fs.readFileSync("public/diary-tools.js", "utf8") +
      "\n" +
      fs.readFileSync("public/insights.js", "utf8") +
      "\n" +
      fs.readFileSync("public/mobile-access.js", "utf8") +
      "\n" +
      fs.readFileSync("public/experience.js", "utf8") +
      "\n" +
      code +
      `;window.qa={set busy(value){busy=value},get state(){return state},get session(){return session},get timer(){return timer},get page(){return page},get today(){return today},get cycle(){return cycle()},get editing(){return editing},get outbox(){return outbox},get syncConflict(){return syncConflict},defaults,ex,diaryMarkdown,readEditor};`,
  );
  await settle();
  return {
    w,
    db,
    errors,
    $: (s) => w.document.querySelector(s),
    input(s, value) {
      const el = w.document.querySelector(s);
      if (el.type === "checkbox") el.checked = value;
      else el.value = value;
      el.dispatchEvent(new w.Event("input", { bubbles: true }));
    },
    storage() {
      return Object.fromEntries(
        Array.from({ length: w.localStorage.length }, (_, i) => {
          const k = w.localStorage.key(i);
          return [k, w.localStorage.getItem(k)];
        }),
      );
    },
    close() {
      w.close();
    },
  };
}

test("initial plan, diary partial save/reopen, copy unsaved text and completed-day editing", async (t) => {
  const db = database();
  const c = await client(db);
  t.after(() => c.close());
  assert.equal(c.w.qa.cycle.workouts.length, 2);
  assert.equal(c.w.qa.cycle.workouts[0].exercises.length, 7);
  c.w.nav("diary");
  c.input("#meal0", "Torrada & café <sem açúcar>");
  c.input("[data-goal]", true);
  await c.w.saveDiary("draft");
  assert.equal(db.state.diary[c.w.qa.today].status, "draft");
  const d = await client(db);
  t.after(() => d.close());
  d.w.nav("diary");
  assert.equal(d.$("#meal0").value, "Torrada & café <sem açúcar>");
  assert.equal(d.$("#meal3").value, "");
  d.input("#meal1", "Arroz e feijão");
  await d.w.copyDiaryForGemini();
  assert.match(d.w.copied, /Arroz e feijão/);
  assert.equal(db.state.diary[d.w.qa.today].meals.Almoço, "");
  await d.w.saveDiary("complete");
  assert.equal(db.state.diary[d.w.qa.today].status, "complete");
  d.input("#meal3", "Sopa");
  await d.w.saveDiary("draft");
  assert.equal(db.state.diary[d.w.qa.today].meals.Janta, "Sopa");
  assert.equal(d.errors.length, 0);
});

test("local diary recovery survives navigation, date changes, restart and custom goals", async (t) => {
  const db = database(),
    c = await client(db);
  t.after(() => c.close());
  c.w.nav("diary");
  c.input("#meal0", "Banana");
  c.w.nav("dashboard");
  c.w.nav("diary");
  assert.equal(c.$("#meal0").value, "Banana");
  c.w.changeDiaryDate("2026-01-01");
  c.input("#meal1", "Massa");
  c.w.changeDiaryDate(c.w.qa.today);
  assert.equal(c.$("#meal0").value, "Banana");
  c.w.goalDialog();
  c.$("#goalNames").value += "\nComi frutas";
  await c.w.saveGoals();
  assert.equal(c.$("#meal0").value, "Banana");
  const d = await client(db, c.storage());
  t.after(() => d.close());
  d.w.nav("diary");
  assert.equal(d.$("#meal0").value, "Banana");
  d.w.changeDiaryDate("2026-01-01");
  assert.equal(d.$("#meal1").value, "Massa");
});

test("two devices sync clean diaries; dirty diaries require a conflict decision", async (t) => {
  const db = database(),
    a = await client(db),
    b = await client(db);
  t.after(() => {
    a.close();
    b.close();
  });
  a.w.nav("diary");
  b.w.nav("diary");
  a.input("#meal0", "PC");
  await a.w.saveDiary("draft");
  await db.notify();
  assert.equal(b.$("#meal0").value, "PC");
  b.input("#meal1", "Texto do celular");
  a.input("#meal1", "Texto do PC");
  await a.w.saveDiary("draft");
  await db.notify();
  assert.equal(b.$("#meal1").value, "Texto do celular");
  await b.w.saveDiary("draft");
  assert.equal(b.$("dialog").open, true);
  assert.equal(db.state.diary[b.w.qa.today].meals.Almoço, "Texto do PC");
  b.w.useRemoteDiary();
  assert.equal(b.$("#meal1").value, "Texto do PC");
});

test("workout CRUD, local editor recovery and validation", async (t) => {
  const db = database(),
    c = await client(db);
  t.after(() => c.close());
  c.w.nav("workouts");
  c.w.editWorkout();
  c.input("#wname", "Treino C");
  c.w.addExercise();
  c.input("[name=name]", "Isometria");
  c.input("[name=type]", "time");
  c.input("[name=target]", "12");
  const d = await client(db, c.storage());
  t.after(() => d.close());
  d.w.nav("workouts");
  d.w.resumeEditor();
  assert.equal(d.$("#wname").value, "Treino C");
  assert.equal(d.$("[name=name]").value, "Isometria");
  await d.w.saveWorkout({ preventDefault() {} });
  assert.equal(db.state.cycles[0].workouts.length, 3);
  const wid = db.state.cycles[0].workouts[2].id;
  d.w.editWorkout(wid);
  d.input("[name=target]", "abc");
  await d.w.saveWorkout({ preventDefault() {} });
  assert.equal(db.state.cycles[0].workouts[2].exercises[0].target, "12");
  const cancel = d.w.cancelEditor();
  d.$("#decisionConfirm").click();
  await cancel;
  const remove = d.w.deleteWorkout(wid);
  d.$("#decisionConfirm").click();
  await remove;
  assert.equal(db.state.cycles[0].workouts.length, 2);
});

test("cycle copy stays independent and optional profile records save", async (t) => {
  const db = database(),
    c = await client(db);
  t.after(() => c.close());
  c.w.cycleDialog();
  await c.w.newCycle();
  assert.equal(db.state.cycles.length, 2);
  c.$("#cycleName").value = "Progressão";
  c.$("#cycleGoal").value = "24";
  await c.w.updateCycle();
  assert.equal(db.state.cycles[0].goal, 20);
  assert.equal(db.state.cycles[1].goal, 24);
  c.w.profileDialog();
  c.$("#weight").value = "68.5";
  c.$("#profileNotes").value = "Roupas mais soltas";
  await c.w.saveProfile();
  assert.equal(db.state.profile.weights.at(-1).weight, 68.5);
});

test("timed sets, adjusted/skipped rests, full workout, session recovery, history and report", async (t) => {
  const db = database(),
    c = await client(db);
  t.after(() => c.close());
  c.w.startTraining(c.w.qa.cycle.workouts[0].id, { circuitRest: "exercise" });
  assert.deepEqual(
    Array.from(c.w.qa.session.steps.slice(0, 4), (s) => s.e.name),
    [
      "Polichinelo",
      "Corrida Estacionária",
      "Polichinelo",
      "Corrida Estacionária",
    ],
  );
  c.w.startTimer(30, "exercise");
  c.w.qa.timer.end = Date.now() - 1;
  c.w.tick();
  assert.equal(c.$("dialog").open, false);
  assert.equal(c.$("#actual").value, "30");
  c.w.completeSet();
  assert.equal(c.w.qa.timer.kind, "rest");
  const end = c.w.qa.timer.end;
  c.w.adjustTimer(15);
  assert.ok(c.w.qa.timer.end >= end + 14990);
  c.w.adjustTimer(-15);
  c.w.endTimer(false);
  const recovered = await client(db, c.storage());
  t.after(() => recovered.close());
  assert.equal(recovered.w.qa.page, "session");
  assert.equal(recovered.w.qa.session.step, 1);
  while (recovered.w.qa.session.step < recovered.w.qa.session.steps.length) {
    recovered.w.completeSet();
    if (recovered.w.qa.timer) recovered.w.endTimer(false);
  }
  recovered.$("#sessionNotes").value = "Mais força, cansaço moderado";
  await recovered.w.finishTraining();
  assert.equal(db.state.history.length, 1);
  assert.equal(db.state.history[0].results.length, 14);
  assert.equal(recovered.w.qa.session, null);
  recovered.w.nav("history");
  assert.match(recovered.$("#app").textContent, /Mais força/);
  recovered.w.nav("report");
  assert.match(
    recovered.$("#reportText").value,
    /série 1, realizado 30 s vs meta 30/,
  );
  assert.match(recovered.$("#reportText").value, /Mais força/);
  await recovered.w.copyReport();
  assert.equal(recovered.w.copied, recovered.$("#reportText").value);
});

test("network failures preserve diary fields and allow retry; clipboard fallback selects text", async (t) => {
  const db = database(),
    c = await client(db);
  t.after(() => c.close());
  c.w.nav("diary");
  c.input("#meal0", "Iogurte");
  db.fail = true;
  await c.w.saveDiary("draft");
  assert.equal(c.$("#meal0").value, "Iogurte");
  assert.equal(c.$("[data-status=draft]").disabled, false);
  db.fail = false;
  await c.w.saveDiary("draft");
  assert.equal(db.state.diary[c.w.qa.today].meals["Café da Manhã"], "Iogurte");
  c.w.navigator.clipboard.writeText = async () => {
    throw Error("Unavailable");
  };
  await c.w.copyDiaryForGemini();
  assert.equal(c.$("dialog").open, true);
  assert.match(c.$("#diaryCopyText").value, /Iogurte/);
  assert.equal(c.$("#diaryCopyText").selectionStart, 0);
});

test("report periods include calendar month and exactly seven dates", async (t) => {
  const db = database(),
    c = await client(db);
  t.after(() => c.close());
  c.w.nav("report");
  c.$("#reportDate").value = "2026-01-03";
  c.$("#range").value = "week";
  c.w.changeReportRange(c.$("#range").value);
  assert.match(c.$("#reportText").value, /2025-12-28 a 2026-01-03/);
  c.$("#range").value = "month";
  c.w.changeReportRange(c.$("#range").value);
  assert.match(c.$("#reportText").value, /2026-01-01 a 2026-01-31/);
});

test("synced local drafts become clean and report filters survive live updates", async (t) => {
  const db = database(),
    c = await client(db);
  t.after(() => c.close());
  c.w.nav("diary");
  c.input("#meal0", "Fruta");
  const stale = c.storage();
  await c.w.saveDiary("draft");
  const d = await client(db, stale);
  t.after(() => d.close());
  d.w.nav("diary");
  assert.match(d.$("#diarySaveStatus").textContent, /Rascunho salvo/);
  assert.equal(d.w.localStorage.getItem("routine:diary:" + d.w.qa.today), null);
  d.w.nav("report");
  d.$("#reportDate").value = "2026-01-03";
  d.w.changeReportDate("2026-01-03");
  d.w.changeReportRange("month");
  db.revision++;
  await db.notify();
  assert.equal(d.$("#reportDate").value, "2026-01-03");
  assert.match(d.$("#reportText").value, /2026-01-01 a 2026-01-31/);
});

test("simultaneous workout edits never silently overwrite the other device", async (t) => {
  const db = database(),
    a = await client(db),
    b = await client(db);
  t.after(() => {
    a.close();
    b.close();
  });
  const wid = a.w.qa.cycle.workouts[0].id;
  a.w.nav("workouts");
  a.w.editWorkout(wid);
  a.input("#wname", "Minha edição");
  b.w.nav("workouts");
  b.w.editWorkout(wid);
  b.input("#wname", "Edição da rede");
  await b.w.saveWorkout({ preventDefault() {} });
  await db.notify();
  await a.w.saveWorkout({ preventDefault() {} });
  assert.equal(db.state.cycles[0].workouts[0].name, "Edição da rede");
  assert.equal(a.$("#wname").value, "Minha edição");
  assert.ok(a.w.localStorage.getItem("routine:editor"));
});

test("sound test requests ambient mixing, respects volume and never pauses other media", async (t) => {
  const c = await client(database());
  t.after(() => c.close());
  const events = [];
  let mediaAccess = 0;
  Object.defineProperty(c.w.navigator, "audioSession", {
    value: { type: "auto" },
    configurable: true,
  });
  Object.defineProperty(c.w.navigator, "mediaSession", {
    get() {
      mediaAccess++;
      throw Error("Must not control the music session");
    },
    configurable: true,
  });
  c.w.AudioContext = class {
    constructor() {
      this.currentTime = 100;
      this.state = "running";
      this.destination = {};
    }
    async resume() {
      this.state = "running";
    }
    createOscillator() {
      const node = {
        frequency: { value: 0 },
        connect() {},
        start() {
          events.push(["frequency", node.frequency.value]);
        },
        stop(time) {
          events.push(["stop", time]);
        },
      };
      return node;
    }
    createGain() {
      return {
        gain: {
          setValueAtTime(value) {
            events.push(["gain", value]);
          },
          exponentialRampToValueAtTime(value) {
            events.push(["ramp", value]);
          },
        },
        connect() {},
      };
    }
  };
  c.w.nav("workouts");
  assert.ok(c.$("#alertVolume"));
  c.w.setAlertVolume(0.35);
  await c.w.testSound();
  assert.equal(c.w.navigator.audioSession.type, "ambient");
  assert.ok(events.some((e) => e[0] === "ramp" && e[1] === 0.35));
  assert.ok(events.some((e) => e[0] === "frequency" && e[1] === 1500));
  assert.equal(mediaAccess, 0);
  c.w.startTraining(c.w.qa.cycle.workouts[0].id);
  c.w.startTimer(30, "exercise");
  c.w.qa.timer.end = Date.now() - 1000;
  c.w.tick();
  assert.equal(c.w.qa.timer, null);
  assert.equal(c.$("#actual").value, "30");
  assert.equal(mediaAccess, 0);
  const d = await client(c.db, c.storage());
  t.after(() => d.close());
  assert.equal(d.$("#alertVolume").value, "0.35");
});

test("circuit order explicitly alternates movements and rests at the end of each round", async (t) => {
  const c = await client(database());
  t.after(() => c.close());
  const w = c.w.qa.cycle.workouts[0];
  const steps = c.w.buildWorkoutSteps(w, { circuitRest: "round" });
  assert.deepEqual(
    Array.from(steps.slice(0, 4), (s) => [
      s.e.name,
      s.round,
      s.position,
      s.restAfter,
    ]),
    [
      ["Polichinelo", 1, 1, 0],
      ["Corrida Estacionária", 1, 2, 60],
      ["Polichinelo", 2, 1, 0],
      ["Corrida Estacionária", 2, 2, 60],
    ],
  );
  assert.equal(steps[4].e.name, "Flexão de Braço");
  assert.equal(steps[4].restAfter, 75);
  assert.equal(steps[10].e.name, "Prancha");
  assert.equal(steps[11].e.name, "Escalador");
  assert.equal(steps[10].restAfter, 0);
  assert.equal(steps[11].restAfter, 60);
  c.w.startTraining(w.id);
  assert.match(
    c.$(".player-subtitle").textContent,
    /Volta 1 de 2 · exercício 1 de 2/,
  );
  assert.match(c.$(".next-exercise").textContent, /Corrida Estacionária/);
  c.w.qa.session.step = 4;
  c.w.training();
  assert.match(
    c.$("label[for=actual]").textContent,
    /Quantas repetições você fez/,
  );
  assert.doesNotMatch(
    c.$("label[for=actual]").textContent,
    /perna|agachamento/i,
  );
});

test("automatic timers stop for every repetition set and permit post-workout correction", async (t) => {
  const db = database(),
    c = await client(db);
  t.after(() => c.close());
  c.w.configureTraining(c.w.qa.cycle.workouts[0].id);
  c.$("#trainingMode").value = "auto";
  c.$("#transitionSeconds").value = "1";
  assert.equal(c.$("#repSeconds"), null);
  assert.match(c.$("#trainingSetup").textContent, /só exercícios por tempo/);
  c.$("#trainingSetup").onsubmit({ preventDefault() {} });
  assert.equal(c.w.qa.timer.kind, "prepare");
  assert.match(c.$(".next-exercise").textContent, /Polichinelo/);
  let guard = 0,
    manualSets = 0,
    timedSets = 0;
  while (c.w.qa.session.step < c.w.qa.session.steps.length) {
    if (++guard > 70) throw Error("Mixed workout did not terminate");
    if (c.w.qa.timer) {
      if (c.w.qa.timer.kind === "exercise") {
        assert.equal(c.w.qa.session.steps[c.w.qa.session.step].e.type, "time");
        timedSets++;
      }
      c.w.qa.timer.end = Date.now() - 10;
      c.w.tick();
    } else {
      const step = c.w.qa.session.steps[c.w.qa.session.step];
      assert.equal(step.e.type, "reps");
      assert.equal(c.$("#countdown"), null);
      assert.equal(c.$("#actual").value, String(c.w.defaultActual(step.e)));
      assert.match(c.$(".phase-label").textContent, /No seu ritmo/);
      const count = c.w.qa.session.results.length;
      c.w.tick();
      c.w.beginAutomaticStep();
      c.w.startTimer(45, "exercise");
      assert.equal(c.w.qa.timer, null);
      assert.equal(c.w.qa.session.results.length, count);
      c.input("#actual", String(5 + manualSets++));
      c.w.completeSet();
      if (step.restAfter > 0) assert.equal(c.w.qa.timer.kind, "rest");
    }
  }
  assert.equal(manualSets, 6);
  assert.equal(timedSets, 8);
  assert.equal(c.w.qa.session.results.length, 14);
  assert.equal(c.w.qa.session.results.filter((r) => r.estimated).length, 0);
  assert.equal(db.state.history.length, 0);
  assert.ok(c.$("#sessionNotes"));
  const finishedAt = c.w.qa.session.completed;
  c.w.qa.session.started = finishedAt - 60000;
  c.w.qa.session.completed = finishedAt - 30000;
  await c.w.finishTraining();
  assert.equal(
    db.state.history[0].duration,
    30,
    "Review time must not inflate workout duration",
  );
  assert.equal(db.state.history.length, 1);
  const hid = db.state.history[0].id;
  c.w.nav("report");
  assert.doesNotMatch(c.$("#reportText").value, /ESTIMATIVA/);
  c.w.nav("history");
  c.w.editHistoryResults(hid);
  c.$("#result-4").value = "7";
  c.$("#resultNotes").value = "Flexões corrigidas após o treino";
  await c.w.saveResultEdits({ preventDefault() {} });
  assert.equal(db.state.history[0].results[4].actual, 7);
  assert.equal(
    db.state.history[0].results.some((r) => r.estimated),
    false,
  );
  assert.equal(db.state.cycles[0].workouts[0].exercises[2].target, "10-12");
  c.w.nav("report");
  assert.match(c.$("#reportText").value, /realizado 7 reps vs meta 10-12/);
  assert.match(c.$("#reportText").value, /Flexões corrigidas/);
  assert.doesNotMatch(c.$("#reportText").value, /ESTIMATIVA/);
});

test("automatic player supports pause, recovery in pause and corrections during the session", async (t) => {
  const db = database(),
    c = await client(db);
  t.after(() => c.close());
  c.w.startTraining(c.w.qa.cycle.workouts[0].id, {
    mode: "auto",
    transition: 0,
    circuitRest: "round",
  });
  c.w.qa.timer.end = Date.now() - 1;
  c.w.tick();
  assert.equal(c.w.qa.timer.kind, "exercise");
  c.w.toggleTimer();
  assert.equal(c.w.qa.timer.paused, true);
  const step = c.w.qa.session.step;
  c.w.qa.timer.end = Date.now() - 10000;
  c.w.tick();
  assert.equal(c.w.qa.session.step, step);
  const d = await client(db, c.storage());
  t.after(() => d.close());
  assert.equal(d.w.qa.timer.paused, true);
  d.w.toggleTimer();
  assert.equal(d.w.qa.timer.paused, false);
  d.w.qa.timer.end = Date.now() - 1;
  d.w.tick();
  assert.equal(d.w.qa.session.step, 1);
  d.w.editSessionResults();
  d.$("#result-0").value = "26";
  d.$("#resultNotes").value = "Ajuste durante o treino";
  await d.w.saveResultEdits({ preventDefault() {} });
  assert.equal(d.w.qa.session.results[0].actual, 26);
  assert.ok(d.w.qa.timer);
  d.w.cancelTraining();
  d.$("#discardSession").click();
  assert.equal(d.w.qa.session, null);
  assert.equal(d.w.qa.timer, null);
  assert.equal(d.w.localStorage.getItem("routine:session"), null);
});

test("a skipped timed exercise uses elapsed seconds; historical edits detect a concurrent change", async (t) => {
  const db = database(),
    c = await client(db);
  t.after(() => c.close());
  c.w.startTraining(c.w.qa.cycle.workouts[0].id);
  c.w.startTimer(30, "exercise");
  c.w.qa.timer.end = Date.now() + 20000;
  c.w.endTimer(false);
  assert.equal(c.$("#actual").value, "10");
  c.w.completeSet();
  assert.equal(c.w.qa.session.results[0].actual, 10);
  while (c.w.qa.session.step < c.w.qa.session.steps.length) {
    c.w.completeSet();
    if (c.w.qa.timer) c.w.endTimer(false);
  }
  await c.w.finishTraining();
  const d = await client(db);
  t.after(() => d.close());
  const hid = db.state.history[0].id;
  c.w.nav("history");
  c.w.editHistoryResults(hid);
  d.w.nav("history");
  d.w.editHistoryResults(hid);
  d.$("#result-0").value = "29";
  await d.w.saveResultEdits({ preventDefault() {} });
  await db.notify();
  c.$("#result-0").value = "12";
  await c.w.saveResultEdits({ preventDefault() {} });
  assert.equal(db.state.history[0].results[0].actual, 29);
  assert.equal(c.$("dialog").open, true);
});

test("repetition-first workout waits indefinitely, then rest and timed movements advance automatically", async (t) => {
  const db = database(),
    c = await client(db);
  t.after(() => c.close());
  const w = c.w.qa.cycle.workouts[0];
  w.exercises = [
    c.w.qa.ex("Flexões", "Força", "reps", "15", 2, 10),
    c.w.qa.ex("Corrida", "Finalizador", "time", "25", 1, 0),
  ];
  w.exercises[0].autoSeconds = 1; // Legacy fields must never time repetitions.
  c.w.localStorage.setItem(
    "routine:training-settings",
    JSON.stringify({ mode: "auto", repSeconds: 1, transition: 0 }),
  );
  assert.equal(c.w.trainingSettings().repSeconds, undefined);
  c.w.startTraining(w.id, { mode: "auto", transition: 0, repSeconds: 1 });
  assert.ok(c.$("#actual"));
  assert.equal(c.w.qa.session.config.repSeconds, undefined);
  assert.equal(c.w.qa.timer, undefined);
  const realNow = c.w.Date.now;
  c.w.Date.now = () => realNow() + 15 * 60000;
  c.w.tick();
  assert.equal(c.w.qa.session.step, 0);
  assert.equal(c.w.qa.session.results.length, 0);
  c.w.Date.now = realNow;
  c.input("#actual", "12");
  const reopened = await client(db, c.storage());
  t.after(() => reopened.close());
  assert.equal(reopened.$("#actual").value, "12");
  assert.equal(reopened.w.qa.timer, undefined);
  reopened.$("#actual").value = "";
  reopened.w.completeSet();
  assert.equal(reopened.w.qa.session.step, 0);
  reopened.$("#actual").value = "12";
  reopened.w.completeSet();
  assert.equal(reopened.w.qa.timer.kind, "rest");
  assert.equal(reopened.w.qa.session.results[0].actual, 12);
  reopened.w.qa.timer.end = Date.now() - 1;
  reopened.w.tick();
  assert.equal(reopened.w.qa.timer, null);
  assert.match(reopened.$(".player-subtitle").textContent, /Série 2/);
  reopened.input("#actual", "9");
  reopened.w.completeSet();
  assert.equal(reopened.w.qa.timer.kind, "rest");
  reopened.w.endTimer(false);
  assert.equal(reopened.w.qa.timer.kind, "exercise");
  assert.equal(reopened.w.qa.timer.total, 25000);
  reopened.w.qa.timer.end = Date.now() - 1;
  reopened.w.tick();
  assert.equal(reopened.w.qa.session.results.length, 3);
  assert.deepEqual(
    Array.from(reopened.w.qa.session.results, (r) => r.actual),
    [12, 9, 25],
  );
  assert.ok(reopened.$("#sessionNotes"));
});

test("legacy repetition timers restore as manual sets while prior estimates remain reviewable", async (t) => {
  const db = database(),
    c = await client(db);
  t.after(() => c.close());
  c.w.startTraining(c.w.qa.cycle.workouts[0].id, { mode: "auto" });
  const storage = c.storage();
  const saved = JSON.parse(storage["routine:session"]);
  saved.session.step = 4;
  saved.session.config.repSeconds = 1;
  saved.session.results = [
    { ...saved.session.steps[0].e, series: 1, actual: 30, estimated: true },
  ];
  saved.timer = {
    kind: "exercise",
    end: Date.now() - 1000,
    total: 1000,
    paused: false,
  };
  storage["routine:session"] = JSON.stringify(saved);
  const d = await client(db, storage);
  t.after(() => d.close());
  assert.equal(d.w.qa.timer, null);
  assert.equal(d.w.qa.session.step, 4);
  assert.equal(d.w.qa.session.config.repSeconds, undefined);
  assert.equal(d.w.qa.session.results[0].estimated, true);
  assert.ok(d.$("#actual"));
  d.w.tick();
  assert.equal(d.w.qa.session.results.length, 1);
  const editor = await client(db);
  t.after(() => editor.close());
  editor.w.editWorkout(editor.w.qa.cycle.workouts[0].id);
  assert.equal(editor.$("[name=autoSeconds]"), null);
});

test("a saved rest before repetitions is recovered paused and still requires manual confirmation", async (t) => {
  const db = database(),
    c = await client(db);
  t.after(() => c.close());
  const w = c.w.qa.cycle.workouts[0];
  c.w.startTraining(w.id, { mode: "auto" });
  const storage = c.storage(),
    saved = JSON.parse(storage["routine:session"]);
  saved.session.step = 4;
  saved.timer = {
    kind: "rest",
    end: Date.now() + 75000,
    total: 75000,
    paused: false,
  };
  storage["routine:session"] = JSON.stringify(saved);
  const d = await client(db, storage);
  t.after(() => d.close());
  assert.equal(d.w.qa.timer.kind, "rest");
  assert.equal(d.w.qa.timer.paused, true);
  d.w.toggleTimer();
  d.w.qa.timer.end = Date.now() - 1;
  d.w.tick();
  assert.equal(d.w.qa.timer, null);
  assert.equal(d.w.qa.session.step, 4);
  assert.ok(d.$("#actual"));
  assert.equal(d.$("#countdown"), null);
  d.input("#actual", "8");
  d.w.completeSet();
  assert.equal(d.w.qa.session.results[0].actual, 8);
  assert.equal(d.w.qa.timer.kind, "rest");
});

test("undo restores the last result from rest or summary and stale taps cannot complete another set", async (t) => {
  const db = database(),
    c = await client(db);
  t.after(() => c.close());
  const w = c.w.qa.cycle.workouts[0];
  w.exercises = [c.w.qa.ex("Flexão", "Força", "reps", "15", 2, 10)];
  c.w.startTraining(w.id, { mode: "auto" });
  const sid = c.w.qa.session.id;
  c.input("#actual", "11");
  c.w.completeSet(sid, 0);
  c.w.completeSet(sid, 0);
  assert.equal(c.w.qa.session.results.length, 1);
  assert.equal(c.w.qa.timer.kind, "rest");
  c.w.undoLastSet(sid, 1);
  c.w.undoLastSet(sid, 1);
  assert.equal(c.w.qa.session.step, 0);
  assert.equal(c.w.qa.session.results.length, 0);
  assert.equal(c.w.qa.timer, null);
  assert.equal(c.$("#actual").value, "11");
  const d = await client(db, c.storage());
  t.after(() => d.close());
  assert.equal(d.$("#actual").value, "11");
  d.w.completeSet();
  d.w.endTimer(false);
  d.input("#actual", "8");
  d.w.completeSet();
  assert.ok(d.$("#sessionNotes"));
  d.input("#sessionNotes", "Nota preservada");
  d.w.undoLastSet();
  assert.equal(d.w.qa.session.completed, undefined);
  assert.equal(d.w.qa.session.notes, "Nota preservada");
  assert.equal(d.$("#actual").value, "8");
  d.w.completeSet();
  await d.w.finishTraining();
  assert.equal(db.state.history.length, 1);
  assert.deepEqual(
    Array.from(db.state.history[0].results, (r) => r.actual),
    [11, 8],
  );
});

test("timed undo waits for an explicit action and transitions identify rounds, blocks and completion", async (t) => {
  const db = database(),
    c = await client(db);
  t.after(() => c.close());
  c.w.startTraining(c.w.qa.cycle.workouts[0].id, {
    mode: "auto",
    transition: 0,
  });
  assert.match(c.$(".transition-notice").textContent, /Início do treino/);
  c.w.endTimer(false);
  c.w.qa.timer.end = Date.now() - 1;
  c.w.tick();
  c.w.undoLastSet();
  assert.equal(c.w.qa.timer, null);
  assert.equal(c.$("#actual").value, "30");
  assert.ok(c.$("button[onclick*=completeSet]"));
  c.w.startTimer(30, "exercise");
  c.w.qa.timer.end = Date.now() - 1;
  c.w.tick();
  c.w.qa.timer.end = Date.now() - 1;
  c.w.tick();
  assert.match(c.$(".transition-notice").textContent, /Volta 1 concluída/);
  c.w.endTimer(false);
  c.w.qa.timer.end = Date.now() - 1;
  c.w.tick();
  c.w.qa.timer.end = Date.now() - 1;
  c.w.tick();
  assert.match(
    c.$(".transition-notice").textContent,
    /Aquecimento concluído.*Força/,
  );
});

test("automatic timers do not start an unseen exercise while the page is hidden", async (t) => {
  const db = database(),
    c = await client(db);
  t.after(() => c.close());
  c.w.startTraining(c.w.qa.cycle.workouts[0].id, {
    mode: "auto",
    transition: 0,
  });
  c.w.endTimer(false);
  Object.defineProperty(c.w.document, "visibilityState", {
    configurable: true,
    value: "hidden",
  });
  c.w.qa.timer.end = Date.now() - 1;
  c.w.tick();
  assert.equal(c.w.qa.session.results.length, 1);
  assert.equal(c.w.qa.timer.paused, true);
  assert.equal(c.w.qa.timer.remaining, 25000);
  c.w.tick();
  assert.equal(c.w.qa.session.results.length, 1);
  Object.defineProperty(c.w.document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  c.w.toggleTimer();
  assert.equal(c.w.qa.timer.paused, false);
});

test("offline saves survive reopening, merge unrelated remote changes and clear only after acknowledgment", async (t) => {
  const db = database(),
    c = await client(db);
  t.after(() => c.close());
  db.offline = true;
  c.w.nav("diary");
  c.input("#meal0", "Meu café offline");
  await c.w.saveDiary("draft");
  assert.ok(c.w.qa.outbox);
  assert.match(c.$("#syncStatus").textContent, /Salvo neste aparelho/);
  const d = await client(db, c.storage());
  t.after(() => d.close());
  assert.ok(d.w.qa.outbox);
  assert.equal(
    d.w.qa.state.diary[d.w.qa.today].meals["Café da Manhã"],
    "Meu café offline",
  );
  db.offline = false;
  const other = await client(db);
  t.after(() => other.close());
  other.w.profileDialog();
  other.$("#weight").value = "70";
  await other.w.saveProfile();
  await d.w.retryPending();
  assert.equal(d.w.qa.outbox, null);
  assert.equal(db.state.profile.weight, 70);
  assert.equal(
    db.state.diary[d.w.qa.today].meals["Café da Manhã"],
    "Meu café offline",
  );
  assert.equal(d.w.localStorage.getItem("routine:outbox"), null);
});

test("offline conflicts require a choice and unrelated records survive either decision", async (t) => {
  for (const choice of ["remote", "local"]) {
    const db = database(),
      c = await client(db);
    t.after(() => c.close());
    db.offline = true;
    c.w.nav("diary");
    c.input("#meal0", "Meu café");
    await c.w.saveDiary("draft");
    db.offline = false;
    const other = await client(db);
    t.after(() => other.close());
    other.w.nav("diary");
    other.input("#meal0", "Café do PC");
    await other.w.saveDiary("draft");
    await c.w.retryPending();
    assert.ok(c.w.qa.syncConflict);
    assert.equal(
      db.state.diary[c.w.qa.today].meals["Café da Manhã"],
      "Café do PC",
    );
    c.w.showPendingConflict();
    assert.match(c.$("dialog").textContent, /Meu café/);
    assert.match(c.$("dialog").textContent, /Café do PC/);
    await c.w.resolvePending(choice);
    assert.equal(c.w.qa.outbox, null);
    assert.equal(
      db.state.diary[c.w.qa.today].meals["Café da Manhã"],
      choice === "local" ? "Meu café" : "Café do PC",
    );
  }
});

test("lost save responses never duplicate a completed workout after replay or reload", async (t) => {
  const db = database(),
    c = await client(db);
  t.after(() => c.close());
  c.w.startTraining(c.w.qa.cycle.workouts[0].id);
  while (c.w.qa.session.step < c.w.qa.session.steps.length) {
    c.w.completeSet();
    if (c.w.qa.timer) c.w.endTimer(false);
  }
  const sid = c.w.qa.session.id;
  db.dropNextReply = true;
  await c.w.finishTraining();
  assert.equal(db.state.history.length, 1);
  assert.equal(c.w.qa.session, null);
  assert.ok(c.w.qa.outbox);
  const d = await client(db, c.storage());
  t.after(() => d.close());
  await d.w.retryPending();
  assert.equal(db.state.history.filter((h) => h.id === sid).length, 1);
  assert.equal(d.w.qa.outbox, null);
  assert.equal(d.w.qa.session, null);
});

test("local storage failure refuses an offline success and leaves the form available", async (t) => {
  const db = database(),
    c = await client(db);
  t.after(() => c.close());
  c.w.nav("diary");
  c.input("#meal0", "Ainda aqui");
  db.offline = true;
  c.w.localStorage.constructor.prototype.setItem = function () {
    throw Error("Quota");
  };
  await c.w.saveDiary("draft");
  assert.equal(c.$("#meal0").value, "Ainda aqui");
  assert.equal(c.w.qa.outbox, null);
  assert.equal(c.$("button[data-status=draft]").disabled, false);
});

test("complete A and B survive offline interruption and undo without duplicated series", async (t) => {
  for (const index of [0, 1]) {
    const db = database();
    let c = await client(db);
    t.after(() => c.close());
    c.w.startTraining(c.w.qa.cycle.workouts[index].id, {
      mode: "auto",
      transition: 0,
    });
    let guard = 0,
      interrupted = false,
      undone = false;
    while (c.w.qa.session.step < c.w.qa.session.steps.length) {
      if (++guard > 100) throw Error("Workout did not finish");
      if (!interrupted && c.w.qa.session.step >= 4) {
        if (!c.w.qa.timer) c.input("#actual", "9");
        db.offline = true;
        const d = await client(db, c.storage());
        t.after(() => d.close());
        c.close();
        c = d;
        interrupted = true;
        db.offline = false;
      }
      if (!undone && c.w.qa.session.step === 5) {
        c.w.undoLastSet();
        undone = true;
        assert.equal(c.w.qa.session.step, 4);
      }
      if (c.w.qa.timer) {
        if (c.w.qa.timer.paused) c.w.toggleTimer();
        c.w.qa.timer.end = Date.now() - 1;
        c.w.tick();
      } else {
        if (c.$("#actual")) c.w.completeSet();
        else c.w.beginAutomaticStep();
      }
    }
    const keys = c.w.qa.session.results.map((r) => `${r.id}/${r.series}`);
    assert.equal(new Set(keys).size, 14);
    assert.equal(keys.length, 14);
    assert.ok(interrupted && undone);
    await c.w.finishTraining();
    assert.equal(db.state.history.length, 1);
    assert.equal(db.state.history[0].results.length, 14);
  }
});

test("stale timer taps cannot skip the next automatic exercise", async (t) => {
  const db = database(),
    c = await client(db);
  t.after(() => c.close());
  c.w.startTraining(c.w.qa.cycle.workouts[0].id, {
    mode: "auto",
    transition: 0,
  });
  c.w.endTimer(false);
  const firstTimer = c.w.qa.timer.id;
  c.w.endTimer(false, firstTimer);
  c.w.endTimer(false, firstTimer);
  assert.equal(c.w.qa.session.results.length, 1);
  assert.equal(c.w.qa.session.step, 1);
  assert.equal(c.w.qa.timer.kind, "exercise");
});

test("diary autosave persists drafts and preserves edits typed while a request is in flight", async (t) => {
  const db = database(),
    c = await client(db);
  t.after(() => c.close());
  c.w.nav("diary");
  c.input("#meal0", "Primeiro texto");
  const realFetch = c.w.fetch;
  let release;
  c.w.fetch = async (url, opts) => {
    if (url === "/api/state" && opts?.method === "POST")
      await new Promise((resolve) => (release = resolve));
    return realFetch(url, opts);
  };
  const pending = c.w.flushDiaryAutosave();
  await settle();
  const originalForm = c.$("#diaryForm"),
    originalField = c.$("#meal0");
  assert.equal(originalField.disabled, false);
  c.input("#meal0", "Texto mais recente");
  release();
  await pending;
  assert.equal(c.$("#diaryForm"), originalForm);
  assert.equal(c.$("#meal0"), originalField);
  assert.equal(db.state.diary[c.w.qa.today].status, "draft");
  assert.equal(
    db.state.diary[c.w.qa.today].meals["Café da Manhã"],
    "Primeiro texto",
  );
  assert.equal(c.$("#meal0").value, "Texto mais recente");
  c.w.fetch = realFetch;
  await c.w.flushDiaryAutosave();
  assert.equal(
    db.state.diary[c.w.qa.today].meals["Café da Manhã"],
    "Texto mais recente",
  );
  await c.w.saveDiary("complete");
  assert.equal(db.state.diary[c.w.qa.today].status, "complete");
  assert.equal(c.$("[data-status=complete]").dataset.saved, "true");
  assert.match(c.$("[data-status=complete]").textContent, /Diário finalizado/);
});

test("transient saves do not expand the sync warning and modal controls stay in its active subtree", async (t) => {
  const c = await client(database());
  t.after(() => c.close());
  c.w.qa.busy = true;
  c.w.updateSyncStatus();
  assert.equal(c.$("#syncPanel").dataset.state, "clean");
  assert.match(c.$("#syncStatus").textContent, /Salvando/);
  c.w.qa.busy = false;
  c.w.updateSyncStatus();
  c.w.HTMLElement.prototype.showPopover = function () {
    this.dataset.shown = "true";
  };
  c.w.cycleDialog();
  await settle();
  c.$("#cycleSelect + .select-trigger").click();
  const popup = c.$(".select-popover");
  assert.equal(popup.closest("dialog"), c.$("#modal"));
  assert.equal(popup.dataset.shown, "true");
  c.w.closeControlPopover();
  c.w.closeModal();
  assert.equal(c.$(".motion-exit-layer"), null);
});
test("favorites sync and meal previews replace only the chosen meal", async (t) => {
  const db = database(),
    c = await client(db);
  t.after(() => c.close());
  c.w.nav("diary");
  c.input("#meal0", "Café favorito");
  c.input("#meal1", "Almoço preservado");
  c.w.favoriteMeal(0);
  c.$("#favoriteName").value = "Meu café";
  c.$("#saveFavorite").click();
  await settle();
  assert.equal(db.state.favorites[0].text, "Café favorito");
  c.w.chooseFavorite(1);
  c.$("[data-use-favorite]").click();
  assert.equal(c.$("#meal1").value, "Almoço preservado");
  c.$("#applyMeal").click();
  assert.equal(c.$("#meal1").value, "Café favorito");
  assert.equal(c.$("#meal0").value, "Café favorito");
  await c.w.flushDiaryAutosave();
  const d = await client(db);
  t.after(() => d.close());
  assert.equal(d.w.qa.state.favorites[0].name, "Meu café");
  c.w.changeDiaryDate("2026-10-01");
  c.input("#meal0", "Café de outro dia");
  await c.w.saveDiary("draft");
  c.w.changeDiaryDate(c.w.qa.today);
  c.w.copyMealDay(0);
  c.$("#sourceMealDay").value = "2026-10-01";
  c.$("#previewMealDay").click();
  c.$("#applyMeal").click();
  assert.equal(c.$("#meal0").value, "Café de outro dia");
  assert.equal(c.$("#meal1").value, "Café favorito");
});
test("insights separate exercise types, ignore estimates and retain changed-goal context", async (t) => {
  const db = database(),
    c = await client(db);
  t.after(() => c.close());
  const e = c.w.qa.cycle.workouts[0].exercises[2];
  c.w.qa.state.history = [
    {
      id: "h1",
      date: "2026-10-01",
      started: 1,
      cycleId: "c1",
      cycleName: "Anterior",
      results: [{ ...e, series: 1, actual: 8 }],
    },
    {
      id: "h2",
      date: "2026-11-01",
      started: 2,
      cycleId: "c2",
      cycleName: "Atual",
      results: [
        { ...e, target: "15", series: 1, actual: 12 },
        { ...e, series: 2, actual: 99, estimated: true },
      ],
    },
  ];
  c.w.qa.state.history.forEach((h) => {
    h.workout = { name: "Treino de teste" };
    h.notes = "Sensação registrada";
  });
  const points = c.w.exerciseSessions(c.w.exerciseKey(e));
  assert.equal(points.length, 2);
  assert.equal(points[1].average, 12);
  assert.equal(
    c.w.exerciseSessions(c.w.exerciseKey({ ...e, type: "time" })).length,
    0,
  );
  assert.match(c.w.previousExerciseReference(e), /meta mudou/);
  c.w.nav("history");
  assert.ok(c.$(".trend-chart"));
  assert.match(c.$("#insightChart").textContent, /meta alterada/);
  c.w.nav("report");
  c.w.changeReportRange("month");
  c.w.changeReportDate("2026-11-01");
  assert.match(c.$("#reportText").value, /2026-10-01 a 2026-10-31/);
  assert.match(c.$("#reportText").value, /média 12.0 vs 8.0/);
});

test("sidebar preference persists and compact navigation retains accessible page names", async (t) => {
  const db = database(),
    c = await client(db);
  t.after(() => c.close());
  c.w.toggleSidebar();
  assert.equal(c.$("#sidebarToggle").getAttribute("aria-expanded"), "false");
  assert.ok(c.w.document.body.classList.contains("sidebar-collapsed"));
  const d = await client(db, c.storage());
  t.after(() => d.close());
  assert.ok(d.w.document.body.classList.contains("sidebar-collapsed"));
  assert.ok(
    d.$('#nav button[aria-label="Diário alimentar"][title="Diário alimentar"]'),
  );
  d.w.toggleSidebar();
  assert.equal(d.$("#sidebarToggle").getAttribute("aria-expanded"), "true");
});

test("settings preferences persist without changing records and onboarding keeps existing workouts", async (t) => {
  const db = database(),
    c = await client(db);
  t.after(() => c.close());
  const original = JSON.stringify(db.state.cycles);
  c.w.nav("settings");
  assert.ok(c.$("#settingsContent"));
  c.w.preference("reduce-motion", true);
  c.w.preference("reduce-glass", true);
  assert.ok(c.w.document.body.classList.contains("quiet-motion"));
  assert.ok(c.w.document.body.classList.contains("quiet-glass"));
  const d = await client(db, c.storage());
  t.after(() => d.close());
  assert.ok(d.w.document.body.classList.contains("quiet-motion"));
  c.w.welcomeRoutine();
  c.$("#welcomeAge").value = "26";
  c.$("#welcomeWeight").value = "72";
  c.$("#welcomePlan").value = "custom";
  await c.$("#welcomeForm").onsubmit({ preventDefault() {} });
  assert.equal(db.state.profile.age, 26);
  assert.equal(db.state.profile.weight, 72);
  assert.equal(JSON.stringify(db.state.cycles), original);
  assert.ok(c.$("#editorForm"));
});
test("fresh installations show welcome and can skip without writing a profile", async (t) => {
  const db = database(),
    c = await client(db, { "routine:welcome-seen": "false" });
  t.after(() => c.close());
  assert.ok(c.$("#welcomeForm"));
  c.w.skipWelcomeRoutine();
  assert.equal(c.$("dialog").open, false);
  assert.equal(c.w.localStorage.getItem("routine:welcome-seen"), "true");
  assert.equal(db.state.profile.setupComplete, undefined);
});

test("screen test releases its lock and an omitted onboarding weight stays blank on reopening", async (t) => {
  const db = database(),
    c = await client(db);
  t.after(() => c.close());
  let released = false;
  c.w.navigator.wakeLock.request = async () => ({
    release: async () => {
      released = true;
    },
  });
  await c.w.testScreenActive();
  assert.equal(released, true);
  c.w.welcomeRoutine();
  await c.$("#welcomeForm").onsubmit({ preventDefault() {} });
  assert.equal(db.state.profile.weightKnown, false);
  c.w.welcomeRoutine();
  assert.equal(c.$("#welcomeWeight").value, "");
});

test("shared select supports keyboard, commit, dismissal and leaves the form source in sync", async (t) => {
  const c = await client(database());
  t.after(() => c.close());
  const field = c.$("#homeWorkout"),
    trigger = c.$(".select-trigger");
  let changes = 0;
  field.addEventListener("change", () => changes++);
  trigger.dispatchEvent(
    new c.w.KeyboardEvent("keydown", {
      key: "ArrowDown",
      bubbles: true,
      cancelable: true,
    }),
  );
  assert.ok(c.$("[role=listbox]"));
  c.$("[role=listbox]").dispatchEvent(
    new c.w.KeyboardEvent("keydown", {
      key: "End",
      bubbles: true,
      cancelable: true,
    }),
  );
  assert.match(c.w.document.activeElement.textContent, /Treino B/);
  c.w.document.activeElement.click();
  await settle();
  assert.equal(field.value, c.w.qa.cycle.workouts[1].id);
  assert.equal(changes, 1);
  assert.match(trigger.textContent, /Treino B/);
  assert.equal(c.$("[role=listbox]"), null);
  const nextTrigger = c.$(".select-trigger");
  nextTrigger.click();
  c.w.document.dispatchEvent(
    new c.w.KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    }),
  );
  assert.equal(c.$("[role=listbox]"), null);
  assert.equal(c.w.document.activeElement, nextTrigger);
  assert.ok(field);
});

test("calendar commits a valid leap date and refuses impossible dates; report segments and source preserve Markdown", async (t) => {
  const c = await client(database());
  t.after(() => c.close());
  c.w.nav("report");
  await settle();
  const range = c.$("#range");
  const segments = range.nextElementSibling;
  segments.children[1].click();
  await settle();
  assert.equal(range.value, "week");
  assert.equal(segments.children[1].getAttribute("aria-pressed"), "true");
  c.$(".date-trigger").click();
  c.$(".calendar-entry").value = "31/02/2024";
  c.$(".calendar-apply").click();
  assert.ok(c.$(".calendar-popover"));
  c.$(".calendar-entry").value = "29/02/2024";
  c.$(".calendar-apply").click();
  await settle();
  assert.equal(c.$("#reportDate").value, "2024-02-29");
  assert.equal(c.$(".calendar-popover"), null);
  assert.ok(c.$("#reportPreview h2"));
  assert.equal(c.$("#reportText").hidden, true);
  const markdown = c.$("#reportText").value;
  c.w.toggleReportSource();
  assert.equal(c.$("#reportText").hidden, false);
  assert.equal(c.$("#reportPreview").hidden, true);
  assert.equal(c.$("#reportText").value, markdown);
  await c.w.copyReport();
  assert.equal(c.w.copied, markdown);
});

test("formatted report treats user content as text instead of executable markup", async (t) => {
  const c = await client(database());
  t.after(() => c.close());
  c.w.nav("report");
  c.w.renderMarkdownPreview(
    "# Routine\n## Treinos\n- <img src=x onerror=alert(1)>\n<script>window.pwned=true</script>",
  );
  assert.equal(c.$("#reportPreview img"), null);
  assert.equal(c.$("#reportPreview script"), null);
  assert.match(c.$("#reportPreview").textContent, /<img src=x/);
  assert.equal(c.w.pwned, undefined);
});

test("integrated confirmations preserve a workout on cancel and on Escape", async (t) => {
  const db = database(),
    c = await client(db);
  t.after(() => c.close());
  const original = JSON.stringify(db.state.cycles),
    wid = c.w.qa.cycle.workouts[0].id;
  const cancel = c.w.deleteWorkout(wid);
  assert.ok(c.$("#decisionConfirm"));
  c.$("#decisionCancel").click();
  await cancel;
  assert.equal(JSON.stringify(db.state.cycles), original);
  const escape = c.w.deleteWorkout(wid);
  c.$("#modal").oncancel({ preventDefault() {} });
  await escape;
  assert.equal(JSON.stringify(db.state.cycles), original);
  assert.equal(c.$("#modal").open, false);
});

test("calendar survives automatic modal scroll and dismisses on deliberate outside scrolling", async (t) => {
  const c = await client(database());
  t.after(() => c.close());
  c.w.profileDialog();
  await settle();
  c.$(".date-trigger").click();
  assert.ok(c.$(".calendar-popover"));
  c.$("#modal").dispatchEvent(new c.w.Event("scroll", { bubbles: true }));
  assert.ok(c.$(".calendar-popover"));
  c.$("#modal").dispatchEvent(new c.w.WheelEvent("wheel", { bubbles: true }));
  assert.equal(c.$(".calendar-popover"), null);
});

test("quick navigation searches without accents, opens the chosen page and respects an active workout", async (t) => {
  const c = await client(database());
  t.after(() => c.close());
  c.w.document.dispatchEvent(
    new c.w.KeyboardEvent("keydown", {
      key: "k",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    }),
  );
  assert.ok(c.$("#commandSearch"));
  assert.ok(c.$("#modal").classList.contains("command-dialog"));
  c.input("#commandSearch", "diario");
  assert.equal(c.w.document.querySelectorAll(".command-result").length, 1);
  c.$(".command-result").click();
  await settle();
  assert.equal(c.w.qa.page, "diary");
  assert.equal(c.$("#modal").open, false);
  c.w.profileDialog();
  assert.equal(c.$("#modal").classList.contains("command-dialog"), false);
  c.w.closeModal();
  c.w.startTraining(c.w.qa.cycle.workouts[0].id, { mode: "manual" });
  c.w.openRoutineCommands();
  assert.equal(c.$("#modal").open, false);
  assert.ok(c.$(".player"));
});

test("control decoration skips timer text and does not observe its own generated controls", async (t) => {
  const c = await client(database());
  t.after(() => c.close());
  c.w.nav("diary");
  await settle();
  let scans = 0;
  const original = c.w.refineControls;
  c.w.refineControls = () => {
    scans++;
    original();
  };
  c.$("#diarySaveStatus").textContent = "00:24";
  await settle();
  assert.equal(scans, 0);
  const field = c.w.document.createElement("select");
  field.innerHTML = "<option>Fixture</option>";
  c.$("#diaryForm").append(field);
  await settle();
  assert.equal(scans, 1);
  assert.ok(field.nextElementSibling.matches(".select-trigger"));
});

test("settings tabs keep their shell and controls while replacing only the panel body", async (t) => {
  const c = await client(database());
  t.after(() => c.close());
  c.w.nav("settings");
  await settle();
  const nav = c.$(".settings-nav"),
    heading = c.$(".heading"),
    panel = c.$("#settingsContent");
  for (const section of [
    "sound",
    "training",
    "data",
    "help",
    "profile",
    "appearance",
  ]) {
    c.$(`[data-settings-section="${section}"]`).click();
    await settle();
    assert.equal(c.$(".settings-nav"), nav);
    assert.equal(c.$(".heading"), heading);
    assert.equal(c.$("#settingsContent"), panel);
    assert.equal(c.$(".motion-exit-layer"), null);
    assert.equal(
      c.$(".settings-nav [aria-current=page]").dataset.settingsSection,
      section,
    );
    assert.ok(c.$(".settings-body").textContent.trim());
  }
  c.w.nav("dashboard");
  assert.equal(c.$(".daily-lanes").parentElement, c.$(".home-layout"));
});

test("phone access shows local QR/link, handles no network and server failure without losing records", async (t) => {
  const c = await client(database());
  t.after(() => c.close());
  const original = c.w.fetch,
    records = JSON.stringify(c.db.state);
  let networks = [
    { name: "Wi-Fi", ip: "192.168.1.50", url: "http://192.168.1.50:4123" },
    { name: "Ethernet", ip: "10.0.0.2", url: "http://10.0.0.2:4123" },
  ];
  c.w.fetch = async (url, opts) =>
    url === "/api/mobile"
      ? { ok: true, json: async () => ({ active: true, networks }) }
      : original(url, opts);
  c.w.nav("mobile");
  await settle();
  assert.match(c.$("#phoneConnection").textContent, /Servidor ativo/);
  assert.equal(c.$("#phoneLink").value, networks[0].url);
  assert.match(c.$("#phoneQr img").getAttribute("src"), /192.168.1.50/);
  c.$("#phoneNetwork").value = "1";
  c.$("#phoneNetwork").onchange();
  await c.w.copyMobileLink();
  assert.equal(c.w.copied, networks[1].url);
  networks = [];
  await c.w.refreshMobileAccess();
  assert.equal(c.$("#phoneQr").hidden, true);
  assert.match(c.$("#phoneNetworks").textContent, /Nenhuma rede/);
  c.w.fetch = async (url, opts) => {
    if (url === "/api/mobile") throw Error("offline");
    return original(url, opts);
  };
  await c.w.refreshMobileAccess();
  assert.match(c.$("#phoneConnection").textContent, /Reabra o Routine pelo atalho/);
  assert.equal(c.$("#phoneRefresh").disabled, false);
  assert.equal(JSON.stringify(c.db.state), records);
});

test("restart confirmation freezes time, keeps previous sets and rejects stale timer actions", async (t) => {
  const c = await client(database());
  t.after(() => c.close());
  c.w.startTraining(c.w.qa.cycle.workouts[0].id, {
    mode: "auto",
    transition: 0,
  });
  c.w.endTimer(false); // preparation -> exercise
  assert.equal(c.w.qa.timer.kind, "exercise");
  c.w.qa.timer.end = Date.now() + 28000;
  const prior = c.w.qa.timer,
    session = c.w.qa.session;
  let pending = c.w.restartTimer(prior.id);
  assert.equal(prior.paused, true);
  assert.ok(c.$("#decisionConfirm"));
  c.$("#decisionCancel").click();
  await pending;
  assert.equal(c.w.qa.timer, prior);
  assert.equal(c.w.qa.timer.paused, false);
  assert.ok(c.w.qa.timer.end - Date.now() <= 28000);
  pending = c.w.restartTimer(prior.id);
  c.$("#decisionConfirm").click();
  await pending;
  const restarted = c.w.qa.timer;
  assert.notEqual(restarted.id, prior.id);
  assert.equal(restarted.total, 30000);
  assert.ok(restarted.end - Date.now() > 29500);
  assert.equal(session.results.length, 0);
  assert.equal(session.step, 0);
  c.w.endTimer(false, prior.id);
  assert.equal(c.w.qa.timer, restarted);
  // Complete a real set, then reset the rest without removing its result.
  restarted.end = Date.now() - 1;
  c.w.tick();
  assert.equal(session.results.length, 1);
  assert.equal(c.w.qa.timer.kind, "exercise"); // warm-up circuit continues without a rest
  c.w.toggleTimer();
  pending = c.w.restartTimer();
  c.$("#decisionConfirm").click();
  await pending;
  assert.equal(c.w.qa.timer.paused, true);
  assert.equal(c.w.qa.timer.remaining, 25000);
  assert.equal(session.results.length, 1);
  assert.equal(session.step, 1);
  // Escape is also a cancellation, and a double tap cannot open another dialog.
  const paused = c.w.qa.timer;
  pending = c.w.restartTimer();
  await c.w.restartTimer();
  c.$("#modal").dispatchEvent(new c.w.Event("cancel", { cancelable: true }));
  await pending;
  assert.equal(c.w.qa.timer, paused);
  assert.equal(paused.paused, true);
});

test("ending a session requires confirmation and cancellation preserves the current timer", async (t) => {
  const c = await client(database());
  t.after(() => c.close());
  c.w.startTraining(c.w.qa.cycle.workouts[0].id, {
    mode: "auto",
    transition: 0,
  });
  c.w.endTimer(false);
  const session = c.w.qa.session,
    timer = c.w.qa.timer;
  c.w.cancelTraining();
  assert.equal(timer.paused, true);
  c.$("#returnToTraining").click();
  assert.equal(c.w.qa.session, session);
  assert.equal(timer.paused, false);
  c.w.cancelTraining();
  c.$("#modal").dispatchEvent(new c.w.Event("cancel", { cancelable: true }));
  assert.equal(c.w.qa.session, session);
  assert.equal(timer.paused, false);
  c.w.cancelTraining();
  c.$("#discardSession").click();
  assert.equal(c.w.qa.session, null);
  assert.equal(c.w.qa.timer, null);
  assert.equal(c.w.qa.state.history.length, 0);
});

test("wordmark RGB is finite, mouse-only, accessible and disabled in training or reduced motion", async (t) => {
  const c = await client(database());
  t.after(() => c.close());
  c.w.matchMedia = () => ({ matches: false });
  c.w.eval(fs.readFileSync("public/brand-motion.js", "utf8"));
  const mark = c.$(".logo .glitch-wordmark");
  Object.defineProperty(c.w.document, "hidden", {
    configurable: true,
    value: false,
  });
  mark.getBoundingClientRect = () => ({ width: 113, height: 28 });
  assert.equal(mark.getAttribute("aria-label"), "Routine");
  assert.equal(mark.querySelectorAll("i").length, 7);
  assert.equal(mark.querySelector("img").alt, "");
  const pointer = (type) => {
    const e = new c.w.Event("pointerenter");
    Object.defineProperty(e, "pointerType", { value: type });
    mark.dispatchEvent(e);
  };
  pointer("touch");
  assert.equal(mark.classList.contains("wordmark-burst"), false);
  pointer("mouse");
  assert.equal(mark.classList.contains("wordmark-burst"), true);
  await new Promise((r) => setTimeout(r, 740));
  assert.equal(mark.classList.contains("wordmark-burst"), false);
  c.w.document.body.classList.add("training-view");
  pointer("mouse");
  assert.equal(mark.classList.contains("wordmark-burst"), false);
  c.w.document.body.classList.remove("training-view");
  c.w.preference("reduce-motion", true);
  pointer("mouse");
  assert.equal(mark.classList.contains("wordmark-burst"), false);
});
