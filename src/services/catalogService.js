import { adminStore } from "./adminStore.js";

// Replace this module with Supabase queries when the project receives credentials.
const hiddenPublicArtists = new Set(["motorith", "nixp publishing", "publishing", "sample artist", "tida lek"]);

function normalizeApparelType(value) {
  const type = String(value || "").trim().toLowerCase();
  if (type === "accesories" || type === "accessory") return "Accessories";
  if (type === "tops" || type === "top") return "Tops";
  if (type === "bottoms" || type === "bottom") return "Bottoms";
  return String(value || "").trim();
}

function numericQuantity(value) {
  const quantity = Number(value);
  return Number.isFinite(quantity) ? Math.max(0, Math.floor(quantity)) : null;
}

function sizeQuantity(sizes) {
  if (!Array.isArray(sizes) || !sizes.length) return null;
  return sizes.reduce((sum, size) => sum + (numericQuantity(size.quantity ?? size.qty ?? (size.soldOut ? 0 : 1)) ?? 0), 0);
}

function inventoryStock(item, product) {
  return (
    numericQuantity(item.stock) ??
    numericQuantity(item.quantity) ??
    numericQuantity(item.qty) ??
    sizeQuantity(item.sizes) ??
    sizeQuantity(product?.sizes) ??
    numericQuantity(product?.qty) ??
    0
  );
}

export const catalogService = {
  async listProducts(options = {}) {
    return adminStore.listProducts(options);
  },
  async listAllProducts() {
    await adminStore.refreshPrivateStore();
    return adminStore.listProducts({ includeDrafts: true });
  },
  async listProductsByCategory(category) {
    return adminStore.listProducts().filter((product) => product.category === category);
  },
  async listProductsByArtist(artistName) {
    const requested = artistKey(artistName);
    return adminStore
      .listProducts()
      .filter((product) => artistKey(product.artist) === requested);
  },
  async getProduct(id, options = {}) {
    return adminStore.getProduct(id, options);
  },
  async listRecords(format = "All", label = "") {
    return adminStore.listProducts().filter((product) => {
      const isRecord = product.category === "Records";
      const matchesFormat = format === "All" || product.format === format;
      const matchesLabel = !label || product.label === label;
      return isRecord && matchesFormat && matchesLabel;
    });
  },
  async listApparel(type = "All Apparel") {
    return adminStore.listProducts().filter((product) => {
      const isApparel = product.category === "Apparel";
      return type === "All Apparel" ? isApparel : isApparel && normalizeApparelType(product.apparelType) === type;
    });
  },
  async listArtists() {
    const snapshot = adminStore.getSnapshot();
    const recordProducts = adminStore.listProducts().filter((product) => product.category === "Records");
    const recordArtistKeys = new Set(recordProducts.map((product) => artistKey(product.artist)).filter(Boolean));
    const names = [
      ...snapshot.artists
        .filter((artist) => artist.status === "Published")
        .filter((artist) => recordArtistKeys.has(artistKey(artist.name)))
        .map((artist) => artist.name),
      ...recordProducts.map((product) => product.artist)
    ];
    return [...new Map(names
      .map((name) => String(name || "").trim())
      .filter((name) => name && !hiddenPublicArtists.has(name.toLowerCase()))
      .map((name) => [artistKey(name), name]))
      .values()]
      .sort((a, b) => a.localeCompare(b));
  },
  async listAdminArtists() {
    return adminStore.getSnapshot().artists;
  },
  async listCollections() {
    return adminStore.getSnapshot().collections;
  },
  async listInventory() {
    await adminStore.refreshPrivateStore();
    const products = adminStore.listProducts({ includeDrafts: true });
    return adminStore.getSnapshot().inventory.map((item) => ({
      ...item,
      product: products.find((product) => product.id === item.productId)
    })).map((item) => ({
      ...item,
      stock: inventoryStock(item, item.product),
      lowStockAt: numericQuantity(item.lowStockAt) ?? 1,
      status: item.status || "In stock"
    }));
  },
  async listOrders() {
    await adminStore.refreshOrders();
    const products = adminStore.listProducts({ includeDrafts: true });
    return adminStore.getSnapshot().orders.map((order) => ({
      ...order,
      products: order.items.map((id) => products.find((product) => product.id === id)).filter(Boolean)
    }));
  },
  async listRequests() {
    await adminStore.refreshRequests();
    return adminStore.getSnapshot().requests;
  },
  async listCashflow() {
    return adminStore.getSnapshot().cashflow;
  }
};

function artistKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
