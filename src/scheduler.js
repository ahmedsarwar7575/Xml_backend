require("dotenv").config();
const cron = require("node-cron");
const db = require("./db/init");
const clickQueue = require("./queue/clickQueue");
const redis = require("./config/redis");
const { nowInTimezone } = require("./utils/timezone");

function distributeClicks(
  totalClicks,
  startTime,
  endTime,
  minInterval,
  maxInterval,
  hourlyLimit = 0
) {
  const start = new Date(startTime);
  const end = new Date(endTime);
  const totalSeconds = (end - start) / 1000;
  const avgInterval = totalSeconds / totalClicks;
  const timestamps = [];

  if (hourlyLimit > 0) {
    const hourBuckets = new Map();
    let currentHour = new Date(start);
    while (currentHour < end) {
      const hourStart = new Date(currentHour);
      hourStart.setMinutes(0, 0, 0);
      const hourEnd = new Date(hourStart);
      hourEnd.setHours(hourStart.getHours() + 1);
      const cap = Math.min(totalClicks, hourlyLimit);
      hourBuckets.set(hourStart.getTime(), cap);
      currentHour = hourEnd;
    }
    let remaining = totalClicks;
    let current = start.getTime();
    while (remaining > 0 && current < end.getTime()) {
      const hourStart = new Date(current);
      hourStart.setMinutes(0, 0, 0);
      const hourEnd = new Date(hourStart);
      hourEnd.setHours(hourStart.getHours() + 1);
      const cap = hourBuckets.get(hourStart.getTime()) || 0;
      let clicksInThisHour = Math.min(remaining, cap);
      if (clicksInThisHour <= 0) {
        current = hourEnd.getTime();
        continue;
      }
      const hourDuration =
        Math.min(end.getTime(), hourEnd.getTime()) -
        Math.max(start.getTime(), current);
      const interval = hourDuration / clicksInThisHour;
      for (let i = 0; i < clicksInThisHour; i++) {
        const offset = interval * (i + 0.5);
        let ts = new Date(current + offset);
        if (ts > end) break;
        timestamps.push(ts);
      }
      remaining -= clicksInThisHour;
      current = hourEnd.getTime();
    }
  } else {
    let current = start.getTime();
    for (let i = 0; i < totalClicks; i++) {
      let interval = avgInterval;
      if (minInterval && maxInterval) {
        interval = minInterval + Math.random() * (maxInterval - minInterval);
      }
      current += interval * 1000;
      if (current > end.getTime()) break;
      timestamps.push(new Date(current));
    }
  }
  return timestamps;
}

async function generateScheduleForCampaign(campaign) {
  const now = nowInTimezone();
  const startDateTime = new Date(now);
  const [startHour, startMinute] = campaign.start_time.split(":");
  startDateTime.setHours(parseInt(startHour), parseInt(startMinute), 0, 0);
  const endDateTime = new Date(now);
  const [endHour, endMinute] = campaign.end_time.split(":");
  endDateTime.setHours(parseInt(endHour), parseInt(endMinute), 0, 0);

  // If we are before the start time, do nothing
  if (now < startDateTime) return;
  // If we are after the end time, do nothing
  if (now > endDateTime) return;

  // Use a lock key that expires after 2 hours (prevents duplicate generation only during the window)
  const lockKey = `schedule_lock:${campaign.id}:${
    startDateTime.toISOString().split("T")[0]
  }`;
  const locked = await redis.set(lockKey, "1", "EX", 7200, "NX"); // 2 hour expiry
  if (!locked) {
    console.log(
      `Schedule already generated for campaign ${campaign.id} on ${
        startDateTime.toISOString().split("T")[0]
      }`
    );
    return;
  }

  // Calculate remaining clicks for today (from startDateTime to endDateTime)
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);
  const clicksToday = db
    .prepare(
      `
    SELECT COUNT(*) as count FROM clicks
    WHERE campaign_id = ? AND timestamp BETWEEN ? AND ?
  `
    )
    .get(campaign.id, todayStart.toISOString(), todayEnd.toISOString()).count;
  const remaining = Math.max(0, campaign.daily_click_target - clicksToday);
  if (remaining === 0) return;

  const startEffective = now > startDateTime ? now : startDateTime;
  const timestamps = distributeClicks(
    remaining,
    startEffective,
    endDateTime,
    campaign.click_interval_min,
    campaign.click_interval_max,
    campaign.hourly_click_limit || 0
  );

  for (const ts of timestamps) {
    const delay = Math.max(0, ts - now);
    const uniqueId = `${ts.getTime()}-${Math.random()
      .toString(36)
      .substr(2, 6)}`;
    if (delay > 0) {
      await clickQueue.add(
        { campaignId: campaign.id, scheduledTime: ts.toISOString() },
        { delay, jobId: `click-${campaign.id}-${uniqueId}` }
      );
    } else {
      await clickQueue.add(
        { campaignId: campaign.id, scheduledTime: ts.toISOString() },
        { jobId: `click-${campaign.id}-${uniqueId}` }
      );
    }
  }
  console.log(`Campaign ${campaign.id}: added ${timestamps.length} jobs`);
}

async function runScheduler() {
  const campaigns = db
    .prepare(`SELECT * FROM campaigns WHERE status = 1`)
    .all();
  for (const campaign of campaigns) {
    await generateScheduleForCampaign(campaign);
  }
  console.log(`Scheduler run at ${nowInTimezone().toISOString()}`);
}

cron.schedule("* * * * *", () => {
  runScheduler().catch(console.error);
});
runScheduler().catch(console.error);
console.log(
  "Scheduler started: only generates jobs when current time is within campaign window"
);
