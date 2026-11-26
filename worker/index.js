// Design OLDA sur Cloudflare. Les pages, CSS, JS, polices et les 217 logos d'origine sont des fichiers statiques
// (dist-cf, préparé par scripts/build-cf.mjs). Ce qui change depuis l'admin (catalogue, visibilité, logos ajoutés)
// vit dans le bucket R2 `design-olda-data`, sous le même chemin que l'URL ; tant qu'un fichier n'y est pas, on sert
// celui du dépôt. Même comportement que l'ancien server.js.

// Code d'accès admin : secret ADMIN_CODE (`wrangler secret put ADMIN_CODE`). À défaut, l'ancien code de secours,
// celui qui servait déjà en production (il est dans l'historique git : à remplacer par le secret).
const CODE_SECOURS = 'olda28280';
const MUTABLES = ['/data/', '/assets/logos/', '/assets/thumbs/'];
const TYPES = { json: 'application/json; charset=utf-8', png: 'image/png', webp: 'image/webp', svg: 'image/svg+xml' };
// Affichable en onglet dans le Dashboard (dockbearolda.github.io), nulle part ailleurs.
const SECURITE = {
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': "frame-ancestors 'self' https://dockbearolda.github.io http://localhost:* http://127.0.0.1:*",
};

const texte = (status, corps) => new Response(corps, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITE } });
const json = (obj) => new Response(JSON.stringify(obj), { headers: { 'Content-Type': TYPES.json, ...SECURITE } });
const cacheDe = (p) => (p.startsWith('/data/') ? 'no-cache' : /\.(png|webp|svg|woff2|ico)$/.test(p) ? 'public, max-age=31536000, immutable' : 'public, max-age=300');

function octets(dataUrl) {
  const bin = atob(String(dataUrl).replace(/^data:image\/\w+;base64,/, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const hasard = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');

// Fichier mutable : R2 d'abord, sinon la version du dépôt.
async function lire(env, request, chemin) {
  const obj = await env.DATA.get(chemin.slice(1));
  const h = new Headers(SECURITE);
  h.set('Cache-Control', cacheDe(chemin));
  if (obj) {
    h.set('Content-Type', obj.httpMetadata?.contentType || TYPES[chemin.split('.').pop()] || 'application/octet-stream');
    h.set('ETag', obj.httpEtag);
    return new Response(request.method === 'HEAD' ? null : obj.body, { headers: h });
  }
  const r = await env.ASSETS.fetch(new Request(new URL(chemin, request.url), { method: request.method === 'HEAD' ? 'HEAD' : 'GET' }));
  if (!r.ok || (r.headers.get('content-type') || '').startsWith('text/html')) return texte(404, 'Not found');
  for (const [k, v] of r.headers) if (!h.has(k)) h.set(k, v);
  return new Response(r.body, { status: r.status, headers: h });
}

// Catalogue courant (R2, sinon le dépôt) avec son etag R2 pour une écriture sans écraser une autre.
async function catalogue(env, request) {
  const obj = await env.DATA.get('data/catalog.json');
  if (obj) return { cat: await obj.json(), etag: obj.etag };
  const r = await env.ASSETS.fetch(new Request(new URL('/data/catalog.json', request.url)));
  return { cat: await r.json(), etag: null };
}

async function api(request, env, chemin) {
  const code = env.ADMIN_CODE || CODE_SECOURS;
  if (request.headers.get('x-admin-code') !== code) return texte(401, 'Unauthorized');
  // On n'accepte que du JSON : coupe le CSRF par <form> text/plain.
  if (!(request.headers.get('content-type') || '').includes('application/json')) return texte(415, 'Unsupported Media Type');
  if (request.method !== 'POST') return texte(404, 'Not found');

  if (chemin === '/api/login') return json({ ok: true });

  if (chemin === '/api/visibility') {
    try {
      const corps = await request.text();
      if (corps.length > 100_000) throw new Error('trop long');
      const { hidden } = JSON.parse(corps);
      if (!Array.isArray(hidden)) throw new Error('invalide');
      await env.DATA.put('data/visibility.json', JSON.stringify({ hidden }, null, 2), { httpMetadata: { contentType: TYPES.json } });
      return json({ ok: true });
    } catch { return texte(400, 'Bad request'); }
  }

  if (chemin === '/api/upload') {
    try {
      if (Number(request.headers.get('content-length') || 0) > 20_000_000) throw new Error('trop lourd');
      const { ref, png, webp, categories } = await request.json();
      if (!ref || !png || !Array.isArray(categories) || !categories.length) throw new Error('invalide');
      let fichiers = null;
      // Deux ajouts en même temps : l'écriture conditionnelle (etag) refuse le second, qui relit et recommence.
      for (let essai = 0; essai < 5; essai++) {
        const { cat, etag } = await catalogue(env, request);
        const aAjouter = cat.categories.filter((c) => categories.includes(c.id) && !c.items.some((i) => i.ref === ref));
        if (!aAjouter.length) return json({ ok: true, ref, added: 0 });
        if (!fichiers) {
          const h = hasard(6);
          const ext = webp && webp.startsWith('data:image/webp') ? 'webp' : 'png';
          fichiers = { img: h + '.png', thumb: h + '.' + ext };
          await env.DATA.put('assets/logos/' + fichiers.img, octets(png), { httpMetadata: { contentType: TYPES.png } });
          await env.DATA.put('assets/thumbs/' + fichiers.thumb, octets(webp || png), { httpMetadata: { contentType: TYPES[ext] } });
        }
        const ids = new Set(aAjouter.map((c) => c.id));
        cat.categories = cat.categories.map((c) => (ids.has(c.id) ? { ...c, items: [...c.items, { ref, ...fichiers }] } : c));
        const ok = await env.DATA.put('data/catalog.json', JSON.stringify(cat, null, 2), {
          httpMetadata: { contentType: TYPES.json }, onlyIf: etag ? { etagMatches: etag } : { etagDoesNotMatch: '*' },
        });
        if (ok) return json({ ok: true, ref, ...fichiers, added: aAjouter.length });
      }
      return texte(409, 'Conflict');
    } catch (e) {
      console.error('upload :', e.message);
      return texte(400, 'Bad request');
    }
  }
  return texte(404, 'Not found');
}

export default {
  async fetch(request, env) {
    let chemin;
    try { chemin = decodeURIComponent(new URL(request.url).pathname); } catch { return texte(400, 'Bad request'); }
    if (chemin.startsWith('/api/')) return api(request, env, chemin);
    if (chemin.split('/').some((s) => s.startsWith('_')) || chemin.includes('..')) return texte(403, 'Forbidden');
    if (MUTABLES.some((p) => chemin.startsWith(p))) return lire(env, request, chemin);
    const r = await env.ASSETS.fetch(new Request(new URL(chemin, request.url), request));
    const h = new Headers(r.headers);
    for (const [k, v] of Object.entries(SECURITE)) h.set(k, v);
    if (r.ok && !h.has('Cache-Control')) h.set('Cache-Control', cacheDe(chemin));
    return new Response(r.body, { status: r.status, headers: h });
  },
};
