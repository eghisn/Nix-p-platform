import { publishingPageMarkup } from "../src/components/catalogPage.js";

const markup = publishingPageMarkup([], "Zine");
for (const filter of ["All", "Poster", "Book", "Zine"]) {
  if (!markup.includes(`data-publishing-filter="${filter}"`)) {
    throw new Error(`Publishing filter ${filter} is missing.`);
  }
}
if (!markup.includes('data-publishing-filter="Zine" aria-pressed="true"')) {
  throw new Error("Publishing filter does not expose its active state.");
}

process.stdout.write("Publishing filters verified.\n");
