import { readFile, writeFile } from "node:fs/promises";

const rows = JSON.parse(await readFile("backups/related-artists/latest-research.json", "utf8"));
const escapeSql = (value) => String(value).replaceAll("'", "''");
const values = rows.map((row) => {
  const patch = {
    relatedArtists: row.relatedArtists,
    relatedArtistEvidence: row.relatedArtistEvidence,
    relatedArtistsResearch: row.relatedArtistsResearch,
    autoEditorial: {
      relatedArtists: row.relatedArtists,
      relatedArtistEvidence: row.relatedArtistEvidence,
      relatedArtistsResearch: row.relatedArtistsResearch
    }
  };
  if (row.relatedArtistsResearch.status === "no-verified-match") {
    patch.enrichmentStatus = "complete-no-related-artists";
  }
  return `('${escapeSql(row.sku)}', '${escapeSql(JSON.stringify(patch))}'::jsonb)`;
}).join(",\n");

const query = `with patches(sku, patch) as (values
${values}
)
update public.products as products
set raw = coalesce(products.raw, '{}'::jsonb) || patches.patch,
    updated_at = current_date,
    synced_at = now()
from patches
where upper(products.sku) = patches.sku
returning products.sku;`;

await writeFile("backups/related-artists/latest-refresh.sql", `${query}\n`);
console.log(JSON.stringify({ rows: rows.length, output: "backups/related-artists/latest-refresh.sql" }));
