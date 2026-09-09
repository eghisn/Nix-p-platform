const SITE_ORIGIN = "https://www.nix-p.com";
const EMAIL_FONT = "'Founders Grotesk Web','Helvetica Neue',Arial,sans-serif";

export function renderPaymentReceipt(order = {}, { payment = {}, catalogImages = new Map() } = {}) {
  const lines = receiptLines(order, catalogImages);
  const merchandise = amount(order.merchandise_total ?? order.merchandiseTotal ?? lines.reduce((total, line) => total + line.lineTotal, 0));
  const shipping = amount(order.shipping_total ?? order.shippingTotal);
  const discount = amount(order.discount_total ?? order.discountTotal);
  const total = amount(order.grand_total ?? order.total ?? merchandise + shipping - discount);
  const reference = orderReference(order);
  const paymentReference = clean(payment.transactionId || payment.transaction_id || payment.providerOrderId || payment.provider_order_id || order.id);
  const paymentMethod = clean(payment.method || payment.payment_type || "Midtrans");
  const paidAt = formatDate(payment.paidAt || payment.transaction_time || order.paid_at || order.paidAt || order.updated_at);
  const delivery = shippingDetails(order);
  const customer = order.customer && typeof order.customer === "object" ? order.customer : {};

  return {
    text: receiptText({ reference, total, merchandise, shipping, discount, paymentReference, paymentMethod, paidAt, customer, delivery, lines }),
    html: receiptHtml({ reference, total, merchandise, shipping, discount, paymentReference, paymentMethod, paidAt, customer, delivery, lines })
  };
}

