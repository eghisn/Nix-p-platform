const META_GRAPH_BASE = "https://graph.facebook.com";
const CACHE_TTL_MS = 10 * 60 * 1000;
let cachedResult = null;
let cachedUntil = 0;

export async function getInstagramInsights({ fetchImpl = fetch, now = Date.now() } = {}) {
  const accountId = String(process.env.NIXP_INSTAGRAM_ACCOUNT_ID || "").trim();
  const accessToken = String(process.env.NIXP_INSTAGRAM_ACCESS_TOKEN || "").trim();
  const version = String(process.env.META_GRAPH_API_VERSION || "v24.0").trim();
  if (!accountId || !accessToken) {
    return {
      status: "setup_required",
      message: "Connect the NIXP Instagram Business or Creator account to show post metrics automatically.",
      account: "",
      posts: []
    };
  }
  if (cachedResult && now < cachedUntil) return cachedResult;

  const endpoint = new URL(`${META_GRAPH_BASE}/${version}/${encodeURIComponent(accountId)}/media`);
  endpoint.searchParams.set("fields", "id,caption,media_type,permalink,timestamp,like_count,comments_count");
  endpoint.searchParams.set("limit", "12");

  try {
    const response = await fetchWithTimeout(fetchImpl, endpoint, accessToken, 7000);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(String(payload?.error?.message || `Meta returned HTTP ${response.status}`).slice(0, 180));
    const result = {
      status: "connected",
      message: "Latest post activity is refreshed automatically from Meta.",
      account: "NIXP Instagram",
      posts: Array.isArray(payload?.data) ? payload.data.map(normalizeInstagramPost).filter(Boolean) : []
    };
    cachedResult = result;
    cachedUntil = now + CACHE_TTL_MS;
    return result;
  } catch (error) {
    return {
      status: "unavailable",
      message: "Instagram post metrics are temporarily unavailable. Website attribution remains live.",
      account: "",
      posts: []
    };
  }
}

export function normalizeInstagramPost(value = {}) {
  const permalink = String(value.permalink || "").trim();
  if (!/^https:\/\/www\.instagram\.com\//i.test(permalink)) return null;
  const parsedTimestamp = new Date(value.timestamp || "");
  if (Number.isNaN(parsedTimestamp.getTime())) return null;
  const timestamp = parsedTimestamp.toISOString();
  return {
    id: String(value.id || "").slice(0, 100),
    caption: String(value.caption || "Untitled Instagram post").replace(/\s+/g, " ").trim().slice(0, 180),
    mediaType: String(value.media_type || "Post").trim().slice(0, 40),
    permalink,
    timestamp,
    likes: nonNegativeInteger(value.like_count),
    comments: nonNegativeInteger(value.comments_count)
  };
}

async function fetchWithTimeout(fetchImpl, url, accessToken, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { signal: controller.signal, headers: { accept: "application/json", authorization: `Bearer ${accessToken}` } });
  } finally {
    clearTimeout(timeout);
  }
}

function nonNegativeInteger(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}
