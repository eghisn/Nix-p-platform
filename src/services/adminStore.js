import { artistNames, cashflow, inventory, orders, products, requestItems } from "../data/sampleData.js";
import { canonicalProductArtist, canonicalLabelName, canonicalRelatedArtistName } from "../data/catalogIdentity.js";
import { isRecentReleaseProduct } from "../data/homeCollections.js";
import { isRecordPublicationReady } from "../data/catalogPublication.js";
import { needsRecordConditionDetails } from "../data/recordMetadata.js";

const STORAGE_KEY = "nixp-admin-store-v1";
const STORE_VERSION = "home-slider-related-artists-2026-07-15";
const ADMIN_STORE_PATH = "/public/data/admin-store.json";
const PUBLIC_STORE_PATH = "/public/data/public-store.json";
const REMOVED_PRODUCT_IDS = new Set(["obj-001", "pub-002"]);
const CATALOG_SYNC_ENDPOINT = "/api/admin/store?commerceAction=catalog-sync";

let activeStore = null;
let activeStoreScope = null;
let privateStoreRefresh = null;
let privateStoreRefreshedAt = 0;

function storeRevision(value) {
  return JSON.stringify(value || []);
}

function notifyPrivateStoreRefreshed() {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("nixp:private-store-refreshed"));
}

function reconcilePublicationInBackground() {
  fetch("/api/admin/deploy-status?reconcile=1", { cache: "no-store" }).catch(() => {});
}

function assertPrivateStoreReady() {
  // The initial private catalog refresh runs in the background so the editor
  // can open immediately. Do not let an older browser snapshot become a save
  // payload before the server-authoritative refresh has completed.
  if (canUsePrivateStore() && privateStoreRefresh) {
    throw new Error("Admin is still syncing the current server catalog. Wait a moment before saving or publishing.");
  }
}

function wait(ms) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

// Use the actual serverless handler rather than a rewrite alias. A one-time
// retry absorbs a transient Vercel function start without duplicating changes.
async function syncCatalog(payload) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(CATALOG_SYNC_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(payload),
        cache: "no-store"
      });
      const result = await response.json().catch(() => ({}));
      if (response.ok) return result;
      const message = result.error || `Catalog research returned HTTP ${response.status}.`;
      if (response.status >= 500 && attempt === 0) {
        lastError = new Error(message);
        await wait(700);
        continue;
      }
      throw new Error(message);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Catalog research could not be reached.");
      if (attempt === 0) {
        await wait(700);
        continue;
      }
    }
  }
  throw new Error(`Catalog research is temporarily unavailable. Nothing was published or changed. Retry Research & Complete. ${lastError?.message || ""}`.trim());
}

const defaultCollections = [
  { id: "records", title: "Records", type: "Category", status: "Published", sort: 1 },
  { id: "objects", title: "Objects", type: "Category", status: "Published", sort: 2 },
  { id: "apparel", title: "Apparel", type: "Category", status: "Published", sort: 3 },
  { id: "publishing", title: "Publishing", type: "Category", status: "Published", sort: 4 },
  { id: "recent-releases", title: "Recent Releases", type: "Home", status: "Published", sort: 10 },
  { id: "nixp-selection", title: "NIXP Selection", type: "Home", status: "Published", sort: 11 },
  { id: "back-in-stock", title: "Back in Stock", type: "Home", status: "Published", sort: 12 },
  { id: "limited-pressing", title: "Limited Pressing", type: "Home", status: "Published", sort: 13 },
  { id: "private-collection", title: "Private Collection", type: "Home", status: "Published", sort: 14 }
];


function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function withDefaults(product) {
  const isFinanceDraft = String(product.id || "").startsWith("finance-") || Boolean(product.financeStockId);
  const defaults = {
    publishStatus: "Published",
    visibility: "Public",
    updatedAt: "2026-07-11",
    ...product,
    artist: canonicalProductArtist(product),
    label: canonicalLabelName(product.label),
    image: product.image || product.images?.[0] || (isFinanceDraft ? "" : "/public/nixp-product-example-paper.png"),
    edition: String(product.edition || "").trim(),
    barcode: String(product.barcode || "").trim(),
    catalogNumber: String(product.catalogNumber || "").trim(),
    mediaCondition: String(product.mediaCondition || "").trim(),
    sleeveCondition: String(product.sleeveCondition || "").trim(),
    tags: product.tags || [],
    details: product.details || [],
    sizes: normalizeSizes(product.sizes || []),
    images: normalizeImages(product),
    relatedArtists: normalizeList(product.relatedArtists).map(canonicalRelatedArtistName),
    descriptionSource: String(product.descriptionSource || "").trim(),
    reviewQuote: String(product.reviewQuote || "").trim(),
    reviewSource: String(product.reviewSource || "").trim(),
    reviewUrl: String(product.reviewUrl || "").trim(),
    homeCollections: normalizeList(product.homeCollections),
    homeSlideSort: hasHomeSlideSort(product) ? Number(product.homeSlideSort) : null,
    collection: product.collection || product.label || "",
    color: product.color || "",
    material: product.material || "",
    qty: Number(product.qty ?? 1),
    open_to_offers: product.open_to_offers === true,
    minimumAcceptableOffer: wholeAmount(product.minimumAcceptableOffer),
    shipping: normalizeShipping(product.shipping)
  };
  return {
    ...defaults,
    homeCollections: normalizeHomeCollections(defaults)
  };
}

function isRecentRelease(product = {}) {
  return isRecentReleaseProduct(product);
}

function normalizeHomeCollections(product, values = product.homeCollections) {
  const collections = new Set(normalizeList(values));
  if (isRecentRelease(product)) collections.add("recent-releases");
  else collections.delete("recent-releases");
  return [...collections];
}

function normalizeList(value) {
  return Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean) : [];
}

function isCompleteEditorialProduct(product = {}) {
  const relatedResearchStatus = String(product.relatedArtistsResearch?.status || product.raw?.relatedArtistsResearch?.status || "").trim();
  return Boolean(
    product.category === "Records" &&
      String(product.description || "").trim() &&
      String(product.reviewQuote || "").trim() &&
      (Array.isArray(product.relatedArtists) && product.relatedArtists.length || ["verified", "combined", "lastfm", "no-verified-match"].includes(relatedResearchStatus)) &&
      ["complete", "complete-no-related-artists"].includes(String(product.enrichmentStatus || product.raw?.enrichmentStatus || "").toLowerCase())
  );
}

