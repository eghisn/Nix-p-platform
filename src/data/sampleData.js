import { recordEditorial } from "./recordEditorial.js";

export const requestStatuses = [
  "New",
  "Searching",
  "Found",
  "Unavailable",
  "Contacted",
  "Closed"
];

export const artistNames = [
  "Antemasque",
  "Animal Collective",
  "Arca",
  "Behold The Arctopus",
  "Blawan",
  "Cave In",
  "Damien Dubrovnik",
  "Daniel Lopatin",
  "David Bowie",
  "FACS",
  "Giant Swan",
  "Gilla Band",
  "Girl Band",
  "Heith & Tarawangsawelas",
  "Hiatus Kaiyote",
  "JK Flesh, Gothtrad",
  "Lightning Bolt",
  "Various Artists",
  "Melt-Banana",
  "Meshuggah",
  "Model Actriz",
  "My Bloody Valentine",
  "Nala Sinephro",
  "Nine Inch Nails",
  "Oneohtrix Point Never",
  "Overmono & The Streets Turn The Page",
  "Panda Bear",
  "Peggy Gou",
  "Poison The Well",
  "Prodigy",
  "Rezzett",
  "Senyawa, Kazuhisa Uchihashi",
  "Sigmun",
  "Soft Moon",
  "Sophie",
  "Squarepusher",
  "Team Sleep",
  "The Chemical Brothers",
  "The Mars Volta",
    "Yeah Yeah Yeahs"
];

const recordImage = "/public/nixp-product-example-paper.png";
const apparelImage = "/public/display-photos/motorith-crewneck-sweatshirt-2023.png";

