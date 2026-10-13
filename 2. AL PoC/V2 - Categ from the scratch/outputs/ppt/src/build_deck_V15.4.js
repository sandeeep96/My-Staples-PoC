// Builds the Staples Assortment PoC deck from deck_facts_<VERSION>.json.
// Usage (from outputs/ppt/src):  node build_deck.js V4
// Output: outputs/ppt/Staples_Assortment_PoC_Deck_<VERSION>.pptx (never overwrites an existing version).
const fs = require("fs");
const path = require("path");
const pptxgen = require("pptxgenjs");
const React = require("react");
const ReactDOMServer = require("react-dom/server");
const sharp = require("sharp");
const fa = require("react-icons/fa");
const tb = require("react-icons/tb");

const VERSION = process.argv[2] || "V1";
const FORCE = process.argv.includes("--force");
const F = JSON.parse(fs.readFileSync(path.join(__dirname, `deck_facts_${VERSION}.json`), "utf8"));
const OUT = path.resolve(__dirname, "..", `Staples_Assortment_PoC_Deck_${VERSION}.pptx`);
const LOGO = path.resolve(__dirname, "..", "assets", "latentview_logo.png");
if (fs.existsSync(OUT) && !FORCE) {
  console.error(`${OUT} exists. Versions are never overwritten: use the next version (or --force while iterating).`);
  process.exit(1);
}

// ---------- palette (LatentView house style, retailer colours for the comparison) ----------
const C = {
  navy: "13285B", blue: "1F4E9A", mid: "2F6FD0", sky: "8FB0E8", pale: "DCE7F8", paler: "EEF3FB",
  head: "B9CEF2", orange: "F5A623", text: "1F2937", muted: "5B6475", line: "C9D3E3", white: "FFFFFF",
  staples: "CC0000", wayfair: "7F187F", amazon: "C45500", amazonFill: "FF9900", amazonInk: "232F3E",
  strong: "1E8E5A", vector: "2F6FD0", gap: "B86E00", cond: "6B7280", warnFill: "FFF4E0",
};
const SEG = {
  "Hero · EXTEND": { fill: C.navy, ink: C.white, short: "HERO · EXTEND" },
  "Probable Hero · BUILD": { fill: C.mid, ink: C.white, short: "PROBABLE HERO · BUILD" },
  "Non-Hero · EXPLORE": { fill: C.sky, ink: C.navy, short: "NON-HERO · EXPLORE" },
};
const TIER = { Strong: C.strong, "Vector-led": C.vector, "Gap-led": C.gap, Conditional: C.cond };
const FONT = "Calibri";

// ---------- helpers ----------
async function icon(Comp, color, px = 256) {
  const svg = ReactDOMServer.renderToStaticMarkup(React.createElement(Comp, { color: "#" + color, size: px }));
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();
  return "image/png;base64," + buf.toString("base64");
}
// "**bold**" markup -> pptxgenjs runs (bold runs take `hi` colour)
function runs(str, base = {}, hi = C.blue) {
  const out = [];
  str.split(/(\*\*[^*]+\*\*)/).filter(Boolean).forEach((part) => {
    const b = part.startsWith("**");
    out.push({ text: b ? part.slice(2, -2) : part, options: { ...base, bold: b || base.bold, color: b ? hi : base.color } });
  });
  return out;
}
// one paragraph of markup runs; breakLine only on its last run
function para(str, base = {}, hi = C.blue, last = false) {
  const r = runs(str, base, hi);
  if (!last) r[r.length - 1].options.breakLine = true;
  return r;
}
const money = (x) => "$" + (x >= 1000 ? Math.round(x).toLocaleString("en-US") : (Math.round(x) === x ? x : x.toFixed(2)));
const money0 = (x) => "$" + Math.round(x).toLocaleString("en-US");
const S = F.stats, B = F.bands, N = F.nodes;
const shortTitle = (t, n = 44) => {
  t = t.replace(/\s+/g, " ").trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n);
  return cut.slice(0, cut.lastIndexOf(" ")).replace(/[,\-–:;|]+$/, "") + "…";
};
function box(slide, x, y, w, h, fill, opts = {}) {
  slide.addShape(opts.rect ? "rect" : "roundRect", {
    x, y, w, h, fill: { color: fill }, line: opts.line ? { color: opts.line, width: opts.lineW || 0.75, dashType: opts.dash } : { color: fill, width: 0 },
    rectRadius: opts.rect ? undefined : (opts.r ?? 0.08), shadow: opts.shadow ? { type: "outer", color: "9AA5B8", blur: 4, offset: 1.5, angle: 90, opacity: 0.35 } : undefined,
    objectName: opts.name,
  });
}
function text(slide, t, x, y, w, h, o = {}) {
  slide.addText(t, { x, y, w, h, fontFace: FONT, fontSize: 12, color: C.text, valign: "top", margin: 0, isTextBox: true, ...o });
}
function circleIcon(slide, img, x, y, d, fill) {
  slide.addShape("ellipse", { x, y, w: d, h: d, fill: { color: fill }, line: { color: fill, width: 0 } });
  const p = d * 0.22;
  slide.addImage({ data: img, x: x + p, y: y + p, w: d - 2 * p, h: d - 2 * p });
}
function chip(slide, label, x, y, w, h, fill, ink = C.white, size = 9) {
  slide.addShape("roundRect", { x, y, w, h, fill: { color: fill }, line: { color: fill, width: 0 }, rectRadius: h / 2 });
  text(slide, label, x, y, w, h, { fontSize: size, bold: true, color: ink, align: "center", valign: "middle" });
}

