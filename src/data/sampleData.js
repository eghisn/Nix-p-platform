export const requestStatuses = [
  "New",
  "Searching",
  "Found",
  "Unavailable",
  "Contacted",
  "Closed"
];

export const artistNames = [
  "Girl Band",
  "Squarepusher",
  "Giant Swan",
  "Damien Dubrovnik",
  "Hiatus Kaiyote",
  "Arca",
  "Melt Banana",
  "Nala Sinephro",
  "Gilla Band",
  "Panda Bear",
  "Model Actriz",
  "Daniel Lopatin",
  "Sophie",
  "The Mars Volta",
  "Lightning Bolt",
  "Meshuggah",
  "David Bowie",
  "Nine Inch Nails",
  "Meshuggah",
  "Team Sleep",
  "Behold The Arctopus",
  "Sigmun",
  "Senyawa with Kazuhisa Uchihashi",
  "The Chemical Brothers",
  "The Chemical Brothers",
  "Yeah Yeah Yeahs",
  "Matrix",
  "Oneohtrix Point Never",
  "Rezzet",
  "Matrix",
  "Nine Inch Nails"
];

const recordImage = "/public/nixp-product-example-paper.png";
const apparelImage = "/public/motorith-crewneck-sweatshirt-2023-transparent.png";

export const products = [
  record("rec-001", "Girl Band", "The Talkies", "New", "Vinyl", 1),
  record("rec-002", "Squarepusher", "Kammerkonzert", "New", "Vinyl", 1),
  record("rec-003", "Giant Swan", "", "Unsealed", "Vinyl", 1),
  record("rec-004", "Damien Dubrovnik", "First Burning Attraction", "Used", "Vinyl", 1),
  record("rec-005", "Hiatus Kaiyote", "Love Heart Cheat Code", "New", "Vinyl", 1),
  record("rec-006", "Arca", "&&&&&", "New", "Vinyl", 1, "Vinyl 12\""),
  record("rec-007", "Melt Banana", "3+5", "New", "Vinyl", 1),
  record("rec-008", "Nala Sinephro", "Endlessness", "New", "Vinyl", 1),
  record("rec-009", "Gilla Band", "The Early Years", "New", "Vinyl", 1),
  record("rec-010", "Panda Bear", "Buoys", "New", "Vinyl", 1),
  record("rec-011", "Model Actriz", "Pirouette", "New", "CD", 1),
  record("rec-012", "Daniel Lopatin", "Marty Supreme", "New", "CD", 1),
  record("rec-013", "Sophie", "Sophie", "New", "CD", 1),
  record("rec-014", "The Mars Volta", "Noctourniquet", "New", "CD", 1),
  record("rec-015", "Lightning Bolt", "Earthly Delights", "Used", "CD", 1),
  record("rec-016", "Meshuggah", "Obzen", "Used", "CD", 1),
  record("rec-017", "David Bowie", "Blackstar", "Used", "CD", 1),
  record("rec-018", "Nine Inch Nails", "Hesitation Marks", "Used", "CD", 1),
  record("rec-019", "Meshuggah", "Chaosphere", "Used", "CD", 1),
  record("rec-020", "Team Sleep", "Maverick", "Used", "CD", 1),
  record("rec-021", "Sigmun", "Crimson Eyes", "Used", "CD", 1),
  record("rec-022", "Senyawa with Kazuhisa Uchihashi", "", "Used", "CD", 1),
  record("rec-023", "The Chemical Brothers", "", "Used", "CD", 1),
  record("rec-024", "The Chemical Brothers", "", "Used", "CD", 1),
  record("rec-025", "Yeah Yeah Yeahs", "", "Used", "CD", 1),
  record("rec-026", "Matrix", "Reloaded ost", "Used", "CD", 1),
  record("rec-027", "Oneohtrix Point Never", "Tranquilizer", "Used", "CD", 1),
  record("rec-028", "Behold The Arctopus", "Interstellar Overtrove", "New", "Cassette", 1),
  record("rec-029", "Rezzet", "", "New", "Cassette", 1),
  record("rec-030", "Matrix", "Reloaded Ost", "Used", "Cassette", 2),
  record("rec-031", "Nine Inch Nails", "Things Falling Apart", "Used", "Cassette", 1),
  {
    id: "obj-001",
    title: "Listening Stone No. 4",
    artist: "Anan Studio",
    format: "Object",
    category: "Objects",
    price: 950000,
    year: 2026,
    label: "Object Series",
    image: recordImage,
    tags: ["ceramic", "edition of 20"],
    description: "A small ceramic listening object made to sit beside records, books, and speakers.",
    details: ["Ceramic", "Edition of 20", "Made in Jakarta"]
  },
  {
    id: "app-001",
    title: "Crewneck Sweatshirt",
    artist: "Motorith",
    format: "Apparel",
    category: "Apparel",
    apparelType: "Tops",
    price: 500000,
    year: 2023,
    label: "Motorith",
    image: apparelImage,
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
    details: ["Cotton fleece", "Black"]
  },
  {
    id: "pub-001",
    title: "Index 01: Jakarta Independent Sound",
    artist: "NIXP Publishing",
    format: "Magazine",
    category: "Publishing",
    price: 250000,
    year: 2026,
    label: "NIXP Publishing",
    image: recordImage,
    tags: ["interviews", "photography"],
    description: "The first NIXP publishing index: interviews, photography, release notes, and shop fragments.",
    details: ["80 pages", "Offset printed", "First issue"]
  },
  {
    id: "pub-002",
    title: "Rooms for Listening",
    artist: "Tida Lek",
    format: "Book",
    category: "Publishing",
    price: 390000,
    year: 2025,
    label: "Quiet Shelf",
    image: recordImage,
    tags: ["essay", "design"],
    description: "Essays and images about domestic rooms, private listening, and the architecture of shelves.",
    details: ["Softcover book", "120 pages", "English language"]
  }
];

