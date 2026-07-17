const STATE_KEY = "main";
const EMPTY_FINANCE_STATE = { general: [], sales: [], expenses: [], inventory: [], inventoryStock: [] };
const RECORD_FORMATS = new Set(["Vinyl", "CD", "Cassette"]);
const APPAREL_TYPES = new Set(["T-shirt", "Longsleeve", "Crewneck", "Hoodie", "Jacket", "Shirt", "Cap"]);

export function isFinanceState(value) {
  return (
    value &&
    Array.isArray(value.general) &&
    Array.isArray(value.sales) &&
    Array.isArray(value.expenses) &&
    Array.isArray(value.inventory)
  );
}

export async function readFinanceState() {
  return (await readFinanceStateWithVersion()).state;
}

export async function readFinanceStateWithVersion() {
  const remote = await readRemoteStateWithVersion().catch((error) => {
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) throw error;
    return null;
  });
  if (isFinanceState(remote?.state)) {
    return { state: normalizeFinanceState(remote.state), updatedAt: remote.updatedAt || null };
  }
  return { state: normalizeFinanceState(EMPTY_FINANCE_STATE), updatedAt: null };
}

export async function writeFinanceState(state, { syncCatalog = true, expectedUpdatedAt = null } = {}) {
  if (!isFinanceState(state)) throw new Error("Invalid finance state.");
  const normalized = normalizeFinanceState(state);
  await backupFinanceState(normalized);
  if (expectedUpdatedAt) {
    const rows = await supabaseFetch(`finance_state?key=eq.${STATE_KEY}&updated_at=eq.${encodeURIComponent(expectedUpdatedAt)}`, {
      method: "PATCH",
      body: { state: normalized },
      prefer: "return=representation"
    });
    if (!Array.isArray(rows) || !rows.length) {
      const error = new Error("Finance data changed on the server. Refresh before saving again.");
      error.statusCode = 409;
      throw error;
    }
  } else {
    await supabaseFetch("finance_state?on_conflict=key", {
      method: "POST",
      body: [{ key: STATE_KEY, state: normalized }],
      prefer: "resolution=merge-duplicates,return=minimal"
    });
  }
  if (syncCatalog) await syncFinanceInventoryToCatalog(normalized);
  return normalized;
}

// Finance is the source of truth for SKU stock; incomplete finance entries stay private drafts in the catalog.
async function syncFinanceInventoryToCatalog(state) {
  const stockRows = (state.inventoryStock || []).filter((item) => String(item?.sku || "").trim());
  if (!stockRows.length && !(state.inventory || []).length) return;

  const skus = [...new Set(stockRows.map((item) => String(item.sku).trim()))];
  const existingRows = skus.length
    ? await supabaseFetch(`products?select=*&sku=in.(${skuList(skus)})`)
    : [];
  const existingBySku = new Map(existingRows.map((row) => [String(row.sku || "").trim().toLowerCase(), row]));
  const productRows = [];
  const productIdBySku = new Map();

  for (const stock of stockRows) {
    const sku = String(stock.sku).trim();
    const key = sku.toLowerCase();
    const existing = existingBySku.get(key);
    const quantity = normalizedQuantity(stock.qty);
    if (existing) {
      const raw = { ...(existing.raw || {}), qty: quantity, updatedAt: today(), financeStockId: stock.id || null };
      productRows.push({ ...existing, qty: quantity, updated_at: today(), raw });
      productIdBySku.set(key, existing.id);
      continue;
    }
    const product = draftProductFromFinanceStock(stock, quantity);
    productRows.push(product);
    productIdBySku.set(key, product.id);
  }

  if (productRows.length) {
    await supabaseFetch("products?on_conflict=id", {
      method: "POST",
      body: productRows,
      prefer: "resolution=merge-duplicates,return=minimal"
    });
  }

  const inventoryRows = [
    ...(state.inventory || []).map((item) => financeInventoryRow(item, productIdBySku)),
    ...stockRows.map((item) => financeStockRow(item, productIdBySku))
  ];
  if (inventoryRows.length) {
    await supabaseFetch("inventory?on_conflict=id", {
      method: "POST",
      body: inventoryRows,
      prefer: "resolution=merge-duplicates,return=minimal"
    });
  }
}

