// mup! — service worker: funciona sin conexión y envía el resumen diario de avisos
const CACHE = 'mup-v11';
const DATA = 'mup-data';            // aquí la app deja una copia de las tareas para poder avisar
const ASSETS = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png', './favicon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== DATA).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (req.url.includes('__mup-')) return;
  // La página: primero red (para recibir actualizaciones), si no hay conexión, la copia guardada
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(res => { const c = res.clone(); caches.open(CACHE).then(ca => ca.put('./index.html', c)); return res; })
      .catch(() => caches.match('./index.html')));
    return;
  }
  // Resto (iconos, tipografía): primero la copia guardada
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
    if (res.ok || res.type === 'opaque') { const c = res.clone(); caches.open(CACHE).then(ca => ca.put(req, c)); }
    return res;
  })));
});

/* ---------- Resumen diario (Android la despierta más o menos una vez al día) ---------- */
const pad = n => String(n).padStart(2, '0');
const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; };

async function dailySummary(){
  const c = await caches.open(DATA);
  const r = await c.match(new URL('__mup-state', self.registration.scope));
  if (!r) return;
  const st = await r.json();
  if (!st.notify) return;
  const t = todayKey();
  const last = await c.match(new URL('__mup-daily', self.registration.scope));
  if (last && (await last.text()) === t) return;              // ya avisó hoy
  const p = (st.notes || []).filter(n => !n.done && n.type === 'task' && n.date <= t);
  if (!p.length) return;
  const late = p.filter(n => n.date < t).length, imp = p.filter(n => n.star);
  const first = s => (s.text || '').split('\n')[0];
  const title = `Tienes ${p.length} tarea${p.length === 1 ? '' : 's'} pendiente${p.length === 1 ? '' : 's'}`;
  let body = imp.length ? `⭐ Importante: ${first(imp[0])}${imp.length > 1 ? ` y ${imp.length - 1} más` : ''}` : p.slice(0, 3).map(first).join(' · ');
  if (late) body += `\n${late} de días anteriores`;
  await self.registration.showNotification(title, { body, icon: 'icon-192.png', badge: 'icon-192.png', tag: 'mup-daily' });
  await c.put(new URL('__mup-daily', self.registration.scope), new Response(t));
}
self.addEventListener('periodicsync', e => { if (e.tag === 'mup-daily') e.waitUntil(dailySummary()); });

// Al tocar un aviso, abrir mup!
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => cs.length ? cs[0].focus() : self.clients.openWindow('./')));
});
