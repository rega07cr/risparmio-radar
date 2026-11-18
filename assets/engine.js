/* ============================================================
   Risparmio Radar — motore di calcolo
   Tutte funzioni pure: punteggi, margini, listing, mining.
   ============================================================ */
(function () {
  "use strict";

  var clamp = function (v, min, max) { return Math.min(max, Math.max(min, v)); };
  var round = function (v, d) { var p = Math.pow(10, d == null ? 2 : d); return Math.round(v * p) / p; };

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  var eurFmt = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });
  var eurFmt0 = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
  var numFmt = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 });

  function eur(v) { return eurFmt.format(v || 0); }
  function eur0(v) { return eurFmt0.format(v || 0); }
  function pct(v, d) { return numFmt.format(round(v, d == null ? 0 : d)) + "%"; }
  function num(v, d) { return new Intl.NumberFormat("it-IT", { maximumFractionDigits: d == null ? 2 : d }).format(v || 0); }

  function eurSmall(v) {
    if (v == null || !isFinite(v)) return "—";
    var abs = Math.abs(v);
    if (abs === 0) return "0,00 €";
    if (abs < 0.000001) return v.toExponential(2).replace(".", ",") + " €";
    if (abs < 0.01) return num(v, 8) + " €";
    if (abs < 1) return num(v, 4) + " €";
    return eur(v);
  }

  var HASH_UNITS = [
    { label: "H/s", value: 1 },
    { label: "kH/s", value: 1e3 },
    { label: "MH/s", value: 1e6 },
    { label: "GH/s", value: 1e9 },
    { label: "TH/s", value: 1e12 },
    { label: "PH/s", value: 1e15 },
    { label: "EH/s", value: 1e18 }
  ];

  function hashrate(v) {
    if (!v || !isFinite(v)) return "0 H/s";
    var i = 0;
    while (i < HASH_UNITS.length - 1 && v >= HASH_UNITS[i + 1].value) i++;
    return num(v / HASH_UNITS[i].value, 2) + " " + HASH_UNITS[i].label;
  }

  function formatDuration(days) {
    if (!isFinite(days) || days <= 0) return "mai a questo hashrate";
    if (days < 1) return "< 1 giorno";
    if (days < 60) return Math.ceil(days) + " giorni";
    if (days < 730) return num(days / 30.44, 1) + " mesi";
    if (days < 36500) return num(days / 365.25, 1) + " anni";
    return "oltre 100 anni";
  }

  /* ---------------- OFFERTE ---------------- */
  function dealScore(deal) {
    var realDiscount = (deal.avg90 - deal.price) / deal.avg90;
    var listDiscount = (deal.listPrice - deal.price) / deal.listPrice;
    var pricePos = clamp((deal.price - deal.min90) / Math.max(deal.listPrice - deal.min90, 1), 0, 1);

    var parts = [
      { key: "discount", label: "Sconto reale", points: round(clamp(realDiscount / 0.3, 0, 1) * 46, 1), max: 46 },
      { key: "rating", label: "Recensioni", points: round(clamp((deal.rating - 3) / 2, 0, 1) * 16, 1), max: 16 },
      { key: "volume", label: "Volume recensioni", points: round(clamp(Math.log10(Math.max(deal.reviews, 1)) / 5, 0, 1) * 14, 1), max: 14 },
      { key: "trust", label: "Venditore e spedizione", points: (deal.shipping === 0 ? 8 : 4) + (deal.merchant === "Amazon" ? 4 : 3), max: 12 },
      { key: "position", label: "Vicinanza al minimo", points: round((1 - pricePos) * 12, 1), max: 12 }
    ];

    var total = Math.round(parts.reduce(function (s, p) { return s + p.points; }, 0));
    var inflated = deal.listPrice > deal.avg90 * 1.22 && listDiscount > 0.3;

    return {
      total: total,
      parts: parts,
      realDiscount: realDiscount,
      listDiscount: listDiscount,
      pricePos: pricePos,
      inflated: inflated,
      verdict: total >= 80 ? "Affare vero" : total >= 70 ? "Buon prezzo" : total >= 55 ? "Nella media" : "Aspetta",
      verdictNote: total >= 80
        ? "Prezzo vicino al minimo e sconto reale solido: è il momento giusto."
        : total >= 70
          ? "Sconto reale sopra la media: buono se ti serve ora."
          : total >= 55
            ? "Prezzo nella norma: non è un errore comprare, ma non è un affare."
            : "Meglio impostare un alert e aspettare un calo reale."
    };
  }

  function searchUrl(deal) {
    var q = encodeURIComponent(deal.name);
    if (deal.merchant === "Amazon") return "https://www.amazon.it/s?k=" + q;
    if (deal.merchant === "eBay") return "https://www.ebay.it/sch/i.html?_nkw=" + q;
    return "https://www.google.com/search?tbm=shop&q=" + encodeURIComponent(deal.name + " " + deal.merchant);
  }

  /* ---------------- DROPSHIPPING ---------------- */
  var COMPETITION_SCORE = { Bassa: 100, Media: 62, Alta: 28 };

  function opportunity(p) {
    var grossPotential = (p.marketPrice - p.supplierCost - p.shippingCost) / p.marketPrice;
    var trendScore = clamp(50 + p.trend * 0.9, 0, 100);
    var score = Math.round(
      clamp(p.demand, 0, 100) * 0.42 +
      clamp((COMPETITION_SCORE[p.competition] || 50), 0, 100) * 0.24 +
      trendScore * 0.19 +
      clamp(grossPotential * 100, 0, 100) * 0.15
    );
    return {
      score: score,
      grossPotential: grossPotential,
      trendScore: trendScore,
      competitionScore: COMPETITION_SCORE[p.competition] || 50,
      verdict: score >= 78 ? "Testa subito" : score >= 65 ? "Buona candidata" : score >= 52 ? "Solo con angolazione forte" : "Lasciar perdere"
    };
  }

  var TIERS = [
    { id: "prudente", label: "Prudente", margin: 0.25, hint: "Più volume, meno rischio ads" },
    { id: "intermedio", label: "Intermedio", margin: 0.4, hint: "Equilibrio margine/competitività" },
    { id: "alto", label: "Alto", margin: 0.55, hint: "Serve branding o nicchia forte" }
  ];

  function unitCost(p, addonCost) {
    return (p.supplierCost || 0) + (p.shippingCost || 0) + 0.9 + (addonCost || 0);
  }

  function priceForMargin(p, margin, addonCost) {
    var cost = unitCost(p, addonCost);
    var raw = cost / (1 - clamp(margin, 0.05, 0.8));
    return Math.max(4.9, Math.round(raw) - 0.1);
  }

  function economics(p, price, addonCost, adPct) {
    var cost = unitCost(p, addonCost);
    var fee = price * 0.029 + 0.30;
    var ads = price * (adPct == null ? 15 : adPct) / 100;
    var profitBeforeAds = price - cost - fee;
    var profit = profitBeforeAds - ads;
    var breakevenRoas = profitBeforeAds > 0 ? price / profitBeforeAds : 0;
    return {
      cost: cost,
      fee: fee,
      ads: ads,
      profitBeforeAds: profitBeforeAds,
      profit: profit,
      marginBeforeAds: profitBeforeAds / price,
      margin: profit / price,
      breakevenRoas: breakevenRoas
    };
  }

  var ANGLES = [
    {
      id: "premium",
      label: "Premium",
      addonCost: 1.4,
      addons: ["confezione regalo premium", "guida rapida in italiano"],
      angle: "materiali curati, presentazione da regalo e assistenza in italiano",
      priceBias: 0.06
    },
    {
      id: "bundle",
      label: "Bundle",
      addonCost: 3.1,
      addons: ["accessorio complementare", "custodia da viaggio", "2 anni di garanzia estesa"],
      angle: "tutto quello che serve in una confezione, senza acquisti separati",
      priceBias: 0.12
    },
    {
      id: "minimal",
      label: "Essenziale",
      addonCost: 0,
      addons: ["imballo minimal riciclabile"],
      angle: "solo il prodotto, prezzo più aggressivo e spedizione rapida",
      priceBias: -0.05
    },
    {
      id: "eco",
      label: "Eco",
      addonCost: 1.1,
      addons: ["packaging plastic-free", "albero piantato per ordine (partner verificato)"],
      angle: "packaging plastic-free e filiera trasparente",
      priceBias: 0.03
    }
  ];

  function buildListing(p, angleId, margin, adPct) {
    var angle = ANGLES.filter(function (a) { return a.id === angleId; })[0] || ANGLES[0];
    var basePrice = priceForMargin(p, margin + angle.priceBias, angle.addonCost);
    var eco = economics(p, basePrice, angle.addonCost, adPct);
    var featureBullets = p.features.map(function (f) { return f.charAt(0).toUpperCase() + f.slice(1) + "."; });

    var bullets = [
      angle.angle.charAt(0).toUpperCase() + angle.angle.slice(1) + ".",
      "Pensato per " + p.audience.toLowerCase() + ".",
      featureBullets[0] || "Design compatto e facile da usare.",
      featureBullets[1] || "Materiali durevoli, uso quotidiano.",
      "Reso 30 giorni e assistenza via email: acquisto senza pensieri."
    ];

    var title = p.name + " — " + angle.label + " | " + p.features.slice(0, 2).join(" · ");
    var description = [
      p.name + " in versione " + angle.label.toLowerCase() + ": " + angle.angle + ".",
      "Ideale per " + p.audience.toLowerCase() + ". Consegna stimata in " + p.deliveryDays + ", tracciata, con imballo protettivo.",
      "Include: " + angle.addons.join(", ") + ".",
      "Perché sceglierlo: " + p.features.join(", ") + ".",
      "reso entro 30 giorni, pagamento sicuro con carta, supporto in italiano."
    ].join("\n\n");

    var tags = (p.category + " " + p.name + " " + p.audience).toLowerCase()
      .replace(/[^a-z0-9àèéìòù\s]/gi, " ")
      .split(/\s+/).filter(function (w) { return w.length > 3; })
      .slice(0, 10);

    return {
      angle: angle,
      title: title,
      subtitle: p.marketPrice > 60 ? "Spedizione gratuita sopra i 49 € · reso 30 giorni" : "Spedizione tracciata · reso 30 giorni",
      bullets: bullets,
      description: description,
      tags: tags,
      price: basePrice,
      econ: eco,
      listings: angle.addons
    };
  }

  /* ---------------- MINING ---------------- */
  function coinRevenue(coin, hashrateHs, priceEur, poolFeePct) {
    var price = priceEur == null ? coin.priceEur : priceEur;
    var feePct = poolFeePct == null ? 1 : poolFeePct;
    var share = hashrateHs / coin.networkHash;
    var blocksPerDay = 86400 / coin.blockTime;
    var coinsPerDay = share * blocksPerDay * coin.blockReward * (1 - feePct / 100);
    return { coinsPerDay: coinsPerDay, eurPerDay: coinsPerDay * price, share: share };
  }

  function coinEconomics(coin, hashrateHs, priceEur, watts, kwhPrice) {
    var rev = coinRevenue(coin, hashrateHs, priceEur, 1);
    var powerCostDay = (watts / 1000) * 24 * kwhPrice;
    var net = rev.eurPerDay - powerCostDay;
    var etaDays = rev.eurPerDay > 0 ? coin.minPayoutEur / rev.eurPerDay : Infinity;
    return {
      coinsPerDay: rev.coinsPerDay,
      eurPerDay: rev.eurPerDay,
      eurPerMonth: rev.eurPerDay * 30.44,
      powerCostDay: powerCostDay,
      powerCostMonth: powerCostDay * 30.44,
      netDay: net,
      netMonth: net * 30.44,
      etaDays: etaDays,
      share: rev.share
    };
  }

  function validateWallet(value) {
    var v = String(value || "").trim();
    if (v.length < 20) return { ok: false, message: "Indirizzo troppo corto: controlla di aver copiato tutto." };
    if (!/^[a-zA-Z0-9:_\-]+$/.test(v)) return { ok: false, message: "L'indirizzo contiene caratteri non validi." };
    return { ok: true, message: "" };
  }

  function validateIban(value) {
    var v = String(value || "").replace(/\s+/g, "").toUpperCase();
    if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$/.test(v)) return { ok: false, message: "IBAN non valido: controlla paese, cifre di controllo e lunghezza." };
    return { ok: true, message: "" };
  }

  window.RadarEngine = {
    clamp: clamp,
    round: round,
    escapeHtml: escapeHtml,
    eur: eur,
    eur0: eur0,
    eurSmall: eurSmall,
    pct: pct,
    num: num,
    hashrate: hashrate,
    formatDuration: formatDuration,
    dealScore: dealScore,
    searchUrl: searchUrl,
    opportunity: opportunity,
    TIERS: TIERS,
    ANGLES: ANGLES,
    unitCost: unitCost,
    priceForMargin: priceForMargin,
    economics: economics,
    buildListing: buildListing,
    coinRevenue: coinRevenue,
    coinEconomics: coinEconomics,
    validateWallet: validateWallet,
    validateIban: validateIban
  };
})();