const recordRows = [
  {
    "id": "nxp-2026-vnl-0006",
    "sku": "NXP-2026-VNL-0006",
    "artist": "Damien Dubrovnik",
    "title": "First Burning Attraction",
    "format": "Vinyl",
    "qty": 1,
    "price": 470000,
    "image": "/public/covers/nxp-2026-vnl-0006-damien-dubrovnik-first-burning-attraction.jpg",
    "condition": "Used Good"
  },
  {
    "id": "nxp-2026-cd-0015",
    "sku": "NXP-2026-CD-0015",
    "artist": "Meshuggah",
    "title": "Obzen",
    "format": "CD",
    "qty": 1,
    "price": 415000,
    "image": "/public/covers/nxp-2026-cd-0015-meshuggah-obzen.jpg",
    "condition": "Used Good"
  },
  {
    "id": "nxp-2026-cst-0005",
    "sku": "NXP-2026-CST-0005",
    "artist": "Rezzett",
    "title": "Into The Boiling Darks",
    "format": "Cassette",
    "qty": 1,
    "price": 260000,
    "condition": "New-Sealed",
    "image": "/public/covers/nxp-2026-cst-0005-rezzett-into-the-boiling-darks.jpg"
  },
  {
    "id": "nxp-2026-cd-0010",
    "sku": "NXP-2026-CD-0010",
    "artist": "The Mars Volta",
    "title": "Noctourniquet",
    "format": "CD",
    "qty": 1,
    "price": 180000,
    "image": "/public/covers/nxp-2026-cd-0010-the-mars-volta-noctourniquet.jpg",
    "condition": "New-Sealed"
  },
  {
    "id": "nxp-2026-cd-0011",
    "sku": "NXP-2026-CD-0011",
    "artist": "David Bowie",
    "title": "Blackstar",
    "format": "CD",
    "qty": 1,
    "price": 250000,
    "condition": "Used Excellent",
    "image": "/public/covers/nxp-2026-cd-0011-david-bowie-blackstar.avif"
  },
  {
    "id": "nxp-2026-cd-0012",
    "sku": "NXP-2026-CD-0012",
    "artist": "Nine Inch Nails",
    "title": "Hesitation Marks",
    "format": "CD",
    "qty": 1,
    "price": 250000,
    "image": "/public/uploads/products/nxp-2026-cd-0012-hesitation-marks-8456ab7d2b0227cd1b7471846c7149b5-1000x898x1-jpg-1783885202172.jpg",
    "condition": "Used Good"
  },
  {
    "id": "nxp-2026-cd-0016",
    "sku": "NXP-2026-CD-0016",
    "artist": "Lightning Bolt",
    "title": "Earthly Delights",
    "format": "CD",
    "qty": 1,
    "price": 350000,
    "image": "/public/covers/nxp-2026-cd-0016-lightning-bolt-earthly-delights.jpg",
    "condition": "Used Excellent"
  },
  {
    "id": "nxp-2026-vnl-0004",
    "sku": "NXP-2026-VNL-0004",
    "artist": "Girl Band",
    "title": "The Talkies",
    "format": "Vinyl",
    "qty": 1,
    "price": 700000,
    "image": "/public/covers/nxp-2026-vnl-0004-girl-band-the-talkies.jpg",
    "condition": "New-Sealed"
  },
  {
    "id": "nxp-2026-vnl-0005",
    "sku": "NXP-2026-VNL-0005",
    "artist": "Gilla Band",
    "title": "The Early Years",
    "format": "Vinyl",
    "qty": 1,
    "price": 568000,
    "image": "/public/uploads/products/nxp-2026-vnl-0005-the-early-years-gilla-band-the-early-years-ep-10th-anniversary-edition-2025-reissue-jpg-1783884296931.jpg",
    "condition": "New-Sealed"
  },
  {
    "id": "nxp-2026-cd-0001",
    "sku": "NXP-2026-CD-0001",
    "artist": "Meshuggah",
    "title": "Chaosphere",
    "format": "CD",
    "qty": 1,
    "price": 285000,
    "image": "/public/uploads/products/nxp-2026-cd-0001-chaosphere-cover-425412532019-r-jpg-1783885419677.jpg",
    "condition": "Used Good"
  },
  {
    "id": "nxp-2026-cd-0002",
    "sku": "NXP-2026-CD-0002",
    "artist": "Team Sleep",
    "title": "Self Titled",
    "format": "CD",
    "qty": 1,
    "price": 235000,
    "image": "/public/covers/nxp-2026-cd-0002-team-sleep-maverick.jpg",
    "condition": "Used Excellent"
  },
  {
    "id": "nxp-2026-cd-0003",
    "sku": "NXP-2026-CD-0003",
    "artist": "The Chemical Brothers",
    "title": "Come With Us",
    "format": "CD",
    "qty": 1,
    "price": 150000,
    "condition": "Used Excellent",
    "image": "/public/covers/nxp-2026-cd-0003-the-chemical-brothers-come-with-us.jpg"
  },
  {
    "id": "nxp-2026-cd-0004",
    "sku": "NXP-2026-CD-0004",
    "artist": "The Chemical Brothers",
    "title": "Further",
    "format": "CD",
    "qty": 1,
    "price": 150000,
    "condition": "Used Excellent",
    "image": "/public/covers/nxp-2026-cd-0004-the-chemical-brothers-further.jpg"
  },
  {
    "id": "nxp-2026-cd-0005",
    "sku": "NXP-2026-CD-0005",
    "artist": "Yeah Yeah Yeahs",
    "title": "It's Blitz!",
    "format": "CD",
    "qty": 1,
    "price": 147000,
    "condition": "Used Good",
    "image": "/public/covers/nxp-2026-cd-0005-yeah-yeah-yeahs-its-blitz.jpg"
  },
  {
    "id": "nxp-2026-cd-0006",
    "sku": "NXP-2026-CD-0006",
    "artist": "Various Artists",
    "title": "Reloaded",
    "format": "CD",
    "qty": 1,
    "price": 150000,
    "image": "/public/covers/nxp-2026-cd-0006-matrix-reloaded.jpg",
    "condition": "Used Good"
  },
  {
    "id": "nxp-2026-cd-0007",
    "sku": "NXP-2026-CD-0007",
    "artist": "Model Actriz",
    "title": "Pirouette",
    "format": "CD",
    "qty": 1,
    "price": 480000,
    "image": "/public/covers/nxp-2026-cd-0007-model-actriz-pirouette.jpg",
    "condition": "New-Sealed"
  },
  {
    "id": "nxp-2026-cd-0008",
    "sku": "NXP-2026-CD-0008",
    "artist": "Daniel Lopatin",
    "title": "Marty Supreme",
    "format": "CD",
    "qty": 1,
    "price": 500000,
    "image": "/public/covers/nxp-2026-cd-0008-daniel-lopatin-marty-supreme.jpg",
    "condition": "New-Sealed"
  },
  {
    "id": "nxp-2026-cd-0009",
    "sku": "NXP-2026-CD-0009",
    "artist": "Sophie",
    "title": "Sophie",
    "format": "CD",
    "qty": 1,
    "price": 450000,
    "image": "/public/covers/nxp-2026-cd-0009-sophie-sophie.jpg",
    "condition": "New-Sealed"
  },
  {
    "id": "nxp-2026-cst-0001",
    "sku": "NXP-2026-CST-0001",
    "artist": "Nine Inch Nails",
    "title": "Things Falling Apart",
    "format": "Cassette",
    "qty": 1,
    "price": 180000,
    "image": "/public/covers/nxp-2026-cst-0001-nine-inch-nails-things-falling-apart.jpg",
    "condition": "Used Good"
  },
  {
    "id": "nxp-2026-cst-0002",
    "sku": "NXP-2026-CST-0002",
    "artist": "Poison The Well",
    "title": "Tear From The red",
    "format": "Cassette",
    "qty": 1,
    "price": 197000,
    "image": "/public/covers/nxp-2026-cst-0002-poison-the-well-tear-from-the-red.jpg",
    "condition": "Used Excellent"
  },
  {
    "id": "nxp-2026-cst-0004",
    "sku": "NXP-2026-CST-0004",
    "artist": "Various Artists",
    "title": "Reloaded",
    "format": "Cassette",
    "qty": 2,
    "price": 100000,
    "image": "/public/covers/nxp-2026-cst-0004-matrix-reloaded.jpg",
    "condition": "Used Good"
  },
  {
    "id": "nxp-2026-cst-0006",
    "sku": "NXP-2026-CST-0006",
    "artist": "Prodigy",
    "title": "The Fat Of The Land",
    "format": "Cassette",
    "qty": 1,
    "price": 150000,
    "image": "/public/covers/nxp-2026-cst-0006-prodigy-the-fat-of-the-land.jpg",
    "condition": "Used Good"
  },
  {
    "id": "nxp-2026-vnl-0001",
    "sku": "NXP-2026-VNL-0001",
    "artist": "Squarepusher",
    "title": "Kammerkonzert",
    "format": "Vinyl",
    "qty": 1,
    "price": 950000,
    "image": "/public/covers/nxp-2026-vnl-0001-squarepusher-kammerkonzert.jpg",
    "condition": "New-Sealed"
  },
  {
    "id": "nxp-2026-vnl-0002",
    "sku": "NXP-2026-VNL-0002",
    "artist": "Melt-Banana",
    "title": "3+5",
    "format": "Vinyl",
    "qty": 1,
    "price": 820000,
    "image": "/public/covers/nxp-2026-vnl-0002-melt-banana-35.jpg",
    "condition": "New-Sealed"
  },
  {
    "id": "nxp-2026-vnl-0003",
    "sku": "NXP-2026-VNL-0003",
    "artist": "Nala Sinephro",
    "title": "Endlessness",
    "format": "Vinyl",
    "qty": 1,
    "price": 900000,
    "image": "/public/covers/nxp-2026-vnl-0003-nala-sinephro-endlessness.jpg",
    "condition": "New-Sealed"
  },
  {
    "id": "nxp-2026-cd-0013",
    "sku": "NXP-2026-CD-0013",
    "artist": "Senyawa, Kazuhisa Uchihashi",
    "title": "Senyawa with Kazuhisa Uchihashi",
    "format": "CD",
    "qty": 1,
    "price": 250000,
    "condition": "Used Good",
    "image": "/public/covers/nxp-2026-cd-0013-senyawa-with-kazuhisa-uchihashi.jpg"
  },
  {
    "id": "nxp-2026-cd-0014",
    "sku": "NXP-2026-CD-0014",
    "artist": "Sigmun",
    "title": "Crimson Eyes",
    "format": "CD",
    "qty": 1,
    "price": 50000,
    "image": "/public/covers/nxp-2026-cd-0014-sigmun-crimson-eyes.jpg",
    "condition": "Used Good"
  },
  {
    "id": "nxp-2026-cd-0017",
    "sku": "NXP-2026-CD-0017",
    "artist": "David Bowie",
    "title": "The Next Day",
    "format": "CD",
    "qty": 1,
    "price": 200000,
    "image": "/public/covers/nxp-2026-cd-0017-david-bowie-the-next-day.jpg",
    "condition": "New-Sealed"
  },
  {
    "id": "nxp-2026-cd-0018",
    "sku": "NXP-2026-CD-0018",
    "artist": "Cave In",
    "title": "Antenna",
    "format": "CD",
    "qty": 1,
    "price": 170000,
    "image": "/public/covers/nxp-2026-cd-0018-cave-in-antenna.jpg",
    "condition": "Used Good"
  },
  {
    "id": "nxp-2026-cd-0019",
    "sku": "NXP-2026-CD-0019",
    "artist": "Animal Collective",
    "title": "Merriweather Post Pavilion",
    "format": "CD",
    "qty": 1,
    "price": 200000,
    "image": "/public/covers/nxp-2026-cd-0019-animal-collective-merriweather-post-pavilion.jpg",
    "condition": "Used Good"
  },
  {
    "id": "nxp-2026-cd-0020",
    "sku": "NXP-2026-CD-0020",
    "artist": "My Bloody Valentine",
    "title": "Isn't Anything",
    "format": "CD",
    "qty": 1,
    "price": 200000,
    "image": "/public/covers/nxp-2026-cd-0020-my-bloody-valentine-isnt-anything.jpg",
    "condition": "Used Good"
  },
  {
    "id": "nxp-2026-cd-0021",
    "sku": "NXP-2026-CD-0021",
    "artist": "JK Flesh, Gothtrad",
    "title": "Knights of The Black Table",
    "format": "CD",
    "qty": 1,
    "price": 250000,
    "image": "/public/covers/nxp-2026-cd-0021-jk-flesh-gothtrad-knights-of-the-black-table.jpg",
    "condition": "Used Excellent"
  },
  {
    "id": "nxp-2026-cd-0022",
    "sku": "NXP-2026-CD-0022",
    "artist": "Soft Moon",
    "title": "Criminal",
    "format": "CD",
    "qty": 1,
    "price": 250000,
    "image": "/public/covers/nxp-2026-cd-0022-soft-moon-criminal.jpg",
    "condition": "Used Excellent"
  },
  {
    "id": "nxp-2026-cst-0007",
    "sku": "NXP-2026-CST-0007",
    "artist": "Behold The Arctopus",
    "title": "Interstellar Overtrove",
    "format": "Cassette",
    "qty": 1,
    "price": 190000,
    "image": "/public/covers/nxp-2026-cst-0007-behold-the-arctopus-interstellar-overtrove.jpg",
    "condition": "Used Excellent"
  },
  {
    "id": "nxp-2026-cst-0008",
    "sku": "NXP-2026-CST-0008",
    "artist": "FACS",
    "title": "Wish Defense",
    "format": "Cassette",
    "qty": 1,
    "price": 450000,
    "image": "/public/covers/nxp-2026-cst-0008-facs-wish-defense.jpg",
    "condition": "New-Sealed"
  },
  {
    "id": "nxp-2026-cst-0009",
    "sku": "NXP-2026-CST-0009",
    "artist": "Peggy Gou",
    "title": "I Hear You",
    "format": "Cassette",
    "qty": 1,
    "price": 450000,
    "image": "/public/covers/nxp-2026-cst-0009-peggy-gou-i-hear-you.jpg",
    "condition": "New-Sealed"
  },
  {
    "id": "nxp-2026-vnl-0007",
    "sku": "NXP-2026-VNL-0007",
    "artist": "Hiatus Kaiyote",
    "title": "Love Heart Cheat Code",
    "format": "Vinyl",
    "qty": 1,
    "price": 900000,
    "image": "/public/uploads/products/nxp-2026-vnl-0007-love-heart-cheat-code-love-heart-cheat-code-main-jpg-1783884529459.jpg",
    "condition": "New-Sealed"
  },
  {
    "id": "nxp-2026-vnl-0008",
    "sku": "NXP-2026-VNL-0008",
    "artist": "Arca",
    "title": "&&&&&",
    "format": "Vinyl",
    "qty": 1,
    "price": 700000,
    "image": "/public/covers/nxp-2026-vnl-0008-arca-.jpg",
    "condition": "New-Sealed"
  },
  {
    "id": "nxp-2026-vnl-0009",
    "sku": "NXP-2026-VNL-0009",
    "artist": "Panda Bear",
    "title": "Buoys",
    "format": "Vinyl",
    "qty": 1,
    "price": 550000,
    "image": "/public/covers/nxp-2026-vnl-0009-panda-bear-buoys.jpg",
    "condition": "New-Sealed"
  },
  {
    "id": "nxp-2026-vnl-0010",
    "sku": "NXP-2026-VNL-0010",
    "artist": "Overmono & The Streets Turn The Page",
    "title": "Turn The Page",
    "format": "Vinyl",
    "qty": 1,
    "price": 550000,
    "image": "/public/covers/nxp-2026-vnl-0010-overmono-the-streets-turn-the-page-turn-the-page.png",
    "condition": "New-Sealed"
  },
  {
    "id": "nxp-2026-vnl-0011",
    "sku": "NXP-2026-VNL-0011",
    "artist": "Heith & Tarawangsawelas",
    "title": "Duori",
    "format": "Vinyl",
    "qty": 1,
    "price": 1000000,
    "image": "/public/covers/nxp-2026-vnl-0011-heith-tarawangsawelas-duori.jpg",
    "condition": "New-Sealed"
  },
  {
    "id": "nxp-2026-vnl-0012",
    "sku": "NXP-2026-VNL-0012",
    "artist": "Blawan",
    "title": "SickElixir",
    "format": "Vinyl",
    "qty": 1,
    "price": 950000,
    "image": "/public/covers/nxp-2026-vnl-0012-blawan-sickelixir.jpg",
    "condition": "New-Sealed"
  },
  {
    "id": "nxp-2026-vnl-0013-self-titled",
    "sku": "NXP-2026-VNL-0013",
    "artist": "Giant Swan",
    "title": "Self Titled",
    "format": "Vinyl",
    "qty": 1,
    "price": 500000,
    "image": "https://ozxkbmexuiuuhjvohxbb.supabase.co/storage/v1/object/public/product-images/products/nxp-2026-vnl-0013-1784281689333-a2998490938-10.jpg",
    "condition": "New-Unsealed"
  },
  {
    "id": "nxp-2026-cd-0023",
    "sku": "NXP-2026-CD-0023",
    "artist": "Oneohtrix Point Never",
    "title": "Tranquilizer",
    "format": "CD",
    "qty": 1,
    "price": 300000,
    "image": "/public/covers/nxp-2026-cd-0023-oneohtrix-point-never-tranquilizer.jpg",
    "condition": "Used Excellence"
  },
  {
    "id": "nxp-2026-cd-0024-antemasque",
    "sku": "NXP-2026-CD-0024",
    "artist": "Antemasque",
    "title": "Antemasque",
    "format": "CD",
    "qty": 1,
    "price": 300000,
    "image": "/public/covers/nxp-2026-cd-0024-antemasque.jpg",
    "condition": "Used Excellent"
  }
];

