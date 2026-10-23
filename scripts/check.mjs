// Wöchentlicher Check: ruft alle Seiten aus festivals.json ab, sucht nach Hinweisen auf
// Bandbewerbungen und schickt eine Push-Nachricht, wenn sich etwas Relevantes ändert.
//
// Aufruf:  node scripts/check.mjs            (normal, mit Push)
//          node scripts/check.mjs --dry      (nur Ausgabe, kein Push, state.json wird trotzdem geschrieben)

import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const DRY = process.argv.includes('--dry');
const ROOT = new URL('../', import.meta.url);
const APP_URL = process.env.APP_URL || '';

// Wörter, um die herum Textausschnitte gesammelt werden. Nur diese Ausschnitte zählen für
// "hat sich geändert" – so lösen Banner, Datumsangaben im Footer usw. keinen Fehlalarm aus.
const TOPIC = [
  'bewerb', 'band-bewerbung', 'einsendeschluss', 'open call', 'call for bands', 'call for artists',
  'application', 'apply', 'submission', 'submit your', 'deadline',
];
// Formulierungen, die auf eine offene Phase hindeuten …
const OPEN = [
  'bewerbung offen', 'bewerbungen offen', 'bewerbungsphase läuft', 'bewerbungsphase ist eröffnet',
  'bewerbungsphase hat begonnen', 'bewerbungsphase startet', 'bewerbungsphase gestartet',
  'jetzt bewerben', 'bewerbt euch', 'bewerbt euch jetzt', 'ab sofort bewerben', 'könnt ihr euch bewerben',
  'könnt ihr euch ab sofort', 'bewerbungen sind ab sofort', 'bewerbungen werden ab sofort', 'zum bewerbungsformular',
  'applications open', 'applications are open', 'application is open', 'apply now', 'submissions open',
  'submissions are open', 'now accepting', 'bewerbungsformular', 'formular unten aus',
];
// Flexiblere Muster für "offen", z. B. "Bewerbung für 2027", "Apply 2027", "bis 25.10. können sich Bands … bewerben".
const OPEN_RX = [
  /(?:bewerbung(?:en)?|bewerben|apply|applications?)\s+(?:für|fürs|for)?\s*(?:\S+\s+){0,3}?(20\d\d)/g,
  /(?:könnt|können)\s+(?:ihr|sich|euch)[^.]{0,160}?bewerben/g,
];
// … und auf eine geschlossene.
const CLOSED = [
  'bewerbungsphase ist beendet', 'bewerbungsphase beendet', 'bewerbungsphase ist vorbei', 'bewerbungsphase ist abgeschlossen',
  'bewerbung geschlossen', 'bewerbungen geschlossen', 'bewerbung ist geschlossen', 'keine bewerbungen mehr',
  'nehmen keine bewerbungen', 'bewerbungszeitraum ist abgelaufen', 'bewerbungsschluss ist vorbei',
  'applications closed', 'applications are closed', 'submissions closed', 'submissions are closed',
  'no longer accepting', 'not accepting',
  // "noch nicht offen" – ergibt zusammen mit einem Offen-Treffer den Status "Bitte prüfen"
  'open in ', 'opens in ', 'opening in ', 'coming soon', 'demnächst', 'öffnet am', 'öffnet im',
  'startet am', 'startet im', 'beginnt am', 'beginnt im',
];

const LABEL = { open: 'offen', closed: 'geschlossen', mixed: 'unklar', unknown: 'keine Infos' };

