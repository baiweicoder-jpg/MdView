const test = require('node:test');
const assert = require('node:assert/strict');
const { getSchema } = require('@tiptap/core');
const StarterKit = require('@tiptap/starter-kit').default;
const { TableKit } = require('@tiptap/extension-table');
const Image = require('@tiptap/extension-image').default;
const { EditorState, TextSelection } = require('@tiptap/pm/state');
const { history, undo, redo } = require('@tiptap/pm/history');
async function fixture() {
  const { WidthTable, WidthCell, WidthHeader } = await import('../src/table-width.js');
  const schema = getSchema([StarterKit, Image.configure({inline:true}), TableKit.configure({table:false,tableCell:false,tableHeader:false}), WidthTable, WidthCell, WidthHeader]);
  const p = text => schema.nodes.paragraph.create(null, text ? schema.text(text) : null);
  const table = (names, widths, header = true) => schema.nodes.table.create(null, names.map((row, r) => schema.nodes.tableRow.create(null, row.map((name,c) => schema.nodes[r === 0 && header ? 'tableHeader' : 'tableCell'].create({colwidth: widths ? [widths[c]] : null, align:c ? 'right' : 'left'}, p(name))))));
  const upper = table([['Field','URL'],['upper','value']], [140,260]);
  const lower = table([['FIRST DATA','https://example.invalid/a?x=1#part'],['last','value']], [400,500]);
  const doc = schema.nodes.doc.create(null,[p(''),upper,p(''),p(''),lower,p('')]);
  let state = EditorState.create({schema,doc,plugins:[history()]});
  let at; doc.descendants((n,pos)=>{if(n.isText && n.text==='FIRST DATA')at=pos+2;});
  state=state.apply(state.tr.setSelection(TextSelection.create(doc,at)));
  const editor = {isEditable:true,get state(){return state;},view:{dispatch(tr){state=state.applyTransaction(tr).state;}}};
  return {schema,p,table,upper,lower,editor};
}
test('rejects boundaries, nested tables, unequal columns, spans and readonly without changing history',async()=>{
  const {planTableMerge,mergeAdjacentTables}=await import('../src/table-merge.js');
  const {schema,p,table,upper,lower}=await fixture();
  const cases=[
    {nodes:[upper,p('substantive'),lower],reason:'adjacent'},
    {nodes:[upper,schema.nodes.codeBlock.create(null,schema.text('code')),lower],reason:'adjacent'},
    {nodes:[upper,schema.nodes.paragraph.create(null,schema.nodes.hardBreak.create()),lower],reason:'adjacent'},
    {nodes:[upper,table([['one']],null)],reason:'columns'},
    {nodes:[schema.nodes.blockquote.create(null,[upper,p(''),lower])],reason:'nested'},
    {nodes:[upper,schema.nodes.table.create(null,schema.nodes.tableRow.create(null,[schema.nodes.tableHeader.create({colspan:2},p('spanning'))]))],reason:'spans'},
  ];
  for(const {nodes,reason} of cases){
    let state=EditorState.create({schema,doc:schema.nodes.doc.create(null,nodes),plugins:[history()]});
    let at;state.doc.descendants((n,pos)=>{if(at===undefined&&n.isText)at=pos;});state=state.apply(state.tr.setSelection(TextSelection.create(state.doc,at)));
    const editor={state,isEditable:true,view:{dispatch(){assert.fail('rejected merge dispatched')}}};
    assert.equal(planTableMerge(editor,'below').reason,reason);assert.equal(mergeAdjacentTables(editor,'below'),false);
  }
  const {editor}=await fixture();editor.isEditable=false;
  assert.equal(planTableMerge(editor,'above').reason,'readonly');assert.equal(mergeAdjacentTables(editor,'above'),false);
});
test('source-order merge below preserves duplicate header/data, inline marks, link and image; Markdown roundtrip',async()=>{
  const {mergeAdjacentTables}=await import('../src/table-merge.js');
  const {schema,p,table,upper}=await fixture();
  const target='https://example.invalid/path?q=%2F#part';
  const content=schema.nodes.paragraph.create(null,[schema.text('FIRST DATA',[schema.marks.bold.create(),schema.marks.link.create({href:target})]),schema.nodes.image.create({src:'synthetic.png',alt:'diagram'})]);
  const lower=table([['Field','URL'],['tail','data']], [800,900]);
  const first=schema.nodes.tableHeader.create(lower.firstChild.firstChild.attrs,content);
  const modified=lower.copy(lower.content.replaceChild(0,lower.firstChild.copy(lower.firstChild.content.replaceChild(0,first))));
  let state=EditorState.create({schema,doc:schema.nodes.doc.create(null,[upper,p(''),modified]),plugins:[history()]});
  state=state.apply(state.tr.setSelection(TextSelection.create(state.doc,4)));
  const editor={isEditable:true,get state(){return state;},view:{dispatch(tr){state=state.applyTransaction(tr).state;}}};
  assert.equal(mergeAdjacentTables(editor,'below'),true);
  assert.deepEqual(state.doc.firstChild.child(2).firstChild.content.toJSON(),first.content.toJSON());
  assert.equal(state.doc.firstChild.child(2).child(1).textContent,'URL','no text deduplication');
  const {MarkdownManager}=require('@tiptap/markdown');
  const {WidthTable,WidthCell,WidthHeader}=await import('../src/table-width.js');
  const manager=new MarkdownManager({extensions:[StarterKit,Image.configure({inline:true}),TableKit.configure({table:false,tableCell:false,tableHeader:false}),WidthTable,WidthCell,WidthHeader]});
  const markdown=manager.serialize(state.doc.toJSON());const reopened=manager.parse(markdown);
  assert.match(markdown,/\{table-widths=140,260\}/);assert.match(markdown,/FIRST DATA/);assert.ok(markdown.includes(target));assert.match(markdown,/synthetic\.png/);
  assert.equal(reopened.content[0].content.length,4);assert.equal(reopened.content[0].content[2].content[0].type,'tableCell');
});

