// const BASE_URL = "https://proxy.webshare.io/api";

// const proxyCache = new Map();
// const CACHE_TTL_MS = 60 * 1000;

// function toQuery(params = {}) {
//   const q = new URLSearchParams();
//   for (const [k, v] of Object.entries(params)) {
//     if (v !== undefined && v !== null && v !== "") q.append(k, String(v));
//   }
//   const s = q.toString();
//   return s ? `?${s}` : "";
// }

// async function sleep(ms) {
//   return new Promise((r) => setTimeout(r, ms));
// }

// async function request(apiKey, path, query = {}, maxRetries = 3) {
//   for (let attempt = 0; attempt <= maxRetries; attempt++) {
//     const res = await fetch(`${BASE_URL}${path}${toQuery(query)}`, {
//       headers: {
//         Accept: "application/json",
//         Authorization: `Token ${apiKey}`,
//       },
//     });
//     const text = await res.text();
//     let data;
//     try {
//       data = text ? JSON.parse(text) : null;
//     } catch {
//       data = text || null;
//     }

//     if (res.status === 429) {
//       let waitSec = 12;
//       const detail = data && data.detail ? String(data.detail) : "";
//       const match = detail.match(/(\d+)\s*seconds?/i);
//       if (match) waitSec = parseInt(match[1], 10) + 2;
//       console.warn(
//         `Webshare 429 rate limited. Waiting ${waitSec}s (attempt ${
//           attempt + 1
//         }/${maxRetries + 1})...`
//       );
//       if (attempt < maxRetries) {
//         await sleep(waitSec * 1000);
//         continue;
//       }
//     }

//     if (!res.ok) {
//       throw new Error(JSON.stringify({ status: res.status, data }, null, 2));
//     }
//     return data;
//   }
//   throw new Error("Webshare request failed after retries");
// }

// async function getActivePlan(apiKey) {
//   const data = await request(apiKey, "/v2/subscription/plan/", {
//     page: 1,
//     page_size: 100,
//   });
//   const plan = data.results.find((x) => x.status === "active");
//   if (!plan) throw new Error("No active plan found");
//   return plan;
// }

// async function getProxiesByCountry(apiKey, countryCode) {
//   const cacheKey = `${apiKey}:${countryCode.toUpperCase()}`;
//   const cached = proxyCache.get(cacheKey);
//   if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
//     console.log(
//       `Webshare: using cached proxies for ${countryCode} (${cached.proxies.length} items)`
//     );
//     return cached.proxies;
//   }

//   const plan = await getActivePlan(apiKey);
//   const allResults = [];
//   let page = 1;
//   const pageSize = 100;

//   while (true) {
//     const data = await request(apiKey, "/v2/proxy/list/", {
//       plan_id: plan.id,
//       mode: "backbone",
//       page,
//       page_size: pageSize,
//       country_code: countryCode.toUpperCase(),
//     });
//     const results = data.results || [];
//     allResults.push(...results);
//     if (!data.next || results.length < pageSize) break;
//     page++;
//     if (page > 50) break;
//     await sleep(300);
//   }

//   const filtered = allResults.filter(
//     (proxy) =>
//       proxy.country_code &&
//       proxy.country_code.toUpperCase() === countryCode.toUpperCase()
//   );

//   console.log(
//     `Webshare: fetched ${allResults.length} total, ${filtered.length} strictly match ${countryCode}`
//   );

//   const proxies = filtered.map((proxy, index) => ({
//     index: index + 1,
//     country: proxy.country_code,
//     username: proxy.username,
//     password: proxy.password,
//     host: "p.webshare.io",
//     port: 80,
//     proxy_url: `http://${encodeURIComponent(
//       proxy.username
//     )}:${encodeURIComponent(proxy.password)}@p.webshare.io:80`,
//     ip: proxy.proxy_address || null,
//     proxyKey: proxy.username,
//     raw: proxy,
//   }));

