const { chromium } = require('rebrowser-playwright');
// const stealth = require('playwright-extra-plugin-stealth');

// Use the stealth plugin
// chromium.use(stealth());

// A list of real-world User-Agent strings
const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
];

(async () => {
  const browser = await chromium.launch({ headless: false }); // Use false for better stealth
  const context = await browser.newContext({
    userAgent: userAgents[Math.floor(Math.random() * userAgents.length)]
  });
  const page = await context.newPage();
  await page.goto('https://www.quicktojobs.com/marketplace/partnerclicks/Job-Nr.%3AQTJ67008877/354'); // Replace with your target URL
  // ... your automation logic
//   await browser.close();
})();