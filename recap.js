/*
  Direct CapSolver API test – fully dynamic sitekey extraction.
  Automatically fetches sitekeys from target pages (including iframes).
  Run: node test-capsolver-direct.js
*/

const { chromium } = require("playwright");

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const CAPSOLVER_API_KEY =
  "CAP-77D475D9E3324B393FC8782BE34FD52F066A1500F80E5B7016646292E9A8B98E";

// ─── STATIC PROXY (for Cloudflare Challenge) ───────────────────────────────────
const STATIC_PROXY = {
  host: "72.1.154.66",
  port: 7957,
  username: "bdhitsfv",
  password: "egx94yvbk56b",
};

// ─── SITEKEY EXTRACTOR (handles iframes, reCAPTCHA & Turnstile) ─────────────
async function extractSitekey(url) {
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    // Give iframes and JS time to render
    await page.waitForTimeout(3000);

    let sitekey = null;
    let isInvisible = false;
    const finalUrl = page.url();

    // Search all frames (main + iframes)
    const frames = page.frames();
    for (const frame of frames) {
      // Look for any element with data-sitekey (reCAPTCHA or Turnstile)
      const el = await frame.$("[data-sitekey]");
      if (el) {
        sitekey = await el.getAttribute("data-sitekey");
        isInvisible = (await el.getAttribute("data-size")) === "invisible";
        break;
      }
    }

    await browser.close();
    return { sitekey, finalUrl, isInvisible };
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    console.log(`  ⚠️ Extraction failed: ${err.message}`);
    return { sitekey: null, finalUrl: url, isInvisible: false };
  }
}

// ─── CAPSOLVER API ────────────────────────────────────────────────────────────
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
  if (taskPayload.isInvisible !== undefined)
    console.log(`  isInvisible: ${taskPayload.isInvisible}`);
  if (taskPayload.metadata)
    console.log(`  metadata: ${JSON.stringify(taskPayload.metadata)}`);

  const created = await capsolverCreateTask(taskPayload);
  if (created.errorId !== 0) {
    console.log(`[${label}] ✗ createTask error: ${created.errorDescription}`);
    return { ok: false, error: created.errorDescription };
  }

  const taskId = created.taskId;
  console.log(`[${label}] taskId: ${taskId}`);
  console.log(`[${label}] Polling...`);

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

// ─── TESTS ────────────────────────────────────────────────────────────────────
async function test1_recaptchaV2() {
  console.log("\n" + "=".repeat(78));
  console.log("TEST 1: reCAPTCHA v2 (regular checkbox)");
  console.log("=".repeat(78));

  const url = "https://www.google.com/recaptcha/api2/demo";
  console.log(`  Extracting sitekey from ${url}...`);
  const { sitekey, finalUrl, isInvisible } = await extractSitekey(url);
  if (!sitekey) return { ok: false, error: "Could not extract sitekey" };
  console.log(
    `  Sitekey: ${sitekey.slice(0, 30)}..., isInvisible: ${isInvisible}`
  );

  return await solveCapsolver(
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
  console.log(`  Extracting sitekey from ${url}...`);
  const { sitekey, finalUrl, isInvisible } = await extractSitekey(url);
  if (!sitekey) return { ok: false, error: "Could not extract sitekey" };
  console.log(
    `  Sitekey: ${sitekey.slice(0, 30)}..., isInvisible: ${isInvisible}`
  );

  return await solveCapsolver(
    {
      type: "ReCaptchaV2TaskProxyLess",
      websiteURL: finalUrl,
      websiteKey: sitekey,
      isInvisible: isInvisible || true, // force true if detected, but we know it's invisible
    },
    "recaptcha_v2_invisible"
  );
}

async function test3_recaptchaV2Enterprise() {
  console.log("\n" + "=".repeat(78));
  console.log("TEST 3: reCAPTCHA v2 ENTERPRISE");
  console.log("=".repeat(78));

  const url = "https://www.google.com/recaptcha/api2/demo"; // enterprise demo uses same page with enterprise key
  console.log(`  Extracting sitekey from ${url}...`);
  const { sitekey, finalUrl, isInvisible } = await extractSitekey(url);
  if (!sitekey) return { ok: false, error: "Could not extract sitekey" };
  console.log(
    `  Sitekey: ${sitekey.slice(0, 30)}..., isInvisible: ${isInvisible}`
  );

  return await solveCapsolver(
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

  const url = "https://dash.cloudflare.com/login";
  console.log(`  Extracting sitekey from ${url}...`);
  const { sitekey, finalUrl } = await extractSitekey(url);
  if (!sitekey)
    return { ok: false, error: "Could not extract Turnstile sitekey" };
  console.log(`  Sitekey: ${sitekey.slice(0, 30)}...`);

  return await solveCapsolver(
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

  const proxyStr = `${STATIC_PROXY.host}:${STATIC_PROXY.port}:${STATIC_PROXY.username}:${STATIC_PROXY.password}`;

  return await solveCapsolver(
    {
      type: "AntiCloudflareTask",
      websiteURL: "https://nowsecure.nl",
      proxy: proxyStr,
      // AntiCloudflareTask does not accept websiteKey
    },
    "cloudflare_challenge"
  );
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
async function main() {
  console.log("#".repeat(78));
  console.log("# DIRECT CAPSOLVER API TEST – DYNAMIC SITEKEY EXTRACTION");
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
      if (r.solution) {
        const token = (
          r.solution.gRecaptchaResponse ||
          r.solution.token ||
          ""
        ).slice(0, 60);
        if (token) console.log(`         token: ${token}...`);
      }
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
