// Identifiant du Google Sheet qui sert de catalogue (voir onglets "Produits" et "Config")
const SHEET_ID = "1O0m5L2eWOTgnipKEsZrNmRFMumukyvAT1PEZyOs9YqU";

// Rempli par fetchCatalog() au chargement, à partir du Sheet
let SHOP = { name: "", tagline: "", whatsapp: "", instagram: "" };
let PRODUCTS = [];
let CATS = ["Tous"];

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

async function fetchCatalog() {
  const [productRows, configRows] = await Promise.all([
    fetchSheetRows("Produits"),
    fetchSheetRows("Config")
  ]);
  PRODUCTS = rowsToProducts(productRows);
  SHOP = rowsToShop(configRows);
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
  tel: ""
};

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

function buildMessage(lines, total) {
  const body = lines.map(l =>
    "- " + l.p.name + (l.variant ? " (" + l.variant + ")" : "") + " x" + l.qty + " — " + fmt(l.sum)
  ).join("\n");

  return [
    "Bonjour " + SHOP.name + ", je souhaite commander :",
    "",
    body || "(aucun produit sélectionné)",
    "",
    "Total : " + fmt(total),
    "",
    "Nom et prénom : " + (state.nom.trim() || "à compléter"),
    "Wilaya / commune : " + (state.wilaya || "à compléter"),
    "Téléphone : " + (state.tel.trim() || "—")
  ].join("\n");
}

function render() {
  document.getElementById("shopName").textContent = SHOP.name;
  document.getElementById("tagline").textContent = SHOP.tagline;
  document.getElementById("instagramLink").href = "https://instagram.com/" + SHOP.instagram.replace(/^@/, "");

  document.getElementById("clearSearch").hidden = !state.query;

  renderCategories();
  const list = filteredProducts();
  renderProducts(list);
  document.getElementById("noResults").hidden = list.length !== 0;

  const lines = cartLines();
  const total = lines.reduce((a, l) => a + l.sum, 0);
  const count = lines.reduce((a, l) => a + l.qty, 0);
  const message = buildMessage(lines, total);

  renderCart(lines, total, count);

  document.getElementById("fallbackMessage").value = message;

  const canSend = count > 0 && state.nom.trim().length > 1 && !!state.wilaya;
  const num = SHOP.whatsapp.replace(/[^0-9]/g, "");
  const sendBtn = document.getElementById("sendBtn");
  const sendNote = document.getElementById("sendNote");

  sendBtn.classList.toggle("disabled", !canSend);
  sendBtn.href = canSend ? "https://wa.me/" + num + "?text=" + encodeURIComponent(message) : "#";
  sendNote.hidden = canSend;
  sendNote.textContent = count === 0
    ? "Ajoutez au moins un produit pour envoyer votre commande."
    : "Renseignez votre nom et votre wilaya dans « Ma sélection ».";
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
      ? `<img class="product-photo-img" src="${p.photoUrl}" alt="${p.name}">`
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

function renderCart(lines, total, count) {
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

  document.getElementById("cartTotal").textContent = fmt(total);

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
