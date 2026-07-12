import { createServer } from "node:http";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { basename, extname, join, normalize, resolve } from "node:path";

const rootArg = process.argv[2] || ".";
const root = resolve(process.cwd(), rootArg);
const port = Number(process.env.PORT || 4173);

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

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function handleApi(req, res) {
  const url = new URL(req.url || "/", `http://localhost:${port}`);

  if (url.pathname === "/api/admin/store" && req.method === "POST") {
    const payload = JSON.parse(await readBody(req));
    const dataDir = join(root, "public", "data");
    await mkdir(dataDir, { recursive: true });
    await writeFile(join(dataDir, "admin-store.json"), JSON.stringify(payload.store, null, 2) + "\n");
    json(res, 200, { ok: true, path: "/public/data/admin-store.json" });
    return true;
  }

  if (url.pathname === "/api/admin/upload" && req.method === "POST") {
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
