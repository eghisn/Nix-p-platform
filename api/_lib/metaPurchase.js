import { classifyMidtransEvent } from "./paymentState.js";

export function metaPurchaseSummary(order, attempt) {
  if (order?.payment_status !== "Paid" || order?.order_class !== "Customer" || attempt?.status !== "Paid") return null;
  const verified = attempt.payload;
  if (!verified || typeof verified !== "object" || String(verified.order_id) !== String(order.id)) return null;
  const status = String(verified.transaction_status || "").toLowerCase();
  const fraud = String(verified.fraud_status || "").toLowerCase();
  if (classifyMidtransEvent({ transactionStatus: status, fraudStatus: fraud }) !== "paid") return null;
  if (status === "capture" && String(verified.payment_type || "").toLowerCase() !== "credit_card") return null;
  if (String(verified.status_code) !== "200" || String(order.currency).toUpperCase() !== "IDR") return null;

  const merchandise = Number(order.merchandise_total);
  const shipping = Number(order.shipping_total);
  const discount = Number(order.discount_total);
  const grandTotal = Number(order.grand_total);
  const value = merchandise - discount;
  const lines = order.items || [];
  if (!lines.length || ![merchandise, shipping, discount, grandTotal, value].every(Number.isSafeInteger)) return null;
  if (value <= 0 || discount < 0 || shipping < 0 || merchandise + shipping - discount !== grandTotal) return null;
  if (Number(verified.gross_amount) !== grandTotal || String(verified.currency || "IDR").toUpperCase() !== "IDR") return null;

  const contents = [];
  let lineTotal = 0;
  let numItems = 0;
  for (const line of lines) {
    const id = String(line.product_id || "").trim();
    const quantity = Number(line.quantity);
    const itemPrice = Number(line.unit_price);
    const total = Number(line.line_total);
    if (!id || !Number.isSafeInteger(quantity) || quantity <= 0 || !Number.isSafeInteger(itemPrice) || itemPrice <= 0 ||
        !Number.isSafeInteger(total) || total !== quantity * itemPrice) return null;
    contents.push({ id, quantity, item_price: itemPrice });
    lineTotal += total;
    numItems += quantity;
  }
  if (lineTotal !== merchandise || !Number.isSafeInteger(numItems) || numItems <= 0) return null;
  return {
    orderId: order.id,
    content_ids: [...new Set(contents.map(({ id }) => id))],
    content_type: "product",
    value,
    currency: "IDR",
    num_items: numItems,
    contents
  };
}
