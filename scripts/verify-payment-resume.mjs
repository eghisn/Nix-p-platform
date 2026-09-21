import assert from "node:assert/strict";
import { classifyMidtransEvent, hasActionableMidtransInstructions, hasUsableMidtransRedirect, midtransIdempotencyKey, safeMidtransPaymentInstructions } from "../api/_lib/paymentState.js";

const bni = safeMidtransPaymentInstructions({
  payment_type: "bank_transfer",
  va_numbers: [{ bank: "bni", va_number: "8578 6653 8367 7320" }]
});

assert.deepEqual(bni, {
  paymentType: "bank_transfer",
  bank: "BNI",
  vaNumber: "8578665383677320",
  billKey: "",
  billerCode: "",
  paymentCode: "",
  actionUrl: "",
  actionLabel: "",
  qrCodeUrl: ""
});

const permata = safeMidtransPaymentInstructions({ payment_type: "bank_transfer", permata_va_number: "8524-0000-1234" });
assert.equal(permata.bank, "PERMATA");
assert.equal(permata.vaNumber, "852400001234");

const mandiri = safeMidtransPaymentInstructions({ payment_type: "echannel", biller_code: "70012", bill_key: "123 456 789" });
assert.equal(mandiri.billerCode, "70012");
assert.equal(mandiri.billKey, "123456789");

const indomaret = safeMidtransPaymentInstructions({ payment_type: "cstore", store: "indomaret", payment_code: "1234-5678" });
assert.equal(indomaret.paymentCode, "1234-5678");

const shopeePay = safeMidtransPaymentInstructions({
  payment_type: "shopeepay",
  actions: [{ name: "deeplink-redirect", method: "GET", url: "https://shopee.co.id/universal-link/payment" }]
});
assert.equal(shopeePay.actionLabel, "Open ShopeePay");
assert.equal(shopeePay.actionUrl, "https://shopee.co.id/universal-link/payment");
assert.equal(hasActionableMidtransInstructions(shopeePay), true);
const qris = safeMidtransPaymentInstructions({
  payment_type: "qris",
  actions: [
    { name: "generate-qr-code", method: "GET", url: "https://api.midtrans.com/v2/qris/example/qr-code" },
    { name: "generate-qr-code-v2", method: "GET", url: "https://api.midtrans.com/v4/qris/example/qr-code" }
  ]
});
assert.equal(qris.qrCodeUrl, "https://api.midtrans.com/v4/qris/example/qr-code");
assert.equal(hasActionableMidtransInstructions(qris), true);
assert.equal(safeMidtransPaymentInstructions({ payment_type: "qris", actions: [{ name: "generate-qr-code", method: "POST", url: "https://api.midtrans.com/v2/qris/example/qr-code" }] }).qrCodeUrl, "");
assert.equal(safeMidtransPaymentInstructions({ payment_type: "qris", actions: [{ name: "generate-qr-code", method: "GET", url: "https://api.midtrans.com.attacker.example/qr" }] }).qrCodeUrl, "");
assert.equal(hasActionableMidtransInstructions(safeMidtransPaymentInstructions({ payment_type: "ovo" })), false);
assert.equal(safeMidtransPaymentInstructions({ payment_type: "dana", actions: [{ name: "deeplink-redirect", method: "POST", url: "https://m.dana.id/pay" }] }).actionUrl, "");
assert.equal(safeMidtransPaymentInstructions({ payment_type: "dana", actions: [{ name: "deeplink-redirect", method: "GET", url: "javascript:alert(1)" }] }).actionUrl, "");
assert.equal(hasUsableMidtransRedirect("https://app.midtrans.com/snap/v4/redirection/example"), true);
assert.equal(hasUsableMidtransRedirect("https://app.sandbox.midtrans.com/snap/v4/redirection/example"), true);
assert.equal(hasUsableMidtransRedirect("https://app.midtrans.com/snap/v4/redirection/example", "production"), true);
assert.equal(hasUsableMidtransRedirect("https://app.sandbox.midtrans.com/snap/v4/redirection/example", "production"), false);
assert.equal(hasUsableMidtransRedirect("https://app.sandbox.midtrans.com/snap/v4/redirection/example", "sandbox"), true);
assert.equal(hasUsableMidtransRedirect("https://app.midtrans.com/snap/v4/redirection/example", "sandbox"), false);
assert.equal(hasUsableMidtransRedirect("https://app.midtrans.com.attacker.example/payment"), false);
assert.equal(hasUsableMidtransRedirect("javascript:alert(1)"), false);
assert.equal(safeMidtransPaymentInstructions({ transaction_status: "pending" }), null);
assert.ok(midtransIdempotencyKey("order-example-12345678").length <= 46, "Midtrans must not ignore an oversized idempotency key.");
assert.equal(midtransIdempotencyKey("order-example-12345678"), midtransIdempotencyKey("order-example-12345678"));

const eventCases = [
  [{ transactionStatus: "settlement", paymentStatus: "Pending" }, "paid"],
  [{ transactionStatus: "capture", fraudStatus: "accept", paymentStatus: "Pending" }, "paid"],
  [{ transactionStatus: "capture", fraudStatus: "challenge", paymentStatus: "Pending" }, "pending"],
  [{ transactionStatus: "pending", paymentStatus: "Pending" }, "pending"],
  [{ transactionStatus: "authorize", paymentStatus: "Paid" }, "stale"],
  [{ transactionStatus: "pending", paymentStatus: "Paid" }, "stale"],
  [{ transactionStatus: "expire", paymentStatus: "Pending" }, "release"],
  [{ transactionStatus: "cancel", paymentStatus: "Pending" }, "release"],
  [{ transactionStatus: "deny", paymentStatus: "Pending" }, "release"],
  [{ transactionStatus: "failure", paymentStatus: "Pending" }, "release"],
  [{ transactionStatus: "cancel", paymentStatus: "Paid" }, "reversal-review"],
  [{ transactionStatus: "refund", paymentStatus: "Paid" }, "refund"],
  [{ transactionStatus: "partial_refund", paymentStatus: "Paid" }, "refund"],
  [{ transactionStatus: "chargeback", paymentStatus: "Paid" }, "chargeback"],
  [{ transactionStatus: "partial_chargeback", paymentStatus: "Paid" }, "chargeback"]
];
for (const [input, expected] of eventCases) assert.equal(classifyMidtransEvent(input), expected, JSON.stringify(input));

console.log("Payment resume, retry idempotency, and asynchronous payment instruction behavior verified.");
