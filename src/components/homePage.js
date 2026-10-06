import { shell } from "./layout.js";
import { isRecentReleaseProduct, recentReleaseSortComparator } from "../data/homeCollections.js";
import { publicProductPath } from "../data/publicUrls.js";

export function homeAppMarkup(publicProducts = []) {
  const products = publicProducts
    .filter(isRecentReleaseProduct)
    .filter((product) => product.image && !product.image.includes("nixp-product-example"))
    .sort(recentReleaseSortComparator);
  const slides = [...products, ...products];
  const collections = [
    ["recent-releases", "Recent Releases"],
    ["nixp-selection", "NIXP Selection"],
    ["back-in-stock", "Back in Stock"],
    ["limited-pressing", "Limited Pressing"],
    ["private-collection", "Private Collection"]
  ];
  const content = `
    <section class="home-slider" aria-label="Product slider">
      <div class="home-collections" role="group" aria-label="Home collections">
        ${collections
          .map(
            ([id, label], index) =>
              `<button class="home-collection-button ${index === 0 ? "is-active" : ""}" type="button" data-home-collection="${id}">${label}</button>`
          )
          .join("")}
      </div>
      <div class="slider-viewport" data-home-slider-viewport aria-roledescription="carousel" aria-label="Automatic product slider. Drag or swipe to browse.">
        <div class="slider-track" data-home-slider-track>
          ${slides
            .map((product, index) => {
              const soldOut = productQuantity(product) <= 0;
              return `
                <article class="slide ${soldOut ? "is-sold-out" : ""}">
                  <a href="${escapeHtml(publicProductPath(product))}" data-link data-product-link data-product-id="${escapeHtml(product.id)}">
                    <figure class="product-art slide-art ${soldOut ? "is-sold-out" : ""}"><img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.title)}" />${soldOut ? '<span class="sold-out-label">Sold out</span>' : ""}</figure>
                    <div class="slide-caption">
                      <span>${String((index % products.length) + 1).padStart(2, "0")}</span>
                      <strong>${escapeHtml(product.artist)}</strong>
                      <em>${escapeHtml(product.title)}</em>
                    </div>
                  </a>
                </article>`;
            })
            .join("")}
        </div>
      </div>
      <div class="slider-scrollbar" aria-label="Catalogue navigation">
        <button class="slider-scroll-button" type="button" aria-label="Previous catalogue items" data-home-slider-previous>&larr;</button>
        <div class="slider-scroll-rail" data-home-slider-control role="slider" aria-label="Browse catalogue" aria-valuemin="0" aria-valuemax="1000" aria-valuenow="0" tabindex="0"><span class="slider-scroll-thumb" data-home-slider-thumb></span></div>
        <button class="slider-scroll-button" type="button" aria-label="Next catalogue items" data-home-slider-next>&rarr;</button>
      </div>
    </section>`;
  return shell(content, "/", 0);
}

function productQuantity(product = {}) {
  if (Array.isArray(product.sizes) && product.sizes.length) {
    return product.sizes.reduce(
      (sum, size) => sum + Math.max(0, Number(size.quantity ?? size.qty ?? (size.soldOut ? 0 : 1)) || 0),
      0
    );
  }
  return Math.max(0, Number(product.qty ?? 1) || 0);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
