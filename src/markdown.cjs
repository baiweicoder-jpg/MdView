const fs = require('node:fs/promises');
const path = require('node:path');
const { createMarkdownParser, renderEditorHtml: renderSharedEditorHtml } = require('./markdown-parser.cjs');
const { readLimited, readTextFile, MAX_DOCUMENT } = require('./document-file.cjs');
const { validateEmbeddedPng } = require('./image-paste.cjs');

const MAX_IMAGES = 24 * 1024 * 1024;
const imageTypes = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.avif': 'image/avif', '.ico': 'image/x-icon' };
const md = createMarkdownParser();
const editorMd = createMarkdownParser();
const searchMd = createMarkdownParser();

async function renderMarkdown(source, directory) {
  if (typeof source !== 'string' || Buffer.byteLength(source, 'utf8') > MAX_DOCUMENT) throw new Error('文档超过 10 MB 上限。');
  const tokens = md.parse(source, {});
  const headings = [];
  const warnings = new Set();
  const ids = new Set();
  let imageBytes = 0;
  const root = directory ? await fs.realpath(directory) : null;
  const images = new Map();
  const missingImages = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type === 'heading_open') {
      const inline = tokens[i + 1];
      const title = (inline.children || []).map(child => child.type === 'image' ? child.content : child.type === 'text' || child.type === 'code_inline' ? child.content : '').join('') || '未命名章节';
      const base = title.toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-|-$/g, '') || 'section';
      let id = base;
      for (let suffix = 2; ids.has(id); suffix++) id = `${base}-${suffix}`;
      ids.add(id);
      token.attrSet('id', id);
      headings.push({ id, title, level: Number(token.tag.slice(1)) });
    }
    for (const child of token.children || []) {
      if (child.type !== 'image') continue;
      const src = child.attrGet('src') || '';
      child.attrSet('data-md-src', src);
      if (!images.has(src)) {
        let dataUrl = '';
        try {
          if (src.startsWith('data:')) {
            const data = validateEmbeddedPng(src);
            if (imageBytes + data.length > MAX_IMAGES) throw new Error('图片总大小超过 24 MB。');
            imageBytes += data.length;
            dataUrl = src;
          } else {
          if (!root || /^[a-z][a-z\d+.-]*:/i.test(src) || /^[\\/]/.test(src)) throw new Error('仅加载文档目录内的相对路径图片');
          const decoded = decodeURIComponent(src.split(/[?#]/)[0]);
          const file = await fs.realpath(path.resolve(root, decoded));
          const relative = path.relative(root, file);
          if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('图片位于文档目录之外');
          const mime = imageTypes[path.extname(file).toLowerCase()];
          if (!mime) throw new Error('图片格式暂不支持');
          const data = await readLimited(file, MAX_IMAGES - imageBytes);
          imageBytes += data.length;
          dataUrl = `data:${mime};base64,${data.toString('base64')}`;
          }
        } catch {
          warnings.add('部分图片未加载：支持文档目录内的 PNG、JPEG、GIF、WebP、BMP、AVIF、ICO，以及每张不超过 2 MB 的嵌入 PNG；总计不超过 24 MB。');
        }
        images.set(src, dataUrl);
      }
      const image = images.get(src);
      if (image) {
        child.attrSet('src', image);
        child.attrSet('loading', 'lazy');
      } else {
        child.attrSet('src', '');
        missingImages.push(child);
      }
    }
  }
  const editorHtml = md.renderer.render(tokens, md.options, {});
  // Give every hidden paragraph its own reader-only inline owner, in token order.
  // Keep hidden/block flags: adjacent block renderers use them for whitespace.
  // html_inline emits the wrappers verbatim, with no new formatting whitespace.
  for (const token of tokens) {
    if (token.hidden && (token.type === 'paragraph_open' || token.type === 'paragraph_close')) {
      token.content = token.type === 'paragraph_open' ? '<span data-search-inline="true">' : '</span>';
      token.type = 'html_inline';
    }
  }
  for (const child of missingImages) { child.type = 'html_inline'; child.content = `<span data-search-image>[图片未加载：${md.utils.escapeHtml(child.content || '图片')}]</span>`; }
  return { editorHtml, assets: Object.fromEntries(images), html: md.renderer.render(tokens, md.options, {}), headings, warnings: [...warnings] };
}

async function readDocument(file) {
  const document = await readTextFile(file);
  return { ...document, ...await renderMarkdown(document.source, path.dirname(document.path)), name: path.basename(document.path), characters: document.source.length };
}

// Editor reconstruction must parse the current draft with the same restricted
// Markdown rules as the reader. SafeImage resolves original image paths against
// the document's approved assets; never use a permissive HTML/Markdown parser.
function renderEditorHtml(source) {
  return renderSharedEditorHtml(source, editorMd);
}

// Search uses the same parser (including tasks/colors), without rendering or file I/O.
function searchTextBlocks(source) {
  return searchMd.parse(source, {}).filter(token => ['inline', 'fence', 'code_block'].includes(token.type)).map(token => {
    if (token.type !== 'inline') return token.content.replace(/\n$/, '');
    return (token.children || []).map(child => {
      if (child.type === 'text' || child.type === 'code_inline') return child.content;
      if (child.type === 'softbreak') return ' ';
      if (child.type === 'hardbreak') return '\n';
      if (child.type === 'image') return '\ufffc';
      return '';
    }).join('');
  });
}
module.exports = { renderMarkdown, readDocument, renderEditorHtml, searchTextBlocks };
