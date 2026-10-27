import { parseHTML } from "linkedom";
import { editorialSource } from "./catalogEditorialSources.js";

const USER_AGENT = "NIXP-Catalog/2.0 (https://nix-p.com; contact@nix-p.com)";

export function researchResultUrls(html, base, kind) {
  const { document } = parseHTML(String(html || ""));
  const urls = new Set();
  for (const anchor of document.querySelectorAll("a[href]")) {
    try {
      let url = new URL(anchor.getAttribute("href"), base);
      if (url.hostname === "duckduckgo.com" || url.hostname.endsWith(".duckduckgo.com")) {
        url = new URL(url.searchParams.get("uddg") || "");
      }
      url.hash = "";
      if (kind === "bandcamp") {
        if (!editorialSource(url.href, { official: true }) || !url.hostname.endsWith(".bandcamp.com") || !/^\/album\/[^/]+\/?$/.test(url.pathname)) continue;
        url.search = "";
      } else if (!editorialSource(url.href)) continue;
      urls.add(url.href);
    } catch { /* Ignore navigation and malformed result links. */ }
  }
  return [...urls];
}

// Search endpoints are discovery only. Every result still goes through source,
// artist, release and physical-edition checks before it can populate a product.
export async function searchCatalogSources({ artist, title, kind = "review", fetcher = fetch }) {
  const phrase = `"${artist}" "${title}"`;
  const endpoints = kind === "bandcamp"
    ? [
        ["Bandcamp search", `https://bandcamp.com/search?q=${encodeURIComponent(`${artist} ${title}`)}&item_type=a`],
        ["DuckDuckGo", `https://html.duckduckgo.com/html/?q=${encodeURIComponent(`site:bandcamp.com/album ${phrase}`)}`],
        ["Brave", `https://search.brave.com/search?q=${encodeURIComponent(`site:bandcamp.com/album ${phrase}`)}&source=web`]
      ]
    : [
        ["DuckDuckGo", `https://html.duckduckgo.com/html/?q=${encodeURIComponent(`${phrase} review`)}`],
        ["Brave", `https://search.brave.com/search?q=${encodeURIComponent(`${phrase} review`)}&source=web`]
      ];
  const results = await Promise.all(endpoints.map(async ([source, url]) => {
    try {
      const response = await fetcher(url, { redirect: "error", signal: AbortSignal.timeout(5000), headers: { accept: "text/html", "user-agent": USER_AGENT } });
      if (!response.ok || response.status === 202) {
        await response.body?.cancel();
        return { attempt: { source, status: "unavailable", httpStatus: response.status }, urls: [] };
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error("empty response");
      const chunks = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 2_000_000) { await reader.cancel(); throw new Error("oversized response"); }
        chunks.push(value);
      }
      const html = Buffer.concat(chunks).toString("utf8");
      if (/anomaly\.js|anomaly-modal|captcha-container|verify you are human|<title>Client Challenge<\/title>|_fs-ch-/i.test(html)) {
        return { attempt: { source, status: "unavailable", reason: "challenge" }, urls: [] };
      }
      const urls = researchResultUrls(html, url, kind);
      return { attempt: { source, status: urls.length ? "found" : "no-results" }, urls: urls.slice(0, 4) };
    } catch {
      return { attempt: { source, status: "unavailable", reason: "request-failed" }, urls: [] };
    }
  }));
  const attempts = results.map((result) => result.attempt);
  const urls = [...new Set(results.flatMap((result) => result.urls))].slice(0, 12);
  return { urls, attempts, unavailable: !urls.length && attempts.every((attempt) => attempt.status === "unavailable") };
}
