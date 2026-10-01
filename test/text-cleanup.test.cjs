const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Schema } = require('@tiptap/pm/model');
const { EditorState, TextSelection } = require('@tiptap/pm/state');
const { history, undo } = require('@tiptap/pm/history');
const schema = new Schema({nodes:{doc:{content:'block+'},paragraph:{content:'inline*',group:'block'},heading:{content:'inline*',group:'block'},codeBlock:{content:'text*',group:'block',code:true},list:{content:'paragraph+',group:'block'},table:{content:'paragraph+',group:'block'},text:{group:'inline'},hardBreak:{inline:true,group:'inline'},image:{inline:true,group:'inline',attrs:{src:{default:'safe'},alt:{default:'a  b'}}}},marks:{bold:{},code:{code:true},link:{attrs:{href:{}}}}});
const text = (s,marks) => schema.text(s,marks);
const p = (...c) => schema.node('paragraph',null,c);
function state(...nodes) { return EditorState.create({doc:schema.node('doc',null,nodes),plugins:[history()]}); }
test('merge only adjacent top-level prose paragraphs, retain structure and one undo',()=>{
 const s=state(p(text('Hello',[schema.mark('bold')])),p(text('world')),schema.node('heading',null,text('Title')),p(text('中文')),p(text('正文')),schema.node('codeBlock',null,text('a\n\nb')),schema.node('list',null,p(text('1.  item'))),schema.node('table',null,p(text(' cell  '))),p(schema.node('image')));
 const plan=clean(s,'lines'); assert.equal(plan.count,2); assert.equal(plan.tr.doc.child(0).textContent,'Hello world'); assert.equal(plan.tr.doc.child(2).textContent,'中文正文');
 assert.equal(plan.tr.doc.child(0).firstChild.marks[0].type.name,'bold');
 let next=s.apply(plan.tr); assert.ok(undo(next,tr=>{next=next.apply(tr);})); assert.deepEqual(next.doc.toJSON(),s.doc.toJSON());
});
test('blank prose paragraphs removed but code/list/table/heading blank content retained',()=>{
 const s=state(p(text('a')),p(),p(text('  ')),p(text('b')),schema.node('list',null,p()),schema.node('codeBlock',null,text('a\n\nb')));
 const plan=clean(s,'blank'); assert.equal(plan.count,2); assert.equal(plan.tr.doc.childCount,4); assert.equal(plan.tr.doc.child(2).type.name,'list');
});
test('selection boundaries never edit outside selected segments',()=>{
 let s=state(p(text('a   b   c'))); s=s.apply(s.tr.setSelection(TextSelection.create(s.doc,2,4)));
 const plan=clean(s,'spaces');assert.equal(plan.tr.doc.textContent,'a  b   c');
 const lines=state(p(text('alpha')),p(text('beta')),p(text('gamma')));
 const segment=TextSelection.create(lines.doc,3,10);
 assert.equal(clean(lines,'lines',segment).tr.doc.childCount,2);
 assert.equal(clean(lines,'lines',segment).tr.doc.lastChild.textContent,'gamma');
});
test('cleanup excludes hardbreak spaces, indentation, code, links, atoms and structural descendants',()=>{
 const protectedNodes=[schema.node('heading',null,text(' H  H ')),schema.node('list',null,p(text(' item  '))),schema.node('table',null,p(text(' cell  '))),schema.node('codeBlock',null,text('a  b\n\n c'))];
 const s=state(...protectedNodes,p(text('    indent  text')),p(text('hard  '),schema.node('hardBreak'),text('line')),p(text('12 kg 中文 English')),p(text('url',[schema.mark('link',{href:'https://a/x  y'})]),schema.node('image')));
 const plan=clean(s,'spaces');
 protectedNodes.forEach((node,i)=>assert.deepEqual(plan.tr.doc.child(i).toJSON(),node.toJSON()));
 assert.equal(plan.tr.doc.child(4).textContent,'    indent text');
 assert.deepEqual(plan.tr.doc.child(5).toJSON(),s.doc.child(5).toJSON());
 assert.deepEqual(plan.tr.doc.lastChild.toJSON(),s.doc.lastChild.toJSON());
});
test('already-empty document is a true no-op without history or dirty updates',()=>{
 const s=state(p()); const plan=clean(s,'blank'); assert.equal(plan.count,0);assert.equal(plan.tr.docChanged,false);
});
test('large ordinary text is not spread into the JS argument stack',()=>{
 const s=state(p(text('a'.repeat(300000)+'  end')));
 const plan=clean(s,'spaces');assert.equal(plan.count,1);assert.equal(plan.tr.doc.textContent.length,300004);
});
function clean(s,kind,selection) { const { planCleanup } = require('../src/text-cleanup.cjs'); return planCleanup(s,kind,selection); }
test('spaces trim prose edges and collapse repeated ASCII spaces without changing meaningful singles or marks',()=>{
 const s=state(p(text('  中文  English  12 kg '),text(' bold  words ',[schema.mark('bold')]),text('x  y',[schema.mark('code')]),text(' link  label ',[schema.mark('link',{href:'https://a/b%20c'})])));
 const plan=clean(s,'spaces'); assert.ok(plan.count); assert.equal(plan.tr.doc.textContent,'中文 English 12 kg bold words x  y link  label ');
 assert.equal(plan.tr.doc.firstChild.lastChild.marks[0].attrs.href,'https://a/b%20c');
});
