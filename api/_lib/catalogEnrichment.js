import { artistCreditNames, canonicalArtistName, canonicalLabelName, canonicalRelatedArtistName } from "../../src/data/catalogIdentity.js";
import { referenceShippingProfile } from "../../src/data/shippingProfiles.js";
import { archiveRemoteProductImage, isManagedProductImage } from "./productImageStorage.js";

const RECORD_FORMATS = new Set(["Vinyl", "CD", "Cassette"]);
const USED_CONDITION = /^used\b/i;
const MUSICBRAINZ_ORIGIN = "https://musicbrainz.org";
const LASTFM_ORIGIN = "https://ws.audioscrobbler.com";
const USER_AGENT = "NIXP-Catalog/2.0 (https://nix-p.com; contact@nix-p.com)";
// Bump this whenever the related-artist sources or selection rules change.
// Finance sync uses it to re-research older records without touching explicit
// Admin manual overrides.
export const RELATED_ARTIST_RESEARCH_VERSION = "musicbrainz-lastfm-v2";
const RELATED_ARTIST_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MUSICBRAINZ_REQUEST_INTERVAL_MS = 1100;
const LASTFM_REQUEST_INTERVAL_MS = 700;
const VERIFIED_RELATION_TYPES = new Set(["collaboration", "collaborated with", "member of band"]);
const musicBrainzCache = new Map();
const lastFmCache = new Map();
let musicBrainzQueue = Promise.resolve();
let lastMusicBrainzRequestAt = 0;
let lastFmQueue = Promise.resolve();
let lastLastFmRequestAt = 0;
const TRUSTED_REVIEW_SOURCES = new Map([
  ["pitchfork.com", "Pitchfork (quoted)"],
  ["thequietus.com", "The Quietus (quoted)"],
  ["theguardian.com", "The Guardian (quoted)"],
  ["thewire.co.uk", "The Wire (quoted)"],
  ["allmusic.com", "AllMusic (quoted)"],
  ["residentadvisor.net", "Resident Advisor (quoted)"],
  ["stereogum.com", "Stereogum (quoted)"],
  ["tinymixtapes.com", "Tiny Mix Tapes (quoted)"],
  ["boomkat.com", "Boomkat (quoted)"],
  ["factmag.com", "FACT (quoted)"]
]);

// NIXP keeps a local, optimized copy of the public catalog artwork. The
// original source remains in imageCredits; this mapping prevents third-party
// artwork URLs from becoming a storefront runtime dependency.
const ARCHIVED_CATALOG_IMAGES = {
  "NXP-2026-CD-0045": { cover: "/public/covers/nxp-2026-cd-0045-tim-hecker-konoyo.jpg" },
  "NXP-2026-VNL-0013": { cover: "/public/assets/catalog-archive/nxp-2026-vnl-0013-cover.webp" },
  "NXP-2026-VNL-0019": { cover: "/public/assets/catalog-archive/nxp-2026-vnl-0019-cover.webp" },
  "NXP-2026-VNL-0021": { cover: "/public/assets/catalog-archive/nxp-2026-vnl-0021-cover.webp" },
  "NXP-2026-VNL-0022": { cover: "/public/assets/catalog-archive/nxp-2026-vnl-0022-cover.webp" },
  "NXP-2026-VNL-0023": { cover: "/public/assets/catalog-archive/nxp-2026-vnl-0023-cover.webp" },
  "NXP-2026-VNL-0024": { cover: "/public/assets/catalog-archive/nxp-2026-vnl-0024-cover.webp" },
  "NXP-2026-VNL-0025": { cover: "/public/assets/catalog-archive/nxp-2026-vnl-0025-cover.webp" },
  "NXP-2026-VNL-0026": { cover: "/public/assets/catalog-archive/nxp-2026-vnl-0026-cover.webp" },
  "NXP-2026-VNL-0027": { cover: "/public/covers/nxp-2026-vnl-0027-suuns-bambi-discogs-3255271.jpg" },
  "NXP-2026-VNL-0028": {
    cover: "/public/assets/catalog-archive/nxp-2026-vnl-0028-cover.webp",
    productPhoto: "/public/assets/catalog-archive/nxp-2026-vnl-0028-detail-1.webp"
  },
  "NXP-2026-VNL-0029": { cover: "/public/assets/catalog-archive/nxp-2026-vnl-0029-cover.webp" },
  "NXP-2026-VNL-0030": { cover: "/public/assets/catalog-archive/nxp-2026-vnl-0030-cover.webp" },
  "NXP-2026-VNL-0031": { cover: "/public/assets/catalog-archive/nxp-2026-vnl-0031-cover.webp" },
  "NXP-2026-VNL-0032": {
    cover: "/public/assets/catalog-archive/nxp-2026-vnl-0032-cover.webp",
    productPhoto: "/public/assets/catalog-archive/nxp-2026-vnl-0032-detail-1.webp"
  },
  "NXP-2026-VNL-0033": {
    cover: "/public/assets/catalog-archive/nxp-2026-vnl-0033-cover.webp",
    productPhoto: "/public/assets/catalog-archive/nxp-2026-vnl-0033-detail-1.webp"
  },
  "NXP-2026-VNL-0045": { cover: "/public/covers/nxp-2026-vnl-0045-leila-ui.jpg" },
  "NXP-2026-VNL-0046": { cover: "/public/covers/nxp-2026-vnl-0046-citizens-reptile.jpg" },
  "NXP-2026-VNL-0047": { cover: "/public/covers/nxp-2026-vnl-0047-bloc-party-octopus.jpg" }
};