export const inventory = products.map((product, index) => ({
  sku: `NIXP-${product.id.toUpperCase()}`,
  productId: product.id,
  location: product.category === "Records" ? `${product.format} Shelf` : "Shop Floor",
  stock: product.qty || 1,
  lowStockAt: 1,
  status: (product.qty || 1) > 0 ? "In stock" : "Sold out",
  sort: index
}));

export const orders = [
  {
    id: "ORD-1042",
    customer: "Pim S.",
    channel: "Website",
    status: "Paid",
    date: "2026-07-01",
    total: 1540000,
    items: ["rec-001", "rec-009", "pub-001"]
  },
  {
    id: "ORD-1043",
    customer: "Daniel K.",
    channel: "Instagram",
    status: "Packing",
    date: "2026-07-02",
    total: 640000,
    items: ["rec-016"]
  },
  {
    id: "ORD-1044",
    customer: "Ari T.",
    channel: "Website",
    status: "Shipped",
    date: "2026-07-03",
    total: 1400000,
    items: ["obj-001", "app-001"]
  },
  {
    id: "ORD-1045",
    customer: "Mei L.",
    channel: "Walk-in",
    status: "Closed",
    date: "2026-07-06",
    total: 640000,
    items: ["pub-002", "pub-001"]
  }
];

export const requestItems = [
  {
    id: "REQ-030",
    artistName: "Arca",
    itemName: "Any available title",
    format: "Vinyl",
    email: "sample@nixp.local",
    whatsapp: "+62 821 2287 6289",
    notes: "Customer prefers a clean copy.",
    status: "Searching"
  },
  {
    id: "REQ-031",
    artistName: "Panda Bear",
    itemName: "Any available title",
    format: "CD",
    email: "collector@nixp.local",
    whatsapp: "+62 821 2287 6289",
    notes: "Notify if a copy appears.",
    status: "Searching"
  }
];

export const cashflow = [
  { month: "Mar", revenue: 4280000, expenses: 2160000, net: 2120000 },
  { month: "Apr", revenue: 5120000, expenses: 2840000, net: 2280000 },
  { month: "May", revenue: 4860000, expenses: 2400000, net: 2460000 },
  { month: "Jun", revenue: 6340000, expenses: 3120000, net: 3220000 },
  { month: "Jul", revenue: 2980000, expenses: 1410000, net: 1570000 }
];

function record(id, artist, title, condition, format, qty, displayFormat = format === "Vinyl" ? "Vinyl 12\"" : format) {
  const displayTitle = title?.trim() || "Untitled Selection";
  const price = priceFor(format, condition);
  return {
    id,
    title: displayTitle,
    artist,
    condition,
    format,
    displayFormat,
    category: "Records",
    qty,
    price,
    year: 2026,
    label: "NIXP Selection",
    image: recordImage,
    tags: [condition, displayFormat],
    description: `${artist} - ${displayTitle}. ${condition} ${format.toLowerCase()} copy from the current NIXP records selection.`,
    details: [`Format: ${displayFormat}`, `Condition: ${condition}`]
  };
}

function priceFor(format, condition) {
  if (format === "Vinyl") return condition === "Used" ? 520000 : 640000;
  if (format === "CD") return condition === "New" ? 280000 : 180000;
  if (format === "Cassette") return condition === "New" ? 220000 : 170000;
  return 0;
}
