import { productGrid } from "./layout.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function recordsPageMarkup({
  records,
  recordsFilter = "All",
  recordsSort = "artist-asc",
  labelFilter = "",
  artistTagFilter = "",
  availableArtistNames
}) {
  const filters = ["All", "Vinyl", "CD", "Cassette"];
  return `
    <section class="section shop-section">
      ${
        labelFilter
          ? `<div class="active-label-filter">
              <span>Record Label</span>
              <strong>${escapeHtml(labelFilter)}</strong>
              <a href="/records" data-link>Clear</a>
            </div>`
          : ""
      }
      ${
        artistTagFilter
          ? `<div class="active-label-filter">
              <span>Related Artist</span>
              <strong>${escapeHtml(artistTagFilter)}</strong>
              <a href="/records" data-link>Clear</a>
            </div>`
          : ""
      }
      <div class="records-toolbar">
        <div class="toolbar" role="group" aria-label="Record format filters">
          ${filters
            .map(
              (filter) => `
                <button class="chip ${recordsFilter === filter ? "is-active" : ""}" type="button" data-record-filter="${filter}">
                  ${filter}
                </button>
              `
            )
            .join("")}
        </div>
        <label class="records-sort">
          <span>Sort</span>
          <select data-record-sort aria-label="Sort records">
            <option value="artist-asc" ${recordsSort === "artist-asc" ? "selected" : ""}>Artist A-Z</option>
            <option value="artist-desc" ${recordsSort === "artist-desc" ? "selected" : ""}>Artist Z-A</option>
            <option value="price-asc" ${recordsSort === "price-asc" ? "selected" : ""}>Price low to high</option>
            <option value="price-desc" ${recordsSort === "price-desc" ? "selected" : ""}>Price high to low</option>
            <option value="year-desc" ${recordsSort === "year-desc" ? "selected" : ""}>Release year newest</option>
            <option value="year-asc" ${recordsSort === "year-asc" ? "selected" : ""}>Release year oldest</option>
          </select>
        </label>
      </div>
      ${productGrid(records, { availableArtistNames, deferCards: true, eagerCardCount: 8 })}
    </section>
  `;
}
