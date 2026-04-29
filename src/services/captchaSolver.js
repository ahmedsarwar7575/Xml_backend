const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    return await page.evaluate(() => {
      const found = [];

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

      const turnstileEls = document.querySelectorAll(
        ".cf-turnstile, [data-sitekey][data-action]"
      );
      for (const el of turnstileEls) {
        const sitekey = el.getAttribute("data-sitekey");
        if (sitekey) {
          found.push({
            type: "turnstile",
            siteKey: sitekey,
            action: el.getAttribute("data-action") || null,
          });
        }
      }

      const recaptchaEls = document.querySelectorAll(
        ".g-recaptcha, [data-sitekey]"
      );
      for (const el of recaptchaEls) {
        if (el.classList.contains("cf-turnstile")) continue;
        const sitekey = el.getAttribute("data-sitekey");
        if (!sitekey) continue;

        const isInvisible = el.getAttribute("data-size") === "invisible";
        const isEnterprise =
          !!document.querySelector('script[src*="recaptcha/enterprise.js"]') ||
          !!window.grecaptcha?.enterprise;

        let kind = "recaptcha_v2";
        if (isEnterprise) kind = "recaptcha_v2_enterprise";

        found.push({
          type: kind,
          siteKey: sitekey,
          isInvisible,
        });
      }

      const hcaptchaEls = document.querySelectorAll(".h-captcha");
      for (const el of hcaptchaEls) {
        const sitekey = el.getAttribute("data-sitekey");
        if (sitekey) {
          found.push({ type: "hcaptcha", siteKey: sitekey });
        }
      }

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
  const pageUrl = page.url();
  const pageUA = await page.evaluate(() => navigator.userAgent).catch(() => "");
  const pageHtmlB64 = await page
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
  const taskPayload = {
    type: "AntiTurnstileTaskProxyLess",
    websiteURL: pageUrl,
    websiteKey: captcha.siteKey,
  };
  if (captcha.action) {
    taskPayload.metadata = { action: captcha.action };
  }

  const { taskId } = await capsolverPost(apiKey, "createTask", {
    task: taskPayload,
  });
  const solution = await pollResult(apiKey, taskId);
  if (!solution || !solution.token)
    throw new Error("No turnstile token returned");

  await page.evaluate((token) => {
    const widget = document.querySelector(".cf-turnstile");
    if (widget && widget.shadowRoot) {
      const input = widget.shadowRoot.querySelector(
        'input[name="cf-turnstile-response"]'
      );
      if (input) input.value = token;
    }
    const inputs = document.querySelectorAll(
      'input[name="cf-turnstile-response"]'
    );
    for (const input of inputs) input.value = token;

    if (window.turnstile && typeof window.turnstile.execute === "function") {
      try {
        window.turnstile.execute();
      } catch (_) {}
    }

    const form = document.querySelector("form");
    if (form) {
      const submitBtn = form.querySelector(
        'button[type="submit"], input[type="submit"]'
      );
      if (submitBtn) submitBtn.click();
      else form.dispatchEvent(new Event("submit", { bubbles: true }));
    }
  }, solution.token);

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

  await page.evaluate((token) => {
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

  await page.evaluate((token) => {
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
  }, solution.gRecaptchaResponse);

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
    try {
      console.log(
        `   Solving: ${challenge.type}${
          challenge.siteKey
            ? " (sitekey: " + challenge.siteKey.slice(0, 20) + "...)"
            : ""
        }`
      );

      if (challenge.type === "cloudflare_challenge") {
        await solveCloudflareChallenge(capsolverKey, page, proxyConfig);
        solvedTypes.push("cloudflare_challenge");
      } else if (challenge.type === "turnstile") {
        await solveTurnstile(capsolverKey, page, challenge, proxyConfig);
        solvedTypes.push("turnstile");
      } else if (challenge.type === "recaptcha_v2") {
        await solveRecaptchaV2(
          capsolverKey,
          page,
          challenge,
          proxyConfig,
          false
        );
        solvedTypes.push("recaptcha_v2");
      } else if (challenge.type === "recaptcha_v2_enterprise") {
        await solveRecaptchaV2(
          capsolverKey,
          page,
          challenge,
          proxyConfig,
          true
        );
        solvedTypes.push("recaptcha_v2_enterprise");
      } else if (challenge.type === "hcaptcha") {
        await solveHCaptcha(capsolverKey, page, challenge);
        solvedTypes.push("hcaptcha");
      }

      await sleep(2000);
    } catch (err) {
      console.error(`   Failed to solve ${challenge.type}: ${err.message}`);
      lastError = err.message;
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
