// Pure DOM-range serialization: read original ancestors, never mutate or clone
// the live editor. Structural prefixes are metadata, never regex-stripped text.
(() => {
  const excluded = 'button,input,textarea,select,label,script,style,.code-toolbar,.image-controls,.image-resize-handles,.link-icon,[aria-hidden="true"]';
  const blocks = new Set(['P','DIV','SECTION','ARTICLE','BLOCKQUOTE','PRE','H1','H2','H3','H4','H5','H6']);
  const clean = value => value.replace(/\r\n?/g, '\n').split('\n').filter(line => line.trim()).join('\n');
  function selectionText(root, range, numbers = true) {
    if (!root || !range || range.collapsed || !root.contains(range.startContainer) || !root.contains(range.endContainer)) return '';
    const headings = [...root.querySelectorAll('h1,h2,h3,h4,h5,h6')];
    const enabled = document.getElementById('heading-numbering-enabled')?.checked;
    const prefixes = enabled ? window.MdViewHeadingNumbering?.numberHeadings(headings.map(h=>({level:Number(h.tagName[1]),title:h.textContent}))) || [] : [];
    const headingPrefix = new Map(headings.map((h,i)=>[h,prefixes[i] || '']));
    function intersects(node) { try { return range.intersectsNode(node); } catch { return false; } }
    function text(node) {
      if (!intersects(node)) return '';
      if (node.nodeType === 3) {
        const from = range.startContainer === node ? range.startOffset : 0;
        const to = range.endContainer === node ? range.endOffset : node.length;
        return node.data.slice(from,to);
      }
      if (node.nodeType !== 1 || node.matches(excluded) || node.hidden) return '';
      const style = window.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return '';
      // Images are intentionally omitted, including unloaded-image fallback UI.
      if (node.matches('img,.editor-image,.image-node,[data-search-image]')) return '';
      if (node.tagName === 'BR') return '\n';
      const children = () => [...node.childNodes].map(text).join('');
      if (node.tagName === 'TR') {
        const cells = [...node.children].filter(cell=>intersects(cell));
        return '\n' + cells.map(cell=>clean(text(cell)).replace(/\n/g,' ')).join('\t') + '\n';
      }
      if (node.tagName === 'LI') {
        let body = clean(children());
        if (!body) return '';
        const own = [...node.childNodes].filter(child => child.nodeType !== 1 || !child.matches('ol,ul')).map(text).join('');
        if (!own.trim()) return '\n' + body + '\n';
        if (numbers) {
          const parent = node.parentElement;
          let marker = '• ';
          if (parent.tagName === 'OL') {
            const siblings = [...parent.children].filter(child=>child.tagName === 'LI');
            let counter = parent.hasAttribute('start') ? Number(parent.getAttribute('start')) : parent.reversed ? siblings.length : 1;
            for (const li of siblings) {
              if (li.hasAttribute('value')) counter = Number(li.getAttribute('value'));
              if (li === node) break;
              counter += parent.reversed ? -1 : 1;
            }
            marker = `${counter}. `;
          } else if (node.hasAttribute('data-checked')) marker = node.getAttribute('data-checked') === 'true' ? '[x] ' : '[ ] ';
          body = marker + body;
        }
        // Preserve hierarchy without flattening nested counters into outer ones.
        let depth = 0;
        for (let p=node.parentElement;p && p!==root;p=p.parentElement) if(p.tagName==='LI') depth++;
        return '\n' + '  '.repeat(depth) + body + '\n';
      }
      let value = children();
      if (/^H[1-6]$/.test(node.tagName) && numbers && value.trim()) value = (headingPrefix.get(node) || '') + value;
      if (blocks.has(node.tagName)) return '\n' + value + '\n';
      return value;
    }
    return clean(text(root));
  }
  window.MdViewPlaintextCopy = { selectionText, clean };
})();
