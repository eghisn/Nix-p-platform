const RECORD_FORMATS = new Set(["Vinyl", "CD", "Cassette"]);
const USED_CONDITION = /^used\b/i;
const MUSICBRAINZ_ORIGIN = "https://musicbrainz.org";
const USER_AGENT = "NIXP-Catalog/1.0 (contact@nix-p.com)";

// Exact, reviewed matches take precedence over discovery. These records also
// document the source used for every locally archived catalog image.
export const CURATED_FINANCE_ENRICHMENTS = {
  "NXP-2026-CD-0025": {
    title: "Pleiades' Dust",
    year: 2016,
    label: "Season of Mist",
    edition: "Digipak CD",
    barcode: "0822603138627",
    catalogNumber: "SOM 386D",
    cover: "/public/covers/nxp-2026-cd-0025-gorguts-pleiades-dust.jpg",
    productPhoto: "/public/product-photos/nxp-2026-cd-0025-gorguts-pleiades-dust-cd.jpg",
    imageCredits: [
      {
        image: "/public/covers/nxp-2026-cd-0025-gorguts-pleiades-dust.jpg",
        credit: "Cover Art Archive / Season of Mist",
        url: "https://coverartarchive.org/release/dde87be9-76ac-47cb-a4a8-40ec53cb135f"
      },
      {
        image: "/public/product-photos/nxp-2026-cd-0025-gorguts-pleiades-dust-cd.jpg",
        credit: "Season of Mist product photography",
        url: "https://shop.season-of-mist.com/products/gorguts-pleiades-dust-cd"
      }
    ],
    description:
      "Gorguts' 2016 EP Pleiades' Dust is a single thirty-three-minute composition in seven movements, using the rise and destruction of Baghdad's House of Wisdom as the frame for the band's dissonant, progressive death metal.",
    descriptionSource: "Season of Mist / MusicBrainz",
    reviewQuote: "music and narrative intertwine themselves flawlessly",
    reviewSource: "Sputnikmusic (quoted)",
    reviewUrl: "https://www.sputnikmusic.com/review/71492/Gorguts-Pleiades-Dust/",
    relatedArtists: ["Behold The Arctopus", "Meshuggah", "The Dillinger Escape Plan"],
    tags: ["technical death metal", "progressive death metal", "EP"],
    sourceUrl: "https://www.season-of-mist.com/release/pleiades-dust/",
    musicBrainzReleaseId: "dde87be9-76ac-47cb-a4a8-40ec53cb135f"
  },
  "NXP-2026-CST-0010": {
    title: "Breeding the Spawn",
    year: 1993,
    label: "Roadrunner Records",
    edition: "Cassette",
    cover: "/public/covers/nxp-2026-cst-0010-suffocation-breeding-the-spawn.jpg",
    productPhoto: "/public/product-photos/nxp-2026-cst-0010-suffocation-breeding-the-spawn-cassette.png",
    imageCredits: [
      {
        image: "/public/covers/nxp-2026-cst-0010-suffocation-breeding-the-spawn.jpg",
        credit: "Listenable Records Bandcamp artwork",
        url: "https://listenable-records.bandcamp.com/album/breeding-the-spawn-sorry-digital-is-not-available"
      },
      {
        image: "/public/product-photos/nxp-2026-cst-0010-suffocation-breeding-the-spawn-cassette.png",
        credit: "Suffocation Direct Merch product photography",
        url: "https://direct-merch.com/products/suffocation-breeding-the-spawn-cassette"
      }
    ],
    description:
      "Suffocation's 1993 second album Breeding the Spawn pushed the New York band's dense riffing, abrupt rhythmic turns and low-register brutality further into the technical death-metal language they helped establish.",
    descriptionSource: "Suffocation / MusicBrainz",
    reviewQuote: "The blueprint that many latter-day tech death bands would borrow from",
    reviewSource: "Metal Storm (quoted)",
    reviewUrl: "https://metalstorm.net/pub/review.php?review_id=18574",
    relatedArtists: ["Gorguts", "The Dillinger Escape Plan"],
    tags: ["death metal", "technical death metal"],
    sourceUrl: "https://direct-merch.com/products/suffocation-breeding-the-spawn-cassette",
    musicBrainzReleaseId: "bc9f0c79-5f69-4f60-9681-087caba79c18"
  },
  "NXP-2026-VNL-0014": {
    title: "SOPHIE",
    year: 2024,
    label: "Transgressive / Future Classic",
    edition: "2LP gatefold",
    catalogNumber: "TRANS809X",
    cover: "/public/covers/nxp-2026-vnl-0014-sophie-sophie.jpg",
    productPhoto: "/public/product-photos/nxp-2026-vnl-0014-sophie-sophie-vinyl.jpg",
    imageCredits: [
      {
        image: "/public/covers/nxp-2026-vnl-0014-sophie-sophie.jpg",
        credit: "Transgressive / Future Classic artwork",
        url: "https://transgressiverecords.com/artist/sophie/"
      },
      {
        image: "/public/product-photos/nxp-2026-vnl-0014-sophie-sophie-vinyl.jpg",
        credit: "Impressed Recordings product photography",
        url: "https://impressedrecordings.com/products/sophie-sophie-vinyl-lp"
      }
    ],
    description:
      "SOPHIE's posthumous 2024 self-titled album was assembled by Benny Long from the artist's final recordings, keeping bright pop abstraction, collaborative songwriting and industrial club textures in conversation.",
    descriptionSource: "Transgressive / Associated Press",
    reviewQuote: "still sounds like the future of pop music",
    reviewSource: "Associated Press (quoted)",
    reviewUrl: "https://apnews.com/article/cfc8b0365229cfe0d05a350f9f748bd3",
    relatedArtists: ["Arca", "Oneohtrix Point Never"],
    tags: ["electronic", "experimental pop", "2LP"],
    sourceUrl: "https://sophie.ochre.store/?lang=en_GB"
  },
  "NXP-2026-VNL-0015": {
    title: "Suicide",
    year: 1977,
    label: "Mute / BMG",
    edition: "2019 remastered limited red vinyl reissue",
    cover: "/public/covers/nxp-2026-vnl-0015-suicide-suicide.jpg",
    productPhoto: "/public/product-photos/nxp-2026-vnl-0015-suicide-suicide-vinyl.jpg",
    imageCredits: [
      {
        image: "/public/covers/nxp-2026-vnl-0015-suicide-suicide.jpg",
        credit: "Cover Art Archive / Red Star Records",
        url: "https://coverartarchive.org/release/aa329b8c-6dd0-3279-9fa2-96e3a995cd4c"
      },
      {
        image: "/public/product-photos/nxp-2026-vnl-0015-suicide-suicide-vinyl.jpg",
        credit: "Mute product photography",
        url: "https://mutebank.co.uk/collections/suicide/products/suicide-suicide-lp"
      }
    ],
    description:
      "Suicide's 1977 debut reduced rock music to Martin Rev's stark electronics and Alan Vega's exposed voice, producing a confrontational New York record whose pulse became foundational to synth-punk, industrial music and electronic pop.",
    descriptionSource: "Mute / The Guardian",
    reviewQuote: "Immeasurably influential record that has lost little of its bite",
    reviewSource: "Sputnikmusic (quoted)",
    reviewUrl: "https://www.sputnikmusic.com/review/12011/Suicide-Suicide/",
    relatedArtists: ["Soft Moon", "Nine Inch Nails"],
    tags: ["synth-punk", "electronic", "reissue"],
    sourceUrl: "https://mutebank.co.uk/collections/suicide/products/suicide-suicide-lp"
  },
  "NXP-2026-VNL-0017": {
    title: "The Erosion of Sanity",
    year: 1993,
    label: "Listenable Records",
    edition: "Black vinyl reissue",
    cover: "/public/covers/nxp-2026-vnl-0017-gorguts-the-erosion-of-sanity.jpg",
    productPhoto: "/public/product-photos/nxp-2026-vnl-0017-gorguts-the-erosion-of-sanity-vinyl.jpg",
    imageCredits: [
      {
        image: "/public/covers/nxp-2026-vnl-0017-gorguts-the-erosion-of-sanity.jpg",
        credit: "Listenable Records Bandcamp artwork",
        url: "https://gorguts.bandcamp.com/album/the-erosion-of-sanity-sorry-digital-is-not-available"
      },
      {
        image: "/public/product-photos/nxp-2026-vnl-0017-gorguts-the-erosion-of-sanity-vinyl.jpg",
        credit: "Listenable Records product photography",
        url: "https://gorguts.bandcamp.com/album/the-erosion-of-sanity-sorry-digital-is-not-available"
      }
    ],
    description:
      "Gorguts' 1993 second album The Erosion of Sanity sharpened the Canadian band's old-school death metal into more dissonant, rhythmically unstable and technically demanding compositions before the later break made by Obscura.",
    descriptionSource: "AllMusic / MusicBrainz",
    reviewQuote: "a bona-fide tech-death classic",
    reviewSource: "Sputnikmusic (quoted)",
    reviewUrl: "https://www.sputnikmusic.com/review/81442/Gorguts-The-Erosion-of-Sanity/",
    relatedArtists: ["Behold The Arctopus", "Meshuggah", "The Dillinger Escape Plan"],
    tags: ["technical death metal", "death metal", "reissue"],
    sourceUrl: "https://gorguts.bandcamp.com/album/the-erosion-of-sanity-sorry-digital-is-not-available"
  }
};

