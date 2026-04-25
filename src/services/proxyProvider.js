const db = require("../db/init");
const novaproxy = require("./novaproxy");
const kindproxy = require("./kindproxy");

function getSetting(key, defaultValue = "") {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  const value = row?.value;
  return value !== undefined && value !== null && value !== "" ? value : defaultValue;
}

function isDbFlagTrue(key) {
  const value = getSetting(key, "false");
  const v = String(value).trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "on";
}

function isNovaEnabled() {
  return isDbFlagTrue("IsNovaProxy") && novaproxy.isConfigured();
}

function isKindEnabled() {
  return isDbFlagTrue("isKindProxy") && kindproxy.isConfigured();
}

function getActiveProviders() {
  const novaOn = isNovaEnabled();
  const kindOn = isKindEnabled();

  if (novaOn && kindOn) return ["novaproxy", "kindproxy"];
  if (novaOn) return ["novaproxy"];
  if (kindOn) return ["kindproxy"];

  return [];
}

async function fetchProxiesFromProvider(providerName, countryCode, quantity = 20) {
  if (providerName === "novaproxy") {
    return await novaproxy.fetchProxiesForCountry(countryCode, quantity);
  }

  if (providerName === "kindproxy") {
    return await kindproxy.fetchProxiesForCountry(countryCode, quantity);
  }

  console.log(`Unknown provider: ${providerName}`);
  return [];
}

function getStatus() {
  return {
    novaEnabled: isNovaEnabled(),
    kindEnabled: isKindEnabled(),
    activeProviders: getActiveProviders(),
    novaConfigured: novaproxy.isConfigured(),
    kindConfigured: kindproxy.isConfigured(),
  };
}

module.exports = {
  getActiveProviders,
  fetchProxiesFromProvider,
  isNovaEnabled,
  isKindEnabled,
  getStatus,
};