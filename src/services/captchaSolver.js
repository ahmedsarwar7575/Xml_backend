const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function safeEvaluate(page, fn, arg, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      await page
        .waitForLoadState("domcontentloaded", { timeout: 5000 })
        .catch(() => {});
      return arg !== undefined
        ? await page.evaluate(fn, arg)
        : await page.evaluate(fn);
    } catch (err) {
      if (
        err.message.includes("Execution context was destroyed") ||
        err.message.includes("Target closed")
      ) {
        await sleep(1500);
        continue;
      }
      throw err;
    }
  }
  return null;
}

async function waitForChallengeStable(page, maxWaitMs = 8000) {
  const deadline = Date.now() + maxWaitMs;
  let lastUrl = page.url();
  while (Date.now() < deadline) {
    await sleep(500);
    let curUrl;
    try {
      curUrl = page.url();
    } catch (_) {
      return;
    }
    if (curUrl !== lastUrl) {
      lastUrl = curUrl;
      await page
        .waitForLoadState("domcontentloaded", { timeout: 5000 })
        .catch(() => {});
    } else {
      return;
    }
  }
}

async function capsolverPost(apiKey, endpoint, body) {
  const res = await fetch(`https://api.capsolver.com/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientKey: apiKey, ...body }),
  });
  const data = await res.json();
  if (data.errorId !== 0) {
    throw new Error(
      `CapSolver [${endpoint}]: ${data.errorDescription || "unknown error"}`
    );
  }
  return data;
}

async function pollResult(apiKey, taskId, maxPolls = 60, intervalMs = 3000) {
  for (let i = 0; i < maxPolls; i++) {
    await sleep(intervalMs);
    const r = await capsolverPost(apiKey, "getTaskResult", { taskId });
    if (r.status === "ready") return r.solution;
    if (r.status === "failed") {
      throw new Error(
        `CapSolver task failed: ${r.errorDescription || "unknown"}`
      );
    }
  }
  throw new Error(
    `CapSolver timed out after ${(maxPolls * intervalMs) / 1000}s`
  );
}

// CapSolver proxy format: "ip:port:user:pass" (colons, no protocol, no @)
// Per https://docs.capsolver.com/en/guide/api-how-to-use-proxy/
function toCapsolverProxy(proxyConfig) {
  if (!proxyConfig || !proxyConfig.server) return null;
  try {
    const u = new URL(proxyConfig.server);
    if (proxyConfig.username) {
      return `${u.hostname}:${u.port}:${proxyConfig.username}:${proxyConfig.password}`;
    }
    return `${u.hostname}:${u.port}`;
  } catch (_) {
    return null;
  }
}

async function detectChallenges(page) {
  try {
    await page
      .waitForFunction(
        () => {
          const ifrs = document.querySelectorAll("iframe");
          for (const f of ifrs) {
            const src = f.getAttribute("src") || "";
            if (
              src.includes("challenges.cloudflare.com") ||
              src.includes("recaptcha") ||
              src.includes("hcaptcha") ||
              src.includes("google.com/recaptcha")
            )
              return true;
          }
          return !!document.querySelector(
            ".cf-turnstile, .g-recaptcha, .h-captcha, form#challenge-form, [data-sitekey]"
          );
        },
        { timeout: 6000 }
      )
      .catch(() => {});
    await sleep(2000);

    const allFound = [];
    const frames = page.frames();

    for (const frame of frames) {
      let frameUrl = "";
      try {
        frameUrl = frame.url();
      } catch (_) {}

      if (
        frameUrl.includes("recaptcha/api2/anchor") ||
        frameUrl.includes("recaptcha/enterprise/anchor")
      ) {
        const m = frameUrl.match(/[?&]k=([^&]+)/);
        if (m) {
          const isEnterprise = frameUrl.includes("/enterprise/");
          const isInvisible =
            frameUrl.includes("size=invisible") || frameUrl.includes("badge=");
          allFound.push({
            type: isEnterprise ? "recaptcha_v2_enterprise" : "recaptcha_v2",
            siteKey: m[1],
            isInvisible,
            frameUrl,
          });
        }
        continue;
      }

      if (frameUrl.includes("challenges.cloudflare.com")) {
        let extracted = null;
        const skMatch = frameUrl.match(/[?&]sitekey=(0x[a-zA-Z0-9_-]+)/);
        if (skMatch) extracted = skMatch[1];
        if (!extracted) {
          const pathMatch = frameUrl.match(/(0x[a-zA-Z0-9_-]{16,})/);
          if (pathMatch) extracted = pathMatch[1];
        }
        if (extracted) {
          allFound.push({
            type: "turnstile",
            siteKey: extracted,
            isIframe: true,
            frameUrl,
          });
        }
        continue;
      }

      if (frameUrl.includes("hcaptcha.com/captcha")) {
        const m = frameUrl.match(/[?&]sitekey=([^&]+)/);
        if (m) allFound.push({ type: "hcaptcha", siteKey: m[1], frameUrl });
        continue;
      }

      try {
        const frameFound = await frame
          .evaluate(() => {
            const out = [];

            const cfForm = document.querySelector("form#challenge-form");
            const cfAction = cfForm ? cfForm.getAttribute("action") || "" : "";
            const isCfFull =
              (document.title || "").includes("Just a moment") ||
              cfAction.includes("__cf_chl_f_tk") ||
              !!document.querySelector(
                "#cf-challenge-running, .cf-challenge-running"
              ) ||
              location.href.includes("cdn-cgi/challenge-platform");
            if (isCfFull) out.push({ type: "cloudflare_challenge" });

            for (const el of document.querySelectorAll(".cf-turnstile")) {
              const sk = el.getAttribute("data-sitekey");
              if (sk && sk.startsWith("0x"))
                out.push({
                  type: "turnstile",
                  siteKey: sk,
                  action: el.getAttribute("data-action") || null,
                });
            }

            for (const el of document.querySelectorAll(
              ".g-recaptcha, [data-sitekey]"
            )) {
              if (
                el.classList.contains("cf-turnstile") ||
                el.classList.contains("h-captcha")
              )
                continue;
              const sk = el.getAttribute("data-sitekey");
              if (!sk || sk.startsWith("0x")) continue;
              let isEnterprise = false;
              for (const s of document.querySelectorAll("script[src]")) {
                const src = s.getAttribute("src") || "";
                if (
                  src.includes("recaptcha/enterprise") ||
                  src.includes("/enterprise.js")
                ) {
                  isEnterprise = true;
                  break;
                }
              }
              if (
                !isEnterprise &&
                window.grecaptcha &&
                window.grecaptcha.enterprise
              )
                isEnterprise = true;
              const isInvisible =
                el.getAttribute("data-size") === "invisible" ||
                !!el.getAttribute("data-badge");
              out.push({
                type: isEnterprise ? "recaptcha_v2_enterprise" : "recaptcha_v2",
                siteKey: sk,
                isInvisible,
              });
            }

            for (const el of document.querySelectorAll(".h-captcha")) {
              const sk = el.getAttribute("data-sitekey");
              if (sk) out.push({ type: "hcaptcha", siteKey: sk });
            }

            return out;
          })
          .catch(() => []);

        for (const f of frameFound) allFound.push(f);
      } catch (_) {}
    }

    const bySiteKey = new Map();
    for (const c of allFound) {
      if (c.type === "cloudflare_challenge") {
        bySiteKey.set("__cf_challenge__", c);
        continue;
      }
      if (!c.siteKey) continue;
      const existing = bySiteKey.get(c.siteKey);
      if (!existing) {
        bySiteKey.set(c.siteKey, c);
        continue;
      }
      const merged = { ...existing };
      if (
        c.type === "recaptcha_v2_enterprise" &&
        existing.type !== "recaptcha_v2_enterprise"
      )
        merged.type = c.type;
      if (c.isInvisible || existing.isInvisible) merged.isInvisible = true;
      bySiteKey.set(c.siteKey, merged);
    }

    return Array.from(bySiteKey.values());
  } catch (_) {
    return [];
  }
}

async function solveCloudflareChallenge(apiKey, page, proxyConfig) {
  await waitForChallengeStable(page, 6000);

  const pageUrl = page.url();
  console.log(`   CF challenge target: ${pageUrl.slice(0, 80)}`);

  const capProxy = toCapsolverProxy(proxyConfig);
  if (!capProxy) {
    console.log("   CF challenge requires proxy - skipping");
    return false;
  }

  // Per CapSolver 2026 docs: only websiteURL + proxy needed. No html field.
  const taskPayload = {
    type: "AntiCloudflareTask",
    websiteURL: pageUrl,
    proxy: capProxy,
  };

  console.log(
    `   CF proxy (masked): ${capProxy
      .split(":")
      .slice(0, 2)
      .join(":")}:****:****`
  );

  const { taskId } = await capsolverPost(apiKey, "createTask", {
    task: taskPayload,
  });
  const solution = await pollResult(apiKey, taskId, 60, 3000);

  if (!solution || !solution.token) {
    throw new Error("CapSolver returned no token for Cloudflare challenge");
  }

  const context = page.context();
  const hostname = new URL(pageUrl).hostname;

  await context.addCookies([
    {
      name: "cf_clearance",
      value: solution.token,
      domain: hostname,
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "None",
    },
  ]);

  if (solution.userAgent) {
    await page.setExtraHTTPHeaders({ "user-agent": solution.userAgent });
  }

  await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await sleep(2000);
  return true;
}

async function solveTurnstile(apiKey, page, captcha, proxyConfig) {
  const pageUrl = page.url();

  let sitekey = captcha.siteKey;

  // If sitekey not starting with 0x, try extracting from frames
  if (!sitekey || !sitekey.startsWith("0x")) {
    for (const frame of page.frames()) {
      const furl = frame.url() || "";
      if (furl.includes("challenges.cloudflare.com")) {
        const m =
          furl.match(/[?&]sitekey=(0x[a-zA-Z0-9_-]+)/) ||
          furl.match(/(0x[a-zA-Z0-9_-]{16,})/);
        if (m) {
          sitekey = m[1];
          break;
        }
      }
    }
  }

  if (!sitekey || !sitekey.startsWith("0x")) {
    throw new Error(`Invalid Turnstile sitekey: ${sitekey}`);
  }

  const taskPayload = {
    type: "AntiTurnstileTaskProxyLess",
    websiteURL: pageUrl,
    websiteKey: sitekey,
  };
  if (captcha.action) taskPayload.metadata = { action: captcha.action };

  const { taskId } = await capsolverPost(apiKey, "createTask", {
    task: taskPayload,
  });
  const solution = await pollResult(apiKey, taskId);
  if (!solution || !solution.token)
    throw new Error("No turnstile token returned");

  await safeEvaluate(
    page,
    (token) => {
      const widget = document.querySelector(".cf-turnstile");
      if (widget && widget.shadowRoot) {
        const input = widget.shadowRoot.querySelector(
          'input[name="cf-turnstile-response"]'
        );
        if (input) {
          input.value = token;
          input.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }
      const inputs = document.querySelectorAll(
        'input[name="cf-turnstile-response"], input[name="cf-turnstile-widget-value"]'
      );
      for (const input of inputs) {
        input.value = token;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
      if (inputs.length === 0 && !widget) {
        const hidden = document.createElement("input");
        hidden.type = "hidden";
        hidden.name = "cf-turnstile-response";
        hidden.value = token;
        document.body.appendChild(hidden);
      }
      if (window.turnstile) {
        try {
          window.turnstile.execute && window.turnstile.execute();
        } catch (_) {}
      }
      const form = document.querySelector("form");
      if (form) {
        const btn = form.querySelector(
          'button[type="submit"], input[type="submit"]'
        );
        if (btn) btn.click();
        else
          form.dispatchEvent(
            new Event("submit", { bubbles: true, cancelable: true })
          );
      }
    },
    solution.token
  );

  return true;
}

async function solveRecaptchaV2(
  apiKey,
  page,
  captcha,
  proxyConfig,
  isEnterprise = false
) {
  let targetFrame = page.mainFrame();
  let targetUrl = page.url();

  for (const frame of page.frames()) {
    let furl = "";
    try {
      furl = frame.url();
    } catch (_) {
      continue;
    }
    if (
      furl.includes("recaptcha/api2/anchor") ||
      furl.includes("recaptcha/api2/bframe") ||
      furl.includes("recaptcha/enterprise/anchor") ||
      furl.includes("recaptcha/enterprise/bframe")
    )
      continue;
    try {
      const has = await frame
        .evaluate(
          (sk) =>
            !!document.querySelector(
              `.g-recaptcha[data-sitekey="${sk}"], [data-sitekey="${sk}"]`
            ),
          captcha.siteKey
        )
        .catch(() => false);
      if (has) {
        targetFrame = frame;
        targetUrl = furl || targetUrl;
        break;
      }
    } catch (_) {}
  }

  const taskType = isEnterprise
    ? "ReCaptchaV2EnterpriseTaskProxyLess"
    : "ReCaptchaV2TaskProxyLess";

  const taskPayload = {
    type: taskType,
    websiteURL: targetUrl,
    websiteKey: captcha.siteKey,
    isInvisible: !!captcha.isInvisible,
  };

  console.log(
    `   reCAPTCHA${isEnterprise ? " Enterprise" : ""}${
      captcha.isInvisible ? " Invisible" : ""
    } → ${targetUrl.slice(0, 60)}`
  );

  const { taskId } = await capsolverPost(apiKey, "createTask", {
    task: taskPayload,
  });
  const solution = await pollResult(apiKey, taskId);
  if (!solution || !solution.gRecaptchaResponse) {
    throw new Error("No reCAPTCHA token returned");
  }

  await targetFrame.evaluate((token) => {
    const textareas = document.querySelectorAll(
      'textarea[name="g-recaptcha-response"]'
    );
    for (const ta of textareas) {
      Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value"
      )?.set?.call(ta, token);
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      ta.dispatchEvent(new Event("change", { bubbles: true }));
      ta.style.display = "block";
    }
    if (textareas.length === 0) {
      const ta = document.createElement("textarea");
      ta.name = "g-recaptcha-response";
      ta.value = token;
      ta.style.display = "none";
      document.body.appendChild(ta);
    }
    const walk = (obj, depth) => {
      if (!obj || depth > 6 || typeof obj !== "object") return;
      if (typeof obj.callback === "function") {
        try {
          obj.callback(token);
        } catch (_) {}
      }
      for (const k of Object.keys(obj)) {
        try {
          walk(obj[k], depth + 1);
        } catch (_) {}
      }
    };
    if (window.___grecaptcha_cfg && window.___grecaptcha_cfg.clients) {
      try {
        walk(window.___grecaptcha_cfg.clients, 0);
      } catch (_) {}
    }
    const form = document.querySelector("form");
    if (form) {
      const btn = form.querySelector(
        'button[type="submit"], input[type="submit"]'
      );
      if (btn) btn.click();
      else form.dispatchEvent(new Event("submit", { bubbles: true }));
    }
  }, solution.gRecaptchaResponse);

  return true;
}

async function solveHCaptcha(apiKey, page, captcha) {
  const taskPayload = {
    type: "HCaptchaTaskProxyLess",
    websiteURL: page.url(),
    websiteKey: captcha.siteKey,
  };
  const { taskId } = await capsolverPost(apiKey, "createTask", {
    task: taskPayload,
  });
  const solution = await pollResult(apiKey, taskId);
  if (!solution || !solution.gRecaptchaResponse) {
    throw new Error("No hCaptcha token returned");
  }
  await safeEvaluate(
    page,
    (token) => {
      const textareas = document.querySelectorAll(
        'textarea[name="h-captcha-response"], textarea[name="g-recaptcha-response"]'
      );
      for (const ta of textareas) {
        ta.value = token;
        ta.innerHTML = token;
      }
      const form = document.querySelector("form");
      if (form) {
        const btn = form.querySelector(
          'button[type="submit"], input[type="submit"]'
        );
        if (btn) btn.click();
        else form.dispatchEvent(new Event("submit", { bubbles: true }));
      }
    },
    solution.gRecaptchaResponse
  );
  return true;
}

async function solveOne(challenge, capsolverKey, page, proxyConfig) {
  if (challenge.type === "cloudflare_challenge") {
    await solveCloudflareChallenge(capsolverKey, page, proxyConfig);
  } else if (challenge.type === "turnstile") {
    await solveTurnstile(capsolverKey, page, challenge, proxyConfig);
  } else if (challenge.type === "recaptcha_v2") {
    await solveRecaptchaV2(capsolverKey, page, challenge, proxyConfig, false);
  } else if (challenge.type === "recaptcha_v2_enterprise") {
    await solveRecaptchaV2(capsolverKey, page, challenge, proxyConfig, true);
  } else if (challenge.type === "hcaptcha") {
    await solveHCaptcha(capsolverKey, page, challenge);
  }
}

async function solveAllCaptchas(
  page,
  capsolverKey,
  captchaEnabled,
  proxyConfig
) {
  if (!captchaEnabled || !capsolverKey)
    return { solved: false, types: [], error: null };

  let pageUrl;
  try {
    pageUrl = page.url();
  } catch (_) {
    return { solved: false, types: [], error: "page closed" };
  }
  if (!pageUrl || pageUrl === "about:blank")
    return { solved: false, types: [], error: null };

  const allSolvedTypes = [];
  let lastError = null;
  const MAX_ROUNDS = 4;

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    let challenges = [];
    try {
      challenges = await detectChallenges(page);
    } catch (e) {
      lastError = "detect error: " + e.message;
      break;
    }

    if (!challenges.length) {
      if (round > 1) console.log(`   Round ${round}: page clean ✓`);
      break;
    }

    console.log(
      `   Round ${round}: ${challenges.length} challenge(s): ${challenges
        .map((c) => c.type)
        .join(", ")}`
    );

    for (const challenge of challenges) {
      let solved = false;
      for (let attempt = 1; attempt <= 3 && !solved; attempt++) {
        try {
          console.log(
            `     [attempt ${attempt}/3] Solving ${challenge.type}${
              challenge.siteKey ? " key=" + challenge.siteKey.slice(0, 20) : ""
            }`
          );
          await solveOne(challenge, capsolverKey, page, proxyConfig);
          await sleep(3500);
          const recheck = await detectChallenges(page).catch(() => []);
          const stillThere = recheck.some(
            (c) => c.type === challenge.type && c.siteKey === challenge.siteKey
          );
          if (!stillThere) {
            solved = true;
            allSolvedTypes.push(challenge.type);
            console.log(`     ✓ ${challenge.type} cleared`);
          } else if (attempt < 3) {
            console.log(`     Still present, retry ${attempt + 1}/3...`);
            await sleep(2000);
          }
        } catch (err) {
          console.error(`     Error: ${err.message}`);
          lastError = err.message;
          if (attempt < 3) await sleep(2000);
        }
      }
      if (!solved) console.log(`     ${challenge.type} could not be cleared`);
    }

    await sleep(2500);
    try {
      await page.waitForLoadState("domcontentloaded", { timeout: 5000 });
    } catch (_) {}
  }

  return {
    solved: allSolvedTypes.length > 0,
    types: [...new Set(allSolvedTypes)],
    error: lastError,
  };
}

module.exports = {
  detectChallenges,
  solveAllCaptchas,
  solveCloudflareChallenge,
  solveTurnstile,
  solveRecaptchaV2,
  solveHCaptcha,
};
