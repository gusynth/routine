function exerciseKey(e) {
  return (
    e.name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase() +
    "|" +
    e.block +
    "|" +
    e.type
  );
}
function exerciseSessions(key, cycleId = "all") {
  return state.history
    .filter((h) => cycleId === "all" || h.cycleId === cycleId)
    .map((h) => {
      const results = h.results.filter(
        (r) => exerciseKey(r) === key && !r.estimated,
      );
      if (!results.length) return null;
      return {
        date: h.date,
        started: h.started,
        cycle: h.cycleName,
        average: results.reduce((n, r) => n + r.actual, 0) / results.length,
        results,
        meta: [...new Set(results.map((r) => r.target))].join(", "),
        id: h.id,
      };
    })
    .filter(Boolean)
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.started - b.started ||
        a.id.localeCompare(b.id),
    );
}
function previousExerciseReference(e) {
  if (cache.get("show-previous") === false) return "";
  const previous = exerciseSessions(exerciseKey(e)).at(-1);
  if (!previous) return "";
  return `<details class="sequence-panel previous-reference"><summary>Última sessão · ${esc(previous.date)}</summary><p class="footnote">${previous.results.map((r) => `Série ${r.series}: ${r.actual}${e.type === "time" ? "s" : " reps"} (meta ${esc(r.target)})`).join("<br>")}</p><p class="footnote">Referência opcional; mantenha seu ritmo.${previous.meta !== e.target ? " A meta mudou desde essa sessão." : ""}</p></details>`;
}
function renderInsights() {
  const keys = [
    ...new Map(
      state.history.flatMap((h) =>
        h.results.filter((r) => !r.estimated).map((r) => [exerciseKey(r), r]),
      ),
    ).entries(),
  ];
  $("#app").insertAdjacentHTML(
    "beforeend",
    `<section class="card insights"><h2>Evolução por exercício</h2><p class="footnote">Média realizada por série em cada sessão, usando somente resultados confirmados. Mudanças de meta, descanso ou execução podem alterar a comparação.</p><div class="formgrid"><div><label for="insightExercise">Exercício</label><select id="insightExercise">${keys.map(([key, e]) => `<option value="${esc(key)}">${esc(e.name)} · ${e.type === "time" ? "segundos" : "repetições"} · ${esc(e.block)}</option>`).join("")}</select></div><div><label for="insightCycle">Ciclo</label><select id="insightCycle"><option value="all">Todos os ciclos</option>${state.cycles.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select></div></div><div id="insightChart"></div></section>`,
  );
  $("#insightExercise").onchange = paintInsights;
  $("#insightCycle").onchange = paintInsights;
  paintInsights();
}
function paintInsights() {
  const key = $("#insightExercise").value,
    points = exerciseSessions(key, $("#insightCycle").value).slice(-30),
    unit = key.endsWith("|time") ? "s" : "reps";
  if (!points.length) {
    $("#insightChart").innerHTML =
      '<p class="empty">Ainda não há resultados confirmados neste filtro.</p>';
    return;
  }
  const max = Math.max(1, ...points.map((p) => p.average));
  const coords = points.map((p, i) => [
    20 + (i * 560) / Math.max(1, points.length - 1),
    150 - (p.average / max) * 120,
  ]);
  const previous = points.at(-2),
    current = points.at(-1),
    delta = previous ? current.average - previous.average : 0;
  $("#insightChart").innerHTML =
    `<p class="footnote">Última sessão: <b>${current.average.toFixed(1)} ${unit}/série</b>${previous ? ` · variação de ${delta > 0 ? "+" : ""}${delta.toFixed(1)} ${unit}/série em relação à anterior${current.meta !== previous.meta ? " · meta alterada" : ""}` : " · registre outra sessão para comparar"}</p><svg class="trend-chart" viewBox="0 0 600 180" role="img" aria-label="Média realizada por série nas últimas ${points.length} sessões; valores na tabela abaixo"><path d="M20 150H580" stroke="#8295bb55" fill="none"/><polyline points="${coords.map((p) => p.join(",")).join(" ")}" fill="none" stroke="#9fb1ff" stroke-width="3"/>${coords.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="4" fill="#a8baff"><title>${points[i].date}: ${points[i].average.toFixed(1)} ${unit}/série</title></circle>`).join("")}</svg><details><summary>Ver valores e metas</summary><div class="table-scroll"><table><thead><tr><th>Data</th><th>Ciclo</th><th>Média/série</th><th>Meta</th></tr></thead><tbody>${points.map((p) => `<tr><td>${p.date}</td><td>${esc(p.cycle)}</td><td>${p.average.toFixed(1)} ${unit}</td><td>${esc(p.meta)}</td></tr>`).join("")}</tbody></table></div></details>`;
}
function reportComparison(start, end) {
  const first = new Date(start + "T12:00:00"),
    last = new Date(end + "T12:00:00");
  let previousStart, previousEnd;
  if (reportRange === "month") {
    previousStart = date(
      new Date(first.getFullYear(), first.getMonth() - 1, 1),
    );
    previousEnd = date(new Date(first.getFullYear(), first.getMonth(), 0));
  } else {
    const length = Math.round((last - first) / 86400000) + 1;
    const d = new Date(first);
    d.setDate(d.getDate() - 1);
    previousEnd = date(d);
    d.setDate(d.getDate() - length + 1);
    previousStart = date(d);
  }
  const now = state.history.filter((h) => h.date >= start && h.date <= end),
    before = state.history.filter(
      (h) => h.date >= previousStart && h.date <= previousEnd,
    );
  let text = `\n\n## Comparação com o período anterior\nAnterior: ${previousStart} a ${previousEnd}\nSessões: ${now.length} no período atual vs ${before.length} no anterior. Ausência de registros não significa ausência de treino.\n`;
  const keys = new Set(
    now.flatMap((h) => h.results.filter((r) => !r.estimated).map(exerciseKey)),
  );
  for (const key of keys) {
    const collect = (hs) =>
        hs.flatMap((h) =>
          h.results.filter((r) => !r.estimated && exerciseKey(r) === key),
        ),
      a = collect(now),
      b = collect(before);
    if (!b.length) continue;
    const avg = (rs) => rs.reduce((n, r) => n + r.actual, 0) / rs.length;
    const changed =
      [...new Set(a.map((r) => r.target))].join("|") !==
      [...new Set(b.map((r) => r.target))].join("|");
    text += `- ${a[0].name}: média ${avg(a).toFixed(1)} vs ${avg(b).toFixed(1)} ${a[0].type === "time" ? "s" : "reps"}/série${changed ? "; meta alterada — comparação com contexto" : ""}.\n`;
  }
  return (
    text +
    "\n### Percepções registradas\n" +
    (now
      .filter((h) => h.notes)
      .map((h) => `- ${h.date}: ${h.notes}`)
      .join("\n") || "Sem observações no período.") +
    "\n"
  );
}
