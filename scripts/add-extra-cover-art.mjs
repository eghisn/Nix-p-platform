import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const dataPath = path.join(root, "src", "data", "sampleData.js");
const coverDir = path.join(root, "public", "covers");

const covers = [
  {
    id: "nxp-2026-vnl-0005",
    url: "https://coverartarchive.org/release/6dd28914-1317-4a24-8a4f-66aea141af8c/front",
    file: "nxp-2026-vnl-0005-gilla-band-the-early-years.jpg"
  },
  {
    id: "nxp-2026-cd-0002",
    url: "https://is1-ssl.mzstatic.com/image/thumb/Music125/v4/c0/48/bf/c048bf00-8caa-8019-047a-0132772dbe08/s06.uyepfrmn.jpg/1200x1200bb.jpg",
    file: "nxp-2026-cd-0002-team-sleep-maverick.jpg"
  },
  {
    id: "nxp-2026-cd-0006",
    url: "https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/1c/49/8b/1c498b28-79e3-18de-da7e-d294181657fd/mzi.lrzeljyl.jpg/1200x1200bb.jpg",
    file: "nxp-2026-cd-0006-matrix-reloaded.jpg"
  },
  {
    id: "nxp-2026-cst-0004",
    url: "https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/1c/49/8b/1c498b28-79e3-18de-da7e-d294181657fd/mzi.lrzeljyl.jpg/1200x1200bb.jpg",
    file: "nxp-2026-cst-0004-matrix-reloaded.jpg"
  },
  {
    id: "nxp-2026-cd-0021",
    url: "https://is1-ssl.mzstatic.com/image/thumb/Music123/v4/6f/c7/67/6fc76767-ba0c-59ad-322a-381156e2cb1f/DYMC320.jpg/1200x1200bb.jpg",
    file: "nxp-2026-cd-0021-jk-flesh-gothtrad-knights-of-the-black-table.jpg"
  }
];

await fs.mkdir(coverDir, { recursive: true });

let source = await fs.readFile(dataPath, "utf8");

for (const cover of covers) {
  const res = await fetch(cover.url, {
    headers: { "User-Agent": "NIXPPrototype/0.1 extra cover art" }
  });
  if (!res.ok) {
    console.warn(`Skipping ${cover.id}: ${res.status}`);
    continue;
  }

  const bytes = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(path.join(coverDir, cover.file), bytes);

  const rowRegex = new RegExp(`(\\{\\s*"id":\\s*"${cover.id}",[\\s\\S]*?"price":\\s*\\d+)(\\s*\\n\\s*\\})`);
  source = source.replace(rowRegex, (match, body, close) => {
    const withoutImage = body.replace(/,\s*\n\s*"image":\s*"[^"]+"/, "");
    return `${withoutImage},\n    "image": "/public/covers/${cover.file}"${close}`;
  });

  console.log(`Added ${cover.id} (${bytes.length} bytes)`);
}

await fs.writeFile(dataPath, source);
