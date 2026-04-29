const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function safeEvaluate(page, fn, arg, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      // wait for any navigation to settle before eval
      await page
        .waitForLoadState("domcontentloaded", { timeout: 5000 })
        .catch(() => {});
      if (arg !== undefined) {
        return await page.evaluate(fn, arg);
      }
      return await page.evaluate(fn);
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

async function pollResult(apiKey, taskId, maxPolls = 40, intervalMs = 3000) {
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
    "CapSolver timed out after " + (maxPolls * intervalMs) / 1000 + "s"
  );
}

function toCapsolverProxy(proxyConfig) {
  if (!proxyConfig || !proxyConfig.server) return null;
  try {
    const u = new URL(proxyConfig.server);
    const proto = u.protocol.replace(":", "");
    if (proxyConfig.username) {
      return `${proto}:${proxyConfig.username}:${proxyConfig.password}@${u.hostname}:${u.port}`;
    }
    return `${proto}:${u.hostname}:${u.port}`;
  } catch (_) {
    return null;
  }
}

async function detectChallenges(page) {
  try {
    // Wait for any captcha-related iframe or element to appear
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

    // ── Scan ALL frames (main + nested iframes) ──────────────────────────────
    const frames = page.frames();
    for (const frame of frames) {
      let frameUrl = "";
      try {
        frameUrl = frame.url();
      } catch (_) {}

      // Detect captcha iframes by URL
      if (
        frameUrl.includes("recaptcha/api2/anchor") ||
        frameUrl.includes("recaptcha/enterprise/anchor")
      ) {
        const m = frameUrl.match(/[?&]k=([^&]+)/);
        if (m) {
          const isEnterprise = frameUrl.includes("/enterprise/");
          allFound.push({
            type: isEnterprise ? "recaptcha_v2_enterprise" : "recaptcha_v2",
            siteKey: m[1],
            isInvisible: frameUrl.includes("size=invisible"),
            frameUrl,
          });
        }
        continue;
      }

      if (frameUrl.includes("challenges.cloudflare.com")) {
        const m =
          frameUrl.match(/[?&]sitekey=([^&]+)/) ||
          frameUrl.match(/\/([^/]+)\/?$/);
        const sk = m ? m[1] : null;
        // also try host extraction from path
        let extracted = sk;
        if (!extracted) {
          const p = frameUrl.match(/turnstile\/[^\/]+\/(0x[a-zA-Z0-9_-]+)/);
          if (p) extracted = p[1];
        }
        allFound.push({
          type: "turnstile",
          siteKey: extracted || "iframe-turnstile",
          isIframe: true,
          frameUrl,
        });
        continue;
      }

      if (frameUrl.includes("hcaptcha.com/captcha")) {
        const m = frameUrl.match(/[?&]sitekey=([^&]+)/);
        if (m) allFound.push({ type: "hcaptcha", siteKey: m[1], frameUrl });
        continue;
      }

      // Look inside this frame for elements with data-sitekey
      try {
        const frameFound = await frame
          .evaluate(() => {
            const out = [];

            // CF full challenge
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

            // Turnstile divs
            for (const el of document.querySelectorAll(".cf-turnstile")) {
              const sk = el.getAttribute("data-sitekey");
              if (sk)
                out.push({
                  type: "turnstile",
                  siteKey: sk,
                  action: el.getAttribute("data-action") || null,
                });
            }

            // reCAPTCHA divs
            for (const el of document.querySelectorAll(
              ".g-recaptcha, [data-sitekey]"
            )) {
              if (
                el.classList.contains("cf-turnstile") ||
                el.classList.contains("h-captcha")
              )
                continue;
              const sk = el.getAttribute("data-sitekey");
              if (!sk) continue;
              const isEnterprise =
                !!document.querySelector(
                  'script[src*="recaptcha/enterprise.js"]'
                ) || !!(window.grecaptcha && window.grecaptcha.enterprise);
              out.push({
                type: isEnterprise ? "recaptcha_v2_enterprise" : "recaptcha_v2",
                siteKey: sk,
                isInvisible: el.getAttribute("data-size") === "invisible",
              });
            }

            // hCaptcha divs
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

    // ── Dedup by type:sitekey ─────────────────────────────────────────────
    const seen = new Set();
    return allFound.filter((c) => {
      const key = `${c.type}:${c.siteKey || ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  } catch (err) {
    return [];
  }
}

async function solveCloudflareChallenge(apiKey, page, proxyConfig) {
  await waitForChallengeStable(page, 6000);

  // Find the frame that actually has the challenge form
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
      furl.includes("cdn-cgi/challenge-platform") ||
      furl.includes("__cf_chl_")
    ) {
      const has = await frame
        .evaluate(() => {
          return (
            !!document.querySelector("form#challenge-form") ||
            (document.title || "").includes("Just a moment")
          );
        })
        .catch(() => false);
      if (has) {
        targetFrame = frame;
        targetUrl = furl;
        break;
      }
    }
  }

  const pageUrl = targetUrl;
  console.log(`   CF challenge target: ${pageUrl.slice(0, 80)}`);
  const pageUA = await targetFrame
    .evaluate(() => navigator.userAgent)
    .catch(() => "");
  const pageHtmlB64 = await targetFrame
    .evaluate(() => {
      try {
        return btoa(
          unescape(encodeURIComponent(document.documentElement.outerHTML))
        );
      } catch (_) {
        return btoa(document.documentElement.outerHTML.substring(0, 50000));
      }
    })
    .catch(() => "");

  const capProxy = toCapsolverProxy(proxyConfig);
  if (!capProxy) {
    console.log("   CF challenge requires proxy - skipping AntiCloudflareTask");
    return false;
  }

  const taskPayload = {
    type: "AntiCloudflareTask",
    websiteURL: pageUrl,
    proxy: capProxy,
    userAgent:
      pageUA ||
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  };

  if (pageHtmlB64) taskPayload.html = pageHtmlB64;

  console.log(`   CF task proxy: ${capProxy.replace(/:([^:@]+)@/, ":****@")}`);

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

  const ua = solution.userAgent || pageUA;
  if (ua) {
    await page.setExtraHTTPHeaders({ "user-agent": ua });
  }

  await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await sleep(2000);
  return true;
}

async function solveTurnstile(apiKey, page, captcha, proxyConfig) {
  const pageUrl = page.url();

  // iframe-based turnstile (ziprecruiter, bigjobsite) needs the real sitekey
  // if we only got "iframe-turnstile" we still try with the page URL
  const sitekey =
    captcha.siteKey === "iframe-turnstile"
      ? await safeEvaluate(page, () => {
          const iframes = document.querySelectorAll("iframe");
          for (const f of iframes) {
            const src = f.getAttribute("src") || "";
            const m = src.match(/[?&]sitekey=([^&]+)/);
            if (m) return m[1];
          }
          return null;
        })
      : captcha.siteKey;

  if (!sitekey)
    throw new Error("Could not extract Turnstile sitekey from iframe");

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

  const token = solution.token;

  await safeEvaluate(
    page,
    (token) => {
      // shadow DOM
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

      // regular inputs
      const inputs = document.querySelectorAll(
        'input[name="cf-turnstile-response"], input[name="cf-turnstile-widget-value"]'
      );
      for (const input of inputs) {
        input.value = token;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }

      // inject hidden input if nothing found (iframe style)
      if (inputs.length === 0 && !widget) {
        const hidden = document.createElement("input");
        hidden.type = "hidden";
        hidden.name = "cf-turnstile-response";
        hidden.value = token;
        document.body.appendChild(hidden);
      }

      // fire window.turnstile callback
      if (window.turnstile) {
        try {
          window.turnstile.execute && window.turnstile.execute();
        } catch (_) {}
        try {
          const widgets = document.querySelectorAll(
            "[data-cf-turnstile-initialized]"
          );
          for (const w of widgets) {
            const id = w.getAttribute("data-cf-turnstile-initialized");
            try {
              window.turnstile.reset && window.turnstile.reset(id);
            } catch (_) {}
          }
        } catch (_) {}
      }

      // submit form
      const form = document.querySelector("form");
      if (form) {
        const submitBtn = form.querySelector(
          'button[type="submit"], input[type="submit"]'
        );
        if (submitBtn) submitBtn.click();
        else
          form.dispatchEvent(
            new Event("submit", { bubbles: true, cancelable: true })
          );
      }
    },
    token
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
  // Find which frame actually contains the recaptcha widget
  // (it might be a nested iframe, not the main page)
  let targetFrame = page.mainFrame();
  let targetUrl = page.url();

  for (const frame of page.frames()) {
    let furl = "";
    try {
      furl = frame.url();
    } catch (_) {
      continue;
    }

    // Skip the recaptcha iframes themselves - we need their PARENT
    if (
      furl.includes("recaptcha/api2/anchor") ||
      furl.includes("recaptcha/api2/bframe") ||
      furl.includes("recaptcha/enterprise/anchor") ||
      furl.includes("recaptcha/enterprise/bframe")
    )
      continue;

    // Check if this frame contains the widget
    try {
      const has = await frame
        .evaluate((sk) => {
          return !!document.querySelector(
            `.g-recaptcha[data-sitekey="${sk}"], [data-sitekey="${sk}"]`
          );
        }, captcha.siteKey)
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

  console.log(`   reCAPTCHA target frame: ${targetUrl.slice(0, 80)}`);

  const { taskId } = await capsolverPost(apiKey, "createTask", {
    task: taskPayload,
  });
  const solution = await pollResult(apiKey, taskId);
  if (!solution || !solution.gRecaptchaResponse) {
    throw new Error("No reCAPTCHA token returned");
  }

  // Inject into target frame
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

    const fireCallbacks = (token) => {
      if (window.___grecaptcha_cfg && window.___grecaptcha_cfg.clients) {
        try {
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
          walk(window.___grecaptcha_cfg.clients, 0);
        } catch (_) {}
      }
      if (window.grecaptcha) {
        try {
          const getR = window.grecaptcha.enterprise || window.grecaptcha;
          const widgetIds = Object.keys(
            window.___grecaptcha_cfg?.clients || {}
          );
          for (const id of widgetIds) {
            try {
              getR.execute && getR.execute(parseInt(id));
            } catch (_) {}
          }
        } catch (_) {}
      }
    };
    fireCallbacks(token);

    const form = document.querySelector("form");
    if (form) {
      const submitBtn = form.querySelector(
        'button[type="submit"], input[type="submit"]'
      );
      if (submitBtn) submitBtn.click();
      else form.dispatchEvent(new Event("submit", { bubbles: true }));
    }
  }, solution.gRecaptchaResponse);

  return true;
}

async function solveHCaptcha(apiKey, page, captcha) {
  const pageUrl = page.url();
  const taskPayload = {
    type: "HCaptchaTaskProxyLess",
    websiteURL: pageUrl,
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
        const submitBtn = form.querySelector(
          'button[type="submit"], input[type="submit"]'
        );
        if (submitBtn) submitBtn.click();
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

// Loop until no captchas remain on page (across all frames), max 4 outer rounds.
// Each round: detect → solve everything → wait → re-detect.
async function solveAllCaptchas(
  page,
  capsolverKey,
  captchaEnabled,
  proxyConfig
) {
  if (!captchaEnabled || !capsolverKey) {
    return { solved: false, types: [], error: null };
  }

  let pageUrl;
  try {
    pageUrl = page.url();
  } catch (_) {
    return { solved: false, types: [], error: "page closed" };
  }
  if (!pageUrl || pageUrl === "about:blank") {
    return { solved: false, types: [], error: null };
  }

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
      if (round === 1) {
        return { solved: false, types: [], error: null };
      }
      console.log(`   Round ${round}: page is now clean ✓`);
      break;
    }

    console.log(
      `   Round ${round}: ${
        challenges.length
      } challenge(s) detected: ${challenges.map((c) => c.type).join(", ")}`
    );

    for (const challenge of challenges) {
      let solved = false;
      const PER_CHALLENGE_ATTEMPTS = 2;

      for (
        let attempt = 1;
        attempt <= PER_CHALLENGE_ATTEMPTS && !solved;
        attempt++
      ) {
        try {
          console.log(
            `     Solving ${
              challenge.type
            } (attempt ${attempt}/${PER_CHALLENGE_ATTEMPTS})${
              challenge.siteKey
                ? " sitekey=" + challenge.siteKey.slice(0, 20)
                : ""
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
          } else if (attempt < PER_CHALLENGE_ATTEMPTS) {
            console.log(`     ${challenge.type} still present, retrying...`);
            await sleep(2000);
          }
        } catch (err) {
          console.error(`     Error: ${err.message}`);
          lastError = err.message;
          if (attempt < PER_CHALLENGE_ATTEMPTS) await sleep(2000);
        }
      }

      if (!solved) {
        console.log(`     ${challenge.type} could not be cleared, moving on`);
      }
    }

    // Wait for any post-solve navigation to settle before next round
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
