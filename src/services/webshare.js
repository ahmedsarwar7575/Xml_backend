const BASE_URL = "https://proxy.webshare.io/api";

const proxyCache = new Map();
const CACHE_TTL_MS = 60 * 1000;

function toQuery(params = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") q.append(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function request(apiKey, path, query = {}, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(`${BASE_URL}${path}${toQuery(query)}`, {
      headers: {
        Accept: "application/json",
        Authorization: `Token ${apiKey}`,
      },
    });
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text || null;
    }

    if (res.status === 429) {
      let waitSec = 12;
      const detail = data && data.detail ? String(data.detail) : "";
      const match = detail.match(/(\d+)\s*seconds?/i);
      if (match) waitSec = parseInt(match[1], 10) + 2;
      console.warn(
        `Webshare 429 rate limited. Waiting ${waitSec}s (attempt ${
          attempt + 1
        }/${maxRetries + 1})...`
      );
      if (attempt < maxRetries) {
        await sleep(waitSec * 1000);
        continue;
      }
    }

    if (!res.ok) {
      throw new Error(JSON.stringify({ status: res.status, data }, null, 2));
    }
    return data;
  }
  throw new Error("Webshare request failed after retries");
}

async function getActivePlan(apiKey) {
  const data = await request(apiKey, "/v2/subscription/plan/", {
    page: 1,
    page_size: 100,
  });
  const plan = data.results.find((x) => x.status === "active");
  if (!plan) throw new Error("No active plan found");
  return plan;
}

async function getProxiesByCountry(apiKey, countryCode) {
  const cacheKey = `${apiKey}:${countryCode.toUpperCase()}`;
  const cached = proxyCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    console.log(
      `Webshare: using cached proxies for ${countryCode} (${cached.proxies.length} items)`
    );
    return cached.proxies;
  }

  const plan = await getActivePlan(apiKey);
  const allResults = [];
  let page = 1;
  const pageSize = 100;

  while (true) {
    const data = await request(apiKey, "/v2/proxy/list/", {
      plan_id: plan.id,
      mode: "backbone",
      page,
      page_size: pageSize,
      country_code: countryCode.toUpperCase(),
    });
    const results = data.results || [];
    allResults.push(...results);
    if (!data.next || results.length < pageSize) break;
    page++;
    if (page > 50) break;
    await sleep(300);
  }

  const filtered = allResults.filter(
    (proxy) =>
      proxy.country_code &&
      proxy.country_code.toUpperCase() === countryCode.toUpperCase()
  );

  console.log(
    `Webshare: fetched ${allResults.length} total, ${filtered.length} strictly match ${countryCode}`
  );

  const proxies = filtered.map((proxy, index) => ({
    index: index + 1,
    country: proxy.country_code,
    username: proxy.username,
    password: proxy.password,
    host: "p.webshare.io",
    port: 80,
    proxy_url: `http://${encodeURIComponent(
      proxy.username
    )}:${encodeURIComponent(proxy.password)}@p.webshare.io:80`,
    ip: proxy.proxy_address || null,
    proxyKey: proxy.username,
    raw: proxy,
  }));

  proxyCache.set(cacheKey, { ts: Date.now(), proxies });
  return proxies;
}

async function fetchProxiesForCountry(apiKey, countryCode, quantity = 100) {
  if (!apiKey) return [];
  try {
    return await getProxiesByCountry(apiKey, countryCode);
  } catch (err) {
    console.error(`Webshare API error for ${countryCode}:`, err.message);
    return [];
  }
}

module.exports = { fetchProxiesForCountry };
