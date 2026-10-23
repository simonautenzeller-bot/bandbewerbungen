# Bandbewerbungen

PWA, die dir eine Push-Nachricht schickt, sobald Festivals oder Contests die Bandbewerbung öffnen.
Einmal pro Woche (montags früh) ruft eine GitHub Action alle Seiten aus `festivals.json` ab und sucht nach
Hinweisen wie „Bewerbung für 2027“, „jetzt bewerben“, „applications open“ oder „Bewerbungsphase beendet“.

**Benachrichtigt wird, wenn …**
- eine Seite neu als **offen** erkannt wird,
- sich die Textstellen rund um „Bewerbung/Apply/Deadline …“ **ändern** (z. B. neues Datum),
- eine Seite plötzlich **nicht mehr erreichbar** ist (URL geändert?).

Die Erkennung ist eine Heuristik. Sie sagt dir, *wann du nachschauen solltest*, und ersetzt nicht den Blick auf die Seite.

---

## Einrichtung (einmalig, ca. 15 Minuten)

### 1. Repo anlegen und Dateien hochladen
1. Auf GitHub ein neues Repository anlegen, z. B. `bandbewerbungen`, und auf **Public** stellen
   (GitHub Pages ist im kostenlosen Plan nur für öffentliche Repos verfügbar).
2. **Add file → Upload files** und alle Dateien und Ordner per Drag & Drop hineinziehen, **außer**:
   - `vapid-keys.txt` (geheim!)
   - `node_modules/`
   - `.claude/`

   Der Ordner `.github` muss mit hochgeladen werden, denn er enthält den wöchentlichen Check.

### 2. Secrets hinterlegen
**Settings → Secrets and variables → Actions → New repository secret**

| Name | Inhalt |
|---|---|
| `VAPID_PUBLIC_KEY` | aus `vapid-keys.txt` |
| `VAPID_PRIVATE_KEY` | aus `vapid-keys.txt` |
| `VAPID_SUBJECT` | `mailto:` + deine E-Mail-Adresse |
| `PUSH_SUBSCRIPTIONS` | kommt in Schritt 4 |

Der öffentliche Schlüssel steht auch schon in `config.js`. Das ist so gewollt und unbedenklich.

### 3. GitHub Pages einschalten
**Settings → Pages → Source: Deploy from a branch → Branch: `main` / `(root)` → Save.**
Nach ca. einer Minute läuft die App unter `https://<dein-name>.github.io/bandbewerbungen/`.

### 4. Push aktivieren
1. Die App auf dem Handy öffnen.
   - **iPhone:** zuerst *Teilen → Zum Home-Bildschirm*, dann die App vom Home-Bildschirm aus öffnen.
   - **Android:** einfach in Chrome öffnen (optional „App installieren“).
2. **Push aktivieren** tippen und erlauben.
3. Den angezeigten Text kopieren und als Secret `PUSH_SUBSCRIPTIONS` speichern.
   Für mehrere Geräte schreibst du die Texte als Liste: `[{…}, {…}]`.

### 5. Testen
**Actions → Wöchentlicher Check → Run workflow.** Beim ersten Lauf bekommst du für jedes bereits offene
Festival eine Nachricht. Daran siehst du direkt, dass alles funktioniert.

---

## Festivals pflegen
In der App **+ Festival** antippen: Der Eintrag wird kopiert, und `festivals.json` öffnet sich auf GitHub. Dort fügst du ihn ein und klickst auf *Commit changes*.
Alternativ bearbeitest du die Datei direkt:

```json
{
  "name": "Mein Festival",
  "url": "https://mein-festival.de/bandbewerbung",
  "notes": "Indie/Rock, Bewerbung per Formular",
  "keywords": ["newcomer-bühne"]
}
```

**Tipp:** Nimm möglichst die konkrete Bewerbungs- oder Booking-Seite, nicht die Startseite. Das reduziert Fehlalarme.
`keywords` ist optional und ergänzt die Standard-Suchbegriffe.

## Gut zu wissen
- **Häufigkeit:** In `.github/workflows/check.yml` steht `cron: '0 6 * * 1'`, also montags um 06:00 UTC.
- **60-Tage-Regel:** GitHub pausiert Zeitpläne in öffentlichen Repos nach 60 Tagen ohne Aktivität. Der Check
  schreibt jede Woche `state.json` zurück und hält das Repo damit aktiv.
- **Abo abgelaufen?** Steht im Action-Log „Abo abgelaufen“, aktivierst du Push in der App neu und ersetzt das Secret.
- **Seiten, die nur per JavaScript laden** (manche Baukasten-Seiten) oder nur auf Instagram stattfinden, kann der
  Check nicht lesen. Dann zeigt die App „Keine Infos“ an.
- **Alternative zu Web Push:** ein Secret `NTFY_TOPIC` mit einem geheimen Themennamen anlegen und die App
  [ntfy](https://ntfy.sh) auf dem Handy abonnieren. Beides funktioniert auch gleichzeitig.

## Lokal ausprobieren
```bash
npm install
npm run check:dry
```
