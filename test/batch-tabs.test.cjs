const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm');
const {EventEmitter}=require('node:events');
function setup() {
 const ipc=new EventEmitter(); ipc.handlers={}; ipc.handle=(k,f)=>ipc.handlers[k]=f;
 const wc=new EventEmitter(); const sent=[], trashed=[], questions=[], commits=[];
 const state={answer:'discard',latest:null,failTrash:null,commit:true};
 wc.send=(channel,data)=>sent.push({channel,data}); wc.executeJavaScript=async()=>state.latest;
 const win=new EventEmitter(); Object.assign(win,{webContents:wc,isDestroyed:()=>false,setTitle:()=>{}});
 const mod={exports:{}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../src/edit-session.cjs'),'utf8'),{module:mod,Buffer,console,require:n=>{
 if(n==='electron')return {ipcMain:ipc,shell:{trashItem:async p=>{if(p===state.failTrash)throw Error('trash denied');trashed.push(p);}},dialog:{},Menu:{},clipboard:{}};
 if(n==='./confirm-dialog.cjs')return ()=>async q=>{questions.push(q);return typeof state.answer==='function'?state.answer(q):state.answer;};
 if(n==='./rename-dialog.cjs')return ()=>()=>{};
 if(n==='./markdown.cjs')return {renderEditorHtml:s=>s,renderMarkdown:async s=>({html:s})};
 if(n==='./content-search-service.cjs')return ()=>({cancel(){}});
 return require(n.startsWith('./')?'../src/'+n.slice(2):n);
 }});
 const session=mod.exports(win,()=>{},'C:/built-in.md',()=>({language:'en'}),()=>{},s=>{commits.push(JSON.parse(JSON.stringify(s)));return state.commit;});
 function open(id){session.openDocument({path:`C:/${id}.md`,name:`${id}.md`,source:id});state.latest={id:sent.filter(x=>x.channel==='tabs').at(-1).data.find(t=>t.active).id,source:id};}
 return {state,session,open,trashed,questions,commits,sent,run:r=>ipc.handlers['batch-tabs']({},r),handler:()=>ipc.handlers['batch-tabs']};
}
test('batch close stops on cancel, preserves earlier close and active unsent draft',async()=>{
 const s=setup();s.open('a');s.open('b');s.open('c');s.state.latest.source='unsent';
 assert.equal(typeof s.handler(),'function','main owns batch tab IPC');
 s.state.answer='cancel';const r=await s.run({action:'close',ids:[1,3]});
 assert.equal(r.canceled,true);assert.deepEqual(Array.from(r.completed),[1]);assert.equal(s.session.snapshot().tabs.length,2);
 assert.equal(s.questions.length,1);
});
test('trash requires explicit confirmation; failures retain drafts and successful paths leave recovery',async()=>{
 const s=setup();s.open('a');s.open('b');s.state.latest.source='dirty b';s.state.answer='cancel';
 let r=await s.run({action:'trash',ids:[1,2]});assert.equal(r.canceled,true);assert.equal(s.trashed.length,0);
 s.state.answer='discard';s.state.failTrash='C:/b.md';r=await s.run({action:'trash',ids:[1,1,2]});
 assert.deepEqual(s.trashed,['C:/a.md']);assert.deepEqual(Array.from(r.completed),[1]);assert.equal(r.failures[0].id,2);
 assert.equal(s.questions.at(-1).kind,'trash');assert.equal(s.questions.at(-1).files[1].dirty,true);
 assert.deepEqual(Array.from(s.session.snapshot().tabs,t=>t.path),['C:/b.md']);
 s.state.answer='cancel';r=await s.run({action:'close',ids:[2]});assert.equal(r.canceled,true);
});
test('invalid IDs/actions and untitled or failed durable preflight never trash',async()=>{
 const s=setup();s.open('a');
 assert.throws(()=>s.run({action:'unlink',ids:[1]}));assert.throws(()=>s.run({action:'trash',ids:[999]}));
 s.state.commit=false;const r=await s.run({action:'trash',ids:[1]});assert.equal(r.ok,false);assert.equal(s.trashed.length,0);assert.equal(s.session.snapshot().tabs.length,1);
 s.state.commit=true;s.session.newBlank();s.state.latest={id:2,source:'untitled'};
 const untitled=await s.run({action:'trash',ids:[2]});assert.equal(untitled.ok,false);assert.equal(s.trashed.length,0);
});
module.exports={setup};
