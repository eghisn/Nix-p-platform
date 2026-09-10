import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const page = await fs.readFile(path.join(root, "dist", "request-item", "index.html"), "utf8");

assert.match(page, /Looking for something\?/i, "Public Request Item page must use customer-facing guidance.");
assert.match(page, /handled privately and is not displayed publicly/i, "Public Request Item page must explain request privacy.");
assert.doesNotMatch(page, /Request status|status-stack|mini-list/i, "Internal request workflow must not be rendered publicly.");
assert.doesNotMatch(page, />\s*(New|Searching|Found|Unavailable|Contacted|Closed)\s*</i, "Internal request statuses must not appear in public markup.");

console.log("Public Request Item privacy checks passed.");
