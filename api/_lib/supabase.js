import { syncAdminCatalogInventory, syncAdminProductInventory } from "./financeState.js";
import { applyCatalogPublicationSafety, isFinanceCatalogProduct, isRecordPublicationReady } from "../../src/data/catalogPublication.js";

const TABLES = ["products", "artists", "collections", "requests", "offers", "orders", "cashflow", "inventory"];
const REQUIRED_STORE_ARRAYS = ["products", "artists", "collections", "requests", "offers", "orders", "cashflow", "inventory"];

export function isSupabaseConfigured({ requireServiceRole = false } = {}) {
  return Boolean(
    process.env.SUPABASE_URL &&
      (requireServiceRole ? process.env.SUPABASE_SERVICE_ROLE_KEY : process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY)
  );
}

function apiKey({ service = false } = {}) {
  return service ? process.env.SUPABASE_SERVICE_ROLE_KEY : process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
}

export async function supabaseFetch(path, options = {}) {
  const key = apiKey({ service: options.service });
  if (!process.env.SUPABASE_URL || !key) {
    throw new Error("Supabase runtime environment variables are not configured.");
  }
  const response = await fetch(`${process.env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/${path}`, {
    method: options.method || "GET",
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      prefer: options.prefer || "return=representation",
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(payload?.message || payload?.error || `Supabase request failed: ${response.status}`);
  }
  return payload;
}

export async function loadStore({ privateScope = false, publicSnapshotUrl = "" } = {}) {
  const [products, artists, collections, requests, offers, orders, cashflow, inventory] = await Promise.all([
    supabaseFetch(
      privateScope
        ? "products?select=*&order=created_at.desc"
        : "products?select=*&publish_status=eq.Published&visibility=eq.Public&order=created_at.desc"
    ),
    supabaseFetch(privateScope ? "artists?select=*&order=sort.asc" : "artists?select=*&status=eq.Published&order=sort.asc"),
    supabaseFetch(privateScope ? "collections?select=*&order=sort.asc" : "collections?select=*&status=eq.Published&order=sort.asc"),
    privateScope ? supabaseFetch("requests?select=*&order=created_at.desc", { service: true }) : [],
    privateScope ? supabaseFetch("offers?select=*&order=created_at.desc", { service: true }) : [],
    privateScope ? supabaseFetch("orders?select=*&order=created_at.desc", { service: true }) : [],
    privateScope ? supabaseFetch("cashflow?select=*&order=created_at.desc", { service: true }) : [],
    privateScope ? supabaseFetch("inventory?select=*&order=created_at.desc", { service: true }) : []
  ]);
  const mappedProducts = products.map((row) => fromProductRow(row, { privateScope }));
  const store = {
    version: "supabase-live-2026-07-13",
    products: privateScope
      ? mappedProducts
      : mappedProducts.filter((product) =>
          product.image &&
          !(product.category === "Records" && product.image.includes("nixp-product-example")) &&
          (!isFinanceCatalogProduct(product) || isRecordPublicationReady(product))
        ),
    artists: artists.map(fromRawRow),
    collections: collections.map(fromRawRow),
    requests: requests.map(fromRawRow),
    offers: offers.map(fromRawRow),
    orders: orders.map(fromRawRow),
    cashflow: cashflow.map(fromRawRow),
    inventory: inventory.map(fromRawRow)
  };
  if (!privateScope && publicSnapshotUrl) {
    try {
      const snapshotResponse = await fetch(publicSnapshotUrl, { cache: "no-store" });
      if (snapshotResponse.ok) {
        const snapshot = await snapshotResponse.json();
        store.products = reconcilePublicRevision(store.products, snapshot.products || []);
        store.artists = reconcilePublicRows(store.artists, snapshot.artists || []);
        store.collections = Array.isArray(snapshot.collections) ? snapshot.collections : store.collections;
      }
    } catch {
      // Supabase remains the source of truth if the deploy snapshot is unavailable.
    }
  }
  return store;
}

function editorialProductIsComplete(product = {}) {
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

function snapshotOwnsEditorialFields(snapshotProduct = {}) {
  return Boolean(
    editorialProductIsComplete(snapshotProduct) &&
      (isManagedCatalogImage(snapshotProduct.image) || (snapshotProduct.images || []).some(isManagedCatalogImage))
  );
}

function isPlaceholderCatalogTitle(value) {
  return /^(?:untitled(?:\s+inventory)?\s+item|new\s+inventory\s+item)$/i.test(String(value || "").trim());
}

export function reconcilePublicRevision(remoteProducts = [], snapshotProducts = []) {
  const remoteById = new Map(remoteProducts.map((product) => [product.id, product]));
  const researchFields = [
    "relatedArtists",
    "relatedArtistEvidence",
    "relatedArtistsResearch",
    "enrichmentStatus"
  ];
  const identityFields = [
    "sku",
    "title",
    "artist",
    "category",
    "format",
    "display_format",
    "condition",
    "label",
    "year",
    "collection",
    "edition",
    "catalogNumber",
    "barcode",
    "details"
  ];
  const fields = [
    "description",
    "descriptionSource",
    "reviewQuote",
    "reviewSource",
    "reviewUrl",
    "image",
    "images",
    "imageCredits",
    "autoProductPhoto",
    "enrichmentOrigin",
    "enrichmentUpdatedAt",
    "metadataSourceUrl",
    "musicBrainzReleaseId",
    "edition",
    "catalogNumber",
    "barcode",
    "details"
  ];
  const snapshotIds = new Set(snapshotProducts.map((product) => String(product?.id || "")).filter(Boolean));
  const reconciledSnapshot = snapshotProducts
    .map((snapshotProduct) => {
      const remoteProduct = remoteById.get(snapshotProduct.id);
      // The deployed snapshot defines which editorial revision is public.
      // Supabase may update price, stock, offer state, and visibility in real
      // time, but a remote-only draft cannot enter public HTML before deploy.
      if (!remoteProduct) return null;
      const merged = {
        ...snapshotProduct,
        price: remoteProduct.price,
        qty: remoteProduct.qty,
        sizes: remoteProduct.sizes,
        publishStatus: remoteProduct.publishStatus,
        visibility: remoteProduct.visibility,
        open_to_offers: remoteProduct.open_to_offers,
        minimumAcceptableOffer: remoteProduct.minimumAcceptableOffer
      };
      const remoteResearchStatus = String(remoteProduct.relatedArtistsResearch?.status || "").trim();
      const hasSourceBackedResearch = ["verified", "combined", "lastfm", "no-verified-match"].includes(remoteResearchStatus);
      const withRemoteResearch = hasSourceBackedResearch
        ? researchFields.reduce(
            (product, field) => (remoteProduct[field] !== undefined ? { ...product, [field]: remoteProduct[field] } : product),
            merged
          )
        : merged;
      const withCurrentIdentity = identityFields.reduce((product, field) => {
        const value = remoteProduct[field];
        const usable = field === "title"
          ? String(value || "").trim() && !isPlaceholderCatalogTitle(value)
          : value !== undefined && value !== null && (typeof value !== "string" || value.trim());
        return usable ? { ...product, [field]: value } : product;
      }, withRemoteResearch);
      if (!snapshotOwnsEditorialFields(snapshotProduct)) return withCurrentIdentity;
      const withSnapshotEditorial = fields.reduce(
        (product, field) => (snapshotProduct[field] !== undefined ? { ...product, [field]: snapshotProduct[field] } : product),
        withCurrentIdentity
      );
      return hasSourceBackedResearch
        ? researchFields.reduce(
            (product, field) => (remoteProduct[field] !== undefined ? { ...product, [field]: remoteProduct[field] } : product),
            withSnapshotEditorial
          )
        : withSnapshotEditorial;
    })
    .filter(Boolean);
  // A product can be fully published in Supabase before the next static
  // snapshot commit. Keep the established snapshot as the editorial baseline,
  // but never hide a complete public item merely because it is new.
  const remoteOnly = remoteProducts.filter((product) => {
    if (snapshotIds.has(String(product?.id || ""))) return false;
    return product?.category !== "Records" || isRecordPublicationReady(product);
  });
  return [...remoteOnly, ...reconciledSnapshot];
}

function reconcilePublicRows(remoteRows = [], snapshotRows = []) {
  const remoteById = new Map(remoteRows.map((row) => [String(row?.id || ""), row]));
  const snapshotIds = new Set(snapshotRows.map((row) => String(row?.id || "")).filter(Boolean));
  const reconciled = snapshotRows
    .map((snapshotRow) => remoteById.get(String(snapshotRow?.id || "")) || snapshotRow)
    .filter(Boolean);
  const remoteOnly = remoteRows.filter((row) => !snapshotIds.has(String(row?.id || "")));
  return [...reconciled, ...remoteOnly].sort((a, b) => Number(a?.sort || 0) - Number(b?.sort || 0) || String(a?.name || "").localeCompare(String(b?.name || "")));
}

export async function verifiedPrices(ids = []) {
  const uniqueIds = [...new Set(ids.map(String).filter(Boolean))];
  if (!uniqueIds.length) return [];
  const inList = uniqueIds.map((id) => `"${id.replaceAll('"', '\\"')}"`).join(",");
  return supabaseFetch(`products?select=id,price,qty,sizes,publish_status,visibility&id=in.(${inList})`);
}

export async function saveStore(store, { inventoryProduct = null, syncCatalogProducts = false } = {}) {
  const safeStore = applyCatalogPublicationSafety(store);
  validateStore(safeStore);
  await backupStore("admin-store", safeStore);
  const rowsByTable = {
    products: (safeStore.products || []).map(toProductRow),
    artists: (safeStore.artists || []).map((item, index) => toRawRow(item, "artists", index)),
    collections: (safeStore.collections || []).map((item, index) => toRawRow(item, "collections", index)),
    requests: (safeStore.requests || []).map((item, index) => toRawRow(item, "requests", index)),
    offers: (safeStore.offers || []).map((item, index) => toRawRow(item, "offers", index)),
    orders: (safeStore.orders || []).map((item, index) => toRawRow(item, "orders", index)),
    cashflow: (safeStore.cashflow || []).map((item, index) => toRawRow(item, "cashflow", index)),
    inventory: (safeStore.inventory || []).map((item, index) => toRawRow(item, "inventory", index))
  };
  for (const table of TABLES) await upsert(table, dedupeRows(rowsByTable[table]));
  if (syncCatalogProducts) await syncAdminCatalogInventory(safeStore.products || []);
  else if (inventoryProduct) await syncAdminProductInventory(inventoryProduct);
  return safeStore;
}

export async function saveProductPublicationStatus(store, productId) {
  const safeStore = applyCatalogPublicationSafety(store);
  validateStore(safeStore);
  const product = (safeStore.products || []).find((item) => item.id === productId);
  if (!product) throw new Error("Product publication save failed: product not found.");
  const previousRows = await supabaseFetch(
    `products?select=*&id=eq.${encodeURIComponent(productId)}`,
    { service: true }
  );
  await backupStore("product-publication", {
    productId,
    previous: previousRows?.[0] || null,
    next: product
  });
  await upsert("products", [toProductRow(product)]);
  return product;
}

async function upsert(table, rows) {
  if (!rows.length) return [];
  return supabaseFetch(`${table}?on_conflict=id`, {
    method: "POST",
    body: rows,
    service: true,
    prefer: "resolution=merge-duplicates,return=minimal"
  });
}

export async function upsertRawRows(table, items) {
  if (!TABLES.includes(table)) throw new Error("Unsupported table.");
  const rows = (Array.isArray(items) ? items : [items]).map((item, index) => toRawRow(item, table, index));
  if (!rows.length) return [];
  return upsert(table, dedupeRows(rows));
}

export async function backupStore(source, raw) {
  const id = `${source}-${new Date().toISOString().replace(/[^0-9]/g, "")}-${Math.random().toString(36).slice(2, 8)}`;
  return supabaseFetch("store_backups", {
    method: "POST",
    service: true,
    body: [{ id, source, raw }],
    prefer: "return=minimal"
  });
}

function validateStore(store) {
  for (const key of REQUIRED_STORE_ARRAYS) {
    if (!Array.isArray(store?.[key])) {
      throw new Error(`Store save blocked: missing ${key} array.`);
    }
  }
}

function fromRawRow(row) {
  return row.raw || row;
}

function fromProductRow(row, { privateScope = false } = {}) {
  const sourceRaw = row.raw || {};
  const nestedRaw = sourceRaw.raw && typeof sourceRaw.raw === "object" ? sourceRaw.raw : {};
  const { shipping, raw: _discardNestedRaw, ...raw } = { ...nestedRaw, ...sourceRaw };
  const product = {
    ...raw,
    id: row.id,
    sku: row.sku,
    title: row.title,
    artist: row.artist,
    category: row.category,
    format: row.format,
    displayFormat: row.display_format,
    apparelType: row.apparel_type,
    condition: row.condition,
    price: row.price,
    year: row.year,
    label: row.label,
    collection: row.collection,
    color: row.color,
    material: row.material,
    image: row.image,
    images: row.images || [],
    imageCredits: row.image_credits || [],
    tags: row.tags || [],
    details: row.details || [],
    sizes: row.sizes || [],
    description: row.description || "",
    qty: row.qty,
    open_to_offers: row.open_to_offers === true || row.raw?.open_to_offers === true,
    minimumAcceptableOffer: Number.isFinite(Number(row.minimum_acceptable_offer ?? row.raw?.minimumAcceptableOffer))
      ? Math.max(0, Number(row.minimum_acceptable_offer ?? row.raw?.minimumAcceptableOffer))
      : null,
    publishStatus: row.publish_status,
    visibility: row.visibility,
    updatedAt: row.updated_at
  };
  if (privateScope) product.shipping = shipping || null;
  return product;
}

function toRawRow(item, table = "items", index = 0) {
  const id = rawRowId(item, table, index);
  return {
    id,
    name: item.name || null,
    title: item.title || null,
    status: item.status || null,
    sort: Number(item.sort || 0),
    raw: { ...item, id }
  };
}

function rawRowId(item = {}, table = "items", index = 0) {
  const explicit = String(item.id || "").trim();
  if (explicit) return explicit;
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

function dedupeRows(rows = []) {
  const byId = new Map();
  for (const row of rows) {
    if (!row?.id) continue;
    byId.set(row.id, row);
  }
  return [...byId.values()];
}

function toProductRow(product) {
  const raw = normalizedProductRaw(product);
  return {
    id: String(product.id),
    sku: product.sku || product.id,
    title: product.title || "Untitled Item",
    artist: product.artist || "",
    category: product.category || "",
    format: product.format || "",
    display_format: product.displayFormat || "",
    apparel_type: product.apparelType || "",
    condition: product.condition || "",
    price: Number(product.price || 0),
    year: Number(product.year || new Date().getFullYear()),
    label: product.label || "",
    collection: product.collection || "",
    color: product.color || "",
    material: product.material || "",
    image: product.image || product.images?.[0] || "",
    images: product.images || [],
    image_credits: product.imageCredits || [],
    tags: product.tags || [],
    details: product.details || [],
    sizes: product.sizes || [],
    description: product.description || "",
    qty: Number(product.qty || 0),
    open_to_offers: product.open_to_offers === true,
    minimum_acceptable_offer:
      product.minimumAcceptableOffer === null || product.minimumAcceptableOffer === undefined || product.minimumAcceptableOffer === ""
        ? null
        : Math.max(0, Math.floor(Number(product.minimumAcceptableOffer) || 0)),
    publish_status: product.publishStatus || "Published",
    visibility: product.visibility || "Public",
    updated_at: product.updatedAt || new Date().toISOString().slice(0, 10),
    raw
  };
}

function normalizedProductRaw(product = {}) {
  const { raw: _discardProductRaw, ...productFields } = product;
  const previousRaw = product.raw && typeof product.raw === "object" ? { ...product.raw } : {};
  delete previousRaw.raw;
  return {
    ...previousRaw,
    ...productFields,
    publishStatus: product.publishStatus || previousRaw.publishStatus || "Published",
    visibility: product.visibility || previousRaw.visibility || "Public",
    open_to_offers: product.open_to_offers === true,
    minimumAcceptableOffer:
      product.minimumAcceptableOffer === null || product.minimumAcceptableOffer === undefined || product.minimumAcceptableOffer === ""
        ? null
        : Math.max(0, Math.floor(Number(product.minimumAcceptableOffer) || 0))
  };
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "row";
}

export async function uploadImage({ dataUrl, fileName, sku, title }) {
  if (!isSupabaseConfigured({ requireServiceRole: true })) {
    throw new Error("Supabase Storage is not configured.");
  }
  const match = String(dataUrl || "").match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error("Invalid image upload.");
  const contentType = match[1];
  const buffer = Buffer.from(match[2], "base64");
  const safeName = `${String(sku || title || "product").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}-${String(fileName || "upload").toLowerCase().replace(/[^a-z0-9.]+/g, "-")}`;
  const objectPath = `products/${safeName}`;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const response = await fetch(`${process.env.SUPABASE_URL.replace(/\/$/, "")}/storage/v1/object/product-images/${objectPath}`, {
    method: "POST",
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      "content-type": contentType,
      "x-upsert": "false"
    },
    body: buffer
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || "Image upload failed.");
  return `${process.env.SUPABASE_URL.replace(/\/$/, "")}/storage/v1/object/public/product-images/${objectPath}`;
}
