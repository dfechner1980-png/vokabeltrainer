"""Vokabeln aus Fotos erkennen – über die Claude API (Vision + erzwungenes Tool für sauberes JSON)."""
import os

import httpx

API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
MODEL = os.environ.get("CLAUDE_MODEL", "claude-sonnet-5-5")
BASE_URL = os.environ.get("ANTHROPIC_BASE_URL", "https://api.anthropic.com").rstrip("/")

PROMPT = """Auf den Bildern ist eine Vokabelliste aus einem Englisch-Schulbuch oder Heft eines deutschen Schulkinds (fotografiert, evtl. schief oder handschriftlich).

Erfasse ALLE Vokabelpaare Englisch–Deutsch in der Reihenfolge, in der sie auf den Bildern stehen, und gib sie mit dem Tool `vokabeln_speichern` zurück.

Regeln:
- "de" = deutsche Bedeutung, "en" = englischer Ausdruck, genau wie im Buch geschrieben (Groß-/Kleinschreibung beibehalten).
- Lautschrift (z. B. [ˈskuːl]), Beispielsätze, Seitenzahlen, Abbildungen und Hinweiskästen weglassen.
- Mehrere deutsche Bedeutungen in "de" mit Komma trennen, z. B. "Schule, Unterricht".
- Mehrere englische Varianten in "en" mit " / " trennen.
- Bei Verben mit "to" das "to" in Klammern setzen: "(to) go". Unregelmäßige Formen in Klammern ("go, went, gone") weglassen, nur die Grundform.
- Abkürzungen wie "sth." / "sb." / "etw." / "jdn." beibehalten.
- Offensichtliche Lesefehler korrigieren; nichts erfinden. Unleserliche Einträge weglassen.
- Wenn eine Überschrift wie "Unit 3" oder "Lesson 2 – At school" erkennbar ist, als name_vorschlag zurückgeben."""

TOOL = {
    "name": "vokabeln_speichern",
    "description": "Speichert die auf den Bildern erkannten Vokabelpaare.",
    "input_schema": {
        "type": "object",
        "properties": {
            "name_vorschlag": {"type": "string", "description": "Name der Unit/Lektion, falls erkennbar, sonst leer"},
            "vokabeln": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "de": {"type": "string", "description": "deutsche Bedeutung"},
                        "en": {"type": "string", "description": "englischer Ausdruck"},
                    },
                    "required": ["de", "en"],
                },
            },
        },
        "required": ["vokabeln"],
    },
}


class AIImportError(Exception):
    pass


def enabled() -> bool:
    return bool(API_KEY)


def extract(images: list[dict]) -> dict:
    """images: [{"media_type": "image/jpeg", "data": "<base64>"}, ...]"""
    if not API_KEY:
        raise AIImportError("Kein ANTHROPIC_API_KEY gesetzt – Foto-Import ist nicht eingerichtet.")
    content = [{"type": "image", "source": {"type": "base64", "media_type": i["media_type"], "data": i["data"]}}
               for i in images]
    content.append({"type": "text", "text": PROMPT})
    body = {
        "model": MODEL,
        "max_tokens": 8000,
        "tools": [TOOL],
        "tool_choice": {"type": "tool", "name": TOOL["name"]},
        "messages": [{"role": "user", "content": content}],
    }
    headers = {"x-api-key": API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json"}
    try:
        r = httpx.post(f"{BASE_URL}/v1/messages", json=body, headers=headers, timeout=180)
    except httpx.HTTPError as e:
        raise AIImportError(f"Claude API nicht erreichbar: {e}") from e
    if r.status_code != 200:
        try:
            msg = r.json().get("error", {}).get("message", r.text)
        except ValueError:
            msg = r.text
        raise AIImportError(f"Claude API Fehler {r.status_code}: {msg}")
    data = r.json()
    for block in data.get("content", []):
        if block.get("type") == "tool_use":
            inp = block.get("input", {})
            words = [{"de": str(v.get("de", "")).strip(), "en": str(v.get("en", "")).strip()}
                     for v in inp.get("vokabeln", [])]
            words = [w for w in words if w["de"] and w["en"]]
            return {"name": str(inp.get("name_vorschlag") or "").strip(), "words": words,
                    "truncated": data.get("stop_reason") == "max_tokens"}
    raise AIImportError("Die KI hat keine Vokabeln zurückgegeben.")
