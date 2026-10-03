const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
test('selection toggles, ranges and filtered select-all never affect hidden items',()=>{
 const file=require('node:path').join(__dirname,'../src/file-selection.js');assert.ok(fs.existsSync(file),'selection model exists');
 const create=require(file),s=create();s.toggle(2,[1,2,3,4]);s.toggle(4,[1,2,3,4],true);assert.deepEqual(s.ids(),[2,3,4]);
 s.scope([2,4]);assert.deepEqual(s.ids(),[2,4]);s.all([2,4]);assert.deepEqual(s.ids(),[2,4]);s.toggle(2,[2,4]);assert.deepEqual(s.ids(),[4]);s.clear();assert.deepEqual(s.ids(),[]);
});

test('keyboard ranges start at focus without a mouse or Ctrl Space anchor',()=>{
 const s=require('../src/file-selection.js')(),ids=[1,2,3,4];
 s.move(1,2,ids,true);assert.deepEqual(s.ids(),[1,2]);
 s.move(2,3,ids,true);assert.deepEqual(s.ids(),[1,2,3]);
 s.move(3,2,ids,true);assert.deepEqual(s.ids(),[1,2]);
 s.clear();s.move(2,3,ids,true);assert.deepEqual(s.ids(),[2,3]);
});
test('plain keyboard movement resets the range anchor without opening or toggling files',()=>{
 const s=require('../src/file-selection.js')(),ids=[1,2,3,4];
 s.toggle(1,ids);s.move(1,2,ids);assert.deepEqual(s.ids(),[1]);
 s.move(2,3,ids,true);assert.deepEqual(s.ids(),[2,3]);
 s.move(3,2,ids,true);assert.deepEqual(s.ids(),[2]);
});
test('keyboard range scopes to visible IDs and ignores invalid origins or destinations',()=>{
 const s=require('../src/file-selection.js')(),ids=[1,2,3,4];
 s.toggle(1,ids);s.scope([2,4]);s.move(2,4,[2,4],true);assert.deepEqual(s.ids(),[2,4]);
 s.move(1,4,[2,4],true);s.move(2,3,[2,4],true);assert.deepEqual(s.ids(),[2,4]);
 s.scope([4]);s.move(4,4,[4],true);assert.deepEqual(s.ids(),[4]);
});

test('plain navigation clears batch selection but anchors a following range',()=>{
 const s=require('../src/file-selection.js')();s.all([1,2,3]);s.navigate(2);assert.deepEqual(s.ids(),[]);s.toggle(3,[1,2,3],true);assert.deepEqual(s.ids(),[2,3]);s.navigate(2);assert.deepEqual(s.ids(),[]);
});