function isManagedCatalogImage(value) {
  const image = String(value || "").trim();
  return Boolean(
    image &&
      (image.startsWith("/public/") || image.startsWith("/assets/") || /supabase\.co\/storage\/v1\/object\/public\//i.test(image))
  );
}

function snapshotOwnsEditorialFields(product = {}) {
  return Boolean(
    isCompleteEditorialProduct(product) &&
      (isManagedCatalogImage(product.image) || (product.images || []).some(isManagedCatalogImage))
  );
}

function hasExplicitManualRelatedArtistsOverride(product = {}) {
  const raw = product.raw || {};
  const enabled = product.manualRelatedArtistsOverride === true || raw.manualRelatedArtistsOverride === true;
  if (!enabled) return false;
  const manual = normalizeList(product.manualRelatedArtists || raw.manualRelatedArtists);
  if (String(product.manualRelatedArtistsOverrideSource || raw.manualRelatedArtistsOverrideSource || "").trim().toLowerCase() === "admin") return true;
  if (manual.length) return true;
  const automatic = normalizeList(product.relatedArtistsResearch?.artists || raw.relatedArtistsResearch?.artists || raw.autoEditorial?.relatedArtists);
  return automatic.length === 0;
}

export function reconcilePublicCatalog(remoteStore, snapshotStore) {
  const snapshotIds = new Set((snapshotStore?.products || []).map((product) => String(product?.id || "")).filter(Boolean));
  // The deployed snapshot protects locally managed media from a stale API
  // image. Editorial research, however, is server-owned: otherwise a fresh
  // Last.fm/MusicBrainz result is silently replaced by yesterday's snapshot.
  const snapshotMediaFields = ["image", "images", "imageCredits", "autoProductPhoto"];
  const researchedEditorialFields = [
    "description",
    "descriptionSource",
    "reviewQuote",
    "reviewSource",
    "reviewUrl",
    "relatedArtists",
    "manualRelatedArtists",
    "manualRelatedArtistsOverride",
    "relatedArtistEvidence",
    "relatedArtistsResearch",
    "autoEditorial",
    "enrichmentOrigin",
    "enrichmentStatus",
    "enrichmentUpdatedAt",
    "enrichmentAttemptedAt",
    "metadataSourceUrl",
    "musicBrainzReleaseId",
    "edition",
    "catalogNumber",
    "barcode",
    "details"
  ];
  const hasEditorialValue = (value) => {
    if (Array.isArray(value)) return value.length > 0;
    if (value && typeof value === "object") return Object.keys(value).length > 0;
    return value !== null && value !== undefined && String(value).trim() !== "";
  };
  const remoteProducts = Array.isArray(remoteStore?.products) ? remoteStore.products : [];
  const remoteById = new Map(remoteProducts.map((product) => [String(product?.id || ""), product]));
  const remoteOnly = remoteProducts.filter((product) => {
    if (snapshotIds.has(String(product?.id || ""))) return false;
    return product?.category !== "Records" || isRecordPublicationReady(product);
  });
  const reconciledSnapshot = (snapshotStore?.products || [])
    .map((snapshotProduct) => {
      const remoteProduct = remoteById.get(String(snapshotProduct?.id || ""));
      // A public API response can be temporarily empty or partial while a
      // server-side catalog read is refreshing. Never let that transient
      // response erase a product already present in the deployed snapshot.
      if (!remoteProduct) return snapshotProduct;
      if (String(remoteProduct.publishStatus || "").toLowerCase() === "archived") return null;

      const mediaProtected = snapshotOwnsEditorialFields(snapshotProduct)
        ? snapshotMediaFields.reduce(
            (merged, field) => (snapshotProduct[field] !== undefined ? { ...merged, [field]: snapshotProduct[field] } : merged),
            remoteProduct
          )
        : remoteProduct;

      // Prefer fresh server research whenever it is present. If an older API
      // revision has an empty field, retain a non-empty snapshot value so a
      // transient partial response cannot erase an already published detail.
      return researchedEditorialFields.reduce((merged, field) => {
        if (field === "manualRelatedArtistsOverride" && hasExplicitManualRelatedArtistsOverride(remoteProduct)) {
          return {
            ...merged,
            manualRelatedArtistsOverride: true,
            manualRelatedArtists: remoteProduct.manualRelatedArtists || [],
            relatedArtists: remoteProduct.relatedArtists || []
          };
        }
        if (hasEditorialValue(remoteProduct[field])) return { ...merged, [field]: remoteProduct[field] };
        if (hasEditorialValue(snapshotProduct[field])) return { ...merged, [field]: snapshotProduct[field] };
        return merged;
      }, mediaProtected);
    })
    .filter(Boolean);
  return {
    ...remoteStore,
    // A complete public product may reach Supabase before the next static
    // snapshot commit. Never make the browser hide it during hydration.
    products: [...remoteOnly, ...reconciledSnapshot],
    artists: reconcilePublicRows(remoteStore.artists || [], snapshotStore?.artists || [])
  };
}

function reconcilePublicRows(remoteRows = [], snapshotRows = []) {
  const remoteById = new Map(remoteRows.map((row) => [String(row?.id || ""), row]));
  const snapshotIds = new Set(snapshotRows.map((row) => String(row?.id || "")).filter(Boolean));
  const reconciled = snapshotRows
    .map((snapshotRow) => {
      const remoteRow = remoteById.get(String(snapshotRow?.id || ""));
      if (String(remoteRow?.status || "").toLowerCase() === "archived") return null;
      return remoteRow || snapshotRow;
    })
    .filter(Boolean);
  const remoteOnly = remoteRows.filter((row) => !snapshotIds.has(String(row?.id || "")));
  return [...reconciled, ...remoteOnly].sort(
    (a, b) => Number(a?.sort || 0) - Number(b?.sort || 0) || String(a?.name || "").localeCompare(String(b?.name || ""))
  );
}

function normalizeVerifiedCommerce(row = {}) {
  const price = Number(row.price);
  const qty = Number(row.qty);
  return {
    id: String(row.id || ""),
    price: Number.isFinite(price) ? price : null,
    qty: Number.isFinite(qty) ? Math.max(0, qty) : null,
    sizes: Array.isArray(row.sizes) ? normalizeSizes(row.sizes) : null,
    publishStatus: String(row.publishStatus || row.publish_status || ""),
    visibility: String(row.visibility || "")
  };
}

async function fetchVerifiedCommerce(ids = []) {
  const uniqueIds = [...new Set((ids || []).map(String).filter(Boolean))];
  if (!uniqueIds.length) return [];
  try {
    const response = await fetch("/api/prices", {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ ids: uniqueIds })
    });
    if (!response.ok) throw new Error("Price API unavailable");
    const payload = await response.json();
    return (payload.prices || []).map(normalizeVerifiedCommerce).filter((row) => row.id);
  } catch {
    // Keep the cached editorial catalogue usable during a temporary API failure.
    return [];
  }
}

async function reconcilePublicCommerce(store) {
  const products = store?.products || [];
  const verified = await fetchVerifiedCommerce(products.map((product) => product.id));
  if (!verified.length) return store;
  const byId = new Map(verified.map((row) => [row.id, row]));
  return {
    ...store,
    products: products.map((product) => {
      const live = byId.get(product.id);
      if (!live) return product;
      return {
        ...product,
        ...(live.price === null ? {} : { price: live.price }),
        ...(live.qty === null ? {} : { qty: live.qty }),
        ...(live.sizes === null ? {} : { sizes: live.sizes }),
        ...(live.publishStatus ? { publishStatus: live.publishStatus } : {}),
        ...(live.visibility ? { visibility: live.visibility } : {})
      };
    })
  };
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : null;
}

