import { createHash } from "node:crypto";

export function safeMidtransPaymentInstructions(payload = {}) {
  const paymentType = String(payload?.payment_type || payload?.paymentType || "").trim().toLowerCase().slice(0, 48);
  const va = Array.isArray(payload?.va_numbers) ? payload.va_numbers.find((entry) => entry?.va_number) : null;
  const vaNumber = digitsOnly(va?.va_number || payload?.permata_va_number || payload?.vaNumber);
  const bank = String(va?.bank || payload?.bank || (payload?.permata_va_number ? "permata" : "")).trim().toUpperCase().slice(0, 24);
  const billKey = digitsOnly(payload?.bill_key || payload?.billKey);
  const billerCode = digitsOnly(payload?.biller_code || payload?.billerCode);
  const paymentCode = String(payload?.payment_code || payload?.paymentCode || "").trim().slice(0, 64);
  const actionUrl = safeMidtransActionUrl(payload?.actions) || safeHttpsUrl(payload?.actionUrl);
  const actionLabel = actionUrl ? paymentActionLabel(paymentType) : "";
  const qrCodeUrl = safeMidtransQrCodeUrl(payload?.actions) || safeMidtransQrCodeUrl([{ name: "generate-qr-code", method: "GET", url: payload?.qrCodeUrl }]);

  if (!paymentType && !vaNumber && !billKey && !paymentCode && !actionUrl && !qrCodeUrl) return null;
  return {
    paymentType,
    bank,
    vaNumber,
    billKey,
    billerCode,
    paymentCode,
    actionUrl,
    actionLabel,
    qrCodeUrl
  };
}

export function hasActionableMidtransInstructions(instructions) {
  return Boolean(
    instructions?.vaNumber
    || instructions?.billKey
    || instructions?.paymentCode
    || instructions?.actionUrl
    || instructions?.qrCodeUrl
  );
}

export function midtransIdempotencyKey(orderId) {
  // Midtrans ignores Idempotency-Key values longer than 46 characters.
  return `nixp-${createHash("sha256").update(`midtrans:${orderId}`).digest("hex").slice(0, 40)}`;
}

export function classifyMidtransEvent({ transactionStatus, fraudStatus, paymentStatus } = {}) {
  const status = String(transactionStatus || "").trim().toLowerCase();
  const fraud = String(fraudStatus || "").trim().toLowerCase();
  const financiallyFinal = ["Paid", "Refund Pending", "Partially Refunded", "Refunded"].includes(String(paymentStatus || ""));

  if (financiallyFinal && ["pending", "authorize"].includes(status)) return "stale";
  if ((status === "settlement" || status === "capture") && (!fraud || fraud === "accept")) return "paid";
  if (["refund", "partial_refund"].includes(status)) return "refund";
  if (["chargeback", "partial_chargeback"].includes(status)) return "chargeback";
  if (["expire", "cancel", "deny", "failure"].includes(status)) return financiallyFinal ? "reversal-review" : "release";
  return "pending";
}

export function hasUsableMidtransRedirect(value, expectedEnvironment = "") {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:") return false;
    const environment = String(expectedEnvironment || "").trim().toLowerCase();
    if (environment === "production") return url.hostname === "app.midtrans.com";
    if (environment === "sandbox") return url.hostname === "app.sandbox.midtrans.com";
    return url.hostname === "app.midtrans.com" || url.hostname === "app.sandbox.midtrans.com";
  } catch {
    return false;
  }
}

function digitsOnly(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 4 && digits.length <= 32 ? digits : "";
}

function safeMidtransActionUrl(actions) {
  const action = (Array.isArray(actions) ? actions : [])
    .find((entry) => String(entry?.name || "").toLowerCase() === "deeplink-redirect"
      && ["", "get"].includes(String(entry?.method || "").toLowerCase()));
  return safeHttpsUrl(action?.url);
}

function safeMidtransQrCodeUrl(actions) {
  const candidates = Array.isArray(actions) ? actions : [];
  const action = ["generate-qr-code-v2", "generate-qr-code"]
    .map((name) => candidates.find((entry) => String(entry?.name || "").toLowerCase() === name
      && ["", "get"].includes(String(entry?.method || "").toLowerCase())))
    .find(Boolean);
  if (!action) return "";
  try {
    const url = new URL(String(action.url || ""));
    const trustedHosts = new Set([
      "api.midtrans.com",
      "api.sandbox.midtrans.com",
      "api.veritrans.co.id",
      "api.sandbox.veritrans.co.id"
    ]);
    return url.protocol === "https:" && trustedHosts.has(url.hostname) && url.href.length <= 2048 ? url.href : "";
  } catch {
    return "";
  }
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && url.href.length <= 2048 ? url.href : "";
  } catch {
    return "";
  }
}

function paymentActionLabel(paymentType) {
  if (paymentType === "shopeepay") return "Open ShopeePay";
  if (paymentType === "dana") return "Open DANA";
  if (paymentType === "gopay") return "Open GoPay";
  return "Open payment app";
}
