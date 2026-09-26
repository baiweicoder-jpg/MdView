import { Editor, Extension } from '@tiptap/core';
import { Plugin, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import hljs from 'highlight.js/lib/common';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { TableKit, TableCell, TableHeader } from '@tiptap/extension-table';
import Image from '@tiptap/extension-image';
import { markdownEditingExtensions, serializeMarkdown } from './markdown-extensions.js';

export function create(element, doc, onChange) {
  let assets = doc.assets || {};
  const CodeStyle = Extension.create({
    name: 'codeStyle',
    // Run before StarterKit's list/table keymaps, but only claim a single code block.
    priority: 1100,
    addKeyboardShortcuts() {
      const indent = outdent => {
        const { state, view, isEditable } = this.editor;
        const { selection } = state;
        const { $from, $to, from, to, empty, anchor, head } = selection;
        if (!isEditable || !(selection instanceof TextSelection) || $from.parent.type.name !== 'codeBlock' || !$from.sameParent($to)) return false;
        const tr = state.tr;
        if (empty && !outdent) {
          tr.insertText('  ', from);
        } else {
          const text = $from.parent.textContent;
          const start = $from.start();
          const first = text.slice(0, from - start).lastIndexOf('\n') + 1;
          // A selection ending at the next line's start does not include that line.
          const last = empty ? to - start : to - start - 1;
          const edits = [];
          for (let offset = first; offset <= last;) {
            const remove = outdent ? (text[offset] === '\t' ? 1 : (text.slice(offset).match(/^ {1,2}/)?.[0].length || 0)) : 0;
            if (!outdent || remove) edits.push({ pos: start + offset, remove });
            const newline = text.indexOf('\n', offset);
            if (newline < 0) break;
            offset = newline + 1;
          }
          // Work backwards so every edit uses the original document coordinates.
          for (const { pos, remove } of edits.reverse()) {
            if (outdent) tr.delete(pos, pos + remove);
            else tr.insertText('  ', pos);
          }
        }
        tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(anchor), tr.mapping.map(head)));
        if (tr.docChanged) view.dispatch(tr.scrollIntoView());
        return true;
      };
      return { Tab: () => indent(false), 'Shift-Tab': () => indent(true) };
    },
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
          codeBlock(node, view, getPos) {
            const dom = document.createElement('section'); dom.className = 'code-block';
            dom.innerHTML = '<div class="code-toolbar" contenteditable="false"><select class="code-language" aria-label="Code language" title="Code language"></select><div class="code-actions"><button type="button" data-code-zoom="-1">A−</button><button type="button" data-code-zoom="0" class="code-zoom-reset">100%</button><button type="button" data-code-zoom="1">A＋</button><button type="button" class="expand-code">单独查看</button><button type="button" class="copy-code">复制</button></div></div><pre><code></code></pre>';
            const select = dom.querySelector('select');
            const code = dom.querySelector('code');
            const languages = hljs.listLanguages().sort();
            select.add(new Option('Plain text', ''));
            for (const language of languages) select.add(new Option(hljs.getLanguage(language).name || language, language));
            function syncLanguage(current) {
              const language = current.attrs.language || '';
              // Keep aliases and custom fence labels verbatim, including through undo.
              if (![...select.options].some(option => option.value === language)) select.add(new Option(language, language));
              select.value = language;
              select.disabled = !view.editable;
            }
            syncLanguage(node);
            select.addEventListener('change', () => {
              const pos = getPos();
              if (!view.editable || typeof pos !== 'number') return;
              const current = view.state.doc.nodeAt(pos);
              if (current?.type.name !== 'codeBlock') return;
              // Change only this node's attributes; never replace its text or selection.
              const tr = view.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, language: select.value || null });
              tr.setSelection(view.state.selection.map(tr.doc, tr.mapping));
              view.dispatch(tr);
              view.focus();
            });
            return {
              dom, contentDOM: code,
              update(current) {
                if (current.type !== node.type) return false;
                node = current; syncLanguage(current); return true;
              },
              stopEvent: event => select.contains(event.target),
              ignoreMutation: mutation => !code.contains(mutation.target) && mutation.type !== 'selection'
            };
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
    extensions: [StarterKit.configure({ underline: false, link: { openOnClick: false }, undoRedo: {} }), Markdown, ...markdownEditingExtensions, SafeImage, CodeStyle, TableKit.configure({ tableCell: false, tableHeader: false }), TableCell.extend({ content: 'paragraph' }), TableHeader.extend({ content: 'paragraph' })],
    content: content.innerHTML,
    editorProps: { attributes: { 'aria-label': '直接编辑 Markdown 内容', role: 'textbox', 'aria-multiline': 'true' } },
    onUpdate: () => onChange(),
  });
  editor.getMarkdown = () => serializeMarkdown(editor.markdown, editor.getJSON());
  editor.view.dispatch(editor.state.tr);
  let baseline = editor.getMarkdown(), original = doc.source;
  return {
    editor,
    source: () => editor.getMarkdown() === baseline ? original : editor.getMarkdown(),
    saved(snapshot, raw) { baseline = snapshot === original ? baseline : snapshot; original = raw; },
    destroy: () => editor.destroy(),
  };
}
