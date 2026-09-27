const { test } = require('node:test');
const assert = require('node:assert/strict');
const { entries, groups, accelerator } = require('../src/shortcuts-data.js');
const { getExtensionField } = require('@tiptap/core');

test('shortcut reference has unique IDs, bilingual copy, real keys and no mouse chords', () => {
  assert.equal(new Set(entries.map(entry => entry.id)).size, entries.length);
  for (const entry of entries) {
    assert.ok(groups[entry.group], entry.id);
    assert.ok(entry.label.every(text => typeof text === 'string' && text.length), entry.id);
    assert.equal(entry.context.length, 2);
    assert.ok(entry.keys.length);
    assert.ok(entry.keys.every(key => !/click|wheel|滚轮|点击/i.test(key)), entry.id);
  }
  assert.equal(accelerator('keyboard-shortcuts'), 'F1');
  assert.equal(accelerator('find-all'), 'CmdOrCtrl+Shift+F');
  assert.equal(accelerator('unknown'), undefined);
  assert.deepEqual(entries.find(entry=>entry.id==='image-context')?.keys,['Shift+F10','ContextMenu']);
});

test('advertised formatting keys exist in installed editor extensions; native conflicts stay native', () => {
  const cases = [
    ['bold', '@tiptap/extension-bold', 'Bold'], ['italic', '@tiptap/extension-italic', 'Italic'],
    ['underline', '@tiptap/extension-underline', 'Underline'],
    ['undo', '@tiptap/extensions', 'UndoRedo'], ['redo', '@tiptap/extensions', 'UndoRedo'],
    ['paragraph', '@tiptap/extension-paragraph', 'Paragraph'],
    ['bullet-list', '@tiptap/extension-list', 'BulletList'], ['ordered-list', '@tiptap/extension-list', 'OrderedList'],
    ['task-list', '@tiptap/extension-list', 'TaskList'], ['code-block', '@tiptap/extension-code-block', 'CodeBlock'],
    ['hard-break', '@tiptap/extension-hard-break', 'HardBreak'],
    ['table-next', '@tiptap/extension-table', 'Table'], ['table-previous', '@tiptap/extension-table', 'Table']
  ];
  const normalize = key => key.toLowerCase().split(/[-+]/).map(part => part === 'ctrl' ? 'mod' : part).sort().join('-');
  for (const [id, module, name] of cases) {
    const extension = require(module)[name];
    const keys = Object.keys(getExtensionField(extension, 'addKeyboardShortcuts', { name: extension.name, options: extension.options, editor: {} })());
    for (const combo of entries.find(entry => entry.id === id).keys) assert.ok(keys.some(key => normalize(key) === normalize(combo)), `${id}: ${combo} missing from ${keys}`);
  }
  assert.equal(accelerator('edit-mode'), 'Ctrl+E');
  assert.equal(accelerator('save-as'), 'Ctrl+Shift+S');
  assert.equal(accelerator('outline'), 'Ctrl+Shift+B');
  assert.equal(entries.some(entry => ['inline-code', 'strike', 'blockquote'].includes(entry.id)), false, 'native accelerators override these inherited editor bindings');
});
