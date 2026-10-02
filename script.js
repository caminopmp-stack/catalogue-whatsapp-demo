// Identifiant du Google Sheet qui sert de catalogue (voir onglets "Produits", "Config" et "Livraison")
const SHEET_ID = "1O0m5L2eWOTgnipKEsZrNmRFMumukyvAT1PEZyOs9YqU";

// Rempli par fetchCatalog() au chargement, à partir du Sheet
let SHOP = { nom_boutique: "", tagline: "", whatsapp: "", instagram: "" };
let PRODUCTS = [];
let CATS = ["Tous"];
let DELIVERY = {}; // numéro de wilaya -> { bureau: prix ou null, domicile: prix ou null }

const DELIVERY_MODES = { bureau: "Bureau (stop desk)", domicile: "À domicile" };

// Interroge un onglet du Sheet via l'endpoint public de Google (gviz) et renvoie
// ses lignes sous forme de tableau d'objets, un objet par ligne, clé = en-tête de colonne.
// Google n'autorise pas la lecture de cette réponse via fetch() depuis un autre site
// (règle de sécurité CORS du navigateur), on utilise donc la technique JSONP : on charge
// la réponse comme un script, et on demande à Google d'appeler directement notre fonction
// avec les données, plutôt que de essayer de lire le contenu nous-mêmes.
let jsonpCounter = 0;
function fetchSheetRows(sheetName) {
  return new Promise((resolve, reject) => {
    const callbackName = "sheetCallback_" + (jsonpCounter++);
    const url = "https://docs.google.com/spreadsheets/d/" + SHEET_ID +
      "/gviz/tq?tqx=out:json;responseHandler:" + callbackName +
      "&sheet=" + encodeURIComponent(sheetName) + "&headers=1";

    const script = document.createElement("script");

    window[callbackName] = function (json) {
      delete window[callbackName];
      script.remove();
      const labels = json.table.cols.map(c => c.label);
      resolve(json.table.rows.map(row => {
        const obj = {};
        labels.forEach((label, i) => {
          const cell = row.c[i];
          obj[label] = cell ? cell.v : "";
        });
        return obj;
      }));
    };

    script.src = url;
    script.onerror = () => {
      delete window[callbackName];
      script.remove();
      reject(new Error("Échec du chargement de l'onglet " + sheetName));
    };
    document.body.appendChild(script);
  });
}

function rowsToProducts(rows) {
  return rows.map(r => {
    const product = { id: r.id, name: r.nom, cat: r.categorie, price: Number(r.prix) || 0, photoUrl: r.photo_url || "" };
    if (r.variantes) {
      product.variants = String(r.variantes).split(",").map(v => v.trim()).filter(Boolean);
    }
    if (String(r.rupture).trim().toLowerCase() === "oui") {
      product.out = true;
    }
    return product;
  });
}

function rowsToShop(rows) {
  const obj = {};
  rows.forEach(r => { obj[r.parametre] = r.valeur; });
  return obj;
}

// Une case vide dans le Sheet = ce mode de livraison n'est pas proposé pour cette wilaya
function rowsToDelivery(rows) {
  const price = v => (v === "" || v === null || isNaN(Number(v))) ? null : Number(v);
  const obj = {};
  rows.forEach(r => {
    const num = parseInt(r.num, 10);
    if (num) obj[num] = { bureau: price(r.prix_bureau), domicile: price(r.prix_domicile) };
  });
  return obj;
}

async function fetchCatalog() {
  const [productRows, configRows, deliveryRows] = await Promise.all([
    fetchSheetRows("Produits"),
    fetchSheetRows("Config"),
    // Onglet facultatif : sans lui, le site marche quand même, tarifs "à confirmer"
    fetchSheetRows("Livraison").catch(() => [])
  ]);
  PRODUCTS = rowsToProducts(productRows);
  SHOP = rowsToShop(configRows);
  DELIVERY = rowsToDelivery(deliveryRows);
  CATS = ["Tous", ...new Set(PRODUCTS.map(p => p.cat))];
}

