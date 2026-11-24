"""Vokabeltrainer – kleine Web-App zum Üben von Vokabeln (Deutsch -> Englisch)."""
import os
import re
import sqlite3
import unicodedata
from contextlib import contextmanager
from datetime import date

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

DB_PATH = os.environ.get("DB_PATH", "/data/vokabeln.db")
ADMIN_PIN = os.environ.get("ADMIN_PIN", "")
CASE_SENSITIVE = os.environ.get("CASE_SENSITIVE", "false").lower() in ("1", "true", "yes")
STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")

app = FastAPI(title="Vokabeltrainer")


# --------------------------------------------------------------------------- DB
@contextmanager
def db():
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    try:
        yield con
        con.commit()
    finally:
        con.close()


def init_db():
    folder = os.path.dirname(DB_PATH)
    if folder:
        os.makedirs(folder, exist_ok=True)
    with db() as con:
        con.executescript(
            """
            CREATE TABLE IF NOT EXISTS sets (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                created TEXT DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS words (
                id INTEGER PRIMARY KEY,
                set_id INTEGER NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
                de TEXT NOT NULL,
                en TEXT NOT NULL,
                correct INTEGER NOT NULL DEFAULT 0,
                wrong INTEGER NOT NULL DEFAULT 0,
                last_result INTEGER
            );
            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY,
                day TEXT NOT NULL,
                set_names TEXT,
                total INTEGER NOT NULL,
                first_try_correct INTEGER NOT NULL,
                rounds INTEGER NOT NULL
            );
            """
        )


init_db()


def require_admin(x_admin_pin: str = Header(default="")):
    if ADMIN_PIN and x_admin_pin != ADMIN_PIN:
        raise HTTPException(401, "Falsche PIN")


# ------------------------------------------------------------------ Parsing
SEPARATORS = ["\t", "=", ";"]


def parse_lines(text: str):
    """Eine Vokabel pro Zeile: 'Hund = dog', 'Hund;dog' oder mit Tab getrennt."""
    pairs, errors = [], []
    for n, raw in enumerate(text.splitlines(), start=1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        for sep in SEPARATORS:
            if sep in line:
                de, en = (x.strip() for x in line.split(sep, 1))
                break
        else:
            errors.append(f"Zeile {n}: '{line}' – kein Trennzeichen (=, ; oder Tab) gefunden")
            continue
        if de and en:
            pairs.append((de, en))
        else:
            errors.append(f"Zeile {n}: '{line}' – Deutsch oder Englisch fehlt")
    return pairs, errors


# --------------------------------------------------------------- Checking
def normalize(s: str) -> str:
    s = unicodedata.normalize("NFC", s)
    s = s.replace("’", "'").replace("‘", "'").replace("`", "'")
    s = re.sub(r"\s+", " ", s).strip()
    s = s.rstrip(".!?")
    return s.strip()


def variants(expected: str):
    """'(to) go / to leave' -> ['go', 'to go', 'to leave']"""
    out = []
    for alt in expected.split("/"):
        alt = alt.strip()
        if not alt:
            continue
        if "(" in alt:
            without = re.sub(r"\s*\([^)]*\)\s*", " ", alt)
            with_ = alt.replace("(", "").replace(")", "")
            out += [normalize(without), normalize(with_)]
        else:
            out.append(normalize(alt))
    seen, result = set(), []
    for v in out:
        if v and v not in seen:
            seen.add(v)
            result.append(v)
    return result


def same(a: str, b: str, case_sensitive: bool) -> bool:
    return a == b if case_sensitive else a.lower() == b.lower()


def align(a: str, b: str):
    """Buchstabengenauer Vergleich (Levenshtein mit Rückverfolgung)."""
    n, m = len(a), len(b)
    eq = lambda x, y: x.lower() == y.lower()
    d = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n + 1):
        d[i][0] = i
    for j in range(m + 1):
        d[0][j] = j
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            cost = 0 if eq(a[i - 1], b[j - 1]) else 1
            d[i][j] = min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
    ops, i, j = [], n, m
    while i > 0 or j > 0:
        if i > 0 and j > 0 and d[i][j] == d[i - 1][j - 1] + (0 if eq(a[i - 1], b[j - 1]) else 1):
            ops.append({"op": "eq" if eq(a[i - 1], b[j - 1]) else "sub", "a": a[i - 1], "b": b[j - 1]})
            i, j = i - 1, j - 1
        elif i > 0 and d[i][j] == d[i - 1][j] + 1:
            ops.append({"op": "extra", "a": a[i - 1]})
            i -= 1
        else:
            ops.append({"op": "missing", "b": b[j - 1]})
            j -= 1
    return ops[::-1], d[n][m]


