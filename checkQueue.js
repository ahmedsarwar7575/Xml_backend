const clickQueue = require('./src/queue/clickQueue');

async function check() {
  const counts = await clickQueue.getJobCounts();
  console.log('Queue counts:', counts);
  const jobs = await clickQueue.getJobs(['waiting', 'active', 'delayed']);
  console.log(`Waiting: ${jobs.filter(j => j.name === 'waiting').length}`);
  console.log(`Delayed: ${jobs.filter(j => j.name === 'delayed').length}`);
  process.exit();
}
check();