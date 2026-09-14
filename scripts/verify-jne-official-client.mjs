import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parsePublicTariffHtml } from "../api/_lib/jneOfficialClient.js";
import { checkoutShippingServiceLabel, jneServiceLabel } from "../src/data/jneServiceLabels.js";

const fixture = await readFile(new URL("./fixtures/jne-tariff-bandung.html", import.meta.url), "utf8");
const services = parsePublicTariffHtml(fixture);
assert.deepEqual(services.map(({ serviceCode, rate, estimatedDaysMin, estimatedDaysMax }) => ({ serviceCode, rate, estimatedDaysMin, estimatedDaysMax })), [
  { serviceCode: "REG", rate: 12000, estimatedDaysMin: 1, estimatedDaysMax: 2 },
  { serviceCode: "YES", rate: 24000, estimatedDaysMin: 1, estimatedDaysMax: 1 }
]);
assert.equal(jneServiceLabel("REG"), "Regular (REG)");
assert.equal(jneServiceLabel("YES"), "Yakin Esok Sampai (YES)");
assert.equal(jneServiceLabel("JTR<130"), "Trucking, under 130 kg (JTR<130)");
assert.equal(checkoutShippingServiceLabel({ courier: "JNE", service: "REG" }), "JNE Regular (REG)");
assert.equal(checkoutShippingServiceLabel({ courier: "Other", serviceName: "Standard" }), "Other Standard");
console.log("Official JNE tariff parser and checkout service labels verified.");
