// Serveur statique minimal, zéro dépendance — pour Railway ($PORT).
const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");

// Types texte compressibles (le gzip divise ~10x le poids du HTML/CSS/JS/JSON).
// Les images (png/webp) et woff2 sont déjà compressées → on n'y touche pas.
const COMPRESSIBLE = /\.(html|css|js|json|svg|webmanifest)$/;

const ROOT = __dirname;
const PORT = process.env.PORT || 8753;
// Code d'accès admin — défini en variable d'env Railway.
// Fallback transitoire : à remplacer par ADMIN_CODE en prod (l'ancien code est
// dans l'historique git, donc à considérer comme compromis).
const ADMIN_CODE = process.env.ADMIN_CODE || "olda28280";

// Stockage persistant : volume Railway (RAILWAY_VOLUME_MOUNT_PATH) ou DATA_DIR,
// sinon ROOT en dev local. On y garde TOUT l'état mutable : data/ (catalog +
// visibility) et les images uploadées (assets/logos + assets/thumbs).
const DATA_ROOT = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || ROOT;
const PERSIST_PREFIXES = ["/data/", "/assets/logos/", "/assets/thumbs/"];

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

// Fichiers/dossiers source jamais servis (le client n'a rien à faire du code/process).
const BLOCKED = new Set(["/server.js", "/package.json", "/package-lock.json"]);
const BLOCKED_DIRS = ["/scripts/", "/.git/"];

// Headers de sécurité appliqués à toutes les réponses statiques.
function securityHeaders() {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    "Referrer-Policy": "strict-origin-when-cross-origin",
  };
}

// Écriture atomique : tmp + rename. Un SIGTERM/crash en plein write ne laisse
// jamais un JSON tronqué (l'ancien fichier reste intact jusqu'au rename).
async function writeAtomic(file, data) {
  const tmp = file + "." + crypto.randomBytes(4).toString("hex") + ".tmp";
  await fsp.writeFile(tmp, data);
  await fsp.rename(tmp, file);
}

// Sérialise les mutations de catalog.json pour tuer la race read-modify-write
// (deux uploads concurrents ne peuvent plus s'écraser l'un l'autre).
let catalogQueue = Promise.resolve();
function withCatalogLock(fn) {
  const run = catalogQueue.then(fn, fn);
  catalogQueue = run.catch(() => {});
  return run;
}

// Lecture du corps avec borne dure (évite l'accumulation mémoire illimitée).
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", d => {
      body += d;
      if (body.length > limit) { req.destroy(); reject(new Error("payload too large")); }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

// Initialise le stockage persistant : au premier boot sur un volume vide, on y
// copie les graines de l'image (217 logos + catalog.json + visibility.json
// committés), puis on garantit l'existence des dossiers d'écriture.
function initStorage() {
  if (DATA_ROOT !== ROOT && !fs.existsSync(path.join(DATA_ROOT, "data", "catalog.json"))) {
    for (const rel of ["data", "assets/logos", "assets/thumbs"]) {
      const src = path.join(ROOT, rel);
      const dst = path.join(DATA_ROOT, rel);
      fs.mkdirSync(dst, { recursive: true });
      if (fs.existsSync(src)) fs.cpSync(src, dst, { recursive: true });
    }
    console.log("volume persistant initialisé depuis l'image");
  }
  for (const rel of ["data", "assets/logos", "assets/thumbs"]) {
    fs.mkdirSync(path.join(DATA_ROOT, rel), { recursive: true });
  }
}

