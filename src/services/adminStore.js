import { artistNames, cashflow, inventory, orders, products, requestItems } from "../data/sampleData.js";

const STORAGE_KEY = "nixp-admin-store-v1";
const STORE_VERSION = "home-slider-related-artists-2026-07-15";
const ADMIN_STORE_PATH = "/public/data/admin-store.json";
const PUBLIC_STORE_PATH = "/public/data/public-store.json";
const REMOVED_PRODUCT_IDS = new Set(["obj-001", "pub-002"]);

let activeStore = null;
let privateStoreRefresh = null;

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

const RECENT_RELEASE_FORMATS = new Set(["Vinyl", "CD", "Cassette"]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function withDefaults(product) {
  const defaults = {
    publishStatus: "Published",
    visibility: "Public",
    updatedAt: "2026-07-11",
    ...product,
    image: product.image || product.images?.[0] || "/public/nixp-product-example-paper.png",
    tags: product.tags || [],
    details: product.details || [],
    sizes: normalizeSizes(product.sizes || []),
    images: normalizeImages(product),
    relatedArtists: normalizeList(product.relatedArtists),
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
    shipping: normalizeShipping(product.shipping)
  };
  return {
    ...defaults,
    homeCollections: normalizeHomeCollections(defaults)
  };
}

function isRecentRelease(product = {}) {
  return (
    product.category === "Records" &&
    RECENT_RELEASE_FORMATS.has(String(product.format || "").trim()) &&
    [2025, 2026].includes(Number(product.year))
  );
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
  return sizes
    .map((size) => {
      const quantity = Number(size.quantity ?? size.qty ?? (size.soldOut ? 0 : 1));
      return {
        label: String(size.label || "").trim(),
        quantity,
        soldOut: quantity <= 0
      };
    })
    .filter((size) => size.label);
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
  return isLocalEditorRuntime() || Boolean(privateWorkspaceFromHost());
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
    orders: publicOnly ? [] : clone(orders),
    cashflow: publicOnly ? [] : clone(cashflow),
    inventory: publicOnly ? [] : clone(inventory)
  };
}

function readStore() {
  // Both local editors and the authenticated admin/finance subdomains need the private store.
  const publicOnly = !canUsePrivateStore();
  const seeded = seed({ publicOnly });
  if (activeStore) return mergeStore(seeded, activeStore, { publicOnly });
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
  const previousActiveStore = activeStore;
  const previousSavedStore = localStorage.getItem(STORAGE_KEY);
  activeStore = store;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  try {
    return await persistStore(store, { inventoryProduct });
  } catch (error) {
    activeStore = previousActiveStore;
    if (previousSavedStore === null) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, previousSavedStore);
    }
    throw error;
  }
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
      const editorialFields = ["description", "descriptionSource", "reviewQuote", "reviewSource", "reviewUrl"];
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
    if (!response.ok) throw new Error(payload.error || "Store save failed. Please log in to admin and try again.");
    return true;
  } catch (error) {
    // Static previews cannot write files. localStorage remains the fallback.
    if (typeof location !== "undefined" && location.protocol === "file:") return false;
    throw error;
  }
}

