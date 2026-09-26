const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const modulePath = path.resolve(__dirname, '../src/workspace-session.cjs');

test('restore skips bad files, keeps order and active path, deduplicates CLI and never writes documents', async () => {
  const { restoreWorkspace } = require(modulePath);
  const a = path.resolve('a.md'), b = path.resolve('b.md'), missing = path.resolve('missing.md');
  const reads = [];
  const read = async file => { reads.push(file); if (file === missing) throw Error('unreadable'); return { path: file, source: 'disk' }; };
  const state = { version: 1, tabs: [{ path: a }, { path: missing }, { path: b, viewState: { editing: true, scrollTop: 70 } }], activeIndex: 2 };
  const result = await restoreWorkspace(state, a, read);
  assert.deepEqual(result.documents.map(d => d.path), [a, b]);
  assert.equal(result.activeIndex, 0);
  assert.equal(result.documents[1].viewState.scrollTop, 70);
  assert.equal((await restoreWorkspace(state, null, read)).activeIndex, 1);
  assert.deepEqual((await restoreWorkspace(null, missing, read)).documents, []);
});

test('explicit CLI file wins even when restored session is at its tab bound', async () => {
  const { restoreWorkspace } = require(modulePath);
  const state = {version:1,tabs:Array.from({length:100},(_,i)=>({path:path.resolve(`${i}.md`)})),activeIndex:0};
  const cli = path.resolve('cli.md');
  const restored = await restoreWorkspace(state,cli,async file=>({path:file,source:''}));
  assert.equal(restored.documents.length,100);
  assert.equal(restored.documents[restored.activeIndex].path,cli);
});

test('bounded validation and corruption are safe; latest metadata wins', () => {
  const { createSessionStore, validateSession } = require(modulePath);
  assert.equal(validateSession({ version: 2, tabs: [] }), null);
  assert.equal(validateSession({ version: 1, tabs: Array(101).fill({path:''}) }), null);
  const valid = validateSession({version:1,tabs:[{path:'relative.md'},{path:'',viewState:{scrollTop:-4,editing:'yes'}}],activeIndex:1});
  assert.deepEqual(valid.tabs, [{path:'',viewState:{scrollTop:0,editing:false}}]);
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'mdview-session-corrupt-'));
  try {
    const file = path.join(dir, 'session.json');
    fs.writeFileSync(file, '{bad');
    const store = createSessionStore(file, {onError:()=>{}});
    assert.equal(store.load(), null);
    fs.writeFileSync(file, ' '.repeat(1024*1024+1));
    assert.equal(store.load(), null);
    store.save({version:1,tabs:[{path:''}],activeIndex:0});
    store.save({version:1,tabs:[],activeIndex:0});
    assert.equal(store.flush(), true);
    assert.deepEqual(store.load().tabs, []);
  } finally { fs.rmSync(dir, {recursive:true,force:true}); }
});

test('session survives separate writer and reader processes without persisting document contents', () => {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'mdview-session-test-'));
  try {
    const file = path.join(dir, 'session.json');
    const tabs = [{ path: path.join(dir, 'one.md'), viewState: { scrollTop: 123, editing: true }, source: 'SECRET DRAFT' }, { path: path.join(dir, 'two.md') }];
    const run = code => { const r = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout; };
    run(`const {createSessionStore}=require(${JSON.stringify(modulePath)}); const s=createSessionStore(${JSON.stringify(file)}); s.save(${JSON.stringify({version:1,tabs,activeIndex:0})}); s.flush();`);
    const restored = JSON.parse(run(`const {createSessionStore}=require(${JSON.stringify(modulePath)}); console.log(JSON.stringify(createSessionStore(${JSON.stringify(file)}).load()));`));
    assert.deepEqual(restored.tabs.map(t => t.path), tabs.map(t => t.path));
    assert.equal(restored.activeIndex, 0);
    assert.deepEqual(restored.tabs[0].viewState, { scrollTop: 123, editing: true });
    assert.ok(!fs.readFileSync(file, 'utf8').includes('SECRET'));
    assert.deepEqual(fs.readdirSync(dir), ['session.json']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
