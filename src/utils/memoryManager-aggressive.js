const os = require("os");

const MEMORY_THRESHOLD_MB = 6000;
const MEMORY_CRITICAL_MB = 7200;
const GC_INTERVAL_MS = 60000;
const CHECK_INTERVAL_MS = 10000;

let lastGCTime = Date.now();
let memoryWarningIssued = false;

function getMemoryUsageMB() {
  const memUsage = process.memoryUsage();
  return {
    heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
    heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
    rss: Math.round(memUsage.rss / 1024 / 1024),
    external: Math.round(memUsage.external / 1024 / 1024),
  };
}

function forceGC() {
  if (global.gc) {
    global.gc(false);
    lastGCTime = Date.now();
    memoryWarningIssued = false;
    const mem = getMemoryUsageMB();
    console.log(`[MEMORY] GC triggered. Heap: ${mem.heapUsed}/${mem.heapTotal}MB, RSS: ${mem.rss}MB`);
  }
}

function checkMemoryUsage() {
  const mem = getMemoryUsageMB();
  const now = Date.now();

  if (mem.heapUsed > MEMORY_CRITICAL_MB) {
    console.error(`[MEMORY] CRITICAL: Heap ${mem.heapUsed}MB exceeds ${MEMORY_CRITICAL_MB}MB limit!`);
    if (global.gc) {
      console.log("[MEMORY] Emergency GC...");
      global.gc(true);
      const afterGC = getMemoryUsageMB();
      console.log(`[MEMORY] After emergency GC: ${afterGC.heapUsed}MB`);
    }
    return false;
  }

  if (mem.heapUsed > MEMORY_THRESHOLD_MB) {
    if (!memoryWarningIssued) {
      console.warn(`[MEMORY] WARNING: Heap ${mem.heapUsed}MB exceeds ${MEMORY_THRESHOLD_MB}MB threshold`);
      memoryWarningIssued = true;
    }
    if (now - lastGCTime > GC_INTERVAL_MS) {
      forceGC();
    }
    return false;
  }

  memoryWarningIssued = false;
  return true;
}

function startMemoryMonitor() {
  setInterval(() => {
    checkMemoryUsage();
  }, CHECK_INTERVAL_MS);

  console.log(
    `[MEMORY] Monitor started (threshold: ${MEMORY_THRESHOLD_MB}MB, critical: ${MEMORY_CRITICAL_MB}MB)`
  );
}

function getStatus() {
  const mem = getMemoryUsageMB();
  const isHealthy = mem.heapUsed < MEMORY_THRESHOLD_MB;
  const usagePercent = Math.round((mem.heapUsed / mem.heapTotal) * 100);

  return {
    healthy: isHealthy,
    heapUsed: mem.heapUsed,
    heapTotal: mem.heapTotal,
    usagePercent,
    rss: mem.rss,
    external: mem.external,
  };
}

module.exports = {
  startMemoryMonitor,
  checkMemoryUsage,
  forceGC,
  getMemoryUsageMB,
  getStatus,
};