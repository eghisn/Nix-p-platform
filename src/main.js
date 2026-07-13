import { requestStatuses } from "./data/sampleData.js";
import { adminStore } from "./services/adminStore.js";
import { catalogService } from "./services/catalogService.js";
import { pageHero, productGrid, shell, table } from "./components/layout.js";

const app = document.querySelector("#app");
const money = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0
});

const state = {
  recordsFilter: "All",
  apparelFilter: "All Apparel",
  cart: JSON.parse(localStorage.getItem("nixp-cart") || "[]"),
  requests: [],
  cartOpen: false,
  searchOpen: false,
  selectedSizes: {},
  zoomedProductId: null,
  auth: {
    loaded: false,
    authenticated: false,
    workspace: null,
    username: null
  },
  adminEditingProductId: null,
  adminSearch: {},
  adminSort: {
    products: "artist",
    artists: "name",
    collections: "sort",
    requests: "status",
    orders: "date",
    preview: "artist"
  }
};

const routes = {
  "/": homePage,
  "/records": recordsPage,
  "/objects": categoryPage("Objects", "Objects", "Objects and editions made for rooms, shelves, and listening rituals."),
  "/apparel": () => apparelPage(),
  "/accessories": () => apparelPage("Accessories"),
  "/accesories": () => apparelPage("Accessories"),
  "/publishing": categoryPage("Publishing", "Publishing", "Printed matter, books, magazines, and text-led editions."),
  "/artists": artistsPage,
  "/blog": blogPage,
  "/request-item": requestItemPage,
  "/about": aboutPage,
  "/contact": contactPage,
  "/shipping-returns": shippingReturnsPage,
  "/cart": cartPage,
  "/login": loginPage,
  "/finance": cashflowPage,
  "/finance/cashflow": cashflowPage,
  "/admin": adminDashboardPage,
  "/admin/editor": adminEditorPage,
  "/admin/products": adminProductsPage,
  "/admin/media": adminMediaPage,
  "/admin/artists": adminArtistsPage,
  "/admin/collections": adminCollectionsPage,
  "/admin/requests": adminRequestsPage,
  "/admin/inventory": inventoryPage,
  "/admin/orders": ordersPage,
  "/admin/cashflow": cashflowPage,
  "/admin/reports": reportsPage,
  "/admin/preview": adminPreviewPage
};

async function render() {
  const path = normalizePath(location.pathname);
  await loadAuthSession();
  const requiredWorkspace = workspaceForPath(path);
  const view =
    requiredWorkspace && !isLocalEditorHost()
      ? privateWorkspacePage
      : requiredWorkspace && !hasWorkspaceAccess(requiredWorkspace)
        ? () => loginPage(requiredWorkspace, path)
        : path.startsWith("/product/")
          ? productDetailPage
          : path.startsWith("/admin/preview/product/")
            ? previewProductDetailPage
            : path.startsWith("/artists/")
              ? artistProductsPage
              : routes[path] || notFoundPage;
  const content = await view(path);
  const isLoginView = path === "/login" || (requiredWorkspace && !hasWorkspaceAccess(requiredWorkspace));
  document.body.classList.toggle("page-lock", path === "/" || path === "/about" || path === "/contact" || isLoginView);
  document.body.classList.toggle("login-lock", isLoginView);
  document.body.classList.toggle("preview-lock", path === "/admin/preview");
  app.innerHTML = shell(content, path, state.cart.length, await cartDrawer(), await searchOverlay());
  bindEvents();
}

async function loadAuthSession({ force = false } = {}) {
  if (state.auth.loaded && !force) return state.auth;
  if (!isLocalEditorHost()) {
    state.auth = { loaded: true, authenticated: false, workspace: null, username: null };
    return state.auth;
  }
  try {
    const response = await fetch("/api/auth/session", { cache: "no-store" });
    state.auth = { loaded: true, ...(await response.json()) };
  } catch {
    state.auth = { loaded: true, authenticated: false, workspace: null, username: null };
  }
  return state.auth;
}

function workspaceForPath(path) {
  if (path.startsWith("/finance") || path === "/admin/cashflow") return "finance";
  if (path.startsWith("/admin")) return "admin";
  return null;
}

function hasWorkspaceAccess(workspace) {
  return state.auth.authenticated && state.auth.workspace === workspace;
}

function isLocalEditorHost() {
  return ["localhost", "127.0.0.1", ""].includes(location.hostname);
}

function normalizePath(path) {
  if (path.length > 1 && path.endsWith("/")) return path.slice(0, -1);
  return path;
}

async function homePage() {
  const products = await catalogService.listProducts();
  const featured = products.filter((product) => product.image && !product.image.includes("nixp-product-example"));
  const slides = featured.length ? featured : products;
  const loopSlides = [...slides, ...slides];
  return `
    <section class="home-slider" aria-label="Product slider">
      <div class="slider-viewport">
        <div class="slider-track">
          ${loopSlides
          .map(
            (product, index) => `
              <article class="slide">
                <a href="/product/${product.id}" data-link>
                  <figure class="product-art slide-art">
                    <img src="${product.image}" alt="${product.title}" />
                  </figure>
                  <div class="slide-caption">
                    <span>${String((index % slides.length) + 1).padStart(2, "0")}</span>
                    <strong>${product.artist}</strong>
                    <em>${product.title}</em>
                  </div>
                </a>
              </article>
            `
          )
          .join("")}
        </div>
      </div>
    </section>
  `;
}

async function recordsPage() {
  const labelFilter = new URLSearchParams(location.search).get("label") || "";
  const records = await catalogService.listRecords(state.recordsFilter, labelFilter);
  const filters = ["All", "Vinyl", "CD", "Cassette"];
  return `
    <section class="section shop-section">
      ${
        labelFilter
          ? `<div class="active-label-filter">
              <span>Record Label</span>
              <strong>${escapeHtml(labelFilter)}</strong>
              <a href="/records" data-link>Clear</a>
            </div>`
          : ""
      }
      <div class="toolbar" role="group" aria-label="Record format filters">
        ${filters
          .map(
            (filter) => `
              <button class="chip ${state.recordsFilter === filter ? "is-active" : ""}" type="button" data-record-filter="${filter}">
                ${filter}
              </button>
            `
          )
          .join("")}
      </div>
      ${productGrid(records)}
    </section>
  `;
}

function categoryPage(category, title, text) {
  return async () => {
    const items = await catalogService.listProductsByCategory(category);
    return `<section class="section shop-section">${productGrid(items)}</section>`;
  };
}

async function apparelPage(filter = state.apparelFilter) {
  const activeFilter = filter || "All Apparel";
  const apparel = await catalogService.listApparel(activeFilter);
  const filters = ["All Apparel", "Tops", "Bottoms", "Accessories"];
  return `
    <section class="section shop-section">
      <div class="toolbar" role="group" aria-label="Apparel filters">
        ${filters
          .map(
            (filter) => `
              <button class="chip ${activeFilter === filter ? "is-active" : ""}" type="button" data-apparel-filter="${filter}">
                ${filter}
              </button>
            `
          )
          .join("")}
      </div>
      ${productGrid(apparel)}
    </section>
  `;
}

