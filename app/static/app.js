"use strict";

const $ = (id) => document.getElementById(id);
const state = {
  pin: sessionStorageGet("pin") || "",
  config: { pin_required: false },
  quiz: null,
  detailId: null,
};

function sessionStorageGet(k) { try { return sessionStorage.getItem(k); } catch { return null; } }
function sessionStorageSet(k, v) { try { sessionStorage.setItem(k, v); } catch { /* egal */ } }

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || "GET",
    headers: { "Content-Type": "application/json", "X-Admin-Pin": state.pin },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).detail || msg; } catch { /* egal */ }
    const err = new Error(typeof msg === "string" ? msg : "Fehler");
    err.status = res.status;
    throw err;
  }
  return res.json();
}

function el(tag, props = {}, ...children) {
  const e = document.createElement(tag);
  Object.assign(e, props);
  for (const c of children) e.append(c);
  return e;
}

function show(view) {
  document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
  $("view-" + view).classList.remove("hidden");
  const tab = { learnlist: "learn", quiz: "start", round: "start" }[view] || view;
  document.querySelectorAll(".nav").forEach((b) => b.classList.toggle("active", b.dataset.view === tab));
}

function msg(id, text, ok = false) {
  const m = $(id);
  m.textContent = text || "";
  m.classList.toggle("ok", ok);
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ------------------------------------------------------------ Auswahl
let lastSelection = [];

async function renderSetList(listId, emptyId) {
  const sets = await api("/api/sets");
  const list = $(listId);
  list.replaceChildren();
  $(emptyId).classList.toggle("hidden", sets.length > 0);
  for (const s of sets) {
    const cb = el("input", { type: "checkbox", value: s.id, checked: lastSelection.includes(s.id) });
    cb.onchange = () => { lastSelection = selectedIds(listId); };
    cb.dataset.name = s.name;
    const info = s.difficult ? ` · ${s.difficult} mit Übungsbedarf` : "";
    list.append(el("label", { className: "set-item" }, cb,
      el("span", { className: "set-name", textContent: s.name }),
      el("span", { className: "muted small", textContent: `${s.count} Wörter${info}` })));
  }
}

function selectedIds(listId) {
  return [...document.querySelectorAll(`#${listId} input:checked`)].map((b) => +b.value);
}

function toggleAll(listId) {
  const boxes = [...document.querySelectorAll(`#${listId} input`)];
  const all = boxes.every((b) => b.checked);
  boxes.forEach((b) => (b.checked = !all));
  lastSelection = selectedIds(listId);
}

async function loadStart() {
  show("start");
  msg("start-msg", "");
  await renderSetList("set-list", "no-sets");
}

$("btn-all").onclick = () => toggleAll("set-list");

$("btn-start").onclick = async () => {
  const boxes = [...document.querySelectorAll("#set-list input:checked")];
  if (!boxes.length) return msg("start-msg", "Bitte mindestens einen Vokabelsatz auswählen.");
  await startQuiz(boxes.map((b) => +b.value), boxes.map((b) => b.dataset.name),
    $("opt-difficult").checked, $("opt-shuffle").checked, "start-msg");
};

async function startQuiz(setIds, setNames, onlyDifficult, doShuffle, msgId) {
  const words = await api("/api/quiz", {
    method: "POST",
    body: { set_ids: setIds, only_difficult: onlyDifficult },
  });
  if (!words.length) {
    return msg(msgId, onlyDifficult
      ? "Super – in diesen Sätzen gibt es gerade keine Wörter mit Übungsbedarf! 🎉"
      : "Diese Sätze enthalten noch keine Vokabeln.");
  }
  const order = doShuffle ? shuffle(words) : words;
  state.quiz = {
    setNames,
    total: words.length,
    round: 1,
    queue: order,
    index: 0,
    wrong: [],
    firstTryCorrect: 0,
    answered: false,
  };
  show("quiz");
  showQuestion();
}

// ------------------------------------------------------------ Lernen
async function loadLearn() {
  show("learn");
  msg("learn-msg", "");
  await renderSetList("learn-set-list", "learn-no-sets");
}

$("learn-all").onclick = () => toggleAll("learn-set-list");

$("learn-go").onclick = async () => {
  const ids = selectedIds("learn-set-list");
  if (!ids.length) return msg("learn-msg", "Bitte mindestens eine Unit auswählen.");
  const words = await api("/api/learn", { method: "POST", body: { set_ids: ids, only_difficult: $("learn-difficult").checked } });
  if (!words.length) {
    return msg("learn-msg", $("learn-difficult").checked
      ? "In diesen Units gibt es gerade keine Wörter mit Übungsbedarf! 🎉"
      : "Diese Units enthalten noch keine Vokabeln.");
  }
  state.learn = { ids, names: [...new Set(words.map((w) => w.set_name))], words };
  renderLearnList();
  show("learnlist");
  window.scrollTo(0, 0);
};

function renderLearnList() {
  const { words } = state.learn;
  const box = $("learn-list");
  box.replaceChildren();
  let current = null, table = null;
  for (const w of words) {
    if (w.set_id !== current) {
      current = w.set_id;
      table = el("div", { className: "learn-table" });
      box.append(el("h3", { textContent: `${w.set_name}` }), table);
    }
    const de = el("span", { className: "learn-de cover-de", textContent: w.de });
    const en = el("span", { className: "learn-en cover-en", textContent: w.en });
    for (const c of [de, en]) c.onclick = () => c.classList.toggle("revealed");
    table.append(el("div", { className: "learn-row" + (w.difficult ? " need" : "") },
      el("span", { className: "dot", textContent: w.difficult ? "🔴" : "", title: w.difficult ? "Übungsbedarf" : "" }),
      de, en));
  }
  applyCover();
}

function applyCover() {
  $("learn-list").classList.toggle("hide-en", $("learn-hide").checked);
  $("learn-list").classList.toggle("hide-de", $("learn-hide-de").checked);
  document.querySelectorAll("#learn-list .revealed").forEach((e) => e.classList.remove("revealed"));
}

$("learn-hide").onchange = () => { if ($("learn-hide").checked) $("learn-hide-de").checked = false; applyCover(); };
$("learn-hide-de").onchange = () => { if ($("learn-hide-de").checked) $("learn-hide").checked = false; applyCover(); };
$("learn-reveal").onclick = () => document.querySelectorAll("#learn-list .learn-de, #learn-list .learn-en")
  .forEach((e) => e.classList.add("revealed"));
$("learn-back").onclick = loadLearn;
$("learn-quiz").onclick = () => startQuiz(state.learn.ids, state.learn.names, $("learn-difficult").checked, true, "learn-msg")
  .then(() => { if (!state.quiz) show("learn"); });

// ------------------------------------------------------------ Abfrage
function showQuestion() {
  const q = state.quiz;
  const w = q.queue[q.index];
  $("round-label").textContent = q.round === 1 ? "Durchgang 1" : `Wiederholung ${q.round - 1}`;
  $("count-label").textContent = `${q.index + 1} / ${q.queue.length}`;
  $("progress-bar").style.width = `${(q.index / q.queue.length) * 100}%`;
  $("q-set").textContent = q.setNames.length > 1 ? w.set_name : "";
  $("q-de").textContent = w.de;
  const input = $("q-answer");
  input.value = "";
  input.readOnly = false;
  input.className = "";
  $("feedback").classList.add("hidden");
  $("btn-check").classList.remove("hidden");
  $("btn-next").classList.add("hidden");
  q.answered = false;
  input.focus();
}

function renderDiff(ops) {
  // Zeile 1: Was eingegeben wurde (Fehler rot). Zeile 2: Richtig (Korrektur grün).
  const yours = el("div", { className: "diff-line" }, el("span", { className: "diff-label", textContent: "Deine Antwort:" }));
  const right = el("div", { className: "diff-line" }, el("span", { className: "diff-label", textContent: "Richtig:" }));
  const yw = el("span", { className: "diff-word" });
  const rw = el("span", { className: "diff-word" });
  for (const o of ops) {
    if (o.op === "eq") {
      yw.append(el("span", { textContent: o.a }));
      rw.append(el("span", { textContent: o.b }));
    } else if (o.op === "sub") {
      yw.append(el("span", { className: "bad", textContent: o.a }));
      rw.append(el("span", { className: "fix", textContent: o.b }));
    } else if (o.op === "extra") {
      yw.append(el("span", { className: "bad strike", textContent: o.a === " " ? "␣" : o.a }));
    } else if (o.op === "missing") {
      yw.append(el("span", { className: "gap", textContent: "_" }));
      rw.append(el("span", { className: "fix", textContent: o.b === " " ? "␣" : o.b }));
    }
  }
  if (!yw.childNodes.length) yw.append(el("span", { className: "muted", textContent: "(leer)" }));
  yours.append(yw);
  right.append(rw);
  return [yours, right];
}

async function checkAnswer() {
  const q = state.quiz;
  if (!q || q.answered || q.checking) return;
  const input = $("q-answer");
  const w = q.queue[q.index];
  q.checking = true;
  let res;
  try {
    res = await api("/api/check", {
      method: "POST",
      body: { word_id: w.id, answer: input.value, first_try: q.round === 1 },
    });
  } finally {
    q.checking = false;
  }
  q.answered = true;
  input.readOnly = true; // Tastatur bleibt auf dem Handy offen, Enter geht zum nächsten Wort
  const fb = $("feedback");
  fb.replaceChildren();
  fb.classList.remove("hidden", "good", "badbox");
  if (res.correct) {
    if (q.round === 1) q.firstTryCorrect++;
    input.className = "is-correct";
    fb.classList.add("good");
    fb.append(el("div", { className: "fb-title", textContent: pick(["Richtig! 🎉", "Super! ⭐", "Klasse! 👍", "Genau! ✅"]) }));
    if (res.hint) fb.append(el("div", { className: "small", textContent: res.hint }));
    if (res.expected.includes("/")) fb.append(el("div", { className: "small muted", textContent: `Möglich: ${res.expected}` }));
  } else {
    q.wrong.push(w);
    input.className = "is-wrong";
    fb.classList.add("badbox");
    fb.append(el("div", { className: "fb-title", textContent: input.value.trim() ? "Leider nicht ganz." : "Nicht gewusst?" }));
    fb.append(...renderDiff(res.diff));
    if (res.expected.includes("/") || res.expected.includes("(")) {
      fb.append(el("div", { className: "small muted", textContent: `Eingetragen ist: ${res.expected}` }));
    }
    fb.append(el("div", { className: "small muted", textContent: "Dieses Wort kommt nachher nochmal dran." }));
  }
  $("btn-check").classList.add("hidden");
  $("btn-next").classList.remove("hidden");
  input.focus();
}

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function nextQuestion() {
  const q = state.quiz;
  q.index++;
  if (q.index < q.queue.length) return showQuestion();
  $("progress-bar").style.width = "100%";
  endRound();
}

function endRound() {
  const q = state.quiz;
  show("round");
  const list = $("round-wrong");
  list.replaceChildren();
  if (q.wrong.length === 0) {
    $("round-emoji").textContent = q.round === 1 ? "🏆" : "🎉";
    $("round-title").textContent = q.round === 1 ? "Alles beim ersten Mal richtig!" : "Geschafft – jetzt sitzen alle Wörter!";
    $("round-text").textContent = `${q.firstTryCorrect} von ${q.total} Wörtern waren beim ersten Versuch richtig.`;
    $("btn-repeat").classList.add("hidden");
    $("btn-done").classList.remove("hidden");
    api("/api/finish", {
      method: "POST",
      body: { set_names: q.setNames, total: q.total, first_try_correct: q.firstTryCorrect, rounds: q.round },
    }).catch(() => {});
  } else {
    $("round-emoji").textContent = "💪";
    $("round-title").textContent = q.round === 1 ? "Erster Durchgang geschafft!" : "Fast geschafft!";
    $("round-text").textContent = q.round === 1
      ? `${q.firstTryCorrect} von ${q.total} richtig. ${q.wrong.length === 1 ? "Dieses Wort" : `Diese ${q.wrong.length} Wörter`} üben wir nochmal:`
      : `Noch ${q.wrong.length} ${q.wrong.length === 1 ? "Wort" : "Wörter"} zum Wiederholen:`;
    for (const w of q.wrong) list.append(el("li", { textContent: w.de }));
    $("btn-repeat").classList.remove("hidden");
    $("btn-done").classList.add("hidden");
  }
}

$("btn-repeat").onclick = () => {
  const q = state.quiz;
  q.queue = shuffle([...q.wrong]);
  q.wrong = [];
  q.index = 0;
  q.round++;
  show("quiz");
  showQuestion();
};
$("btn-done").onclick = () => { state.quiz = null; loadStart(); };
$("btn-check").onclick = checkAnswer;
$("btn-next").onclick = nextQuestion;
$("btn-quit").onclick = () => { if (confirm("Abfrage wirklich abbrechen?")) { state.quiz = null; loadStart(); } };
$("q-answer").addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  if (state.quiz && state.quiz.answered) nextQuestion(); else checkAnswer();
});

