import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const outputDir = resolve(process.env.NIXP_BACKUP_DIR || "backups/supabase");
const key = readKey(process.env.NIXP_BACKUP_ENCRYPTION_KEY);
const baseUrl = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!baseUrl || !serviceKey) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");

const tables = [
  "products", "artists", "collections", "inventory", "cashflow", "orders", "requests", "offers",
  "order_records", "order_lines", "order_events", "payment_attempts", "notification_outbox",
  "shipping_settings", "shipping_destinations", "shipping_services", "shipping_rate_versions",
  "shipping_rates", "jne_destinations", "jne_tariff_cache", "shipping_quote_sessions",
  "shipping_sync_jobs", "shipping_source_events", "shipping_validation_runs", "system_events"
];

const snapshot = { format: "nixp-supabase-backup-v1", createdAt: new Date().toISOString(), tables: {} };
for (const table of tables) snapshot.tables[table] = await readTable(table);
const plaintext = Buffer.from(JSON.stringify(snapshot));
const iv = randomBytes(12);
const cipher = createCipheriv("aes-256-gcm", key, iv);
const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
const authTag = cipher.getAuthTag();
const digest = createHash("sha256").update(plaintext).digest("hex");
await mkdir(outputDir, { recursive: true });
const stamp = snapshot.createdAt.replace(/[:.]/g, "-");
const outputPath = join(outputDir, "nixp-supabase-" + stamp + ".json.enc");
await writeFile(outputPath, Buffer.concat([Buffer.from("NIXP1"), iv, authTag, ciphertext]));
await writeFile(join(outputDir, "nixp-supabase-" + stamp + ".manifest.json"), JSON.stringify({
  format: snapshot.format,
  createdAt: snapshot.createdAt,
  sha256: digest,
  tableCounts: Object.fromEntries(Object.entries(snapshot.tables).map(([name, rows]) => [name, rows.length]))
}, null, 2));
await pruneOldBackups();
console.log("Encrypted Supabase backup written: " + outputPath);

async function readTable(table) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const response = await fetch(baseUrl + "/rest/v1/" + table + "?select=*&limit=1000&offset=" + offset, {
      headers: { apikey: serviceKey, authorization: "Bearer " + serviceKey }
    });
    const text = await response.text();
    if (!response.ok) throw new Error("Backup read failed for " + table + ": " + response.status + " " + text.slice(0, 240));
    const page = text ? JSON.parse(text) : [];
    rows.push(...(Array.isArray(page) ? page : []));
    if (page.length < 1000) return rows;
  }
}

function readKey(value) {
  const raw = String(value || "").trim();
  if (/^[a-f0-9]{64}$/i.test(raw)) return Buffer.from(raw, "hex");
  const decoded = Buffer.from(raw, "base64");
  if (decoded.length === 32) return decoded;
  throw new Error("NIXP_BACKUP_ENCRYPTION_KEY must be a 32-byte hex or base64 secret.");
}

async function pruneOldBackups() {
  const keepDays = Math.max(7, Number(process.env.NIXP_BACKUP_RETENTION_DAYS || 90));
  const cutoff = Date.now() - keepDays * 86_400_000;
  const names = await readdir(outputDir);
  await Promise.all(names.filter((name) => name.startsWith("nixp-supabase-") && name.endsWith(".json.enc")).map(async (name) => {
    const stamp = name.slice("nixp-supabase-".length, -".json.enc".length);
    const fileDate = new Date(stamp.replace(/T(\d+)-(\d+)-(\d+)-(\d+)Z$/, "T$1:$2:$3.$4Z")).getTime();
    if (!Number.isFinite(fileDate) || fileDate >= cutoff) return;
    await rm(join(outputDir, name), { force: true });
    await rm(join(outputDir, name.replace(".json.enc", ".manifest.json")), { force: true });
  }));
}
