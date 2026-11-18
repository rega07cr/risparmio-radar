/* ============================================================
   Risparmio Radar — UI
   Vanilla JS, nessuna build, stato in localStorage.
   ============================================================ */
(function () {
  "use strict";

  var D = window.RADAR_DATA;
  var E = window.RadarEngine;

  /* ---------------- storage ---------------- */
  var PREFIX = "rr1:";
  function load(key, fallback) {
    try {
      var raw = localStorage.getItem(PREFIX + key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (err) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch (err) { /* quota / private mode */ }
  }

  var state = {
    tab: "offerte",
    deal: { q: "", cat: "", merchant: "", sort: "score", budget: 2000, topOnly: false, limit: 24 },
    offer: { kind: "", q: "" },
    product: { cat: "", competition: "", sort: "opportunity" },
    selectedProduct: load("selectedProduct", D.products[0].id),
    margin: load("margin", 0.4),
    adPct: load("adPct", 15),
    angle: load("angle", "premium"),
    idea: { capital: "", effort: "", category: "" },
    mining: (function () {
      var saved = load("mining", {});
      return {
        hashValue: saved.hashValue == null ? 20 : saved.hashValue,
        hashUnit: saved.hashUnit == null ? 1000 : saved.hashUnit,
        watts: saved.watts == null ? 65 : saved.watts,
        kwh: saved.kwh == null ? 0.28 : saved.kwh,
        coinId: saved.coinId || "monero",
        speed: saved.speed == null ? 60 : saved.speed,
        running: false,
        withdrawType: "wallet",
        prices: {}
      };
    })(),
    lastMeasured: null
  };

  var accounts = load("accounts", {});
  var requests = load("requests", []);
  var codes = load("codes", []);
  var checks = load("checks", {});

  function coinById(id) {
    return D.coins.filter(function (c) { return c.id === id; })[0] || D.coins[0];
  }
  function productById(id) {
    return D.products.filter(function (p) { return p.id === id; })[0] || D.products[0];
  }
  function priceOf(coin) {
    var live = state.mining.prices[coin.id];
    return live == null ? coin.priceEur : live;
  }
  function accountOf(coin) {
    if (!accounts[coin.id]) accounts[coin.id] = { balance: 0, seconds: 0 };
    return accounts[coin.id];
  }
  function hashHs() {
    return Math.max(0, Number(state.mining.hashValue) || 0) * Number(state.mining.hashUnit || 1);
  }
  function currentEcon(coin) {
    return E.coinEconomics(coin, hashHs(), priceOf(coin), Number(state.mining.watts) || 0, Number(state.mining.kwh) || 0);
  }
  function withdrawFee() { return 0.6; }

  /* ---------------- MineVault: conto bancario demo ----------------
     Vive in localStorage come il conto mining: chiudendo la pagina non si perde
     nulla. Nessun dato esce dal dispositivo e nessun euro è reale. */
  var vault = (function () {
    var saved = load("vault", null);
    var v = saved && typeof saved === "object" ? saved : {};
    return {
      iban: v.iban || "IT00 MVLT 0942 0000 0000 0000 0001",
      balance: Number(v.balance) || 0,
      earned: Number(v.earned) || 0,
      taxPaid: Number(v.taxPaid) || 0,
      taxRate: v.taxRate == null ? 26 : Number(v.taxRate),
      feePct: v.feePct == null ? 1 : Number(v.feePct),
      calc: v.calc == null ? 100 : Number(v.calc),
      tx: Array.isArray(v.tx) ? v.tx : []
    };
  })();

  function round2(v) { return Math.round((Number(v) || 0) * 100) / 100; }

  function vaultQuote(gross, coin) {
    var g = Math.max(0, Number(gross) || 0);
    var networkFee = g > 0 ? Math.min(withdrawFee(), g) : 0;
    var afterNetwork = Math.max(0, g - networkFee);
    var vaultFee = afterNetwork * (Number(vault.feePct) || 0) / 100;
    var taxable = Math.max(0, afterNetwork - vaultFee);
    var tax = taxable * (Number(vault.taxRate) || 0) / 100;
    return {
      gross: g,
      networkFee: networkFee,
      vaultFee: vaultFee,
      taxable: taxable,
      tax: tax,
      net: taxable - tax
    };
  }

  /* ---------------- helpers ---------------- */
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  var toastTimer = null;
  function toast(message) {
    var el = $("#toast");
    el.textContent = message;
    el.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("is-on"); }, 2600);
  }

  function copyText(text, message) {
    var done = function () { toast(message || "Copiato negli appunti"); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
    } else {
      fallbackCopy(text); done();
    }
  }
  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch (err) { /* ignore */ }
    document.body.removeChild(ta);
  }

  var DEAL_CATEGORY_LABELS = {};

  /* ---------------- tabs ---------------- */
  function setTab(name, scroll) {
    var known = ["offerte", "sconti", "dropshipping", "mining", "idee"];
    if (known.indexOf(name) === -1) name = "offerte";
    state.tab = name;
    $$(".tab").forEach(function (btn) {
      var active = btn.getAttribute("data-tab") === name;
      btn.classList.toggle("is-active", active);
      if (active) btn.setAttribute("aria-current", "page"); else btn.removeAttribute("aria-current");
    });
    $$(".panel").forEach(function (panel) {
      panel.classList.toggle("is-active", panel.id === "panel-" + name);
    });
    if (history.replaceState) history.replaceState(null, "", "#" + name);
    if (scroll !== false) window.scrollTo({ top: 0, behavior: "smooth" });
    if (name === "mining") updateAccountDom();
  }

  /* ============================================================
     OFFERTE
     ============================================================ */
  function renderHeroStats() {
    var scored = D.deals.map(function (d) { return { d: d, s: E.dealScore(d) }; });
    var best = scored.slice().sort(function (a, b) { return b.s.realDiscount - a.s.realDiscount; })[0];
    var top = scored.filter(function (x) { return x.s.total >= 80; }).length;
    var merchants = {};
    D.deals.forEach(function (d) { merchants[d.merchant] = true; });
    var el = $("#hero-stats");
    el.innerHTML =
      '<div class="stat"><div><b>' + D.deals.length + '</b><small>offerte analizzate</small></div><span class="stat-note">snapshot ' + D.meta.snapshot.split("-").reverse().join("/") + '</span></div>' +
      '<div class="stat"><div><b class="pos">−' + E.pct(best.s.realDiscount * 100) + '</b><small>miglior sconto reale</small></div><span class="stat-note">' + E.escapeHtml(best.d.name) + '</span></div>' +
      '<div class="stat"><div><b>' + top + '</b><small>affari con punteggio ≥ 80</small></div><span class="stat-note">su ' + D.deals.length + ' monitorati</span></div>' +
      '<div class="stat"><div><b>' + Object.keys(merchants).length + '</b><small>negozi monitorati</small></div><span class="stat-note">Amazon, Apple, DJI, Dyson, GameStop…</span></div>';
  }

  function dealCategories() {
    var set = {};
    D.deals.forEach(function (d) { set[d.category] = true; });
    return Object.keys(set).sort(function (a, b) { return a.localeCompare(b, "it"); });
  }

  function renderDealFilters() {
    var cats = dealCategories();
    var wrap = $("#deal-categories");
    wrap.innerHTML = '<button class="chip is-active" data-cat="">Tutte</button>' + cats.map(function (c) {
      return '<button class="chip" data-cat="' + E.escapeHtml(c) + '">' + E.escapeHtml(c) + '</button>';
    }).join("");

    var merchants = {};
    D.deals.forEach(function (d) { merchants[d.merchant] = true; });
    var sel = $("#deal-merchant");
    sel.innerHTML = '<option value="">Tutti</option>' + Object.keys(merchants).sort().map(function (m) {
      return '<option value="' + E.escapeHtml(m) + '">' + E.escapeHtml(m) + '</option>';
    }).join("");
  }

  function filteredDeals() {
    var f = state.deal;
    var q = f.q.trim().toLowerCase();
    var list = D.deals.filter(function (d) {
      if (f.cat && d.category !== f.cat) return false;
      if (f.merchant && d.merchant !== f.merchant) return false;
      if (d.price > f.budget) return false;
      if (q) {
        var hay = (d.name + " " + d.brand + " " + d.category + " " + d.features.join(" ")).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      if (f.topOnly && E.dealScore(d).total < 80) return false;
      return true;
    });

    list.sort(function (a, b) {
      var sa = E.dealScore(a), sb = E.dealScore(b);
      if (f.sort === "price-asc") return a.price - b.price;
      if (f.sort === "discount") return sb.realDiscount - sa.realDiscount;
      if (f.sort === "rating") return (b.rating - a.rating) || (b.reviews - a.reviews);
      return sb.total - sa.total;
    });
    return list;
  }

  /* Miniatura della card: usa d.image se presente (con fallback automatico
     se l'immagine non carica), altrimenti un'illustrazione generata
     dalla categoria del prodotto, così nessuna card resta vuota. */
  var THUMB_ICONS = {
    audio: '<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="2.4" y="13.4" width="4.2" height="7.2" rx="2.1"/><rect x="17.4" y="13.4" width="4.2" height="7.2" rx="2.1"/>',
    screen: '<rect x="2.4" y="4" width="19.2" height="12.4" rx="2"/><path d="M8 20.4h8M12 16.4v4"/>',
    laptop: '<rect x="3.6" y="5" width="16.8" height="10.6" rx="1.6"/><path d="M2 19.2h20"/>',
    phone: '<rect x="7" y="2.4" width="10" height="19.2" rx="2.4"/><path d="M10.8 18.4h2.4"/>',
    gamepad: '<path d="M8 8.4h8a4.8 4.8 0 0 1 0 9.6H8a4.8 4.8 0 0 1 0-9.6Z"/><path d="M9.6 11.6v3.4M7.9 13.3h3.4"/><circle cx="16" cy="12.2" r=".85"/><circle cx="17.9" cy="14.2" r=".85"/>',
    camera: '<rect x="2.4" y="6.6" width="19.2" height="12.8" rx="2.4"/><circle cx="12" cy="13" r="3.4"/><path d="M8.2 6.6 9.7 4.4h4.6l1.5 2.2"/>',
    drive: '<rect x="3" y="4.2" width="18" height="6.6" rx="2"/><rect x="3" y="13.2" width="18" height="6.6" rx="2"/><path d="M6.4 7.5h.01M6.4 16.5h.01"/>',
    network: '<path d="M2.6 8.6a15 15 0 0 1 18.8 0"/><path d="M5.6 12.2a10.4 10.4 0 0 1 12.8 0"/><path d="M8.6 15.7a5.8 5.8 0 0 1 6.8 0"/><circle cx="12" cy="19.2" r="1"/>',
    home: '<path d="M3.6 11 12 3.6 20.4 11"/><path d="M6.2 10v10h11.6V10"/>',
    wearable: '<circle cx="12" cy="12" r="5.4"/><path d="M9.2 6.8 9.6 3h4.8l.4 3.8M9.2 17.2 9.6 21h4.8l.4-3.8"/><path d="M12 9.8v2.6l1.6 1"/>',
    keyboard: '<rect x="2.2" y="6.2" width="19.6" height="11.6" rx="2"/><path d="M5.8 10h.01M9.3 10h.01M12.8 10h.01M16.3 10h.01M7 14h10"/>',
    chip: '<rect x="6.6" y="6.6" width="10.8" height="10.8" rx="2"/><path d="M10 3v3.6M14 3v3.6M10 17.4V21M14 17.4V21M3 10h3.6M3 14h3.6M17.4 10H21M17.4 14H21"/>',
    bolt: '<path d="M13 2.6 5.6 13.4H11l-1 8 8-11.6H12l1-7.2Z"/>',
    device: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8.6 9.4h6.8M8.6 12.6h6.8M8.6 15.8h3.6"/>'
  };

  function thumbKey(d) {
    var c = (d.category + " " + d.brand + " " + d.name).toLowerCase();
    if (/cuffie|audio|speaker|soundbar|earbud|auricolari|sonos|bose|jbl|airpods|momentum|home cinema/.test(c)) return "audio";
    if (/tv|televisore|proiettore|oled|qled/.test(c)) return "screen";
    if (/monitor/.test(c)) return "screen";
    if (/notebook|portatile|laptop|macbook|ultrabook|chromebook/.test(c)) return "laptop";
    if (/smartphone|iphone|galaxy s|pixel|telefono/.test(c)) return "phone";
    if (/tablet|ipad|paperwhite|kindle/.test(c)) return "phone";
    if (/console|gaming|playstation|xbox|switch|dualsense|controller|quest|gamepad/.test(c)) return "gamepad";
    if (/drone|camera|fotocamera|mirrorless|gopro|osmo|obiettivo|eos|zv-e10/.test(c)) return "camera";
    if (/ssd|storage|nvme|hard disk|hdd|espansione|microsd/.test(c)) return "drive";
    if (/router|rete|wifi|mesh|deco|nighthawk/.test(c)) return "network";
    if (/aspirapolvere|dyson|purificatore|robot|casa|nest|chromecast|smart home/.test(c)) return "home";
    if (/smartwatch|forerunner|fitness|garmin/.test(c)) return "wearable";
    if (/tastiera|keychron|keyboard|mouse|superlight|master/.test(c)) return "keyboard";
    if (/gpu|rtx|radeon|geforce|cpu|ryzen|intel|alimentatore|scheda madre|ram/.test(c)) return "chip";
    if (/power bank|batteria|caricatore|nexode|alimentazione/.test(c)) return "bolt";
    return "device";
  }

  function thumbHue(seed) {
    var h = 0;
    var s = String(seed || "");
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
    return h;
  }

  function dealThumb(d) {
    var hue = thumbHue(d.brand + d.id);
    var mono = (d.brand || d.merchant || "?").split(/\s+/).slice(0, 2).map(function (w) { return w.charAt(0); }).join("");
    var img = d.image
      ? '<img src="' + E.escapeHtml(d.image) + '" alt="" loading="lazy" decoding="async" onerror="this.remove()">'
      : "";
    return '<div class="deal-thumb" style="--h:' + hue + '" aria-hidden="true">' +
      img +
      '<span class="thumb-mono">' + E.escapeHtml(mono) + '</span>' +
      '<svg class="thumb-icon" viewBox="0 0 24 24">' + (THUMB_ICONS[thumbKey(d)] || THUMB_ICONS.device) + '</svg>' +
      (d.image ? "" : '<span class="thumb-tag">anteprima generata</span>') +
      '</div>';
  }

  function dealCard(d) {
    var s = E.dealScore(d);
    var saving = d.avg90 - d.price;
    var badges = [];
    if (s.total >= 80) badges.push('<span class="badge badge-top">TOP</span>');
    if (d.price <= d.min90 * 1.02) badges.push('<span class="badge badge-good">vicino al minimo</span>');
    if (d.shipping === 0) badges.push('<span class="badge">spedizione gratis</span>');
    if (s.inflated) badges.push('<span class="badge badge-warn">listino gonfiato</span>');

    var whyRows = s.parts.map(function (p) {
      return '<div class="why-row"><span>' + E.escapeHtml(p.label) + '</span><i style="--w:' + Math.round((p.points / p.max) * 100) + '%"></i><em>' + Math.round(p.points) + '</em></div>';
    }).join("");

    var pricePosText = s.pricePos <= 0.15 ? "Sei praticamente al minimo degli ultimi 90 giorni."
      : s.pricePos <= 0.4 ? "Il prezzo è nella parte bassa della forbice a 90 giorni."
        : "Il prezzo è nella parte alta della forbice: c'è margine di attesa.";

    return '' +
      '<article class="deal" data-deal="' + E.escapeHtml(d.id) + '">' +
        dealThumb(d) +
        '<div class="deal-top">' +
          '<div><span class="deal-cat">' + E.escapeHtml(d.category) + ' · ' + E.escapeHtml(d.brand) + '</span></div>' +
          '<span class="deal-merchant">' + E.escapeHtml(d.merchant) + '</span>' +
        '</div>' +
        '<h3>' + E.escapeHtml(d.name) + '</h3>' +
        '<ul class="deal-feats">' + d.features.map(function (f) { return '<li>' + E.escapeHtml(f) + '</li>'; }).join("") + '</ul>' +
        '<div class="price-line">' +
          '<span class="price-now">' + E.eur(d.price) + '</span>' +
          '<span class="price-old">' + E.eur(d.listPrice) + '</span>' +
          '<span class="price-saving">' + (saving > 0 ? "−" + E.pct(s.realDiscount * 100) + " vs media 90gg" : "sopra la media") + '</span>' +
        '</div>' +
        '<div class="score-box">' +
          '<span class="score-ring" style="--p:' + s.total + '"><b>' + s.total + '</b></span>' +
          '<span class="score-meta"><b>' + s.verdict + '</b><small>' + s.verdictNote + '</small></span>' +
        '</div>' +
        '<div class="deal-badges">' + badges.join("") + '</div>' +
        '<div class="deal-foot">' +
          '<span class="rating">★ <b>' + d.rating.toFixed(1).replace(".", ",") + '</b> · ' + E.num(d.reviews, 0) + ' rec.</span>' +
          '<div class="deal-actions">' +
            '<button class="icon-btn" data-why="' + E.escapeHtml(d.id) + '" aria-label="Perché questo punteggio" aria-expanded="false">' +
              '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>' +
            '</button>' +
            '<a class="btn btn-primary btn-sm" href="' + E.offerUrl(d) + '" target="_blank" rel="noopener noreferrer" aria-label="' + E.escapeHtml(E.storeLabel(d) + ": " + d.name) + '">' +
              E.escapeHtml(E.storeLabel(d)) +
            '</a>' +
          '</div>' +
        '</div>' +
        '<div class="why" id="why-' + E.escapeHtml(d.id) + '">' +
          whyRows +
          '<p><b>Prezzo vs media 90 giorni:</b> ' + E.eur(d.avg90) + ' · <b>minimo:</b> ' + E.eur(d.min90) + '. ' + pricePosText + '</p>' +
          (s.inflated ? '<p><b>Listino gonfiato:</b> il prezzo “pieno” di ' + E.eur(d.listPrice) + ' non è mai stato il prezzo reale (media 90gg ' + E.eur(d.avg90) + '). Lo sconto vero è ' + E.pct(s.realDiscount * 100) + ', non ' + E.pct(s.listDiscount * 100) + '.</p>' : '') +
          '<p>' + E.escapeHtml(d.note) + '</p>' +
        '</div>' +
      '</article>';
  }

  function resetDealLimit() { state.deal.limit = 24; }

  function renderDeals() {
    var list = filteredDeals();
    var grid = $("#deals-grid");
    var shown = list.slice(0, state.deal.limit);
    grid.innerHTML = shown.map(dealCard).join("");
    $("#deals-empty").hidden = list.length > 0;
    var top = list.filter(function (d) { return E.dealScore(d).total >= 80; }).length;
    var merchants = {};
    list.forEach(function (d) { merchants[d.merchant] = true; });
    var merchantCount = Object.keys(merchants).length;
    $("#deal-count").textContent = list.length + (list.length === 1 ? " offerta" : " offerte") + " · " + merchantCount + (merchantCount === 1 ? " negozio" : " negozi") + " · " + top + " con punteggio ≥ 80";
    var more = $("#deal-more");
    var note = $("#deal-more-note");
    if (more) {
      more.hidden = shown.length >= list.length;
      note.textContent = shown.length >= list.length
        ? "Hai visto tutte le " + list.length + " offerte con questi filtri."
        : "Mostrate " + shown.length + " di " + list.length + " offerte · ne restano " + (list.length - shown.length) + ".";
    }
  }

  function bindDeals() {
    $("#deal-search").addEventListener("input", function (e) { state.deal.q = e.target.value; resetDealLimit(); renderDeals(); });
    $("#deal-merchant").addEventListener("change", function (e) { state.deal.merchant = e.target.value; resetDealLimit(); renderDeals(); });
    $("#deal-sort").addEventListener("change", function (e) { state.deal.sort = e.target.value; resetDealLimit(); renderDeals(); });
    $("#deal-top-only").addEventListener("change", function (e) { state.deal.topOnly = e.target.checked; resetDealLimit(); renderDeals(); });
    $("#deal-budget").addEventListener("input", function (e) {
      state.deal.budget = Number(e.target.value);
      $("#budget-out").textContent = state.deal.budget >= 2000 ? "2000+ €" : state.deal.budget + " €";
      resetDealLimit();
      renderDeals();
    });
    $("#deal-categories").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-cat]");
      if (!btn) return;
      state.deal.cat = btn.getAttribute("data-cat");
      $$(".chip", $("#deal-categories")).forEach(function (c) { c.classList.toggle("is-active", c === btn); });
      resetDealLimit();
      renderDeals();
    });
    $("#deal-more").addEventListener("click", function () {
      state.deal.limit += 24;
      renderDeals();
    });
    $("#deals-grid").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-why]");
      if (!btn) return;
      var card = btn.closest(".deal");
      var open = card.classList.toggle("is-open");
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }

  /* ============================================================
     SCONTI
     ============================================================ */
  var KIND_LABEL = {
    "outlet": "Outlet / fine serie",
    "ricondizionato": "Ricondizionato",
    "coupon-ufficiale": "Coupon ufficiale",
    "studenti": "Studenti / aziende",
    "usato": "Second-hand"
  };

  function renderOffers() {
    var q = state.offer.q.trim().toLowerCase();
    var list = D.offers.filter(function (o) {
      if (state.offer.kind && o.kind !== state.offer.kind) return false;
      if (q) {
        var hay = (o.merchant + " " + o.title + " " + o.description + " " + o.how + " " + o.kind).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
    $("#offers-list").innerHTML = list.length ? list.map(function (o) {
      return '' +
        '<article class="offer">' +
          '<div class="offer-top"><span class="tag">' + E.escapeHtml(KIND_LABEL[o.kind] || o.kind) + '</span><span class="deal-merchant">' + E.escapeHtml(o.merchant) + '</span></div>' +
          '<h3>' + E.escapeHtml(o.title) + '</h3>' +
          '<p>' + E.escapeHtml(o.description) + '</p>' +
          '<div class="how"><b>Come usarlo:</b> ' + E.escapeHtml(o.how) + '</div>' +
          '<p class="fine">' + E.escapeHtml(o.caveat) + '</p>' +
          '<div class="meta"><span>Pagina ufficiale del negozio</span>' +
            '<a class="btn btn-ghost btn-sm" href="' + E.escapeHtml(o.url) + '" target="_blank" rel="noopener noreferrer">Apri offerta ↗</a>' +
          '</div>' +
        '</article>';
    }).join("") : '<div class="empty-state">Nessuna promo con questi filtri. Prova a togliere il tipo di sconto.</div>';
  }

  function renderCodes() {
    var wrap = $("#codes-list");
    if (!codes.length) {
      wrap.innerHTML = '<div class="empty-state">Non hai ancora codici verificati.<br>Aggiungi qui a fianco un codice che hai usato davvero: resterà su questo dispositivo con data e percentuale di successo.</div>';
      return;
    }
    wrap.innerHTML = codes.map(function (c) {
      var total = c.works + c.fails;
      var rate = total ? Math.round((c.works / total) * 100) : null;
      var expired = c.expiry && new Date(c.expiry) < new Date(new Date().toDateString());
      return '' +
        '<article class="code-card">' +
          '<div class="code-head">' +
            '<div>' +
              '<span class="deal-cat">' + E.escapeHtml(c.merchant) + '</span>' +
              '<div class="code-value">' + E.escapeHtml(c.code) + '</div>' +
              '<div class="meta"><span>' + E.escapeHtml(c.benefit) + '</span></div>' +
            '</div>' +
            (expired ? '<span class="badge badge-warn">scaduto</span>' : rate != null && rate >= 70 ? '<span class="badge badge-good">funziona</span>' : '<span class="badge">da testare</span>') +
          '</div>' +
          '<div class="meta" style="margin-top:8px">' +
            '<span>Aggiunto il ' + new Date(c.addedAt).toLocaleDateString("it-IT") + '</span>' +
            (c.expiry ? '<span>· scade ' + new Date(c.expiry).toLocaleDateString("it-IT") + '</span>' : '') +
            (c.lastTested ? '<span>· ultimo test ' + new Date(c.lastTested).toLocaleDateString("it-IT") + '</span>' : '') +
          '</div>' +
          (rate != null ? '<div class="success-bar"><i style="width:' + rate + '%"></i></div><div class="meta" style="margin-top:5px"><span>' + rate + '% di successo su ' + total + ' test</span></div>' : '') +
          '<div class="vote">' +
            '<button data-vote="works" data-code="' + c.id + '" class="' + (c.works ? "is-ok" : "") + '">Ha funzionato (' + c.works + ')</button>' +
            '<button data-vote="fails" data-code="' + c.id + '" class="' + (c.fails ? "is-no" : "") + '">Non funziona (' + c.fails + ')</button>' +
            '<button data-copy="' + E.escapeHtml(c.code) + '">Copia</button>' +
            '<button data-del="' + c.id + '" aria-label="Elimina codice">Elimina</button>' +
          '</div>' +
        '</article>';
    }).join("");
  }

  function bindCodes() {
    $("#offer-kind").addEventListener("change", function (e) { state.offer.kind = e.target.value; renderOffers(); });
    $("#offer-search").addEventListener("input", function (e) { state.offer.q = e.target.value; renderOffers(); });

    $("#code-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var merchant = $("#code-merchant").value.trim();
      var code = $("#code-value").value.trim().toUpperCase();
      var benefit = $("#code-benefit").value.trim();
      var expiry = $("#code-expiry").value;
      var err = $("#code-error");
      if (!merchant || !code || !benefit) {
        err.textContent = "Compila negozio, codice e cosa fa lo sconto.";
        err.hidden = false;
        return;
      }
      if (codes.some(function (c) { return c.merchant.toLowerCase() === merchant.toLowerCase() && c.code === code; })) {
        err.textContent = "Questo codice è già nella tua lista.";
        err.hidden = false;
        return;
      }
      err.hidden = true;
      codes.unshift({
        id: "c" + Date.now().toString(36),
        merchant: merchant,
        code: code,
        benefit: benefit,
        expiry: expiry || "",
        addedAt: new Date().toISOString(),
        works: 0,
        fails: 0,
        lastTested: ""
      });
      save("codes", codes);
      renderCodes();
      e.target.reset();
      toast("Codice aggiunto. Provalo al checkout prima di fidarti.");
    });

    $("#codes-list").addEventListener("click", function (e) {
      var vote = e.target.closest("[data-vote]");
      var del = e.target.closest("[data-del]");
      var copy = e.target.closest("[data-copy]");
      if (vote) {
        var c = codes.filter(function (x) { return x.id === vote.getAttribute("data-code"); })[0];
        if (!c) return;
        c[vote.getAttribute("data-vote")] += 1;
        c.lastTested = new Date().toISOString();
        save("codes", codes);
        renderCodes();
        toast("Test registrato");
      }
      if (del) {
        codes = codes.filter(function (x) { return x.id !== del.getAttribute("data-del"); });
        save("codes", codes);
        renderCodes();
        toast("Codice rimosso");
      }
      if (copy) copyText(copy.getAttribute("data-copy"), "Codice copiato");
    });
  }

  /* ============================================================
     DROPSHIPPING
     ============================================================ */
  function renderProductFilters() {
    var cats = {};
    D.products.forEach(function (p) { cats[p.category] = true; });
    $("#product-category").innerHTML = '<option value="">Tutte</option>' + Object.keys(cats).sort().map(function (c) {
      return '<option value="' + E.escapeHtml(c) + '">' + E.escapeHtml(c) + '</option>';
    }).join("");
  }

  function sortedProducts() {
    var f = state.product;
    var list = D.products.filter(function (p) {
      if (f.cat && p.category !== f.cat) return false;
      if (f.competition && p.competition !== f.competition) return false;
      return true;
    });
    list.sort(function (a, b) {
      if (f.sort === "demand") return b.demand - a.demand;
      if (f.sort === "trend") return b.trend - a.trend;
      if (f.sort === "margin") return (b.marketPrice - b.supplierCost) / b.marketPrice - (a.marketPrice - a.supplierCost) / a.marketPrice;
      return E.opportunity(b).score - E.opportunity(a).score;
    });
    return list;
  }

  function renderProducts() {
    var list = sortedProducts();
    if (!list.some(function (p) { return p.id === state.selectedProduct; }) && list.length) {
      state.selectedProduct = list[0].id;
    }
    var body = $("#products-table tbody");
    body.innerHTML = list.map(function (p) {
      var o = E.opportunity(p);
      return '' +
        '<tr data-product="' + E.escapeHtml(p.id) + '" class="' + (p.id === state.selectedProduct ? "is-selected" : "") + '">' +
          '<td><b>' + E.escapeHtml(p.name) + '</b><small>' + E.escapeHtml(p.category) + ' · ' + E.escapeHtml(p.supplier) + '</small></td>' +
          '<td class="num">' + E.eur(p.supplierCost) + '</td>' +
          '<td class="num">' + E.eur(p.marketPrice) + '</td>' +
          '<td class="num">' + p.demand + '/100</td>' +
          '<td class="num ' + (p.trend >= 20 ? "pos" : "") + '">+' + p.trend + '%</td>' +
          '<td><span class="badge">' + E.escapeHtml(p.competition) + '</span></td>' +
          '<td class="num"><b class="' + (o.score >= 75 ? "pos" : "") + '">' + o.score + '</b></td>' +
        '</tr>';
    }).join("");
    renderProductDetail();
    renderListing();
  }

  function renderProductDetail() {
    var p = productById(state.selectedProduct);
    var o = E.opportunity(p);
    var tier = E.TIERS.filter(function (t) { return Math.abs(t.margin - state.margin) < 0.001; })[0];
    var cost = E.unitCost(p);
    var price = E.priceForMargin(p, state.margin);
    var econ = E.economics(p, price, 0, state.adPct);
    var el = $("#product-detail");
    el.innerHTML = '' +
      '<div class="detail-head">' +
        '<span class="tag">' + E.escapeHtml(p.category) + '</span>' +
        '<h3 style="margin-top:8px">' + E.escapeHtml(p.name) + '</h3>' +
        '<p class="fine" style="margin-top:2px">' + E.escapeHtml(p.supplier) + ' · consegna ' + E.escapeHtml(p.deliveryDays) + '</p>' +
      '</div>' +
      '<div class="kpis">' +
        '<div class="kpi"><small>Opportunità</small><b class="' + (o.score >= 75 ? "pos" : "") + '">' + o.score + '/100</b></div>' +
        '<div class="kpi"><small>Trend</small><b class="pos">+' + p.trend + '%</b></div>' +
        '<div class="kpi"><small>Costo fornitore</small><b>' + E.eur(p.supplierCost) + '</b></div>' +
        '<div class="kpi"><small>Prezzo mercato</small><b>' + E.eur(p.marketPrice) + '</b></div>' +
      '</div>' +
      '<p class="muted">' + E.escapeHtml(p.note) + '</p>' +
      '<h4 style="margin:14px 0 0;font-size:.8rem;font-family:\'Sora\',sans-serif">Margine che vuoi tenere</h4>' +
      '<div class="segmented">' +
        E.TIERS.map(function (t) {
          return '<button data-tier="' + t.id + '" class="' + (tier && tier.id === t.id ? "is-active" : "") + '">' + t.label + '<br><small style="font-size:.62rem;opacity:.75">' + Math.round(t.margin * 100) + '%</small></button>';
        }).join("") +
      '</div>' +
      '<div class="margin-slider">' +
        '<input type="range" min="15" max="65" step="1" value="' + Math.round(state.margin * 100) + '" id="margin-range" aria-label="Margine percentuale">' +
        '<output id="margin-out">' + Math.round(state.margin * 100) + '%</output>' +
      '</div>' +
      '<div class="input-mini">' +
        '<div class="field"><label for="ad-range">Costo ads (% del prezzo)</label><input id="ad-range" type="range" min="0" max="40" step="1" value="' + state.adPct + '"></div>' +
        '<div class="field"><label>Ads per unità</label><input type="text" value="' + E.eur(econ.ads) + '" readonly></div>' +
      '</div>' +
      '<div class="kpis" style="margin-top:12px">' +
        '<div class="kpi"><small>Prezzo di vendita</small><b>' + E.eur(price) + '</b></div>' +
        '<div class="kpi"><small>Profitto netto / unità</small><b class="' + (econ.profit > 0 ? "pos" : "neg") + '">' + E.eur(econ.profit) + '</b></div>' +
        '<div class="kpi"><small>Margine netto</small><b class="' + (econ.margin > 0 ? "pos" : "neg") + '">' + E.pct(econ.margin * 100, 1) + '</b></div>' +
        '<div class="kpi"><small>ROAS di pareggio</small><b>' + (econ.breakevenRoas ? econ.breakevenRoas.toFixed(2).replace(".", ",") + "×" : "—") + '</b></div>' +
      '</div>' +
      '<p class="fine">Costo pieno per unità: ' + E.eur(cost) + ' (prodotto + spedizione + imballo 0,90 €). Commissione carta stimata 2,9% + 0,30 €. ' +
        'Profitto su 100 ordini: <b>' + E.eur(econ.profit * 100) + '</b>.</p>' +
      '<button class="btn btn-primary btn-sm" style="width:100%;margin-top:12px" data-gen-listing="1">Genera il prodotto simile →</button>';
  }

  function renderListing() {
    var p = productById(state.selectedProduct);
    var listing = E.buildListing(p, state.angle, state.margin, state.adPct);
    var el = $("#listing-area");
    el.innerHTML = '' +
      '<div class="section-head section-head-tight" style="margin-bottom:12px">' +
        '<span class="eyebrow">Listing pronto</span>' +
        '<h2 style="font-size:1.5rem">' + E.escapeHtml(p.name) + ' — versione ' + E.escapeHtml(listing.angle.label) + '</h2>' +
        '<p class="lead" style="font-size:.9rem">Prodotto differenziato, non una copia: accessori, angolazione e prezzo cambiano con la variante. Prezzo calcolato sul margine del ' + Math.round(state.margin * 100) + '% + ads ' + state.adPct + '%.</p>' +
      '</div>' +
      '<div class="listing">' +
        '<div class="variant-tabs">' +
          E.ANGLES.map(function (a) {
            return '<button data-angle="' + a.id + '" class="' + (a.id === state.angle ? "is-active" : "") + '">' + a.label + '</button>';
          }).join("") +
        '</div>' +
        '<h4>' + E.escapeHtml(listing.title) + '</h4>' +
        '<p class="subtitle">' + E.escapeHtml(listing.subtitle) + '</p>' +
        '<div class="kpis">' +
          '<div class="kpi"><small>Prezzo consigliato</small><b>' + E.eur(listing.price) + '</b></div>' +
          '<div class="kpi"><small>Profitto / unità</small><b class="' + (listing.econ.profit > 0 ? "pos" : "neg") + '">' + E.eur(listing.econ.profit) + '</b></div>' +
        '</div>' +
        '<ul>' + listing.bullets.map(function (b) { return '<li>' + E.escapeHtml(b) + '</li>'; }).join("") + '</ul>' +
        '<div class="desc">' + E.escapeHtml(listing.description) + '</div>' +
        '<div class="tags">' + listing.tags.map(function (t) { return '<span>#' + E.escapeHtml(t) + '</span>'; }).join("") + '</div>' +
        '<div class="listing-actions">' +
          '<button class="btn btn-primary btn-sm" data-copy-listing="1">Copia tutto il listing</button>' +
          '<button class="btn btn-ghost btn-sm" data-copy-title="1">Copia titolo</button>' +
          '<button class="btn btn-ghost btn-sm" data-download-listing="1">Scarica JSON</button>' +
        '</div>' +
      '</div>';
  }

  function bindProducts() {
    $("#product-category").addEventListener("change", function (e) { state.product.cat = e.target.value; renderProducts(); });
    $("#product-competition").addEventListener("change", function (e) { state.product.competition = e.target.value; renderProducts(); });
    $("#product-sort").addEventListener("change", function (e) { state.product.sort = e.target.value; renderProducts(); });

    $("#products-table").addEventListener("click", function (e) {
      var row = e.target.closest("[data-product]");
      if (!row) return;
      state.selectedProduct = row.getAttribute("data-product");
      save("selectedProduct", state.selectedProduct);
      renderProducts();
      if (window.innerWidth < 1080) $("#product-detail").scrollIntoView({ behavior: "smooth", block: "start" });
    });

    $("#product-detail").addEventListener("click", function (e) {
      var tierBtn = e.target.closest("[data-tier]");
      if (tierBtn) {
        var t = E.TIERS.filter(function (x) { return x.id === tierBtn.getAttribute("data-tier"); })[0];
        if (t) {
          state.margin = t.margin;
          save("margin", state.margin);
          renderProductDetail();
          renderListing();
        }
      }
      if (e.target.closest("[data-gen-listing]")) {
        renderListing();
        $("#listing-area").scrollIntoView({ behavior: "smooth", block: "start" });
        toast("Listing generato: scegli la variante e copia");
      }
    });

    // durante il trascinamento aggiorniamo solo il valore, al rilascio ricalcoliamo
    $("#product-detail").addEventListener("input", function (e) {
      if (e.target.id === "margin-range") {
        state.margin = Number(e.target.value) / 100;
        $("#margin-out").textContent = Math.round(state.margin * 100) + "%";
      }
      if (e.target.id === "ad-range") {
        state.adPct = Number(e.target.value);
      }
    });
    $("#product-detail").addEventListener("change", function (e) {
      if (e.target.id !== "margin-range" && e.target.id !== "ad-range") return;
      save("margin", state.margin);
      save("adPct", state.adPct);
      renderProductDetail();
      renderListing();
    });

    $("#listing-area").addEventListener("click", function (e) {
      var angle = e.target.closest("[data-angle]");
      if (angle) {
        state.angle = angle.getAttribute("data-angle");
        save("angle", state.angle);
        renderListing();
        return;
      }
      var p = productById(state.selectedProduct);
      var listing = E.buildListing(p, state.angle, state.margin, state.adPct);
      if (e.target.closest("[data-copy-listing]")) {
        var text = listing.title + "\n\n" + listing.subtitle + "\n\n" + listing.bullets.map(function (b) { return "• " + b; }).join("\n") +
          "\n\n" + listing.description + "\n\n" + listing.tags.map(function (t) { return "#" + t; }).join(" ");
        copyText(text, "Listing copiato");
      }
      if (e.target.closest("[data-copy-title]")) copyText(listing.title, "Titolo copiato");
      if (e.target.closest("[data-download-listing]")) {
        var payload = {
          prodotto: p.name,
          variante: listing.angle.label,
          prezzo: listing.price,
          profitto_unitario: Number(listing.econ.profit.toFixed(2)),
          margine_netto: Number((listing.econ.margin * 100).toFixed(1)),
          titolo: listing.title,
          bullets: listing.bullets,
          descrizione: listing.description,
          tag: listing.tags,
          generato_il: new Date().toISOString()
        };
        var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "listing-" + p.id + "-" + listing.angle.id + ".json";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
        toast("JSON scaricato");
      }
    });

    // checklist pagamenti
    $$("#payment-checklist input").forEach(function (input) {
      input.checked = !!checks[input.getAttribute("data-check")];
    });
    updateChecklistNote();
    $("#payment-checklist").addEventListener("change", function (e) {
      var input = e.target.closest("input[data-check]");
      if (!input) return;
      checks[input.getAttribute("data-check")] = input.checked;
      save("checks", checks);
      updateChecklistNote();
    });
  }

  function updateChecklistNote() {
    var total = $$("#payment-checklist input").length;
    var done = $$("#payment-checklist input").filter(function (i) { return i.checked; }).length;
    var note = $("#payment-checklist").nextElementSibling;
    if (!note) return;
    if (done === total) {
      note.innerHTML = "Checklist completa: puoi collegare Stripe e fare un ordine reale di test. I pagamenti veri si attivano solo dal provider.";
    } else {
      note.innerHTML = done + "/" + total + " completati: i pagamenti reali restano spenti finché la checklist non è completa.";
    }
  }

  /* ============================================================
     MINING
     ============================================================ */
  function renderMiningControls() {
    var sel = $("#mining-coin");
    sel.innerHTML = D.coins.map(function (c) {
      return '<option value="' + c.id + '"' + (c.id === state.mining.coinId ? " selected" : "") + '>' + c.symbol + " · " + c.name + (c.asicOnly ? " (ASIC)" : "") + '</option>';
    }).join("");
    $("#hash-value").value = state.mining.hashValue;
    $("#hash-unit").value = String(state.mining.hashUnit);
    $("#power-watts").value = state.mining.watts;
    $("#power-price").value = state.mining.kwh;
    $("#demo-speed").value = String(state.mining.speed);
  }

  function renderCoinsTable() {
    var body = $("#coins-table tbody");
    body.innerHTML = D.coins.map(function (c) {
      var e = currentEcon(c);
      return '' +
        '<tr data-coin="' + c.id + '" class="' + (c.id === state.mining.coinId ? "is-selected" : "") + '">' +
          '<td><b>' + E.escapeHtml(c.symbol) + '</b><small>' + E.escapeHtml(c.name) + '</small></td>' +
          '<td><span class="badge">' + E.escapeHtml(c.algorithm) + '</span></td>' +
          '<td class="num">' + E.hashrate(c.networkHash) + '</td>' +
          '<td class="num">' + E.eurSmall(priceOf(c)) + '</td>' +
          '<td class="num">' + E.eurSmall(e.eurPerDay) + '</td>' +
          '<td class="num neg">−' + E.eur(e.powerCostDay) + '</td>' +
          '<td class="num ' + (e.netDay >= 0 ? "pos" : "neg") + '">' + E.eurSmall(e.netDay) + '</td>' +
          '<td class="num">' + E.formatDuration(e.etaDays) + '</td>' +
        '</tr>';
    }).join("");
  }

  function renderMiningAccount() {
    var coin = coinById(state.mining.coinId);
    var acc = accountOf(coin);
    var threshold = coin.minPayoutEur;
    var pctDone = Math.min(100, (acc.balance / threshold) * 100);
    var e = currentEcon(coin);
    var el = $("#mining-account");
    el.innerHTML = '' +
      '<div class="card-head"><h3>Conto temporaneo</h3><span class="demo-tag">solo demo</span></div>' +
      '<div>' +
        '<div class="balance"><small>Saldo stimato · ' + E.escapeHtml(coin.symbol) + '</small><span data-balance>' + E.eurSmall(acc.balance) + '</span></div>' +
      '</div>' +
      '<div class="progress"><i data-progress style="width:' + pctDone + '%"></i></div>' +
      '<div class="account-line"><span>Soglia payout</span><b>' + E.eur(threshold) + '</b></div>' +
      '<div class="account-line"><span>Manca</span><b data-missing>' + E.eur(Math.max(0, threshold - acc.balance)) + '</b></div>' +
      '<div class="account-line"><span>Ricavo stimato</span><b>' + E.eurSmall(e.eurPerDay) + ' / giorno</b></div>' +
      '<div class="account-line"><span>Elettricità</span><b class="neg">−' + E.eur(e.powerCostDay) + ' / giorno</b></div>' +
      '<div class="account-line"><span>Netto</span><b class="' + (e.netDay >= 0 ? "pos" : "neg") + '">' + E.eurSmall(e.netDay) + ' / giorno</b></div>' +
      '<div class="account-line"><span>Tempo al payout</span><b>' + E.formatDuration(e.etaDays) + '</b></div>' +
      '<p class="fine">Nessun euro reale: il saldo cresce al ritmo stimato dal calcolo, moltiplicato per l\'acceleratore demo. Il saldo resta salvato su questo dispositivo: puoi chiudere la pagina e ritrovarlo. Trasferiscilo su MineVault qui sotto per vedere quanto arriva davvero dopo commissioni e tasse.</p>' +
      '<button class="btn btn-primary btn-sm" data-mining="toggle">' + (state.mining.running ? "Ferma simulazione" : "Avvia simulazione") + '</button>' +
      '<button class="btn btn-ghost btn-sm" data-mining="reset">Azzera conto</button>';
  }

  function renderMiningConsole() {
    var coin = coinById(state.mining.coinId);
    var acc = accountOf(coin);
    var threshold = coin.minPayoutEur;
    var amount = Math.max(0, acc.balance - withdrawFee());
    var ready = acc.balance >= threshold;
    var e = currentEcon(coin);
    var el = $("#mining-console");
    el.innerHTML = '' +
      '<div class="console-card">' +
        '<h4>Sessione</h4>' +
        '<p>' + E.escapeHtml(coin.name) + ' · ' + E.escapeHtml(coin.algorithm) + ' · ' + E.escapeHtml(coin.hardware) + '</p>' +
        '<div class="big">' + E.hashrate(hashHs()) + '</div>' +
        '<div class="status ' + (state.mining.running ? "on" : "") + '"><i></i>' + (state.mining.running ? "simulazione attiva" : "in pausa") + '</div>' +
        '<div class="btn-row">' +
          '<button class="btn btn-primary btn-sm" data-mining="toggle">' + (state.mining.running ? "Ferma" : "Avvia") + '</button>' +
        '</div>' +
        '<p class="fine">' + e.coinsPerDay.toExponential(2).replace(".", ",") + ' ' + coin.symbol + '/giorno · quota rete ' + (e.share * 100).toExponential(2).replace(".", ",") + '%</p>' +
      '</div>' +
      '<div class="console-card">' +
        '<h4>Prelievo sul conto</h4>' +
        '<p>Richiesta minima ' + E.eur(threshold) + ' · commissione simulata ' + E.eur(withdrawFee()) + '. Trasferimento al conto reale: <b>non eseguito</b>.</p>' +
        '<div class="segmented">' +
          '<button data-withdraw-type="wallet" class="' + (state.mining.withdrawType === "wallet" ? "is-active" : "") + '">Wallet crypto</button>' +
          '<button data-withdraw-type="iban" class="' + (state.mining.withdrawType === "iban" ? "is-active" : "") + '">Bonifico IBAN</button>' +
        '</div>' +
        '<form id="withdraw-form">' +
          '<div class="field" style="margin-top:8px">' +
            '<label for="withdraw-address" id="withdraw-label">' + (state.mining.withdrawType === "wallet" ? "Indirizzo wallet " + coin.symbol : "IBAN del tuo conto") + '</label>' +
            '<input id="withdraw-address" autocomplete="off" spellcheck="false" placeholder="' + (state.mining.withdrawType === "wallet" ? "incolla l'indirizzo del wallet" : "IT00 X000 0000 0000 0000 0000 000") + '">' +
          '</div>' +
          '<p class="form-error" id="withdraw-error" hidden></p>' +
          '<button class="btn btn-primary btn-sm" type="submit" data-withdraw-btn ' + (ready ? "" : "disabled") + '>Preleva ' + E.eur(amount) + '</button>' +
        '</form>' +
        '<p class="fine">Mancano <span data-missing>' + E.eur(Math.max(0, threshold - acc.balance)) + '</span> alla soglia. Usa l\'acceleratore demo per provare il flusso.</p>' +
      '</div>' +
      '<div class="console-card">' +
        '<h4>Richieste di prelievo</h4>' +
        (requests.length ? '<div class="requests">' + requests.slice(0, 5).map(function (r) {
          return '<div class="request"><div><b>' + E.eur(r.amount) + '</b> · ' + E.escapeHtml(r.symbol) + '<br><code>' + E.escapeHtml(r.claim) + '</code></div><span class="badge badge-warn">in attesa</span></div>';
        }).join("") + '</div>' : '<div class="empty-state" style="margin-top:10px">Nessuna richiesta. Il prelievo si sblocca al raggiungimento della soglia.</div>') +
        '<p class="fine">Le richieste restano su questo dispositivo. Per un payout reale servono pool, wallet e exchange con KYC: vedi il percorso qui sotto.</p>' +
      '</div>';
  }

  function updateAccountDom() {
    var coin = coinById(state.mining.coinId);
    var acc = accountOf(coin);
    var threshold = coin.minPayoutEur;
    var pctDone = Math.min(100, (acc.balance / threshold) * 100);
    $$("[data-balance]").forEach(function (el) { el.textContent = E.eurSmall(acc.balance); });
    $$("[data-progress]").forEach(function (el) { el.style.width = pctDone + "%"; });
    $$("[data-missing]").forEach(function (el) { el.textContent = E.eur(Math.max(0, threshold - acc.balance)); });
    var btn = $("[data-withdraw-btn]");
    if (btn) {
      var amount = Math.max(0, acc.balance - withdrawFee());
      btn.disabled = acc.balance < threshold;
      btn.textContent = "Preleva " + E.eur(amount);
    }
    var toggle = $('[data-mining="toggle"]');
    if (toggle && $("#mining-account")) { /* render account handles label */ }
    var status = $("#mining-console .status");
    if (status) {
      status.classList.toggle("on", state.mining.running);
      status.innerHTML = "<i></i>" + (state.mining.running ? "simulazione attiva" : "in pausa");
    }
  }

  var miningTimer = null;
  var miningLastTick = Date.now();

  // Accredito basato sul tempo trascorso: se il browser sospende il timer
  // (scheda in background) il saldo recupera, invece di perdere secondi.
  function accrueMining() {
    var now = Date.now();
    var elapsed = Math.max(0, Math.min(3600, (now - miningLastTick) / 1000));
    miningLastTick = now;
    if (!state.mining.running || elapsed <= 0) return;
    var coin = coinById(state.mining.coinId);
    var e = currentEcon(coin);
    var acc = accountOf(coin);
    acc.balance += (e.eurPerDay / 86400) * state.mining.speed * elapsed;
    acc.seconds += elapsed;
    save("accounts", accounts);
    updateAccountDom();
    updateVaultLive();
  }

  function startMiningTimer() {
    if (miningTimer) return;
    miningTimer = setInterval(accrueMining, 1000);
    document.addEventListener("visibilitychange", function () { if (state.mining.running) accrueMining(); });
  }

  /* ============================================================
     MINEVAULT — conto bancario demo (stile Revolut)
     ============================================================ */
  function vaultTxList() {
    if (!vault.tx.length) {
      return '<div class="empty-state" style="margin-top:10px">Nessun movimento. Trasferisci il saldo del conto mining per vedere il primo accredito: resta salvato anche se chiudi la pagina.</div>';
    }
    return '<div class="vault-tx-list">' + vault.tx.slice(0, 8).map(function (t) {
      var when = new Date(t.at).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
      var detail = t.kind === "in"
        ? "da mining " + (t.symbol || "") + " · tasse " + E.eur(t.tax || 0)
        : "verso conto reale (demo)";
      return '<div class="vault-tx-item">' +
        '<div><b class="' + (t.kind === "in" ? "pos" : "neg") + '">' + (t.kind === "in" ? "+" : "−") + E.eur(t.amount) + '</b>' +
        '<small>' + E.escapeHtml(detail) + ' · ' + when + '</small></div>' +
        '<span class="badge ' + (t.kind === "in" ? "badge-good" : "badge-warn") + '">' + (t.kind === "in" ? "accredito" : "prelievo") + '</span>' +
        '</div>';
    }).join("") + '</div>';
  }

  function renderVault() {
    var coin = coinById(state.mining.coinId);
    var acc = accountOf(coin);
    var q = vaultQuote(acc.balance, coin);
    var e = currentEcon(coin);
    var monthlyNet = e.netDay * 30.44 * (1 - vault.taxRate / 100);
    var taxOptions = [
      { v: 0, label: "0% · nessuna imposta" },
      { v: 26, label: "26% · plusvalenze crypto (IT)" },
      { v: 33, label: "33% · ipotesi aliquota alta" },
      { v: 43, label: "43% · reddito da lavoro" }
    ];
    var el = $("#minevault");
    el.innerHTML = '' +
      '<div class="vault-card">' +
        '<div class="vault-head">' +
          '<span class="vault-brand">Mine<span>Vault</span></span>' +
          '<span class="demo-tag">conto demo</span>' +
        '</div>' +
        '<div class="vault-balance"><small>Saldo disponibile</small><b data-vault-balance>' + E.eur(vault.balance) + '</b></div>' +
        '<div class="vault-iban"><span>IBAN (finto)</span><code>' + E.escapeHtml(vault.iban) + '</code>' +
          '<button class="vault-copy" data-vault="copy" type="button" aria-label="Copia l&#39;IBAN demo">Copia</button>' +
        '</div>' +
        '<div class="vault-rows">' +
          '<div class="account-line"><span>Accrediti simulati</span><b>' + E.eur(vault.earned) + '</b></div>' +
          '<div class="account-line"><span>Tasse già trattenute</span><b>' + E.eur(vault.taxPaid) + '</b></div>' +
          '<div class="account-line"><span>Movimenti registrati</span><b>' + vault.tx.length + '</b></div>' +
        '</div>' +
        '<div class="vault-actions">' +
          '<button class="btn btn-ghost btn-sm" data-vault="withdraw" type="button"' + (vault.balance > 0 ? "" : " disabled") + '>Preleva sul conto reale</button>' +
          '<button class="btn btn-ghost btn-sm" data-vault="reset" type="button"' + (vault.balance > 0 || vault.tx.length ? "" : " disabled") + '>Azzera conto</button>' +
        '</div>' +
      '</div>' +
      '<div class="vault-panel">' +
        '<div class="card-head"><h3>Trasferimento mining → MineVault</h3><span class="tag">commesse e tasse incluse</span></div>' +
        '<p class="fine">Dal conto temporaneo di <b>' + E.escapeHtml(coin.name) + '</b>: commissione di rete simulata ' + E.eur(withdrawFee()) +
          ', commissione MineVault ' + vault.feePct + '% e imposta ' + vault.taxRate + '% trattenuta all\'ingresso. È esattamente ciò che succederebbe con soldi veri.</p>' +
        '<div class="math-box">' +
          '<div class="math-line"><span>Saldo mining</span><b data-vault-gross>' + E.eurSmall(q.gross) + '</b></div>' +
          '<div class="math-line"><span>Commissione di rete</span><b class="neg" data-vault-netfee>−' + E.eur(q.networkFee) + '</b></div>' +
          '<div class="math-line"><span>Commissione MineVault (' + vault.feePct + '%)</span><b class="neg" data-vault-fee>−' + E.eur(q.vaultFee) + '</b></div>' +
          '<div class="math-line"><span>Imposta ' + vault.taxRate + '%</span><b class="neg" data-vault-tax>−' + E.eur(q.tax) + '</b></div>' +
          '<div class="math-line"><span>Accredito netto</span><b class="pos" data-vault-net>' + E.eur(q.net) + '</b></div>' +
        '</div>' +
        '<button class="btn btn-primary btn-sm" data-vault="transfer" type="button" style="width:100%;margin-top:12px">Trasferisci</button>' +
        '<div class="vault-config">' +
          '<div class="field">' +
            '<label for="vault-tax">Imposta trattenuta all\'ingresso</label>' +
            '<select id="vault-tax">' + taxOptions.map(function (t) {
              return '<option value="' + t.v + '"' + (t.v === vault.taxRate ? " selected" : "") + '>' + t.label + '</option>';
            }).join("") + '</select>' +
          '</div>' +
        '</div>' +
        '<div class="vault-calc-row">' +
          '<div class="field"><label for="vault-calc">Simula un versamento (€)</label>' +
            '<input id="vault-calc" type="number" min="0" step="10" value="' + vault.calc + '"></div>' +
          '<div class="vault-calc-out"><small>Netto che arriverebbe</small><b id="vault-calc-net">—</b>' +
            '<span class="fine" id="vault-calc-note"></span></div>' +
        '</div>' +
        '<div class="math-box" style="margin-top:14px">' +
          '<div class="math-line"><span>Netto mining oggi (dopo elettricità)</span><b class="' + (e.netDay >= 0 ? "pos" : "neg") + '">' + E.eurSmall(e.netDay) + ' / giorno</b></div>' +
          '<div class="math-line"><span>Dopo imposta ' + vault.taxRate + '%</span><b class="' + (monthlyNet >= 0 ? "pos" : "neg") + '">' + E.eurSmall(monthlyNet) + ' / mese</b></div>' +
          '<div class="math-line"><span>Proiezione a 12 mesi</span><b>' + E.eurSmall(monthlyNet * 12) + '</b></div>' +
        '</div>' +
        '<h4 style="margin-top:16px">Movimenti</h4>' +
        vaultTxList() +
        '<p class="fine">Saldo e movimenti di MineVault restano in localStorage su questo dispositivo: sopravvivono alla chiusura della pagina, non a un\'eliminazione dei dati del browser. Nessun conto reale, nessun IBAN valido, nessun euro.</p>' +
      '</div>';
    updateVaultLive();
    renderVaultCalc();
  }

  function updateVaultLive() {
    var coin = coinById(state.mining.coinId);
    var acc = accountOf(coin);
    var q = vaultQuote(acc.balance, coin);
    var set = function (sel, text) {
      var node = $(sel);
      if (node) node.textContent = text;
    };
    set("[data-vault-gross]", E.eurSmall(q.gross));
    set("[data-vault-netfee]", "−" + E.eur(q.networkFee));
    set("[data-vault-fee]", "−" + E.eur(q.vaultFee));
    set("[data-vault-tax]", "−" + E.eur(q.tax));
    set("[data-vault-net]", E.eur(q.net));
    var btn = $('[data-vault="transfer"]');
    if (btn) {
      var enough = acc.balance >= coin.minPayoutEur;
      btn.disabled = !enough;
      btn.textContent = enough
        ? "Trasferisci " + E.eur(q.gross) + " → MineVault"
        : "Mancano " + E.eur(Math.max(0, coin.minPayoutEur - acc.balance)) + " alla soglia di " + E.eur(coin.minPayoutEur);
    }
  }

  function renderVaultCalc() {
    var input = $("#vault-calc");
    var amount = input ? Number(input.value) : vault.calc;
    var q = vaultQuote(amount, coinById(state.mining.coinId));
    var net = $("#vault-calc-net");
    var note = $("#vault-calc-note");
    if (net) net.textContent = E.eur(q.net);
    if (note) {
      note.textContent = amount > 0
        ? "Su " + E.eur(amount) + " lordi: commissioni " + E.eur(q.networkFee + q.vaultFee) + " + imposta " + E.eur(q.tax) + "."
        : "Inserisci un importo per vedere il netto.";
    }
  }

  function doVaultTransfer() {
    var coin = coinById(state.mining.coinId);
    var acc = accountOf(coin);
    if (acc.balance < coin.minPayoutEur) {
      toast("Servono almeno " + E.eur(coin.minPayoutEur) + " sul conto mining");
      return;
    }
    var q = vaultQuote(acc.balance, coin);
    vault.balance = round2(vault.balance + q.net);
    vault.earned = round2(vault.earned + q.net);
    vault.taxPaid = round2(vault.taxPaid + q.tax);
    vault.tx.unshift({
      id: "v" + Date.now().toString(36),
      kind: "in",
      amount: round2(q.net),
      gross: round2(q.gross),
      fee: round2(q.networkFee + q.vaultFee),
      tax: round2(q.tax),
      symbol: coin.symbol,
      coin: coin.id,
      at: new Date().toISOString()
    });
    if (vault.tx.length > 40) vault.tx.length = 40;
    acc.balance = 0;
    acc.seconds = 0;
    save("accounts", accounts);
    save("vault", vault);
    renderVault();
    renderMiningAccount();
    renderMiningConsole();
    updateAccountDom();
    toast("Accreditati " + E.eur(q.net) + " su MineVault · demo, nessun euro reale");
  }

  function doVaultWithdraw() {
    if (vault.balance <= 0) return;
    var amount = round2(vault.balance);
    var fee = round2(amount * 0.005);
    vault.tx.unshift({
      id: "v" + Date.now().toString(36),
      kind: "out",
      amount: round2(amount - fee),
      gross: amount,
      fee: fee,
      tax: 0,
      at: new Date().toISOString()
    });
    if (vault.tx.length > 40) vault.tx.length = 40;
    vault.balance = 0;
    save("vault", vault);
    renderVault();
    toast("Prelievo demo di " + E.eur(amount - fee) + " verso il conto reale · non eseguito");
  }

  function doVaultReset() {
    vault = { iban: vault.iban, balance: 0, earned: 0, taxPaid: 0, taxRate: vault.taxRate, feePct: vault.feePct, calc: vault.calc, tx: [] };
    save("vault", vault);
    renderVault();
    toast("MineVault azzerato");
  }

  function bindVault() {
    var el = $("#minevault");
    el.addEventListener("click", function (e) {
      var action = e.target.closest("[data-vault]");
      if (!action) return;
      var what = action.getAttribute("data-vault");
      if (what === "transfer") doVaultTransfer();
      if (what === "withdraw") doVaultWithdraw();
      if (what === "reset") doVaultReset();
      if (what === "copy") copyText(vault.iban, "IBAN demo copiato");
    });
    el.addEventListener("change", function (e) {
      if (e.target.id !== "vault-tax") return;
      vault.taxRate = Number(e.target.value) || 0;
      save("vault", vault);
      renderVault();
      toast("Imposta impostata al " + vault.taxRate + "%");
    });
    el.addEventListener("input", function (e) {
      if (e.target.id !== "vault-calc") return;
      vault.calc = Number(e.target.value) || 0;
      save("vault", vault);
      renderVaultCalc();
    });
  }

  function renderMathBox() {
    var coin = coinById("monero");
    var hash = 5000; // 5 kH/s: un CPU consumer
    var e = E.coinEconomics(coin, hash, priceOf(coin), 65, 0.28);
    var el = $("#math-box");
    el.innerHTML = '' +
      '<div class="math-line"><span>Hashrate</span><b>' + E.hashrate(hash) + ' (un CPU)</b></div>' +
      '<div class="math-line"><span>Ricavo / giorno</span><b>' + E.eurSmall(e.eurPerDay) + '</b></div>' +
      '<div class="math-line"><span>Elettricità / giorno</span><b class="neg">−' + E.eur(e.powerCostDay) + '</b></div>' +
      '<div class="math-line"><span>Netto / mese</span><b class="' + (e.netMonth >= 0 ? "pos" : "neg") + '">' + E.eur(e.netMonth) + '</b></div>' +
      '<div class="math-line"><span>Tempo al payout (' + E.eur(coin.minPayoutEur) + ')</span><b>' + E.formatDuration(e.etaDays) + '</b></div>' +
      '<div class="math-line"><span>Hardware per sperare in un utile</span><b>ASIC o rig dedicato</b></div>';
  }

  function refreshPrices() {
    var ids = {
      bitcoin: "bitcoin",
      monero: "monero",
      litecoin: "litecoin",
      dogecoin: "dogecoin",
      "ethereum-classic": "ethereum-classic",
      kaspa: "kaspa",
      ravencoin: "ravencoin",
      zcash: "zcash",
      "ethereum-pow": "ethereum-pow-iou",
      firo: "firo"
    };
    var url = "https://api.coingecko.com/api/v3/simple/price?ids=" + Object.keys(ids).map(function (k) { return ids[k]; }).join(",") + "&vs_currencies=eur";
    var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timeout = setTimeout(function () { if (controller) controller.abort(); }, 9000);
    $("#price-source").textContent = "aggiornamento in corso…";
    fetch(url, controller ? { signal: controller.signal } : {})
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (data) {
        clearTimeout(timeout);
        var updated = 0;
        Object.keys(ids).forEach(function (coinId) {
          var payload = data[ids[coinId]];
          if (payload && typeof payload.eur === "number") {
            state.mining.prices[coinId] = payload.eur;
            updated += 1;
          }
        });
        if (!updated) throw new Error("nessun prezzo");
        save("prices", { ts: Date.now(), map: state.mining.prices });
        $("#price-source").textContent = "prezzi live CoinGecko · " + new Date().toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
        renderCoinsTable();
        renderMiningAccount();
        renderMiningConsole();
        renderMathBox();
        toast("Prezzi aggiornati");
      })
      .catch(function (err) {
        clearTimeout(timeout);
        $("#price-source").textContent = "prezzi statici (aggiornamento non riuscito: " + (err && err.name === "AbortError" ? "timeout" : "rete o limite API") + ")";
        toast("Prezzi non aggiornati: uso i valori statici");
      });
  }

  function measureBrowser() {
    var src = "self.onmessage=function(){var buf=new Uint8Array(80);var t0=performance.now();var n=0;var end=t0+1500;function step(){if(performance.now()<end){crypto.subtle.digest('SHA-256',buf).then(function(){n++;step();});}else{var sec=(performance.now()-t0)/1000;self.postMessage(n/sec);}}step();};";
    var btn = $("#measure-btn");
    btn.disabled = true;
    btn.textContent = "Misura in corso…";
    var url, worker;
    var finish = function (rate) {
      btn.disabled = false;
      btn.textContent = "Misura questo browser";
      if (!rate) {
        toast("Misura non disponibile in questo browser");
        return;
      }
      var unit = 1;
      if (rate >= 1e6) unit = 1e6; else if (rate >= 1e3) unit = 1e3;
      state.mining.hashValue = Number((rate / unit).toFixed(2));
      state.mining.hashUnit = unit;
      save("mining", state.mining);
      renderMiningControls();
      renderCoinsTable();
      renderMiningAccount();
      renderMiningConsole();
      renderMathBox();
      $("#hash-source").textContent = "misurato ora";
      toast("Hashrate misurato: " + E.hashrate(rate));
      if (worker) worker.terminate();
      if (url) URL.revokeObjectURL(url);
    };
    try {
      var blob = new Blob([src], { type: "application/javascript" });
      url = URL.createObjectURL(blob);
      worker = new Worker(url);
      var done = false;
      worker.onmessage = function (e) { done = true; finish(Number(e.data)); };
      worker.onerror = function () { if (!done) finish(null); };
      worker.postMessage("start");
      setTimeout(function () { if (!done) finish(null); }, 7000);
    } catch (err) {
      finish(null);
    }
  }

  function bindMining() {
    var m = state.mining;
    $("#hash-value").addEventListener("input", function (e) {
      m.hashValue = Number(e.target.value) || 0;
      save("mining", m);
      renderCoinsTable(); renderMiningAccount(); renderMiningConsole(); renderMathBox(); renderVault();
    });
    $("#hash-unit").addEventListener("change", function (e) {
      m.hashUnit = Number(e.target.value) || 1;
      save("mining", m);
      renderCoinsTable(); renderMiningAccount(); renderMiningConsole(); renderMathBox(); renderVault();
    });
    $("#power-watts").addEventListener("input", function (e) {
      m.watts = Number(e.target.value) || 0;
      save("mining", m);
      renderCoinsTable(); renderMiningAccount(); renderMiningConsole(); renderMathBox(); renderVault();
    });
    $("#power-price").addEventListener("input", function (e) {
      m.kwh = Number(e.target.value) || 0;
      save("mining", m);
      renderCoinsTable(); renderMiningAccount(); renderMiningConsole(); renderMathBox(); renderVault();
    });
    $("#demo-speed").addEventListener("change", function (e) {
      m.speed = Number(e.target.value) || 1;
      save("mining", m);
      renderMiningConsole();
    });
    $("#mining-coin").addEventListener("change", function (e) {
      m.coinId = e.target.value;
      miningLastTick = Date.now();
      save("mining", m);
      renderCoinsTable(); renderMiningAccount(); renderMiningConsole(); renderVault();
    });
    $("#coins-table").addEventListener("click", function (e) {
      var row = e.target.closest("[data-coin]");
      if (!row) return;
      m.coinId = row.getAttribute("data-coin");
      save("mining", m);
      $("#mining-coin").value = m.coinId;
      renderCoinsTable(); renderMiningAccount(); renderMiningConsole(); renderVault();
      $("#mining-account").scrollIntoView({ behavior: "smooth", block: "center" });
    });
    $("#mining-account").addEventListener("click", function (e) {
      var action = e.target.closest("[data-mining]");
      if (!action) return;
      handleMiningAction(action.getAttribute("data-mining"));
    });
    $("#mining-console").addEventListener("click", function (e) {
      var action = e.target.closest("[data-mining]");
      if (action) { handleMiningAction(action.getAttribute("data-mining")); return; }
      var type = e.target.closest("[data-withdraw-type]");
      if (type) {
        m.withdrawType = type.getAttribute("data-withdraw-type");
        renderMiningConsole();
        updateAccountDom();
      }
    });
    $("#mining-console").addEventListener("submit", function (e) {
      if (e.target.id !== "withdraw-form") return;
      e.preventDefault();
      var coin = coinById(m.coinId);
      var acc = accountOf(coin);
      var address = $("#withdraw-address").value.trim();
      var err = $("#withdraw-error");
      var valid = m.withdrawType === "wallet" ? E.validateWallet(address) : E.validateIban(address);
      if (!valid.ok) {
        err.textContent = valid.message;
        err.hidden = false;
        return;
      }
      if (acc.balance < coin.minPayoutEur) {
        err.textContent = "Saldo sotto la soglia di " + E.eur(coin.minPayoutEur) + ".";
        err.hidden = false;
        return;
      }
      err.hidden = true;
      var amount = Math.max(0, acc.balance - withdrawFee());
      var claim = "RR-" + Math.random().toString(36).slice(2, 6).toUpperCase() + "-" + Math.random().toString(36).slice(2, 6).toUpperCase();
      var masked = address.length > 10 ? address.slice(0, 4) + "…" + address.slice(-4) : "…";
      requests.unshift({
        id: "r" + Date.now().toString(36),
        claim: claim,
        coin: coin.id,
        symbol: coin.symbol,
        amount: Number(amount.toFixed(2)),
        type: m.withdrawType,
        destination: masked,
        createdAt: new Date().toISOString(),
        status: "demo-pending"
      });
      acc.balance = 0;
      acc.seconds = 0;
      save("requests", requests);
      save("accounts", accounts);
      renderMiningAccount();
      renderMiningConsole();
      updateAccountDom();
      toast("Richiesta demo " + claim + " creata · nessun euro reale inviato");
    });
    $("#measure-btn").addEventListener("click", measureBrowser);
    $("#refresh-prices").addEventListener("click", refreshPrices);
    startMiningTimer();
  }

  function handleMiningAction(action) {
    var m = state.mining;
    var coin = coinById(m.coinId);
    if (action === "toggle") {
      m.running = !m.running;
      miningLastTick = Date.now();
      save("mining", m);
      renderMiningAccount();
      renderMiningConsole();
      updateAccountDom();
      toast(m.running ? "Simulazione avviata · saldo demo in crescita" : "Simulazione in pausa");
    }
    if (action === "reset") {
      var acc = accountOf(coin);
      acc.balance = 0;
      acc.seconds = 0;
      save("accounts", accounts);
      renderMiningAccount();
      renderMiningConsole();
      updateAccountDom();
      toast("Conto demo azzerato");
    }
  }

  /* ============================================================
     IDEE
     ============================================================ */
  function renderIdeaFilters() {
    var cats = {};
    D.ideas.forEach(function (i) { cats[i.category] = true; });
    $("#idea-category").innerHTML = '<option value="">Tutte</option>' + Object.keys(cats).sort(function (a, b) { return a.localeCompare(b, "it"); }).map(function (c) {
      return '<option value="' + E.escapeHtml(c) + '">' + E.escapeHtml(c) + '</option>';
    }).join("");
  }

  function renderIdeas() {
    var f = state.idea;
    var list = D.ideas.filter(function (i) {
      if (f.capital && i.capital !== f.capital) return false;
      if (f.effort && i.effort !== f.effort) return false;
      if (f.category && i.category !== f.category) return false;
      return true;
    });
    $("#ideas-grid").innerHTML = list.map(function (i) {
      return '' +
        '<article class="idea">' +
          '<div class="idea-top"><span class="tag">' + E.escapeHtml(i.category) + '</span><span class="risk risk-' + E.escapeHtml(i.risk) + '">rischio ' + i.risk.toLowerCase() + '</span></div>' +
          '<h3>' + E.escapeHtml(i.title) + '</h3>' +
          '<p>' + E.escapeHtml(i.description) + '</p>' +
          '<div class="idea-metrics">' +
            '<div>Capitale<b>' + E.escapeHtml(i.capitalLabel) + '</b></div>' +
            '<div>Primo incasso<b>' + E.escapeHtml(i.timeToFirst) + '</b></div>' +
            '<div>Potenziale<b>' + E.escapeHtml(i.potential) + '</b></div>' +
            '<div>Impegno<b>' + E.escapeHtml(i.effort) + '</b></div>' +
          '</div>' +
          '<div class="first"><b>Primo passo:</b> ' + E.escapeHtml(i.firstStep) + '</div>' +
          '<a class="link" href="' + E.escapeHtml(i.url) + '" target="_blank" rel="noopener noreferrer">' + E.escapeHtml(i.urlLabel) + ' →</a>' +
        '</article>';
    }).join("") || '<div class="empty-state">Nessuna idea con questi filtri.</div>';
  }

  function bindIdeas() {
    $("#idea-capital").addEventListener("change", function (e) { state.idea.capital = e.target.value; renderIdeas(); });
    $("#idea-effort").addEventListener("change", function (e) { state.idea.effort = e.target.value; renderIdeas(); });
    $("#idea-category").addEventListener("change", function (e) { state.idea.category = e.target.value; renderIdeas(); });
  }

  /* ============================================================
     INIT
     ============================================================ */
  function init() {
    $("#year").textContent = new Date().getFullYear();

    // prezzi salvati (max 12 ore)
    var savedPrices = load("prices", null);
    if (savedPrices && savedPrices.ts && Date.now() - savedPrices.ts < 12 * 3600 * 1000) {
      state.mining.prices = savedPrices.map || {};
      $("#price-source").textContent = "prezzi CoinGecko salvati · " + new Date(savedPrices.ts).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    }

    renderHeroStats();
    renderDealFilters();
    bindDeals();
    renderDeals();
    renderOffers();
    bindCodes();
    renderCodes();
    renderProductFilters();
    bindProducts();
    renderProducts();
    renderMiningControls();
    bindMining();
    bindVault();
    renderCoinsTable();
    renderMiningAccount();
    renderMiningConsole();
    renderVault();
    renderMathBox();
    renderIdeaFilters();
    bindIdeas();
    renderIdeas();

    $$(".tab").forEach(function (tab) {
      tab.addEventListener("click", function () { setTab(tab.getAttribute("data-tab")); });
    });
    $$("[data-tab-link]").forEach(function (el) {
      el.addEventListener("click", function (e) {
        e.preventDefault();
        setTab(el.getAttribute("data-tab-link"));
      });
    });
    $$("[data-jump]").forEach(function (el) {
      el.addEventListener("click", function () {
        var target = document.getElementById(el.getAttribute("data-jump"));
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });

    var initial = (location.hash || "").replace("#", "");
    setTab(initial || "offerte", false);
    if (state.mining.running) state.mining.running = false;
    window.addEventListener("beforeunload", function () { save("accounts", accounts); save("vault", vault); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
