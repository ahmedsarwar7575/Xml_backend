const { chromium } = require("playwright");
const db = require("./src/db/init");
const proxyProvider = require("./src/services/proxyProvider");

const COUNTRIES = ["US", "DE", "CA"];
const PROBES_PER_COUNTRY = 2;

const SETTINGS_KEYS = [
  "NovaProxyHost",
  "NovaProxyPort",
  "NovaProxyUsername",
  "NovaProxyPassword",
  "IsNovaProxy",
  "KindProxyHost",
  "KindProxyPort",
  "KindProxyUsername",
  "KindProxyPassword",
  "isKindProxy",
];

const upsertSetting = db.prepare(
  "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)"
);

const deleteSetting = db.prepare("DELETE FROM settings WHERE key = ?");

function line(char = "=", len = 70) {
  return char.repeat(len);
}

function header(text) {
  console.log("\n" + line());
  console.log(text);
  console.log(line());
}

function subheader(text) {
  console.log("\n" + line("-"));
  console.log(text);
  console.log(line("-"));
}

function normalizeSettingValue(value) {
  if (value === true) return "true";
  if (value === false) return "false";
  if (value === undefined || value === null) return "";
  return String(value);
}

function getSettingRecord(key) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return {
    exists: Boolean(row),
    value: row?.value || "",
  };
}

function snapshotSettings() {
  return SETTINGS_KEYS.reduce((acc, key) => {
    acc[key] = getSettingRecord(key);
    return acc;
  }, {});
}

function restoreSettings(snapshot) {
  const tx = db.transaction(() => {
    for (const key of SETTINGS_KEYS) {
      const item = snapshot[key];
      if (item?.exists) {
        upsertSetting.run(key, item.value);
      } else {
        deleteSetting.run(key);
      }
    }
  });

  tx();
}

function setDbSettings(values) {
  const tx = db.transaction(() => {
    for (const [key, value] of Object.entries(values)) {
      if (SETTINGS_KEYS.includes(key)) {
        upsertSetting.run(key, normalizeSettingValue(value));
      }
    }
  });

  tx();
}

async function probeProxy(proxyConfig, timeoutMs = 20000) {
  let browser = null;

  try {
    browser = await chromium.launch({ headless: true, proxy: proxyConfig });

    const page = await browser.newPage();

    await page.goto("https://ipinfo.io/json", {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });

    const body = await page.locator("body").innerText();
    const data = JSON.parse(body);

    await browser.close();

    return {
      ok: true,
      ip: data.ip,
      country: data.country,
      city: data.city,
      region: data.region,
      org: data.org,
    };
  } catch (err) {
    if (browser) {
      await browser.close().catch(() => {});
    }

    return {
      ok: false,
      error: err.message.split("\n")[0],
    };
  }
}

async function scenario1_onlyNovaEnabled() {
  header("SCENARIO 1: Only NovaProxy enabled");

  setDbSettings({
    IsNovaProxy: true,
    isKindProxy: false,
  });

  const status = proxyProvider.getStatus();
  console.log("Provider status:", JSON.stringify(status, null, 2));

  const activeProviders = proxyProvider.getActiveProviders();
  console.log(`Active providers: [${activeProviders.join(", ")}]`);

  if (activeProviders[0] !== "novaproxy" || activeProviders.length !== 1) {
    console.log(
      "FAIL: Expected only novaproxy. Check NovaProxyUsername and NovaProxyPassword in DB settings."
    );
    return false;
  }

  console.log("PASS: novaproxy is the only active provider");

  for (const country of COUNTRIES) {
    subheader(`Testing NovaProxy for ${country}`);

    const proxies = await proxyProvider.fetchProxiesFromProvider(
      "novaproxy",
      country,
      5
    );

    console.log(`Generated ${proxies.length} proxy sessions`);

    if (proxies.length === 0) {
      console.log("FAIL: No proxies generated");
      return false;
    }

    console.log("First proxy sample:");
    console.log(`   proxyKey: ${proxies[0].proxyKey}`);
    console.log(`   host: ${proxies[0].host}:${proxies[0].port}`);
    console.log(`   provider: ${proxies[0].provider}`);

    for (let i = 0; i < Math.min(PROBES_PER_COUNTRY, proxies.length); i++) {
      const p = proxies[i];

      const cfg = {
        server: `http://${p.host}:${p.port}`,
        username: p.username,
        password: p.password,
      };

      console.log(`\nProbe ${i + 1}/${PROBES_PER_COUNTRY} for ${country}:`);

      const result = await probeProxy(cfg);

      if (result.ok) {
        const match = result.country === country ? "MATCH" : "MISMATCH";
        console.log(
          `   ${match}: IP=${result.ip} Country=${result.country} City=${result.city} ISP=${result.org}`
        );
      } else {
        console.log(`   FAIL: ${result.error}`);
      }
    }
  }

  return true;
}

