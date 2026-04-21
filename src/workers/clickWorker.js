const { chromium } = require("playwright");
const db = require("../db/init");
const clickQueue = require("../queue/clickQueue");
const { fetchProxiesForCountry } = require("../services/webshare");
const { countryNameToCode } = require("../utils/countryMapping");
const {
  getRandomDesktopProfile,
  getRandomMobileProfile,
  getRandomProfile,
} = require("../utils/browserProfiles");
const { nowInTimezone } = require("../utils/timezone");

const webshareProxyIndex = new Map();

function getSetting(key) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? row.value : null;
}

function isCaptchaEnabled() {
  return getSetting("captcha_enabled") === "true";
}

function getCapsolverKey() {
  return getSetting("capsolver_key");
}

function getWebshareApiKey() {
  return getSetting("webshare_api_key");
}

function isHeadlessMode() {
  return getSetting("headless_mode") !== "false";
}

async function capsolverTask(apiKey, taskPayload) {
  if (!apiKey) throw new Error("Capsolver API key missing");
  const createRes = await fetch("https://api.capsolver.com/createTask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientKey: apiKey, task: taskPayload }),
  });
  const createData = await createRes.json();
  if (createData.errorId !== 0)
    throw new Error(`Capsolver createTask: ${createData.errorDescription}`);
  const taskId = createData.taskId;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const resultRes = await fetch("https://api.capsolver.com/getTaskResult", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientKey: apiKey, taskId }),
    });
    const resultData = await resultRes.json();
    if (resultData.status === "ready") return resultData.solution;
    if (resultData.errorId !== 0)
      throw new Error(
        `Capsolver getTaskResult: ${resultData.errorDescription}`
      );
  }
  throw new Error("Capsolver timed out after 90s");
}

async function detectCaptcha(page) {
  try {
    await page
      .waitForFunction(
        () =>
          document.querySelector(".cf-turnstile, .h-captcha, .g-recaptcha") !==
          null,
        { timeout: 15000 }
      )
      .catch(() => {});
  } catch (_) {}

  const captchas = await page.evaluate(() => {
    const found = [];
    const turnstileDiv = document.querySelector(".cf-turnstile");
    if (turnstileDiv && turnstileDiv.dataset.sitekey) {
      found.push({ type: "turnstile", siteKey: turnstileDiv.dataset.sitekey });
    }
    const hcaptchaDiv = document.querySelector(".h-captcha");
    if (hcaptchaDiv && hcaptchaDiv.dataset.sitekey) {
      found.push({ type: "hcaptcha", siteKey: hcaptchaDiv.dataset.sitekey });
    }
    const recaptchaDiv = document.querySelector(".g-recaptcha");
    if (recaptchaDiv && recaptchaDiv.dataset.sitekey) {
      found.push({ type: "recaptcha", siteKey: recaptchaDiv.dataset.sitekey });
    }
    return found;
  });
  return captchas;
}

