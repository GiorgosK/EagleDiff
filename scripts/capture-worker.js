const puppeteer = require('puppeteer-core');
const { buildBrowserLaunchOptions, captureScreenshots } = require('./run');
const { captureErrorDetails } = require('./capture-diagnostics');

process.once('message', async (job) => {
  if (!job || typeof job !== 'object') {
    process.exitCode = 1;
    return;
  }

  let browser = await puppeteer.launch(buildBrowserLaunchOptions(job.config));
  let cancelled = false;
  process.once('SIGTERM', async () => {
    cancelled = true;
    await browser.close().catch(() => {});
    process.exit(1);
  });

  try {
    const options = {
      isCancelled: () => cancelled,
      relaunchBrowser: async () => {
        if (cancelled) throw new Error('Capture worker cancelled.');
        await browser.close().catch(() => {});
        if (cancelled) throw new Error('Capture worker cancelled.');
        browser = await puppeteer.launch(buildBrowserLaunchOptions(job.config));
        return browser;
      },
      workerId: job.workerId,
      parallel: true,
      warningReporter: require('./warnings').createWarningReporter((message, code, context) => {
        if (process.connected) process.send({ type: 'warning', code, message, context });
      }),
      retryReporter: event => {
        if (process.connected) process.send({ type: 'retry', event });
      },
      progressReporter: (event) => {
        if (process.send) {
          process.send({ type: 'progress', ...event, workerId: job.workerId });
        }
      }
    };
    for (const { scenario, viewport } of job.captures) {
      await captureScreenshots(
        browser,
        job.config,
        { scenarios: [scenario], viewports: [viewport] },
        job.actualDir,
        job.baseUrl,
        job.addPara,
        job.command,
        options
      );
    }

    if (process.send) {
      process.send({ type: 'done', workerId: job.workerId });
    }
  } catch (error) {
    if (process.send) {
      process.send({
        type: 'error',
        workerId: job.workerId,
        message: error.message,
        stack: error.stack,
        details: captureErrorDetails(error)
      });
    }
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
});
