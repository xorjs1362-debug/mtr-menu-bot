(() => {
  let deferredPrompt = null;

  const isStandalone = () =>
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  function showHelp(message) {
    let box = document.getElementById('pwaHelpBox');
    if (!box) {
      box = document.createElement('div');
      box.id = 'pwaHelpBox';
      box.style.cssText = 'position:fixed;left:16px;right:16px;bottom:18px;z-index:99999;max-width:520px;margin:auto;background:#111827;color:#fff;padding:15px 16px;border-radius:14px;box-shadow:0 12px 34px rgba(0,0,0,.25);font-size:13px;line-height:1.55;';
      box.innerHTML = '<div id="pwaHelpText"></div><button id="pwaHelpClose" type="button" style="margin-top:10px;border:0;border-radius:9px;padding:8px 12px;font-weight:800;cursor:pointer">확인</button>';
      document.body.appendChild(box);
      document.getElementById('pwaHelpClose').onclick = () => box.remove();
    }
    document.getElementById('pwaHelpText').innerHTML = message;
  }

  async function installApp() {
    if (isStandalone()) {
      showHelp('이미 <b>앱으로 설치된 상태</b>입니다. 홈 화면의 <b>할 일</b> 아이콘으로 실행하시면 됩니다.');
      return;
    }

    if (deferredPrompt) {
      deferredPrompt.prompt();
      const result = await deferredPrompt.userChoice;
      if (result.outcome === 'accepted') {
        deferredPrompt = null;
      }
      return;
    }

    const ua = navigator.userAgent || '';
    const inWebView = /; wv\)/i.test(ua) || /WebView/i.test(ua);
    const isIOS = /iPhone|iPad|iPod/i.test(ua);

    if (isIOS) {
      showHelp('<b>아이폰 설치 방법</b><br>Safari에서 이 페이지를 연 뒤 <b>공유 → 홈 화면에 추가 → 웹 앱으로 열기</b>를 선택해 주세요.');
    } else if (inWebView) {
      showHelp('<b>현재 앱 내부 브라우저에서는 PWA 설치가 제한될 수 있습니다.</b><br>오른쪽 위 메뉴에서 <b>Chrome에서 열기</b>를 선택한 뒤, 이 페이지의 <b>앱 설치</b> 버튼을 다시 눌러 주세요.');
    } else {
      showHelp('<b>Chrome이 아직 설치 준비를 완료하지 않았습니다.</b><br>이 페이지를 한 번 터치하고 약 30초 정도 사용한 뒤 <b>앱 설치</b> 버튼을 다시 눌러 주세요. 그래도 안 되면 Chrome에서 페이지를 새로고침한 뒤 다시 눌러 주세요.');
    }
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
    window.addEventListener('load', async () => {
      try {
        const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
        await navigator.serviceWorker.ready;
        console.log('PWA service worker ready:', reg.scope);
      } catch (err) {
        console.error('Service worker registration failed:', err);
      }
    });
  }
})();