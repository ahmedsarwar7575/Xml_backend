const { chromium } = require("playwright");

// ─── Config ───────────────────────────────────────────────────────────────────

const CAPSOLVER_API_KEY = "CAP-77D475D9E3324B393FC8782BE34FD52F066A1500F80E5B7016646292E9A8B98E";
const TARGET_URL = "https://cfschl.peet.ws/";

// Same format your clickWorker already uses — paste a fresh session URL
const PROXY =
  "http://b80ad5e8a53c:f116c2fc160c_country-us_session-8l7qpn1yjd_lifetime-600s@residential.novaproxy.io:12321";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, msg) => console.log(`[${tag}] ${msg}`);

// EXACT same parseProxy your clickWorker uses — no changes
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

// CapSolver proxy string format: http:user:pass@host:port
function toCapsolverProxy(proxyConfig) {
  const u = new URL(proxyConfig.server);
  const proto = u.protocol.replace(":", "");
  if (proxyConfig.username) {
    return `${proto}:${proxyConfig.username}:${proxyConfig.password}@${u.hostname}:${u.port}`;
  }
  return `${proto}:${u.hostname}:${u.port}`;
}

// ─── CapSolver ────────────────────────────────────────────────────────────────

async function capsolverPost(endpoint, body) {
  const res = await fetch(`https://api.capsolver.com/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientKey: CAPSOLVER_API_KEY, ...body }),
  });
  const data = await res.json();
  if (data.errorId !== 0)
    throw new Error(`CapSolver [${endpoint}]: ${data.errorDescription}`);
  return data;
}

async function pollResult(taskId) {
  log("capsolver", `Polling taskId: ${taskId}`);
  for (let i = 0; i < 40; i++) {
    await sleep(3000);
    const r = await capsolverPost("getTaskResult", { taskId });
    if (r.status === "ready") {
      console.log("");
      log("capsolver", "Solution received ✓");
      return r.solution;
    }
    if (r.status === "failed")
      throw new Error(`CapSolver failed: ${r.errorDescription}`);
    process.stdout.write(".");
  }
  throw new Error("CapSolver timed out");
}

// ─── Detection ────────────────────────────────────────────────────────────────

async function isCfChallengePage(page) {
  return page.evaluate(() => {
    const form = document.querySelector("form#challenge-form");
    const action = form ? form.getAttribute("action") || "" : "";
    return (
      (document.title || "").includes("Just a moment") ||
      action.includes("__cf_chl_f_tk") ||
      !!document.querySelector(
        "#cf-challenge-running, .cf-challenge-running"
      ) ||
      location.href.includes("cdn-cgi/challenge-platform")
    );
  });
}

async function getPageHtmlBase64(page) {
  return page.evaluate(() =>
    btoa(unescape(encodeURIComponent(document.documentElement.outerHTML)))
  );
}

// ─── Solve ────────────────────────────────────────────────────────────────────

async function solveCfChallenge(pageUrl, pageHtmlB64, proxyConfig, pageUA) {
  const capProxy = toCapsolverProxy(proxyConfig);
  log("capsolver", "Task type: AntiCloudflareTask");
  log("capsolver", `Proxy: ${capProxy.replace(/:([^:@]+)@/, ":****@")}`);

  const { taskId } = await capsolverPost("createTask", {
    task: {
      type: "AntiCloudflareTask",
      websiteURL: pageUrl,
      proxy: capProxy,
      userAgent: pageUA,
      html: pageHtmlB64,
    },
  });

  return pollResult(taskId); // → { token, userAgent }
}

// ─── Apply solution ───────────────────────────────────────────────────────────

async function applySolution(context, page, solution) {
  const { token: cfClearance, userAgent } = solution;

  log("solution", `cf_clearance: ${cfClearance.slice(0, 60)}...`);
  log("solution", `userAgent:    ${userAgent.slice(0, 80)}...`);

  await context.addCookies([
    {
      name: "cf_clearance",
      value: cfClearance,
      domain: new URL(page.url()).hostname,
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "None",
    },
  ]);
  log("cookie", "cf_clearance set");

  await page.setExtraHTTPHeaders({ "user-agent": userAgent });
  log("reload", "Reloading with cf_clearance...");
  await page.goto(page.url(), { waitUntil: "networkidle", timeout: 30_000 });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  const proxyConfig = parseProxy(PROXY);
  if (!proxyConfig) throw new Error("Invalid proxy URL");

  log("proxy", `Server:   ${proxyConfig.server}`);
  log("proxy", `Username: ${proxyConfig.username}`);

  // EXACT same pattern as your clickWorker — proxy goes into browser.launch()
  const launchOptions = {
    headless: true,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--ignore-certificate-errors",
    ],
  };
  launchOptions.proxy = proxyConfig; // { server, username, password }

  const browser = await chromium.launch(launchOptions);

  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });

  const page = await context.newPage();

  page.on("framenavigated", (frame) => {
    if (frame !== page.mainFrame()) return;
    log("nav", frame.url());
  });

  log("start", TARGET_URL);

  try {
    await page.goto(TARGET_URL, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
  } catch (e) {
    log("warn", e.message.split("\n")[0]);
  }

  await sleep(3000);

  const isChallenge = await isCfChallengePage(page);
  log("detect", "─".repeat(50));
  log("detect", `CF Challenge: ${isChallenge}`);
  log("detect", `Title: ${await page.title()}`);
  log("detect", `URL:   ${page.url()}`);
  log("detect", "─".repeat(50));

  if (!isChallenge) {
    log("detect", "No CF Challenge — page loaded clean");
    await browser.close();
    return;
  }

  const pageUA = await page.evaluate(() => navigator.userAgent);
  const pageHtmlB64 = await getPageHtmlBase64(page);
  const solution = await solveCfChallenge(
    page.url(),
    pageHtmlB64,
    proxyConfig,
    pageUA
  );

  await applySolution(context, page, solution);

  await sleep(2000);
  const stillChallenge = await isCfChallengePage(page);
  if (stillChallenge) {
    log("error", "Still on challenge page");
    log(
      "error",
      "→ Proxy session likely expired — generate a fresh session URL from NovaProxy"
    );
  } else {
    log("success", "✓ CF Challenge bypassed!");
    log("success", `URL:   ${page.url()}`);
    log("success", `Title: ${await page.title()}`);
  }

  await browser.close();
}

run().catch((err) => {
  console.error("[fatal]", err.message);
  process.exit(1);
});
