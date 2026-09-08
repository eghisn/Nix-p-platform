import { recordsPageMarkup, recordArtistInitial, validRecordArtistInitial } from "../src/components/recordsPage.js";

const expectedInitials = [
  ["Arca", "A"],
  ["  Death Grips", "D"],
  ["Elysia Crampton", "E"],
  ["9 Lazy 9", ""]
];

for (const [artist, initial] of expectedInitials) {
  if (recordArtistInitial(artist) !== initial) {
    throw new Error(`Artist initial mismatch for ${artist}.`);
  }
}

if (validRecordArtistInitial("a") !== "A" || validRecordArtistInitial("AA")) {
  throw new Error("Artist initial URL validation is incorrect.");
}

const markup = recordsPageMarkup({
  records: [],
  artistInitialFilter: "A",
  availableArtistNames: new Map()
});

if (!markup.includes('data-record-letter="A"') || !markup.includes('aria-pressed="true">A</button>')) {
  throw new Error("Records page does not render the active artist alphabet filter.");
}

process.stdout.write("Records artist alphabet filter verification passed.\n");
