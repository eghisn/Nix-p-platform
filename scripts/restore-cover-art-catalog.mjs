import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const coverDir = path.join(root, "public", "covers");
const samplePath = path.join(root, "src", "data", "sampleData.js");
const storePath = path.join(root, "public", "data", "admin-store.json");

const covers = await fs.readdir(coverDir);
const coverById = new Map();

for (const file of covers) {
  const id = file.match(/^(nxp-2026-(?:cd|cst|vnl)-\d+)/)?.[1];
  if (id) coverById.set(id, `/public/covers/${file}`);
}

let source = await fs.readFile(samplePath, "utf8");

for (const [id, cover] of coverById) {
  const rowRegex = new RegExp(`(\\{\\s*"id":\\s*"${id}",[\\s\\S]*?"price":\\s*\\d+)([\\s\\S]*?\\n\\s*\\})`);
  source = source.replace(rowRegex, (match, body, tail) => {
    const cleanedTail = tail.replace(/,\s*\n\s*"image":\s*"[^"]+"/, "");
    return `${body},\n    "image": "${cover}"${cleanedTail}`;
  });
}

source = source
  .replaceAll('"Matrix",', '"Various Artists",')
  .replaceAll('"Tida Lek",\r\n', "")
  .replaceAll('"Tida Lek",\n', "")
  .replace(/"artist": "Matrix"/g, '"artist": "Various Artists"')
  .replace(/\n  \{\n    id: "obj-001",[\s\S]*?\n  \},\n(?=  \{\n    id: "app-001")/, "\n")
  .replace(/\n  \{\n    id: "pub-002",[\s\S]*?\n  \}\n(?=\];)/, "")
  .replace(/,?\s*"obj-001"/g, "");

await fs.writeFile(samplePath, source);

const store = JSON.parse(await fs.readFile(storePath, "utf8"));

for (const product of store.products) {
  const cover = coverById.get(product.id);
  if (cover) product.image = cover;
  if (product.artist === "Matrix") {
    product.artist = "Various Artists";
    product.description = String(product.description || "").replace(/^Matrix - /, "Various Artists - ");
  }
}

store.products = store.products.filter((product) => product.id !== "obj-001" && product.id !== "pub-002");
store.artists = store.artists.filter((artist) => !["matrix", "tida lek"].includes(String(artist.name).toLowerCase()));

if (!store.artists.some((artist) => artist.name === "Various Artists")) {
  store.artists.push({
    id: "various-artists",
    name: "Various Artists",
    bio: "",
    status: "Published",
    sort: store.artists.length + 1
  });
}

store.artists.sort((a, b) => a.name.localeCompare(b.name)).forEach((artist, index) => {
  artist.sort = index + 1;
});

for (const order of store.orders || []) {
  order.items = (order.items || []).filter((id) => id !== "obj-001");
}
store.inventory = (store.inventory || []).filter((item) => item.productId !== "obj-001" && item.productId !== "pub-002");

await fs.writeFile(storePath, `${JSON.stringify(store, null, 2)}\n`);

console.log(`Mapped ${coverById.size} cover files; updated sampleData and admin store.`);
