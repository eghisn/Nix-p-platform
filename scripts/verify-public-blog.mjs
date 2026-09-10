import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const page = await fs.readFile(path.join(root, "dist", "blog", "index.html"), "utf8");

assert.match(page, /No journal entries are published at the moment\./i, "Blog should render a public empty state.");
assert.doesNotMatch(page, /Listening Notes: The First NIXP Selection|Inside Aesthetic Pleasure Gallery|Format Notes: Vinyl, CD, Cassette/i, "Placeholder blog articles must not be deployed.");
assert.doesNotMatch(page, /class="blog-row"/i, "Blog must not render sample post rows.");

console.log("Public Blog placeholder checks passed.");
