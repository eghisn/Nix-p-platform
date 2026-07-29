import { mkdir, writeFile } from "node:fs/promises";

const source = "https://wilayah.id/api";
const provinceResponse = await fetch(`${source}/provinces.json`);
if (!provinceResponse.ok) throw new Error(`Unable to download provinces: ${provinceResponse.status}`);
const provinces = (await provinceResponse.json()).data || [];
const regions = [];

for (const province of provinces) {
  const response = await fetch(`${source}/regencies/${province.code}.json`);
  if (!response.ok) throw new Error(`Unable to download regencies for ${province.name}: ${response.status}`);
  const regencies = (await response.json()).data || [];
  for (const regency of regencies) {
    regions.push({ code: regency.code, city: regency.name, province: province.name });
  }
}

regions.sort((a, b) => a.province.localeCompare(b.province, "id") || a.city.localeCompare(b.city, "id"));
const output = `// Source: wilayah.id, administrative data aligned to Kepmendagri No. 300.2.2-2138/2025.\n// Refreshed: ${new Date().toISOString().slice(0, 10)}. JNE serviceability is confirmed separately by its shipping API.\nexport const indonesiaRegencies = ${JSON.stringify(regions, null, 2)};\n`;

await mkdir(new URL("../src/data/", import.meta.url), { recursive: true });
await writeFile(new URL("../src/data/indonesiaRegencies.js", import.meta.url), output, "utf8");
console.log(`Saved ${regions.length} Indonesian regencies/cities.`);