const recordLabels = {
  "nxp-2026-vnl-0006": "Alter",
  "nxp-2026-cd-0015": "Nuclear Blast",
  "nxp-2026-cst-0005": "Cav Empt",
  "nxp-2026-cd-0010": "Warner Bros. Records / Sargent House",
  "nxp-2026-cd-0011": "ISO Records / Columbia",
  "nxp-2026-cd-0012": "The Null Corporation / Columbia",
  "nxp-2026-cd-0016": "Load Records",
  "nxp-2026-vnl-0004": "Rough Trade Records",
  "nxp-2026-vnl-0005": "Rough Trade Records",
  "nxp-2026-cd-0001": "Nuclear Blast",
  "nxp-2026-cd-0002": "Maverick",
  "nxp-2026-cd-0003": "Freestyle Dust / Virgin",
  "nxp-2026-cd-0004": "Freestyle Dust / Parlophone",
  "nxp-2026-cd-0005": "Dress Up / Interscope",
  "nxp-2026-cd-0006": "Maverick / Warner Bros.",
  "nxp-2026-cd-0007": "True Panther",
  "nxp-2026-cd-0008": "A24 Music",
  "nxp-2026-cd-0009": "Transgressive / Future Classic",
  "nxp-2026-cst-0001": "Nothing Records / Interscope",
  "nxp-2026-cst-0002": "Undying Music",
  "nxp-2026-cst-0004": "Maverick / Warner Bros.",
  "nxp-2026-cst-0006": "XL Recordings",
  "nxp-2026-vnl-0001": "Warp Records",
  "nxp-2026-vnl-0002": "A-Zap",
  "nxp-2026-vnl-0003": "Warp Records",
  "nxp-2026-cd-0013": "Innocent Records / Contra-Disc",
  "nxp-2026-cd-0014": "Orange Cliff Records",
  "nxp-2026-cd-0017": "ISO Records / Columbia",
  "nxp-2026-cd-0018": "RCA",
  "nxp-2026-cd-0019": "Domino",
  "nxp-2026-cd-0020": "Creation Records",
  "nxp-2026-cd-0021": "Avalanche Recordings / Daymare Recordings",
  "nxp-2026-cd-0022": "Sacred Bones Records",
  "nxp-2026-cst-0007": "P2",
  "nxp-2026-cst-0008": "Trouble In Mind",
  "nxp-2026-cst-0009": "XL Recordings",
  "nxp-2026-vnl-0007": "Brainfeeder",
  "nxp-2026-vnl-0008": "PAN",
  "nxp-2026-vnl-0009": "Domino",
  "nxp-2026-vnl-0010": "XL Recordings",
  "nxp-2026-vnl-0011": "Stroom",
  "nxp-2026-vnl-0012": "XL Recordings",
  "nxp-2026-vnl-0013-self-titled": "Keck",
  "nxp-2026-cd-0023": "Warp Records",
  "nxp-2026-cd-0024-antemasque": "Nadie Sound"
};

