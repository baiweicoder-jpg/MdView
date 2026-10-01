import { Editor, Extension } from '@tiptap/core';
import { Plugin, TextSelection } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import hljs from 'highlight.js/lib/common';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { TableKit, TableCell, TableHeader } from '@tiptap/extension-table';
import Image from '@tiptap/extension-image';
import { markdownEditingExtensions, serializeMarkdown } from './markdown-extensions.js';
import { installContentSearch } from './content-search-editor.js';
import { installTableControls } from './table-controls.js';
import { installImageGroupControls } from './image-group-controls.js';
import { planCleanup, applyCleanup } from './text-cleanup.cjs';
import { markdownPaste, prepareEditorHtml } from './markdown-paste.js';

export function create(element, doc, onChange) {
  const assets = Object.assign(Object.create(null), doc.assets || {});
  const pendingPastes = new Set();
  const MAX_PNG = 2 * 1024 * 1024, MAX_INPUT = 8 * 1024 * 1024;
  const encodedSize = value => typeof value === 'string' && value.includes(';base64,') ? Math.floor(value.split(';base64,')[1].length * 3 / 4) : 0;
  // IPC/main approves file assets. Embedded draft images also need a strict local
  // check because a tab can reconstruct editorHtml with an older assets snapshot.
  function embeddedPng(src) {
    const prefix = 'data:image/png;base64,';
    if (typeof src !== 'string' || !src.startsWith(prefix) || src.length > prefix.length + 4 * Math.ceil(MAX_PNG / 3)) return '';
    try {
      const encoded = src.slice(prefix.length), bytes = atob(encoded);
      if (bytes.length > MAX_PNG || btoa(bytes) !== encoded || bytes.slice(0, 8) !== '\x89PNG\r\n\x1a\n' || bytes.slice(12, 16) !== 'IHDR') return '';
      const int = offset => ((bytes.charCodeAt(offset) * 0x1000000) + (bytes.charCodeAt(offset + 1) << 16) + (bytes.charCodeAt(offset + 2) << 8) + bytes.charCodeAt(offset + 3));
      const width = int(16), height = int(20);
      if (int(8) !== 13 || !width || !height || width > 8192 || height > 8192 || width * height > 16 * 1024 * 1024) return '';
      let offset = 8, idat = false;
      while (offset + 12 <= bytes.length) {
        const length = int(offset), type = bytes.slice(offset + 4, offset + 8);
        if (length > bytes.length - offset - 12 || type === 'acTL') return '';
        if (type === 'IDAT') idat = true;
        offset += length + 12;
        if (type === 'IEND') return length === 0 && offset === bytes.length && idat ? src : '';
      }
    } catch { /* Invalid base64 is an inert missing image. */ }
    return '';
  }
  function reportPasteError(message) {
    // Keep errors local and accessible without coupling to renderer globals.
    let notice = element.querySelector('.image-paste-notice');
    if (!notice) { notice = document.createElement('div'); notice.className = 'image-paste-notice'; notice.setAttribute('role', 'alert'); element.append(notice); }
    notice.textContent = message;
  }
  const ImagePaste = Extension.create({
    name: 'imagePaste',
    addProseMirrorPlugins() {
      const owner = this.editor;
      return [new Plugin({
        state: { init: () => null, apply(tr) { for (const pending of pendingPastes) pending.bookmark = pending.bookmark.map(tr.mapping); return null; } },
        props: { handleDOMEvents: { paste(view, event) {
          const files = [...(event.clipboardData?.files || [])];
          if (!files.length || !files.some(file => file.type.startsWith('image/'))) return false;
          // Never read clipboard from a timer, mount, or synthetic DOM event.
          if (!event.isTrusted || !owner.isEditable) return false;
          event.preventDefault();
          if (pendingPastes.size || files.length !== 1 || files[0].type !== 'image/png' || files[0].size > MAX_INPUT) {
            reportPasteError('请一次粘贴一张 PNG 图片（输入不超过 8 MB）。'); return true;
          }
          const pending = { bookmark: view.state.selection.getBookmark() };
          pendingPastes.add(pending);
          (async () => {
            try {
              const bytes = new Uint8Array(await files[0].arrayBuffer());
              if (owner.isDestroyed) return;
              const result = await window.mdview.pasteImage(bytes);
              if (owner.isDestroyed || !owner.isEditable || !pendingPastes.has(pending)) return;
              if (!result.ok || !embeddedPng(result.dataUrl)) throw Error(result.message || '图片数据无效。');
              const tr = view.state.tr.setSelection(pending.bookmark.resolve(view.state.doc));
              tr.replaceSelectionWith(view.state.schema.nodes.image.create({ src: result.dataUrl, alt: '图片' }));
              const source = serializeMarkdown(owner.markdown, tr.doc.toJSON());
              const diskSource = source.replace(/\r\n?/g, '\n').replace(/\n/g, doc.newline || '\n');
              if (new TextEncoder().encode(diskSource).length + (doc.bom ? 3 : 0) > 10 * 1024 * 1024) throw Error('粘贴后文档超过 10 MB 保存上限。');
              const seen = new Set(); let total = 0;
              tr.doc.descendants(node => { if (node.type.name !== 'image' || seen.has(node.attrs.src)) return; seen.add(node.attrs.src); total += encodedSize(assets[node.attrs.src] || embeddedPng(node.attrs.src)); });
              if (total > 24 * 1024 * 1024) throw Error('图片总大小超过 24 MB。');
              assets[result.dataUrl] = result.dataUrl;
              pendingPastes.delete(pending);
              view.dispatch(closeHistory(tr).scrollIntoView());
              view.dispatch(closeHistory(view.state.tr));
              element.querySelector('.image-paste-notice')?.remove();
            } catch (error) { if (!owner.isDestroyed) reportPasteError(error.message || '图片粘贴失败。'); }
            finally { pendingPastes.delete(pending); }
          })();
          return true;
        } } }
      })];
    }
  });
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
            dom.innerHTML = '<div class="code-toolbar" contenteditable="false"><select class="code-language" aria-label="Code language" title="Code language"></select><div class="code-actions"><button type="button" class="collapse-code" aria-expanded="true" title="折叠 / Collapse code">折叠 / Fold</button><button type="button" class="wrap-code" aria-pressed="false" title="自动换行 / Wrap long lines">换行 / Wrap</button><button type="button" data-code-zoom="-1">A−</button><button type="button" data-code-zoom="0" class="code-zoom-reset">100%</button><button type="button" data-code-zoom="1">A＋</button><button type="button" class="remove-blank-lines" title="删除此代码块的空行（可撤销） / Remove blank lines (undoable)">去空行 / Clean</button><button type="button" class="expand-code">单独查看</button><button type="button" class="copy-code">复制</button></div></div><pre><code></code></pre>';
            const select = dom.querySelector('select');
            const code = dom.querySelector('code');
            const clean = dom.querySelector('.remove-blank-lines');
            const toolbar = dom.querySelector('.code-toolbar');
            // Keep pointer clicks on buttons from replacing the editor selection.
            toolbar.addEventListener('mousedown', event => {
              if (event.target.closest('button')) event.preventDefault();
            });
            clean.addEventListener('click', () => {
              const pos = getPos();
              if (!view.editable || typeof pos !== 'number') return;
              const current = view.state.doc.nodeAt(pos);
              if (current?.type.name !== 'codeBlock') return;
              const lines = current.textContent.split('\n');
              const ranges = [];
              const lastContentLine = lines.findLastIndex(line => line.trim());
              let offset = 0;
              for (let i = 0; i < lines.length; i++) {
                const end = offset + lines[i].length;
                if (!lines[i].trim()) {
                  const from = i > lastContentLine ? Math.max(0, offset - 1) : offset;
                  const to = i === lines.length - 1 ? end : end + 1;
                  const previous = ranges.at(-1);
                  if (previous && previous.to >= from) previous.to = to;
                  else if (to > from) ranges.push({ from, to });
                }
                offset = end + 1;
              }
              if (!ranges.length) return;
              const tr = closeHistory(view.state.tr);
              for (const { from, to } of ranges.reverse()) tr.delete(pos + 1 + from, pos + 1 + to);
              tr.setSelection(view.state.selection.map(tr.doc, tr.mapping));
              view.dispatch(tr);
              view.dispatch(closeHistory(view.state.tr));
              view.focus();
            });
            const languages = hljs.listLanguages().sort();
            select.add(new Option('Plain text', ''));
            for (const language of languages) select.add(new Option(hljs.getLanguage(language).name || language, language));
            function syncLanguage(current) {
              const language = current.attrs.language || '';
              // Keep aliases and custom fence labels verbatim, including through undo.
              if (![...select.options].some(option => option.value === language)) select.add(new Option(language, language));
              select.value = language;
              select.disabled = !view.editable;
              clean.disabled = !view.editable || !current.textContent.split('\n').some(line => !line.trim()) || !current.textContent;
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
              stopEvent: event => toolbar.contains(event.target),
              ignoreMutation: mutation => !code.contains(mutation.target) && mutation.type !== 'selection'
            };
          }
        }
      } })];
    }
  });
  const ImageMove = Extension.create({
    name: 'imageMove',
    addProseMirrorPlugins() {
      const imageDrag = view => {
        const slice = view.dragging?.slice;
        return slice?.content.childCount === 1 && slice.content.firstChild.type.name === 'image';
      };
      return [new Plugin({
        view(view) {
          // Run before Tiptap paste-rule drop handlers, which can schedule a
          // deletion in the drag-source editor even for an unrelated OS file.
          // Bubble to the application file opener, but skip editor processing.
          const fileDrop = event => { if (event.dataTransfer?.files.length) event.preventDefault(); };
          view.dom.addEventListener('drop', fileDrop, true);
          return { destroy() { view.dom.removeEventListener('drop', fileDrop, true); } };
        },
        appendTransaction: (transactions, _old, state) => {
          if (transactions.some(tr => tr.getMeta('uiEvent') === 'drop') && imageDrag(this.editor.view)) return closeHistory(state.tr);
        },
        props: {
          // Image-body gestures are moves even with the platform copy modifier.
          // Leave text drag/copy semantics untouched.
          dragCopies: () => imageDrag(this.editor.view) ? false : undefined,
          handleDrop(view) {
            if (!imageDrag(view)) return false;
            view.dispatch(closeHistory(view.state.tr));
            return false; // Native PM handles dropPoint, deletion, mapping and selection.
          },
        },
      })];
    },
  });
  const imageWidth = value => /^\d+$/.test(String(value)) && Number(value) >= 32 && Number(value) <= 1600 ? Number(value) : null;
  const SafeImage = Image.extend({
    addAttributes() { return { ...this.parent(),
      src: { default: null, parseHTML: element => element.getAttribute('data-md-src') || element.getAttribute('src') },
      width: { default: null, parseHTML: element => imageWidth(element.getAttribute('width')) },
    }; },
    renderMarkdown(node) {
      // Escape attribute delimiters, never rewrite the image's source attribute.
      const escape = value => String(value || '').replace(/([\\\[\]"()<>])/g, '\\$1');
      const src = escape(node.attrs.src);
      const destination = /\s/.test(src) ? `<${src}>` : src;
      const title = node.attrs.title ? ` "${escape(node.attrs.title)}"` : '';
      const width = imageWidth(node.attrs.width);
      return `![${escape(node.attrs.alt)}](${destination}${title})${width ? `{width=${width}}` : ''}`;
    },
    addNodeView() {
      return ({ node, editor: owner, getPos }) => {
        const dom = document.createElement('span');
        dom.className = 'editor-image';
        dom.contentEditable = 'false';
        const image = document.createElement('img');
        const missing = document.createElement('span');
        const controls = document.createElement('span');
        controls.className = 'image-size-controls';
        controls.setAttribute('role', 'group');
        controls.setAttribute('aria-label', '图片尺寸 / Image size');
        const buttons = [
          ['decrease', '−', '缩小图片 / Smaller image', -32],
          ['reset', '↺', '原始尺寸 / Original size', 0],
          ['increase', '+', '放大图片 / Larger image', 32],
        ].map(([name, text, label, delta]) => {
          const button = document.createElement('button');
          button.type = 'button'; button.className = `image-size-${name}`;
          button.textContent = text; button.title = label; button.setAttribute('aria-label', label);
          button.addEventListener('mousedown', event => event.preventDefault());
          button.addEventListener('click', () => {
            const pos = getPos();
            if (!owner.isEditable || typeof pos !== 'number') return;
            const current = owner.state.doc.nodeAt(pos);
            if (current?.type.name !== 'image') return;
            const base = imageWidth(current.attrs.width) || Math.round(image.getBoundingClientRect().width) || 320;
            const width = delta ? Math.max(32, Math.min(1600, base + delta)) : null;
            if (current.attrs.width === width) return;
            // Separate each adjustment from typing, pasting and other images.
            owner.view.dispatch(closeHistory(owner.state.tr).setNodeMarkup(pos, undefined, { ...current.attrs, width }));
            owner.view.dispatch(closeHistory(owner.state.tr));
          });
          controls.append(button); return button;
        });
        // Preview only in the NodeView: a completed gesture writes one history step.
        // Cancellation never changes the document (or dirties an untouched draft).
        let drag = null;
        image.draggable = false;
        const handles = document.createElement('span');
        handles.className = 'image-resize-handles';
        handles.setAttribute('aria-hidden', 'true');
        for (const direction of ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']) {
          const handle = document.createElement('span');
          handle.className = `image-resize-handle image-resize-${direction}`;
          handle.dataset.direction = direction;
          handles.append(handle);
        }
        function finishDrag(commit = false) {
          if (!drag) return;
          const finished = drag;
          drag = null;
          owner.view.dom.classList.remove('image-resizing');
          dom.classList.remove('image-resizing');
          window.removeEventListener('blur', cancelDrag);
          window.removeEventListener('keydown', escapeDrag, true);
          if (finished.handle.hasPointerCapture(finished.id)) finished.handle.releasePointerCapture(finished.id);
          sync(node);
          if (!commit || !owner.isEditable || owner.isDestroyed) return;
          const pos = getPos();
          const current = typeof pos === 'number' ? owner.state.doc.nodeAt(pos) : null;
          if (current !== finished.node || !finished.moved || current.attrs.width === finished.width) return;
          owner.view.dispatch(closeHistory(owner.state.tr).setNodeMarkup(pos, undefined, { ...current.attrs, width: finished.width }));
          owner.view.dispatch(closeHistory(owner.state.tr));
        }
        function cancelDrag() { finishDrag(false); }
        function escapeDrag(event) {
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelDrag(); }
        }
        handles.addEventListener('pointerdown', event => {
          const handle = event.target.closest('.image-resize-handle');
          if (!handle || drag || !owner.isEditable || event.button !== 0 || !event.isPrimary) return;
          const pos = getPos();
          if (typeof pos !== 'number' || owner.state.doc.nodeAt(pos) !== node) return;
          const rect = image.getBoundingClientRect();
          if (image.hidden || !rect.width || !rect.height) return;
          event.preventDefault(); event.stopPropagation();
          owner.commands.setNodeSelection(pos);
          try { handle.setPointerCapture(event.pointerId); } catch { return; }
          drag = { handle, id: event.pointerId, node, x: event.clientX, y: event.clientY,
            base: rect.width, ratio: rect.width / rect.height, width: rect.width, direction: handle.dataset.direction, moved: false };
          owner.view.dom.classList.add('image-resizing');
          dom.classList.add('image-resizing');
          window.addEventListener('blur', cancelDrag);
          window.addEventListener('keydown', escapeDrag, true);
        });
        handles.addEventListener('pointermove', event => {
          if (!drag || drag.id !== event.pointerId) return;
          event.preventDefault(); event.stopPropagation();
          const dx = (event.clientX - drag.x) * (drag.direction.includes('w') ? -1 : 1);
          const dy = (event.clientY - drag.y) * (drag.direction.includes('n') ? -1 : 1) * drag.ratio;
          // Corners follow the dominant axis; all eight handles retain aspect ratio.
          const horizontal = /[ew]/.test(drag.direction), vertical = /[ns]/.test(drag.direction);
          const delta = horizontal && vertical ? (Math.abs(dx) >= Math.abs(dy) ? dx : dy) : horizontal ? dx : dy;
          if (!delta && !drag.moved) return;
          drag.moved = true;
          drag.width = Math.max(32, Math.min(1600, Math.round(drag.base + delta)));
          image.setAttribute('width', drag.width);
        });
        handles.addEventListener('pointerup', event => {
          if (drag?.id !== event.pointerId) return;
          event.preventDefault(); event.stopPropagation(); finishDrag(true);
        });
        for (const type of ['pointercancel', 'lostpointercapture']) handles.addEventListener(type, event => {
          if (drag?.id === event.pointerId) cancelDrag();
        });
        // Keep native drags local to this editor. Tiptap's cross-editor paste
        // rules otherwise schedule deletion of the original selection when an
        // image is dropped onto a different editor, outside this document.
        let moveDocument = null;
        function stopMove() {
          moveDocument = null;
          document.removeEventListener('drop', guardMoveDrop, true);
          document.removeEventListener('dragend', stopMove, true);
        }
        function guardMoveDrop(event) {
          if (owner.isDestroyed || !owner.isEditable || !owner.view.dom.contains(event.target)
            || owner.state.doc !== moveDocument || owner.state.selection.node !== node) {
            event.preventDefault(); event.stopPropagation();
            if (!owner.isDestroyed) owner.view.dragging = null;
          }
          stopMove();
        }
        // Let ProseMirror serialize and move the actual node, not the rendered
        // data-URL image. Size controls retain their own pointer gestures.
        dom.addEventListener('dragstart', event => {
          if (!owner.isEditable || drag || controls.contains(event.target) || handles.contains(event.target)) { event.preventDefault(); return; }
          const pos = getPos();
          if (typeof pos !== 'number' || owner.state.doc.nodeAt(pos) !== node) { event.preventDefault(); return; }
          // Even inside a larger text selection, dragging the body moves only
          // this image. PM then owns the native slice and move transaction.
          owner.commands.setNodeSelection(pos);
          moveDocument = owner.state.doc;
          document.addEventListener('drop', guardMoveDrop, true);
          document.addEventListener('dragend', stopMove, true);
        });
        function syncEditable() {
          controls.hidden = !owner.isEditable;
          handles.hidden = !owner.isEditable || image.hidden;
          if (drag && (!owner.isEditable || owner.state.selection.from !== getPos() || !owner.state.selection.node)) cancelDrag();
        }
        owner.on('transaction', syncEditable);
        owner.on('update', syncEditable);
        dom.append(image, missing, controls, handles);
        function sync(current) {
          node = current;
          dom.dataset.imageSource = node.attrs.src;
          image.alt = node.attrs.alt || '图片';
          image.title = node.attrs.title || '';
          const safeSource = node.attrs.src?.startsWith('data:') ? embeddedPng(node.attrs.src) : assets[node.attrs.src];
          if (safeSource) { if (image.getAttribute('src') !== safeSource) image.src = safeSource; }
          else image.removeAttribute('src');
          image.hidden = !safeSource; missing.hidden = !!safeSource;
          missing.textContent = safeSource ? '' : `[图片未加载：${node.attrs.alt || node.attrs.src}]`;
          const width = imageWidth(node.attrs.width);
          if (width) image.setAttribute('width', width); else image.removeAttribute('width');
          buttons[0].disabled = !owner.isEditable || width === 32;
          buttons[1].disabled = !owner.isEditable || !width;
          buttons[2].disabled = !owner.isEditable || width === 1600;
          dom.title = width ? `${width}px` : '原始尺寸 / Original size';
          syncEditable();
        }
        sync(node);
        return {
          dom,
          update(current) { if (current.type !== node.type) return false; if (drag && current !== node) cancelDrag(); sync(current); return true; },
          selectNode() { dom.classList.add('ProseMirror-selectednode'); },
          deselectNode() { cancelDrag(); dom.classList.remove('ProseMirror-selectednode'); },
          stopEvent: event => controls.contains(event.target) || handles.contains(event.target),
          ignoreMutation: mutation => mutation.type !== 'selection',
          destroy() { stopMove(); cancelDrag(); owner.off('transaction', syncEditable); owner.off('update', syncEditable); },
        };
      };
    }
  });
  const content = prepareEditorHtml(doc.editorHtml);
  const editor = new Editor({
    element,
    // Pasting a URL replaces selected content; it must not turn that content into a link.
    extensions: [StarterKit.configure({ underline: false, link: { openOnClick: false, linkOnPaste: false }, undoRedo: {} }), Markdown, ...markdownEditingExtensions, SafeImage.configure({ allowBase64: true, inline: true }), ImagePaste, markdownPaste(doc, reportPasteError), ImageMove, CodeStyle, TableKit.configure({ tableCell: false, tableHeader: false }), TableCell.extend({ content: 'paragraph' }), TableHeader.extend({ content: 'paragraph' })],
    content: content.innerHTML,
    editorProps: { attributes: { 'aria-label': '直接编辑 Markdown 内容', role: 'textbox', 'aria-multiline': 'true' } },
    onUpdate: () => onChange(),
  });
  editor.getMarkdown = () => serializeMarkdown(editor.markdown, editor.getJSON());
  installTableControls(editor);
  installImageGroupControls(editor);
  editor.view.dispatch(editor.state.tr);
  const searchHighlights = installContentSearch(editor);
  let baseline = editor.getMarkdown(), original = doc.source;
  return {
    editor,
    searchHighlights,
    planCleanup: kind => planCleanup(editor.state, kind),
    applyCleanup: plan => applyCleanup(editor, plan),
    deleteSearchMatch(hit, query, caseSensitive) {
      if (!editor.isEditable || !query || editor.isDestroyed) return false;
      const range = searchHighlights([hit], 0, query, caseSensitive)[0];
      if (!range) return false;
      const actual = editor.state.doc.textBetween(range.from, range.to, '', node => node.type.name === 'hardBreak' ? '\n' : '\ufffc');
      const pattern = new RegExp('^(?:' + query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')$', caseSensitive ? 'u' : 'iu');
      if (!pattern.test(actual) || actual.includes('\ufffc')) return false;
      editor.view.dispatch(closeHistory(editor.state.tr.delete(range.from, range.to)));
      editor.view.dispatch(closeHistory(editor.state.tr));
      return true;
    },
    source: () => editor.getMarkdown() === baseline ? original : editor.getMarkdown(),
    saved(snapshot, raw) { baseline = snapshot === original ? baseline : snapshot; original = raw; },
    destroy: () => editor.destroy(),
  };
}
