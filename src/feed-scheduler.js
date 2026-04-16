const cron = require('node-cron');
const { refreshAllDueFeeds } = require('./services/feedRefresher');

async function run() {
  console.log('Feed refresher checking due feeds...');
  await refreshAllDueFeeds();
}

cron.schedule('*/5 * * * *', () => {
  run().catch(console.error);
});

run().catch(console.error);
console.log('Feed refresher started (checks every 5 minutes)');