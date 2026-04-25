// const { chromium } = require("playwright");

// const CONFIG = {
//   host: "residential.novaproxy.io",
//   port: 12321,

//   // Set these in PowerShell:
//   // $env:NOVA_USER = "your_nova_username"
//   // $env:NOVA_PASS = "your_nova_password"
//   username: process.env.NOVA_USER || "PUT_YOUR_NOVA_USERNAME_HERE",
//   password: process.env.NOVA_PASS || "PUT_YOUR_NOVA_PASSWORD_HERE",

//   countries: ["US", "DE", "CA"],
//   testsPerCountry: 3,

//   // NovaProxy sticky format:
//   // password_country-us_session-abc123_lifetime-60s
//   stickySessions: true,
//   sessionLifetimeSeconds: 60,

//   headless: true,
//   timeoutMs: 30000,
// };

// function randomSession() {
//   return Math.random().toString(36).substring(2, 12);
// }

// function normalizeCountry(country) {
//   return String(country).trim().toLowerCase();
// }

// function buildNovaPassword(country, session) {
//   const countryCode = normalizeCountry(country);

//   let password = `${CONFIG.password}_country-${countryCode}`;

//   if (CONFIG.stickySessions) {
//     password += `_session-${session}_lifetime-${CONFIG.sessionLifetimeSeconds}s`;
//   }

//   return password;
// }

// function buildProxyConfig(country) {
//   const session = randomSession();
//   const password = buildNovaPassword(country, session);

//   return {
//     server: `http://${CONFIG.host}:${CONFIG.port}`,
//     username: CONFIG.username,
//     password,

//     // Safe debug info. Do not print the real password.
//     debugCountry: country.toUpperCase(),
//     debugSession: session,
//     debugPasswordSuffix: CONFIG.stickySessions
//       ? `_country-${normalizeCountry(country)}_session-${session}_lifetime-${CONFIG.sessionLifetimeSeconds}s`
//       : `_country-${normalizeCountry(country)}`,
//   };
// }

// async function getIpInfo(proxyConfig) {
//   let browser = null;

//   try {
//     browser = await chromium.launch({
//       headless: CONFIG.headless,
//       proxy: {
//         server: proxyConfig.server,
//         username: proxyConfig.username,
//         password: proxyConfig.password,
//       },
//     });

//     const page = await browser.newPage();

//     // One request gives IP + country.
//     // This avoids mismatch problems with rotating proxies.
//     await page.goto("https://ipinfo.io/json", {
//       waitUntil: "domcontentloaded",
//       timeout: CONFIG.timeoutMs,
//     });

//     const body = await page.locator("body").innerText();

//     let data;
//     try {
//       data = JSON.parse(body);
//     } catch {
//       throw new Error(`Could not parse JSON response: ${body.slice(0, 300)}`);
//     }

//     await browser.close();

//     return {
//       ip: data.ip || "",
//       country: data.country || "",
//       city: data.city || "",
//       region: data.region || "",
//       org: data.org || "",
//       timezone: data.timezone || "",
//     };
//   } catch (err) {
//     if (browser) {
//       await browser.close().catch(() => {});
//     }

//     return {
//       error: err.message,
//     };
//   }
// }

// async function runTests() {
//   console.log("=".repeat(70));
//   console.log("NovaProxy Test Script");
//   console.log("=".repeat(70));
//   console.log(`Host: ${CONFIG.host}:${CONFIG.port}`);
//   console.log(`User: ${CONFIG.username}`);
//   console.log(`Countries: ${CONFIG.countries.join(", ")}`);
//   console.log(`Tests per country: ${CONFIG.testsPerCountry}`);
//   console.log(`Sticky sessions: ${CONFIG.stickySessions ? "ON" : "OFF"}`);

//   if (
//     CONFIG.username.includes("PUT_YOUR_NOVA_USERNAME_HERE") ||
//     CONFIG.password.includes("PUT_YOUR_NOVA_PASSWORD_HERE")
//   ) {
//     console.error("");
//     console.error("ERROR: Set your NovaProxy username and password first.");
//     console.error("");
//     console.error("PowerShell example:");
//     console.error('$env:NOVA_USER = "your_nova_username"');
//     console.error('$env:NOVA_PASS = "your_nova_password"');
//     console.error("node novaproxy-test.js");
//     process.exit(1);
//   }

//   const results = {};

//   for (const country of CONFIG.countries) {
//     console.log(`\n--- Testing ${country} ---`);

//     results[country] = {
//       success: 0,
//       fail: 0,
//       countryMatches: 0,
//       ips: new Set(),
//       failures: [],
//     };

//     for (let i = 1; i <= CONFIG.testsPerCountry; i++) {
//       const proxyConfig = buildProxyConfig(country);

