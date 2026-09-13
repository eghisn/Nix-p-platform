const SITE_ORIGIN = "https://www.nix-p.com";
const EMAIL_FONT = "'Founders Grotesk Web','Helvetica Neue',Arial,sans-serif";

export function renderDeliveryQuote(order = {}, { statusUrl = "", catalogImages = new Map() } = {}) {
  const lines = quoteLines(order, catalogImages);
  const merchandise = amount(order.merchandise_total ?? order.merchandiseTotal ?? lines.reduce((total, line) => total + line.lineTotal, 0));
  const shipping = amount(order.shipping_total ?? order.shippingTotal);
  const total = amount(order.grand_total ?? order.total ?? merchandise + shipping);
  const reference = clean(order.public_reference || order.publicReference || order.id) || "NIXP order";
  const customer = order.customer && typeof order.customer === "object" ? order.customer : {};
  const courier = [clean(order.courier), clean(order.shipping_method || order.shippingMethod)].filter(Boolean).join(" / ") || "Delivery";
  const expiresAt = formatDate(order.payment_expires_at || order.paymentExpiresAt);
  const payUrl = clean(statusUrl);

  return {
    text: quoteText({ reference, customer, courier, expiresAt, merchandise, shipping, total, lines, payUrl }),
    html: quoteHtml({ reference, customer, courier, expiresAt, merchandise, shipping, total, lines, payUrl })
  };
}

