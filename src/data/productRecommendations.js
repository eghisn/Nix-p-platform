import { artistCreditNames, artistIdentityKey, canonicalLabelName } from "./catalogIdentity.js";

// Hand-curated listening circles take precedence over broad metadata matches.
// They are intentionally small: the rest of the catalogue remains driven by
// relationships, labels, and tags instead of a fixed recommendation shelf.
const CURATED_LISTENING_CIRCLES = new Map([
  ["arca", ["SOPHIE", "Toxe", "Oneohtrix Point Never", "Amnesia Scanner"]]
]);

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function artistKeys(value) {
  return unique(artistCreditNames(value).map(artistIdentityKey));
}

function productArtistKeys(product = {}) {
  return artistKeys(product.artist);
}

function relatedArtistKeys(product = {}) {
  return unique((product.relatedArtists || []).flatMap((artist) => artistKeys(artist)));
}

function normalisedTags(product = {}) {
  return new Set(
    (product.tags || [])
      .map((tag) => String(tag || "").trim().toLowerCase())
      .filter((tag) => tag && !/^nxp-\d{4}-/.test(tag) && !/^(vinyl|cd|cassette|12-inch|2lp|ep|a\/v)$/i.test(tag))
  );
}

function sharedCount(first, second) {
  const right = second instanceof Set ? second : new Set(second || []);
  let count = 0;
  for (const value of first) if (right.has(value)) count += 1;
  return count;
}

function includesAny(values, expected) {
  return expected.some((value) => values.includes(value));
}

function listeningCircleScore(product, candidate) {
  const sourceArtists = productArtistKeys(product);
  const candidateArtists = productArtistKeys(candidate);
  const candidateRelated = relatedArtistKeys(candidate);
  const sourceRelated = relatedArtistKeys(product);
  let score = 0;

  for (const artist of sourceArtists) {
    const circle = CURATED_LISTENING_CIRCLES.get(artist) || [];
    const circleKeys = circle.map(artistIdentityKey);
    if (includesAny(candidateArtists, circleKeys)) {
      // Preserve the written order inside a curated circle.
      const position = circleKeys.findIndex((key) => candidateArtists.includes(key));
      score += 10_000 - position * 100;
    }
  }

  // A direct related-artist link is a stronger musical signal than genre alone.
  score += sharedCount(new Set(candidateArtists), sourceRelated) * 800;
  score += sharedCount(new Set(sourceArtists), candidateRelated) * 650;
  score += sharedCount(sourceRelated, candidateRelated) * 135;

  const productLabel = canonicalLabelName(product.label).toLowerCase();
  const candidateLabel = canonicalLabelName(candidate.label).toLowerCase();
  if (productLabel && productLabel === candidateLabel) score += 180;

  score += sharedCount(normalisedTags(product), normalisedTags(candidate)) * 95;

  // Multiple formats of the same title should not crowd the shelf.
  if (
    product.artist === candidate.artist &&
    String(product.title || "").trim().toLowerCase() === String(candidate.title || "").trim().toLowerCase()
  ) {
    score -= 10_000;
  }

  // A small same-artist signal keeps a second release discoverable without
  // overpowering more meaningful links.
  if (sharedCount(new Set(sourceArtists), new Set(candidateArtists))) score += 32;
  if (product.format === candidate.format) score += 4;

  return score;
}

export function recommendedProducts(product, products, { limit = 4 } = {}) {
  const candidates = (products || [])
    .filter((candidate) => candidate.category === "Records" && candidate.id !== product.id)
    .map((candidate) => ({ candidate, score: listeningCircleScore(product, candidate) }))
    .filter(({ score }) => score > -10_000)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      const artist = String(left.candidate.artist || "").localeCompare(String(right.candidate.artist || ""));
      if (artist) return artist;
      return String(left.candidate.title || "").localeCompare(String(right.candidate.title || ""));
    });

  const seenReleases = new Set();
  const distinct = candidates.filter(({ candidate }) => {
    const key = `${artistIdentityKey(candidate.artist)}:${String(candidate.title || "").trim().toLowerCase()}`;
    if (seenReleases.has(key)) return false;
    seenReleases.add(key);
    return true;
  });

  return distinct.slice(0, limit).map(({ candidate }) => candidate);
}