const WILAYAS = ["01 Adrar","02 Chlef","03 Laghouat","04 Oum El Bouaghi","05 Batna","06 Béjaïa","07 Biskra","08 Béchar","09 Blida","10 Bouira","11 Tamanrasset","12 Tébessa","13 Tlemcen","14 Tiaret","15 Tizi Ouzou","16 Alger","17 Djelfa","18 Jijel","19 Sétif","20 Saïda","21 Skikda","22 Sidi Bel Abbès","23 Annaba","24 Guelma","25 Constantine","26 Médéa","27 Mostaganem","28 M'Sila","29 Mascara","30 Ouargla","31 Oran","32 El Bayadh","33 Illizi","34 Bordj Bou Arreridj","35 Boumerdès","36 El Tarf","37 Tindouf","38 Tissemsilt","39 El Oued","40 Khenchela","41 Souk Ahras","42 Tipaza","43 Mila","44 Aïn Defla","45 Naâma","46 Aïn Témouchent","47 Ghardaïa","48 Relizane","49 El M'Ghair","50 El Meniaa","51 Ouled Djellal","52 Bordj Baji Mokhtar","53 Béni Abbès","54 Timimoun","55 Touggourt","56 Djanet","57 In Salah","58 In Guezzam"];

const state = {
  cat: "Tous",
  qty: {},       // clé "productId|variante" -> quantité
  picked: {},    // productId -> variante choisie
  cartOpen: false,
  fallbackOpen: false,
  query: "",
  sort: "default",
  range: "all",
  nom: "",
  wilaya: "",
  commune: "",
  tel: "",
  mode: ""       // "bureau" ou "domicile"
};

// Tarifs de la wilaya choisie. Wilaya absente de l'onglet Livraison :
// les deux modes restent proposés, avec un tarif à confirmer par la boutique.
function ratesFor(wilaya) {
  if (!wilaya) return null;
  const rates = DELIVERY[parseInt(wilaya, 10)];
  return rates || { bureau: undefined, domicile: undefined };
}

// null = pas proposé, undefined = tarif inconnu (à confirmer), nombre = prix
function isModeAvailable(rates, mode) {
  return rates && rates[mode] !== null;
}

function deliveryCost() {
  const rates = ratesFor(state.wilaya);
  if (!state.mode || !isModeAvailable(rates, state.mode)) return null;
  return rates[state.mode];
}

function deliveryText() {
  if (!state.mode) return "—";
  const cost = deliveryCost();
  if (cost === undefined) return "à confirmer";
  return cost === 0 ? "Gratuite" : fmt(cost);
}

function fmt(n) {
  return n.toLocaleString("fr-FR").replace(/ | /g, " ") + " DA";
}

function variantOf(p) {
  return state.picked[p.id] || (p.variants ? p.variants[0] : null);
}

function keyFor(p) {
  const v = variantOf(p);
  return p.id + (v ? "|" + v : "");
}

function addToCart(p) {
  if (p.out) return;
  const key = keyFor(p);
  state.qty[key] = (state.qty[key] || 0) + 1;
  state.cartOpen = true;
  render();
}

function bumpQty(key, delta) {
  const next = (state.qty[key] || 0) + delta;
  if (next <= 0) delete state.qty[key];
  else state.qty[key] = next;
  render();
}

function filteredProducts() {
  const q = state.query.trim().toLowerCase();
  let list = PRODUCTS.filter(p => {
    if (state.cat !== "Tous" && p.cat !== state.cat) return false;
    if (q && !p.name.toLowerCase().includes(q)) return false;
    if (state.range === "lt3" && p.price >= 3000) return false;
    if (state.range === "mid" && (p.price < 3000 || p.price > 6000)) return false;
    if (state.range === "gt6" && p.price <= 6000) return false;
    return true;
  });
  if (state.sort === "asc") list = list.slice().sort((a, b) => a.price - b.price);
  if (state.sort === "desc") list = list.slice().sort((a, b) => b.price - a.price);
  return list;
}

