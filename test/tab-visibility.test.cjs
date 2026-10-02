const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
test('active tab reveal is horizontal only and does not override manual scrolling on same ID', () => {
  let observe, frame, id = '2', left = 240;
  const tab = { dataset: { get id() { return id; } }, getBoundingClientRect: () => ({left, right:left+80}) };
  const bar = {scrollLeft:0, clientLeft:0, clientWidth:200, getBoundingClientRect:()=>({left:0}), querySelector:()=>tab};
  const file = require('node:path').join(__dirname,'../src/tab-visibility.js');
  assert.ok(fs.existsSync(file), 'active-tab visibility module exists');
  vm.runInNewContext(fs.readFileSync(file,'utf8'), {document:{querySelector:()=>bar}, MutationObserver:class {constructor(fn){observe=fn;}observe(){}}, requestAnimationFrame:fn=>{frame=fn;}});
  frame(); frame=null; assert.equal(bar.scrollLeft,120);
  bar.scrollLeft=0; observe(); if(frame)frame(); assert.equal(bar.scrollLeft,0);
  id='3'; left=-80; observe(); frame(); assert.equal(bar.scrollLeft,-80);
});
