// Serveur statique minimal, zéro dépendance — pour Railway ($PORT).
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

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

      // API : ajout d'un logo (admin)
      if (req.method === "POST" && urlPath === "/api/upload") {
        let body = "";
        req.on("data", d => { body += d; if (body.length > 20_000_000) req.destroy(); });
        req.on("end", () => {
          try {
            const { ref, png, webp, categories } = JSON.parse(body);
            if (!ref || !png || !Array.isArray(categories) || !categories.length) throw new Error("invalid");

            const hash = crypto.randomBytes(6).toString("hex");
            const imgName = hash + ".png";
            const thumbName = hash + ".webp";

            const pngBuf = Buffer.from(png.replace(/^data:image\/\w+;base64,/, ""), "base64");
            const webpBuf = Buffer.from((webp || png).replace(/^data:image\/\w+;base64,/, ""), "base64");
            const thumbExt = (webp && webp.startsWith("data:image/webp")) ? ".webp" : ".png";
            const thumbFile = hash + thumbExt;

            fs.writeFileSync(path.join(ROOT, "assets", "logos", imgName), pngBuf);
            fs.writeFileSync(path.join(ROOT, "assets", "thumbs", thumbFile), webpBuf);

            // mise à jour catalog.json
            const catPath = path.join(ROOT, "data", "catalog.json");
            const catalog = JSON.parse(fs.readFileSync(catPath, "utf8"));
            const newItem = { ref, img: imgName };
            let added = 0;
            catalog.categories = catalog.categories.map(cat => {
              if (!categories.includes(cat.id)) return cat;
              if (cat.items.some(i => i.ref === ref)) return cat; // doublon
              added++;
              return { ...cat, items: [...cat.items, newItem] };
            });
            fs.writeFileSync(catPath, JSON.stringify(catalog, null, 2));

            res.writeHead(200, { "Content-Type": TYPES[".json"] })
               .end(JSON.stringify({ ok: true, ref, img: imgName, thumb: thumbFile, added }));
          } catch(e) {
            res.writeHead(400).end("Bad request: " + e.message);
          }
        });
        return;
      }

      // API : sauvegarde de la visibilité (admin)
      if (req.method === "POST" && urlPath === "/api/visibility") {
        let body = "";
        req.on("data", d => { body += d; if (body.length > 100000) req.destroy(); });
        req.on("end", () => {
          try {
            const parsed = JSON.parse(body);
            if (!Array.isArray(parsed.hidden)) throw new Error("invalid");
            const visPath = path.join(ROOT, "data", "visibility.json");
            fs.writeFile(visPath, JSON.stringify({ hidden: parsed.hidden }, null, 2), err => {
              if (err) return res.writeHead(500).end("Write error");
              res.writeHead(200, { "Content-Type": TYPES[".json"] }).end('{"ok":true}');
            });
          } catch {
            res.writeHead(400).end("Bad request");
          }
        });
        return;
      }

      if (urlPath === "/") urlPath = "/index.html";
      // répertoires privés : aucun segment ne peut commencer par "_"
      // (protège assets/_masters/ — les originaux propres, sans filigrane)
      if (urlPath.split("/").some(seg => seg.startsWith("_"))) {
        res.writeHead(403).end("Forbidden");
        return;
      }
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