// ------------------------------------------------------------ Verwaltung
async function loadAdmin() {
  show("admin");
  $("set-detail").classList.add("hidden");
  if (state.config.pin_required && !state.pin) {
    $("pin-box").classList.remove("hidden");
    $("admin-main").classList.add("hidden");
    $("pin-input").focus();
    return;
  }
  $("pin-box").classList.add("hidden");
  $("admin-main").classList.remove("hidden");
  const sets = await api("/api/sets");
  fillImportTargets(sets);
  const box = $("admin-sets");
  box.replaceChildren();
  if (!sets.length) box.append(el("p", { className: "muted", textContent: "Noch keine Sätze." }));
  for (const s of sets) {
    const btn = el("button", { className: "secondary", textContent: "Bearbeiten" });
    btn.onclick = () => openSet(s.id);
    box.append(el("div", { className: "admin-set" },
      el("div", {}, el("div", { className: "set-name", textContent: s.name }),
        el("div", { className: "muted small", textContent: `${s.count} Wörter · ${s.difficult} mit Übungsbedarf` })),
      btn));
  }
}

$("btn-pin").onclick = async () => {
  state.pin = $("pin-input").value;
  try {
    await api("/api/admin/login", { method: "POST" });
    sessionStorageSet("pin", state.pin);
    $("pin-input").value = "";
    msg("pin-msg", "");
    loadAdmin();
  } catch {
    state.pin = "";
    msg("pin-msg", "Falsche PIN.");
  }
};
$("pin-input").addEventListener("keydown", (e) => { if (e.key === "Enter") $("btn-pin").click(); });