async function solveCaptchaOnPage(page, capsolverKey, captchaEnabled) {
  if (!captchaEnabled || !capsolverKey) {
    console.log("   Captcha solving disabled or no API key – skipping");
    return false;
  }
  const pageUrl = page.url();
  if (!pageUrl || pageUrl === "about:blank") return false;
  const captchas = await detectCaptcha(page);
  if (captchas.length === 0) {
    console.log("   No captcha detected after polling");
    return false;
  }
  let solved = false;
  for (const captcha of captchas) {
    console.log(
      `   🧩 Detected: ${captcha.type} | siteKey: ${captcha.siteKey}`
    );
    if (!captcha.siteKey) {
      console.log("   ⚠️ No siteKey found, skipping");
      continue;
    }
    try {
      if (captcha.type === "turnstile") {
        const solution = await capsolverTask(capsolverKey, {
          type: "AntiTurnstileTaskProxyLess",
          websiteURL: pageUrl,
          websiteKey: captcha.siteKey,
        });
        console.log("   ✅ Turnstile solved, injecting token...");
        await page.evaluate((token) => {
          const widget = document.querySelector(".cf-turnstile");
          if (widget && widget.shadowRoot) {
            const input = widget.shadowRoot.querySelector(
              'input[name="cf-turnstile-response"]'
            );
            if (input) input.value = token;
          }
          const regularInput = document.querySelector(
            'input[name="cf-turnstile-response"]'
          );
          if (regularInput) regularInput.value = token;
          const form = document.querySelector("form");
          if (form) {
            const submitBtn = form.querySelector(
              'button[type="submit"], input[type="submit"]'
            );
            if (submitBtn) submitBtn.click();
            else form.dispatchEvent(new Event("submit", { bubbles: true }));
          }
        }, solution.token);
        solved = true;
      } else if (captcha.type === "hcaptcha") {
        const solution = await capsolverTask(capsolverKey, {
          type: "HCaptchaTaskProxyLess",
          websiteURL: pageUrl,
          websiteKey: captcha.siteKey,
        });
        console.log("   ✅ hCaptcha solved, injecting token...");
        await page.evaluate((token) => {
          const input = document.querySelector('[name="h-captcha-response"]');
          if (input) input.value = token;
          const form = document.querySelector("form");
          if (form) form.dispatchEvent(new Event("submit", { bubbles: true }));
        }, solution.gRecaptchaResponse);
        solved = true;
      } else if (captcha.type === "recaptcha") {
        const solution = await capsolverTask(capsolverKey, {
          type: "ReCaptchaV2TaskProxyLess",
          websiteURL: pageUrl,
          websiteKey: captcha.siteKey,
        });
        console.log("   ✅ reCAPTCHA solved, injecting token...");
        await page.evaluate((token) => {
          const input = document.querySelector('[name="g-recaptcha-response"]');
          if (input) input.value = token;
          const form = document.querySelector("form");
          if (form) form.dispatchEvent(new Event("submit", { bubbles: true }));
        }, solution.gRecaptchaResponse);
        solved = true;
      }
      await page.waitForTimeout(3000);
    } catch (err) {
      console.error(`   ❌ Failed to solve ${captcha.type}:`, err.message);
    }
  }
  return solved;
}

async function smoothScroll(page) {
  await page.evaluate(async () => {
    const scrollHeight = document.body.scrollHeight;
    const windowHeight = window.innerHeight;
    const steps = Math.max(10, Math.floor(scrollHeight / windowHeight) * 2);
    let current = 0;
    for (let i = 0; i <= steps; i++) {
      current = (scrollHeight / steps) * i;
      window.scrollTo({ top: current, behavior: "smooth" });
      await new Promise((r) => setTimeout(r, Math.random() * 100 + 50));
    }
    window.scrollTo({ top: scrollHeight - windowHeight, behavior: "smooth" });
    await new Promise((r) => setTimeout(r, 300));
  });
}

function parseProxy(proxyUrl) {
  if (!proxyUrl) return null;
  if (proxyUrl.startsWith("http://") || proxyUrl.startsWith("https://")) {
    try {
      const url = new URL(proxyUrl);
      return {
        server: `${url.protocol}//${url.hostname}:${url.port}`,
        username: url.username || undefined,
        password: url.password || undefined,
      };
    } catch (e) {
      console.error(`Invalid URL format: ${proxyUrl}`, e.message);
      return null;
    }
  }
  const parts = proxyUrl.split(":");
  if (parts.length === 4) {
    const [ip, port, username, password] = parts;
    return { server: `http://${ip}:${port}`, username, password };
  }
  if (proxyUrl.includes("@")) {
    const [auth, hostport] = proxyUrl.split("@");
    const [username, password] = auth.split(":");
    const [ip, port] = hostport.split(":");
    return { server: `http://${ip}:${port}`, username, password };
  }
  if (parts.length === 2) {
    const [ip, port] = parts;
    return { server: `http://${ip}:${port}` };
  }
  console.error(`Unrecognized proxy format: ${proxyUrl}`);
  return null;
}