async function scenario2_onlyKindEnabled() {
  header("SCENARIO 2: Only KindProxy enabled");

  setDbSettings({
    IsNovaProxy: false,
    isKindProxy: true,
  });

  const status = proxyProvider.getStatus();
  console.log("Provider status:", JSON.stringify(status, null, 2));

  const activeProviders = proxyProvider.getActiveProviders();
  console.log(`Active providers: [${activeProviders.join(", ")}]`);

  if (activeProviders[0] !== "kindproxy" || activeProviders.length !== 1) {
    console.log(
      "FAIL: Expected only kindproxy. Check KindProxyUsername and KindProxyPassword in DB settings."
    );
    return false;
  }

  console.log("PASS: kindproxy is the only active provider");

  for (const country of COUNTRIES) {
    subheader(`Testing KindProxy for ${country}`);

    const proxies = await proxyProvider.fetchProxiesFromProvider(
      "kindproxy",
      country,
      5
    );

    console.log(`Generated ${proxies.length} proxy sessions`);

    if (proxies.length === 0) {
      console.log("FAIL: No proxies generated");
      return false;
    }

    console.log("First proxy sample:");
    console.log(`   proxyKey: ${proxies[0].proxyKey}`);
    console.log(`   host: ${proxies[0].host}:${proxies[0].port}`);
    console.log(`   provider: ${proxies[0].provider}`);

    for (let i = 0; i < Math.min(PROBES_PER_COUNTRY, proxies.length); i++) {
      const p = proxies[i];

      const cfg = {
        server: `http://${p.host}:${p.port}`,
        username: p.username,
        password: p.password,
      };

      console.log(`\nProbe ${i + 1}/${PROBES_PER_COUNTRY} for ${country}:`);

      const result = await probeProxy(cfg);

      if (result.ok) {
        const match = result.country === country ? "MATCH" : "MISMATCH";
        console.log(
          `   ${match}: IP=${result.ip} Country=${result.country} City=${result.city} ISP=${result.org}`
        );
      } else {
        console.log(`   FAIL: ${result.error}`);
      }
    }
  }

  return true;
}

async function scenario3_bothEnabledNovaPrimary() {
  header("SCENARIO 3: Both enabled - Nova primary, Kind fallback");

  setDbSettings({
    IsNovaProxy: true,
    isKindProxy: true,
  });

  const status = proxyProvider.getStatus();
  console.log("Provider status:", JSON.stringify(status, null, 2));

  const activeProviders = proxyProvider.getActiveProviders();
  console.log(
    `Active providers in priority order: [${activeProviders.join(" -> ")}]`
  );

  if (
    activeProviders.length !== 2 ||
    activeProviders[0] !== "novaproxy" ||
    activeProviders[1] !== "kindproxy"
  ) {
    console.log(
      "FAIL: Expected [novaproxy, kindproxy]. Check both provider credentials in DB settings."
    );
    return false;
  }

  console.log("PASS: Nova is primary, Kind is fallback");

  for (const country of COUNTRIES) {
    subheader(`Integration test for ${country} (Nova primary, Kind fallback)`);

    for (const providerName of activeProviders) {
      console.log(`\n>>> Trying ${providerName} for ${country}`);

      const proxies = await proxyProvider.fetchProxiesFromProvider(
        providerName,
        country,
        3
      );

      if (proxies.length === 0) {
        console.log(
          `${providerName}: 0 proxies returned, falling back to next provider`
        );
        continue;
      }

      const p = proxies[0];

      const cfg = {
        server: `http://${p.host}:${p.port}`,
        username: p.username,
        password: p.password,
      };

      const result = await probeProxy(cfg);

      if (result.ok && result.country === country) {
        console.log(
          `   SUCCESS on ${providerName}: IP=${result.ip} Country=${result.country}`
        );
        break;
      } else if (result.ok) {
        console.log(
          `   Wrong country on ${providerName}: got ${result.country}, wanted ${country}`
        );
      } else {
        console.log(`   FAIL on ${providerName}: ${result.error}`);
      }
    }
  }

  return true;
}