function reportAdded(id, res) {
  let t = `${res.added} Vokabel${res.added === 1 ? "" : "n"} gespeichert.`;
  if (res.errors.length) t += " Nicht übernommen: " + res.errors.join(" | ");
  msg(id, t, !res.errors.length);
}

$("btn-create").onclick = async () => {
  const name = $("new-name").value.trim();
  if (!name) return msg("create-msg", "Bitte einen Namen eingeben.");
  const res = await api("/api/sets", { method: "POST", body: { name, text: $("new-text").value } });
  $("new-name").value = "";
  $("new-text").value = "";
  await loadAdmin();
  reportAdded("create-msg", res);
};

async function openSet(id) {
  state.detailId = id;
  const data = await api(`/api/sets/${id}/words`);
  $("admin-main").classList.add("hidden");
  $("set-detail").classList.remove("hidden");
  $("detail-name").value = data.name;
  msg("detail-msg", "");
  const tbody = $("detail-words");
  tbody.replaceChildren();
  for (const w of data.words) tbody.append(wordRow(w));
  if (!data.words.length) tbody.append(el("tr", {}, el("td", { colSpan: 4, className: "muted", textContent: "Noch keine Vokabeln." })));
}

function wordRow(w) {
  const de = el("input", { type: "text", value: w.de });
  const en = el("input", { type: "text", value: w.en });
  const save = el("button", { className: "icon", title: "Speichern", textContent: "💾" });
  const del = el("button", { className: "icon", title: "Löschen", textContent: "🗑️" });
  save.onclick = async () => {
    await api(`/api/words/${w.id}`, { method: "PUT", body: { de: de.value, en: en.value } });
    msg("detail-msg", "Gespeichert.", true);
  };
  del.onclick = async () => {
    if (!confirm(`„${w.de}“ löschen?`)) return;
    await api(`/api/words/${w.id}`, { method: "DELETE" });
    openSet(state.detailId);
  };
  const stat = el("td", { className: "small" + (w.last_result === 0 ? " need" : ""),
    textContent: `${w.correct} / ${w.wrong}`, title: w.last_result === 0 ? "Übungsbedarf" : "" });
  return el("tr", {}, el("td", {}, de), el("td", {}, en), stat, el("td", { className: "nowrap" }, save, del));
}

