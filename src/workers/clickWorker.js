const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const db = require("../db/init");
const clickQueue = require("../queue/clickQueue");
const proxyProvider = require("../services/proxyProvider");
const captchaSolver = require("../services/captchaSolver");
const { countryNameToCode } = require("../utils/countryMapping");
const memoryManager = require("../utils/memoryManager");

const {
  getRandomDesktopProfile,
  getRandomMobileProfile,
  getRandomProfile,
} = require("../utils/browserProfiles");
const { nowInTimezone } = require("../utils/timezone");

const SCREENSHOT_DIR = path.join(__dirname, "../../screenshots");
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}
memoryManager.startMemoryMonitor();

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

function isHeadlessMode() {
  return getSetting("headless_mode") !== "false";
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function getKeywords(campaign) {
  try {
    const kw = JSON.parse(campaign.keywords || "[]");
    return Array.isArray(kw)
      ? kw.filter((k) => k && k.trim()).map((k) => k.trim().toLowerCase())
      : [];
  } catch (_) {
    return [];
  }
}

function pickKeywordForRotation(campaignId, keywords) {
  if (!keywords.length) return null;
  const todayStart = new Date(nowInTimezone());
  todayStart.setHours(0, 0, 0, 0);
  const totalClicksToday = db
    .prepare(
      `SELECT COUNT(*) as count FROM clicks WHERE campaign_id = ? AND timestamp >= ?`
    )
    .get(campaignId, todayStart.toISOString()).count;
  const idx = totalClicksToday % keywords.length;
  return keywords[idx];
}

function claimNextItem(campaignId, feedId, campaign) {
  const keywords = getKeywords(campaign);
  const activeKeyword = pickKeywordForRotation(campaignId, keywords);
  console.log(
    `Active keyword for this click: ${activeKeyword || "(none - all items)"}`
  );

  let baseSql = `
    UPDATE feed_items
    SET locked_until = datetime('now', '+10 minutes')
    WHERE id = (
      SELECT fi.id FROM feed_items fi
      LEFT JOIN (
        SELECT feed_item_id, COUNT(*) as click_count, MAX(timestamp) as last_clicked
        FROM clicks
        WHERE campaign_id = ?
          AND timestamp >= datetime('now', 'start of day')
          AND status = 'success'
        GROUP BY feed_item_id
      ) c ON c.feed_item_id = fi.id
      WHERE fi.feed_id = ?
        AND (fi.locked_until IS NULL OR fi.locked_until < datetime('now'))
  `;

  const params = [campaignId, feedId];

  if (activeKeyword) {
    baseSql += ` AND (LOWER(fi.title) LIKE ? OR LOWER(fi.description) LIKE ?)`;
    const pattern = `%${activeKeyword}%`;
    params.push(pattern, pattern);
  }

  baseSql += `
      ORDER BY COALESCE(c.click_count, 0) ASC,
               COALESCE(c.last_clicked, '1970-01-01') ASC,
               fi.id ASC
      LIMIT 1
    )
    RETURNING id, url, title, country
  `;

  let item = db.prepare(baseSql).get(...params);

  if (!item && activeKeyword) {
    console.log(
      `No items match keyword "${activeKeyword}", falling back to any item`
    );
    const fallbackSql = `
      UPDATE feed_items
      SET locked_until = datetime('now', '+10 minutes')
      WHERE id = (
        SELECT fi.id FROM feed_items fi
        LEFT JOIN (
          SELECT feed_item_id, COUNT(*) as click_count, MAX(timestamp) as last_clicked
          FROM clicks
          WHERE campaign_id = ?
            AND timestamp >= datetime('now', 'start of day')
            AND status = 'success'
          GROUP BY feed_item_id
        ) c ON c.feed_item_id = fi.id
        WHERE fi.feed_id = ?
          AND (fi.locked_until IS NULL OR fi.locked_until < datetime('now'))
        ORDER BY COALESCE(c.click_count, 0) ASC,
                 COALESCE(c.last_clicked, '1970-01-01') ASC,
                 fi.id ASC
        LIMIT 1
      )
      RETURNING id, url, title, country
    `;
    item = db.prepare(fallbackSql).get(campaignId, feedId);
  }

  return item;
}

async function smoothScroll(page) {
  await page.evaluate(async () => {
    const scrollHeight = document.body.scrollHeight;
    const windowHeight = window.innerHeight;
    if (scrollHeight <= windowHeight) return;
    const steps = Math.max(12, Math.floor(scrollHeight / windowHeight) * 3);
    for (let i = 0; i <= steps; i++) {
      const current = (scrollHeight / steps) * i;
      window.scrollTo({ top: current, behavior: "smooth" });
      // human-like random pause between scrolls
      const delay =
        80 + Math.random() * 150 + (i % 4 === 0 ? Math.random() * 400 : 0);
      await new Promise((r) => setTimeout(r, delay));
    }
    // scroll back up a bit like a real user
    await new Promise((r) => setTimeout(r, 300 + Math.random() * 200));
    window.scrollTo({ top: scrollHeight * 0.6, behavior: "smooth" });
    await new Promise((r) => setTimeout(r, 400 + Math.random() * 300));
  });
}

async function humanMouseMove(page) {
  try {
    const vp = page.viewportSize();
    if (!vp) return;
    // move mouse in a natural arc
    const points = [
      {
        x: Math.floor(vp.width * 0.3 + Math.random() * 100),
        y: Math.floor(vp.height * 0.3 + Math.random() * 80),
      },
      {
        x: Math.floor(vp.width * 0.5 + Math.random() * 80),
        y: Math.floor(vp.height * 0.4 + Math.random() * 60),
      },
      {
        x: Math.floor(vp.width * 0.4 + Math.random() * 120),
        y: Math.floor(vp.height * 0.6 + Math.random() * 80),
      },
    ];
    for (const p of points) {
      await page.mouse.move(p.x, p.y, { steps: 8 });
      await page.waitForTimeout(150 + Math.floor(Math.random() * 200));
    }
  } catch (_) {}
}

function parseProxy(proxyUrl) {
  if (!proxyUrl) return null;
  if (proxyUrl.startsWith("http://") || proxyUrl.startsWith("https://")) {
    try {
      const url = new URL(proxyUrl);
      return {
        server: `${url.protocol}//${url.hostname}:${url.port}`,
        username: url.username ? decodeURIComponent(url.username) : undefined,
        password: url.password ? decodeURIComponent(url.password) : undefined,
      };
    } catch (e) {
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
  return null;
}

function buildProxyConfigFromCandidate(candidate) {
  if (
    candidate.host &&
    candidate.port &&
    candidate.username &&
    candidate.password
  ) {
    return {
      server: `http://${candidate.host}:${candidate.port}`,
      username: candidate.username,
      password: candidate.password,
    };
  }
  return parseProxy(candidate.proxy_url);
}

async function getIpAndCountryViaProxy(proxyConfig) {
  let browser = null;
  try {
    const launchOptions = { headless: true };
    if (proxyConfig) launchOptions.proxy = proxyConfig;
    browser = await chromium.launch(launchOptions);
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
    console.error("Failed to get IP/country:", err.message);
    if (browser) await browser.close().catch(() => {});
    return { ip: null, country: null };
  }
}

async function waitForAllRedirects(page, maxWaitMs = 30000) {
  let lastUrl;
  try {
    lastUrl = page.url();
  } catch (_) {
    return null;
  }
  let stableSince = Date.now();
  const deadline = Date.now() + maxWaitMs;
  const STABILITY_MS = 3000;

  while (Date.now() < deadline) {
    await page.waitForTimeout(500);
    let currentUrl;
    try {
      currentUrl = page.url();
    } catch (_) {
      break;
    }
    if (currentUrl !== lastUrl) {
      console.log(`   Redirect: ${lastUrl} -> ${currentUrl}`);
      lastUrl = currentUrl;
      stableSince = Date.now();
      await page
        .waitForLoadState("domcontentloaded", { timeout: 10000 })
        .catch(() => {});
    } else if (Date.now() - stableSince >= STABILITY_MS) {
      await page
        .waitForLoadState("networkidle", { timeout: 5000 })
        .catch(() => {});
      break;
    }
  }
  try {
    return page.url();
  } catch (_) {
    return lastUrl;
  }
}

async function waitForScriptsToLoad(page, maxWaitMs = 20000) {
  console.log(`   Waiting for scripts to fully load on final page...`);
  const deadline = Date.now() + maxWaitMs;

  try {
    await page.waitForLoadState("load", { timeout: maxWaitMs }).catch(() => {});
  } catch (_) {}

  try {
    await page
      .waitForLoadState("networkidle", { timeout: 10000 })
      .catch(() => {});
  } catch (_) {}

  const remaining = Math.max(0, deadline - Date.now());
  if (remaining > 0) {
    try {
      await page
        .waitForFunction(
          () => {
            if (document.readyState !== "complete") return false;
            if (
              typeof window.jQuery !== "undefined" &&
              window.jQuery.active > 0
            )
              return false;
            const pendingImgs = Array.from(document.images).filter(
              (img) => !img.complete
            );
            return pendingImgs.length === 0;
          },
          { timeout: remaining, polling: 500 }
        )
        .catch(() => {});
    } catch (_) {}
  }

  await page.waitForTimeout(2000);
  console.log(`   Scripts loaded, page is fully ready`);
}

async function checkAndSolveCaptcha(
  page,
  capsolverKey,
  captchaEnabled,
  proxyConfig,
  label
) {
  const result = await captchaSolver.solveAllCaptchas(
    page,
    capsolverKey,
    captchaEnabled,
    proxyConfig
  );
  if (result.solved) {
    console.log(`   [${label}] Captcha(s) solved: ${result.types.join(", ")}`);
    await waitForAllRedirects(page, 20000);
    const recheck = await captchaSolver.detectChallenges(page);
    if (recheck.length > 0) {
      console.log(`   [${label}] Still detected after solve, retrying once...`);
      await captchaSolver.solveAllCaptchas(
        page,
        capsolverKey,
        captchaEnabled,
        proxyConfig
      );
      await waitForAllRedirects(page, 15000);
    }
  } else if (result.error) {
    console.log(`   [${label}] Captcha solve failed: ${result.error}`);
  }
  return result;
}

async function executeClick(
  page,
  url,
  capsolverKey,
  captchaEnabled,
  proxyConfig,
  timeoutMs = 120000
) {
  const allCaptchaTypes = [];

  try {
    console.log(`   Navigating to ${url} (timeout ${timeoutMs}ms)`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await page.waitForTimeout(2000);

    console.log(`   Waiting for all redirects to complete...`);
    await waitForAllRedirects(page, 30000);

    const step1 = await checkAndSolveCaptcha(
      page,
      capsolverKey,
      captchaEnabled,
      proxyConfig,
      "after-nav"
    );
    if (step1.solved) allCaptchaTypes.push(...step1.types);

    console.log("   Performing smooth scroll + mouse movement...");
    try {
      await humanMouseMove(page);
    } catch (_) {}
    try {
      await smoothScroll(page);
    } catch (_) {}
    try {
      await humanMouseMove(page);
    } catch (_) {}

    console.log("   Final redirect check after scroll...");
    await waitForAllRedirects(page, 10000);

    const step2 = await checkAndSolveCaptcha(
      page,
      capsolverKey,
      captchaEnabled,
      proxyConfig,
      "after-scroll"
    );
    if (step2.solved) allCaptchaTypes.push(...step2.types);

    await waitForScriptsToLoad(page, 20000);

    const step3 = await checkAndSolveCaptcha(
      page,
      capsolverKey,
      captchaEnabled,
      proxyConfig,
      "final-page"
    );
    if (step3.solved) {
      allCaptchaTypes.push(...step3.types);
      await waitForAllRedirects(page, 15000);
      await waitForScriptsToLoad(page, 10000);
    }

    const finalUrl = page.url();
    const userAgent = await page.evaluate(() => navigator.userAgent);
    const captchaSolved = allCaptchaTypes.length > 0;
    console.log(`   Final URL after all redirects + scripts: ${finalUrl}`);
    if (captchaSolved) {
      console.log(`   Total captchas solved: ${allCaptchaTypes.join(", ")}`);
    }

    return {
      success: true,
      finalUrl,
      userAgent,
      captchaSolved,
      captchaTypes: allCaptchaTypes,
    };
  } catch (err) {
    console.error(`   Click execution error: ${err.message}`);
    return { success: false, errorMessage: err.message };
  }
}

async function takeScreenshot(page, campaignId, itemId) {
  try {
    const ts = Date.now();
    const filename = `click_${campaignId}_${itemId}_${ts}.png`;
    const fullPath = path.join(SCREENSHOT_DIR, filename);
    await page.screenshot({ path: fullPath, fullPage: false });
    const relPath = path.join("screenshots", filename).replace(/\\/g, "/");
    console.log(`   Screenshot saved: ${relPath}`);
    return relPath;
  } catch (err) {
    console.error(`   Screenshot failed: ${err.message}`);
    return null;
  }
}

function getUsedIpsToday(campaignId) {
  const todayStart = new Date(nowInTimezone());
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayStart.getDate() + 1);
  return db
    .prepare(
      `SELECT DISTINCT ip_address FROM clicks
       WHERE campaign_id = ? AND ip_address IS NOT NULL AND ip_address != ''
       AND timestamp BETWEEN ? AND ?`
    )
    .all(campaignId, todayStart.toISOString(), todayEnd.toISOString())
    .map((row) => row.ip_address);
}

async function tryProviderProxies(providerName, countryCode, campaignId) {
  console.log(`\n>>> Trying ${providerName} for ${countryCode}`);
  const allProxies = await proxyProvider.fetchProxiesFromProvider(
    providerName,
    countryCode,
    20
  );

  if (!allProxies || allProxies.length === 0) {
    console.log(`${providerName} returned 0 proxies for ${countryCode}`);
    return null;
  }

  const usedIPs = getUsedIpsToday(campaignId);
  console.log(
    `${providerName} returned ${allProxies.length} sessions. Used IPs today: ${usedIPs.length}`
  );

  const maxProbes = Math.min(allProxies.length, 20);

  for (let i = 0; i < maxProbes; i++) {
    const candidate = allProxies[i];
    const candidateConfig = buildProxyConfigFromCandidate(candidate);
    if (!candidateConfig) {
      console.log(
        `   Invalid proxy config for ${candidate.proxyKey}, skipping`
      );
      continue;
    }
    console.log(
      `Probing ${providerName} proxy ${i + 1}/${maxProbes} (${
        candidate.proxyKey
      })`
    );
    const ipInfo = await getIpAndCountryViaProxy(candidateConfig);
    if (!ipInfo.ip) {
      console.log(`   Probe failed, trying next`);
      continue;
    }
    if (
      !ipInfo.country ||
      ipInfo.country.toUpperCase() !== countryCode.toUpperCase()
    ) {
      console.log(
        `   REJECTED: Exit IP ${ipInfo.ip} is in ${
          ipInfo.country || "unknown"
        }, not ${countryCode}`
      );
      continue;
    }
    const freshUsedIPs = getUsedIpsToday(campaignId);
    if (freshUsedIPs.includes(ipInfo.ip)) {
      console.log(
        `   REJECTED: IP ${ipInfo.ip} already used today (fresh check)`
      );
      continue;
    }
    console.log(
      `   ACCEPTED: IP ${ipInfo.ip} in ${ipInfo.country} via ${providerName}`
    );
    return {
      proxyConfig: candidateConfig,
      proxyRecord: { id: null, proxy_url: candidate.proxy_url },
      ipAddress: ipInfo.ip,
      ipCountry: ipInfo.country,
      provider: providerName,
    };
  }

  return null;
}

async function tryHostedProxies(countryCode, campaignId) {
  const providers = proxyProvider.getActiveProviders();

  if (providers.length === 0) {
    console.log(
      "No hosted proxy provider enabled (set NOVA_ENABLED=true or KIND_ENABLED=true)"
    );
    return null;
  }

  console.log(`Active providers in priority order: ${providers.join(" -> ")}`);

  for (const providerName of providers) {
    const result = await tryProviderProxies(
      providerName,
      countryCode,
      campaignId
    );
    if (result) return result;
    console.log(
      `${providerName} exhausted for ${countryCode}, trying next provider`
    );
  }

  return null;
}

async function tryManualProxies(campaignId, countryCode) {
  const manualProxies = db
    .prepare("SELECT * FROM proxies WHERE campaign_id = ?")
    .all(campaignId);
  if (manualProxies.length === 0) return null;
  console.log(`Trying ${manualProxies.length} manual proxies`);

  const usedIPs = getUsedIpsToday(campaignId);
  const shuffled = [...manualProxies].sort(() => Math.random() - 0.5);

  for (const mp of shuffled) {
    const mpConfig = parseProxy(mp.proxy_url);
    if (!mpConfig) {
      console.log(`   Manual proxy INVALID format, skipping: ${mp.proxy_url}`);
      continue;
    }
    const ipInfo = await getIpAndCountryViaProxy(mpConfig);
    if (!ipInfo.ip) continue;

    if (countryCode) {
      if (
        !ipInfo.country ||
        ipInfo.country.toUpperCase() !== countryCode.toUpperCase()
      ) {
        console.log(
          `   Manual proxy REJECTED: IP ${ipInfo.ip} in ${ipInfo.country}, not ${countryCode}`
        );
        continue;
      }
    }

    const freshUsedIPs = getUsedIpsToday(campaignId);
    if (freshUsedIPs.includes(ipInfo.ip)) {
      console.log(
        `   Manual proxy REJECTED: IP ${ipInfo.ip} already used today`
      );
      continue;
    }

    console.log(`   Manual proxy ACCEPTED: IP ${ipInfo.ip}`);
    return {
      proxyConfig: mpConfig,
      proxyRecord: mp,
      ipAddress: ipInfo.ip,
      ipCountry: ipInfo.country,
      provider: "manual",
    };
  }
  return null;
}

clickQueue.process(1, async (job) => {
  memoryManager.checkMemoryUsage();
  const startTime = Date.now();
  console.log("\n========== JOB START ==========");
  console.log(`Processing job for campaign ${job.data.campaignId}`);

  const { campaignId } = job.data;
  const campaign = db
    .prepare(`SELECT * FROM campaigns WHERE id = ? AND status = 1`)
    .get(campaignId);
  if (!campaign) {
    console.log(`Campaign ${campaignId} not active - skipping`);
    return { skipped: true, reason: "Inactive" };
  }
  console.log(`Campaign: ${campaign.name} (Feed ID: ${campaign.feed_id})`);

  let selectedProfile;
  if (campaign.browser_profile === "desktop")
    selectedProfile = getRandomDesktopProfile();
  else if (campaign.browser_profile === "mobile")
    selectedProfile = getRandomMobileProfile();
  else selectedProfile = getRandomProfile();
  console.log(`Selected browser profile: ${selectedProfile.type}`);

  const now = nowInTimezone();
  const start = new Date(now);
  const [startHour, startMinute] = campaign.start_time.split(":");
  start.setHours(parseInt(startHour), parseInt(startMinute), 0, 0);
  const end = new Date(now);
  const [endHour, endMinute] = campaign.end_time.split(":");
  end.setHours(parseInt(endHour), parseInt(endMinute), 0, 0);
  if (now < start || now > end) {
    console.log(`Outside active hours - skipping`);
    return { skipped: true, reason: "Outside hours" };
  }

  if (campaign.hourly_click_limit && campaign.hourly_click_limit > 0) {
    const hourStart = new Date(now);
    hourStart.setMinutes(0, 0, 0);
    const hourEnd = new Date(hourStart);
    hourEnd.setHours(hourStart.getHours() + 1);
    const clicksThisHour = db
      .prepare(
        `SELECT COUNT(*) as count FROM clicks WHERE campaign_id = ? AND timestamp BETWEEN ? AND ?`
      )
      .get(campaignId, hourStart.toISOString(), hourEnd.toISOString()).count;
    if (clicksThisHour >= campaign.hourly_click_limit) {
      console.log(`Hourly limit reached - skipping`);
      return { skipped: true, reason: "Hourly limit exceeded" };
    }
  }

  const item = claimNextItem(campaignId, campaign.feed_id, campaign);
  if (!item) {
    console.log(`No items available for campaign ${campaignId}`);
    return { skipped: true, reason: "No items" };
  }
  console.log(`Claimed item ID ${item.id}: ${item.title.substring(0, 60)}`);

  let proxyConfig = null;
  let proxyRecord = null;
  let ipAddress = null;
  let ipCountry = null;
  let proxySource = "none";

  let countryToUse = null;
  if (campaign.target_country && campaign.target_country !== "Remote") {
    countryToUse = campaign.target_country;
  } else if (item.country) {
    countryToUse = item.country;
  }
  const countryCode = countryToUse ? countryNameToCode(countryToUse) : null;
  const strictCountry = countryToUse && countryToUse !== "Remote";

  console.log(
    `Target country: ${countryToUse || "Remote"} (code: ${
      countryCode || "none"
    }, strict: ${strictCountry})`
  );

  const providerStatus = proxyProvider.getStatus();
  console.log(
    `Provider status: Nova=${providerStatus.novaEnabled} Kind=${providerStatus.kindEnabled}`
  );

  if (countryCode) {
    const result = await tryHostedProxies(countryCode, campaignId);
    if (result) {
      proxyConfig = result.proxyConfig;
      proxyRecord = result.proxyRecord;
      ipAddress = result.ipAddress;
      ipCountry = result.ipCountry;
      proxySource = result.provider;
    } else {
      console.log(
        `All hosted providers exhausted for ${countryCode}, trying manual proxies`
      );
    }
  }

  if (!proxyConfig) {
    const result = await tryManualProxies(
      campaignId,
      strictCountry ? countryCode : null
    );
    if (result) {
      proxyConfig = result.proxyConfig;
      proxyRecord = result.proxyRecord;
      ipAddress = result.ipAddress;
      ipCountry = result.ipCountry;
      proxySource = "manual";
    }
  }

  if (!proxyConfig) {
    if (strictCountry) {
      console.log(`Checking if direct connection matches ${countryCode}`);
      const ipInfo = await getIpAndCountryViaProxy(null);
      if (
        ipInfo.country &&
        ipInfo.country.toUpperCase() === countryCode.toUpperCase()
      ) {
        const freshUsedIPs = getUsedIpsToday(campaignId);
        if (!freshUsedIPs.includes(ipInfo.ip)) {
          console.log(
            `Direct IP ${ipInfo.ip} matches ${countryCode} - using direct`
          );
          ipAddress = ipInfo.ip;
          ipCountry = ipInfo.country;
          proxySource = "direct";
        } else {
          console.log(
            `Direct IP ${ipInfo.ip} already used today - SKIPPING CLICK`
          );
          db.prepare(
            "UPDATE feed_items SET locked_until = NULL WHERE id = ?"
          ).run(item.id);
          return { skipped: true, reason: "No unused IP available" };
        }
      } else {
        console.log(
          `Direct IP in ${
            ipInfo.country || "unknown"
          } does not match ${countryCode} - SKIPPING CLICK`
        );
        db.prepare(
          "UPDATE feed_items SET locked_until = NULL WHERE id = ?"
        ).run(item.id);
        return { skipped: true, reason: `No ${countryCode} proxy available` };
      }
    } else {
      console.log(`No country requirement - using direct connection`);
      proxySource = "direct";
      const ipInfo = await getIpAndCountryViaProxy(null);
      ipAddress = ipInfo.ip;
      ipCountry = ipInfo.country;
    }
  }

  if (ipAddress) {
    const finalCheck = getUsedIpsToday(campaignId);
    if (finalCheck.includes(ipAddress)) {
      console.log(
        `FINAL CHECK FAIL: IP ${ipAddress} was used by another job - SKIPPING`
      );
      db.prepare("UPDATE feed_items SET locked_until = NULL WHERE id = ?").run(
        item.id
      );
      return { skipped: true, reason: "IP raced with another job" };
    }
  }

  const headless = isHeadlessMode();
  const captchaEnabled = isCaptchaEnabled();
  const capsolverKey = getCapsolverKey();
  console.log(
    `Launching browser (source: ${proxySource}, IP: ${
      ipAddress || "unknown"
    }, Country: ${ipCountry || "unknown"})`
  );
  console.log(
    `Captcha: enabled=${captchaEnabled}, capsolver=${
      capsolverKey ? "configured" : "missing"
    }`
  );

  let browser = null;
  let result = {
    success: false,
    finalUrl: null,
    userAgent: null,
    errorMessage: null,
    captchaSolved: false,
    captchaTypes: [],
  };
  let screenshotPath = null;

  try {
    const launchOptions = {
      headless,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--ignore-certificate-errors",
        "--disable-web-security",
        "--disable-features=IsolateOrigins,site-per-process",
        "--disable-site-isolation-trials",
        "--disable-dev-shm-usage",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-networking",
      ],
    };
    if (proxyConfig) launchOptions.proxy = proxyConfig;
    browser = await chromium.launch(launchOptions);
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      userAgent: selectedProfile.userAgent,
      viewport: selectedProfile.viewport,
      locale: "en-US",
      timezoneId: "America/New_York",
      permissions: ["geolocation"],
      extraHTTPHeaders: {
        "Accept-Language": "en-US,en;q=0.9",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
      },
    });

    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      Object.defineProperty(navigator, "plugins", {
        get: () => [1, 2, 3, 4, 5],
      });
      Object.defineProperty(navigator, "languages", {
        get: () => ["en-US", "en"],
      });
      Object.defineProperty(navigator, "platform", { get: () => "Win32" });
      Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 8 });
      Object.defineProperty(navigator, "deviceMemory", { get: () => 8 });
      window.chrome = {
        runtime: {},
        loadTimes: () => {},
        csi: () => {},
        app: {},
      };
      const getParam = RTCPeerConnection.prototype.createOffer;
      Object.defineProperty(screen, "colorDepth", { get: () => 24 });
      Object.defineProperty(screen, "pixelDepth", { get: () => 24 });
      const origQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (params) =>
        params.name === "notifications"
          ? Promise.resolve({ state: Notification.permission })
          : origQuery(params);
    });

    const page = await context.newPage();

    const clickResult = await executeClick(
      page,
      item.url,
      capsolverKey,
      captchaEnabled,
      proxyConfig,
      120000
    );

    if (clickResult.success) {
      result = clickResult;
      screenshotPath = await takeScreenshot(page, campaignId, item.id);
      console.log(`Click succeeded`);
    } else {
      result = clickResult;
      try {
        screenshotPath = await takeScreenshot(page, campaignId, item.id);
      } catch (_) {}
      console.log(`Click failed: ${result.errorMessage}`);
    }
  } catch (err) {
    result.errorMessage = err.message;
    console.error(`Exception: ${err.message}`);
  }

  if (browser) await browser.close();

  const insertClick = db.prepare(`
    INSERT INTO clicks (campaign_id, feed_item_id, proxy_id, status, final_url, ip_address, ip_country, user_agent, browser_type_used, error_message, screenshot_path, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertClick.run(
    campaignId,
    item.id,
    proxyRecord?.id || null,
    result.success ? "success" : "failure",
    result.finalUrl || (result.success ? item.url : null),
    ipAddress,
    ipCountry,
    result.userAgent,
    selectedProfile.type,
    result.errorMessage,
    screenshotPath,
    new Date().toISOString()
  );

  db.prepare("UPDATE feed_items SET locked_until = NULL WHERE id = ?").run(
    item.id
  );

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  const captchaInfo = result.captchaSolved
    ? `, Captcha: ${result.captchaTypes.join("+")}`
    : "";
  console.log(
    `\nClick recorded: ${result.success ? "SUCCESS" : "FAILURE"} (IP: ${
      ipAddress || "unknown"
    }, Country: ${
      ipCountry || "unknown"
    }, Source: ${proxySource}, Duration: ${duration}s${captchaInfo})`
  );
  memoryManager.checkMemoryUsage();
  console.log("========== JOB END ==========\n");
  return { success: result.success, itemId: item.id };
});

console.log("Click worker started (with full captcha support)");
