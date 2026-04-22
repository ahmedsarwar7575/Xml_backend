const BASE_URL = "https://proxy.webshare.io/api";

function toQuery(params = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") q.append(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

async function request(apiKey, path, query = {}) {
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
  if (!res.ok) {
    throw new Error(JSON.stringify({ status: res.status, data }, null, 2));
  }
  return data;
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

async function getProxiesByCountry(apiKey, countryCode, quantity = 25) {
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
  }

  console.log(
    `Webshare: fetched ${allResults.length} total ${countryCode} proxies across ${page} page(s)`
  );

  const filtered = allResults.filter(
    (proxy) => proxy.country_code === countryCode.toUpperCase()
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
  return proxies;
}

async function fetchProxiesForCountry(apiKey, countryCode, quantity = 25) {
  if (!apiKey) return [];
  try {
    return await getProxiesByCountry(apiKey, countryCode, quantity);
  } catch (err) {
    console.error(`Webshare API error for ${countryCode}:`, err.message);
    return [];
  }
}

module.exports = { fetchProxiesForCountry };