async function productDetailPage(path) {
  const id = decodeURIComponent(path.replace("/product/", ""));
  const product = await catalogService.getProduct(id);
  if (!product) return notFoundPage();
  return productDetailMarkup(product);
}

async function productDetailMarkup(product) {
  const related = (await catalogService.listProducts())
    .filter((item) => item.category === product.category && item.id !== product.id)
    .slice(0, 4);
  const displayFormat = product.displayFormat || product.format;
  const conditionLabel = product.condition || "Available";
  const isApparel = product.category === "Apparel";
  const galleryImages = productImages(product);
  const isSizedProduct = (product.category === "Apparel" || product.category === "Objects") && product.sizes?.length;
  const selectedSize =
    state.selectedSizes[product.id] ||
    product.sizes?.find((size) => !isSizeSoldOut(size))?.label ||
    "";

  return `
    <section class="product-detail">
      <div class="detail-gallery">
        ${galleryImages
          .map(
            (image, index) => `
              <figure class="product-art product-art-large ${isApparel ? "product-art-apparel" : ""}">
                <img src="${image}" alt="${product.title}${galleryImages.length > 1 ? ` image ${index + 1}` : ""}" />
              </figure>
            `
          )
          .join("")}
      </div>
      <aside class="detail-copy">
        <a class="back-link" href="/${product.category.toLowerCase()}" data-link>${product.category}</a>
        <p class="eyebrow">${product.artist}</p>
        <h1>${product.title}</h1>
        <div class="detail-price">${money.format(product.price)}</div>
        <p>${product.description}</p>
        ${
          isSizedProduct
            ? `<div class="size-picker" aria-label="Available sizes">
                ${product.sizes
                  .map(
                    (size) => `
                      <button
                        type="button"
                        data-size-option="${product.id}"
                        data-size-value="${size.label}"
                        ${isSizeSoldOut(size) ? "disabled" : ""}
                        class="${[
                          isSizeSoldOut(size) ? "is-sold-out" : "",
                          selectedSize === size.label ? "is-selected" : ""
                        ]
                          .filter(Boolean)
                          .join(" ")}"
                      >
                        ${size.label}
                      </button>
                    `
                  )
                  .join("")}
              </div>`
            : ""
        }
        <div class="detail-actions">
          <button class="button button-dark" type="button" data-add-cart="${product.id}">Add to cart</button>
          <a class="button button-outline" href="/request-item" data-link>Request similar</a>
        </div>
        <dl class="detail-list">
          ${
            isApparel
              ? `<div><dt>Material</dt><dd>${product.material}</dd></div>
                 <div><dt>Color</dt><dd>${product.color}</dd></div>`
              : `<div><dt>Format</dt><dd>${displayFormat} / ${conditionLabel}</dd></div>
                 <div><dt>Label</dt><dd>${recordLabelMarkup(product)}</dd></div>
                 <div><dt>Year</dt><dd>${product.year}</dd></div>
                 <div><dt>Notes</dt><dd>${product.details.join(" / ")}</dd></div>`
          }
        </dl>
      </aside>
    </section>
    ${
      related.length
        ? `<section class="section shop-section">${productGrid(related)}</section>`
        : ""
    }
  `;
}

async function artistsPage() {
  const artists = await catalogService.listArtists();
  return `
    <section class="section artist-list">
      ${artists
        .map(
          (artist) => `
            <article class="artist-row">
              <a href="/artists/${encodeURIComponent(artist)}" data-link>
                <h2>${artist}</h2>
                <span>View products</span>
              </a>
            </article>
          `
        )
        .join("")}
    </section>
  `;
}

async function artistProductsPage(path) {
  const artist = decodeURIComponent(path.replace("/artists/", ""));
  const products = await catalogService.listProductsByArtist(artist);
  return `
    <section class="section shop-section artist-products">
      <div class="toolbar artist-toolbar">
        <a class="back-link" href="/artists" data-link>Artists</a>
        <span>${artist}</span>
      </div>
      ${productGrid(products)}
    </section>
  `;
}

function blogPage() {
  const articles = [
    {
      number: "01",
      title: "Listening Notes: The First NIXP Selection",
      type: "Editorial",
      date: "2026",
      summary: "A short introduction to the records, CDs, cassettes, books and objects shaping the first NIXP catalog."
    },
    {
      number: "02",
      title: "Inside Aesthetic Pleasure Gallery",
      type: "Place",
      date: "2026",
      summary: "Notes from the listening space, the shop table, and the culture around the gallery floor."
    },
    {
      number: "03",
      title: "Format Notes: Vinyl, CD, Cassette",
      type: "Guide",
      date: "2026",
      summary: "A practical media index for collectors moving between physical formats."
    }
  ];

  return `
    <section class="section editorial-page blog-page">
      <div class="editorial-shell">
        <h1>Blog</h1>
        <div class="blog-list">
        ${articles
          .map(
            (article) => `
              <article class="blog-row">
                <span>${article.number} / ${article.type} / ${article.date}</span>
                <div>
                  <h2>${article.title}</h2>
                  <p>${article.summary}</p>
                </div>
                <a href="#" aria-label="Read ${article.title}">Read</a>
              </article>
            `
          )
          .join("")}
        </div>
      </div>
    </section>
  `;
}

async function requestItemPage() {
  const requests = [...(await catalogService.listRequests()), ...state.requests];
  return `
    <section class="section form-layout">
      <form class="request-form" data-request-form>
        <label>Artist Name:<input name="artistName" required /></label>
        <label>Title / Item Name:<input name="itemName" required /></label>
        <label>Format:
          <select name="format" required>
            ${["Vinyl", "CD", "Cassette", "Book", "Magazine", "Object", "Apparel", "Other"]
              .map((format) => `<option>${format}</option>`)
              .join("")}
          </select>
        </label>
        <label>Email:<input type="email" name="email" required /></label>
        <label>WhatsApp:<input name="whatsapp" /></label>
        <label>Notes:<textarea name="notes" rows="5"></textarea></label>
        <button class="button button-dark" type="submit">Submit request</button>
      </form>
      <aside class="status-panel">
        <p class="eyebrow">Request status</p>
        <div class="status-stack">
          ${requestStatuses.map((status) => `<span>${status}</span>`).join("")}
        </div>
        <div class="mini-list">
          ${requests
            .map(
              (request) => `
                <article>
                  <strong>${request.itemName}</strong>
                  <span>${request.artistName} / ${request.format} / ${request.status}</span>
                </article>
              `
            )
            .join("")}
        </div>
      </aside>
    </section>
  `;
}

function aboutPage() {
  return `
    <section class="section editorial-page">
      <div class="editorial-shell">
        <h1>About</h1>
        <div class="editorial-copy">
          <p>NIXP is an extension of Nix Powell, bringing together records, CDs, cassettes, books and selected objects shaped by years of listening, collecting and making.</p>
          <p>Operating from Aesthetic Pleasure Gallery in Jakarta, <strong>NIXP is a place for sound, objects and printed matter to gather, following the traces between image, memory and whatever refuses to stay in one form.</strong></p>
        </div>
      </div>
    </section>
  `;
}

