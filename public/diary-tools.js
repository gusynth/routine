let diaryAutoTimer;
function scheduleDiaryAutosave() {
  clearTimeout(diaryAutoTimer);
  const day = mealDate;
  diaryAutoTimer = setTimeout(() => flushDiaryAutosave(day), 1500);
}
async function flushDiaryAutosave(day = mealDate) {
  if (page !== "diary" || mealDate !== day || !diaryDirty) return;
  if (busy || $("#modal").open) {
    scheduleDiaryAutosave();
    return;
  }
  if (!same(state.diary[day] || null, diaryBase)) {
    $("#diarySaveStatus").textContent =
      "Este dia mudou na rede. Toque em Salvar rascunho para revisar.";
    return;
  }
  await saveDiary("draft", true);
}
function shiftDiaryDay(offset) {
  const d = new Date(mealDate + "T12:00:00");
  d.setDate(d.getDate() + offset);
  changeDiaryDate(date(d));
}
function enhanceDiary() {
  const dateField = $("#mealDate");
  dateField.insertAdjacentHTML(
    "afterend",
    `<div class="diary-date-tools"><button type="button" class="btn small" aria-label="Dia anterior" title="Dia anterior" onclick="shiftDiaryDay(-1)">${uiIcon("back")}</button><button type="button" class="btn small" onclick="changeDiaryDate(date())">Hoje</button><button type="button" class="btn small" aria-label="Próximo dia" title="Próximo dia" onclick="shiftDiaryDay(1)">${uiIcon("arrow")}</button></div><details class="sequence-panel"><summary>Dias registrados</summary><div class="diary-date-tools">${
      Object.entries(state.diary)
        .sort(([a], [b]) => b.localeCompare(a))
        .slice(0, 31)
        .map(
          ([day, entry]) =>
            `<button type="button" class="btn small" onclick="changeDiaryDate('${day}')">${day.split("-").reverse().join("/")} · ${entry.status === "complete" ? "Finalizado" : "Rascunho"}</button>`,
        )
        .join("") || '<p class="footnote">Nenhum dia salvo ainda.</p>'
    }</div></details>`,
  );
  document
    .querySelectorAll(".meal-card")
    .forEach((card, index) =>
      card.insertAdjacentHTML(
        "beforeend",
        `<div class="meal-tools"><details class="meal-reuse"><summary>Reutilizar refeição</summary><div class="meal-reuse-actions"><button type="button" class="btn small" onclick="chooseFavorite(${index})">Usar refeição salva</button><button type="button" class="btn small" onclick="copyMealDay(${index})">Trazer de outra data</button><button type="button" class="btn small" onclick="favoriteMeal(${index})">Salvar como favorita</button></div></details></div>`,
      ),
    );
  const form = $("#diaryForm"),
    mealGrid = form.querySelector(".formgrid"),
    calendar = document.createElement("section"),
    entries = document.createElement("div");
  calendar.className = "diary-calendar";
  calendar.setAttribute("aria-label", "Data e salvamento do diário");
  entries.className = "diary-entries";
  while (form.firstElementChild !== mealGrid)
    calendar.append(form.firstElementChild);
  while (form.firstElementChild) entries.append(form.firstElementChild);
  form.append(calendar, entries);
  $("#app").insertAdjacentHTML("beforeend", aiExplanation());
  if (diaryDirty) scheduleDiaryAutosave();
}
function favoriteMeal(index) {
  const text = $("#meal" + index)?.value;
  if (!text?.trim()) return toast("Preencha a refeição antes de favoritar.");
  openModal(
    `<h2>Salvar refeição favorita</h2><label for="favoriteName">Nome</label><input id="favoriteName" maxlength="100" value="${esc(meals[index])}"><label>Refeição</label><p class="backup-preview">${esc(text)}</p><div class="timeractions"><button class="btn" onclick="closeModal()">Voltar</button><button class="btn primary" id="saveFavorite">Salvar favorito</button></div>`,
  );
  $("#saveFavorite").onclick = async () => {
    if (busy) return;
    const name = $("#favoriteName").value.trim();
    if (!name) return toast("Informe um nome.");
    if ((state.favorites || []).length >= 100)
      return toast("Limite de 100 favoritos. Remova um antes de criar outro.");
    const next = clone(state);
    next.favorites = [...(next.favorites || []), { id: id(), name, text }];
    if (await save(next)) {
      closeModal();
      toast("Refeição favorita salva.");
    }
  };
}
function chooseFavorite(index) {
  openModal(
    `<h2>Refeições favoritas</h2><div class="backup-list">${(state.favorites || []).map((f) => `<div class="line"><b>${esc(f.name)}</b><p class="backup-preview">${esc(f.text)}</p><div class="meal-tools"><button class="btn small" data-use-favorite="${f.id}">Conferir uso</button><button class="btn small danger" data-remove-favorite="${f.id}">Remover favorito</button></div></div>`).join("") || '<p class="empty">Use Favoritar em uma refeição preenchida.</p>'}</div><button class="btn" onclick="closeModal()">Voltar</button>`,
  );
  document.querySelectorAll("[data-use-favorite]").forEach(
    (button) =>
      (button.onclick = () => {
        const f = state.favorites.find(
          (f) => f.id === button.dataset.useFavorite,
        );
        previewMeal(index, f.text, f.name);
      }),
  );
  document.querySelectorAll("[data-remove-favorite]").forEach(
    (button) =>
      (button.onclick = async () => {
        const next = clone(state);
        next.favorites = next.favorites.filter(
          (f) => f.id !== button.dataset.removeFavorite,
        );
        if (await save(next)) chooseFavorite(index);
      }),
  );
}
function previewMeal(index, text, source) {
  const day = mealDate;
  openModal(
    `<h2>Conferir refeição</h2><p class="footnote">${esc(source)} → ${esc(meals[index])}. Substitui apenas esta refeição; o restante do dia será preservado.</p><label>Texto atual</label><p class="backup-preview">${esc($("#meal" + index).value || "Em branco")}</p><label>Texto a usar</label><p class="backup-preview">${esc(text)}</p><div class="timeractions"><button class="btn" onclick="closeModal()">Voltar</button><button class="btn primary" id="applyMeal">Usar nesta refeição</button></div>`,
  );
  $("#applyMeal").onclick = () => {
    if (mealDate !== day || !$("#meal" + index))
      return toast("A data mudou. Reabra a prévia.");
    $("#meal" + index).value = text;
    $("#meal" + index).dispatchEvent(new Event("input", { bubbles: true }));
    closeModal();
  };
}
function copyMealDay(index) {
  openModal(
    `<h2>Copiar ${esc(meals[index])}</h2><label for="sourceMealDay">Dia de origem</label><input id="sourceMealDay" type="date" value="${mealDate}"><div class="timeractions"><button class="btn" onclick="closeModal()">Voltar</button><button class="btn primary" id="previewMealDay">Conferir refeição</button></div>`,
  );
  $("#previewMealDay").onclick = () => {
    const day = $("#sourceMealDay").value,
      text = state.diary[day]?.meals?.[meals[index]];
    if (!text?.trim())
      return toast("Essa refeição não está registrada nessa data.");
    previewMeal(index, text, day);
  };
}
