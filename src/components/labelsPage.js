import { labelLogoPath } from "../data/labelCatalog.js";
import { verifiedLabelLogos } from "../data/labelLogoManifest.js";
import { productGrid } from "./layout.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function labelsPageMarkup(labels = []) {
  return `
    <section class="section labels-page">
      <div class="labels-grid" aria-label="Record labels">
        ${labels
          .map(
            (label) => `
              <article class="label-tile">
                <a class="label-logo-link" href="/labels/${escapeHtml(label.slug)}" data-link aria-label="View ${escapeHtml(label.name)} products">
                  <img class="label-logo${verifiedLabelLogos[label.slug]?.tone === "preserve" ? " label-logo--preserve" : ""}" src="${labelLogoPath(label.name)}" alt="${escapeHtml(label.name)}" loading="lazy" decoding="async" />
                </a>
                <a class="label-products-link" href="/labels/${escapeHtml(label.slug)}" data-link>View products</a>
              </article>
            `
          )
          .join("")}
      </div>
    </section>
  `;
}

export function labelProductsPageMarkup(label, products, options = {}) {
  return `
    <section class="section labels-detail-page">
      <div class="label-detail-heading">
        <a class="back-link" href="/labels" data-link>Labels</a>
        <h1>${escapeHtml(label.name)}</h1>
      </div>
      ${productGrid(products, options)}
    </section>
  `;
}
