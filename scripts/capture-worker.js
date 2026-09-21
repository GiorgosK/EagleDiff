const puppeteer = require('puppeteer-core');
const { buildBrowserLaunchOptions, captureScreenshots } = require('./run');

process.once('message', async (job) => {
  if (!job || typeof job !== 'object') {
    process.exitCode = 1;
    return;
  }

  const browser = await puppeteer.launch(buildBrowserLaunchOptions(job.config));
  process.once('SIGTERM', async () => {
    await browser.close().catch(() => {});
    process.exit(1);
  });

  try {
    await captureScreenshots(
      browser,
      job.config,
      job.scenarios,
      job.actualDir,
      job.baseUrl,
      job.addPara,
      job.command,
      {
        workerId: job.workerId,
        parallel: true,
        warningReporter: require('./warnings').createWarningReporter((message, code) => {
          if (process.connected) process.send({ type: 'warning', code, message });
        }),
        progressReporter: (event) => {
          if (process.send) {
            process.send({
              type: 'progress',
              ...event,
              workerId: job.workerId
            });
          }
        }
      }
    );

    if (process.send) {
      process.send({ type: 'done', workerId: job.workerId });
    }
  } catch (error) {
    if (process.send) {
      process.send({
        type: 'error',
        workerId: job.workerId,
        message: error.message,
        stack: error.stack
      });
    }
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
});