def check_answer(answer: str, expected: str):
    given = normalize(answer)
    opts = variants(expected) or [normalize(expected)]
    for v in opts:
        if same(given, v, CASE_SENSITIVE):
            hint = None
            if given != v:
                hint = f"Richtig! Achte aber auf die Schreibweise: {v}"
            return {"correct": True, "hint": hint, "closest": v, "diff": None, "distance": 0}
    # Nicht richtig: nächstliegende Variante für die Fehleranzeige wählen
    best = None
    for v in opts:
        ops, dist = align(given, v)
        if best is None or dist < best[2]:
            best = (v, ops, dist)
    v, ops, dist = best
    return {"correct": False, "hint": None, "closest": v, "diff": ops, "distance": dist}


# ---------------------------------------------------------------- Models
class SetIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    text: str = ""


class SetRename(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class WordsIn(BaseModel):
    text: str


class WordIn(BaseModel):
    de: str = Field(min_length=1)
    en: str = Field(min_length=1)


class QuizIn(BaseModel):
    set_ids: list[int]
    only_difficult: bool = False


class CheckIn(BaseModel):
    word_id: int
    answer: str
    first_try: bool = True


class FinishIn(BaseModel):
    set_names: list[str] = []
    total: int
    first_try_correct: int
    rounds: int


# --------------------------------------------------------------- Routes
@app.get("/api/config")
def config():
    return {"pin_required": bool(ADMIN_PIN), "case_sensitive": CASE_SENSITIVE}


@app.post("/api/admin/login", dependencies=[Depends(require_admin)])
def admin_login():
    return {"ok": True}


@app.get("/api/sets")
def list_sets():
    with db() as con:
        rows = con.execute(
            """SELECT s.id, s.name, COUNT(w.id) AS count,
                      SUM(CASE WHEN w.last_result = 0 THEN 1 ELSE 0 END) AS difficult
               FROM sets s LEFT JOIN words w ON w.set_id = s.id
               GROUP BY s.id ORDER BY s.created DESC, s.id DESC"""
        ).fetchall()
    return [dict(r, difficult=r["difficult"] or 0) for r in rows]


@app.post("/api/sets", dependencies=[Depends(require_admin)])
def create_set(body: SetIn):
    pairs, errors = parse_lines(body.text)
    with db() as con:
        cur = con.execute("INSERT INTO sets(name) VALUES (?)", (body.name.strip(),))
        set_id = cur.lastrowid
        con.executemany("INSERT INTO words(set_id, de, en) VALUES (?,?,?)", [(set_id, d, e) for d, e in pairs])
    return {"id": set_id, "added": len(pairs), "errors": errors}


@app.put("/api/sets/{set_id}", dependencies=[Depends(require_admin)])
def rename_set(set_id: int, body: SetRename):
    with db() as con:
        con.execute("UPDATE sets SET name=? WHERE id=?", (body.name.strip(), set_id))
    return {"ok": True}


@app.delete("/api/sets/{set_id}", dependencies=[Depends(require_admin)])
def delete_set(set_id: int):
    with db() as con:
        con.execute("DELETE FROM sets WHERE id=?", (set_id,))
    return {"ok": True}


@app.get("/api/sets/{set_id}/words", dependencies=[Depends(require_admin)])
def list_words(set_id: int):
    with db() as con:
        s = con.execute("SELECT id, name FROM sets WHERE id=?", (set_id,)).fetchone()
        if not s:
            raise HTTPException(404, "Vokabelsatz nicht gefunden")
        words = con.execute(
            "SELECT id, de, en, correct, wrong, last_result FROM words WHERE set_id=? ORDER BY id", (set_id,)
        ).fetchall()
    return {"id": s["id"], "name": s["name"], "words": [dict(w) for w in words]}


@app.post("/api/sets/{set_id}/words", dependencies=[Depends(require_admin)])
def add_words(set_id: int, body: WordsIn):
    pairs, errors = parse_lines(body.text)
    with db() as con:
        if not con.execute("SELECT 1 FROM sets WHERE id=?", (set_id,)).fetchone():
            raise HTTPException(404, "Vokabelsatz nicht gefunden")
        con.executemany("INSERT INTO words(set_id, de, en) VALUES (?,?,?)", [(set_id, d, e) for d, e in pairs])
    return {"added": len(pairs), "errors": errors}


@app.put("/api/words/{word_id}", dependencies=[Depends(require_admin)])
def update_word(word_id: int, body: WordIn):
    with db() as con:
        con.execute("UPDATE words SET de=?, en=? WHERE id=?", (body.de.strip(), body.en.strip(), word_id))
    return {"ok": True}


@app.delete("/api/words/{word_id}", dependencies=[Depends(require_admin)])
def delete_word(word_id: int):
    with db() as con:
        con.execute("DELETE FROM words WHERE id=?", (word_id,))
    return {"ok": True}


@app.post("/api/quiz")
def start_quiz(body: QuizIn):
    if not body.set_ids:
        raise HTTPException(400, "Bitte mindestens einen Vokabelsatz auswählen")
    marks = ",".join("?" * len(body.set_ids))
    sql = f"""SELECT w.id, w.de, s.name AS set_name FROM words w JOIN sets s ON s.id = w.set_id
              WHERE w.set_id IN ({marks})"""
    if body.only_difficult:
        sql += " AND w.last_result = 0"
    with db() as con:
        rows = con.execute(sql, body.set_ids).fetchall()
    # Bewusst ohne englische Lösung – die gibt es erst nach dem Prüfen
    return [dict(r) for r in rows]


@app.post("/api/check")
def check(body: CheckIn):
    with db() as con:
        w = con.execute("SELECT id, de, en FROM words WHERE id=?", (body.word_id,)).fetchone()
        if not w:
            raise HTTPException(404, "Vokabel nicht gefunden")
        result = check_answer(body.answer, w["en"])
        if body.first_try:
            col = "correct" if result["correct"] else "wrong"
            con.execute(f"UPDATE words SET {col} = {col} + 1, last_result=? WHERE id=?",
                        (1 if result["correct"] else 0, w["id"]))
        # Wiederholungsrunden zählen nicht in die Statistik: ein Wort bleibt
        # "schwierig", bis es in einem neuen Durchgang beim ersten Versuch sitzt.
    return {**result, "expected": w["en"], "de": w["de"], "answer": body.answer}


@app.post("/api/finish")
def finish(body: FinishIn):
    with db() as con:
        con.execute(
            "INSERT INTO sessions(day, set_names, total, first_try_correct, rounds) VALUES (?,?,?,?,?)",
            (date.today().isoformat(), ", ".join(body.set_names), body.total, body.first_try_correct, body.rounds),
        )
    return {"ok": True}


@app.get("/api/stats")
def stats():
    """Kompakte Zahlen, z. B. für einen REST-Sensor in Home Assistant."""
    today = date.today().isoformat()
    with db() as con:
        t = con.execute(
            "SELECT COUNT(*) n, COALESCE(SUM(total),0) words, COALESCE(SUM(first_try_correct),0) ok "
            "FROM sessions WHERE day=?", (today,)
        ).fetchone()
        last = con.execute("SELECT * FROM sessions ORDER BY id DESC LIMIT 1").fetchone()
        counts = con.execute(
            "SELECT COUNT(*) total, SUM(CASE WHEN last_result=0 THEN 1 ELSE 0 END) difficult FROM words"
        ).fetchone()
    return {
        "today_sessions": t["n"],
        "today_words": t["words"],
        "today_first_try_correct": t["ok"],
        "total_words": counts["total"],
        "difficult_words": counts["difficult"] or 0,
        "last_session": dict(last) if last else None,
    }


@app.get("/health")
def health():
    return {"ok": True}


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/sw.js")
def service_worker():
    return FileResponse(os.path.join(STATIC_DIR, "sw.js"), media_type="application/javascript")


@app.get("/")
def index():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))
