const desktopProfiles = [
  {
    type: "Desktop Chrome 120",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1920, height: 1080 },
  },
  {
    type: "Desktop Chrome 119",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
    viewport: { width: 1366, height: 768 },
  },
  {
    type: "Desktop Chrome 118",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36",
    viewport: { width: 1536, height: 864 },
  },
  {
    type: "Desktop Chrome 117",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 },
  },
  {
    type: "Desktop Chrome 116",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 720 },
  },
  {
    type: "Desktop Chrome 115",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
    viewport: { width: 1920, height: 1080 },
  },
  {
    type: "Desktop Chrome 114",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
    viewport: { width: 1366, height: 768 },
  },
  {
    type: "Desktop Chrome 113",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Safari/537.36",
    viewport: { width: 1536, height: 864 },
  },
  {
    type: "Desktop Chrome 112",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 },
  },
  {
    type: "Desktop Chrome 111",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 720 },
  },
];

const mobileProfiles = [
  {
    type: "Mobile Chrome 120 (Pixel 7)",
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    viewport: { width: 412, height: 915 },
  },
  {
    type: "Mobile Chrome 119 (Samsung S22)",
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; SM-S901B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36",
    viewport: { width: 360, height: 780 },
  },
  {
    type: "Mobile Chrome 118 (iPhone 14)",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/118.0.0.0 Mobile/15E148 Safari/604.1",
    viewport: { width: 390, height: 844 },
  },
  {
    type: "Mobile Chrome 117 (OnePlus 9)",
    userAgent:
      "Mozilla/5.0 (Linux; Android 12; LE2117) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Mobile Safari/537.36",
    viewport: { width: 412, height: 915 },
  },
  {
    type: "Mobile Chrome 116 (Xiaomi 12)",
    userAgent:
      "Mozilla/5.0 (Linux; Android 12; 2201123G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36",
    viewport: { width: 393, height: 873 },
  },
  {
    type: "Mobile Chrome 115 (Pixel 6)",
    userAgent:
      "Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Mobile Safari/537.36",
    viewport: { width: 412, height: 915 },
  },
  {
    type: "Mobile Chrome 114 (Samsung S21)",
    userAgent:
      "Mozilla/5.0 (Linux; Android 11; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36",
    viewport: { width: 360, height: 780 },
  },
  {
    type: "Mobile Chrome 113 (iPhone 13)",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/113.0.0.0 Mobile/15E148 Safari/604.1",
    viewport: { width: 390, height: 844 },
  },
  {
    type: "Mobile Chrome 112 (Motorola Edge)",
    userAgent:
      "Mozilla/5.0 (Linux; Android 11; motorola edge) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36",
    viewport: { width: 412, height: 915 },
  },
  {
    type: "Mobile Chrome 111 (Huawei P30)",
    userAgent:
      "Mozilla/5.0 (Linux; Android 10; ELE-L29) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Mobile Safari/537.36",
    viewport: { width: 360, height: 780 },
  },
];

function getRandomDesktopProfile() {
  return desktopProfiles[Math.floor(Math.random() * desktopProfiles.length)];
}

function getRandomMobileProfile() {
  return mobileProfiles[Math.floor(Math.random() * mobileProfiles.length)];
}

function getRandomProfile() {
  const isDesktop = Math.random() < 0.5;
  return isDesktop ? getRandomDesktopProfile() : getRandomMobileProfile();
}

module.exports = {
  desktopProfiles,
  mobileProfiles,
  getRandomDesktopProfile,
  getRandomMobileProfile,
  getRandomProfile,
};
