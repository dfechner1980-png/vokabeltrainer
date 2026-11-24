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
  document.querySelectorAll(".nav").forEach((b) =>
    b.classList.toggle("active", b.dataset.view === view || (view !== "admin" && b.dataset.view === "start")));
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
async function loadStart() {
  show("start");
  msg("start-msg", "");
  const sets = await api("/api/sets");
  const list = $("set-list");
  list.replaceChildren();
  $("no-sets").classList.toggle("hidden", sets.length > 0);
  for (const s of sets) {
    const cb = el("input", { type: "checkbox", value: s.id });
    cb.dataset.name = s.name;
    const info = s.difficult ? ` · ${s.difficult} mit Übungsbedarf` : "";
    list.append(el("label", { className: "set-item" }, cb,
      el("span", { className: "set-name", textContent: s.name }),
      el("span", { className: "muted small", textContent: `${s.count} Wörter${info}` })));
  }
}

$("btn-all").onclick = () => {
  const boxes = [...document.querySelectorAll("#set-list input")];
  const all = boxes.every((b) => b.checked);
  boxes.forEach((b) => (b.checked = !all));
};

$("btn-start").onclick = async () => {
  const boxes = [...document.querySelectorAll("#set-list input:checked")];
  if (!boxes.length) return msg("start-msg", "Bitte mindestens einen Vokabelsatz auswählen.");
  const words = await api("/api/quiz", {
    method: "POST",
    body: { set_ids: boxes.map((b) => +b.value), only_difficult: $("opt-difficult").checked },
  });
  if (!words.length) {
    return msg("start-msg", $("opt-difficult").checked
      ? "Super – in diesen Sätzen gibt es gerade keine Wörter mit Übungsbedarf! 🎉"
      : "Diese Sätze enthalten noch keine Vokabeln.");
  }
  const order = $("opt-shuffle").checked ? shuffle(words) : words;
  state.quiz = {
    setNames: boxes.map((b) => b.dataset.name),
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
};

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

// ------------------------------------------------------------ Navigation
document.querySelectorAll(".nav").forEach((b) => {
  b.onclick = () => {
    if (state.quiz && !confirm("Die laufende Abfrage wird abgebrochen. Weiter?")) return;
    state.quiz = null;
    b.dataset.view === "admin" ? loadAdmin() : loadStart();
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
