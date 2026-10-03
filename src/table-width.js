import { Table, TableCell, TableHeader } from '@tiptap/extension-table';
import { closeHistory } from '@tiptap/pm/history';
import { createTablePerimeter } from './table-perimeter.js';
import { parseWidths, MIN_COLUMN_WIDTH as MIN, MAX_COLUMN_WIDTH as MAX } from './table-width-syntax.cjs';

function cellAttributes() {
  const attrs = this.parent();
  return { ...attrs, align: { ...attrs.align,
    parseHTML: el => ['left','center','right'].find(a => el.classList.contains(`align-${a}`)) || attrs.align.parseHTML(el),
    renderHTML: values => ['left','center','right'].includes(values.align) ? { class: `align-${values.align}` } : {},
  } };
}
export const WidthCell = TableCell.extend({ content: 'paragraph', addAttributes: cellAttributes });
export const WidthHeader = TableHeader.extend({ content: 'paragraph', addAttributes: cellAttributes });
const clamp = n => Math.max(MIN, Math.min(MAX, Math.round(n)));
function widthsOf(node) {
  const cells = node.content?.[0]?.content || [];
  const raw = cells.map(cell => cell.attrs?.colwidth?.[0]);
  if (!raw.some(Boolean)) return null;
  return parseWidths(raw.map(w => clamp(w || 120)).join(','));
}