function normalizeShipping(shipping = {}) {
  const data = shipping || {};
  return {
    weightGrams: nullableNumber(data.weightGrams),
    lengthCm: nullableNumber(data.lengthCm),
    widthCm: nullableNumber(data.widthCm),
    heightCm: nullableNumber(data.heightCm),
    shippingClass: String(data.shippingClass || "").trim(),
    packageType: String(data.packageType || "").trim(),
    packagingGroup: String(data.packagingGroup || "").trim().toUpperCase(),
    vinylWeightClass: String(data.vinylWeightClass || "").trim(),
    manualShippingOverride: data.manualShippingOverride === true || String(data.manualShippingOverride || "").toLowerCase() === "yes",
    status: data.status || "needs_measurement",
    source: String(data.source || "").trim(),
    updatedAt: data.updatedAt || ""
  };
}

function hasHomeSlideSort(product) {
  return product.homeSlideSort !== null && product.homeSlideSort !== undefined && product.homeSlideSort !== "" && Number.isFinite(Number(product.homeSlideSort));
}

function normalizeImages(product = {}) {
  const urls = [
    ...(Array.isArray(product.images) ? product.images : []),
    product.image
  ]
    .map((image) => String(image || "").trim())
    .filter(Boolean);
  return [...new Set(urls)];
}

function normalizeSizes(sizes) {
  const byLabel = new Map();
  for (const size of Array.isArray(sizes) ? sizes : []) {
    const label = String(size.label || "").trim();
    if (!label) continue;
    const quantity = Math.max(0, Number(size.quantity ?? size.qty ?? (size.soldOut ? 0 : 1)) || 0);
    byLabel.set(label.toLowerCase(), {
      label,
      quantity,
      soldOut: quantity <= 0
    });
  }
  return [...byLabel.values()];
}

function productStock(product = {}) {
  if (Array.isArray(product.sizes) && product.sizes.length) {
    return product.sizes.reduce((sum, size) => sum + (Number(size.quantity ?? size.qty ?? (size.soldOut ? 0 : 1)) || 0), 0);
  }
  return Math.max(0, Number(product.qty ?? 0) || 0);
}

function isLocalEditorRuntime() {
  if (typeof location === "undefined") return true;
  return ["localhost", "127.0.0.1", ""].includes(location.hostname);
}

function privateWorkspaceFromHost() {
  if (typeof location === "undefined") return "";
  const host = location.hostname.toLowerCase();
  if (host === "admin.nix-p.com") return "admin";
  if (host === "finance.nix-p.com") return "finance";
  return "";
}

function canUsePrivateStore() {
  if (privateWorkspaceFromHost()) return true;
  if (!isLocalEditorRuntime() || typeof location === "undefined") return false;
  const path = location.pathname || "/";
  return path.startsWith("/admin") || path.startsWith("/finance");
}

function currentStoreScope() {
  return canUsePrivateStore() ? "admin" : "public";
}

function deployedPublicStorePath() {
  if (typeof document === "undefined") return PUBLIC_STORE_PATH;
  const path = document.querySelector('meta[name="nixp-catalog-snapshot"]')?.content || "";
  return /^\/public\/data\/releases\/[a-z0-9]+\.json$/i.test(path) ? path : PUBLIC_STORE_PATH;
}

function deployedReleaseRevision() {
  if (typeof document === "undefined") return "";
  return String(document.querySelector('meta[name="nixp-release-revision"]')?.content || "").trim();
}

function normalizeApparelType(value) {
  const type = String(value || "").trim().toLowerCase();
  if (type === "accesories" || type === "accessory") return "Accessories";
  if (type === "tops" || type === "top") return "Tops";
  if (type === "bottoms" || type === "bottom") return "Bottoms";
  return String(value || "").trim();
}

function seed({ publicOnly = !canUsePrivateStore() } = {}) {
  return {
    version: STORE_VERSION,
    products: products.map(withDefaults),
    artists: [...new Set(artistNames)].sort((a, b) => a.localeCompare(b)).map((name, index) => ({
      id: slugify(name),
      name,
      bio: "",
      status: "Published",
      sort: index + 1
    })),
    collections: defaultCollections,
    requests: publicOnly ? [] : clone(requestItems),
    offers: [],
    orders: publicOnly ? [] : clone(orders),
    cashflow: publicOnly ? [] : clone(cashflow),
    inventory: publicOnly ? [] : clone(inventory)
  };
}

function readStore() {
  // Both local editors and the authenticated admin/finance subdomains need the private store.
  const publicOnly = !canUsePrivateStore();
  const scope = currentStoreScope();
  const seeded = seed({ publicOnly });
  if (activeStore && activeStoreScope === scope) return mergeStore(seeded, activeStore, { publicOnly });
  if (publicOnly) return seeded;
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!saved) return seeded;
    if (saved.version !== STORE_VERSION) return seeded;
    return mergeStore(seeded, saved, { publicOnly });
  } catch {
    return seeded;
  }
}

async function writeStore(store, { inventoryProduct = null } = {}) {
  if (!canUsePrivateStore()) return false;
  assertPrivateStoreReady();
  const normalizedStore = normalizeStoreForSave(store);
  const previousActiveStore = activeStore;
  const previousActiveStoreScope = activeStoreScope;
  const previousSavedStore = localStorage.getItem(STORAGE_KEY);
  activeStore = normalizedStore;
  activeStoreScope = "admin";
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizedStore));
  try {
    return await persistStore(normalizedStore, { inventoryProduct });
  } catch (error) {
    activeStore = previousActiveStore;
    activeStoreScope = previousActiveStoreScope;
    if (previousSavedStore === null) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, previousSavedStore);
    }
    throw error;
  }
}

function normalizeStoreForSave(store) {
  return {
    ...store,
    products: dedupeStoreArray(store.products || [], "products").map(withDefaults),
    artists: dedupeStoreArray(store.artists || [], "artists"),
    collections: dedupeStoreArray(store.collections || [], "collections"),
    requests: dedupeStoreArray(store.requests || [], "requests"),
    offers: dedupeStoreArray(store.offers || [], "offers"),
    orders: dedupeStoreArray(store.orders || [], "orders"),
    cashflow: dedupeStoreArray(store.cashflow || [], "cashflow"),
    inventory: dedupeStoreArray(store.inventory || [], "inventory")
  };
}

function dedupeStoreArray(items, table) {
  const byId = new Map();
  for (const [index, item] of (Array.isArray(items) ? items : []).entries()) {
    const id = storeRowId(item, table, index);
    byId.set(id, { ...item, id });
  }
  return [...byId.values()];
}

