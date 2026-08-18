(() => {
  const MOBILE_QUERY = '(max-width:700px)';
  let locked = false;
  let lockedScrollY = 0;
  let gesture = null;

  const isMobile = () => window.matchMedia(MOBILE_QUERY).matches;

  function installStyles(){
    if(document.getElementById('weeklyMobileFixStyle')) return;
    const style = document.createElement('style');
    style.id = 'weeklyMobileFixStyle';
    style.textContent = `
      html.weekly-report-open,
      body.weekly-report-open{
        overscroll-behavior:none!important;
      }
      .weekly-backdrop,
      .weekly-modal,
      .weekly-body{
        overscroll-behavior:contain;
      }

      @media(max-width:700px){
        .weekly-backdrop{
          padding:6px!important;
          touch-action:none;
        }
        .weekly-modal{
          width:100%!important;
          max-height:96dvh!important;
          border-radius:13px!important;
          touch-action:auto;
        }
        .weekly-body{
          padding:10px!important;
          overflow-y:auto!important;
          overflow-x:hidden!important;
          -webkit-overflow-scrolling:touch;
          touch-action:pan-y;
        }
        .weekly-project{
          overflow:hidden!important;
        }
        .weekly-project-title{
          display:flex!important;
          align-items:center!important;
          justify-content:space-between!important;
          gap:8px!important;
        }
        .weekly-swipe-hint{
          flex:0 0 auto;
          color:#8590a1;
          font-size:9px;
          font-weight:700;
          white-space:nowrap;
        }
        .weekly-grid{
          display:flex!important;
          grid-template-columns:none!important;
          gap:8px!important;
          width:100%!important;
          overflow-x:auto!important;
          overflow-y:hidden!important;
          scroll-snap-type:x mandatory;
          scroll-behavior:smooth;
          overscroll-behavior-x:contain;
          -webkit-overflow-scrolling:touch;
          scrollbar-width:none;
          padding:0 8% 0 0!important;
          box-sizing:border-box!important;
          touch-action:pan-x pan-y;
        }
        .weekly-grid::-webkit-scrollbar{display:none;}
        .weekly-field{
          flex:0 0 92%!important;
          min-width:92%!important;
          max-width:92%!important;
          scroll-snap-align:start;
          scroll-snap-stop:always;
          box-sizing:border-box!important;
          border-right:1px solid #edf0f4!important;
          border-bottom:0!important;
        }
        .weekly-field:last-child{border-right:0!important;}
        .weekly-text{
          min-height:170px!important;
          touch-action:pan-x pan-y;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function lockPage(){
    if(locked) return;
    locked = true;
    lockedScrollY = window.scrollY || window.pageYOffset || 0;
    document.documentElement.classList.add('weekly-report-open');
    document.body.classList.add('weekly-report-open');
    document.body.style.position = 'fixed';
    document.body.style.top = `-${lockedScrollY}px`;
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.width = '100%';
    document.body.style.overflow = 'hidden';
  }

  function unlockPage(){
    if(!locked) return;
    locked = false;
    document.documentElement.classList.remove('weekly-report-open');
    document.body.classList.remove('weekly-report-open');
    document.body.style.removeProperty('position');
    document.body.style.removeProperty('top');
    document.body.style.removeProperty('left');
    document.body.style.removeProperty('right');
    document.body.style.removeProperty('width');
    document.body.style.removeProperty('overflow');
    window.scrollTo(0, lockedScrollY);
  }

  function decorateProjects(){
    if(!isMobile()) return;
    document.querySelectorAll('#weeklyBody .weekly-project-title').forEach(title => {
      if(title.querySelector('.weekly-swipe-hint')) return;
      const hint = document.createElement('span');
      hint.className = 'weekly-swipe-hint';
      hint.textContent = '← 좌우로 넘기기 →';
      title.appendChild(hint);
    });
  }

  function syncOpenState(){
    const backdrop = document.getElementById('weeklyBackdrop');
    const open = !!backdrop?.classList.contains('show');
    if(open){
      lockPage();
      requestAnimationFrame(decorateProjects);
    }else{
      unlockPage();
    }
  }

  function bindSwipe(){
    const body = document.getElementById('weeklyBody');
    if(!body || body.dataset.mobileSwipeBound === '1') return;
    body.dataset.mobileSwipeBound = '1';

    body.addEventListener('touchstart', e => {
      if(!isMobile()) return;
      const grid = e.target.closest('.weekly-grid');
      if(!grid || !e.touches.length) return;
      const t = e.touches[0];
      gesture = {
        grid,
        startX:t.clientX,
        startY:t.clientY,
        startScroll:grid.scrollLeft,
        horizontal:false
      };
    }, {passive:true});

    body.addEventListener('touchmove', e => {
      if(!gesture || !e.touches.length) return;
      const t = e.touches[0];
      const dx = t.clientX - gesture.startX;
      const dy = t.clientY - gesture.startY;

      if(!gesture.horizontal && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.1){
        gesture.horizontal = true;
      }

      if(gesture.horizontal){
        e.preventDefault();
        e.stopPropagation();
        gesture.grid.scrollLeft = gesture.startScroll - dx;
      }
    }, {passive:false});

    const endGesture = () => { gesture = null; };
    body.addEventListener('touchend', endGesture, {passive:true});
    body.addEventListener('touchcancel', endGesture, {passive:true});
  }

  function bindBackdropGuard(){
    const backdrop = document.getElementById('weeklyBackdrop');
    if(!backdrop || backdrop.dataset.mobileGuardBound === '1') return;
    backdrop.dataset.mobileGuardBound = '1';

    backdrop.addEventListener('touchmove', e => {
      if(!e.target.closest('.weekly-modal')) e.preventDefault();
    }, {passive:false});

    const observer = new MutationObserver(syncOpenState);
    observer.observe(backdrop, {attributes:true, attributeFilter:['class']});
  }

  function observeDraftChanges(){
    const body = document.getElementById('weeklyBody');
    if(!body) return;
    const observer = new MutationObserver(() => requestAnimationFrame(decorateProjects));
    observer.observe(body, {childList:true, subtree:true});
  }

  installStyles();
  bindSwipe();
  bindBackdropGuard();
  observeDraftChanges();
  syncOpenState();

  window.addEventListener('resize', () => {
    if(!isMobile()) gesture = null;
    decorateProjects();
  });
})();
