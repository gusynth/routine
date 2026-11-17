const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validateState } = require("../lib/state");
const seed = () => ({
  currentCycle: "c",
  cycles: [
    {
      id: "c",
      name: "Mês 1",
      start: "2026-11-06",
      goal: 20,
      workouts: [
        {
          id: "a",
          name: "Treino A",
          schedule: "Seg",
          exercises: [
            {
              id: "e",
              name: "Prancha",
              block: "Força",
              type: "time",
              target: "30",
              sets: 2,
              rest: 60,
            },
          ],
        },
      ],
    },
  ],
  profile: { height: 1.7, weight: 69, notes: "", weights: [] },
  diary: {},
  goals: [],
  history: [],
});
test("state validation protects persisted data from invalid nested fields", () => {
  assert.equal(validateState(seed()), true);
  const mutations = [
    (s) => (s.cycles[0].workouts[0].exercises[0].sets = 0),
    (s) => (s.cycles[0].workouts[0].exercises[0].rest = -1),
    (s) => (s.cycles[0].workouts[0].exercises[0].target = "text"),
    (s) => (s.cycles[0].workouts[0].id = "x');alert(1)"),
    (s) => (s.profile.weight = null),
    (s) => (s.cycles[0].start = "2026-02-31"),
    (s) => s.cycles[0].workouts.push(s.cycles[0].workouts[0]),
    (s) => s.history.push({}),
    (s) => (s.diary["2026-11-06"] = { meals: [], checks: {}, goalNames: {} }),
  ];
  for (const mutation of mutations) {
    const s = seed();
    mutation(s);
    assert.equal(validateState(s), false);
  }
  const partial = seed();
  partial.diary["2026-11-06"] = {
    meals: { "Café da Manhã": "Pão", Janta: "" },
    checks: {},
    goalNames: {},
    status: "draft",
  };
  assert.equal(validateState(partial), true);
});
