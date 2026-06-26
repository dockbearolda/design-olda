/* ════════════════════════════════════════════════════
   OLDA · Catalogue — logique d'app (zéro dépendance)
   ════════════════════════════════════════════════════ */
const THUMB = "assets/thumbs/";   // .webp (grille)
const FULL  = "assets/logos/";    // .png  (lightbox)

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (t, c, h) => { const n = document.createElement(t); if (c) n.className = c; if (h != null) n.innerHTML = h; return n; };
const thumb = img => THUMB + img.replace(/\.png$/, ".webp");

let DATA = null;
let activeFamily = "Tout";
let query = "";
let flat = [];          // liste plate {ref, img, cat} pour la navigation lightbox
let lbList = [];        // sous-ensemble courant pour prev/next
let lbIndex = 0;

/* ─────────── boot ─────────── */
init();
async function init(){
  $("#yr").textContent = new Date().getFullYear();
  try{
    DATA = await (await fetch("data/catalog.json")).json();
  }catch(e){
    $("#sections").innerHTML = "<p class='empty'>Catalogue indisponible.</p>";
    return;
  }
  flat = DATA.categories.flatMap(c => c.items.map(i => ({ ...i, cat: c.title, family: c.family })));
  buildMarquee();
  buildFamilies();
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

/* ─────────── filtres univers ─────────── */
function buildFamilies(){
  const counts = { Tout: flat.length };
  DATA.families.forEach(f => counts[f] = flat.filter(i => i.family === f).length);
  const order = ["Tout", ...DATA.families];
  const wrap = $("#families");
  order.forEach((f, i) => {
    const b = el("button", "seg-btn", `${f}<span class="seg-btn__n">${counts[f]}</span>`);
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", f === activeFamily ? "true" : "false");
    b.dataset.fam = f;
    b.addEventListener("click", () => { activeFamily = f; query = ""; $("#search").value = ""; toggleClear(); syncFamilies(); render(); });
    wrap.appendChild(b);
  });
}
function syncFamilies(){
  $$("#families .seg-btn").forEach(b => b.setAttribute("aria-selected", b.dataset.fam === activeFamily ? "true" : "false"));
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
  const cats = DATA.categories.filter(c => activeFamily === "Tout" || c.family === activeFamily);
  lbList = cats.flatMap(c => c.items.map(i => ({ ...i, cat: c.title })));
  cats.forEach(c => sections.appendChild(gridSection(c)));
  const tot = lbList.length;
  $("#count").textContent = `${tot} logos · ${cats.length} collection${cats.length > 1 ? "s" : ""}`;
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
