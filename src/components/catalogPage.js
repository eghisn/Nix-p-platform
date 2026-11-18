import { productGrid } from "./layout.js";

export function catalogGridPageMarkup(products, options = {}) {
  return `<section class="section shop-section">${productGrid(products, options)}</section>`;
}

export function apparelPageMarkup(apparel, activeFilter = "All Apparel", activeCollection = "") {
  const filters = ["All Apparel", "Tops", "Bottoms", "Accessories"];
  const collections = ["Nix Powell", "Music Merch"];
  return `
    <section class="section shop-section apparel-shop-section">
      <div class="apparel-toolbar">
        <div class="apparel-toolbar-group apparel-collections" role="group" aria-label="Apparel collections">
          ${collections.map((collection) => `<button class="chip ${activeCollection === collection ? "is-active" : ""}" type="button" data-apparel-collection="${collection}" aria-pressed="${activeCollection === collection}">${collection}</button>`).join("")}
        </div>
        <div class="apparel-toolbar-group apparel-types" role="group" aria-label="Apparel filters">
        ${filters
          .map(
            (filter) => `
              <button class="chip ${activeFilter === filter ? "is-active" : ""}" type="button" data-apparel-filter="${filter}" aria-pressed="${activeFilter === filter}">
                ${filter}
              </button>
            `
          )
          .join("")}
        </div>
      </div>
      ${productGrid(apparel)}
    </section>
  `;
}

export function publishingPageMarkup(items, activeFilter = "All") {
  const filters = ["All", "Poster", "Book", "Zine"];
  return `
    <section class="section shop-section">
      <div class="toolbar" role="group" aria-label="Publishing format filters">
        ${filters
          .map(
            (filter) => `
              <button class="chip ${activeFilter === filter ? "is-active" : ""}" type="button" data-publishing-filter="${filter}" aria-pressed="${activeFilter === filter}">
                ${filter}
              </button>
            `
          )
          .join("")}
      </div>
      ${productGrid(items)}
    </section>
  `;
}
