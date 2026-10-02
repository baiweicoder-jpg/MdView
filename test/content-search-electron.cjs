const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, Menu } = require('electron');
const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || app.getPath('temp'), 'mdview-search-'));
app.setPath('userData', path.join(dir, 'profile'));
app.disableHardwareAcceleration();
app.on('browser-window-created', (_e, win) => { win.setOpacity(0); win.setSkipTaskbar(true); win.webContents.setBackgroundThrottling(false); });
(async () => {
 const {win, editSession} = await require('../src/main.cjs');
 // Disable throttling on the loaded renderer as well as the native window.
 win.webContents.setBackgroundThrottling(false);
 const run = async code => { try { return await win.webContents.executeJavaScript(code, true); } catch (e) { console.error('Renderer expression:',code); throw e; } };
 // Tiptap's existing style injection is CSP-blocked on editor creation. Measure
 // violations introduced by search separately after initialization settles.
 win.webContents.on('console-message', event => { if(event.level === 'error' && !event.message.startsWith('Applying inline style violates')) console.error(event.message); });
 const wait = async code => { for(let i=0;i<240;i++){ if(await run(code)) return; await new Promise(r=>setTimeout(r,25)); } assert.fail(code); };
 await wait('!!currentDocument && !restoringView');
 assert.equal(await run('typeof window.mdviewSearch'), 'object', 'production content search is installed');
 const file = path.join(dir, '搜索 <img>.md'.replace(/[<>]/g,'_'));
 fs.writeFileSync(file, '# 你好 **世界**\n\n你好 世界 你好 世界\n\n```js\n你好 世界\n```');
 editSession.openDocument(await require('../src/markdown.cjs').readDocument(file));
 await wait(`currentDocument.path === ${JSON.stringify(file)} && !restoringView`);
 const query = async (q,scope='current') => { await run(`window.mdviewSearch.open(${JSON.stringify(scope)}); document.querySelector('#document-search-query').value=${JSON.stringify(q)}; document.querySelector('#document-search-query').dispatchEvent(new Event('input'));`); await wait('!window.mdviewSearch.pending'); };
 // List containers are not parser text blocks unless they own a tight paragraph.
 const listCases = [
   ['all-inline-owners', '- needle\n  # needle\n  needle', ['li > span:first-child','li > h1','li > span:last-child']],
   ['nested-owner-order', '- needle\n  - needle\n  # needle\n  needle', ['#content > ul > li > span:first-child','li li > span','#content > ul > li > h1','#content > ul > li > span:last-child']],
   ['tight-task-text', '- [x] needle', 'li > div > span'],
   ['loose-task-text', '- [x] needle\n\n  continuation', 'li > div > p:first-child'],
   ['entity-offsets', '- &nbsp;&#32;&#10;needle', 'li > span'],
   ['heading-then-paragraph', '- # heading\n  needle', 'li > span[data-search-inline]'],
   ['fence-then-paragraph', '- ```text\n  code\n  ```\n  needle', 'li > span[data-search-inline]'],
   ['paragraph-heading-paragraph', '- first\n  # heading\n  needle', 'li > span[data-search-inline]:last-child'],
   ['nested-heading-paragraph', '- first\n  - # heading\n    needle', 'li li > span[data-search-inline]'],
   ['task-heading-paragraph', '- [x] first\n  # heading\n  needle', 'li > div > span[data-search-inline]:last-child'],
   ['empty-item', '-\n- needle', 'li:nth-child(2)'],
   ['heading-item', '- # needle', 'li h1'],
   ['fenced-item', '- ```text\n  needle\n  ```', 'li pre code'],
   ['nested-empty-item', '-\n  - needle', 'li li'],
   ['empty-task-item', '- [ ]\n- needle', 'li:nth-child(2)'],
   ['nbsp-item', '- &nbsp;\n- needle', 'li:nth-child(2)'],
   ['space-entity-item', '- &#32;\n- needle', 'li:nth-child(2)'],
   ['newline-entity-item', '- &#10;\n- needle', 'li:nth-child(2)'],
   ['nested-newline-entity', '- &#10;\n  - needle', 'li li'],
   ['loose-entity-item', '- &nbsp;\n\n- needle', 'li:nth-child(2) > p'],
   ['nested-empty-task', '- [ ]\n  - needle', 'li li'],
   ['loose-nested-empty-task', '- [ ]\n\n  - needle', 'li li'],
   ['loose-empty-task-paragraph', '- [ ]\n\n  needle', 'li > div > p:nth-child(2)'],
   ['nested-loose-empty-task', '- parent\n  - [ ]\n\n  - needle', 'li li:nth-child(2) > p'],
 ];
 const mappingFailures = [];
 for (const [name, source, target] of listCases) {
   const fixture = path.join(dir, `${name}.md`);
   fs.writeFileSync(fixture, source + '\n\nlater needle');
   editSession.openDocument(await require('../src/markdown.cjs').readDocument(fixture));
   await wait(`currentDocument.path === ${JSON.stringify(fixture)} && !restoringView`);
   const originalListDOM = await run('document.querySelector("#content").innerHTML');
   const targets = (Array.isArray(target) ? target : [target]).concat('p:last-child');
   const total = targets.length;
   await query('needle');
   await wait(`!window.mdviewSearch.pending && window.mdviewSearch.total === ${total} && CSS.highlights.has("document-search")`);
   const actual = await run(`(()=>{const ranges=[...CSS.highlights.get('document-search')];const selectors=${JSON.stringify(targets)};const targets=selectors.map((s,i)=>document.querySelector(i===selectors.length-1?'#content > p:last-child':s.startsWith('#content')?s:'#content '+s));return {total:window.mdviewSearch.total,text:ranges.map(r=>r.toString()),exact:ranges.map((r,i)=>!!targets[i]&&targets[i].contains(r.startContainer)&&targets[i].contains(r.endContainer))}})()`);
   try {
     assert.deepEqual(actual, {total,text:Array(total).fill('needle'),exact:Array(total).fill(true)}, name);
     assert.equal(await run('document.querySelector("#content").innerHTML'), originalListDOM, `${name}: search leaves DOM unchanged`);
     assert.equal(await run('payload().source'), source + '\n\nlater needle', `${name}: source preserved`);
     await run('document.querySelector("#document-search-previous").click()');
     await wait(`document.querySelector("#document-search-count").textContent.startsWith("${total} /")`);
     assert.equal(await run('[...CSS.highlights.get("document-search-selected")][0]?.toString()'), 'needle', `${name}: later navigation`);
   } catch (error) { mappingFailures.push(error.message); }
 }
 assert.deepEqual(mappingFailures, [], 'list hits and subsequent hits map to exact DOM ranges');
 // Differential geometry under production CSS: wrappers must not change bullets,
 // text wrapping, checkbox alignment, or loose/tight task content layout.
 const layoutSource = '- plain **text** that wraps ' + 'long text '.repeat(35) + '\n  - nested text\n\n- [x] task text\n\n  second paragraph\n\n- [ ] empty task\n\nend';
 const tightLayoutSource = '- normal text\n- [x] task text\n  - nested text\n- [ ]\n\nend';
 for (const source of [layoutSource, tightLayoutSource]) {
   const rendered = await require('../src/markdown.cjs').renderMarkdown(source);
   const geometry = await run(`(()=>{
     const content=document.querySelector('#content'), original=content.innerHTML;
     const measure=html=>{
       content.innerHTML=html;
       const origin=content.getBoundingClientRect();
       const rect=r=>[r.left-origin.left,r.top-origin.top,r.width,r.height];
       const elements=[...content.querySelectorAll('ul,li,label,input,li > div,p')].map(el=>({tag:el.tagName,rect:rect(el.getBoundingClientRect()),display:getComputedStyle(el).display,list:getComputedStyle(el).listStyleType}));
       const walker=document.createTreeWalker(content,NodeFilter.SHOW_TEXT), text=[];
       while(walker.nextNode()) if(walker.currentNode.data.trim()) {const node=walker.currentNode,r=new Range();r.setStart(node,node.data.length-node.data.trimStart().length);r.setEnd(node,node.data.trimEnd().length);text.push({text:node.data.trim(),rects:[...r.getClientRects()].map(rect)});}
       return {elements,text};
     };
     try {return {baseline:measure(${JSON.stringify(rendered.editorHtml)}),reader:measure(${JSON.stringify(rendered.html)}),inline:[...content.querySelectorAll('[data-search-inline]')].every(el=>getComputedStyle(el).display==='inline')};}
     finally {content.innerHTML=original;}
   })()`);
   assert.deepEqual(geometry.reader, geometry.baseline, 'reader wrappers preserve exact normal/task list and text geometry');
   assert.equal(geometry.inline, true, 'search owners retain inline layout');
 }
 console.log('LIST MAPPING PASS: '+listCases.length+' exact-range/source fixtures; loose/tight normal/task geometry unchanged');
 editSession.openDocument(await require('../src/markdown.cjs').readDocument(file));
 await wait(`currentDocument.path === ${JSON.stringify(file)} && !restoringView`);
 const readerDOM = await run('document.querySelector("#content").innerHTML');
 await query('你好 世界');
 assert.equal(await run('document.querySelector("#content").innerHTML'),readerDOM,'reader highlights do not rewrite DOM');
 assert.equal(await run('window.mdviewSearch.total'),4);
 assert.equal(await run('CSS.highlights.get("document-search").size'),4);
 // Reader ranges span inline formatting and include folded code, without DOM rewriting.
 assert.deepEqual(await run('[...CSS.highlights.get("document-search")].map(r=>r.toString())'), Array(4).fill('你好 世界'));
 const original = await run('payload().source');
 const foldControl = await run('(()=>{const b=document.querySelector("#content .collapse-code");return {label:b.textContent,title:b.title,expanded:b.getAttribute("aria-expanded")}})()');
 await run('document.querySelector("#content .collapse-code").click(); document.querySelector("#document-search-previous").click()');
 await wait('!document.querySelector("#content .code-block").classList.contains("code-collapsed")');
 assert.deepEqual(await run('(()=>{const b=document.querySelector("#content .collapse-code");return {label:b.textContent,title:b.title,expanded:b.getAttribute("aria-expanded")}})()'), foldControl, 'search expansion restores Fold label, title and aria-expanded');
 assert.equal(await run('payload().source'),original);
 await run('toggleEditing()'); await wait('!window.mdviewSearch.pending');
 assert.deepEqual(await run('[...document.querySelectorAll(".document-search-selected")].map(n=>n.textContent).join("")'), '你好 世界');
 assert.equal(await run('payload().source'),original);
 // A selected repeated occurrence, not the first equal string.
 await run('document.querySelector("#document-search-next").click()');
 await wait('document.querySelector("#document-search-count").textContent.startsWith("2 /")');
 assert.equal(await run('document.querySelector(".document-search-selected").closest("p").textContent'), '你好 世界 你好 世界');
 const first = await run('currentDocument.id');
 await run('richEditor.editor.commands.insertContentAt(richEditor.editor.state.doc.content.size, "<p>draftneedle draftneedle</p>")');
 const draftA = await run('payload().source');
 await run('toggleEditing()');
 await run('window.mdview.newDocument()'); await wait(`currentDocument.id !== ${first} && editing && !restoringView`);
 const second = await run('currentDocument.id');
 await run('richEditor.editor.commands.setContent("<p>draftneedle &lt;img onerror=alert(1)&gt; draftneedle</p>", {emitUpdate:false})');
 const draftB = await run('payload().source');
 await query('draftneedle','all');
 assert.equal(await run('window.mdviewSearch.total'),4, 'all tabs search uses inactive draft and flushes active unsent content');
 assert.equal(await run('document.querySelectorAll(".document-search-result").length'),4);
 await run('document.querySelector(".document-search-result").click()');
 await wait(`currentDocument.id === ${first} && !restoringView`);
 await new Promise(r=>setTimeout(r,100));
 assert.equal(await run('payload().source'),draftA);
 assert.equal(await run('[...CSS.highlights.get("document-search-selected")][0]?.toString()'),'draftneedle', 'inactive read-mode draft is displayed and exact hit located');
 await run('document.querySelectorAll(".document-search-result")[3].click()');
 await wait(`currentDocument.id === ${second} && !restoringView`);
 await new Promise(r=>setTimeout(r,100));
 assert.equal(await run('payload().source'),draftB);
 assert.equal(await run('document.querySelector(".document-search-selected").textContent'),'draftneedle');
 assert.equal(await run('document.querySelectorAll("#document-search-results img").length'),0, 'snippets never parse HTML');
 // Native accelerators and Enter/Shift+Enter/Escape drive the production UI.
 const key = (keyCode, modifiers=[]) => { win.webContents.sendInputEvent({type:'keyDown',keyCode,modifiers}); win.webContents.sendInputEvent({type:'keyUp',keyCode,modifiers}); };
 win.show(); win.focus();
 await run('window.mdviewSearch.close()'); key('F',['control']);
 await wait('!document.querySelector("#document-search").hidden && document.querySelector("#document-search-scope").value === "current"');
 key('F',['control','shift']); await wait('document.querySelector("#document-search-scope").value === "all"');
 assert.ok(Menu.getApplicationMenu().items[1].submenu.items.some(item=>item.accelerator === 'CmdOrCtrl+Shift+F'));
 await query('draftneedle');
 await run('document.querySelector("#document-search-query").focus()');
 key('Enter'); await wait('document.querySelector("#document-search-count").textContent.startsWith("2 /")');
 key('Enter',['shift']); await wait('document.querySelector("#document-search-count").textContent.startsWith("1 /")');
 key('Escape'); await wait('document.querySelector("#document-search").hidden');
 assert.equal(await run('document.querySelectorAll(".document-search-match").length'),0);
 // Source and model/history must not be changed by any search operation.
 const model = await run('JSON.stringify(richEditor.editor.getJSON())');
 await new Promise(r=>setTimeout(r,100));
 await run('window.searchCSP=[]; document.addEventListener("securitypolicyviolation",e=>window.searchCSP.push(e.violatedDirective))');
 await query('draftneedle'); await run('document.querySelector("#document-search-case").click()'); await wait('!window.mdviewSearch.pending');
 await query('');
 assert.equal(await run('JSON.stringify(richEditor.editor.getJSON())'), model);
 assert.equal(await run('payload().source'),draftB);
 assert.deepEqual(await run('window.searchCSP'),[],'search adds no CSP violations');
 assert.equal(await run('document.querySelectorAll(".document-search-match").length'),0);
 await query('no-such-text'); assert.equal(await run('window.mdviewSearch.total'),0);
 // In-flight query replacement during tab navigation must invalidate the old result.
 await query('draftneedle','all');
 await run('document.querySelector(".document-search-result").click(); document.querySelector("#document-search-query").value="absent-after-navigation"; document.querySelector("#document-search-query").dispatchEvent(new Event("input"))');
 await wait(`currentDocument.id === ${first} && !restoringView && !window.mdviewSearch.pending`);
 assert.equal(await run('window.mdviewSearch.total'),0, 'a query change during navigation cannot paint stale results');
 // Mixed block mappings, image atoms, task labels, rich marks and table cells.
 const complex = '- [x] ==needle==\n- <u>needle</u>\n\n| h |\n|---|\n| `needle` |\n\na ![ignored](missing.png){width=240} needle\nsoft  \nneedle\n\n```js\nneedle needle\n```';
 const complexFile = path.join(dir,'mixed.md'); fs.writeFileSync(complexFile,complex);
 editSession.openDocument(await require('../src/markdown.cjs').readDocument(complexFile));
 await wait('currentDocument.name === "mixed.md" && !restoringView');
 await query('needle'); assert.equal(await run('window.mdviewSearch.total'),7);
 assert.deepEqual(await run('[...CSS.highlights.get("document-search")].map(r=>r.toString())'),Array(7).fill('needle'));
 await run('toggleEditing()'); await wait('!window.mdviewSearch.pending');
 assert.equal(await run('[...document.querySelectorAll(".document-search-match")].map(n=>n.textContent).join("|")'),Array(7).fill('needle').join('|'));
 await run('richEditor.editor.commands.insertContentAt(1,"history-sentinel ")');
 await query('history-sentinel'); assert.equal(await run('window.mdviewSearch.total'),1);
 await run('richEditor.editor.commands.undo()'); await wait('!window.mdviewSearch.pending');
 assert.equal(await run('window.mdviewSearch.total'),0,'search does not create undo steps');
 await run('richEditor.editor.commands.redo()'); await wait('!window.mdviewSearch.pending');
 assert.equal(await run('window.mdviewSearch.total'),1);
 // Empty live paragraphs and original Markdown whitespace do not shift editor hits.
 await run('richEditor.editor.commands.insertContentAt(0,"<p></p>")');
 await query('history-sentinel');
 assert.equal(await run('document.querySelector(".document-search-match")?.textContent'),'history-sentinel');
 const spacedFile = path.join(dir,'spaces.md'); fs.writeFileSync(spacedFile,'before  needle and   needle');
 editSession.openDocument(await require('../src/markdown.cjs').readDocument(spacedFile));
 await wait('currentDocument.name === "spaces.md" && !restoringView');
 await query('needle'); await run('toggleEditing()'); await wait('!window.mdviewSearch.pending');
 assert.deepEqual(await run('[...document.querySelectorAll(".document-search-match")].map(n=>n.textContent)'),['needle','needle']);
 // Navigation scrolls to the exact occurrence inside a very long code node.
 const longFile = path.join(dir,'long-code.md');
 fs.writeFileSync(longFile,'```text\nscrollneedle\n'+('filler\n'.repeat(180))+'scrollneedle\n```');
 editSession.openDocument(await require('../src/markdown.cjs').readDocument(longFile));
 await wait('currentDocument.name === "long-code.md" && !restoringView');
 await query('scrollneedle');
 await run('document.querySelector("#document-search-previous").click()');
 await wait('document.querySelector("#document-search-count").textContent.startsWith("2 /")');
 assert.equal(await run('(()=>{const r=[...CSS.highlights.get("document-search-selected")][0].getBoundingClientRect(),v=reader.getBoundingClientRect();return r.top>=v.top && r.bottom<=v.bottom})()'),true,'reader scrolls to occurrence, not center of long code block');
 await run('toggleEditing()'); await wait('!window.mdviewSearch.pending');
 await run('document.querySelector("#document-search-previous").click()');
 await wait('document.querySelector("#document-search-count").textContent.startsWith("2 /")');
 assert.equal(await run('(()=>{const r=document.querySelector(".document-search-selected").getBoundingClientRect(),v=reader.getBoundingClientRect();return r.top>=v.top && r.bottom<=v.bottom})()'),true,'editor scrolls to occurrence');
 // Cap DOM and highlight allocations, but keep the true total.
 await run('richEditor.editor.commands.setContent("<p>capword ".repeat(1200)+"</p>")');
 await query('capword'); assert.equal(await run('window.mdviewSearch.total'),1200);
 assert.equal(await run('document.querySelectorAll(".document-search-match").length'),500);
 assert.ok((await run('document.querySelector("#document-search-count").textContent')).includes('500'));
 // Themes and narrow layout use the app palette; search never overflows the viewport.
 win.setMinimumSize(480,520); win.setSize(620,720);
 for(const theme of ['light','dark','warm']) {
   await run(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
   const rect = await run('(()=>{const r=document.querySelector("#document-search").getBoundingClientRect();return {left:r.left,right:r.right,width:innerWidth,bg:getComputedStyle(document.querySelector("#document-search")).backgroundColor}})()');
   assert.ok(rect.left>=0 && rect.right<=rect.width + 1, JSON.stringify(rect)); assert.notEqual(rect.bg,'rgba(0, 0, 0, 0)');
   assert.ok(rect.width <= 620,'exercise the wrapped compact layout, not the native minimum width');
 }
 // Closing a matching tab removes its results and keeps the other draft.
 await run('window.mdviewSearch.close(); void closeTab(currentDocument.id)');
 await wait('document.querySelector("#unsaved-dialog").open');
 await run('document.querySelector("#unsaved-dialog [data-choice="+JSON.stringify("discard")+"]").click()');
 await wait('currentDocument.name !== "long-code.md" && !fileBusy && !restoringView');
 await query('capword','all'); assert.equal(await run('window.mdviewSearch.total'),0);
 console.log('CONTENT SEARCH PASS: reader/editor exact ranges, folded code, Unicode, drafts/flush, native keys, history, stale queries, cap, themes, close'); app.exit(0);
})().catch(e=>{console.error(e);app.exit(1);});
