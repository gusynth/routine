/* Independent of the WebGL bundle: a failed import/context must leave a poster. */
(() => {
  const root = document.getElementById("routine-raycast-glass-final");
  const stage = root.querySelector(".rr-scene"),
    canvas = root.querySelector("canvas");
  const query = new URLSearchParams(location.search),
    banner = query.get("view") === "workout";
  const palette = Math.max(0, Math.min(2, Number(query.get("palette")) || 0));
  const poster = document.createElement("img");
  poster.className = banner ? "rr-poster rr-poster-banner" : "rr-poster";
  poster.alt = "";
  poster.src = banner
    ? `/brand/workout-banner-${palette}.svg`
    : "/brand/routine-symbol.svg";
  stage.insertBefore(poster, canvas);
  if (banner) root.classList.add("rr-workout");
  let failed = false,
    ready = false;
  let timer;
  function watchStartup() {
    clearTimeout(timer);
    if (!document.hidden && !ready && !failed)
      timer = setTimeout(() => fail("R-GFX-004"), 20000);
  }
  watchStartup();
  document.addEventListener("visibilitychange", watchStartup);
  function fail(code) {
    if (failed) return;
    failed = true;
    clearTimeout(timer);
    root.classList.remove("rr-rendered", "rr-glass-ready");
    const status = root.querySelector(".rr-status");
    status.hidden = false;
    status.textContent = `Visual estático para manter o app disponível · ${code}`;
    const button = root.querySelector(".rr-play");
    button.disabled = false;
    button.textContent = "Tentar animação";
    button.onclick = () => location.reload();
    window.parent.postMessage(
      { type: "routine:scene-error", code },
      location.origin,
    );
    window.dispatchEvent(new Event("routine:scene-failed"));
  }
  window.RoutineSceneGuard = {
    fail,
    pending() {
      if (failed || ready) return;
      watchStartup();
    },
    ready() {
      if (failed) return;
      ready = true;
      clearTimeout(timer);
      root.classList.add("rr-rendered", "rr-glass-ready");
      root.querySelector(".rr-status").hidden = true;
    },
    get failed() {
      return failed;
    },
  };
  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    fail("R-GFX-002");
  });
  window.addEventListener("error", () =>
    fail(ready ? "R-GFX-003" : "R-GFX-001"),
  );
  window.addEventListener("unhandledrejection", () => fail("R-GFX-003"));
  window.addEventListener("pagehide", () => clearTimeout(timer), {
    once: true,
  });
})();
