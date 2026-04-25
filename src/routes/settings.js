const express = require("express");
const db = require("../db/init");
const router = express.Router();

const getSettings = () => {
  const rows = db.prepare("SELECT key, value FROM settings").all();
  return rows.reduce((acc, row) => {
    acc[row.key] = row.value;
    return acc;
  }, {});
};

const getBool = (settings, key, defaultValue = false) => {
  if (settings[key] === undefined) return defaultValue;
  return settings[key] === "true";
};

const boolToString = (value) => {
  return value === true || value === "true" ? "true" : "false";
};

router.get("/", (req, res) => {
  try {
    const settings = getSettings();

    res.json({
      webshare_api_key: settings.webshare_api_key || "",
      capsolver_key: settings.capsolver_key || "",
      captcha_enabled: getBool(settings, "captcha_enabled", false),
      headless_mode: getBool(settings, "headless_mode", true),
      admin_username: settings.admin_username || "admin",
      admin_password: settings.admin_password || "password",
      timezone: settings.timezone || "UTC",
      NovaProxyHost: settings.NovaProxyHost || "",
      NovaProxyPort: settings.NovaProxyPort || "",
      NovaProxyUsername: settings.NovaProxyUsername || "",
      NovaProxyPassword: settings.NovaProxyPassword || "",
      IsNovaProxy: getBool(settings, "IsNovaProxy", false),
      KindProxyHost: settings.KindProxyHost || "",
      KindProxyPort: settings.KindProxyPort || "",
      KindProxyUsername: settings.KindProxyUsername || "",
      KindProxyPassword: settings.KindProxyPassword || "",
      isKindProxy: getBool(settings, "isKindProxy", false),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/", (req, res) => {
  try {
    const {
      webshare_api_key,
      capsolver_key,
      captcha_enabled,
      headless_mode,
      admin_username,
      admin_password,
      timezone,
      NovaProxyHost,
      NovaProxyPort,
      NovaProxyUsername,
      NovaProxyPassword,
      IsNovaProxy,
      KindProxyHost,
      KindProxyPort,
      KindProxyUsername,
      KindProxyPassword,
      isKindProxy,
    } = req.body;

    const stmt = db.prepare(
      "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)"
    );

    if (webshare_api_key !== undefined) {
      stmt.run("webshare_api_key", webshare_api_key);
    }

    if (capsolver_key !== undefined) {
      stmt.run("capsolver_key", capsolver_key);
    }

    if (captcha_enabled !== undefined) {
      stmt.run("captcha_enabled", boolToString(captcha_enabled));
    }

    if (headless_mode !== undefined) {
      stmt.run("headless_mode", boolToString(headless_mode));
    }

    if (admin_username !== undefined) {
      stmt.run("admin_username", admin_username);
    }

    if (admin_password !== undefined && admin_password !== "") {
      stmt.run("admin_password", admin_password);
    }

    if (timezone !== undefined) {
      stmt.run("timezone", timezone);
    }

    if (NovaProxyHost !== undefined) {
      stmt.run("NovaProxyHost", NovaProxyHost);
    }

    if (NovaProxyPort !== undefined) {
      stmt.run("NovaProxyPort", NovaProxyPort);
    }

    if (NovaProxyUsername !== undefined) {
      stmt.run("NovaProxyUsername", NovaProxyUsername);
    }

    if (NovaProxyPassword !== undefined) {
      stmt.run("NovaProxyPassword", NovaProxyPassword);
    }

    if (IsNovaProxy !== undefined) {
      stmt.run("IsNovaProxy", boolToString(IsNovaProxy));
    }

    if (KindProxyHost !== undefined) {
      stmt.run("KindProxyHost", KindProxyHost);
    }

    if (KindProxyPort !== undefined) {
      stmt.run("KindProxyPort", KindProxyPort);
    }

    if (KindProxyUsername !== undefined) {
      stmt.run("KindProxyUsername", KindProxyUsername);
    }

    if (KindProxyPassword !== undefined) {
      stmt.run("KindProxyPassword", KindProxyPassword);
    }

    if (isKindProxy !== undefined) {
      stmt.run("isKindProxy", boolToString(isKindProxy));
    }

    res.json({ message: "Settings updated" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
