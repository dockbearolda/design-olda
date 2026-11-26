// Prépare dist-cf/ : les fichiers servis tels quels par Cloudflare (Workers Assets).
// Jamais : le code (worker/, scripts/), ni les originaux privés (assets/_masters).
import fs from 'node:fs';
const OUT = 'dist-cf';
fs.rmSync(OUT, { recursive: true, force: true });
for (const f of ['index.html', 'admin.html', 'sw.js', 'manifest.webmanifest', 'data', 'assets']) {
  fs.cpSync(f, `${OUT}/${f}`, { recursive: true, filter: (src) => !src.includes('_masters') && !src.endsWith('.DS_Store') });
}
console.log('dist-cf prêt');
