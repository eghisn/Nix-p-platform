import { syncAdminCatalogInventory, syncAdminProductInventory } from "./financeState.js";

const TABLES = ["products", "artists", "collections", "requests", "orders", "cashflow", "inventory"];
const REQUIRED_STORE_ARRAYS = ["products", "artists", "collections", "requests", "orders", "cashflow", "inventory"];

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

export async function loadStore({ privateScope = false } = {}) {
  const [products, artists, collections, requests, orders, cashflow, inventory] = await Promise.all([
    supabaseFetch(
      privateScope
        ? "products?select=*&order=created_at.desc"
        : "products?select=*&publish_status=eq.Published&visibility=eq.Public&order=created_at.desc"
    ),
    supabaseFetch(privateScope ? "artists?select=*&order=sort.asc" : "artists?select=*&status=eq.Published&order=sort.asc"),
    supabaseFetch(privateScope ? "collections?select=*&order=sort.asc" : "collections?select=*&status=eq.Published&order=sort.asc"),
    privateScope ? supabaseFetch("requests?select=*&order=created_at.desc", { service: true }) : [],
    privateScope ? supabaseFetch("orders?select=*&order=created_at.desc", { service: true }) : [],
    privateScope ? supabaseFetch("cashflow?select=*&order=created_at.desc", { service: true }) : [],
    privateScope ? supabaseFetch("inventory?select=*&order=created_at.desc", { service: true }) : []
  ]);
  return {
    version: "supabase-live-2026-07-13",
    products: products.map((row) => fromProductRow(row, { privateScope })),
    artists: artists.map(fromRawRow),
    collections: collections.map(fromRawRow),
    requests: requests.map(fromRawRow),
    orders: orders.map(fromRawRow),
    cashflow: cashflow.map(fromRawRow),
    inventory: inventory.map(fromRawRow)
  };
}

export async function verifiedPrices(ids = []) {
  const uniqueIds = [...new Set(ids.map(String).filter(Boolean))];
  if (!uniqueIds.length) return [];
  const inList = uniqueIds.map((id) => `"${id.replaceAll('"', '\\"')}"`).join(",");
  return supabaseFetch(`products?select=id,price,qty,publish_status,visibility&id=in.(${inList})`);
}

export async function saveStore(store, { inventoryProduct = null, syncCatalogProducts = false } = {}) {
  validateStore(store);
  await backupStore("admin-store", store);
  const rowsByTable = {
    products: (store.products || []).map(toProductRow),
    artists: (store.artists || []).map((item, index) => toRawRow(item, "artists", index)),
    collections: (store.collections || []).map((item, index) => toRawRow(item, "collections", index)),
    requests: (store.requests || []).map((item, index) => toRawRow(item, "requests", index)),
    orders: (store.orders || []).map((item, index) => toRawRow(item, "orders", index)),
    cashflow: (store.cashflow || []).map((item, index) => toRawRow(item, "cashflow", index)),
    inventory: (store.inventory || []).map((item, index) => toRawRow(item, "inventory", index))
  };
  for (const table of TABLES) await upsert(table, dedupeRows(rowsByTable[table]));
  if (syncCatalogProducts) await syncAdminCatalogInventory(store.products || []);
  else if (inventoryProduct) await syncAdminProductInventory(inventoryProduct);
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
  const { shipping, ...raw } = row.raw || {};
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
    publish_status: product.publishStatus || "Published",
    visibility: product.visibility || "Public",
    updated_at: product.updatedAt || new Date().toISOString().slice(0, 10),
    raw: product
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