const recordYears = {
  "nxp-2026-vnl-0006": 2013,
  "nxp-2026-cd-0015": 2008,
  "nxp-2026-cst-0005": 2025,
  "nxp-2026-cd-0010": 2012,
  "nxp-2026-cd-0011": 2016,
  "nxp-2026-cd-0012": 2013,
  "nxp-2026-cd-0016": 2009,
  "nxp-2026-vnl-0004": 2019,
  "nxp-2026-vnl-0005": 2025,
  "nxp-2026-cd-0001": 1998,
  "nxp-2026-cd-0002": 2005,
  "nxp-2026-cd-0003": 2002,
  "nxp-2026-cd-0004": 2010,
  "nxp-2026-cd-0005": 2009,
  "nxp-2026-cd-0006": 2003,
  "nxp-2026-cd-0007": 2025,
  "nxp-2026-cd-0008": 2025,
  "nxp-2026-cd-0009": 2024,
  "nxp-2026-cst-0001": 2000,
  "nxp-2026-cst-0002": 2002,
  "nxp-2026-cst-0004": 2003,
  "nxp-2026-cst-0006": 1997,
  "nxp-2026-vnl-0001": 2026,
  "nxp-2026-vnl-0002": 2024,
  "nxp-2026-vnl-0003": 2024,
  "nxp-2026-cd-0013": 2012,
  "nxp-2026-cd-0014": 2015,
  "nxp-2026-cd-0017": 2013,
  "nxp-2026-cd-0018": 2003,
  "nxp-2026-cd-0019": 2009,
  "nxp-2026-cd-0020": 1988,
  "nxp-2026-cd-0021": 2019,
  "nxp-2026-cd-0022": 2018,
  "nxp-2026-cst-0007": 2023,
  "nxp-2026-cst-0008": 2025,
  "nxp-2026-cst-0009": 2024,
  "nxp-2026-vnl-0007": 2024,
  "nxp-2026-vnl-0008": 2013,
  "nxp-2026-vnl-0009": 2019,
  "nxp-2026-vnl-0010": 2024,
  "nxp-2026-vnl-0011": 2026,
  "nxp-2026-vnl-0012": 2025,
  "nxp-2026-vnl-0013-self-titled": 2019,
  "nxp-2026-cd-0023": 2025,
  "nxp-2026-cd-0024-antemasque": 2014
};