async function getIpAndCountryViaProxy(proxyConfig) {
  try {
    const browser = await chromium.launch({
      headless: true,
      proxy: proxyConfig,
    });
    const page = await browser.newPage();
    await page.goto("https://api.ipify.org?format=json", {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });
    const body = await page.locator("body").innerText();
    const { ip } = JSON.parse(body);
    await page.goto(`http://ip-api.com/json/${ip}`, {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });
    const geoBody = await page.locator("body").innerText();
    const geo = JSON.parse(geoBody);
    await browser.close();
    return { ip, country: geo.countryCode };
  } catch (err) {
    console.error("Failed to get IP/country via proxy:", err.message);
    return { ip: null, country: null };
  }
}

async function executeClick(
  page,
  url,
  capsolverKey,
  captchaEnabled,
  timeoutMs = 120000
) {
  try {
    console.log(`   Navigating to ${url} (timeout ${timeoutMs}ms)`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await page.waitForTimeout(5000);
    const solved = await solveCaptchaOnPage(page, capsolverKey, captchaEnabled);
    if (solved) {
      console.log("   Captcha solved, waiting for navigation...");
      await page
        .waitForNavigation({ timeout: 15000, waitUntil: "domcontentloaded" })
        .catch(() => {});
    }
    console.log("   Performing smooth scroll...");
    await smoothScroll(page);
    await page.waitForTimeout(500);
    const finalUrl = page.url();
    const userAgent = await page.evaluate(() => navigator.userAgent);
    return { success: true, finalUrl, userAgent };
  } catch (err) {
    console.error(`   ❌ Click execution error: ${err.message}`);
    return { success: false, errorMessage: err.message };
  }
}

clickQueue.process(1, async (job) => {
  const startTime = Date.now();
  console.log("\n========== JOB START ==========");
  console.log(`Processing job for campaign ${job.data.campaignId}`);

  const { campaignId } = job.data;
  const campaign = db
    .prepare(`SELECT * FROM campaigns WHERE id = ? AND status = 1`)
    .get(campaignId);
  if (!campaign) {
    console.log(`Campaign ${campaignId} not active – skipping`);
    return { skipped: true, reason: "Inactive" };
  }
  console.log(`Campaign: ${campaign.name} (Feed ID: ${campaign.feed_id})`);

  let selectedProfile;
  if (campaign.browser_profile === "desktop") {
    selectedProfile = getRandomDesktopProfile();
  } else if (campaign.browser_profile === "mobile") {
    selectedProfile = getRandomMobileProfile();
  } else {
    selectedProfile = getRandomProfile();
  }
  console.log(`Selected browser profile: ${selectedProfile.type}`);

  const now = nowInTimezone();
  const start = new Date(now);
  const [startHour, startMinute] = campaign.start_time.split(":");
  start.setHours(parseInt(startHour), parseInt(startMinute), 0, 0);
  const end = new Date(now);
  const [endHour, endMinute] = campaign.end_time.split(":");
  end.setHours(parseInt(endHour), parseInt(endMinute), 0, 0);
  if (now < start || now > end) {
    console.log(
      `Outside active hours (now=${now.toLocaleTimeString()}, window=${
        campaign.start_time
      }-${campaign.end_time}) – skipping`
    );
    return { skipped: true, reason: "Outside hours" };
  }
  console.log(`Active hours OK: now=${now.toLocaleTimeString()}`);

  if (campaign.hourly_click_limit && campaign.hourly_click_limit > 0) {
    const hourStart = new Date(now);
    hourStart.setMinutes(0, 0, 0);
    const hourEnd = new Date(hourStart);
    hourEnd.setHours(hourStart.getHours() + 1);
    const clicksThisHour = db
      .prepare(
        `
      SELECT COUNT(*) as count FROM clicks
      WHERE campaign_id = ? AND timestamp BETWEEN ? AND ?
    `
      )
      .get(campaignId, hourStart.toISOString(), hourEnd.toISOString()).count;
    if (clicksThisHour >= campaign.hourly_click_limit) {
      console.log(
        `Hourly limit reached (${clicksThisHour}/${campaign.hourly_click_limit}) – skipping`
      );
      return { skipped: true, reason: "Hourly limit exceeded" };
    }
    console.log(
      `Hourly limit OK: ${clicksThisHour}/${campaign.hourly_click_limit} used this hour`
    );
  }

  const claimStmt = db.prepare(`
    UPDATE feed_items
    SET locked_until = datetime('now', '+5 minutes')
    WHERE id = (
      SELECT fi.id
      FROM feed_items fi
      LEFT JOIN clicks c ON c.feed_item_id = fi.id AND c.campaign_id = ?
      WHERE fi.feed_id = ?
        AND c.id IS NULL
        AND (fi.locked_until IS NULL OR fi.locked_until < datetime('now'))
      LIMIT 1
    )
    RETURNING id, url, title, country
  `);
  const item = claimStmt.get(campaignId, campaign.feed_id);
  if (!item) {
    console.log(`No items left for campaign ${campaignId}`);
    return { skipped: true, reason: "No items" };
  }
  console.log(
    `Claimed item ID ${item.id}: ${item.title.substring(0, 60)} (Country: ${
      item.country || "unknown"
    })`
  );

  let proxyConfig = null;
  let proxyRecord = null;
  let ipAddress = null;
  let ipCountry = null;
  let proxySource = "none";

  const webshareKey = getWebshareApiKey();
  console.log(`Webshare API key present: ${!!webshareKey}`);

  let countryToUse = null;
  if (campaign.target_country && campaign.target_country !== "Remote") {
    countryToUse = campaign.target_country;
    console.log(`Campaign has fixed country: ${countryToUse}`);
  } else if (item.country) {
    countryToUse = item.country;
    console.log(`Using feed item country: ${countryToUse}`);
  } else {
    console.log(
      `No country specified (campaign: ${campaign.target_country}, feed: ${item.country})`
    );
  }

  if (webshareKey && countryToUse) {
    const countryCode = countryNameToCode(countryToUse);
    if (countryCode) {
      console.log(
        `Attempting to fetch Webshare proxies for ${countryCode} (${countryToUse})`
      );
      const proxies = await fetchProxiesForCountry(webshareKey, countryCode, 25);
      if (proxies.length > 0) {
        let idx = webshareProxyIndex.get(campaignId) || 0;
        const selected = proxies[idx % proxies.length];
        idx = (idx + 1) % proxies.length;
        webshareProxyIndex.set(campaignId, idx);
        proxyConfig = parseProxy(selected.proxy_url);
        proxyRecord = { id: null, proxy_url: selected.proxy_url };
        ipAddress = selected.ip;
        ipCountry = selected.country;
        proxySource = "webshare";
        console.log(
          `✅ Using Webshare proxy ${selected.index}/${
            proxies.length
          } for ${countryCode}: ${selected.proxy_url.substring(0, 50)}...`
        );
      } else {
        console.log(`❌ No Webshare proxies available for ${countryCode}`);
      }
    } else {
      console.log(
        `Could not map country "${countryToUse}" to code – skipping auto proxy`
      );
    }
  } else {
    console.log(`Webshare not available or no country to use`);
  }

  if (!proxyConfig) {
    const manualProxies = db
      .prepare("SELECT * FROM proxies WHERE campaign_id = ?")
      .all(campaignId);
    console.log(`Manual proxies found: ${manualProxies.length}`);
    if (manualProxies.length > 0) {
      let selectedProxy = null;
      if (campaign.proxy_rotation_strategy === "round-robin") {
        const idx = campaign.last_proxy_index % manualProxies.length;
        selectedProxy = manualProxies[idx];
        db.prepare(
          "UPDATE campaigns SET last_proxy_index = last_proxy_index + 1 WHERE id = ?"
        ).run(campaignId);
        console.log(
          `Round-robin: selected index ${idx} of ${manualProxies.length}`
        );
      } else {
        const randomIdx = Math.floor(Math.random() * manualProxies.length);
        selectedProxy = manualProxies[randomIdx];
        console.log(
          `Random: selected index ${randomIdx} of ${manualProxies.length}`
        );
      }
      proxyConfig = parseProxy(selectedProxy.proxy_url);
      proxyRecord = selectedProxy;
      proxySource = "manual";
      console.log(
        `✅ Using manual proxy: ${selectedProxy.proxy_url.substring(0, 50)}...`
      );
    } else {
      console.log(`No manual proxies configured, using direct connection`);
      proxySource = "direct";
    }
  }

  const headless = isHeadlessMode();
  const captchaEnabled = isCaptchaEnabled();
  const capsolverKey = getCapsolverKey();
  console.log(`Headless mode: ${headless}`);
  console.log(
    `Captcha solving enabled: ${captchaEnabled}, Capsolver key present: ${!!capsolverKey}`
  );
  console.log(`Launching browser with proxy: ${proxySource}`);

  let browser = null;
  let result = {
    success: false,
    finalUrl: null,
    userAgent: null,
    errorMessage: null,
  };
  const maxAttempts = proxySource !== "direct" ? 2 : 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const usingProxy = proxyConfig && attempt === 1 ? true : false;
    const currentProxyConfig = usingProxy ? proxyConfig : null;
    console.log(
      `\n--- Attempt ${attempt}/${maxAttempts} (using ${
        usingProxy ? "proxy" : "direct"
      }) ---`
    );
    try {
      if (browser) await browser.close();
      browser = await chromium.launch({
        headless,
        proxy: currentProxyConfig || undefined,
      });
      const context = await browser.newContext({
        ignoreHTTPSErrors: true,
        userAgent: selectedProfile.userAgent,
        viewport: selectedProfile.viewport,
      });
      const page = await context.newPage();

      const clickResult = await executeClick(
        page,
        item.url,
        capsolverKey,
        captchaEnabled,
        120000
      );
      if (clickResult.success) {
        result = clickResult;
        if (!ipAddress && currentProxyConfig) {
          console.log("Fetching IP/country from proxy...");
          const ipInfo = await getIpAndCountryViaProxy(currentProxyConfig);
          ipAddress = ipInfo.ip;
          ipCountry = ipInfo.country;
        } else if (!currentProxyConfig) {
          console.log("Fetching direct IP/country...");
          const directIp = await getIpAndCountryViaProxy(null);
          ipAddress = directIp.ip;
          ipCountry = directIp.country;
        }
        console.log(`✅ Click succeeded on attempt ${attempt}`);
        break;
      } else {
        result = clickResult;
        console.log(`❌ Attempt ${attempt} failed: ${result.errorMessage}`);
        if (attempt === maxAttempts) {
          console.log(`No more retries, marking as failure`);
        }
      }
    } catch (err) {
      result.errorMessage = err.message;
      console.error(`❌ Attempt ${attempt} exception: ${err.message}`);
      if (attempt === maxAttempts) {
        console.log(`No more retries, marking as failure`);
      }
    }
  }

  if (browser) await browser.close();
  const feedURLFinal = url;
  const insertClick = db.prepare(`
    INSERT INTO clicks (campaign_id, feed_item_id, proxy_id, status, final_url, ip_address, ip_country, user_agent, browser_type_used, error_message, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertClick.run(
    campaignId,
    item.id,
    proxyRecord?.id || null,
    result.success ? "success" : "failure",
    result.success ? feedURLFinal : result?.finalUrl,
    ipAddress,
    ipCountry,
    result.userAgent,
    selectedProfile.type,
    result.errorMessage,
    new Date().toISOString()
  );

  db.prepare("UPDATE feed_items SET locked_until = NULL WHERE id = ?").run(
    item.id
  );

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(
    `\nClick recorded: ${result.success ? "SUCCESS" : "FAILURE"} (IP: ${
      ipAddress || "unknown"
    }, Country: ${ipCountry || "unknown"}, Source: ${proxySource}, Browser: ${
      selectedProfile.type
    }, Duration: ${duration}s)`
  );
  console.log("========== JOB END ==========\n");
  return { success: result.success, itemId: item.id };
});

console.log(
  "Click worker started with shadow DOM captcha support, atomic locking, concurrency=1, timezone support, and country dropdown logic"
);