function storeRowId(item = {}, table = "items", index = 0) {
  const explicit = String(item.id || "").trim();
  if (explicit && explicit !== "undefined") return explicit;
  const candidates = [
    item.productId,
    item.sku,
    item.orderNumber,
    item.email,
    item.month,
    item.date,
    item.title,
    item.name
  ];
  const source = candidates.map((value) => String(value || "").trim()).find(Boolean) || `row-${index + 1}`;
  return `${table}-${slugify(source)}`;
}

function mergeStore(seeded, saved, { publicOnly = false } = {}) {
  const savedProducts = (saved.products || [])
    .filter((product) => !REMOVED_PRODUCT_IDS.has(product.id))
    .map(withDefaults);
  const seededProducts = seeded.products
    .filter((product) => !REMOVED_PRODUCT_IDS.has(product.id))
    .map(withDefaults);
  const mergedProducts = [
    ...savedProducts.map((product) => {
      const seedProduct = seededProducts.find((item) => item.id === product.id);
      const mergedProduct = { ...product };
      const editorialFields = [
        "description",
        "descriptionSource",
        "reviewQuote",
        "reviewSource",
        "reviewUrl",
        "edition",
        "barcode",
        "catalogNumber",
        "mediaCondition",
        "sleeveCondition"
      ];
      for (const field of editorialFields) {
        const savedValue = String(product[field] || "").trim();
        const isGenericDescription = field === "description" && savedValue.includes("current NIXP records selection");
        if ((!savedValue || isGenericDescription) && seedProduct?.[field]) mergedProduct[field] = seedProduct[field];
      }
      if (
        seedProduct?.image?.startsWith("/public/display-photos/") &&
        (!product.image || product.image === "/public/nixp-product-example-paper.png")
      ) {
        mergedProduct.image = seedProduct.image;
      }
      return mergedProduct;
    }),
    ...seededProducts.filter((seedProduct) => !savedProducts.some((product) => product.id === seedProduct.id))
  ];
  return {
    ...seeded,
    ...saved,
    version: STORE_VERSION,
    products: mergedProducts,
    artists: saved.artists || seeded.artists,
    collections: saved.collections || seeded.collections,
    requests: publicOnly ? [] : saved.requests || seeded.requests,
    offers: publicOnly ? [] : saved.offers || seeded.offers,
    orders: publicOnly ? [] : saved.orders || seeded.orders,
    cashflow: publicOnly ? [] : saved.cashflow || seeded.cashflow,
    inventory: publicOnly ? [] : saved.inventory || seeded.inventory
  };
}

function collectSizes(data) {
  return Object.entries(data)
    .filter(([key]) => key.startsWith("sizeQty:"))
    .map(([key, value]) => {
      const label = key.replace("sizeQty:", "");
      const rawValue = String(value ?? "").trim();
      if (rawValue === "") return null;
      const parsedQuantity = Number(rawValue);
      if (!Number.isFinite(parsedQuantity)) return null;
      const quantity = Math.max(0, parsedQuantity);
      return { label, quantity, soldOut: quantity <= 0 };
    })
    .filter((size) => size?.label);
}

async function persistStore(store, { inventoryProduct = null } = {}) {
  try {
    const response = await fetch("/api/admin/store", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ store, inventoryProduct })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error("Admin session expired. Refresh the Admin Editor and sign in again.");
      }
      throw new Error(payload.error || `Store save failed on the server (HTTP ${response.status}). Please try again.`);
    }
    if (payload.store?.products) {
      activeStore = normalizeStoreForSave(payload.store);
      activeStoreScope = "admin";
      localStorage.setItem(STORAGE_KEY, JSON.stringify(activeStore));
    }
    return true;
  } catch (error) {
    // Static previews cannot write files. localStorage remains the fallback.
    if (typeof location !== "undefined" && location.protocol === "file:") return false;
    throw error;
  }
}

async function persistProduct(product, { expectedRevision = 0 } = {}) {
  const response = await fetch("/api/admin/store?commerceAction=product", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ product, expectedRevision })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error("Admin session expired. Refresh the Admin Editor and sign in again.");
    }
    const error = new Error(payload.error || `Product save failed on the server (HTTP ${response.status}). Please try again.`);
    error.statusCode = response.status;
    error.currentProduct = payload.currentProduct || null;
    throw error;
  }
  return payload;
}

async function writeStoreBestEffort(store) {
  try {
    return await writeStore(store);
  } catch {
    return false;
  }
}

let publicCommerceRefreshPromise = null;

function refreshPublicCommerceInBackground(store, ids = []) {
  const currentStore = activeStoreScope === "public" && activeStore ? activeStore : store;
  const requestedIds = [...new Set((ids || []).map(String).filter(Boolean))];
  const requestedIdSet = new Set(requestedIds);
  const products = currentStore?.products || [];
  const scopedStore = requestedIds.length
    ? { ...currentStore, products: products.filter((product) => requestedIdSet.has(String(product.id))) }
    : currentStore;
  if (publicCommerceRefreshPromise) return publicCommerceRefreshPromise;
  publicCommerceRefreshPromise = reconcilePublicCommerce(scopedStore)
    .then((nextStore) => {
      if (requestedIds.length) {
        const liveById = new Map((nextStore.products || []).map((product) => [String(product.id), product]));
        activeStore = {
          ...currentStore,
          products: products.map((product) => liveById.get(String(product.id)) || product)
        };
      } else {
        activeStore = nextStore;
      }
      activeStoreScope = "public";
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("nixp:public-commerce-refreshed"));
      }
      return activeStore;
    })
    .catch(() => currentStore)
    .finally(() => {
      publicCommerceRefreshPromise = null;
    });
  return publicCommerceRefreshPromise;
}