function cartLines() {
  return Object.keys(state.qty).map(key => {
    const [id, variant] = key.split("|");
    const p = PRODUCTS.find(x => x.id === id);
    const qty = state.qty[key];
    return { key, p, variant, qty, sum: p.price * qty };
  });
}

function buildMessage(lines, subtotal, total) {
  const body = lines.map(l =>
    "- " + l.p.name + (l.variant ? " (" + l.variant + ")" : "") + " x" + l.qty + " — " + fmt(l.sum)
  ).join("\n");

  const livraison = state.mode
    ? DELIVERY_MODES[state.mode] + ", " + deliveryText()
    : "à choisir";

  return [
    "Bonjour " + SHOP.nom_boutique + ", je souhaite commander :",
    "",
    body || "(aucun produit sélectionné)",
    "",
    "Sous-total : " + fmt(subtotal),
    "Livraison : " + livraison,
    "Total : " + fmt(total) + (deliveryCost() === undefined ? " + livraison" : ""),
    "",
    "Nom et prénom : " + (state.nom.trim() || "à compléter"),
    "Téléphone : " + (state.tel.trim() || "à compléter"),
    "Wilaya : " + (state.wilaya || "à compléter"),
    "Commune : " + (state.commune.trim() || "à compléter")
  ].join("\n");
}

// Liste des informations encore manquantes pour pouvoir envoyer la commande
function missingFields() {
  const missing = [];
  if (state.nom.trim().length < 2) missing.push("nom");
  if (state.tel.replace(/[^0-9]/g, "").length < 9) missing.push("téléphone");
  if (!state.wilaya) missing.push("wilaya");
  if (state.commune.trim().length < 2) missing.push("commune");
  if (!state.mode) missing.push("mode de livraison");
  return missing;
}

function render() {
  document.getElementById("shopName").textContent = SHOP.nom_boutique;
  document.getElementById("tagline").textContent = SHOP.tagline;
  document.getElementById("instagramLink").href = "https://instagram.com/" + SHOP.instagram.replace(/^@/, "");

  document.getElementById("clearSearch").hidden = !state.query;

  renderCategories();
  const list = filteredProducts();
  renderProducts(list);
  document.getElementById("noResults").hidden = list.length !== 0;

  const lines = cartLines();
  const subtotal = lines.reduce((a, l) => a + l.sum, 0);
  const total = subtotal + (deliveryCost() || 0);
  const count = lines.reduce((a, l) => a + l.qty, 0);
  const message = buildMessage(lines, subtotal, total);

  renderCart(lines, subtotal, total, count);
  renderDelivery();

  document.getElementById("fallbackMessage").value = message;

  const missing = missingFields();
  const canSend = count > 0 && missing.length === 0;
  const num = SHOP.whatsapp.replace(/[^0-9]/g, "");
  const sendBtn = document.getElementById("sendBtn");
  const sendNote = document.getElementById("sendNote");

  sendBtn.classList.toggle("disabled", !canSend);
  sendBtn.href = canSend ? "https://wa.me/" + num + "?text=" + encodeURIComponent(message) : "#";
  sendNote.hidden = canSend;
  sendNote.textContent = count === 0
    ? "Ajoutez au moins un produit pour envoyer votre commande."
    : "À compléter dans « Ma sélection » : " + missing.join(", ") + ".";
}

function renderDelivery() {
  const block = document.getElementById("deliveryBlock");
  const rates = ratesFor(state.wilaya);
  block.hidden = !rates;
  if (!rates) return;

  const el = document.getElementById("deliveryOptions");
  const available = Object.keys(DELIVERY_MODES).filter(m => isModeAvailable(rates, m));

  if (available.length === 0) {
    el.innerHTML = '<div class="delivery-info">Livraison non disponible vers cette wilaya pour le moment.</div>';
    return;
  }

  el.innerHTML = Object.keys(DELIVERY_MODES).map(mode => {
    const ok = isModeAvailable(rates, mode);
    const price = !ok ? "Non disponible"
      : rates[mode] === undefined ? "à confirmer"
      : rates[mode] === 0 ? "Gratuite" : fmt(rates[mode]);
    return `
      <label class="delivery-option${state.mode === mode ? " selected" : ""}${ok ? "" : " unavailable"}">
        <input type="radio" name="deliveryMode" value="${mode}" ${state.mode === mode ? "checked" : ""} ${ok ? "" : "disabled"}>
        <span class="delivery-option-label">${DELIVERY_MODES[mode]}</span>
        <span class="delivery-option-price">${price}</span>
      </label>`;
  }).join("");
}

