(() => {
  const HOLD_MS = 2000;
  const MOVE_CANCEL_PX = 8;
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
        touch-action:auto;
        user-select:none;
        -webkit-user-select:none;
        -webkit-touch-callout:none;
        transition:background .15s,box-shadow .15s,transform .15s;
      }
      #tabs .project-drag-handle.hold-pending{
        transform:scale(.94);
        box-shadow:inset 0 0 0 2px rgba(47,111,237,.20);
      }
      #tabs .project-drag-handle.hold-active{
        cursor:grabbing;
        background:#eaf1ff;
        box-shadow:inset 0 0 0 2px rgba(47,111,237,.45);
      }
      #tabs .project-reorderable.tab-dragging{
        opacity:.72;
        outline:2px solid rgba(47,111,237,.35);
        outline-offset:2px;
      }

      /* 수정창에서 할 일 제목 직접 줄바꿈 */
      #editTitle{
        min-height:110px;
        resize:vertical;
        line-height:1.45;
        white-space:pre-wrap;
      }

      /* 사용자가 입력한 줄바꿈을 웹/모바일 목록에 그대로 표시 */
      td:nth-child(2) b,
      .mobile-task-title{
        white-space:pre-wrap !important;
      }

      @media(max-width:600px){
        #tabs .project-drag-handle{
          width:22px;
          height:22px;
          margin-left:1px;
          font-size:13px;
          touch-action:auto!important;
        }
        #editTitle{min-height:120px;}
      }
    `;
    document.head.appendChild(style);
  }

  function enableMultilineEditTitle() {
    const current = $('#editTitle');
    if (!current || current.tagName === 'TEXTAREA') return;

    const textarea = document.createElement('textarea');
    textarea.id = 'editTitle';
    textarea.rows = 4;
    textarea.value = current.value || '';
    textarea.placeholder = '할 일을 입력하세요. Enter로 줄바꿈할 수 있습니다.';
    current.replaceWith(textarea);
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
        handle.title = '2초 이상 길게 눌러 프로젝트 탭 순서 변경';
        handle.setAttribute('role','button');
        handle.setAttribute('aria-label','2초 이상 길게 눌러 프로젝트 탭 순서 변경');
        btn.appendChild(handle);
      }
    });
  }

  function projectButtons() {
    return [...document.querySelectorAll('#tabs .project-reorderable[data-tab]')];
  }

  function placeDraggedAtPointer(x, y) {
    if (!drag?.button || !drag.activated) return;
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
      const archive = tabs.querySelector('.tab[data-tab="archive"]');
      const addTab = tabs.querySelector('#quickProject');
      tabs.insertBefore(button, unclassified || archive || addTab || null);
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

  function clearHoldTimer() {
    if (drag?.timer) {
      clearTimeout(drag.timer);
      drag.timer = null;
    }
  }

  function activateDrag() {
    if (!drag || drag.activated) return;
    clearHoldTimer();
    drag.activated = true;
    drag.dragging = true;
    drag.handle?.classList.remove('hold-pending');
    drag.handle?.classList.add('hold-active');
    drag.button?.classList.add('tab-dragging');
    document.body.classList.add('project-tab-reordering');

    if (drag.kind === 'pointer') {
      try { drag.handle?.setPointerCapture(drag.pointerId); } catch {}
    }
  }

  function beginHold(data) {
    if (drag) cleanupDrag(false);
    drag = {...data, activated:false, dragging:false, timer:null};
    drag.handle?.classList.add('hold-pending');
    drag.timer = setTimeout(activateDrag, HOLD_MS);
  }

  function cleanupDrag(renderAfter=false) {
    if (!drag) return;
    const shouldPersist = !!(renderAfter && drag.activated);
    clearHoldTimer();

    drag.handle?.classList.remove('hold-pending','hold-active');
    drag.button?.classList.remove('tab-dragging');
    if (drag.kind === 'pointer') {
      try { drag.handle?.releasePointerCapture(drag.pointerId); } catch {}
    }
    drag = null;
    document.body.classList.remove('project-tab-reordering');

    if (shouldPersist) {
      persistDomOrder();
      render();
    }
  }

  function movedTooFar(x, y) {
    if (!drag) return false;
    return Math.hypot(x - drag.startX, y - drag.startY) > MOVE_CANCEL_PX;
  }

  function touchById(list, id) {
    return Array.from(list || []).find(t => t.identifier === id) || null;
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

    tabs.addEventListener('contextmenu', e => {
      if (e.target.closest('.project-drag-handle')) e.preventDefault();
    });

    tabs.addEventListener('touchstart', e => {
      const handle = e.target.closest('.project-drag-handle');
      if (!handle || !e.changedTouches.length) return;
      const button = handle.closest('.project-reorderable[data-tab]');
      if (!button) return;
      const t = e.changedTouches[0];

      beginHold({
        kind:'touch',
        touchId:t.identifier,
        handle,
        button,
        startX:t.clientX,
        startY:t.clientY
      });
    }, {passive:true});

    window.addEventListener('touchmove', e => {
      if (!drag || drag.kind !== 'touch') return;
      const t = touchById(e.touches, drag.touchId);
      if (!t) return;

      if (!drag.activated) {
        if (movedTooFar(t.clientX, t.clientY)) cleanupDrag(false);
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      placeDraggedAtPointer(t.clientX, t.clientY);
    }, {passive:false});

    window.addEventListener('touchend', e => {
      if (!drag || drag.kind !== 'touch') return;
      if (!touchById(e.changedTouches, drag.touchId)) return;
      cleanupDrag(true);
    }, {passive:true});

    window.addEventListener('touchcancel', e => {
      if (!drag || drag.kind !== 'touch') return;
      if (!touchById(e.changedTouches, drag.touchId)) return;
      cleanupDrag(false);
    }, {passive:true});

    tabs.addEventListener('pointerdown', e => {
      if (e.pointerType === 'touch' || e.button !== 0) return;
      const handle = e.target.closest('.project-drag-handle');
      if (!handle) return;
      const button = handle.closest('.project-reorderable[data-tab]');
      if (!button) return;

      beginHold({
        kind:'pointer',
        pointerId:e.pointerId,
        handle,
        button,
        startX:e.clientX,
        startY:e.clientY
      });
    });

    window.addEventListener('pointermove', e => {
      if (!drag || drag.kind !== 'pointer' || e.pointerId !== drag.pointerId) return;

      if (!drag.activated) {
        if (movedTooFar(e.clientX, e.clientY)) cleanupDrag(false);
        return;
      }

      e.preventDefault();
      placeDraggedAtPointer(e.clientX,e.clientY);
    }, {passive:false});

    window.addEventListener('pointerup', e => {
      if (!drag || drag.kind !== 'pointer' || e.pointerId !== drag.pointerId) return;
      cleanupDrag(true);
    });

    window.addEventListener('pointercancel', e => {
      if (!drag || drag.kind !== 'pointer' || e.pointerId !== drag.pointerId) return;
      cleanupDrag(false);
    });
  }

  const previousRender = render;
  render = function() {
    previousRender();
    enableMultilineEditTitle();
    decorateTabs();
    bindEvents();
  };

  installStyles();
  enableMultilineEditTitle();
  decorateTabs();
  bindEvents();
})();
