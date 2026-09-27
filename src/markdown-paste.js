import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { DOMParser, Slice } from '@tiptap/pm/model';
import { closeHistory } from '@tiptap/pm/history';
import { renderEditorHtml } from './markdown-parser.cjs';
import { serializeMarkdown } from './markdown-extensions.js';

const LIMIT = 10 * 1024 * 1024;
// Deliberately conservative: prose, bare URLs and isolated list-like lines stay
// ordinary clipboard text. Source markers win over browser-generated text/html.
export function looksLikeMarkdown(text) {
  return /^(?: {0,3}#{1,6}\s+\S| {0,3}(?:`{3,}|~{3,})[^\n]*$)/m.test(text)
    || /(?:^|\n) {0,3}(?:[-+*]|\d+[.)])\s+[^\n]+\n(?:[ \t]*\n)*[ \t]*(?:[-+*]|\d+[.)])\s+\S/.test(text)
    || /^(?=.*\|)[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*(?:\|[ \t]*:?-{3,}:?[ \t]*)+\|?[ \t]*$/m.test(text)
    || /(?:\*\*[^*\n]+\*\*|__[^_\n]+__|==[^=\n]+==|\[[^\]\n]+\]\([^\s)]+\)|<u>[^\n]+<\/u>|<(?:mark|span) data-color="#[\da-fA-F]{6}">)/.test(text);
}

// Also used for initial reconstruction: fenced-code terminators and table
// alignment must mean the same thing when opened from disk and when pasted.
export function prepareEditorHtml(html) {
  const content = document.createElement('div');
  content.innerHTML = html;
  for (const block of content.querySelectorAll('.code-block')) {
    const pre = block.querySelector('pre');
    const code = pre.querySelector('code');
    code.textContent = code.textContent.replace(/\n$/, '');
    block.replaceWith(pre);
  }
  for (const cell of content.querySelectorAll('th,td')) {
    const align = [...cell.classList].find(name => name.startsWith('align-'));
    if (align) cell.style.textAlign = align.slice(6);
  }
  return content;
}

export function markdownPaste(doc, reportError) {
  return Extension.create({
    name: 'markdownPaste',
    addProseMirrorPlugins() {
      const owner = this.editor;
      let plainPaste = false;
      return [new Plugin({ props: { handleDOMEvents: {
        // No native menu overrides Ctrl+Shift+V: Chromium delivers text-only
        // paste. Remember the modifier because ClipboardEvent has no shiftKey.
        keydown(_view, event) {
          plainPaste = event.key.toLowerCase() === 'v' && (event.ctrlKey || event.metaKey) && event.shiftKey;
          return false;
        },
        keyup() { plainPaste = false; return false; },
        blur() { plainPaste = false; return false; },
        paste(view, event) {
          const literal = plainPaste; plainPaste = false;
          const clipboard = event.clipboardData;
          if (!owner.isEditable || !event.isTrusted || !clipboard) return false;
          // ImagePaste retains first refusal, even for mixed image/text data.
          if ([...clipboard.files].some(file => file.type.startsWith('image/'))) return false;
          const text = clipboard.getData('text/plain').replace(/\r\n?/g, '\n');
          if (!text || literal || view.state.selection.$from.parent.type.spec.code) return false;
          if (!looksLikeMarkdown(text)) return false;
          event.preventDefault();
          try {
            if (text.length > LIMIT || new TextEncoder().encode(text).length > LIMIT) throw Error('粘贴内容超过 10 MB。');
            // Synchronous local restricted parsing: no async bookmark, document
            // switch race, filesystem, URL fetching or raw-HTML interpretation.
            const content = prepareEditorHtml(renderEditorHtml(text));
            let slice = DOMParser.fromSchema(view.state.schema).parseSlice(content, { preserveWhitespace: true });
            // Keep structural boundaries closed: otherwise an initial heading
            // becomes the surrounding paragraph and trailing prose joins code.
            if (slice.content.childCount !== 1 || slice.content.firstChild.type.name !== 'paragraph') slice = new Slice(slice.content, 0, 0);
            const tr = view.state.tr.replaceSelection(slice);
            const source = serializeMarkdown(owner.markdown, tr.doc.toJSON()).replace(/\r\n?/g, '\n').replace(/\n/g, doc.newline || '\n');
            if (new TextEncoder().encode(source).length + (doc.bom ? 3 : 0) > LIMIT) throw Error('粘贴后文档超过 10 MB 保存上限。');
            view.dispatch(closeHistory(tr).setMeta('paste', true).setMeta('uiEvent', 'paste').scrollIntoView());
            view.dispatch(closeHistory(view.state.tr));
          } catch (error) { reportError(error.message || 'Markdown 粘贴失败。'); }
          return true;
        }
      } } })];
    }
  });
}