function renderCategories() {
  const el = document.getElementById("categories");
  el.innerHTML = CATS.map(label =>
    `<button type="button" class="cat-btn${state.cat === label ? " active" : ""}" data-cat="${label}">${label}</button>`
  ).join("");
}

function renderProducts(list) {
  const el = document.getElementById("productGrid");

  el.innerHTML = list.map(p => {
    const variant = variantOf(p);
    const variantSelect = p.variants ? `
      <select class="variant-select" data-product-id="${p.id}" aria-label="Variante">
        ${p.variants.map(v => `<option value="${v}" ${v === variant ? "selected" : ""}>${v}</option>`).join("")}
      </select>` : "";

    const photo = p.photoUrl
      ? `<img class="product-photo-img" src="${p.photoUrl}" alt="${p.name}" loading="lazy" decoding="async">`
      : "photo produit";

    return `
      <div class="product-card${p.out ? " out" : ""}">
        <div class="product-photo${p.photoUrl ? "" : " stripes"}">
          ${photo}
          ${p.out ? '<div class="stock-badge">Rupture de stock</div>' : ""}
        </div>
        <div class="product-info">
          <div class="product-name">${p.name}</div>
          ${variantSelect}
          <div class="product-bottom-row">
            <div class="product-price">${fmt(p.price)}</div>
            <button type="button" class="add-btn" data-product-id="${p.id}" ${p.out ? "disabled" : ""}>
              ${p.out ? "Indisponible" : "Ajouter"}
            </button>
          </div>
        </div>
      </div>`;
  }).join("");
}

function renderCart(lines, subtotal, total, count) {
  document.getElementById("cartEmpty").style.display = lines.length === 0 ? "block" : "none";
  document.getElementById("cartSheet").hidden = !state.cartOpen;
  document.getElementById("cartFab").style.display = state.cartOpen ? "none" : "flex";

  document.getElementById("cartLines").innerHTML = lines.map(l => `
    <div class="cart-line">
      <div class="cart-line-info">
        <div class="cart-line-name">${l.p.name}</div>
        <div class="cart-line-sub">${(l.variant ? l.variant + " · " : "") + fmt(l.sum)}</div>
      </div>
      <div class="cart-line-qty">
        <button type="button" class="qty-btn" data-key="${l.key}" data-action="dec" aria-label="Retirer">−</button>
        <div class="qty-value">${l.qty}</div>
        <button type="button" class="qty-btn" data-key="${l.key}" data-action="inc" aria-label="Ajouter">+</button>
      </div>
    </div>`).join("");

  document.getElementById("cartSubtotal").textContent = fmt(subtotal);
  document.getElementById("cartDelivery").textContent = deliveryText();
  document.getElementById("cartTotal").textContent = fmt(total) + (deliveryCost() === undefined ? " + livraison" : "");

  const badge = document.getElementById("cartBadge");
  badge.textContent = count;
  badge.classList.toggle("has-items", count > 0);
}

function populateWilayaOptions() {
  const select = document.getElementById("wilayaSelect");
  WILAYAS.forEach(w => {
    const opt = document.createElement("option");
    opt.value = w;
    opt.textContent = w;
    select.appendChild(opt);
  });
}

