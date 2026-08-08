import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { JneOfficialClient } from "../api/_lib/jneOfficialClient.js";
import { indonesiaRegencies } from "../src/data/indonesiaRegencies.js";

const args = parseArgs(process.argv.slice(2));
const phase = String(args.phase || "all");
const weights = String(args.weights || "1,2,3,4").split(",").map(Number).filter((weight) => Number.isInteger(weight) && weight >= 1 && weight <= 20);
const delayMs = clamp(args.delay, 120, 5000, 300);
const outputUrl = new URL(`../${String(args.output || "work/jne-public-tariff-snapshot.json")}`, import.meta.url);
const client = new JneOfficialClient();
const snapshot = await loadSnapshot();
const capitalByRegion = await loadRegionalCapitals();

if (["all", "map"].includes(phase)) await collectDestinations();
if (["all", "rates"].includes(phase)) await collectRates();
console.log(JSON.stringify(summary(), null, 2));

async function collectDestinations() {
  const existing = new Map(snapshot.destinations.map((row) => [row.localRegionCode, row]));
  for (let index = 0; index < indonesiaRegencies.length; index += 1) {
    const region = indonesiaRegencies[index];
    if (existing.has(region.code) && !args.force) continue;
    const result = await findDestination(region);
    snapshot.mappingAttempts[region.code] = { city: region.city, province: region.province, ...result.report };
    if (result.candidate && result.score >= 82 && !result.tie) {
      const row = {
        localRegionCode: region.code,
        cityName: region.city,
        provinceName: region.province,
        jneDestinationCode: result.candidate.jneDestinationCode,
        destinationName: result.candidate.destinationName,
        rawSource: { ...result.candidate.raw, acquisitionQueries: result.report.queries, matchScore: result.score }
      };
      existing.set(region.code, row);
      snapshot.destinations = [...existing.values()].sort((a, b) => a.localRegionCode.localeCompare(b.localRegionCode));
    }
    snapshot.updatedAt = new Date().toISOString();
    await saveSnapshot();
    if ((index + 1) % 10 === 0) console.log(`[map] ${index + 1}/${indonesiaRegencies.length} mapped=${snapshot.destinations.length}`);
  }
}

async function collectRates() {
  if (!weights.length) throw new Error("At least one valid weight is required.");
  const existing = new Map(snapshot.tariffs.map((row) => [`${row.localRegionCode}|${row.weight}`, row]));
  const total = snapshot.destinations.length * weights.length;
  let processed = 0;
  for (const destination of snapshot.destinations) {
    for (const weight of weights) {
      processed += 1;
      const key = `${destination.localRegionCode}|${weight}`;
      if (existing.has(key) && !args.force) continue;
      try {
        const result = await client.fetchTariff("CGK10000", destination.jneDestinationCode, weight);
        if (!result.services.length) throw new Error("No services returned.");
        const row = {
          localRegionCode: destination.localRegionCode,
          destinationCode: destination.jneDestinationCode,
          weight,
          fetchedAt: result.fetchedAt,
          checksum: hash(result.raw?.html || ""),
          services: result.services
        };
        existing.set(key, row);
        delete snapshot.rateFailures[key];
        snapshot.tariffs = [...existing.values()].sort((a, b) => a.localRegionCode.localeCompare(b.localRegionCode) || a.weight - b.weight);
      } catch (error) {
        snapshot.rateFailures[key] = { error: error.message, attemptedAt: new Date().toISOString() };
      }
      snapshot.updatedAt = new Date().toISOString();
      await saveSnapshot();
      await delay(delayMs);
      if (processed % 10 === 0) console.log(`[rates] ${processed}/${total} collected=${snapshot.tariffs.length} failed=${Object.keys(snapshot.rateFailures).length}`);
    }
  }
  if (args["prune-unavailable"]) await pruneUnavailableDestinations();
}

