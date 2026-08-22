const BUCKET = "product-images";
const MAX_REMOTE_IMAGE_BYTES = 9 * 1024 * 1024;

export function isManagedProductImage(value) {
  const image = String(value || "").trim();
  return Boolean(
    image &&
      (image.startsWith("/public/") || image.startsWith("/assets/") || /supabase\.co\/storage\/v1\/object\/public\//i.test(image))
  );
}

// Keeps third-party cover URLs out of the live product record. Failed archival
// deliberately returns the source URL so enrichment can still be reviewed in
// Admin rather than losing a valid release match.
export async function archiveRemoteProductImage({ url, sku, role = "cover" } = {}) {
  const source = String(url || "").trim();
  if (!source || isManagedProductImage(source) || !/^https?:\/\//i.test(source)) {
    return { url: source, archived: isManagedProductImage(source) };
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { url: source, archived: false };
  }

  let isDiscogs = false;
  try {
    const hostname = new URL(source).hostname;
    isDiscogs = /(?:^|\.)discogs\.com$/i.test(hostname) || /(?:^|\.)i\.discogs\.com$/i.test(hostname);
  } catch {
    return { url: source, archived: false };
  }
  const downloadHeaders = {
    accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    "user-agent": "NIXP-Catalog/2.0 (https://nix-p.com; contact@nix-p.com)",
    ...(isDiscogs ? { referer: "https://www.discogs.com/" } : {})
  };
  const baseUrl = process.env.SUPABASE_URL.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const safeSku = String(sku || "catalog-item").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "catalog-item";

  // Remote artwork hosts occasionally return a transient 403/5xx from a
  // serverless region. Retry the download and upload once, but never return a
  // remote URL as if it were a managed NIXP asset.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const downloaded = await fetch(source, {
        redirect: "follow",
        headers: downloadHeaders,
        signal: AbortSignal.timeout(12000)
      });
      const contentType = String(downloaded.headers.get("content-type") || "").split(";")[0].toLowerCase();
      const contentLength = Number(downloaded.headers.get("content-length") || 0);
      if (!downloaded.ok || !contentType.startsWith("image/") || (contentLength && contentLength > MAX_REMOTE_IMAGE_BYTES)) {
        if (attempt === 0) continue;
        return { url: source, archived: false };
      }
      const buffer = Buffer.from(await downloaded.arrayBuffer());
      if (!buffer.length || buffer.length > MAX_REMOTE_IMAGE_BYTES) {
        if (attempt === 0) continue;
        return { url: source, archived: false };
      }

      const extension = extensionFor(contentType, downloaded.url || source);
      const objectPath = `catalog/${safeSku}/${role}${extension}`;
      const uploaded = await fetch(`${baseUrl}/storage/v1/object/${BUCKET}/${objectPath}`, {
        method: "POST",
        headers: {
          apikey: key,
          authorization: `Bearer ${key}`,
          "content-type": contentType,
          "x-upsert": "true"
        },
        body: buffer,
        signal: AbortSignal.timeout(12000)
      });
      if (uploaded.ok) {
        return {
          url: `${baseUrl}/storage/v1/object/public/${BUCKET}/${objectPath}`,
          archived: true
        };
      }
    } catch {
      // The second attempt below is the final retry. The caller will keep the
      // item Draft if the image cannot be archived.
    }
  }
  return { url: source, archived: false };
}

function extensionFor(contentType, url) {
  if (contentType.includes("png")) return ".png";
  if (contentType.includes("webp")) return ".webp";
  if (contentType.includes("avif")) return ".avif";
  if (contentType.includes("gif")) return ".gif";
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return ".jpg";
  const match = String(url).match(/\.(jpe?g|png|webp|avif|gif)(?:$|[?#])/i);
  return match ? `.${match[1].toLowerCase().replace("jpeg", "jpg")}` : ".jpg";
}