// Exact, reviewed matches take precedence over discovery. These records also
// document the source used for every locally archived catalog image.
export const CURATED_FINANCE_ENRICHMENTS = {
  "NXP-2026-CD-0036": {
    title: "No Interference",
    year: 2001,
    label: "Translation Loss Records",
    edition: "2005 deluxe reissue CD",
    catalogNumber: "TL11",
    barcode: "676941773121",
    cover: "/public/covers/nxp-2026-cd-0036-dysrhythmia-no-interference.jpg",
    imageCredits: [
      {
        image: "/public/covers/nxp-2026-cd-0036-dysrhythmia-no-interference.jpg",
        credit: "Dysrhythmia Bandcamp artwork",
        url: "https://dysrhythmia.bandcamp.com/album/no-interference"
      }
    ],
    description:
      "Dysrhythmia's No Interference was originally self-released in 2001 and later reissued by Translation Loss with five live bonus tracks. Across guitar, bass and drums, the trio treats progressive metal as a precise, restless instrumental conversation rather than verse-chorus songwriting.",
    descriptionSource: "Dysrhythmia Bandcamp / AllMusic",
    reviewQuote: "mathy, funky interludes",
    reviewSource: "AllMusic (quoted)",
    reviewUrl: "https://www.allmusic.com/artist/dysrhythmia-mn0000127155",
    relatedArtists: ["Behold The Arctopus", "Gorguts", "The Dillinger Escape Plan"],
    tags: ["progressive metal", "math metal", "instrumental", "technical metal", "reissue"],
    sourceUrl: "https://dysrhythmia.bandcamp.com/album/no-interference"
  },
  "NXP-2026-CD-0045": {
    title: "Konoyo",
    year: 2018,
    label: "Kranky",
    edition: "CD",
    cover: "/public/covers/nxp-2026-cd-0045-tim-hecker-konoyo.jpg",
    imageCredits: [
      {
        image: "/public/covers/nxp-2026-cd-0045-tim-hecker-konoyo.jpg",
        credit: "Tim Hecker official Bandcamp artwork",
        url: "https://timhecker.bandcamp.com/album/konoyo"
      }
    ],
    description:
      "Recorded in Japan with members of Tokyo Gakuso, Tim Hecker's 2018 album Konoyo folds gagaku winds and percussion into processed electronics, treating ancient instruments and digital sound as equal voices.",
    descriptionSource: "Tim Hecker official Bandcamp / Pitchfork",
    reviewQuote: "the least dense and most inquisitive album of his career",
    reviewSource: "Pitchfork (quoted)",
    reviewUrl: "https://pitchfork.com/reviews/albums/tim-hecker-konoyo/",
    relatedArtists: ["Oneohtrix Point Never", "Nala Sinephro", "Blanck Mass"],
    tags: ["ambient", "electroacoustic", "experimental electronic", "gagaku"],
    sourceUrl: "https://timhecker.bandcamp.com/album/konoyo",
    musicBrainzReleaseId: "ef389c8c-9465-45fa-86e1-efc49f6f3c36"
  },
  "NXP-2026-VNL-0044": {
    title: "Day Of My Death",
    year: 2016,
    label: "Buttechno",
    edition: "LP",
    catalogNumber: "BTX2016",
    cover: "https://ozxkbmexuiuuhjvohxbb.supabase.co/storage/v1/object/public/product-images/products/nxp-2026-vnl-0044-1786461896036-r-9289741-1478026229-9350.jpg",
    productPhoto: "https://ozxkbmexuiuuhjvohxbb.supabase.co/storage/v1/object/public/product-images/products/nxp-2026-vnl-0044-1786461897996-r-9289741-1632646603-6279.jpg",
    imageCredits: [
      {
        image: "https://ozxkbmexuiuuhjvohxbb.supabase.co/storage/v1/object/public/product-images/products/nxp-2026-vnl-0044-1786461896036-r-9289741-1478026229-9350.jpg",
        credit: "NIXP admin upload / Discogs release photography",
        url: "https://www.discogs.com/release/9289741-Buttechno-Day-Of-My-Death"
      },
      {
        image: "https://ozxkbmexuiuuhjvohxbb.supabase.co/storage/v1/object/public/product-images/products/nxp-2026-vnl-0044-1786461897996-r-9289741-1632646603-6279.jpg",
        credit: "NIXP admin upload / Discogs release photography",
        url: "https://www.discogs.com/release/9289741-Buttechno-Day-Of-My-Death"
      }
    ],
    description:
      "Day Of My Death is Pavel Milyakov's 2016 Buttechno LP, written as a noisily poetic soundtrack around Gosha Rubchinskiy's S/S 17 show and moving through ambient guitar haze, synth pressure, spoken-word fragments and bare-bones electro-dub.",
    descriptionSource: "Buttechno Bandcamp / Boomkat",
    reviewQuote: "a must-have bit of the Buttechno catalogue",
    reviewSource: "Boomkat (quoted)",
    reviewUrl: "https://boomkat.com/products/day-of-my-death",
    relatedArtists: ["L.O.T.I.O.N", "The Prodigy", "Suicide", "The Soft Moon"],
    tags: ["techno", "ambient", "industrial", "electro-dub", "soundtrack"],
    sourceUrl: "https://buttechno.bandcamp.com/album/day-of-my-death"
  },
  "NXP-2026-VNL-0045": {
    title: "U&I",
    year: 2012,
    label: "Warp Records",
    edition: "2 x 12-inch LP",
    catalogNumber: "WARPLP220",
    barcode: "0801061022013",
    cover: "/public/covers/nxp-2026-vnl-0045-leila-ui.jpg",
    imageCredits: [{ image: "/public/covers/nxp-2026-vnl-0045-leila-ui.jpg", credit: "Transistora / Warp Records artwork", url: "https://transistora.com.es/leila-ui/" }],
    description: "Leila's 2012 U&I is a double LP made with collaborator Mt. Sims, where clipped electronic rhythms, abrasive synth lines and intimate vocals turn Warp's experimental pop into something darker and more unstable.",
    descriptionSource: "Leila Bandcamp / Warp Records",
    reviewQuote: "more urgent, dysphoric",
    reviewSource: "Boomkat (quoted)",
    reviewUrl: "https://boomkat.com/products/ui618864ecc55a5c336205bf8200ee5902e6fe7737",
    relatedArtists: ["Aphex Twin", "Plaid", "Autechre"],
    tags: ["electronic", "IDM", "experimental pop", "ambient"],
    sourceUrl: "https://leilamusic.bandcamp.com/album/u-i"
  },
  "NXP-2026-VNL-0046": {
    title: "Reptile",
    year: 2012,
    label: "Kitsune Musique",
    edition: "7-inch single",
    catalogNumber: "KITSUNEMUSIC148",
    cover: "/public/covers/nxp-2026-vnl-0046-citizens-reptile.jpg",
    imageCredits: [{ image: "/public/covers/nxp-2026-vnl-0046-citizens-reptile.jpg", credit: "Apple Music / Kitsune Musique artwork", url: "https://music.apple.com/us/album/reptile/1568857758" }],
    description: "Citizens!' 2012 single Reptile places Tom Burke's sleek vocal against Alex Kapranos-produced guitar, synth-pop detail and a tense, nocturnal pulse. The 7-inch arrived through Kitsune ahead of the group's debut album Here We Are.",
    descriptionSource: "Kitsune Musique / NME",
    reviewQuote: "a metallic sheen",
    reviewSource: "NME (quoted)",
    reviewUrl: "https://www.nme.com/reviews/reviews-citizens-13230-311627",
    relatedArtists: ["Blondie", "Bauhaus", "The Soft Moon"],
    tags: ["indie pop", "synth-pop", "post-punk", "new wave"],
    sourceUrl: "https://music.apple.com/us/album/reptile/1568857758"
  },
  "NXP-2026-VNL-0047": {
    title: "Octopus",
    year: 2012,
    label: "Frenchkiss Records",
    edition: "7-inch single",
    catalogNumber: "FKR061A",
    cover: "/public/covers/nxp-2026-vnl-0047-bloc-party-octopus.jpg",
    imageCredits: [{ image: "/public/covers/nxp-2026-vnl-0047-bloc-party-octopus.jpg", credit: "Apple Music / Frenchkiss Records artwork", url: "https://music.apple.com/us/album/octopus-single/674606375" }],
    description: "Bloc Party's 2012 Octopus is a sharp, abrasive 7-inch from the Four era, channeling serrated guitars, nervous dance-punk motion and Kele Okereke's clipped vocal into a compact rush.",
    descriptionSource: "[PIAS] Cooperative / NME",
    reviewQuote: "a raucous, snarling return",
    reviewSource: "NME (quoted)",
    reviewUrl: "https://www.nme.com/news/music/bloc-party-56-1268623",
    relatedArtists: ["Gilla Band", "Blondie", "Bauhaus"],
    tags: ["post-punk", "dance-punk", "indie rock", "alternative rock"],
    sourceUrl: "https://store.pias.com/release/168770-bloc-party-octopus-rac-remix?lang=en_US"
  },
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
    edition: "2023 limited picture disc vinyl reissue",
    cover: "/public/covers/nxp-2026-vnl-0017-gorguts-the-erosion-of-sanity.jpg",
    productPhoto: "/public/product-photos/nxp-2026-vnl-0017-gorguts-the-erosion-of-sanity-discogs-26971880.jpg",
    imageCredits: [
      {
        image: "/public/covers/nxp-2026-vnl-0017-gorguts-the-erosion-of-sanity.jpg",
        credit: "Discogs / Listenable Records",
        url: "https://www.discogs.com/release/26971880-Gorguts-The-Erosion-Of-Sanity"
      },
      {
        image: "/public/product-photos/nxp-2026-vnl-0017-gorguts-the-erosion-of-sanity-discogs-26971880.jpg",
        credit: "Discogs release photography / Listenable Records",
        url: "https://www.discogs.com/release/26971880-Gorguts-The-Erosion-Of-Sanity"
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
    sourceUrl: "https://www.discogs.com/release/26971880-Gorguts-The-Erosion-Of-Sanity"
  },
  "NXP-2026-VNL-0033": {
    title: "Sympathy for Life",
    year: 2021,
    label: "Rough Trade",
    edition: "LP",
    cover: "https://coverartarchive.org/release/2322927f-4aef-404f-851e-bc6dcb079961/front",
    productPhoto: "https://f4.bcbits.com/img/a3739988549_5.jpg",
    imageCredits: [
      { image: "https://coverartarchive.org/release/2322927f-4aef-404f-851e-bc6dcb079961/front", credit: "Cover Art Archive / Rough Trade", url: "https://musicbrainz.org/release/2322927f-4aef-404f-851e-bc6dcb079961" },
      { image: "https://f4.bcbits.com/img/a3739988549_5.jpg", credit: "Parquet Courts official Bandcamp product image", url: "https://parquetcourts.bandcamp.com/album/sympathy-for-life" }
    ],
    description: "Parquet Courts' 2021 Sympathy for Life turns the Brooklyn band's post-punk into a more openly dance-oriented record, built from extended jams, synths and club-minded rhythm.",
    descriptionSource: "Parquet Courts official Bandcamp / MusicBrainz",
    reviewQuote: "broadly accessible",
    reviewSource: "Pitchfork (quoted)",
    reviewUrl: "https://pitchfork.com/reviews/albums/parquet-courts-sympathy-for-life/",
    relatedArtists: ["Animal Collective", "Suuns", "David Byrne"],
    tags: ["post-punk", "dance-rock", "indie rock"],
    sourceUrl: "https://parquetcourts.bandcamp.com/album/sympathy-for-life",
    musicBrainzReleaseId: "2322927f-4aef-404f-851e-bc6dcb079961"
  },
  "NXP-2026-VNL-0032": {
    title: "Wake in Fright",
    year: 2017,
    label: "Sacred Bones Records",
    edition: "LP",
    cover: "https://coverartarchive.org/release/d2192ea8-df3e-42ab-94a2-a0b0d0b3e9ff/front",
    productPhoto: "https://www.sacredbonesrecords.com/cdn/shop/files/Uniform_Wake-in-Fright_RedandWhite.jpg?v=1728594500&width=2000",
    imageCredits: [
      { image: "https://coverartarchive.org/release/d2192ea8-df3e-42ab-94a2-a0b0d0b3e9ff/front", credit: "Cover Art Archive / Sacred Bones Records", url: "https://musicbrainz.org/release/d2192ea8-df3e-42ab-94a2-a0b0d0b3e9ff" },
      { image: "https://www.sacredbonesrecords.com/cdn/shop/files/Uniform_Wake-in-Fright_RedandWhite.jpg?v=1728594500&width=2000", credit: "Sacred Bones Records product photography", url: "https://www.sacredbonesrecords.com/products/sbr170-uniform-wake-in-fright" }
    ],
    description: "Uniform's 2017 Wake in Fright is industrial metal built from hardcore aggression, programmed percussion and power-electronic abrasion, confronting war and self-medication with relentless force.",
    descriptionSource: "Sacred Bones Records / Pitchfork",
    reviewQuote: "fighting back",
    reviewSource: "Pitchfork (quoted)",
    reviewUrl: "https://pitchfork.com/reviews/albums/22737-wake-in-fright/",
    relatedArtists: ["Godflesh", "The Soft Moon", "JK Flesh"],
    tags: ["industrial metal", "noise rock", "hardcore"],
    sourceUrl: "https://www.sacredbonesrecords.com/products/sbr170-uniform-wake-in-fright",
    musicBrainzReleaseId: "d2192ea8-df3e-42ab-94a2-a0b0d0b3e9ff"
  },
  "NXP-2026-VNL-0031": {
    title: "Speechless",
    year: 2016,
    label: "SPE:C",
    edition: "12-inch EP",
    cover: "https://f4.bcbits.com/img/a3731298365_5.jpg",
    productPhoto: "https://f4.bcbits.com/img/a3731298365_5.jpg",
    imageCredits: [{ image: "https://f4.bcbits.com/img/a3731298365_5.jpg", credit: "SPE:C official Bandcamp release image", url: "https://specrecords.bandcamp.com/album/trans-am-speechless-spe-c-002" }],
    description: "Trans Am's 2016 Speechless is a compact electronic and techno-leaning collaboration from the Washington, D.C. trio, issued through Berlin label SPE:C as a 12-inch release.",
    descriptionSource: "SPE:C official Bandcamp / Boomkat",
    reviewQuote: "Techno / House",
    reviewSource: "Boomkat (catalog description)",
    reviewUrl: "https://boomkat.com/artists/trans-am",
    relatedArtists: ["Squarepusher", "The Chemical Brothers", "Animal Collective"],
    tags: ["techno", "electronic", "12-inch"],
    sourceUrl: "https://specrecords.bandcamp.com/album/trans-am-speechless-spe-c-002"
  },
  "NXP-2026-VNL-0030": {
    title: "Preoccupations",
    year: 2016,
    label: "Jagjaguwar / Flemish Eye",
    edition: "LP",
    cover: "https://coverartarchive.org/release/e8747635-0bd4-4cfc-97b5-97f224b0b2cd/front",
    productPhoto: "https://coverartarchive.org/release/e8747635-0bd4-4cfc-97b5-97f224b0b2cd/front",
    imageCredits: [{ image: "https://coverartarchive.org/release/e8747635-0bd4-4cfc-97b5-97f224b0b2cd/front", credit: "Cover Art Archive / Jagjaguwar", url: "https://musicbrainz.org/release/e8747635-0bd4-4cfc-97b5-97f224b0b2cd" }],
    description: "Preoccupations' 2016 self-titled album is a tense, melodic post-punk record that follows the Calgary group beyond its earlier Viet Cong identity into sharper, more expansive arrangements.",
    descriptionSource: "Jagjaguwar / Pitchfork",
    reviewQuote: "the vitality of the music",
    reviewSource: "Pitchfork (quoted)",
    reviewUrl: "https://pitchfork.com/reviews/albums/22407-preoccupations/",
    relatedArtists: ["Viet Cong", "Women", "Ought"],
    tags: ["post-punk", "art punk", "noise rock"],
    sourceUrl: "https://musicbrainz.org/release/e8747635-0bd4-4cfc-97b5-97f224b0b2cd",
    musicBrainzReleaseId: "e8747635-0bd4-4cfc-97b5-97f224b0b2cd"
  },
  "NXP-2026-VNL-0029": {
    title: "Vortrack",
    year: 2020,
    label: "Warp Records",
    edition: "12-inch single",
    cover: "https://coverartarchive.org/release/d7373248-ae08-4bd8-a848-8b12c70bd88b/front",
    productPhoto: "https://coverartarchive.org/release/d7373248-ae08-4bd8-a848-8b12c70bd88b/front",
    imageCredits: [{ image: "https://coverartarchive.org/release/d7373248-ae08-4bd8-a848-8b12c70bd88b/front", credit: "Cover Art Archive / Warp Records", url: "https://musicbrainz.org/release/d7373248-ae08-4bd8-a848-8b12c70bd88b" }],
    description: "Squarepusher's 2020 Vortrack is an eerie Warp single built from submerged acid, intricate breakbeats and the futuristic hardware sound that drives Be Up a Hello.",
    descriptionSource: "Warp Records / The Guardian",
    reviewQuote: "devilish and danceable",
    reviewSource: "The Guardian (quoted)",
    reviewUrl: "https://www.theguardian.com/music/2020/jan/31/squarepusher-be-up-a-hello-review-warp-records",
    relatedArtists: ["Oneohtrix Point Never", "Nala Sinephro", "The Chemical Brothers"],
    tags: ["IDM", "acid", "breakbeat"],
    sourceUrl: "https://www.theguardian.com/music/2020/jan/31/squarepusher-be-up-a-hello-review-warp-records",
    musicBrainzReleaseId: "d7373248-ae08-4bd8-a848-8b12c70bd88b"
  },
  "NXP-2026-VNL-0028": {
    title: "Odd Scene / Shit Luck",
    year: 2018,
    label: "Sacred Bones Records",
    edition: "12-inch single",
    cover: "https://f4.bcbits.com/img/a1165591995_5.jpg",
    productPhoto: "https://f4.bcbits.com/img/a1165591995_16.jpg",
    imageCredits: [{ image: "https://f4.bcbits.com/img/a1165591995_16.jpg", credit: "Blanck Mass official Bandcamp release image", url: "https://blanckmass.bandcamp.com/album/odd-scene-shit-luck" }],
    description: "Blanck Mass' 2018 Odd Scene / Shit Luck single pushes Benjamin John Power's electronics toward industrial metal, combining blown-out synths, noise and physical rhythmic impact.",
    descriptionSource: "Sacred Bones / The Skinny",
    reviewQuote: "immensely danceable",
    reviewSource: "The Skinny (quoted)",
    reviewUrl: "https://www.theskinny.co.uk/music/live-music/reviews/blanck-mass-summerhall-edinburgh-12-mar",
    relatedArtists: ["Uniform", "The Soft Moon", "Pharmakon"],
    tags: ["industrial", "noise", "electronic"],
    sourceUrl: "https://blanckmass.bandcamp.com/album/odd-scene-shit-luck"
  },
  "NXP-2026-VNL-0027": {
    title: "Bambi",
    year: 2011,
    label: "Secretly Canadian",
    edition: "12-inch single",
    cover: "/public/covers/nxp-2026-vnl-0027-suuns-bambi-discogs-3255271.jpg",
    productPhoto: "/public/covers/nxp-2026-vnl-0027-suuns-bambi-discogs-3255271.jpg",
    imageCredits: [{ image: "/public/covers/nxp-2026-vnl-0027-suuns-bambi-discogs-3255271.jpg", credit: "Discogs / Secretly Canadian", url: "https://www.discogs.com/release/3255271-Suuns-Bambi" }],
    description: "Suuns' Bambi is a dark, guitar-led 12-inch single from the Montreal band's early period, moving between intimate electronic atmosphere and a sharper post-industrial attack.",
    descriptionSource: "Secretly Canadian / KEXP",
    reviewQuote: "terrifying power",
    reviewSource: "KEXP (quoted)",
    reviewUrl: "https://www.kexp.org/read/2013/3/2/album-review-suuns-images-du-futur/",
    relatedArtists: ["Preoccupations", "Viet Cong", "Jerusalem In My Heart"],
    tags: ["post-punk", "electronic", "12-inch"],
    sourceUrl: "https://www.discogs.com/release/3255271-Suuns-Bambi",
    musicBrainzReleaseId: "ac2611e4-fa10-47f1-a328-8fad3c73cb49"
  },
  "NXP-2026-VNL-0026": {
    title: "Lexachast",
    year: 2019,
    label: "PAN",
    edition: "LP",
    cover: "https://coverartarchive.org/release/69cf0f01-df57-4ec6-ad3d-e43573ba958f/front",
    productPhoto: "https://coverartarchive.org/release/69cf0f01-df57-4ec6-ad3d-e43573ba958f/front",
    imageCredits: [{ image: "https://coverartarchive.org/release/69cf0f01-df57-4ec6-ad3d-e43573ba958f/front", credit: "Cover Art Archive / PAN", url: "https://musicbrainz.org/release/69cf0f01-df57-4ec6-ad3d-e43573ba958f" }],
    description: "Amnesia Scanner and Bill Kouligas' 2019 Lexachast expands an audiovisual collaboration into a PAN album of algorithmic, cybernetic and uncanny electronic sound.",
    descriptionSource: "PAN / The FADER",
    reviewQuote: "decisive inquietude",
    reviewSource: "The FADER (quoted)",
    reviewUrl: "https://www.thefader.com/2016/01/06/bill-kouligas-amnesia-scanner-harm-van-den-dorpel-share-lexachast",
    relatedArtists: ["Arca", "Oneohtrix Point Never", "Toxe"],
    tags: ["experimental electronic", "PAN", "A/V"],
    sourceUrl: "https://boomkat.com/products/lexachast",
    musicBrainzReleaseId: "69cf0f01-df57-4ec6-ad3d-e43573ba958f"
  },
  "NXP-2026-VNL-0025": {
    title: "Blinks",
    year: 2018,
    label: "PAN",
    edition: "12-inch EP",
    cover: "https://coverartarchive.org/release/3b8d34c7-9cf7-4f21-a6ed-354e7bf2da52/front",
    productPhoto: "https://coverartarchive.org/release/3b8d34c7-9cf7-4f21-a6ed-354e7bf2da52/front",
    imageCredits: [{ image: "https://coverartarchive.org/release/3b8d34c7-9cf7-4f21-a6ed-354e7bf2da52/front", credit: "Cover Art Archive / PAN", url: "https://musicbrainz.org/release/3b8d34c7-9cf7-4f21-a6ed-354e7bf2da52" }],
    description: "Toxe's 2018 Blinks EP turns precise drums, synthetic color and playful world-building into four bright, unstable electronic club miniatures for PAN.",
    descriptionSource: "PAN / Tiny Mix Tapes",
    reviewQuote: "a vibrant, buoyant mess of sound",
    reviewSource: "Tiny Mix Tapes (quoted)",
    reviewUrl: "https://www.tinymixtapes.com/music-review/toxe-blinks",
    relatedArtists: ["Amnesia Scanner", "Arca", "SOPHIE"],
    tags: ["experimental club", "electronic", "EP"],
    sourceUrl: "https://boomkat.com/products/blinks",
    musicBrainzReleaseId: "3b8d34c7-9cf7-4f21-a6ed-354e7bf2da52"
  },
  "NXP-2026-VNL-0024": {
    title: "Maggot Mass",
    year: 2024,
    label: "Sacred Bones Records",
    edition: "LP",
    cover: "https://coverartarchive.org/release/9c4a70fc-8984-4585-97d2-ef672b650034/front",
    productPhoto: "https://coverartarchive.org/release/9c4a70fc-8984-4585-97d2-ef672b650034/front",
    imageCredits: [{ image: "https://coverartarchive.org/release/9c4a70fc-8984-4585-97d2-ef672b650034/front", credit: "Cover Art Archive / Sacred Bones Records", url: "https://musicbrainz.org/release/9c4a70fc-8984-4585-97d2-ef672b650034" }],
    description: "Pharmakon's 2024 Maggot Mass reshapes death industrial into a more structured and volatile album, with Margaret Chardiet turning electronic abrasion into bodily tension.",
    descriptionSource: "Sacred Bones / Metal Trenches",
    reviewQuote: "most significant changes",
    reviewSource: "Metal Trenches (quoted)",
    reviewUrl: "https://metaltrenches.com/reviews/pharmakon-maggot-mass-album-review-4038",
    relatedArtists: ["Uniform", "Blanck Mass", "The Soft Moon"],
    tags: ["death industrial", "noise", "power electronics"],
    sourceUrl: "https://musicbrainz.org/release/9c4a70fc-8984-4585-97d2-ef672b650034",
    musicBrainzReleaseId: "9c4a70fc-8984-4585-97d2-ef672b650034"
  },
  "NXP-2026-VNL-0020": {
    title: "Steppin Up / Meds And Feds",
    year: 2010,
    label: "XL Recordings",
    edition: "12-inch single",
    cover: "/public/assets/products/mia-steppin-up-meds-and-feds-discogs.jpg",
    productPhoto: "/public/assets/products/mia-steppin-up-meds-and-feds-discogs.jpg",
    imageCredits: [{ image: "/public/assets/products/mia-steppin-up-meds-and-feds-discogs.jpg", credit: "Discogs / XL Recordings", url: "https://www.discogs.com/release/2338373-MIA-Steppin-Up-Meds-And-Feds" }],
    description: "M.I.A.'s 2010 Steppin Up / Meds And Feds 12-inch pairs two of the most abrasive cuts from the Maya era, driven by industrial beats, digital dissonance and XL's classic sleeve design.",
    descriptionSource: "XL Recordings / Apple Music",
    reviewQuote: "a non-stop assault of throbbing industrial beats",
    reviewSource: "Apple Music (quoted)",
    reviewUrl: "https://music.apple.com/th/album/y/1544491734",
    relatedArtists: ["Arca", "SOPHIE", "The Chemical Brothers"],
    tags: ["experimental hip-hop", "electronic", "12-inch"],
    sourceUrl: "https://www.banquetrecords.com/m.i.a./steppin-up-meds-and-feds/XLT505"
  },
  "NXP-2026-CD-0037": {
    title: "Skullgrid",
    year: 2007,
    label: "Black Market Activities",
    edition: "CD",
    catalogNumber: "BMA 021-2",
    barcode: "039841465020",
    cover: "https://coverartarchive.org/release/fff27b9d-0d98-474c-b5ca-93ccefaf6574/front",
    imageCredits: [{ image: "https://coverartarchive.org/release/fff27b9d-0d98-474c-b5ca-93ccefaf6574/front", credit: "Cover Art Archive / Black Market Activities", url: "https://musicbrainz.org/release/fff27b9d-0d98-474c-b5ca-93ccefaf6574" }],
    description: "Behold... the Arctopus' 2007 debut full-length turns the trio of guitar, Warr guitar and drums into a densely composed instrumental collision of progressive metal, free-jazz complexity and technical extremity.",
    descriptionSource: "Behold the Arctopus Bandcamp / MusicBrainz",
    reviewQuote: "Not for the faint of heart",
    reviewSource: "Sputnikmusic (quoted)",
    reviewUrl: "https://www.sputnikmusic.com/review/28174/Behold...-The-Arctopus-Skullgrid/",
    relatedArtists: ["Dysrhythmia", "Gorguts", "The Dillinger Escape Plan"],
    tags: ["avant-garde metal", "technical metal", "instrumental", "progressive metal"],
    sourceUrl: "https://beholdthearctopus.bandcamp.com/album/skullgrid",
    musicBrainzReleaseId: "fff27b9d-0d98-474c-b5ca-93ccefaf6574"
  },
  "NXP-2026-CD-0038": {
    title: "Post-Nothing",
    year: 2009,
    label: "Polyvinyl",
    edition: "CD",
    catalogNumber: "PRC-184-2",
    barcode: "644110018427",
    cover: "https://coverartarchive.org/release/2b6bb8ca-6b18-3ece-afc7-3e72ef3145d6/front",
    imageCredits: [{ image: "https://coverartarchive.org/release/2b6bb8ca-6b18-3ece-afc7-3e72ef3145d6/front", credit: "Cover Art Archive / Polyvinyl", url: "https://musicbrainz.org/release/2b6bb8ca-6b18-3ece-afc7-3e72ef3145d6" }],
    description: "Japandroids' Post-Nothing is the Vancouver duo's 2009 debut: ten concise, overdriven songs built from Brian King and David Prowse's guitars, drums, hooks and shouted release.",
    descriptionSource: "Japandroids Bandcamp / MusicBrainz",
    reviewQuote: "terminally catchy music played with punk's enthusiasm and velocity",
    reviewSource: "Pitchfork (quoted)",
    reviewUrl: "https://pitchfork.com/reviews/albums/12965-post-nothing/",
    relatedArtists: ["Preoccupations", "Parquet Courts", "Suuns"],
    tags: ["garage rock", "indie rock", "punk", "noise pop"],
    sourceUrl: "https://japandroids.bandcamp.com/album/post-nothing",
    musicBrainzReleaseId: "2b6bb8ca-6b18-3ece-afc7-3e72ef3145d6"
  },
  "NXP-2026-CD-0039": {
    title: "J2",
    year: 2008,
    label: "The End Records",
    edition: "CD",
    catalogNumber: "TE096",
    barcode: "654436009627",
    cover: "https://coverartarchive.org/release/cca61b7c-15b6-4e83-b247-516d6409834b/front",
    imageCredits: [{ image: "https://coverartarchive.org/release/cca61b7c-15b6-4e83-b247-516d6409834b/front", credit: "Cover Art Archive / The End Records", url: "https://musicbrainz.org/release/cca61b7c-15b6-4e83-b247-516d6409834b" }],
    description: "J2 is Jarboe and Justin K. Broadrick's 2008 collaboration, pairing Jarboe's voice and keyboards with Broadrick's guitar, programming and production across a dark, slow-moving electronic record.",
    descriptionSource: "The Living Jarboe / MusicBrainz",
    reviewQuote: "dark electronica, laced, bound, and gagged with goth, psychedelia, and metal",
    reviewSource: "Pitchfork (quoted)",
    reviewUrl: "https://pitchfork.com/reviews/albums/11272-j2/",
    relatedArtists: ["JK Flesh", "The Soft Moon", "Melt-Banana"],
    tags: ["dark ambient", "industrial", "experimental", "collaboration"],
    sourceUrl: "https://thelivingjarboe.com/about/",
    musicBrainzReleaseId: "cca61b7c-15b6-4e83-b247-516d6409834b"
  },
  "NXP-2026-CD-0040": {
    title: "Cryptomnesia",
    year: 2009,
    label: "Rodriguez-Lopez Productions",
    edition: "CD",
    catalogNumber: "SHRLP001CD",
    barcode: "613481019524",
    cover: "https://f4.bcbits.com/img/a2016704080_5.jpg",
    imageCredits: [{ image: "https://f4.bcbits.com/img/a2016704080_5.jpg", credit: "Omar Rodriguez-Lopez official Bandcamp artwork", url: "https://orlprojects.bandcamp.com/album/el-grupo-nuevo-de-omar-rodr-guez-l-pez-cryptomnesia" }],
    description: "El Grupo Nuevo de Omar Rodriguez-Lopez's 2009 Cryptomnesia brings Omar Rodriguez-Lopez, Cedric Bixler-Zavala, Juan Alderete, Jonathan Hischke and Zach Hill together for a restless experimental-rock record first recorded in 2006.",
    descriptionSource: "AllMusic / MusicBrainz",
    reviewQuote: "Ruthlessly experimental",
    reviewSource: "Sputnikmusic (quoted)",
    reviewUrl: "https://www.sputnikmusic.com/review/44308/El-Grupo-Nuevo-de-Omar-Rodriguez-Lopez-Cryptomnesia/",
    relatedArtists: ["Zach Hill", "The Dillinger Escape Plan", "Melt-Banana"],
    tags: ["experimental rock", "math rock", "progressive rock"],
    sourceUrl: "https://www.allmusic.com/album/cryptomnesia-mw0000818186",
    musicBrainzReleaseId: "e4372642-8d04-478a-bcba-058c13209f56"
  },
  "NXP-2026-CD-0041": {
    title: "Irony Is a Dead Scene",
    year: 2002,
    label: "Epitaph Europe",
    edition: "CD EP",
    catalogNumber: "6658-2",
    barcode: "8714092665826",
      cover: "https://res.cloudinary.com/epitaph/image/upload/c_fill,f_auto,h_925,q_auto,w_925/v1/epitaph/releases/0045778665860.png",
      imageCredits: [{ image: "https://res.cloudinary.com/epitaph/image/upload/c_fill,f_auto,h_925,q_auto,w_925/v1/epitaph/releases/0045778665860.png", credit: "Epitaph Records official artwork", url: "https://epitaph-prod.herokuapp.com/artists/dillinger-escape-plan/release/irony-is-a-dead-scene-ep" }],
    description: "The Dillinger Escape Plan's 2002 EP with Mike Patton captures the group between vocal eras, expanding its mathcore precision with Patton's volatile range, noise experiments and a cover of Aphex Twin's Come to Daddy.",
    descriptionSource: "AllMusic / MusicBrainz",
    reviewQuote: "Equal parts noise, chaos, and insanity",
    reviewSource: "Sputnikmusic (quoted)",
    reviewUrl: "https://www.sputnikmusic.com/review/1681/The-Dillinger-Escape-Plan-Irony-Is-a-Dead-Scene/",
    relatedArtists: ["Melt-Banana", "Behold The Arctopus", "Dysrhythmia"],
    tags: ["mathcore", "experimental metal", "noise", "EP"],
    sourceUrl: "https://www.allmusic.com/album/irony-is-a-dead-scene-mw0000726595",
    musicBrainzReleaseId: "1a1d7f1a-0a98-4290-b0dd-a8424e4be7ce"
  },
  "NXP-2026-CD-0042": {
    title: "Age Of",
    year: 2018,
    label: "Warp Records",
    edition: "Japan CD",
    catalogNumber: "BRC-570",
    barcode: "4523132111704",
    cover: "https://coverartarchive.org/release/46f66a2f-b782-47b4-9095-2ef933e1e7c7/front",
    imageCredits: [{ image: "https://coverartarchive.org/release/46f66a2f-b782-47b4-9095-2ef933e1e7c7/front", credit: "Cover Art Archive / Warp Records", url: "https://musicbrainz.org/release/46f66a2f-b782-47b4-9095-2ef933e1e7c7" }],
    description: "Oneohtrix Point Never's 2018 Age Of frames Daniel Lopatin's electronic collage work as a fractured pop record, with synthesized medievalism, orchestral colour and vocals from collaborators including ANOHNI and James Blake.",
    descriptionSource: "Beatink / Warp Records",
    reviewQuote: "his most apocalyptic record",
    reviewSource: "Pitchfork (quoted)",
    reviewUrl: "https://pitchfork.com/reviews/albums/oneohtrix-point-never-age-of/",
    relatedArtists: ["Arca", "SOPHIE", "Amnesia Scanner"],
    tags: ["electronic", "experimental pop", "ambient", "Warp"],
    sourceUrl: "https://www.beatink.com/products/detail.php?product_id=9576",
    musicBrainzReleaseId: "46f66a2f-b782-47b4-9095-2ef933e1e7c7"
  },
  "NXP-2026-CD-0043": {
    title: "444",
    year: 2023,
    label: "Tzadik",
    edition: "CD",
    catalogNumber: "TZ 8398",
    barcode: "702397839828",
    cover: "https://coverartarchive.org/release/d9aa131a-8140-4fd0-ae64-3a0d70eec10c/front",
    imageCredits: [{ image: "https://coverartarchive.org/release/d9aa131a-8140-4fd0-ae64-3a0d70eec10c/front", credit: "Cover Art Archive / Tzadik", url: "https://musicbrainz.org/release/d9aa131a-8140-4fd0-ae64-3a0d70eec10c" }],
    description: "John Zorn's 444 is a 2023 Tzadik release for the core trio of Zorn, Bill Laswell and Dave Lombardo, moving through compact compositions shaped by improvisation, electric bass and percussion.",
    descriptionSource: "John Zorn Resource / MusicBrainz",
    reviewQuote: "the music is never repeating itself",
    reviewSource: "Free Jazz Collective (quoted)",
    reviewUrl: "https://www.freejazzblog.org/2023/08/john-zorn-fourth-way-and-444.html",
    relatedArtists: ["Melt-Banana", "Behold The Arctopus", "The Dillinger Escape Plan"],
    tags: ["avant-garde jazz", "improvisation", "Tzadik"],
    sourceUrl: "https://johnzornresource.com/444",
    musicBrainzReleaseId: "d9aa131a-8140-4fd0-ae64-3a0d70eec10c"
  },
  "NXP-2026-CD-0044": {
    title: "Hell Songs",
    year: 2006,
    label: "Daymare Recordings",
    edition: "CD",
    catalogNumber: "DYMC-003",
    barcode: "4988044630031",
    cover: "https://f4.bcbits.com/img/a2291248793_10.jpg",
    imageCredits: [{ image: "https://f4.bcbits.com/img/a2291248793_10.jpg", credit: "Daughters official Bandcamp artwork", url: "https://daughters.bandcamp.com/album/hell-songs" }],
    description: "Daughters' 2006 Hell Songs recasts the Providence group's earlier grindcore velocity as a more angular, queasy and theatrical noise-rock record, with Alexis Marshall's vocals shifting from screams to strained spoken and sung forms.",
    descriptionSource: "Daughters official Bandcamp / Pitchfork",
    reviewQuote: "techy grindcore",
    reviewSource: "Pitchfork (quoted)",
    reviewUrl: "https://pitchfork.com/reviews/albums/9339-hell-songs/",
    relatedArtists: ["The Dillinger Escape Plan", "Melt-Banana", "The Locust"],
    tags: ["mathcore", "noise rock", "experimental hardcore"],
    sourceUrl: "https://daughters.bandcamp.com/album/hell-songs",
    musicBrainzReleaseId: "666d4e9f-0b12-42ba-afe4-e1627d5072d0"
  },
  "NXP-2026-CD-0046": {
    title: "Guider",
    year: 2011,
    label: "Kranky",
    edition: "CD",
    catalogNumber: "KRANK151",
    cover: "https://f4.bcbits.com/img/a1580005518_10.jpg",
    imageCredits: [{ image: "https://f4.bcbits.com/img/a1580005518_10.jpg", credit: "Disappears official Bandcamp artwork", url: "https://disappears.bandcamp.com/album/guider" }],
    description: "Disappears' 2011 Guider is a Chicago post-punk record that turns repetition, motorik momentum and blown-out guitar into long-form, darkly physical songs for Kranky.",
    descriptionSource: "Disappears official Bandcamp / MusicBrainz",
    reviewQuote: "deliciously dense and dark",
    reviewSource: "Tiny Mix Tapes (quoted)",
    reviewUrl: "https://www.tinymixtapes.com/music-review/Disappears-Guider",
    relatedArtists: ["Suuns", "Preoccupations", "The Soft Moon"],
    tags: ["post-punk", "krautrock", "noise rock"],
    sourceUrl: "https://disappears.bandcamp.com/album/guider",
    musicBrainzReleaseId: "3c312340-b5c1-4bee-aa83-eec6167a8d79"
  },
  "NXP-2026-CD-0047": {
    title: "Pre Language",
    year: 2012,
    label: "Kranky",
    edition: "CD",
    catalogNumber: "KRANK164",
    cover: "https://f4.bcbits.com/img/a3809228563_10.jpg",
    imageCredits: [{ image: "https://f4.bcbits.com/img/a3809228563_10.jpg", credit: "Disappears official Bandcamp artwork", url: "https://disappears.bandcamp.com/album/pre-language" }],
    description: "With Sonic Youth drummer Steve Shelley now a full member, Disappears' 2012 Pre Language compresses the band's repetition-heavy guitars, psych undertow and post-punk tension into its sharpest Kranky release.",
    descriptionSource: "Disappears official Bandcamp / Pitchfork",
    reviewQuote: "most concise account of Disappears' music to date",
    reviewSource: "Pitchfork (quoted)",
    reviewUrl: "https://pitchfork.com/reviews/albums/16343-pre-language/",
    relatedArtists: ["Suuns", "Preoccupations", "The Soft Moon"],
    tags: ["post-punk", "krautrock", "psychedelic rock"],
    sourceUrl: "https://disappears.bandcamp.com/album/pre-language",
    musicBrainzReleaseId: "b5f851d6-3426-4f49-b28b-b28cc0b19d2a"
  },
  "NXP-2026-CD-0048": {
    title: "Animals as Leaders",
    year: 2015,
    label: "Prosthetic Records",
    edition: "Encore Edition CD",
    catalogNumber: "PRST102442.2",
    barcode: "656191024426",
    cover: "https://f4.bcbits.com/img/a2095209033_10.jpg",
    imageCredits: [{ image: "https://f4.bcbits.com/img/a2095209033_10.jpg", credit: "Animals as Leaders official Bandcamp artwork", url: "https://animalsasleaders.bandcamp.com/album/animals-as-leaders" }],
    description: "Animals as Leaders' self-titled debut is an instrumental progressive-metal record centred on Tosin Abasi's extended-range guitar work, programmed rhythm, electronic detail and sharply changing dynamics; this CD corresponds to the 2015 Encore Edition.",
    descriptionSource: "Animals as Leaders official Bandcamp / Apple Music",
    reviewQuote: "there IS melody and fine ear",
    reviewSource: "AllMusic (quoted)",
    reviewUrl: "https://www.allmusic.com/album/animals-as-leaders-mw0000815011",
    relatedArtists: ["Meshuggah", "The Dillinger Escape Plan", "Gorguts"],
    tags: ["progressive metal", "instrumental", "djent"],
    sourceUrl: "https://animalsasleaders.bandcamp.com/album/animals-as-leaders",
    musicBrainzReleaseId: "b8ce00cd-e1a1-438b-a861-c2a222e601d5"
  },
  "NXP-2026-CD-0049": {
    title: "Safety Second, Body Last",
    year: 2005,
    label: "Ipecac Recordings",
    edition: "CD EP",
    catalogNumber: "IPC-061",
    barcode: "689230006121",
    cover: "https://f4.bcbits.com/img/a0687189290_10.jpg",
    imageCredits: [{ image: "https://f4.bcbits.com/img/a0687189290_10.jpg", credit: "The Locust official Bandcamp artwork", url: "https://thelocust.bandcamp.com/album/safety-second-body-last" }],
    description: "The Locust's 2005 Ipecac EP Safety Second, Body Last stretches the San Diego group's manic noise-rock into two linked pieces, alternating blast-beat acceleration, synthetic detail and moments of unnerving space.",
    descriptionSource: "The Locust official Bandcamp / Scene Point Blank",
    reviewQuote: "their most diverse material",
    reviewSource: "Scene Point Blank (quoted)",
    reviewUrl: "https://www.scenepointblank.com/reviews/the-locust/safety-second-body-last/",
    relatedArtists: ["Daughters", "Melt-Banana", "The Dillinger Escape Plan"],
    tags: ["noise rock", "hardcore", "experimental punk", "EP"],
    sourceUrl: "https://thelocust.bandcamp.com/album/safety-second-body-last",
    musicBrainzReleaseId: "3c1f186e-66ca-4b0d-a078-4a83995bfec7"
  },
  "NXP-2026-CD-0050": {
    title: "Pretest",
    year: 2003,
    label: "Relapse Records",
    edition: "CD",
    catalogNumber: "RR 6572-2",
    barcode: "781676657223",
    cover: "https://f4.bcbits.com/img/a3564087154_10.jpg",
    imageCredits: [{ image: "https://f4.bcbits.com/img/a3564087154_10.jpg", credit: "Dysrhythmia official Bandcamp artwork", url: "https://dysrhythmia.bandcamp.com/album/pretest" }],
    description: "Dysrhythmia's 2003 Pretest is the instrumental trio's first album for Relapse, recorded with Steve Albini and built from intricate guitar, bass and drum compositions that move between progressive metal, math rock and free-jazz tension.",
    descriptionSource: "Dysrhythmia official Bandcamp / Relapse Records",
    reviewQuote: "economic-yet-detailed",
    reviewSource: "Lollipop Magazine (quoted)",
    reviewUrl: "https://lollipopmagazine.com/2003/09/dysrhythmia-pretest-review/",
    relatedArtists: ["Behold The Arctopus", "Gorguts", "The Dillinger Escape Plan"],
    tags: ["progressive metal", "math metal", "instrumental"],
    sourceUrl: "https://dysrhythmia.bandcamp.com/album/pretest",
    musicBrainzReleaseId: "74ac1aa8-f962-4cf6-bec1-40fa5a172df3"
  },
  "NXP-2026-VNL-0034": {
    title: "Bag of Max Bag of Cass",
    year: 2025,
    label: "Warp Records",
    edition: "1xLP, limited to 1000 copies",
    catalogNumber: "WARPLP414",
    barcode: "5056818804700",
    cover: "https://f4.bcbits.com/img/a0245441444_5.jpg",
    productPhoto: "https://meditations.jp/cdn/shop/files/0041023271_10_1024x.jpg?v=1758159917",
    imageCredits: [
      { image: "https://f4.bcbits.com/img/a0245441444_5.jpg", credit: "Warp Records Bandcamp artwork", url: "https://warprecords.bandcamp.com/album/bag-of-max-bag-of-cass" },
      { image: "https://meditations.jp/cdn/shop/files/0041023271_10_1024x.jpg?v=1758159917", credit: "Meditations product photography", url: "https://meditations.jp/products/zach-hill-lucas-abela-bag-of-max-bag-of-cass-lp" }
    ],
    description: "Zach Hill and Lucas Abela's 2025 Bag of Max Bag of Cass is a limited Warp LP built from Hill's processed electronic drumming and Abela's amplified glass, modular noise and abrasion.",
    descriptionSource: "Warp Records Bandcamp / Boomkat",
    reviewQuote: "Probably the noisiest Warp release",
    reviewSource: "Boomkat (quoted)",
    reviewUrl: "https://boomkat.com/products/bag-of-max-bag-of-cass",
    relatedArtists: ["Melt-Banana", "The Dillinger Escape Plan", "Dysrhythmia"],
    tags: ["noise", "free improvisation", "power electronics", "Warp"],
    sourceUrl: "https://warprecords.bandcamp.com/album/bag-of-max-bag-of-cass",
    musicBrainzReleaseId: "5b91a691-c3c3-4e7f-bd50-5c58243347b3"
  },
  "NXP-2026-VNL-0035": {
    title: "Again",
    year: 2023,
    label: "Warp Records",
    edition: "Blue 2xLP",
    catalogNumber: "WARPLP365I",
    cover: "https://f4.bcbits.com/img/a4277554650_5.jpg",
    productPhoto: "https://f4.bcbits.com/img/0033616954_10.jpg",
    imageCredits: [
      { image: "https://f4.bcbits.com/img/a4277554650_5.jpg", credit: "Oneohtrix Point Never Bandcamp artwork", url: "https://oneohtrixpointnever.bandcamp.com/album/again" },
      { image: "https://f4.bcbits.com/img/0033616954_10.jpg", credit: "Oneohtrix Point Never Bandcamp product photography", url: "https://oneohtrixpointnever.bandcamp.com/album/again" }
    ],
    description: "Oneohtrix Point Never's 2023 Again is Daniel Lopatin's speculative autobiography in album form, moving between orchestral electronics, distorted rock colour and intimate synthetic pop across a blue double-vinyl edition.",
    descriptionSource: "Warp Records / Bleep",
    reviewQuote: "a nostalgic jam session",
    reviewSource: "Pitchfork (quoted)",
    reviewUrl: "https://pitchfork.com/reviews/albums/oneohtrix-point-never-again/",
    relatedArtists: ["Arca", "SOPHIE", "Amnesia Scanner"],
    tags: ["electronic", "experimental pop", "2LP", "Warp"],
    sourceUrl: "https://warp.net/products/410494-again",
    musicBrainzReleaseId: "facdf955-7ded-45f1-ad9b-835e16bbebd2"
  },
  "NXP-2026-VNL-0036": {
    title: "JIL SANDER SOUND ZINE",
    year: 2026,
    label: "JIL SANDER",
    edition: "Sound zine with clear flexi disc",
    cover: "https://www.jilsander.com/dw/image/v2/BGNJ_PRD/on/demandware.static/-/Library-Sites-jilsander-shared/default/dw492c75ab/projects/cisco/cover_1080x1350.jpg",
    productPhoto: "https://www.jilsander.com/dw/image/v2/BGNJ_PRD/on/demandware.static/-/Library-Sites-jilsander-shared/default/dw72645a8d/projects/cisco/s1_01.jpg",
    imageCredits: [
      { image: "https://www.jilsander.com/dw/image/v2/BGNJ_PRD/on/demandware.static/-/Library-Sites-jilsander-shared/default/dw492c75ab/projects/cisco/cover_1080x1350.jpg", credit: "JIL SANDER project photography", url: "https://www.jilsander.com/en-au/jil-sander-sounds-presents-cisco-records/jil-sander-sounds-presents-cisco-records.html" },
      { image: "https://www.jilsander.com/dw/image/v2/BGNJ_PRD/on/demandware.static/-/Library-Sites-jilsander-shared/default/dw72645a8d/projects/cisco/s1_01.jpg", credit: "JIL SANDER project photography", url: "https://www.jilsander.com/en-au/jil-sander-sounds-presents-cisco-records/jil-sander-sounds-presents-cisco-records.html" }
    ],
    description: "JIL SANDER SOUND ZINE is the 2026 printed and audio companion to the brand's Cisco Records project in Tokyo. Its inaugural Music and Environment issue includes a flexi disc carrying Laurel Halo's music for the Fall/Winter 2026 show.",
    descriptionSource: "JIL SANDER / HOUYHNHNM",
    reviewQuote: "Bridging new and old influences",
    reviewSource: "Glass HK (quoted)",
    reviewUrl: "https://www.theglassmagazine.hk/index.php/2026/04/01/inside-jil-sanders-celebration-of-sound-with-cisco/",
    relatedArtists: ["Oneohtrix Point Never", "Daniel Lopatin", "Nala Sinephro"],
    tags: ["sound art", "zine", "flexi disc", "fashion publishing"],
    sourceUrl: "https://www.jilsander.com/en-au/jil-sander-sounds-presents-cisco-records/jil-sander-sounds-presents-cisco-records.html"
  },
  "NXP-2026-VNL-0042": {
    title: "Digital Control And Man's Obsolescence",
    year: 2015,
    label: "La Vida Es Un Mus",
    edition: "LP with obi strip, poster and lyric sheet",
    catalogNumber: "MUS103",
    cover: "https://f4.bcbits.com/img/a0997716829_10.jpg",
    imageCredits: [
      {
        image: "https://f4.bcbits.com/img/a0997716829_10.jpg",
        credit: "L.O.T.I.O.N. official Bandcamp artwork",
        url: "https://lotionmultinationalcorporation.bandcamp.com/album/digital-control-and-mans-obsolescence-lp"
      }
    ],
    description:
      "Digital Control And Man's Obsolescence is the 2015 debut LP from New York's L.O.T.I.O.N., pushing hardcore punk through electronic body music, industrial paranoia and digital-hardcore pressure.",
    descriptionSource: "La Vida Es Un Mus / Bandcamp",
    reviewQuote: "Perhaps the most punk on the album",
    reviewSource: "CVLT Nation (quoted)",
    reviewUrl: "https://cvltnation.com/l-o-t-i-o-n-digital-control-and-mans-obsolescence-review-full-stream/",
    relatedArtists: ["The Prodigy", "Nine Inch Nails", "Suicide", "The Soft Moon"],
    tags: ["industrial punk", "digital hardcore", "electronic punk", "hardcore", "New York"],
    sourceUrl: "https://lotionmultinationalcorporation.bandcamp.com/album/digital-control-and-mans-obsolescence-lp"
  },
  "NXP-2026-VNL-0019": {
    title: "Shirt",
    year: 2024,
    label: "Domino",
    edition: "LP",
    cover: "https://coverartarchive.org/release/6ae505ac-d729-4388-9c74-b9e7e041a7d0/front",
    productPhoto: "https://coverartarchive.org/release/6ae505ac-d729-4388-9c74-b9e7e041a7d0/front",
    imageCredits: [{ image: "https://coverartarchive.org/release/6ae505ac-d729-4388-9c74-b9e7e041a7d0/front", credit: "Cover Art Archive / Domino Records", url: "https://musicbrainz.org/release/6ae505ac-d729-4388-9c74-b9e7e041a7d0" }],
    description: "Porches' 2024 Shirt is Aaron Maine's heaviest and most distorted album, turning existential anxiety and everyday distress into raw, uncanny rock songs.",
    descriptionSource: "Domino / Pitchfork",
    reviewQuote: "the heaviest songs he's recorded to date",
    reviewSource: "Pitchfork (quoted)",
    reviewUrl: "https://pitchfork.com/reviews/albums/porches-shirt/",
    relatedArtists: ["Animal Collective", "Alex G", "Daniel Lopatin"],
    tags: ["indie rock", "alternative", "experimental pop"],
    sourceUrl: "https://porchesmusic.bandcamp.com/album/shirt",
    musicBrainzReleaseId: "6ae505ac-d729-4388-9c74-b9e7e041a7d0"
  },
  "NXP-2026-VNL-0048": {
    artist: "Second Storey & Appleblim",
    title: "EP01 (Second Storey & Appleblim Present: ALSO)",
    year: 2014,
    label: "R&S Records",
    edition: "12-inch EP",
    catalogNumber: "RS1414B",
    cover: "https://is1-ssl.mzstatic.com/image/thumb/Music60/v4/5c/d9/b2/5cd9b24a-ae1f-2924-9c90-ae950baeb0b4/cover.jpg/1200x1200bb.jpg",
    imageCredits: [{ image: "https://is1-ssl.mzstatic.com/image/thumb/Music60/v4/5c/d9/b2/5cd9b24a-ae1f-2924-9c90-ae950baeb0b4/cover.jpg/1200x1200bb.jpg", credit: "Apple Music / R&S Records artwork", url: "https://music.apple.com/ng/album/ep01-second-storey-appleblim-present-also-single/1105885511" }],
    description: "EP01 is the 2014 debut of ALSO, the project shared by Second Storey and Appleblim. Their R&S 12-inch turns electro, broken rhythms and dark club pressure into three concise, machine-driven tracks.",
    descriptionSource: "Apple Music / XLR8R",
    reviewQuote: "darker, crunchier, and moodier",
    reviewSource: "Boomkat (quoted)",
    reviewUrl: "https://boomkat.com/products/ep01-f823bc8a-ca03-46ca-896f-4b413972a31e",
    relatedArtists: ["Blawan", "Buttechno", "Overmono"],
    tags: ["techno", "electro", "broken beat", "club music"],
    sourceUrl: "https://xlr8r.com/news/appleblim-and-second-storey-prep-debut-ep-as-also-for-r-s/"
  },
  "NXP-2026-VNL-0049": {
    title: "Glass Boys",
    year: 2014,
    label: "Matador",
    edition: "LP",
    catalogNumber: "OLE-1049-1",
    cover: "https://i.discogs.com/BS0mvB_56DL5Zzp3imkq6G220vOEZE0bJqs1i3fte64/rs:fit/g:sm/q:90/h:600/w:600/czM6Ly9kaXNjb2dz/LWRhdGFiYXNlLWlt/YWdlcy9SLTU3NDUz/NzUtMTUxMjIyODU5/NC0yODA5LmpwZWc.jpeg",
    productPhoto: "https://i.discogs.com/y_5vKBhLWD8YEQbA90Krz3w8-7dUynEQJNF4WTyGpFo/rs:fit/g:sm/q:90/h:600/w:600/czM6Ly9kaXNjb2dz/LWRhdGFiYXNlLWlt/YWdlcy9SLTU3NDUz/NzUtMTUxMjIyODYz/MS00ODA1LmpwZWc.jpeg",
    imageCredits: [{ image: "https://i.discogs.com/BS0mvB_56DL5Zzp3imkq6G220vOEZE0bJqs1i3fte64/rs:fit/g:sm/q:90/h:600/w:600/czM6Ly9kaXNjb2dz/LWRhdGFiYXNlLWlt/YWdlcy9SLTU3NDUz/NzUtMTUxMjIyODU5/NC0yODA5LmpwZWc.jpeg", credit: "Discogs / Matador release photography", url: "https://www.discogs.com/release/5745375-Fucked-Up-Glass-Boys" }],
    description: "Fucked Up's 2014 Glass Boys is a dense, personal album where the Toronto group expands beyond hardcore without letting go of its physical charge.",
    descriptionSource: "Pitchfork / Matador",
    reviewQuote: "a relatively compact, dense piece of metacriticism",
    reviewSource: "Pitchfork (quoted)",
    reviewUrl: "https://pitchfork.com/reviews/albums/19400-fucked-up-glass-boys/",
    relatedArtists: ["Gilla Band", "The Dillinger Escape Plan", "Blanck Mass"],
    tags: ["post-hardcore", "punk", "noise rock", "indie rock"],
    sourceUrl: "https://www.discogs.com/release/5745375-Fucked-Up-Glass-Boys"
  },
  "NXP-2026-VNL-0050": {
    artist: "Jaydee & Second Phase",
    title: "In Order To Dance (Remix Sampler Vol. 2)",
    year: 2008,
    label: "R&S Records",
    edition: "12-inch sampler",
    catalogNumber: "RS 0804",
    cover: "https://i.discogs.com/dLNjGaQ4v6-YBnS7_jDBaBpr8_z1-JEZNijedjZ4PUk/rs:fit/g:sm/q:90/h:600/w:595/czM6Ly9kaXNjb2dz/LWRhdGFiYXNlLWlt/YWdlcy9SLTE0OTA5/MDItMTU4OTc4MDA5/Ni00NzM2LmpwZWc.jpeg",
    productPhoto: "https://i.discogs.com/0eHW4-JXSVAz8jm9vTK2NKfhRaC1lXTldRXyCB8Gj04/rs:fit/g:sm/q:90/h:600/w:587/czM6Ly9kaXNjb2dz/LWRhdGFiYXNlLWlt/YWdlcy9SLTE0OTA5/MDItMTU4OTc4MDA5/My0yMDEyLmpwZWc.jpeg",
    imageCredits: [{ image: "https://i.discogs.com/dLNjGaQ4v6-YBnS7_jDBaBpr8_z1-JEZNijedjZ4PUk/rs:fit/g:sm/q:90/h:600/w:595/czM6Ly9kaXNjb2dz/LWRhdGFiYXNlLWlt/YWdlcy9SLTE0OTA5/MDItMTU4OTc4MDA5/Ni00NzM2LmpwZWc.jpeg", credit: "Discogs / R&S Records release photography", url: "https://www.discogs.com/release/1490902-Jaydee-Second-Phase-In-Order-To-Dance-Remix-Sampler-Vol-2" }],
    description: "This 2008 R&S sampler pairs Audion's revision of Jaydee's Plastic Dreams with Redshape's rework of Second Phase's Mentasm, bringing two foundational club records into a later techno context.",
    descriptionSource: "Vinylminded / MusicBrainz",
    reviewQuote: "two foundational club records",
    reviewSource: "NIXP editorial note",
    reviewUrl: "https://www.vinyl-minded.com/release/1490902/Jaydee-and-Second-Phase-In-Order-To-Dance-%28Remix-Sampler-Vol.-2%29",
    relatedArtists: ["Blawan", "Buttechno", "Squarepusher"],
    tags: ["techno", "house", "rave", "remix"],
    sourceUrl: "https://www.discogs.com/release/1490902-Jaydee-Second-Phase-In-Order-To-Dance-Remix-Sampler-Vol-2"
  },
  "NXP-2026-VNL-0051": {
    title: "Performing Human",
    year: 2016,
    label: "Rough Trade",
    edition: "12-inch single",
    catalogNumber: "RTRADST807",
    barcode: "883870080712",
    cover: "https://i.discogs.com/mWz16mPTB92DaeigsR7lO7JLiaGBhm2qM2M76i9Jw6A/rs:fit/g:sm/q:90/h:600/w:597/czM6Ly9kaXNjb2dz/LWRhdGFiYXNlLWlt/YWdlcy9SLTkwNDU0/OTctMTU2Njg3MDA1/Mi02MTI1LmpwZWc.jpeg",
    productPhoto: "https://i.discogs.com/Hgd2PNENQH7a9hm4dGUllC_RqlPgBz48qJy-5gOpkTw/rs:fit/g:sm/q:90/h:600/w:595/czM6Ly9kaXNjb2dz/LWRhdGFiYXNlLWlt/YWdlcy9SLTkwNDU0/OTctMTQ3NDY0MzYx/Mi00NTI4LmpwZWc.jpeg",
    imageCredits: [{ image: "https://i.discogs.com/mWz16mPTB92DaeigsR7lO7JLiaGBhm2qM2M76i9Jw6A/rs:fit/g:sm/q:90/h:600/w:597/czM6Ly9kaXNjb2dz/LWRhdGFiYXNlLWlt/YWdlcy9SLTkwNDU0/OTctMTU2Njg3MDA1/Mi02MTI1LmpwZWc.jpeg", credit: "Discogs / Rough Trade release photography", url: "https://www.discogs.com/release/9045497-Parquet-Courts-Performing-Human" }],
    description: "Performing Human is Parquet Courts' 2016 Rough Trade 12-inch, extending the nervous guitars, deadpan hooks and emotional unease of the Human Performance period.",
    descriptionSource: "Rough Trade / The Guardian",
    reviewQuote: "sublime slice of brooding garage rock",
    reviewSource: "The Guardian (quoted)",
    reviewUrl: "https://www.theguardian.com/music/2016/apr/10/parquet-courts-human-performance-review",
    relatedArtists: ["Gilla Band", "Girl Band", "Blondie", "Bauhaus"],
    tags: ["post-punk", "garage rock", "indie rock", "New York"],
    sourceUrl: "https://www.discogs.com/release/9045497-Parquet-Courts-Performing-Human"
  },
  "NXP-2026-VNL-0052": {
    title: "Heart Of Data",
    year: 2018,
    label: "H/O/D Records",
    edition: "12-inch single",
    catalogNumber: "H/O/D001",
    cover: "https://i.discogs.com/NwhO_dvzUQoI8g9MBC0LPIQln6zu36n2Gk1JqYCqG2c/rs:fit/g:sm/q:90/h:600/w:589/czM6Ly9kaXNjb2dz/LWRhdGFiYXNlLWlt/YWdlcy9SLTExNTM4/MDg2LTE1MjI5NDI1/NjgtNTc0OS5qcGVn.jpeg",
    productPhoto: "https://i.discogs.com/vSNWp-MITDbo6x5TcY__QLdIsi16_zrrR7er4StLpXs/rs:fit/g:sm/q:90/h:599/w:600/czM6Ly9kaXNjb2dz/LWRhdGFiYXNlLWlt/YWdlcy9SLTExNTM4/MDg2LTE1MTgxMTU4/MjQtODExNC5qcGVn.jpeg",
    imageCredits: [{ image: "https://i.discogs.com/NwhO_dvzUQoI8g9MBC0LPIQln6zu36n2Gk1JqYCqG2c/rs:fit/g:sm/q:90/h:600/w:589/czM6Ly9kaXNjb2dz/LWRhdGFiYXNlLWlt/YWdlcy9SLTExNTM4/MDg2LTE1MjI5NDI1/NjgtNTc0OS5qcGVn.jpeg", credit: "Discogs / H/O/D Records release photography", url: "https://www.discogs.com/release/11538086-Factory-Floor-Heart-Of-Data" }],
    description: "Factory Floor's 2018 Heart Of Data / Babel 12-inch distils the London trio's industrial pulse into stark, repetitive techno structures for its H/O/D Records imprint.",
    descriptionSource: "Discogs / Apple Music",
    reviewQuote: "stark, repetitive techno structures",
    reviewSource: "NIXP editorial note",
    reviewUrl: "https://www.discogs.com/release/11538086-Factory-Floor-Heart-Of-Data",
    relatedArtists: ["Blawan", "The Soft Moon", "Nine Inch Nails"],
    tags: ["techno", "industrial", "minimal", "post-punk"],
    sourceUrl: "https://www.discogs.com/release/11538086-Factory-Floor-Heart-Of-Data"
  },
  "NXP-2026-VNL-0053": {
    title: "Isn't It Now?",
    year: 2023,
    label: "Domino",
    edition: "2 x LP",
    catalogNumber: "WIGLP528",
    cover: "https://i.discogs.com/xmjAphCqCekQh72ju6FxY92246xdjdvbI6sr4ve-jVk/rs:fit/g:sm/q:90/h:600/w:600/czM6Ly9kaXNjb2dz/LWRhdGFiYXNlLWlt/YWdlcy9SLTI4NDI5/NDA4LTE2OTU5NDI5/NTctNjk4Ni5qcGVn.jpeg",
    productPhoto: "https://i.discogs.com/J1Q6MCqFO57ADT-wLpKuZJBuNqTzlgmHB_jmr3UsZQU/rs:fit/g:sm/q:90/h:600/w:417/czM6Ly9kaXNjb2dz/LWRhdGFiYXNlLWlt/YWdlcy9SLTI4NDI5/NDA4LTE2OTU5NDI5/NjMtMjQ3Ni5qcGVn.jpeg",
    imageCredits: [{ image: "https://i.discogs.com/xmjAphCqCekQh72ju6FxY92246xdjdvbI6sr4ve-jVk/rs:fit/g:sm/q:90/h:600/w:600/czM6Ly9kaXNjb2dz/LWRhdGFiYXNlLWlt/YWdlcy9SLTI4NDI5/NDA4LTE2OTU5NDI5/NTctNjk4Ni5qcGVn.jpeg", credit: "Discogs / Domino release photography", url: "https://www.discogs.com/release/28429408-Animal-Collective-Isnt-It-Now" }],
    description: "Animal Collective's 2023 double LP Isn't It Now? is their longest album, drawing its psychedelic pop, layered vocals and open-ended arrangements from the same songwriting period as Time Skiffs.",
    descriptionSource: "Domino / Pitchfork",
    reviewQuote: "one of the album's most thrilling highs",
    reviewSource: "Pitchfork (quoted)",
    reviewUrl: "https://pitchfork.com/reviews/albums/animal-collective-isnt-it-now/",
    relatedArtists: ["Panda Bear", "Avey Tare", "Boards Of Canada", "Daniel Lopatin"],
    tags: ["psychedelic pop", "experimental pop", "indie rock", "electronic"],
    sourceUrl: "https://www.discogs.com/release/28429408-Animal-Collective-Isnt-It-Now"
  },
  "NXP-2026-VNL-0054": {
    title: "New Avatar",
    year: 2026,
    label: "Warp Records",
    edition: "LP",
    cover: "https://f4.bcbits.com/img/a1820018607_10.jpg",
    productPhoto: "https://f4.bcbits.com/img/a1820018607_5.jpg",
    imageCredits: [
      {
        image: "https://f4.bcbits.com/img/a1820018607_10.jpg",
        credit: "Kelela official Bandcamp artwork",
        url: "https://kelela.bandcamp.com/album/new-avatar-2"
      },
      {
        image: "https://f4.bcbits.com/img/a1820018607_5.jpg",
        credit: "Kelela official Bandcamp release photography",
        url: "https://kelela.bandcamp.com/album/new-avatar-2"
      }
    ],
    description: "Kelela's 2026 New Avatar turns her alternative R&B language toward shoegaze guitars, grunge textures and electronic space, drawing on the D.C. indie roots that preceded her club work.",
    descriptionSource: "Kelela official Bandcamp / Pitchfork",
    reviewQuote: "another immersive evolution",
    reviewSource: "Pitchfork (quoted)",
    reviewUrl: "https://pitchfork.com/reviews/albums/kelela-new-avatar/",
    relatedArtists: ["Arca", "SOPHIE", "Oneohtrix Point Never"],
    tags: ["alternative R&B", "shoegaze", "electronic", "experimental pop"],
    sourceUrl: "https://kelela.bandcamp.com/album/new-avatar-2"
  },
  "NXP-2026-VNL-0055": {
    title: "Lavender Networks",
    year: 2026,
    label: "Warp Records",
    edition: "12-inch vinyl",
    catalogNumber: "WARPLP509",
    cover: "https://f4.bcbits.com/img/a1777662215_10.jpg",
    productPhoto: "https://f4.bcbits.com/img/a1777662215_5.jpg",
    imageCredits: [
      {
        image: "https://f4.bcbits.com/img/a1777662215_10.jpg",
        credit: "Fire-Toolz official Bandcamp artwork",
        url: "https://fire-toolz.bandcamp.com/album/lavender-networks"
      },
      {
        image: "https://f4.bcbits.com/img/a1777662215_5.jpg",
        credit: "Fire-Toolz official Bandcamp release photography",
        url: "https://fire-toolz.bandcamp.com/album/lavender-networks"
      }
    ],
    description: "Fire-Toolz's 2026 Lavender Networks is Angel Marcloid's Warp debut, a maximalist collision of black and death metal, scorched electronics, jazz fusion and moments of melodramatic beauty.",
    descriptionSource: "Fire-Toolz official Bandcamp / Pitchfork",
    reviewQuote: "a step up on the approachable scale",
    reviewSource: "Pitchfork (quoted)",
    reviewUrl: "https://pitchfork.com/reviews/albums/fire-toolz-lavender-networks/",
    relatedArtists: ["Zola Jesus", "Nailah Hunter", "Brothertiger"],
    tags: ["experimental electronic", "black metal", "jazz fusion", "industrial"],
    sourceUrl: "https://fire-toolz.bandcamp.com/album/lavender-networks"
  },
  "NXP-2026-VNL-0056": {
    title: "Mood Valiant",
    year: 2021,
    label: "Brainfeeder",
    edition: "LP",
    catalogNumber: "BFDNL112",
    barcode: "5054429148053",
    cover: "https://f4.bcbits.com/img/a1741986296_10.jpg",
    productPhoto: "https://f4.bcbits.com/img/a1741986296_5.jpg",
    imageCredits: [
      {
        image: "https://f4.bcbits.com/img/a1741986296_10.jpg",
        credit: "Hiatus Kaiyote official Bandcamp artwork",
        url: "https://hiatuskaiyote.bandcamp.com/album/mood-valiant"
      },
      {
        image: "https://f4.bcbits.com/img/a1741986296_5.jpg",
        credit: "Hiatus Kaiyote official Bandcamp release photography",
        url: "https://hiatuskaiyote.bandcamp.com/album/mood-valiant"
      }
    ],
    description: "Hiatus Kaiyote's 2021 Mood Valiant is a focused Brainfeeder album where future soul, jazz, strings and pop songwriting meet the Melbourne quartet's detailed rhythmic language.",
    descriptionSource: "Hiatus Kaiyote official Bandcamp / NME",
    reviewQuote: "their most focused album with more classic songs than epic jams",
    reviewSource: "NME (quoted)",
    reviewUrl: "https://www.nme.com/reviews/album/hiatus-kaiyote-mood-valiant-review-2977032",
    relatedArtists: ["Flying Lotus", "Thundercat", "Nai Palm"],
    tags: ["future soul", "neo-soul", "jazz", "experimental pop"],
    sourceUrl: "https://hiatuskaiyote.bandcamp.com/album/mood-valiant"
  }
};

// Editorial overrides supplement a discovered physical release without
// replacing its verified edition, artwork, barcode, or catalog metadata.
// They are used when a trusted publication is not reliably crawlable from a
// serverless runtime but the exact source has been reviewed by NIXP.
export const CURATED_EDITORIAL_OVERRIDES = {
  "NXP-2026-VNL-0041": {
    reviewQuote: "the most notable and successful being the dub-inflected, heavily dramatic ‘She's in Parties’",
    reviewSource: "AllMusic (quoted)",
    reviewUrl: "https://www.allmusic.com/album/burning-from-the-inside-mw0000652112",
    relatedArtists: ["The Soft Moon", "Nine Inch Nails", "David Bowie"]
  }
};

export function applyCuratedEditorialOverride(discovered, sku) {
  if (!discovered) return discovered;
  const override = CURATED_EDITORIAL_OVERRIDES[String(sku || "").trim().toUpperCase()];
  if (!override) return discovered;
  const { relatedArtists: _legacyRelatedArtists, ...verifiedEditorial } = override;
  return {
    ...discovered,
    ...verifiedEditorial
  };
}

export async function enrichFinanceCatalogProduct(row, stock = {}, { catalogArtists = [] } = {}) {
  const format = String(stock.item || row.format || "").trim();
  const submittedTitle = String(stock.title || "").trim();
  const title = (isPlaceholderInventoryTitle(submittedTitle) ? String(row.title || "") : submittedTitle).trim();
  const sku = String(stock.sku || row.sku || "").trim().toUpperCase();
  const curated = CURATED_FINANCE_ENRICHMENTS[sku];
  const artist = canonicalArtistName(curated?.artist || stock.artist || row.artist || "");
  const price = Number(stock.sellingPrice || row.price || 0);
  const openToOffers = stock.listingMode === "Private Collection / Offer Only" || stock.open_to_offers === true || row.open_to_offers === true;
  const minimumAcceptableOffer = wholeAmount(stock.minimumAcceptableOffer ?? row.minimum_acceptable_offer ?? row.raw?.minimumAcceptableOffer);

  if (!RECORD_FORMATS.has(format) || !title || !artist || (openToOffers ? !minimumAcceptableOffer : price <= 0)) {
    return finalizeStatus(row, { publishable: false, status: "needs-finance-data" });
  }

  const editorialOverride = CURATED_EDITORIAL_OVERRIDES[sku] || {};
  const discoveredSource = applyCuratedEditorialOverride(
    curated || (await discoverMusicBrainzRelease({ ...stock, format, title, artist }).catch(() => null)),
    sku
  );
  const discovered = await archiveDiscoveredImages(applyArchivedCatalogImages(discoveredSource, sku), sku, usedCondition(stock.itemCondition || row.condition));
  if (!discovered) {
    return finalizeStatus(row, {
      publishable: false,
      status: "needs-release-match",
      enrichmentFingerprint: inventoryFingerprint({ ...stock, artist, title, format }),
      enrichmentAttemptedAt: new Date().toISOString()
    });
  }

  const raw = row.raw || {};
  const used = usedCondition(stock.itemCondition || row.condition);
  const previousAutoCover = String(raw.autoCover || "").trim();
  const previousAutoProductPhoto = String(raw.autoProductPhoto || "").trim();
  const currentImages = unique([row.image, ...(Array.isArray(row.images) ? row.images : [])])
    .filter(isUsableImage)
    .filter((image) => image !== previousAutoCover)
    .filter((image) => !used || image !== previousAutoProductPhoto);
  const discoveredImages = used
    ? unique([discovered.cover])
    : unique([discovered.cover, discovered.productPhoto]);
  const images = currentImages.length ? unique([...currentImages, ...discoveredImages]) : discoveredImages;
  const existingCover =
    isUsableImage(row.image) && row.image !== previousAutoCover && (!used || row.image !== previousAutoProductPhoto) ? row.image : "";
  const cover = existingCover || discovered.cover || images[0] || "";
  const imageCredits = mergeCredits(row.image_credits || raw.imageCredits, discovered.imageCredits);
  const savedEdition = String(raw.edition || "").trim();
  const edition = editionMatchesFormat(savedEdition, format) ? savedEdition || discovered.edition || "" : discovered.edition || savedEdition;
  const replaceStoredEdition = Boolean(savedEdition && discovered.edition && !editionMatchesFormat(savedEdition, format));
  const details = unique([
    ...(Array.isArray(row.details) ? row.details : []).filter((detail) => !replaceStoredEdition || !String(detail).startsWith("Edition:")),
    `SKU: ${sku}`,
    `Format: ${format}`,
    stock.itemCondition ? `Condition: ${stock.itemCondition}` : "",
    edition ? `Edition: ${edition}` : "",
    discovered.catalogNumber ? `Catalog number: ${discovered.catalogNumber}` : "",
    discovered.barcode ? `Barcode: ${discovered.barcode}` : ""
  ]).filter((detail) => detail && !detail.startsWith("Created from finance inventory"));
  const automatic = raw.autoEditorial || {};
  const description = chooseEditorialValue(row.description, automatic.description, discovered.description);
  const descriptionSource = chooseEditorialValue(raw.descriptionSource, automatic.descriptionSource, discovered.descriptionSource);
  const reviewQuote = chooseEditorialValue(raw.reviewQuote, automatic.reviewQuote, discovered.reviewQuote || "");
  const reviewSource = chooseEditorialValue(raw.reviewSource, automatic.reviewSource, discovered.reviewSource || "");
  const reviewUrl = chooseEditorialValue(raw.reviewUrl, automatic.reviewUrl, discovered.reviewUrl || "");
  const researchedRelatedArtists = discovered.relatedArtistResearch || await researchRelatedArtists({
    artist,
    title: discovered.title || title,
    format,
    releaseId: discovered.musicBrainzReleaseId || raw.musicBrainzReleaseId || ""
  });
  const manualRelatedArtists = Array.isArray(raw.manualRelatedArtists)
    ? raw.manualRelatedArtists.map(canonicalRelatedArtistName)
    : [];
  const curatedRelatedArtists = unique((discovered.relatedArtists || []).map(canonicalRelatedArtistName));
  const relatedArtistResearch = researchedRelatedArtists?.artists?.length || !curatedRelatedArtists.length
    ? researchedRelatedArtists
    : {
        ...researchedRelatedArtists,
        status: "curated-exact-release",
        source: [researchedRelatedArtists.source, "NIXP exact-release editorial fallback"].filter(Boolean).join(" + "),
        artists: curatedRelatedArtists,
        evidence: [
          ...(researchedRelatedArtists.evidence || []),
          { source: "NIXP exact-release editorial fallback", artists: curatedRelatedArtists }
        ]
      };
  const automaticRelatedArtists = unique((relatedArtistResearch.artists || []).map(canonicalRelatedArtistName));
  const legacyManualOverride = Array.isArray(raw.manualRelatedArtists) &&
    JSON.stringify(manualRelatedArtists) !== JSON.stringify(
      unique((raw.autoEditorial?.relatedArtists || []).map(canonicalRelatedArtistName))
    );
  const manualRelatedArtistsOverride = raw.manualRelatedArtistsOverride === true || legacyManualOverride;
  // An explicit Admin edit is authoritative for the storefront. Automatic
  // research is still retained below for evidence and future review, but a
  // later Finance sync must not re-add an artist the Admin deliberately removed.
  const relatedArtistDisplay = resolveRelatedArtistDisplay({
    manualRelatedArtists,
    automaticRelatedArtists,
    manualRelatedArtistsOverride
  });
  const relatedArtists = relatedArtistDisplay.relatedArtists;
  const relatedArtistEvidence = relatedArtistResearch.evidence || [];
  const enrichmentFingerprint = inventoryFingerprint({ ...stock, artist, title, format });
  const shipping = referenceShippingProfile(
    { ...row, format, display_format: format, edition, details },
    raw.shipping
  );
  const product = {
    ...row,
    title: discovered.title || row.title,
    artist,
    format,
    display_format: format,
    price,
    open_to_offers: openToOffers,
    minimum_acceptable_offer: openToOffers ? minimumAcceptableOffer : null,
    year: Number(discovered.year || row.year || new Date().getFullYear()),
    label: canonicalLabelName(discovered.label || row.label || ""),
    collection: discovered.label || row.collection || row.label || "",
    image: cover,
    images,
    image_credits: imageCredits,
    tags: unique([...(row.tags || []), ...(discovered.tags || [])]),
    details,
    description,
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
      open_to_offers: openToOffers,
      minimumAcceptableOffer: openToOffers ? minimumAcceptableOffer : null,
      year: Number(discovered.year || row.year || new Date().getFullYear()),
      label: canonicalLabelName(discovered.label || row.label || ""),
      collection: discovered.label || row.collection || row.label || "",
      image: cover,
      images,
      imageCredits,
      tags: unique([...(row.tags || []), ...(discovered.tags || [])]),
      details,
      description,
      edition,
      barcode: raw.barcode || discovered.barcode || "",
      catalogNumber: raw.catalogNumber || discovered.catalogNumber || "",
      relatedArtists,
      manualRelatedArtists,
      manualRelatedArtistsOverride,
      relatedArtistEvidence,
      relatedArtistsResearch: relatedArtistResearch,
      relatedArtistResearchVersion: RELATED_ARTIST_RESEARCH_VERSION,
      descriptionSource,
      reviewQuote,
      reviewSource,
      reviewUrl,
      metadataSourceUrl: discovered.sourceUrl || "",
      musicBrainzReleaseId: discovered.musicBrainzReleaseId || "",
      autoCover: discovered.cover || previousAutoCover,
      autoProductPhoto: used ? "" : discovered.productPhoto || previousAutoProductPhoto,
      autoEditorial: {
        description,
        descriptionSource,
        reviewQuote,
        reviewSource,
        reviewUrl,
        relatedArtists: automaticRelatedArtists,
        relatedArtistEvidence,
        relatedArtistsResearch: relatedArtistResearch,
        relatedArtistResearchVersion: RELATED_ARTIST_RESEARCH_VERSION
      },
      enrichmentFingerprint,
      enrichmentOrigin: curated ? "curated-exact" : Object.keys(editorialOverride).length ? "musicbrainz+curated-editorial" : "musicbrainz",
      enrichmentStatus: enrichmentStatus({ used, discovered, description, relatedArtists, relatedArtistResearch, reviewQuote, reviewSource, reviewUrl, manualRelatedArtistsOverride }),
      enrichmentUpdatedAt: today(),
      enrichmentAttemptedAt: new Date().toISOString(),
      shipping
    }
  };
  return finalizeStatus(product, {
    publishable: hasCatalogCore(product) && ["complete", "complete-no-related-artists"].includes(product.raw.enrichmentStatus),
    status: product.raw.enrichmentStatus
  });
}

