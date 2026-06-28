/* ════════════════════════════════════════════════════
   OLDA · Catalogue — logique d'app (zéro dépendance)
   ════════════════════════════════════════════════════ */
const THUMB = "assets/thumbs/";   // .webp (grille)
const FULL  = "assets/logos/";    // .png  (lightbox)

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (t, c, h) => { const n = document.createElement(t); if (c) n.className = c; if (h != null) n.innerHTML = h; return n; };
const thumb = img => THUMB + img.replace(/\.png$/, ".webp");

const HIDDEN_FAMILIES = new Set(["Textile"]); // gérés sur une autre app
let DATA = null;
let activeCat = "Tout";   // "Tout" ou un id de catégorie (famille d'objet)
let query = "";
let flat = [];          // liste plate {ref, img, cat} pour la navigation lightbox
let lbList = [];        // sous-ensemble courant pour prev/next
let lbIndex = 0;
const visibleCats = () => DATA.categories.filter(c => !HIDDEN_FAMILIES.has(c.family));

let HIDDEN = new Set(); // refs masquées par l'admin

/* ─────────── boot ─────────── */
init();
async function init(){
  $("#yr").textContent = new Date().getFullYear();
  try{
    const [catalog, vis] = await Promise.all([
      fetch("data/catalog.json").then(r => r.json()),
      fetch("data/visibility.json").then(r => r.json()).catch(() => ({ hidden: [] })),
    ]);
    DATA = catalog;
    HIDDEN = new Set(vis.hidden || []);
  }catch(e){
    $("#sections").innerHTML = "<p class='empty'>Catalogue indisponible.</p>";
    return;
  }
  // filtrer les items masqués dans chaque catégorie
  DATA.categories = DATA.categories.map(c => ({
    ...c,
    items: c.items.filter(i => !HIDDEN.has(i.ref)),
  }));
  flat = visibleCats().flatMap(c => c.items.map(i => ({ ...i, cat: c.title, family: c.family })));
  buildMarquee();
  buildSidebar();
  render();
  wireUI();
  revealObserver();
}

/* ─────────── marquee ─────────── */
function buildMarquee(){
  // un échantillon varié de logos monochromes
  const mono = (DATA.categories.find(c => c.title === "Logos monochromes") || DATA.categories[0]).items;
  const pick = mono.filter((_, i) => i % 4 === 0).slice(0, 18);
  const row = [...pick, ...pick];           // dupliqué pour boucle infinie
  const frag = document.createDocumentFragment();
  row.forEach(it => {
    const im = new Image();
    im.src = thumb(it.img); im.alt = ""; im.loading = "lazy";
    frag.appendChild(im);
  });
  $("#marquee").appendChild(frag);
}