export async function enrichFinanceCatalogProduct(row, stock = {}) {
  const format = String(stock.item || row.format || "").trim();
  const title = String(stock.title || row.title || "").trim();
  const artist = String(stock.artist || row.artist || "").trim();
  const price = Number(stock.sellingPrice || row.price || 0);

  if (!RECORD_FORMATS.has(format) || !title || !artist || price <= 0) {
    return finalizeStatus(row, { publishable: false, status: "needs-finance-data" });
  }

  const sku = String(stock.sku || row.sku || "").trim().toUpperCase();
  const curated = CURATED_FINANCE_ENRICHMENTS[sku];
  const discovered = curated || (await discoverMusicBrainzRelease({ ...stock, format, title, artist }).catch(() => null));
  if (!discovered) {
    return finalizeStatus(row, {
      publishable: hasCatalogCore(row),
      status: "needs-release-match"
    });
  }

  const raw = row.raw || {};
  const used = USED_CONDITION.test(String(stock.itemCondition || row.condition || ""));
  const previousAutoProductPhoto = String(raw.autoProductPhoto || "").trim();
  const currentImages = unique([row.image, ...(Array.isArray(row.images) ? row.images : [])])
    .filter(isUsableImage)
    .filter((image) => !used || image !== previousAutoProductPhoto);
  const discoveredImages = used
    ? unique([discovered.cover])
    : unique([discovered.cover, discovered.productPhoto]);
  const images = currentImages.length ? unique([...currentImages, ...discoveredImages]) : discoveredImages;
  const existingCover =
    isUsableImage(row.image) && (!used || row.image !== previousAutoProductPhoto) ? row.image : "";
  const cover = existingCover || discovered.cover || images[0] || "";
  const imageCredits = mergeCredits(row.image_credits || raw.imageCredits, discovered.imageCredits);
  const details = unique([
    ...(Array.isArray(row.details) ? row.details : []),
    `SKU: ${sku}`,
    `Format: ${format}`,
    stock.itemCondition ? `Condition: ${stock.itemCondition}` : "",
    discovered.edition ? `Edition: ${discovered.edition}` : "",
    discovered.catalogNumber ? `Catalog number: ${discovered.catalogNumber}` : "",
    discovered.barcode ? `Barcode: ${discovered.barcode}` : ""
  ]).filter((detail) => detail && !detail.startsWith("Created from finance inventory"));
  const relatedArtists = unique([...(raw.relatedArtists || []), ...(discovered.relatedArtists || [])]);
  const product = {
    ...row,
    title: discovered.title || row.title,
    artist,
    format,
    display_format: format,
    price,
    year: Number(discovered.year || row.year || new Date().getFullYear()),
    label: discovered.label || row.label || "",
    collection: discovered.label || row.collection || row.label || "",
    image: cover,
    images,
    image_credits: imageCredits,
    tags: unique([...(row.tags || []), ...(discovered.tags || [])]),
    details,
    description: row.description || discovered.description || "",
    updated_at: today(),
    raw: {
      ...raw,
      id: row.id,
      sku,
      title: discovered.title || row.title,
      artist,
      category: "Records",
      format,
      displayFormat: format,
      condition: stock.itemCondition || row.condition || "",
      price,
      year: Number(discovered.year || row.year || new Date().getFullYear()),
      label: discovered.label || row.label || "",
      collection: discovered.label || row.collection || row.label || "",
      image: cover,
      images,
      imageCredits,
      tags: unique([...(row.tags || []), ...(discovered.tags || [])]),
      details,
      description: row.description || discovered.description || "",
      edition: raw.edition || discovered.edition || "",
      barcode: raw.barcode || discovered.barcode || "",
      catalogNumber: raw.catalogNumber || discovered.catalogNumber || "",
      relatedArtists,
      descriptionSource: raw.descriptionSource || discovered.descriptionSource || "",
      reviewQuote: raw.reviewQuote || discovered.reviewQuote || "",
      reviewSource: raw.reviewSource || discovered.reviewSource || "",
      reviewUrl: raw.reviewUrl || discovered.reviewUrl || "",
      metadataSourceUrl: discovered.sourceUrl || "",
      musicBrainzReleaseId: discovered.musicBrainzReleaseId || "",
      autoProductPhoto: used ? "" : discovered.productPhoto || previousAutoProductPhoto,
      enrichmentOrigin: curated ? "curated-exact" : "musicbrainz",
      enrichmentStatus: used || discovered.productPhoto ? "complete" : "needs-product-photo",
      enrichmentUpdatedAt: today()
    }
  };
  return finalizeStatus(product, {
    publishable: hasCatalogCore(product),
    status: product.raw.enrichmentStatus
  });
}

