/* Shared controls. Original form fields remain the data source and mobile fallback. */
const controlViews = new WeakMap();
let activePopover = null;
const uiPaths = {
  search: "M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15M16 16l5 5",
  undo: "M9 5 4 10l5 5M4 10h9a6 6 0 0 1 0 12",
  edit: "m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14Z",
  chevron: "m9 5 7 7-7 7",
  down: "m6 9 6 6 6-6",
  arrow: "M5 12h14m-6-6 6 6-6 6",
  back: "M19 12H5m6-6-6 6 6 6",
  check: "m5 12 4 4L19 6",
  plus: "M12 5v14M5 12h14",
  calendar: "M8 3v4m8-4v4M4 10h16M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1Z",
  play: "m8 5 11 7-11 7Z",
  music: "M9 18V5l11-2v13M9 9l11-2M9 18a3 3 0 1 1-3-3m14 1a3 3 0 1 1-3-3",
  more: "M5 12h.01M12 12h.01M19 12h.01",
};
function uiIcon(name) {
  return `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${(
    uiPaths[name] || uiPaths.chevron
  )
    .split("|")
    .map((d) => `<path d="${d}"/>`)
    .join("")}</svg>`;
}
function openRoutineCommands() {
  if (!state)
    return toast("Preparando seu espaço. Tente novamente em instantes.");
  if (busy) return toast("Aguarde o salvamento para navegar.");
  if (session)
    return toast("Finalize ou encerre o treino antes de trocar de tela.");
  const entries = [
    {
      name: "Usar no celular",
      detail: "QR Code, rede e acesso pelo Wi-Fi",
      page: "mobile",
      icon: "arrow",
    },
    {
      name: "Visão geral",
      detail: "Seu treino e o progresso do ciclo",
      page: "dashboard",
      icon: "arrow",
    },
    {
      name: "Meus treinos",
      detail: "Organize seu plano e seus exercícios",
      page: "workouts",
      icon: "edit",
    },
    {
      name: "Diário alimentar",
      detail: "Registre as refeições de hoje",
      page: "diary",
      icon: "calendar",
    },
    {
      name: "Evolução",
      detail: "Histórico e resultados por exercício",
      page: "history",
      icon: "arrow",
    },
    {
      name: "Relatórios",
      detail: "Seu progresso, organizado para compartilhar",
      page: "report",
      icon: "calendar",
    },
    {
      name: "Configurações",
      detail: "Seu perfil, preferências e backups",
      page: "settings",
      icon: "more",
    },
    ...cycle().workouts.map((w) => ({
      name: "Treinar " + w.name,
      detail: w.exercises.length + " exercícios · " + cycle().name,
      workout: w.id,
      icon: "play",
    })),
  ];
  openModal(
    `<div class="command-search">${uiIcon("search")}<input id="commandSearch" aria-label="Buscar no Routine" placeholder="Onde vamos agora?" autocomplete="off"></div><div id="commandResults" class="command-results" aria-label="Atalhos do Routine"></div><div class="command-footer"><span>Navegue no seu ritmo.</span><button class="btn small" onclick="closeModal()">Fechar <kbd>esc</kbd></button></div>`,
  );
  document.querySelector("#modal").classList.add("command-dialog");
  const input = document.querySelector("#commandSearch"),
    results = document.querySelector("#commandResults");
  const normalize = (text) =>
    text
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  const paint = () => {
    const filtered = entries.filter((e) =>
      normalize(e.name + " " + e.detail).includes(
        normalize(input.value.trim()),
      ),
    );
    results.innerHTML =
      filtered
        .map(
          (entry, index) =>
            `<button type="button" class="command-result" data-command="${index}">${uiIcon(entry.icon)}<span><b>${esc(entry.name)}</b><small>${esc(entry.detail)}</small></span>${uiIcon("chevron")}</button>`,
        )
        .join("") ||
      '<p class="empty">Nenhum atalho encontrado. Tente “treino” ou “diário”.</p>';
    results.querySelectorAll("[data-command]").forEach(
      (button) =>
        (button.onclick = () => {
          const entry = filtered[+button.dataset.command];
          closeModal();
          if (entry.workout) configureTraining(entry.workout);
          else nav(entry.page);
        }),
    );
  };
  input.oninput = paint;
  input.onkeydown = (event) => {
    if (["ArrowDown", "Enter"].includes(event.key)) {
      event.preventDefault();
      const first = results.querySelector("button");
      if (event.key === "Enter") first?.click();
      else first?.focus();
    }
  };
  results.onkeydown = (event) => {
    const buttons = [...results.querySelectorAll("button")],
      index = buttons.indexOf(document.activeElement);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      buttons[(index + 1) % buttons.length]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (index <= 0) input.focus();
      else buttons[index - 1].focus();
    }
  };
  paint();
  input.focus();
}
document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    if (!document.querySelector("#modal").open) openRoutineCommands();
  }
});
function closeControlPopover(restore = false) {
  if (!activePopover) return;
  const { panel, trigger } = activePopover;
  RoutineMotion.snapshot(panel);
  panel.remove();
  trigger.setAttribute("aria-expanded", "false");
  activePopover = null;
  if (restore && trigger.isConnected) trigger.focus({ preventScroll: true });
}
function controlPopover(trigger, className, estimatedHeight = 370) {
  closeControlPopover();
  const panel = document.createElement("div");
  panel.className = "control-popover " + className;
  panel.id = "popover-" + id();
  trigger.setAttribute("aria-controls", panel.id);
  trigger.setAttribute("aria-expanded", "true");
  if (typeof panel.showPopover === "function") {
    panel.setAttribute("popover", "manual");
    // Keep the popup in the modal's active subtree; top-layer positioning
    // escapes its transformed containing block without making it inert.
    (trigger.closest("dialog") || document.body).append(panel);
    panel.showPopover();
  } else (trigger.closest("dialog") || document.body).append(panel);
  const rect = trigger.getBoundingClientRect(),
    width = Math.min(
      className === "calendar-popover" ? 320 : Math.max(rect.width, 220),
      innerWidth - 32,
    );
  panel.style.width = width + "px";
  panel.style.left =
    Math.max(16, Math.min(rect.left, innerWidth - width - 16)) + "px";
  const height = Math.min(estimatedHeight, innerHeight - 32);
  const top =
    rect.bottom + height + 8 <= innerHeight - 16
      ? rect.bottom + 8
      : rect.top - height - 8;
  panel.style.top =
    Math.max(16, Math.min(top, innerHeight - height - 16)) + "px";
  activePopover = { panel, trigger };
  RoutineMotion.enter(panel, 340);
  return panel;
}
function commitControl(field, value) {
  field.value = value;
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.dispatchEvent(new Event("change", { bubbles: true }));
  if (field.isConnected) {
    if (field.tagName === "SELECT") enhanceSelect(field);
    else if (field.type === "date") enhanceDate(field);
  }
}
function controlLabel(field) {
  return (
    field.labels?.[0]?.textContent.trim() ||
    field.getAttribute("aria-label") ||
    "Selecionar opção"
  );
}
function enhanceSelect(field) {
  if (controlViews.has(field)) {
    const view = controlViews.get(field);
    if (view.matches(".segmented-control"))
      Array.from(view.children).forEach((button, index) =>
        button.setAttribute(
          "aria-pressed",
          String(field.options[index]?.selected || false),
        ),
      );
    if (
      view.matches(".select-trigger") &&
      view.querySelector("span").textContent !==
        (field.selectedOptions[0]?.textContent || "Selecionar")
    )
      view.querySelector("span").textContent =
        field.selectedOptions[0]?.textContent || "Selecionar";
    return;
  }
  const segmented =
    [
      "range",
      "trainingMode",
      "circuitRest",
      "defaultMode",
      "defaultRest",
      "welcomePlan",
    ].includes(field.id) || field.name === "type";
  const view = document.createElement(segmented ? "div" : "button");
  field.classList.add(segmented ? "segmented-source" : "native-select");
  controlViews.set(field, view);
  if (segmented) {
    view.className = "segmented-control";
    view.setAttribute("role", "group");
    view.setAttribute("aria-label", controlLabel(field));
    Array.from(field.options).forEach((option) => {
      const button = document.createElement("button");
      button.type = "button";
      const shortNames = {
        range: { day: "Dia", week: "7 dias", month: "Mês" },
        trainingMode: { manual: "Manual", auto: "Timers automáticos" },
        defaultMode: { manual: "Manual", auto: "Timers automáticos" },
        circuitRest: {
          round: "Ao fim da volta",
          exercise: "Após cada exercício",
        },
        defaultRest: {
          round: "Ao fim da volta",
          exercise: "Após cada exercício",
        },
        welcomePlan: {
          existing: "Usar plano atual",
          custom: "Criar meu treino",
        },
      };
      button.textContent =
        shortNames[field.id]?.[option.value] || option.textContent;
      button.title = option.textContent;
      button.setAttribute("aria-pressed", String(option.selected));
      button.disabled = option.disabled;
      button.onclick = () => {
        Array.from(view.children).forEach((b) =>
          b.setAttribute("aria-pressed", String(b === button)),
        );
        commitControl(field, option.value);
      };
      view.append(button);
    });
  } else {
    view.type = "button";
    view.className = "select-trigger";
    view.setAttribute("role", "combobox");
    view.setAttribute("aria-label", controlLabel(field));
    view.setAttribute("aria-haspopup", "listbox");
    view.setAttribute("aria-expanded", "false");
    view.innerHTML = `<span>${esc(field.selectedOptions[0]?.textContent || "Selecionar")}</span>${uiIcon("down")}`;
    view.onclick = () => openSelect(field, view);
    view.onkeydown = (event) => {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        openSelect(field, view);
      }
    };
  }
  field.after(view);
}
function openSelect(field, trigger) {
  if (activePopover?.trigger === trigger) return closeControlPopover(true);
  const panel = controlPopover(
    trigger,
    "select-popover",
    Math.min(370, field.options.length * 52 + 8),
  );
  panel.setAttribute("role", "listbox");
  panel.setAttribute("aria-label", controlLabel(field));
  const options = Array.from(field.options);
  options.forEach((option) => {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(option.selected));
    button.disabled = option.disabled;
    button.innerHTML = `<span>${esc(option.textContent)}</span>${option.selected ? uiIcon("check") : ""}`;
    button.onclick = () => {
      closeControlPopover(true);
      commitControl(field, option.value);
    };
    panel.append(button);
  });
  const buttons = Array.from(panel.children).filter((b) => !b.disabled);
  (
    buttons.find((b) => b.getAttribute("aria-selected") === "true") ||
    buttons[0]
  )?.focus();
  panel.onkeydown = (event) => {
    let index = buttons.indexOf(document.activeElement);
    if (event.key === "ArrowDown") index = (index + 1) % buttons.length;
    else if (event.key === "ArrowUp")
      index = (index - 1 + buttons.length) % buttons.length;
    else if (event.key === "Home") index = 0;
    else if (event.key === "End") index = buttons.length - 1;
    else if (event.key.length === 1) {
      index = buttons.findIndex((b) =>
        b.textContent.trim().toLowerCase().startsWith(event.key.toLowerCase()),
      );
    } else return;
    event.preventDefault();
    buttons[index]?.focus();
  };
}
function enhanceDate(field) {
  if (controlViews.has(field)) {
    const text = field.value
      ? field.value.split("-").reverse().join("/")
      : "Selecionar data";
    if (controlViews.get(field).querySelector("span").textContent !== text)
      controlViews.get(field).querySelector("span").textContent = text;
    return;
  }
  field.classList.add("native-date");
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "date-trigger";
  trigger.setAttribute("aria-label", controlLabel(field));
  trigger.setAttribute("aria-haspopup", "dialog");
  trigger.setAttribute("aria-expanded", "false");
  trigger.innerHTML = `<span>${esc(field.value ? field.value.split("-").reverse().join("/") : "Selecionar data")}</span>${uiIcon("calendar")}`;
  trigger.onclick = () => openCalendar(field, trigger);
  controlViews.set(field, trigger);
  field.after(trigger);
}
function openCalendar(field, trigger) {
  if (activePopover?.trigger === trigger) return closeControlPopover(true);
  const panel = controlPopover(trigger, "calendar-popover", 480);
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Escolher data");
  let cursor = new Date((field.value || date()) + "T12:00:00");
  cursor.setDate(1);
  const choose = (value) => {
    if ((field.min && value < field.min) || (field.max && value > field.max))
      return;
    closeControlPopover(true);
    commitControl(field, value);
  };
  const paint = () => {
    panel.innerHTML = `<div class="calendar-heading"><button type="button" aria-label="Mês anterior">${uiIcon("back")}</button><b>${esc(cursor.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }))}</b><button type="button" aria-label="Próximo mês">${uiIcon("arrow")}</button></div><div class="calendar-week" aria-hidden="true">${["D", "S", "T", "Q", "Q", "S", "S"].map((d) => `<span>${d}</span>`).join("")}</div><div class="calendar-days"></div><label>Ir para data<input class="calendar-entry" placeholder="DD/MM/AAAA" inputmode="numeric" maxlength="10"></label><div class="calendar-footer"><button type="button" class="btn small calendar-today">Hoje</button><button type="button" class="btn small calendar-apply">Ir para data</button></div>`;
    const grid = panel.querySelector(".calendar-days");
    for (let i = 0; i < cursor.getDay(); i++)
      grid.append(document.createElement("span"));
    const total = new Date(
      cursor.getFullYear(),
      cursor.getMonth() + 1,
      0,
    ).getDate();
    for (let day = 1; day <= total; day++) {
      const value = date(
        new Date(cursor.getFullYear(), cursor.getMonth(), day, 12),
      );
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = day;
      button.setAttribute(
        "aria-label",
        new Date(value + "T12:00:00").toLocaleDateString("pt-BR", {
          day: "numeric",
          month: "long",
          year: "numeric",
        }),
      );
      if (value === field.value) {
        button.className = "selected";
        button.setAttribute("aria-current", "date");
      }
      button.disabled = Boolean(
        (field.min && value < field.min) || (field.max && value > field.max),
      );
      button.onclick = () => choose(value);
      grid.append(button);
    }
    const nav = panel.querySelectorAll(".calendar-heading button");
    nav[0].onclick = () => {
      cursor.setMonth(cursor.getMonth() - 1);
      paint();
      RoutineMotion.enter(panel.querySelector(".calendar-days"), 340);
      panel.querySelector(".calendar-heading button").focus();
    };
    nav[1].onclick = () => {
      cursor.setMonth(cursor.getMonth() + 1);
      paint();
      RoutineMotion.enter(panel.querySelector(".calendar-days"), 340);
      panel.querySelectorAll(".calendar-heading button")[1].focus();
    };
    panel.querySelector(".calendar-today").onclick = () => choose(date());
    const manual = panel.querySelector(".calendar-entry");
    manual.setAttribute("aria-label", "Data em dia, mês e ano");
    const apply = () => {
      const match = manual.value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      const value = match && `${match[3]}-${match[2]}-${match[1]}`;
      if (
        !value ||
        !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        isNaN(new Date(value + "T12:00:00")) ||
        date(new Date(value + "T12:00:00")) !== value
      )
        return toast("Use uma data válida no formato DD/MM/AAAA.");
      choose(value);
    };
    manual.onkeydown = (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        apply();
      }
    };
    panel.querySelector(".calendar-apply").onclick = apply;
    grid.onkeydown = (event) => {
      const buttons = Array.from(grid.querySelectorAll("button"));
      const index = buttons.indexOf(document.activeElement);
      const offset = {
        ArrowLeft: -1,
        ArrowRight: 1,
        ArrowUp: -7,
        ArrowDown: 7,
      }[event.key];
      if (offset) {
        event.preventDefault();
        buttons[index + offset]?.focus();
      }
    };
  };
  paint();
  (
    panel.querySelector(".selected") ||
    panel.querySelector(".calendar-days button")
  )?.focus();
}
function refineControls() {
  document
    .querySelectorAll("#app select, #modal select")
    .forEach(enhanceSelect);
  document
    .querySelectorAll("#app input[type=date], #modal input[type=date]")
    .forEach(enhanceDate);
  const symbols = {
    "↗": "arrow",
    "→": "arrow",
    "←": "back",
    "▾": "down",
    "›": "chevron",
    "▷": "play",
    "✓": "check",
    "♪": "music",
  };
  document
    .querySelectorAll(
      "button, .hero-link, .daily-lanes i, .circuit-route i, .lane-icon, .plan-block span[aria-hidden], .settings-nav button > span",
    )
    .forEach((el) => {
      for (const node of Array.from(el.childNodes)) {
        if (node.nodeType !== 3 || !/[↗→←▾›▷✓♪]/.test(node.textContent))
          continue;
        const fragment = document.createDocumentFragment();
        for (const part of node.textContent.split(/([↗→←▾›▷✓♪])/)) {
          if (symbols[part]) {
            const span = document.createElement("span");
            span.className = "inline-icon";
            span.innerHTML = uiIcon(symbols[part]);
            fragment.append(span);
          } else fragment.append(document.createTextNode(part));
        }
        node.replaceWith(fragment);
      }
    });
}
document.addEventListener("pointerdown", (event) => {
  if (
    activePopover &&
    !activePopover.panel.contains(event.target) &&
    !activePopover.trigger.contains(event.target)
  )
    closeControlPopover();
});
document.addEventListener("focusin", (event) => {
  if (
    activePopover &&
    !activePopover.panel.contains(event.target) &&
    !activePopover.trigger.contains(event.target)
  )
    closeControlPopover();
});
document.addEventListener(
  "keydown",
  (event) => {
    if (event.key === "Escape" && activePopover) {
      event.preventDefault();
      event.stopPropagation();
      closeControlPopover(true);
    }
  },
  true,
);
window.addEventListener("resize", () => closeControlPopover());
document.addEventListener(
  "wheel",
  (event) => {
    if (activePopover && !activePopover.panel.contains(event.target))
      closeControlPopover();
  },
  { capture: true, passive: true },
);
document.addEventListener(
  "touchmove",
  (event) => {
    if (activePopover && !activePopover.panel.contains(event.target))
      closeControlPopover();
  },
  { capture: true, passive: true },
);

