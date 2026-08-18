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
      button.textContent = '복사됨';
      setTimeout(() => button.textContent = old, 1000);
    }
  }

  function removeWeeklyButton(){
    document.getElementById('weeklyChecklistLinkCopy')?.remove();
  }

  function install(){
    removeWeeklyButton();

    const headerActions = document.querySelector('.header-actions');
    if(!headerActions || document.getElementById('mainChecklistLinkCopy')) return;

    const button = document.createElement('button');
    button.id = 'mainChecklistLinkCopy';
    button.type = 'button';
    button.textContent = '링크 복사';
    button.title = '체크리스트 주소 복사';
    button.onclick = () => copy(checklistUrl(), button);

    const weekly = document.getElementById('weeklyReportBtn');
    if(weekly?.nextSibling) headerActions.insertBefore(button, weekly.nextSibling);
    else if(weekly) headerActions.appendChild(button);
    else {
      const manage = document.getElementById('manageProjectsBtn');
      headerActions.insertBefore(button, manage || null);
    }
  }

  install();
  const observer = new MutationObserver(install);
  observer.observe(document.body, {childList:true, subtree:true});
})();