function contactPage() {
  return `
    <section class="section editorial-page contact-page">
      <div class="editorial-shell">
        <h1>Contact</h1>
        <div class="editorial-copy contact-copy">
          <address>Aesthetic Pleasure Gallery Wijaya Grand Centre, Jl. Darmawangsa Raya Blok G 9 2rd Floor, RT.6/RW.1, Pulo, Kebayoran Baru, South Jakarta City, Jakarta 12160</address>
          <p><a href="https://wa.me/6282122876289">+628 2122 8762 89</a><br><a href="mailto:contact@nix-p.com">contact@nix-p.com</a><br><a href="/shipping-returns" data-link>Shipping & Returns</a></p>
        </div>
      </div>
    </section>
  `;
}

function shippingReturnsPage() {
  return `
    <section class="section editorial-page">
      <div class="editorial-shell">
        <h1>Shipping & Returns</h1>
        <div class="editorial-copy">
          <p>Shipping rates, fulfillment windows, and return terms will be connected once checkout and inventory are live.</p>
          <p>For now, customers can contact NIXP directly for availability, local pickup, and item condition questions.</p>
        </div>
      </div>
    </section>
  `;
}

async function cartPage() {
  const { rows, total } = await cartSummary();
  return `
    <section class="section cart-view">
      ${
        rows.length
          ? rows
              .map(
                (row) => `
                  <article class="cart-row">
                    <span>${row.product.artist}</span>
                    <strong>${row.product.title} <small>x${row.quantity}</small></strong>
                    <span>${money.format(row.lineTotal)}</span>
                  </article>
                `
              )
              .join("")
          : `<p class="empty-state">Your cart is empty.</p>`
      }
      <div class="cart-total"><span>Total</span><strong>${money.format(total)}</strong></div>
    </section>
  `;
}

async function cartSummary() {
  const products = await catalogService.listProducts();
  const counts = state.cart.reduce((map, id) => {
    map.set(id, (map.get(id) || 0) + 1);
    return map;
  }, new Map());
  const rows = [...counts.entries()]
    .map(([id, quantity]) => {
      const product = products.find((item) => item.id === id);
      return product
        ? {
            id,
            product,
            quantity,
            lineTotal: product.price * quantity
          }
        : null;
    })
    .filter(Boolean);
  return {
    rows,
    total: rows.reduce((sum, row) => sum + row.lineTotal, 0)
  };
}