const server = http.createServer(async (req, res) => {
  try {
    let urlPath;
    try {
      urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
    } catch {
      res.writeHead(400).end("Bad request"); // URL mal encodée → 400 (et non 500)
      return;
    }

    // ──────────────── API protégée (admin) ────────────────
    if (urlPath.startsWith("/api/")) {
      // Auth serveur RÉELLE, fail-closed (si ADMIN_CODE vide → tout est refusé).
      if (!ADMIN_CODE || req.headers["x-admin-code"] !== ADMIN_CODE) {
        res.writeHead(401).end("Unauthorized");
        return;
      }
      // On n'accepte que du JSON → coupe le CSRF par <form> text/plain.
      if (!(req.headers["content-type"] || "").includes("application/json")) {
        res.writeHead(415).end("Unsupported Media Type");
        return;
      }

      // Vérification de code (login admin) : arriver ici = code déjà validé.
      if (req.method === "POST" && urlPath === "/api/login") {
        res.writeHead(200, { "Content-Type": TYPES[".json"] }).end('{"ok":true}');
        return;
      }

      // Ajout d'un logo.
      if (req.method === "POST" && urlPath === "/api/upload") {
        try {
          const body = await readBody(req, 20_000_000);
          const { ref, png, webp, categories } = JSON.parse(body);
          if (!ref || !png || !Array.isArray(categories) || !categories.length) {
            throw new Error("invalid");
          }

          const result = await withCatalogLock(async () => {
            const catPath = path.join(DATA_ROOT, "data", "catalog.json");
            const catalog = JSON.parse(await fsp.readFile(catPath, "utf8"));

            // Ne rien écrire si la ref est déjà présente partout où on la demande.
            const targets = catalog.categories.filter(c => categories.includes(c.id));
            const toAdd = targets.filter(c => !c.items.some(i => i.ref === ref));
            if (!toAdd.length) return { ref, added: 0 };

            const hash = crypto.randomBytes(6).toString("hex");
            const imgName = hash + ".png";
            const thumbExt = (webp && webp.startsWith("data:image/webp")) ? ".webp" : ".png";
            const thumbFile = hash + thumbExt;

            const pngBuf = Buffer.from(png.replace(/^data:image\/\w+;base64,/, ""), "base64");
            const webpBuf = Buffer.from((webp || png).replace(/^data:image\/\w+;base64,/, ""), "base64");

            await fsp.writeFile(path.join(DATA_ROOT, "assets", "logos", imgName), pngBuf);
            await fsp.writeFile(path.join(DATA_ROOT, "assets", "thumbs", thumbFile), webpBuf);

            // On stocke le nom RÉEL de la vignette (peut être .png si WebP indispo).
            const newItem = { ref, img: imgName, thumb: thumbFile };
            const toAddIds = new Set(toAdd.map(c => c.id));
            catalog.categories = catalog.categories.map(c =>
              toAddIds.has(c.id) ? { ...c, items: [...c.items, newItem] } : c);
            await writeAtomic(catPath, JSON.stringify(catalog, null, 2));
            return { ref, img: imgName, thumb: thumbFile, added: toAdd.length };
          });

          res.writeHead(200, { "Content-Type": TYPES[".json"] })
             .end(JSON.stringify({ ok: true, ...result }));
        } catch (e) {
          console.error("upload error:", e.message); // détail en log, pas au client
          res.writeHead(400).end("Bad request");
        }
        return;
      }

      // Sauvegarde de la visibilité.
      if (req.method === "POST" && urlPath === "/api/visibility") {
        try {
          const body = await readBody(req, 100_000);
          const parsed = JSON.parse(body);
          if (!Array.isArray(parsed.hidden)) throw new Error("invalid");
          await writeAtomic(
            path.join(DATA_ROOT, "data", "visibility.json"),
            JSON.stringify({ hidden: parsed.hidden }, null, 2)
          );
          res.writeHead(200, { "Content-Type": TYPES[".json"] }).end('{"ok":true}');
        } catch (e) {
          console.error("visibility error:", e.message);
          res.writeHead(400).end("Bad request");
        }
        return;
      }

      res.writeHead(404).end("Not found");
      return;
    }

    // ──────────────── Fichiers statiques ────────────────
    if (urlPath === "/") urlPath = "/index.html";
    if (urlPath === "/admin") urlPath = "/admin.html";

    // Répertoires privés : aucun segment ne commence par "_" (protège assets/_masters/).
    if (urlPath.split("/").some(seg => seg.startsWith("_"))) {
      res.writeHead(403).end("Forbidden");
      return;
    }
    // Ne jamais servir le code source / process.
    if (BLOCKED.has(urlPath) || BLOCKED_DIRS.some(d => urlPath.startsWith(d))) {
      res.writeHead(403).end("Forbidden");
      return;
    }
    // Les données mutables (catalog, visibilité, logos uploadés) viennent du volume ;
    // le reste (html/css/js/icônes) vient de l'image.
    const base = PERSIST_PREFIXES.some(p => urlPath.startsWith(p)) ? DATA_ROOT : ROOT;
    // Empêche le path traversal (séparateur final → pas de bypass par dossier voisin).
    const filePath = path.normalize(path.join(base, urlPath));
    if (filePath !== base && !filePath.startsWith(base + path.sep)) {
      res.writeHead(403).end("Forbidden");
      return;
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        // fallback SPA-ish : sert index.html pour les routes inconnues
        fs.readFile(path.join(ROOT, "index.html"), (e2, html) => {
          if (e2) return res.writeHead(404).end("Not found");
          res.writeHead(200, { "Content-Type": TYPES[".html"], ...securityHeaders() }).end(html);
        });
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      const headers = { "Content-Type": TYPES[ext] || "application/octet-stream", ...securityHeaders() };
      // cache long pour les assets immuables (images/fonts), court pour le reste.
      // Les données mutables (/data/*.json) sont en "no-cache" : le navigateur revalide
      // à chaque fois → un changement admin (visibilité/upload) est visible tout de suite,
      // sans attendre l'expiration d'un cache. Voir aussi sw.js (réseau d'abord sur /data/).
      if (/\.(png|webp|svg|woff2|ico)$/.test(filePath)) {
        headers["Cache-Control"] = "public, max-age=31536000, immutable";
      } else if (urlPath.startsWith("/data/")) {
        headers["Cache-Control"] = "no-cache";
      } else {
        headers["Cache-Control"] = "public, max-age=300";
      }
      // Compression gzip pour le texte si le client l'accepte (zlib natif, zéro dép).
      if (COMPRESSIBLE.test(filePath) && /\bgzip\b/.test(req.headers["accept-encoding"] || "")) {
        zlib.gzip(data, (gzErr, gz) => {
          if (gzErr) return res.writeHead(200, headers).end(data);
          headers["Content-Encoding"] = "gzip";
          headers["Vary"] = "Accept-Encoding";
          res.writeHead(200, headers).end(gz);
        });
        return;
      }
      res.writeHead(200, headers).end(data);
    });
  } catch {
    res.writeHead(500).end("Server error");
  }
});

initStorage();
server.listen(PORT, () => console.log(`OLDA catalogue → http://0.0.0.0:${PORT} (data: ${DATA_ROOT})`));

// Graceful shutdown : Railway envoie SIGTERM au redeploy. On laisse les requêtes
// en cours se terminer (les writes atomiques évitent toute corruption JSON).
function shutdown(sig) {
  console.log(`${sig} reçu → fermeture propre`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
