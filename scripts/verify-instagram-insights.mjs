import assert from "node:assert/strict";
import { getInstagramInsights, normalizeInstagramPost } from "../api/_lib/instagramInsights.js";

assert.deepEqual(normalizeInstagramPost({
  id: "post-1",
  caption: " A post\nabout a release ",
  media_type: "CAROUSEL_ALBUM",
  permalink: "https://www.instagram.com/p/example/",
  timestamp: "2026-09-15T12:00:00+00:00",
  like_count: "12",
  comments_count: 3
}), {
  id: "post-1",
  caption: "A post about a release",
  mediaType: "CAROUSEL_ALBUM",
  permalink: "https://www.instagram.com/p/example/",
  timestamp: "2026-09-15T12:00:00.000Z",
  likes: 12,
  comments: 3,
  reach: null,
  saves: null,
  shares: null
});
assert.equal(normalizeInstagramPost({ permalink: "https://example.com/not-instagram" }), null);

const originalAccountId = process.env.NIXP_INSTAGRAM_ACCOUNT_ID;
const originalAccessToken = process.env.NIXP_INSTAGRAM_ACCESS_TOKEN;
process.env.NIXP_INSTAGRAM_ACCOUNT_ID = "17841400000000000";
process.env.NIXP_INSTAGRAM_ACCESS_TOKEN = "test-access-token";
const requestUrls = [];
let requestHeaders = {};
const insights = await getInstagramInsights({
  now: 0,
  fromDate: "2026-09-14",
  toDate: "2026-09-15",
  fetchImpl: async (url, options) => {
    requestUrls.push(String(url));
    requestHeaders = options.headers;
    if (String(url).includes("/17841400000000000/insights")) {
      return { ok: true, json: async () => ({ data: [{ name: "profile_links_taps", values: [{ value: 3 }, { value: 8 }] }] }) };
    }
    if (String(url).includes("/insights")) {
      return { ok: true, json: async () => ({ data: [
        { name: "reach", values: [{ value: 120 }] },
        { name: "saved", values: [{ value: 4 }] },
        { name: "shares", values: [{ value: 6 }] }
      ] }) };
    }
    return { ok: true, json: async () => ({ data: [{ id: "post-1", caption: "NIXP release", media_type: "IMAGE", permalink: "https://www.instagram.com/p/example/", timestamp: "2026-09-15T00:00:00Z", like_count: 42, comments_count: 5 }] }) };
  }
});
if (originalAccountId === undefined) delete process.env.NIXP_INSTAGRAM_ACCOUNT_ID; else process.env.NIXP_INSTAGRAM_ACCOUNT_ID = originalAccountId;
if (originalAccessToken === undefined) delete process.env.NIXP_INSTAGRAM_ACCESS_TOKEN; else process.env.NIXP_INSTAGRAM_ACCESS_TOKEN = originalAccessToken;

assert.equal(insights.status, "connected");
assert.equal(insights.posts[0].likes, 42);
assert.equal(insights.posts[0].reach, 120);
assert.equal(insights.posts[0].saves, 4);
assert.equal(insights.posts[0].shares, 6);
assert.equal(insights.accountMetrics.bioLinkTaps, 11);
assert.equal(requestUrls.some((url) => url.includes("profile_links_taps")), true);
assert.equal(requestUrls.some((url) => url.includes("test-access-token")), false, "Instagram access tokens must not be put in request URLs.");
assert.equal(requestHeaders.authorization, "Bearer test-access-token");
console.log("Instagram insight normalization verified.");
