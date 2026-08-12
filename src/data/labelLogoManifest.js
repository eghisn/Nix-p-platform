// Locally stored label artwork. The main page only lists labels with a verified logo asset.
export const verifiedLabelLogoExtensions = Object.freeze({
  bmg: "svg",
  "jil-sander": "svg",
  kranky: "svg",
  parlophone: "svg",
  polyvinyl: "gif",
  rca: "svg",
  "relapse-records": "svg",
  "roadrunner-records": "svg",
  "sacred-bones-records": "svg",
  "warp-records": "png",
  "warner-bros": "svg",
  "xl-recordings": "svg",
});

export function labelLogoAvailable(value) {
  return Boolean(verifiedLabelLogoExtensions[value]);
}
