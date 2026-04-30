/*
  Direct CapSolver API test – fully dynamic sitekey extraction.
  All 5 tests enabled: reCAPTCHA v2, invisible, enterprise, Turnstile, Cloudflare Challenge.
  Turnstile extraction: waits for .cf-turnstile, reads data-sitekey (like your production code).
  Cloudflare Challenge uses Nova proxy (dynamic session).
  Run: node test-capsolver-direct.js
*/

const { chromium } = require("playwright");

const CAPSOLVER_API_KEY =
  "CAP-77D475D9E3324B393FC8782BE34FD52F066A1500F80E5B7016646292E9A8B98E";

function buildNovaProxy() {
  const session = Math.random().toString(36).substring(2, 12);
  return {
    proxyStr: `residential.novaproxy.io:12321:a638cacf689e:4f63895ac023_country-us_session-${session}_lifetime-600s`,
    session,
  };
}

async function extractSitekey(url, options = {}) {
  const { isTurnstile = false } = options;
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
    });
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 800 },
    });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

    let sitekey = null;
    let isInvisible = false;
    const finalUrl = page.url();

    if (isTurnstile) {
      console.log(`  Waiting for Turnstile widget (up to 30s)...`);

      // Wait for any Turnstile indicator: div.cf-turnstile, iframe, or script
      await page
        .waitForFunction(
          () => {
            // Method 1: inline div with class cf-turnstile + data-sitekey
            const divEl = document.querySelector(".cf-turnstile[data-sitekey]");
            if (divEl) return true;
            // Method 2: any element with data-sitekey starting with 0x
            const anyKey = document.querySelector('[data-sitekey^="0x"]');
            if (anyKey) return true;
            // Method 3: turnstile iframe loaded
            const iframes = document.querySelectorAll("iframe");
            for (const f of iframes) {
              const src = f.getAttribute("src") || "";
              if (
                src.includes("challenges.cloudflare.com") ||
                src.includes("turnstile")
              )
                return true;
            }
            return false;
          },
          { timeout: 30000 }
        )
        .catch(() => {});

      // Give SPA frameworks (React/Vue) extra time to mount widget
      await page.waitForTimeout(3000);

      // Method 1: scan all frames for [data-sitekey]
      for (const frame of page.frames()) {
        try {
          const sks = await frame.$$eval("[data-sitekey]", (els) =>
            els.map((el) => ({
              key: el.getAttribute("data-sitekey"),
              cls: el.className || "",
            }))
          );
          for (const item of sks) {
            // Turnstile keys start with "0x"; reCAPTCHA keys start with "6L"
            if (item.key && item.key.startsWith("0x")) {
              sitekey = item.key;
              console.log(
                `  Extracted Turnstile sitekey via data-sitekey: ${sitekey}`
              );
              break;
            }
          }
          if (sitekey) break;
        } catch (_) {}
      }

      // Method 2: extract from Turnstile iframe URL path (challenges.cloudflare.com)
      if (!sitekey) {
        for (const frame of page.frames()) {
          const furl = frame.url() || "";
          if (furl.includes("challenges.cloudflare.com")) {
            const m =
              furl.match(/[?&]sitekey=(0x[a-zA-Z0-9_-]+)/) ||
              furl.match(/(0x[a-zA-Z0-9_-]{16,})/);
            if (m) {
              sitekey = m[1];
              console.log(
                `  Extracted Turnstile sitekey from iframe URL: ${sitekey}`
              );
              break;
            }
          }
        }
      }

      // Method 3: scan page HTML for "sitekey" string near Turnstile
      if (!sitekey) {
        try {
          const html = await page.content();
          const m =
            html.match(/data-sitekey=["'](0x[a-zA-Z0-9_-]+)["']/) ||
            html.match(
              /turnstile[^"']*sitekey["']?\s*[:=]\s*["'](0x[a-zA-Z0-9_-]+)["']/i
            ) ||
            html.match(/(0x[a-zA-Z0-9_-]{20,})/);
          if (m) {
            sitekey = m[1];
            console.log(
              `  Extracted Turnstile sitekey from page HTML: ${sitekey}`
            );
          }
        } catch (_) {}
      }

      if (!sitekey) throw new Error("Could not find Turnstile sitekey on page");
    } else {
      // reCAPTCHA: look for [data-sitekey] in main page and iframes
      try {
        await page.waitForSelector("[data-sitekey]", { timeout: 10000 });
      } catch {
        /* continue */
      }

      for (const frame of page.frames()) {
        const el = await frame.$("[data-sitekey]");
        if (el) {
          sitekey = await el.getAttribute("data-sitekey");
          isInvisible = (await el.getAttribute("data-size")) === "invisible";
          if (sitekey) break;
        }
      }
      if (!sitekey) throw new Error("Could not extract reCAPTCHA sitekey");
    }

    await browser.close();
    return { sitekey, finalUrl, isInvisible };
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    throw new Error(`Dynamic extraction failed: ${err.message}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function capsolverCreateTask(taskPayload) {
  const res = await fetch("https://api.capsolver.com/createTask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientKey: CAPSOLVER_API_KEY, task: taskPayload }),
  });
  return await res.json();
}

async function capsolverGetResult(taskId) {
  const res = await fetch("https://api.capsolver.com/getTaskResult", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientKey: CAPSOLVER_API_KEY, taskId }),
  });
  return await res.json();
}

async function solveCapsolver(taskPayload, label) {
  console.log(`\n[${label}] Sending task to CapSolver:`);
  console.log(`  type: ${taskPayload.type}`);
  console.log(`  websiteURL: ${taskPayload.websiteURL}`);
  console.log(`  websiteKey: ${(taskPayload.websiteKey || "").slice(0, 30)}`);
  if (taskPayload.proxy)
    console.log(`  proxy: ${taskPayload.proxy.replace(/:([^:]+)$/, ":****")}`);
  if (taskPayload.isInvisible)
    console.log(`  isInvisible: ${taskPayload.isInvisible}`);
  if (taskPayload.metadata)
    console.log(`  metadata: ${JSON.stringify(taskPayload.metadata)}`);

  const created = await capsolverCreateTask(taskPayload);
  if (created.errorId !== 0) {
    console.log(`[${label}] ✗ createTask error: ${created.errorDescription}`);
    return { ok: false, error: created.errorDescription };
  }

  const taskId = created.taskId;
  console.log(`[${label}] taskId: ${taskId}\n[${label}] Polling...`);

  for (let i = 0; i < 60; i++) {
    await sleep(3000);
    const r = await capsolverGetResult(taskId);
    if (r.status === "ready") {
      console.log(`[${label}] ✓ SOLVED in ${(i + 1) * 3}s`);
      return { ok: true, solution: r.solution };
    }
    if (r.errorId !== 0 && r.errorId !== undefined) {
      console.log(`[${label}] ✗ getTaskResult error: ${r.errorDescription}`);
      return { ok: false, error: r.errorDescription };
    }
    process.stdout.write(".");
  }
  console.log(`[${label}] ✗ TIMEOUT`);
  return { ok: false, error: "timeout" };
}

async function test1_recaptchaV2() {
  console.log("\n" + "=".repeat(78));
  console.log("TEST 1: reCAPTCHA v2 (regular checkbox)");
  console.log("=".repeat(78));
  const url = "https://www.google.com/recaptcha/api2/demo";
  const { sitekey, finalUrl } = await extractSitekey(url);
  return solveCapsolver(
    {
      type: "ReCaptchaV2TaskProxyLess",
      websiteURL: finalUrl,
      websiteKey: sitekey,
    },
    "recaptcha_v2"
  );
}

async function test2_recaptchaV2Invisible() {
  console.log("\n" + "=".repeat(78));
  console.log("TEST 2: reCAPTCHA v2 INVISIBLE");
  console.log("=".repeat(78));
  const url = "https://recaptcha-demo.appspot.com/recaptcha-v2-invisible.php";
  const { sitekey, finalUrl, isInvisible } = await extractSitekey(url);
  return solveCapsolver(
    {
      type: "ReCaptchaV2TaskProxyLess",
      websiteURL: finalUrl,
      websiteKey: sitekey,
      isInvisible: isInvisible || true,
    },
    "recaptcha_v2_invisible"
  );
}

async function test3_recaptchaV2Enterprise() {
  console.log("\n" + "=".repeat(78));
  console.log("TEST 3: reCAPTCHA v2 ENTERPRISE");
  console.log("=".repeat(78));
  const url = "https://www.google.com/recaptcha/api2/demo";
  const { sitekey, finalUrl } = await extractSitekey(url);
  return solveCapsolver(
    {
      type: "ReCaptchaV2EnterpriseTaskProxyLess",
      websiteURL: finalUrl,
      websiteKey: sitekey,
      enterprisePayload: {},
    },
    "recaptcha_v2_enterprise"
  );
}

async function test4_cloudflareTurnstile() {
  console.log("\n" + "=".repeat(78));
  console.log("TEST 4: Cloudflare Turnstile");
  console.log("=".repeat(78));

  // Try a list of URLs known to have Turnstile widgets - whichever succeeds first
  const candidates = [
    "https://nowsecure.nl/",
    "https://dash.cloudflare.com/login",
    "https://www.serversmtp.com/turnstile-test/",
  ];

  let sitekey = null;
  let finalUrl = null;
  let lastError = null;

  for (const url of candidates) {
    console.log(`\n  Trying URL: ${url}`);
    try {
      const result = await extractSitekey(url, { isTurnstile: true });
      sitekey = result.sitekey;
      finalUrl = result.finalUrl;
      console.log(`  ✓ Extracted from ${url}`);
      break;
    } catch (err) {
      console.log(`  ✗ Failed: ${err.message.slice(0, 100)}`);
      lastError = err.message;
    }
  }

  if (!sitekey) {
    return { ok: false, error: `All Turnstile URLs failed: ${lastError}` };
  }

  return solveCapsolver(
    {
      type: "AntiTurnstileTaskProxyLess",
      websiteURL: finalUrl,
      websiteKey: sitekey,
      metadata: { action: "login" },
    },
    "turnstile"
  );
}

async function test5_cloudflareChallenge() {
  console.log("\n" + "=".repeat(78));
  console.log("TEST 5: Cloudflare Challenge (full JS challenge)");
  console.log("=".repeat(78));
  const { proxyStr, session } = buildNovaProxy();
  console.log(`  Nova session: ${session}`);
  return solveCapsolver(
    {
      type: "AntiCloudflareTask",
      websiteURL: "https://nowsecure.nl",
      proxy: proxyStr,
    },
    "cloudflare_challenge"
  );
}

async function main() {
  console.log("#".repeat(78));
  console.log("# DIRECT CAPSOLVER API TEST – FULLY DYNAMIC (NO HARDCODED)");
  console.log(`# Started: ${new Date().toISOString()}`);
  console.log("#".repeat(78));

  const results = {};

  try {
    results.recaptcha_v2 = await test1_recaptchaV2();
  } catch (e) {
    results.recaptcha_v2 = { ok: false, error: e.message };
  }
  try {
    results.recaptcha_v2_invisible = await test2_recaptchaV2Invisible();
  } catch (e) {
    results.recaptcha_v2_invisible = { ok: false, error: e.message };
  }
  try {
    results.recaptcha_v2_enterprise = await test3_recaptchaV2Enterprise();
  } catch (e) {
    results.recaptcha_v2_enterprise = { ok: false, error: e.message };
  }
  try {
    results.turnstile = await test4_cloudflareTurnstile();
  } catch (e) {
    results.turnstile = { ok: false, error: e.message };
  }
  try {
    results.cloudflare_challenge = await test5_cloudflareChallenge();
  } catch (e) {
    results.cloudflare_challenge = { ok: false, error: e.message };
  }

  console.log("\n" + "#".repeat(78));
  console.log("# SUMMARY");
  console.log("#".repeat(78));

  let passed = 0,
    failed = 0;
  for (const [name, r] of Object.entries(results)) {
    if (r.ok) {
      console.log(`✓ PASS  ${name}`);
      const token = (
        r.solution?.gRecaptchaResponse ||
        r.solution?.token ||
        ""
      ).slice(0, 60);
      if (token) console.log(`         token: ${token}...`);
      passed++;
    } else {
      console.log(`✗ FAIL  ${name}: ${r.error}`);
      failed++;
    }
  }

  console.log("\n" + "=".repeat(78));
  console.log(`PASSED: ${passed}/5    FAILED: ${failed}/5`);
  console.log("=".repeat(78));
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
