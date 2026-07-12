import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const coverDir = path.join(root, "public", "covers");
const exportDir = path.join(root, "exports", "supabase");
const storePath = path.join(root, "public", "data", "admin-store.json");
const samplePath = path.join(root, "src", "data", "sampleData.js");
const blackstarSource = "C:\\Users\\neo-jagur\\Downloads\\920.avif";
const userAgent = "NIXPPrototype/0.1 local asset preparation";

const coverJobs = [
  {
    id: "nxp-2026-cd-0011",
    file: "nxp-2026-cd-0011-david-bowie-blackstar.avif",
    local: blackstarSource,
    title: "Blackstar",
    artist: "David Bowie"
  },
  {
    id: "nxp-2026-cst-0005",
    file: "nxp-2026-cst-0005-rezzett-into-the-boiling-darks.jpg",
    bandcamp: "https://rezzett.bandcamp.com/album/into-the-boiling-darks",
    title: "Into The Boiling Darks",
    artist: "Rezzett"
  },
  {
    id: "nxp-2026-cd-0003",
    file: "nxp-2026-cd-0003-the-chemical-brothers-come-with-us.jpg",
    itunes: "The Chemical Brothers Come With Us",
    title: "Come With Us",
    artist: "The Chemical Brothers"
  },
  {
    id: "nxp-2026-cd-0004",
    file: "nxp-2026-cd-0004-the-chemical-brothers-further.jpg",
    itunes: "The Chemical Brothers Further",
    title: "Further",
    artist: "The Chemical Brothers"
  },
  {
    id: "nxp-2026-cd-0005",
    file: "nxp-2026-cd-0005-yeah-yeah-yeahs-its-blitz.jpg",
    itunes: "Yeah Yeah Yeahs It's Blitz!",
    title: "It's Blitz!",
    artist: "Yeah Yeah Yeahs"
  },
  {
    id: "nxp-2026-cd-0013",
    file: "nxp-2026-cd-0013-senyawa-with-kazuhisa-uchihashi.jpg",
    bandcamp: "https://innocentrecords.bandcamp.com/album/senyawa-with-kazuhisa-uchihashi",
    title: "Senyawa with Kazuhisa Uchihashi",
    artist: "Senyawa, Kazuhisa Uchihashi"
  },
  {
    id: "nxp-2026-cd-0023",
    file: "nxp-2026-cd-0023-oneohtrix-point-never-tranquilizer.jpg",
    bandcamp: "https://oneohtrixpointnever.bandcamp.com/album/tranquilizer",
    title: "Tranquilizer",
    artist: "Oneohtrix Point Never"
  }
];

await fs.mkdir(coverDir, { recursive: true });
await fs.mkdir(exportDir, { recursive: true });

async function fetchText(url) {
  const response = await fetch(url, { headers: { "User-Agent": userAgent } });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.text();
}

async function fetchBuffer(url) {
  const response = await fetch(url, { headers: { "User-Agent": userAgent } });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function bandcampImage(url) {
  const html = await fetchText(url);
  const og = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i)?.[1];
  if (!og) throw new Error(`No Bandcamp og:image found for ${url}`);
  return og;
}