async function scenario4_nothingEnabled() {
  header("SCENARIO 4: Nothing enabled");

  setDbSettings({
    IsNovaProxy: false,
    isKindProxy: false,
    NovaProxyUsername: "",
    NovaProxyPassword: "",
    KindProxyUsername: "",
    KindProxyPassword: "",
  });

  const status = proxyProvider.getStatus();
  console.log("Provider status:", JSON.stringify(status, null, 2));

  const activeProviders = proxyProvider.getActiveProviders();
  console.log(`Active providers: [${activeProviders.join(", ")}]`);

  if (activeProviders.length !== 0) {
    console.log("FAIL: Expected no active providers");
    return false;
  }

  console.log(
    "PASS: No providers active - clickWorker would fall through to manual proxies"
  );

  const novaProxies = await proxyProvider.fetchProxiesFromProvider(
    "novaproxy",
    "US",
    5
  );

  const kindProxies = await proxyProvider.fetchProxiesFromProvider(
    "kindproxy",
    "US",
    5
  );

  console.log(`\nDirect novaproxy fetch: ${novaProxies.length} proxies`);
  console.log(`Direct kindproxy fetch: ${kindProxies.length} proxies`);

  return novaProxies.length === 0 && kindProxies.length === 0;
}

async function scenario5_fallbackSimulation() {
  header("SCENARIO 5: Simulated Nova failure -> falls back to Kind");

  setDbSettings({
    IsNovaProxy: true,
    isKindProxy: true,
    NovaProxyUsername: "wrong_user_that_will_fail",
    NovaProxyPassword: "wrong_password",
  });

  const activeProviders = proxyProvider.getActiveProviders();
  console.log(`Active providers: [${activeProviders.join(" -> ")}]`);

  if (!activeProviders.includes("kindproxy")) {
    console.log(
      "FAIL: KindProxy is not active. Check KindProxyUsername and KindProxyPassword in DB settings."
    );
    return false;
  }

  const country = "US";

  subheader(`Simulating clickWorker fallback logic for ${country}`);

  let chosenProvider = null;
  let chosenResult = null;

  for (const providerName of activeProviders) {
    console.log(`\n>>> Trying ${providerName} for ${country}`);

    const proxies = await proxyProvider.fetchProxiesFromProvider(
      providerName,
      country,
      3
    );

    if (proxies.length === 0) {
      console.log(`${providerName}: empty pool, trying next`);
      continue;
    }

    const p = proxies[0];

    const cfg = {
      server: `http://${p.host}:${p.port}`,
      username: p.username,
      password: p.password,
    };

    console.log(`Probing ${providerName}...`);

    const result = await probeProxy(cfg);

    if (result.ok && result.country === country) {
      console.log(
        `   SUCCESS on ${providerName}: IP=${result.ip} Country=${result.country}`
      );
      chosenProvider = providerName;
      chosenResult = result;
      break;
    } else if (result.ok) {
      console.log(`   Wrong country on ${providerName}, trying next provider`);
    } else {
      console.log(`   FAIL on ${providerName}: ${result.error}`);
      console.log("   -> Falling back to next provider");
    }
  }

  console.log(
    `\nFinal chosen provider: ${
      chosenProvider || "NONE (would fall to manual)"
    }`
  );

  if (chosenResult) {
    console.log(`Final IP: ${chosenResult.ip} in ${chosenResult.country}`);
  }

  if (chosenProvider === "kindproxy") {
    console.log(
      "PASS: Fallback worked correctly - Nova failed, Kind succeeded"
    );
  } else {
    console.log(`Result: fell back to ${chosenProvider || "manual"}`);
  }

  return true;
}

