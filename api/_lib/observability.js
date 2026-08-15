import { createHash } from "node:crypto";
import { isSupabaseConfigured, supabaseFetch } from "./supabase.js";

export async function recordSystemEvent({ level = "error", source = "api", req, error, details = {} } = {}) {
  const message = String(error instanceof Error ? error.message : error || "Unknown server error").slice(0, 500);
  const route = String(req?.url || "").split("?")[0].slice(0, 240) || null;
  const fingerprint = createHash("sha256").update(String(source) + "|" + (route || "") + "|" + message).digest("hex").slice(0, 32);
  const event = {
    level,
    source: String(source).slice(0, 80),
    route,
    message,
    fingerprint,
    details,
    requestId: String(req?.headers?.["x-vercel-id"] || "") || null
  };
  console.error(JSON.stringify(event));
  if (!isSupabaseConfigured({ requireServiceRole: true })) {
    return { recorded: false, reason: "supabase-not-configured" };
  }
  try {
    await supabaseFetch("system_events", {
      method: "POST",
      service: true,
      prefer: "return=minimal",
      body: [{ level, source: event.source, route, message, fingerprint, details }]
    });
    return { recorded: true };
  } catch (recordError) {
    console.error("[" + source + "] " + message, { route, ...details, observabilityError: recordError instanceof Error ? recordError.message : String(recordError) });
    return { recorded: false, reason: "recording-failed" };
  }
}