const recordRelatedArtists = {
  "nxp-2026-vnl-0006": ["Puce Mary", "Croatian Amor", "Lust For Youth"],
  "nxp-2026-cd-0015": ["Gojira", "Car Bomb", "Tesseract"],
  "nxp-2026-cst-0005": ["Actress", "Huerco S.", "Kassem Mosse"],
  "nxp-2026-cd-0010": ["At The Drive-In", "Omar Rodriguez-Lopez", "Antemasque"],
  "nxp-2026-cd-0011": ["Scott Walker", "Nine Inch Nails", "Brian Eno"],
  "nxp-2026-cd-0012": ["Trent Reznor and Atticus Ross", "How to Destroy Angels", "Ministry"],
  "nxp-2026-cd-0016": ["Hella", "Melt-Banana", "Black Pus"],
  "nxp-2026-vnl-0004": ["The Murder Capital", "Shame", "Squid"],
  "nxp-2026-vnl-0005": ["The Murder Capital", "Shame", "Squid"],
  "nxp-2026-cd-0001": ["Gojira", "Car Bomb", "Tesseract"],
  "nxp-2026-cd-0002": ["Deftones", "Crosses", "Palms"],
  "nxp-2026-cd-0003": ["Fatboy Slim", "The Prodigy", "The Crystal Method"],
  "nxp-2026-cd-0004": ["Fatboy Slim", "The Prodigy", "Underworld"],
  "nxp-2026-cd-0005": ["The Strokes", "TV On The Radio", "The Rapture"],
  "nxp-2026-cd-0006": ["Don Davis", "Juno Reactor", "Rob Dougan"],
  "nxp-2026-cd-0007": ["Gilla Band", "Daughters", "The Armed"],
  "nxp-2026-cd-0008": ["Oneohtrix Point Never", "Tim Hecker", "Arca"],
  "nxp-2026-cd-0009": ["Arca", "A. G. Cook", "Charli XCX"],
  "nxp-2026-cst-0001": ["Trent Reznor and Atticus Ross", "How to Destroy Angels", "Ministry"],
  "nxp-2026-cst-0002": ["Thursday", "Glassjaw", "From Autumn to Ashes"],
  "nxp-2026-cst-0004": ["Don Davis", "Juno Reactor", "Rob Dougan"],
  "nxp-2026-cst-0006": ["The Chemical Brothers", "The Crystal Method", "Fatboy Slim"],
  "nxp-2026-vnl-0001": ["Aphex Twin", "Autechre", "u-Ziq"],
  "nxp-2026-vnl-0002": ["Lightning Bolt", "Hella", "Boredoms"],
  "nxp-2026-vnl-0003": ["Floating Points", "Shabaka Hutchings", "Sam Gendel"],
  "nxp-2026-cd-0013": ["Keiji Haino", "Otomo Yoshihide", "Rully Shabara"],
  "nxp-2026-cd-0014": ["Mooner", "The Sigit", "White Shoes & The Couples Company"],
  "nxp-2026-cd-0017": ["Scott Walker", "Brian Eno", "Iggy Pop"],
  "nxp-2026-cd-0018": ["Converge", "Isis", "Botch"],
  "nxp-2026-cd-0019": ["Panda Bear", "Avey Tare", "Boards of Canada"],
  "nxp-2026-cd-0020": ["Slowdive", "Ride", "Cocteau Twins"],
  "nxp-2026-cd-0021": ["Godflesh", "Justin Broadrick", "Scorn"],
  "nxp-2026-cd-0022": ["Cold Cave", "Drab Majesty", "TR/ST"],
  "nxp-2026-cst-0007": ["Dysrhythmia", "Krallice", "Orthrelm"],
  "nxp-2026-cst-0008": ["Disappears", "Preoccupations", "Ought"],
  "nxp-2026-cst-0009": ["DJ Koze", "Jayda G", "Honey Dijon"],
  "nxp-2026-vnl-0007": ["Nai Palm", "Moonchild", "Thundercat"],
  "nxp-2026-vnl-0008": ["SOPHIE", "FKA twigs", "Bjork"],
  "nxp-2026-vnl-0009": ["Animal Collective", "Avey Tare", "Deakin"],
  "nxp-2026-vnl-0010": ["Joy Orbison", "Bicep", "The Streets"],
  "nxp-2026-vnl-0011": ["Jon Hassell", "Tarawangsawelas", "Heith"],
  "nxp-2026-vnl-0012": ["Karenn", "Pariah", "Surgeon"],
  "nxp-2026-vnl-0013-self-titled": ["Blawan", "Tzusing"],
  "nxp-2026-cd-0023": ["Tim Hecker", "Arca", "Daniel Lopatin"],
  "nxp-2026-cd-0024-antemasque": ["The Mars Volta", "At The Drive-In", "Red Hot Chili Peppers"]
};

