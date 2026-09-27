const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

const { statTimes } = require('./document-times.cjs');

const MAX_DOCUMENT = 10 * 1024 * 1024;
const fingerprint = data => createHash('sha256').update(data).digest('hex');

function validatePath(file) {
  if (typeof file !== 'string' || !/\.(md|markdown)$/i.test(file)) throw new Error('请选择 .md 或 .markdown 文件。');
}

async function readLimited(file, limit) {
  const handle = await fs.open(file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('请选择文件。');
    if (stat.size > limit) throw new Error('文件过大，超出读取上限。');
    const data = Buffer.alloc(stat.size + 1);
    let offset = 0;
    while (offset < data.length) {
      const { bytesRead } = await handle.read(data, offset, data.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset > limit) throw new Error('文件过大，超出读取上限。');
    return data.subarray(0, offset);
  } finally {
    await handle.close();
  }
}

async function readTextFile(file) {
  validatePath(file);
  const resolved = await fs.realpath(file);
  const data = await readLimited(resolved, MAX_DOCUMENT);
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data); }
  catch { throw new Error('此文件不是有效的 UTF-8 文本，请先转换编码。'); }
  const bom = text.startsWith('\uFEFF');
  const source = bom ? text.slice(1) : text;
  return { ...statTimes(await fs.stat(resolved)), path: resolved, source, fingerprint: fingerprint(data), bom, newline: source.includes('\r\n') ? '\r\n' : '\n' };
}

async function saveTextFile(file, source, { expectedHash, bom = false, newline = '\n' }) {
  validatePath(file);
  if (typeof source !== 'string' || !(expectedHash === null || typeof expectedHash === 'string')) throw new Error('保存参数无效。');
  if (!['\n', '\r\n'].includes(newline)) throw new Error('换行格式无效。');
  const normalized = source.replace(/\r\n?/g, '\n').replace(/\n/g, newline);
  const data = Buffer.from(`${bom ? '\uFEFF' : ''}${normalized}`, 'utf8');
  if (data.length > MAX_DOCUMENT) throw new Error('文件过大，超出 10 MB 保存上限。');
  async function checkCurrentFile() {
    let actualHash = null;
    try { actualHash = fingerprint(await readLimited(file, MAX_DOCUMENT)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (actualHash !== expectedHash) {
      const error = new Error('磁盘文件已被其他程序修改或删除。请另存为，或重新打开文件后合并修改。');
      error.code = 'FILE_CHANGED';
      throw error;
    }
  }
  await checkCurrentFile();
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
  const handle = await fs.open(temporary, 'wx');
  try { await handle.writeFile(data); await handle.sync(); }
  finally { await handle.close(); }
  // Recheck after writing the temporary file; failed saves preserve the original and draft.
  await checkCurrentFile();
  await fs.rename(temporary, file);
  return { ...statTimes(await fs.stat(file)), path: file, source: normalized, fingerprint: fingerprint(data), bom, newline };
}

// Filename-only boundary: never accept paths, Windows device names or ambiguous suffixes.
function validateFilename(name) {
  if (typeof name !== 'string' || !name || name.length > 255 || /[<>:"/\\|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name) ||
      !name.trim() || /^\./.test(name) || /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³]) *(?:\.|$)/i.test(name)) {
    throw Error('文件名无效。请勿使用路径、保留名称、特殊字符或末尾的空格和句点。');
  }
  validatePath(name);
  if (!path.basename(name, path.extname(name)).trim()) throw Error('文件名不能为空。');
  return name;
}

async function renameTextFile(document, name) {
  validateFilename(name);
  const old = document.path, target = path.join(path.dirname(old), name);
  if (!path.isAbsolute(old) || typeof document.fingerprint !== 'string') throw Error('请先保存文档。');
  const sameIdentity = (a, b) => a.dev === b.dev && a.ino === b.ino;
  const original = await fs.lstat(old);
  if (!original.isFile() || original.isSymbolicLink()) throw Error('文件已改变，请重新打开。');
  if ((original.mode & 0o222) === 0) throw Object.assign(Error('没有权限重命名此文件。'), { code: 'EACCES' });
  const check = async () => {
    if (!sameIdentity(original, await fs.lstat(old)) || fingerprint(await readLimited(old, MAX_DOCUMENT)) !== document.fingerprint) {
      throw Error('磁盘文件已被其他程序修改或删除。请重新打开文件后合并修改。');
    }
  };
  await check();
  if (old === target) return { path: old };
  // Do not emulate a case-only Windows move using an overwriting rename. A two-step
  // user rename is safe on all supported filesystems and keeps rollback unambiguous.
  if (process.platform === 'win32' && old.toLowerCase() === target.toLowerCase()) throw Error('仅更改大小写时，请先改为另一个文件名，再改为所需名称。');
  // link() creates the destination exclusively: unlike rename(), it can NEVER
  // overwrite a destination created between our checks. No document bytes are saved.
  await fs.link(old, target);
  try {
    await check();
    if (!sameIdentity(original, await fs.lstat(target))) throw Error('目标文件已改变。');
    await fs.unlink(old);
  } catch (error) {
    try { if (sameIdentity(original, await fs.lstat(target))) await fs.unlink(target); }
    catch { /* Keep either surviving name rather than deleting an unrelated file. */ }
    throw error;
  }
  return { path: target };
}

module.exports = { MAX_DOCUMENT, readLimited, readTextFile, saveTextFile, validateFilename, renameTextFile };