async function cartDrawer() {
  const { rows, total } = await cartSummary();
  return `
    <div class="cart-overlay ${state.cartOpen ? "is-open" : ""}" data-cart-overlay>
      <button class="cart-backdrop" type="button" aria-label="Close cart" data-cart-close></button>
      <aside class="cart-drawer" aria-label="Cart">
        <div class="drawer-head">
          <h2>Cart</h2>
          <button type="button" aria-label="Close cart" data-cart-close>Close</button>
        </div>
        <div class="drawer-lines">
          ${
            rows.length
              ? rows
                  .map(
                    (row) => `
                      <article class="drawer-line">
                        <img class="drawer-thumb" src="${row.product.image}" alt="${row.product.title}" />
                        <div>
                          <strong>${row.product.title}</strong>
                          <span>${row.product.format} / ${row.product.artist}</span>
                          <small>${row.quantity} x ${money.format(row.product.price)}</small>
                        </div>
                        <button type="button" aria-label="Remove ${row.product.title}" data-remove-cart="${row.id}">Remove</button>
                      </article>
                    `
                  )
                  .join("")
              : `<p class="empty-state">Cart empty ;(</p>`
          }
        </div>
        <div class="drawer-foot">
          <div class="cart-total"><span>Subtotal</span><strong>${money.format(total)}</strong></div>
          <a class="button button-dark" href="/cart" data-link>Checkout</a>
        </div>
      </aside>
    </div>
  `;
}

async function searchOverlay() {
  const [products, artists] = await Promise.all([catalogService.listProducts(), catalogService.listArtists()]);
  const suggestions = [
    ...products.map((product) => ({
      type: product.category,
      title: product.title,
      meta: `${product.artist} / ${product.displayFormat || product.format}${product.label ? ` / ${product.label}` : ""}`,
      href: `/product/${product.id}`
    })),
    ...artists.map((artist) => ({
      type: "Artist",
      title: artist,
      meta: "Artist index",
      href: `/artists/${encodeURIComponent(artist)}`
    }))
  ];

  return `
    <div class="search-overlay ${state.searchOpen ? "is-open" : ""}" data-search-overlay>
      <button class="search-backdrop" type="button" aria-label="Close search" data-search-close></button>
      <aside class="search-panel" aria-label="Search">
        <div class="search-head">
          <label for="site-search">Search</label>
          <button type="button" data-search-close>Close</button>
        </div>
        <input id="site-search" type="search" autocomplete="off" placeholder="Type at least 3 letters" data-search-input />
        <div class="search-hint" data-search-hint>Suggestions appear after the first 3 letters.</div>
        <div class="search-results" data-search-results></div>
        <script type="application/json" data-search-data>${JSON.stringify(suggestions).replace(/</g, "\\u003c")}</script>
      </aside>
    </div>
  `;
}

function loginPage(workspaceOrPath = "admin", nextPath = null) {
  const params = new URLSearchParams(location.search);
  const workspace = ["admin", "finance"].includes(workspaceOrPath)
    ? workspaceOrPath
    : params.get("workspace") === "finance"
      ? "finance"
      : "admin";
  const next = nextPath || params.get("next") || (workspace === "finance" ? "/finance" : "/admin");
  const workspaceLabel = workspace === "finance" ? "NIXP Finance" : "NIXP Admin";
  return `
    <section class="section private-entry">
      <div class="private-entry-copy">
        <p class="eyebrow">Private</p>
        <h1>${workspaceLabel}</h1>
        <p>Sign in to continue.</p>
      </div>
      <form class="private-entry-form" data-login-form data-workspace="${escapeAttr(workspace)}" data-next="${escapeAttr(next)}">
        <label>Username<input name="username" type="text" autocomplete="username" /></label>
        <label>Password<input name="password" type="password" autocomplete="current-password" /></label>
        <button class="button button-dark" type="submit">Enter ${workspace === "finance" ? "Finance" : "Admin"}</button>
        <p class="form-message" data-login-message></p>
      </form>
    </section>
  `;
}

function privateWorkspacePage() {
  return `
    ${pageHero({
      eyebrow: "Private Workspace",
      title: "NIXP Admin Is Not Public",
      text: "Admin and finance tools are intentionally disabled on the public storefront until authenticated subdomains are connected."
    })}
  `;
}

async function adminDashboardPage() {
  const [inventory, orders, requests] = await Promise.all([
    catalogService.listInventory(),
    catalogService.listOrders(),
    catalogService.listRequests()
  ]);
  const products = await catalogService.listAllProducts();
  const stockUnits = inventory.reduce((sum, item) => sum + item.stock, 0);
  const orderValue = orders.reduce((sum, order) => sum + order.total, 0);
  return `
    ${adminHero("Admin Dashboard", "Operations snapshot for catalog, stock, orders, requests, and shop health.")}
    <section class="section metric-grid">
      ${metric("Products", products.length)}
      ${metric("Drafts", products.filter((product) => product.publishStatus !== "Published").length)}
      ${metric("Stock units", stockUnits)}
      ${metric("Open orders", orders.filter((order) => order.status !== "Closed").length)}
      ${metric("Requests", requests.length)}
      ${metric("Order value", money.format(orderValue))}
    </section>
  `;
}

async function adminEditorPage() {
  const [products, artists, collections, requests, orders] = await Promise.all([
    catalogService.listAllProducts(),
    catalogService.listAdminArtists(),
    catalogService.listCollections(),
    catalogService.listRequests(),
    catalogService.listOrders()
  ]);
  const drafts = products.filter((product) => product.publishStatus !== "Published").length;
  return `
    ${adminHero("NIXP Editor", "One workspace for products, images, artists, collections, requests, orders, drafts, and previews.")}
    <section class="section editor-command">
      ${metric("Products", products.length)}
      ${metric("Drafts", drafts)}
      ${metric("Requests", requests.length)}
      ${metric("Orders", orders.length)}
      <nav class="editor-tabs" aria-label="Editor sections">
        <a href="#editor-products">Products</a>
        <a href="#editor-media">Images</a>
        <a href="#editor-artists">Artists</a>
        <a href="#editor-collections">Collections</a>
        <a href="#editor-requests">Requests</a>
        <a href="#editor-orders">Orders</a>
        <a href="#editor-preview">Preview</a>
      </nav>
    </section>
    <section class="section editor-section" id="editor-products">
      <div class="editor-section-head">
        <span>01</span>
        <h2>Products</h2>
        <p>Create product drafts, publish finished listings, and archive old items.</p>
      </div>
      ${await adminProductsPage({ embedded: true })}
    </section>
    <section class="section editor-section" id="editor-media">
      <div class="editor-section-head">
        <span>02</span>
        <h2>Images</h2>
        <p>Upload or replace product images before they move into Supabase Storage.</p>
      </div>
      ${await adminMediaPage({ embedded: true })}
    </section>
    <section class="section editor-section" id="editor-artists">
      <div class="editor-section-head">
        <span>03</span>
        <h2>Artists</h2>
        <p>Manage the artist index and editorial metadata.</p>
      </div>
      ${await adminArtistsPage({ embedded: true })}
    </section>
    <section class="section editor-section" id="editor-collections">
      <div class="editor-section-head">
        <span>04</span>
        <h2>Collections</h2>
        <p>Organize categories, shelves, drops, and campaign groupings.</p>
      </div>
      ${await adminCollectionsPage({ embedded: true })}
    </section>
    <section class="section editor-section" id="editor-requests">
      <div class="editor-section-head">
        <span>05</span>
        <h2>Requests</h2>
        <p>Move request items from new lead to closed conversation.</p>
      </div>
      ${await adminRequestsPage({ embedded: true })}
    </section>
    <section class="section editor-section" id="editor-orders">
      <div class="editor-section-head">
        <span>06</span>
        <h2>Orders</h2>
        <p>Review carts and update order statuses.</p>
      </div>
      ${await ordersPage({ embedded: true })}
    </section>
    <section class="section editor-section" id="editor-preview">
      <div class="editor-section-head">
        <span>07</span>
        <h2>Preview</h2>
        <p>Open draft previews before publishing them to the public storefront.</p>
      </div>
      ${await adminPreviewPage({ embedded: true })}
    </section>
  `;
}

async function adminProductsPage({ embedded = false } = {}) {
  const products = await catalogService.listAllProducts();
  const visibleProducts = sortItems(
    filterItems(products, "products", (item) => [
      item.sku,
      item.artist,
      item.title,
      item.format,
      item.condition,
      item.category,
      item.publishStatus,
      item.price
    ]),
    state.adminSort.products,
    {
      artist: (item) => item.artist,
      product: (item) => item.title,
      title: (item) => item.title,
      sku: (item) => item.sku,
      category: (item) => item.category,
      format: (item) => item.format,
      condition: (item) => item.condition || "",
      price: (item) => item.price,
      status: (item) => item.publishStatus,
      updated: (item) => item.updatedAt || ""
    }
  );
  const editing = state.adminEditingProductId
    ? products.find((product) => product.id === state.adminEditingProductId)
    : null;
  const product = editing || {};
  const productCategory = product.category || "Records";
  return `
    ${embedded ? "" : adminHero("Products", "Create product drafts, upload images, publish items, and keep the storefront clean.")}
    <div class="admin-workspace">
      <form class="admin-panel admin-product-form" data-admin-product-form>
        <div class="admin-panel-head">
          <h2>${editing ? "Edit product" : "New product"}</h2>
          ${editing ? `<button class="button button-outline" type="button" data-admin-new-product>New</button>` : ""}
        </div>
        <div class="admin-form-grid">
          ${input("id", "ID", product.id || "", "Leave blank for auto ID")}
          ${input("sku", "SKU", product.sku || "", "NXP-2026-APP-0002")}
          ${input("title", "Title", product.title || "", "Item title")}
          ${select("category", "Category", ["Records", "Objects", "Apparel", "Publishing"], product.category || "Records")}
          <div class="admin-record-fields" data-admin-record-fields ${productCategory === "Apparel" || productCategory === "Objects" ? "hidden" : ""}>
            ${input("artist", "Artist", product.artist || "", "Artist / maker")}
            ${input("format", "Format", product.format || "", "Vinyl, CD, Book")}
            ${input("displayFormat", "Display format", product.displayFormat || "", "Vinyl 12&quot;")}
          </div>
          <div class="admin-product-fields" data-admin-product-fields ${productCategory === "Apparel" || productCategory === "Objects" ? "" : "hidden"}>
            ${input("collection", "Collection", product.collection || product.label || "", "NIXP Apparel")}
            ${input("color", "Color", product.color || "", "Black")}
            ${input("material", "Material", product.material || "", "Knit cotton blend")}
            <div data-admin-apparel-field ${productCategory === "Apparel" ? "" : "hidden"}>
              ${select("apparelType", "Apparel type", ["", "Tops", "Bottoms", "Accessories"], product.apparelType === "Accesories" ? "Accessories" : product.apparelType || "")}
            </div>
            ${sizeInventoryFields(product)}
          </div>
          ${input("condition", "Condition", product.condition || "", "New, Used, Unsealed")}
          ${input("price", "Price IDR", product.price || "", "640000", "number")}
          ${input("year", "Year", product.year || new Date().getFullYear(), "2026", "number")}
          ${input("label", "Label", product.label || "", "NIXP Selection")}
          ${input("qty", "Quantity", product.qty || 1, "1", "number")}
          ${input("tags", "Tags", product.tags?.join(", ") || "", "new, vinyl, jakarta")}
          ${input("details", "Details", product.details?.join(", ") || "", "Format, condition, notes")}
          ${select("publishStatus", "Status", ["Published", "Draft", "Archived"], product.publishStatus || "Published")}
          ${select("visibility", "Visibility", ["Public", "Hidden"], product.visibility || "Public")}
        </div>
        <label>Description<textarea name="description" rows="4">${escapeHtml(product.description || "")}</textarea></label>
        <label>Image URL<input name="image" value="${escapeAttr(product.image || "")}" placeholder="/public/example.png or uploaded data URL" /></label>
        ${galleryUploadFields(product)}
        <p class="admin-form-note" data-admin-form-message aria-live="polite"></p>
        <div class="admin-form-actions">
          <button class="button button-dark" type="submit">Save product</button>
          ${editing ? `<a class="button button-outline" href="/admin/preview/product/${product.id}" data-link>Preview</a>` : ""}
        </div>
      </form>

      <div class="admin-panel">
        <div class="admin-panel-head">
          <h2>Catalog</h2>
          <span>${visibleProducts.length} / ${products.length} items</span>
        </div>
        ${adminListControls("products", "Search SKU, product, category, format, condition", [
          ["status", "Status"],
          ["sku", "SKU"],
          ["product", "Product"],
          ["category", "Category"],
          ["format", "Format"],
          ["condition", "Condition"],
          ["price", "Selling price"],
          ["updated:desc", "Updated newest"],
          ["updated", "Updated oldest"],
          ["artist", "Artist"],
          ["title", "Album / title"],
        ])}
        ${table(
          [
            sortHeader("products", "status", "Status"),
            sortHeader("products", "sku", "SKU"),
            sortHeader("products", "product", "Product"),
            sortHeader("products", "category", "Category"),
            sortHeader("products", "format", "Format"),
            sortHeader("products", "condition", "Condition"),
            sortHeader("products", "price", "Selling Price"),
            sortHeader("products", "updated", "Updated"),
            "Actions"
          ],
          visibleProducts.map((item) => [
            statusPill(item.publishStatus),
            escapeHtml(item.sku || "-"),
            `<strong>${escapeHtml(item.title)}</strong><br><small>${escapeHtml(item.artist)}</small>`,
            escapeHtml(item.category || "-"),
            item.displayFormat || item.format,
            item.condition || "-",
            money.format(item.price || 0),
            item.updatedAt || "-",
            `<button class="link-button" type="button" data-admin-edit-product="${item.id}">Edit</button>
             <button class="link-button" type="button" data-admin-product-status="${item.id}" data-status="${item.publishStatus === "Published" ? "Draft" : "Published"}">${item.publishStatus === "Published" ? "Unpublish" : "Publish"}</button>`
          ])
        )}
      </div>
    </div>
  `;
}

async function adminMediaPage({ embedded = false } = {}) {
  const products = await catalogService.listAllProducts();
  return `
    ${embedded ? "" : adminHero("Media", "Upload or replace product images. Uploaded images are stored in the prototype admin data until Supabase Storage is connected.")}
    <div class="admin-workspace admin-workspace-single">
      <form class="admin-panel" data-admin-media-form>
        <label>Product
          <select name="productId">
            ${products.map((product) => `<option value="${product.id}">${escapeHtml(product.artist)} / ${escapeHtml(product.title)}</option>`).join("")}
          </select>
        </label>
        <label>Image URL<input name="image" placeholder="/public/new-image.png" /></label>
        ${galleryUploadFields({}, "New gallery images")}
        <p class="admin-form-note" data-admin-form-message aria-live="polite"></p>
        <button class="button button-dark" type="submit">Update images</button>
      </form>
      <div class="admin-media-grid">
        ${products
          .map(
            (product) => `
              <article class="admin-media-card">
                <img src="${product.image}" alt="${escapeAttr(product.title)}" />
                <strong>${escapeHtml(product.title)}</strong>
                <span>${escapeHtml(product.artist)} / ${product.publishStatus}</span>
              </article>
            `
          )
          .join("")}
      </div>
    </div>
  `;
}

async function adminArtistsPage({ embedded = false } = {}) {
  const artists = await catalogService.listAdminArtists();
  const visibleArtists = sortItems(
    filterItems(artists, "artists", (artist) => [artist.name, artist.status, artist.bio]),
    state.adminSort.artists,
    {
      name: (artist) => artist.name,
      status: (artist) => artist.status,
      sort: (artist) => artist.sort
    }
  );
  return `
    ${embedded ? "" : adminHero("Artists", "Manage artist names and editorial notes for the public artist index.")}
    <div class="admin-workspace">
      <form class="admin-panel" data-admin-artist-form>
        ${input("name", "Artist name", "", "Artist / maker")}
        <label>Bio<textarea name="bio" rows="4"></textarea></label>
        ${select("status", "Status", ["Draft", "Published", "Archived"], "Published")}
        <button class="button button-dark" type="submit">Save artist</button>
      </form>
      <div class="admin-panel">
        ${adminListControls("artists", "Search artists", [
          ["name", "Artist"],
          ["status", "Status"],
          ["sort", "Sort"]
        ])}
        ${table(
          ["Artist", "Status", "Bio"],
          visibleArtists.map((artist) => [escapeHtml(artist.name), statusPill(artist.status), escapeHtml(artist.bio || "-")])
        )}
      </div>
    </div>
  `;
}

async function adminCollectionsPage({ embedded = false } = {}) {
  const collections = await catalogService.listCollections();
  const visibleCollections = sortItems(
    filterItems(collections, "collections", (collection) => [
      collection.title,
      collection.type,
      collection.status,
      collection.sort
    ]),
    state.adminSort.collections,
    {
      title: (collection) => collection.title,
      type: (collection) => collection.type,
      status: (collection) => collection.status,
      sort: (collection) => collection.sort
    }
  );
  return `
    ${embedded ? "" : adminHero("Collections", "Manage categories, campaign groupings, and editorial shelves.")}
    <div class="admin-workspace">
      <form class="admin-panel" data-admin-collection-form>
        ${input("title", "Collection title", "", "Records")}
        ${select("type", "Type", ["Category", "Campaign", "Shelf", "Drop"], "Category")}
        ${select("status", "Status", ["Draft", "Published", "Archived"], "Published")}
        ${input("sort", "Sort", collections.length + 1, "1", "number")}
        <button class="button button-dark" type="submit">Save collection</button>
      </form>
      <div class="admin-panel">
        ${adminListControls("collections", "Search collections", [
          ["sort", "Sort"],
          ["title", "Title"],
          ["type", "Type"],
          ["status", "Status"]
        ])}
        ${table(
          ["Title", "Type", "Status", "Sort"],
          visibleCollections.map((collection) => [
            escapeHtml(collection.title),
            collection.type,
            statusPill(collection.status),
            collection.sort
          ])
        )}
      </div>
    </div>
  `;
}

async function adminRequestsPage({ embedded = false } = {}) {
  const requests = await catalogService.listRequests();
  const visibleRequests = sortItems(
    filterItems(requests, "requests", (request) => [
      request.id,
      request.artistName,
      request.itemName,
      request.format,
      request.email,
      request.status
    ]),
    state.adminSort.requests,
    {
      id: (request) => request.id,
      artist: (request) => request.artistName,
      item: (request) => request.itemName,
      format: (request) => request.format,
      status: (request) => request.status
    }
  );
  return `
    ${embedded ? "" : adminHero("Request Inbox", "Track customer item requests from new lead to closed conversation.")}
    <div>
      ${adminListControls("requests", "Search requests", [
        ["status", "Status"],
        ["artist", "Artist"],
        ["item", "Item"],
        ["format", "Format"],
        ["id", "Request ID"]
      ])}
      ${table(
        ["Request", "Customer", "Item", "Notes", "Status"],
        visibleRequests.map((request) => [
          request.id,
          `${escapeHtml(request.email)}<br><small>${escapeHtml(request.whatsapp || "-")}</small>`,
          `<strong>${escapeHtml(request.artistName)}</strong><br>${escapeHtml(request.itemName)} / ${request.format}`,
          escapeHtml(request.notes || "-"),
          statusSelect("request", request.id, request.status, requestStatuses)
        ])
      )}
    </div>
  `;
}

async function adminPreviewPage({ embedded = false } = {}) {
  return `<div class="admin-home-preview">${await homePage()}</div>`;
}

async function previewProductDetailPage(path) {
  const id = decodeURIComponent(path.replace("/admin/preview/product/", ""));
  const product = await catalogService.getProduct(id, { includeDrafts: true });
  if (!product) return notFoundPage();
  return productDetailMarkup(product);
}

async function inventoryPage() {
  const items = await catalogService.listInventory();
  return `
    ${adminHero("Inventory", "Track stock counts, locations, and low stock states.")}
    <section class="section">
      ${table(
        ["SKU", "Product", "Format", "Location", "Stock", "Status"],
        items.map((item) => [
          item.sku,
          item.product?.title || "Unknown",
          item.product?.format || "-",
          item.location,
          item.stock,
          `<span class="status ${item.status.toLowerCase().replaceAll(" ", "-")}">${item.status}</span>`
        ])
      )}
    </section>
  `;
}

async function ordersPage({ embedded = false } = {}) {
  const orders = await catalogService.listOrders();
  const visibleOrders = sortItems(
    filterItems(orders, "orders", (order) => [
      order.id,
      order.customer,
      order.channel,
      order.status,
      order.date,
      order.total,
      order.products.map((product) => `${product.sku} ${product.artist} ${product.title}`).join(" ")
    ]),
    state.adminSort.orders,
    {
      date: (order) => order.date,
      customer: (order) => order.customer,
      status: (order) => order.status,
      total: (order) => order.total,
      id: (order) => order.id
    }
  );
  return `
    ${embedded ? "" : adminHero("Orders", "Sample order workflow across web, social, and walk-in channels.")}
    <div>
      ${adminListControls("orders", "Search orders, SKU, artist, album", [
        ["date", "Date"],
        ["customer", "Customer"],
        ["status", "Status"],
        ["total", "Total"],
        ["id", "Order ID"]
      ])}
      ${table(
        ["Order", "Customer", "Channel", "Items", "Status", "Total"],
        visibleOrders.map((order) => [
          order.id,
          order.customer,
          order.channel,
          order.products.map((product) => product.title).join(", "),
          statusSelect("order", order.id, order.status, ["New", "Paid", "Packing", "Shipped", "Closed", "Refunded"]),
          money.format(order.total)
        ])
      )}
    </div>
  `;
}

async function cashflowPage() {
  const rows = await catalogService.listCashflow();
  const max = Math.max(...rows.map((row) => row.revenue));
  return `
    ${adminHero("Cashflow", "Revenue, expenses, and net cash movement prepared as a future finance view.")}
    <section class="section cashflow-view">
      <div class="chart">
        ${rows
          .map(
            (row) => `
              <div class="bar-row">
                <span>${row.month}</span>
                <div class="bar-track">
                  <i style="width: ${(row.revenue / max) * 100}%"></i>
                </div>
                <strong>${money.format(row.net)}</strong>
              </div>
            `
          )
          .join("")}
      </div>
      ${table(
        ["Month", "Revenue", "Expenses", "Net"],
        rows.map((row) => [row.month, money.format(row.revenue), money.format(row.expenses), money.format(row.net)])
      )}
    </section>
  `;
}

async function reportsPage() {
  const [products, orders, inventory] = await Promise.all([
    catalogService.listProducts(),
    catalogService.listOrders(),
    catalogService.listInventory()
  ]);
  return `
    ${adminHero("Reports", "Summary reports for products, formats, sales, and inventory conditions.")}
    <section class="section report-grid">
      ${metric("Products", products.length)}
      ${metric("Record formats", new Set(products.filter((p) => p.category === "Records").map((p) => p.format)).size)}
      ${metric("Orders", orders.length)}
      ${metric("Low stock SKUs", inventory.filter((item) => item.stock <= item.lowStockAt).length)}
    </section>
  `;
}

function adminHero(title, text) {
  const workspace = workspaceForPath(normalizePath(location.pathname));
  const label = workspace === "finance" ? "NIXP Finance" : "NIXP Admin";
  const session = state.auth.authenticated
    ? ` Signed in as ${escapeHtml(state.auth.username || workspace)}. <button class="link-button" type="button" data-auth-logout>Logout</button>`
    : "";
  return pageHero({ eyebrow: label, title, text: `${text}${session}` });
}

function metric(label, value) {
  return `<article class="metric"><span>${label}</span><strong>${value}</strong></article>`;
}

function input(name, label, value = "", placeholder = "", type = "text") {
  return `
    <label>${label}
      <input name="${name}" type="${type}" value="${escapeAttr(value)}" placeholder="${placeholder}" />
    </label>
  `;
}

function select(name, label, options, value = "") {
  return `
    <label>${label}
      <select name="${name}">
        ${options.map((option) => `<option ${option === value ? "selected" : ""}>${option}</option>`).join("")}
      </select>
    </label>
  `;
}

function statusPill(status) {
  return `<span class="status ${String(status).toLowerCase().replaceAll(" ", "-")}">${status}</span>`;
}

function statusSelect(type, id, value, options) {
  return `
    <select class="status-select" data-admin-status="${type}" data-id="${id}">
      ${options.map((option) => `<option ${option === value ? "selected" : ""}>${option}</option>`).join("")}
    </select>
  `;
}

function isSizeSoldOut(size) {
  const quantity = Number(size.quantity ?? size.qty ?? (size.soldOut ? 0 : 1));
  return size.soldOut || quantity <= 0;
}

function sizeInventoryFields(product = {}) {
  const sizeOptions = ["S", "M", "L", "XL", "XXL", "7", "9", "11"];
  const savedSizes = new Map((product.sizes || []).map((size) => [size.label, size]));
  return `
    <fieldset class="admin-size-fieldset">
      <legend>Size quantity</legend>
      <div class="admin-size-grid">
        ${sizeOptions
          .map((label) => {
            const saved = savedSizes.get(label);
            const quantity = saved ? Number(saved.quantity ?? saved.qty ?? (saved.soldOut ? 0 : 1)) : "";
            return `
              <label>${label}
                <input name="sizeQty:${label}" type="number" min="0" step="1" value="${escapeAttr(quantity)}" />
              </label>
            `;
          })
          .join("")}
      </div>
    </fieldset>
  `;
}

function sortHeader(scope, key, label) {
  const current = state.adminSort[scope] || "";
  const activeKey = current.replace(":desc", "");
  const isActive = activeKey === key;
  const direction = current.endsWith(":desc") ? "desc" : "asc";
  const marker = isActive ? (direction === "desc" ? "↓" : "↑") : "";
  return `<button class="table-sort-button ${isActive ? "is-active" : ""}" type="button" data-scope="${scope}" data-admin-sort-button="${key}">${label}${marker ? ` ${marker}` : ""}</button>`;
}

function adminListControls(scope, placeholder, sortOptions) {
  return `
    <div class="admin-list-tools" data-admin-list-tools="${scope}">
      <label class="admin-search">
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <circle cx="10.5" cy="10.5" r="6.5"></circle>
          <path d="M15.5 15.5L21 21"></path>
        </svg>
        <input
          type="search"
          value="${escapeAttr(state.adminSearch[scope] || "")}"
          placeholder="${placeholder}"
          data-admin-search="${scope}"
        />
      </label>
      <label class="admin-sort">Sort
        <select data-admin-sort="${scope}">
          ${sortOptions
            .map(([value, label]) => `<option value="${value}" ${state.adminSort[scope] === value ? "selected" : ""}>${label}</option>`)
            .join("")}
        </select>
      </label>
    </div>
  `;
}

function filterItems(items, scope, fields) {
  const query = String(state.adminSearch[scope] || "").trim().toLowerCase();
  if (!query) return items;
  return items.filter((item) => fields(item).join(" ").toLowerCase().includes(query));
}

function recordLabelMarkup(product) {
  if (product.category !== "Records" || !product.label) return escapeHtml(product.label || "-");
  return `<a class="record-label-link" href="/records?label=${encodeURIComponent(product.label)}" data-link>${escapeHtml(product.label)}</a>`;
}

function productImages(product) {
  const images = [
    ...(Array.isArray(product.images) ? product.images : []),
    product.image
  ]
    .map((image) => String(image || "").trim())
    .filter(Boolean);
  return [...new Set(images)].slice(0, 5);
}

function galleryUploadFields(product = {}, title = "Upload gallery") {
  const currentImages = productImages(product);
  return `
    <fieldset class="admin-gallery-fieldset">
      <legend>${title}</legend>
      <div class="admin-gallery-slots">
        ${Array.from({ length: 5 }, (_, index) => {
          const slot = index + 1;
          const currentImage = currentImages[index] || "";
          return `
            <label>
              <span>${slot}</span>
              <input name="imageFile${slot}" type="file" accept="image/*" />
              ${currentImage ? `<em>${escapeHtml(currentImage)}</em>` : ""}
            </label>
          `;
        }).join("")}
      </div>
      <p class="admin-form-note">Upload 1-5 images. Public product pages show them in this order.</p>
    </fieldset>
  `;
}

function galleryFilesFromForm(form) {
  return Array.from({ length: 5 }, (_, index) => ({
    index,
    file: form.elements[`imageFile${index + 1}`]?.files?.[0]
  })).filter((slot) => slot.file);
}

async function uploadGallerySlots(form, product = {}) {
  const slots = galleryFilesFromForm(form);
  const currentImages = productImages(product).slice(0, 5);
  if (!slots.length) return currentImages;

  for (const slot of slots) {
    currentImages[slot.index] = await adminStore.uploadProductImage(slot.file, product);
  }

  return currentImages
    .map((image) => String(image || "").trim())
    .filter(Boolean)
    .slice(0, 5);
}

function setFormMessage(form, message, tone = "") {
  const target = form.querySelector("[data-admin-form-message]");
  if (!target) return;
  target.textContent = message;
  target.dataset.tone = tone;
}

function sortItems(items, key, sorters) {
  const rawKey = String(key || "");
  const isDesc = rawKey.endsWith(":desc");
  const sortKey = rawKey.replace(":desc", "");
  const sorter = sorters[sortKey] || sorters.title || sorters.name || ((item) => item.id);
  return [...items].sort((a, b) => {
    const av = sorter(a);
    const bv = sorter(b);
    const result =
      typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av || "").localeCompare(String(bv || ""), undefined, { numeric: true });
    return isDesc ? -result : result;
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function notFoundPage() {
  return pageHero({
    eyebrow: "404",
    title: "Page not found",
    text: "This route is not part of the NIXP prototype yet.",
    actionHref: "/",
    actionLabel: "Return home"
  });
}

function bindEvents() {
  document.querySelector("[data-login-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const message = form.querySelector("[data-login-message]");
    const data = Object.fromEntries(new FormData(form).entries());
    message.textContent = "Checking login...";
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspace: form.dataset.workspace,
          username: data.username,
          password: data.password
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Login failed");
      state.auth = { loaded: true, authenticated: true, workspace: payload.workspace, username: payload.username };
      history.pushState({}, "", form.dataset.next || (payload.workspace === "finance" ? "/finance" : "/admin"));
      render();
    } catch (error) {
      message.textContent = error instanceof Error ? error.message : "Login failed";
    }
  });

  document.querySelectorAll("[data-auth-logout]").forEach((button) => {
    button.addEventListener("click", async () => {
      await fetch("/api/auth/logout", { method: "POST" });
      state.auth = { loaded: true, authenticated: false, workspace: null, username: null };
      history.pushState({}, "", "/");
      render();
    });
  });

  document.querySelectorAll("[data-link]").forEach((link) => {
    link.addEventListener("click", (event) => {
      const href = link.getAttribute("href");
      if (!href || href.startsWith("http") || href.startsWith("mailto:")) return;
      event.preventDefault();
      state.zoomedProductId = null;
      history.pushState({}, "", href);
      render();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });

  document.querySelector("[data-nav-toggle]")?.addEventListener("click", () => {
    document.querySelector(".site-header")?.classList.toggle("is-open");
  });

  document.querySelector("[data-cart-open]")?.addEventListener("click", () => {
    state.cartOpen = true;
    render();
  });

  document.querySelector("[data-search-open]")?.addEventListener("click", () => {
    state.searchOpen = true;
    render();
  });

  document.querySelectorAll("[data-search-close]").forEach((button) => {
    button.addEventListener("click", () => {
      state.searchOpen = false;
      render();
    });
  });

  bindSearch();

  document.querySelectorAll("[data-cart-close]").forEach((button) => {
    button.addEventListener("click", () => {
      state.cartOpen = false;
      render();
    });
  });

  document.querySelectorAll("[data-record-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.recordsFilter = button.dataset.recordFilter;
      render();
    });
  });

  document.querySelectorAll("[data-apparel-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.apparelFilter = button.dataset.apparelFilter;
      render();
    });
  });

  document.querySelectorAll("[data-size-option]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedSizes[button.dataset.sizeOption] = button.dataset.sizeValue;
      render();
    });
  });

  document.querySelectorAll("[data-product-zoom]").forEach((button) => {
    button.addEventListener("click", () => {
      state.zoomedProductId = state.zoomedProductId === button.dataset.productZoom ? null : button.dataset.productZoom;
      render();
    });
  });

  document.querySelectorAll("[data-add-cart]").forEach((button) => {
    button.addEventListener("click", () => {
      state.cart.push(button.dataset.addCart);
      localStorage.setItem("nixp-cart", JSON.stringify(state.cart));
      state.cartOpen = true;
      render();
    });
  });

  document.querySelectorAll("[data-remove-cart]").forEach((button) => {
    button.addEventListener("click", () => {
      const index = state.cart.indexOf(button.dataset.removeCart);
      if (index >= 0) state.cart.splice(index, 1);
      localStorage.setItem("nixp-cart", JSON.stringify(state.cart));
      render();
    });
  });

  document.querySelector("[data-admin-new-product]")?.addEventListener("click", () => {
    state.adminEditingProductId = null;
    render();
  });

  document.querySelectorAll("[data-admin-edit-product]").forEach((button) => {
    button.addEventListener("click", () => {
      state.adminEditingProductId = button.dataset.adminEditProduct;
      render();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });

  document.querySelectorAll("[data-admin-product-status]").forEach((button) => {
    button.addEventListener("click", () => {
      adminStore.updateProductStatus(button.dataset.adminProductStatus, button.dataset.status);
      render();
    });
  });

  document.querySelectorAll("[data-admin-search]").forEach((input) => {
    input.addEventListener("input", async () => {
      const scope = input.dataset.adminSearch;
      state.adminSearch[scope] = input.value;
      await render();
      const nextInput = document.querySelector(`[data-admin-search="${scope}"]`);
      nextInput?.focus();
      nextInput?.setSelectionRange(nextInput.value.length, nextInput.value.length);
    });
  });

  document.querySelectorAll("[data-admin-sort]").forEach((selectEl) => {
    selectEl.addEventListener("change", async () => {
    state.adminSort[selectEl.dataset.adminSort] = selectEl.value;
      await render();
    });
  });

  document.querySelectorAll("[data-admin-sort-button]").forEach((button) => {
    button.addEventListener("click", async () => {
      const scope = button.dataset.scope;
      const key = button.dataset.adminSortButton;
      const current = state.adminSort[scope];
      state.adminSort[scope] = current === key ? `${key}:desc` : key;
      await render();
    });
  });

  document.querySelector("[data-admin-product-form] select[name='category']")?.addEventListener("change", (event) => {
    const form = event.currentTarget.closest("[data-admin-product-form]");
    const isProductCategory = event.currentTarget.value === "Apparel" || event.currentTarget.value === "Objects";
    form.querySelector("[data-admin-record-fields]").hidden = isProductCategory;
    form.querySelector("[data-admin-product-fields]").hidden = !isProductCategory;
    form.querySelector("[data-admin-apparel-field]").hidden = event.currentTarget.value !== "Apparel";
    if (isProductCategory) {
      form.elements.artist.value ||= event.currentTarget.value === "Objects" ? "NIXP Objects" : "NIXP Apparel";
      form.elements.format.value = event.currentTarget.value.replace(/s$/, "");
      form.elements.displayFormat.value = "";
    }
  });

  document.querySelector("[data-admin-product-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    setFormMessage(form, "Saving product...");
    try {
      const data = Object.fromEntries(new FormData(form).entries());
      const existing = state.adminEditingProductId
        ? await catalogService.getProduct(state.adminEditingProductId, { includeDrafts: true })
        : {};
      const baseGallery = productImages({
        ...existing,
        image: data.image?.trim() || existing?.image
      });
      const gallery = await uploadGallerySlots(form, { ...data, images: baseGallery });
      if (gallery.length) {
        data.images = gallery;
        data.image = gallery[0];
      }
      const saved = await adminStore.saveProduct(data);
      state.adminEditingProductId = saved.id;
      setFormMessage(form, "Saved.", "success");
      await render();
    } catch (error) {
      setFormMessage(form, error instanceof Error ? error.message : "Could not save product.", "error");
      submitButton.disabled = false;
    }
  });

  document.querySelector("[data-admin-media-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    setFormMessage(form, "Updating images...");
    try {
      const data = Object.fromEntries(new FormData(form).entries());
      const product = await catalogService.getProduct(data.productId, { includeDrafts: true });
      if (!product) throw new Error("Product was not found.");
      const baseGallery = productImages({
        ...product,
        image: data.image?.trim() || product.image
      });
      const gallery = await uploadGallerySlots(form, { ...product, images: baseGallery });
      await adminStore.saveProduct({
        ...product,
        image: gallery[0] || product.image,
        images: gallery
      });
      setFormMessage(form, "Images updated.", "success");
      await render();
    } catch (error) {
      setFormMessage(form, error instanceof Error ? error.message : "Could not update images.", "error");
      submitButton.disabled = false;
    }
  });

  document.querySelector("[data-admin-artist-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    adminStore.saveArtist(Object.fromEntries(new FormData(event.currentTarget).entries()));
    event.currentTarget.reset();
    render();
  });

  document.querySelector("[data-admin-collection-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    adminStore.saveCollection(Object.fromEntries(new FormData(event.currentTarget).entries()));
    event.currentTarget.reset();
    render();
  });

  document.querySelectorAll("[data-admin-status]").forEach((selectEl) => {
    selectEl.addEventListener("change", () => {
      if (selectEl.dataset.adminStatus === "request") {
        adminStore.updateRequestStatus(selectEl.dataset.id, selectEl.value);
      }
      if (selectEl.dataset.adminStatus === "order") {
        adminStore.updateOrderStatus(selectEl.dataset.id, selectEl.value);
      }
      render();
    });
  });

  document.querySelector("[data-request-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    state.requests.push({
      id: `REQ-${String(100 + state.requests.length)}`,
      artistName: form.get("artistName"),
      itemName: form.get("itemName"),
      format: form.get("format"),
      email: form.get("email"),
      whatsapp: form.get("whatsapp"),
      notes: form.get("notes"),
      status: "New"
    });
    event.currentTarget.reset();
    render();
  });
}

