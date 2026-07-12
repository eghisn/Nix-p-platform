import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const root = process.cwd();
const dist = `${root}/dist`;

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const entry of ["index.html", "src", "public", "vercel.json"]) {
  if (existsSync(`${root}/${entry}`)) {
    await cp(`${root}/${entry}`, `${dist}/${entry}`, { recursive: true });
  }
}

await rm(`${dist}/public/data/admin-store.json`, { force: true });

const dataModule = `${dist}/src/data/sampleData.js`;
if (existsSync(dataModule)) {
  const source = await readFile(dataModule, "utf8");
  const sanitized = source
    .replace(/export const inventory = products\.map\(\(product, index\) => \(\{[\s\S]*?\}\)\);\r?\n/, "export const inventory = [];\n")
    .replace(/export const orders = \[[\s\S]*?\r?\n\];\r?\n/, "export const orders = [];\n")
    .replace(/export const requestItems = \[[\s\S]*?\r?\n\];\r?\n/, "export const requestItems = [];\n")
    .replace(/export const cashflow = \[[\s\S]*?\r?\n\];\r?\n/, "export const cashflow = [];\n");
  await writeFile(dataModule, sanitized);
}

console.log("Built NIXP prototype to dist/");