export async function syncAdminProductInventory(product) {
  return syncAdminCatalogInventory([product]);
}

// Apply a full Admin catalog deployment in one state write. Writing each product
// individually would allow concurrent writes to overwrite one another.
export async function syncAdminCatalogInventory(products = []) {
  const catalogProducts = (Array.isArray(products) ? products : [products]).filter((product) => product?.sku);
  if (!catalogProducts.length) return;
  const current = normalizeFinanceState((await readRemoteState().catch(() => null)) || EMPTY_FINANCE_STATE);
  const existingIndexes = new Map(
    current.inventoryStock.map((item, index) => [String(item?.sku || "").trim().toLowerCase(), index])
  );

  for (const product of catalogProducts) {
    const sku = String(product.sku).trim();
    const key = sku.toLowerCase();
    const index = existingIndexes.get(key);
    const existing = index === undefined ? {} : current.inventoryStock[index];
    const quantity = Array.isArray(product.sizes) && product.sizes.length
      ? product.sizes.reduce((sum, size) => sum + normalizedQuantity(size.quantity ?? size.qty), 0)
      : normalizedQuantity(product.qty);
    const nextStock = recalculateStock({
      ...existing,
      id: existing.id || `catalog-${product.id}`,
      sku,
      item: financeItemForProduct(product),
      itemCondition: product.condition || existing.itemCondition || "New-Sealed",
      artist: product.artist || existing.artist || "",
      title: product.title || existing.title || "",
      source: existing.source || "Admin editor",
      acquisitionMonth: existing.acquisitionMonth || new Date().toISOString().slice(0, 7),
      qty: quantity,
      costBasis: Number(existing.costBasis || 0),
      sellingPrice: Number(existing.sellingPrice || product.price || 0),
      soldPrice: Number(existing.soldPrice || 0)
    });
    if (index === undefined) {
      existingIndexes.set(key, current.inventoryStock.length);
      current.inventoryStock.push(nextStock);
    } else {
      current.inventoryStock[index] = nextStock;
    }
  }
  await writeFinanceState(current, { syncCatalog: false });
}

async function backupFinanceState(nextState) {
  const previousState = await readRemoteState().catch(() => null);
  const id = `finance-state-${new Date().toISOString().replace(/[^0-9]/g, "")}-${Math.random().toString(36).slice(2, 8)}`;
  return supabaseFetch("store_backups", {
    method: "POST",
    body: [{
      id,
      source: "finance-state",
      raw: {
        previous: isFinanceState(previousState) ? normalizeFinanceState(previousState) : null,
        next: nextState
      }
    }],
    prefer: "return=minimal"
  });
}

export function normalizeFinanceState(state) {
  return {
    general: Array.isArray(state.general) ? state.general : [],
    sales: Array.isArray(state.sales) ? state.sales : [],
    expenses: Array.isArray(state.expenses) ? state.expenses : [],
    inventory: Array.isArray(state.inventory) ? state.inventory : [],
    inventoryStock: Array.isArray(state.inventoryStock) ? state.inventoryStock : []
  };
}

