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
    hash: [fa.FaHashtag, C.white], poll: [fa.FaPoll, C.white], map: [fa.FaMapMarkedAlt, C.white],
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
    { v: "PRIORITISE", ic: "chart", f: `Link sales & search to the top picks in 2–3 pilot nodes`, h: "Demand & segment prioritisation", q: "Which gaps will sell, and to whom?",
      b: ["Link sales, traffic & search to each archetype", "Profile buyers: B2B vs B2C, RFM, basket mix", "Re-rank add-lists by expected GMV & commission"], d: "Sales · traffic · customers", o: "Revenue-ranked add-list per segment" },
    { v: "PROTECT", ic: "shieldW", f: `Calibrate gates with merchants (60 side-by-side pairs)`, h: "Cannibalisation & threshold tuning", q: "Will this listing take sales from 1P?",
      b: ["Tune safety-gate thresholds with merchants: cannibalisation, price, fit, picks per node", "Swap today's supply proxy for real 1P sales overlap", "Set price & margin floors per node"], d: "1P sales · margin · price history", o: "1P protected in revenue terms" },
    { v: "EXPAND", ic: "target", f: `Agree the next nodes & benchmark competitors`, h: "Any node, competitor or audience", q: "Where should Staples grow next?",
      b: ["Pick the category and the competitor to benchmark", "e.g. IKEA for small-space home offices, Target for Back-to-School, Etsy for gifting", "From 12 nodes to every category: config only, no new code"], d: "Staples catalog + new competitor crawls", o: "The engine aimed at the audience Staples wants" },
    { v: "CURATE", ic: "clip", f: `Vet top picks; start with the ${SRC.brands_on_staples_12_n} brands on Staples`, h: "Automated seller-listing vetting", q: "Should this listing go live?",
      b: ["Score every seller submission with the same engine", "Check fit, 1P overlap & price automatically", "Approve / review / reject queue that learns from curators"], d: "Seller submissions · curator decisions", o: "Curation that scales beyond manual review" },
    { v: "MONITOR", ic: "radar", f: `Track pilots' GMV, attach & commission`, h: "Market radar & pilot tracking", q: "What changed, and what worked?",
      b: ["Monthly re-crawls flag new & closing gaps", "Track listed picks' GMV, attach & commission", "Compare with forecast; feed back into step 1"], d: "Sales · pilot results (+ competitor crawls)", o: "Live gap list & proven ROI" },
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
    { k: "Coffee Organizers", pk: P["Coffee Organizers"][0], h: "Wooden K-Cup pod drawers", st: "coffee organisers",
      hook: `Staples sells ${A.single_serve} single-serve coffees & ${A.coffee_makers} coffee makers; its organisers are ${S.coffee_plastic.st}% plastic` },
    { k: "Lunch Bags", pk: P["Lunch Bags"][0], h: "Adult bento boxes for the commute", st: "lunch bags",
      hook: `Lunch range built for school (${S.lunch_kids.st}% kids vs ${S.lunch_kids.co}% at Amazon); office commuters under-served` },
    { k: "Planners", pk: P.Planners[1], h: "Guided & daily journals", st: "planners",
      hook: `Planner shoppers already come to Staples (${P.Planners[1].attr_check.staples_total} planners); a journal is the natural add-on` },
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
  s.addNotes(`The ask: a curated, core-adjacent ("White Chair") marketplace for Q1 2027 that does not cannibalise 1P sales, built on external data only.\nFunnel: ${T.families_all.toLocaleString("en-US")} product families (${T.staples_families.toLocaleString("en-US")} Staples, ${T.amazon_families.toLocaleString("en-US")} Amazon, ${T.wayfair_families.toLocaleString("en-US")} Wayfair; colour/size variants merged) → ${T.archetypes_built} archetypes compared → ${T.recommended} pass the safety gates (${T.tiers.Strong} Strong, ${T.tiers["Vector-led"]} Vector-led, ${T.tiers["Gap-led"]} Gap-led, ${T.tiers.Conditional || 0} Conditional) → ${T.example_products} example products, each shown beside the nearest Staples item → ${SRC.brands_on_staples_12_n} brands already selling on Staples (${SRC.brands_on_staples_12.join(", ")}).\nHow: Method 1 compares products in an embedding space (whitespace, fit with Staples, look, cannibalisation risk, price position); Method 2 compares attribute shares (share gap, price, colour, material/style, design). Each has its own cannibalisation gate; the final list is their union.\nThe four headline picks are anchored to what Staples already sells, so a merchant recognises them; each was checked against the Staples catalog: wooden K-Cup pod drawers ${P["Coffee Organizers"][0].attr_check.staples_hits} of ${P["Coffee Organizers"][0].attr_check.staples_total} coffee organisers (Strong: both methods; Staples sells ${A.single_serve} single-serve coffee items and ${A.coffee_makers} coffee makers); adult stainless bento ${P["Lunch Bags"][0].attr_check.staples_hits} of ${P["Lunch Bags"][0].attr_check.staples_total} lunch bags (Strong); journals ${P.Planners[1].attr_check.staples_hits} of ${P.Planners[1].attr_check.staples_total} planners (Gap-led); barrel chairs ${P["Accent Chairs"][1].attr_check.staples_hits} of ${P["Accent Chairs"][1].attr_check.staples_total} accent chairs (Gap-led; the literal "White Chair").\nBackup picks if asked: folding screens under $150 (${P.Partitions[0].attr_check.staples_hits} of ${P.Partitions[0].attr_check.staples_total} partitions vs ${Math.round(P.Partitions[0].attr_check.comp_share)}% of Wayfair's; Strong), statement wall clocks (Staples' clocks ${S.clocks_plastic.st}% plastic vs ${S.clocks_plastic.co}% at Wayfair; Strong), hiking / outdoor daypacks (${P.Backpacks[0].attr_check.staples_hits} of ${P.Backpacks[0].attr_check.staples_total} vs ${Math.round(P.Backpacks[0].attr_check.comp_share)}% of Amazon's).\nIf asked about the assortments: Staples builds for the workplace (${S.chairs_reception.st}% of accent chairs are reception/lobby seats vs ${S.chairs_reception.co}% at Wayfair; ${S.partitions_tackable.st}% of partitions tackable vs ${S.partitions_tackable.co}%); Wayfair for the home (${S.chairs_residential.co}% of accent chairs for living rooms vs ${S.chairs_residential.st}%); Amazon for the person and the activity (${S.bp_hiking.co}% of backpacks hiking/outdoor vs ${S.bp_hiking.st}%). Design-forward share ${DF.staples_all}% at Staples vs ${DF.competitor_all}% at the competitors (text-based, provisional). Price: Staples desks median ${money0(N["Office Desks"].price_median_staples)} vs ${money0(N["Office Desks"].price_median_competitor)} at Wayfair; ${B.planners_u10.co}% of Amazon planners under $10 vs ${B.planners_u10.st}%.\nMore picks: ${T.recommended - 4} further archetypes, each with example products, are in the demo.\nNext steps: the five steps of slide 5 (same labels and headings). First moves if asked: ${CONT.map((c, i) => `${i + 1} ${c.v[0] + c.v.slice(1).toLowerCase()}: ${c.f}`).join("; ")}.`);

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
  text(s, runs("The same Assortment Gap & Recommendation analysis, powered by **real demand**, **Staples' own data** and **merchant-set thresholds**.", { fontSize: 11.5, color: C.text }, C.navy), 0.6, 1.18, 12.13, 0.38, { align: "center", valign: "middle" });
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
  s.addNotes("The PoC engine on Staples data: the same analysis, now on Staples' internal data. If asked about order: deepen the 12 nodes first, then broaden.\n1 Prioritise: join sales, traffic and search data to each archetype; profile buyers (B2B vs B2C, RFM, basket mix); re-rank each node's add-list by expected GMV and commission per segment (Hero / Probable / Non-Hero).\n2 Protect: today's cannibalisation checks use supply only (how close a competitor product sits to Staples products). With Staples data we tune every safety-gate threshold with merchants (cannibalisation risk bands, price-position limits, fit-with-Staples cut-offs, picks per node; the merchant calibration session on slide 2 is the first move) and replace the supply proxy with real 1P sales overlap and substitution seen in baskets, plus price and margin floors per node.\n3 Expand: once calibrated, point the engine at any Staples category and any competitor that represents the audience Staples wants (e.g. IKEA for small-space home offices, Target for students and Back-to-School, Etsy for gifting). A new competitor is one adapter entry and a new node one config file; no code change.\n4 Curate: the same attribute and archetype engine scores every seller submission for fit, 1P overlap and price, feeding an approve / review / reject queue that learns from curator decisions (first move: vet the top picks, starting with the brands already on Staples).\n5 Monitor: scheduled re-crawls flag new and closing gaps; pilot listings are tracked for GMV, attach rate and commission against the forecast, and results feed back into prioritisation.");

  // ======================= 5. GROWTH PATHS =======================
  s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Next steps" });
  s.addText("Growth Paths for the Marketplace", { placeholder: "title" });
  box(s, 0.45, 1.18, 12.43, 0.38, C.paler, { r: 0.08 });
  text(s, runs("Beyond assortment gaps: **six more ways to grow**, combining external signals with Staples data.", { fontSize: 11.5, color: C.text }, C.navy), 0.6, 1.18, 12.13, 0.38, { align: "center", valign: "middle" });
  const ALT = [
    { t: "SENSE demand early", fill: C.blue, cards: [
      { ic: "srch", h: "SEO & search-intent gaps", q: "What do shoppers search for but not find?",
        b: ["Map on-site searches & SEO keywords to archetypes", "Flag zero-result searches & keywords rivals win", "Feed seller recruiting & product pages"], d: "On-site search logs · SEO keywords", o: "Existing traffic, converted" },
      { ic: "hash", h: "Social media & trend listening", q: "Which styles are taking off?",
        b: ["Track archetype mentions & saves on TikTok, Pinterest, Reddit", "Add Google Trends; score growth & sentiment", "Flag rising styles for Explore nodes"], d: "Social & trend data + Staples sales", o: "Spot the next \"White Chair\" early" },
    ] },
    { t: "SIZE & VALIDATE", fill: C.mid, cards: [
      { ic: "poll", h: "Market research & customer surveys", q: "What do Staples customers actually want?",
        b: ["Survey B2B & B2C customers on needs, style & price", "Concept-test the top archetypes with images", "Feed results into the prioritisation weights"], d: "Customer panel · email base", o: "Picks validated by Staples' own customers" },
      { ic: "barW", h: "Demand forecasting", q: "How much will each archetype sell?",
        b: ["Forecast demand per node & archetype", "Add seasonality (Back-to-School) & trend signals", "Size GMV & commission before listing"], d: "Sales history + trend signals", o: "Supply in place before the season" },
    ] },
    { t: "ACT on basket & catalog", fill: C.navy, cards: [
      { ic: "map", h: "New-category whitespace", q: "Which new categories are worth opening?",
        b: [`Start from the ${k1(T.backlog_families)} competitor products outside the 12 nodes`, "Add adjacent verticals, e.g. facility supplies", "Size with forecasting & research; open the best"], d: "PoC backlog + sales & search", o: "Evidence-backed new categories" },
      { ic: "basket", h: "Basket completion & Back-to-School kits", q: "Which item would complete the basket?",
        b: ["Market-basket analysis on transactions", "Find missing complements & seasonal kits", "Recruit sellers for 1–2 attach items per order"], d: "Transactions", o: "Bigger baskets, new commission" },
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
  s.addNotes(`Growth paths, read left to right: sense demand early, size and validate it, then act on the basket and the catalog. Each combines external signals with Staples data.\n- Social media & trend listening (social media analytics + trend listening): mentions, hashtags and saves per archetype on TikTok, Instagram, Pinterest and Reddit plus Google Trends, scored for growth and sentiment; rising styles feed the Explore nodes.\n- SEO & search-intent gaps: on-site searches (zero-result, high-exit) and external SEO keywords where competitors rank and Staples does not, mapped to archetypes; feeds seller recruiting and product pages.\n- Demand forecasting: per node and archetype from sales history, with Back-to-School seasonality and the trend signals from social listening; sizes GMV and commission before listing.\n- Market research & customer surveys (market research + market survey): B2B and B2C customers on unmet needs, style and price; concept tests of the top archetypes; results set the prioritisation weights.\n- Basket completion & Back-to-School kits: market-basket analysis finds missing complements; target 1–2 attach items per order (the brief's basket goal).\n- New-category whitespace: the PoC already set aside ${T.backlog_families.toLocaleString("en-US")} competitor product families that fit none of the 12 nodes (e.g. wall calendars, thermocoolers, reusable bags, briefcases, many of which Staples shelves elsewhere); running the engine against the whole Staples tree, plus the brief's adjacent verticals such as facility supplies, finds categories with no Staples home.\nFurther options if asked: B2B account cross-sell, seller recruitment scoring, listing content enrichment (our attribute extractor auto-tags seller listings for filters and search).`);

  // ======================= 6. SOLUTION ARCHITECTURE =======================
  pres.addSection({ title: "Appendix" });
  s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Appendix" });
  s.addText("Solution Architecture: From Listings to Safe Recommendations", { placeholder: "title" });
  const stages = [
    { t: "Data Acquisition", w: 1.9, items: [["dbS", "Staples.com", `${SKUS.staples} SKUs · 12 nodes`], ["dbA", "Amazon", `${SKUS.amazon} SKUs · 7 nodes`], ["dbW", "Wayfair", `${SKUS.wayfair} SKUs · 5 nodes`]] },
    { t: "Prep & Mapping", sub: "S0–S2", w: 2.05, items: [["filter", "Clean & de-identify", "prices, text fixes, PII removed"], ["layer", "Product families", "colour / size variants merged"], ["sitemap", "Node mapping", "k-NN classifier"]] },
    { t: "Attributes & Archetypes", sub: "S3–S4", w: 2.3, items: [["tags", "3-tier attributes", "function · look · lifestyle, same extractor on both sides"], ["proj", "Neutral product embeddings", "extracted attributes only (no title, price or brand), bge-base"], ["puzzle", "Archetypes", "4–6-attribute combinations, up to 3 sets per node"]] },
    { t: "Two Scoring Methods", sub: "S5–S6", w: 2.76, methods: true },
    { t: "Gates & Picks", sub: "S7–S8", w: 1.9, items: [["shield", "Safety gates", "common → per method → final"], ["check", "Final list", "union of both methods, 3–10 per node"], ["storeB", "Products & sellers", "each beside its nearest Staples item"]] },
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
  s.addNotes("End-to-end flow. S0–S2: ingest and clean the three sources (PII from Wayfair reviews removed), merge colour/size variants into product families, map each competitor product to the right Staples node with a k-NN classifier over all Staples nodes. S3–S4: read every product's full text with the same extractor on both sides into 3 tiers of attributes; build archetypes as combinations of 4–6 attributes (no price). Neutral product embeddings: each product becomes a card of its extracted attributes only (same template on both sides, no title, price or brand, so neither retailer's copy style separates them), embedded with bge-base; it powers Method 1, the clustering cross-check and the nearest-Staples match for every example product. S5: Method 1 in embedding space (whitespace, fit with Staples, aesthetic difference, cannibalisation risk, price position) gives VOS. S6: Method 2 on attribute shares (share gap, price, colour, material/style, design) gives TG, with its own attribute cannibalisation check (ACR). S7: each method has its own safety gate; the final gate takes the union and tiers it. S8: example products safe under the recommending method, each shown next to the nearest Staples product, plus brand and seller notes.");

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
  s.addNotes("Close. Next steps are on the executive summary and in detail on slide 5 (the PoC engine on Staples data).");

  await pres.writeFile({ fileName: OUT });
  console.log("wrote", OUT);
})();
