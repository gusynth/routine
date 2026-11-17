/* Local, bounded diagnostics. Never store diary text, API bodies or profiles. */
(() => {
  const key = "routine:diagnostics";
  let entries = [];
  try {
    entries = JSON.parse(localStorage.getItem(key) || "[]")
      .filter((e) => /^R-[A-Z]+-\d{3}$/.test(e.code))
      .slice(-80);
  } catch {}
  function record(code, component = "app") {
    if (!/^R-[A-Z]+-\d{3}$/.test(code)) return;
    const last = entries.at(-1),
      now = Date.now();
    if (
      last?.code === code &&
      last.component === component &&
      now - Date.parse(last.time) < 10000
    )
      return;
    entries.push({
      time: new Date(now).toISOString(),
      code,
      component: String(component)
        .replace(/[^a-z-]/gi, "")
        .slice(0, 40),
    });
    entries = entries.slice(-80);
    try {
      localStorage.setItem(key, JSON.stringify(entries));
    } catch {}
  }
  function report() {
    return {
      version: 1,
      graphics: window.RoutineSceneMetrics || [],
      sceneStates: window.RoutineSceneStatuses || [],
      events: entries.slice(),
      viewport: { width: innerWidth, height: innerHeight },
      graphicsSafeMode:
        sessionStorage.getItem("routine:graphics-safe") === "true",
    };
  }
  window.RoutineDiagnostics = {
    record,
    report,
    clear() {
      entries = [];
      try {
        localStorage.removeItem(key);
      } catch {}
    },
  };
  window.addEventListener("error", () => record("R-APP-001"));
  window.addEventListener("unhandledrejection", () => record("R-APP-002"));
  const original = window.fetch;
  if (original)
    window.fetch = async (...args) => {
      try {
        const response = await original(...args);
        if (!response.ok) {
          record(
            `R-HTTP-${String(response.status).padStart(3, "0")}`,
            "network",
          );
          response
            .clone?.()
            .json()
            .then((body) => record(body.code, "api"))
            .catch(() => {});
        }
        return response;
      } catch (error) {
        if (error?.name !== "AbortError") record("R-NET-001", "network");
        throw error;
      }
    };
  window.chrome?.webview?.addEventListener("message", (event) => {
    if (event.data?.type === "routine-graphics-failure")
      window.dispatchEvent(new Event("routine:graphics-safe-mode"));
  });
})();
