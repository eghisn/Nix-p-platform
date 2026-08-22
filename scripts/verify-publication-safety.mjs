import assert from "node:assert/strict";
import {
  apparelPublicationIssues,
  applyCatalogPublicationSafety,
  catalogPublicationIssues,
  isCatalogPublicationReady
} from "../src/data/catalogPublication.js";

const staleApparel = {
  id: "finance-nxp-2026-app-0042",
  financeStockId: "stock-0042",
  category: "Apparel",
  title: "Hiatus Kaiyote Tee",
  price: 350000,
  image: "/images/hiatus-kaiyote-tee.jpg",
  publishStatus: "Published",
  visibility: "Public",
  raw: {
    category: "Apparel",
    publicationIssues: ["label", "description", "source-backed review", "managed cover art", "verified related-artist research"]
  }
};

const cleaned = applyCatalogPublicationSafety({ products: [staleApparel] }).products[0];
assert.equal(cleaned.publishStatus, "Published");
assert.equal(cleaned.visibility, "Public");
assert.equal(cleaned.raw.publicationIssues, undefined);
assert.deepEqual(catalogPublicationIssues(cleaned), []);
assert.equal(isCatalogPublicationReady(cleaned), true);

const incompleteApparel = {
  ...staleApparel,
  publishStatus: "Draft",
  visibility: "Private",
  image: "",
  price: 0,
  raw: { category: "Apparel" }
};
assert.deepEqual(apparelPublicationIssues(incompleteApparel), ["managed product photo", "selling price"]);

const incompleteRecord = {
  id: "finance-nxp-2026-vnl-9999",
  financeStockId: "stock-9999",
  category: "Records",
  format: "Vinyl",
  title: "New Release",
  artist: "Artist",
  price: 250000,
  publishStatus: "Draft",
  visibility: "Private",
  raw: { category: "Records", format: "Vinyl" }
};
const protectedRecord = applyCatalogPublicationSafety({ products: [incompleteRecord] }).products[0];
assert.equal(protectedRecord.publishStatus, "Draft");
assert.ok(catalogPublicationIssues(protectedRecord).includes("label"));
assert.ok(catalogPublicationIssues(protectedRecord).includes("managed cover art"));

console.log("Publication safety checks passed.");
