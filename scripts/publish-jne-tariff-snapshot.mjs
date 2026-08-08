import { readFile } from "node:fs/promises";

await loadLocalEnv();
const args = parseArgs(process.argv.slice(2));
const snapshotUrl = new URL(`../${String(args.input || "work/jne-public-tariff-snapshot.json")}`, import.meta.url);
const snapshot = JSON.parse(await readFile(snapshotUrl, "utf8"));
const baseUrl = String(args.baseUrl || "https://admin.nix-p.com").replace(/\/$/, "");
const cookie = await login();

for (const rows of chunks(snapshot.destinations, 50)) {
  await adminRequest({ action: "import-public-tariff-snapshot", versionName: snapshot.versionName, destinations: rows });
  console.log(`[publish] destinations ${rows.length}`);
}
for (const rows of chunks(snapshot.tariffs, 50)) {
  await adminRequest({ action: "import-public-tariff-snapshot", versionName: snapshot.versionName, tariffs: rows });
  console.log(`[publish] tariffs ${rows.length}`);
}
const final = await adminRequest({
  action: "import-public-tariff-snapshot",
  versionName: snapshot.versionName,
  finalize: true,
  expectedDestinationCount: snapshot.destinations.length,
  weights: snapshot.weights
});
console.log(JSON.stringify(final, null, 2));

async function login() {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspace: "admin", username: process.env.NIXP_ADMIN_USERNAME, password: process.env.NIXP_ADMIN_PASSWORD })
  });
  if (!response.ok) throw new Error(`Admin login failed (${response.status}).`);
  const setCookie = response.headers.getSetCookie?.()[0] || response.headers.get("set-cookie") || "";
  const sessionCookie = setCookie.split(";")[0];
  if (!sessionCookie) throw new Error("Admin login did not return a session cookie.");
  return sessionCookie;
}

async function adminRequest(body) {
  const response = await fetch(`${baseUrl}/api/admin/shipping`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Admin import failed (${response.status}).`);
  return payload;
}

async function loadLocalEnv() {
  const env = await readFile(new URL("../.env.local", import.meta.url), "utf8").catch(() => "");
  for (const line of env.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
  if (!process.env.NIXP_ADMIN_USERNAME || !process.env.NIXP_ADMIN_PASSWORD) throw new Error("Admin credentials are not configured locally.");
}

function chunks(rows, size) { const output = []; for (let index = 0; index < rows.length; index += size) output.push(rows.slice(index, index + size)); return output; }
function parseArgs(values) { return Object.fromEntries(values.map((value) => { const [key, ...rest] = value.replace(/^--/, "").split("="); return [key, rest.length ? rest.join("=") : true]; })); }
