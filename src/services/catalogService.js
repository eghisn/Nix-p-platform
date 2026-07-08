import { artistNames, cashflow, inventory, orders, products, requestItems } from "../data/sampleData.js";

// Replace this module with Supabase queries when the project receives credentials.
export const catalogService = {
  async listProducts() {
    return products;
  },
  async listProductsByCategory(category) {
    return products.filter((product) => product.category === category);
  },
  async listProductsByArtist(artistName) {
    return products.filter((product) => product.artist.toLowerCase() === artistName.toLowerCase());
  },
  async getProduct(id) {
    return products.find((product) => product.id === id);
  },
  async listRecords(format = "All") {
    return products.filter((product) => {
      const isRecord = product.category === "Records";
      return format === "All" ? isRecord : isRecord && product.format === format;
    });
  },
  async listApparel(type = "All Apparel") {
    return products.filter((product) => {
      const isApparel = product.category === "Apparel";
      return type === "All Apparel" ? isApparel : isApparel && product.apparelType === type;
    });
  },
  async listArtists() {
    return [...new Set(artistNames)].sort((a, b) => a.localeCompare(b));
  },
  async listInventory() {
    return inventory.map((item) => ({
      ...item,
      product: products.find((product) => product.id === item.productId)
    }));
  },
  async listOrders() {
    return orders.map((order) => ({
      ...order,
      products: order.items.map((id) => products.find((product) => product.id === id)).filter(Boolean)
    }));
  },
  async listRequests() {
    return requestItems;
  },
  async listCashflow() {
    return cashflow;
  }
};
