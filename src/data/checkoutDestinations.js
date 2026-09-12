import { indonesiaRegencies } from "./indonesiaRegencies.js";

function normalize(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

const aliases = {
  yogya: "yogyakarta", jogja: "yogyakarta", jogjakarta: "yogyakarta",
  "west java": "jawa barat", jabar: "jawa barat",
  "central java": "jawa tengah", jateng: "jawa tengah",
  "east java": "jawa timur", jatim: "jawa timur"
};

export function searchCheckoutDestinations(value) {
  const normalized = normalize(value);
  const query = aliases[normalized] || normalized;
  const words = query.split(" ").filter(Boolean);
  const isProvince = indonesiaRegencies.some((region) => normalize(region.province) === query);
  return indonesiaRegencies.filter((region) => {
    if (isProvince) return normalize(region.province) === query;
    const text = normalize(`${region.city} ${region.province}`);
    return words.every((word) => text.includes(word));
  }).sort((a, b) => {
    const score = (region) => {
      const city = normalize(region.city).replace(/^(kota|kabupaten) /, "");
      return (city === query ? 0 : city.startsWith(query) ? 1 : 2) * 10
        + (/^Kota\b/.test(region.city) ? 0 : 1);
    };
    return score(a) - score(b) || a.city.localeCompare(b.city, "id");
  });
}

export function checkoutQuoteError(status, message = "") {
  if (/^SHIPPING_PROFILE_REQUIRED:|^SHIPPING_MEASUREMENTS_REQUIRED:/.test(message)) {
    return "Shipping details for an item are not ready. Please contact NIXP or choose Store Pickup.";
  }
  if (status === 429) return "Too many shipping requests. Please wait a moment, then retry.";
  if (status >= 500 || !status) return "Shipping could not be calculated right now. Please retry.";
  if (status === 422) return "Shipping is currently unavailable for this destination.";
  return "Shipping could not be calculated. Please check your city and cart, then retry.";
}