$("btn-back").onclick = loadAdmin;
$("btn-rename").onclick = async () => {
  await api(`/api/sets/${state.detailId}`, { method: "PUT", body: { name: $("detail-name").value } });
  msg("detail-msg", "Name gespeichert.", true);
};
$("btn-add").onclick = async () => {
  const res = await api(`/api/sets/${state.detailId}/words`, { method: "POST", body: { text: $("add-text").value } });
  $("add-text").value = "";
  await openSet(state.detailId);
  reportAdded("detail-msg", res);
};
$("btn-delete-set").onclick = async () => {
  if (!confirm(`Den ganzen Satz „${$("detail-name").value}“ mit allen Vokabeln löschen?`)) return;
  await api(`/api/sets/${state.detailId}`, { method: "DELETE" });
  loadAdmin();
};

// ------------------------------------------------------------ Import (Foto / JSON)
let photos = [];

function fillImportTargets(sets) {
  const sel = $("import-target");
  const keep = sel.value;
  sel.replaceChildren(el("option", { value: "", textContent: "➕ Neuer Vokabelsatz" }));
  for (const s of sets) sel.append(el("option", { value: s.id, textContent: `an „${s.name}“ anhängen` }));
  if ([...sel.options].some((o) => o.value === keep)) sel.value = keep;
  $("import-name").classList.toggle("hidden", sel.value !== "");
  $("photo-area").classList.toggle("hidden", !state.config.ai_import);
  $("photo-off").classList.toggle("hidden", !!state.config.ai_import);
}
$("import-target").onchange = () => $("import-name").classList.toggle("hidden", $("import-target").value !== "");

