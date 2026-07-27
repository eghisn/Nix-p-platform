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
    cover: "https://coverartarchive.org/release/ac2611e4-fa10-47f1-a328-8fad3c73cb49/front",
    productPhoto: "https://coverartarchive.org/release/ac2611e4-fa10-47f1-a328-8fad3c73cb49/front",
    imageCredits: [{ image: "https://coverartarchive.org/release/ac2611e4-fa10-47f1-a328-8fad3c73cb49/front", credit: "Cover Art Archive / Secretly Canadian", url: "https://musicbrainz.org/release/ac2611e4-fa10-47f1-a328-8fad3c73cb49" }],
    description: "Suuns' Bambi is a dark, guitar-led 12-inch single from the Montreal band's early period, moving between intimate electronic atmosphere and a sharper post-industrial attack.",
    descriptionSource: "Secretly Canadian / KEXP",
    reviewQuote: "terrifying power",
    reviewSource: "KEXP (quoted)",
    reviewUrl: "https://www.kexp.org/read/2013/3/2/album-review-suuns-images-du-futur/",
    relatedArtists: ["Preoccupations", "Viet Cong", "Jerusalem In My Heart"],
    tags: ["post-punk", "electronic", "12-inch"],
    sourceUrl: "https://www.discogs.com/master/1568907-Suuns-Bambi",
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
    cover: "https://coverartarchive.org/release/5f24a203-f56c-4996-b91b-78ed2d1f4f37/front",
    productPhoto: "https://coverartarchive.org/release/5f24a203-f56c-4996-b91b-78ed2d1f4f37/front",
    imageCredits: [{ image: "https://coverartarchive.org/release/5f24a203-f56c-4996-b91b-78ed2d1f4f37/front", credit: "Cover Art Archive / XL Recordings", url: "https://musicbrainz.org/release/5f24a203-f56c-4996-b91b-78ed2d1f4f37" }],
    description: "M.I.A.'s 2010 Steppin Up / Meds And Feds 12-inch pairs two of the most abrasive cuts from the Maya era, driven by industrial beats, digital dissonance and XL's classic sleeve design.",
    descriptionSource: "XL Recordings / Apple Music",
    reviewQuote: "a non-stop assault of throbbing industrial beats",
    reviewSource: "Apple Music (quoted)",
    reviewUrl: "https://music.apple.com/th/album/y/1544491734",
    relatedArtists: ["Arca", "SOPHIE", "The Chemical Brothers"],
    tags: ["experimental hip-hop", "electronic", "12-inch"],
    sourceUrl: "https://www.banquetrecords.com/m.i.a./steppin-up-meds-and-feds/XLT505"
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
