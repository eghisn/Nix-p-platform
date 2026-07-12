import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const dataPath = path.join(root, "src", "data", "sampleData.js");
const coverDir = path.join(root, "public", "covers");
const reportPath = path.join(root, "work", "cover-art-report.json");

const userAgent = "NIXPPrototype/0.1 (local prototype cover matching)";
const ambiguousTitles = new Set(["Untitled Selection"]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function slug(value) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 90);
}

function similarity(a, b) {
  const clean = (value) =>
    value
      .toLowerCase()
      .replace(/&/g, "and")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const left = new Set(clean(a).split(/\s+/).filter(Boolean));
  const right = new Set(clean(b).split(/\s+/).filter(Boolean));
  if (!left.size || !right.size) return 0;
  let hit = 0;
  for (const token of left) {
    if (right.has(token)) hit += 1;
  }
  return hit / Math.max(left.size, right.size);
}

function extractRecordRows(source) {
  const start = source.indexOf("const recordRows = [");
  const end = source.indexOf("];", start);
  if (start === -1 || end === -1) {
    throw new Error("Could not find recordRows in sampleData.js");
  }

  const block = source.slice(start, end);
  const objectPattern = /\{\s*"id":\s*"([^"]+)",\s*"sku":\s*"([^"]+)",\s*"artist":\s*"([^"]+)",\s*"title":\s*"([^"]+)",\s*"format":\s*"([^"]+)",/g;
  return [...block.matchAll(objectPattern)].map((match) => ({
    id: match[1],
    sku: match[2],
    artist: match[3],
    title: match[4],
    format: match[5]
  }));
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": userAgent,
      Accept: "application/json"
    }
  });
  if (!res.ok) return null;
  return res.json();
}

async function searchMusicBrainz(row) {
  const query = `artist:"${row.artist}" AND release:"${row.title}"`;
  const url = `https://musicbrainz.org/ws/2/release/?query=${encodeURIComponent(query)}&fmt=json&limit=8`;
  const json = await fetchJson(url);
  await sleep(1100);
  if (!json?.releases?.length) return null;

  const formatNeedle = row.format.toLowerCase();
  const candidates = json.releases
    .map((release) => {
      const titleScore = similarity(row.title, release.title || "");
      const artistCredit = (release["artist-credit"] || []).map((entry) => entry.name).join(" ");
      const artistScore = similarity(row.artist, artistCredit);
      const mediaFormats = (release.media || []).map((media) => (media.format || "").toLowerCase());
      const formatScore = mediaFormats.some((format) => format.includes(formatNeedle)) ? 0.2 : 0;
      return { release, score: titleScore * 0.55 + artistScore * 0.35 + formatScore };
    })
    .filter(({ score }) => score >= 0.58)
    .sort((a, b) => b.score - a.score);

  for (const { release, score } of candidates) {
    const frontUrl = `https://coverartarchive.org/release/${release.id}/front`;
    const head = await fetch(frontUrl, {
      method: "HEAD",
      headers: { "User-Agent": userAgent }
    });
    await sleep(250);
    if (head.ok) {
      return {
        url: frontUrl,
        source: "Cover Art Archive",
        sourceUrl: `https://musicbrainz.org/release/${release.id}`,
        matchedTitle: release.title,
        score
      };
    }
  }

  return null;
}

async function searchItunes(row) {
  const term = `${row.artist} ${row.title}`;
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=album&media=music&limit=10`;
  const json = await fetchJson(url);
  if (!json?.results?.length) return null;

  const best = json.results
    .map((album) => {
      const titleScore = similarity(row.title, album.collectionName || "");
      const artistScore = similarity(row.artist, album.artistName || "");
      return { album, score: titleScore * 0.62 + artistScore * 0.38 };
    })
    .filter(({ score }) => score >= 0.7)
    .sort((a, b) => b.score - a.score)[0];

  if (!best) return null;

  return {
    url: best.album.artworkUrl100.replace(/100x100bb\.(jpg|png)$/, "1200x1200bb.$1"),
    source: "Apple iTunes Search API",
    sourceUrl: best.album.collectionViewUrl,
    matchedTitle: best.album.collectionName,
    score: best.score
  };
}

async function downloadCover(row, match) {
  const ext = match.url.includes(".png") ? "png" : "jpg";
  const filename = `${row.id}-${slug(row.artist)}-${slug(row.title)}.${ext}`;
  const filePath = path.join(coverDir, filename);
  const publicPath = `/public/covers/${filename}`;

  const res = await fetch(match.url, {
    headers: { "User-Agent": userAgent }
  });
  if (!res.ok) {
    throw new Error(`Could not download ${match.url}: ${res.status}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(filePath, buffer);
  return { filePath, publicPath, bytes: buffer.length };
}

function applyImages(source, updates) {
  let next = source;
  for (const update of updates) {
    const rowRegex = new RegExp(`(\\{\\s*"id":\\s*"${update.id}",[\\s\\S]*?"price":\\s*\\d+)(\\s*\\n\\s*\\})`);
    next = next.replace(rowRegex, (match, body, close) => {
      const withoutImage = body.replace(/,\s*\n\s*"image":\s*"[^"]+"/, "");
      return `${withoutImage},\n    "image": "${update.publicPath}"${close}`;
    });
  }
  return next.replace(
    "function record(row) {\n  const displayFormat = row.format === \"Vinyl\" ? \"Vinyl 12\\\"\" : row.format;",
    "function record(row) {\n  const displayFormat = row.format === \"Vinyl\" ? \"Vinyl 12\\\"\" : row.format;"
  ).replace(
    /function record\(row\) \{([\s\S]*?)image: recordImage,/,
    "function record(row) {$1image: row.image || recordImage,"
  );
}

await fs.mkdir(coverDir, { recursive: true });
await fs.mkdir(path.dirname(reportPath), { recursive: true });

const source = await fs.readFile(dataPath, "utf8");
const rows = extractRecordRows(source);
const report = [];
const updates = [];

for (const row of rows) {
  if (ambiguousTitles.has(row.title)) {
    report.push({ ...row, status: "skipped", reason: "Ambiguous title in source data" });
    continue;
  }

  try {
    let match = await searchMusicBrainz(row);
    if (!match) match = await searchItunes(row);

    if (!match) {
      report.push({ ...row, status: "not-found" });
      continue;
    }

    const download = await downloadCover(row, match);
    updates.push({ ...row, ...download });
    report.push({ ...row, status: "matched", ...match, publicPath: download.publicPath, bytes: download.bytes });
    console.log(`matched ${row.sku} ${row.artist} - ${row.title}`);
  } catch (error) {
    report.push({ ...row, status: "error", error: error.message });
    console.warn(`error ${row.sku}: ${error.message}`);
  }
}

const nextSource = applyImages(source, updates);
await fs.writeFile(dataPath, nextSource);
await fs.writeFile(reportPath, JSON.stringify(report, null, 2));

const matched = report.filter((item) => item.status === "matched").length;
const skipped = report.filter((item) => item.status === "skipped").length;
const notFound = report.filter((item) => item.status === "not-found").length;
const errors = report.filter((item) => item.status === "error").length;
console.log(`Cover art complete: ${matched} matched, ${skipped} skipped, ${notFound} not found, ${errors} errors.`);