async function shrinkImage(file) {
  // Handyfotos verkleinern (lange Kante max. 2000 px) – spart Upload und API-Kosten
  const img = await createImageBitmap(file);
  const scale = Math.min(1, 2000 / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * scale);
  c.height = Math.round(img.height * scale);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  const url = c.toDataURL("image/jpeg", 0.85);
  return { media_type: "image/jpeg", data: url.split(",")[1], preview: url };
}

$("photo-input").onchange = async (e) => {
  msg("import-msg", "");
  for (const f of e.target.files) {
    try { photos.push(await shrinkImage(f)); } catch { msg("import-msg", `„${f.name}“ konnte nicht gelesen werden.`); }
  }
  e.target.value = "";
  renderThumbs();
};

function renderThumbs() {
  const box = $("photo-thumbs");
  box.replaceChildren();
  photos.forEach((p, i) => {
    const x = el("button", { className: "thumb-x", title: "Entfernen", textContent: "✕" });
    x.onclick = () => { photos.splice(i, 1); renderThumbs(); };
    box.append(el("div", { className: "thumb" }, el("img", { src: p.preview }), x));
  });
  $("btn-recognize").classList.toggle("hidden", !photos.length);
  $("btn-recognize").textContent = photos.length > 1 ? `Vokabeln aus ${photos.length} Fotos erkennen` : "Vokabeln erkennen";
}

$("btn-recognize").onclick = async () => {
  const btn = $("btn-recognize");
  btn.disabled = true;
  btn.textContent = "⏳ KI liest die Vokabeln …";
  msg("import-msg", "");
  try {
    const res = await api("/api/import/photo", {
      method: "POST",
      body: { images: photos.map(({ media_type, data }) => ({ media_type, data })) },
    });
    if (!res.words.length) return msg("import-msg", "Auf den Fotos wurden keine Vokabeln erkannt.");
    showPreview(res.name, res.words);
    msg("import-msg", `${res.words.length} Vokabeln erkannt – bitte prüfen.` +
      (res.truncated ? " Achtung: Liste evtl. unvollständig, lieber weniger Fotos auf einmal." : ""), !res.truncated);
    photos = [];
    renderThumbs();
  } catch (err) {
    if (err.status === 401) throw err;
    msg("import-msg", err.message);
  } finally {
    btn.disabled = false;
    renderThumbs();
  }
};

