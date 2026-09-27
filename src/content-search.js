/* Document-content search. Filename filtering in sidebar.js is deliberately separate. */
(() => {
  const panel = document.createElement('section');
  panel.id = 'document-search'; panel.hidden = true;
  panel.setAttribute('aria-label', t('搜索文档内容'));
  panel.innerHTML = '<div class="document-search-bar"><select id="document-search-scope" aria-label="搜索范围"><option value="current">当前文档</option><option value="all">所有打开的文档</option></select><input id="document-search-query" type="search" maxlength="256" autocomplete="off" spellcheck="false" aria-label="搜索文档内容"><button id="document-search-case" type="button" aria-pressed="false" title="区分大小写">Aa</button><output id="document-search-count" role="status" aria-live="polite"></output><button id="document-search-previous" type="button" title="上一个匹配（Shift+Enter）" aria-label="上一个匹配（Shift+Enter）">↑</button><button id="document-search-next" type="button" title="下一个匹配（Enter）" aria-label="下一个匹配（Enter）">↓</button><button id="document-search-close" type="button" title="关闭搜索（Escape）" aria-label="关闭搜索（Escape）">×</button></div><div id="document-search-results" role="list" aria-label="搜索结果"></div>';
  $('#tab-bar').after(panel);
  const input = $('#document-search-query'), scope = $('#document-search-scope');
  const count = $('#document-search-count'), list = $('#document-search-results');
  const caseButton = $('#document-search-case');
  let generation = 0, timer, hits = [], total = 0, selected = -1, pending = false, navigating = false, restoreFocus;
  let caseSensitive = false;
  const MAX_HITS = 500;
  function clearHighlights() {
    CSS.highlights?.delete('document-search'); CSS.highlights?.delete('document-search-selected');
    richEditor?.searchHighlights([], -1);
  }
  function updateCount() {
    count.textContent = pending ? t('正在搜索…') : !input.value ? t('输入文字以搜索') :
      total ? t('{index} / {total} 个匹配', { index: selected + 1, total: total.toLocaleString(uiLanguage) }) : t('没有匹配');
    if (!pending && total > hits.length) count.textContent += ' · ' + t('仅显示前 {limit} 个', { limit: MAX_HITS });
    $('#document-search-previous').disabled = $('#document-search-next').disabled = pending || !hits.length || fileBusy;
    list.hidden = scope.value !== 'all' || !hits.length;
  }
  function invalidate() {
    ++generation; clearTimeout(timer); window.mdview.cancelContentSearch();
    pending = false; hits = []; total = 0; selected = -1;
    clearHighlights(); list.replaceChildren(); updateCount();
  }
  function refresh() {
    if (panel.hidden) return;
    invalidate();
    if (!input.value || !currentDocument) return;
    pending = true; updateCount();
    const token = generation;
    timer = setTimeout(() => search(token), 160);
  }
  async function search(token) {
    const query = input.value, all = scope.value === 'all';
    const documents = all ? tabs.slice() : tabs.filter(tab => tab.id === currentDocument?.id);
    const active = currentDocument ? payload() : null;
    const found = []; let sum = 0;
    try {
      for (let i = 0; i < documents.length; i++) {
        const tab = documents[i];
        const result = await window.mdview.searchDocument({ id: tab.id, query, caseSensitive, limit: MAX_HITS - found.length, ...(i === 0 && active ? { active } : {}) });
        if (token !== generation) return;
        if (!result) { refresh(); return; }
        sum += result.total;
        found.push(...result.hits.map(hit => ({ ...hit, id: tab.id, name: tab.path ? tab.name : t('未命名.md'), path: tab.path })));
      }
      if (token !== generation) return;
      hits = found; total = sum; pending = false;
      selected = hits.findIndex(hit => hit.id === currentDocument?.id);
      if (selected < 0 && hits.length) selected = 0;
      renderResults(); paint(false); updateCount();
    } catch {
      if (token !== generation) return;
      pending = false; count.textContent = t('搜索未完成，请重试。');
    }
  }
  function renderResults() {
    const fragment = document.createDocumentFragment();
    hits.forEach((hit, index) => {
      const row = document.createElement('button'); row.type = 'button'; row.className = 'document-search-result';
      row.dataset.index = index; row.setAttribute('role', 'listitem'); row.title = hit.path || hit.name;
      const name = document.createElement('strong'), snippet = document.createElement('span');
      name.textContent = hit.name; snippet.textContent = hit.snippet;
      row.append(name, snippet); fragment.append(row);
    });
    list.replaceChildren(fragment);
  }
  // Map rendered text to native Ranges; never wrap/mutate rich HTML or editor DOM.
  function readerBlocks() {
    const selector = 'p,h1,h2,h3,h4,h5,h6,pre,span[data-search-inline="true"],th,td';
    // Hidden paragraphs have individual parser-supplied owners, including empty
    // tasks and paragraphs after headings/code or on either side of nested lists.
    const elements = [...$('#content').querySelectorAll(selector)];
    const owned = new Set(elements);
    return elements.map(element => {
      const segments = []; let length = 0;
      function visit(node) {
        if (node.nodeType === Node.TEXT_NODE) {
          // markdown-it emits a formatting newline after <br>; it is not another hard break.
          const offset = node.previousSibling?.nodeName === 'BR' && node.data.startsWith('\n') ? 1 : 0;
          segments.push({ node, start: length, size: node.length - offset, offset }); length += node.length - offset; return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE || (node !== element && owned.has(node)) || node.matches('label,.code-toolbar')) return;
        if (node.matches('img,[data-search-image],br')) {
          const index = [...node.parentNode.childNodes].indexOf(node);
          segments.push({ node: node.parentNode, start: length, size: 1, index }); length++; return;
        }
        for (const child of node.childNodes) visit(child);
      }
      visit(element);
      return { element, segments };
    });
  }
  function rangeFor(block, hit) {
    if (!block) return null;
    const start = block.segments.find(s => s.start <= hit.from && s.start + s.size > hit.from);
    const end = block.segments.find(s => s.start < hit.to && s.start + s.size >= hit.to);
    if (!start || !end) return null;
    const range = new Range();
    range.setStart(start.node, start.index ?? hit.from - start.start + (start.offset || 0));
    range.setEnd(end.node, end.index === undefined ? hit.to - end.start + (end.offset || 0) : end.index + 1);
    return range;
  }
  function reveal(element, range) {
    const code = element?.closest('.code-block');
    if (code?.classList.contains('code-collapsed')) {
      code.classList.remove('code-collapsed');
      const collapse = code.querySelector('.collapse-code');
      if (collapse) {
        collapse.setAttribute('aria-expanded', 'true');
        collapse.textContent = '折叠 / Fold';
        collapse.title = '折叠 / Collapse code';
      }
    }
    if (!element) return;
    const rectangle = () => (range || element).getBoundingClientRect();
    const pre = element.closest('pre');
    if (pre) {
      const bounds = pre.getBoundingClientRect(), rect = rectangle();
      pre.scrollLeft += rect.left - bounds.left - bounds.width / 2;
      pre.scrollTop += rect.top - bounds.top - bounds.height / 2;
    }
    const rect = rectangle(), bounds = reader.getBoundingClientRect();
    reader.scrollTo({ top: reader.scrollTop + rect.top - bounds.top - bounds.height / 2, behavior: 'instant' });
  }
  function paint(scroll) {
    clearHighlights();
    const local = hits.filter(hit => hit.id === currentDocument?.id);
    const chosen = hits[selected], index = local.indexOf(chosen);
    if (editing && richEditor) {
      const mapped = richEditor.searchHighlights(local, index, input.value, caseSensitive);
      if (scroll && mapped[index]) {
        reveal(richEditor.editor.view.dom.querySelector('.document-search-selected'));
      }
    } else if (CSS.highlights && typeof Highlight === 'function') {
      const blocks = readerBlocks();
      const ranges = local.map(hit => rangeFor(blocks[hit.block], hit));
      CSS.highlights.set('document-search', new Highlight(...ranges.filter(Boolean)));
      if (ranges[index]) {
        CSS.highlights.set('document-search-selected', new Highlight(ranges[index]));
        if (scroll) {
          const node = ranges[index].startContainer;
          reveal(node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement, ranges[index]);
        }
      }
    }
    for (const row of list.children) row.setAttribute('aria-current', String(Number(row.dataset.index) === selected));
  }
  async function navigate(index) {
    if (pending || navigating || fileBusy || !hits.length) return;
    const token = generation;
    const hit = hits[(index + hits.length) % hits.length];
    if (!tabs.some(tab => tab.id === hit.id)) { refresh(); return; }
    navigating = true;
    try {
      if (hit.id !== currentDocument?.id) await switchToTab(hit.id);
      // Let the normal tab scroll restoration finish before locating the match.
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (token !== generation || panel.hidden || currentDocument?.id !== hit.id) return;
      selected = hits.indexOf(hit); paint(true); updateCount();
    } finally { navigating = false; }
  }
  function open(value = 'current') {
    if (document.querySelector('dialog[open]')) return;
    if (panel.hidden) restoreFocus = document.activeElement;
    panel.hidden = false; scope.value = value === 'all' ? 'all' : 'current';
    input.focus(); input.select(); refresh();
  }
  function close() {
    panel.hidden = true; invalidate();
    if (restoreFocus?.isConnected) restoreFocus.focus({ preventScroll: true });
    else if (editing) richEditor?.editor.view.focus();
  }
  input.addEventListener('input', refresh); scope.addEventListener('change', refresh);
  caseButton.addEventListener('click', () => { caseSensitive = !caseSensitive; caseButton.setAttribute('aria-pressed', String(caseSensitive)); refresh(); });
  $('#document-search-previous').addEventListener('click', () => navigate(selected - 1));
  $('#document-search-next').addEventListener('click', () => navigate(selected + 1));
  $('#document-search-close').addEventListener('click', close);
  list.addEventListener('click', event => { const row = event.target.closest('.document-search-result'); if (row) void navigate(Number(row.dataset.index)); });
  document.addEventListener('keydown', event => {
    if (document.querySelector('dialog[open]')) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); open(event.shiftKey ? 'all' : 'current'); }
    else if (!panel.hidden && event.key === 'Escape') { event.preventDefault(); close(); }
    else if (!panel.hidden && panel.contains(event.target) && event.key === 'Enter' && !event.isComposing) { event.preventDefault(); void navigate(selected + (event.shiftKey ? -1 : 1)); }
  });
  window.mdview.onMenuAction((action, value) => { if (action === 'find') open(value); });
  document.addEventListener('document-search-update', () => { if (!navigating) refresh(); });
  let tabSignature = '';
  window.mdview.onTabs(value => {
    const signature = JSON.stringify(value.map(tab => [tab.id, tab.name, tab.active]));
    if (signature !== tabSignature) { tabSignature = signature; if (!navigating) refresh(); }
  });
  window.mdview.onLanguageChanged(() => { updateCount(); });
  window.mdview.onBusy(() => updateCount());
  window.mdviewSearch = { open, close, refresh, get total() { return total; }, get pending() { return pending; } };
})();