(async () => {
  const pres = new pptxgen();
  pres.layout = "LAYOUT_WIDE"; // 13.333 x 7.5 in
  pres.author = "LatentView Analytics";
  pres.company = "LatentView Analytics";
  pres.title = "Staples Marketplace: Assortment Gap and Archetype Recommendation PoC";
  pres.theme = { headFontFace: FONT, bodyFontFace: FONT };

  const hasLogo = fs.existsSync(LOGO);
  const logoObj = hasLogo ? [{ image: { path: LOGO, x: 11.85, y: 0.22, w: 1.05, h: 0.62, sizing: { type: "contain", w: 1.05, h: 0.62 } } }] : [];

  pres.defineSlideMaster({
    title: "CONTENT",
    background: { color: C.white },
    objects: [
      { rect: { x: 0.45, y: 1.0, w: 1.1, h: 0.06, fill: { color: C.orange }, line: { color: C.orange, width: 0 } } },
      { rect: { x: 1.55, y: 1.0, w: 11.33, h: 0.06, fill: { color: C.blue }, line: { color: C.blue, width: 0 } } },
      { text: { text: "Staples × LatentView  |  Assortment Gap & Archetype PoC  |  Confidential", options: { x: 0.45, y: 7.14, w: 8, h: 0.24, fontFace: FONT, fontSize: 9, color: "7A8599", margin: 0 } } },
      ...logoObj,
      { placeholder: { options: { name: "title", type: "title", x: 0.45, y: 0.24, w: hasLogo ? 11.2 : 12.43, h: 0.72, fontFace: FONT, fontSize: 28, bold: true, color: C.blue, align: "left", valign: "middle", margin: 0 }, text: "" } },
    ],
    slideNumber: { x: 12.38, y: 7.12, w: 0.5, h: 0.26, fontFace: FONT, fontSize: 9, color: "7A8599", align: "right" },
  });
  pres.defineSlideMaster({ title: "DARK", background: { color: C.navy }, objects: [...(hasLogo ? [] : [])] });

  const ICON = {};
  const need = {
    cal: [tb.TbCalendar, C.white], bag: [tb.TbBackpack, C.white], desk: [tb.TbDesk, C.white], chair: [tb.TbArmchair, C.white],
    lamp: [tb.TbLamp, C.white], lunch: [tb.TbPaperBag, C.white], clock: [tb.TbClock, C.white], part: [tb.TbLayoutBoardSplit, C.white],
    coffee: [tb.TbCoffee, C.white], search: [fa.FaSearchDollar, C.blue], users: [fa.FaUsers, C.white], target: [fa.FaBullseye, C.white],
    hand: [fa.FaHandshake, C.white], cogs: [fa.FaCogs, C.white], home: [fa.FaHome, C.white], palette: [fa.FaPalette, C.white],
    store: [fa.FaStore, C.white], warn: [fa.FaExclamationTriangle, C.orange], userF: [fa.FaUserFriends, C.white],
    clip: [fa.FaClipboardCheck, C.white], scale: [fa.FaBalanceScale, C.white], srch: [fa.FaSearch, C.white],
    chart: [fa.FaChartLine, C.white], basket: [fa.FaShoppingBasket, C.white], globe: [fa.FaGlobe, C.white],
    dbS: [fa.FaDatabase, C.staples], dbA: [fa.FaDatabase, C.amazonFill], dbW: [fa.FaDatabase, C.wayfair],
    filter: [fa.FaFilter, C.blue], layer: [fa.FaLayerGroup, C.blue], sitemap: [fa.FaSitemap, C.blue],
    tags: [fa.FaTags, C.blue], puzzle: [fa.FaPuzzlePiece, C.blue], proj: [fa.FaProjectDiagram, C.blue],
    shield: [fa.FaShieldAlt, C.blue], check: [fa.FaCheckCircle, C.blue], storeB: [fa.FaStore, C.blue],
    brief: [fa.FaBriefcase, C.white], lightB: [fa.FaLightbulb, C.white], rocket: [fa.FaRocket, C.white],
    users2: [fa.FaUserTie, C.white], dollar: [fa.FaDollarSign, C.white], layersW: [fa.FaLayerGroup, C.white],
    mag: [fa.FaMagic, C.white], boxW: [fa.FaBoxOpen, C.white],
    bottle: [tb.TbBottle, C.white], pad: [tb.TbKeyboard, C.white], pencil: [fa.FaPencilRuler, C.white],
    play: [fa.FaPlayCircle, C.blue], link: [fa.FaLink, C.blue], radar: [tb.TbRadar, C.white], qmark: [fa.FaQuestionCircle, C.white],
    flag: [fa.FaFlagCheckered, C.white], barW: [fa.FaChartBar, C.white], shieldW: [fa.FaShieldAlt, C.white],
    hash: [fa.FaHashtag, C.white], personC: [fa.FaUserTie, "BE2827"], personB: [fa.FaUserTie, C.blue], starG: [fa.FaStar, "1EA44B"], starY: [fa.FaStar, "F5B700"], globeB: [fa.FaGlobe, C.blue], poll: [fa.FaPoll, C.white], map: [fa.FaMapMarkedAlt, C.white],
  };
  for (const [k, [comp, col]] of Object.entries(need)) ICON[k] = await icon(comp, col);
  const NODE_ICON = {
    Planners: "cal", Backpacks: "bag", "Office Desks": "desk", "Accent Chairs": "chair", "Desk Lamps": "lamp",
    "Lunch Bags": "lunch", Clocks: "clock", Partitions: "part", "Coffee Organizers": "coffee",
    "Desk Organizers": "pencil", "Water Bottles": "bottle", "Desk Pads": "pad",
  };
  // all 12 analysed nodes (from V3), in Staples' segment rank order
  const ORDER = Object.keys(N).sort((a, b) => N[a].rank - N[b].rank);
  const SEGS = ["Hero · EXTEND", "Probable Hero · BUILD", "Non-Hero · EXPLORE"];
  const bySeg = (s) => ORDER.filter((k) => N[k].segment === s);
  const compColor = (c) => (c === "Amazon" ? C.amazon : C.wayfair);

  const T = F.totals;
  const SRC = F.sourcing, DF = F.design_forward;

  // Input file sizes (Excels in the project root): Staples 4,891 SKUs, Amazon 14,591, Wayfair 11,175.
  const SKUS = { staples: "4.9K", amazon: "14.6K", wayfair: "11.2K" };
  const k1 = (x) => (x / 1000).toFixed(1) + "K";
  const ARW = "A9C3EE"; // soft-blue flow arrows (match the chevron palette)
  const arrow = (sl, x, y, w = 0.2, h = 0.28) => sl.addShape("rightArrow", { x, y, w, h, fill: { color: ARW }, line: { color: ARW, width: 0 } });
  
  // ======================= 0. TITLE =======================
  pres.addSection({ title: "Opening" });
  let s = pres.addSlide({ masterName: "DARK", sectionTitle: "Opening" });
  text(s, "Staples Marketplace", 0.7, 2.3, 7.3, 0.95, { fontSize: 44, bold: true, color: C.white, valign: "middle" });
  s.addShape("rect", { x: 0.72, y: 3.36, w: 1.2, h: 0.06, fill: { color: C.orange }, line: { color: C.orange, width: 0 } });
  text(s, "Assortment Gap & Archetype Recommendation", 0.7, 3.55, 7.3, 0.6, { fontSize: 26, color: "CADCFC" });
  text(s, "LatentView Analytics  ·  October 2026", 0.7, 6.25, 7, 0.35, { fontSize: 14, color: "CADCFC" });
  // client and LatentView logos below the title in their own colours (official artwork, outputs/ppt/assets),
  // each on its own small white card so it stays legible on navy; the cards are separate
  const LOGO_ST = path.resolve(__dirname, "..", "assets", "title_logo_staples.png");
  const LOGO_LV = path.resolve(__dirname, "..", "assets", "title_logo_latentview.png");
  if (fs.existsSync(LOGO_ST) && fs.existsSync(LOGO_LV)) {
    box(s, 0.72, 4.6, 2.5, 0.72, C.white, { r: 0.08 });
    s.addImage({ path: LOGO_ST, x: 0.9, y: 4.77, w: 2.14, h: 0.38, sizing: { type: "contain", w: 2.14, h: 0.38 } });
    box(s, 3.62, 4.6, 2.5, 0.72, C.white, { r: 0.08 });
    s.addImage({ path: LOGO_LV, x: 3.8, y: 4.73, w: 2.14, h: 0.46, sizing: { type: "contain", w: 2.14, h: 0.46 } });
  }
  SEGS.forEach((seg, ci) => {
    const x = 8.35 + ci * 1.45;
    text(s, SEG[seg].short.split(" · ")[0], x, 0.5, 1.3, 0.3, { fontSize: 10, bold: true, color: "CADCFC", align: "center" });
    bySeg(seg).forEach((k, ri) => {
      const y = 0.88 + ri * 1.5;
      box(s, x, y, 1.3, 1.36, ci === 0 ? "1C3A7A" : ci === 1 ? "24498F" : "2D5AA6", { r: 0.12 });
      s.addImage({ data: ICON[NODE_ICON[k]], x: x + 0.39, y: y + 0.16, w: 0.52, h: 0.52 });
      text(s, k, x + 0.05, y + 0.78, 1.2, 0.46, { fontSize: 10.5, color: C.white, align: "center", valign: "middle" });
    });
  });
  s.addNotes(`Opening. This PoC answers one question for each of ${T.nodes_scored} Staples nodes: what does the leading competitor (Amazon or Wayfair) carry that Staples does not, and which of those items can Staples add through the marketplace without cannibalising its own assortment. External data only.`);

  // PoC-engine steps: drawn on slide 5; slide 2's next steps reuse the same labels and headings
  const CONT = [
    { v: "PRIORITISE", ic: "chart", f: `Link sales & search to the top picks in 2–3 pilot nodes`, h: "Opportunity sizing & stack-rank", q: "Which gaps are worth the most, and to whom?",
      b: ["Opportunity $ = node demand × archetype share (competitor-scaled) × conversion × AUR", "Stack-rank to the ~20% of gaps that solve 80%, by category owner", "Size the opportunity by customer segment: Staples.com (SMB, consumers) vs Staples Business"], d: "Sales · search funnel · conversion", o: "$-ranked shortlist per segment" },
    { v: "PROTECT", ic: "shieldW", f: `Tune thresholds with merchants (60 side-by-side pairs)`, h: "Core guardrails & cannibalisation", q: "Will this listing take sales from 1P?",
      b: ["Tune cannibalisation thresholds: tighter the closer to core", "Swap today's supply proxy for real 1P sales overlap", "Set price & margin floors per node"], d: "1P sales · margin · price history", o: "1P protected: curated, not an everything store" },
    { v: "EXPAND", ic: "target", f: `Pick 2–3 adjacent test categories & a broad competitor`, h: "Adjacent-category whitespace", q: "Where should Staples grow next?",
      b: ["Relax adjacency thresholds to surface whitespace & new verticals: the flip side of Protect", "Test adjacent: toys, hydration, luggage, tech accessories", "Benchmark a broad-assortment competitor to scope each"], d: "Staples catalog + broad-competitor crawls", o: "Evidence-backed adjacent categories" },
    { v: "CURATE", ic: "clip", f: `Vet top picks; start with the ${SRC.brands_on_staples_12_n} brands on Staples`, h: "Automated vetting & seller recruiting", q: "Who should supply it, and should it go live?",
      b: ["Score every seller submission with the same engine: fit, 1P overlap & price", "Approve / review / reject queue that learns from curators", `Recruit: start with the ${SRC.brands_on_staples_12_n} brands already on Staples, then top competitor sellers`], d: "Seller submissions · curator decisions", o: "Curation that scales + a recruit list" },
    { v: "MONITOR", ic: "radar", f: `Track pilots' GMV, attach & commission`, h: "Market radar & pilot tracking", q: "What changed, and what worked?",
      b: ["Quarterly re-crawls flag new & closing gaps", "Track live picks' GMV, attach & conversion vs forecast", "Scale what proves out, drop the rest; feed back into step 1"], d: "Sales · pilot results (+ competitor crawls)", o: "Live gap list & proven ROI" },
  ];
  // ======================= 1. EXECUTIVE SUMMARY =======================
  pres.addSection({ title: "Summary" });
  s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Summary" });
  s.addText("Executive Summary", { placeholder: "title" });
  // band 1a: the ask
  box(s, 0.45, 1.2, 12.43, 0.52, C.navy, { r: 0.08 });
  text(s, "THE ASK", 0.6, 1.2, 1.0, 0.52, { fontSize: 12, bold: true, color: C.orange, valign: "middle", charSpacing: 1 });
  text(s, "Which design-led, core-adjacent products can Staples add to its marketplace without cannibalising 1P sales, using only external data?", 1.62, 1.2, 11.15, 0.52, { fontSize: 12.5, color: C.white, valign: "middle" });
  // band 1b: funnel tiles
  const tiles = [
    [String(T.nodes_scored), "Staples nodes across 3 segments, vs Amazon & Wayfair"],
    [k1(T.families_all), `product families analysed: ${k1(T.staples_families)} Staples, ${k1(T.competitor_families)} competitor`],
    [String(T.archetypes_built), "archetypes (attribute combinations) compared"],
    [String(T.recommended), `safe to add; ${T.tiers.Strong} confirmed by both methods`],
  ];
  const TG = 0.2, TW = (12.43 - 3 * TG) / 4;
  tiles.forEach(([v, l], i) => {
    const x = 0.45 + i * (TW + TG);
    const safe = i === 3; // "safe to add" tile highlighted in light green
    box(s, x, 1.92, TW, 1.04, safe ? "DDF3E7" : C.paler, { r: 0.1, line: safe ? "7CCB9F" : undefined, lineW: 1 });
    text(s, v, x + 0.08, 1.98, TW - 0.16, 0.46, { fontSize: 28, bold: true, color: safe ? C.strong : C.blue, align: "center", valign: "middle" });
    text(s, l, x + 0.14, 2.46, TW - 0.28, 0.44, { fontSize: 10.5, color: C.text, align: "center", valign: "top" });
  });
  // band 3: what to add first (picks a Staples merchant recognises: anchored to what Staples already sells)
  text(s, "WHAT STAPLES SHOULD ADD FIRST", 0.45, 3.2, 6, 0.28, { fontSize: 12, bold: true, color: C.blue, valign: "middle", charSpacing: 1 });
  const P = F.picks, A = F.attach;
  const recs = [
    { k: "Office Desks", pk: P["Office Desks"][0], h: "Design-led (luxe) desks", st: "office desks",
      hook: `Staples' desks are corporate-office pieces (${S.desks_corporate.st}% vs ${S.desks_corporate.co}% at Wayfair); only ${S.desks_luxe.st}% luxe vs ${S.desks_luxe.co}%` },
    { k: "Lunch Bags", pk: P["Lunch Bags"][0], h: "Adult bento boxes for the commute", st: "lunch bags",
      hook: `Lunch range built for school (${S.lunch_kids.st}% kids vs ${S.lunch_kids.co}% at Amazon); office commuters under-served` },
    { k: "Coffee Organizers", pk: P["Coffee Organizers"][0], h: "Wooden K-Cup pod drawers", st: "coffee organisers",
      hook: `Staples sells ${A.single_serve} single-serve coffees & ${A.coffee_makers} coffee makers; its organisers are ${S.coffee_plastic.st}% plastic` },
    { k: "Accent Chairs", pk: P["Accent Chairs"][1], h: "The \"White Chair\": swivel barrel chair", st: "accent chairs",
      hook: `Accent chairs built for lobbies (${S.chairs_reception.st}% reception vs ${S.chairs_reception.co}% at Wayfair); no home-office chair` },
  ];
  const RW4 = (12.43 - 3 * 0.15) / 4;
  recs.forEach((r, i) => {
    const x = 0.45 + i * (RW4 + 0.15), y = 3.54, n = N[r.k], a = r.pk.attr_check, ex = r.pk.exemplar;
    box(s, x, y, RW4, 1.84, C.white, { r: 0.1, line: C.line, shadow: true });
    circleIcon(s, ICON[NODE_ICON[r.k]], x + 0.14, y + 0.14, 0.48, C.blue);
    text(s, r.h, x + 0.72, y + 0.1, RW4 - 0.82, 0.56, { fontSize: 12.5, bold: true, color: C.navy, valign: "middle" });
    text(s, r.hook, x + 0.16, y + 0.74, RW4 - 0.3, 0.5, { fontSize: 9.5, italic: true, color: C.text, valign: "top" });
    text(s, [
      { text: "Staples: ", options: { color: C.muted } }, { text: `${a.staples_hits} of ${a.staples_total}`, options: { bold: true, color: C.staples } }, { text: " · " },
      { text: `${n.competitor}: `, options: { color: C.muted } }, { text: `${Math.round(a.comp_share)}%`, options: { bold: true, color: compColor(n.competitor) } }, { text: " of range" },
    ], x + 0.16, y + 1.26, RW4 - 0.3, 0.24, { fontSize: 10.5, color: C.text, valign: "middle" });
    text(s, [{ text: "e.g. ", options: { color: C.muted } }, { text: shortTitle(ex.title, 30) + ` · ${money0(ex.price)} ↗`, options: { hyperlink: { url: ex.url, tooltip: ex.title }, color: C.mid, underline: { style: "sng" } } }], x + 0.16, y + 1.54, RW4 - 0.3, 0.2, { fontSize: 9.5 });
  });
  // band 4: next steps = the first move in each Project Continuation step (same labels & headings as slide 5)
  text(s, "NEXT STEPS", 0.45, 5.66, 6, 0.28, { fontSize: 12, bold: true, color: C.blue, valign: "middle", charSpacing: 1 });
  const NG = 0.15, NW = (12.43 - 4 * NG) / 5;
  CONT.forEach((c, i) => {
    const x = 0.45 + i * (NW + NG), y = 6.0;
    box(s, x, y, NW, 0.88, C.pale, { r: 0.08 });
    box(s, x, y, NW, 0.38, i < 2 ? C.blue : i === 2 ? C.mid : C.navy, { r: 0.08 });
    s.addImage({ data: ICON[c.ic], x: x + 0.12, y: y + 0.08, w: 0.22, h: 0.22 });
    text(s, `${i + 1} · ${c.v}`, x + 0.44, y, NW - 0.52, 0.38, { fontSize: 10.5, bold: true, color: C.orange, valign: "middle", charSpacing: 1 });
    text(s, c.h, x + 0.12, y + 0.42, NW - 0.2, 0.42, { fontSize: 10.5, bold: true, color: C.navy, valign: "middle" });
  });
  s.addNotes(`The ask: a curated, core-adjacent ("White Chair") marketplace for Q1 2027 that does not cannibalise 1P sales, built on external data only.\nFunnel: ${T.families_all.toLocaleString("en-US")} product families (${T.staples_families.toLocaleString("en-US")} Staples, ${T.amazon_families.toLocaleString("en-US")} Amazon, ${T.wayfair_families.toLocaleString("en-US")} Wayfair; colour/size variants merged) → ${T.archetypes_built} archetypes compared → ${T.recommended} pass the safety gates (${T.tiers.Strong} Strong, ${T.tiers["Vector-led"]} Vector-led, ${T.tiers["Gap-led"]} Gap-led, ${T.tiers.Conditional || 0} Conditional) → ${T.example_products} example products, each shown beside the nearest Staples item → ${SRC.brands_on_staples_12_n} brands already selling on Staples (${SRC.brands_on_staples_12.join(", ")}).\nHow: Method 1 compares products in an embedding space (whitespace, fit with Staples, look, cannibalisation risk, price position); Method 2 compares attribute shares (share gap, price, colour, material/style, design). Each has its own cannibalisation gate; the final list is their union.\nThe four headline picks are anchored to what Staples already sells, so a merchant recognises them; each was checked against the Staples catalog: design-led (luxe) desks ${P["Office Desks"][0].attr_check.staples_hits} of ${P["Office Desks"][0].attr_check.staples_total} office desks vs ${Math.round(P["Office Desks"][0].attr_check.comp_share)}% of Wayfair's (Strong: both methods; the Hero-node pick; Staples' desks are corporate pieces at a median ${money0(N["Office Desks"].price_median_staples)} vs ${money0(N["Office Desks"].price_median_competitor)} at Wayfair, so these add the home-office look at a lower price); wooden K-Cup pod drawers ${P["Coffee Organizers"][0].attr_check.staples_hits} of ${P["Coffee Organizers"][0].attr_check.staples_total} coffee organisers (Strong: both methods; Staples sells ${A.single_serve} single-serve coffee items and ${A.coffee_makers} coffee makers); adult stainless bento ${P["Lunch Bags"][0].attr_check.staples_hits} of ${P["Lunch Bags"][0].attr_check.staples_total} lunch bags (Strong); barrel chairs ${P["Accent Chairs"][1].attr_check.staples_hits} of ${P["Accent Chairs"][1].attr_check.staples_total} accent chairs (the literal "White Chair"; Gap-led: a clear gap, but Method 1 reads most barrel chairs as off-brand for today's Staples customer, so check the fit).\nBackup picks if asked: statement / oversized wall clocks (${P.Clocks[0].attr_check.staples_hits} of ${P.Clocks[0].attr_check.staples_total} clocks vs ${Math.round(P.Clocks[0].attr_check.comp_share)}% of Wayfair's; Strong; Staples' clocks ${S.clocks_plastic.st}% plastic vs ${S.clocks_plastic.co}%, a design trade-up), folding screens under $150 (${P.Partitions[0].attr_check.staples_hits} of ${P.Partitions[0].attr_check.staples_total} partitions vs ${Math.round(P.Partitions[0].attr_check.comp_share)}% of Wayfair's; Strong), guided / daily journals (${P.Planners[1].attr_check.staples_hits} of ${P.Planners[1].attr_check.staples_total} planners vs ${Math.round(P.Planners[1].attr_check.comp_share)}% of Amazon's; Gap-led, read as off-brand by Method 1), hiking / outdoor daypacks (${P.Backpacks[0].attr_check.staples_hits} of ${P.Backpacks[0].attr_check.staples_total} vs ${Math.round(P.Backpacks[0].attr_check.comp_share)}% of Amazon's).\nIf asked about the assortments: Staples builds for the workplace (${S.chairs_reception.st}% of accent chairs are reception/lobby seats vs ${S.chairs_reception.co}% at Wayfair; ${S.partitions_tackable.st}% of partitions tackable vs ${S.partitions_tackable.co}%); Wayfair for the home (${S.chairs_residential.co}% of accent chairs for living rooms vs ${S.chairs_residential.st}%); Amazon for the person and the activity (${S.bp_hiking.co}% of backpacks hiking/outdoor vs ${S.bp_hiking.st}%). Design-forward share ${DF.staples_all}% at Staples vs ${DF.competitor_all}% at the competitors (text-based, provisional). Price: Staples desks median ${money0(N["Office Desks"].price_median_staples)} vs ${money0(N["Office Desks"].price_median_competitor)} at Wayfair; ${B.planners_u10.co}% of Amazon planners under $10 vs ${B.planners_u10.st}%.\nMore picks: ${T.recommended - 4} further archetypes, each with example products, are in the demo.\nNext steps: the five steps of slide 5 (same labels and headings). First moves if asked: ${CONT.map((c, i) => `${i + 1} ${c.v[0] + c.v.slice(1).toLowerCase()}: ${c.f}`).join("; ")}.`);

  // ======================= 2. CURRENT SCOPE =======================
  s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Summary" });
  s.addText(`PoC Scope at a Glance: ${ORDER.length} Nodes · 3 Segments · 2 Competitors`, { placeholder: "title" });
  const hdr = (t, al = "left") => ({ text: t, options: { bold: true, color: C.white, fill: { color: C.blue }, fontSize: 12.5, valign: "middle", align: al } });
  const rows = [[hdr("Segment · Play", "center"), hdr("Staples node"), hdr("Category path"), hdr("Primary competitor", "center"), hdr("Archetypes recommended", "center")]];
  SEGS.forEach((seg) => {
    const ks = bySeg(seg);
    ks.forEach((k, i) => {
      const n = N[k], parts = n.node_id.split(" > "), f = i % 2 ? C.paler : C.white;
      const r = [];
      if (i === 0) r.push({ text: seg.replace(" · ", "\n"), options: { rowspan: ks.length, fill: { color: SEG[seg].fill }, color: SEG[seg].ink, bold: true, fontSize: 13, align: "center", valign: "middle" } });
      r.push({ text: n.leaf, options: { bold: true, fontSize: 12, color: C.navy, valign: "middle", fill: { color: f } } });
      r.push({ text: parts.slice(0, -1).join(" > "), options: { fontSize: 10.5, color: C.muted, valign: "middle", fill: { color: f } } });
      r.push({ text: n.competitor, options: { bold: true, fontSize: 12, color: compColor(n.competitor), align: "center", valign: "middle", fill: { color: f } } });
      r.push({ text: String(n.recommended), options: { bold: true, fontSize: 12, color: C.navy, align: "center", valign: "middle", fill: { color: f } } });
      rows.push(r);
    });
  });
  s.addTable(rows, { x: 0.45, y: 1.25, w: 12.43, colW: [1.9, 3.3, 4.0, 1.55, 1.68], rowH: [0.42, ...Array(ORDER.length).fill(0.39)], fontFace: FONT, border: { type: "solid", pt: 0.75, color: C.line }, margin: [0.03, 0.1, 0.03, 0.1] });
  box(s, 0.45, 6.5, 12.43, 0.42, C.warnFill, { r: 0.08, line: C.orange, lineW: 1 });
  s.addImage({ data: ICON.warn, x: 0.62, y: 6.59, w: 0.24, h: 0.24 });
  text(s, [
    { text: "Data disclaimer:  ", options: { bold: true, color: "8A5A00" } },
    { text: "competitor data are scraped listing samples, not full catalogs; Staples data are close to complete." },
  ], 1.0, 6.5, 11.7, 0.42, { fontSize: 11, color: C.text, valign: "middle" });
  s.addNotes(`Segments (as per our research): Hero = Staples' top-performing categories, so we EXTEND them with design-led variants; Probable Hero = a good market where Staples can improve its position, so we BUILD depth; Non-Hero = a smaller Staples presence today, so we EXPLORE via marketplace sellers with near-zero 1P risk.\nCompetitors (as per our research): each node is compared with its Primary competitor only: Wayfair, the leading online home-furnishing store, for furniture and décor (5 nodes); Amazon, the default everyday marketplace, for supplies, bags and kitchen (7 nodes).\nArchetypes recommended: the final gate keeps 3 to 10 per node; Desk Organizers, Water Bottles and Desk Pads have the smallest competitor samples (185, 194 and 61 product families), hence fewer picks.\nDisclaimer detail: Amazon ${SKUS.amazon} and Wayfair ${SKUS.wayfair} SKUs vs ${SKUS.staples} Staples SKUs. Because the competitor files are samples, every comparison is a share of each retailer's range with a credibility check, never a raw count. No internal sales, traffic or margin data were used.`);

  // ======================= 3. DEMO =======================
  pres.addSection({ title: "Demo" });
  s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Demo" });
  s.addText("Demo", { placeholder: "title" });
  s.addImage({ data: ICON.play, x: 6.17, y: 2.0, w: 1.0, h: 1.0 });
  text(s, "Live Demo", 0.45, 3.15, 12.43, 0.8, { fontSize: 40, bold: true, color: C.navy, align: "center", valign: "middle" });
  box(s, 3.67, 4.25, 6.0, 0.7, C.paler, { r: 0.1, line: C.sky, dash: "dash" });
  s.addImage({ data: ICON.link, x: 3.95, y: 4.44, w: 0.32, h: 0.32 });
  text(s, "Link: [to be added]", 4.45, 4.25, 5.0, 0.7, { fontSize: 18, color: C.mid, valign: "middle" });
  s.addNotes("Placeholder: add the demo link here before the session.");

  // ======================= 4. THE POC ENGINE ON STAPLES DATA =======================
  pres.addSection({ title: "Next steps" });
  s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Next steps" });
  s.addText("The PoC Engine on Staples Data", { placeholder: "title" });
  box(s, 0.45, 1.18, 12.43, 0.38, C.paler, { r: 0.08 });
  text(s, runs("The same Assortment Gap & Recommendation analysis, powered by **real demand**, **Staples' own data** and **merchant-set guardrails**.", { fontSize: 11.5, color: C.text }, C.navy), 0.6, 1.18, 12.13, 0.38, { align: "center", valign: "middle" });
  const CG = 0.26, CW5 = (12.43 - 4 * CG) / 5, HY5 = 1.9, BY5 = 2.74, BH5 = 3.72;
  CONT.forEach((c, i) => {
    const x = 0.45 + i * (CW5 + CG);
    box(s, x, HY5, CW5, 0.78, i < 2 ? C.blue : i === 2 ? C.mid : C.navy, { r: 0.08 });
    s.addImage({ data: ICON[c.ic], x: x + 0.12, y: HY5 + 0.2, w: 0.38, h: 0.38 });
    text(s, `${i + 1} · ${c.v}`, x + 0.6, HY5 + 0.06, CW5 - 0.68, 0.24, { fontSize: 10.5, bold: true, color: C.orange, charSpacing: 1 });
    text(s, c.h, x + 0.6, HY5 + 0.3, CW5 - 0.68, 0.44, { fontSize: 11, bold: true, color: C.white, valign: "middle" });
    box(s, x, BY5, CW5, BH5, C.white, { r: 0.08, line: C.line });
    text(s, c.q, x + 0.12, BY5 + 0.08, CW5 - 0.24, 0.42, { fontSize: 10, italic: true, bold: true, color: C.mid, valign: "middle" });
    text(s, c.b.map((t, k) => ({ text: t, options: { bullet: { indent: 9 }, breakLine: k < c.b.length - 1 } })), x + 0.1, BY5 + 0.56, CW5 - 0.18, 1.6, { fontSize: 9.5, color: C.text, paraSpaceAfter: 3 });
    box(s, x + 0.08, BY5 + 2.2, CW5 - 0.16, 0.62, C.paler, { r: 0.06 });
    text(s, "STAPLES DATA", x + 0.16, BY5 + 2.25, CW5 - 0.3, 0.18, { fontSize: 7.5, bold: true, color: C.orange, charSpacing: 1 });
    text(s, c.d, x + 0.16, BY5 + 2.42, CW5 - 0.3, 0.38, { fontSize: 9.5, bold: true, color: C.mid });
    box(s, x + 0.08, BY5 + 2.9, CW5 - 0.16, 0.74, C.pale, { r: 0.06 });
    text(s, "OUTCOME", x + 0.16, BY5 + 2.95, CW5 - 0.3, 0.18, { fontSize: 7.5, bold: true, color: C.orange, charSpacing: 1 });
    text(s, c.o, x + 0.16, BY5 + 3.12, CW5 - 0.3, 0.48, { fontSize: 10.5, bold: true, color: C.navy });
  });
  s.addNotes(`The PoC engine on Staples data: the same analysis, now on Staples' internal data, shaped by the first review. If asked about order: acquire the product first (build the basket for existing customers), adjacent categories before core.\n1 Prioritise (opportunity sizing): opportunity $ per archetype = Staples demand for the node (sessions or units) × the archetype's share (the only competitor input: e.g. ${Math.round(F.picks.Backpacks[0].attr_check.comp_share)}% of Amazon's backpacks are hiking/outdoor vs ${F.picks.Backpacks[0].attr_check.staples_hits} of ${F.picks.Backpacks[0].attr_check.staples_total} at Staples, scaled to Staples' velocity) × expected conversion × AUR (modelled at Staples' price point; the PoC's competitor median, e.g. ${money0(F.picks.Backpacks[0].median_price_competitor)} for hiking daypacks, is the starting value). Net of cannibalisation and times commission, it gives Staples' own revenue. Stack-rank to the ~20% of gaps that solve 80%, cut per category owner (e.g. furniture, consumer electronics) so each merchant sees their own list, and size it by customer segment: Staples.com (SMB and consumers) first, Staples Business later (e.g. a dialysis chair matters to Staples Business, not to Staples.com). Null searches alone mislead because redirects hide demand: trace search → product page → conversion.\n2 Protect: tune the cannibalisation (safety-gate) thresholds with merchants (cannibalisation risk bands, price-position limits, fit-with-Staples cut-offs, picks per node): tighter the closer a category is to core (e.g. desks: no top-line erosion just for unit velocity). Today's checks use supply only (they already hold back ${T.m1_sub_undercut_share}% of competitor products as substitutes or undercuts); real 1P sales overlap replaces that proxy, plus price and margin floors per node.\n3 Expand (adjacent-category whitespace): the flip side of Protect. Relaxing the adjacency thresholds (AAS, Adjacency Affinity Score: fit with Staples) turns today's OFF-BRAND products into whitespace and new verticals instead of exclusions. Test the adjacent categories raised in the review (toys, e.g. waiting-room rewards; hydration; travel and luggage; tech accessories), benchmarking a competitor with a broad assortment to scope each. The PoC already set aside ${T.backlog_families.toLocaleString("en-US")} competitor families outside the 12 nodes; a new category or competitor is one config entry, no code change.\n4 Curate: the same engine scores every seller submission for fit, 1P overlap and price, feeding an approve / review / reject queue that learns from curator decisions. Recruiting: start with the ${SRC.brands_on_staples_12_n} brands behind our picks already on Staples (${SRC.brands_on_staples_12.join(", ")}), then top competitor sellers Staples does not carry; Wayfair's range is mostly house brands, so source the archetype, not the brand.\n5 Monitor: quarterly re-crawls flag new and closing gaps. Nothing is live on the Marketplace yet, so track live picks' GMV, attach and conversion against the forecast, scale what proves out, and feed results back into step 1.`);

  // ======================= 5. GROWTH PATHS =======================
  s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Next steps" });
  s.addText("Growth Paths for the Marketplace", { placeholder: "title" });
  box(s, 0.45, 1.18, 12.43, 0.38, C.paler, { r: 0.08 });
  text(s, runs("Beyond assortment gaps: **six more ways to grow**, combining external signals with Staples data.", { fontSize: 11.5, color: C.text }, C.navy), 0.6, 1.18, 12.13, 0.38, { align: "center", valign: "middle" });
  const ALT = [
    { t: "SENSE demand early", fill: C.blue, cards: [
      { ic: "srch", h: "Search & funnel gaps", q: "Where do shoppers search, and drop off?",
        b: ["Map on-site searches & SEO keywords to archetypes", "Search → PDP → need met → conversion (redirects hide demand)", "Feed seller recruiting & product pages"], d: "Search logs · funnel · satisfaction", o: "Existing traffic, converted" },
      { ic: "hash", h: "Social, trends & retail media", q: "Which styles are taking off, and for whom?",
        b: ["Track archetype mentions & saves (TikTok, Pinterest, Reddit, Google Trends)", "Signals show which subcategories to grow after entry", "Aim off-site retail media at new customers"], d: "Social & trend data + Staples sales", o: "Grow on signals; reach new customers" },
    ] },
    { t: "SIZE & VALIDATE", fill: C.mid, cards: [
      { ic: "barW", h: "Demand forecasting", q: "How much will each archetype sell?",
        b: ["Forecast demand per node & archetype", "Add seasonality (Back-to-School) & trend signals", "Size GMV & commission before listing"], d: "Sales history + trend signals", o: "Supply in place before the season" },
      { ic: "poll", h: "Market research & customer surveys", q: "What do Staples customers actually want?",
        b: ["Survey B2B & B2C customers on needs, style & price", "Concept-test the top archetypes with images", "Feed results into the prioritisation weights"], d: "Customer panel · email base", o: "Picks validated by Staples' own customers" },
    ] },
    { t: "ACT on basket & sellers", fill: C.navy, cards: [
      { ic: "basket", h: "Basket building for existing customers", q: "Which item would complete the basket?",
        b: ["Market-basket analysis on transactions", "Top customers' verticals → missing complements", "Recruit sellers for 1–2 attach items per order"], d: "Transactions · customer verticals", o: "Bigger baskets, new commission" },
      { ic: "hand", h: "Best-seller & seller intelligence", q: "Who wins where Staples is absent?",
        b: ["Top-selling brands & sellers in categories Staples doesn't carry", "Layer unit conversion & seller performance", "Category-specific targets & key players to recruit"], d: "Competitor sales signals · seller performance", o: "Sharper $ estimates & a recruit shortlist" },
    ] },
  ];
  const AG3 = 0.26, AW = (12.43 - 2 * AG3) / 3;
  ALT.forEach((col, i) => {
    const x = 0.45 + i * (AW + AG3);
    box(s, x, 1.7, AW, 0.42, col.fill, { r: 0.08 });
    text(s, `${i + 1} · ${col.t}`, x, 1.7, AW, 0.42, { fontSize: 13, bold: true, color: C.white, align: "center", valign: "middle", charSpacing: 1 });
    if (i < ALT.length - 1) arrow(s, x + AW + 0.04, 1.77, 0.18, 0.28);
    col.cards.forEach((c, j) => {
      const y = 2.24 + j * 2.36, h = 2.26;
      box(s, x, y, AW, h, C.white, { r: 0.1, line: C.line, shadow: true });
      circleIcon(s, ICON[c.ic], x + 0.14, y + 0.14, 0.48, col.fill);
      text(s, c.h, x + 0.74, y + 0.1, AW - 0.86, 0.3, { fontSize: 12.5, bold: true, color: C.navy, valign: "middle" });
      text(s, c.q, x + 0.74, y + 0.4, AW - 0.86, 0.24, { fontSize: 10, italic: true, color: C.mid, valign: "middle" });
      text(s, c.b.map((t, k) => ({ text: t, options: { bullet: { type: "number" }, breakLine: k < c.b.length - 1 } })), x + 0.2, y + 0.74, AW - 0.32, 0.82, { fontSize: 10, color: C.text, paraSpaceAfter: 2 });
      const sy = y + 1.62, sw = (AW - 0.3) / 2;
      box(s, x + 0.1, sy, AW - 0.2, 0.54, C.paler, { r: 0.06 });
      text(s, "DATA", x + 0.2, sy + 0.04, sw - 0.1, 0.16, { fontSize: 7.5, bold: true, color: C.orange, charSpacing: 1 });
      text(s, c.d, x + 0.2, sy + 0.2, sw - 0.1, 0.32, { fontSize: 9, bold: true, color: C.mid });
      text(s, "OUTCOME", x + 0.2 + sw, sy + 0.04, sw - 0.05, 0.16, { fontSize: 7.5, bold: true, color: C.orange, charSpacing: 1 });
      text(s, c.o, x + 0.2 + sw, sy + 0.2, sw - 0.05, 0.32, { fontSize: 9, bold: true, color: C.navy });
    });
  });
  s.addNotes(`Growth paths, read left to right: sense demand early, size and validate it, then act on the basket and with sellers. In each column the top card matters most. Each combines external signals with Staples data; adjacent-category whitespace now sits in step 3 of slide 5.\n- Search & funnel gaps: on-site searches and external SEO keywords where competitors rank and Staples does not, mapped to archetypes. Null searches alone are not enough (redirects hide unmet demand), so trace search → product page → need met (satisfaction) → conversion; feeds seller recruiting and product pages.\n- Social, trends & retail media: mentions, hashtags and saves per archetype plus Google Trends, scored for growth and sentiment. Signal-based expansion: after Staples enters an adjacent category, these signals (with search and early sales) show which subcategories to develop, so the first load is confident rather than every item. The same audiences guide off-site retail media for new customers: the second workstream (educate and acquire the customer), on a longer horizon once the product is live.\n- Demand forecasting: per node and archetype from sales history, with Back-to-School seasonality and trend signals; sizes GMV and commission before listing and feeds the opportunity $ on slide 5.\n- Market research & customer surveys: B2B and B2C customers on unmet needs, style and price; concept tests of the top archetypes; results set the prioritisation weights.\n- Basket building for existing customers: market-basket analysis plus the business verticals of top customers show which complements are missing; target 1–2 attach items per order. Staples.com customers first; Staples Business is a separate, later channel.\n- Competitor best-sellers & seller intelligence: identify the top-selling brands and sellers in competitor categories Staples does not carry, then layer unit conversion and seller performance. This moves from broad visibility to category-specific targets and key players to recruit, and sharpens the opportunity estimates. Note: the PoC deliberately excluded competitor ratings, rank and bought-in-past-month signals; using them is a phase-2 decision for Staples.`);

  // ======================= 5b. CURATED GROWTH PLAN (phases) =======================
  s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Next steps" });
  s.addText("A Curated Growth Plan for the Staples Marketplace", { placeholder: "title" });
  {
    box(s, 0.45, 1.18, 12.43, 0.38, C.paler, { r: 0.08 });
    text(s, runs("Everything on slides 5–6, sequenced: **size the prize first**, **adjacent first**, **scale on evidence**.", { fontSize: 11.5, color: C.text }, C.navy), 0.6, 1.18, 12.13, 0.38, { align: "center", valign: "middle" });
    const PH = [
      { n: "SIZE & LAUNCH", ic: "dollar", fill: C.blue, aim: "Size the prize, load with confidence",
        chips: ["Adjacent first", "Existing customers", "Staples.com"],
        b: [["Opportunity $ by customer segment; top ~20%", "5 · Prioritise"], ["Join Staples sales, search & basket data", "new data"], ["Tune & relax thresholds with merchants", "5 · Protect, Expand"], ["Rank toys, hydration, luggage, tech", "5 · Expand"], [`Recruit from ${SRC.brands_on_staples_12_n} brands on Staples; attach items`, "5 · Curate, 6"]],
        o: "A $-ranked launch shortlist, one story per category owner" },
      { n: "LEARN & SCALE", ic: "chart", fill: C.mid, aim: "Learn from launch, scale what works",
        chips: ["Adjacent + near-core", "Existing customers", "Staples.com"],
        b: [["Track pilots vs forecast; quarterly re-crawls", "5 · Monitor"], ["Signals pick the subcategories to grow", "6"], ["Search & funnel gaps, demand forecasting", "6"], ["Best-seller & seller intelligence", "6"]],
        o: "Scale on evidence; sharper $ estimates" },
      { n: "EXTEND", ic: "target", fill: C.navy, aim: "Into core and new customers",
        chips: ["Core gaps", "New customers", "+ Staples Business"],
        b: [["Core gaps raised with merchants, e.g. smaller or luxe desks, bento", "with merchants"], ["Educate & acquire customers: social, trends, off-site retail media", "6"], ["Staples Business: specialist verticals & contract needs", "new channel"], ["Validate with market research & surveys", "6"]],
        o: "Core growth merchants sign up to; new customers reached" },
    ];
    const PG = 0.26, PW = (12.43 - 2 * PG) / 3, HY = 1.7;
    PH.forEach((p, i) => {
      const x = 0.45 + i * (PW + PG);
      box(s, x, HY, PW, 0.72, p.fill, { r: 0.08 });
      s.addImage({ data: ICON[p.ic], x: x + 0.16, y: HY + 0.17, w: 0.38, h: 0.38 });
      text(s, `PHASE ${i + 1} · ${p.n}`, x + 0.7, HY + 0.07, PW - 0.85, 0.28, { fontSize: 11, bold: true, color: C.orange, charSpacing: 1, valign: "middle" });
      text(s, p.aim, x + 0.7, HY + 0.35, PW - 0.85, 0.3, { fontSize: 12.5, bold: true, color: C.white, valign: "middle" });
      if (i < PH.length - 1) arrow(s, x + PW + 0.04, HY + 0.22, 0.18, 0.28);
      const by = HY + 0.82, bh = 3.42;
      box(s, x, by, PW, bh, C.white, { r: 0.08, line: C.line, shadow: true });
      const cw = (PW - 0.32) / 3;
      p.chips.forEach((c, j) => chip(s, c, x + 0.12 + j * (cw + 0.04), by + 0.12, cw, 0.28, C.pale, C.navy, 8.5));
      text(s, p.b.map(([t, tag], k) => [
        { text: t, options: { bullet: { indent: 10 }, color: C.text } },
        { text: "  " + tag.replace(/ /g, " "), options: { fontSize: 9, italic: true, color: "8A94A6", breakLine: k < p.b.length - 1 } },
      ]).flat(), x + 0.12, by + 0.54, PW - 0.24, 2.0, { fontSize: 12, paraSpaceAfter: 6, valign: "top" });
      box(s, x + 0.1, by + 2.62, PW - 0.2, 0.7, C.pale, { r: 0.06 });
      text(s, "OUTCOME", x + 0.2, by + 2.67, PW - 0.4, 0.18, { fontSize: 7.5, bold: true, color: C.orange, charSpacing: 1 });
      text(s, p.o, x + 0.2, by + 2.85, PW - 0.4, 0.42, { fontSize: 11, bold: true, color: C.navy, valign: "middle" });
    });
    const BY = 6.08;
    box(s, 0.45, BY, 12.43, 0.84, C.paler, { r: 0.08, line: C.sky });
    text(s, "BEYOND INTERNAL REPORTING", 0.62, BY, 2.0, 0.84, { fontSize: 10.5, bold: true, color: C.blue, valign: "middle", charSpacing: 1 });
    const BEY = [
      ["globeB", "Sees outside Staples", "the competitor side internal data can't show"],
      ["layer", "Same yardstick on both sides", `${T.archetypes_built} archetypes, one attribute extractor`],
      ["shield", "Two independent safety gates", "cannibalisation checked twice"],
    ];
    const BW = (12.43 - 2.3) / 3;
    BEY.forEach(([ic, h, d], i) => {
      const x = 2.75 + i * BW;
      s.addImage({ data: ICON[ic], x, y: BY + 0.23, w: 0.38, h: 0.38 });
      text(s, [{ text: h, options: { bold: true, color: C.navy, breakLine: true } }, { text: d, options: { color: C.text } }], x + 0.5, BY + 0.06, BW - 0.6, 0.72, { fontSize: 10.5, valign: "middle" });
    });
  }
  s.addNotes(`A curated growth plan for the Staples Marketplace: everything on slides 5 and 6, put in the order agreed in our first review. Size the prize first; product before customer (two workstreams); existing customers before new ones (build the basket); adjacent categories before core (so existing merchants are brought along, not challenged); Staples.com before Staples Business; a confident first load, then scale on evidence (launch and learn).\nPhase 1 Size & launch (in priority order): size the opportunity $ on the PoC's ${T.recommended} safe picks by customer segment (Staples.com: SMB and consumers first) and keep the top ~20%; this needs Staples' sales, search-funnel, conversion and basket data joined in; agree the guardrails with merchants (tune the cannibalisation thresholds, relax the adjacency thresholds); rank the adjacent tests raised (toys, hydration, travel and luggage, tech accessories); vet listings and recruit, starting with the ${SRC.brands_on_staples_12_n} brands already on Staples, plus basket attach items for existing customers. Output: a $-ranked launch shortlist and one story per category owner.
Phase 2 Learn & scale: once items are live, track pilots against the forecast and re-crawl quarterly; signals choose which subcategories to grow after entry; search-funnel gaps and demand forecasting; competitor best-seller and seller intelligence sharpens the $ estimates and the recruit list.
Phase 3 Extend: raise core-category gaps with the merchants who own them (e.g. smaller or luxe desks, bento); the customer workstream (education, social, trends, off-site retail media) for new customers; Staples Business as a separate channel for specialist verticals and contract needs; validate with research and surveys.
How we would support it (phased): first organise the data and build the stories for the initial launch, then extend into Staples' data, more analyses and stakeholder use cases, using Staples' existing data and tools and adding external data where useful; the plan adapts to Staples' roadmap rather than a fixed path.\nBeyond internal reporting (if asked how this differs from running internal tools): internal data can't show what Staples doesn't carry; we measure both sides with one attribute instrument (${T.archetypes_built} archetypes); cannibalisation is screened by two independent methods.`);

  // ======================= 5c. ENGAGEMENT MODEL (governance flowchart) =======================
  s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Next steps" });
  s.addText("Our Governance Model Ensures Effective Oversight and Collaboration", { placeholder: "title" });
  {
    const CY = "BE2827", DR = "A31515", DL = "5B8DB8", SOFT = "7F9CC0";
    const ln = (x, y, w, h, o = {}) => s.addShape("line", { x, y, w, h, line: { color: o.c || DL, width: o.wd || 1, dashType: o.dash, beginArrowType: o.b, endArrowType: o.e } });
    const dotBox = (x, y, w, h, col = SOFT, fill) => s.addShape("rect", { x, y, w, h, fill: fill ? { color: fill } : { type: "none" }, line: { color: col, width: 1, dashType: "sysDot" } });
    const pill = (t, x, y, w, h, fill, sz = 9.5) => { box(s, x, y, w, h, fill, { r: 0.08 }); text(s, t, x + 0.04, y, w - 0.08, h, { fontSize: sz, color: C.white, align: "center", valign: "middle" }); };

    // banners
    box(s, 0.3, 1.15, 9.15, 0.38, C.navy, { rect: true });
    text(s, "3-Tiered Robust Governance Structure with Cadence for Seamless Communication and Feedback Alignment", 0.35, 1.15, 9.05, 0.38, { fontSize: 11.5, bold: true, color: C.white, align: "center", valign: "middle" });
    box(s, 9.68, 1.15, 3.2, 0.38, "7E62A8", { rect: true });
    text(s, "LatentView Value Adds & Investments", 9.68, 1.15, 3.2, 0.38, { fontSize: 11, bold: true, color: C.white, align: "center", valign: "middle" });

    // tier labels: name, cadence, forums (from the communication blueprint), centred on their tier's box
    const TL = [
      { y: 1.62, h: 1.1, n: "Executive Team", c: "Quarterly", f: ["Quarterly business review", "Monthly executive briefing"] },
      { y: 3.0, h: 1.32, n: "Project Team", c: "Monthly / Quarterly", f: ["Monthly business review", "Weekly status newsletter"] },
      { y: 4.74, h: 1.84, n: "Delivery Team", c: "Daily / Weekly", f: ["Daily stand-ups", "Weekly reviews", "Sprint planning"] },
    ];
    TL.forEach((t) => {
      text(s, [
        { text: t.n, options: { fontSize: 12.5, bold: true, color: C.blue, breakLine: true } },
        { text: t.c, options: { fontSize: 10.5, bold: true, italic: true, color: DR, breakLine: true } },
        { text: t.f.join(" · "), options: { fontSize: 8.5, italic: true, color: "7A8599" } },
      ], 0.3, t.y, 1.85, t.h, { align: "center", valign: "middle", paraSpaceAfter: 3 });
    });
    ln(0.3, 2.82, 9.05, 0, { dash: "dash", c: C.blue, wd: 1 });
    ln(0.3, 4.6, 9.05, 0, { dash: "dash", c: C.blue, wd: 1 });

    // executive tier (logos same size)
    const LW = 1.3, LH = 0.27;
    if (fs.existsSync(LOGO_ST)) s.addImage({ path: LOGO_ST, x: 2.2, y: 2.03, w: LW, h: LH, sizing: { type: "contain", w: LW, h: LH } });
    dotBox(3.65, 1.74, 3.3, 0.86);
    pill("Staples\nLeadership", 3.88, 1.91, 1.3, 0.52, CY);
    pill("LatentView\nLeadership", 5.42, 1.91, 1.3, 0.52, C.blue);
    if (fs.existsSync(LOGO_LV)) s.addImage({ path: LOGO_LV, x: 7.15, y: 2.02, w: LW, h: 0.3, sizing: { type: "contain", w: LW, h: 0.3 } });
    ln(5.3, 2.62, 0, 0.36, { c: "000000", wd: 1.25, b: "triangle" });

    // project tier
    dotBox(3.65, 3.0, 3.3, 1.32);
    pill("Staples Team\nLeads", 3.82, 3.12, 1.38, 0.46, CY);
    pill("Staples\nStakeholders", 3.82, 3.72, 1.38, 0.46, CY);
    pill("LatentView Client\nPartners", 5.42, 3.12, 1.38, 0.46, C.blue);
    pill("LatentView Account\nManagers", 5.42, 3.72, 1.38, 0.46, C.blue);
    ln(6.8, 3.35, 0.24, 0, { c: "44546A", wd: 1 });
    ln(6.8, 3.95, 0.24, 0, { c: "44546A", wd: 1 });
    ln(7.04, 3.35, 0, 0.6, { c: "44546A", wd: 1 });
    ln(7.04, 3.65, 0.22, 0, { c: "44546A", wd: 1, e: "triangle" });
    box(s, 7.28, 3.3, 1.6, 0.7, "E6E6E6", { r: 0.12 });
    text(s, "Collectively own program management", 7.34, 3.3, 1.48, 0.7, { fontSize: 9.5, color: C.text, align: "center", valign: "middle" });
    ln(5.3, 4.34, 0, 0.38, { c: "000000", wd: 1.25, b: "triangle" });

    // delivery tier
    dotBox(2.4, 4.74, 6.5, 1.84);
    s.addShape("rect", { x: 2.53, y: 4.84, w: 6.24, h: 1.64, fill: { color: C.white }, line: { color: "C0504D", width: 1 } });
    text(s, "Data Engineering / Business Intelligence / Data Science Team", 2.53, 4.88, 6.24, 0.26, { fontSize: 10.5, bold: true, color: C.navy, align: "center", valign: "middle" });
    s.addImage({ data: ICON.personC, x: 4.6, y: 5.18, w: 0.3, h: 0.3 });
    text(s, "Staples Team Lead", 4.2, 5.49, 1.1, 0.18, { fontSize: 7.5, bold: true, color: C.navy, align: "center" });
    s.addShape("leftRightArrow", { x: 5.0, y: 5.27, w: 0.7, h: 0.13, fill: { color: "A6A6A6" }, line: { color: "A6A6A6", width: 0 } });
    s.addImage({ data: ICON.personB, x: 5.8, y: 5.18, w: 0.3, h: 0.3 });
    text(s, "LV Program Manager", 5.4, 5.49, 1.1, 0.18, { fontSize: 7.5, bold: true, color: C.navy, align: "center" });
    s.addShape("upDownArrow", { x: 5.87, y: 5.7, w: 0.12, h: 0.26, fill: { color: "A6A6A6" }, line: { color: "A6A6A6", width: 0 } });
    box(s, 2.7, 6.0, 5.9, 0.38, "F0F0F0", { rect: true });
    [["Big Data Engineer", "Data Architect"], ["BI Developer", "BI Analyst"], ["Data Scientist", "Data Analyst"]].forEach(([a, b], i) =>
      text(s, `${a}\n${b}`, 2.8 + i * 1.95, 6.0, 1.8, 0.38, { fontSize: 8.5, color: C.text, align: "center", valign: "middle" }));

    // legend
    s.addImage({ data: ICON.personC, x: 0.3, y: 6.8, w: 0.2, h: 0.2 });
    text(s, "Staples", 0.54, 6.8, 0.8, 0.2, { fontSize: 9.5, color: C.text, valign: "middle" });
    s.addImage({ data: ICON.personB, x: 1.35, y: 6.8, w: 0.2, h: 0.2 });
    text(s, "LatentView", 1.59, 6.8, 1.0, 0.2, { fontSize: 9.5, color: C.text, valign: "middle" });

    // value adds panel (compact)
    ln(9.56, 1.65, 0, 4.95, { dash: "dash", c: SOFT, wd: 0.75 });
    box(s, 9.68, 1.65, 3.2, 4.4, "F3F3F3", { rect: true });
    s.addImage({ data: ICON.starG, x: 9.74, y: 1.72, w: 0.2, h: 0.2 });
    dotBox(9.98, 1.78, 2.75, 0.36);
    text(s, "Access To Scalable analytics team", 9.98, 1.78, 2.75, 0.36, { fontSize: 10, bold: true, color: C.blue, align: "center", valign: "middle" });
    dotBox(9.88, 2.28, 2.8, 2.34);
    text(s, "Org Expertise", 9.88, 2.32, 2.8, 0.28, { fontSize: 11.5, bold: true, color: "000000", align: "center", valign: "middle" });
    ln(10.05, 2.64, 2.46, 0, { dash: "dash", c: C.blue, wd: 0.75 });
    [["LatentView\nDE Horizontal", 9.98, 2.74], ["LatentView Data\nScience & AI Horizontal", 11.3, 2.74], ["LatentView BI\nCenter of Excellence", 9.98, 3.32], ["LatentView Supply\nChain CoE", 11.3, 3.32], ["Service Delivery\nExcellence", 10.64, 3.9]]
      .forEach(([t, x, y]) => pill(t, x, y, 1.28, 0.5, C.blue, 8.5));
    s.addShape("roundRect", { x: 9.83, y: 4.8, w: 2.9, h: 0.98, fill: { color: "7A1F4B" }, line: { color: "3A0F24", width: 0.75, dashType: "sysDot" }, rectRadius: 0.1 });
    text(s, "Buffer Pool of Trained Data Engineers, Data Scientists, Business Analysts & BI developers for Contingency Management", 9.9, 4.8, 2.76, 0.98, { fontSize: 9.5, color: C.white, align: "center", valign: "middle" });
    s.addImage({ data: ICON.starY, x: 12.5, y: 5.6, w: 0.2, h: 0.2 });
  }
  s.addNotes("Governance model: three tiers, each pairing Staples and LatentView, with a set cadence; issues move up a tier when they need a decision.\nExecutive team (quarterly): Staples leadership with LatentView leadership. Quarterly business review for value, excellence and innovation; quarterly discussions on long-term planning and strategic alignment; a monthly executive briefing on strategic updates, key risks and mitigation.\nProject team (monthly / quarterly): Staples team leads and stakeholders with LatentView client partners and account managers, who collectively own program management. Monthly business review on milestones, feedback and scope; weekly newsletters on project health with critical issues and dependencies escalated.\nDelivery team (daily / weekly): the Staples team lead works with the LatentView program manager and a data engineering, BI and data science team. Daily stand-ups with the program manager; weekly review meetings on progress, challenges and upcoming tasks; monthly sprint planning and cross-workstream meetings; a quarterly inspect-and-adapt.\nLatentView value adds and investments: access to a scalable analytics team; org expertise from the data engineering and data science & AI horizontals, the BI and supply-chain centres of excellence and service delivery excellence; a buffer pool of trained engineers, scientists, analysts and BI developers for contingency.\nHow we communicate: maximum transparency, feedback on the partnership and team, insight into team utilisation, identifying opportunities, and new ideas across multiple frontiers. The cadence scales with the phase on the growth plan: light while we build the launch stories, fuller once Staples' data joins.");

  // ======================= 6. SOLUTION ARCHITECTURE =======================
  pres.addSection({ title: "Appendix" });
  s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Appendix" });
  s.addText("Solution Architecture: From Listings to Safe Recommendations", { placeholder: "title" });
  const stages = [
    { t: "Data Acquisition", w: 1.9, items: [["dbS", "Staples.com", `${SKUS.staples} SKUs · 12 nodes`], ["dbA", "Amazon", `${SKUS.amazon} SKUs · 7 nodes`], ["dbW", "Wayfair", `${SKUS.wayfair} SKUs · 5 nodes`]] },
    { t: "Prep & Mapping", w: 2.05, items: [["filter", "Clean & de-identify", "prices, text fixes, PII removed"], ["layer", "Product families", "colour / size variants merged"], ["sitemap", "Node mapping", "k-NN classifier"]] },
    { t: "Attributes & Archetypes", w: 2.3, items: [["tags", "3-tier attributes", "function · look · lifestyle, same extractor on both sides"], ["proj", "Neutral product embeddings", "extracted attributes only (no title, price or brand), bge-base"], ["puzzle", "Archetypes", "4–6-attribute combinations, up to 3 sets per node"]] },
    { t: "Two Scoring Methods", w: 2.76, methods: true },
    { t: "Gates & Picks", w: 1.9, items: [["shield", "Safety gates", "common → per method → final"], ["check", "Final list", "union of both methods, 3–10 per node"], ["storeB", "Products & sellers", "each beside its nearest Staples item"]] },
  ];
  const AGs = 0.38, by = 2.05, bh = 4.65;
  let sx = 0.45;
  stages.forEach((st, i) => {
    const w = st.w, last = i === stages.length - 1;
    const cw = last ? w : w + AGs - 0.02;
    s.addShape(i === 0 ? "homePlate" : "chevron", { x: sx - (i ? 0.1 : 0), y: 1.28, w: cw + (i ? 0.1 : 0), h: 0.6, fill: { color: [C.pale, "CFDDF5", C.head, "A9C3EE", "97B6EA"][i] }, line: { color: C.white, width: 1 } });
    text(s, [{ text: st.t, options: { bold: true, breakLine: !!st.sub } }, ...(st.sub ? [{ text: st.sub, options: { fontSize: 9.5, color: C.muted } }] : [])], sx + (i ? 0.25 : 0.1), 1.28, cw - (i ? 0.45 : 0.4), 0.6, { fontSize: 12.5, color: C.navy, align: "center", valign: "middle" });
    box(s, sx, by, w, bh, C.white, { r: 0.08, line: "D3DDEE", lineW: 0.5 });
    if (st.methods) {
      const mm = [
        { h: "Method 1 · Vector view", f: C.paler, lines: ["VW (Vector Whitespace)", "AAS (Adjacency Affinity Score)", "CRS (Cannibalisation Risk Score)", "AD (Aesthetic Delta)", "PPR (Price Position Ratio)"], out: "→ VOS (Vector Opportunity Score)" },
        { h: "Method 2 · Attribute view", f: "F3F0FA", lines: ["LSR (Log Share Ratio)", "PPG (Price Position Gap)", "CG (Colour Gap) · MSG (Material/Style Gap)", "DFG (Design-Forward Gap)", "ACR (Attribute Cannibalisation Risk)"], out: "→ TG (Total Gap)" },
      ];
      mm.forEach((m, j) => {
        const mh = (bh - 0.3) / 2, my = by + 0.1 + j * (mh + 0.1);
        box(s, sx + 0.1, my, w - 0.2, mh, m.f, { r: 0.08 });
        text(s, m.h, sx + 0.2, my + 0.08, w - 0.4, 0.28, { fontSize: 12, bold: true, color: C.blue });
        text(s, m.lines.map((l, k) => ({ text: l, options: { breakLine: k < m.lines.length - 1 } })), sx + 0.2, my + 0.45, w - 0.35, 1.1, { fontSize: 9.5, color: C.text, paraSpaceAfter: 2 });
        text(s, m.out, sx + 0.2, my + mh - 0.4, w - 0.4, 0.3, { fontSize: 11, bold: true, color: C.navy });
      });
    } else {
      st.items.forEach(([ic, h, d], j) => {
        const iy = by + 0.3 + j * 1.48;
        s.addImage({ data: ICON[ic], x: sx + w / 2 - 0.25, y: iy, w: 0.5, h: 0.5 });
        text(s, h, sx + 0.08, iy + 0.56, w - 0.16, 0.24, { fontSize: 11.5, bold: true, color: C.navy, align: "center" });
        text(s, d, sx + 0.08, iy + 0.8, w - 0.16, 0.5, { fontSize: 9.5, color: C.muted, align: "center" });
      });
    }
    if (!last) arrow(s, sx + w + 0.08, by + bh / 2 - 0.15, 0.22, 0.3);
    sx += w + AGs;
  });
  s.addNotes("End-to-end flow. Prep & mapping: ingest and clean the three sources (PII from Wayfair reviews removed), merge colour/size variants into product families, map each competitor product to the right Staples node with a k-NN classifier over all Staples nodes. Attributes & archetypes: read every product's full text with the same extractor on both sides into 3 tiers of attributes; build archetypes as combinations of 4–6 attributes (no price). Neutral product embeddings: each product becomes a card of its extracted attributes only (same template on both sides, no title, price or brand, so neither retailer's copy style separates them), embedded with bge-base; it powers Method 1, the clustering cross-check and the nearest-Staples match for every example product. Method 1 in embedding space (whitespace, fit with Staples, aesthetic difference, cannibalisation risk, price position) gives VOS. Method 2 on attribute shares (share gap, price, colour, material/style, design) gives TG, with its own attribute cannibalisation check (ACR). Gates: each method has its own safety gate; the final gate takes the union and tiers it. Picks: example products safe under the recommending method, each shown next to the nearest Staples product, plus brand and seller notes.");

  // ======================= 7. METHOD 1 FRAMEWORK =======================
  s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Appendix" });
  s.addText("Method 1 (Vector View): Framework", { placeholder: "title" });
  {
    const M = F.m1, OK = ["D5F0E6", "5CC49A"], HOLD = ["FCEBCB", "E8B44A"], NO = ["E6E3FA", "A99BEA"];
    const g = 0.06, X0 = 1.75, W1 = 2.2, W2 = 2.6, W3 = 2.2, Y0 = 1.68, RH = 0.74, TOP = 4 * RH + 3 * g, BH = 0.86;
    const X2 = X0 + W1 + g, X3 = X2 + W2 + g, XE = X3 + W3;
    const cell = (x, y, w, h, [f, l], t, sub) => {
      box(s, x, y, w, h, f, { r: 0.08, line: l, lineW: 1 });
      text(s, [{ text: t, options: { bold: true, fontSize: 12, color: C.navy, breakLine: true } }, { text: sub, options: { fontSize: 9, color: C.text } }], x + 0.05, y, w - 0.1, h, { align: "center", valign: "middle" });
    };
    // column headers (CRS bands)
    [[X0, W1, `CRS < ${M.crs_low}`], [X2, W2, `${M.crs_low} ≤ CRS < ${M.crs_high}`], [X3, W3, `CRS ≥ ${M.crs_high}`]].forEach(([x, w, t]) =>
      text(s, t, x, 1.3, w, 0.3, { fontSize: 11, bold: true, color: C.mid, align: "center", valign: "middle" }));
    // column 1: low CRS
    const H2 = (TOP - g) / 2;
    cell(X0, Y0, W1, H2, OK, "CURATE", "true whitespace · approve");
    cell(X0, Y0 + H2 + g, W1, H2, HOLD, "EDGE", "weaker fit · hold for phase 2");
    // column 2: middle CRS
    cell(X2, Y0, W2, RH, OK, "LEAN-APPROVE", `AD ≥ ${M.ad_threshold} (clearly different look) · approve, flag`);
    cell(X2, Y0 + RH + g, W2, TOP - RH - g, HOLD, "REVIEW", "undecided · calibration queue");
    // column 3: high CRS, checked top-down
    [[NO, "1 · UNDERCUT", `PPR < ${M.ppr_undercut}× · hard reject`], [OK, "2 · TRADE-UP", `PPR ≥ ${M.ppr_tradeup}× + design/material upgrade`],
     [OK, "3 · STYLE-EXTENSION", `AD ≥ ${M.ad_threshold}: new colour/material/style`], [NO, "4 · SUBSTITUTE", "otherwise: same job, same look · reject"]]
      .forEach(([c, t, sub], j) => cell(X3, Y0 + j * (RH + g), W3, RH, c, t, sub));
    // bottom row: low AAS
    const YB = Y0 + TOP + g;
    cell(X0, YB, XE - X0, BH, NO, "OFF-BRAND", "poor fit with Staples' catalog and customers · reject (checked before CRS)");
    // AAS row labels + axis titles
    [[Y0, H2, `≥ T_high\n(${M.t_high})`], [Y0 + H2 + g, H2, "T_low–T_high"], [YB, BH, `< T_low\n(${M.t_low})`]].forEach(([y, h, t]) =>
      text(s, t, 0.72, y, X0 - 0.8, h, { fontSize: 10, color: C.muted, align: "right", valign: "middle" }));
    text(s, "AAS (Adjacency Affinity Score): fit with Staples →", 0.4, Y0, 0.36, YB + BH - Y0, { fontSize: 10.5, bold: true, color: C.navy, align: "center", valign: "middle", vert: "vert270" });
    text(s, "CRS (Cannibalisation Risk Score): functional closeness to a Staples product →", X0, YB + BH + 0.08, XE - X0, 0.3, { fontSize: 10.5, bold: true, color: C.navy, align: "center", valign: "middle" });
    // legend
    const LY = YB + BH + 0.48;
    [[OK, "approve (safe)"], [HOLD, "hold / undecided"], [NO, "reject"]].forEach(([[f, l], t], j) => {
      const x = X0 + j * 1.75;
      box(s, x, LY + 0.04, 0.18, 0.18, f, { r: 0.03, line: l, lineW: 1 });
      text(s, t, x + 0.26, LY, 1.45, 0.26, { fontSize: 9.5, color: C.text, valign: "middle" });
    });
    text(s, "EXCLUDE (identical to a Staples product) is checked first.", X0 + 4.1, LY, XE - X0 - 4.1, 0.26, { fontSize: 9.5, italic: true, color: C.muted, align: "right", valign: "middle" });
    // key terms
    const KX = 9.45, KW = 12.88 - KX;
    text(s, "KEY TERMS", KX, 1.3, KW, 0.3, { fontSize: 12, bold: true, color: C.blue, valign: "middle", charSpacing: 1 });
    const TERMS = [
      ["AAS", "Adjacency Affinity Score", "how well the product fits Staples' catalog and customers"],
      ["CRS", "Cannibalisation Risk Score", "how close it is in function to a Staples product (0–100); higher = more likely to take 1P sales"],
      ["PPR", "Price Position Ratio", "its price ÷ the median price of the nearest Staples products"],
      ["AD", "Aesthetic Delta", "look difference from the nearest Staples product (colour, material, style)"],
    ];
    const KG = 0.08, VH = 0.7, KH = (YB + BH - Y0 - VH - 4 * KG) / 4; // term cards + VOS box end level with the map
    TERMS.forEach(([ab, full, d], j) => {
      const y = Y0 + j * (KH + KG);
      box(s, KX, y, KW, KH, C.paler, { r: 0.08 });
      text(s, [{ text: ab, options: { bold: true, color: C.blue, fontSize: 13 } }, { text: `  (${full})`, options: { bold: true, color: C.navy, fontSize: 10.5 } }], KX + 0.14, y + 0.06, KW - 0.28, 0.28, { valign: "middle" });
      text(s, d, KX + 0.14, y + 0.36, KW - 0.28, KH - 0.4, { fontSize: 9.5, color: C.text, valign: "top" });
    });
    const VY = Y0 + 4 * (KH + KG);
    box(s, KX, VY, KW, YB + BH - VY, C.navy, { r: 0.08 });
    text(s, [{ text: "Green labels = safe for Method 1. ", options: { bold: true, color: C.orange } }, { text: "They are ranked by VOS (Vector Opportunity Score) and joined with Method 2's picks at the final gate.", options: { color: C.white } }], KX + 0.14, VY, KW - 0.28, YB + BH - VY, { fontSize: 10, valign: "middle" });
  }
  s.addNotes(`Method 1 decision map: every competitor product gets one label. First EXCLUDE (identical to a Staples product), then OFF-BRAND (AAS below T_low: poor fit with Staples' catalog and customers), then the CRS band decides. Low CRS (< ${F.m1.crs_low}): CURATE if AAS ≥ T_high (true whitespace), else EDGE (hold for phase 2). Middle CRS: LEAN-APPROVE if the look is clearly different (AD ≥ ${F.m1.ad_threshold}) and the fit is strong, else REVIEW (merchant calibration queue). High CRS (≥ ${F.m1.crs_high}), top-down: UNDERCUT (PPR < ${F.m1.ppr_undercut}×, hard reject), TRADE-UP (PPR ≥ ${F.m1.ppr_tradeup}× with a design or material upgrade), STYLE-EXTENSION (AD ≥ ${F.m1.ad_threshold}), otherwise SUBSTITUTE (same job, same look, reject).\nT_low / T_high are set from Staples' own AAS per L2 group (ranges ${F.m1.t_low} and ${F.m1.t_high}); all cut-offs are provisional until the merchant calibration session (slide 5, step 2 Protect).`);

  // ======================= 8. THANK YOU =======================
  pres.addSection({ title: "Close" });
  s = pres.addSlide({ masterName: "DARK", sectionTitle: "Close" });
  text(s, "Thank You", 0.7, 2.6, 8, 1.0, { fontSize: 48, bold: true, color: C.white });
  s.addShape("rect", { x: 0.72, y: 3.68, w: 1.2, h: 0.06, fill: { color: C.orange }, line: { color: C.orange, width: 0 } });
  text(s, "Questions & discussion", 0.7, 3.85, 8, 0.5, { fontSize: 22, color: "CADCFC" });
  text(s, "LatentView Analytics  ·  October 2026", 0.7, 6.25, 7, 0.35, { fontSize: 14, color: "CADCFC" });
  s.addNotes("Close. Next steps are on the executive summary and in detail on slides 5–7 (the PoC engine on Staples data, growth paths, and the phased growth plan).");

  await pres.writeFile({ fileName: OUT });
  console.log("wrote", OUT);
})();
