import fs from "node:fs/promises";
import path from "node:path";
import { artistCreditNames } from "../src/data/catalogIdentity.js";

const root = process.cwd();
const store = JSON.parse(await fs.readFile(path.join(root, "public", "data", "public-store.json"), "utf8"));
const records = (store.products || []).filter((product) => product.category === "Records" && product.publishStatus === "Published" && product.visibility === "Public");
const fordLopatin = records.find((product) => product.artist === "Ford & Lopatin");
if (!fordLopatin) throw new Error("Ford & Lopatin product credit is missing from the public catalogue.");
if (JSON.stringify(artistCreditNames(fordLopatin.artist)) !== JSON.stringify(["Ford", "Daniel Lopatin"])) {
  throw new Error("Ford & Lopatin does not resolve to Ford and Daniel Lopatin without changing the product credit.");
}
const expected = [...new Set(records.flatMap((product) => artistCreditNames(product.artist)))].sort((left, right) => left.localeCompare(right));
const html = await fs.readFile(path.join(root, "dist", "artists", "index.html"), "utf8");
const actual = [...html.matchAll(/class="artist-row"[\s\S]*?<h2>(.*?)<\/h2>/g)].map((match) => match[1].replaceAll("&amp;", "&"));

if (JSON.stringify(actual) !== JSON.stringify(expected)) {
  throw new Error(`Generated artist directory differs from the public record credits (${actual.length} rendered, ${expected.length} expected).`);
}
if (actual.includes("Lopatin")) throw new Error("The legacy Lopatin artist identity is still publicly listed.");
if (!actual.includes("Daniel Lopatin")) throw new Error("Daniel Lopatin is missing from the public artist directory.");
if (!actual.includes("Ford")) throw new Error("Ford is missing from the public artist directory.");

console.log(`Artist directory consistency passed: ${actual.length} sorted public artists.`);
