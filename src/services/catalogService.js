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
    return adminStore
      .listProducts()
      .filter((product) => product.artist.toLowerCase() === artistName.toLowerCase());
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
    return adminStore
      .getSnapshot()
      .artists.filter((artist) => artist.status === "Published")
      .filter((artist) => !hiddenPublicArtists.has(artist.name.trim().toLowerCase()))
      .map((artist) => artist.name)
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
