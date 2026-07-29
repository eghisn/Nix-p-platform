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

  try {
    const downloaded = await fetch(source, {
      redirect: "follow",
      headers: { accept: "image/*", "user-agent": "NIXP-Catalog/1.0 (contact@nix-p.com)" }
    });
    const contentType = String(downloaded.headers.get("content-type") || "").split(";")[0].toLowerCase();
    const contentLength = Number(downloaded.headers.get("content-length") || 0);
    if (!downloaded.ok || !contentType.startsWith("image/") || (contentLength && contentLength > MAX_REMOTE_IMAGE_BYTES)) {
      return { url: source, archived: false };
    }
    const buffer = Buffer.from(await downloaded.arrayBuffer());
    if (!buffer.length || buffer.length > MAX_REMOTE_IMAGE_BYTES) return { url: source, archived: false };

    const extension = extensionFor(contentType, downloaded.url || source);
    const safeSku = String(sku || "catalog-item").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "catalog-item";
    const objectPath = `catalog/${safeSku}/${role}${extension}`;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const uploaded = await fetch(`${process.env.SUPABASE_URL.replace(/\/$/, "")}/storage/v1/object/${BUCKET}/${objectPath}`, {
      method: "POST",
      headers: {
        apikey: key,
        authorization: `Bearer ${key}`,
        "content-type": contentType,
        "x-upsert": "true"
      },
      body: buffer
    });
    if (!uploaded.ok) return { url: source, archived: false };
    return {
      url: `${process.env.SUPABASE_URL.replace(/\/$/, "")}/storage/v1/object/public/${BUCKET}/${objectPath}`,
      archived: true
    };
  } catch {
    return { url: source, archived: false };
  }
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
