export function imageCreditMarkup(product, image) {
  const credit = (Array.isArray(product.imageCredits) ? product.imageCredits : [])
    .find((item) => item.image === image || item.src === image);
  if (!credit?.credit) return "";
  const text = `Courtesy: ${escapeHtml(credit.credit)}`;
  const url = /^https?:\/\//i.test(String(credit.url || "")) ? credit.url : "";
  return url
    ? `<figcaption class="image-credit"><a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${text}</a></figcaption>`
    : `<figcaption class="image-credit">${text}</figcaption>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}
