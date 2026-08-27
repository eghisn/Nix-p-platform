import fs from "node:fs/promises";
import path from "node:path";
import { productArtistCreditNames } from "../src/data/catalogIdentity.js";
import { canGenerateProductCardThumbnail, productCardThumbnailWidths } from "../src/data/productThumbnails.js";

const root = process.cwd();
const store = JSON.parse(await fs.readFile(path.join(root, "public", "data", "public-store.json"), "utf8"));
const products = (store.products || []).filter(
  (product) => product.publishStatus === "Published" && product.visibility === "Public" && product.image
);
const records = products.filter((product) => product.category === "Records");
const artistCount = new Set(records.flatMap((product) => productArtistCreditNames(product).map(slugify))).size;

const artistsHtml = await fs.readFile(path.join(root, "dist", "artists", "index.html"), "utf8");
assert(artistsHtml.includes("artist-list"), "Artists must be generated as a static catalogue page.");
assert(count(artistsHtml, 'class="artist-row"') === artistCount, "Static Artists page is not using the complete deployed artist revision.");

const recordsHtml = await fs.readFile(path.join(root, "dist", "records", "index.html"), "utf8");
assert(count(recordsHtml, 'class="product-card ') === records.length, "Records page must preserve every public catalogue item.");
assert(
  count(recordsHtml, "data-deferred-product-card") === Math.max(0, records.length - 8),
  "Records below the initial render window must use progressive card activation."
);
const activeRecordsHtml = recordsHtml.replace(/<template>[\s\S]*?<\/template>/g, "");
assert(count(activeRecordsHtml, "<img ") <= 10, "Records initial HTML activates too many image elements.");
assert(recordsHtml.includes("product-thumbnails/") && recordsHtml.includes("srcset="), "Records cards must expose responsive thumbnail sources.");

const localThumbnailRecords = records.filter(canGenerateProductCardThumbnail);
const thumbnailFiles = await fs.readdir(path.join(root, "dist", "product-thumbnails"));
assert(
  thumbnailFiles.length === localThumbnailRecords.length * productCardThumbnailWidths.length,
  "Build did not generate every responsive local record thumbnail."
);

const assets = await fs.readdir(path.join(root, "dist", "assets", "chunks"));
assert(assets.some((entry) => entry.endsWith(".js")), "Records route code was not emitted as a separate browser chunk.");

const vercel = JSON.parse(await fs.readFile(path.join(root, "vercel.json"), "utf8"));
assert(!vercel.rewrites.some((rewrite) => rewrite.source === "/artists"), "/artists must not bypass the static page through a no-store function.");
assert(vercel.headers.some((entry) => entry.source === "/artists"), "/artists must have an explicit CDN cache policy.");

console.log(
  `Catalog performance contract passed: ${artistCount} artists, ${records.length} records, ${thumbnailFiles.length} thumbnails.`
);

function count(value, token) {
  return value.split(token).length - 1;
}

function slugify(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
