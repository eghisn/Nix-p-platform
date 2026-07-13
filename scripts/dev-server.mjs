import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { basename, extname, join, normalize, resolve } from "node:path";

const rootArg = process.argv[2] || ".";
const root = resolve(process.cwd(), rootArg);
await loadLocalEnv(join(root, ".env.local"));
await loadLocalEnv(join(root, ".env"));
const port = Number(process.env.PORT || 4173);
const sessions = new Map();

const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2"
};

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const clean = normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  return resolve(join(root, clean));
}

async function sendFile(res, filePath) {
  const fileStat = await stat(filePath);
  res.writeHead(200, {
    "content-length": fileStat.size,
    "content-type": types[extname(filePath)] || "application/octet-stream",
    "cache-control": "no-store"
  });
  createReadStream(filePath).pipe(res);
}

function readBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 30_000_000) {
        req.destroy();
        rejectBody(new Error("Request body too large"));
      }
    });
    req.on("end", () => resolveBody(body));
    req.on("error", rejectBody);
  });
}

function json(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

async function loadLocalEnv(filePath) {
  if (!existsSync(filePath)) return;
  const source = await readFile(filePath, "utf8");
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

function parseCookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || "")
      .split(";")
      .map((cookie) => cookie.trim())
      .filter(Boolean)
      .map((cookie) => {
        const index = cookie.indexOf("=");
        return index === -1 ? [cookie, ""] : [cookie.slice(0, index), decodeURIComponent(cookie.slice(index + 1))];
      })
  );
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function credentialsForWorkspace(workspace) {
  if (workspace === "admin") {
    return {
      username: process.env.NIXP_ADMIN_USERNAME,
      password: process.env.NIXP_ADMIN_PASSWORD
    };
  }
  if (workspace === "finance") {
    return {
      username: process.env.NIXP_FINANCE_USERNAME,
      password: process.env.NIXP_FINANCE_PASSWORD
    };
  }
  return null;
}

function clientAddress(req) {
  const forwardedFor = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const address = forwardedFor || req.socket.remoteAddress || "";
  return address.replace(/^::ffff:/, "");
}

function allowedByAllowlist(req) {
  const allowlist = String(process.env.NIXP_AUTH_ALLOWLIST || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (!allowlist.length) return true;
  const address = clientAddress(req);
  return allowlist.includes(address) || (address === "::1" && allowlist.includes("127.0.0.1"));
}

function sessionFromRequest(req) {
  const token = parseCookies(req).nixp_session;
  if (!token) return null;
  const session = sessions.get(token);
  if (!session || session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  return session;
}

function requireWorkspace(req, workspace) {
  const session = sessionFromRequest(req);
  if (!session) return false;
  if (workspace === "admin") return session.workspace === "admin";
  if (workspace === "finance") return session.workspace === "finance";
  return false;
}

function setSessionCookie(res, token, maxAgeSeconds) {
  res.setHeader(
    "set-cookie",
    `nixp_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}`
  );
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function handleApi(req, res) {
  const url = new URL(req.url || "/", `http://localhost:${port}`);

  if (url.pathname === "/api/auth/session" && req.method === "GET") {
    const session = sessionFromRequest(req);
    json(res, 200, {
      authenticated: Boolean(session),
      workspace: session?.workspace || null,
      username: session?.username || null
    });
    return true;
  }

  if (url.pathname === "/api/auth/login" && req.method === "POST") {
    if (!allowedByAllowlist(req)) {
      json(res, 403, { ok: false, error: "This device is not allowed to access this workspace" });
      return true;
    }

    const payload = JSON.parse(await readBody(req));
    const workspace = String(payload.workspace || "").trim().toLowerCase();
    const credentials = credentialsForWorkspace(workspace);
    const configured = Boolean(credentials?.username && credentials?.password);
    const valid =
      configured &&
      safeEqual(payload.username, credentials.username) &&
      safeEqual(payload.password, credentials.password);

    if (!valid) {
      json(res, 401, { ok: false, error: configured ? "Invalid credentials" : "Workspace login is not configured" });
      return true;
    }

    const token = randomBytes(32).toString("hex");
    const maxAgeSeconds = 60 * 60 * 8;
    sessions.set(token, {
      workspace,
      username: credentials.username,
      expiresAt: Date.now() + maxAgeSeconds * 1000
    });
    setSessionCookie(res, token, maxAgeSeconds);
    json(res, 200, { ok: true, workspace, username: credentials.username });
    return true;
  }

  if (url.pathname === "/api/auth/logout" && req.method === "POST") {
    const token = parseCookies(req).nixp_session;
    if (token) sessions.delete(token);
    setSessionCookie(res, "", 0);
    json(res, 200, { ok: true });
    return true;
  }

  if (url.pathname === "/api/admin/store" && req.method === "POST") {
    if (!requireWorkspace(req, "admin")) {
      json(res, 401, { ok: false, error: "Admin login required" });
      return true;
    }
    const payload = JSON.parse(await readBody(req));
    const dataDir = join(root, "public", "data");
    await mkdir(dataDir, { recursive: true });
    await writeFile(join(dataDir, "admin-store.json"), JSON.stringify(payload.store, null, 2) + "\n");
    const publicStore = {
      ...payload.store,
      products: (payload.store.products || []).filter(
        (product) => product.publishStatus === "Published" && product.visibility !== "Hidden"
      ),
      requests: [],
      orders: [],
      cashflow: [],
      inventory: []
    };
    await writeFile(join(dataDir, "public-store.json"), JSON.stringify(publicStore, null, 2) + "\n");
    json(res, 200, { ok: true, path: "/public/data/admin-store.json" });
    return true;
  }

  if (url.pathname === "/api/admin/upload" && req.method === "POST") {
    if (!requireWorkspace(req, "admin")) {
      json(res, 401, { ok: false, error: "Admin login required" });
      return true;
    }
    const payload = JSON.parse(await readBody(req));
    const match = String(payload.dataUrl || "").match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/);
    if (!match) {
      json(res, 400, { ok: false, error: "Expected image data URL" });
      return true;
    }

    const extByMime = {
      "image/png": ".png",
      "image/jpeg": ".jpg",
      "image/jpg": ".jpg",
      "image/webp": ".webp"
    };
    const originalExt = extname(basename(payload.fileName || ""));
    const extension = extByMime[match[1]] || originalExt || ".png";
    const baseName = slugify([payload.sku, payload.title, payload.fileName].filter(Boolean).join("-")) || `upload-${Date.now()}`;
    const uploadDir = join(root, "public", "uploads", "products");
    await mkdir(uploadDir, { recursive: true });
    const fileName = `${baseName}-${Date.now()}${extension}`;
    const filePath = join(uploadDir, fileName);
    await writeFile(filePath, Buffer.from(match[2], "base64"));
    json(res, 200, { ok: true, image: `/public/uploads/products/${fileName}` });
    return true;
  }

  return false;
}

createServer(async (req, res) => {
  try {
    if ((req.url || "").startsWith("/api/") && (await handleApi(req, res))) return;

    const requested = safePath(req.url || "/");
    if (!requested.startsWith(root)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    if (existsSync(requested) && (await stat(requested)).isFile()) {
      await sendFile(res, requested);
      return;
    }

    const indexPath = join(root, "index.html");
    const html = await readFile(indexPath, "utf8");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(html);
  } catch (error) {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end(error instanceof Error ? error.message : "Server error");
  }
}).listen(port, () => {
  console.log(`NIXP local prototype running at http://localhost:${port}`);
});
