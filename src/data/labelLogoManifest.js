// Locally stored label artwork. The main page only lists labels with a verified logo asset.
export const verifiedLabelLogoExtensions = Object.freeze({
  bmg: "svg",
  columbia: "svg",
  elektra: "svg",
  interscope: "svg",
  "jil-sander": "svg",
  kranky: "svg",
  pan: "png",
  parlophone: "svg",
  "pickwick-records": "svg",
  polyvinyl: "gif",
  rca: "svg",
  "relapse-records": "svg",
  "roadrunner-records": "svg",
  "sacred-bones-records": "svg",
  "secretly-canadian": "svg",
  transgressive: "svg",
  "warp-records": "png",
  "warner-bros": "svg",
  "warner-bros-records": "svg",
  v2: "png",
  "xl-recordings": "svg",
});

export function labelLogoAvailable(value) {
  return Boolean(verifiedLabelLogoExtensions[value]);
}