function quoteHtml({ reference, customer, courier, expiresAt, merchandise, shipping, total, lines, payUrl }) {
  const itemRows = lines.map((line) => `
    <tr>
      <td style="padding:16px 0;border-top:1px solid #d2d2d2;vertical-align:top;width:92px;">
        ${line.image ? `<img src="${escapeHtml(line.image)}" width="76" height="76" alt="${escapeHtml(line.artist ? `${line.artist} - ${line.title}` : line.title)}" style="display:block;width:76px;height:76px;object-fit:cover;background:#d9d9d9;" />` : `<div style="width:76px;height:76px;background:#292929;color:#f1f1f1;font-family:${EMAIL_FONT};font-size:11px;font-weight:700;line-height:76px;text-align:center;letter-spacing:0;">NIXP</div>`}
      </td>
      <td style="padding:16px 14px;border-top:1px solid #d2d2d2;vertical-align:top;font-family:${EMAIL_FONT};color:#292929;">
        <div style="font-size:10px;font-weight:700;line-height:14px;text-transform:uppercase;letter-spacing:0;color:#747474;">${escapeHtml(line.artist || "NIXP")}</div>
        <div style="margin-top:3px;font-size:17px;font-weight:700;line-height:20px;letter-spacing:0;">${escapeHtml(line.title)}</div>
        <div style="margin-top:7px;font-size:12px;line-height:16px;color:#555555;">${escapeHtml(line.meta)}</div>
      </td>
      <td style="padding:16px 0;border-top:1px solid #d2d2d2;vertical-align:top;text-align:right;font-family:${EMAIL_FONT};color:#292929;font-size:14px;font-weight:700;line-height:20px;white-space:nowrap;">${escapeHtml(rupiah(line.lineTotal))}</td>
    </tr>`).join("");
  const payBlock = payUrl ? `
    <tr><td style="padding:0 24px 30px;background:#f1f1f1;">
      <a href="${escapeHtml(payUrl)}" style="display:block;padding:15px 18px;background:#292929;color:#f1f1f1;font-family:${EMAIL_FONT};font-size:13px;font-weight:700;line-height:18px;text-align:center;text-decoration:none;text-transform:uppercase;letter-spacing:0;">Review quote and pay securely</a>
    </td></tr>` : "";
  const expiryCopy = expiresAt ? `Your stock reservation is held until ${escapeHtml(expiresAt)}.` : "Your stock is reserved while this quote is active.";

  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>@font-face{font-family:'Founders Grotesk Web';src:url('${SITE_ORIGIN}/public/fonts/FoundersGroteskWeb-Regular.woff2') format('woff2');font-weight:400;font-style:normal;font-display:swap;}@font-face{font-family:'Founders Grotesk Web';src:url('${SITE_ORIGIN}/public/fonts/FoundersGroteskWeb-Semibold.woff2') format('woff2');font-weight:600 800;font-style:normal;font-display:swap;}</style></head>
  <body style="margin:0;padding:0;background:#f1f1f1;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f1f1f1;">
      <tr><td align="center" style="padding:28px 12px;">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background:#f1f1f1;">
          <tr><td style="padding:22px 24px;background:#292929;color:#f1f1f1;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
              <td style="font-family:${EMAIL_FONT};font-size:24px;font-weight:700;line-height:24px;letter-spacing:0;">NIXP</td>
              <td align="right" style="font-family:${EMAIL_FONT};font-size:10px;font-weight:700;line-height:14px;text-transform:uppercase;letter-spacing:0;">Delivery quote</td>
            </tr></table>
          </td></tr>
          <tr><td style="padding:32px 24px 24px;background:#f1f1f1;">
            <div style="font-family:${EMAIL_FONT};font-size:10px;font-weight:700;line-height:14px;text-transform:uppercase;letter-spacing:0;color:#747474;">Ready for payment</div>
            <div style="margin-top:8px;font-family:${EMAIL_FONT};font-size:32px;font-weight:700;line-height:34px;letter-spacing:0;color:#292929;">Your delivery quote is ready.</div>
            <div style="margin-top:12px;font-family:${EMAIL_FONT};font-size:15px;line-height:22px;color:#292929;">Hi ${escapeHtml(clean(customer.name) || "there")}, we have confirmed the delivery cost for your order. Review the total below before payment.</div>
          </td></tr>
          <tr><td style="padding:0 24px 28px;background:#f1f1f1;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-top:1px solid #292929;border-bottom:1px solid #292929;">
              <tr><td style="padding:12px 0;font-family:${EMAIL_FONT};font-size:10px;font-weight:700;line-height:14px;text-transform:uppercase;letter-spacing:0;color:#747474;">Order</td><td style="padding:12px 0;text-align:right;font-family:${EMAIL_FONT};font-size:13px;font-weight:700;line-height:18px;color:#292929;">${escapeHtml(reference)}</td></tr>
              <tr><td style="padding:0 0 12px;font-family:${EMAIL_FONT};font-size:10px;font-weight:700;line-height:14px;text-transform:uppercase;letter-spacing:0;color:#747474;">Courier</td><td style="padding:0 0 12px;text-align:right;font-family:${EMAIL_FONT};font-size:13px;line-height:18px;color:#292929;">${escapeHtml(courier)}</td></tr>
              ${expiresAt ? `<tr><td style="padding:0 0 12px;font-family:${EMAIL_FONT};font-size:10px;font-weight:700;line-height:14px;text-transform:uppercase;letter-spacing:0;color:#747474;">Reservation</td><td style="padding:0 0 12px;text-align:right;font-family:${EMAIL_FONT};font-size:13px;line-height:18px;color:#292929;">Until ${escapeHtml(expiresAt)}</td></tr>` : ""}
            </table>
          </td></tr>
          <tr><td style="padding:0 24px 8px;background:#f1f1f1;font-family:${EMAIL_FONT};font-size:10px;font-weight:700;line-height:14px;text-transform:uppercase;letter-spacing:0;color:#747474;">Order summary</td></tr>
          <tr><td style="padding:0 24px 20px;background:#f1f1f1;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${itemRows}</table></td></tr>
          <tr><td style="padding:0 24px 18px;background:#f1f1f1;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-top:1px solid #292929;">
              <tr><td style="padding:12px 0 6px;font-family:${EMAIL_FONT};font-size:13px;line-height:18px;color:#555555;">Items</td><td style="padding:12px 0 6px;text-align:right;font-family:${EMAIL_FONT};font-size:13px;line-height:18px;color:#292929;">${escapeHtml(rupiah(merchandise))}</td></tr>
              <tr><td style="padding:6px 0;font-family:${EMAIL_FONT};font-size:13px;line-height:18px;color:#555555;">Delivery</td><td style="padding:6px 0;text-align:right;font-family:${EMAIL_FONT};font-size:13px;line-height:18px;color:#292929;">${escapeHtml(rupiah(shipping))}</td></tr>
              <tr><td style="padding:14px 0 0;border-top:1px solid #292929;font-family:${EMAIL_FONT};font-size:20px;font-weight:700;line-height:24px;color:#292929;">Total at payment</td><td style="padding:14px 0 0;border-top:1px solid #292929;text-align:right;font-family:${EMAIL_FONT};font-size:20px;font-weight:700;line-height:24px;color:#292929;white-space:nowrap;">${escapeHtml(rupiah(total))}</td></tr>
            </table>
          </td></tr>
          <tr><td style="padding:0 24px 30px;background:#f1f1f1;font-family:${EMAIL_FONT};font-size:12px;line-height:18px;color:#555555;">${expiryCopy} Payment is processed securely by Midtrans.</td></tr>
          ${payBlock}
          <tr><td style="padding:20px 24px;background:#292929;font-family:${EMAIL_FONT};font-size:11px;line-height:17px;color:#f1f1f1;">This is a delivery quote, not a payment receipt. Your order is confirmed only after payment is verified.</td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

function quoteText({ reference, customer, courier, expiresAt, merchandise, shipping, total, lines, payUrl }) {
  return [
    "NIXP delivery quote",
    `Order: ${reference}`,
    `Courier: ${courier}`,
    expiresAt ? `Reservation: until ${expiresAt}` : "",
    "",
    "Items",
    ...lines.map((line) => `- ${line.quantity} x ${[line.artist, line.title].filter(Boolean).join(" - ")} / ${rupiah(line.lineTotal)}`),
    "",
    `Items: ${rupiah(merchandise)}`,
    `Delivery: ${rupiah(shipping)}`,
    `Total at payment: ${rupiah(total)}`,
    "",
    "This is a delivery quote, not a payment receipt. Your order is confirmed only after payment is verified.",
    payUrl ? `Review quote and pay securely: ${payUrl}` : ""
  ].filter(Boolean).join("\n");
}

function quoteLines(order, catalogImages) {
  const items = Array.isArray(order.items) ? order.items : [];
  if (!items.length) return [{ artist: "NIXP", title: "Order item", meta: "", quantity: 1, lineTotal: 0, image: "" }];
  return items.map((item) => {
    const productId = clean(item.product_id || item.productId);
    const quantity = Math.max(1, Number(item.quantity || item.qty || 1));
    const title = clean(item.title || item.productTitle || item.name || productId || "Order item");
    const sku = clean(item.sku);
    const size = clean(item.size_label || item.size);
    return {
      artist: clean(item.artist),
      title,
      quantity,
      meta: [sku, size ? `Size ${size}` : "", `Qty ${quantity}`].filter(Boolean).join(" / "),
      lineTotal: amount(item.line_total ?? item.lineTotal ?? item.total ?? item.price),
      image: absoluteManagedImage(catalogImages.get(productId))
    };
  });
}

function absoluteManagedImage(value) {
  const image = clean(value);
  if (image.startsWith("/public/") || image.startsWith("/assets/")) return `${SITE_ORIGIN}${image}`;
  if (image.startsWith(`${SITE_ORIGIN}/`)) return image;
  return "";
}

function amount(value) {
  return Math.max(0, Math.round(Number(value) || 0));
}

function clean(value) {
  return String(value || "").trim();
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? clean(value) : new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(date);
}

function rupiah(value) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(amount(value));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}
