module.exports = async function pauseMedia(page) {
  await page.evaluate(() => {
    document.querySelectorAll('video, audio').forEach((media) => {
      try {
        media.pause();
      } catch (error) {
        // Ignore media elements that cannot be paused.
      }
    });
  });
};
