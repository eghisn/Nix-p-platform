import { artistCreditNames, canonicalArtistName, canonicalLabelName, canonicalRelatedArtistName } from "../../src/data/catalogIdentity.js";
import { archiveRemoteProductImage, isManagedProductImage } from "./productImageStorage.js";

const RECORD_FORMATS = new Set(["Vinyl", "CD", "Cassette"]);
const USED_CONDITION = /^used\b/i;
const MUSICBRAINZ_ORIGIN = "https://musicbrainz.org";
const USER_AGENT = "NIXP-Catalog/1.0 (contact@nix-p.com)";

// NIXP keeps a local, optimized copy of the public catalog artwork. The
// original source remains in imageCredits; this mapping prevents third-party
// artwork URLs from becoming a storefront runtime dependency.
const ARCHIVED_CATALOG_IMAGES = {
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
  }
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
    edition: "1 LP - black vinyl",
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
    relatedArtists: ["Laurel Halo"],
    tags: ["sound art", "zine", "flexi disc", "fashion publishing"],
    sourceUrl: "https://www.jilsander.com/en-au/jil-sander-sounds-presents-cisco-records/jil-sander-sounds-presents-cisco-records.html"
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
  }
};

export async function enrichFinanceCatalogProduct(row, stock = {}, { catalogArtists = [] } = {}) {
  const format = String(stock.item || row.format || "").trim();
  const title = String(stock.title || row.title || "").trim();
  const artist = canonicalArtistName(stock.artist || row.artist || "");
  const price = Number(stock.sellingPrice || row.price || 0);
  const openToOffers = stock.listingMode === "Private Collection / Offer Only" || stock.open_to_offers === true || row.open_to_offers === true;
  const minimumAcceptableOffer = wholeAmount(stock.minimumAcceptableOffer ?? row.minimum_acceptable_offer ?? row.raw?.minimumAcceptableOffer);

  if (!RECORD_FORMATS.has(format) || !title || !artist || (openToOffers ? !minimumAcceptableOffer : price <= 0)) {
    return finalizeStatus(row, { publishable: false, status: "needs-finance-data" });
  }

  const sku = String(stock.sku || row.sku || "").trim().toUpperCase();
  const curated = CURATED_FINANCE_ENRICHMENTS[sku];
  const discoveredSource = curated || (await discoverMusicBrainzRelease({ ...stock, format, title, artist }).catch(() => null));
  const discovered = await archiveDiscoveredImages(applyArchivedCatalogImages(discoveredSource, sku), sku, usedCondition(stock.itemCondition || row.condition));
  if (!discovered) {
    return finalizeStatus(row, {
      publishable: hasCatalogCore(row),
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
  const details = unique([
    ...(Array.isArray(row.details) ? row.details : []),
    `SKU: ${sku}`,
    `Format: ${format}`,
    stock.itemCondition ? `Condition: ${stock.itemCondition}` : "",
    discovered.edition ? `Edition: ${discovered.edition}` : "",
    discovered.catalogNumber ? `Catalog number: ${discovered.catalogNumber}` : "",
    discovered.barcode ? `Barcode: ${discovered.barcode}` : ""
  ]).filter((detail) => detail && !detail.startsWith("Created from finance inventory"));
  const automatic = raw.autoEditorial || {};
  const description = chooseEditorialValue(row.description, automatic.description, discovered.description);
  const descriptionSource = chooseEditorialValue(raw.descriptionSource, automatic.descriptionSource, discovered.descriptionSource);
  const reviewQuote = chooseEditorialValue(raw.reviewQuote, automatic.reviewQuote, discovered.reviewQuote || "");
  const reviewSource = chooseEditorialValue(raw.reviewSource, automatic.reviewSource, discovered.reviewSource || "");
  const reviewUrl = chooseEditorialValue(raw.reviewUrl, automatic.reviewUrl, discovered.reviewUrl || "");
  const relatedArtists = unique([
    ...((Array.isArray(raw.relatedArtists) ? raw.relatedArtists : [])),
    ...(discovered.relatedArtists || []),
    ...relatedArtistsFromCatalog({ artist, label: discovered.label || row.label, catalogArtists })
  ].map(canonicalRelatedArtistName));
  const enrichmentFingerprint = inventoryFingerprint({ ...stock, artist, title, format });
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
      edition: raw.edition || discovered.edition || "",
      barcode: raw.barcode || discovered.barcode || "",
      catalogNumber: raw.catalogNumber || discovered.catalogNumber || "",
      relatedArtists,
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
        relatedArtists
      },
      enrichmentFingerprint,
      enrichmentOrigin: curated ? "curated-exact" : "musicbrainz",
      enrichmentStatus: enrichmentStatus({ used, discovered, description, relatedArtists, reviewQuote }),
      enrichmentUpdatedAt: today(),
      enrichmentAttemptedAt: new Date().toISOString()
    }
  };
  return finalizeStatus(product, {
    publishable: hasCatalogCore(product),
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
  const response = await fetch(
    `${MUSICBRAINZ_ORIGIN}/ws/2/release/?query=${encodeURIComponent(query)}&fmt=json&limit=25&inc=labels+artist-credits+media`,
    { headers: { accept: "application/json", "user-agent": USER_AGENT } }
  );
  if (!response.ok) return null;
  const payload = await response.json();
  const format = String(stock.format || stock.item || "").toLowerCase();
  const expectedTitle = normalizedText(stock.title);
  const expectedArtist = normalizedText(stock.artist);
  const barcode = String(stock.barcode || "").replace(/\D/g, "");
  const catalogNumber = normalizedText(stock.catalogNumber);
  const matches = (payload.releases || []).filter((release) => {
    const formats = (release.media || []).map((medium) => String(medium.format || "").toLowerCase());
    const artists = (release["artist-credit"] || []).map((credit) => credit.name).join(" ");
    const releaseBarcode = String(release.barcode || "").replace(/\D/g, "");
    const releaseCatalogNumbers = (release["label-info"] || []).map((label) => normalizedText(label["catalog-number"]));
    return (
      normalizedText(release.title) === expectedTitle &&
      normalizedText(artists).includes(expectedArtist) &&
      (!formats.length || formats.some((candidate) => candidate.includes(format))) &&
      (!barcode || !releaseBarcode || releaseBarcode === barcode || (catalogNumber && releaseCatalogNumbers.includes(catalogNumber))) &&
      (!catalogNumber || !releaseCatalogNumbers.length || releaseCatalogNumbers.includes(catalogNumber))
    );
  });
  const release = matches.sort((a, b) => Number(b.score || 0) - Number(a.score || 0))[0];
  if (!release) return null;

  const labelInfo = release["label-info"] || [];
  const labels = unique(labelInfo.map((entry) => entry.label?.name));
  const catalogNumbers = unique(labelInfo.map((entry) => entry["catalog-number"]));
  const candidateCover = `https://coverartarchive.org/release/${release.id}/front`;
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
    relatedArtists: await discoverRelatedArtists(artist),
    tags: [],
    sourceUrl: `${MUSICBRAINZ_ORIGIN}/release/${release.id}`,
    musicBrainzReleaseId: release.id
  };
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

function enrichmentStatus({ used, discovered, description, relatedArtists, reviewQuote }) {
  if (!discovered?.cover) return "needs-cover-art";
  if (!isManagedProductImage(discovered.cover)) return "needs-cover-archive";
  if (!used && !discovered?.productPhoto) return "needs-product-photo";
  if (!used && !isManagedProductImage(discovered.productPhoto)) return "needs-product-photo-archive";
  if (!description) return "needs-editorial-metadata";
  if (!relatedArtists.length) return "metadata-complete-no-related-artists";
  // A source-backed review quote is never invented by automation. Its absence
  // is an editorial task, not a failed product identity match.
  return reviewQuote ? "complete" : "metadata-complete-needs-editorial-review";
}

function chooseEditorialValue(current, previousAutomatic, nextAutomatic) {
  const value = String(current || "").trim();
  if (!value || value === String(previousAutomatic || "").trim()) return String(nextAutomatic || "").trim();
  return value;
}

function relatedArtistsFromCatalog({ artist, label, catalogArtists = [] } = {}) {
  const ownNames = new Set(artistCreditNames(artist).map((name) => normalizedText(name)));
  const normalizedLabel = normalizedText(label);
  const candidates = (Array.isArray(catalogArtists) ? catalogArtists : [])
    .filter((candidate) => normalizedText(candidate?.label) === normalizedLabel)
    .flatMap((candidate) => artistCreditNames(candidate?.artist));
  return unique(candidates).filter((name) => !ownNames.has(normalizedText(name))).slice(0, 6);
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

async function remoteImageExists(url) {
  const response = await fetch(url, {
    method: "HEAD",
    redirect: "follow",
    headers: { accept: "image/*", "user-agent": USER_AGENT }
  }).catch(() => null);
  return Boolean(response?.ok && String(response.headers.get("content-type") || "").startsWith("image/"));
}

async function discoverRelatedArtists(artist) {
  const search = await fetch(
    `${MUSICBRAINZ_ORIGIN}/ws/2/artist/?query=${encodeURIComponent(`artist:"${escapeQuery(artist)}"`)}&fmt=json&limit=1`,
    { headers: { accept: "application/json", "user-agent": USER_AGENT } }
  ).catch(() => null);
  if (!search?.ok) return [];
  const payload = await search.json().catch(() => ({}));
  const match = payload.artists?.[0];
  if (!match?.id) return [];
  const response = await fetch(
    `${MUSICBRAINZ_ORIGIN}/ws/2/artist/${match.id}?inc=artist-rels&fmt=json`,
    { headers: { accept: "application/json", "user-agent": USER_AGENT } }
  ).catch(() => null);
  if (!response?.ok) return [];
  const artistData = await response.json().catch(() => ({}));
  return unique(
    (artistData.relations || [])
      .filter((relation) => relation?.target?.type === "artist")
      .map((relation) => relation.target?.name || relation.artist?.name)
      .filter((name) => normalizedText(name) !== normalizedText(artist))
  ).slice(0, 8);
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
