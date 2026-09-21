const META_GRAPH_BASE = "https://graph.facebook.com";
const INSTAGRAM_GRAPH_BASE = "https://graph.instagram.com";
const CACHE_TTL_MS = 10 * 60 * 1000;
let cachedResult = null;
let cachedUntil = 0;
let cachedRange = "";

export async function getInstagramInsights({ fetchImpl = fetch, now = Date.now(), fromDate = "", toDate = "" } = {}) {
  const accountId = String(process.env.NIXP_INSTAGRAM_ACCOUNT_ID || "").trim();
  const accessToken = String(process.env.NIXP_INSTAGRAM_ACCESS_TOKEN || "").trim();
  const version = String(process.env.META_GRAPH_API_VERSION || "v24.0").trim();
  const graphBase = instagramGraphBase();
  if (!accountId || !accessToken) {
    return {
      status: "setup_required",
      message: "Connect the NIXP Instagram Business or Creator account to show post metrics automatically.",
      account: "",
      posts: [],
      accountMetrics: { bioLinkTaps: null }
    };
  }
  const range = `${fromDate}:${toDate}`;
  if (cachedResult && cachedRange === range && now < cachedUntil) return cachedResult;

  const endpoint = new URL(`${graphBase}/${version}/${encodeURIComponent(accountId)}/media`);
  endpoint.searchParams.set("fields", "id,caption,media_type,permalink,timestamp,like_count,comments_count");
  endpoint.searchParams.set("limit", "12");

  try {
    const response = await fetchWithTimeout(fetchImpl, endpoint, accessToken, 7000);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(String(payload?.error?.message || `Meta returned HTTP ${response.status}`).slice(0, 180));
    const posts = Array.isArray(payload?.data) ? payload.data.map(normalizeInstagramPost).filter(Boolean) : [];
    const [postInsights, accountMetrics] = await Promise.all([
      Promise.all(posts.map((post) => loadPostInsights({ fetchImpl, graphBase, version, accessToken, post }))),
      loadAccountInsights({ fetchImpl, graphBase, version, accessToken, accountId, fromDate, toDate })
    ]);
    const result = {
      status: "connected",
      message: "Latest post activity is refreshed automatically from Meta. Bio link taps are refreshed at account level for the selected period; per-post bio link taps remain a manual actual.",
      account: "NIXP Instagram",
      posts: postInsights,
      accountMetrics
    };
    cachedResult = result;
    cachedUntil = now + CACHE_TTL_MS;
    cachedRange = range;
    return result;
  } catch (error) {
    return {
      status: "unavailable",
      message: "Instagram post metrics are temporarily unavailable. Website attribution remains live.",
      account: "",
      posts: [],
      accountMetrics: { bioLinkTaps: null }
    };
  }
}

async function loadAccountInsights({ fetchImpl, graphBase, version, accessToken, accountId, fromDate, toDate }) {
  const endpoint = new URL(`${graphBase}/${version}/${encodeURIComponent(accountId)}/insights`);
  endpoint.searchParams.set("metric", "profile_links_taps");
  endpoint.searchParams.set("period", "day");
  endpoint.searchParams.set("metric_type", "total_value");
  const from = insightTimestamp(fromDate);
  const until = insightTimestamp(toDate, true);
  if (from !== null && until !== null) {
    endpoint.searchParams.set("since", String(from));
    endpoint.searchParams.set("until", String(until));
  }
  try {
    const response = await fetchWithTimeout(fetchImpl, endpoint, accessToken, 7000);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return { bioLinkTaps: null };
    const metric = (Array.isArray(payload?.data) ? payload.data : []).find((item) => String(item?.name || "") === "profile_links_taps");
    return { bioLinkTaps: insightTotal(metric) };
  } catch {
    return { bioLinkTaps: null };
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
    comments: nonNegativeInteger(value.comments_count),
    reach: null,
    saves: null,
    shares: null
  };
}

async function loadPostInsights({ fetchImpl, graphBase, version, accessToken, post }) {
  const endpoint = new URL(`${graphBase}/${version}/${encodeURIComponent(post.id)}/insights`);
  endpoint.searchParams.set("metric", "reach,saved,shares");
  try {
    const response = await fetchWithTimeout(fetchImpl, endpoint, accessToken, 7000);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return post;
    const metrics = new Map((Array.isArray(payload?.data) ? payload.data : []).map((metric) => [String(metric?.name || ""), insightValue(metric)]));
    return {
      ...post,
      reach: metrics.get("reach") ?? null,
      saves: metrics.get("saved") ?? null,
      shares: metrics.get("shares") ?? null
    };
  } catch {
    return post;
  }
}

function insightValue(metric) {
  const value = metric?.total_value?.value ?? metric?.values?.[0]?.value;
  return nonNegativeIntegerOrNull(value);
}

function insightTotal(metric) {
  const values = Array.isArray(metric?.values) ? metric.values.map((item) => nonNegativeIntegerOrNull(item?.value)).filter((value) => value !== null) : [];
  if (values.length) return values.reduce((sum, value) => sum + value, 0);
  return nonNegativeIntegerOrNull(metric?.total_value?.value);
}

function insightTimestamp(value, endExclusive = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return null;
  const date = new Date(`${value}T00:00:00+07:00`);
  if (Number.isNaN(date.getTime())) return null;
  if (endExclusive) date.setUTCDate(date.getUTCDate() + 1);
  return Math.floor(date.getTime() / 1000);
}

function instagramGraphBase() {
  const configured = String(process.env.NIXP_INSTAGRAM_GRAPH_BASE || "").trim().replace(/\/+$/, "");
  return configured === INSTAGRAM_GRAPH_BASE ? INSTAGRAM_GRAPH_BASE : META_GRAPH_BASE;
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

function nonNegativeIntegerOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  return nonNegativeInteger(value);
}
