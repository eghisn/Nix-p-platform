import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { NIXP_ADDRESS } from "../src/data/siteDetails.js";

const [main, build, terms] = await Promise.all([
  readFile(new URL("../src/main.js", import.meta.url), "utf8"),
  readFile(new URL("../scripts/build.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/data/termsOfUse.js", import.meta.url), "utf8")
]);

assert.match(main, /import \{ NIXP_ADDRESS \} from "\.\/data\/siteDetails\.js";/);
assert.equal(main.split("${NIXP_ADDRESS}").length - 1, 2, "About and Contact must use the canonical address.");
assert.match(build, /import \{ NIXP_ADDRESS \} from "\.\.\/src\/data\/siteDetails\.js";/);
assert.equal(build.split("${NIXP_ADDRESS}").length - 1, 2, "Static About and Contact pages must use the canonical address.");
assert.equal(terms.split("${NIXP_ADDRESS}").length - 1, 1, "Terms must use the canonical address.");
assert.equal(NIXP_ADDRESS, "Aesthetic Pleasure Gallery, Wijaya Grand Centre, Jl. Darmawangsa Raya Blok G9, 2nd Floor, South Jakarta 12160");
assert.doesNotMatch(`${main}\n${build}\n${terms}`, /2rd Floor|Grand Wijaya Center|Blok G 9/, "Legacy address variants must be removed from public copy.");

console.log("Canonical public address contract passed.");
