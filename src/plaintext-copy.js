// App-level selection menu, deliberately separate from editor commands/history.
(() => {
  const api = window.MdViewPlaintextCopy;
  if (!api) return;
  const excluded = 'input,textarea,select,button,[role="dialog"],dialog,.code-toolbar,[role="menu"]';
  let menu = null, owned = false, previousFocus = null, contextVersion = 0;
  const english = () => document.documentElement.lang === 'en';
  function close(restore = false) {
    contextVersion++;
    if (owned) menu?.remove();
    else if (menu) { menu.dispatchEvent(new CustomEvent('mdview-dismiss-context')); menu.querySelectorAll('[data-plaintext-copy]').forEach(b=>b.remove()); }
    menu = null; owned = false;
    if (restore && previousFocus?.isConnected) previousFocus.focus({preventScroll:true});
  }
  function capture(target, event) {
    if (!(target instanceof Element) || target.closest(excluded)) return null;
    const root = target.closest('#content,#editor-content');
    if (!root || root.hidden || root.closest('[hidden]')) return null;
    const cells = [...root.querySelectorAll('th.selectedCell,td.selectedCell')];
    if (cells.length) {
      if (!cells.includes(target.closest('td,th'))) return null;
      const rows = new Map();
      for (const cell of cells) {
        const range = document.createRange(); range.selectNodeContents(cell);
        const values = rows.get(cell.parentElement) || [];
        values.push(api.selectionText(cell,range,false).replace(/\n/g,' ')); rows.set(cell.parentElement,values);
      }
      const plain = api.clean([...rows.values()].map(values=>values.join('\t')).join('\n'));
      return plain ? {plain,numbered:plain} : null;
    }
    const selection = window.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) return null;
    const range = selection.getRangeAt(0);
    // A selection elsewhere in the document must not hijack this context target.
    const block = target.closest('td,th,p,li,pre,h1,h2,h3,h4,h5,h6') || target;
    if (!root.contains(range.startContainer) || !root.contains(range.endContainer) || !range.intersectsNode(block)) return null;
    if (event?.isTrusted && (event.clientX || event.clientY)
      && ![...range.getClientRects()].some(rect => event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom)) return null;
    const plain = api.selectionText(root, range, false);
    if (!plain) return null;
    return {plain, numbered:api.selectionText(root,range,true)};
  }
  function position(element, x, y) {
    element.style.left = `${Math.max(4,Math.min(x,innerWidth-element.offsetWidth-4))}px`;
    element.style.top = `${Math.max(4,Math.min(y,innerHeight-element.offsetHeight-4))}px`;
  }
  function append(element, snapshot) {
    for (const numbers of [true,false]) {
      const button = document.createElement('button'); button.type = 'button';
      button.dataset.plaintextCopy = numbers ? 'numbered' : 'plain';
      button.setAttribute('role','menuitem');
      button.title = english() ? 'Blank lines and images omitted; original text and code preserved.' : '去除空行并省略图片；保留原文和代码。';
      button.textContent = english() ? `Copy plain text (${numbers ? 'with' : 'without'} numbering)` : `无格式复制（${numbers ? '带' : '不带'}序号）`;
      button.addEventListener('mousedown',event=>event.preventDefault());
      button.addEventListener('click',async()=>{
        try { await window.mdview.copy(numbers ? snapshot.numbered : snapshot.plain); close(true); }
        catch { button.textContent = english() ? 'Copy failed — try again' : '复制失败，请重试'; }
      });
      element.append(button);
    }
  }
  document.addEventListener('contextmenu',event=>{
    const snapshot = capture(event.target, event);
    close();
    if (!snapshot) return;
    previousFocus = document.activeElement;
    event.mdviewTextSelection = true;
    event.preventDefault();
    // Table/image handlers retain first refusal and all structural operations.
    // Their synchronous menus are extended, never replaced or stopped.
    // Native event dispatch may run microtasks between capture listeners and
    // the editor target handler. A task waits for table/image menus to exist.
    const version = contextVersion;
    setTimeout(()=>{
      if (version !== contextVersion || !event.target.isConnected || event.target.closest('[hidden]')) return;
      menu = document.querySelector('.table-context-menu,.image-group-menu');
      owned = !menu;
      if (!menu) { menu=document.createElement('div'); menu.className='plaintext-copy-menu'; menu.setAttribute('role','menu'); menu.setAttribute('aria-label',english()?'Copy selection':'复制所选内容'); document.body.append(menu); }
      if (owned) menu.addEventListener('mdview-dismiss-context', () => close());
      append(menu,snapshot); position(menu,event.clientX,event.clientY);
      if (owned) menu.querySelector('button')?.focus({preventScroll:true});
    });
  },true);
  document.addEventListener('mousedown',event=>{
    if (menu && !menu.contains(event.target)) close();
    // Chromium must not collapse a selected text range before contextmenu.
    if (event.button===2 && capture(event.target, event)) event.preventDefault();
  },true);
  document.addEventListener('keydown',event=>{
    if (!menu || !owned) return;
    if (event.key==='Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
    else if(event.key==='Tab') close();
    else if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
      event.preventDefault(); const buttons=[...menu.querySelectorAll('button')];
      let index=buttons.indexOf(document.activeElement);
      index=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;
      buttons[index].focus();
    }
  },true);
  window.addEventListener('blur',()=>close());
  window.addEventListener('resize',()=>close());
  window.addEventListener('scroll',()=>close(),true);
})();
