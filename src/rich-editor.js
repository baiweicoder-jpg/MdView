import { Editor, Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import hljs from 'highlight.js/lib/common';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { TableKit, TableCell, TableHeader } from '@tiptap/extension-table';
import Image from '@tiptap/extension-image';

export function create(element, doc, onChange) {
  let assets = doc.assets || {};
  const CodeStyle = Extension.create({
    name: 'codeStyle',
    addProseMirrorPlugins() {
      return [new Plugin({ props: {
        decorations(state) {
          const marks = [];
          state.doc.descendants((node, pos) => {
            if (node.type.name !== 'codeBlock' || !hljs.getLanguage(node.attrs.language || '')) return;
            const fragment = document.createElement('div');
            fragment.innerHTML = hljs.highlight(node.textContent, { language: node.attrs.language, ignoreIllegals: true }).value;
            let offset = pos + 1;
            function visit(parent) {
              for (const child of parent.childNodes) {
                const start = offset;
                if (child.nodeType === 3) offset += child.textContent.length;
                else { visit(child); if (offset > start && child.className) marks.push(Decoration.inline(start, offset, { class: child.className })); }
              }
            }
            visit(fragment);
          });
          return DecorationSet.create(state.doc, marks);
        },
        nodeViews: {
          codeBlock(node) {
            const dom = document.createElement('section'); dom.className = 'code-block';
            dom.innerHTML = '<div class="code-toolbar" contenteditable="false"><span class="code-language"></span><div class="code-actions"><button type="button" data-code-zoom="-1">A−</button><button type="button" data-code-zoom="0" class="code-zoom-reset">100%</button><button type="button" data-code-zoom="1">A＋</button><button type="button" class="expand-code">单独查看</button><button type="button" class="copy-code">复制</button></div></div><pre><code></code></pre>';
            dom.querySelector('.code-language').textContent = node.attrs.language || 'text';
            return { dom, contentDOM: dom.querySelector('code'), ignoreMutation: mutation => !dom.querySelector('code').contains(mutation.target) && mutation.type !== 'selection' };
          }
        }
      } })];
    }
  });
  const SafeImage = Image.extend({
    addAttributes() { return { ...this.parent(), src: { default: null, parseHTML: element => element.getAttribute('data-md-src') || element.getAttribute('src') } }; },
    addNodeView() {
      return ({ node }) => {
        const dom = document.createElement('span');
        dom.className = 'editor-image';
        dom.dataset.imageSource = node.attrs.src;
        const image = document.createElement('img');
        image.alt = node.attrs.alt || '图片';
        if (assets[node.attrs.src]) { image.src = assets[node.attrs.src]; dom.append(image); }
        else dom.textContent = `[图片未加载：${node.attrs.alt || node.attrs.src}]`;
        return { dom };
      };
    }
  });
  const content = document.createElement('div');
  content.innerHTML = doc.editorHtml;
  for (const block of content.querySelectorAll('.code-block')) block.replaceWith(block.querySelector('pre'));
  for (const cell of content.querySelectorAll('th,td')) {
    const align = [...cell.classList].find(name => name.startsWith('align-'));
    if (align) cell.style.textAlign = align.slice(6);
  }
  const editor = new Editor({
    element,
    extensions: [StarterKit.configure({ link: { openOnClick: false }, undoRedo: {} }), Markdown, SafeImage, CodeStyle, TableKit.configure({ tableCell: false, tableHeader: false }), TableCell.extend({ content: 'paragraph' }), TableHeader.extend({ content: 'paragraph' })],
    content: content.innerHTML,
    editorProps: { attributes: { 'aria-label': '直接编辑 Markdown 内容', role: 'textbox', 'aria-multiline': 'true' } },
    onUpdate: () => onChange(),
  });
  editor.view.dispatch(editor.state.tr);
  let baseline = editor.getMarkdown(), original = doc.source;
  return {
    editor,
    source: () => editor.getMarkdown() === baseline ? original : editor.getMarkdown(),
    saved(snapshot, raw) { baseline = snapshot === original ? baseline : snapshot; original = raw; },
    destroy: () => editor.destroy(),
  };
}
