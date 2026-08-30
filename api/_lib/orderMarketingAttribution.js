import { normalizeMarketingAttribution } from "./marketingAttribution.js";
import { supabaseFetch } from "./supabase.js";

// Attribution never participates in order pricing, stock, payment, or status.
// A failure here is recorded separately and must not block a customer order.
export async function attachOrderMarketingAttribution(orderId, value) {
  const attribution = normalizeMarketingAttribution(value);
  if (!attribution.sessionId) return { captured: false, reason: "no-consented-session" };
  const result = await supabaseFetch("rpc/attach_order_marketing_attribution", {
    method: "POST",
    service: true,
    body: {
      p_order_id: String(orderId || "").trim(),
      p_attribution: {
        version: 1,
        anonymousSessionId: attribution.sessionId,
        source: attribution.source,
        medium: attribution.medium,
        campaign: attribution.campaign,
        term: attribution.term,
        content: attribution.content
      }
    }
  });
  return result || { captured: false };
}
