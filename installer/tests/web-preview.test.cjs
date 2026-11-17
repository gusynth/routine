const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM, VirtualConsole } = require("jsdom");
const folder = path.join(__dirname, "../web");
function open(file = "index.html") {
  const errors = [],
    posted = [];
  let receive;
  const html = fs
    .readFileSync(path.join(folder, file), "utf8")
    .replace(
      '<script src="lucide.min.js"></script>',
      () =>
        "<script>" +
        fs.readFileSync(path.join(folder, "lucide.min.js"), "utf8") +
        "</script>",
    );
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    url: "https://routine-setup.invalid/index.html",
    pretendToBeVisual: true,
    virtualConsole: new VirtualConsole().on("jsdomError", (e) =>
      errors.push(e.message),
    ),
    beforeParse(w) {
      w.chrome = {
        webview: {
          postMessage: (m) => posted.push(m),
          addEventListener: (name, fn) => (receive = fn),
        },
      };
      w.matchMedia = () => ({ matches: true });
      w.ResizeObserver = class {
        observe() {}
        disconnect() {}
      };
      w.Element.prototype.getAnimations = () => [];
      w.Element.prototype.animate = () => ({
        finished: Promise.resolve(),
        cancel() {},
      });
    },
  });
  return {
    dom,
    doc: dom.window.document,
    errors,
    posted,
    send: (message) => receive({ data: message }),
  };
}
const tick = () => new Promise((r) => setTimeout(r, 30));
test("approved typography, art and small icons render locally without network", () => {
  const { dom, doc, errors } = open();
  assert.deepEqual(errors, []);
  assert.match(doc.querySelector("h1").textContent, /Sua rotina/);
  assert.ok(doc.querySelector(".rp-footerline svg"));
  assert.ok(doc.querySelector(".rp-close svg"));
  assert.ok(
    doc.querySelector(".rp-art img").src.startsWith("data:image/png;base64,"),
  );
  assert.match(doc.querySelector("style").textContent, /font-weight:550/);
  assert.match(
    doc.querySelector("style").textContent,
    /data:font\/woff2;base64/,
  );
  assert.ok(!doc.documentElement.textContent.includes("\ufffd"));
  dom.window.close();
});
test("options preserve the page and show the full helper text in both directions", () => {
  const { dom, doc, errors } = open();
  const heading = doc.querySelector("h1"),
    toggle = doc.querySelector("#rp-options");
  toggle.click();
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.match(
    doc.querySelector(".rp-option-body").textContent,
    /Também disponível no menu Iniciar/,
  );
  toggle.click();
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.equal(doc.querySelector("h1"), heading);
  assert.deepEqual(errors, []);
  dom.window.close();
});
test("uninstall includes the original shield, backup and retention details", async () => {
  const { dom, doc, errors } = open();
  doc.querySelector('[data-mode="remove"]').click();
  await tick();
  assert.ok(doc.querySelector(".rp-retain>svg"));
  assert.ok(doc.querySelector("#rp-backup svg"));
  assert.equal(doc.querySelector("#rp-delete").checked, false);
  assert.match(
    doc.querySelector(".rp-retain").textContent,
    /Uma reinstalação encontra tudo de novo/,
  );
  assert.deepEqual(errors, []);
  dom.window.close();
});
test("deleting records is simulated and requires the animated confirmation", async () => {
  const { dom, doc, errors } = open();
  doc.querySelector('[data-mode="remove"]').click();
  await tick();
  const check = doc.querySelector("#rp-delete");
  check.checked = true;
  check.dispatchEvent(new dom.window.Event("change"));
  doc.querySelector("#rp-primary").click();
  await tick();
  assert.equal(doc.querySelector(".rp-dialog-host").hidden, false);
  assert.match(
    doc.querySelector(".rp-dialog").textContent,
    /Apagar também seus registros/,
  );
  doc.querySelector("#rp-dialog-back").click();
  await tick();
  assert.equal(doc.querySelector(".rp-dialog-host").hidden, true);
  assert.deepEqual(errors, []);
  dom.window.close();
});

