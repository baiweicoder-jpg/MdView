const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSessionStore, restoreWorkspace, validateSession, MAX_TABS } = require('../src/workspace-session.cjs');
const { MAX_DOCUMENT } = require('../src/document-file.cjs');
test('10 MB drafts survive JSON escaping; over-limit sources and totals reject without truncation', () => {
  const source = '\u0000'.repeat(MAX_DOCUMENT);
  assert.equal(validateSession({version:2,tabs:[{path:'',source}],activeIndex:0}).tabs[0].source,source);
  assert.equal(validateSession({version:2,tabs:[{path:'',source:source+'x'}],activeIndex:0}),null);
  assert.equal(validateSession({version:2,tabs:Array(7).fill({path:'',source:'x'.repeat(MAX_DOCUMENT)}),activeIndex:0}),null);
});
test('a CLI file cannot evict a recovered draft at the 100-tab boundary', async () => {
  const tabs = Array.from({length:MAX_TABS},(_,i)=>({path:'',source:`draft ${i}`}));
  const restored = await restoreWorkspace({version:2,tabs,activeIndex:99},path.resolve('new.md'),async file=>({path:file,source:'disk'}));
  assert.deepEqual(restored.documents.map(t=>t.source),tabs.map(t=>t.source));
  assert.equal(restored.activeIndex,99);
});
test('v2 recovers independent Unicode drafts and rejects lossy snapshots', async () => {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'mdview-drafts-'));
  try {
    const file = path.join(dir, 'session.json');
    const store = createSessionStore(file, {onError:()=>{}});
    const tabs = [{path:'',source:'# 中文 🐋\n\n**bold**',viewState:{editing:true,scrollTop:42}}, {path:'',source:'```js\n日本語\n```'}];
    assert.equal(store.save({version:2,tabs,activeIndex:1}),true);
    assert.equal(store.flush(),true);
    const restored = await restoreWorkspace(store.load(),null,async()=>assert.fail('draft must not access disk paths'));
    assert.deepEqual(restored.documents.map(t=>t.source),tabs.map(t=>t.source));
    assert.equal(restored.activeIndex,1);
    assert.equal(restored.documents[0].viewState.scrollTop,42);
    assert.equal(store.save({version:2,tabs:Array(101).fill(tabs[0]),activeIndex:100}),false);
    assert.equal(store.flush(),false);
    assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')).tabs.map(t=>t.source),tabs.map(t=>t.source));
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
