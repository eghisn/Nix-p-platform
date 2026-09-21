export function safeMidtransPaymentInstructions(payload = {}) {
  const paymentType = String(payload?.payment_type || "").trim().toLowerCase();
  const va = Array.isArray(payload?.va_numbers) ? payload.va_numbers.find((entry) => entry?.va_number) : null;
  const vaNumber = digitsOnly(va?.va_number || payload?.permata_va_number);
  const bank = String(va?.bank || (payload?.permata_va_number ? "permata" : "")).trim().toUpperCase();
  const billKey = digitsOnly(payload?.bill_key);
  const billerCode = digitsOnly(payload?.biller_code);
  const paymentCode = String(payload?.payment_code || "").trim().slice(0, 64);

  if (!paymentType && !vaNumber && !billKey && !paymentCode) return null;
  return {
    paymentType,
    bank,
    vaNumber,
    billKey,
    billerCode,
    paymentCode
  };
}

export function hasUsableMidtransRedirect(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && (url.hostname === "app.midtrans.com" || url.hostname === "app.sandbox.midtrans.com");
  } catch {
    return false;
  }
}

function digitsOnly(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 4 && digits.length <= 32 ? digits : "";
}
