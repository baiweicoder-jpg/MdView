const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
test('selection toggles, ranges and filtered select-all never affect hidden items',()=>{
 const file=require('node:path').join(__dirname,'../src/file-selection.js');assert.ok(fs.existsSync(file),'selection model exists');
 const create=require(file),s=create();s.toggle(2,[1,2,3,4]);s.toggle(4,[1,2,3,4],true);assert.deepEqual(s.ids(),[2,3,4]);
 s.scope([2,4]);assert.deepEqual(s.ids(),[2,4]);s.all([2,4]);assert.deepEqual(s.ids(),[2,4]);s.toggle(2,[2,4]);assert.deepEqual(s.ids(),[4]);s.clear();assert.deepEqual(s.ids(),[]);
});
