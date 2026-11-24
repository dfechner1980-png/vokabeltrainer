# 📚 Vokabeltrainer

Kleine Web-App zum Vokabelüben (Deutsch → Englisch) für zu Hause.
Läuft als Docker-Container, die Daten liegen in einer SQLite-Datenbank.

## Installation auf Unraid

Bei jedem Push auf `main` baut GitHub Actions das Image `ghcr.io/dfechner1980-png/vokabeltrainer:latest`.

**Einmalig: Template einspielen** (im Unraid-Terminal)
```bash
wget -O /boot/config/plugins/dockerMan/templates-user/my-vokabeltrainer.xml \
  https://raw.githubusercontent.com/dfechner1980-png/vokabeltrainer/main/unraid/my-vokabeltrainer.xml
```
Ist das Repo privat, die Datei `unraid/my-vokabeltrainer.xml` stattdessen von Hand in diesen Ordner kopieren.

Danach **Docker → Add Container → Template: vokabeltrainer** wählen, die Admin-PIN eintragen und auf **Apply** klicken.
Die Weboberfläche läuft dann unter `http://<unraid-ip>:8080`.

Alternativ ohne Template: **Add Container** von Hand ausfüllen.

| Feld | Wert |
|------|------|
| Repository | `ghcr.io/dfechner1980-png/vokabeltrainer:latest` |
| Port | 8080 → 8080 |
| Path | `/mnt/user/appdata/vokabeltrainer` → `/data` |
| Variable | `ADMIN_PIN` = deine PIN |

**Updates:** Code pushen, warten, bis die Action grün ist, dann in Unraid **Check for Updates → Update**.

Die Rechte auf `/data` setzt der Container beim Start selbst (Standard `PUID=99`, `PGID=100`, wie unter Unraid üblich).

## Andere Docker-Hosts

```bash
docker compose up -d     # nutzt das fertige Image; zum lokalen Bauen in docker-compose.yml "build: ." aktivieren
```

## Bedienung

**Verwalten** (mit PIN geschützt, z. B. für die Eltern)
- Einen neuen Vokabelsatz anlegen: Namen eingeben und die Vokabeln eintragen, eine pro Zeile:
  ```
  Hund = dog
  gehen = (to) go
  rennen = (to) run / (to) race
  Schule; school
  ```
- Trennzeichen: `=`, `;` oder Tab. Spalten aus Excel oder Google Sheets lassen sich direkt einfügen.
- `/` trennt mehrere richtige Antworten.
- `( )` markiert optionale Teile: `(to) go` akzeptiert sowohl „go“ als auch „to go“.
- Vokabeln lassen sich einzeln bearbeiten oder löschen. Die Spalte ✔ / ✘ zeigt, wie oft ein Wort beim ersten Versuch richtig oder falsch war. Rot bedeutet Übungsbedarf.

**Lernen**
- Eine oder mehrere Units auswählen, dann erscheint die Vokabelliste nach Units gruppiert. Wörter mit Übungsbedarf sind mit 🔴 markiert.
- Zum Selbsttest lässt sich „Englisch verdecken“ oder „Deutsch verdecken“ einschalten. Ein Antippen deckt das einzelne Wort auf.
- „Jetzt abfragen“ startet direkt die Abfrage mit denselben Units. Die Auswahl der Units bleibt beim Wechsel zwischen Lernen und Üben erhalten.

**Üben**
- Einen oder mehrere Sätze auswählen. Optional die Reihenfolge mischen oder nur Wörter mit Übungsbedarf abfragen.
- Das deutsche Wort wird angezeigt, die englische Übersetzung eintippen, dann Enter oder „Prüfen“.
- Bei einem Fehler zeigt die App buchstabengenau an, was falsch war: rot steht für falsch oder zu viel, grün für die Korrektur.
- Nach dem ersten Durchgang werden die falschen Wörter erneut abgefragt, so lange, bis alle sitzen.
- Ein Wort gilt als „mit Übungsbedarf“, bis es in einem neuen Durchgang beim ersten Versuch richtig ist.

Groß- und Kleinschreibung wird standardmäßig nicht als Fehler gewertet. Die App weist aber darauf hin, zum Beispiel bei „monday“ statt „Monday“. Mit `CASE_SENSITIVE=true` muss die Schreibweise exakt stimmen.

## Vokabeln importieren (JSON)

Unter **Verwalten → 📥 Vokabeln importieren** lässt sich JSON einfügen, das ein beliebiges KI-Tool aus einem Foto erzeugt hat (ChatGPT, Gemini, Claude, Copilot …):

1. Das Foto der Vokabelseite im KI-Tool hochladen.
2. Die Anleitung dazu einfügen. In der App gibt es dafür den Knopf „Anleitung kopieren“.
3. Die Antwort kopieren und in das Feld einfügen, dann auf **Vorschau anzeigen** klicken.
4. Die Einträge prüfen und korrigieren. Danach als neuen Satz anlegen oder an einen vorhandenen Satz anhängen.

