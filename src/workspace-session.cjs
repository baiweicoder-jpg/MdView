// Metadata only: document contents and unsaved drafts never leave edit-session.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const MAX_TABS = 100;
const MAX_BYTES = 1024 * 1024;
const pathKey = file => process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file);
function viewState(value) {
  return { scrollTop: Number.isFinite(value?.scrollTop) ? Math.max(0, Math.min(100000000, value.scrollTop)) : 0, editing: value?.editing === true };
}
function validateSession(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.tabs) || value.tabs.length > MAX_TABS) return null;
  const tabs = [], seen = new Set();
  let activeIndex = 0;
  for (let index = 0; index < value.tabs.length; index++) {
    const item = value.tabs[index];
    if (!item || typeof item.path !== 'string' || item.path.length > 8192 || Buffer.byteLength(item.path, 'utf8') > 8192 || item.path.includes('\0') || (item.path && !path.isAbsolute(item.path))) continue;
    const key = item.path && pathKey(item.path);
    if (key && seen.has(key)) {
      if (index === value.activeIndex) activeIndex = tabs.findIndex(tab => pathKey(tab.path || '.') === key);
      continue;
    }
    if (key) seen.add(key);
    if (index === value.activeIndex) activeIndex = tabs.length;
    tabs.push({ path: item.path, viewState: viewState(item.viewState) });
  }
  return { version: 1, tabs, activeIndex };
}
function createSessionStore(file, { onError = error => console.warn('Workspace session:', error.message), delay = 150 } = {}) {
  let pending = null, timer = null;
  function load() {
    try {
      if (fs.statSync(file).size > MAX_BYTES) return null;
      return validateSession(JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch (error) { if (error.code !== 'ENOENT') onError(error); return null; }
  }
  function flush() {
    clearTimeout(timer); timer = null;
    if (!pending) return true;
    const value = pending;
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const fd = fs.openSync(temporary, 'wx', 0o600);
      try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(temporary, file);
      pending = null;
      return true;
    } catch (error) { onError(error); return false; }
    finally { try { fs.unlinkSync(temporary); } catch {} }
  }
  function save(value) {
    const validated = validateSession(value);
    if (!validated) return false;
    pending = validated;
    clearTimeout(timer);
    timer = setTimeout(flush, delay);
    timer.unref?.();
    return true;
  }
  return { load, save, flush };
}
async function restoreWorkspace(value, initialFile, readDocument) {
  const saved = validateSession(value);
  const documents = [];
  let activeIndex = 0;
  async function append(item, activate) {
    try {
      const document = item.path ? await readDocument(item.path) : null;
      const existing = document && documents.findIndex(doc => doc.path && pathKey(doc.path) === pathKey(document.path));
      let index;
      if (Number.isInteger(existing) && existing >= 0) index = existing;
      else {
        if (documents.length >= MAX_TABS) {
          if (!activate) return;
          documents.pop(); // A requested CLI file takes priority over the last bounded restore slot.
        }
        index = documents.length;
        documents.push(document ? { ...document, viewState: viewState(item.viewState) } : { path: '', viewState: viewState(item.viewState) });
      }
      if (activate) activeIndex = index;
    } catch { /* Missing, inaccessible, oversized and invalid UTF-8 files are skipped. */ }
  }
  if (saved) for (let i = 0; i < saved.tabs.length; i++) await append(saved.tabs[i], i === saved.activeIndex);
  if (initialFile) await append({ path: initialFile }, true);
  return { documents, activeIndex };
}
module.exports = { createSessionStore, restoreWorkspace, validateSession, viewState, pathKey, MAX_TABS };
