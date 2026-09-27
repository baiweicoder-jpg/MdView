const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { EventEmitter } = require('node:events');
function setup() {
  const ipc = new EventEmitter(), contents = new EventEmitter();
  let destroyed = false, timeout, sequence=0;
  const sent=[];
  contents.isDestroyed=()=>destroyed;
  contents.send=(channel,data)=>sent.push({channel,data});
  const module={exports:{}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/confirm-dialog.cjs'),'utf8'),{
    module, require: name=>name==='electron'?{ipcMain:ipc}:{randomUUID:()=>`id-${++sequence}`},
    setTimeout: (callback,ms)=>{assert.equal(ms,120000);timeout=callback;return 1;},clearTimeout:()=>{}
  });
  const ask=module.exports({webContents:contents},event=>{if(event.sender!==contents)throw Error('untrusted');});
  return {ask,ipc,contents,sent,expire:()=>timeout(),destroy:()=>{destroyed=true;contents.emit('destroyed');},answer:(id,choice,sender=contents)=>ipc.emit('unsaved-confirm-answer',{sender},{id,choice})};
}
test('only current trusted allowlisted answers settle; one pending request',async()=>{
  const s=setup(), first=s.ask({name:'A.md'});let settled=false;first.then(()=>settled=true);
  assert.equal(await s.ask({name:'B.md'}),'cancel');
  s.answer('bad','discard');s.answer('id-1','bad');s.answer('id-1','discard',null);
  await Promise.resolve();assert.equal(settled,false);
  s.answer('id-1','save');assert.equal(await first,'save');
  const second=s.ask({name:'B.md'});s.answer('id-1','discard');s.answer('id-2','cancel');assert.equal(await second,'cancel');
});
test('navigation, crash, timeout and destruction cancel; listener is removed',async()=>{
  for(const event of ['navigation','render-process-gone','timeout','destroyed']) {
    const s=setup(), result=s.ask({name:'A.md'});
    if(event==='navigation')s.contents.emit('did-start-navigation',{},'file:///new',false,true);
    else if(event==='timeout')s.expire();else if(event==='destroyed')s.destroy();else s.contents.emit(event);
    assert.equal(await result,'cancel');
    if(event==='destroyed')assert.equal(s.ipc.listenerCount('unsaved-confirm-answer'),0);
  }
});
test('renderer send failure cannot throw out of cancellation or strand pending request',async()=>{
  const s=setup(), result=s.ask({name:'A.md'});
  s.contents.send=()=>{throw Error('renderer gone');};
  assert.doesNotThrow(()=>s.contents.emit('render-process-gone'));
  assert.equal(await result,'cancel');
});