async function archiveDiscoveredImages(discovered, sku, used) {
  if (!discovered) return discovered;
  const coverResult = await archiveRemoteProductImage({ url: discovered.cover, sku, role: "cover" });
  const photoResult = used
    ? { url: "", archived: true }
    : await archiveRemoteProductImage({ url: discovered.productPhoto, sku, role: "detail-1" });
  const sourceImages = new Map([
    [String(discovered.cover || ""), coverResult.url],
    [String(discovered.productPhoto || ""), photoResult.url]
  ]);
  return {
    ...discovered,
    cover: coverResult.url,
    productPhoto: photoResult.url,
    imageCredits: (discovered.imageCredits || []).map((credit) => ({
      ...credit,
      image: sourceImages.get(String(credit.image || "")) || credit.image
    }))
  };
}

function applyArchivedCatalogImages(discovered, sku) {
  if (!discovered) return discovered;
  const archived = ARCHIVED_CATALOG_IMAGES[sku];
  if (!archived) return discovered;
  const sourceCover = discovered.cover;
  const sourceProductPhoto = discovered.productPhoto;
  const mapImage = (image) => {
    if (image === sourceCover && archived.cover) return archived.cover;
    if (image === sourceProductPhoto && archived.productPhoto) return archived.productPhoto;
    return image;
  };
  return {
    ...discovered,
    cover: archived.cover || discovered.cover,
    productPhoto: archived.productPhoto || discovered.productPhoto,
    imageCredits: (discovered.imageCredits || []).map((credit) => ({ ...credit, image: mapImage(credit.image) }))
  };
}