function receiptHtml({ reference, total, merchandise, shipping, discount, paymentReference, paymentMethod, paidAt, customer, delivery, lines }) {
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
  const discountRow = discount > 0 ? `<tr><td style="padding:6px 0;font-family:${EMAIL_FONT};font-size:13px;line-height:18px;color:#555555;">Discount</td><td style="padding:6px 0;text-align:right;font-family:${EMAIL_FONT};font-size:13px;line-height:18px;color:#292929;">-${escapeHtml(rupiah(discount))}</td></tr>` : "";
  const shippingRow = shipping > 0 ? `<tr><td style="padding:6px 0;font-family:${EMAIL_FONT};font-size:13px;line-height:18px;color:#555555;">Delivery</td><td style="padding:6px 0;text-align:right;font-family:${EMAIL_FONT};font-size:13px;line-height:18px;color:#292929;">${escapeHtml(rupiah(shipping))}</td></tr>` : "";
  const deliveryBlock = delivery.lines.length ? `
    <td style="width:50%;padding:0 12px 0 0;vertical-align:top;">
      <div style="font-family:${EMAIL_FONT};font-size:10px;font-weight:700;line-height:14px;text-transform:uppercase;letter-spacing:0;color:#747474;">Delivery</div>
      <div style="margin-top:7px;font-family:${EMAIL_FONT};font-size:13px;line-height:19px;color:#292929;">${delivery.lines.map(escapeHtml).join("<br>")}</div>
    </td>` : "";

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
              <td align="right" style="font-family:${EMAIL_FONT};font-size:10px;font-weight:700;line-height:14px;text-transform:uppercase;letter-spacing:0;">Payment receipt</td>
            </tr></table>
          </td></tr>
          <tr><td style="padding:32px 24px 24px;background:#f1f1f1;">
            <div style="font-family:${EMAIL_FONT};font-size:10px;font-weight:700;line-height:14px;text-transform:uppercase;letter-spacing:0;color:#747474;">Payment verified</div>
            <div style="margin-top:8px;font-family:${EMAIL_FONT};font-size:32px;font-weight:700;line-height:34px;letter-spacing:0;color:#292929;">Thank you, ${escapeHtml(clean(customer.name) || "for your order")}.</div>
            <div style="margin-top:12px;font-family:${EMAIL_FONT};font-size:15px;line-height:22px;color:#292929;">Your payment has been securely verified. We are preparing your order.</div>
          </td></tr>
          <tr><td style="padding:0 24px 28px;background:#f1f1f1;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-top:1px solid #292929;border-bottom:1px solid #292929;">
              <tr>
                <td style="padding:12px 0;font-family:${EMAIL_FONT};font-size:10px;font-weight:700;line-height:14px;text-transform:uppercase;letter-spacing:0;color:#747474;">Order</td>
                <td style="padding:12px 0;text-align:right;font-family:${EMAIL_FONT};font-size:13px;font-weight:700;line-height:18px;color:#292929;">${escapeHtml(reference)}</td>
              </tr>
              <tr>
                <td style="padding:0 0 12px;font-family:${EMAIL_FONT};font-size:10px;font-weight:700;line-height:14px;text-transform:uppercase;letter-spacing:0;color:#747474;">Payment</td>
                <td style="padding:0 0 12px;text-align:right;font-family:${EMAIL_FONT};font-size:13px;line-height:18px;color:#292929;">${escapeHtml(paymentMethod)}${paymentReference ? ` / ${escapeHtml(paymentReference)}` : ""}</td>
              </tr>
              <tr>
                <td style="padding:0 0 12px;font-family:${EMAIL_FONT};font-size:10px;font-weight:700;line-height:14px;text-transform:uppercase;letter-spacing:0;color:#747474;">Verified</td>
                <td style="padding:0 0 12px;text-align:right;font-family:${EMAIL_FONT};font-size:13px;line-height:18px;color:#292929;">${escapeHtml(paidAt)}</td>
              </tr>
            </table>
          </td></tr>
          <tr><td style="padding:0 24px 8px;background:#f1f1f1;font-family:${EMAIL_FONT};font-size:10px;font-weight:700;line-height:14px;text-transform:uppercase;letter-spacing:0;color:#747474;">Order summary</td></tr>
          <tr><td style="padding:0 24px 20px;background:#f1f1f1;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${itemRows}</table></td></tr>
          <tr><td style="padding:0 24px 30px;background:#f1f1f1;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-top:1px solid #292929;">
              <tr><td style="padding:12px 0 6px;font-family:${EMAIL_FONT};font-size:13px;line-height:18px;color:#555555;">Items</td><td style="padding:12px 0 6px;text-align:right;font-family:${EMAIL_FONT};font-size:13px;line-height:18px;color:#292929;">${escapeHtml(rupiah(merchandise))}</td></tr>
              ${shippingRow}${discountRow}
              <tr><td style="padding:14px 0 0;border-top:1px solid #292929;font-family:${EMAIL_FONT};font-size:20px;font-weight:700;line-height:24px;color:#292929;">Total paid</td><td style="padding:14px 0 0;border-top:1px solid #292929;text-align:right;font-family:${EMAIL_FONT};font-size:20px;font-weight:700;line-height:24px;color:#292929;white-space:nowrap;">${escapeHtml(rupiah(total))}</td></tr>
            </table>
          </td></tr>
          <tr><td style="padding:0 24px 30px;background:#f1f1f1;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
              <td style="width:50%;padding:0 12px 0 0;vertical-align:top;">
                <div style="font-family:${EMAIL_FONT};font-size:10px;font-weight:700;line-height:14px;text-transform:uppercase;letter-spacing:0;color:#747474;">Customer</div>
                <div style="margin-top:7px;font-family:${EMAIL_FONT};font-size:13px;line-height:19px;color:#292929;">${escapeHtml(clean(customer.name) || "NIXP customer")}${clean(customer.email) ? `<br>${escapeHtml(customer.email)}` : ""}</div>
              </td>
              ${deliveryBlock}
            </tr></table>
          </td></tr>
          <tr><td style="padding:20px 24px;background:#292929;font-family:${EMAIL_FONT};font-size:11px;line-height:17px;color:#f1f1f1;">This receipt confirms a payment verified by Midtrans. Keep it with your order reference for support.</td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

function receiptText({ reference, total, merchandise, shipping, discount, paymentReference, paymentMethod, paidAt, customer, delivery, lines }) {
  return [
    "NIXP payment receipt",
    `Order: ${reference}`,
    `Payment: ${paymentMethod}${paymentReference ? ` / ${paymentReference}` : ""}`,
    `Verified: ${paidAt}`,
    "",
    "Items",
    ...lines.map((line) => `- ${line.quantity} x ${[line.artist, line.title].filter(Boolean).join(" - ")} / ${rupiah(line.lineTotal)}`),
    "",
    `Items: ${rupiah(merchandise)}`,
    shipping > 0 ? `Delivery: ${rupiah(shipping)}` : "",
    discount > 0 ? `Discount: -${rupiah(discount)}` : "",
    `Total paid: ${rupiah(total)}`,
    "",
    `Customer: ${clean(customer.name) || "NIXP customer"}`,
    ...delivery.lines.map((line) => `Delivery: ${line}`),
    "",
    "This receipt confirms a payment verified by Midtrans."
  ].filter(Boolean).join("\n");
}

function receiptLines(order, catalogImages) {
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

function shippingDetails(order) {
  const address = order.shipping_address && typeof order.shipping_address === "object"
    ? order.shipping_address
    : order.shippingAddress && typeof order.shippingAddress === "object" ? order.shippingAddress : {};
  const method = [clean(order.courier), clean(order.shipping_method || order.shippingMethod)].filter(Boolean).join(" / ");
  return {
    lines: [
      method,
      clean(address.recipient),
      clean(address.phone),
      clean(address.address1),
      clean(address.address2),
      [clean(address.district), clean(address.city)].filter(Boolean).join(", "),
      [clean(address.province), clean(address.postalCode)].filter(Boolean).join(" "),
      clean(address.country)
    ].filter(Boolean)
  };
}

function absoluteManagedImage(value) {
  const image = clean(value);
  if (image.startsWith("/public/") || image.startsWith("/assets/")) return `${SITE_ORIGIN}${image}`;
  if (image.startsWith(`${SITE_ORIGIN}/`)) return image;
  return "";
}

function orderReference(order) {
  return clean(order.public_reference || order.publicReference || order.id) || "NIXP order";
}

function amount(value) {
  return Math.max(0, Math.round(Number(value) || 0));
}

function clean(value) {
  return String(value || "").trim();
}

function formatDate(value) {
  if (!value) return "Verified";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? clean(value) : new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(date);
}

function rupiah(value) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(amount(value));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}
