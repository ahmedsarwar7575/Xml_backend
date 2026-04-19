const db = require("../db/init");
const moment = require("moment-timezone");

let cachedTimezone = null;
let cacheTime = 0;

function getTimezone() {
  const now = Date.now();
  if (cachedTimezone && now - cacheTime < 60000) return cachedTimezone;
  const row = db
    .prepare("SELECT value FROM settings WHERE key = 'timezone'")
    .get();
  cachedTimezone = row ? row.value : "UTC";
  cacheTime = now;
  return cachedTimezone;
}

function nowInTimezone() {
  const tz = getTimezone();
  return moment.tz(tz).toDate();
}

function convertToTimezone(date, tz) {
  return moment(date).tz(tz).toDate();
}

module.exports = { getTimezone, nowInTimezone, convertToTimezone };