//   proxyCache.set(cacheKey, { ts: Date.now(), proxies });
//   return proxies;
// }

// async function fetchProxiesForCountry(apiKey, countryCode, quantity = 100) {
//   if (!apiKey) return [];
//   try {
//     return await getProxiesByCountry(apiKey, countryCode);
//   } catch (err) {
//     console.error(`Webshare API error for ${countryCode}:`, err.message);
//     return [];
//   }
// }

// module.exports = { fetchProxiesForCountry };



const proxyCache = new Map();
const CACHE_TTL_MS = 60 * 1000;

function getEnv(...keys) {
  for (const key of keys) {
    if (process.env[key]) return process.env[key];
  }
  return "";
}

function toInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function normalizeCountry(countryCode) {
  const country = String(countryCode || "").trim().toLowerCase();
  if (!/^[a-z]{2}$/.test(country)) {
    throw new Error(`Invalid country code: ${countryCode}`);
  }
  return country;
}

function normalizeQuantity(quantity) {
  const n = Number(quantity);
  if (!Number.isFinite(n) || n <= 0) return 100;
  return Math.floor(n);
}

function randomSession() {
  return `${Math.random().toString(36).substring(2, 10)}${Date.now()
    .toString(36)
    .slice(-4)}`;
}

function readConfig(config = {}) {
  const input = config && typeof config === "object" && !Array.isArray(config) ? config : {};

  return {
    nova: {
      host:
        input.nova?.host ||
        getEnv("NOVA_PROXY_HOST", "NOVA_HOST") ||
        "residential.novaproxy.io",
      port: toInt(
        input.nova?.port || getEnv("NOVA_PROXY_PORT", "NOVA_PORT"),
        12321
      ),
      username:
        input.nova?.username ||
        getEnv("NOVA_PROXY_USERNAME", "NOVA_USERNAME", "NOVA_USER"),
      password:
        input.nova?.password ||
        getEnv("NOVA_PROXY_PASSWORD", "NOVA_PASSWORD", "NOVA_PASS"),
      stickySessions:
        input.nova?.stickySessions !== undefined
          ? Boolean(input.nova.stickySessions)
          : true,
      sessionLifetimeSeconds: toInt(
        input.nova?.sessionLifetimeSeconds ||
          getEnv("NOVA_PROXY_SESSION_LIFETIME_SECONDS", "NOVA_SESSION_LIFETIME_SECONDS"),
        60
      ),
    },
    kind: {
      host:
        input.kind?.host ||
        getEnv("KIND_PROXY_HOST", "KIND_HOST", "KP_HOST") ||
        "gw.kindproxy.com",
      port: toInt(
        input.kind?.port || getEnv("KIND_PROXY_PORT", "KIND_PORT", "KP_PORT"),
        12000
      ),
      username:
        input.kind?.username ||
        getEnv("KIND_PROXY_USERNAME", "KIND_USERNAME", "KIND_USER", "KP_USER"),
      password:
        input.kind?.password ||
        getEnv("KIND_PROXY_PASSWORD", "KIND_PASSWORD", "KIND_PASS", "KP_PASS"),
      stickySessions:
        input.kind?.stickySessions !== undefined
          ? Boolean(input.kind.stickySessions)
          : true,
      sessionTtlMinutes: toInt(
        input.kind?.sessionTtlMinutes ||
          getEnv("KIND_PROXY_SESSION_TTL_MINUTES", "KIND_SESSION_TTL_MINUTES"),
        10
      ),
    },
  };
}

function validateProviderConfig(provider, config) {
  if (!config.host) throw new Error(`${provider} proxy host missing`);
  if (!config.port) throw new Error(`${provider} proxy port missing`);
  if (!config.username) throw new Error(`${provider} proxy username missing`);
  if (!config.password) throw new Error(`${provider} proxy password missing`);
}

