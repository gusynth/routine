const object = (v) => v && typeof v === "object" && !Array.isArray(v);
const text = (v, max = 10000) => typeof v === "string" && v.length <= max;
const ident = (v) => typeof v === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(v);
const integer = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
const day = (v) =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  new Date(v + "T12:00:00Z").toISOString().slice(0, 10) === v;
function exercise(e) {
  return (
    object(e) &&
    ident(e.id) &&
    text(e.name, 300) &&
    e.name.trim() &&
    ["Aquecimento", "Força", "Finalizador"].includes(e.block) &&
    ["reps", "time"].includes(e.type) &&
    text(e.target, 100) &&
    e.target.trim() &&
    (e.type !== "time" || integer(Number(e.target), 1, 3600)) &&
    integer(e.sets, 1, 30) &&
    (e.autoSeconds === undefined || integer(e.autoSeconds, 1, 3600)) &&
    integer(e.rest, 0, 3600)
  );
}
const unique = (list) => new Set(list.map((v) => v.id)).size === list.length;
function workout(w) {
  return (
    object(w) &&
    ident(w.id) &&
    text(w.name, 300) &&
    w.name.trim() &&
    text(w.schedule, 300) &&
    Array.isArray(w.exercises) &&
    w.exercises.length <= 100 &&
    unique(w.exercises) &&
    w.exercises.every(exercise)
  );
}
function validateState(s) {
  try {
    if (
      !object(s) ||
      !object(s.profile) ||
      !Number.isFinite(s.profile.height) ||
      s.profile.height <= 0 ||
      !Number.isFinite(s.profile.weight) ||
      s.profile.weight <= 0 ||
      s.profile.weight > 500 ||
      !text(s.profile.notes) ||
      !Array.isArray(s.profile.weights) ||
      !s.profile.weights.every(
        (w) =>
          object(w) &&
          day(w.date) &&
          Number.isFinite(w.weight) &&
          w.weight > 0 &&
          w.weight <= 500 &&
          text(w.notes),
      )
    )
      return false;
    if (s.profile.age !== undefined && !integer(s.profile.age, 1, 120))
      return false;
    if (
      s.profile.setupComplete !== undefined &&
      typeof s.profile.setupComplete !== "boolean"
    )
      return false;
    if (
      s.profile.weightKnown !== undefined &&
      typeof s.profile.weightKnown !== "boolean"
    )
      return false;
    if (
      !Array.isArray(s.cycles) ||
      !s.cycles.length ||
      s.cycles.length > 120 ||
      !unique(s.cycles) ||
      !s.cycles.every(
        (c) =>
          object(c) &&
          ident(c.id) &&
          text(c.name, 300) &&
          c.name.trim() &&
          integer(c.goal, 1, 999) &&
          day(c.start) &&
          Array.isArray(c.workouts) &&
          c.workouts.length <= 100 &&
          unique(c.workouts) &&
          c.workouts.every(workout),
      ) ||
      !s.cycles.some((c) => c.id === s.currentCycle)
    )
      return false;
    if (
      !Array.isArray(s.goals) ||
      s.goals.length > 100 ||
      !unique(s.goals) ||
      !s.goals.every(
        (g) => object(g) && ident(g.id) && text(g.name, 300) && g.name.trim(),
      )
    )
      return false;
    if (
      s.favorites !== undefined &&
      (!Array.isArray(s.favorites) ||
        s.favorites.length > 100 ||
        !unique(s.favorites) ||
        !s.favorites.every(
          (f) =>
            object(f) &&
            ident(f.id) &&
            text(f.name, 100) &&
            f.name.trim() &&
            text(f.text) &&
            f.text.trim(),
        ))
    )
      return false;
    if (
      !object(s.diary) ||
      !Object.entries(s.diary).every(
        ([d, v]) =>
          day(d) &&
          object(v) &&
          object(v.meals) &&
          Object.values(v.meals).every((t) => text(t)) &&
          object(v.checks) &&
          Object.values(v.checks).every((t) => typeof t === "boolean") &&
          object(v.goalNames) &&
          Object.values(v.goalNames).every((t) => text(t, 300)) &&
          (!v.status || ["draft", "complete"].includes(v.status)),
      )
    )
      return false;
    if (
      !Array.isArray(s.history) ||
      !unique(s.history) ||
      !s.history.every(
        (h) =>
          object(h) &&
          ident(h.id) &&
          ident(h.cycleId) &&
          text(h.cycleName, 300) &&
          day(h.date) &&
          Number.isFinite(h.started) &&
          Number.isFinite(h.duration) &&
          h.duration >= 0 &&
          text(h.notes) &&
          workout(h.workout) &&
          Array.isArray(h.results) &&
          h.results.length <= 3000 &&
          h.results.every(
            (e) =>
              exercise(e) &&
              (e.estimated === undefined || typeof e.estimated === "boolean") &&
              integer(e.series, 1, e.sets) &&
              integer(e.actual, 0, 100000),
          ),
      )
    )
      return false;
    return true;
  } catch {
    return false;
  }
}
module.exports = { validateState };