// ---------- Text ----------
function htmlToText(html) {
  return html
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr)[^>]*>/gi, '. ')
    .replace(/<(?:[^>"']|"[^"]*"|'[^']*')*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&auml;/g, 'ä').replace(/&ouml;/g, 'ö').replace(/&uuml;/g, 'ü')
    .replace(/&Auml;/g, 'Ä').replace(/&Ouml;/g, 'Ö').replace(/&Uuml;/g, 'Ü').replace(/&szlig;/g, 'ß')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/(\s*\.\s*){2,}/g, '. ')
    .replace(/\s+/g, ' ')
    .trim();
}

function snippets(text, words, before = 90, after = 160, max = 8) {
  const lower = text.toLowerCase();
  const ranges = [];
  for (const w of words) {
    for (let i = lower.indexOf(w); i !== -1; i = lower.indexOf(w, i + w.length)) {
      ranges.push([Math.max(0, i - before), Math.min(text.length, i + w.length + after)]);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const r of ranges) {
    const last = merged.at(-1);
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  return merged.slice(0, max).map(([a, b]) => text.slice(a, b).trim());
}

function classify(text) {
  const lower = text.toLowerCase();
  const thisYear = new Date().getFullYear();
  const open = [
    ...OPEN.filter((p) => lower.includes(p)),
    ...OPEN_RX.flatMap((rx) => [...lower.matchAll(rx)])
      .filter((m) => !m[1] || +m[1] >= thisYear)
      .map((m) => m[0].replace(/\s+/g, ' ')),
  ];
  const closed = CLOSED.filter((p) => lower.includes(p));
  const status = open.length && closed.length ? 'mixed' : open.length ? 'open' : closed.length ? 'closed' : 'unknown';
  return { status, open, closed };
}

const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

// ---------- Abruf ----------
async function check(festival) {
  const res = await fetch(festival.url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(25_000),
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; Bandbewerbungen-Checker/1.0; woechentlicher Check)',
      'Accept-Language': 'de,en;q=0.8',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = htmlToText(await res.text());
  const words = [...TOPIC, ...(festival.keywords || []).map((k) => k.toLowerCase())];
  const snips = snippets(text, words);
  const { status, open, closed } = classify(snips.join(' ') || text);
  return { status, snippets: snips, hash: hash(snips.join('\n').toLowerCase()), matched: { open, closed } };
}

// ---------- Benachrichtigen ----------
async function notify(messages) {
  if (!messages.length) return console.log('\nKeine Benachrichtigungen nötig.');
  console.log(`\n${messages.length} Benachrichtigung(en):`);
  messages.forEach((m) => console.log(`  • ${m.title} – ${m.body}`));
  if (DRY) return console.log('(--dry: nichts gesendet)');

  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, PUSH_SUBSCRIPTIONS, NTFY_TOPIC } = process.env;

  if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && PUSH_SUBSCRIPTIONS) {
    const webpush = (await import('web-push')).default;
    webpush.setVapidDetails(VAPID_SUBJECT || 'mailto:noreply@example.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    const subs = [JSON.parse(PUSH_SUBSCRIPTIONS)].flat();
    for (const sub of subs) {
      for (const m of messages) {
        try {
          await webpush.sendNotification(sub, JSON.stringify(m), { TTL: 7 * 24 * 3600 });
        } catch (e) {
          const hint = e.statusCode === 404 || e.statusCode === 410 ? ' → Abo abgelaufen, in der App neu aktivieren und Secret ersetzen' : '';
          console.error(`  ✗ Web Push fehlgeschlagen (${e.statusCode || e.message})${hint}`);
          process.exitCode = 1;
        }
      }
    }
    console.log(`✓ Web Push an ${subs.length} Gerät(e) gesendet`);
  }

  if (NTFY_TOPIC) {
    for (const m of messages) {
      const r = await fetch('https://ntfy.sh/', {
        method: 'POST',
        body: JSON.stringify({ topic: NTFY_TOPIC, title: m.title, message: m.body, click: m.url, tags: ['guitar'] }),
      });
      if (!r.ok) { console.error(`  ✗ ntfy fehlgeschlagen (HTTP ${r.status})`); process.exitCode = 1; }
    }
    console.log('✓ ntfy gesendet');
  }

  if (!PUSH_SUBSCRIPTIONS && !NTFY_TOPIC) console.warn('⚠ Kein Push-Ziel konfiguriert (PUSH_SUBSCRIPTIONS oder NTFY_TOPIC).');
}

// ---------- Ablauf ----------
const festivals = JSON.parse(await readFile(new URL('festivals.json', ROOT), 'utf8'));
let state = { festivals: {} };
try { state = JSON.parse(await readFile(new URL('state.json', ROOT), 'utf8')); } catch {}

const now = new Date().toISOString();
const next = { lastRun: now, festivals: {} };
const messages = [];

for (const f of festivals) {
  const prev = state.festivals?.[f.url];
  let entry;
  try {
    const r = await check(f);
    const changed = prev && prev.hash && prev.hash !== r.hash;
    entry = {
      name: f.name, status: r.status, hash: r.hash, snippets: r.snippets,
      lastChecked: now,
      lastChanged: !prev ? now : changed || prev.status !== r.status ? now : prev.lastChanged,
    };

    const becameOpen = r.status === 'open' && prev?.status !== 'open';
    if (becameOpen) {
      messages.push({ title: `🎸 ${f.name}: Bewerbung offen!`, body: 'Auf der Seite stehen Hinweise auf eine offene Bandbewerbung.', url: f.url, tag: f.url });
    } else if (changed) {
      messages.push({ title: `🔎 ${f.name}: Bewerbungs-Infos geändert`, body: `Status: ${LABEL[r.status]}. Am besten kurz reinschauen.`, url: f.url, tag: f.url });
    }
    console.log(`${changed ? '△' : prev ? '·' : '+'} ${f.name.padEnd(32)} ${LABEL[r.status].padEnd(12)} ${r.snippets.length} Fundstelle(n)` +
      (r.matched.open.length ? `  [offen: ${r.matched.open.join(', ')}]` : '') +
      (r.matched.closed.length ? `  [zu: ${r.matched.closed.join(', ')}]` : ''));
  } catch (e) {
    const error = e.cause?.code || (e.name === 'TimeoutError' ? 'Zeitüberschreitung' : e.message);
    // Letzten guten Stand behalten, damit es nach dem Fehler keinen falschen "geändert"-Alarm gibt.
    entry = { ...(prev || { name: f.name }), error, lastChecked: now };
    if (!prev?.error) {
      messages.push({ title: `⚠ ${f.name}: Seite nicht erreichbar`, body: `${error} – evtl. hat sich die URL geändert.`, url: f.url, tag: f.url });
    }
    console.log(`✗ ${f.name.padEnd(32)} ${error}`);
  }
  next.festivals[f.url] = entry;
}

await writeFile(new URL('state.json', ROOT), JSON.stringify(next, null, 2) + '\n');
await notify(messages.map((m) => ({ ...m, url: m.url || APP_URL })));
