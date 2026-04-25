# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the System

The system has four processes that must run concurrently:

```bash
npm run all          # starts all four processes via concurrently
```

Or individually:

```bash
npm start            # Express API server (port 3000)
npm run worker       # Playwright click worker (processes Bull jobs)
npm run scheduler    # Click scheduler (cron every 1 min, pushes jobs to Bull)
npm run feed         # Feed refresher (cron every 2 min, re-fetches XML feeds)
```

**Prerequisites**: Redis must be running locally on port 6379 (or set `REDIS_HOST`/`REDIS_PORT` in `.env`). SQLite database is auto-created at `data/clicker.db` on first run.

## Debugging

```bash
node checkQueue.js   # inspect Bull queue counts (waiting/active/delayed)
node webshare.js     # test proxy auth formats against NovaProxy
```

## Architecture

### What this system does

An automated click farm: it ingests XML job-listing feeds, then simulates human browser visits to URLs in those feeds — routed through geo-targeted proxies — at a scheduled rate per campaign.

### Process responsibilities

| Process | File | Responsibility |
|---|---|---|
| API | `src/server.js` | REST CRUD for feeds, campaigns, proxies, clicks, settings, auth |
| Scheduler | `src/scheduler.js` | Every minute: distributes a campaign's remaining daily clicks as delayed Bull jobs across the active time window |
| Worker | `src/workers/clickWorker.js` | Processes one Bull job at a time: picks proxy → launches Playwright → navigates URL → solves captcha → records result |
| Feed refresher | `src/feed-scheduler.js` | Every 2 min: re-parses feeds whose `refresh_interval_hours` has elapsed |

### Data model (SQLite)

`feeds` → `feed_items` (1:many, cascade delete)
`feeds` → `campaigns` (1:many, cascade delete)
`campaigns` → `proxies` (1:many, cascade delete)
`campaigns` + `feed_items` → `clicks` (junction, FK nullified on item delete)

Schema is defined and auto-migrated in `src/db/init.js`. Additive migrations are done with try/catch `ALTER TABLE` at the bottom of that file.

### Click execution flow

1. Scheduler distributes `daily_click_target - clicks_today` jobs with random delays into the Bull queue, guarded by a Redis lock (`schedule_lock:<campaign_id>:<date>`) to prevent duplicate generation within the same day.
2. Worker claims a `feed_item` by setting `locked_until = now + 10 min` (prevents concurrent workers from double-clicking the same item).
3. Worker resolves a proxy: Webshare API first (filtered to exact country code, IP-verified via `api.ipify.org`), then manual proxies from DB, then direct connection. Rejects IPs already used today for that campaign.
4. Playwright launches with the selected proxy + a random browser profile (desktop/mobile user-agent + viewport from `src/utils/browserProfiles.js`).
5. After navigation: detects and solves captchas via Capsolver if enabled (Turnstile, hCaptcha, reCaptcha), then smooth-scrolls the page.
6. Click result (success/failure, final URL, IP, country, screenshot path) is inserted into `clicks`. `locked_until` is cleared on the item.

### Keyword rotation

Keywords on a campaign are cycled round-robin based on `total_clicks_today % keywords.length`. If no items match the active keyword, falls back to any available item.

### Feed parsing

`src/services/feedParser.js` has two parsers:
- **`parseXmlStream`** (SAX, streaming): used for URL fetches and large file uploads — constant memory, handles 2 GB+ feeds. Expects `<job>` elements with `<TITLE>`, `<DESCRIPTION>`, `<URL>`, `<COUNTRY>` children.
- **`parseXml`** (fast-xml-parser, in-memory): fallback for small uploads; handles RSS 2.0, Atom, RDF, and the `<source><job>` format.

### Settings

Runtime-configurable via `settings` table (key/value). Keys: `webshare_api_key`, `capsolver_key`, `captcha_enabled`, `headless_mode`, `timezone`. The worker reads these fresh from DB on each job — no restart needed to change behavior.

### Timezone

All `now` comparisons in the scheduler and worker go through `nowInTimezone()` (`src/utils/timezone.js`), which reads the `timezone` setting (cached 60 s) and returns a `moment-timezone` Date. Campaign `start_time`/`end_time` are HH:MM strings interpreted in this timezone.

### Sample XML feed endpoint

`GET /data.xml` serves a static sample feed (two German job listings) from `Xml/xml.js` — useful for testing feed ingestion without an external URL.
