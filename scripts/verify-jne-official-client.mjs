import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parsePublicTariffHtml } from "../api/_lib/jneOfficialClient.js";

const fixture = await readFile(new URL("./fixtures/jne-tariff-bandung.html", import.meta.url), "utf8");
const services = parsePublicTariffHtml(fixture);
assert.deepEqual(services.map(({ serviceCode, rate, estimatedDaysMin, estimatedDaysMax }) => ({ serviceCode, rate, estimatedDaysMin, estimatedDaysMax })), [
  { serviceCode: "REG", rate: 12000, estimatedDaysMin: 1, estimatedDaysMax: 2 },
  { serviceCode: "YES", rate: 24000, estimatedDaysMin: 1, estimatedDaysMax: 1 }
]);
console.log("Official JNE tariff parser contract verified.");