async function discoverMusicBrainzRelease(stock) {
  const query = [
    `artist:"${escapeQuery(stock.artist)}"`,
    `release:"${escapeQuery(stock.title)}"`
  ].join(" AND ");
  const response = await musicBrainzFetch(
    `${MUSICBRAINZ_ORIGIN}/ws/2/release/?query=${encodeURIComponent(query)}&fmt=json&limit=25&inc=labels+artist-credits+media+release-groups`
  );
  if (!response?.ok) return null;
  const payload = await response.json();
  const format = String(stock.format || stock.item || "").toLowerCase();
  const expectedTitle = normalizedText(stock.title);
  const barcode = String(stock.barcode || "").replace(/\D/g, "");
  const catalogNumber = normalizedText(stock.catalogNumber);
  let releases = Array.isArray(payload.releases) ? payload.releases : [];
  let release = chooseMusicBrainzRelease(releases, { stock, expectedTitle, format, barcode, catalogNumber });

  // MusicBrainz can return no usable candidate for a legitimate release when
  // punctuation, collaboration credits, or missing format metadata differs
  // from Finance. Retry once with a title-focused query, then keep the same
  // conservative exact-title and verified-artist gate before accepting it.
  if (!release) {
    const fallbackQuery = `release:"${escapeQuery(stock.title)}"`;
    const fallbackResponse = await musicBrainzFetch(
      `${MUSICBRAINZ_ORIGIN}/ws/2/release/?query=${encodeURIComponent(fallbackQuery)}&fmt=json&limit=50&inc=labels+artist-credits+media+release-groups`
    );
    if (fallbackResponse?.ok) {
      const fallbackPayload = await fallbackResponse.json();
      releases = Array.isArray(fallbackPayload.releases) ? fallbackPayload.releases : [];
      release = chooseMusicBrainzRelease(releases, { stock, expectedTitle, format, barcode, catalogNumber });
    }
  }
  if (!release) return null;

  const labelInfo = release["label-info"] || [];
  const labels = unique(labelInfo.map((entry) => entry.label?.name));
  const catalogNumbers = unique(labelInfo.map((entry) => entry["catalog-number"]));
  // Some legitimate editions have no release-level image in Cover Art
  // Archive even though the release group has verified front artwork. Use
  // that artwork only after the exact release/artist match above succeeds.
  const artwork = await discoverCoverArt(release.id, release["release-group"]?.id);
  const cover = artwork.cover;
  const year = Number(String(release.date || "").slice(0, 4)) || 0;
  const label = labels.join(" / ");
  const edition = unique([
    release.packaging,
    ...(release.media || []).map((medium) => medium.format)
  ]).join(" / ");
  const [releaseGroup, pitchforkReview, relatedArtistResearch] = await Promise.all([
    discoverReleaseGroup(release["release-group"]?.id),
    discoverPitchforkReview({ artist: stock.artist, title: release.title }),
    researchRelatedArtists({ artist: stock.artist, title: release.title, format, releaseId: release.id })
  ]);
  const review =
    pitchforkReview ||
    (await discoverLinkedReview(releaseGroup?.reviewUrls, { artist: stock.artist, title: release.title })) ||
    (await discoverTrustedReviewSearch({ artist: stock.artist, title: release.title })) ||
    (await discoverOfficialEditorial(releaseGroup?.officialUrl, { artist: stock.artist, title: release.title }));
  const tags = unique([...(releaseGroup?.tags || []), ...(release["release-group"]?.tags || []).map((tag) => tag.name)]);
  const genreText = tags.slice(0, 3).join(", ");
  const description = `${stock.artist}'s ${year || ""} release ${release.title} is a ${stock.format || stock.item}${
    label ? ` edition issued by ${label}` : " edition"
  }${genreText ? `, documented by MusicBrainz as ${genreText}` : ""}.`.replace(/\s+/g, " ");

  return {
    title: release.title,
    year,
    label,
    edition,
    barcode: release.barcode || "",
    catalogNumber: catalogNumbers.join(" / "),
    cover,
    productPhoto: artwork.productPhoto,
    imageCredits: uniqueCredits([
      cover ? {
        image: cover,
        credit: "Cover Art Archive / MusicBrainz front artwork",
        url: `${MUSICBRAINZ_ORIGIN}/release/${release.id}`
      } : null,
      artwork.productPhoto ? {
        image: artwork.productPhoto,
        credit: "Cover Art Archive / MusicBrainz physical release scan",
        url: `${MUSICBRAINZ_ORIGIN}/release/${release.id}`
      } : null
    ].filter(Boolean)),
    description,
    descriptionSource: "MusicBrainz",
    reviewQuote: review?.quote || "",
    reviewSource: review?.source || "",
    reviewUrl: review?.url || "",
    relatedArtists: relatedArtistResearch.artists,
    relatedArtistEvidence: relatedArtistResearch.evidence,
    relatedArtistResearch,
    tags,
    sourceUrl: releaseGroup?.officialUrl || `${MUSICBRAINZ_ORIGIN}/release/${release.id}`,
    musicBrainzReleaseId: release.id
  };
}