test('adjacent and whitespace-only plain paragraph gaps merge; marked whitespace does not',async()=>{
  const {mergeAdjacentTables}=await import('../src/table-merge.js');
  const {schema,p,upper,lower}=await fixture();
  for(const gap of [[],[p(' \t\u00a0')],[p(''),p('  '),p('')]]){
    let state=EditorState.create({schema,doc:schema.nodes.doc.create(null,[upper,...gap,lower]),plugins:[history()]});
    state=state.apply(state.tr.setSelection(TextSelection.create(state.doc,4)));
    const original=state.doc.toJSON(),caret=state.selection.toJSON();
    const editor={isEditable:true,get state(){return state;},view:{dispatch(tr){state=state.applyTransaction(tr).state;}}};
    assert.equal(mergeAdjacentTables(editor,'below'),true,'whitespace-only gaps are supported');
    assert.equal(state.doc.childCount,1);assert.equal(state.doc.firstChild.childCount,4);
    assert.equal(undo(state,editor.view.dispatch),true);assert.deepEqual(state.doc.toJSON(),original);assert.deepEqual(state.selection.toJSON(),caret);
    assert.equal(redo(state,editor.view.dispatch),true);assert.equal(state.doc.childCount,1);
  }
  const marked=schema.nodes.paragraph.create(null,schema.text(' ',[schema.marks.link.create({href:'https://example.invalid/'})]));
  const state=EditorState.create({schema,doc:schema.nodes.doc.create(null,[upper,marked,lower])});
  assert.equal(mergeAdjacentTables({state,isEditable:true,view:{dispatch(){assert.fail('marked gap must not disappear');}}},'below',4),false);
});

test('merge retains lower first row, upper widths, surrounding blanks and selection; atomic history', async()=>{
  const mod = await import('../src/table-merge.js').catch(()=>({}));
  assert.equal(typeof mod.mergeAdjacentTables,'function','merge command must exist');
  const {editor}=await fixture(); const original=editor.state.doc.toJSON(), selection=editor.state.selection.from;
  assert.equal(mod.mergeAdjacentTables(editor,'above'),true);
  const doc=editor.state.doc, table=doc.child(1);
  assert.equal(doc.childCount,3); assert.equal(doc.firstChild.content.size,0);assert.equal(doc.lastChild.content.size,0);
  assert.equal(table.childCount,4);assert.equal(table.child(2).firstChild.textContent,'FIRST DATA');
  assert.equal(table.child(2).firstChild.type.name,'tableCell');assert.equal(table.firstChild.firstChild.type.name,'tableHeader');
  table.forEach(row=>row.forEach((cell,_offset,c)=>assert.deepEqual(cell.attrs.colwidth,[c?260:140])));
  assert.equal(editor.state.selection.$from.parent.textContent,'FIRST DATA');assert.equal(editor.state.selection.$from.parentOffset,2);
  assert.equal(undo(editor.state,editor.view.dispatch),true);assert.deepEqual(editor.state.doc.toJSON(),original);assert.equal(editor.state.selection.from,selection);
  assert.equal(redo(editor.state,editor.view.dispatch),true);assert.equal(editor.state.doc.child(1).childCount,4);
});
