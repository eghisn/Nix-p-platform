import { json } from "./_lib/auth.js";
import { readFinanceState, writeFinanceState } from "./_lib/financeState.js";
import { isSupabaseConfigured, supabaseFetch, upsertRawRows } from "./_lib/supabase.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method not allowed" });
  if (!isSupabaseConfigured({ requireServiceRole: true })) {
    return json(res, 503, { ok: false, error: "Checkout is not configured." });
  }

  try {
    const body = parseBody(req.body);
    if (containsClientPrice(body)) {
      return json(res, 400, { ok: false, error: "Checkout prices must be verified by the server." });
    }

    const items = normalizeItems(body.items);
    if (!items.length) return json(res, 400, { ok: false, error: "Cart is empty." });

    const products = await loadProducts(items.map((item) => item.id));
    const productsById = new Map(products.map((product) => [product.id, product]));
    const lines = items.map((item) => buildLine(item, productsById.get(item.id)));
    const unavailable = lines.find((line) => line.error);
    if (unavailable) return json(res, 409, { ok: false, error: unavailable.error });

    const total = lines.reduce((sum, line) => sum + line.lineTotal, 0);
    const order = buildOrder(body.customer || {}, lines, total);
    await upsertRawRows("orders", order);
    await Promise.all(lines.map((line) => reserveStock(line)));
    await appendFinanceSale(order);

    return json(res, 200, {
      ok: true,
      order: {
        id: order.id,
        status: order.status,
        total: order.total,
        items: order.items
      }
    });
  } catch (error) {
    const status = Number(error?.statusCode || 500);
    return json(res, status, { ok: false, error: error instanceof Error ? error.message : "Checkout failed." });
  }
}

async function appendFinanceSale(order) {
  const state = await readFinanceState();
  const existingSales = Array.isArray(state.sales) ? state.sales : [];
  if (existingSales.some((sale) => sale.invoice === order.id)) return;
  await writeFinanceState({
    ...state,
    sales: [
      ...existingSales,
      {
        id: `sale-${order.id}`,
        date: order.date,
        invoice: order.id,
        category: "Retail",
        sku: order.lineItems.map((item) => (item.size ? `${item.sku}/${item.size}` : item.sku)).join(", "),
        qty: order.lineItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
        revenue: order.total,
        discount: 0,
        discountContext: "",
        cogs: 0,
        grossProfit: order.total,
        paymentMethod: "Pending"
      }
    ]
  });
}

function parseBody(body) {
  try {
    return typeof body === "string" ? JSON.parse(body || "{}") : body || {};
  } catch {
    const error = new Error("Invalid checkout payload.");
    error.statusCode = 400;
    throw error;
  }
}

function containsClientPrice(value) {
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, nested]) => {
    const normalized = key.toLowerCase();
    if (["price", "total", "linetotal", "subtotal", "amount"].includes(normalized)) return true;
    return containsClientPrice(nested);
  });
}

function normalizeItems(items) {
  const counts = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const id = typeof item === "string" ? item : String(item?.id || "");
    const size = typeof item === "string" ? "" : String(item?.size || "").trim();
    const quantity = typeof item === "string" ? 1 : Number(item?.quantity || 1);
    if (!id || !Number.isFinite(quantity) || quantity <= 0) continue;
    const key = `${id}::${size}`;
    counts.set(key, {
      id,
      size,
      quantity: (counts.get(key)?.quantity || 0) + Math.min(20, Math.floor(quantity))
    });
  }
  return [...counts.values()];
}

async function loadProducts(ids) {
  const uniqueIds = [...new Set(ids)];
  if (!uniqueIds.length) return [];
  const inList = uniqueIds.map((id) => `"${id.replaceAll('"', '\\"')}"`).join(",");
  return supabaseFetch(`products?select=*&id=in.(${inList})`, { service: true });
}

function buildLine(item, product) {
  if (!product) return { ...item, error: "One or more cart items are no longer available." };
  const stock = productStock(product, item.size);
  if (product.publish_status !== "Published" || product.visibility !== "Public") {
    return { ...item, product, error: `${product.title} is not available.` };
  }
  if (hasSizes(product) && !item.size) {
    return { ...item, product, error: `Please select a size for ${product.title}.` };
  }
  if (stock < item.quantity) {
    return { ...item, product, error: `${product.title}${item.size ? ` / ${item.size}` : ""} has only ${Math.max(0, stock)} available.` };
  }
  const unitPrice = Number(product.price || 0);
  return {
    id: item.id,
    size: item.size,
    quantity: item.quantity,
    product,
    unitPrice,
    lineTotal: unitPrice * item.quantity
  };
}

function buildOrder(customer, lines, total) {
  const id = `order-${Date.now()}`;
  const date = new Date().toISOString().slice(0, 10);
  const cleanCustomer = {
    name: String(customer.name || "").trim(),
    email: String(customer.email || "").trim(),
    whatsapp: String(customer.whatsapp || "").trim(),
    notes: String(customer.notes || "").trim()
  };
  return {
    id,
    date,
    customer: cleanCustomer.name || cleanCustomer.email || cleanCustomer.whatsapp || "Website customer",
    email: cleanCustomer.email,
    whatsapp: cleanCustomer.whatsapp,
    channel: "Website",
    status: "New",
    total,
    items: lines.map((line) => line.id),
    lineItems: lines.map((line) => ({
      productId: line.id,
      sku: line.product.sku,
      artist: line.product.artist,
      title: line.product.title,
      size: line.size,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      lineTotal: line.lineTotal
    })),
    notes: cleanCustomer.notes,
    priceSource: "server:supabase.products.price",
    createdAt: new Date().toISOString()
  };
}

async function reserveStock(line) {
  const raw = line.product.raw || {};
  if (hasSizes(line.product)) {
    const currentSizes = Array.isArray(line.product.sizes) ? line.product.sizes : [];
    const nextSizes = currentSizes.map((size) => {
      if (String(size.label || "") !== line.size) return size;
      const quantity = Math.max(0, Number(size.quantity ?? size.qty ?? (size.soldOut ? 0 : 1)) - line.quantity);
      return { ...size, quantity, soldOut: quantity <= 0 };
    });
    return supabaseFetch(`products?id=eq.${encodeURIComponent(line.id)}`, {
      method: "PATCH",
      service: true,
      body: {
        sizes: nextSizes,
        raw: {
          ...raw,
          sizes: nextSizes,
          updatedAt: new Date().toISOString().slice(0, 10)
        },
        updated_at: new Date().toISOString().slice(0, 10)
      },
      prefer: "return=minimal"
    });
  }
  const nextQty = Math.max(0, Number(line.product.qty || raw.qty || 0) - line.quantity);
  return supabaseFetch(`products?id=eq.${encodeURIComponent(line.id)}`, {
    method: "PATCH",
    service: true,
    body: {
      qty: nextQty,
      raw: {
        ...raw,
        qty: nextQty,
        updatedAt: new Date().toISOString().slice(0, 10)
      },
      updated_at: new Date().toISOString().slice(0, 10)
    },
    prefer: "return=minimal"
  });
}

function hasSizes(product) {
  return Array.isArray(product?.sizes) && product.sizes.length > 0;
}

function productStock(product, size = "") {
  if (hasSizes(product)) {
    const selected = product.sizes.find((item) => String(item.label || "") === size);
    if (!selected) return 0;
    return Math.max(0, Math.floor(Number(selected.quantity ?? selected.qty ?? (selected.soldOut ? 0 : 1)) || 0));
  }
  return Math.max(0, Math.floor(Number(product.qty || 0) || 0));
}
