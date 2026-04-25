const db = require("../db/init");

const DEFAULT_HOST = "gw.kindproxy.com";
const DEFAULT_PORT = 12000;
const DEFAULT_SESSION_TTL_MINUTES = 10;

function getSetting(key, defaultValue = "") {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  const value = row?.value;
  return value !== undefined && value !== null && value !== ""
    ? value
    : defaultValue;
}

function parseInteger(value, defaultValue) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

function randomSession() {
  return Math.random().toString(36).substring(2, 12);
}

function getConfig() {
  return {
    host: getSetting("KindProxyHost", DEFAULT_HOST),
    port: parseInteger(getSetting("KindProxyPort", DEFAULT_PORT), DEFAULT_PORT),
    username: getSetting("KindProxyUsername", ""),
    password: getSetting("KindProxyPassword", ""),
    sessionTtlMinutes: DEFAULT_SESSION_TTL_MINUTES,
  };
}

function isConfigured() {
  const cfg = getConfig();
  return Boolean(cfg.username && cfg.password && cfg.host && cfg.port);
}

function replaceCountryInUsername(baseUsername, countryCode) {
  const country = countryCode.toLowerCase();

  if (baseUsername.includes("__cr.")) {
    return baseUsername.replace(/__cr\.[^;]+/, `__cr.${country}`);
  }

  return `${baseUsername}__cr.${country}`;
}

function buildProxy(cfg, countryCode, index) {
  const session = randomSession();
  const country = countryCode.toLowerCase();
  const baseUser = replaceCountryInUsername(cfg.username, country);
  const fullUsername = `${baseUser};sessid.${session};sessttl.${cfg.sessionTtlMinutes}`;
  const proxyUrl = `http://${encodeURIComponent(
    fullUsername
  )}:${encodeURIComponent(cfg.password)}@${cfg.host}:${cfg.port}`;

  return {
    index: index + 1,
    country: countryCode.toUpperCase(),
    username: fullUsername,
    password: cfg.password,
    host: cfg.host,
    port: cfg.port,
    proxy_url: proxyUrl,
    ip: null,
    proxyKey: `kind-${country}-${session}`,
    provider: "kindproxy",
    raw: {
      session,
      countryCode: country,
      ttlMinutes: cfg.sessionTtlMinutes,
    },
  };
}

async function fetchProxiesForCountry(countryCode, quantity = 20) {
  if (!countryCode) {
    console.log("KindProxy: countryCode is required");
    return [];
  }

  if (!isConfigured()) {
    console.log("KindProxy: credentials not configured in settings");
    return [];
  }

  const cfg = getConfig();
  const proxies = [];
  const total = Math.max(1, parseInteger(quantity, 20));

  for (let i = 0; i < total; i++) {
    proxies.push(buildProxy(cfg, countryCode, i));
  }

  console.log(
    `KindProxy: generated ${
      proxies.length
    } rotating sessions for ${countryCode.toUpperCase()}`
  );
  return proxies;
}

module.exports = {
  fetchProxiesForCountry,
  isConfigured,
  getConfig,
};
