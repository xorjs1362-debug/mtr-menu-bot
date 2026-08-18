(() => {
  function checklistUrl(){
    try { return new URL('./', window.location.href).href; }
    catch { return window.location.href.split('?')[0].split('#')[0]; }
  }

  async function copy(text, button){
    try{
      await navigator.clipboard.writeText(text);
    }catch{
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    if(button){
      const old = button.textContent;
      button.textContent = '링크 복사됨';
      setTimeout(() => button.textContent = old, 1000);
    }
  }

  function install(){
    const options = document.querySelector('#weeklyBackdrop .weekly-options');
    if(!options || document.getElementById('weeklyChecklistLinkCopy')) return;

    const button = document.createElement('button');
    button.id = 'weeklyChecklistLinkCopy';
    button.type = 'button';
    button.textContent = '체크리스트 링크 복사';
    button.title = '현재 체크리스트 주소 복사';
    button.onclick = () => copy(checklistUrl(), button);

    const refresh = document.getElementById('weeklyRefresh');
    options.insertBefore(button, refresh || null);
  }

  install();
  const observer = new MutationObserver(install);
  observer.observe(document.body, {childList:true, subtree:true});
})();
