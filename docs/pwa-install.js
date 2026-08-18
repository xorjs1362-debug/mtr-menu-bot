(() => {
  const stickyCss = document.createElement('link');
  stickyCss.rel = 'stylesheet';
  stickyCss.href = './sticky-columns.css?v=5';
  document.head.appendChild(stickyCss);

  let deferredPrompt = null;
  const startedAt = Date.now();

  const isStandalone = () =>
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  function browserInfo() {
    const ua = navigator.userAgent || '';
    const android = /Android/i.test(ua);
    const samsung = /SamsungBrowser/i.test(ua);
    const webview = /; wv\)/i.test(ua) || /\bwv\b/i.test(ua) || /WebView/i.test(ua);
    const edge = /EdgA|EdgiOS/i.test(ua);
    const opera = /OPR\//i.test(ua);
    const firefox = /Firefox|FxiOS/i.test(ua);
    const chrome = /Chrome\//i.test(ua) && !samsung && !webview && !edge && !opera;
    const ios = /iPhone|iPad|iPod/i.test(ua);
    return { ua, android, samsung, webview, edge, opera, firefox, chrome, ios };
  }

  function chromeIntentUrl() {
    const fallback = encodeURIComponent('https://xorjs1362-debug.github.io/mtr-menu-bot/?install=1');
    return `intent://xorjs1362-debug.github.io/mtr-menu-bot/?install=1#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${fallback};end`;
  }

  function showHelp({title, html, primaryText, primaryAction, secondaryText, secondaryAction}) {
    let box = document.getElementById('pwaHelpBox');
    if (box) box.remove();

    box = document.createElement('div');
    box.id = 'pwaHelpBox';
    box.style.cssText = 'position:fixed;left:16px;right:16px;bottom:18px;z-index:99999;max-width:560px;margin:auto;background:#111827;color:#fff;padding:16px;border-radius:16px;box-shadow:0 14px 38px rgba(0,0,0,.30);font-size:13px;line-height:1.6;';

    const actions = [];
    if (primaryText) actions.push(`<button id="pwaPrimary" type="button" style="border:0;border-radius:10px;padding:9px 13px;font-weight:850;cursor:pointer;background:#fff;color:#111827">${primaryText}</button>`);
    if (secondaryText) actions.push(`<button id="pwaSecondary" type="button" style="border:1px solid rgba(255,255,255,.25);border-radius:10px;padding:9px 13px;font-weight:800;cursor:pointer;background:transparent;color:#fff">${secondaryText}</button>`);
    actions.push('<button id="pwaHelpClose" type="button" style="border:0;border-radius:10px;padding:9px 13px;font-weight:800;cursor:pointer;background:#374151;color:#fff">닫기</button>');

    box.innerHTML = `
      <div style="font-size:15px;font-weight:900;margin-bottom:5px">${title}</div>
      <div>${html}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">${actions.join('')}</div>
    `;
    document.body.appendChild(box);
    document.getElementById('pwaHelpClose').onclick = () => box.remove();
    if (primaryText && document.getElementById('pwaPrimary')) document.getElementById('pwaPrimary').onclick = primaryAction;
    if (secondaryText && document.getElementById('pwaSecondary')) document.getElementById('pwaSecondary').onclick = secondaryAction;
  }

  async function installApp() {
    if (isStandalone()) {
      showHelp({
        title:'이미 설치되어 있습니다',
        html:'홈 화면 또는 앱 화면의 <b>할 일</b> 아이콘으로 실행하시면 됩니다.'
      });
      return;
    }

    if (deferredPrompt) {
      deferredPrompt.prompt();
      const result = await deferredPrompt.userChoice;
      if (result.outcome === 'accepted') deferredPrompt = null;
      return;
    }

    const b = browserInfo();

    if (b.ios) {
      showHelp({
        title:'아이폰 설치 방법',
        html:'<b>Safari</b>에서 이 페이지를 연 뒤 <b>공유 → 홈 화면에 추가 → 웹 앱으로 열기</b>를 선택해 주세요.'
      });
      return;
    }

    if (b.samsung) {
      showHelp({
        title:'삼성 인터넷에서 설치',
        html:'삼성 인터넷은 Chrome의 설치 팝업과 방식이 다릅니다.<br><b>주소창의 설치(+) 아이콘</b>을 누르거나, 메뉴에서 <b>현재 페이지 추가 → 홈 화면</b>을 선택해 주세요.<br><br>원하시면 아래 버튼으로 Chrome에서 바로 열 수도 있습니다.',
        primaryText:'Chrome에서 열기',
        primaryAction:()=>{ location.href = chromeIntentUrl(); }
      });
      return;
    }

    if (b.webview || (b.android && !b.chrome)) {
      showHelp({
        title:'현재 브라우저에서는 직접 설치가 제한됩니다',
        html:'앱 내부 브라우저나 일부 브라우저에서는 설치 팝업을 사이트가 직접 띄울 수 없습니다.<br><b>Chrome에서 열기</b>를 누른 뒤 다시 <b>앱 설치</b>를 눌러 주세요.',
        primaryText:'Chrome에서 열기',
        primaryAction:()=>{ location.href = chromeIntentUrl(); }
      });
      return;
    }

    if (b.chrome) {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      const remain = Math.max(0, 30 - elapsed);
      showHelp({
        title:'Chrome 설치 준비 중',
        html: remain > 0
          ? `Chrome은 설치 프롬프트 전에 사용 이력을 확인합니다.<br>이 페이지를 한 번 터치한 뒤 <b>약 ${remain}초</b> 더 사용하고 다시 눌러 주세요.`
          : '설치 조건은 거의 갖춰졌습니다. <b>새로고침</b>한 뒤 앱 설치를 다시 눌러 주세요.<br>그래도 안 뜨면 Chrome 메뉴의 <b>홈 화면에 추가 / 앱 설치</b> 항목을 확인해 주세요.',
        primaryText: remain > 0 ? '확인' : '새로고침',
        primaryAction:()=>{ if (remain > 0) document.getElementById('pwaHelpBox')?.remove(); else location.reload(); },
        secondaryText:'진단 정보',
        secondaryAction:showDiagnostics
      });
      return;
    }

    showHelp({
      title:'설치 방법 안내',
      html:'현재 브라우저에서는 사이트가 설치 창을 직접 띄우지 못했습니다. Android라면 Chrome에서 다시 열어 설치해 주세요.',
      primaryText:'Chrome에서 열기',
      primaryAction:()=>{ location.href = chromeIntentUrl(); }
    });
  }

  async function showDiagnostics() {
    const b = browserInfo();
    let sw='미지원';
    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration('./');
        sw = reg ? (navigator.serviceWorker.controller ? '등록됨 / 제어중' : '등록됨 / 제어 대기') : '미등록';
      }
    } catch(e) { sw='확인 실패'; }

    let manifest='확인 실패';
    try {
      const r=await fetch('./manifest.webmanifest',{cache:'no-store'});
      manifest=r.ok?'정상':'HTTP '+r.status;
    } catch(e) {}

    showHelp({
      title:'PWA 설치 진단',
      html:`브라우저: <b>${b.samsung?'Samsung Internet':b.chrome?'Chrome':b.webview?'앱 내부 브라우저':'기타'}</b><br>HTTPS: <b>${location.protocol==='https:'?'정상':'아님'}</b><br>Manifest: <b>${manifest}</b><br>Service Worker: <b>${sw}</b><br>설치 이벤트: <b>${deferredPrompt?'준비됨':'아직 없음'}</b>`
    });
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredPrompt = event;
    const btn = document.getElementById('installBtn');
    if (btn) {
      btn.hidden = false;
      btn.textContent = '앱 설치';
    }
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    const btn = document.getElementById('installBtn');
    if (btn) btn.hidden = true;
  });

  document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('installBtn');
    if (btn) {
      btn.hidden = isStandalone();
      btn.addEventListener('click', installApp);
    }
  });

  if ('serviceWorker' in navigator) {
    (async () => {
      try {
        const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
        await navigator.serviceWorker.ready;
        if (!navigator.serviceWorker.controller && !sessionStorage.getItem('todo-pwa-sw-reload')) {
          sessionStorage.setItem('todo-pwa-sw-reload','1');
          location.reload();
          return;
        }
        console.log('PWA service worker ready:', reg.scope);
      } catch (err) {
        console.error('Service worker registration failed:', err);
      }
    })();
  }
})();