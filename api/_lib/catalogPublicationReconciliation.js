import { catalogResearchJobSummary, markCatalogResearchJobsLive, publicationJobsForProducts } from "./catalogResearchJobs.js";
import { comparePublicCatalogRevision, fetchPublicCatalogRevision } from "./publicCatalogDeployment.js";
import { loadStore, saveProductPublicationStatus } from "./supabase.js";

export async function reconcileCatalogPublicationState() {
  const [store, jobs, liveProducts] = await Promise.all([
    loadStore({ privateScope: true }),
    catalogResearchJobSummary([], { statuses: ["ready", "deployment_pending"] }),
    fetchPublicCatalogRevision()
  ]);
  const products = store.products || [];
  const pendingJobs = jobs || [];
  const liveJobs = publicationJobsForProducts(pendingJobs, products)
    .filter((job) => comparePublicCatalogRevision(products, liveProducts, [job.sku]).confirmed);
  if (liveJobs.length) {
    await markCatalogResearchJobsLive(liveJobs, {
      reconciledAt: new Date().toISOString(),
      source: "public-catalog-reconciliation"
    });
  }

  const pendingProducts = products.filter((product) =>
    String(product.publicationState || product.raw?.publicationState || "") === "deployment_pending"
  );
  const reconciledProducts = [];
  const skippedProducts = [];
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
    try {
      await saveProductPublicationStatus(nextStore, product.id, {
        expectedRevision: product.editRevision,
        actor: "publication-reconciliation"
      });
      reconciledProducts.push(product.sku);
    } catch (error) {
      if (Number(error?.statusCode) !== 409) throw error;
      skippedProducts.push(product.sku);
    }
  }

  return {
    checkedJobs: pendingJobs.length,
    jobsMarkedLive: liveJobs.map((job) => job.id),
    checkedProducts: pendingProducts.length,
    productsMarkedLive: reconciledProducts,
    productsSkippedForNewerEdit: skippedProducts
  };
}