/* ─────────── sidebar — familles d'objet ─────────── */
function buildSidebar(){
  const side = $("#side");
  side.innerHTML = "";
  const cats = visibleCats();

  // entrée « Tout »
  side.appendChild(sideLink("Tout", "Tout le catalogue", flat.length));

  // groupes par famille (Logos, Objets…), dans l'ordre d'apparition
  const fams = [...new Set(cats.map(c => c.family))];
  fams.forEach(fam => {
    const group = el("div", "side__group");
    group.appendChild(el("p", "side__label", fam));
    cats.filter(c => c.family === fam).forEach(c => {
      group.appendChild(sideLink(c.id, c.title, c.items.length));
    });
    side.appendChild(group);
  });
  syncSidebar();
}
function sideLink(id, title, n){
  const b = el("button", "side__item",
    `<span class="side__name">${esc(title)}</span><span class="side__n">${n}</span>`);
  b.dataset.cat = id;
  b.addEventListener("click", () => {
    activeCat = id; query = ""; $("#search").value = ""; toggleClear();
    syncSidebar(); render(); closeDrawer();
    $("#top").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  return b;
}
function syncSidebar(){
  $$("#side .side__item").forEach(b =>
    b.setAttribute("aria-current", b.dataset.cat === activeCat ? "true" : "false"));
}

/* ─────────── rendu catalogue ─────────── */
function render(){
  const sections = $("#sections");
  const q = query.trim().toLowerCase();
  sections.innerHTML = "";

  // mode recherche → grille plate de résultats
  if (q){
    const matches = flat.filter(i =>
      i.ref.toLowerCase().includes(q) || i.cat.toLowerCase().includes(q));
    lbList = matches;
    if (!matches.length){
      $("#empty").hidden = false; $("#emptyTerm").textContent = query;
      $("#count").textContent = "";
      return;
    }
    $("#empty").hidden = true;
    sections.appendChild(gridSection({ title: "Résultats", sub: `pour « ${query} »`, items: matches }, true));
    $("#count").textContent = `${matches.length} logo${matches.length > 1 ? "s" : ""} trouvé${matches.length > 1 ? "s" : ""}`;
    revealObserver();
    return;
  }

  $("#empty").hidden = true;
  const cats = activeCat === "Tout" ? visibleCats() : visibleCats().filter(c => c.id === activeCat);
  lbList = cats.flatMap(c => c.items.map(i => ({ ...i, cat: c.title })));
  cats.forEach(c => sections.appendChild(gridSection(c)));
  const tot = lbList.length;
  $("#count").textContent = `${tot} logos · ${cats.length} famille${cats.length > 1 ? "s" : ""}`;
  revealObserver();
}

function gridSection(c, isSearch){
  const sec = el("section", "cat");
  sec.id = isSearch ? "" : slug(c.title);
  const head = el("div", "cat__head");
  head.appendChild(el("h2", "cat__title", c.title));
  if (c.subtitle || c.sub) head.appendChild(el("p", "cat__sub", c.subtitle || c.sub));
  head.appendChild(el("span", "cat__n", `${c.items.length}`));
  sec.appendChild(head);
  sec.appendChild(el("div", "cat__divider"));

  const grid = el("div", "grid");
  c.items.forEach((it, i) => {
    const card = el("button", "card reveal");
    card.style.setProperty("--d", Math.min(i, 8));
    card.innerHTML =
      `<div class="card__media"><img src="${thumb(it.img)}" alt="Logo ${esc(it.ref)}" loading="lazy" decoding="async"></div>
       <div class="card__foot">
         <span class="card__ref">${esc(it.ref)}</span>
         <span class="card__zoom"><svg viewBox="0 0 24 24" width="13" height="13"><path d="M7 17L17 7M17 7H9M17 7v8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
       </div>`;
    card.addEventListener("click", () => openLB(it, c.title));
    grid.appendChild(card);
  });
  sec.appendChild(grid);
  return sec;
}

/* ─────────── lightbox ─────────── */
function openLB(item, catTitle){
  lbIndex = lbList.findIndex(i => i.img === item.img && i.ref === item.ref);
  if (lbIndex < 0) lbIndex = 0;
  showLB(catTitle);
  const lb = $("#lb");
  lb.hidden = false;
  document.body.style.overflow = "hidden";
}
function showLB(catTitle){
  const it = lbList[lbIndex];
  if (!it) return;
  const img = $("#lbImg");
  img.src = FULL + it.img;
  img.alt = "Logo " + it.ref;
  $("#lbRef").textContent = it.ref;
  $("#lbCat").textContent = it.cat || catTitle || "";
  const copy = $("#lbCopy");
  copy.classList.remove("done");
  copy.querySelector("span").textContent = "Copier la référence";
}
function closeLB(){ $("#lb").hidden = true; document.body.style.overflow = ""; }
function stepLB(d){ lbIndex = (lbIndex + d + lbList.length) % lbList.length; showLB(); }

/* ─────────── UI wiring ─────────── */
function wireUI(){
  // nav scroll state
  const nav = $("#nav");
  const onScroll = () => nav.classList.toggle("scrolled", window.scrollY > 12);
  onScroll(); addEventListener("scroll", onScroll, { passive: true });

  // tiroir sidebar (mobile)
  $("#navToggle").addEventListener("click", () =>
    document.body.classList.contains("drawer-open") ? closeDrawer() : openDrawer());
  $("#scrim").addEventListener("click", closeDrawer);
  addEventListener("keydown", e => { if (e.key === "Escape") closeDrawer(); });

  // recherche
  const search = $("#search");
  let t;
  search.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => { query = search.value; toggleClear(); render(); }, 120);
  });
  $("#searchClear").addEventListener("click", () => { search.value = ""; query = ""; toggleClear(); render(); search.focus(); });

  // lightbox
  $("#lbClose").addEventListener("click", closeLB);
  $("#lbPrev").addEventListener("click", () => stepLB(-1));
  $("#lbNext").addEventListener("click", () => stepLB(1));
  $("#lb").addEventListener("click", e => { if (e.target === $("#lb")) closeLB(); });
  $("#lbCopy").addEventListener("click", async () => {
    const ref = lbList[lbIndex]?.ref || "";
    try{ await navigator.clipboard.writeText(ref); }catch(e){}
    const b = $("#lbCopy"); b.classList.add("done"); b.querySelector("span").textContent = "Référence copiée ✓";
  });
  addEventListener("keydown", e => {
    if ($("#lb").hidden) return;
    if (e.key === "Escape") closeLB();
    if (e.key === "ArrowLeft") stepLB(-1);
    if (e.key === "ArrowRight") stepLB(1);
  });
}
function toggleClear(){ $("#searchClear").hidden = !$("#search").value; }
function openDrawer(){
  document.body.classList.add("drawer-open");
  $("#scrim").hidden = false;
  $("#navToggle").setAttribute("aria-expanded", "true");
}
function closeDrawer(){
  document.body.classList.remove("drawer-open");
  $("#scrim").hidden = true;
  $("#navToggle").setAttribute("aria-expanded", "false");
}

/* ─────────── reveal on scroll ─────────── */
let io;
function revealObserver(){
  if (!io){
    io = new IntersectionObserver((ents) => {
      ents.forEach(en => { if (en.isIntersecting){ en.target.classList.add("in"); io.unobserve(en.target); } });
    }, { rootMargin: "0px 0px -8% 0px", threshold: .05 });
  }
  $$(".reveal:not(.in)").forEach(n => io.observe(n));
}

/* ─────────── utils ─────────── */
function slug(s){ return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,""); }
function esc(s){ return String(s).replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c])); }
