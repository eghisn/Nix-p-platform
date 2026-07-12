import { adminStore } from "./adminStore.js";

// Replace this module with Supabase queries when the project receives credentials.
const hiddenPublicArtists = new Set(["motorith", "nixp publishing", "publishing", "sample artist", "tida lek"]);

export const catalogService = {
  async listProducts(options = {}) {
    return adminStore.listProducts(options);
  },
  async listAllProducts() {
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
  async listRecords(format = "All") {
    return adminStore.listProducts().filter((product) => {
      const isRecord = product.category === "Records";
      return format === "All" ? isRecord : isRecord && product.format === format;
    });
  },
  async listApparel(type = "All Apparel") {
    return adminStore.listProducts().filter((product) => {
      const isApparel = product.category === "Apparel";
      return type === "All Apparel" ? isApparel : isApparel && product.apparelType === type;
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
    const products = adminStore.listProducts({ includeDrafts: true });
    return adminStore.getSnapshot().inventory.map((item) => ({
      ...item,
      product: products.find((product) => product.id === item.productId)
    }));
  },
  async listOrders() {
    const products = adminStore.listProducts({ includeDrafts: true });
    return adminStore.getSnapshot().orders.map((order) => ({
      ...order,
      products: order.items.map((id) => products.find((product) => product.id === id)).filter(Boolean)
    }));
  },
  async listRequests() {
    return adminStore.getSnapshot().requests;
  },
  async listCashflow() {
    return adminStore.getSnapshot().cashflow;
  }
};