function draftProductFromFinanceStock(stock, quantity) {
  const item = String(stock.item || "Vinyl").trim();
  const category = RECORD_FORMATS.has(item) ? "Records" : APPAREL_TYPES.has(item) ? "Apparel" : "Objects";
  const id = `finance-${slugify(stock.sku)}`;
  const product = {
    id,
    sku: String(stock.sku).trim(),
    title: String(stock.title || "Untitled inventory item").trim(),
    artist: String(stock.artist || "NIXP").trim(),
    category,
    format: category === "Records" ? item : category === "Apparel" ? "Apparel" : "Object",
    displayFormat: category === "Records" ? item : "",
    apparelType: category === "Apparel" ? "Accessories" : "",
    condition: String(stock.itemCondition || "").trim(),
    price: 0,
    year: new Date().getFullYear(),
    label: "",
    collection: "",
    color: "",
    material: "",
    image: "",
    images: [],
    imageCredits: [],
    tags: [],
    details: ["Created from finance inventory. Complete this draft in NIXP Admin before publishing."],
    sizes: [],
    description: "",
    qty: quantity,
    publishStatus: "Draft",
    visibility: "Private",
    updatedAt: today(),
    financeStockId: stock.id || null
  };
  return {
    id,
    sku: product.sku,
    title: product.title,
    artist: product.artist,
    category: product.category,
    format: product.format,
    display_format: product.displayFormat,
    apparel_type: product.apparelType,
    condition: product.condition,
    price: product.price,
    year: product.year,
    label: product.label,
    collection: product.collection,
    color: product.color,
    material: product.material,
    image: product.image,
    images: product.images,
    image_credits: product.imageCredits,
    tags: product.tags,
    details: product.details,
    sizes: product.sizes,
    description: product.description,
    qty: product.qty,
    publish_status: product.publishStatus,
    visibility: product.visibility,
    updated_at: product.updatedAt,
    raw: product
  };
}

function financeInventoryRow(item, productIdBySku) {
  const sku = String(item?.sku || "").trim();
  return {
    id: `finance-purchase-${item.id}`,
    name: null,
    title: item.itemType || "Inventory purchase",
    status: "Synced",
    sort: 0,
    raw: {
      ...item,
      id: `finance-purchase-${item.id}`,
      productId: productIdBySku.get(sku.toLowerCase()) || null,
      origin: "finance-purchase",
      updatedAt: today()
    }
  };
}

function financeStockRow(item, productIdBySku) {
  const sku = String(item?.sku || "").trim();
  const productId = productIdBySku.get(sku.toLowerCase()) || null;
  return {
    id: productId || `finance-stock-${item.id || slugify(sku)}`,
    name: null,
    title: item.title || item.item || "Inventory stock",
    status: "Synced",
    sort: 0,
    raw: {
      ...item,
      id: productId || `finance-stock-${item.id || slugify(sku)}`,
      productId,
      origin: "finance-stock",
      updatedAt: today()
    }
  };
}

function financeItemForProduct(product) {
  if (product.category === "Records") return product.format || "Vinyl";
  if (product.category === "Apparel") return product.apparelType === "Accessories" ? "Cap" : product.title || "Apparel";
  return "Object";
}

function recalculateStock(item) {
  const quantity = normalizedQuantity(item.qty);
  const costBasis = Number(item.costBasis || 0);
  const soldPrice = Number(item.soldPrice || 0);
  return {
    ...item,
    qty: quantity,
    costBasis,
    sellingPrice: Number(item.sellingPrice || 0),
    soldPrice,
    grossProfit: soldPrice > 0 ? soldPrice - costBasis : 0,
    margin: soldPrice > 0 ? ((soldPrice - costBasis) / soldPrice) * 100 : 0
  };
}

function normalizedQuantity(value) {
  return Math.max(0, Math.floor(Number(value) || 0));
}

function skuList(values) {
  return values.map((value) => `"${String(value).replaceAll('"', '\\"')}"`).join(",");
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "inventory-item";
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function readRemoteState() {
  return (await readRemoteStateWithVersion())?.state || null;
}

async function readRemoteStateWithVersion() {
  const rows = await supabaseFetch(`finance_state?select=state,updated_at&key=eq.${STATE_KEY}&limit=1`);
  const row = rows?.[0];
  return row ? { state: row.state, updatedAt: row.updated_at || null } : null;
}

async function supabaseFetch(path, options = {}) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service role is not configured.");
  const response = await fetch(`${url.replace(/\/$/, "")}/rest/v1/${path}`, {
    method: options.method || "GET",
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      prefer: options.prefer || "return=representation"
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(payload?.message || payload?.error || `Supabase finance state failed: ${response.status}`);
  return payload;
}
