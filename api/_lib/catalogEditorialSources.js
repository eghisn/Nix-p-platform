import { parseHTML } from "linkedom";

const REVIEW_SOURCES = new Map([
  ["pitchfork.com", "Pitchfork"], ["thequietus.com", "The Quietus"],
  ["theguardian.com", "The Guardian"], ["thewire.co.uk", "The Wire"],
  ["allmusic.com", "AllMusic"], ["residentadvisor.net", "Resident Advisor"],
  ["ra.co", "Resident Advisor"], ["stereogum.com", "Stereogum"],
  ["tinymixtapes.com", "Tiny Mix Tapes"], ["boomkat.com", "Boomkat"],
  ["factmag.com", "FACT"], ["thelineofbestfit.com", "The Line of Best Fit"],
  ["undertheradarmag.com", "Under the Radar"], ["loudandquiet.com", "Loud and Quiet"]
]);
const OFFICIAL_SOURCES = new Map([
  ["bandcamp.com", "Bandcamp"], ["matadorrecords.com", "Matador Records"],
  ["mergerecords.com", "Merge Records"], ["atorecords.com", "ATO Records"],
  ["pias.com", "PIAS"], ["sacredbonesrecords.com", "Sacred Bones Records"],
  ["bluenote.com", "Blue Note Records"], ["warp.net", "Warp Records"],
  ["ninjatune.net", "Ninja Tune"], ["4ad.com", "4AD"],
  ["subpop.com", "Sub Pop"], ["dominomusic.com", "Domino"],
  ["thrilljockey.com", "Thrill Jockey"], ["kranky.net", "Kranky"],
  ["season-of-mist.com", "Season of Mist"]
]);

export function editorialSource(value, { official = false } = {}) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    const sources = official ? OFFICIAL_SOURCES : REVIEW_SOURCES;
    const entry = [...sources].find(([domain]) => url.hostname === domain || url.hostname.endsWith(`.${domain}`));
    return entry ? { name: entry[1], url: url.href } : null;
  } catch { return null; }
}

export function readHtmlMetadata(html, name) {
  const { document } = parseHTML(String(html || ""));
  const meta = [...document.querySelectorAll("meta")].find((node) =>
    (node.getAttribute("property") || node.getAttribute("name") || "").toLowerCase() === String(name).toLowerCase());
  return meta?.getAttribute("content")?.trim() || "";
}

const normalized = (value) => String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function editorialPageMatches(pageTitle, { artist, title } = {}) {
  const page = ` ${normalized(pageTitle)} `;
  const artistKey = normalized(artist);
  const titleKey = normalized(title).replace(/\s+(ep|lp|single|album)$/, "");
  return Boolean(artistKey && titleKey && page.includes(` ${artistKey} `) && page.includes(` ${titleKey} `));
}

// Redirects are checked before following them: an approved publisher cannot
// redirect research into a marketplace, a catalog database, or a private host.
export async function fetchEditorialPage(value, { official = false, fetcher = fetch } = {}) {
  let source = editorialSource(value, { official });
  if (!source) return null;
  const signal = AbortSignal.timeout(7000);
  try {
    for (let hop = 0; hop < 3; hop += 1) {
      const response = await fetcher(source.url, {
        redirect: "manual", signal,
        headers: { accept: "text/html", "user-agent": "NIXP-Catalog/2.0 (https://nix-p.com; contact@nix-p.com)" }
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location) return null;
        source = editorialSource(new URL(location, source.url).href, { official });
        if (!source) return null;
        continue;
      }
      if (!response.ok || response.status === 202 || !/text\/html|application\/xhtml\+xml/i.test(response.headers.get("content-type") || "")) {
        await response.body?.cancel();
        return null;
      }
      const reader = response.body?.getReader();
      if (!reader) return null;
      const chunks = [];
      let size = 0;
      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        size += chunk.byteLength;
        if (size > 3_000_000) { await reader.cancel(); return null; }
        chunks.push(chunk);
      }
      const html = Buffer.concat(chunks).toString("utf8");
      const { document } = parseHTML(html);
      const meta = (name) => [...document.querySelectorAll("meta")].find((node) =>
        (node.getAttribute("property") || node.getAttribute("name")) === name)?.getAttribute("content") || "";
      return {
        source: source.name, url: source.url,
        title: meta("og:title") || document.querySelector("title")?.textContent || "",
        description: meta("description") || meta("og:description")
      };
    }
  } catch { /* An unavailable editorial page never blocks metadata research. */ }
  return null;
}
