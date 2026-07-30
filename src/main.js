import { requestStatuses } from "./data/sampleData.js";
import { artistCreditNames, artistIdentityKey, canonicalArtistName, canonicalLabelName } from "./data/catalogIdentity.js";
import { parsePublicProductPath, publicCategoryPath, publicProductPath, publicProductSlug } from "./data/publicUrls.js";
import { recommendedProducts } from "./data/productRecommendations.js";
import { indonesiaRegencies } from "./data/indonesiaRegencies.js";
import { adminStore } from "./services/adminStore.js";
import { catalogService } from "./services/catalogService.js";
import { pageHero, productGrid, shell, table } from "./components/layout.js";

const app = document.querySelector("#app");
const CHECKOUT_SESSION_STORAGE_KEY = "nixp-checkout-session";
let homeSliderCleanup = null;
let adminOrdersRefreshTimer = null;
let priceCache = { expiresAt: 0, prices: new Map() };
let renderRequestId = 0;
const money = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0
});

const state = {
  recordsFilter: "All",
  recordsSort: "artist-asc",
  homeCollectionFilter: "recent-releases",
  apparelFilter: "All Apparel",
  cart: readCart(),
  requests: [],
  cartOpen: false,
  checkoutMessage: "",
  checkoutTone: "",
  checkoutOrderToken: readCheckoutSession()?.orderId || "",
  requestNotice: "",
  requestNoticeTone: "",
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
  adminNotice: "",
  adminNoticeTone: "",
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

function readCart() {
  try {
    const parsed = JSON.parse(localStorage.getItem("nixp-cart") || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.map((id) => String(id || "").trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function persistCart() {
  localStorage.setItem("nixp-cart", JSON.stringify(state.cart));
}

function checkoutCartFingerprint(cart = state.cart) {
  return [...cart].sort().join("|");
}

function readCheckoutSession() {
  try {
    const session = JSON.parse(localStorage.getItem(CHECKOUT_SESSION_STORAGE_KEY) || "null");
    if (!session?.orderId || !session?.cartFingerprint || !session?.createdAt) return null;
    if (Date.now() - Number(session.createdAt) > 2 * 60 * 60 * 1000) return null;
    return session;
  } catch {
    return null;
  }
}

function getCheckoutOrderToken() {
  const fingerprint = checkoutCartFingerprint();
  const existing = readCheckoutSession();
  if (existing?.cartFingerprint === fingerprint) {
    state.checkoutOrderToken = existing.orderId;
    return existing.orderId;
  }
  const orderId = createCheckoutOrderToken();
  state.checkoutOrderToken = orderId;
  localStorage.setItem(CHECKOUT_SESSION_STORAGE_KEY, JSON.stringify({ orderId, cartFingerprint: fingerprint, createdAt: Date.now() }));
  return orderId;
}

function clearCheckoutSession() {
  state.checkoutOrderToken = "";
  localStorage.removeItem(CHECKOUT_SESSION_STORAGE_KEY);
}

function cartKey(productId, size = "") {
  const cleanId = String(productId || "").trim();
  const cleanSize = String(size || "").trim();
  return cleanSize ? `${cleanId}::${encodeURIComponent(cleanSize)}` : cleanId;
}

function parseCartKey(key) {
  const [productId, encodedSize = ""] = String(key || "").split("::");
  return {
    key: String(key || "").trim(),
    productId,
    size: encodedSize ? decodeURIComponent(encodedSize) : ""
  };
}

function cartItemQuantity(key) {
  return state.cart.filter((itemKey) => itemKey === key).length;
}

function setCartItemQuantity(key, quantity) {
  const cleanKey = String(key || "").trim();
  const cleanQuantity = Math.max(0, Math.floor(Number(quantity) || 0));
  state.cart = state.cart.filter((itemKey) => itemKey !== cleanKey);
  state.cart.push(...Array.from({ length: cleanQuantity }, () => cleanKey));
  clearCheckoutSession();
  persistCart();
}

function createCheckoutOrderToken() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

const homeCollectionOptions = [
  ["recent-releases", "Recent Releases"],
  ["nixp-selection", "NIXP Selection"],
  ["back-in-stock", "Back in Stock"],
  ["limited-pressing", "Limited Pressing"],
  ["private-collection", "Private Collection"]
];

const indonesiaRegionByCode = new Map(indonesiaRegencies.map((region) => [region.code, region]));

function checkoutCityOptions() {
  const byProvince = new Map();
  for (const region of indonesiaRegencies) {
    const cities = byProvince.get(region.province) || [];
    cities.push(region);
    byProvince.set(region.province, cities);
  }
  return [...byProvince.entries()]
    .map(
      ([province, cities]) =>
        `<optgroup label="${escapeAttr(province)}">${cities
          .map((region) => `<option value="${escapeAttr(region.code)}">${escapeHtml(region.city)}</option>`)
          .join("")}</optgroup>`
    )
    .join("");
}

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
  "/international-order": internationalOrderPage,
  "/cart": cartPage,
  "/order-status": customerOrderStatusPage,
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

async function render({ preserveScroll = false, scrollToTop = false } = {}) {
  const requestId = ++renderRequestId;
  const previousScrollTop = preserveScroll ? window.scrollY : 0;
  let path = normalizePath(location.pathname);
  await loadAuthSession();
  const legacyProduct = path.startsWith("/product/")
    ? adminStore.getProduct(decodeRoutePart(path.replace("/product/", "")), { includeDrafts: true })
    : null;
  if (legacyProduct) {
    const canonicalPath = publicProductPath(legacyProduct);
    if (canonicalPath !== path) {
      history.replaceState({}, "", canonicalPath);
      path = canonicalPath;
    }
  }
  const requiredWorkspace = workspaceForPath(path);
  const view =
    requiredWorkspace && !isWorkspaceRuntime(requiredWorkspace)
      ? privateWorkspacePage
      : requiredWorkspace && !hasWorkspaceAccess(requiredWorkspace)
        ? () => loginPage(requiredWorkspace, path)
        : path.startsWith("/product/") || parsePublicProductPath(path)
          ? productDetailPage
          : path.startsWith("/admin/preview/product/")
            ? previewProductDetailPage
            : path.startsWith("/artists/")
              ? artistProductsPage
              : routes[path] || notFoundPage;
  let content = "";
  try {
    content = await view(path);
  } catch (error) {
    content = routeErrorPage(requiredWorkspace, error);
  }
  if (requestId !== renderRequestId) return;
  const isLoginView = path === "/login" || (requiredWorkspace && !hasWorkspaceAccess(requiredWorkspace));
  document.body.classList.toggle("page-lock", path === "/" || path === "/about" || path === "/contact" || isLoginView);
  document.body.classList.toggle("login-lock", isLoginView);
  document.body.classList.toggle("preview-lock", path === "/admin/preview");
  const [drawerMarkup, searchMarkup] = await Promise.all([cartDrawer(), searchOverlay()]);
  const markup = shell(content, path, state.cart.length, drawerMarkup, searchMarkup);
  if (requestId !== renderRequestId) return;
  updateDocumentTitle(path);
  const commit = () => {
    app.innerHTML = markup;
    bindEvents();
  };
  const privateRoute = Boolean(requiredWorkspace);
  let commitDone = Promise.resolve();
  if (document.startViewTransition && !privateRoute) {
    const transition = document.startViewTransition(commit);
    commitDone = transition.updateCallbackDone || transition.ready || Promise.resolve();
  } else if (privateRoute) {
    commit();
  } else {
    app.classList.add("is-rendering");
    commit();
    requestAnimationFrame(() => app.classList.remove("is-rendering"));
  }
  await commitDone.catch(() => {});
  if (requestId !== renderRequestId) return;
  if (preserveScroll) window.scrollTo({ top: previousScrollTop, behavior: "auto" });
  else if (scrollToTop) window.scrollTo({ top: 0, behavior: "auto" });
  setupAdminOrdersLiveRefresh(path);
}

function updateDocumentTitle(path) {
  if (path.startsWith("/product/") || parsePublicProductPath(path)) {
    const product = findProductForPublicPath(path);
    document.title = product ? `${product.artist} - ${product.title} | NIXP` : "NIXP";
    return;
  }
  if (path.startsWith("/artists/")) {
    const artist = decodeRoutePart(path.replace("/artists/", "")).replace(/-/g, " ");
    document.title = `${artist.replace(/\b\w/g, (letter) => letter.toUpperCase())} | NIXP`;
    return;
  }
  const titles = {
    "/": "NIXP",
    "/records": "Records | NIXP",
    "/objects": "Objects | NIXP",
    "/apparel": "Apparel | NIXP",
    "/accessories": "Accessories | NIXP",
    "/accesories": "Accessories | NIXP",
    "/publishing": "Publishing | NIXP",
    "/artists": "Artists | NIXP",
    "/blog": "Blog | NIXP",
    "/request-item": "Request Item | NIXP",
    "/about": "About | NIXP",
    "/contact": "Contact | NIXP",
    "/cart": "Cart | NIXP"
  };
  document.title = titles[path] || (path.startsWith("/admin") ? "Admin | NIXP" : path.startsWith("/finance") ? "Finance | NIXP" : "NIXP");
}

function routeErrorPage(workspace, error) {
  const title = workspace ? "Workspace Could Not Load" : "Page Could Not Load";
  const message = error instanceof Error ? error.message : "Please refresh and try again.";
  return `
    ${workspace ? adminHero(title, "The route opened, but one section could not finish loading.") : ""}
    <section class="section">
      <div class="admin-panel admin-section-error">
        <div class="admin-panel-head">
          <h2>${escapeHtml(title)}</h2>
        </div>
        <p class="admin-form-note" data-tone="error">${escapeHtml(message)}</p>
      </div>
    </section>
  `;
}

async function loadAuthSession({ force = false } = {}) {
  if (state.auth.loaded && !force) return state.auth;
  if (!isLocalEditorHost() && !workspaceForHost()) {
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

function workspaceForHost() {
  const host = location.hostname.toLowerCase();
  if (host === "admin.nix-p.com") return "admin";
  if (host === "finance.nix-p.com") return "finance";
  return null;
}

function isWorkspaceRuntime(workspace) {
  return isLocalEditorHost() || workspaceForHost() === workspace;
}

function hasWorkspaceAccess(workspace) {
  return state.auth.authenticated && state.auth.workspace === workspace;
}

function isLocalEditorHost() {
  return ["localhost", "127.0.0.1", ""].includes(location.hostname);
}

function normalizePath(path) {
  const value = String(path || "/");
  const withLeadingSlash = value.startsWith("/") ? value : `/${value}`;
  return withLeadingSlash.replace(/\/+$/, "") || "/";
}

function decodeRoutePart(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function findProductForPublicPath(path, { includeDrafts = true } = {}) {
  if (path.startsWith("/product/")) {
    return adminStore.getProduct(decodeRoutePart(path.replace("/product/", "")), { includeDrafts });
  }
  const parsed = parsePublicProductPath(path);
  if (!parsed) return null;
  return adminStore
    .listProducts({ includeDrafts })
    .find((product) => publicCategoryPath(product) === parsed.categoryPath && publicProductSlug(product) === parsed.slug);
}

async function homePage() {
  const products = await catalogService.listProducts();
  const selectedCollection = homeCollectionOptions.some(([id]) => id === state.homeCollectionFilter)
    ? state.homeCollectionFilter
    : homeCollectionOptions[0][0];
  const collectionProducts = products
    .filter((product) => homeCollectionMatch(product, selectedCollection))
    .sort((a, b) => {
      const sortA = hasHomeSlideSort(a) ? Number(a.homeSlideSort) : 9999;
      const sortB = hasHomeSlideSort(b) ? Number(b.homeSlideSort) : 9999;
      return sortA - sortB || String(a.artist || "").localeCompare(String(b.artist || ""));
    });
  const featured = collectionProducts.filter((product) => product.image && !product.image.includes("nixp-product-example"));
  const slides = featured.length ? featured : products;
  const loopSlides = [...slides, ...slides];
  return `
    <section class="home-slider" aria-label="Product slider">
      <div class="home-collections" role="group" aria-label="Home collections">
        ${homeCollectionOptions
          .map(
            ([id, label]) => `
              <button class="home-collection-button ${selectedCollection === id ? "is-active" : ""}" type="button" data-home-collection="${id}">
                ${label}
              </button>
            `
          )
          .join("")}
      </div>
      <div class="slider-viewport" data-home-slider-viewport aria-roledescription="carousel" aria-label="Automatic product slider. Drag or swipe to browse.">
        ${
          featured.length || selectedCollection !== "private-collection"
            ? `<div class="slider-track" data-home-slider-track>
                ${loopSlides
                  .map(
                    (product, index) => `
                      <article class="slide">
                        <a href="${publicProductPath(product)}" data-link data-product-link>
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
              </div>`
            : `<div class="home-slider-empty"><span>Private Collection</span><strong>Open for future bid-only pieces.</strong></div>`
        }
      </div>
      ${
        featured.length || selectedCollection !== "private-collection"
          ? `<div class="slider-scrollbar" aria-label="Catalogue navigation">
              <button class="slider-scroll-button" type="button" aria-label="Previous catalogue items" data-home-slider-previous>&larr;</button>
              <div class="slider-scroll-rail" data-home-slider-control role="slider" aria-label="Browse catalogue" aria-valuemin="0" aria-valuemax="1000" aria-valuenow="0" tabindex="0">
                <span class="slider-scroll-thumb" data-home-slider-thumb></span>
              </div>
              <button class="slider-scroll-button" type="button" aria-label="Next catalogue items" data-home-slider-next>&rarr;</button>
            </div>`
          : ""
      }
    </section>
  `;
}

function homeCollectionMatch(product, collectionId) {
  if (collectionId === "recent-releases") {
    return product.category === "Records" && ["Vinyl", "CD", "Cassette"].includes(product.format) && [2025, 2026].includes(Number(product.year));
  }
  return Array.isArray(product.homeCollections) && product.homeCollections.includes(collectionId);
}

function hasHomeSlideSort(product) {
  return product.homeSlideSort !== null && product.homeSlideSort !== undefined && product.homeSlideSort !== "" && Number.isFinite(Number(product.homeSlideSort));
}

async function recordsPage() {
  const labelFilter = new URLSearchParams(location.search).get("label") || "";
  const artistTagFilter = new URLSearchParams(location.search).get("artistTag") || "";
  const availableArtistNames = inventoryArtistNames(await catalogService.listProducts());
  const records = (await catalogService.listRecords(state.recordsFilter, labelFilter)).filter((product) =>
    artistTagFilter ? productRelatedArtists(product).some((artist) => artist.toLowerCase() === artistTagFilter.toLowerCase()) : true
  );
  records.sort(recordSortComparator(state.recordsSort));
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
      ${
        artistTagFilter
          ? `<div class="active-label-filter">
              <span>Related Artist</span>
              <strong>${escapeHtml(artistTagFilter)}</strong>
              <a href="/records" data-link>Clear</a>
            </div>`
          : ""
      }
      <div class="records-toolbar">
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
        <label class="records-sort">
          <span>Sort</span>
          <select data-record-sort aria-label="Sort records">
            <option value="artist-asc" ${state.recordsSort === "artist-asc" ? "selected" : ""}>Artist A-Z</option>
            <option value="artist-desc" ${state.recordsSort === "artist-desc" ? "selected" : ""}>Artist Z-A</option>
            <option value="price-asc" ${state.recordsSort === "price-asc" ? "selected" : ""}>Price low to high</option>
            <option value="price-desc" ${state.recordsSort === "price-desc" ? "selected" : ""}>Price high to low</option>
            <option value="year-desc" ${state.recordsSort === "year-desc" ? "selected" : ""}>Release year newest</option>
            <option value="year-asc" ${state.recordsSort === "year-asc" ? "selected" : ""}>Release year oldest</option>
          </select>
        </label>
      </div>
      ${productGrid(records, { availableArtistNames })}
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
  const parsed = parsePublicProductPath(path);
  const product = path.startsWith("/product/")
    ? await catalogService.getProduct(decodeRoutePart(path.replace("/product/", "")))
    : parsed
      ? await catalogService.getProductByPublicSlug(parsed.categoryPath, parsed.slug)
      : null;
  if (!product) return notFoundPage();
  return productDetailMarkup(product);
}

async function productDetailMarkup(product) {
  const allProducts = await catalogService.listProducts();
  const availableArtistNames = inventoryArtistNames(allProducts);
  const related = product.category === "Records" ? recommendedProducts(product, allProducts) : [];
  const displayFormat = product.displayFormat || product.format;
  const conditionLabel = product.condition || "Available";
  const isApparel = product.category === "Apparel";
  const isRecord = product.category === "Records";
  const isUsedRecord = isRecord && String(product.condition || "").toLowerCase().startsWith("used");
  const isSoldOut = totalProductStock(product) <= 0;
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
              <figure class="product-art product-art-large ${isApparel ? "product-art-apparel" : ""} ${isSoldOut ? "is-sold-out" : ""}">
                <img src="${image}" alt="${product.title}${galleryImages.length > 1 ? ` image ${index + 1}` : ""}" />
                ${isSoldOut ? `<span class="sold-out-label">Sold out</span>` : ""}
                ${imageCreditMarkup(product, image)}
              </figure>
            `
          )
          .join("")}
      </div>
      <aside class="detail-copy">
        <a class="back-link" href="/${publicCategoryPath(product)}" data-link>${product.category}</a>
        <p class="eyebrow">${product.artist}</p>
        <h1>${product.title}</h1>
        <div class="detail-price">${money.format(product.price)}</div>
        <p class="product-description">${escapeHtml(product.description || "").replaceAll("\n", "<br />")}</p>
        ${productReviewMarkup(product)}
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
          <button class="button button-dark" type="button" data-add-cart="${product.id}" ${isSoldOut ? "disabled" : ""}>${isSoldOut ? "Sold out" : "Add to cart"}</button>
          <a class="button button-outline" href="/request-item" data-link>Request similar</a>
        </div>
        <dl class="detail-list">
          ${
            isApparel
              ? `<div><dt>Material</dt><dd>${product.material}</dd></div>
                 <div><dt>Color</dt><dd>${product.color}</dd></div>`
              : isRecord
                ? `<div><dt>Format</dt><dd>${escapeHtml(displayFormat)}</dd></div>
                 <div><dt>Condition</dt><dd>${escapeHtml(conditionLabel)}</dd></div>
                 <div><dt>Edition</dt><dd>${escapeHtml(product.edition || "Not specified")}</dd></div>
                 ${
                   isUsedRecord
                     ? `<div><dt>Media condition</dt><dd>${escapeHtml(product.mediaCondition || "Not specified")}</dd></div>
                        <div><dt>Sleeve condition</dt><dd>${escapeHtml(product.sleeveCondition || "Not specified")}</dd></div>`
                     : ""
                 }
                 <div><dt>Label</dt><dd>${recordLabelMarkup(product)}</dd></div>
                 <div><dt>Year</dt><dd>${product.year}</dd></div>
                 <div><dt>Notes</dt><dd>${product.details.join(" / ")}</dd></div>`
                : `<div><dt>Format</dt><dd>${escapeHtml(displayFormat)}</dd></div>
                   <div><dt>Label</dt><dd>${escapeHtml(product.label || "-")}</dd></div>
                   <div><dt>Year</dt><dd>${product.year}</dd></div>
                   <div><dt>Notes</dt><dd>${product.details.join(" / ")}</dd></div>`
          }
        </dl>
        ${recordRelatedArtistsMarkup(product, availableArtistNames)}
      </aside>
    </section>
    ${
      related.length
        ? `<section class="section shop-section">${productGrid(related, { availableArtistNames })}</section>`
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
              <a href="/artists/${artistSlug(artist)}" data-link>
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
  const requestedArtist = decodeRoutePart(path.replace("/artists/", ""));
  const allProducts = await catalogService.listProducts();
  const artistNames = await catalogService.listArtists();
  const artist = artistNames.find((name) => artistSlug(name) === artistSlug(requestedArtist));
  if (!artist) return notFoundPage();
  const products = artist
    ? allProducts.filter((product) => product.category === "Records" && artistCreditNames(product.artist).some((name) => artistIdentityKey(name) === artistIdentityKey(artist)))
    : [];
  const availableArtistNames = inventoryArtistNames(allProducts);
  return `
    <section class="section shop-section artist-products">
      <div class="toolbar artist-toolbar">
        <a class="back-link" href="/artists" data-link>Artists</a>
        <span>${artist}</span>
      </div>
      ${productGrid(products, { availableArtistNames })}
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
  // The public page never needs the private request inbox. Keep only the
  // visitor's in-session confirmation after a successful submission.
  const requests = state.requests;
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
        <label>Email:<input name="email" type="email" autocomplete="email" required /></label>
        <label>WhatsApp:<input name="whatsapp" /></label>
        <label>Notes:<textarea name="notes" rows="5"></textarea></label>
        <input class="request-honeypot" name="company" tabindex="-1" autocomplete="off" aria-hidden="true" />
        <button class="button button-dark" type="submit">Submit request</button>
        ${state.requestNotice ? `<p class="form-message ${state.requestNoticeTone === "error" ? "is-error" : "is-success"}">${escapeHtml(state.requestNotice)}</p>` : ""}
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
          <p>NIXP is an extension of Nix Powell, built around a growing catalogue of records, tapes, discs, printed matter, and objects selected through personal taste, research, and repeat listening.</p>
          <p>The focus moves across experimental music, heavy music, electronic music, contemporary composition, independent publishing, and their surrounding edges.</p>
          <p>Based online and operating from Aesthetic Pleasure Gallery, Grand Wijaya Center, Jakarta.</p>
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
          <p><a href="https://wa.me/6282122876289">+628 2122 8762 89</a><br><a href="mailto:contact@nix-p.com">contact@nix-p.com</a></p>
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

function internationalOrderPage() {
  return `
    <section class="section editorial-page contact-page">
      <div class="editorial-shell">
        <h1>International Orders</h1>
        <div class="editorial-copy contact-copy">
          <p>Online checkout is currently available for delivery within Indonesia only. For an international order, contact NIXP directly with the item name, your destination country, and postal code.</p>
          <p><a href="mailto:contact@nix-p.com?subject=International%20order%20enquiry">contact@nix-p.com</a><br><a href="https://wa.me/6282122876289?text=Hello%20NIXP%2C%20I%20would%20like%20to%20arrange%20an%20international%20order.">WhatsApp NIXP</a></p>
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
                    <strong>${row.product.title}${row.size ? ` <small>/ ${escapeHtml(row.size)}</small>` : ""} <small>x${row.quantity}</small></strong>
                    ${cartQuantityControl(row)}
                    <span>${money.format(row.lineTotal)}</span>
                  </article>
                `
              )
              .join("")
          : `<p class="empty-state">Your cart is empty.</p>`
      }
      <div class="cart-total cart-totals" aria-label="Order total">
        <span>Items</span><strong>${money.format(total)}</strong>
        <span>Delivery</span><em>Quoted after address confirmation</em>
        <span>Total at payment</span><strong>${money.format(total)} + delivery</strong>
      </div>
      ${
        rows.length
          ? `
            <aside class="checkout-assurance" aria-label="Checkout details">
              <p><strong>Two-hour reservation</strong><span>Stock is held for two hours after checkout, then released automatically when payment is not completed.</span></p>
              <p><strong>Delivery quote before payment</strong><span>JNE and GoSend delivery costs are confirmed from your address before payment opens. The final total always includes items and shipping.</span></p>
            </aside>
            <form class="checkout-form" data-checkout-form>
              <h2>Contact</h2>
              <div class="admin-form-grid">
                <label>Name<input name="name" required autocomplete="name" /></label>
                <label>Email<input name="email" type="email" required autocomplete="email" placeholder="name@email.com" /></label>
                <label>WhatsApp<input name="whatsapp" required autocomplete="tel" inputmode="tel" /></label>
                <label class="admin-form-span">Notes<textarea name="notes" rows="3" placeholder="Delivery, pickup, or payment notes"></textarea></label>
              </div>
              <h2>Delivery</h2>
              <div class="admin-form-grid">
                <label>Shipping method
                  <select name="shippingMethod" required data-checkout-shipping-method>
                    <option value="JNE">JNE</option>
                    <option value="GoSend Manual">GoSend Manual</option>
                    <option value="Store Pickup">Store Pickup</option>
                  </select>
                </label>
                <label data-checkout-address-field>Recipient<input name="shippingRecipient" required autocomplete="shipping name" /></label>
                <label data-checkout-address-field>Recipient phone<input name="shippingPhone" required autocomplete="shipping tel" inputmode="tel" /></label>
                <label class="admin-form-span" data-checkout-address-field>Address<input name="shippingAddress1" required autocomplete="shipping address-line1" /></label>
                <label class="admin-form-span" data-checkout-address-field>Address details<input name="shippingAddress2" autocomplete="shipping address-line2" placeholder="Building, unit, or landmark (optional)" /></label>
                <label data-checkout-address-field>District<input name="shippingDistrict" required autocomplete="shipping address-level3" /></label>
                <label data-checkout-address-field>City / regency
                  <select name="shippingCity" required autocomplete="shipping address-level2" data-checkout-city>
                    <option value="" selected disabled>Select city or regency</option>
                    ${checkoutCityOptions()}
                  </select>
                </label>
                <label data-checkout-address-field>Province<input name="shippingProvince" required readonly autocomplete="shipping address-level1" data-checkout-province /></label>
                <label data-checkout-address-field>Postal code<input name="shippingPostalCode" required autocomplete="shipping postal-code" inputmode="numeric" pattern="[0-9]{5}" maxlength="5" /></label>
                <label data-checkout-address-field>Country<input name="shippingCountry" value="Indonesia" readonly /></label>
                <a class="button checkout-international-order" href="/international-order" data-link>Ordering from outside Indonesia?</a>
              </div>
              <div class="admin-form-actions">
                <button class="button button-dark" type="submit" data-checkout-submit>Request delivery quote</button>
                <p class="admin-form-note" data-tone="${escapeAttr(state.checkoutTone)}">${escapeHtml(state.checkoutMessage)}</p>
              </div>
            </form>
          `
          : ""
      }
    </section>
  `;
}

async function customerOrderStatusPage() {
  const params = new URLSearchParams(location.search);
  const orderId = String(params.get("order") || "").trim();
  const token = String(params.get("token") || "").trim();
  if (!orderId || !token) {
    return `<section class="section order-status-page"><div class="order-status-shell"><p class="eyebrow">NIXP ORDER</p><h1>Order link unavailable</h1><p class="empty-state">Open the secure link from your NIXP email to view a delivery quote or payment status.</p></div></section>`;
  }
  try {
    const response = await fetch(`/api/order-status?order=${encodeURIComponent(orderId)}&token=${encodeURIComponent(token)}`, { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Order status is unavailable.");
    const order = payload.order || {};
    const activeQuote = (payload.quotes || []).find((quote) => quote.status === "Sent") || (payload.quotes || [])[0];
    const paymentPending = order.paymentStatus === "Pending" && order.orderStatus === "Active";
    const quotePending = order.shippingStatus === "Awaiting Quote";
    const expiresAt = order.paymentExpiresAt ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(order.paymentExpiresAt)) : "";
    return `
      <section class="section order-status-page">
        <div class="order-status-shell">
          <div class="order-status-heading">
            <p class="eyebrow">NIXP ORDER</p>
            <h1>${escapeHtml(order.reference || order.id)}</h1>
            <p>${quotePending ? "Delivery details received. NIXP is preparing your shipping quote." : paymentPending ? "Your delivery quote is ready. Payment is secured through Midtrans." : "This page reflects the latest verified order status."}</p>
          </div>
          <div class="order-status-grid">
            <div class="order-status-lines">
              ${(order.items || []).map((item) => `<p><span>${escapeHtml([item.artist, item.title, item.size ? `/${item.size}` : ""].filter(Boolean).join(" "))} <small>x${item.quantity}</small></span><strong>${money.format(item.lineTotal || 0)}</strong></p>`).join("")}
              <p><span>Items</span><strong>${money.format(order.merchandiseTotal || 0)}</strong></p>
              <p><span>Shipping${activeQuote?.service ? ` / ${escapeHtml(activeQuote.service)}` : ""}</span><strong>${quotePending ? "Awaiting quote" : money.format(order.shippingTotal || 0)}</strong></p>
              <p class="order-status-total"><span>Total</span><strong>${quotePending ? "To be confirmed" : money.format(order.total || 0)}</strong></p>
            </div>
            <div class="order-status-meta">
              <p><span>Order</span><strong>${escapeHtml(order.orderStatus || "-")}</strong></p>
              <p><span>Payment</span><strong>${escapeHtml(order.paymentStatus || "-")}</strong></p>
              <p><span>Fulfillment</span><strong>${escapeHtml(order.fulfillmentStatus || "-")}</strong></p>
              <p><span>Delivery</span><strong>${escapeHtml(order.shippingStatus || "-")}${activeQuote?.eta ? ` / ${escapeHtml(activeQuote.eta)}` : ""}</strong></p>
              ${order.trackingNumber ? `<p><span>Tracking</span><strong>${escapeHtml(order.trackingNumber)}</strong></p>` : ""}
            </div>
          </div>
          ${paymentPending ? `<p class="order-status-note">Payment reservation ends ${escapeHtml(expiresAt)}. NIXP only marks payment as paid after provider verification.</p><div class="order-status-actions"><button class="button button-dark" type="button" data-order-pay data-order-id="${escapeAttr(orderId)}" data-order-token="${escapeAttr(token)}">Continue to payment</button><button class="button button-outline" type="button" data-order-status-refresh>Refresh status</button></div>` : `<div class="order-status-actions"><button class="button button-outline" type="button" data-order-status-refresh>Refresh status</button></div>`}
          <p class="admin-form-note" data-order-status-message aria-live="polite"></p>
        </div>
      </section>
    `;
  } catch (error) {
    return `<section class="section order-status-page"><div class="order-status-shell"><p class="eyebrow">NIXP ORDER</p><h1>Order unavailable</h1><p class="empty-state">${escapeHtml(error instanceof Error ? error.message : "Order status is unavailable.")}</p></div></section>`;
  }
}

async function cartSummary() {
  const products = await catalogService.listProducts();
  const counts = state.cart.reduce((map, key) => {
    map.set(key, (map.get(key) || 0) + 1);
    return map;
  }, new Map());
  const productIds = [...new Set([...counts.keys()].map((key) => parseCartKey(key).productId))];
  const serverPrices = await verifiedCartPrices(productIds);
  const priceById = new Map(serverPrices.map((item) => [item.id, Number(item.price || 0)]));
  const rows = [...counts.entries()]
    .map(([key, requestedQuantity]) => {
      const parsed = parseCartKey(key);
      const product = products.find((item) => item.id === parsed.productId);
      const size = parsed.size || defaultAvailableSize(product);
      const nextKey = size ? cartKey(parsed.productId, size) : parsed.productId;
      const price = priceById.has(parsed.productId) ? priceById.get(parsed.productId) : product?.price;
      const stock = productStock(product, size);
      const quantity = Math.min(requestedQuantity, stock);
      return product
        ? {
            id: nextKey,
            productId: parsed.productId,
            product: { ...product, price },
            size,
            stock,
            quantity,
            lineTotal: price * quantity
          }
        : null;
    })
    .filter((row) => row && row.quantity > 0);
  const nextCart = rows.flatMap((row) => Array.from({ length: row.quantity }, () => row.id));
  if (nextCart.join("|") !== state.cart.join("|")) {
    state.cart = nextCart;
    clearCheckoutSession();
    persistCart();
  }
  return {
    rows,
    total: rows.reduce((sum, row) => sum + row.lineTotal, 0)
  };
}

async function verifiedCartPrices(productIds) {
  if (!productIds.length) return [];

  const now = Date.now();
  const missingIds = productIds.filter((id) => !priceCache.prices.has(id) || priceCache.expiresAt <= now);
  if (missingIds.length) {
    const verified = await adminStore.verifyPrices(missingIds);
    for (const item of verified) priceCache.prices.set(item.id, Number(item.price || 0));
    priceCache.expiresAt = now + 15_000;
  }

  return productIds
    .filter((id) => priceCache.prices.has(id))
    .map((id) => ({ id, price: priceCache.prices.get(id) }));
}

function cartQuantityControl(row) {
  const max = Math.max(0, Number(row.stock || 0));
  const decreaseDisabled = row.quantity <= 1 ? "disabled" : "";
  const increaseDisabled = row.quantity >= max ? "disabled" : "";
  return `
    <div class="cart-quantity" aria-label="Quantity for ${escapeAttr(row.product.title)}${row.size ? ` size ${escapeAttr(row.size)}` : ""}">
      <button type="button" data-cart-quantity-step="${escapeAttr(row.id)}" data-delta="-1" ${decreaseDisabled}>-</button>
      <input type="number" min="1" max="${max}" value="${row.quantity}" data-cart-quantity="${escapeAttr(row.id)}" aria-label="Quantity" />
      <button type="button" data-cart-quantity-step="${escapeAttr(row.id)}" data-delta="1" ${increaseDisabled}>+</button>
      <small>${max} available</small>
    </div>
  `;
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
                          <span>${row.product.format} / ${row.product.artist}${row.size ? ` / ${escapeHtml(row.size)}` : ""}</span>
                          <small>${row.quantity} x ${money.format(row.product.price)}</small>
                          ${cartQuantityControl(row)}
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
      href: publicProductPath(product)
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
        <input id="site-search" type="search" autocomplete="off" placeholder="Search" data-search-input />
        <div class="search-results" data-search-results></div>
        <script type="application/json" data-search-data>${JSON.stringify(suggestions).replace(/</g, "\\u003c")}</script>
      </aside>
    </div>
  `;
}

function loginPage(workspaceOrPath = "admin", nextPath = null) {
  const params = new URLSearchParams(location.search);
  const hostWorkspace = workspaceForHost();
  const requestedWorkspace = params.get("workspace") === "finance" ? "finance" : "admin";
  const workspace = ["admin", "finance"].includes(workspaceOrPath) ? workspaceOrPath : hostWorkspace || requestedWorkspace;
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
  const stockUnits = inventory.reduce((sum, item) => sum + numericValue(item.stock), 0);
  const orderValue = orders.reduce((sum, order) => sum + numericValue(order.total), 0);
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
    safeAdminValue(catalogService.listAllProducts(), []),
    safeAdminValue(catalogService.listAdminArtists(), []),
    safeAdminValue(catalogService.listCollections(), []),
    safeAdminValue(catalogService.listRequests(), []),
    safeAdminValue(catalogService.listOrders(), [])
  ]);
  const drafts = products.filter((product) => product.publishStatus !== "Published").length;
  let deployStatus = null;
  try {
    deployStatus = await adminStore.deployStatus();
  } catch (error) {
    deployStatus = {
      ready: false,
      error: error instanceof Error ? error.message : "Deploy status unavailable."
    };
  }
  const [
    productsSection,
    homeSliderSection,
    mediaSection,
    artistsSection,
    collectionsSection,
    requestsSection,
    ordersSection,
    previewSection
  ] = await Promise.all([
    safeAdminSection("Products", () => adminProductsPage({ embedded: true })),
    safeAdminSection("Home Slider", () => adminHomeSliderPage({ embedded: true })),
    safeAdminSection("Images", () => adminMediaPage({ embedded: true })),
    safeAdminSection("Artists", () => adminArtistsPage({ embedded: true })),
    safeAdminSection("Collections", () => adminCollectionsPage({ embedded: true })),
    safeAdminSection("Requests", () => adminRequestsPage({ embedded: true })),
    safeAdminSection("Orders", () => ordersPage({ embedded: true })),
    safeAdminSection("Preview", () => adminPreviewPage({ embedded: true }))
  ]);
  return `
    ${adminHero("NIXP Editor", "One workspace for products, images, artists, collections, requests, orders, drafts, and previews.")}
    <section class="section editor-command">
      ${metric("Products", products.length)}
      ${metric("Drafts", drafts)}
      ${metric("Requests", requests.length)}
      ${metric("Orders", orders.length)}
      <form class="editor-deploy-panel" data-admin-deploy-form>
        <div>
          <strong>Deploy</strong>
          <span>Save Supabase, commit GitHub, trigger Vercel.</span>
        </div>
        <button class="button button-dark" type="submit">Deploy</button>
        ${deployStatusMarkup(deployStatus)}
        <p class="admin-form-note" data-admin-form-message aria-live="polite"></p>
      </form>
      <nav class="editor-tabs" aria-label="Editor sections">
        <a href="#editor-products">Products</a>
        <a href="#editor-home-slider">Home Slider</a>
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
      ${productsSection}
    </section>
    <section class="section editor-section" id="editor-home-slider">
      <div class="editor-section-head">
        <span>02</span>
        <h2>Home Slider</h2>
        <p>Edit homepage collection tabs and slider order. Use Deploy above after saving to publish it live.</p>
      </div>
      ${homeSliderSection}
    </section>
    <section class="section editor-section" id="editor-media">
      <div class="editor-section-head">
        <span>03</span>
        <h2>Images</h2>
        <p>Upload or replace product images before they move into Supabase Storage.</p>
      </div>
      ${mediaSection}
    </section>
    <section class="section editor-section" id="editor-artists">
      <div class="editor-section-head">
        <span>04</span>
        <h2>Artists</h2>
        <p>Manage the artist index and editorial metadata.</p>
      </div>
      ${artistsSection}
    </section>
    <section class="section editor-section" id="editor-collections">
      <div class="editor-section-head">
        <span>05</span>
        <h2>Collections</h2>
        <p>Organize categories, shelves, drops, and campaign groupings.</p>
      </div>
      ${collectionsSection}
    </section>
    <section class="section editor-section" id="editor-requests">
      <div class="editor-section-head">
        <span>06</span>
        <h2>Requests</h2>
        <p>Move request items from new lead to closed conversation.</p>
      </div>
      ${requestsSection}
    </section>
    <section class="section editor-section" id="editor-orders">
      <div class="editor-section-head">
        <span>07</span>
        <h2>Orders</h2>
        <p>Review carts and update order statuses.</p>
      </div>
      ${ordersSection}
    </section>
    <section class="section editor-section" id="editor-preview">
      <div class="editor-section-head">
        <span>08</span>
        <h2>Preview</h2>
        <p>Open draft previews before publishing them to the public storefront.</p>
      </div>
      ${previewSection}
    </section>
  `;
}

async function safeAdminValue(promise, fallback) {
  try {
    return await promise;
  } catch {
    return fallback;
  }
}

async function safeAdminSection(label, loader) {
  try {
    return await loader();
  } catch (error) {
    const message = error instanceof Error ? error.message : "This editor section could not load.";
    return `
      <div class="admin-panel admin-section-error">
        <div class="admin-panel-head">
          <h2>${escapeHtml(label)}</h2>
        </div>
        <p class="admin-form-note" data-tone="error">${escapeHtml(message)}</p>
      </div>
    `;
  }
}

async function adminHomeSliderPage({ embedded = false } = {}) {
  const products = await catalogService.listAllProducts();
  const visibleProducts = sortItems(
    products.filter((product) => product.category === "Records" || hasHomeSlideSort(product)),
    "homeSlideSort",
    {
      homeSlideSort: (item) => (hasHomeSlideSort(item) ? Number(item.homeSlideSort) : 9999),
      title: (item) => item.title
    }
  );
  return `
    ${embedded ? "" : adminHero("Home Slider", "Edit homepage collection tabs and slider order.")}
    <form class="admin-panel admin-home-slider-form" data-admin-home-slider-form>
      ${table(
        ["Use", "Order", "Product", ...homeCollectionOptions.map(([, label]) => label)],
        visibleProducts.map((product, index) => {
          const sortValue = hasHomeSlideSort(product) ? Number(product.homeSlideSort) : index + 1;
          const collections = Array.isArray(product.homeCollections) ? product.homeCollections : [];
          return [
            `<input type="checkbox" name="homeSlide:${escapeAttr(product.id)}" ${hasHomeSlideSort(product) ? "checked" : ""} />`,
            `<input class="admin-order-input" type="number" min="1" step="1" name="homeSlideSort:${escapeAttr(product.id)}" value="${escapeAttr(sortValue)}" />`,
            `<strong>${escapeHtml(product.artist)}</strong><br><small>${escapeHtml(product.title)} / ${escapeHtml(product.displayFormat || product.format)}</small>`,
            ...homeCollectionOptions.map(
              ([id]) =>
                `<input type="checkbox" name="homeCollection:${escapeAttr(product.id)}:${id}" ${collections.includes(id) ? "checked" : ""} />`
            )
          ];
        })
      )}
      <div class="admin-form-actions">
        <button class="button button-dark" type="submit">Save slider</button>
        <p class="admin-form-note" data-admin-form-message aria-live="polite"></p>
      </div>
    </form>
  `;
}

async function adminProductsPage({ embedded = false } = {}) {
  const products = await catalogService.listAllProducts();
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
        ${productSyncMarkup(product)}
        <div class="admin-form-grid">
          ${input("id", "ID", product.id || "", "Leave blank for auto ID")}
          ${input("sku", "SKU", product.sku || "", "NXP-2026-APP-0002")}
          ${input("title", "Title", product.title || "", "Item title")}
          ${select("category", "Category", ["Records", "Objects", "Apparel", "Publishing"], product.category || "Records")}
          <div class="admin-record-fields" data-admin-record-fields ${productCategory === "Apparel" || productCategory === "Objects" ? "hidden" : ""}>
            ${input("artist", "Artist", product.artist || "", "Artist / maker")}
            ${input("format", "Format", product.format || "", "Vinyl, CD, Book")}
            ${input("displayFormat", "Display format", product.displayFormat || "", "Vinyl 12&quot;")}
            <div data-admin-edition-field ${productCategory === "Records" ? "" : "hidden"}>
              ${input("edition", "Edition", product.edition || "", "Original pressing, reissue, limited edition")}
              ${input("barcode", "Barcode", product.barcode || "", "Exact release barcode")}
              ${input("catalogNumber", "Catalog number", product.catalogNumber || "", "Label catalog number")}
            </div>
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
          ${select("condition", "Condition", ["", "New-Sealed", "New-Unsealed", "Used Mint", "Used Excellent", "Used Excellence", "Used Good", "Used Fair", "Used Poor"], product.condition || "")}
          <div class="admin-used-condition-fields" data-admin-used-condition-fields ${productCategory === "Records" && String(product.condition || "").toLowerCase().startsWith("used") ? "" : "hidden"}>
            ${input("mediaCondition", "Media condition", product.mediaCondition || "", "Grade the disc, record, or tape")}
            ${input("sleeveCondition", "Sleeve condition", product.sleeveCondition || "", "Grade the sleeve or case")}
          </div>
          ${input("price", "Price IDR", product.price || "", "640000", "number")}
          ${input("year", "Year", product.year || new Date().getFullYear(), "2026", "number")}
          ${input("label", "Label", product.label || "", "NIXP Selection")}
          ${input("qty", "Quantity", product.qty ?? 1, "1", "number")}
          ${input("tags", "Tags", product.tags?.join(", ") || "", "new, vinyl, jakarta")}
          <div data-admin-record-editorial-field ${productCategory === "Records" ? "" : "hidden"}>
            ${input("relatedArtists", "Related artists", product.relatedArtists?.join(", ") || "", "SOPHIE, FKA twigs, Bjork")}
          </div>
          ${input("details", "Details", product.details?.join(", ") || "", "Format, condition, notes")}
          ${shippingAttributeFields(product)}
          ${select("publishStatus", "Status", ["Published", "Draft", "Archived"], product.publishStatus || "Published")}
          ${select("visibility", "Visibility", ["Public", "Hidden"], product.visibility || "Public")}
        </div>
        <label>Description<textarea name="description" rows="4">${escapeHtml(product.description || "")}</textarea></label>
        <label data-admin-record-editorial-field ${productCategory === "Records" ? "" : "hidden"}>Description source<input name="descriptionSource" value="${escapeAttr(product.descriptionSource || "")}" placeholder="Official artist / label / release page" /></label>
        <label data-admin-record-editorial-field ${productCategory === "Records" ? "" : "hidden"}>Review quote<textarea name="reviewQuote" rows="3" placeholder="Optional short quote, under 25 words">${escapeHtml(product.reviewQuote || "")}</textarea></label>
        <div class="admin-form-grid" data-admin-record-editorial-field ${productCategory === "Records" ? "" : "hidden"}>
          ${input("reviewSource", "Review source", product.reviewSource || "", "Pitchfork, The Quietus, The Wire")}
          ${input("reviewUrl", "Review source URL", product.reviewUrl || "", "https://...")}
        </div>
        <label>Image URL<input name="image" value="${escapeAttr(product.image || "")}" placeholder="/public/example.png or uploaded data URL" /></label>
        ${galleryUploadFields(product)}
        <p class="admin-form-note" data-admin-form-message data-tone="${escapeAttr(state.adminNoticeTone)}" aria-live="polite">${escapeHtml(state.adminNotice)}</p>
        <div class="admin-form-actions">
          <button class="button button-dark" type="submit">Save product</button>
          ${editing ? `<a class="button button-outline" href="/admin/preview/product/${product.id}" data-link>Preview</a>` : ""}
        </div>
      </form>

      ${adminProductsCatalogMarkup(products)}
    </div>
  `;
}

function productSyncMarkup(product = {}) {
  const sync = product.syncStatus || {};
  const enrichment = String(product.enrichmentStatus || "").trim();
  if (!sync?.at && !enrichment) return "";
  const timestamp = sync?.at ? new Date(sync.at) : null;
  const date = !timestamp || Number.isNaN(timestamp.valueOf())
    ? sync?.at || ""
    : new Intl.DateTimeFormat("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      }).format(timestamp);
  return `
    <p class="admin-sync-status" aria-live="polite">
      ${enrichment ? `<span>Enrichment: ${escapeHtml(enrichment.replaceAll("-", " "))}</span>` : ""}
      <strong>${escapeHtml(sync.source || "System")} sync</strong>
      <span>${escapeHtml(sync.action || "Catalog synchronized")} · ${escapeHtml(date)}</span>
    </p>
  `;
}

function visibleAdminProducts(products) {
  return sortItems(
    filterItems(products, "products", (item) => [
      item.sku,
      item.artist,
      item.title,
      item.format,
      item.condition,
      item.category,
      item.publishStatus,
      item.price,
      item.qty
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
      qty: (item) => Number(item.qty || 0),
      price: (item) => item.price,
      status: (item) => item.publishStatus,
      updated: (item) => item.updatedAt || ""
    }
  );
}

function adminProductsCatalogMarkup(products) {
  const visibleProducts = visibleAdminProducts(products);
  return `
      <div class="admin-panel" data-admin-products-catalog>
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
          ["qty", "Quantity"],
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
            sortHeader("products", "qty", "Quantity"),
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
            Number(item.qty || 0).toString(),
            money.format(item.price || 0),
            item.updatedAt || "-",
            `<button class="link-button" type="button" data-admin-edit-product="${item.id}">Edit</button>
             <button class="link-button" type="button" data-admin-product-status="${item.id}" data-status="${item.publishStatus === "Published" ? "Draft" : "Published"}">${item.publishStatus === "Published" ? "Unpublish" : "Publish"}</button>`
          ])
        )}
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
  const id = decodeRoutePart(path.replace("/admin/preview/product/", ""));
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
      order.paymentStatus,
      order.fulfillmentStatus,
      order.shippingStatus,
      order.date,
      order.total,
      orderItemSummary(order)
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
    ${embedded ? "" : adminHero("Orders", "Payment, fulfillment, shipping, and action-required order operations.")}
    <div>
      <form class="admin-panel admin-shipping-quote-form" data-admin-shipping-quote-form>
        <div class="admin-form-heading"><h3>Issue delivery quote</h3><p>Confirm the courier charge before stock is reserved and payment opens.</p></div>
        <div class="admin-form-grid">
          ${input("orderId", "Order ID", "", "order-...", "text")}
          ${input("amount", "Shipping amount (Rp)", "", "0", "number")}
          ${input("courier", "Courier", "JNE", "JNE", "text")}
          ${input("service", "Service", "", "REG / YES", "text")}
          ${input("eta", "Estimated delivery", "", "2-4 working days", "text")}
        </div>
        <div class="admin-form-actions"><button class="button button-dark" type="submit">Send quote</button><p class="admin-form-note" data-admin-quote-message aria-live="polite"></p></div>
      </form>
      ${adminListControls("orders", "Search orders, SKU, artist, album", [
        ["date", "Date"],
        ["customer", "Customer"],
        ["status", "Order status"],
        ["total", "Total"],
        ["id", "Order ID"]
      ])}
      ${table(
        ["Order", "Customer", "Items", "Payment", "Fulfillment", "Shipping", "Action required", "Total"],
        visibleOrders.map((order) => [
          escapeHtml(order.reference || order.id),
          `${escapeHtml(order.customer || "-")}<br><small>${escapeHtml(order.email || order.whatsapp || order.channel || "")}</small>`,
          escapeHtml(orderItemSummary(order)),
          statusBadge(order.paymentStatus || order.status || "-"),
          statusBadge(order.fulfillmentStatus || "Unfulfilled"),
          statusBadge(order.shippingStatus || "Not Required"),
          escapeHtml(orderActionRequired(order)),
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

function numericValue(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function input(name, label, value = "", placeholder = "", type = "text") {
  return `
    <label>${label}
      <input name="${name}" type="${type}" value="${escapeAttr(value)}" placeholder="${placeholder}" />
    </label>
  `;
}

function statusBadge(value) {
  const label = String(value || "-").trim() || "-";
  const className = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
  return `<span class="status ${className}">${escapeHtml(label)}</span>`;
}

function orderItemSummary(order = {}) {
  const productTitles = Array.isArray(order.products)
    ? order.products.map((product) => [product.artist, product.title].filter(Boolean).join(" / ")).filter(Boolean)
    : [];
  if (productTitles.length) return productTitles.join(", ");
  const lineItems = Array.isArray(order.lineItems) ? order.lineItems : [];
  const lineTitles = lineItems
    .map((item) => {
      const title = [item.artist, item.title].filter(Boolean).join(" / ") || item.sku || item.productId || "Item";
      const quantity = Number(item.quantity || 0);
      return quantity > 1 ? `${title} x${quantity}` : title;
    })
    .filter(Boolean);
  return lineTitles.length ? lineTitles.join(", ") : "-";
}

function orderActionRequired(order) {
  const payment = String(order.paymentStatus || "").toLowerCase();
  const fulfillment = String(order.fulfillmentStatus || "").toLowerCase();
  const shipping = String(order.shippingStatus || "").toLowerCase();
  if (payment === "pending" || payment === "unpaid") return "Awaiting payment";
  if (payment === "refund pending") return "Refund required";
  if (fulfillment === "processing" || fulfillment === "stock reserved") return "Pack order";
  if (fulfillment === "packed" && shipping === "awaiting pickup") return "Hand to courier";
  if (shipping === "delivery failed") return "Delivery follow-up";
  if (shipping === "quote sent" || shipping === "awaiting quote") return "Send shipping quote";
  return "-";
}

function shippingAttributeFields(product = {}) {
  const shipping = product.shipping || {};
  return `
    <fieldset class="admin-size-fieldset admin-form-span">
      <legend>Shipping attributes</legend>
      <div class="admin-size-grid">
        ${input("shippingWeightGrams", "Weight (grams)", shipping.weightGrams ?? "", "Measured packed item weight", "number")}
        ${input("shippingLengthCm", "Length (cm)", shipping.lengthCm ?? "", "Measured package length", "number")}
        ${input("shippingWidthCm", "Width (cm)", shipping.widthCm ?? "", "Measured package width", "number")}
        ${input("shippingHeightCm", "Height (cm)", shipping.heightCm ?? "", "Measured package height", "number")}
      </div>
      <div class="admin-size-grid">
        ${input("shippingClass", "Shipping class", shipping.shippingClass || "", "vinyl-cardboard-bubble")}
        ${input("shippingPackageType", "Packaging", shipping.packageType || "", "lp-mailer / poly-mailer")}
      </div>
      <label>Measurement status
        <select name="shippingStatus">
          ${["needs_measurement", "verified", "format_reference"].map((status) => `<option ${status === (shipping.status || "needs_measurement") ? "selected" : ""}>${status}</option>`).join("")}
        </select>
      </label>
      <label>Measurement source
        <input name="shippingSource" value="${escapeAttr(shipping.source || "")}" placeholder="Scale / ruler / official product page URL" />
      </label>
    </fieldset>
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

function defaultAvailableSize(product) {
  if (!product?.sizes?.length) return "";
  return product.sizes.find((size) => !isSizeSoldOut(size))?.label || "";
}

function productStock(product, size = "") {
  if (!product) return 0;
  if (product.sizes?.length) {
    const selected = product.sizes.find((item) => item.label === size);
    if (!selected) return 0;
    return Math.max(0, Math.floor(Number(selected.quantity ?? selected.qty ?? (selected.soldOut ? 0 : 1)) || 0));
  }
  return Math.max(0, Math.floor(Number(product.qty ?? 1) || 0));
}

function totalProductStock(product) {
  if (!product) return 0;
  if (product.sizes?.length) {
    return product.sizes.reduce(
      (sum, size) => sum + Math.max(0, Math.floor(Number(size.quantity ?? size.qty ?? (size.soldOut ? 0 : 1)) || 0)),
      0
    );
  }
  return Math.max(0, Math.floor(Number(product.qty ?? 1) || 0));
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
  const label = canonicalLabelName(product.label);
  return `<a class="record-label-link" href="/records?label=${encodeURIComponent(label)}" data-link>${escapeHtml(label)}</a>`;
}

function productRelatedArtists(product) {
  return Array.isArray(product.relatedArtists)
    ? product.relatedArtists.map((artist) => String(artist || "").trim()).filter(Boolean)
    : [];
}

function inventoryArtistNames(products) {
  const artists = new Map();
  for (const product of products) {
    const artist = String(product.artist || "").trim();
    if (!artist) continue;
    for (const credit of artistCreditNames(artist)) artists.set(artistIdentityKey(credit), canonicalArtistName(credit));
  }
  return artists;
}

function recordRelatedArtistsMarkup(product, availableArtistNames = new Set()) {
  if (product.category !== "Records") return "";
  const artists = productRelatedArtists(product);
  if (!artists.length) return "";
  return `
    <p class="related-artist-heading">Related Artists</p>
    <div class="related-artist-tags" aria-label="Related artists">
      ${artists
        .map((artist) => {
          const inventoryArtist = artistCreditNames(artist)
            .map((name) => availableArtistNames.get?.(artistIdentityKey(name)))
            .find(Boolean);
          return inventoryArtist
            ? `<a href="/artists/${artistSlug(inventoryArtist)}" data-link data-related-artist-link>${escapeHtml(artist)}</a>`
            : `<span>${escapeHtml(artist)}</span>`;
        })
        .join("")}
    </div>
  `;
}

function artistSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function recordSortComparator(sort) {
  return (a, b) => {
    if (sort === "price-desc") return Number(b.price || 0) - Number(a.price || 0) || a.title.localeCompare(b.title);
    if (sort === "price-asc") return Number(a.price || 0) - Number(b.price || 0) || a.title.localeCompare(b.title);
    if (sort === "year-desc") return Number(b.year || 0) - Number(a.year || 0) || a.artist.localeCompare(b.artist);
    if (sort === "year-asc") return Number(a.year || 0) - Number(b.year || 0) || a.artist.localeCompare(b.artist);
    const artistCompare = a.artist.localeCompare(b.artist);
    return sort === "artist-desc" ? -artistCompare : artistCompare;
  };
}

function safeExternalUrl(value) {
  try {
    const url = new URL(String(value || ""), location.origin);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function productReviewMarkup(product) {
  const quote = String(product.reviewQuote || "").trim();
  if (!quote) return "";
  const source = String(product.reviewSource || "").trim();
  const url = safeExternalUrl(product.reviewUrl);
  const sourceMarkup = source
    ? url
      ? `<a href="${escapeAttr(url)}" target="_blank" rel="noreferrer">${escapeHtml(source)}</a>`
      : escapeHtml(source)
    : "Sourced review";
  return `<blockquote class="product-review"><p>"${escapeHtml(quote)}"</p><cite>${sourceMarkup}</cite></blockquote>`;
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

function imageCreditMarkup(product, image) {
  const credits = Array.isArray(product.imageCredits) ? product.imageCredits : [];
  const credit = credits.find((item) => item.image === image || item.src === image);
  if (!credit?.credit) return "";
  const text = `Courtesy: ${escapeHtml(credit.credit)}`;
  return credit.url
    ? `<figcaption class="image-credit"><a href="${escapeAttr(credit.url)}" target="_blank" rel="noreferrer">${text}</a></figcaption>`
    : `<figcaption class="image-credit">${text}</figcaption>`;
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

function navigateInternal(href, { preserveScroll = false } = {}) {
  if (!href || href.startsWith("http") || href.startsWith("mailto:")) return false;
  state.zoomedProductId = null;
  history.pushState({}, "", href);
  render({ preserveScroll, scrollToTop: !preserveScroll });
  return true;
}

function setupAdminOrdersLiveRefresh(path) {
  if (adminOrdersRefreshTimer) {
    clearInterval(adminOrdersRefreshTimer);
    adminOrdersRefreshTimer = null;
  }
  if (path !== "/admin/orders" || !hasWorkspaceAccess("admin")) return;
  adminOrdersRefreshTimer = setInterval(() => {
    if (document.hidden || normalizePath(location.pathname) !== "/admin/orders") return;
    adminStore.refreshOrders().then(() => render({ preserveScroll: true })).catch(() => undefined);
  }, 10_000);
}

function deployStatusMarkup(status) {
  if (!status) return "";
  if (status.error) {
    return `<p class="deploy-status" data-tone="error">${escapeHtml(status.error)}</p>`;
  }
  const missing = [...(status.supabase?.missing || []), ...(status.github?.missing || [])];
  const repository = status.github?.repository || "eghisn/Nix-p-platform";
  const branch = status.github?.branch || "main";
  if (status.ready) {
    return `<p class="deploy-status" data-tone="success">Ready: Supabase + GitHub ${escapeHtml(repository)} / ${escapeHtml(branch)}.</p>`;
  }
  const missingText = missing.length ? missing.join(", ") : "deployment configuration";
  return `<p class="deploy-status" data-tone="warning">Needs Vercel env: ${escapeHtml(missingText)}.</p>`;
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
  bindHomeSlider();
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
      await render();
      adminStore.refresh().catch(() => {});
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

  document.querySelectorAll("[data-related-artist-link]").forEach((link) => {
    link.addEventListener("click", (event) => {
      const href = link.getAttribute("href");
      if (!href) return;
      event.preventDefault();
      event.stopPropagation();
      navigateInternal(href);
    });
  });

  document.querySelectorAll("[data-link]").forEach((link) => {
    link.addEventListener("click", (event) => {
      const href = link.getAttribute("href");
      if (!href || href.startsWith("http") || href.startsWith("mailto:")) return;
      event.preventDefault();
      navigateInternal(href);
    });
  });

  document.querySelector("[data-nav-toggle]")?.addEventListener("click", (event) => {
    const header = document.querySelector(".site-header");
    const isOpen = header?.classList.toggle("is-open") || false;
    event.currentTarget.setAttribute("aria-expanded", String(isOpen));
    event.currentTarget.setAttribute("aria-label", isOpen ? "Close navigation" : "Open navigation");
  });

  document.querySelector("[data-cart-open]")?.addEventListener("click", () => {
    setCartOpen(true);
  });

  document.querySelector("[data-search-open]")?.addEventListener("click", () => {
    setSearchOpen(true);
  });

  document.querySelectorAll("[data-search-close]").forEach((button) => {
    button.addEventListener("click", () => {
      setSearchOpen(false);
    });
  });

  bindSearch();

  document.querySelectorAll("[data-cart-close]").forEach((button) => {
    button.addEventListener("click", () => {
      setCartOpen(false);
    });
  });

  document.querySelectorAll("[data-record-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.recordsFilter = button.dataset.recordFilter;
      render({ preserveScroll: true });
    });
  });

  document.querySelector("[data-record-sort]")?.addEventListener("change", (event) => {
    state.recordsSort = event.currentTarget.value;
    render({ preserveScroll: true });
  });

  document.querySelectorAll("[data-home-collection]").forEach((button) => {
    button.addEventListener("click", () => {
      state.homeCollectionFilter = button.dataset.homeCollection;
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
    button.addEventListener("click", async () => {
      const product = await catalogService.getProduct(button.dataset.addCart);
      const selectedSize = product?.sizes?.length ? state.selectedSizes[product.id] || defaultAvailableSize(product) : "";
      const key = cartKey(button.dataset.addCart, selectedSize);
      const stock = productStock(product, selectedSize);
      const currentQuantity = cartItemQuantity(key);
      if (stock > 0 && currentQuantity < stock) {
        state.cart.push(key);
        clearCheckoutSession();
        persistCart();
      }
      state.cartOpen = true;
      render();
    });
  });

  document.querySelectorAll("[data-cart-quantity-step]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.cartQuantityStep;
      const input = document.querySelector(`[data-cart-quantity="${CSS.escape(id)}"]`);
      const max = Math.max(1, Number(input?.max || 1));
      const nextQuantity = Math.min(max, Math.max(1, cartItemQuantity(id) + Number(button.dataset.delta || 0)));
      setCartItemQuantity(id, nextQuantity);
      render();
    });
  });

  document.querySelectorAll("[data-cart-quantity]").forEach((input) => {
    input.addEventListener("change", () => {
      const max = Math.max(1, Number(input.max || 1));
      const nextQuantity = Math.min(max, Math.max(1, Math.floor(Number(input.value) || 1)));
      setCartItemQuantity(input.dataset.cartQuantity, nextQuantity);
      render();
    });
  });

  document.querySelectorAll("[data-remove-cart]").forEach((button) => {
    button.addEventListener("click", () => {
      setCartItemQuantity(button.dataset.removeCart, 0);
      render();
    });
  });

  document.querySelector("[data-checkout-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const customer = {
      name: formData.get("name"),
      email: formData.get("email"),
      whatsapp: formData.get("whatsapp"),
      notes: formData.get("notes")
    };
    const shippingMethod = String(formData.get("shippingMethod") || "");
    const selectedRegion = indonesiaRegionByCode.get(String(formData.get("shippingCity") || ""));
    const shippingAddress = {
      recipient: formData.get("shippingRecipient"),
      phone: formData.get("shippingPhone"),
      address1: formData.get("shippingAddress1"),
      address2: formData.get("shippingAddress2"),
      district: formData.get("shippingDistrict"),
      city: selectedRegion?.city || "",
      province: selectedRegion?.province || "",
      regionCode: selectedRegion?.code || "",
      postalCode: formData.get("shippingPostalCode"),
      country: formData.get("shippingCountry")
    };
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    state.checkoutMessage = "Preparing your order...";
    state.checkoutTone = "";
    await render();
    try {
      const { rows } = await cartSummary();
      const orderId = getCheckoutOrderToken();
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          items: rows.map((row) => ({ id: row.productId, size: row.size, quantity: row.quantity })),
          customer,
          shippingMethod,
          shippingAddress,
          orderId
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Checkout failed.");
      const expiresAt = payload.order.paymentExpiresAt
        ? new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(new Date(payload.order.paymentExpiresAt))
        : "the end of the reservation window";
      if (payload.requiresShippingQuote && payload.statusUrl) {
        state.cart = [];
        clearCheckoutSession();
        persistCart();
        window.location.assign(payload.statusUrl);
        return;
      }
      if (payload.payment?.redirectUrl) {
        state.checkoutMessage = `Your order is reserved until ${expiresAt}. Opening secure payment...`;
        state.checkoutTone = "success";
        await render({ preserveScroll: true });
        window.location.assign(payload.payment.redirectUrl);
        return;
      }
      if (payload.order.paymentStatus === "Paid") {
        state.cart = [];
        clearCheckoutSession();
        persistCart();
        state.checkoutMessage = `Payment for order ${payload.order.id} is confirmed.`;
      } else if (payload.payment?.error) {
        state.checkoutMessage = `Order ${payload.order.id} is reserved until ${expiresAt}. ${payload.payment.error}`;
      } else {
        state.checkoutMessage = `Order ${payload.order.id} is reserved until ${expiresAt}. Online payment will open here as soon as Midtrans is activated.`;
      }
      state.checkoutTone = "success";
      await adminStore.refresh();
      await render({ preserveScroll: true });
    } catch (error) {
      state.checkoutMessage = error instanceof Error ? error.message : "Checkout failed.";
      state.checkoutTone = "error";
      await render({ preserveScroll: true });
    }
  });

  const shippingMethod = document.querySelector("[data-checkout-shipping-method]");
  const checkoutCity = document.querySelector("[data-checkout-city]");
  const checkoutProvince = document.querySelector("[data-checkout-province]");
  const syncCheckoutProvince = () => {
    const region = indonesiaRegionByCode.get(checkoutCity?.value || "");
    if (checkoutProvince) checkoutProvince.value = region?.province || "";
  };
  const syncCheckoutAddressRequirements = () => {
    const pickup = shippingMethod?.value === "Store Pickup";
    const submit = document.querySelector("[data-checkout-submit]");
    if (submit) submit.textContent = pickup ? "Place order and reserve stock" : "Request delivery quote";
    document.querySelectorAll("[data-checkout-address-field]").forEach((field) => {
      field.hidden = pickup;
      field.querySelectorAll("input, select").forEach((input) => {
        if (input.name !== "shippingAddress2" && input.name !== "shippingCountry") input.required = !pickup;
      });
    });
  };
  shippingMethod?.addEventListener("change", syncCheckoutAddressRequirements);
  checkoutCity?.addEventListener("change", syncCheckoutProvince);
  syncCheckoutProvince();
  syncCheckoutAddressRequirements();

  document.querySelector("[data-order-status-refresh]")?.addEventListener("click", () => render({ preserveScroll: true }));
  document.querySelector("[data-order-pay]")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const notice = document.querySelector("[data-order-status-message]");
    button.disabled = true;
    if (notice) notice.textContent = "Opening secure payment...";
    try {
      const response = await fetch("/api/order-status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "start-payment", orderId: button.dataset.orderId, token: button.dataset.orderToken })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Payment could not be started.");
      if (!payload.payment?.redirectUrl) throw new Error(payload.payment?.reason === "midtrans-not-configured" ? "Online payment is not activated yet. NIXP has been notified of your quote." : "Payment is not available for this order.");
      window.location.assign(payload.payment.redirectUrl);
    } catch (error) {
      if (notice) notice.textContent = error instanceof Error ? error.message : "Payment could not be started.";
      button.disabled = false;
    }
  });

  document.querySelector("[data-admin-new-product]")?.addEventListener("click", () => {
    state.adminEditingProductId = null;
    state.adminNotice = "";
    state.adminNoticeTone = "";
    render({ preserveScroll: true });
  });

  bindAdminListControls();

  document.querySelector("[data-admin-product-form] select[name='category']")?.addEventListener("change", (event) => {
    const form = event.currentTarget.closest("[data-admin-product-form]");
    const isProductCategory = event.currentTarget.value === "Apparel" || event.currentTarget.value === "Objects";
    const isRecord = event.currentTarget.value === "Records";
    form.querySelector("[data-admin-record-fields]").hidden = isProductCategory;
    form.querySelector("[data-admin-product-fields]").hidden = !isProductCategory;
    form.querySelector("[data-admin-apparel-field]").hidden = event.currentTarget.value !== "Apparel";
    form.querySelector("[data-admin-edition-field]").hidden = !isRecord;
    form.querySelector("[data-admin-used-condition-fields]").hidden =
      !isRecord || !String(form.elements.condition.value || "").toLowerCase().startsWith("used");
    form.querySelectorAll("[data-admin-record-editorial-field]").forEach((field) => {
      field.hidden = !isRecord;
    });
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
    const wasEditing = Boolean(state.adminEditingProductId);
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
      state.adminEditingProductId = wasEditing ? saved.id : null;
      state.adminNotice = wasEditing ? "Product updated successfully." : "Product saved successfully. Ready for a new product.";
      state.adminNoticeTone = "success";
      await render({ preserveScroll: true });
    } catch (error) {
      state.adminNotice = error instanceof Error ? error.message : "Could not save product.";
      state.adminNoticeTone = "error";
      setFormMessage(form, state.adminNotice, "error");
      submitButton.disabled = false;
    }
  });

  document.querySelector("[data-admin-product-form] select[name='condition']")?.addEventListener("change", (event) => {
    const form = event.currentTarget.closest("[data-admin-product-form]");
    const isRecord = form.elements.category.value === "Records";
    form.querySelector("[data-admin-used-condition-fields]").hidden =
      !isRecord || !String(event.currentTarget.value || "").toLowerCase().startsWith("used");
  });

  document.querySelector("[data-admin-deploy-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button");
    button.disabled = true;
    setFormMessage(form, "Deploying...");
    try {
      const result = await adminStore.deployStore();
      const sha = result.github?.commitSha ? ` Commit ${result.github.commitSha.slice(0, 7)}.` : "";
      const tone = result.github?.skipped ? "warning" : "success";
      setFormMessage(form, `${result.message || "Deploy started."}${sha}`, tone);
    } catch (error) {
      setFormMessage(form, error instanceof Error ? error.message : "Deploy failed.", "error");
    } finally {
      button.disabled = false;
    }
  });

  document.querySelector("[data-admin-home-slider-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button");
    button.disabled = true;
    setFormMessage(form, "Saving slider...");
    try {
      await adminStore.saveHomeSlider(Object.fromEntries(new FormData(form).entries()));
      setFormMessage(form, "Slider saved. Use Deploy to publish it live.", "success");
      await render({ preserveScroll: true });
    } catch (error) {
      setFormMessage(form, error instanceof Error ? error.message : "Could not save slider.", "error");
      button.disabled = false;
    }
  });

  document.querySelector("[data-admin-shipping-quote-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button");
    const notice = form.querySelector("[data-admin-quote-message]");
    const data = Object.fromEntries(new FormData(form).entries());
    button.disabled = true;
    if (notice) notice.textContent = "Sending delivery quote...";
    try {
      const response = await fetch("/api/admin/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "issue-shipping-quote", ...data })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Delivery quote could not be issued.");
      form.reset();
      form.elements.courier.value = "JNE";
      if (notice) notice.textContent = "Quote sent. Stock is reserved for the two-hour payment window.";
      await adminStore.refresh();
      await render({ preserveScroll: true });
    } catch (error) {
      if (notice) notice.textContent = error instanceof Error ? error.message : "Delivery quote could not be issued.";
    } finally {
      button.disabled = false;
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
      await render({ preserveScroll: true });
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

  document.querySelector("[data-request-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const button = formElement.querySelector('button[type="submit"]');
    button.disabled = true;
    state.requestNotice = "Submitting request...";
    state.requestNoticeTone = "";
    await render({ preserveScroll: true });
    try {
      const response = await fetch("/api/catalog?action=request-item", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(Object.fromEntries(new FormData(formElement).entries()))
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Request could not be submitted.");
      state.requests = [payload.request, ...state.requests.filter((item) => item.id !== payload.request.id)];
      state.requestNotice = payload.notification?.delivered
        ? "Request submitted. NIXP has been notified."
        : "Request submitted successfully.";
      state.requestNoticeTone = "success";
      await render({ preserveScroll: true });
    } catch (error) {
      state.requestNotice = error instanceof Error ? error.message : "Request could not be submitted.";
      state.requestNoticeTone = "error";
      await render({ preserveScroll: true });
    }
  });
}

function bindAdminListControls(root = document) {
  root.querySelectorAll("[data-admin-edit-product]").forEach((button) => {
    button.addEventListener("click", () => {
      state.adminEditingProductId = button.dataset.adminEditProduct;
      window.scrollTo({ top: 0, behavior: "auto" });
      render();
    });
  });

  root.querySelectorAll("[data-admin-product-status]").forEach((button) => {
    button.addEventListener("click", async () => {
      await adminStore.updateProductStatus(button.dataset.adminProductStatus, button.dataset.status);
      await refreshAdminList("products");
    });
  });

  root.querySelectorAll("[data-admin-search]").forEach((input) => {
    input.addEventListener("input", async () => {
      const scope = input.dataset.adminSearch;
      state.adminSearch[scope] = input.value;
      await refreshAdminList(scope);
      const nextInput = document.querySelector(`[data-admin-search="${scope}"]`);
      nextInput?.focus();
      nextInput?.setSelectionRange(nextInput.value.length, nextInput.value.length);
    });
  });

  root.querySelectorAll("[data-admin-sort]").forEach((selectEl) => {
    selectEl.addEventListener("change", async () => {
      const scope = selectEl.dataset.adminSort;
      state.adminSort[scope] = selectEl.value;
      await refreshAdminList(scope);
    });
  });

  root.querySelectorAll("[data-admin-sort-button]").forEach((button) => {
    button.addEventListener("click", async () => {
      const scope = button.dataset.scope;
      const key = button.dataset.adminSortButton;
      const current = state.adminSort[scope];
      state.adminSort[scope] = current === key ? `${key}:desc` : key;
      await refreshAdminList(scope);
    });
  });
}

async function refreshAdminList(scope) {
  if (scope !== "products") {
    await render({ preserveScroll: true });
    return;
  }

  const panel = document.querySelector("[data-admin-products-catalog]");
  if (!panel) {
    await render({ preserveScroll: true });
    return;
  }

  const products = await catalogService.listAllProducts();
  const wrapper = document.createElement("div");
  wrapper.innerHTML = adminProductsCatalogMarkup(products).trim();
  const nextPanel = wrapper.firstElementChild;
  if (!nextPanel) return;
  panel.replaceWith(nextPanel);
  bindAdminListControls(nextPanel);
}

function setCartOpen(isOpen) {
  state.cartOpen = isOpen;
  document.querySelector("[data-cart-overlay]")?.classList.toggle("is-open", isOpen);
}

function bindHomeSlider() {
  homeSliderCleanup?.();
  homeSliderCleanup = null;

  const viewport = document.querySelector("[data-home-slider-viewport]");
  const track = document.querySelector("[data-home-slider-track]");
  const controlRail = document.querySelector("[data-home-slider-control]");
  const controlThumb = document.querySelector("[data-home-slider-thumb]");
  const previousButton = document.querySelector("[data-home-slider-previous]");
  const nextButton = document.querySelector("[data-home-slider-next]");
  if (!viewport || !track) return;

  let frameId = 0;
  let lastFrame = performance.now();
  let pausedUntil = 0;
  let mouseDragging = false;
  let touchActive = false;
  let controlActive = false;
  let controlPointerId = null;
  let controlValue = 0;
  let pointerId = null;
  let pointerStartX = 0;
  let pointerStartScroll = 0;
  let didDrag = false;
  let suppressClickUntil = 0;
  let pendingProductHref = "";
  let pendingProductX = 0;
  let pendingProductY = 0;
  let hovering = false;
  let touchResetTimer = 0;
  let autoScrollLeft = viewport.scrollLeft;
  let applyingAutoScroll = false;
  const supportsHoverPause =
    typeof window.matchMedia !== "function" ||
    (window.matchMedia("(hover: hover) and (pointer: fine)").matches && !window.matchMedia("(max-width: 860px)").matches);

  const loopWidth = () => {
    const gap = Number.parseFloat(getComputedStyle(track).columnGap || getComputedStyle(track).gap || "0") || 0;
    return track.scrollWidth / 2 + gap / 2;
  };
  const pause = (delay = 0) => {
    pausedUntil = Math.max(pausedUntil, performance.now() + delay);
  };
  const applyAutoScroll = () => {
    applyingAutoScroll = true;
    viewport.scrollLeft = autoScrollLeft;
    requestAnimationFrame(() => {
      applyingAutoScroll = false;
    });
  };
  const normalizeLoopPosition = (syncFromViewport = false) => {
    const width = loopWidth();
    if (!width) return;
    if (syncFromViewport) autoScrollLeft = viewport.scrollLeft;
    if (autoScrollLeft >= width) autoScrollLeft -= width;
    if (autoScrollLeft < 0) autoScrollLeft += width;
    applyAutoScroll();
  };
  const renderControl = () => {
    if (!controlRail || !controlThumb) return;
    const travel = Math.max(controlRail.clientWidth - controlThumb.offsetWidth, 0);
    controlThumb.style.transform = `translateX(${(controlValue / 1000) * travel}px)`;
    controlRail.setAttribute("aria-valuenow", String(controlValue));
  };
  const tick = (now) => {
    const elapsed = Math.min(now - lastFrame, 80);
    lastFrame = now;
    const width = loopWidth();
    if (!mouseDragging && !touchActive && !controlActive && !hovering && now >= pausedUntil && width > 0) {
      // Keep the existing 95 second loop speed while using native scroll for swipe support.
      autoScrollLeft += (width / 95_000) * elapsed;
      normalizeLoopPosition();
    }
    frameId = requestAnimationFrame(tick);
  };
  const onPointerDown = (event) => {
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    mouseDragging = true;
    didDrag = false;
    pointerId = event.pointerId;
    pointerStartX = event.clientX;
    pointerStartScroll = viewport.scrollLeft;
    pause();
    viewport.classList.add("is-dragging");
    viewport.setPointerCapture?.(pointerId);
  };
  const onProductPointerDown = (event) => {
    const productLink = event.target?.closest?.("a[data-product-link]");
    pendingProductHref = productLink?.getAttribute("href") || "";
    pendingProductX = event.clientX;
    pendingProductY = event.clientY;
    if (pendingProductHref) pause(1_200);
  };
  const onPointerMove = (event) => {
    if (!mouseDragging || event.pointerId !== pointerId) return;
    const distance = event.clientX - pointerStartX;
    if (Math.abs(distance) > 12) didDrag = true;
    autoScrollLeft = pointerStartScroll - distance;
    normalizeLoopPosition();
  };
  const stopDrag = (event) => {
    if (!mouseDragging || (event && event.pointerId !== pointerId)) return;
    mouseDragging = false;
    pointerId = null;
    viewport.classList.remove("is-dragging");
    if (didDrag) suppressClickUntil = performance.now() + 350;
    pause(1_500);
  };
  const onProductPointerUp = (event) => {
    if (!pendingProductHref || controlActive) return;
    const moved =
      Math.abs(event.clientX - pendingProductX) > 10 ||
      Math.abs(event.clientY - pendingProductY) > 10;
    const href = pendingProductHref;
    pendingProductHref = "";
    if (moved || didDrag) return;
    event.preventDefault();
    event.stopPropagation();
    suppressClickUntil = performance.now() + 500;
    navigateInternal(href);
  };
  const preventClickAfterDrag = (event) => {
    const productLink = event.target?.closest?.("a[data-product-link]");
    if (productLink && (!didDrag || performance.now() > suppressClickUntil)) {
      event.preventDefault();
      event.stopPropagation();
      didDrag = false;
      suppressClickUntil = 0;
      navigateInternal(productLink.getAttribute("href"));
      return;
    }
    if (!didDrag || performance.now() > suppressClickUntil) {
      didDrag = false;
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    didDrag = false;
    suppressClickUntil = 0;
  };
  const onScroll = () => {
    if (!applyingAutoScroll) normalizeLoopPosition(true);
  };
  const onTouchStart = () => {
    touchActive = true;
    window.clearTimeout(touchResetTimer);
    touchResetTimer = window.setTimeout(() => {
      touchActive = false;
    }, 1_200);
  };
  const onTouchEnd = () => {
    touchActive = false;
    window.clearTimeout(touchResetTimer);
    pause(1_500);
  };
  const setControlPosition = (clientX) => {
    const width = loopWidth();
    if (!width || !controlRail || !controlThumb) return;
    const rect = controlRail.getBoundingClientRect();
    const travel = Math.max(rect.width - controlThumb.offsetWidth, 1);
    const ratio = Math.min(Math.max((clientX - rect.left - controlThumb.offsetWidth / 2) / travel, 0), 1);
    controlValue = Math.round(ratio * 1000);
    renderControl();
    autoScrollLeft = ratio * width;
    normalizeLoopPosition();
    pause(1_500);
  };
  const onControlPointerDown = (event) => {
    if (event.button !== 0 || !controlRail) return;
    controlActive = true;
    controlPointerId = event.pointerId;
    controlRail.setPointerCapture?.(controlPointerId);
    setControlPosition(event.clientX);
  };
  const onControlPointerMove = (event) => {
    if (!controlActive || event.pointerId !== controlPointerId) return;
    setControlPosition(event.clientX);
  };
  const onControlPointerEnd = (event) => {
    if (!controlActive || (event && event.pointerId !== controlPointerId)) return;
    controlActive = false;
    controlPointerId = null;
    pause(1_500);
  };
  const nudgeSlider = (direction) => {
    const width = loopWidth();
    autoScrollLeft = viewport.scrollLeft + direction * viewport.clientWidth * 0.82;
    if (width && autoScrollLeft >= width) autoScrollLeft -= width;
    if (width && autoScrollLeft < 0) autoScrollLeft += width;
    viewport.scrollTo({ left: autoScrollLeft, behavior: "smooth" });
    pause(2_000);
  };
  const onControlKeyDown = (event) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      nudgeSlider(-1);
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      nudgeSlider(1);
    }
  };
  const onPreviousButtonClick = () => nudgeSlider(-1);
  const onNextButtonClick = () => nudgeSlider(1);
  const onMouseEnter = () => {
    if (!supportsHoverPause) return;
    hovering = true;
  };
  const onMouseLeave = () => {
    if (!supportsHoverPause) return;
    hovering = false;
  };

  viewport.addEventListener("pointerdown", onPointerDown);
  viewport.addEventListener("pointerdown", onProductPointerDown, true);
  viewport.addEventListener("pointermove", onPointerMove);
  viewport.addEventListener("pointerup", stopDrag);
  viewport.addEventListener("pointerup", onProductPointerUp, true);
  viewport.addEventListener("pointercancel", stopDrag);
  viewport.addEventListener("click", preventClickAfterDrag, true);
  viewport.addEventListener("mouseenter", onMouseEnter);
  viewport.addEventListener("mouseleave", onMouseLeave);
  viewport.addEventListener("scroll", onScroll, { passive: true });
  viewport.addEventListener("touchstart", onTouchStart, { passive: true });
  viewport.addEventListener("touchend", onTouchEnd, { passive: true });
  viewport.addEventListener("touchcancel", onTouchEnd, { passive: true });
  controlRail?.addEventListener("pointerdown", onControlPointerDown);
  controlRail?.addEventListener("pointermove", onControlPointerMove);
  controlRail?.addEventListener("pointerup", onControlPointerEnd);
  controlRail?.addEventListener("pointercancel", onControlPointerEnd);
  controlRail?.addEventListener("keydown", onControlKeyDown);
  previousButton?.addEventListener("click", onPreviousButtonClick);
  nextButton?.addEventListener("click", onNextButtonClick);
  renderControl();
  frameId = requestAnimationFrame(tick);

  homeSliderCleanup = () => {
    cancelAnimationFrame(frameId);
    window.clearTimeout(touchResetTimer);
    viewport.removeEventListener("pointerdown", onPointerDown);
    viewport.removeEventListener("pointerdown", onProductPointerDown, true);
    viewport.removeEventListener("pointermove", onPointerMove);
    viewport.removeEventListener("pointerup", stopDrag);
    viewport.removeEventListener("pointerup", onProductPointerUp, true);
    viewport.removeEventListener("pointercancel", stopDrag);
    viewport.removeEventListener("click", preventClickAfterDrag, true);
    viewport.removeEventListener("mouseenter", onMouseEnter);
    viewport.removeEventListener("mouseleave", onMouseLeave);
    viewport.removeEventListener("scroll", onScroll);
    viewport.removeEventListener("touchstart", onTouchStart);
    viewport.removeEventListener("touchend", onTouchEnd);
    viewport.removeEventListener("touchcancel", onTouchEnd);
    controlRail?.removeEventListener("pointerdown", onControlPointerDown);
    controlRail?.removeEventListener("pointermove", onControlPointerMove);
    controlRail?.removeEventListener("pointerup", onControlPointerEnd);
    controlRail?.removeEventListener("pointercancel", onControlPointerEnd);
    controlRail?.removeEventListener("keydown", onControlKeyDown);
    previousButton?.removeEventListener("click", onPreviousButtonClick);
    nextButton?.removeEventListener("click", onNextButtonClick);
  };
}

function setSearchOpen(isOpen) {
  state.searchOpen = isOpen;
  document.querySelector("[data-search-overlay]")?.classList.toggle("is-open", isOpen);
  if (isOpen) setTimeout(() => document.querySelector("[data-search-input]")?.focus(), 0);
}

function bindSearch() {
  const input = document.querySelector("[data-search-input]");
  const results = document.querySelector("[data-search-results]");
  const dataEl = document.querySelector("[data-search-data]");
  if (!input || !results || !dataEl) return;

  const suggestions = JSON.parse(dataEl.textContent || "[]");
  const renderSearch = () => {
    const query = input.value.trim().toLowerCase();
    if (query.length < 3) {
      results.innerHTML = "";
      return;
    }

    const matches = suggestions
      .filter((item) => `${item.title} ${item.meta} ${item.type}`.toLowerCase().includes(query))
      .slice(0, 8);

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
        setSearchOpen(false);
        navigateInternal(link.getAttribute("href"));
      });
    });
  };

  input.addEventListener("input", renderSearch);
  if (state.searchOpen) setTimeout(() => input.focus(), 0);
}

window.addEventListener("popstate", render);
adminStore
  .initialize()
  .then(() => render())
  .catch((error) => {
    console.warn("Catalog refresh failed; continuing with the local snapshot.", error);
    return render();
  });
