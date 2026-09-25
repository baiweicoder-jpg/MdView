const fs = require('node:fs/promises');
const path = require('node:path');
const MarkdownIt = require('markdown-it');
const hljs = require('highlight.js/lib/common');
const { readLimited, readTextFile } = require('./document-file.cjs');

const MAX_IMAGES = 24 * 1024 * 1024;
const imageTypes = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.avif': 'image/avif', '.ico': 'image/x-icon' };
const md = new MarkdownIt({
  html: false,
  linkify: true,
  highlight(code, language) {
    if (language && hljs.getLanguage(language)) {
      return hljs.highlight(code, { language, ignoreIllegals: true }).value;
    }
    return ''; // The renderer escapes unknown/unlabelled languages.
  }
});
for (const type of ['th_open', 'td_open']) {
  md.renderer.rules[type] = (tokens, index, _options, _env, self) => {
    const token = tokens[index];
    const align = token.attrGet('style');
    if (align) {
      token.attrs = token.attrs.filter(([name]) => name !== 'style');
      token.attrSet('class', `align-${align.split(':')[1]}`);
    }
    return self.renderToken(tokens, index, {});
  };
}
for (const type of ['fence', 'code_block']) {
  const render = md.renderer.rules[type];
  md.renderer.rules[type] = (tokens, index, options, env, self) => {
    const language = tokens[index].info.trim().split(/\s+/)[0] || 'text';
    return `<section class="code-block"><div class="code-toolbar"><span class="code-language">${md.utils.escapeHtml(language)}</span><div class="code-actions"><button type="button" data-code-zoom="-1" aria-label="缩小此代码块字号" title="缩小代码字号">A−</button><button type="button" data-code-zoom="0" class="code-zoom-reset" aria-label="恢复此代码块默认字号" title="恢复默认字号">100%</button><button type="button" data-code-zoom="1" aria-label="放大此代码块字号" title="放大代码字号">A＋</button><button class="expand-code" type="button" aria-label="单独查看此代码块" aria-haspopup="dialog">单独查看</button><button class="copy-code" type="button" aria-label="复制代码">复制</button></div></div>${render(tokens, index, options, env, self)}</section>`;
  };
}

async function renderMarkdown(source, directory) {
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
        } catch {
          warnings.add('部分图片未加载：首版支持文档目录内的 PNG、JPEG、GIF、WebP、BMP、AVIF、ICO，总计不超过 24 MB。');
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
  for (const child of missingImages) { child.type = 'text'; child.content = `[图片未加载：${child.content || '图片'}]`; }
  return { editorHtml, assets: Object.fromEntries(images), html: md.renderer.render(tokens, md.options, {}), headings, warnings: [...warnings] };
}

async function readDocument(file) {
  const document = await readTextFile(file);
  return { ...document, ...await renderMarkdown(document.source, path.dirname(document.path)), name: path.basename(document.path), characters: document.source.length };
}

module.exports = { renderMarkdown, readDocument };
