(() => {
  const backdrop = document.getElementById('editBackdrop');
  if (!backdrop) return;

  let locked = false;
  let lockedScrollY = 0;

  function installStyles() {
    if (document.getElementById('editModalLockStyle')) return;
    const style = document.createElement('style');
    style.id = 'editModalLockStyle';
    style.textContent = `
      html.edit-modal-open,
      body.edit-modal-open{
        overscroll-behavior:none!important;
      }
      #editBackdrop{
        overscroll-behavior:contain;
      }

      @media(max-width:600px){
        #editBackdrop{
          padding:8px!important;
          touch-action:none;
        }
        #editBackdrop .modal{
          width:100%!important;
          max-height:calc(100dvh - 16px)!important;
          display:flex!important;
          flex-direction:column!important;
          overflow:hidden!important;
          touch-action:auto;
        }
        #editBackdrop .modal-head,
        #editBackdrop .modal-foot{
          flex:0 0 auto!important;
        }
        #editBackdrop .edit-grid{
          flex:1 1 auto!important;
          min-height:0!important;
          overflow-y:auto!important;
          overflow-x:hidden!important;
          overscroll-behavior:contain!important;
          -webkit-overflow-scrolling:touch;
          touch-action:pan-y;
        }
        #editBackdrop textarea{
          touch-action:pan-y;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function lockPage() {
    if (locked) return;
    locked = true;
    lockedScrollY = window.scrollY || window.pageYOffset || 0;

    document.documentElement.classList.add('edit-modal-open');
    document.body.classList.add('edit-modal-open');
    document.body.style.position = 'fixed';
    document.body.style.top = `-${lockedScrollY}px`;
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.width = '100%';
    document.body.style.overflow = 'hidden';
  }

  function unlockPage() {
    if (!locked) return;
    locked = false;

    document.documentElement.classList.remove('edit-modal-open');
    document.body.classList.remove('edit-modal-open');
    document.body.style.removeProperty('position');
    document.body.style.removeProperty('top');
    document.body.style.removeProperty('left');
    document.body.style.removeProperty('right');
    document.body.style.removeProperty('width');
    document.body.style.removeProperty('overflow');
    window.scrollTo(0, lockedScrollY);
  }

  function syncState() {
    if (backdrop.classList.contains('show')) lockPage();
    else unlockPage();
  }

  backdrop.addEventListener('touchmove', e => {
    if (!e.target.closest('.modal')) e.preventDefault();
  }, {passive:false});

  const observer = new MutationObserver(syncState);
  observer.observe(backdrop, {attributes:true, attributeFilter:['class']});

  installStyles();
  syncState();
})();