async function pruneUnavailableDestinations() {
  const collected = new Set(snapshot.tariffs.map((row) => row.localRegionCode));
  const unavailable = snapshot.destinations.filter((destination) => (
    !collected.has(destination.localRegionCode)
    && weights.every((weight) => snapshot.rateFailures[`${destination.localRegionCode}|${weight}`])
  ));
  if (!unavailable.length) return;
  const unavailableCodes = new Set(unavailable.map((destination) => destination.localRegionCode));
  snapshot.destinations = snapshot.destinations.filter((destination) => !unavailableCodes.has(destination.localRegionCode));
  for (const code of unavailableCodes) {
    for (const weight of weights) delete snapshot.rateFailures[`${code}|${weight}`];
  }
  snapshot.unavailableDestinations = [
    ...(snapshot.unavailableDestinations || []).filter((row) => !unavailableCodes.has(row.localRegionCode)),
    ...unavailable.map((row) => ({ ...row, reason: "The official JNE checker returned no services for every collected weight.", checkedAt: new Date().toISOString() }))
  ];
  snapshot.updatedAt = new Date().toISOString();
  await saveSnapshot();
}

async function findDestination(region) {
  const base = stripRegionType(region.city);
  const capital = cleanCapital(capitalByRegion.get(normalize(region.city)) || "");
  const words = base.split(/\s+/).filter((word) => word.length >= 3);
  const capitalWords = capital.split(/\s+/).filter((word) => word.length >= 3);
  const capitalQueries = [
    capital,
    normalizeCompact(capital),
    ...capitalWords,
    ...capitalWords.map((word) => word.slice(0, Math.min(6, word.length)))
  ].filter((query) => query.length >= 3);
  const queries = [...new Set([base, ...capitalQueries, ...words.map((word) => word.slice(0, Math.min(5, word.length)))].filter((query) => query.length >= 3))];
  const candidates = new Map();
  for (const query of queries) {
    try {
      for (const candidate of await client.searchDestinations(query)) candidates.set(candidate.jneDestinationCode, candidate);
    } catch (error) {
      snapshot.sourceFailures.push({ type: "destination", regionCode: region.code, query, error: error.message, at: new Date().toISOString() });
    }
    const ranked = rank(region, [...candidates.values()], capital);
    if (ranked[0]?.score >= 90 && (!ranked[1] || ranked[1].score < ranked[0].score)) break;
    await delay(delayMs);
  }
  const ranked = rank(region, [...candidates.values()], capital);
  return {
    candidate: ranked[0]?.candidate || null,
    score: ranked[0]?.score || 0,
    tie: Boolean(ranked[1] && ranked[0].score === ranked[1].score),
    report: { queries, capital, score: ranked[0]?.score || 0, tie: Boolean(ranked[1] && ranked[0].score === ranked[1].score), top: ranked.slice(0, 5).map((row) => ({ code: row.candidate.jneDestinationCode, name: row.candidate.destinationName, score: row.score })) }
  };
}

function rank(region, candidates, capital) {
  return candidates.map((candidate) => ({ candidate, score: destinationScore(region, candidate, capital) })).filter((row) => row.score > 0).sort((a, b) => b.score - a.score || a.candidate.destinationName.localeCompare(b.candidate.destinationName));
}

function destinationScore(region, candidate, capital = "") {
  const targetWords = canonical(stripRegionType(region.city));
  const labelWords = canonical(candidate.destinationName);
  const capitalWords = canonical(capital);
  const target = normalizeCompact(targetWords);
  const label = normalizeCompact(labelWords);
  const capitalCompact = normalizeCompact(capitalWords);
  const isRegency = /^kabupaten\s/i.test(region.city);
  if (!target || !label) return 0;
  const targetTokens = targetWords.split(" ").filter((word) => word.length >= 3);
  const targetCoverage = targetTokens.length
    ? targetTokens.filter((word) => labelWords.split(" ").includes(word)).length / targetTokens.length
    : 0;
  const primaryBonus = candidate.jneDestinationCode.endsWith("0000") ? 4 : candidate.jneDestinationCode.endsWith("00") ? 3 : 0;
  if (label === target) return 1000 + primaryBonus;
  if (!isRegency && candidate.jneDestinationCode.endsWith("0000") && (labelWords === targetWords || labelWords.startsWith(`${targetWords} `))) return 995;
  if (!isRegency && labelWords === `${targetWords} ${targetWords}`) return 994 + primaryBonus;
  if (isRegency && (labelWords.startsWith(`${targetWords} kab `) || labelWords === `${targetWords} kab`)) return 990 + primaryBonus;
  if (isRegency && labelWords.includes(`kab ${targetWords}`)) return 985 + primaryBonus;
  if (isRegency && label.includes(`kab${target}`)) return 980 + primaryBonus;
  if (capitalCompact && label === capitalCompact) return (isRegency ? 975 : 970) + primaryBonus;
  if (capitalCompact && label.startsWith(capitalCompact)) {
    if (targetCoverage === 1) return 970 + primaryBonus;
    if (targetCoverage >= 0.5) return 950 + primaryBonus;
    return 900 + primaryBonus;
  }
  if (label.includes(target)) return (isRegency ? 940 : 930) + primaryBonus;
  if (targetCoverage === 1) return (isRegency ? 920 : 910) + primaryBonus;
  if (!isRegency && candidate.jneDestinationCode.endsWith("0000") && targetCoverage >= 0.5) return 900 + primaryBonus;
  return 0;
}

