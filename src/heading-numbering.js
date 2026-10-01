// CSSOM-only decoration: no mutations to reader/editor text, attrs, model,
// history or search ranges. The external stylesheet is already CSP-approved.
(() => {
  const dialog = document.getElementById('settings-dialog');
  const core = window.MdViewHeadingNumbering;
  const sheet = [...document.styleSheets].find(s => s.href && new URL(s.href).pathname.endsWith('/heading-numbering.css'));
  if (!dialog || !core || !sheet || document.getElementById('heading-numbering-settings')) return;
  const roots = ['content', 'editor-content'].map(id=>document.getElementById(id));
  const outline = document.getElementById('outline');
  const key = 'mdview-heading-numbering';
  const baseRules = sheet.cssRules.length;
  let enabled = false, scheduled = false, previous = '';
  try { enabled = localStorage.getItem(key) === 'true'; } catch { /* default off */ }
  const section = document.createElement('section'); section.id = 'heading-numbering-settings';
  const label = document.createElement('label'); label.className = 'view-row';
  const caption = document.createElement('span');
  const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.id = 'heading-numbering-enabled';
  checkbox.checked = enabled; checkbox.setAttribute('aria-describedby', 'heading-numbering-note');
  const note = document.createElement('p'); note.id = 'heading-numbering-note'; note.className = 'settings-note';
  label.append(caption, checkbox); section.append(label, note); dialog.append(section);
  function translate() {
    const english = document.documentElement.lang === 'en';
    caption.textContent = english ? 'Automatic heading numbers' : '标题自动序号';
    note.textContent = english
      ? 'Display only · off by default. H1: 一、; H2: 1.; H3–H6: 1.1…. Missing parent levels start at 1. Recognized manual prefixes are preserved and still count; they are not corrected. Markdown and exports are unchanged.'
      : '仅显示，默认关闭。一级：一、；二级：1.；三级至六级：1.1…。跳级时缺失父级从 1 起算。识别到手写序号时保留原文并计数，不校正手写序号。Markdown 与导出内容不变。';
  }
  function clear() {
    while (sheet.cssRules.length > baseRules) sheet.deleteRule(sheet.cssRules.length - 1);
    previous = '';
  }
  function scan() {
    if (!enabled) return;
    const rules = [], indexes = new Map();
    function selector(element, root) {
      const parts = [];
      for (let node = element; node !== root; node = node.parentElement) {
        const parent = node.parentElement;
        if (!indexes.has(parent)) indexes.set(parent, new Map([...parent.children].map((child,index)=>[child,index+1])));
        parts.unshift(`${node.localName}:nth-child(${indexes.get(parent).get(node)})`);
      }
      return `#${root.id} > ${parts.join(' > ')}`;
    }
    function add(element, root, prefix) {
      if (prefix) rules.push(`${selector(element, root)}::before { content: ${JSON.stringify(prefix)}; white-space: pre; pointer-events: none; }`);
    }
    for (const root of roots) {
      const headings = [...root.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(h=>!h.closest('pre,code'));
      const numbers = core.numberHeadings(headings.map(h=>({level:Number(h.tagName.slice(1)),title:h.textContent})));
      headings.forEach((h,i)=>add(h,root,numbers[i]));
      // Outline is already ordered by original heading occurrence, including
      // duplicates. Reuse numbers; don't rewrite slugs, text, titles or links.
      if (!root.hidden) [...outline.querySelectorAll('a')].forEach((a,i)=>add(a,outline,numbers[i]));
    }
    const signature = rules.join('\n');
    if (signature === previous) return;
    clear();
    for (const rule of rules) sheet.insertRule(rule,sheet.cssRules.length);
    previous = signature;
  }
  function schedule() {
    if (!enabled || scheduled) return;
    scheduled = true;
    queueMicrotask(()=>{ scheduled = false; scan(); });
  }
  checkbox.addEventListener('change',()=>{
    enabled = checkbox.checked;
    try { localStorage.setItem(key,String(enabled)); } catch { /* session-only */ }
    if (enabled) scan(); else clear();
  });
  // No observed attributes are written, so no PM observer/history feedback loop.
  const observer = new MutationObserver(schedule);
  for (const root of [...roots,outline]) observer.observe(root,{childList:true,subtree:true,characterData:true});
  const visibility = new MutationObserver(schedule);
  for (const root of roots) visibility.observe(root,{attributes:true,attributeFilter:['hidden']});
  new MutationObserver(translate).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
  window.mdview?.onLanguageChanged?.(()=>queueMicrotask(translate));
  translate(); if (enabled) scan();
})();