async function writeStoreBestEffort(store) {
  try {
    return await writeStore(store);
  } catch {
    return false;
  }
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

export const adminStore = {
  async initialize() {
    const publicOnly = !canUsePrivateStore();
    let browserStore = null;
    if (!publicOnly) {
      try {
        browserStore = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      } catch {
        browserStore = null;
      }
    }

    try {
      const filePath = publicOnly ? PUBLIC_STORE_PATH : ADMIN_STORE_PATH;
      const apiScope = publicOnly ? "public" : "admin";
      const response = await fetch(`/api/catalog?scope=${apiScope}&v=${Date.now()}`, { cache: "no-store" });
      if (response.ok) {
        const payload = await response.json();
        if (payload.store) {
          activeStore = mergeStore(seed({ publicOnly }), payload.store, { publicOnly });
          if (!publicOnly) localStorage.setItem(STORAGE_KEY, JSON.stringify(activeStore));
          return;
        }
      }
      const fileResponse = await fetch(`${filePath}?v=${Date.now()}`, { cache: "no-store" });
      if (!fileResponse.ok) throw new Error("No file store");
      activeStore = await migrateBrowserStore(
        mergeStore(seed({ publicOnly }), await fileResponse.json(), { publicOnly }),
        browserStore
      );
      if (!publicOnly) localStorage.setItem(STORAGE_KEY, JSON.stringify(activeStore));
    } catch {
      activeStore = readStore();
    }
  },
  async refresh() {
    activeStore = null;
    return this.initialize();
  },
  async refreshRequests() {
    await this.refreshPrivateStore();
    return this.getSnapshot().requests;
  },
  async refreshOrders() {
    await this.refreshPrivateStore();
    return this.getSnapshot().orders;
  },
  async refreshPrivateStore() {
    if (!canUsePrivateStore()) return this.getSnapshot();
    if (privateStoreRefresh) return privateStoreRefresh;
    privateStoreRefresh = (async () => {
      const response = await fetch(`/api/catalog?scope=admin&v=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Could not refresh admin data. Please log in to admin and try again.");
      const payload = await response.json();
      if (!payload.store) return this.getSnapshot();
      activeStore = mergeStore(seed({ publicOnly: false }), payload.store, { publicOnly: false });
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
    try {
      const response = await fetch("/api/prices", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids })
      });
      if (!response.ok) throw new Error("Price API unavailable");
      const payload = await response.json();
      return payload.prices || [];
    } catch {
      return [];
    }
  },
  getSnapshot() {
    return readStore();
  },
  async deployStore() {
    const response = await fetch("/api/admin/deploy", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        store: readStore(),
        message: `Deploy NIXP catalog ${new Date().toISOString()}`
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Deploy failed. Please check Vercel and GitHub settings.");
    return payload;
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
  async saveHomeSlider(data) {
    const store = readStore();
    const collectionIds = ["recent-releases", "nixp-selection", "back-in-stock", "limited-pressing", "private-collection"];
    const nextProducts = store.products.map((product) => {
      const include = data[`homeSlide:${product.id}`] === "on";
      const rawSort = Number(data[`homeSlideSort:${product.id}`]);
      return {
        ...product,
        homeSlideSort: include && Number.isFinite(rawSort) ? rawSort : null,
        homeCollections: normalizeHomeCollections(
          product,
          collectionIds.filter((id) => data[`homeCollection:${product.id}:${id}`] === "on")
        ),
        updatedAt: today()
      };
    });
    return writeStore({ ...store, products: nextProducts });
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
    const items = readStore().products;
    return includeDrafts ? items : items.filter((product) => product.publishStatus === "Published");
  },
  getProduct(id, { includeDrafts = false } = {}) {
    return this.listProducts({ includeDrafts }).find((product) => product.id === id);
  },
  async saveProduct(data) {
    const store = readStore();
    const category = data.category || "Records";
    const isProductCategory = category === "Apparel" || category === "Objects";
    const id = data.id?.trim() || slugify(`${data.sku || data.artist}-${data.title}`) || `item-${Date.now()}`;
    const existing = store.products.find((product) => product.id === id);
    const collection = data.collection?.trim() || data.label?.trim() || existing?.collection || "";
    const fallbackMaker = category === "Objects" ? "NIXP Objects" : category === "Apparel" ? "NIXP Apparel" : "NIXP";
    const format = isProductCategory ? category.replace(/s$/, "") : data.format?.trim();
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
      apparelType: normalizeApparelType(data.apparelType),
      condition: data.condition?.trim() || "",
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
      relatedArtists: splitList(data.relatedArtists),
      homeCollections: existing?.homeCollections || [],
      homeSlideSort: existing?.homeSlideSort ?? null,
      details: splitList(data.details),
      sizes: isProductCategory ? collectSizes(data) : existing?.sizes || [],
      description: data.description?.trim() || "",
      descriptionSource: data.descriptionSource?.trim() || existing?.descriptionSource || "",
      reviewQuote: data.reviewQuote?.trim() || existing?.reviewQuote || "",
      reviewSource: data.reviewSource?.trim() || existing?.reviewSource || "",
      reviewUrl: data.reviewUrl?.trim() || existing?.reviewUrl || "",
      qty: Math.max(0, Number(data.qty ?? 1) || 0),
      shipping: normalizeShipping({
        weightGrams: data.shippingWeightGrams,
        lengthCm: data.shippingLengthCm,
        widthCm: data.shippingWidthCm,
        heightCm: data.shippingHeightCm,
        status: data.shippingStatus || existing?.shipping?.status || "needs_measurement",
        source: data.shippingSource?.trim() || existing?.shipping?.source || "",
        updatedAt: today()
      }),
      publishStatus: data.publishStatus || "Published",
      visibility: data.visibility || "Public",
      updatedAt: today()
    });
    const nextProducts = existing
      ? store.products.map((item) => (item.id === id ? product : item))
      : [product, ...store.products];
    const nextArtists = [...store.artists];
    const recordArtist = category === "Records" ? data.artist?.trim() : "";
    if (recordArtist && !nextArtists.some((artist) => artist.name.toLowerCase() === recordArtist.toLowerCase())) {
      nextArtists.push({
        id: slugify(recordArtist),
        name: recordArtist,
        bio: "",
        status: "Published",
        sort: nextArtists.length + 1
      });
    }
    const inventoryId = product.id;
    const existingInventory = store.inventory.find((item) => item.productId === product.id || item.id === inventoryId);
    const inventoryEntry = {
      ...existingInventory,
      id: existingInventory?.id || inventoryId,
      productId: product.id,
      sku: product.sku,
      artist: product.artist,
      title: product.title,
      category: product.category,
      format: product.format,
      condition: product.condition,
      quantity: product.qty,
      sizes: product.sizes,
      source: "Admin editor",
      updatedAt: today()
    };
    const nextInventory = existingInventory
      ? store.inventory.map((item) => (item.id === existingInventory.id ? inventoryEntry : item))
      : [inventoryEntry, ...store.inventory];
    await writeStore(
      { ...store, products: nextProducts, artists: nextArtists, inventory: nextInventory },
      { inventoryProduct: product }
    );
    return product;
  },
  updateProductStatus(id, publishStatus) {
    const store = readStore();
    return writeStore({
      ...store,
      products: store.products.map((product) =>
        product.id === id ? { ...product, publishStatus, updatedAt: today() } : product
      )
    });
  },
  saveArtist(data) {
    const store = readStore();
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
    const store = readStore();
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
    const store = readStore();
    return writeStore({
      ...store,
      requests: store.requests.map((request) => (request.id === id ? { ...request, status } : request))
    });
  },
  updateOrderStatus(id, status) {
    const store = readStore();
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
