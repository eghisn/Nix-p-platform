import { readFile, writeFile } from "node:fs/promises";

const updatedAt = "2026-07-22";
const sources = {
  vinyl: "https://www.shopify.com/blog/how-to-ship-vinyl-records",
  cd: "https://auspost.com.au/content/dam/auspost_corp/media/documents/packaging-guide.pdf",
  cassette: "https://www.duplication.com/full-black-cassette-cases-no-posts.html",
  apparel: "https://help.shopify.com/en/manual/fulfillment/setup/packaging/packages-and-weights",
  mailer: "https://www.pluspackaging.com/blog/mailing-bags/poly-mailer-sizes/",
  cap: "https://hatcaddy.co/pages/shipping",
  magazine: "https://www.defendapack.com/postal_boxes_and_cartons/book-mailers-book-postal-packaging/size-5-a4-book-mailer-302mm-x-215mm-x-80mm/"
};

function reference(weightGrams, lengthCm, widthCm, heightCm, source) {
  return { weightGrams, lengthCm, widthCm, heightCm, status: "format_reference", source, updatedAt };
}

export function shippingProfile(product = {}) {
  const format = String(product.format || "").toLowerCase();
  const title = String(product.title || "").toLowerCase();
  const material = String(product.material || "").toLowerCase();
  const details = Array.isArray(product.details) ? product.details.join(" ").toLowerCase() : "";

  if (format === "vinyl") return reference(700, 35, 35, 5, sources.vinyl);
  if (format === "cd") return reference(200, 18, 16, 5, sources.cd);
  if (format === "cassette") return reference(180, 16, 12, 5, sources.cassette);
  if (format === "magazine" || product.category === "Publishing") return reference(700, 32, 24, 4, sources.magazine);
  if (product.category === "Objects" || format === "object") return reference(180, 12, 10, 6, sources.apparel);
  if (title.includes("cap")) return reference(350, 25, 20, 15, sources.cap);
  if (title.includes("knit") || material.includes("knit")) return reference(1000, 40, 32, 12, sources.mailer);
  if (title.includes("crewneck") || title.includes("sweatshirt") || title.includes("hoodie")) return reference(900, 40, 32, 10, sources.mailer);
  if (title.includes("longsleeve") || details.includes("250gsm")) return reference(500, 35, 28, 6, sources.apparel);
  if (details.includes("320gsm")) return reference(500, 35, 28, 5, sources.apparel);
  if (details.includes("265gsm")) return reference(450, 35, 28, 5, sources.apparel);
  return reference(380, 35, 28, 5, sources.apparel);
}

for (const path of ["public/data/admin-store.json", "public/data/public-store.json"]) {
  const store = JSON.parse(await readFile(path, "utf8"));
  store.products = (store.products || []).map((product) => ({ ...product, shipping: shippingProfile(product) }));
  await writeFile(path, `${JSON.stringify(store, null, 2)}\n`);
  console.log(`Updated ${store.products.length} shipping profiles in ${path}`);
}