const state = (view, extra = {}) => ({
  type: "state",
  view,
  initial: true,
  removing: false,
  folder: "C:\\Routine-test",
  ...extra,
});
test("production sends actual choices to the restricted bridge without simulating install", async () => {
  const { dom, doc, errors, posted, send } = open("setup.html");
  assert.equal(posted[0].action, "ready");
  send(state("welcome"));
  await tick();
  doc.querySelector("#rp-options").click();
  doc.querySelector("#rp-folder").value = "C:\\Own folder\\Routine";
  doc.querySelector("#rp-desktop").checked = false;
  doc
    .querySelector("#rp-desktop")
    .dispatchEvent(new dom.window.Event("change"));
  doc.querySelector("#rp-primary").click();
  assert.deepEqual(JSON.parse(JSON.stringify(posted.at(-1))), {
    action: "primary",
    folder: "C:\\Own folder\\Routine",
    desktop: false,
    deleteData: false,
  });
  assert.match(doc.querySelector("h1").textContent, /Sua rotina/);
  assert.deepEqual(errors, []);
  dom.window.close();
});
test("production progress and success are driven only by native state", async () => {
  const { dom, doc, errors, send } = open("setup.html");
  send(state("progress"));
  await tick();
  send({
    type: "progress",
    label: "Verificando os arquivos reais",
    fraction: 0.42,
  });
  assert.equal(doc.querySelector("#rp-percent").textContent, "42%");
  assert.equal(
    doc.querySelector("#rp-status").textContent,
    "Verificando os arquivos reais",
  );
  send(state("success"));
  await tick();
  assert.match(doc.querySelector("h1").textContent, /Seu espaço/);
  assert.match(
    doc.querySelector("#rp-again").textContent,
    /Concluir sem abrir/,
  );
  assert.deepEqual(errors, []);
  dom.window.close();
});
test("production destructive confirmation returns a matching token and cancellation", async () => {
  const { dom, doc, errors, posted, send } = open("setup.html");
  send(state("welcome", { removing: true }));
  await tick();
  assert.equal(doc.querySelector("#rp-delete").checked, false);
  send({
    type: "dialog",
    id: "unique-confirmation",
    title: "Apagar registros?",
    description: "Ação permanente.",
    action: "Apagar",
    danger: true,
  });
  assert.equal(doc.querySelector(".rp-dialog-host").hidden, false);
  doc.querySelector("#rp-dialog-back").click();
  await tick();
  assert.deepEqual(JSON.parse(JSON.stringify(posted.at(-1))), {
    action: "answer",
    id: "unique-confirmation",
    accept: false,
  });
  assert.deepEqual(errors, []);
  dom.window.close();
});
test("native error strings render as text rather than executable markup", async () => {
  const { dom, doc, errors, send } = open("setup.html");
  send(
    state("error", {
      title: "Falha <img src=x>",
      description: "<script>broken()</script>",
      code: "R-IN-003",
    }),
  );
  await tick();
  assert.equal(doc.querySelector("h1").textContent, "Falha <img src=x>");
  assert.equal(doc.querySelector("h1 img"), null);
  assert.equal(doc.querySelector(".rp-status-code").textContent, "R-IN-003");
  assert.deepEqual(errors, []);
  dom.window.close();
});

test("installed versions show update or repair and keep the registered folder fixed", async () => {
  const { dom, doc, send } = open("setup.html");
  send(
    state("welcome", {
      installedVersion: "0.9.0",
      version: "1.0.0",
      installAction: "update",
    }),
  );
  await tick();
  assert.match(
    doc.querySelector("#rp-primary").textContent,
    /Atualizar Routine/,
  );
  assert.match(doc.querySelector(".rp-copy>p").textContent, /0.9.0.*1.0.0/);
  assert.equal(doc.querySelector("#rp-folder").readOnly, true);
  assert.equal(doc.querySelector("#rp-browse").hidden, true);
  send(
    state("welcome", {
      installedVersion: "1.0.0",
      version: "1.0.0",
      installAction: "repair",
    }),
  );
  await tick();
  assert.match(doc.querySelector("#rp-primary").textContent, /Reparar Routine/);
  send(
    state("welcome", {
      installedVersion: "1.3.0",
      version: "1.0.0",
      installAction: "downgrade",
    }),
  );
  await tick();
  assert.match(
    doc.querySelector("#rp-primary").textContent,
    /Instalar esta versão/,
  );
  dom.window.close();
});
