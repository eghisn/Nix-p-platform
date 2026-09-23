import assert from "node:assert/strict";
import { isMidtransConfigured, midtransApiBaseUrl, midtransConfiguration, midtransSnapBaseUrl } from "../api/_lib/commerce.js";

const original = Object.fromEntries([
  "MIDTRANS_ENV",
  "MIDTRANS_ENABLED",
  "MIDTRANS_SERVER_KEY",
  "MIDTRANS_MERCHANT_ID"
].map((key) => [key, process.env[key]]));

try {
  Object.assign(process.env, {
    MIDTRANS_ENV: "production",
    MIDTRANS_ENABLED: "true",
    MIDTRANS_SERVER_KEY: "server-key",
    MIDTRANS_MERCHANT_ID: "merchant-id"
  });
  assert.equal(isMidtransConfigured(), true);
  assert.equal(midtransConfiguration().environment, "production");
  assert.equal(midtransSnapBaseUrl(), "https://app.midtrans.com");
  assert.equal(midtransApiBaseUrl(), "https://api.midtrans.com");

  process.env.MIDTRANS_ENV = "";
  assert.equal(isMidtransConfigured(), false, "A missing environment must not silently use the sandbox gateway.");
  assert.equal(midtransConfiguration().environment, "invalid");

  process.env.MIDTRANS_ENV = "unexpected";
  assert.equal(isMidtransConfigured(), false, "An invalid environment must fail closed.");
} finally {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

console.log("Midtrans configuration fails closed outside an explicit environment.");
