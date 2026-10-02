// Shared allowlist: browser gestures and the trusted main-process IPC use the
// same validation. Never resolve relative URLs or normalize the user's target.
(function (root) {
  function validTarget(href) {
    // URL() repairs extra authority slashes; never forward that malformed input.
    if (typeof href === 'string' && !/^https?:\/\/[^/?#]+/i.test(href)) return null;
    if (typeof href !== 'string' || href.length > 8192 || !/^https?:\/\//i.test(href) || /[\s\\\u0000-\u001f\u007f]/u.test(href)) return null;
    try {
      const url = new URL(href);
      return ['http:','https:'].includes(url.protocol) && url.hostname && !url.username && !url.password
        && !/^https?:\/\/[^/?#]*@/i.test(href) ? href : null;
    } catch { return null; }
  }
  function install(doc, open) {
    let gesture = null;
    const excluded = 'button,input,textarea,select,.code-toolbar,.table-width-controls,.image-size-controls,.image-resize-handles,.table-resizing,.image-resizing';
    const linkAt = target => {
      const link=target?.closest?.('a[href]');
      const scope=link?.closest('#content,#editor-content');
      return scope && !scope.closest('[hidden]') && !target.closest(excluded) ? link : null;
    };
    const modifiers = (event, link) => !event.metaKey && !event.shiftKey && !event.altKey
      && !!event.ctrlKey === !!link.closest('#editor-content');
    for (const [id, title] of [
      ['content', '点击或聚焦链接后按 Enter，在默认浏览器打开 / Click or focus a link and press Enter to open in your browser'],
      ['editor-content', 'Ctrl+点击或聚焦链接后按 Ctrl+Enter 打开；普通点击编辑 / Ctrl+click or focus a link and press Ctrl+Enter to open; ordinary click edits'],
    ]) doc.getElementById(id)?.setAttribute('title',title);
    function down(event) {
      const link=linkAt(event.target);
      gesture=event.isTrusted && event.button===0 && link && modifiers(event,link) ? {link,x:event.clientX,y:event.clientY,moved:false} : null;
    }
    function move(event) {
      if(gesture && (Math.abs(event.clientX-gesture.x)>4 || Math.abs(event.clientY-gesture.y)>4))gesture.moved=true;
    }
    function cancel(){gesture=null;}
    function click(event) {
      const link=linkAt(event.target), down=gesture; gesture=null;
      if(!link || (link.getAttribute('href') || '').startsWith('#'))return;
      // Claim anchor navigation even when rejected. Never cancel pointerdown:
      // native caret placement, drag selection and Ctrl+C keep their semantics.
      event.preventDefault(); event.stopPropagation();
      if(!event.isTrusted || event.button!==0 || event.detail!==1 || !modifiers(event,link)
        || !down || down.link!==link || down.moved || (!event.ctrlKey && !doc.defaultView.getSelection()?.isCollapsed))return;
      const target=validTarget(link.getAttribute('href'));
      if(target)open(target);
    }
    function keyboard(event) {
      const link=linkAt(event.target);
      // A focused anchor is distinct from the editing caret inside a link.
      if(event.key!=='Enter' || !link || event.target!==link || (link.getAttribute('href') || '').startsWith('#'))return;
      event.preventDefault();event.stopPropagation();
      const target=validTarget(link.getAttribute('href'));
      if(event.isTrusted && !event.repeat && modifiers(event,link) && target)open(target);
    }
    let menu=null, owned=false, button=null, previousFocus=null, contextVersion=0;
    function closeMenu(restore=false) {
      contextVersion++;
      if(owned)menu?.remove(); else button?.remove();
      menu=null;button=null;owned=false;
      if(restore && previousFocus?.isConnected)previousFocus.focus({preventScroll:true});
    }
    function mouseDown(event) {
      if(menu && !menu.contains(event.target))closeMenu();
      // Preserve selection for an explicit context action; table context handlers
      // still choose the right-clicked cell independently.
      if(event.button===2 && linkAt(event.target))event.preventDefault();
    }
    function context(event) {
      const link=linkAt(event.target), href=link?.getAttribute('href');
      closeMenu();
      if(!link || href.startsWith('#'))return;
      event.preventDefault();previousFocus=doc.activeElement;
      const version=contextVersion;
      // Let table/image and selected-text menus finish, then extend (not replace).
      doc.defaultView.setTimeout(()=>doc.defaultView.setTimeout(()=>{
        if(version!==contextVersion || !link.isConnected)return;
        menu=doc.querySelector('.table-context-menu,.image-group-menu,.plaintext-copy-menu');
        owned=!menu;
        if(owned){menu=doc.createElement('div');menu.className='plaintext-copy-menu';menu.setAttribute('role','menu');menu.setAttribute('aria-label','打开链接 / Open link');doc.body.append(menu);}
        button=doc.createElement('button');button.type='button';button.dataset.openExternalLink='';button.setAttribute('role','menuitem');
        button.textContent=doc.documentElement.lang==='en'?'Open link in browser':'在浏览器打开链接';
        button.disabled=!validTarget(href);
        button.title=button.disabled?'仅允许不含凭据的 HTTP(S) 地址 / Only HTTP(S) URLs without credentials are allowed':href;
        button.addEventListener('mousedown',e=>e.preventDefault());
        button.addEventListener('click',e=>{
          if(!e.isTrusted || !link.isConnected || !linkAt(link) || link.getAttribute('href')!==href || !validTarget(href))return;
          open(href);
          if(!owned)menu.dispatchEvent(new doc.defaultView.CustomEvent('mdview-dismiss-context'));
          closeMenu(true);
        });
        menu.prepend(button);
        menu.style.left=`${Math.max(4,Math.min(event.clientX,doc.defaultView.innerWidth-menu.offsetWidth-4))}px`;
        menu.style.top=`${Math.max(4,Math.min(event.clientY,doc.defaultView.innerHeight-menu.offsetHeight-4))}px`;
        if(owned)button.focus({preventScroll:true});
      },0),0);
    }
    function menuKey(event) {
      if(!menu || !owned)return;
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeMenu(true);}
      else if(event.key==='Tab')closeMenu();
    }
    function dismiss(){closeMenu();cancel();}
    function auxiliary(event){if(linkAt(event.target))event.preventDefault();}
    doc.addEventListener('contextmenu',context,true);doc.addEventListener('mousedown',mouseDown,true);
    doc.addEventListener('keydown',menuKey,true);
    doc.defaultView.addEventListener('resize',dismiss);doc.defaultView.addEventListener('scroll',dismiss,true);
    doc.addEventListener('keydown',keyboard,true);
    doc.addEventListener('pointerdown',down,true);doc.addEventListener('pointermove',move,true);
    doc.addEventListener('pointercancel',cancel,true);doc.addEventListener('dragstart',cancel,true);
    doc.addEventListener('click',click,true);doc.addEventListener('auxclick',auxiliary,true);
    doc.defaultView.addEventListener('blur',dismiss);
    return ()=>{
      dismiss();
      doc.removeEventListener('contextmenu',context,true);doc.removeEventListener('mousedown',mouseDown,true);
      doc.removeEventListener('keydown',menuKey,true);
      doc.defaultView.removeEventListener('resize',dismiss);doc.defaultView.removeEventListener('scroll',dismiss,true);
      doc.removeEventListener('keydown',keyboard,true);
      doc.removeEventListener('pointerdown',down,true);doc.removeEventListener('pointermove',move,true);
      doc.removeEventListener('pointercancel',cancel,true);doc.removeEventListener('dragstart',cancel,true);
      doc.removeEventListener('click',click,true);doc.removeEventListener('auxclick',auxiliary,true);
      doc.defaultView.removeEventListener('blur',dismiss);
    };
  }
  const api={validTarget,install};
  if(typeof module==='object' && module.exports)module.exports=api;
  else root.MdViewExternalLinks=api;
})(typeof window==='object' ? window : globalThis);
