import { requestStatuses } from "./data/sampleData.js";
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
  zoomedProductId: null
};

const routes = {
  "/": homePage,
  "/records": recordsPage,
  "/objects": categoryPage("Objects", "Objects", "Objects and editions made for rooms, shelves, and listening rituals."),
  "/apparel": apparelPage,
  "/publishing": categoryPage("Publishing", "Publishing", "Printed matter, books, magazines, and text-led editions."),
  "/artists": artistsPage,
  "/blog": blogPage,
  "/request-item": requestItemPage,
  "/about": aboutPage,
  "/contact": contactPage,
  "/shipping-returns": shippingReturnsPage,
  "/cart": cartPage,
  "/login": loginPage,
  "/admin": adminDashboardPage,
  "/admin/inventory": inventoryPage,
  "/admin/orders": ordersPage,
  "/admin/cashflow": cashflowPage,
  "/admin/reports": reportsPage
};

async function render() {
  const path = normalizePath(location.pathname);
  const view = path.startsWith("/product/")
    ? productDetailPage
    : path.startsWith("/artists/")
      ? artistProductsPage
      : routes[path] || notFoundPage;
  const content = await view(path);
  document.body.classList.toggle("page-lock", path === "/about" || path === "/contact");
  app.innerHTML = shell(content, path, state.cart.length, await cartDrawer(), await searchOverlay());
  bindEvents();
}

function normalizePath(path) {
  if (path.length > 1 && path.endsWith("/")) return path.slice(0, -1);
  return path;
}

async function homePage() {
  const products = await catalogService.listProducts();
  const slides = Array.from({ length: 10 }, (_, index) => products[index % products.length]);
  const marqueeSlides = [...slides, ...slides];
  return `
    <section class="home-slider" aria-label="Product slider">
      <div class="slider-viewport">
        <div class="slider-track">
          ${marqueeSlides
          .map(
            (product, index) => `
              <article class="slide">
                <a href="/product/${product.id}" data-link>
                  <figure class="product-art slide-art">
                    <img src="${product.image}" alt="${product.title}" />
                  </figure>
                  <div class="slide-caption">
                    <span>${String((index % 10) + 1).padStart(2, "0")}</span>
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
  const records = await catalogService.listRecords(state.recordsFilter);
  const filters = ["All", "Vinyl", "CD", "Cassette"];
  return `
    <section class="section shop-section">
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

async function apparelPage() {
  const apparel = await catalogService.listApparel(state.apparelFilter);
  const filters = ["All Apparel", "Tops", "Bottoms", "Accessories"];
  return `
    <section class="section shop-section">
      <div class="toolbar" role="group" aria-label="Apparel filters">
        ${filters
          .map(
            (filter) => `
              <button class="chip ${state.apparelFilter === filter ? "is-active" : ""}" type="button" data-apparel-filter="${filter}">
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

  const related = (await catalogService.listProducts())
    .filter((item) => item.category === product.category && item.id !== product.id)
    .slice(0, 4);
  const displayFormat = product.displayFormat || product.format;
  const isApparel = product.category === "Apparel";
  const selectedSize =
    state.selectedSizes[product.id] ||
    product.sizes?.find((size) => !size.soldOut)?.label ||
    "";

  return `
    <section class="product-detail">
      <div class="detail-gallery">
        <button
          class="zoom-trigger ${state.zoomedProductId === product.id ? "is-zoomed" : ""}"
          type="button"
          data-product-zoom="${product.id}"
          aria-label="Zoom ${product.title}"
          aria-pressed="${state.zoomedProductId === product.id ? "true" : "false"}"
        >
          <figure class="product-art product-art-large ${isApparel ? "product-art-apparel" : ""}">
            <img src="${product.image}" alt="${product.title}" />
          </figure>
        </button>
        <div class="detail-thumbs">
          <figure class="product-art ${isApparel ? "product-art-apparel" : ""}"><img src="${product.image}" alt="${product.title} detail A" /></figure>
          <figure class="product-art ${isApparel ? "product-art-apparel" : ""}"><img src="${product.image}" alt="${product.title} detail B" /></figure>
        </div>
      </div>
      <aside class="detail-copy">
        <a class="back-link" href="/${product.category.toLowerCase()}" data-link>${product.category}</a>
        <p class="eyebrow">${product.artist}</p>
        <h1>${product.title}</h1>
        <div class="detail-price">${money.format(product.price)}</div>
        <p>${product.description}</p>
        ${
          isApparel
            ? `<div class="size-picker" aria-label="Available sizes">
                ${product.sizes
                  .map(
                    (size) => `
                      <button
                        type="button"
                        data-size-option="${product.id}"
                        data-size-value="${size.label}"
                        ${size.soldOut ? "disabled" : ""}
                        class="${[
                          size.soldOut ? "is-sold-out" : "",
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
              : `<div><dt>Format</dt><dd>${displayFormat}</dd></div>
                 <div><dt>Label</dt><dd>${product.label}</dd></div>
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
          <p>Operating from Aesthetic Pleasure Gallery in Jakarta, NIXP functions as both a record store and listening space, with a selection that moves across contemporary music, experimental publishing and independent culture without separating them into disciplines.</p>
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
      meta: `${product.artist} / ${product.displayFormat || product.format}`,
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

function loginPage() {
  return `
    ${pageHero({
      eyebrow: "Private",
      title: "Login",
      text: "Admin authentication placeholder. Supabase Auth can connect here later."
    })}
    <section class="section login-panel">
      <form>
        <label>Email:<input type="email" value="admin@nixp.local" /></label>
        <label>Password:<input type="password" value="prototype" /></label>
        <a class="button button-dark" href="/admin" data-link>Enter admin</a>
      </form>
    </section>
  `;
}

async function adminDashboardPage() {
  const [inventory, orders, requests] = await Promise.all([
    catalogService.listInventory(),
    catalogService.listOrders(),
    catalogService.listRequests()
  ]);
  const stockUnits = inventory.reduce((sum, item) => sum + item.stock, 0);
  const orderValue = orders.reduce((sum, order) => sum + order.total, 0);
  return `
    ${adminHero("Admin Dashboard", "Operations snapshot for catalog, stock, orders, requests, and shop health.")}
    <section class="section metric-grid">
      ${metric("Stock units", stockUnits)}
      ${metric("Open orders", orders.filter((order) => order.status !== "Closed").length)}
      ${metric("Requests", requests.length)}
      ${metric("Order value", money.format(orderValue))}
    </section>
  `;
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

async function ordersPage() {
  const orders = await catalogService.listOrders();
  return `
    ${adminHero("Orders", "Sample order workflow across web, social, and walk-in channels.")}
    <section class="section">
      ${table(
        ["Order", "Customer", "Channel", "Items", "Status", "Total"],
        orders.map((order) => [
          order.id,
          order.customer,
          order.channel,
          order.products.map((product) => product.title).join(", "),
          order.status,
          money.format(order.total)
        ])
      )}
    </section>
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
  return pageHero({ eyebrow: "NIXP Admin", title, text });
}

function metric(label, value) {
  return `<article class="metric"><span>${label}</span><strong>${value}</strong></article>`;
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
render();
