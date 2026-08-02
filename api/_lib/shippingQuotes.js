import { NixpShippingEngine, getSettings, saveSettings, shippingDashboard } from "./nixpShippingEngine.js";

const engine = new NixpShippingEngine();

export function calculateRuleShippingQuote(input) {
  return engine.quote(input);
}

export function validateRuleShippingQuote(input) {
  return engine.validateQuote(input);
}

export function getShippingSettings() {
  return getSettings();
}

export function saveShippingSettings(input) {
  return saveSettings(input);
}

export function getShippingDashboard() {
  return shippingDashboard();
}
