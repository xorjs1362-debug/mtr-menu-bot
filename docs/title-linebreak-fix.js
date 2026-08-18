(() => {
  const body = document.querySelector('#taskBody');
  if (!body) return;

  function applyTitleLineBreaks() {
    body.querySelectorAll('td:nth-child(2) b, .mobile-task-title').forEach(el => {
      if (el.dataset.linebreakFixed === '1') return;

      const text = (el.textContent || '').replace(/\r\n?/g, '\n');
      el.style.setProperty('white-space', 'pre-wrap', 'important');

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
    applyTitleLineBreaks();
  };

  const previousRender = render;
  render = function() {
    previousRender();
    applyTitleLineBreaks();
  };

  const observer = new MutationObserver(() => {
    requestAnimationFrame(applyTitleLineBreaks);
  });
  observer.observe(body, {childList:true, subtree:true});

  applyTitleLineBreaks();
})();