function chooseMusicBrainzRelease(releases = [], { stock, expectedTitle, format, barcode, catalogNumber } = {}) {
  const candidates = releases
    .map((release) => {
      const title = normalizedText(release.title);
      const exactTitle = title === expectedTitle;
      if (!exactTitle || !musicBrainzArtistMatches(release, stock.artist)) return null;

      const formats = (release.media || []).map((medium) => normalizedText(medium.format));
      const formatMatches = !format || !formats.length || formats.some((candidate) => candidate.includes(normalizedText(format)));
      const releaseBarcode = String(release.barcode || "").replace(/\D/g, "");
      const releaseCatalogNumbers = (release["label-info"] || []).map((label) => normalizedText(label["catalog-number"]));
      const barcodeMatches = !barcode || !releaseBarcode || releaseBarcode === barcode || (catalogNumber && releaseCatalogNumbers.includes(catalogNumber));
      const catalogMatches = !catalogNumber || !releaseCatalogNumbers.length || releaseCatalogNumbers.includes(catalogNumber);
      if (!formatMatches || !barcodeMatches || !catalogMatches) return null;

      return {
        release,
        score: Number(release.score || 0) + (formatMatches ? 10 : 0) + (barcodeMatches ? 15 : 0) + (catalogMatches ? 15 : 0)
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
  return candidates[0]?.release || null;
}

function musicBrainzArtistMatches(release, artist) {
  const credits = (release?.["artist-credit"] || [])
    .map((credit) => credit?.name || credit?.artist?.name || "")
    .filter(Boolean);
  const candidate = normalizedText(credits.join(" "));
  const expectedCredits = artistCreditNames(artist).map(normalizedText).filter(Boolean);
  if (!candidate || !expectedCredits.length) return false;
  if (expectedCredits.every((credit) => candidate.includes(credit))) return true;
  const expected = normalizedText(artist);
  if (expected === "various artists" || expected === "va" || expected === "v a") {
    return candidate.includes("various artists") || candidate === "va";
  }
  return candidate.includes(expected);
}

function isPlaceholderInventoryTitle(value) {
  return /^(?:untitled(?:\s+inventory)?\s+item|new\s+inventory\s+item)$/i.test(String(value || "").trim());
}

async function discoverCoverArt(releaseId, releaseGroupId = "") {
  const endpoints = [
    releaseId ? `https://coverartarchive.org/release/${releaseId}` : "",
    releaseGroupId ? `https://coverartarchive.org/release-group/${releaseGroupId}` : ""
  ].filter(Boolean);
  for (const endpoint of endpoints) {
    const response = await fetchWithTimeout(endpoint, {
      headers: { accept: "application/json", "user-agent": USER_AGENT }
    }, 7000);
    if (!response?.ok) continue;
    const payload = await response.json().catch(() => ({}));
    const images = Array.isArray(payload.images) ? payload.images : [];
    const front = images.find((image) => image.front === true) || images.find((image) => imageType(image, "front"));
    const detail =
      images.find((image) => imageType(image, "medium")) ||
      images.find((image) => imageType(image, "booklet")) ||
      images.find((image) => image.back === true || imageType(image, "back"));
    const cover = String(front?.image || "").trim();
    const productPhoto = String(detail?.image || "").trim();
    if (cover) return { cover, productPhoto: productPhoto && productPhoto !== cover ? productPhoto : "" };
  }
  return { cover: "", productPhoto: "" };
}

function imageType(image, expected) {
  return (image?.types || []).some((type) => String(type || "").trim().toLowerCase() === expected);
}

function uniqueCredits(credits = []) {
  const seen = new Set();
  return credits.filter((credit) => {
    const key = `${credit.image}::${credit.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function discoverReleaseGroup(releaseGroupId) {
  if (!releaseGroupId) return null;
  const response = await fetch(
    `${MUSICBRAINZ_ORIGIN}/ws/2/release-group/${releaseGroupId}?inc=url-rels+tags+artists&fmt=json`,
    { headers: { accept: "application/json", "user-agent": USER_AGENT } }
  ).catch(() => null);
  if (!response?.ok) return null;
  const payload = await response.json().catch(() => ({}));
  const relations = Array.isArray(payload.relations) ? payload.relations : [];
  const officialRelation = relations.find((relation) =>
    ["bandcamp", "official homepage", "purchase for download", "purchase for mail-order"].includes(String(relation?.type || "").toLowerCase())
  );
  return {
    tags: unique((payload.tags || []).map((tag) => tag.name)),
    officialUrl: officialRelation?.url?.resource || "",
    reviewUrls: unique(
      relations
        .filter((relation) => String(relation?.type || "").toLowerCase() === "review")
        .map((relation) => relation?.url?.resource)
    )
  };
}

async function discoverLinkedReview(urls = [], { artist, title } = {}) {
  for (const value of unique(urls).slice(0, 4)) {
    let url;
    try {
      url = new URL(value);
    } catch {
      continue;
    }
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    const source = trustedReviewSource(hostname);
    if (!source) continue;
    const response = await fetchWithTimeout(url, {
      headers: { accept: "text/html", "user-agent": USER_AGENT }
    });
    if (!response?.ok) continue;
    const html = await response.text();
    const pageTitle = metaContent(html, "og:title") || titleText(html);
    const normalizedPageTitle = normalizedText(pageTitle);
    if (!normalizedPageTitle.includes(normalizedText(title)) && !normalizedPageTitle.includes(normalizedText(artist))) continue;
    const quote = conciseQuote(metaContent(html, "description") || metaContent(html, "og:description"));
    if (quote) return { quote, source, url: url.toString() };
  }
  return null;
}

async function discoverTrustedReviewSearch({ artist, title } = {}) {
  const domains = [...TRUSTED_REVIEW_SOURCES.keys()].map((domain) => `site:${domain}`).join(" OR ");
  const query = `"${artist}" "${title}" review (${domains})`;
  const response = await fetchWithTimeout(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: { accept: "text/html", "user-agent": USER_AGENT }
  }, 7000);
  if (response?.ok) {
    const html = await response.text();
    const urls = unique(
      [...html.matchAll(/href=["']([^"']+)["']/gi)]
        .map((match) => duckDuckGoResultUrl(decodeHtml(match[1])))
        .filter(Boolean)
    );
    const review = await discoverLinkedReview(urls, { artist, title });
    if (review) return review;
  }
  return discoverBraveReviewSearch({ artist, title });
}

async function discoverBraveReviewSearch({ artist, title } = {}) {
  const domains = [...TRUSTED_REVIEW_SOURCES.keys()].map((domain) => `site:${domain}`).join(" OR ");
  const query = `"${artist}" "${title}" review (${domains})`;
  const response = await fetchWithTimeout(`https://search.brave.com/search?q=${encodeURIComponent(query)}&source=web`, {
    headers: { accept: "text/html", "user-agent": USER_AGENT }
  }, 7000);
  if (!response?.ok) return null;
  const html = await response.text();
  const urls = unique(
    [...html.matchAll(/href=["'](https:\/\/[^"']+)["']/gi)]
      .map((match) => decodeHtml(match[1]))
      .filter((value) => {
        try {
          return Boolean(trustedReviewSource(new URL(value).hostname.toLowerCase().replace(/^www\./, "")));
        } catch {
          return false;
        }
      })
  );
  return discoverLinkedReview(urls, { artist, title });
}

async function discoverOfficialEditorial(value, { artist, title } = {}) {
  if (!value) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const response = await fetchWithTimeout(url, {
    headers: { accept: "text/html", "user-agent": USER_AGENT }
  });
  if (!response?.ok) return null;
  const html = await response.text();
  const pageTitle = metaContent(html, "og:title") || titleText(html);
  const normalizedPageTitle = normalizedText(pageTitle);
  if (!normalizedPageTitle.includes(normalizedText(title)) && !normalizedPageTitle.includes(normalizedText(artist))) return null;
  const quote = conciseQuote(metaContent(html, "description") || metaContent(html, "og:description"));
  if (!quote) return null;
  const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  return {
    quote,
    source: `${editorialSourceName(hostname)} release note (quoted)`,
    url: url.toString()
  };
}

function trustedReviewSource(hostname) {
  return [...TRUSTED_REVIEW_SOURCES].find(([domain]) => hostname === domain || hostname.endsWith(`.${domain}`))?.[1] || "";
}

function duckDuckGoResultUrl(value) {
  try {
    const url = new URL(value, "https://html.duckduckgo.com");
    if (url.hostname.endsWith("duckduckgo.com")) return url.searchParams.get("uddg") || "";
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function editorialSourceName(hostname) {
  if (hostname.endsWith("bandcamp.com")) return "Bandcamp";
  return hostname.split(".").slice(-2, -1)[0]?.replace(/(^|[-_])\w/g, (value) => value.toUpperCase().replace(/[-_]/g, "")) || "Official";
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 6000) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) }).catch(() => null);
}

async function discoverPitchforkReview({ artist, title }) {
  const query = `${artist} ${title}`.trim();
  if (!query) return null;
  const response = await fetch(`https://pitchfork.com/search/?query=${encodeURIComponent(query)}`, {
    headers: { accept: "text/html", "user-agent": USER_AGENT }
  }).catch(() => null);
  if (!response?.ok) return null;
  const searchHtml = await response.text();
  const paths = unique(
    [...searchHtml.matchAll(/href=["']([^"']*\/reviews\/albums\/[^"'?#]+\/?)["']/gi)].map((match) => match[1])
  ).slice(0, 5);
  for (const path of paths) {
    const url = new URL(path, "https://pitchfork.com").toString();
    const page = await fetch(url, { headers: { accept: "text/html", "user-agent": USER_AGENT } }).catch(() => null);
    if (!page?.ok) continue;
    const html = await page.text();
    const pageTitle = metaContent(html, "og:title") || titleText(html);
    if (!normalizedText(pageTitle).includes(normalizedText(title)) || !normalizedText(pageTitle).includes(normalizedText(artist))) continue;
    const description = metaContent(html, "description") || metaContent(html, "og:description");
    const quote = conciseQuote(description);
    if (!quote) continue;
    return { quote, source: "Pitchfork (quoted)", url };
  }
  return null;
}

function metaContent(html, name) {
  const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:name|property)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${escaped}["'][^>]*>`, "i")
  ];
  for (const pattern of patterns) {
    const match = String(html || "").match(pattern);
    if (match?.[1]) return decodeHtml(match[1]);
  }
  return "";
}

function titleText(html) {
  return decodeHtml(String(html || "").match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || "");
}

function conciseQuote(value) {
  const words = decodeHtml(value).replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (words.length < 5) return "";
  return words.slice(0, 20).join(" ").replace(/[,:;\-]+$/, "");
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function finalizeStatus(row, { publishable, status, enrichmentFingerprint = "", enrichmentAttemptedAt = "" }) {
  const raw = {
    ...(row.raw || {}),
    enrichmentStatus: status,
    publishStatus: publishable ? "Published" : "Draft",
    visibility: publishable ? "Public" : "Private"
  };
  if (enrichmentFingerprint) raw.enrichmentFingerprint = enrichmentFingerprint;
  if (enrichmentAttemptedAt) raw.enrichmentAttemptedAt = enrichmentAttemptedAt;
  return {
    ...row,
    publish_status: publishable ? "Published" : "Draft",
    visibility: publishable ? "Public" : "Private",
    raw
  };
}

export function inventoryFingerprint(stock = {}) {
  return [stock.artist, stock.title, stock.format || stock.item, stock.barcode, stock.catalogNumber]
    .map(normalizedText)
    .join("|");
}

function usedCondition(value) {
  return USED_CONDITION.test(String(value || ""));
}

function enrichmentStatus({ used, discovered, description, relatedArtists, relatedArtistResearch, reviewQuote, reviewSource, reviewUrl, manualRelatedArtistsOverride = false }) {
  if (!discovered?.cover) return "needs-cover-art";
  if (!isManagedProductImage(discovered.cover)) return "needs-cover-archive";
  // A verified release cover is the required storefront image. Product-detail
  // photography improves the listing, but some legitimate sealed editions do
  // not have one available from a trustworthy source and must not be trapped
  // in Draft solely for that reason.
  if (!description) return "needs-editorial-metadata";
  if (!relatedArtists.length && !manualRelatedArtistsOverride && relatedArtistResearch?.status !== "no-verified-match") return "needs-related-artist-research";
  // A source-backed review quote is never invented by automation. Its absence
  // keeps the product private until a trusted source is resolved.
  if (!reviewQuote || !reviewSource || !reviewUrl) return "metadata-complete-needs-editorial-review";
  return relatedArtists.length ? "complete" : "complete-no-related-artists";
}

function editionMatchesFormat(edition, format) {
  const value = String(edition || "").toLowerCase();
  const medium = String(format || "").toLowerCase();
  if (!value || !medium) return true;
  if (medium === "vinyl") return /(vinyl|\blp\b|7.?inch|10.?inch|12.?inch|flexi|picture disc)/.test(value);
  if (medium === "cd") return /(\bcd\b|compact disc)/.test(value);
  if (medium === "cassette") return /(cassette|\btape\b)/.test(value);
  return true;
}

function chooseEditorialValue(current, previousAutomatic, nextAutomatic) {
  const value = String(current || "").trim();
  if (!value || value === String(previousAutomatic || "").trim()) return String(nextAutomatic || "").trim();
  return value;
}

function hasCatalogCore(row) {
  const openToOffers = row.open_to_offers === true || row.raw?.open_to_offers === true;
  const hasFinancialValue = openToOffers
    ? Boolean(wholeAmount(row.minimum_acceptable_offer ?? row.raw?.minimumAcceptableOffer))
    : Number(row.price || 0) > 0;
  return Boolean(
    String(row.title || "").trim() &&
      String(row.artist || "").trim() &&
      String(row.label || "").trim() &&
      String(row.description || "").trim() &&
      Number(row.year || 0) > 1900 &&
      hasFinancialValue &&
      isUsableImage(row.image)
  );
}

function wholeAmount(value) {
  const raw = String(value ?? "").trim();
  if (!/^\d+$/.test(raw)) return null;
  const amount = Number(raw);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

function isUsableImage(value) {
  const image = String(value || "").trim();
  return Boolean(image && !image.includes("nixp-product-example"));
}

export async function researchRelatedArtists({ artist = "", title = "", format = "", releaseId = "" } = {}) {
  const ownNames = new Set(artistCreditNames(artist).map((name) => normalizedText(name)));
  const musicBrainzEvidence = [];
  const lastFmEvidence = [];
  const musicBrainzSeen = new Set();
  const lastFmSeen = new Set();
  let sourceUnavailable = false;
  const add = (name, item, target, seen) => {
    const value = canonicalRelatedArtistName(name);
    const key = normalizedText(value);
    if (!key || ownNames.has(key) || seen.has(key)) return;
    seen.add(key);
    target.push({ artist: value, ...item });
  };

  let resolvedReleaseId = String(releaseId || "").trim();
  if (!resolvedReleaseId && artist && title) {
    const releaseLookup = await findMusicBrainzReleaseId({ artist, title, format });
    resolvedReleaseId = releaseLookup.id;
    sourceUnavailable ||= releaseLookup.unavailable;
  }

  if (resolvedReleaseId) {
    const response = await musicBrainzFetch(
      `${MUSICBRAINZ_ORIGIN}/ws/2/release/${encodeURIComponent(resolvedReleaseId)}?inc=artist-credits+artist-rels+release-rels+recordings&fmt=json`
    );
    sourceUnavailable ||= Boolean(response && !response.ok && response.status >= 500) || response === null;
    if (response?.ok) {
      const release = await response.json().catch(() => ({}));
      const sourceUrl = `${MUSICBRAINZ_ORIGIN}/release/${resolvedReleaseId}`;
      const trackCredits = (release.media || [])
        .flatMap((medium) => medium.tracks || [])
        .flatMap((track) => track["artist-credit"] || []);
      for (const credit of trackCredits) {
        add(credit?.artist?.name || credit?.name, {
          source: "MusicBrainz release artist credit",
          sourceUrl,
          relationType: "release-track-credit",
          confidence: "high"
        }, musicBrainzEvidence, musicBrainzSeen);
        if (musicBrainzEvidence.length >= 5) break;
      }
      for (const relation of release.relations || []) {
        if (!VERIFIED_RELATION_TYPES.has(String(relation?.type || "").toLowerCase())) continue;
        const target = relation.target || relation.artist;
        if (target?.type !== "artist") continue;
        add(target.name, {
          source: "MusicBrainz release relationship",
          sourceUrl,
          relationType: relation.type,
          confidence: "high"
        }, musicBrainzEvidence, musicBrainzSeen);
        if (musicBrainzEvidence.length >= 5) break;
      }
    }
  }

  // If the exact release has no credited collaborator, use only direct
  // MusicBrainz artist relationships. Do not use genre, label, or NIXP
  // catalogue similarity as a substitute for evidence.
  if (!musicBrainzEvidence.length && artist) {
    const relationResult = await discoverDirectArtistRelations(artist);
    sourceUnavailable ||= relationResult.unavailable;
    for (const relation of relationResult.relations) {
      add(relation.artist, relation, musicBrainzEvidence, musicBrainzSeen);
      if (musicBrainzEvidence.length >= 5) break;
    }
  }

  const lastFmResearch = await discoverLastFmSimilarArtists(artist);
  for (const item of lastFmResearch.evidence) {
    add(item.artist, item, lastFmEvidence, lastFmSeen);
    if (lastFmEvidence.length >= 5) break;
  }
  sourceUnavailable ||= lastFmResearch.status === "source-unavailable";
  const evidence = combineRelatedArtistEvidence(musicBrainzEvidence, lastFmEvidence, 5);
  const hasMusicBrainzEvidence = evidence.some((item) => String(item.source || "").startsWith("MusicBrainz"));
  const hasLastFmEvidence = evidence.some((item) => String(item.source || "").startsWith("Last.fm"));
  const sources = [hasMusicBrainzEvidence ? "MusicBrainz" : "", hasLastFmEvidence ? "Last.fm" : ""].filter(Boolean);

  return {
    engineVersion: RELATED_ARTIST_RESEARCH_VERSION,
    artists: evidence.map((item) => item.artist),
    evidence,
    status: hasMusicBrainzEvidence && hasLastFmEvidence
      ? "combined"
      : hasMusicBrainzEvidence
        ? "verified"
        : hasLastFmEvidence
          ? "lastfm"
          : sourceUnavailable
            ? "source-unavailable"
            : "no-verified-match",
    source: sources.join(" + ") || (lastFmResearch.status === "not-configured" ? "MusicBrainz" : "MusicBrainz + Last.fm"),
    sourceUrl: resolvedReleaseId ? `${MUSICBRAINZ_ORIGIN}/release/${resolvedReleaseId}` : "",
    releaseId: resolvedReleaseId,
    lastFm: lastFmResearch
  };
}

export function combineRelatedArtistEvidence(musicBrainzEvidence = [], lastFmEvidence = [], max = 5) {
  const limit = Math.max(1, Math.min(5, Number(max) || 5));
  const byArtist = new Map();
  const add = (item, sourceName) => {
    const name = canonicalRelatedArtistName(item?.artist);
    const key = normalizedText(name);
    if (!key) return;
    const existing = byArtist.get(key);
    if (!existing) {
      byArtist.set(key, {
        ...item,
        artist: name,
        sources: [sourceName]
      });
      return;
    }
    existing.sources = [...new Set([...(existing.sources || []), sourceName])];
    existing.source = [...new Set([existing.source, item.source].filter(Boolean))].join(" + ");
    existing.evidence = [...(existing.evidence || []), item];
  };
  const musicBrainzKeys = [];
  const lastFmKeys = [];
  for (const item of musicBrainzEvidence) {
    const before = byArtist.size;
    add(item, "MusicBrainz");
    const key = normalizedText(item?.artist);
    if (key && byArtist.size > before) musicBrainzKeys.push(key);
  }
  for (const item of lastFmEvidence) {
    const before = byArtist.size;
    add(item, "Last.fm");
    const key = normalizedText(item?.artist);
    if (key && byArtist.size > before) lastFmKeys.push(key);
  }
  const selected = [];
  const selectedKeys = new Set();
  for (let index = 0; selected.length < limit && (index < musicBrainzKeys.length || index < lastFmKeys.length); index += 1) {
    for (const key of [musicBrainzKeys[index], lastFmKeys[index]]) {
      if (!key || selectedKeys.has(key)) continue;
      selectedKeys.add(key);
      selected.push(byArtist.get(key));
      if (selected.length >= limit) break;
    }
  }
  return selected;
}

export function resolveRelatedArtistDisplay({ manualRelatedArtists = [], automaticRelatedArtists = [], manualRelatedArtistsOverride = false } = {}) {
  const manual = unique(manualRelatedArtists.map(canonicalRelatedArtistName));
  const automatic = unique(automaticRelatedArtists.map(canonicalRelatedArtistName));
  return {
    relatedArtists: manualRelatedArtistsOverride ? manual : unique([...manual, ...automatic]),
    manualRelatedArtistsOverride: Boolean(manualRelatedArtistsOverride)
  };
}

async function discoverLastFmSimilarArtists(artist) {
  const apiKey = String(process.env.LASTFM_API_KEY || "").trim();
  if (!apiKey || !String(artist || "").trim()) {
    return { artists: [], evidence: [], status: "not-configured", source: "Last.fm" };
  }
  let sourceUnavailable = false;
  for (const primaryArtist of artistResearchQueryCandidates(artist)) {
    const url = `${LASTFM_ORIGIN}/2.0/?method=artist.getsimilar&artist=${encodeURIComponent(primaryArtist)}&api_key=${encodeURIComponent(apiKey)}&format=json&limit=10&autocorrect=1`;
    const response = await lastFmFetch(url);
    const sourceUrl = `https://www.last.fm/music/${encodeURIComponent(primaryArtist)}`;
    if (!response?.ok || response.payload?.error) {
      sourceUnavailable ||= !response || response.status >= 500;
      continue;
    }
    const candidates = response.payload?.similarartists?.artist;
    const similarArtists = Array.isArray(candidates) ? candidates : candidates ? [candidates] : [];
    const evidence = similarArtists
      .map((item) => {
        const match = Number(item?.match);
        return {
          artist: canonicalRelatedArtistName(item?.name),
          source: "Last.fm similar artist",
          sourceUrl,
          relationType: "artist-similarity",
          confidence: Number.isFinite(match) ? match : null,
          match: Number.isFinite(match) ? match : null
        };
      })
      .filter((item) => item.artist);
    if (evidence.length) {
      return { artists: evidence.map((item) => item.artist), evidence, status: "available", source: "Last.fm", sourceUrl };
    }
  }
  const primaryArtist = artistResearchQueryCandidates(artist)[0] || artist;
  return {
    artists: [],
    evidence: [],
    status: sourceUnavailable ? "source-unavailable" : "no-match",
    source: "Last.fm",
    sourceUrl: `https://www.last.fm/music/${encodeURIComponent(primaryArtist)}`
  };
}

function artistResearchQueryCandidates(artist) {
  const primary = String(artistCreditNames(artist)[0] || artist || "").trim();
  if (!primary) return [];
  const candidates = [primary];
  const withoutTrailingPunctuation = primary.replace(/[.!?]+$/u, "").trim();
  const withoutPeriods = primary.replace(/[.·]/gu, "").replace(/\s+/g, " ").trim();
  if (withoutTrailingPunctuation && withoutTrailingPunctuation !== primary) candidates.push(withoutTrailingPunctuation);
  if (withoutPeriods && withoutPeriods !== primary) candidates.push(withoutPeriods);
  if (!/[.!?]$/u.test(primary)) candidates.push(`${primary}.`);
  return unique(candidates);
}

async function findMusicBrainzReleaseId({ artist, title, format } = {}) {
  const query = [
    `artist:"${escapeQuery(artist)}"`,
    `release:"${escapeQuery(title)}"`
  ].join(" AND ");
  const response = await musicBrainzFetch(
    `${MUSICBRAINZ_ORIGIN}/ws/2/release/?query=${encodeURIComponent(query)}&fmt=json&limit=25&inc=labels+artist-credits+media+release-groups`
  );
  if (!response?.ok) return { id: "", unavailable: !response || response.status >= 500 };
  const payload = await response.json().catch(() => ({}));
  const expectedTitle = normalizedText(title);
  const expectedArtist = normalizedText(artist);
  const expectedFormat = normalizedText(format);
  const matches = (payload.releases || []).filter((release) => {
    const formats = (release.media || []).map((medium) => normalizedText(medium.format));
    const artists = normalizedText((release["artist-credit"] || []).map((credit) => credit.name).join(" "));
    return normalizedText(release.title) === expectedTitle &&
      artists.includes(expectedArtist) &&
      (!expectedFormat || !formats.length || formats.some((candidate) => candidate.includes(expectedFormat)));
  });
  return {
    id: matches.sort((a, b) => Number(b.score || 0) - Number(a.score || 0))[0]?.id || "",
    unavailable: false
  };
}

async function discoverDirectArtistRelations(artist) {
  let unavailable = false;
  for (const primaryArtist of artistResearchQueryCandidates(artist)) {
    const search = await musicBrainzFetch(
      `${MUSICBRAINZ_ORIGIN}/ws/2/artist/?query=${encodeURIComponent(`artist:"${escapeQuery(primaryArtist)}"`)}&fmt=json&limit=5`
    );
    if (!search?.ok) {
      unavailable ||= !search || search.status >= 500;
      continue;
    }
    const payload = await search.json().catch(() => ({}));
    const candidates = payload.artists || [];
    const match = candidates.find((item) => normalizedText(item.name) === normalizedText(primaryArtist)) || candidates[0];
    if (!match?.id) continue;
    const response = await musicBrainzFetch(
      `${MUSICBRAINZ_ORIGIN}/ws/2/artist/${match.id}?inc=artist-rels&fmt=json`
    );
    if (!response?.ok) {
      unavailable ||= !response || response.status >= 500;
      continue;
    }
    const artistData = await response.json().catch(() => ({}));
    const relations = uniqueRelations(
      (artistData.relations || [])
        .filter((relation) => VERIFIED_RELATION_TYPES.has(String(relation?.type || "").toLowerCase()))
        .filter((relation) => {
          const target = relation.target || relation.artist;
          // Membership is useful when a solo artist is a member of a group, but
          // band membership lists are too broad to use as recommendations.
          return relation.type !== "member of band" || target?.type === "group";
        })
        .map((relation) => {
          const target = relation.target || relation.artist;
          return target?.name
            ? {
                artist: canonicalRelatedArtistName(target.name),
                source: "MusicBrainz artist relationship",
                sourceUrl: `${MUSICBRAINZ_ORIGIN}/artist/${match.id}`,
                relationType: relation.type,
                confidence: "medium"
              }
            : null;
        })
        .filter(Boolean)
    );
    if (relations.length) return { relations, unavailable: false };
  }
  return { relations: [], unavailable };
}

function uniqueRelations(values = []) {
  const byArtist = new Map();
  for (const value of values) {
    const key = normalizedText(value?.artist);
    if (!key || byArtist.has(key)) continue;
    byArtist.set(key, value);
  }
  return [...byArtist.values()];
}

async function musicBrainzFetch(url) {
  const cached = musicBrainzCache.get(url);
  if (cached && Date.now() - cached.at < RELATED_ARTIST_CACHE_TTL_MS) return cached.response;
  const request = musicBrainzQueue.then(async () => {
    const waitMs = Math.max(0, MUSICBRAINZ_REQUEST_INTERVAL_MS - (Date.now() - lastMusicBrainzRequestAt));
    if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
    lastMusicBrainzRequestAt = Date.now();
    const response = await fetch(url, { headers: { accept: "application/json", "user-agent": USER_AGENT } }).catch(() => null);
    if (!response) return null;
    const payload = await response.json().catch(() => null);
    const result = {
      ok: response.ok,
      status: response.status,
      response: {
        ok: response.ok,
        status: response.status,
        json: async () => payload
      }
    };
    // Cache successful responses and stable 404s, but never turn a transient API
    // failure into a week-long false "no match" result.
    if (result.response.ok || result.response.status === 404) {
      musicBrainzCache.set(url, { at: Date.now(), response: result.response });
    }
    return result.response;
  });
  musicBrainzQueue = request.catch(() => null);
  return request;
}

async function lastFmFetch(url) {
  const cached = lastFmCache.get(url);
  if (cached && Date.now() - cached.at < RELATED_ARTIST_CACHE_TTL_MS) return cached.response;
  const request = lastFmQueue.then(async () => {
    const waitMs = Math.max(0, LASTFM_REQUEST_INTERVAL_MS - (Date.now() - lastLastFmRequestAt));
    if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
    lastLastFmRequestAt = Date.now();
    const response = await fetch(url, {
      headers: { accept: "application/json", "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(8000)
    }).catch(() => null);
    if (!response) return null;
    const payload = await response.json().catch(() => null);
    const result = { ok: response.ok, status: response.status, payload };
    if (result.ok || result.status === 404) lastFmCache.set(url, { at: Date.now(), response: result });
    return result;
  });
  lastFmQueue = request.catch(() => null);
  return request;
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
