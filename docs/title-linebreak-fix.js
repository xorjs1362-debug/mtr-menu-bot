(() => {
  const body = document.querySelector('#taskBody');
  if (!body) return;

  function applySavedLineBreaks() {
    body.querySelectorAll(
      'td:nth-child(2) b, td:nth-child(2) .memo, .mobile-task-title, .mobile-task-memo'
    ).forEach(el => {
      if (el.dataset.linebreakFixed === '1') return;

      const text = (el.textContent || '').replace(/\r\n?/g, '\n');
      el.style.setProperty('white-space', 'pre-wrap', 'important');
      el.style.setProperty('overflow', 'visible', 'important');
      el.style.setProperty('text-overflow', 'clip', 'important');
      el.style.setProperty('display', 'block', 'important');

      if (text.includes('\n')) {
        const fragment = document.createDocumentFragment();
        text.split('\n').forEach((line, index) => {
          if (index > 0) fragment.appendChild(document.createElement('br'));
          fragment.appendChild(document.createTextNode(line));
        });
        el.replaceChildren(fragment);
      }

      el.dataset.linebreakFixed = '1';
    });
  }

  const previousRenderTasks = renderTasks;
  renderTasks = function() {
    previousRenderTasks();
    applySavedLineBreaks();
  };

  const previousRender = render;
  render = function() {
    previousRender();
    applySavedLineBreaks();
  };

  const observer = new MutationObserver(() => {
    requestAnimationFrame(applySavedLineBreaks);
  });
  observer.observe(body, {childList:true, subtree:true});

  applySavedLineBreaks();
})();
