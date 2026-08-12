import fs from "node:fs/promises";
import path from "node:path";
import { labelEntries, labelLogoPath } from "../src/data/labelCatalog.js";

const root = process.cwd();
const source = process.argv[2] || path.join(root, "public", "data", "public-store.json");
const output = process.argv[3] || path.join(root, "public", "labels");
const store = JSON.parse(await fs.readFile(source, "utf8"));

function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

await fs.mkdir(output, { recursive: true });
for (const label of labelEntries(store.products || [])) {
  const width = Math.max(180, Math.min(760, 42 + label.name.length * 14));
  const filename = path.basename(labelLogoPath(label.name));
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 64" role="img" aria-labelledby="title">
  <title id="title">${escapeXml(label.name)}</title>
  <text x="${width / 2}" y="42" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="700" letter-spacing="0">${escapeXml(label.name)}</text>
</svg>
`;
  await fs.writeFile(path.join(output, filename), svg);
}

console.log(`Generated ${labelEntries(store.products || []).length} transparent label assets in ${output}`);