async function discoverMusicBrainzRelease(stock) {
  const query = [
    `artist:"${escapeQuery(stock.artist)}"`,
    `release:"${escapeQuery(stock.title)}"`
  ].join(" AND ");
  const response = await fetch(
    `${MUSICBRAINZ_ORIGIN}/ws/2/release/?query=${encodeURIComponent(query)}&fmt=json&limit=25`,
    { headers: { accept: "application/json", "user-agent": USER_AGENT } }
  );
  if (!response.ok) return null;
  const payload = await response.json();
  const format = String(stock.format || stock.item || "").toLowerCase();
  const expectedTitle = normalizedText(stock.title);
  const expectedArtist = normalizedText(stock.artist);
  let matches = (payload.releases || []).filter((release) => {
    const formats = (release.media || []).map((medium) => String(medium.format || "").toLowerCase());
    const artists = (release["artist-credit"] || []).map((credit) => credit.name).join(" ");
    return (
      normalizedText(release.title) === expectedTitle &&
      normalizedText(artists).includes(expectedArtist) &&
      formats.some((candidate) => candidate.includes(format))
    );
  });

  const barcode = String(stock.barcode || "").replace(/\D/g, "");
  if (barcode) matches = matches.filter((release) => String(release.barcode || "").replace(/\D/g, "") === barcode);
  const catalogNumber = normalizedText(stock.catalogNumber);
  if (catalogNumber) {
    matches = matches.filter((release) =>
      (release["label-info"] || []).some((label) => normalizedText(label["catalog-number"]) === catalogNumber)
    );
  }
  const release = matches.sort((a, b) => Number(b.score || 0) - Number(a.score || 0))[0];
  if (!release) return null;

  const labelInfo = release["label-info"] || [];
  const labels = unique(labelInfo.map((entry) => entry.label?.name));
  const catalogNumbers = unique(labelInfo.map((entry) => entry["catalog-number"]));
  const candidateCover = `https://coverartarchive.org/release/${release.id}/front-1200`;
  const cover = (await remoteImageExists(candidateCover)) ? candidateCover : "";
  const year = Number(String(release.date || "").slice(0, 4)) || 0;
  const label = labels.join(" / ");
  const edition = unique([
    release.packaging,
    ...(release.media || []).map((medium) => medium.format)
  ]).join(" / ");
  const description = `${stock.artist}'s ${year || ""} release ${release.title} on ${stock.format || stock.item}${
    label ? `, issued by ${label}` : ""
  }.`.replace(/\s+/g, " ");

  return {
    title: release.title,
    year,
    label,
    edition,
    barcode: release.barcode || "",
    catalogNumber: catalogNumbers.join(" / "),
    cover,
    imageCredits: cover
      ? [
          {
            image: cover,
            credit: "Cover Art Archive / MusicBrainz",
            url: `${MUSICBRAINZ_ORIGIN}/release/${release.id}`
          }
        ]
      : [],
    description,
    descriptionSource: "MusicBrainz",
    relatedArtists: [],
    tags: [],
    sourceUrl: `${MUSICBRAINZ_ORIGIN}/release/${release.id}`,
    musicBrainzReleaseId: release.id
  };
}

