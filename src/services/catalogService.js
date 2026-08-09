import { adminStore } from "./adminStore.js";
import { artistCreditNames, canonicalArtistName, canonicalLabelName, artistIdentityKey } from "../data/catalogIdentity.js";
import { publicCategoryPath, publicProductSlug } from "../data/publicUrls.js";

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
    const requested = artistIdentityKey(artistName);
    return adminStore
      .listProducts()
      .filter((product) => artistCreditNames(product.artist).some((name) => artistIdentityKey(name) === requested));
  },
  async getProduct(id, options = {}) {
    return adminStore.getProduct(id, options);
  },
  async getProductByPublicSlug(categoryPath, slug, options = {}) {
    return adminStore
      .listProducts(options)
      .find((product) => publicCategoryPath(product) === categoryPath && publicProductSlug(product) === slug);
  },
  async listRecords(format = "All", label = "") {
    return adminStore.listProducts().filter((product) => {
      const isRecord = product.category === "Records";
      const matchesFormat = format === "All" || product.format === format;
      const matchesLabel = !label || canonicalLabelName(product.label) === canonicalLabelName(label);
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
    const recordArtistKeys = new Set(recordProducts.flatMap((product) => artistCreditNames(product.artist).map(artistIdentityKey)).filter(Boolean));
    const names = [
      ...snapshot.artists
        .filter((artist) => artist.status === "Published")
        .filter((artist) => recordArtistKeys.has(artistIdentityKey(artist.name)))
        .map((artist) => artist.name),
      ...recordProducts.flatMap((product) => artistCreditNames(product.artist))
    ];
    return [...new Map(names
      .map((name) => String(name || "").trim())
      .filter((name) => name && !hiddenPublicArtists.has(name.toLowerCase()))
      .map((name) => [artistIdentityKey(name), canonicalArtistName(name)]))
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
    await adminStore.refreshPrivateStore();
    const orders = adminStore.getSnapshot().orders;
    const products = adminStore.listProducts({ includeDrafts: true });
    return orders.map((order) => {
      const lineItems = Array.isArray(order.lineItems) ? order.lineItems : [];
      const productIds = Array.isArray(order.items) && order.items.length ? order.items : lineItems.map((item) => item.productId).filter(Boolean);
      return {
        ...order,
        items: productIds,
        lineItems,
        products: productIds.map((id) => products.find((product) => product.id === id)).filter(Boolean)
      };
    });
  },
  async listRequests() {
    await adminStore.refreshRequests();
    return adminStore.getSnapshot().requests;
  },
  async listOffers() {
    await adminStore.refreshPrivateStore();
    return adminStore.getSnapshot().offers || [];
  },
  async listCashflow() {
    return adminStore.getSnapshot().cashflow;
  }
};