function buildProxyUrl(username, password, host, port) {
  return `http://${encodeURIComponent(username)}:${encodeURIComponent(
    password
  )}@${host}:${port}`;
}

function buildNovaPassword(config, country, session) {
  let password = `${config.password}_country-${country}`;
  if (config.stickySessions) {
    password += `_session-${session}_lifetime-${config.sessionLifetimeSeconds}s`;
  }
  return password;
}

function buildKindUsername(config, country, session) {
  let username = String(config.username)
    .replace(/;sessid\.[^;]+/gi, "")
    .replace(/;sessttl\.\d+/gi, "");

  if (username.includes("__cr.")) {
    username = username.replace(/__cr\.[^;]+/i, `__cr.${country}`);
  } else {
    username = `${username}__cr.${country}`;
  }

  if (config.stickySessions) {
    username = `${username};sessid.${session};sessttl.${config.sessionTtlMinutes}`;
  }

  return username;
}

function createProxy({
  provider,
  index,
  country,
  host,
  port,
  username,
  password,
  session,
}) {
  return {
    index,
    country: country.toUpperCase(),
    username,
    password,
    host,
    port,
    proxy_url: buildProxyUrl(username, password, host, port),
    ip: null,
    proxyKey: `${provider}:${country}:${session}`,
    provider,
    source: provider,
    raw: {
      provider,
      country: country.toUpperCase(),
      session,
      host,
      port,
    },
  };
}

function buildNovaProxies(config, countryCode, quantity) {
  const country = normalizeCountry(countryCode);
  const count = normalizeQuantity(quantity);

  validateProviderConfig("Nova", config);

  return Array.from({ length: count }, (_, i) => {
    const session = randomSession();
    const password = buildNovaPassword(config, country, session);

    return createProxy({
      provider: "nova",
      index: i + 1,
      country,
      host: config.host,
      port: config.port,
      username: config.username,
      password,
      session,
    });
  });
}

function buildKindProxies(config, countryCode, quantity) {
  const country = normalizeCountry(countryCode);
  const count = normalizeQuantity(quantity);

  validateProviderConfig("KindProxy", config);

  return Array.from({ length: count }, (_, i) => {
    const session = randomSession();
    const username = buildKindUsername(config, country, session);

    return createProxy({
      provider: "kindproxy",
      index: i + 1,
      country,
      host: config.host,
      port: config.port,
      username,
      password: config.password,
      session,
    });
  });
}

async function fetchProxiesForCountry(apiKey, countryCode, quantity = 100) {
  const country = normalizeCountry(countryCode);
  const count = normalizeQuantity(quantity);
  const config = readConfig(apiKey);
  const cacheKey = `${country.toUpperCase()}:${count}`;

  const cached = proxyCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    console.log(
      `${cached.provider}: using cached proxies for ${country.toUpperCase()} (${cached.proxies.length} items)`
    );
    return cached.proxies;
  }

  try {
    const proxies = buildNovaProxies(config.nova, country, count);
    proxyCache.set(cacheKey, {
      ts: Date.now(),
      provider: "Nova",
      proxies,
    });
    console.log(
      `Nova: generated ${proxies.length} proxies for ${country.toUpperCase()}`
    );
    return proxies;
  } catch (novaErr) {
    console.error(
      `Nova proxy error for ${country.toUpperCase()}, switching to KindProxy:`,
      novaErr.message
    );

    try {
      const proxies = buildKindProxies(config.kind, country, count);
      proxyCache.set(cacheKey, {
        ts: Date.now(),
        provider: "KindProxy",
        proxies,
      });
      console.log(
        `KindProxy: generated ${proxies.length} fallback proxies for ${country.toUpperCase()}`
      );
      return proxies;
    } catch (kindErr) {
      console.error(
        `KindProxy fallback error for ${country.toUpperCase()}:`,
        kindErr.message
      );
      return [];
    }
  }
}

module.exports = { fetchProxiesForCountry };