async function itunesImage(term) {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=album&media=music&limit=10`;
  const data = JSON.parse(await fetchText(url));
  const result = data.results?.[0];
  if (!result?.artworkUrl100) throw new Error(`No iTunes artwork found for ${term}`);
  return result.artworkUrl100.replace(/100x100bb\.(jpg|png)$/, "1200x1200bb.$1");
}

const imageById = new Map();

for (const job of coverJobs) {
  const output = path.join(coverDir, job.file);
  if (job.local) {
    if (!existsSync(job.local)) throw new Error(`Missing local file: ${job.local}`);
    await fs.copyFile(job.local, output);
  } else {
    const imageUrl = job.bandcamp ? await bandcampImage(job.bandcamp) : await itunesImage(job.itunes);
    await fs.writeFile(output, await fetchBuffer(imageUrl));
  }
  imageById.set(job.id, `/public/covers/${job.file}`);
  console.log(`Saved ${job.id} -> /public/covers/${job.file}`);
}

function updateSampleRow(source, job) {
  const image = imageById.get(job.id);
  const rowRegex = new RegExp(`(\\{\\s*"id":\\s*"${job.id}",[\\s\\S]*?)(\\n\\s*\\})`);
  return source.replace(rowRegex, (match, body, close) => {
    let next = body
      .replace(/"artist":\s*"[^"]+"/, `"artist": "${job.artist}"`)
      .replace(/"title":\s*"[^"]+"/, `"title": "${job.title}"`)
      .replace(/,\s*\n\s*"image":\s*"[^"]+"/, "");
    return `${next},\n    "image": "${image}"${close}`;
  });
}

let sampleSource = await fs.readFile(samplePath, "utf8");
for (const job of coverJobs.filter((job) => job.id !== "nxp-2026-cd-0023")) {
  sampleSource = updateSampleRow(sampleSource, job);
}

if (!sampleSource.includes('"id": "nxp-2026-cd-0023"')) {
  const newRecord = `  {
    "id": "nxp-2026-cd-0023",
    "sku": "NXP-2026-CD-0023",
    "artist": "Oneohtrix Point Never",
    "title": "Tranquilizer",
    "format": "CD",
    "qty": 1,
    "price": 300000,
    "condition": "Used Excellence",
    "image": "${imageById.get("nxp-2026-cd-0023")}"
  },
`;
  sampleSource = sampleSource.replace("const recordRows = [\n", `const recordRows = [\n${newRecord}`);
}

sampleSource = sampleSource
  .replace(/\n  \{\n    id: "obj-001",[\s\S]*?\n  \},\n(?=  \{\n    id: "app-001")/, "\n")
  .replace(/\n  \{\n    id: "pub-002",[\s\S]*?\n  \},?\n(?=\];)/, "\n")
  .replace(/,?\s*"obj-001"/g, "")
  .replace(/,?\s*"pub-002"/g, "")
  .replaceAll('"Tida Lek",\r\n', "")
  .replaceAll('"Tida Lek",\n', "");

await fs.writeFile(samplePath, sampleSource);

const store = JSON.parse(await fs.readFile(storePath, "utf8"));

for (const job of coverJobs) {
  let product = store.products.find((item) => item.id === job.id);
  if (!product && job.id === "nxp-2026-cd-0023") {
    product = {
      publishStatus: "Published",
      visibility: "Public",
      updatedAt: new Date().toISOString().slice(0, 10),
      id: job.id,
      sku: "NXP-2026-CD-0023",
      title: job.title,
      artist: job.artist,
      condition: "Used Excellence",
      format: "CD",
      displayFormat: "CD",
      category: "Records",
      qty: 1,
      price: 300000,
      year: 2026,
      label: "NIXP Selection",
      tags: ["CD", "NXP-2026-CD-0023"],
      details: ["SKU: NXP-2026-CD-0023", "Format: CD", "Condition: Used Excellence"],
      sizes: []
    };
    store.products.push(product);
  }

  if (product) {
    product.artist = job.artist;
    product.title = job.title;
    product.image = imageById.get(job.id);
    if (job.id === "nxp-2026-cd-0023") {
      product.price = 300000;
      product.condition = "Used Excellence";
      product.format = "CD";
      product.displayFormat = "CD";
      product.category = "Records";
      product.qty = 1;
    }
  }
}

store.products = store.products.filter((product) => product.id !== "obj-001" && product.id !== "pub-002");
store.artists = store.artists.filter((artist) => String(artist.name).toLowerCase() !== "tida lek");
for (const order of store.orders || []) {
  order.items = (order.items || []).filter((id) => id !== "obj-001" && id !== "pub-002");
}
store.inventory = (store.inventory || []).filter((item) => item.productId !== "obj-001" && item.productId !== "pub-002");

if (!store.artists.some((artist) => artist.name === "Oneohtrix Point Never")) {
  store.artists.push({
    id: "oneohtrix-point-never",
    name: "Oneohtrix Point Never",
    bio: "",
    status: "Published",
    sort: store.artists.length + 1
  });
}

store.artists.sort((a, b) => a.name.localeCompare(b.name)).forEach((artist, index) => {
  artist.sort = index + 1;
});

await fs.writeFile(storePath, `${JSON.stringify(store, null, 2)}\n`);

const publicProducts = store.products.filter((product) => product.publishStatus === "Published" && product.visibility !== "Hidden");
const exportPayloads = {
  "products.json": store.products,
  "public-products.json": publicProducts,
  "artists.json": store.artists,
  "collections.json": store.collections,
  "inventory.json": store.inventory,
  "orders.json": store.orders,
  "requests.json": store.requests,
  "cashflow.json": store.cashflow,
  "asset-manifest.json": {
    generatedAt: new Date().toISOString(),
    coverImages: store.products
      .filter((product) => String(product.image || "").startsWith("/public/covers/"))
      .map((product) => ({
        productId: product.id,
        sku: product.sku,
        image: product.image,
        localPath: product.image.replace("/public/", "public/")
      })),
    uploadedProductImages: store.products
      .filter((product) => String(product.image || "").startsWith("/public/uploads/products/"))
      .map((product) => ({
        productId: product.id,
        sku: product.sku,
        image: product.image,
        localPath: product.image.replace("/public/", "public/")
      }))
  }
};

for (const [file, data] of Object.entries(exportPayloads)) {
  await fs.writeFile(path.join(exportDir, file), `${JSON.stringify(data, null, 2)}\n`);
}

await fs.copyFile(storePath, path.join(exportDir, "admin-store.snapshot.json"));
console.log(`Prepared Supabase/GitHub export files in ${path.relative(root, exportDir)}`);