function parseImportJson(text) {
  const data = JSON.parse(text);
  const list = Array.isArray(data) ? data : data.words || data.vokabeln || [];
  const words = list.map((w) => Array.isArray(w)
    ? { de: String(w[0] ?? ""), en: String(w[1] ?? "") }
    : { de: String(w.de ?? w.deutsch ?? ""), en: String(w.en ?? w.englisch ?? w.english ?? "") });
  return { name: Array.isArray(data) ? "" : (data.name || data.name_vorschlag || ""), words };
}

$("btn-json").onclick = () => {
  try {
    const { name, words } = parseImportJson($("json-text").value);
    if (!words.length) return msg("import-msg", "Im JSON wurden keine Vokabeln gefunden.");
    showPreview(name, words);
    $("json-box").open = false;
    $("json-text").value = "";
    msg("import-msg", `${words.length} Vokabeln übernommen – bitte prüfen.`, true);
  } catch (e) {
    msg("import-msg", "Das ist kein gültiges JSON: " + e.message);
  }
};

function importRow(w = { de: "", en: "" }) {
  const de = el("input", { type: "text", value: w.de, className: "imp-de" });
  const en = el("input", { type: "text", value: w.en, className: "imp-en" });
  const del = el("button", { className: "icon", title: "Zeile entfernen", textContent: "🗑️" });
  const tr = el("tr", {}, el("td", {}, de), el("td", {}, en), el("td", {}, del));
  del.onclick = () => tr.remove();
  return tr;
}

function showPreview(name, words) {
  $("import-preview").classList.remove("hidden");
  if (name && $("import-target").value === "") $("import-name").value = name;
  const rows = $("import-rows");
  for (const w of words) rows.append(importRow(w));
  $("import-preview").scrollIntoView({ behavior: "smooth", block: "start" });
}

$("btn-import-addrow").onclick = () => { const r = importRow(); $("import-rows").append(r); r.querySelector("input").focus(); };

$("btn-import-save").onclick = async () => {
  const words = [...$("import-rows").querySelectorAll("tr")].map((tr) => ({
    de: tr.querySelector(".imp-de").value.trim(), en: tr.querySelector(".imp-en").value.trim(),
  })).filter((w) => w.de && w.en);
  if (!words.length) return msg("import-msg", "Die Vorschau enthält keine vollständigen Vokabeln.");
  const target = $("import-target").value;
  const body = target ? { set_id: +target, words } : { name: $("import-name").value.trim(), words };
  if (!target && !body.name) return msg("import-msg", "Bitte einen Namen für den neuen Satz eingeben.");
  try {
    const res = await api("/api/import/json", { method: "POST", body });
    $("import-rows").replaceChildren();
    $("import-name").value = "";
    $("import-preview").classList.add("hidden");
    await loadAdmin();
    msg("import-msg", `✅ ${res.added} Vokabeln importiert.`, true);
  } catch (err) {
    if (err.status === 401) throw err;
    msg("import-msg", err.message);
  }
};

// ------------------------------------------------------------ Navigation
document.querySelectorAll(".nav").forEach((b) => {
  b.onclick = () => {
    if (state.quiz && !confirm("Die laufende Abfrage wird abgebrochen. Weiter?")) return;
    state.quiz = null;
    ({ admin: loadAdmin, learn: loadLearn, start: loadStart })[b.dataset.view]();
  };
});
$("home-link").onclick = () => { if (!state.quiz) loadStart(); };

window.addEventListener("unhandledrejection", (e) => {
  const err = e.reason;
  if (err && err.status === 401) {
    state.pin = "";
    sessionStorageSet("pin", "");
    loadAdmin();
    return;
  }
  alert("Fehler: " + (err && err.message ? err.message : err));
});

(async function init() {
  try { state.config = await api("/api/config"); } catch { /* Standardwerte */ }
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  loadStart();
})();
