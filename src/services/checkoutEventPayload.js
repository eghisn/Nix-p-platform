export function checkoutEventPayload(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const contentIds = [];
  let value = 0;
  let numItems = 0;
  for (const row of rows) {
    const id = String(row?.productId || "").trim();
    const product = row?.product;
    const quantity = Number(row?.quantity);
    const price = Number(product?.price);
    if (
      !id || product?.id !== id || product.publishStatus !== "Published" ||
      product.visibility !== "Public" || product.open_to_offers === true ||
      !Number.isSafeInteger(quantity) || quantity <= 0 || quantity > Number(row.stock) ||
      !Number.isSafeInteger(price) || price <= 0 ||
      row.lineTotal !== quantity * price
    ) return null;

    if (!contentIds.includes(id)) contentIds.push(id);
    value += row.lineTotal;
    numItems += quantity;
  }
  if (!Number.isSafeInteger(value) || value <= 0 || !Number.isSafeInteger(numItems)) return null;
  return { content_ids: contentIds, content_type: "product", value, currency: "IDR", num_items: numItems };
}