function setupEvents() {
  document.getElementById("categories").addEventListener("click", e => {
    const btn = e.target.closest(".cat-btn");
    if (!btn) return;
    state.cat = btn.dataset.cat;
    render();
  });

  // Permet de défiler les catégories avec la molette verticale d'une souris classique
  // (sans trackpad, le défilement horizontal natif n'est sinon accessible qu'au doigt/trackpad).
  document.getElementById("categories").addEventListener("wheel", e => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    e.preventDefault();
    e.currentTarget.scrollLeft += e.deltaY;
  }, { passive: false });

  document.getElementById("productGrid").addEventListener("click", e => {
    const btn = e.target.closest(".add-btn");
    if (!btn) return;
    const p = PRODUCTS.find(x => x.id === btn.dataset.productId);
    addToCart(p);
  });

  document.getElementById("productGrid").addEventListener("change", e => {
    const select = e.target.closest(".variant-select");
    if (!select) return;
    state.picked[select.dataset.productId] = select.value;
    render();
  });

  document.getElementById("cartLines").addEventListener("click", e => {
    const btn = e.target.closest(".qty-btn");
    if (!btn) return;
    bumpQty(btn.dataset.key, btn.dataset.action === "inc" ? 1 : -1);
  });

  document.getElementById("cartFab").addEventListener("click", () => {
    state.cartOpen = true;
    render();
  });

  document.getElementById("closeCart").addEventListener("click", () => {
    state.cartOpen = false;
    render();
  });

  document.getElementById("fallbackToggle").addEventListener("click", () => {
    state.fallbackOpen = !state.fallbackOpen;
    document.getElementById("fallbackBox").hidden = !state.fallbackOpen;
  });

  document.getElementById("copyMessageBtn").addEventListener("click", () => {
    const message = document.getElementById("fallbackMessage").value;
    const btn = document.getElementById("copyMessageBtn");
    const showCopied = () => {
      btn.textContent = "Message copié";
      setTimeout(() => { btn.textContent = "Copier le message"; }, 2000);
    };
    if (navigator.clipboard) {
      navigator.clipboard.writeText(message).then(showCopied, showCopied);
    } else {
      showCopied();
    }
  });

  document.getElementById("searchInput").addEventListener("input", e => {
    state.query = e.target.value;
    render();
  });

  document.getElementById("clearSearch").addEventListener("click", () => {
    state.query = "";
    document.getElementById("searchInput").value = "";
    render();
  });

  document.getElementById("sortSelect").addEventListener("change", e => {
    state.sort = e.target.value;
    render();
  });

  document.getElementById("rangeSelect").addEventListener("change", e => {
    state.range = e.target.value;
    render();
  });

  document.getElementById("nomInput").addEventListener("input", e => {
    state.nom = e.target.value;
    render();
  });

  document.getElementById("wilayaSelect").addEventListener("change", e => {
    state.wilaya = e.target.value;
    // Le mode choisi n'existe peut-être pas dans la nouvelle wilaya
    if (state.mode && !isModeAvailable(ratesFor(state.wilaya), state.mode)) state.mode = "";
    render();
  });

  document.getElementById("communeInput").addEventListener("input", e => {
    state.commune = e.target.value;
    render();
  });

  document.getElementById("deliveryOptions").addEventListener("change", e => {
    if (e.target.name !== "deliveryMode") return;
    state.mode = e.target.value;
    render();
  });

  document.getElementById("telInput").addEventListener("input", e => {
    state.tel = e.target.value;
    render();
  });

  document.getElementById("sendBtn").addEventListener("click", e => {
    if (document.getElementById("sendBtn").classList.contains("disabled")) {
      e.preventDefault();
      state.cartOpen = true;
      render();
    }
  });
}

async function init() {
  document.getElementById("productGrid").innerHTML = '<div class="loading-msg">Chargement du catalogue…</div>';
  try {
    await fetchCatalog();
  } catch (err) {
    console.error("Erreur de chargement du catalogue :", err);
    document.getElementById("productGrid").innerHTML = '<div class="loading-msg">Impossible de charger le catalogue pour le moment.</div>';
    return;
  }
  populateWilayaOptions();
  setupEvents();
  render();
}

init();
