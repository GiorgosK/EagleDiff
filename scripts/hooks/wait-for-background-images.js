module.exports = async function waitForBackgroundImages(page) {
  await page.evaluate(async () => {
    const decodeImage = (img) => {
      if (img.decode) {
        return img.decode().catch(() => {});
      }
      return Promise.resolve();
    };

    const waitForImage = (img) => {
      if (img.complete) {
        return decodeImage(img);
      }

      return new Promise((resolve) => {
        img.addEventListener('load', () => decodeImage(img).then(resolve));
        img.addEventListener('error', resolve);
      });
    };

    const foregroundImages = Array.from(document.images);
    const backgroundImages = [];

    document.querySelectorAll('*').forEach((element) => {
      const backgroundImage = window.getComputedStyle(element).backgroundImage;
      if (!backgroundImage || backgroundImage === 'none') {
        return;
      }

      const matches = backgroundImage.match(/url\((['"]?)(.*?)\1\)/);
      if (!matches || !matches[2]) {
        return;
      }

      const img = new Image();
      img.src = matches[2];
      backgroundImages.push(img);
    });

    await Promise.all([
      ...foregroundImages.map(waitForImage),
      ...backgroundImages.map(waitForImage)
    ]);
  });
};