const nixpSelectionIds = new Set([
  "nxp-2026-cst-0005",
  "nxp-2026-cd-0011",
  "nxp-2026-cd-0007",
  "nxp-2026-cd-0008",
  "nxp-2026-cd-0009",
  "nxp-2026-vnl-0001",
  "nxp-2026-vnl-0003",
  "nxp-2026-vnl-0008",
  "nxp-2026-vnl-0011",
  "nxp-2026-vnl-0012",
  "nxp-2026-cd-0023"
]);

const backInStockIds = new Set([
  "nxp-2026-cd-0015",
  "nxp-2026-cd-0001",
  "nxp-2026-cd-0002",
  "nxp-2026-cd-0003",
  "nxp-2026-cd-0004",
  "nxp-2026-cst-0006",
  "nxp-2026-cd-0019",
  "nxp-2026-cd-0020"
]);

function recordHomeCollections(row) {
  const collections = [];
  if ([2025, 2026].includes(Number(recordYears[row.id] || row.year || 0))) collections.push("recent-releases");
  if (nixpSelectionIds.has(row.id)) collections.push("nixp-selection");
  if (backInStockIds.has(row.id)) collections.push("back-in-stock");
  if (row.condition === "New-Sealed" && ["Vinyl", "Cassette"].includes(row.format)) collections.push("limited-pressing");
  return collections;
}

const recordMockups = {
  "nxp-2026-vnl-0001": "/public/mockups/nxp-2026-vnl-0001-squarepusher-kammerkonzert-vinyl.jpg",
  "nxp-2026-vnl-0002": "/public/mockups/nxp-2026-vnl-0002-melt-banana-3-5-vinyl.jpg",
  "nxp-2026-vnl-0003": "/public/mockups/nxp-2026-vnl-0003-nala-sinephro-endlessness-vinyl.jpg",
  "nxp-2026-vnl-0004": "/public/mockups/nxp-2026-vnl-0004-girl-band-the-talkies-vinyl.jpg",
  "nxp-2026-vnl-0005": "/public/mockups/nxp-2026-vnl-0005-gilla-band-the-early-years-vinyl.jpg",
  "nxp-2026-vnl-0007": "/public/mockups/nxp-2026-vnl-0007-hiatus-kaiyote-love-heart-cheat-code-vinyl.jpg",
  "nxp-2026-vnl-0008": "/public/mockups/nxp-2026-vnl-0008-arca-and-and-and-and-and-vinyl.jpg",
  "nxp-2026-vnl-0009": "/public/mockups/nxp-2026-vnl-0009-panda-bear-buoys-vinyl.jpg",
  "nxp-2026-vnl-0010": "/public/mockups/nxp-2026-vnl-0010-overmono-the-streets-turn-the-page-vinyl.jpg",
  "nxp-2026-vnl-0011": "/public/mockups/nxp-2026-vnl-0011-heith-tarawangsawelas-duori-vinyl.jpg",
  "nxp-2026-vnl-0012": "/public/mockups/nxp-2026-vnl-0012-blawan-sickelixir-vinyl.jpg",
  "nxp-2026-vnl-0013-self-titled": "/public/mockups/nxp-2026-vnl-0013-giant-swan-self-titled-vinyl.jpg"
};

const recordGalleries = {
  "nxp-2026-cd-0024-antemasque": [
    "/public/mockups/nxp-2026-cd-0024-antemasque-cd-front.jpg",
    "/public/mockups/nxp-2026-cd-0024-antemasque-cd-disc.jpg",
    "/public/mockups/nxp-2026-cd-0024-antemasque-cd-package.jpg"
  ]
};

