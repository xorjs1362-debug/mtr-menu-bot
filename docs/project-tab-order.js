(() => {
  let drag = null;

  function installStyles() {
    if (document.getElementById('projectTabOrderStyle')) return;
    const style = document.createElement('style');
    style.id = 'projectTabOrderStyle';
    style.textContent = `
      #tabs .project-reorderable{
        display:inline-flex;
        align-items:center;
        gap:4px;
      }
      #tabs .project-drag-handle{
        display:inline-flex;
        align-items:center;
        justify-content:center;
        width:20px;
        height:20px;
        margin-left:2px;
        border-radius:6px;
        color:#7c8797;
        background:rgba(127,140,160,.10);
        font-size:12px;
        font-weight:800;
        line-height:1;
        cursor:grab;
        touch-action:none;
        user-select:none;
        -webkit-user-select:none;
      }
      #tabs .project-drag-handle:active{cursor:grabbing;}
      #tabs .project-reorderable.tab-dragging{
        opacity:.72;
        outline:2px solid rgba(47,111,237,.35);
        outline-offset:2px;
      }
      @media(max-width:600px){
        #tabs .project-drag-handle{
          width:22px;
          height:22px;
          margin-left:1px;
          font-size:13px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function projectIds() {
    return new Set((state?.projects || []).map(p => String(p.id)));
  }

  function decorateTabs() {
    const tabs = $('#tabs');
    if (!tabs) return;
    const ids = projectIds();

    tabs.querySelectorAll('.tab[data-tab]').forEach(btn => {
      const id = String(btn.dataset.tab || '');
      if (!ids.has(id)) return;
      btn.classList.add('project-reorderable');
      btn.dataset.projectReorderable = '1';

      if (!btn.querySelector('.project-drag-handle')) {
        const handle = document.createElement('span');
        handle.className = 'project-drag-handle';
        handle.textContent = '↔';
        handle.title = '잡고 끌어서 프로젝트 탭 순서 변경';
        handle.setAttribute('role','button');
        handle.setAttribute('aria-label','프로젝트 탭 순서 변경');
        btn.appendChild(handle);
      }
    });
  }

  function projectButtons() {
    return [...document.querySelectorAll('#tabs .project-reorderable[data-tab]')];
  }

  function placeDraggedAtPointer(x, y) {
    if (!drag?.button) return;
    const tabs = $('#tabs');
    const button = drag.button;
    const others = projectButtons().filter(x => x !== button);
    if (!others.length) return;

    const ordered = others.map(el => ({el, rect:el.getBoundingClientRect()}))
      .sort((a,b) => Math.abs(a.rect.top-b.rect.top) > 8 ? a.rect.top-b.rect.top : a.rect.left-b.rect.left);

    let before = null;
    for (const item of ordered) {
      const cy = item.rect.top + item.rect.height / 2;
      const cx = item.rect.left + item.rect.width / 2;
      if (y < cy - item.rect.height * .35 || (Math.abs(y-cy) <= item.rect.height * .65 && x < cx)) {
        before = item.el;
        break;
      }
    }

    if (before) {
      if (button.nextElementSibling !== before) tabs.insertBefore(button, before);
    } else {
      const unclassified = tabs.querySelector('.tab[data-tab="unclassified"]');
      const addTab = tabs.querySelector('#quickProject');
      tabs.insertBefore(button, unclassified || addTab || null);
    }
  }

  function persistDomOrder() {
    const ids = projectButtons().map(btn => String(btn.dataset.tab));
    if (!Array.isArray(state?.projects) || ids.length !== state.projects.length) return;

    const byId = new Map(state.projects.map(p => [String(p.id), p]));
    if (ids.some(id => !byId.has(id))) return;

    const current = state.projects.map(p => String(p.id));
    if (ids.every((id,i) => id === current[i])) return;

    state.projects = ids.map(id => byId.get(id));
    save();
  }

  function cleanupDrag(renderAfter=false) {
    if (!drag) return;
    const wasDragging = drag.dragging;
    drag.button?.classList.remove('tab-dragging');
    drag = null;
    document.body.classList.remove('project-tab-reordering');
    if (renderAfter && wasDragging) {
      persistDomOrder();
      render();
    }
  }

  function bindEvents() {
    const tabs = $('#tabs');
    if (!tabs || tabs.dataset.projectOrderBound === '1') return;
    tabs.dataset.projectOrderBound = '1';

    tabs.addEventListener('click', e => {
      if (e.target.closest('.project-drag-handle')) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    }, true);

    tabs.addEventListener('pointerdown', e => {
      const handle = e.target.closest('.project-drag-handle');
      if (!handle) return;
      const button = handle.closest('.project-reorderable[data-tab]');
      if (!button) return;

      e.preventDefault();
      e.stopPropagation();
      drag = {
        pointerId:e.pointerId,
        button,
        startX:e.clientX,
        startY:e.clientY,
        dragging:false
      };
      try { handle.setPointerCapture(e.pointerId); } catch {}
    });

    window.addEventListener('pointermove', e => {
      if (!drag || e.pointerId !== drag.pointerId) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (!drag.dragging && Math.hypot(dx,dy) < 7) return;

      drag.dragging = true;
      drag.button.classList.add('tab-dragging');
      document.body.classList.add('project-tab-reordering');
      e.preventDefault();
      placeDraggedAtPointer(e.clientX,e.clientY);
    }, {passive:false});

    window.addEventListener('pointerup', e => {
      if (!drag || e.pointerId !== drag.pointerId) return;
      cleanupDrag(true);
    });

    window.addEventListener('pointercancel', e => {
      if (!drag || e.pointerId !== drag.pointerId) return;
      cleanupDrag(true);
    });
  }

  const previousRender = render;
  render = function() {
    previousRender();
    decorateTabs();
    bindEvents();
  };

  installStyles();
  decorateTabs();
  bindEvents();
})();
