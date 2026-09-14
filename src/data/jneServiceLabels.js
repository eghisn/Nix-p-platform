const JNE_SERVICE_LABELS = {
  REG: "Regular (REG)",
  YES: "Yakin Esok Sampai (YES)",
  OKE: "Economy (OKE)",
  SPS: "Priority (SPS)",
  JTR: "Trucking (JTR)"
};

export function jneServiceLabel(value) {
  const code = String(value || "").trim().toUpperCase();
  if (!code) return "Service";
  if (JNE_SERVICE_LABELS[code]) return JNE_SERVICE_LABELS[code];
  const truckingThreshold = code.match(/^JTR([<>])(\d+)$/);
  if (truckingThreshold) {
    const direction = truckingThreshold[1] === "<" ? "under" : "over";
    return `Trucking, ${direction} ${truckingThreshold[2]} kg (${code})`;
  }
  return code;
}

export function checkoutShippingServiceLabel(option = {}) {
  const courier = String(option.courier || "Delivery").trim();
  return courier.toUpperCase() === "JNE"
    ? `JNE ${jneServiceLabel(option.service)}`
    : [courier, String(option.serviceName || option.service || "").trim()].filter(Boolean).join(" ");
}
