/* Transient UI motion only. The WebGL animation and saved state are untouched. */
(() => {
  const ease = "cubic-bezier(.22,1,.36,1)",
    active = new WeakMap(),
    ghosts = new Set();
  const reduced = () =>
    document.body.classList.contains("quiet-motion") ||
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  function animate(el, frames, duration = 420) {
    if (!el || reduced() || typeof el.animate !== "function") return null;
    active.get(el)?.cancel();
    const animation = el.animate(frames, { duration, easing: ease });
    active.set(el, animation);
    animation.finished.then(
      () => {
        if (active.get(el) === animation) active.delete(el);
      },
      () => {},
    );
    return animation;
  }
  function enter(el, duration = 420) {
    return animate(
      el,
      [
        { opacity: 0, transform: "translateY(7px)" },
        { opacity: 1, transform: "none" },
      ],
      duration,
    );
  }
  function snapshot(el, modal = false) {
    if (!el || reduced() || typeof el.animate !== "function") return;
    // Cloning a live iframe would start another WebGL engine in the exit ghost.
    if (el.matches("iframe,canvas") || el.querySelector("iframe,canvas"))
      return;
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const layer = document.createElement("div");
    layer.className = "motion-exit-layer";
    layer.setAttribute("aria-hidden", "true");
    layer.inert = true;
    if (modal) layer.dataset.modal = "true";
    const clone = el.cloneNode(true);
    clone.removeAttribute("open");
    [clone, ...clone.querySelectorAll("[id]")].forEach((node) =>
      node.removeAttribute("id"),
    );
    clone.style.cssText += `;position:fixed;display:block;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;margin:0;max-height:none;animation:none;transform:none;translate:none;rotate:none;scale:none;pointer-events:none;overflow:hidden;`;
    layer.append(clone);
    document.body.append(layer);
    if (typeof layer.showPopover === "function") {
      layer.setAttribute("popover", "manual");
      try {
        layer.showPopover();
      } catch {
        layer.removeAttribute("popover");
      }
    }
    const remove = () => {
      layer.remove();
      ghosts.delete(layer);
    };
    ghosts.add(layer);
    if (ghosts.size > 3) {
      const first = ghosts.values().next().value;
      first.remove();
      ghosts.delete(first);
    }
    const fade = animate(
      layer,
      [{ opacity: 1 }, { opacity: 0 }],
      modal ? 320 : 240,
    );
    animate(
      clone,
      [
        { transform: "none" },
        {
          transform: modal ? "translateY(8px) scale(.99)" : "translateY(-3px)",
        },
      ],
      modal ? 320 : 240,
    );
    if (fade) fade.finished.then(remove, remove);
    else remove();
  }
  function swap(el, paint) {
    snapshot(el);
    paint();
    enter(el);
  }
  const replacements = new WeakMap();
  function replaceContent(el, next) {
    const before = el.getBoundingClientRect().height;
    active.get(el)?.cancel();
    el.style.overflow = "";
    el.querySelectorAll(":scope > [data-motion-outgoing]").forEach((node) =>
      node.remove(),
    );
    const previous = el.firstElementChild;
    if (!previous || reduced() || typeof el.animate !== "function") {
      el.replaceChildren(next);
      return;
    }
    const opacity = getComputedStyle(previous).opacity;
    const box = previous.getBoundingClientRect();
    const top = previous.offsetTop,
      left = previous.offsetLeft;
    active.get(previous)?.cancel();
    previous.dataset.motionOutgoing = "true";
    previous.inert = true;
    previous.setAttribute("aria-hidden", "true");
    [previous, ...previous.querySelectorAll("[id]")].forEach((node) =>
      node.removeAttribute("id"),
    );
    previous.style.cssText += `;position:absolute;top:${top}px;left:${left}px;width:${box.width}px;margin:0;pointer-events:none;`;
    el.replaceChildren(next, previous);
    const after = el.getBoundingClientRect().height;
    const token = {};
    replacements.set(el, token);
    el.style.overflow = "clip";
    const height = animate(
      el,
      [{ height: before + "px" }, { height: after + "px" }],
      440,
    );
    const exit = animate(previous, [{ opacity }, { opacity: 0 }], 180);
    animate(
      next,
      [
        { opacity: 0, transform: "translateY(4px)" },
        { opacity: 1, transform: "none" },
      ],
      420,
    );
    exit.finished.then(
      () => previous.remove(),
      () => previous.remove(),
    );
    height.finished.then(
      () => {
        if (replacements.get(el) === token) el.style.overflow = "";
      },
      () => {},
    );
  }
  function sync(panel, paint) {
    const before = panel.dataset.state,
      app = document.querySelector("#app"),
      top = app?.getBoundingClientRect().top;
    paint();
    if (!before || before === panel.dataset.state) return;
    enter(panel, 400);
    if (app && top !== undefined) {
      const delta = top - app.getBoundingClientRect().top;
      if (delta)
        animate(
          app,
          [{ transform: `translateY(${delta}px)` }, { transform: "none" }],
          420,
        );
    }
  }
  const disclosures = new WeakMap();
  document.addEventListener("click", (event) => {
    const summary = event.target.closest?.("details > summary");
    if (
      !summary ||
      !summary.closest("#app,#modal") ||
      event.target.closest("button,a,input") ||
      reduced() ||
      typeof summary.animate !== "function"
    )
      return;
    event.preventDefault();
    const el = summary.parentElement,
      prior = disclosures.get(el),
      expanded = !(prior?.expanded ?? el.open);
    const start = el.getBoundingClientRect().height;
    prior?.animation?.cancel();
    el.style.height = "";
    el.style.overflow = "hidden";
    el.open = expanded;
    const end = el.getBoundingClientRect().height;
    el.open = true;
    el.dataset.motionExpanded = String(expanded);
    el.style.height = start + "px";
    const animation = el.animate(
      [{ height: start + "px" }, { height: end + "px" }],
      { duration: 440, easing: ease, fill: "forwards" },
    );
    const state = { expanded, animation };
    disclosures.set(el, state);
    animation.onfinish = () => {
      if (disclosures.get(el) !== state) return;
      el.open = expanded;
      el.style.height = "";
      el.style.overflow = "";
      animation.cancel();
      disclosures.delete(el);
      delete el.dataset.motionExpanded;
    };
  });
  window.RoutineMotion = {
    enter,
    snapshot,
    swap,
    replaceContent,
    sync,
    animate,
    reduced,
  };
})();
