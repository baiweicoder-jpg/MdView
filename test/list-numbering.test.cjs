const test = require('node:test');
const assert = require('node:assert/strict');
const { MarkdownManager } = require('@tiptap/markdown');
const StarterKit = require('@tiptap/starter-kit').default;
async function manager() {
  const { markdownEditingExtensions, serializeMarkdown } = await import('../src/markdown-extensions.js');
  const m = new MarkdownManager({ extensions: [StarterKit.configure({ orderedList: false, listItem: false, underline: false }), ...markdownEditingExtensions] });
  return { m, serialize: doc => serializeMarkdown(m, doc) };
}
for (const start of [1, 0, 5]) test(`ordered start ${start} survives middle-item deletion and roundtrip`, async () => {
  const {m,serialize} = await manager();
  const item = text => ({type:'listItem', content:[{type:'paragraph',content:[{type:'text',text}]}]});
  const doc = {type:'doc',content:[{type:'orderedList',attrs:{start},content:[item('first'),item('middle'),item('last')]}]};
  doc.content[0].content.splice(1,1);
  assert.equal(serialize(doc), `${start}. first\n${start+1}. last`);
  assert.equal(m.parse(serialize(doc)).content[0].attrs?.start ?? 1,start);
});
for (const start of [0, 5, 1]) test(`ordinary ordered start ${start} is unchanged by task serialization fix`, async () => {
  const { m, serialize } = await manager();
  const { renderEditorHtml } = require('../src/markdown-parser.cjs');
  const source = `${start}. first\n${start + 1}. second`;
  const doc = m.parse(source);
  assert.equal(serialize(doc), source);
  assert.deepEqual(m.parse(serialize(doc)), doc);
  assert.equal(renderEditorHtml(serialize(doc)), `${start === 1 ? '<ol>' : `<ol start="${start}">`}\n<li>first</li>\n<li>second</li>\n</ol>\n`);
});
for (const start of [0, 5, 1]) test(`task nested ordered start ${start} survives production reader roundtrip`, async () => {
  const { m, serialize } = await manager();
  const { renderEditorHtml } = require('../src/markdown-parser.cjs');
  const source = `- [ ] outer\n\n  ${start}. first\n  ${start + 1}. second`;
  const doc = m.parse(source);
  const markdown = serialize(doc);
  const boundary = start === 1 ? '\n' : '\n  \n';
  assert.equal(markdown, `- [ ] outer${boundary}  ${start}. first\n  ${start + 1}. second`);
  assert.deepEqual(m.parse(markdown), doc, 'task checked state, nested structure and starts survive');
  assert.equal(serialize(m.parse(markdown)), markdown, 'serialization is stable');
  const opening = start === 1 ? '<ol>' : `<ol start="${start}">`;
  assert.equal(renderEditorHtml(markdown), `<ul data-type="taskList">\n<li data-type="taskItem" data-checked="false">${start === 1 ? '' : '\n'}<label><input type="checkbox" disabled aria-label="outer"></label><div>${start === 1 ? 'outer\n' : '<p>outer</p>\n'}${opening}\n<li>first</li>\n<li>second</li>\n</ol>\n</div></li>\n</ul>\n`);
});
test('nested tasks preserve checked marks, multiple lists and prose siblings', async () => {
  const { m, serialize } = await manager();
  const { renderEditorHtml } = require('../src/markdown-parser.cjs');
  const source = [
    '- [x] **outer**',
    '',
    '  0. zero',
    '  1. one',
    '',
    '  between *lists*',
    '',
    '  5. five',
    '  6. six',
    '',
    '  after lists',
    '  - [ ] nested',
    '',
    '    5. deep',
    '    6. deeper',
    '- [ ] sibling',
    '- plain sibling',
  ].join('\n');
  const doc = m.parse(source);
  const outer = doc.content[0].content[0];
  assert.equal(outer.attrs.checked, true);
  assert.deepEqual(outer.content.map(n => n.type), ['paragraph', 'orderedList', 'paragraph', 'orderedList', 'paragraph', 'taskList']);
  assert.deepEqual(outer.content[0].content[0].marks, [{ type: 'bold' }]);
  assert.deepEqual(outer.content[2].content[1].marks, [{ type: 'italic' }]);
  assert.deepEqual(doc.content[0].content.map(n => n.type), ['taskItem', 'taskItem']);
  assert.equal(doc.content[1].type, 'bulletList');
  assert.equal(doc.content[1].content[0].content[0].content[0].text, 'plain sibling');
  const markdown = serialize(doc);
  assert.equal(markdown, [
    '- [x] **outer**', '  ', '  0. zero', '  1. one',
    '', '  between *lists*', '  ', '  5. five', '  6. six',
    '', '  after lists', '  - [ ] nested', '    ', '    5. deep', '    6. deeper',
    '- [ ] sibling', '', '- plain sibling',
  ].join('\n'));
  assert.deepEqual(m.parse(markdown), doc, 'all checked attrs, marks, prose and nested siblings survive');
  assert.equal(serialize(m.parse(markdown)), markdown);
  assert.equal(renderEditorHtml(markdown), renderEditorHtml(source));
  assert.match(renderEditorHtml(markdown), /data-checked="true"[\s\S]*<strong>outer<\/strong>[\s\S]*<ol start="0">/);
  assert.match(renderEditorHtml(markdown), /<p>between <em>lists<\/em><\/p>\n<ol start="5">/);
  assert.match(renderEditorHtml(markdown), /aria-label="nested"[\s\S]*<ol start="5">\n<li>deep<\/li>\n<li>deeper<\/li>/);
});
test('PM lift of a middle item continues split fragments and undo restores attrs', async()=>{
  const {getSchema}=require('@tiptap/core');
  const {EditorState,TextSelection}=require('@tiptap/pm/state');
  const {liftListItem}=require('@tiptap/pm/schema-list');
  const {history,undo,redo}=require('@tiptap/pm/history');
  const {orderedListContinuityPlugin}=await import('../src/list-continuity.js');
  const schema=getSchema([StarterKit]);
  for(const start of [1,0,5]) {
    const item=text=>schema.nodes.listItem.create(null,schema.nodes.paragraph.create(null,schema.text(text)));
    const list=schema.nodes.orderedList.create({start},[item('first'),item('middle'),item('last')]);
    let state=EditorState.create({schema,doc:schema.nodes.doc.create(null,list),plugins:[history(),orderedListContinuityPlugin()]});
    const original=state.doc.toJSON();let at;state.doc.descendants((n,p)=>{if(n.isText&&n.text==='middle')at=p;});
    state=state.apply(state.tr.setSelection(TextSelection.create(state.doc,at)));
    const dispatch=tr=>{state=state.applyTransaction(tr).state;};
    assert.equal(liftListItem(schema.nodes.listItem)(state,dispatch),true);
    assert.equal(state.doc.child(0).attrs.start,start);
    assert.equal(state.doc.child(2).attrs.start,start+1);
    assert.equal(undo(state,dispatch),true);assert.deepEqual(state.doc.toJSON(),original);
    assert.equal(redo(state,dispatch),true);assert.equal(state.doc.child(2).attrs.start,start+1);
  }
});
test('nested lift continues only fragments of that list; independent starts remain explicit', async()=>{
  const {getSchema}=require('@tiptap/core');const {EditorState,TextSelection}=require('@tiptap/pm/state');const {liftListItem}=require('@tiptap/pm/schema-list');
  const {orderedListContinuityPlugin}=await import('../src/list-continuity.js');const schema=getSchema([StarterKit]);
  const p=text=>schema.nodes.paragraph.create(null,schema.text(text));
  const item=(text,extra=[])=>schema.nodes.listItem.create(null,[p(text),...extra]);
  const list=(start,items)=>schema.nodes.orderedList.create({start},items);
  const inner=list(0,[item('a'),item('middle'),item('c')]);
  let state=EditorState.create({schema,doc:schema.nodes.doc.create(null,[list(5,[item('outer',[inner])]),p('separate'),list(0,[item('independent')])]),plugins:[orderedListContinuityPlugin()]});
  let at;state.doc.descendants((n,pos)=>{if(n.isText&&n.text==='middle')at=pos;});state=state.apply(state.tr.setSelection(TextSelection.create(state.doc,at)));
  liftListItem(schema.nodes.listItem)(state,tr=>{state=state.applyTransaction(tr).state;});
  const starts=[];state.doc.descendants(n=>{if(n.type.name==='orderedList')starts.push(n.attrs.start);});
  assert.deepEqual(starts,[5,0,1,0]);
});
test('nested list starts survive serializer and parser independently', async()=>{
  const {m,serialize}=await manager();
  const p=text=>({type:'paragraph',content:[{type:'text',text}]});
  const item=text=>({type:'listItem',content:[p(text)]});
  const doc={type:'doc',content:[{type:'orderedList',attrs:{start:5},content:[{type:'listItem',content:[p('outer'),{type:'orderedList',attrs:{start:0},content:[item('zero'),item('one')]}]},item('next')]}]};
  const markdown=serialize(doc); const parsed=m.parse(markdown);
  assert.equal(parsed.content[0].attrs.start,5);
  assert.equal(parsed.content[0].content[0].content[1].attrs?.start ?? 1,0,markdown);
  assert.equal(serialize(parsed),markdown);
  const {renderEditorHtml}=require('../src/markdown-parser.cjs');
  assert.match(renderEditorHtml(markdown),/<ol start="0">/, 'reader must recognize the nested zero-start list, not literal prose');
});