Antworttext oder ```json-Codeblöcke rund um das JSON stören nicht, sie werden automatisch entfernt.

**Anleitung für die KI:**

```
Lies die Vokabeln auf dem Foto aus und gib sie ausschließlich als JSON in genau diesem Format zurück, ohne weiteren Text:

{"name": "Name der Unit", "words": [{"de": "deutsches Wort", "en": "englisches Wort"}]}

Regeln:
- "de" = deutsche Bedeutung, "en" = englischer Ausdruck genau wie im Buch
- Lautschrift, Beispielsätze und Seitenzahlen weglassen
- mehrere deutsche Bedeutungen mit Komma trennen: "Schule, Unterricht"
- mehrere englische Varianten mit " / " trennen: "(to) run / (to) race"
- Verben mit "to" so schreiben: "(to) go"
- "name" = Überschrift der Unit, falls erkennbar, sonst leer lassen
```

**Format:**

```json
{
  "name": "Unit 5 – Animals",
  "words": [
    {"de": "Katze", "en": "cat"},
    {"de": "füttern", "en": "(to) feed"}
  ]
}
```
Akzeptiert werden außerdem eine reine Liste `[{"de": "...", "en": "..."}]` und `[["Katze", "cat"], ...]`.

**API:** `POST /api/import/json` mit dem Header `X-Admin-Pin` und dem Format oben. Statt `name` lässt sich `"set_id": 3` angeben, dann werden die Wörter an Satz 3 angehängt.

## Einstellungen (docker-compose.yml)

| Variable          | Standard            | Bedeutung                                      |
|-------------------|---------------------|------------------------------------------------|
| `ADMIN_PIN`       | leer                | PIN für „Verwalten“ (leer = kein Schutz)        |
| `CASE_SENSITIVE`  | `false`             | Groß-/Kleinschreibung als Fehler werten         |
| `DB_PATH`         | `/data/vokabeln.db` | Ort der Datenbank im Container                  |

## Sicherung

Alle Daten stecken in einer einzigen Datei: `/mnt/user/appdata/vokabeltrainer/vokabeln.db`. Sie wird von Unraid-Backups (z. B. „Appdata Backup“) mit erfasst. Von Hand geht es auch so:

```bash
docker cp vokabeltrainer:/data/vokabeln.db ./vokabeln-backup.db
```

## Aufs Handy (Android)

Die App ist als PWA angelegt, mit Manifest, Icons und Service Worker.
- **Schnell:** In Chrome die Seite öffnen und über ⋮ → „Zum Startbildschirm hinzufügen“ einen Shortcut anlegen.
- **Als echte App mit eigenem Fenster:** Chrome installiert eine PWA nur über **HTTPS**. Dafür eignet sich zum Beispiel ein Reverse Proxy mit Zertifikat (Nginx Proxy Manager, Traefik, Caddy) oder Tailscale. Danach erscheint in Chrome „App installieren“.
- **Später:** Mit Capacitor oder einer Trusted Web Activity lässt sich daraus eine APK bauen. Das Backend bleibt dabei unverändert.

## Home Assistant (optional)

`GET /api/stats` liefert kompakte Zahlen, die sich zum Beispiel als REST-Sensor nutzen lassen:

```yaml
rest:
  - resource: http://<docker-host>:8080/api/stats
    scan_interval: 300
    sensor:
      - name: Vokabeln heute geübt
        value_template: "{{ value_json.today_words }}"
      - name: Vokabeln mit Übungsbedarf
        value_template: "{{ value_json.difficult_words }}"
```

Die Seite lässt sich auch per Webseiten-Karte (iframe) in ein Dashboard einbinden.

## API (Überblick)

| Methode | Pfad                         | Zweck                                 |
|---------|------------------------------|----------------------------------------|
| GET     | `/api/sets`                  | Vokabelsätze mit Anzahl                |
| POST    | `/api/sets` 🔒               | Satz anlegen (`name`, `text`)          |
| PUT/DELETE | `/api/sets/{id}` 🔒       | Umbenennen / löschen                   |
| GET/POST | `/api/sets/{id}/words` 🔒   | Vokabeln lesen / hinzufügen            |
| PUT/DELETE | `/api/words/{id}` 🔒      | Vokabel ändern / löschen               |
| POST    | `/api/quiz`                  | Abfrage starten (ohne Lösungen)        |
| POST    | `/api/check`                 | Antwort prüfen, inkl. Fehleranzeige    |
| POST    | `/api/finish`                | Ergebnis einer Übung speichern         |
| GET     | `/api/stats`                 | Statistik (z. B. für Home Assistant)   |
| POST    | `/api/import/json` 🔒        | Vokabeln importieren (neu oder anhängen) |

🔒 = benötigt den Header `X-Admin-Pin`, wenn eine PIN gesetzt ist.