export const WidthTable = Table.extend({
  renderHTML({ node }) {
    const widths = widthsOf(node.toJSON());
    return ['table', widths ? { width: widths.reduce((a,b)=>a+b,0), class: 'mdview-width-table' } : {},
      ...(widths ? [['colgroup', ...widths.map(width => ['col', { width }])]] : []), ['tbody', 0]];
  },
  renderMarkdown(node, helpers) {
    const markdown = Table.config.renderMarkdown(node, helpers), widths = widthsOf(node);
    return widths ? `{table-widths=${widths.join(',')}}\n\n${markdown.trim()}` : markdown;
  },
  parseMarkdown(token, helpers) {
    const node = Table.config.parseMarkdown(token, helpers);
    if (token.mdviewWidths) for (const row of node.content) row.content.forEach((cell,i) => { cell.attrs = { ...cell.attrs, colwidth: [token.mdviewWidths[i]] }; });
    return node;
  },
  markdownTokenizer: {
    ...Table.config.markdownTokenizer,
    start: src => src.startsWith('{table-widths=') ? 0 : Table.config.markdownTokenizer.start(src),
    tokenize(src, tokens, helper) {
      const match = /^\{table-widths=([^}]+)\}\n\n/.exec(src);
      const widths = match && parseWidths(match[1]);
      if (!widths) return Table.config.markdownTokenizer.tokenize(src,tokens,helper);
      const rest = src.slice(match[0].length), candidate = rest.split('\n\n')[0];
      if (!/^[ \t|:]*-[ \t|:-]*$/.test(candidate.split('\n')[1] || '') || !candidate.split('\n')[1]?.includes('|')) return;
      // The upstream tokenizer only handles escaped code-span pipes; normal
      // tables deliberately fall through to marked's built-in tokenizer.
      const token = helper.blockTokens(candidate)[0];
      if (token?.type !== 'table' || token.header?.length !== widths.length) return;
      return { ...token, raw: match[0] + token.raw, mdviewWidths: widths };
    },
  },
  addNodeView() {
    return ({ node: initial, editor, getPos }) => {
      let node = initial, drag = null;
      const doc = document, win = doc.defaultView;
      const dom = doc.createElement('div'); dom.className = 'mdview-table-scroll';
      const controls = doc.createElement('div'); controls.className = 'table-width-controls'; controls.contentEditable = 'false';
      controls.setAttribute('role','group'); controls.setAttribute('aria-label','表格宽度 / Table width');
      const overall = doc.createElement('button'); overall.type = 'button'; overall.dataset.resizeTable = '';
      overall.setAttribute('role','slider'); overall.setAttribute('aria-label','表格总宽度 / Total table width'); overall.setAttribute('aria-orientation','horizontal');
      overall.textContent = '↔'; overall.title = '拖动调整整个表格宽度；方向键微调 / Drag table width; arrow keys adjust';
      const reset = doc.createElement('button'); reset.type = 'button'; reset.textContent = '↺'; reset.setAttribute('aria-label','自动宽度 / Automatic width');
      reset.title = '恢复自动宽度 / Reset to automatic width';
      const columns = doc.createElement('div'); columns.className = 'table-column-widths';
      controls.append(overall,reset,columns);
      const table = doc.createElement('table'); table.className = 'mdview-width-table';
      const colgroup = doc.createElement('colgroup'), contentDOM = doc.createElement('tbody'); table.append(colgroup,contentDOM);
      const canvas = doc.createElement('div'); canvas.className = 'table-perimeter-canvas'; canvas.append(controls,table); dom.append(canvas);
      const perimeter = createTablePerimeter({ editor, getPos, controls, table, columns, overall, reset });
      function configured() { return widthsOf(node.toJSON()); }
      function currentWidths() {
        const scale = table.getBoundingClientRect().width / table.offsetWidth || 1;
        return configured() || Array.from(contentDOM.querySelector('tr')?.children || [],cell => clamp(cell.getBoundingClientRect().width / scale || 120));
      }
      function preview(widths) {
        canvas.style.width = widths ? `${widths.reduce((a,b)=>a+b,0)}px` : '';
        table.style.width = '100%';
        for (let i=0; i<colgroup.children.length; i++) colgroup.children[i].style.width = widths ? `${widths[i]}px` : '';
        for (let i=0; i<columns.children.length; i++) {
          const button = columns.children[i];
          button.setAttribute('aria-valuenow', String(widths?.[i] || 120));
        }
        const total = widths?.reduce((a,b)=>a+b,0) || Math.round(table.getBoundingClientRect().width) || 120*columns.children.length;
        overall.setAttribute('aria-valuenow',String(total)); overall.setAttribute('aria-valuemin',String(MIN*columns.children.length)); overall.setAttribute('aria-valuemax',String(MAX*columns.children.length));
        perimeter.schedule();
      }
      function commit(widths) {
        const pos = getPos();
        if (!editor.isEditable || typeof pos !== 'number' || editor.state.doc.nodeAt(pos) !== node) return;
        const tr = closeHistory(editor.state.tr);
        node.forEach((row,offset) => row.forEach((cell,cellOffset,i) => {
          const colwidth = widths ? [widths[i]] : null;
          if (JSON.stringify(cell.attrs.colwidth) !== JSON.stringify(colwidth)) tr.setNodeMarkup(pos+2+offset+cellOffset,undefined,{ ...cell.attrs,colwidth });
        }));
        if (tr.docChanged) { editor.view.dispatch(tr); editor.view.dispatch(closeHistory(editor.state.tr)); }
      }
      function finish(commitDrag) {
        if (!drag) return;
        const finished = drag; drag = null;
        win.removeEventListener('blur',cancel); win.removeEventListener('keydown',escape,true);
        if (finished.handle.hasPointerCapture(finished.id)) finished.handle.releasePointerCapture(finished.id);
        dom.classList.remove('table-resizing'); preview(configured());
        if (commitDrag && finished.moved && node === finished.node) commit(finished.widths);
      }
      function cancel() { finish(false); }
      function escape(event) { if(event.key==='Escape') { event.preventDefault(); event.stopPropagation(); cancel(); } }
      function resized(base,index,delta) {
        if (index !== null) return base.map((w,i)=>i===index ? clamp(w+delta) : w);
        const sum = base.reduce((a,b)=>a+b,0), factor = (sum+delta)/sum;
        return base.map(w=>clamp(w*factor));
      }
      controls.addEventListener('pointerdown',event => {
        const handle = event.target.closest('[data-resize-column],[data-resize-table]');
        if (!handle || !editor.isEditable || drag || event.button !== 0 || !event.isPrimary) return;
        event.preventDefault(); event.stopPropagation();
        const widths = currentWidths(); if (!widths.length) return;
        handle.setPointerCapture(event.pointerId);
        drag = { node,handle,id:event.pointerId,x:event.clientX,scale:table.getBoundingClientRect().width/table.offsetWidth || 1,base:widths,widths,index:handle.hasAttribute('data-resize-column') ? Number(handle.dataset.resizeColumn) : null,moved:false };
        dom.classList.add('table-resizing'); win.addEventListener('blur',cancel); win.addEventListener('keydown',escape,true);
      });
      function pointerMove(event) {
        if (!drag || drag.id!==event.pointerId) return;
        event.preventDefault(); const delta=(event.clientX-drag.x)/drag.scale; if(!delta && !drag.moved) return;
        drag.moved=true; drag.widths=resized(drag.base,drag.index,delta); preview(drag.widths);
      }
      function pointerUp(event) { if(drag?.id===event.pointerId) { event.preventDefault(); finish(true); } }
      win.addEventListener('pointermove', pointerMove);
      win.addEventListener('pointerup', pointerUp);
      for(const name of ['pointercancel','lostpointercapture']) controls.addEventListener(name,event=>{if(drag?.id===event.pointerId)cancel();});
      controls.addEventListener('keydown',event => {
        const handle=event.target.closest('[data-resize-column],[data-resize-table]');
        if (!handle || !editor.isEditable || !['ArrowLeft','ArrowRight'].includes(event.key) || event.ctrlKey || event.metaKey || event.altKey) return;
        event.preventDefault(); event.stopPropagation();
        commit(resized(currentWidths(),handle.hasAttribute('data-resize-column') ? Number(handle.dataset.resizeColumn) : null,(event.key==='ArrowRight'?1:-1)*(event.shiftKey?50:10)));
      });
      controls.addEventListener('mousedown',event=>event.preventDefault());
      reset.addEventListener('click',()=>commit(null));
      function syncEditable() { controls.hidden=!editor.isEditable; if(!editor.isEditable) cancel(); perimeter.schedule(); }
      function sync() {
        const count=node.firstChild.childCount;
        while(colgroup.children.length<count) colgroup.append(doc.createElement('col'));
        while(colgroup.children.length>count) colgroup.lastChild.remove();
        if(columns.children.length!==count) {
          columns.replaceChildren();
          for(let i=0;i<count;i++) {
            const button=doc.createElement('button'); button.type='button'; button.dataset.resizeColumn=String(i);
            button.setAttribute('role','slider'); button.setAttribute('aria-orientation','horizontal'); button.setAttribute('aria-valuemin',String(MIN)); button.setAttribute('aria-valuemax',String(MAX));
            button.setAttribute('aria-label',`调整第 ${i+1} 列宽 / Resize column ${i+1}`);
            button.title='拖动或方向键调整列宽 / Drag or arrow keys to resize column'; columns.append(button);
          }
        }
        preview(configured()); syncEditable();
      }
      editor.on('transaction',syncEditable); editor.on('update',syncEditable); sync();
      return { dom,contentDOM,
        update(current) { if(current.type!==node.type)return false; if(drag && current!==node)cancel(); node=current; sync(); return true; },
        stopEvent:event=>controls.contains(event.target),
        ignoreMutation:mutation=>mutation.type!=='selection' && !contentDOM.contains(mutation.target),
        destroy() { cancel(); perimeter.destroy(); win.removeEventListener('pointermove',pointerMove); win.removeEventListener('pointerup',pointerUp); editor.off('transaction',syncEditable); editor.off('update',syncEditable); },
      };
    };
  },
});