function bindSearch() {
  const input = document.querySelector("[data-search-input]");
  const results = document.querySelector("[data-search-results]");
  const hint = document.querySelector("[data-search-hint]");
  const dataEl = document.querySelector("[data-search-data]");
  if (!input || !results || !dataEl) return;

  const suggestions = JSON.parse(dataEl.textContent || "[]");
  const renderSearch = () => {
    const query = input.value.trim().toLowerCase();
    if (query.length < 3) {
      results.innerHTML = "";
      hint.textContent = "Suggestions appear after the first 3 letters.";
      return;
    }

    const matches = suggestions
      .filter((item) => `${item.title} ${item.meta} ${item.type}`.toLowerCase().includes(query))
      .slice(0, 8);

    hint.textContent = matches.length ? `${matches.length} suggestion${matches.length > 1 ? "s" : ""}` : "No suggestions found.";
    results.innerHTML = matches
      .map(
        (item) => `
          <a class="search-result" href="${item.href}" data-link>
            <span>${item.type}</span>
            <strong>${item.title}</strong>
            <em>${item.meta}</em>
          </a>
        `
      )
      .join("");

    results.querySelectorAll("[data-link]").forEach((link) => {
      link.addEventListener("click", (event) => {
        event.preventDefault();
        state.searchOpen = false;
        history.pushState({}, "", link.getAttribute("href"));
        render();
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    });
  };

  input.addEventListener("input", renderSearch);
  if (state.searchOpen) setTimeout(() => input.focus(), 0);
}

window.addEventListener("popstate", render);
adminStore.initialize().then(render);