const recordImageCredits = {
  "nxp-2026-vnl-0001": { credit: "Squarepusher Bandcamp", url: "https://squarepusher.bandcamp.com/" },
  "nxp-2026-vnl-0002": { credit: "Turntable Lab", url: "https://www.turntablelab.com/products/melt-banana-3-5-colored-vinyl-vinyl-lp" },
  "nxp-2026-vnl-0003": { credit: "Nala Sinephro Bandcamp", url: "https://nalasinephro.bandcamp.com/album/endlessness" },
  "nxp-2026-vnl-0004": { credit: "Gilla Band Bandcamp", url: "https://gillaband.bandcamp.com/album/the-talkies" },
  "nxp-2026-vnl-0005": { credit: "Gilla Band Bandcamp", url: "https://gillaband.bandcamp.com/album/the-early-years" },
  "nxp-2026-vnl-0007": { credit: "Hiatus Kaiyote Bandcamp", url: "https://hiatuskaiyote.bandcamp.com/merch" },
  "nxp-2026-vnl-0008": { credit: "Arca Bandcamp", url: "https://arca1000000.bandcamp.com/" },
  "nxp-2026-vnl-0009": { credit: "Domino", url: "https://www.dominomusic.com/releases/panda-bear/buoys/deluxe-lp" },
  "nxp-2026-vnl-0010": { credit: "Overmono Bandcamp", url: "https://overmono.bandcamp.com/album/turn-the-page" },
  "nxp-2026-vnl-0011": { credit: "Meditations", url: "https://meditations.jp/products/heith-tarawangsawelas-duori-lp" },
  "nxp-2026-vnl-0012": { credit: "Turntable Lab", url: "https://www.turntablelab.com/products/blawan-sickelixir-vinyl-lp" },
  "nxp-2026-vnl-0013-self-titled": { credit: "Turntable Lab", url: "https://www.turntablelab.com/products/giant-swan-giant-swan-vinyl-lp" }
};

/* Legacy editorial snapshot retained only for historical reference.
const recordEditorialLegacy = {
  "nxp-2026-cd-0011": {
    description: "David Bowie's 2016 Blackstar is a Columbia studio album that folds exploratory jazz, coded drama and alienation into a final act of reinvention.",
    descriptionSource: "Pitchfork",
    reviewQuote: "Exploratory jazz and the echos of various mad men soundtrack his free fall.",
    reviewSource: "Pitchfork",
    reviewUrl: "https://pitchfork.com/reviews/albums/21332-blackstar/"
  },
  "nxp-2026-cd-0005": {
    description: "Yeah Yeah Yeahs' 2009 It's Blitz! recombines rock, synths and dance-floor instincts into a bracing, emotionally open third album.",
    descriptionSource: "Pitchfork",
    reviewQuote: "YYYs make the dreaded ‘mature album’ work by taking familiar shapes and tools and recombining them in ways that are bracing and unexpected.",
    reviewSource: "Pitchfork",
    reviewUrl: "https://pitchfork.com/reviews/albums/12855-its-blitz/"
  },
  "nxp-2026-vnl-0003": {
    description: "Nala Sinephro's 2024 Endlessness centers on an evolving arpeggio, bringing harp, piano, modular synths and London's jazz community into one continuous field.",
    descriptionSource: "Pitchfork",
    reviewQuote: "It feels like a feat of physics.",
    reviewSource: "Pitchfork",
    reviewUrl: "https://pitchfork.com/reviews/albums/nala-sinephro-endlessness/"
  },
  "nxp-2026-cd-0023": {
    description: "Oneohtrix Point Never's 2025 Tranquilizer turns unstable commercial sample archives into dense, transportive electronic music about impermanence.",
    descriptionSource: "Pitchfork",
    reviewQuote: "The most immediately pleasurable Oneohtrix Point Never album in some time.",
    reviewSource: "Pitchfork",
    reviewUrl: "https://pitchfork.com/reviews/albums/oneohtrix-point-never-tranquilizer/"
  },
  "nxp-2026-vnl-0013-self-titled": {
    description: "Giant Swan's self-titled debut is a 2019 Keck LP by Bristol duo Robin Stewart and Harry Wright, built from rugged electronics, improvised pressure and physical club energy.",
    descriptionSource: "Giant Swan Bandcamp / The Wire",
    reviewQuote: "A statement that changes with each recipient, centered around tolerance, inclusion, self-sufficiency and TRUST.",
    reviewSource: "Turntable Lab, quoted from Giant Swan",
    reviewUrl: "https://www.turntablelab.com/products/giant-swan-giant-swan-vinyl-lp"
  }
};
*/

