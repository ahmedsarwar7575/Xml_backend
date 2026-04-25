const db = require("../db/init");

const DEFAULT_HOST = "residential.novaproxy.io";
const DEFAULT_PORT = 12321;
const DEFAULT_SESSION_LIFETIME_SECONDS = 600;

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
    host: getSetting("NovaProxyHost", DEFAULT_HOST),
    port: parseInteger(getSetting("NovaProxyPort", DEFAULT_PORT), DEFAULT_PORT),
    username: getSetting("NovaProxyUsername", ""),
    password: getSetting("NovaProxyPassword", ""),
    sessionLifetimeSeconds: DEFAULT_SESSION_LIFETIME_SECONDS,
  };
}

function isConfigured() {
  const cfg = getConfig();
  return Boolean(cfg.username && cfg.password && cfg.host && cfg.port);
}

function buildProxy(cfg, countryCode, index) {
  const session = randomSession();
  const country = countryCode.toLowerCase();
  const fullPassword = `${cfg.password}_country-${country}_session-${session}_lifetime-${cfg.sessionLifetimeSeconds}s`;
  const proxyUrl = `http://${encodeURIComponent(
    cfg.username
  )}:${encodeURIComponent(fullPassword)}@${cfg.host}:${cfg.port}`;

  return {
    index: index + 1,
    country: countryCode.toUpperCase(),
    username: cfg.username,
    password: fullPassword,
    host: cfg.host,
    port: cfg.port,
    proxy_url: proxyUrl,
    ip: null,
    proxyKey: `nova-${country}-${session}`,
    provider: "novaproxy",
    raw: {
      session,
      countryCode: country,
      lifetimeSeconds: cfg.sessionLifetimeSeconds,
    },
  };
}

async function fetchProxiesForCountry(countryCode, quantity = 20) {
  if (!countryCode) {
    console.log("NovaProxy: countryCode is required");
    return [];
  }

  if (!isConfigured()) {
    console.log("NovaProxy: credentials not configured in settings");
    return [];
  }

  const cfg = getConfig();
  const proxies = [];
  const total = Math.max(1, parseInteger(quantity, 20));

  for (let i = 0; i < total; i++) {
    proxies.push(buildProxy(cfg, countryCode, i));
  }

  console.log(
    `NovaProxy: generated ${
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
