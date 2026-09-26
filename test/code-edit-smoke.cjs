const assert = require('node:assert/strict');

// Callable like editor-smoke.cjs: await require('./code-edit-smoke.cjs')({ win }).
module.exports = async ({ win }) => {
  const run = code => win.webContents.executeJavaScript(code, true);
  await run(`(() => {
    const host = document.createElement('div');
    host.id = 'code-edit-smoke'; document.body.append(host);
    window.__codeEditSmoke = MdViewRich.create(host, {
      editorHtml: '<pre><code class="language-custom-lang">alpha\\nbeta\\ngamma</code></pre><p>after</p>',
      source: '', assets: {}
    }, () => {});
  })()`);
  try {
    const selector = '#code-edit-smoke select.code-language';
    assert.equal(await run(`!!document.querySelector('${selector}')`), true, 'code language selector exists');
    assert.equal(await run(`document.querySelector('${selector}').value`), 'custom-lang', 'unknown language preserved');
    assert.equal(await run(`['javascript', 'python', 'json', 'bash', ''].every(value => [...document.querySelector('${selector}').options].some(option => option.value === value))`), true);
    await run(`__codeEditSmoke.editor.commands.setTextSelection({ from: 8, to: 3 })`);
    const before = await run(`({ text: __codeEditSmoke.editor.getText(), selection: __codeEditSmoke.editor.state.selection.toJSON() })`);
    await run(`(() => { const select = document.querySelector('${selector}'); select.focus(); select.value = 'python'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    assert.deepEqual(await run(`({ text: __codeEditSmoke.editor.getText(), selection: __codeEditSmoke.editor.state.selection.toJSON() })`), before, 'language change preserves text and backwards selection');
    assert.equal(await run('__codeEditSmoke.editor.state.doc.firstChild.attrs.language'), 'python');
    assert.match(await run('__codeEditSmoke.editor.getMarkdown()'), /```python\nalpha\nbeta\ngamma/);
    await run('__codeEditSmoke.editor.commands.undo()');
    assert.equal(await run(`document.querySelector('${selector}').value`), 'custom-lang', 'undo synchronizes selector');
    await run(`(() => { const select = document.querySelector('${selector}'); select.value = ''; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    assert.equal(await run('__codeEditSmoke.editor.state.doc.firstChild.attrs.language'), null);
    assert.match(await run('__codeEditSmoke.editor.getMarkdown()'), /```\nalpha/);
    const reset = async (text, from, to = from) => run(`(() => {
      const editor = __codeEditSmoke.editor;
      editor.commands.setContent({ type: 'doc', content: [
        { type: 'codeBlock', attrs: { language: 'javascript' }, content: ${JSON.stringify(text)} ? [{ type: 'text', text: ${JSON.stringify(text)} }] : [] },
        { type: 'paragraph', content: [{ type: 'text', text: 'after' }] }
      ] });
      editor.commands.setTextSelection({ from: ${from}, to: ${to} });
      editor.view.focus();
    })()`);
    const key = (shift = false) => run(`(() => {
      const event = new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', keyCode: 9, shiftKey: ${shift}, bubbles: true, cancelable: true });
      __codeEditSmoke.editor.view.dom.dispatchEvent(event);
      return event.defaultPrevented;
    })()`);
    const state = () => run(`({ text: __codeEditSmoke.editor.state.doc.firstChild.textContent, anchor: __codeEditSmoke.editor.state.selection.anchor, head: __codeEditSmoke.editor.state.selection.head })`);
    await reset('alpha\nbeta\ngamma', 3);
    assert.equal(await key(), true, 'Tab is handled inside code');
    assert.deepEqual(await state(), { text: 'al  pha\nbeta\ngamma', anchor: 5, head: 5 });
    await run('__codeEditSmoke.editor.commands.undo()');
    assert.equal((await state()).text, 'alpha\nbeta\ngamma', 'indent is undoable');
    await reset('alpha\nbeta\ngamma', 9, 3);
    await key();
    assert.deepEqual(await state(), { text: '  alpha\n  beta\ngamma', anchor: 13, head: 5 }, 'whole touched lines indent, keeping backwards selection');
    await key(true);
    assert.deepEqual(await state(), { text: 'alpha\nbeta\ngamma', anchor: 9, head: 3 });
    await reset('alpha\nbeta', 1, 7);
    await key();
    assert.deepEqual(await state(), { text: '  alpha\nbeta', anchor: 3, head: 9 }, 'selection ending at next line start excludes that line');
    await reset('\talpha\n beta\ngamma', 1, 13);
    await key(true);
    assert.deepEqual(await state(), { text: 'alpha\nbeta\ngamma', anchor: 1, head: 11 }, 'outdent handles tabs and partial indentation');
    await reset('  alpha', 2);
    await key(true);
    assert.deepEqual(await state(), { text: 'alpha', anchor: 1, head: 1 }, 'cursor in removed whitespace stays in code');
    await reset('', 1);
    assert.equal(await key(true), true, 'outdent without indentation is a handled no-op');
    await key();
    assert.equal((await state()).text, '  ');
    await reset('\nalpha', 1, 3);
    await key();
    assert.deepEqual(await state(), { text: '  \n  alpha', anchor: 3, head: 7 }, 'leading empty line is indented too');
    await reset('alpha', 2, 10);
    assert.equal(await key(), false, 'selection crossing code boundary is not rewritten');
    assert.equal((await state()).text, 'alpha');
    await reset('alpha', 9);
    assert.equal(await key(), false, 'ordinary paragraph keeps normal Tab behavior');
    console.log('Code edit smoke: language selector, selection preservation, undo, Tab and multiline outdent passed');
  } finally {
    await run(`__codeEditSmoke.destroy(); document.querySelector('#code-edit-smoke').remove(); delete window.__codeEditSmoke`);
  }
};
