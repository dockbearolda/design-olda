// Serveur statique minimal, zéro dépendance — pour Railway ($PORT).
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const PORT = process.env.PORT || 8753;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

http
  .createServer((req, res) => {
    try {
      let urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (urlPath === "/") urlPath = "/index.html";
      // empêche le path traversal
      const filePath = path.normalize(path.join(ROOT, urlPath));
      if (!filePath.startsWith(ROOT)) {
        res.writeHead(403).end("Forbidden");
        return;
      }
      fs.readFile(filePath, (err, data) => {
        if (err) {
          // fallback SPA-ish : sert index.html pour les routes inconnues
          fs.readFile(path.join(ROOT, "index.html"), (e2, html) => {
            if (e2) return res.writeHead(404).end("Not found");
            res.writeHead(200, { "Content-Type": TYPES[".html"] }).end(html);
          });
          return;
        }
        const ext = path.extname(filePath).toLowerCase();
        const headers = { "Content-Type": TYPES[ext] || "application/octet-stream" };
        // cache long pour les assets immuables (images/fonts), court pour le reste
        if (/\.(png|webp|svg|woff2|ico)$/.test(filePath)) {
          headers["Cache-Control"] = "public, max-age=31536000, immutable";
        } else {
          headers["Cache-Control"] = "public, max-age=300";
        }
        res.writeHead(200, headers).end(data);
      });
    } catch {
      res.writeHead(500).end("Server error");
    }
  })
  .listen(PORT, () => console.log(`OLDA catalogue → http://0.0.0.0:${PORT}`));
