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
    // Wait for any captcha iframes to actually render (Turnstile lazy-loads)
    await page
      .waitForFunction(
        () => {
          const ifrs = document.querySelectorAll("iframe");
          for (const f of ifrs) {
            const src = f.getAttribute("src") || "";
            if (
              src.includes("challenges.cloudflare.com") ||
              src.includes("recaptcha") ||
              src.includes("hcaptcha")
            ) {
              return true;
            }
          }
          return !!document.querySelector(
            ".cf-turnstile, .g-recaptcha, .h-captcha, form#challenge-form, [data-sitekey]"
          );
        },
        { timeout: 6000 }
      )
      .catch(() => {});
    await sleep(1500);
    return await page.evaluate(() => {
      const found = [];

      // ── Cloudflare full challenge (JS challenge page) ──────────────────────
      const cfChallengeForm = document.querySelector("form#challenge-form");
      const cfAction = cfChallengeForm
        ? cfChallengeForm.getAttribute("action") || ""
        : "";
      const isCfFullChallenge =
        (document.title || "").includes("Just a moment") ||
        cfAction.includes("__cf_chl_f_tk") ||
        !!document.querySelector(
          "#cf-challenge-running, .cf-challenge-running"
        ) ||
        location.href.includes("cdn-cgi/challenge-platform");
      if (isCfFullChallenge) {
        found.push({ type: "cloudflare_challenge" });
      }

      // ── Turnstile: div-based (.cf-turnstile) ─────────────────────────────
      const turnstileDivs = document.querySelectorAll(".cf-turnstile");
      for (const el of turnstileDivs) {
        const sitekey = el.getAttribute("data-sitekey");
        if (sitekey) {
          found.push({
            type: "turnstile",
            siteKey: sitekey,
            action: el.getAttribute("data-action") || null,
          });
        }
      }

      // ── Turnstile: iframe-based (ziprecruiter, bigjobsite style) ──────────
      const iframes = document.querySelectorAll("iframe");
      for (const iframe of iframes) {
        const src = iframe.getAttribute("src") || "";
        if (
          src.includes("challenges.cloudflare.com") ||
          src.includes("cloudflare.com/cdn-cgi/challenge")
        ) {
          const urlMatch = src.match(/[?&]sitekey=([^&]+)/);
          const sitekey = urlMatch ? urlMatch[1] : "iframe-turnstile";
          const alreadyAdded = found.some((f) => f.type === "turnstile");
          if (!alreadyAdded) {
            found.push({ type: "turnstile", siteKey: sitekey, isIframe: true });
          }
        }
      }

      // ── Turnstile: script-injected without class ───────────────────────────
      const scripts = document.querySelectorAll("script[src]");
      for (const s of scripts) {
        if (
          s.src.includes("challenges.cloudflare.com") ||
          s.src.includes("turnstile")
        ) {
          const els = document.querySelectorAll("[data-sitekey]");
          for (const el of els) {
            if (
              !el.classList.contains("g-recaptcha") &&
              !el.classList.contains("h-captcha")
            ) {
              const sitekey = el.getAttribute("data-sitekey");
              if (sitekey && !found.some((f) => f.siteKey === sitekey)) {
                found.push({
                  type: "turnstile",
                  siteKey: sitekey,
                  action: el.getAttribute("data-action") || null,
                });
              }
            }
          }
        }
      }

      // ── reCAPTCHA v2 / Enterprise ─────────────────────────────────────────
      const recaptchaEls = document.querySelectorAll(
        ".g-recaptcha, [data-sitekey]"
      );
      for (const el of recaptchaEls) {
        if (el.classList.contains("cf-turnstile")) continue;
        const sitekey = el.getAttribute("data-sitekey");
        if (!sitekey) continue;
        if (found.some((f) => f.siteKey === sitekey)) continue;

        const isInvisible = el.getAttribute("data-size") === "invisible";
        const isEnterprise =
          !!document.querySelector('script[src*="recaptcha/enterprise.js"]') ||
          !!window.grecaptcha?.enterprise;

        found.push({
          type: isEnterprise ? "recaptcha_v2_enterprise" : "recaptcha_v2",
          siteKey: sitekey,
          isInvisible,
        });
      }

      // ── hCaptcha ──────────────────────────────────────────────────────────
      const hcaptchaEls = document.querySelectorAll(".h-captcha");
      for (const el of hcaptchaEls) {
        const sitekey = el.getAttribute("data-sitekey");
        if (sitekey) found.push({ type: "hcaptcha", siteKey: sitekey });
      }

      // ── Dedup ─────────────────────────────────────────────────────────────
      const seen = new Set();
      return found.filter((c) => {
        const key = `${c.type}:${c.siteKey || ""}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    });
  } catch (err) {
    return [];
  }
}

async function solveCloudflareChallenge(apiKey, page, proxyConfig) {
  await waitForChallengeStable(page, 6000);
  const pageUrl = page.url();
  const pageUA = await safeEvaluate(page, () => navigator.userAgent).catch(
    () => ""
  );
  const pageHtmlB64 = await safeEvaluate(page, () => {
    try {
      return btoa(
        unescape(encodeURIComponent(document.documentElement.outerHTML))
      );
    } catch (_) {
      return btoa(document.documentElement.outerHTML.substring(0, 50000));
    }
  }).catch(() => "");

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
  const pageUrl = page.url();
  const taskType = isEnterprise
    ? "ReCaptchaV2EnterpriseTaskProxyLess"
    : "ReCaptchaV2TaskProxyLess";

  const taskPayload = {
    type: taskType,
    websiteURL: pageUrl,
    websiteKey: captcha.siteKey,
    isInvisible: !!captcha.isInvisible,
  };

  const { taskId } = await capsolverPost(apiKey, "createTask", {
    task: taskPayload,
  });
  const solution = await pollResult(apiKey, taskId);
  if (!solution || !solution.gRecaptchaResponse) {
    throw new Error("No reCAPTCHA token returned");
  }

  await safeEvaluate(
    page,
    (token) => {
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
    },
    solution.gRecaptchaResponse
  );

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

async function solveAllCaptchas(
  page,
  capsolverKey,
  captchaEnabled,
  proxyConfig
) {
  if (!captchaEnabled || !capsolverKey) {
    return { solved: false, types: [], error: null };
  }

  try {
    await page
      .waitForFunction(
        () =>
          document.querySelector(
            ".cf-turnstile, .h-captcha, .g-recaptcha, form#challenge-form, [data-sitekey]"
          ) !== null,
        { timeout: 8000 }
      )
      .catch(() => {});
  } catch (_) {}

  const pageUrl = page.url();
  if (!pageUrl || pageUrl === "about:blank") {
    return { solved: false, types: [], error: null };
  }

  const challenges = await detectChallenges(page);
  if (!challenges.length) {
    return { solved: false, types: [], error: null };
  }

  console.log(
    `   Detected ${challenges.length} challenge(s): ${challenges
      .map((c) => c.type)
      .join(", ")}`
  );

  const solvedTypes = [];
  let lastError = null;

  for (const challenge of challenges) {
    let solved = false;
    let attempts = 0;
    const MAX_ATTEMPTS = 2;

    while (!solved && attempts < MAX_ATTEMPTS) {
      attempts++;
      try {
        console.log(
          `   Solving (attempt ${attempts}/${MAX_ATTEMPTS}): ${challenge.type}${
            challenge.siteKey
              ? " (sitekey: " + challenge.siteKey.slice(0, 20) + "...)"
              : ""
          }`
        );

        if (challenge.type === "cloudflare_challenge") {
          await solveCloudflareChallenge(capsolverKey, page, proxyConfig);
        } else if (challenge.type === "turnstile") {
          await solveTurnstile(capsolverKey, page, challenge, proxyConfig);
        } else if (challenge.type === "recaptcha_v2") {
          await solveRecaptchaV2(
            capsolverKey,
            page,
            challenge,
            proxyConfig,
            false
          );
        } else if (challenge.type === "recaptcha_v2_enterprise") {
          await solveRecaptchaV2(
            capsolverKey,
            page,
            challenge,
            proxyConfig,
            true
          );
        } else if (challenge.type === "hcaptcha") {
          await solveHCaptcha(capsolverKey, page, challenge);
        }

        await sleep(3000);

        // Verify it actually worked by checking if challenge is gone
        const stillThere = await detectChallenges(page);
        const stillSameChallenge = stillThere.some(
          (c) => c.type === challenge.type && c.siteKey === challenge.siteKey
        );

        if (!stillSameChallenge) {
          solved = true;
          solvedTypes.push(challenge.type);
          console.log(`   ✓ ${challenge.type} solved successfully`);
        } else if (attempts < MAX_ATTEMPTS) {
          console.log(
            `   ${challenge.type} still present after solve, retrying...`
          );
          await sleep(2000);
        } else {
          console.log(
            `   ${challenge.type} could not be solved after ${MAX_ATTEMPTS} attempts`
          );
          lastError = `${challenge.type} solve verification failed`;
        }
      } catch (err) {
        console.error(
          `   Attempt ${attempts} failed for ${challenge.type}: ${err.message}`
        );
        lastError = err.message;
        if (attempts < MAX_ATTEMPTS) await sleep(3000);
      }
    }
  }

  return {
    solved: solvedTypes.length > 0,
    types: solvedTypes,
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
