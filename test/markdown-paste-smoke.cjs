const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { app, BrowserWindow, clipboard, ClipboardItem } = require('electron');
const { renderMarkdown, readDocument } = require('../src/markdown.cjs');
const { saveTextFile } = require('../src/document-file.cjs');
const fixture = '## 一、准备资料\n\n请先**仔细核对**资料。\n\n1. 创建目录\n   - 保存原件\n   - 核对清单\n2. 检查文件\n\n| 项目 | 要求 |\n| --- | --- |\n| 文件 | 完整 |\n| 名称 | 清晰 |\n\n## 二、整理步骤\n\n- [ ] 检查内容\n- [x] 完成备份\n\n| 操作 | 说明 |\n| --- | --- |\n| 保存 | 本地文件 |\n\n## 三、参考信息\n\n```text\n链接：@url:`https://pan.baidu.com/s/xxxxxx`\n提取码：abcd\n```';
const literalCode = '链接：@url:`https://pan.baidu.com/s/xxxxxx`\n提取码：abcd';
async function smoke({win, outputDirectory}) {
  const run = code => win.webContents.executeJavaScript(code, true);
  const settle = () => run('new Promise(r=>setTimeout(r,100))');
  const original = await Promise.all((await clipboard.read()).map(async item => new ClipboardItem(Object.fromEntries(await Promise.all(item.types.map(async type => [type, await item.getType(type)]))))));
  async function mount(source) {
    const doc = {source,...await renderMarkdown(source)};
    await run(`window.mp?.destroy();document.querySelector('#mp')?.remove();{const host=document.createElement('div');host.id='mp';document.body.append(host);window.mp=MdViewRich.create(host,${JSON.stringify(doc)},()=>{});window.e=mp.editor;e.view.focus();}`);
    await settle();
  }
  async function paste(text, html, literal = false) {
    await clipboard.write([new ClipboardItem({'text/plain':text,...(html ? {'text/html':html} : {})})]);
    await run(`window.pasteTrusted=false;e.view.dom.addEventListener('paste',event=>{window.pasteTrusted=event.isTrusted},{once:true});e.view.focus()`);
    win.webContents.sendInputEvent({type:'keyDown',keyCode:'v',modifiers:literal ? ['control','shift'] : ['control']});
    win.webContents.sendInputEvent({type:'keyUp',keyCode:'v',modifiers:literal ? ['control','shift'] : ['control']});
    await settle();
    assert.equal(await run('pasteTrusted'),true,'native clipboard paste');
  }
  async function structure() {
    assert.deepEqual(await run(`({headings:e.view.dom.querySelectorAll('h2').length,tables:e.view.dom.querySelectorAll('table').length,bold:e.view.dom.querySelector('strong')?.textContent,nested:!!e.view.dom.querySelector('ol ul'),code:e.state.doc.content.content.filter(n=>n.type.name==='codeBlock').map(n=>n.textContent)})`),{headings:3,tables:2,bold:'仔细核对',nested:true,code:[literalCode]});
  }
  try {
    await mount('OLD'); await run('e.commands.selectAll()'); await paste(fixture); await structure();
    const inserted = await run('e.getJSON()');
    await run('e.commands.undo()'); assert.equal(await run('mp.source()'),'OLD','one undo restores selection replacement');
    await run('e.commands.redo()'); assert.deepEqual(await run('e.getJSON()'),inserted);
    const file=path.join(outputDirectory,'markdown-paste.md');
    await saveTextFile(file,await run('mp.source()'),{expectedHash:null});
    const reopened=await readDocument(file);
    assert.equal(reopened.headings.length,3); assert.equal((reopened.html.match(/<table>/g)||[]).length,2);
    await mount(reopened.source); await structure();
    await mount('OLD'); await run('e.commands.selectAll()');
    await paste(fixture, '<pre>'+fixture.replaceAll('&','&amp;').replaceAll('<','&lt;')+'</pre>'); await structure();
    for (const selection of [{from:6,to:12},{from:6,to:6}]) {
      await mount('left TARGET right'); await run(`e.commands.setTextSelection(${JSON.stringify(selection)})`);
      await paste('**加粗**');
      assert.equal(await run('e.getText()'),selection.to===12 ? 'left 加粗 right' : 'left 加粗TARGET right','caret/range keeps surrounding text');
      assert.equal(await run('e.view.dom.querySelector("strong").textContent'),'加粗');
      await run('e.commands.undo()');assert.equal(await run('mp.source()'),'left TARGET right');
    }
    await mount('left TARGET right'); await run('e.commands.setTextSelection({from:6,to:12})'); await paste(fixture); await structure();
    assert.equal(await run('e.getText().startsWith("left ") && e.getText().endsWith(" right")'),true,'block insertion preserves both sides');
    await run('e.commands.undo()');assert.equal(await run('mp.source()'),'left TARGET right');
    await mount(''); await paste('普通中文段落，没有格式。');
    assert.equal(await run('e.getText()'),'普通中文段落，没有格式。');
    await mount(''); await paste('正常富文本','<h3>正常<strong>富文本</strong></h3>');
    assert.equal(await run('e.view.dom.querySelector("h3 strong").textContent'),'富文本','normal HTML clipboard retains formatting');
    await mount('```text\n原文\n```');await run('e.commands.setTextSelection({from:1,to:3})');await paste(fixture);
    assert.equal(await run('e.state.doc.firstChild.textContent'),fixture,'code block stays literal');
    assert.equal(await run('e.view.dom.querySelectorAll("h2,table,strong").length'),0);
    await mount('');await paste(fixture,'<h2>must not use HTML</h2>',true);
    assert.equal(await run('e.view.dom.querySelectorAll("h2,table,strong,pre").length'),0,'Ctrl+Shift+V bypasses Markdown and HTML');
    assert.equal(await run('e.getText().includes("**仔细核对**")'),true,'literal paste keeps Markdown delimiters');
    const hostile='## 安全\n\n<script>window.pasteUnsafe=1</script>\n<svg onload="window.pasteUnsafe=1"></svg>\n\n[危险](javascript:alert(1))\n\n![外部](https://example.invalid/track.svg)\n\n![矢量](data:image/svg+xml;base64,PHN2Zy8+)';
    await mount('');await paste(hostile,'<script>window.pasteUnsafe=2</script>');
    assert.equal(await run('!!window.pasteUnsafe || !!e.view.dom.querySelector("script,svg,iframe,[onload],a[href^=javascript],img[src^=http],img[src^=\\\"data:image/svg\\\"]")'),false,'untrusted HTML/URLs/SVG stay inert');
    assert.equal(await run('e.getText().includes("<script>")'),true,'raw HTML remains visible literal source');
    await mount('');await paste('**独立撤销**');
    win.webContents.insertText('后续输入');await settle();await run('e.commands.undo()');
    assert.equal(await run('e.getText()'),'独立撤销','typing after paste is an independent undo');
    await run('e.commands.undo()');assert.equal(await run('e.getText()'),'','second undo removes paste');
    await mount('KEEP');await run('e.commands.selectAll()');await paste('## '+ 'x'.repeat(10*1024*1024));
    assert.equal(await run('e.getText()'),'KEEP','oversized source rejects atomically');
    assert.match(await run('document.querySelector(".image-paste-notice").textContent'),/10 MB/);
    await mount('KEEP');await run('e.commands.selectAll()');await paste('## '+ '中'.repeat(4*1024*1024));
    assert.equal(await run('e.getText()'),'KEEP','UTF-8 byte limit, not JS character count');
    await mount('');await run(`e.commands.setContent({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'x'.repeat(10*1024*1024-20)}]}]});e.commands.setTextSelection(e.state.doc.content.size-1);window.beforeLarge=e.getText();`);
    await paste('**'+ 'y'.repeat(40)+'**');
    assert.equal(await run('e.getText()===beforeLarge'),true,'resulting document limit rejects without replacing selection');
    console.log('Markdown paste smoke PASS: Chinese guide, native paste, full/partial/caret, HTML variants, prose/code/literal bypass, inert HTML, size limits, isolated undo/redo, disk reader/editor reopen');
  } finally {await run('window.mp?.destroy();document.querySelector("#mp")?.remove()');await clipboard.write(original);}
}
module.exports=smoke;
if(process.argv.some(arg=>path.resolve(arg)===__filename)) {
  const root=process.env.MDVIEW_TEST_SCRATCH||'I:/AI/Hermes/cache/scratch';
  require('node:fs').mkdirSync(root,{recursive:true});
  app.setPath('userData',require('node:fs').mkdtempSync(path.join(root,'markdown-paste-profile-')));
  app.whenReady().then(async()=>{let win;try{
    const dir=await fs.mkdtemp(path.join(root,'markdown-paste-'));
    await require('esbuild').build({entryPoints:[path.join(__dirname,'../src/rich-editor.js')],outfile:path.join(dir,'editor.js'),bundle:true,platform:'browser',format:'iife',globalName:'MdViewRich'});
    await fs.writeFile(path.join(dir,'index.html'),`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; img-src data:; style-src 'self'"><body><script src="editor.js"></script>`);
    win=new BrowserWindow({show:true,width:900,height:700,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
    await win.loadFile(path.join(dir,'index.html'));win.focus();
    await smoke({win,outputDirectory:dir});win.destroy();app.exit(0);
  }catch(error){console.error(error);win?.destroy();app.exit(1);}});
}
