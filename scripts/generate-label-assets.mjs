import fs from "node:fs/promises";
import path from "node:path";
import { labelEntries, labelSlug } from "../src/data/labelCatalog.js";

const root = process.cwd();
const source = process.argv[2] || path.join(root, "public", "data", "public-store.json");
const output = process.argv[3] || path.join(root, "public", "labels");
const store = JSON.parse(await fs.readFile(source, "utf8"));

function hash(value) {
  return [...String(value)].reduce((result, character) => ((result * 31) + character.charCodeAt(0)) >>> 0, 7);
}

function fallbackMark(label) {
  const seed = hash(label.slug);
  const angle = seed % 360;
  const barCount = 3 + (seed % 4);
  const bars = Array.from({ length: barCount }, (_, index) => {
    const width = 18 + ((seed >>> (index + 2)) % 42);
    const x = 120 - (width / 2);
    const y = 34 + (index * 13);
    return `<rect x="${x}" y="${y}" width="${width}" height="6" rx="3" />`;
  }).join("");
  const ring = 24 + (seed % 13);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 120" role="img" aria-labelledby="title">
  <title id="title">${label.name.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</title>
  <g fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" transform="rotate(${angle} 120 60)">
    <circle cx="120" cy="60" r="${ring}" />
    <path d="M120 21v17M120 82v17M81 60H64M176 60h-17" />
  </g>
  <g fill="currentColor" transform="rotate(${angle / 2} 120 60)">${bars}</g>
</svg>
`;
}

await fs.mkdir(output, { recursive: true });
const labels = labelEntries(store.products || []);
for (const label of labels) {
  const slug = labelSlug(label.name);
  const filename = `${slug}.svg`;
  await fs.writeFile(path.join(output, filename), fallbackMark(label), "utf8");
}

for (const filename of await fs.readdir(output)) {
  if (!filename.endsWith(".svg") || labels.some((label) => `${labelSlug(label.name)}.svg` === filename)) continue;
  await fs.rm(path.join(output, filename), { force: true });
}

console.log(`Generated ${labels.length} transparent visual label assets in ${output}.`);
