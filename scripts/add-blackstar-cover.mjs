import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const coverPath = path.join(root, "public", "covers", "nxp-2026-cd-0011-david-bowie-blackstar.jpg");
const publicPath = "/public/covers/nxp-2026-cd-0011-david-bowie-blackstar.jpg";
const userAgent = "NIXPPrototype/0.1 cover art restore";

const query = 'artist:"David Bowie" AND release:"Blackstar"';
const search = await fetch(
  `https://musicbrainz.org/ws/2/release/?query=${encodeURIComponent(query)}&fmt=json&limit=10`,
  { headers: { "User-Agent": userAgent, Accept: "application/json" } }
);

if (!search.ok) throw new Error(`MusicBrainz search failed: ${search.status}`);
const searchJson = await search.json();
let response = null;
let matchedRelease = null;
const releases = (searchJson.releases || []).sort((a, b) => {
  const aCd = (a.media || []).some((media) => String(media.format || "").toLowerCase().includes("cd"));
  const bCd = (b.media || []).some((media) => String(media.format || "").toLowerCase().includes("cd"));
  return Number(bCd) - Number(aCd);
});

for (const release of releases) {
  const candidate = await fetch(`https://coverartarchive.org/release/${release.id}/front`, {
    headers: { "User-Agent": userAgent }
  });
  if (candidate.ok) {
    response = candidate;
    matchedRelease = release;
    break;
  }
}

if (!response) throw new Error("Could not download Blackstar cover from any MusicBrainz release candidate");

await fs.writeFile(coverPath, Buffer.from(await response.arrayBuffer()));

const samplePath = path.join(root, "src", "data", "sampleData.js");
let sampleSource = await fs.readFile(samplePath, "utf8");
sampleSource = sampleSource.replace(
  /(\{\s*"id":\s*"nxp-2026-cd-0011",[\s\S]*?"price":\s*250000)([\s\S]*?\n\s*\})/,
  (match, body, tail) => {
    const cleanedTail = tail.replace(/,\s*\n\s*"image":\s*"[^"]+"/, "");
    return `${body},\n    "image": "${publicPath}"${cleanedTail}`;
  }
);
await fs.writeFile(samplePath, sampleSource);

const storePath = path.join(root, "public", "data", "admin-store.json");
const store = JSON.parse(await fs.readFile(storePath, "utf8"));
const product = store.products.find((item) => item.id === "nxp-2026-cd-0011");
if (product) product.image = publicPath;
await fs.writeFile(storePath, `${JSON.stringify(store, null, 2)}\n`);

console.log(`Added ${publicPath} from MusicBrainz release ${matchedRelease.id}`);