async function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function uploadDataUrlImage(dataUrl, product, fileName = "product-upload.png") {
  const response = await fetch("/api/admin/upload", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      dataUrl,
      fileName,
      sku: product.sku || product.id,
      title: product.title
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Upload failed. Please log in to admin and try again.");
  if (!payload.image) throw new Error("Upload finished without an image URL.");
  return payload.image;
}

async function migrateBrowserStore(fileStore, browserStore) {
  if (!browserStore || browserStore.version !== STORE_VERSION) return fileStore;
  const merged = mergeStore(seed(), fileStore);
  let changed = false;

  for (const browserProduct of browserStore.products || []) {
    if (REMOVED_PRODUCT_IDS.has(browserProduct.id)) continue;
    const existingIndex = merged.products.findIndex((product) => product.id === browserProduct.id);
    const existing = existingIndex >= 0 ? merged.products[existingIndex] : null;
    const hasBrowserUpload = String(browserProduct.image || "").startsWith("data:image/");
    const isMissingFromFile = !existing;
    const hasDifferentUsefulImage =
      browserProduct.image &&
      browserProduct.image !== existing?.image &&
      existing?.image === "/public/nixp-product-example-paper.png";

    if (!isMissingFromFile && !hasBrowserUpload && !hasDifferentUsefulImage) continue;

    const migratedProduct = withDefaults({
      ...existing,
      ...browserProduct,
      image: hasBrowserUpload
        ? await uploadDataUrlImage(browserProduct.image, browserProduct, `${browserProduct.sku || browserProduct.id}.png`)
        : browserProduct.image || existing?.image
    });

    if (existingIndex >= 0) {
      merged.products[existingIndex] = migratedProduct;
    } else {
      merged.products = [migratedProduct, ...merged.products];
    }
    changed = true;
  }

  if (changed) await writeStoreBestEffort(merged);
  return merged;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

export function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeCommerceOrder(row = {}) {
  const customer = row.customer || {};
  const metadata = row.metadata || {};
  const lineItems = Array.isArray(metadata.lineItems) ? metadata.lineItems : Array.isArray(row.lineItems) ? row.lineItems : [];
  const ids = lineItems.map((item) => item.productId).filter(Boolean);
  return {
    id: row.id,
    reference: row.public_reference || row.publicReference || row.id,
    date: String(row.created_at || row.createdAt || "").slice(0, 10),
    customer: customer.name || customer.email || row.name || "Website customer",
    email: customer.email || row.email || "",
    whatsapp: customer.whatsapp || row.whatsapp || "",
    channel: row.shipping_method ? `Website / ${row.shipping_method}` : row.channel || "Website",
    status: row.order_status || row.orderStatus || row.status || "Draft",
    orderStatus: row.order_status || row.orderStatus || row.status || "Draft",
    paymentStatus: row.payment_status || row.paymentStatus || "Unpaid",
    fulfillmentStatus: row.fulfillment_status || row.fulfillmentStatus || "Unfulfilled",
    shippingStatus: row.shipping_status || row.shippingStatus || "Not Required",
    courier: row.courier || "",
    trackingNumber: row.tracking_number || row.trackingNumber || "",
    merchandiseTotal: Number(row.merchandise_total ?? row.merchandiseTotal ?? 0),
    shippingTotal: Number(row.shipping_total ?? row.shippingTotal ?? 0),
    total: Number(row.grand_total ?? row.total ?? 0),
    items: Array.isArray(row.items) && row.items.length ? row.items : ids,
    lineItems,
    shippingCalculation: metadata.shippingCalculation || row.shippingCalculation || null,
    raw: row
  };
}

export const adminStore = {
  async initialize() {
    const publicOnly = !canUsePrivateStore();
    const scope = currentStoreScope();
    const expectedReleaseRevision = publicOnly ? deployedReleaseRevision() : "";
    let browserStore = null;
    if (!publicOnly) {
      try {
        browserStore = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      } catch {
        browserStore = null;
      }
    }

    if (!publicOnly) {
      const initialStore = browserStore?.version === STORE_VERSION ? browserStore : {};
      activeStore = mergeStore(seed({ publicOnly: false }), initialStore, { publicOnly: false });
      activeStoreScope = scope;
      privateStoreRefreshedAt = Date.now();
      // Render the last known private snapshot immediately. Previously this
      // awaited a full Supabase read of products, inventory, orders, cashflow,
      // requests, and offers, leaving a blank workspace for several seconds.
      // The authoritative response still replaces this snapshot in the
      // background, while writes remain guarded until that refresh is done.
      this.refreshPrivateStore({ force: true })
        .then(() => {
          notifyPrivateStoreRefreshed();
          reconcilePublicationInBackground();
        })
        .catch(() => {
          // Keep the last local snapshot available when the private API is down.
        });
      return;
    }

    try {
      // Public HTML is generated from this same deployed snapshot. Keep the
      // browser on that one editorial revision as well; loading the full
      // Supabase catalog here would make remote-only products or newer fields
      // appear after the initial HTML and create an old/new flash on refresh.
      const filePath = publicOnly ? deployedPublicStorePath() : ADMIN_STORE_PATH;
      // The public store is a deploy-owned editorial revision. Do not append a
      // timestamp here: it turns one immutable snapshot into a fresh cache key
      // on every refresh and makes the first interactive render needlessly late.
      const fileResponse = await fetch(filePath, { cache: publicOnly ? "default" : "no-store" });
      if (!fileResponse.ok) throw new Error("No file store");
      const fileStore = await fileResponse.json();
      if (expectedReleaseRevision && fileStore?.releaseRevision !== expectedReleaseRevision) {
        throw new Error("Catalog release does not match this page.");
      }
      activeStore = await migrateBrowserStore(
        mergeStore(seed({ publicOnly }), fileStore, { publicOnly }),
        browserStore
      );
      if (publicOnly) refreshPublicCommerceInBackground(activeStore);
      activeStoreScope = scope;
      privateStoreRefreshedAt = publicOnly ? privateStoreRefreshedAt : Date.now();
      if (!publicOnly) localStorage.setItem(STORAGE_KEY, JSON.stringify(activeStore));
    } catch {
      // Do not render a stale public seed/snapshot when the deployed source is
      // unavailable. A public API response is a single-source fallback, not a
      // second hydration pass, so it is only used when the snapshot request
      // itself failed before any public content was rendered.
      if (publicOnly) {
        if (expectedReleaseRevision) throw new Error("This catalog release is unavailable.");
        const response = await fetch("/api/catalog?scope=public", { cache: "default" });
        if (!response.ok) throw new Error("Public catalog unavailable.");
        const payload = await response.json();
        if (!payload.store) throw new Error("Public catalog unavailable.");
        activeStore = mergeStore(seed({ publicOnly }), payload.store, { publicOnly });
        activeStoreScope = scope;
        refreshPublicCommerceInBackground(activeStore);
      } else {
        activeStore = readStore();
      }
    }
  },
  async refresh() {
    activeStore = null;
    activeStoreScope = null;
    privateStoreRefreshedAt = 0;
    return this.initialize();
  },
  async refreshPublicCommerce(ids = []) {
    if (activeStoreScope !== "public" || !activeStore) return this.getSnapshot();
    return refreshPublicCommerceInBackground(activeStore, ids);
  },
  async refreshRequests() {
    await this.refreshPrivateStore();
    return this.getSnapshot().requests;
  },
  async refreshOrders() {
    if (canUsePrivateStore()) {
      try {
        const response = await fetch(`/api/admin/orders?v=${Date.now()}`, { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "Could not refresh orders.");
        const orders = (payload.orders || []).map(normalizeCommerceOrder);
        const snapshot = this.getSnapshot();
        activeStore = { ...snapshot, orders };
        activeStoreScope = "admin";
        privateStoreRefreshedAt = Date.now();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(activeStore));
        return orders;
      } catch {
        // Keep the workspace usable with the last known private store.
      }
    }
    await this.refreshPrivateStore({ force: true });
    return this.getSnapshot().orders;
  },
  async refreshInventory() {
    if (!canUsePrivateStore()) return this.getSnapshot().inventory;
    const response = await fetch(`/api/admin/store?commerceAction=inventory&v=${Date.now()}`, { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Could not refresh inventory.");
    const inventory = Array.isArray(payload.inventory) ? payload.inventory : [];
    const snapshot = this.getSnapshot();
    activeStore = { ...snapshot, inventory };
    activeStoreScope = "admin";
    localStorage.setItem(STORAGE_KEY, JSON.stringify(activeStore));
    return inventory;
  },
  async refreshOrdersIfChanged() {
    const before = storeRevision(this.getSnapshot().orders);
    const orders = await this.refreshOrders();
    return { orders, changed: before !== storeRevision(orders) };
  },
  async refreshPrivateStore({ force = false } = {}) {
    if (!canUsePrivateStore()) return this.getSnapshot();
    if (!force && activeStore && Date.now() - privateStoreRefreshedAt < 30_000) return this.getSnapshot();
    if (privateStoreRefresh) return privateStoreRefresh;
    privateStoreRefresh = (async () => {
      const response = await fetch(`/api/catalog?scope=admin&v=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Could not refresh admin data. Please log in to admin and try again.");
      const payload = await response.json();
      if (!payload.store) return this.getSnapshot();
      const current = this.getSnapshot();
      const partialStore = {
        ...payload.store,
        orders: Array.isArray(payload.store.orders) ? payload.store.orders : current.orders,
        cashflow: Array.isArray(payload.store.cashflow) ? payload.store.cashflow : current.cashflow,
        inventory: Array.isArray(payload.store.inventory) ? payload.store.inventory : current.inventory
      };
      activeStore = mergeStore(seed({ publicOnly: false }), partialStore, { publicOnly: false });
      activeStoreScope = "admin";
      privateStoreRefreshedAt = Date.now();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(activeStore));
      return activeStore;
    })();
    try {
      return await privateStoreRefresh;
    } finally {
      privateStoreRefresh = null;
    }
  },
  async verifyPrices(ids) {
    return fetchVerifiedCommerce(ids);
  },
  getSnapshot() {
    // Public navigation asks for products, artists, the cart, and search data
    // during one render. Reusing the hydrated snapshot avoids re-merging the
    // entire catalogue for each of those reads.
    const scope = currentStoreScope();
    if (activeStore && activeStoreScope === scope) return activeStore;
    return readStore();
  },
  async deployStore({ store, message, statusChange = null } = {}) {
    assertPrivateStoreReady();
    const currentStore = store || this.getSnapshot();
    const response = await fetch("/api/admin/deploy", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        store: currentStore,
        message: message || `Deploy NIXP catalog ${new Date().toISOString()}`,
        deploymentSource: "admin-editor",
        statusChange
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 409 && payload.statusChange?.blocked) {
      return { ...payload, blocked: true };
    }
    if (!response.ok) throw new Error(payload.error || "Deploy failed. Please check Vercel and GitHub settings.");
    return payload;
  },
  async deployCurrentCatalog({ message = "" } = {}) {
    assertPrivateStoreReady();
    return syncCatalog({
      action: "deploy-current",
      message: message || `Deploy current NIXP catalog ${new Date().toISOString()}`
    });
  },
  async saveProductAndPublish(data) {
    const saved = await this.saveProduct(data);
    const financeSync = saved.financeSync || null;
    // Draft and private listings deliberately stop at the protected database.
    // Public listings deploy from a fresh server snapshot so a browser cache
    // can never overwrite another editor's current catalog fields.
    await this.refreshPrivateStore({ force: true });
    const product = this.getSnapshot().products.find((item) => item.id === saved.id) || saved;
    if (product.publishStatus !== "Published" || product.visibility !== "Public") {
      return { product, financeSync, savedOnly: true, publicConfirmed: false };
    }
    try {
      const deployment = await this.deployCurrentCatalog({
        message: `Update ${product.sku || product.title} from Admin Editor`
      });
      return {
        product,
        financeSync,
        deployment,
        publicConfirmed: !deployment.github?.skipped && deployment.deployment?.confirmed === true
      };
    } catch (error) {
      return {
        product,
        financeSync,
        deploymentError: error instanceof Error ? error.message : "Public catalog deployment failed.",
        publicConfirmed: false
      };
    }
  },
  async publishProduct(id, publishStatus) {
    const store = this.getSnapshot();
    const product = store.products.find((item) => item.id === id);
    if (!product) throw new Error("Product could not be found in the Admin catalog.");
    const nextStore = {
      ...store,
      products: store.products.map((item) =>
        item.id === id
          ? {
              ...item,
              publishStatus,
              visibility: publishStatus === "Published" ? "Public" : "Private",
              raw: {
                ...(item.raw || {}),
                adminPublishOverride: publishStatus === "Draft" ? "Draft" : null
              },
              updatedAt: today()
            }
          : item
      )
    };
    const result = await this.deployStore({
      store: nextStore,
      message: `${publishStatus === "Published" ? "Publish" : "Unpublish"} ${product.sku || product.title}`,
      statusChange: { id, publishStatus, expectedRevision: product.editRevision || 0 }
    });
    await this.refreshPrivateStore({ force: true });
    const savedProduct = this.getSnapshot().products.find((item) => item.id === id);
    // The server owns deployment verification. A second browser-side poll can
    // race a CDN response and wrongly report a completed deployment as pending.
    const publicConfirmed = !result.blocked && !result.github?.skipped && result.deployment?.confirmed === true;
    return {
      ...result,
      product: savedProduct,
      requestedStatus: publishStatus,
      publicConfirmed
    };
  },
  async deployStatus() {
    const response = await fetch("/api/admin/deploy-status", {
      method: "GET",
      headers: { accept: "application/json" }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Deploy status unavailable.");
    return payload;
  },
  async emailHealth() {
    const response = await fetch(`/api/admin/store?commerceAction=email-health&v=${Date.now()}`, {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "no-store"
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Email delivery health unavailable.");
    return payload.health || { configured: false, failed: 0, pending: 0, sending: 0, sent: 0, messages: [] };
  },
  async retryFailedEmails() {
    const response = await fetch("/api/admin/store?commerceAction=email-health", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({})
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Failed email messages could not be retried.");
    return payload;
  },
  async completeDraftProducts({ onProgress } = {}) {
    assertPrivateStoreReady();
    const draftsBySku = new Map(this.getSnapshot().products.filter((product) =>
      product.category === "Records" &&
      product.publishStatus !== "Published" &&
      (String(product.id || "").startsWith("finance-") || product.financeStockId || product.enrichmentStatus)
    ).map((product) => [String(product.sku || product.id).toLowerCase(), product]));
    const drafts = [...draftsBySku.values()];
    if (!drafts.length) {
      return { processed: 0, published: 0, remaining: 0, failed: 0, items: [], github: null };
    }

    const items = [];
    let failed = 0;
    for (const [index, product] of drafts.entries()) {
      onProgress?.({ index: index + 1, total: drafts.length, product });
      try {
        const payload = await syncCatalog({ skus: [product.sku], force: true, publishAfterResearch: true });
        items.push(...(payload.report?.items || []));
      } catch (error) {
        failed += 1;
        items.push({
          sku: product.sku,
          artist: product.artist,
          title: product.title,
          published: false,
          issues: [error instanceof Error ? error.message : "Completion request failed"]
        });
      }
    }

    await this.refreshPrivateStore({ force: true });
    return {
      processed: drafts.length,
      published: items.filter((item) => item.published).length,
      remaining: items.filter((item) => !item.published).length,
      failed,
      items,
      github: null,
      message: items.some((item) => item.published)
        ? "Research requests completed. Each published item is now waiting for, or has passed, public deployment verification."
        : "No item was published; unresolved items remain safely in Draft."
    };
  },
  async completeProduct(id) {
    assertPrivateStoreReady();
    // The rendered Admin table comes from the active server-refreshed store.
    // Never fall back to an older localStorage row when constructing the
    // research request, or the result can be written against stale Finance
    // identity data and appear as an unresolved draft.
    const product = this.getSnapshot().products.find((item) => item.id === id);
    if (!product) throw new Error("Product could not be found in the Admin catalog.");
    if (product.category !== "Records") throw new Error("Internet catalog completion is only used for records, CDs, and cassettes.");
    const payload = await syncCatalog({ skus: [product.sku], force: true, publishAfterResearch: true });
    const item = payload.report?.items?.find((candidate) =>
      String(candidate.sku || "").toLowerCase() === String(product.sku || "").toLowerCase()
    ) || payload.report?.items?.[0];
    await this.refreshPrivateStore({ force: true });
    const savedProduct = this.getSnapshot().products.find((candidate) => candidate.id === id);
    const publicConfirmed = Boolean(payload.deployment?.confirmed);
    return {
      item,
      product: savedProduct,
      github: payload.deployment?.github || null,
      deployment: payload.deployment || null,
      message: payload.message,
      publicConfirmed
    };
  },
  async saveHomeSlider(data) {
    const store = this.getSnapshot();
    const collectionIds = ["recent-releases", "nixp-selection", "back-in-stock", "limited-pressing", "private-collection"];
    const updates = [];
    for (const product of store.products) {
      const include = data[`homeSlide:${product.id}`] === "on";
      const rawSort = Number(data[`homeSlideSort:${product.id}`]);
      const homeSlideSort = include && Number.isFinite(rawSort) ? rawSort : null;
      const homeCollections = normalizeHomeCollections(
        product,
        collectionIds.filter((id) => data[`homeCollection:${product.id}:${id}`] === "on")
      );
      if (
        Number(product.homeSlideSort ?? -1) === Number(homeSlideSort ?? -1) &&
        JSON.stringify(product.homeCollections || []) === JSON.stringify(homeCollections)
      ) continue;
      updates.push({
        id: product.id,
        expectedRevision: product.editRevision || 1,
        homeSlideSort,
        homeCollections
      });
    }
    if (!updates.length) return true;
    const response = await fetch("/api/admin/store?commerceAction=home-slider", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ updates })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Home slider save failed. Refresh Admin and try again.");
    const savedById = new Map((payload.products || []).map((product) => [product.id, product]));
    activeStore = {
      ...store,
      products: store.products.map((product) => savedById.get(product.id) || product)
    };
    activeStoreScope = "admin";
    localStorage.setItem(STORAGE_KEY, JSON.stringify(activeStore));
    return true;
  },
  async uploadProductImage(file, product) {
    return uploadDataUrlImage(await fileToDataUrl(file), product, file.name);
  },
  async uploadProductImages(files, product) {
    const uploads = [];
    for (const file of Array.from(files || [])) {
      uploads.push(await this.uploadProductImage(file, product));
    }
    return uploads;
  },
  listProducts({ includeDrafts = false } = {}) {
    const scope = currentStoreScope();
    const items = activeStore && activeStoreScope === scope ? activeStore.products : readStore().products;
    if (includeDrafts) return items;
    return items.filter((product) =>
      product.publishStatus === "Published" &&
      (canUsePrivateStore() || (product.image && !(product.category === "Records" && product.image.includes("nixp-product-example"))))
    );
  },
  getProduct(id, { includeDrafts = false } = {}) {
    return this.listProducts({ includeDrafts }).find((product) => product.id === id);
  },
  async saveProduct(data) {
    const store = this.getSnapshot();
    const category = data.category || "Records";
    const isProductCategory = category === "Apparel" || category === "Objects";
    const isRecord = category === "Records";
    const id = data.id?.trim() || slugify(`${data.sku || data.artist}-${data.title}`) || `item-${Date.now()}`;
    const existing = store.products.find((product) => product.id === id);
    const incomingRelatedArtists = isRecord ? splitList(data.relatedArtists).map(canonicalRelatedArtistName) : [];
    const existingAutomaticRelatedArtists = normalizeList(existing?.autoEditorial?.relatedArtists).map(canonicalRelatedArtistName);
    const existingManualRelatedArtists = normalizeList(existing?.manualRelatedArtists).map(canonicalRelatedArtistName);
    const existingDisplayedRelatedArtists = normalizeList(existing?.relatedArtists).map(canonicalRelatedArtistName);
    const legacyManualOverride = isRecord && JSON.stringify(existingManualRelatedArtists) !== JSON.stringify(existingAutomaticRelatedArtists);
    const existingManualOverride = isRecord && (existing?.manualRelatedArtistsOverride === true || legacyManualOverride);
    const relatedArtistsChanged = isRecord && data.relatedArtists !== undefined &&
      JSON.stringify(incomingRelatedArtists) !== JSON.stringify(existingDisplayedRelatedArtists);
    const manualRelatedArtistsOverride = isRecord
      ? (relatedArtistsChanged ? true : existingManualOverride)
      : false;
    const manualRelatedArtists = relatedArtistsChanged ? incomingRelatedArtists : existingManualRelatedArtists;
    const manualRelatedArtistsOverrideSource = relatedArtistsChanged
      ? "admin"
      : String(existing?.manualRelatedArtistsOverrideSource || "").trim();
    const collection = data.collection?.trim() || data.label?.trim() || existing?.collection || "";
    const fallbackMaker = category === "Objects" ? "NIXP Objects" : category === "Apparel" ? "NIXP Apparel" : "NIXP";
    const format = isProductCategory ? category.replace(/s$/, "") : data.format?.trim();
    const openToOffers = data.open_to_offers === true || data.open_to_offers === "true" || data.open_to_offers === "Yes" || data.listingMode === "Private Collection / Offer Only" || (data.open_to_offers === undefined && existing?.open_to_offers === true);
    const minimumAcceptableOffer = wholeAmount(data.minimumAcceptableOffer ?? existing?.minimumAcceptableOffer);
    if (openToOffers && !minimumAcceptableOffer) throw new Error("Private Collection items require a Minimum Acceptable Offer in whole rupiah.");
    const product = withDefaults({
      ...existing,
      id,
      sku: data.sku?.trim() || existing?.sku || id.toUpperCase(),
      title: data.title?.trim() || "Untitled Item",
      artist: isProductCategory ? collection || fallbackMaker : data.artist?.trim() || fallbackMaker,
      category,
      format: format || category || "Object",
      displayFormat: isProductCategory
        ? data.displayFormat?.trim() || ""
        : data.displayFormat?.trim() || data.format?.trim() || category || "Object",
      edition: isRecord ? data.edition?.trim() || "" : "",
      barcode: isRecord ? data.barcode?.trim() || "" : "",
      catalogNumber: isRecord ? data.catalogNumber?.trim() || "" : "",
      apparelType: normalizeApparelType(data.apparelType),
      condition: data.condition?.trim() || "",
      mediaCondition: needsRecordConditionDetails({ category: isRecord ? "Records" : "", condition: data.condition }) ? data.mediaCondition?.trim() || "" : "",
      sleeveCondition: needsRecordConditionDetails({ category: isRecord ? "Records" : "", condition: data.condition }) ? data.sleeveCondition?.trim() || "" : "",
      price: Number(data.price || 0),
      year: Number(data.year || new Date().getFullYear()),
      label: data.label?.trim() || collection || "NIXP Selection",
      collection,
      color: data.color?.trim() || "",
      material: data.material?.trim() || "",
      image:
        data.image?.trim() ||
        data.images?.[0] ||
        existing?.image ||
        existing?.images?.[0] ||
        "/public/nixp-product-example-paper.png",
      images: normalizeImages({
        images: data.images || existing?.images,
        image: data.image?.trim() || data.images?.[0] || existing?.image
      }),
      tags: splitList(data.tags),
      relatedArtists: isRecord
        ? (data.relatedArtists !== undefined ? incomingRelatedArtists : existingDisplayedRelatedArtists)
        : [],
      manualRelatedArtists,
      manualRelatedArtistsOverride,
      manualRelatedArtistsOverrideSource,
      homeCollections: existing?.homeCollections || [],
      homeSlideSort: existing?.homeSlideSort ?? null,
      details: splitList(data.details),
      sizes: isProductCategory ? collectSizes(data) : existing?.sizes || [],
      description: data.description?.trim() || "",
      descriptionSource: isRecord ? data.descriptionSource?.trim() || existing?.descriptionSource || "" : "",
      reviewQuote: isRecord ? data.reviewQuote?.trim() || existing?.reviewQuote || "" : "",
      reviewSource: isRecord ? data.reviewSource?.trim() || existing?.reviewSource || "" : "",
      reviewUrl: isRecord ? data.reviewUrl?.trim() || existing?.reviewUrl || "" : "",
      qty: Math.max(0, Number(data.qty ?? 1) || 0),
      // Optional flag, default false. Only an explicit opt-in here makes a
      // product show "OPEN TO OFFERS" instead of a price; it is never inferred
      // from SOURCE or from a zero price.
      open_to_offers: openToOffers,
      minimumAcceptableOffer: openToOffers ? minimumAcceptableOffer : null,
      shipping: normalizeShipping({
        weightGrams: data.shippingWeightGrams,
        lengthCm: data.shippingLengthCm,
        widthCm: data.shippingWidthCm,
        heightCm: data.shippingHeightCm,
        shippingClass: data.shippingClass?.trim() || existing?.shipping?.shippingClass || "",
        packageType: data.shippingPackageType?.trim() || existing?.shipping?.packageType || "",
        packagingGroup: data.shippingPackagingGroup || existing?.shipping?.packagingGroup || "",
        vinylWeightClass: data.shippingVinylWeightClass || existing?.shipping?.vinylWeightClass || "",
        manualShippingOverride: data.manualShippingOverride === "Yes",
        status: data.shippingStatus || existing?.shipping?.status || "needs_measurement",
        source: data.shippingSource?.trim() || existing?.shipping?.source || "",
        updatedAt: today()
      }),
      publishStatus: data.publishStatus || "Published",
      visibility: data.visibility || "Public",
      updatedAt: today()
    });
    const payload = await persistProduct(product, { expectedRevision: existing?.editRevision || 0 });
    const savedProduct = payload.product || product;
    Object.defineProperty(savedProduct, "financeSync", {
      value: payload.financeSync || {
        status: payload.financeSynced === false ? "pending" : "synced",
        synced: payload.financeSynced !== false,
        pending: payload.financeSynced === false,
        message: payload.warning || ""
      },
      configurable: true
    });
    const nextProducts = existing
      ? store.products.map((item) => (item.id === id ? savedProduct : item))
      : [savedProduct, ...store.products];
    activeStore = { ...store, products: nextProducts };
    activeStoreScope = "admin";
    localStorage.setItem(STORAGE_KEY, JSON.stringify(activeStore));
    return savedProduct;
  },
  updateProductStatus(id, publishStatus) {
    return this.publishProduct(id, publishStatus);
  },
  saveArtist(data) {
    const store = this.getSnapshot();
    const name = data.name?.trim();
    if (!name) return;
    const id = data.id || slugify(name);
    const artist = {
      id,
      name,
      bio: data.bio?.trim() || "",
      status: data.status || "Published",
      sort: Number(data.sort || store.artists.length + 1)
    };
    const exists = store.artists.some((item) => item.id === id);
    return writeStore({
      ...store,
      artists: exists ? store.artists.map((item) => (item.id === id ? artist : item)) : [...store.artists, artist]
    });
  },
  saveCollection(data) {
    const store = this.getSnapshot();
    const title = data.title?.trim();
    if (!title) return;
    const id = data.id || slugify(title);
    const collection = {
      id,
      title,
      type: data.type || "Category",
      status: data.status || "Draft",
      sort: Number(data.sort || store.collections.length + 1)
    };
    const exists = store.collections.some((item) => item.id === id);
    return writeStore({
      ...store,
      collections: exists
        ? store.collections.map((item) => (item.id === id ? collection : item))
        : [...store.collections, collection]
    });
  },
  updateRequestStatus(id, status) {
    const store = this.getSnapshot();
    return writeStore({
      ...store,
      requests: store.requests.map((request) => (request.id === id ? { ...request, status } : request))
    });
  },
  async updateOfferStatus(id, status) {
    const response = await fetch("/api/catalog?action=offer-status", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, status })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Offer status could not be updated.");
    const snapshot = this.getSnapshot();
    const nextOffers = (snapshot.offers || []).map((offer) => offer.id === id ? { ...offer, status } : offer);
    activeStore = { ...snapshot, offers: nextOffers };
    activeStoreScope = "admin";
    localStorage.setItem(STORAGE_KEY, JSON.stringify(activeStore));
    return payload.offer;
  },
  updateOrderStatus(id, status) {
    const store = this.getSnapshot();
    return writeStore({
      ...store,
      orders: store.orders.map((order) => (order.id === id ? { ...order, status } : order))
    });
  }
};

function splitList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function wholeAmount(value) {
  if (value === null || value === undefined || value === "") return null;
  const raw = String(value).trim();
  if (!/^\d+$/.test(raw)) return null;
  const amount = Number(raw);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}