//       console.log(`  [${i}/${CONFIG.testsPerCountry}] Trying session...`);
//       console.log(`      Server: ${proxyConfig.server}`);
//       console.log(`      User: ${proxyConfig.username}`);
//       console.log(`      Password suffix: ${proxyConfig.debugPasswordSuffix}`);

//       const result = await getIpInfo(proxyConfig);

//       if (result.error) {
//         console.log(`      FAIL: ${result.error}`);
//         results[country].fail++;
//         results[country].failures.push(result.error);
//         continue;
//       }

//       const expectedCountry = country.toUpperCase();
//       const actualCountry = String(result.country || "").toUpperCase();
//       const countryMatch = actualCountry === expectedCountry;

//       console.log(
//         `      ${countryMatch ? "OK" : "WRONG COUNTRY"} ` +
//           `IP=${result.ip} ` +
//           `Country=${actualCountry} ` +
//           `City=${result.city || "N/A"} ` +
//           `Region=${result.region || "N/A"} ` +
//           `Org=${result.org || "N/A"}`
//       );

//       results[country].success++;
//       results[country].ips.add(result.ip);

//       if (countryMatch) {
//         results[country].countryMatches++;
//       }
//     }
//   }

//   console.log("\n" + "=".repeat(70));
//   console.log("SUMMARY");
//   console.log("=".repeat(70));

//   let totalSuccess = 0;
//   let totalCountryMatches = 0;
//   const totalTests = CONFIG.countries.length * CONFIG.testsPerCountry;

//   for (const [country, r] of Object.entries(results)) {
//     totalSuccess += r.success;
//     totalCountryMatches += r.countryMatches;

//     console.log(
//       `${country}: ` +
//         `${r.success}/${CONFIG.testsPerCountry} succeeded | ` +
//         `${r.countryMatches} matched country | ` +
//         `${r.ips.size} unique IPs`
//     );

//     if (r.failures.length > 0) {
//       const uniqueFailures = [...new Set(r.failures)];
//       for (const failure of uniqueFailures) {
//         console.log(`    Failure: ${failure}`);
//       }
//     }
//   }

//   console.log("");
//   console.log(`Overall success: ${totalSuccess}/${totalTests}`);
//   console.log(`Country matches: ${totalCountryMatches}/${totalTests}`);

//   if (totalSuccess === totalTests && totalCountryMatches === totalTests) {
//     console.log("RESULT: NovaProxy is working correctly for all requested countries.");
//   } else if (totalSuccess === totalTests) {
//     console.log("RESULT: Proxy connects, but some countries did not match.");
//     console.log("Check whether your NovaProxy plan supports those country codes.");
//   } else {
//     console.log("RESULT: Some proxy requests failed.");
//     console.log("Check username, password, active plan, country support, or provider limits.");
//   }
// }

// runTests().catch((err) => {
//   console.error("Fatal error:", err);
//   process.exit(1);
// });


const { chromium } = require("playwright");

const CONFIG = {
  host: "gw.kindproxy.com",
  port: 12000,

  // Do not include -region-us-session-xxx here.
  // Keep the base KindProxy username only.
  //
  // Example:
  // proxyglobal-usPbLx__cr.global
  username: process.env.KP_USER || "proxyglobal-usPbLx__cr.global",

  // Recommended: set this with PowerShell:
  // $env:KP_PASS = "your_real_password"
  password: process.env.KP_PASS || "PUT_YOUR_PASSWORD_HERE",

  countries: ["US", "DE", "CA"],
  testsPerCountry: 3,

  // Sticky sessions make the IP/country check reliable.
  // Without sticky sessions, different requests may rotate to different IPs.
  stickySessions: true,
  sessionTtlMinutes: 10,

  headless: true,
  timeoutMs: 30000,
};

function randomSession() {
  return Math.random().toString(36).substring(2, 12);
}

function normalizeCountry(country) {
  return country.toLowerCase();
}

function replaceCountryInUsername(baseUsername, country) {
  const countryCode = normalizeCountry(country);

  if (baseUsername.includes("__cr.")) {
    return baseUsername.replace(/__cr\.[^;]+/, `__cr.${countryCode}`);
  }

  // Fallback if your dashboard gives a username without __cr.global
  return `${baseUsername}__cr.${countryCode}`;
}

function buildProxyConfig(country) {
  const session = randomSession();

  let username = replaceCountryInUsername(CONFIG.username, country);

  if (CONFIG.stickySessions) {
    username = `${username};sessid.${session};sessttl.${CONFIG.sessionTtlMinutes}`;
  }

  return {
    server: `http://${CONFIG.host}:${CONFIG.port}`,
    username,
    password: CONFIG.password,
    debugUsername: username,
  };
}

