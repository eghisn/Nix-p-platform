import assert from "node:assert/strict";
import { hasUsableMidtransRedirect, safeMidtransPaymentInstructions } from "../api/_lib/paymentState.js";

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
  paymentCode: ""
});
assert.equal(hasUsableMidtransRedirect("https://app.midtrans.com/snap/v4/redirection/example"), true);
assert.equal(hasUsableMidtransRedirect("https://app.sandbox.midtrans.com/snap/v4/redirection/example"), true);
assert.equal(hasUsableMidtransRedirect("https://app.midtrans.com.attacker.example/payment"), false);
assert.equal(hasUsableMidtransRedirect("javascript:alert(1)"), false);
assert.equal(safeMidtransPaymentInstructions({ transaction_status: "pending" }), null);

console.log("Payment resume and bank-transfer instruction behavior verified.");
