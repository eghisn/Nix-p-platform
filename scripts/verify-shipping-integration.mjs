import { readFile } from "node:fs/promises";
import { calculateRuleShippingQuote, getShippingSettings } from "../api/_lib/shippingQuotes.js";

const env = await readFile(new URL("../.env.local", import.meta.url), "utf8").catch(() => "");
for (const line of env.split(/\r?\n/)) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (!match || process.env[match[1]]) continue;
  process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
}

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.log("Shipping integration check skipped: local Supabase service credentials are not present.");
  process.exit(0);
}

const settings = await getShippingSettings();
if (settings.volumetricDivisor !== 6000) throw new Error("Unexpected shipping divisor.");
const quote = await calculateRuleShippingQuote({
  items: [{ id: "nxp-2026-vnl-0001", quantity: 1 }],
  destinationCode: "32.73"
});
if (quote.packaging.packages.length !== 1 || quote.packaging.packages[0].packagingGroup !== "VINYL") {
  throw new Error("Live shipping package integration failed.");
}
console.log(`Shipping integration verified: ${quote.packaging.packages.length} package, ${quote.options.length} configured rate option(s).`);
