const cron = require("node-cron");
const { refreshAllDueFeeds } = require("./services/feedRefresher");

let isRunning = false;

async function run() {
  if (isRunning) {
    console.log("Previous refresh still running, skipping this tick");
    return;
  }

  isRunning = true;
  const startMem = process.memoryUsage();
  console.log(`Feed refresher started. Heap: ${Math.round(startMem.heapUsed / 1024 / 1024)}MB`);

  try {
    await refreshAllDueFeeds();
  } catch (err) {
    console.error("Refresh error:", err.message);
  } finally {
    isRunning = false;
    if (global.gc) {
      global.gc(true);
    }
    const endMem = process.memoryUsage();
    console.log(`Feed refresher done. Heap: ${Math.round(endMem.heapUsed / 1024 / 1024)}MB`);
  }
}

cron.schedule("*/5 * * * *", () => {
  run().catch(console.error);
});

setInterval(() => {
  const mem = process.memoryUsage();
  const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
  if (heapMB > 1500) {
    console.warn(`[MEMORY] Heap ${heapMB}MB - forcing GC`);
    if (global.gc) global.gc(true);
  }
}, 60000);

run().catch(console.error);
console.log("Feed scheduler started (checks every 5 minutes, memory safe)");