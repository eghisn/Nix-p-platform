import { catalogResearchJobSummary, markCatalogResearchJobsLive } from "./catalogResearchJobs.js";
import { comparePublicCatalogRevision, fetchPublicCatalogRevision } from "./publicCatalogDeployment.js";
import { loadStore, saveProductPublicationStatus } from "./supabase.js";

export async function reconcileCatalogPublicationState() {
  const [store, jobs, liveProducts] = await Promise.all([
    loadStore({ privateScope: true }),
    catalogResearchJobSummary(),
    fetchPublicCatalogRevision()
  ]);
  const products = store.products || [];
  const productBySku = new Map(products.map((product) => [normalizedSku(product.sku), product]));
  const pendingJobs = (jobs || []).filter((job) => ["ready", "deployment_pending"].includes(String(job.status || "")));
  const liveJobSkus = [...new Set(pendingJobs
    .map((job) => normalizedSku(job.sku))
    .filter((sku) => {
      const product = productBySku.get(sku);
      return product?.publishStatus === "Published" && product?.visibility === "Public";
    })
    .filter((sku) => comparePublicCatalogRevision(products, liveProducts, [sku]).confirmed))];
  if (liveJobSkus.length) {
    await markCatalogResearchJobsLive(liveJobSkus, {
      reconciledAt: new Date().toISOString(),
      source: "public-catalog-reconciliation"
    });
  }

  const pendingProducts = products.filter((product) =>
    String(product.publicationState || product.raw?.publicationState || "") === "deployment_pending"
  );
  const reconciledProducts = [];
  for (const product of pendingProducts) {
    if (!comparePublicCatalogRevision(products, liveProducts, [product.sku]).confirmed) continue;
    const nextStore = {
      ...store,
      products: products.map((candidate) => candidate.id === product.id
        ? {
            ...candidate,
            raw: {
              ...(candidate.raw || {}),
              publicationState: "live",
              publication: {
                ...(candidate.publication || candidate.raw?.publication || {}),
                verifiedAt: new Date().toISOString(),
                reconciled: true
              }
            }
          }
        : candidate)
    };
    await saveProductPublicationStatus(nextStore, product.id);
    reconciledProducts.push(product.sku);
  }

  return {
    checkedJobs: pendingJobs.length,
    jobsMarkedLive: liveJobSkus,
    checkedProducts: pendingProducts.length,
    productsMarkedLive: reconciledProducts
  };
}

function normalizedSku(value) {
  return String(value || "").trim().toUpperCase();
}
