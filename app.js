const cfg = window.APP_CONFIG || {};
const $ = (s) => document.querySelector(s);

const STATUS = {
  open:    { label: 'Offen',            rank: 0 },
  mixed:   { label: 'Bitte prüfen',     rank: 1 },
  unknown: { label: 'Keine Infos',      rank: 2 },
  pending: { label: 'Noch nicht geprüft', rank: 3 },
  error:   { label: 'Fehler',           rank: 4 },
  closed:  { label: 'Geschlossen',      rank: 5 },
};
const RECENT_DAYS = 8;
const HIGHLIGHT = /(bewerb\w*|applications?|apply|submissions?|einsendeschluss|deadline|open call|call for \w+|geschlossen|closed|beendet|offen|open)/gi;

let festivals = [];
let state = { festivals: {} };
let filter = 'all';

// ---------- Repo / Links ----------
function repo() {
  if (cfg.GITHUB_REPO) return cfg.GITHUB_REPO;
  const m = location.hostname.match(/^([^.]+)\.github\.io$/);
  const seg = location.pathname.split('/').filter(Boolean)[0];
  return m && seg ? `${m[1]}/${seg}` : '';
}
const gh = (path) => (repo() ? `https://github.com/${repo()}${path}` : '#');

// ---------- Helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (iso) => (iso ? new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '–');
const daysAgo = (iso) => (iso ? (Date.now() - new Date(iso)) / 864e5 : Infinity);

function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('show'), ms);
}

async function loadJson(path, fallback) {
  try {
    const r = await fetch(path, { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    return await r.json();
  } catch {
    return fallback;
  }
}

// ---------- Render ----------
function render() {
  const rows = festivals.map((f) => {
    const s = state.festivals?.[f.url] || {};
    return { ...f, s, status: s.error ? 'error' : s.status || 'pending' };
  });

  const visible = rows
    .filter((r) => filter === 'all'
      || (filter === 'open' && (r.status === 'open' || r.status === 'mixed'))
      || (filter === 'changed' && daysAgo(r.s.lastChanged) < RECENT_DAYS))
    .sort((a, b) => STATUS[a.status].rank - STATUS[b.status].rank || a.name.localeCompare(b.name, 'de'));

  $('#list').innerHTML = visible.map((r) => {
    const recent = daysAgo(r.s.lastChanged) < RECENT_DAYS;
    const snips = (r.s.snippets || []).map((t) => `<p class="snip">…${esc(t).replace(HIGHLIGHT, '<mark>$1</mark>')}…</p>`).join('');
    return `
      <li class="card ${r.status === 'open' ? 'is-open' : ''}">
        <div class="card-head">
          <div>
            <h3>${esc(r.name)}</h3>
            <a class="url" href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.url.replace(/^https?:\/\//, ''))}</a>
          </div>
          <span class="badge ${r.status}">${STATUS[r.status].label}</span>
        </div>
        ${r.notes ? `<p class="notes">${esc(r.notes)}</p>` : ''}
        <div class="meta">
          <span>Geprüft: ${fmt(r.s.lastChecked)}</span>
          <span class="${recent ? 'new' : ''}">Geändert: ${fmt(r.s.lastChanged)}${recent ? ' • neu' : ''}</span>
          ${r.s.error ? `<span>⚠ ${esc(r.s.error)}</span>` : ''}
        </div>
        ${snips ? `<details><summary>Fundstellen auf der Seite (${r.s.snippets.length})</summary>${snips}</details>` : ''}
      </li>`;
  }).join('');

  $('#empty').hidden = visible.length > 0;
  const openCount = rows.filter((r) => r.status === 'open').length;
  $('#openPill').innerHTML = `<span class="dot ${openCount ? 'on' : ''}"></span><span>${
    openCount === 1 ? '1 Bewerbung offen' : openCount ? `${openCount} Bewerbungen offen` : 'Gerade nichts offen'}</span>`;
  $('#lastRun').textContent = state.lastRun
    ? `${festivals.length} Festivals · letzter Check ${fmt(state.lastRun)}`
    : `${festivals.length} Festivals · noch kein Check gelaufen`;
}

// ---------- Push ----------
function urlBase64ToUint8Array(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function showSubscription(sub) {
  $('#subJson').value = JSON.stringify(sub);
  $('#pushPanel').hidden = false;
}

async function setupPush() {
  const supported = 'serviceWorker' in navigator && 'PushManager' in window;
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (isIos && !standalone) $('#iosHint').hidden = false;
  if (!supported) return;

  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  const btn = $('#pushBtn');
  btn.hidden = false;
  if (existing) {
    btn.textContent = 'Push aktiv';
    btn.classList.remove('primary');
    btn.onclick = () => showSubscription(existing);
    return;
  }
  btn.onclick = async () => {
    if (!cfg.VAPID_PUBLIC_KEY) return toast('Erst VAPID_PUBLIC_KEY in config.js eintragen (siehe README).');
    const perm = await Notification.requestPermission();
    if (perm === 'denied') {
      return toast('Benachrichtigungen sind für diese Seite blockiert. Über das Schloss-Symbol links neben der Adresse → Benachrichtigungen → Zulassen, dann neu laden.', 9000);
    }
    if (perm !== 'granted') return toast('Die Anfrage wurde geschlossen. Bitte nochmal tippen und „Zulassen“ wählen.', 6000);
    try {
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(cfg.VAPID_PUBLIC_KEY) });
      showSubscription(sub);
      btn.textContent = 'Push aktiv';
      btn.classList.remove('primary');
      btn.onclick = () => showSubscription(sub);
    } catch (e) {
      toast('Push-Anmeldung fehlgeschlagen: ' + e.message);
    }
  };
}

// ---------- Events ----------
function bind() {
  $('#repoLink').href = gh('');
  $('#runLink').href = gh('/actions/workflows/check.yml');
  $('#secretsLink').href = gh('/settings/secrets/actions');

  document.querySelectorAll('.chip').forEach((c) => c.addEventListener('click', () => {
    document.querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x === c));
    filter = c.dataset.filter;
    render();
  }));

  $('#copySub').onclick = async () => {
    await navigator.clipboard.writeText($('#subJson').value);
    toast('Kopiert – jetzt als Secret PUSH_SUBSCRIPTIONS speichern.');
  };
  $('#testPush').onclick = async () => {
    const reg = await navigator.serviceWorker.ready;
    reg.showNotification('Test 🎸', { body: 'So sieht eine Benachrichtigung aus.', icon: 'icons/icon-192.png' });
  };

  $('#addToggle').onclick = () => { $('#addForm').hidden = !$('#addForm').hidden; };
  $('#addCancel').onclick = () => { $('#addForm').hidden = true; };
  $('#addForm').onsubmit = async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    const entry = { name: d.name.trim(), url: d.url.trim(), ...(d.notes.trim() && { notes: d.notes.trim() }) };
    if (festivals.some((f) => f.url === entry.url)) return toast('Diese URL ist schon in der Liste.');
    await navigator.clipboard.writeText(',\n  ' + JSON.stringify(entry, null, 2).replace(/\n/g, '\n  '));
    toast('Eintrag kopiert – auf GitHub vor der letzten ] einfügen.');
    if (repo()) window.open(gh(`/edit/${cfg.BRANCH || 'main'}/festivals.json`), '_blank', 'noopener');
    e.target.reset();
    $('#addForm').hidden = true;
  };
}

// ---------- Start ----------
(async () => {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
  bind();
  [festivals, state] = await Promise.all([loadJson('festivals.json', []), loadJson('state.json', { festivals: {} })]);
  render();
  setupPush();
})();
