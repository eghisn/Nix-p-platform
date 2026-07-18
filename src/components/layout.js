const leftPublicLinks = [
  ["Records", "/records"],
  ["Objects", "/objects"],
  ["Apparel", "/apparel"],
  ["Publishing", "/publishing"],
  ["Artists", "/artists"]
];

const rightPublicLinks = [
  ["Blog", "/blog"],
  ["Request Item", "/request-item"]
];

const adminLinks = [
  ["Dashboard", "/admin"],
  ["Editor", "/admin/editor"],
  ["Products", "/admin/products"],
  ["Requests", "/admin/requests"],
  ["Orders", "/admin/orders"],
  ["Preview", "/admin/preview"]
];

const financeLinks = [
  ["Cashflow", "/finance"],
  ["Reports", "/finance/cashflow"]
];

const idr = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0
});

export function shell(content, path, cartCount = 0, cartDrawer = "", searchOverlay = "") {
  const isAdmin = path.startsWith("/admin") && !path.startsWith("/admin/preview");
  const isFinance = path.startsWith("/finance");
  const loginWorkspace =
    path === "/login" && typeof location !== "undefined"
      ? new URLSearchParams(location.search).get("workspace")
      : "";
  const isPrivate = isAdmin || isFinance || path === "/login";
  const isFinanceShell = isFinance || loginWorkspace === "finance";
  const privateLinks = isFinanceShell ? financeLinks : adminLinks;
  const logoHref = isFinanceShell ? "/finance" : isAdmin ? "/admin" : "/";

  return `
    <header class="site-header">
      <button class="nav-toggle" type="button" aria-label="Open navigation" aria-expanded="false" data-nav-toggle>
        <span class="nav-toggle-mark" aria-hidden="true"><i></i><i></i><i></i></span>
      </button>
      <nav class="site-nav site-nav-left" data-nav-left>
        ${
          isPrivate
            ? privateLinks.map(([label, href]) => navLink(label, href, path)).join("")
            : leftPublicLinks.map(([label, href]) => navLink(label, href, path)).join("")
        }
      </nav>
      <a class="brand" href="${logoHref}" data-link aria-label="NIXP home">
        <img src="/public/nixp-logo.png" alt="NIXP" />
      </a>
      <nav class="site-nav site-nav-right" data-nav-right>
        ${
          isPrivate
            ? `<a href="/" data-link>Public site</a>`
            : `${rightPublicLinks.map(([label, href]) => navLink(label, href, path)).join("")}
              <button class="cart-trigger" type="button" data-cart-open>Cart <span>${cartCount}</span></button>
              <button class="search-trigger" type="button" aria-label="Search" data-search-open>
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <circle cx="10.5" cy="10.5" r="6.5"></circle>
                  <path d="M15.5 15.5L21 21"></path>
                </svg>
              </button>`
        }
      </nav>
    </header>
    <main>${content}</main>
    ${cartDrawer}
    ${searchOverlay}
    <footer class="site-footer">
      <nav class="footer-left">
        <a href="/about" data-link>About</a>
        <a href="/contact" data-link>Contact</a>
      </nav>
      <nav class="footer-right" aria-label="Social links">
        <a href="https://www.instagram.com/nixp.archive/?hl=en" aria-label="Instagram">
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <rect x="4" y="4" width="16" height="16" rx="4"></rect>
            <circle cx="12" cy="12" r="3.5"></circle>
            <path d="M16.6 7.4h.01"></path>
          </svg>
        </a>
        <a href="https://www.youtube.com/@nixp" aria-label="YouTube">
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M5.5 7.5C6 6.8 7 6.6 12 6.6s6 .2 6.5.9c.5.7.7 1.6.7 4.5s-.2 3.8-.7 4.5c-.5.7-1.5.9-6.5.9s-6-.2-6.5-.9c-.5-.7-.7-1.6-.7-4.5s.2-3.8.7-4.5Z"></path>
            <path d="M10.6 9.4v5.2l4.5-2.6-4.5-2.6Z"></path>
          </svg>
        </a>
        <a href="https://www.tiktok.com/@nixp" aria-label="TikTok">
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M14 4v10.2a4 4 0 1 1-3.4-4"></path>
            <path d="M14 4c.6 3 2.4 4.8 5.2 5.1"></path>
          </svg>
        </a>
      </nav>
    </footer>
  `;
}

function navLink(label, href, path) {
  const active = href === "/" ? path === "/" : path === href;
  return `<a href="${href}" data-link ${active ? `aria-current="page"` : ""}>${label}</a>`;
}

export function pageHero({ eyebrow, title, text, actionHref, actionLabel }) {
  return `
    <section class="admin-hero">
      <p class="eyebrow">${eyebrow}</p>
      <h1>${title}</h1>
      <p>${text}</p>
      ${actionHref ? `<a class="button button-dark" href="${actionHref}" data-link>${actionLabel}</a>` : ""}
    </section>
  `;
}

export function productGrid(products, options = {}) {
  if (!products.length) {
    return `<p class="empty-state">No products match this view yet.</p>`;
  }
  const availableArtistNames =
    options.availableArtistNames ||
    new Set(products.map((product) => String(product.artist || "").trim().toLowerCase()).filter(Boolean));

  return `
    <div class="product-grid">
      ${products.map((product) => productCard(product, { ...options, availableArtistNames })).join("")}
    </div>
  `;
}

export function productCard(product, { hrefFor, availableArtistNames } = {}) {
  const meta = product.condition ? `${product.displayFormat || product.format}/${product.condition}` : product.year;
  const artClass = product.category === "Apparel" ? "product-art product-art-apparel" : "product-art";
  const href = hrefFor ? hrefFor(product) : `/product/${product.id}`;
  const labelLink =
    product.category === "Records" && product.label
      ? `<a class="record-label-link" href="/records?label=${encodeURIComponent(product.label)}" data-link>${product.label}</a>`
      : "";

  return `
    <article class="product-card">
      <a class="product-link" href="${href}" data-link aria-label="View ${product.title}">
        <figure class="${artClass}">
          <img src="${product.image}" alt="${product.title}" />
        </figure>
      </a>
      <div class="product-meta">
        <p>${product.artist}</p>
        <h2><a href="${href}" data-link>${product.title}</a></h2>
        ${labelLink}
        ${recordArtistTags(product, availableArtistNames)}
        <div class="row-between">
          <span>${meta}</span>
          <strong>${idr.format(product.price)}</strong>
        </div>
        <button class="button button-outline" type="button" data-add-cart="${product.id}">Add to cart</button>
      </div>
    </article>
  `;
}

function recordArtistTags(product, availableArtistNames = new Set()) {
  if (product.category !== "Records" || !Array.isArray(product.relatedArtists) || !product.relatedArtists.length) return "";
  return `
    <div class="related-artist-tags related-artist-tags-card" aria-label="Related artists">
      ${product.relatedArtists
        .map((artist) => String(artist || "").trim())
        .filter(Boolean)
        .slice(0, 3)
        .map((artist) =>
          availableArtistNames.has(artist.toLowerCase())
            ? `<a href="/artists/${encodeURIComponent(artist)}" data-link>${escapeHtml(artist)}</a>`
            : `<span>${escapeHtml(artist)}</span>`
        )
        .join("")}
    </div>
  `;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function table(headers, rows) {
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>${headers.map((header) => `<th>${header}</th>`).join("")}</tr>
        </thead>
        <tbody>
          ${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}
        </tbody>
      </table>
    </div>
  `;
}