function finalizeStatus(row, { publishable, status }) {
  const raw = {
    ...(row.raw || {}),
    enrichmentStatus: status,
    publishStatus: publishable ? "Published" : "Draft",
    visibility: publishable ? "Public" : "Private"
  };
  return {
    ...row,
    publish_status: publishable ? "Published" : "Draft",
    visibility: publishable ? "Public" : "Private",
    raw
  };
}

function hasCatalogCore(row) {
  return Boolean(
    String(row.title || "").trim() &&
      String(row.artist || "").trim() &&
      String(row.label || "").trim() &&
      String(row.description || "").trim() &&
      Number(row.year || 0) > 1900 &&
      Number(row.price || 0) > 0 &&
      isUsableImage(row.image)
  );
}

function isUsableImage(value) {
  const image = String(value || "").trim();
  return Boolean(image && !image.includes("nixp-product-example"));
}

async function remoteImageExists(url) {
  const response = await fetch(url, {
    method: "HEAD",
    redirect: "follow",
    headers: { accept: "image/*", "user-agent": USER_AGENT }
  }).catch(() => null);
  return Boolean(response?.ok && String(response.headers.get("content-type") || "").startsWith("image/"));
}

function mergeCredits(current, discovered) {
  const credits = [...(Array.isArray(current) ? current : []), ...(Array.isArray(discovered) ? discovered : [])];
  const byImage = new Map();
  for (const credit of credits) {
    const key = String(credit?.image || credit?.url || "").trim();
    if (key) byImage.set(key, credit);
  }
  return [...byImage.values()];
}

function unique(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean))];
}

function normalizedText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function escapeQuery(value) {
  return String(value || "").replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function today() {
  return new Date().toISOString().slice(0, 10);
}
