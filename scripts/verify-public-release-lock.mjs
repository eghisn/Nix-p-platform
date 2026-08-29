import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const root = process.cwd();
const dist = join(root, "dist");

async function htmlFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return htmlFiles(path);
    return entry.isFile() && entry.name.endsWith(".html") ? [path] : [];
  }));
  return nested.flat();
}

const files = (await htmlFiles(dist)).filter((file) => !relative(dist, file).replaceAll("\\", "/").startsWith("marketing/"));
if (!files.length) throw new Error("No generated HTML files found.");

let expectedRevision = "";
for (const file of files) {
  const html = await readFile(file, "utf8");
  const revision = html.match(/<meta name="nixp-release-revision" content="([a-z0-9]+)"/i)?.[1] || "";
  const snapshot = html.match(/<meta name="nixp-catalog-snapshot" content="([^"]+)"/i)?.[1] || "";
  const bundle = html.match(/<script type="module" src="([^"]+)"/i)?.[1] || "";
  const label = relative(dist, file);

  if (!revision) throw new Error(`${label} has no release revision.`);
  if (!expectedRevision) expectedRevision = revision;
  if (revision !== expectedRevision) throw new Error(`${label} uses release ${revision}, expected ${expectedRevision}.`);
  if (snapshot !== `/public/data/releases/${revision}.json`) throw new Error(`${label} uses the wrong catalog snapshot.`);
  if (bundle !== `/assets/app-${revision}.js`) throw new Error(`${label} uses the wrong application bundle.`);
}

const snapshotPath = join(dist, "public", "data", "releases", `${expectedRevision}.json`);
const bundlePath = join(dist, "assets", `app-${expectedRevision}.js`);
if (!existsSync(snapshotPath)) throw new Error("Revisioned catalog snapshot was not built.");
if (!existsSync(bundlePath)) throw new Error("Revisioned application bundle was not built.");

const snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
if (snapshot.releaseRevision !== expectedRevision) throw new Error("Catalog payload revision does not match its URL.");

console.log(`Verified ${files.length} public pages on release ${expectedRevision}.`);