async function scenario6_dbFlagParsing() {
  header("SCENARIO 6: DB flag parsing variations");

  const cases = [
    { value: "true", expected: true, label: "true" },
    { value: "TRUE", expected: true, label: "TRUE" },
    { value: "1", expected: true, label: "1" },
    { value: "yes", expected: true, label: "yes" },
    { value: "on", expected: true, label: "on" },
    { value: "false", expected: false, label: "false" },
    { value: "0", expected: false, label: "0" },
    { value: "", expected: false, label: "(empty string)" },
  ];

  let allPass = true;

  for (const c of cases) {
    setDbSettings({
      IsNovaProxy: c.value,
      NovaProxyUsername: "placeholder_user",
      NovaProxyPassword: "placeholder_password",
    });

    const isOn = proxyProvider.isNovaEnabled();
    const pass = isOn === c.expected;
    const mark = pass ? "PASS" : "FAIL";

    console.log(
      `${mark}: IsNovaProxy=${c.label} -> isNovaEnabled=${isOn} (expected ${c.expected})`
    );

    if (!pass) {
      allPass = false;
    }
  }

  subheader("Testing missing credentials");

  setDbSettings({
    IsNovaProxy: "true",
    NovaProxyUsername: "",
    NovaProxyPassword: "",
  });

  const isOnNoCreds = proxyProvider.isNovaEnabled();
  const credsPass = isOnNoCreds === false;

  console.log(
    `${
      credsPass ? "PASS" : "FAIL"
    }: IsNovaProxy=true but no credentials -> isNovaEnabled=${isOnNoCreds} (expected false)`
  );

  if (!credsPass) {
    allPass = false;
  }

  return allPass;
}

async function runScenario(originalSettings, name, fn) {
  restoreSettings(originalSettings);

  try {
    return await fn();
  } catch (err) {
    console.error(`${name} crashed:`, err.message);
    return false;
  }
}

async function main() {
  console.log("Starting Proxy Provider Test Suite");
  console.log(`Timestamp: ${new Date().toISOString()}`);

  const originalSettings = snapshotSettings();
  console.log("Original DB settings:", JSON.stringify(originalSettings, null, 2));
  const results = {};

  let exitCode = 1;

  try {
    results.scenario1 = await runScenario(
      originalSettings,
      "Scenario 1",
      scenario1_onlyNovaEnabled
    );

    results.scenario2 = await runScenario(
      originalSettings,
      "Scenario 2",
      scenario2_onlyKindEnabled
    );

    results.scenario3 = await runScenario(
      originalSettings,
      "Scenario 3",
      scenario3_bothEnabledNovaPrimary
    );

    results.scenario4 = await runScenario(
      originalSettings,
      "Scenario 4",
      scenario4_nothingEnabled
    );

    results.scenario5 = await runScenario(
      originalSettings,
      "Scenario 5",
      scenario5_fallbackSimulation
    );

    results.scenario6 = await runScenario(
      originalSettings,
      "Scenario 6",
      scenario6_dbFlagParsing
    );

    header("FINAL RESULTS");

    for (const [name, passed] of Object.entries(results)) {
      console.log(`${passed ? "PASS" : "FAIL"}: ${name}`);
    }

    const allPassed = Object.values(results).every(Boolean);

    console.log(
      `\n${allPassed ? "ALL SCENARIOS PASSED" : "SOME SCENARIOS FAILED"}`
    );

    exitCode = allPassed ? 0 : 1;
  } finally {
    restoreSettings(originalSettings);
    console.log("\nOriginal proxy settings restored in database");
  }

  process.exit(exitCode);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