async function loadRegionalCapitals() {
  const title = "Daftar kabupaten dan kota di Indonesia menurut provinsi";
  const url = `https://id.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&prop=text&format=json&origin=*`;
  const response = await fetch(url, { headers: { accept: "application/json", "user-agent": "NIXP/1.0 contact@nix-p.com" } });
  if (!response.ok) throw new Error(`Regional-capital reference returned HTTP ${response.status}.`);
  const payload = await response.json();
  const html = String(payload?.parse?.text?.["*"] || "");
  const capitals = new Map();
  for (const rowMatch of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...rowMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => cleanHtml(match[1]));
    const regionName = cells[1] || "";
    const capital = cells[2] || "";
    if (/^(kabupaten|kota|kabupaten administrasi|kota administrasi)\s/i.test(regionName) && capital) capitals.set(normalize(regionName), capital);
  }
  snapshot.capitalReference = { source: url, fetchedAt: new Date().toISOString(), rows: capitals.size };
  return capitals;
}

async function loadSnapshot() {
  const existing = await readFile(outputUrl, "utf8").then(JSON.parse).catch(() => null);
  return existing || {
    versionName: `NIXP JNE ${new Date().toISOString().slice(0, 10)}`,
    originCode: "CGK10000",
    weights,
    destinations: [],
    tariffs: [],
    mappingAttempts: {},
    rateFailures: {},
    sourceFailures: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

async function saveSnapshot() {
  await mkdir(new URL("../work/", import.meta.url), { recursive: true });
  await writeFile(outputUrl, JSON.stringify(snapshot, null, 2), "utf8");
}

function summary() {
  return {
    output: outputUrl.pathname,
    destinations: snapshot.destinations.length,
    expectedDestinations: indonesiaRegencies.length,
    tariffs: snapshot.tariffs.length,
    expectedTariffs: snapshot.destinations.length * weights.length,
    unmatchedDestinations: indonesiaRegencies.length - snapshot.destinations.length,
    rateFailures: Object.keys(snapshot.rateFailures).length
  };
}

function parseArgs(values) { return Object.fromEntries(values.map((value) => { const [key, ...rest] = value.replace(/^--/, "").split("="); return [key, rest.length ? rest.join("=") : true]; })); }
function stripRegionType(value) { return normalize(value).replace(/^(kota administrasi|kabupaten administrasi|kota|kabupaten)\s+/, ""); }
function normalize(value) { return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function normalizeCompact(value) { return normalize(value).replace(/\s+/g, ""); }
function canonical(value) {
  return normalize(value)
    .replace(/\bsltn\b/g, "selatan")
    .replace(/\btmr\b/g, "timur")
    .replace(/\bbrt\b/g, "barat")
    .replace(/\butr\b/g, "utara")
    .replace(/\btgh\b/g, "tengah")
    .replace(/\bgn\b/g, "gunung")
    .replace(/\bkep\b/g, "kepulauan")
    .replace(/\bkabupaten\b/g, "kab")
    .replace(/\s+/g, " ")
    .trim();
}
function cleanCapital(value) { return normalize(value).replace(/\s*\(.*$/, "").replace(/^kota\s+/, "").replace(/^kabupaten\s+/, "").trim(); }
function cleanHtml(value) { return String(value || "").replace(/<sup[^>]*>[\s\S]*?<\/sup>/gi, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/&#39;|&apos;/gi, "'").replace(/&quot;/gi, '"').replace(/\s+/g, " ").trim(); }
function hash(value) { return createHash("sha256").update(String(value)).digest("hex"); }
function clamp(value, min, max, fallback) { const number = Number(value); return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.floor(number))) : fallback; }
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