export const products = [
  ...recordRows.map((row) => record(row)),
  {
    id: "nxp-2026-obj-0002-preform",
    sku: "NXP-2026-OBJ-0002",
    title: "Preform",
    artist: "Cold Metal Breathes Too",
    format: "Object",
    displayFormat: "",
    category: "Objects",
    apparelType: "",
    condition: "",
    price: 480000,
    year: 2026,
    label: "Nix Powell",
    collection: "Cold Metal Breathes Too",
    color: "Palladio",
    material: "White Brass",
    image: "/public/uploads/products/nxp-2026-obj-0002-preform-dsc08746j-jpg-1783846293637.jpg",
    images: ["/public/uploads/products/nxp-2026-obj-0002-preform-dsc08746j-jpg-1783846293637.jpg"],
    tags: [],
    details: ["Brass Ring"],
    sizes: [
      { label: "9", quantity: 4, soldOut: false },
      { label: "11", quantity: 5, soldOut: false }
    ],
    description:
      "PREFORM RINGNIX POWELL \"PREFORM\" RING IN BRASS\nTHESE JEWELLERY PIECES ARE CRAFTED WITH THE INDIVIDUAL HANDWORK OF THE ARTISAN, MAKING EACH PIECE UNIQUE.\nWHITE BRASS WITH A BRUSHED PALLADIUM FINISH\n\n\nCOLOR: PALLADIO\nMATERIAL: 100% BRASS",
    qty: 1
  },
  {
    id: "app-001",
    sku: "NXP-2023-APP-0001",
    title: "Crewneck Sweatshirt",
    artist: "Motorith",
    format: "Apparel",
    category: "Apparel",
    apparelType: "Tops",
    price: 500000,
    year: 2023,
    label: "Motorith",
    image: apparelImage,
    images: [apparelImage],
    tags: ["crewneck", "sweatshirt", "black"],
    material: "Cotton fleece",
    color: "Black",
    sizes: [
      { label: "S", soldOut: true },
      { label: "M", soldOut: false },
      { label: "L", soldOut: false },
      { label: "XL", soldOut: false },
      { label: "XXL", soldOut: true }
    ],
    description: "Motorith crewneck sweatshirt from 2023 with front and sleeve artwork.",
    details: ["SKU: NXP-2023-APP-0001", "Cotton fleece", "Black"]
  },
  {
    id: "app-002",
    sku: "NXP-2026-APP-0002",
    title: "Flesh Knitsweater",
    artist: "NIXP Apparel",
    format: "Apparel",
    category: "Apparel",
    apparelType: "Tops",
    price: 650000,
    year: 2026,
    label: "NIXP Apparel",
    collection: "NIXP Apparel",
    image: "/public/nixp-product-example-paper.png",
    images: ["/public/nixp-product-example-paper.png"],
    tags: ["knitsweater", "apparel"],
    material: "Knit cotton blend",
    color: "Black",
    sizes: [
      { label: "S", soldOut: false },
      { label: "M", soldOut: false },
      { label: "L", soldOut: false },
      { label: "XL", soldOut: false }
    ],
    description: "Flesh Knitsweater apparel item.",
    details: ["SKU: NXP-2026-APP-0002", "Knit sweater", "Black"]
  },
  {
    id: "nxp-2026-app-0010-osculum-nylon-black-polo-cap",
    sku: "NXP-2026-APP-0010",
    title: "Osculum Nylon Black Polo Cap",
    artist: "Cold Metal Breathes Too",
    format: "Apparel",
    category: "Apparel",
    apparelType: "Accessories",
    qty: 12,
    price: 320000,
    year: 2026,
    label: "Nix Powell",
    collection: "Cold Metal Breathes Too",
    color: "Black",
    material: "Nylon",
    image: "/public/uploads/products/nxp-2026-app-0010-osculum-cap-1.jpg",
    images: [1, 2, 3, 4, 5].map((index) => `/public/uploads/products/nxp-2026-app-0010-osculum-cap-${index}.jpg`),
    tags: [],
    details: [],
    sizes: [],
    description:
      "Polo cap in nylon with front Osculum art embroidery and Tether art embroidered on the side\n\nRound crown\nCurved brim\nFront art embroidery\nSide art embroidery\nFive-part construction\nAdjustable strap at rear\n100% Nylon\nColor: Black"
  },
  {
    id: "pub-001",
    sku: "NXP-2026-PUB-0001",
    title: "Index 01: Jakarta Independent Sound",
    artist: "NIXP Publishing",
    format: "Magazine",
    category: "Publishing",
    qty: 0,
    price: 250000,
    year: 2026,
    label: "NIXP Publishing",
    image: recordImage,
    images: [recordImage],
    tags: ["interviews", "photography"],
    description: "The first NIXP publishing index: interviews, photography, release notes, and shop fragments.",
    details: ["SKU: NXP-2026-PUB-0001", "80 pages", "Offset printed", "First issue"]
  }
];

export const inventory = [];

export const orders = [];

export const requestItems = [];

export const cashflow = [];

function record(row) {
  const displayFormat = row.format === "Vinyl" ? "Vinyl 12\"" : row.format;
  const image = row.image || recordImage;
  const mockup = ["New-Sealed", "New-Unsealed"].includes(row.condition) && row.format === "Vinyl" ? recordMockups[row.id] : null;
  const gallery = recordGalleries[row.id] || [];
  const galleryCredits = gallery.map((galleryImage) => ({
    image: galleryImage,
    credit: "Discogs release r6310531 image",
    url: "https://www.discogs.com/release/6310531-Antemasque-Antemasque"
  }));
  return {
    id: row.id,
    sku: row.sku,
    title: row.title,
    artist: row.artist,
    condition: row.condition || "Available",
    format: row.format,
    displayFormat,
    category: "Records",
    qty: row.qty,
    price: row.price,
    year: recordYears[row.id] || 2026,
    label: recordLabels[row.id] || row.label || "NIXP Selection",
    image,
    images: [...new Set(mockup ? [image, mockup, ...gallery] : [image, ...gallery])],
    imageCredits: [
      ...(mockup && recordImageCredits[row.id] ? [{ image: mockup, ...recordImageCredits[row.id] }] : []),
      ...galleryCredits
    ],
    tags: [displayFormat, row.sku],
    relatedArtists: recordRelatedArtists[row.id] || [],
    homeCollections: recordHomeCollections(row),
    homeSlideSort: recordRows.findIndex((item) => item.id === row.id) + 1,
    description: recordEditorial[row.id]?.description || `${row.artist} - ${row.title}. ${displayFormat} from the current NIXP records selection.`,
    descriptionSource: recordEditorial[row.id]?.descriptionSource || "",
    reviewQuote: recordEditorial[row.id]?.reviewQuote || "",
    reviewSource: recordEditorial[row.id]?.reviewSource || "",
    reviewUrl: recordEditorial[row.id]?.reviewUrl || "",
    details: [`SKU: ${row.sku}`, `Format: ${displayFormat}`, `Condition: ${row.condition || "Available"}`]
  };
}
