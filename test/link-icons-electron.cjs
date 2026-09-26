// Standalone real-Chromium/CSP/Tiptap verification; no network requests.
const { app, BrowserWindow, nativeImage } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { normalizeRaster } = require('../src/link-icons.cjs');
const scratch = fs.mkdtempSync(path.join(process.env.TMPDIR || app.getPath('temp'), 'mdview-link-icons-'));
app.setPath('userData', path.join(scratch, 'profile'));
app.whenReady().then(async () => {
  let win;
  try {
    const src = path.resolve(__dirname, '../src');
    const url = file => pathToFileURL(path.join(src, file)).href;
    const csp = fs.readFileSync(path.join(src, 'index.html'), 'utf8').match(/content="(default-src[^"]+)"/)[1];
    const fixture = path.join(scratch, 'index.html');
    fs.writeFileSync(fixture, `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><link rel="stylesheet" href="${url('style.css')}"><link rel="stylesheet" href="${url('link-icons.css')}"><script src="${url('generated/rich-editor.js')}" defer></script></head><body><dialog id="settings-dialog"></dialog><article id="content"><a href="https://site.com/private?q=secret">Reader</a><a href="https://u:p@site.com/">Credential</a><a href="file:///secret">File</a></article><article id="editor-content"></article></body></html>`);
    win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
    const js = code => win.webContents.executeJavaScript(code, true);
    await win.loadFile(fixture);
    // Use a locally generated, real decoded raster rather than a potentially invalid fixture CRC.
    const png = nativeImage.createFromBitmap(Buffer.from([0, 0, 255, 255]), { width: 1, height: 1 }).toPNG();
    const data = normalizeRaster(png, nativeImage); assert.match(data, /^data:image\/png;base64,/);
    assert.equal(nativeImage.createFromDataURL(data).getSize().width, 16);
    await js(`window.calls=[]; window.pending=[]; window.listeners=[]; window.icon=${JSON.stringify(data)};
      window.mdview={getLinkIcon: target => { calls.push(target); return window.hold ? new Promise(r=>pending.push(r)) : Promise.resolve(window.icon); }, onLanguageChanged: cb=>listeners.push(cb)};
      window.changes=0; window.editorFixture=MdViewRich.create(document.querySelector('#editor-content'), {source:'[Editor](https://site.com/private?q=secret)', editorHtml:'<p><a href="https://site.com/private?q=secret">Editor</a></p>', html:'<p><a href="https://site.com/private?q=secret">Editor</a></p>'}, ()=>changes++);
      window.before=JSON.stringify(editorFixture.editor.getJSON()); window.beforeHTML=document.querySelector('#editor-content').innerHTML;`);
    await new Promise(r => setTimeout(r, 60));
    await js(`window.violations=[]; document.addEventListener('securitypolicyviolation', e=>violations.push(e.violatedDirective));
      const script=document.createElement('script'); script.src=${JSON.stringify(url('link-icons.js'))}; document.head.append(script);`);
    const wait = async expression => {
      for (let i = 0; i < 150; i++) { if (await js(expression)) return; await new Promise(r => setTimeout(r, 20)); }
      throw Error('Timed out: ' + expression);
    };
    await wait('!!document.querySelector("#link-icons-enabled")');
    assert.equal(await js('calls.length'), 0);
    assert.equal(await js('document.querySelector("#link-icons-enabled").checked'), false);
    const toggle = value => js(`document.querySelector('#link-icons-enabled').checked=${value}; document.querySelector('#link-icons-enabled').dispatchEvent(new Event('change'));`);
    await toggle(true);
    await wait('getComputedStyle(document.querySelector("#editor-content a")).backgroundImage.startsWith("url(")');
    assert.match(await js('getComputedStyle(document.querySelector("#content a")).backgroundImage'), /data:image\/png/);
    assert.deepEqual(await js('calls'), [{ protocol: 'https:', hostname: 'site.com' }]);
    assert.equal(await js('JSON.stringify(editorFixture.editor.getJSON()) === before'), true);
    assert.equal(await js('document.querySelector("#editor-content").innerHTML === beforeHTML'), true);
    assert.equal(await js('changes'), 0); assert.equal(await js('document.querySelectorAll("#editor-content img").length'), 0);
    assert.equal(await js('editorFixture.source()'), '[Editor](https://site.com/private?q=secret)');
    await new Promise(r => setTimeout(r, 100)); assert.equal(await js('calls.length'), 1);
    await js('document.documentElement.lang="zh-CN"; listeners.forEach(cb=>cb("zh-CN"))');
    assert.match(await js('document.querySelector("#link-icon-settings").textContent'), /网站图标/);
    await toggle(false);
    assert.equal(await js('getComputedStyle(document.querySelector("#editor-content a")).backgroundImage'), 'none');
    await js('window.hold=true; document.querySelector("#content a").href="https://other.com/new";');
    await toggle(true); await wait('pending.length > 0'); await toggle(false);
    await js('pending.splice(0).forEach(r=>r(icon))');
    await new Promise(r => setTimeout(r, 80));
    assert.equal(await js('getComputedStyle(document.querySelector("#content a")).backgroundImage'), 'none');
    assert.deepEqual(await js('violations'), []);
    assert.equal(await js('localStorage.getItem("mdview-link-icons")'), 'false');
    // Persist true, reload the actual file origin, and verify automatic opt-in restore.
    await js('window.hold=false'); await toggle(true);
    await wait('getComputedStyle(document.querySelector("#content a")).backgroundImage.startsWith("url(")');
    await win.loadFile(fixture);
    await js(`window.calls=[]; window.mdview={ getLinkIcon: target=>{ calls.push(target); return Promise.resolve(${JSON.stringify(data)}); } }; const s=document.createElement('script'); s.src=${JSON.stringify(url('link-icons.js'))}; document.head.append(s);`);
    await wait('!!document.querySelector("#link-icons-enabled")?.checked');
    await wait('getComputedStyle(document.querySelector("#content a")).backgroundImage.startsWith("url(")');
    assert.deepEqual(await js('calls'), [{ protocol: 'https:', hostname: 'site.com' }]);
    // Mutation-created links get decorated; malicious IPC data is never put into CSS.
    await js(`window.mdview.getLinkIcon=()=>Promise.resolve('data:image/svg+xml;base64,PHN2Zy8+'); const a=document.createElement('a'); a.href='https://unsafe.com/'; a.id='unsafe'; a.textContent='Unsafe'; document.querySelector('#content').append(a);`);
    await new Promise(r => setTimeout(r, 100));
    assert.equal(await js('getComputedStyle(document.querySelector("#unsafe")).backgroundImage'), 'none');
    await js(`window.mdview.getLinkIcon=()=>Promise.resolve(${JSON.stringify(data)}); document.querySelector('#unsafe').href='https://newsite.com/new';`);
    await wait('getComputedStyle(document.querySelector("#unsafe")).backgroundImage.startsWith("url(")');
    await js(`document.querySelector('#unsafe').href='mailto:person@example.com'`);
    await wait('getComputedStyle(document.querySelector("#unsafe")).backgroundImage === "none"');
    console.log('PASS link icons: real raster/CSP, default-off, origin-only, reader/editor, unchanged DOM/JSON/source, bilingual, no observer loop, toggle cancellation, reload persistence, dynamic href, unsafe data rejection');
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { win?.destroy(); app.exit(process.exitCode || 0); }
});
