/* One short RGB burst at entry or mouse hover. No loop, WebGL or layout work. */
(() => {
  const reduced = () => {
    let saved = false;
    try {
      saved = localStorage.getItem("routine:reduce-motion") === "true";
    } catch {}
    return (
      saved ||
      document.body.classList.contains("quiet-motion") ||
      matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  };
  const marks = [];
  document.querySelectorAll("img.brand-wordmark").forEach((image) => {
    const mark = document.createElement("span");
    mark.className = image.className + " glitch-wordmark";
    if (image.alt) {
      mark.setAttribute("role", "img");
      mark.setAttribute("aria-label", image.alt);
    } else mark.setAttribute("aria-hidden", "true");
    image.replaceWith(mark);
    image.className = "wordmark-base";
    image.alt = "";
    image.setAttribute("aria-hidden", "true");
    mark.append(image);
    for (const channel of [
      "red",
      "green",
      "blue",
      "slice-red",
      "slice-green",
      "slice-blue",
      "pixels",
    ]) {
      const layer = document.createElement("i");
      layer.className = "wordmark-" + channel;
      layer.setAttribute("aria-hidden", "true");
      mark.append(layer);
    }
    let timeout;
    const play = () => {
      if (
        reduced() ||
        document.hidden ||
        document.body.classList.contains("training-view") ||
        !mark.getBoundingClientRect().width ||
        mark.classList.contains("wordmark-burst")
      )
        return;
      mark.classList.add("wordmark-burst");
      clearTimeout(timeout);
      timeout = setTimeout(() => mark.classList.remove("wordmark-burst"), 700);
    };
    mark.addEventListener("pointerenter", (event) => {
      if (event.pointerType === "mouse") play();
    });
    marks.push(play);
  });
  // Wait for the app's initial preferences; hover never starts a repeating timer.
  window.addEventListener(
    "load",
    () => setTimeout(() => marks.forEach((play) => play()), 450),
    { once: true },
  );
})();
