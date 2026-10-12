module.exports = async function addParagraph(page, context) {
  if (!context.scenario.addParagraph) {
    return;
  }

  const paragraphText = context.scenario.addParagraphText || 'Eaglediff injected paragraph';
  const containerSelector = context.scenario.addParagraphSelector || '#eaglediff-paragraph';

  await page.evaluate(
    ({ targetSelector, text, id }) => {
      const target = document.querySelector(targetSelector) || document.body;
      const wrapper = document.createElement('div');
      wrapper.id = id;
      wrapper.style.margin = '24px 0';
      wrapper.style.padding = '16px';
      wrapper.style.border = '2px dashed #c62828';
      wrapper.style.background = '#fff4f4';
      wrapper.style.color = '#7f1d1d';

      const paragraph = document.createElement('p');
      paragraph.textContent = text;
      paragraph.style.margin = '0';

      wrapper.appendChild(paragraph);
      target.appendChild(wrapper);
    },
    {
      targetSelector: context.scenario.addParagraphTarget || 'main',
      text: paragraphText,
      id: containerSelector.replace(/^#/, '')
    }
  );
};