function renderMarkdownPreview(markdown) {
  const preview = document.querySelector("#reportPreview");
  if (!preview) return;
  const fragment = document.createDocumentFragment();
  let list = null;
  const formatted = (text) =>
    text.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, "$3/$2/$1");
  const inline = (element, text) => {
    for (const part of formatted(text).split(/(\*\*[^*]+\*\*)/g)) {
      if (part.startsWith("**") && part.endsWith("**")) {
        const strong = document.createElement("strong");
        strong.textContent = part.slice(2, -2);
        element.append(strong);
      } else element.append(document.createTextNode(part));
    }
  };
  for (const line of markdown.split("\n")) {
    let el;
    if (/^#{1,4} /.test(line)) {
      const level = line.match(/^#+/)[0].length;
      el = document.createElement("h" + Math.min(4, level + 1));
      el.textContent = formatted(line.replace(/^#+\s*/, ""));
      list = null;
    } else if (/^[-*] /.test(line)) {
      if (!list) {
        list = document.createElement("ul");
        fragment.append(list);
      }
      el = document.createElement("li");
      const task = line.match(/^[-*] \[([ x])\] (.*)$/i);
      if (task) {
        el.className = "report-task";
        el.setAttribute("data-done", String(task[1].toLowerCase() === "x"));
        el.setAttribute(
          "aria-label",
          (task[1].toLowerCase() === "x"
            ? "Meta cumprida: "
            : "Meta não marcada: ") + task[2],
        );
        inline(el, task[2]);
      } else inline(el, line.slice(2));
      list.append(el);
      continue;
    } else if (!line.trim()) {
      list = null;
      continue;
    } else {
      el = document.createElement("p");
      inline(el, line);
      list = null;
    }
    fragment.append(el);
  }
  RoutineMotion.swap(preview, () => preview.replaceChildren(fragment));
}
function toggleReportSource() {
  const source = document.querySelector("#reportText"),
    preview = document.querySelector("#reportPreview");
  source.hidden = !source.hidden;
  preview.hidden = !source.hidden;
  RoutineMotion.enter(source.hidden ? preview : source);
  document.querySelector("#reportSourceButton").textContent = source.hidden
    ? "Ver Markdown"
    : "Ver relatório formatado";
}
function confirmRoutine(title, description, label = "Confirmar") {
  return new Promise((resolve) => {
    openModal(
      `<h2>${esc(title)}</h2><p class="footnote">${esc(description)}</p><div class="timeractions"><button type="button" class="btn" id="decisionCancel">Voltar</button><button type="button" class="btn danger" id="decisionConfirm">${esc(label)}</button></div>`,
    );
    const modal = document.querySelector("#modal");
    let settled = false;
    const closed = () => finish(false, false);
    const finish = (result, close = true) => {
      if (settled) return;
      settled = true;
      modal.removeEventListener("close", closed);
      modal.oncancel = null;
      if (close) closeModal();
      resolve(result);
    };
    modal.addEventListener("close", closed, { once: true });
    modal.oncancel = (event) => {
      event.preventDefault();
      finish(false);
    };
    modal.querySelector("#decisionCancel").onclick = () => finish(false);
    modal.querySelector("#decisionConfirm").onclick = () => finish(true);
  });
}