async function getIpInfo(proxyConfig) {
  let browser = null;

  try {
    browser = await chromium.launch({
      headless: CONFIG.headless,
      proxy: {
        server: proxyConfig.server,
        username: proxyConfig.username,
        password: proxyConfig.password,
      },
    });

    const page = await browser.newPage();

    // One request gives IP + country, avoiding mismatch from rotating IPs.
    await page.goto("https://ipinfo.io/json", {
      waitUntil: "domcontentloaded",
      timeout: CONFIG.timeoutMs,
    });

    const body = await page.locator("body").innerText();

    let data;
    try {
      data = JSON.parse(body);
    } catch {
      throw new Error(`Could not parse JSON response: ${body.slice(0, 300)}`);
    }

    await browser.close();

    return {
      ip: data.ip || "",
      country: data.country || "",
      city: data.city || "",
      region: data.region || "",
      org: data.org || "",
      timezone: data.timezone || "",
    };
  } catch (err) {
    if (browser) {
      await browser.close().catch(() => {});
    }

    return {
      error: err.message,
    };
  }
}

async function runTests() {
  console.log("=".repeat(70));
  console.log("KindProxy Test Script");
  console.log("=".repeat(70));
  console.log(`Host: ${CONFIG.host}:${CONFIG.port}`);
  console.log(`Base user: ${CONFIG.username}`);
  console.log(`Countries: ${CONFIG.countries.join(", ")}`);
  console.log(`Tests per country: ${CONFIG.testsPerCountry}`);
  console.log(`Sticky sessions: ${CONFIG.stickySessions ? "ON" : "OFF"}`);
  console.log("");

  if (
    CONFIG.host.includes("FILL_ME_IN") ||
    CONFIG.username.includes("FILL_ME_IN") ||
    CONFIG.password.includes("PUT_YOUR_PASSWORD_HERE")
  ) {
    console.error("ERROR: Set your KindProxy password first.");
    console.error("");
    console.error("PowerShell example:");
    console.error('$env:KP_PASS = "your_real_password"');
    console.error("node kindproxy-test.js");
    process.exit(1);
  }

  const results = {};

  for (const country of CONFIG.countries) {
    console.log(`\n--- Testing ${country} ---`);

    results[country] = {
      success: 0,
      fail: 0,
      countryMatches: 0,
      ips: new Set(),
      failures: [],
    };

    for (let i = 1; i <= CONFIG.testsPerCountry; i++) {
      const proxyConfig = buildProxyConfig(country);

      console.log(`  [${i}/${CONFIG.testsPerCountry}] Trying session...`);
      console.log(`      User: ${proxyConfig.debugUsername}`);

      const result = await getIpInfo(proxyConfig);

      if (result.error) {
        console.log(`      FAIL: ${result.error}`);
        results[country].fail++;
        results[country].failures.push(result.error);
        continue;
      }

      const expectedCountry = country.toUpperCase();
      const actualCountry = String(result.country || "").toUpperCase();
      const countryMatch = actualCountry === expectedCountry;

      console.log(
        `      ${countryMatch ? "OK" : "WRONG COUNTRY"} ` +
          `IP=${result.ip} ` +
          `Country=${actualCountry} ` +
          `City=${result.city || "N/A"} ` +
          `Region=${result.region || "N/A"} ` +
          `Org=${result.org || "N/A"}`
      );

      results[country].success++;
      results[country].ips.add(result.ip);

      if (countryMatch) {
        results[country].countryMatches++;
      }
    }
  }

  console.log("\n" + "=".repeat(70));
  console.log("SUMMARY");
  console.log("=".repeat(70));

  let totalSuccess = 0;
  let totalCountryMatches = 0;
  const totalTests = CONFIG.countries.length * CONFIG.testsPerCountry;

  for (const [country, r] of Object.entries(results)) {
    totalSuccess += r.success;
    totalCountryMatches += r.countryMatches;

    console.log(
      `${country}: ` +
        `${r.success}/${CONFIG.testsPerCountry} succeeded | ` +
        `${r.countryMatches} matched country | ` +
        `${r.ips.size} unique IPs`
    );

    if (r.failures.length > 0) {
      const uniqueFailures = [...new Set(r.failures)];
      for (const failure of uniqueFailures) {
        console.log(`    Failure: ${failure}`);
      }
    }
  }

  console.log("");
  console.log(`Overall success: ${totalSuccess}/${totalTests}`);
  console.log(`Country matches: ${totalCountryMatches}/${totalTests}`);

  if (totalSuccess === totalTests && totalCountryMatches === totalTests) {
    console.log("RESULT: KindProxy is working correctly for all requested countries.");
  } else if (totalSuccess === totalTests) {
    console.log("RESULT: Proxy connects, but some countries did not match.");
    console.log("Check whether your KindProxy plan supports those country codes.");
  } else {
    console.log("RESULT: Some proxy requests failed.");
    console.log("Check username format, password, active plan, country support, or provider limits.");
  }
}

runTests().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});