/* Shared native accelerators and audited Windows shortcut reference.
 * Editor bindings: production extensions in rich-editor.js / installed Tiptap.
 * Native Ctrl+E, Ctrl+Shift+S and Ctrl+Shift+B take precedence over Tiptap's
 * inline-code, strike and quote bindings: deliberately do not advertise those.
 * No command dispatch or document access lives in this catalog.
 */
(function (root) {
  const groups = {
    files: ['文件与标签', 'Files & tabs'], view: ['查看与导航', 'View & navigation'],
    search: ['文档搜索', 'Document search'], edit: ['文字编辑', 'Text editing'],
    blocks: ['段落、列表与代码', 'Blocks, lists & code'], controls: ['界面操作', 'Interface controls']
  };
  const entries = [];
  const add = (id, group, zh, en, keys, context = ['', ''], accelerator = null) => entries.push({ id, group, label: [zh, en], keys, context, accelerator });
  const menu = (id, group, zh, en, accelerator, keys = [accelerator]) => add(id, group, zh, en, keys, ['', ''], accelerator);
  menu('new', 'files', '新建空白文档', 'New document', 'Ctrl+N');
  menu('open', 'files', '打开 Markdown', 'Open Markdown', 'Ctrl+O');
  menu('reload', 'files', '重新读取', 'Reload document', 'Ctrl+R');
  menu('save', 'files', '保存', 'Save', 'Ctrl+S');
  menu('save-as', 'files', '另存为', 'Save as', 'Ctrl+Shift+S');
  menu('next-tab', 'files', '下一个标签', 'Next tab', 'Ctrl+Tab');
  menu('previous-tab', 'files', '上一个标签', 'Previous tab', 'Ctrl+Shift+Tab');
  menu('close-tab', 'files', '关闭标签', 'Close tab', 'Ctrl+W');
  menu('edit-mode', 'view', '切换编辑 / 阅读模式', 'Toggle edit / read mode', 'Ctrl+E');
  menu('outline', 'view', '切换侧边栏', 'Toggle sidebar', 'Ctrl+Shift+B');
  menu('settings', 'view', '偏好设置', 'Preferences', 'Ctrl+,');
  menu('keyboard-shortcuts', 'view', '快捷键速查', 'Keyboard shortcuts', 'F1');
  add('fullscreen', 'view', '全屏', 'Full screen', ['F11']);
  add('zoom-in', 'view', '放大界面', 'Zoom interface in', ['Ctrl+Plus'], ['整个界面；不是正文字号', 'Whole interface; not text size']);
  add('zoom-out', 'view', '缩小界面', 'Zoom interface out', ['Ctrl+-'], ['整个界面；不是正文字号', 'Whole interface; not text size']);
  add('zoom-reset', 'view', '重置界面缩放', 'Reset interface zoom', ['Ctrl+0']);
  menu('find', 'search', '搜索当前文档', 'Find in current document', 'CmdOrCtrl+F', ['Ctrl+F']);
  menu('find-all', 'search', '搜索所有打开的文档', 'Find in all open documents', 'CmdOrCtrl+Shift+F', ['Ctrl+Shift+F']);
  const search = ['搜索栏内', 'In search bar'];
  add('next-match', 'search', '下一个匹配', 'Next match', ['Enter'], search);
  add('previous-match', 'search', '上一个匹配', 'Previous match', ['Shift+Enter'], search);
  add('close-search', 'search', '关闭搜索', 'Close search', ['Escape'], ['搜索打开时；无弹框', 'Search open; no modal']);
  const editor = ['仅编辑器', 'Editor only'];
  add('bold', 'edit', '加粗', 'Bold', ['Ctrl+B'], editor);
  add('italic', 'edit', '斜体', 'Italic', ['Ctrl+I'], editor);
  add('underline', 'edit', '下划线', 'Underline', ['Ctrl+U'], editor);
  add('undo', 'edit', '撤销', 'Undo', ['Ctrl+Z'], editor);
  add('redo', 'edit', '重做', 'Redo', ['Ctrl+Shift+Z', 'Ctrl+Y'], editor);
  add('select-all', 'edit', '全选', 'Select all', ['Ctrl+A'], ['编辑器 / 输入框', 'Editor / text field']);
  add('copy', 'edit', '复制', 'Copy', ['Ctrl+C'], ['选中文字', 'Selected text']);
  add('cut', 'edit', '剪切', 'Cut', ['Ctrl+X'], ['编辑器 / 输入框', 'Editor / text field']);
  add('paste', 'edit', '粘贴并替换选区', 'Paste and replace selection', ['Ctrl+V'], ['编辑器识别 Markdown；支持 PNG', 'Editor recognizes Markdown; supports PNG']);
  add('paste-plain', 'edit', '粘贴为纯文本', 'Paste as plain text', ['Ctrl+Shift+V'], ['编辑器；不解析 Markdown', 'Editor; bypass Markdown parsing']);
  add('paragraph', 'blocks', '正文', 'Paragraph', ['Ctrl+Alt+0'], editor);
  add('heading', 'blocks', '标题 1–6', 'Heading 1–6', ['Ctrl+Alt+1–6'], editor);
  add('bullet-list', 'blocks', '无序列表', 'Bullet list', ['Ctrl+Shift+8'], editor);
  add('ordered-list', 'blocks', '有序列表', 'Numbered list', ['Ctrl+Shift+7'], editor);
  add('task-list', 'blocks', '任务列表', 'Task list', ['Ctrl+Shift+9'], editor);
  add('code-block', 'blocks', '代码块', 'Code block', ['Ctrl+Alt+C'], editor);
  add('hard-break', 'blocks', '硬换行', 'Hard line break', ['Shift+Enter', 'Ctrl+Enter'], ['编辑器；非代码块；表格末行 Shift+Enter / 首行 Ctrl+Enter 优先退出表格', 'Editor; outside code; last-row Shift+Enter / first-row Ctrl+Enter exit the table instead']);
  add('exit-code', 'blocks', '退出代码块', 'Exit code block', ['Ctrl+Enter'], ['仅编辑中的代码块', 'Editable code only']);
  add('code-indent', 'blocks', '插入两个空格 / 多行缩进', 'Insert two spaces / indent lines', ['Tab'], ['仅编辑中的代码块', 'Editable code only']);
  add('code-outdent', 'blocks', '减少行首缩进', 'Outdent lines', ['Shift+Tab'], ['仅编辑中的代码块', 'Editable code only']);
  add('list-indent', 'blocks', '增加 / 减少列表层级', 'Indent / outdent list item', ['Tab', 'Shift+Tab'], ['编辑器列表内', 'In an editor list']);
  add('list-split', 'blocks', '新列表项；空项退出列表', 'New list item; exit empty item', ['Enter'], ['编辑器列表内', 'In an editor list']);
  add('table-next', 'blocks', '下一单元格；末格新增行', 'Next cell; add row at last cell', ['Tab'], ['编辑器表格内', 'In an editor table']);
  add('table-previous', 'blocks', '上一单元格', 'Previous cell', ['Shift+Tab'], ['编辑器表格内', 'In an editor table']);
  add('table-append', 'blocks', '追加行并移到对应列', 'Append row and move to same column', ['Enter'], ['编辑表格末行；普通段落中的空选区光标，非输入法组词', 'Last table row; caret in a paragraph, not a range or IME composition']);
  add('table-exit-below', 'blocks', '移到表格下方空段落', 'Move to empty paragraph below table', ['Shift+Enter'], ['编辑表格末行；普通段落中的空选区光标', 'Last table row; caret in a paragraph, no range selection']);
  add('table-exit-above', 'blocks', '移到表格上方空段落', 'Move to empty paragraph above table', ['Ctrl+Enter'], ['编辑表格首行（含表头）；普通段落中的空选区光标', 'First table row (including header); caret in a paragraph, no range selection']);
  add('table-delete', 'blocks', '删除整张表格', 'Delete entire table', ['Backspace', 'Delete', 'Ctrl+Backspace', 'Ctrl+Delete'], ['编辑器；已选中全部单元格', 'Editor; all cells selected']);
  add('image-context', 'controls', '打开图片批量尺寸菜单', 'Open image group size menu', ['Shift+F10', 'ContextMenu'], ['编辑器聚焦且已多选图片', 'Editor focused with image group selected']);
  add('image-clear', 'controls', '关闭图片菜单 / 清除图片多选', 'Close image menu / clear image group', ['Escape'], ['编辑器图片多选时', 'Editor image group active']);
  add('image-apply', 'controls', '应用共同尺寸', 'Apply common dimensions', ['Enter'], ['图片尺寸菜单输入框内', 'Image size menu text field']);
  add('table-menu', 'controls', '切换表格菜单项', 'Move through table menu', ['↑', '↓', 'Home', 'End'], ['表格右键菜单打开时', 'Table context menu open']);
  add('table-menu-close', 'controls', '关闭表格菜单', 'Close table menu', ['Escape', 'Tab'], ['表格右键菜单打开时', 'Table context menu open']);
  add('menu-focus', 'controls', '聚焦菜单栏', 'Focus menu bar', ['Alt', 'F10']);
  add('menu-open', 'controls', '文件 / 编辑 / 查看 / 设置菜单', 'File / Edit / View / Settings menu', ['Alt+F', 'Alt+E', 'Alt+V', 'Alt+S']);
  add('menu-move', 'controls', '切换菜单；首项 / 末项', 'Move between menus; first / last', ['←', '→', 'Home', 'End'], ['菜单栏聚焦时', 'Menu bar focused']);
  add('menu-expand', 'controls', '打开菜单', 'Open menu', ['↓', 'Enter', 'Space'], ['菜单栏聚焦时', 'Menu bar focused']);
  add('dialog-close', 'controls', '关闭弹框 / 取消', 'Close dialog / cancel', ['Escape'], ['弹框内；未保存确认不会丢弃修改', 'In a dialog; unsaved confirmation cancels']);
  add('focus', 'controls', '下一个 / 上一个控件', 'Next / previous control', ['Tab', 'Shift+Tab'], ['界面控件；编辑器内依上下文', 'UI controls; context-dependent in editor']);
  add('select-navigation', 'controls', '选择选项；首项 / 末项', 'Choose option; first / last', ['↑', '↓', 'Home', 'End'], ['下拉框聚焦时', 'Dropdown focused']);
  add('select-commit', 'controls', '打开 / 确认选项', 'Open / confirm option', ['Enter', 'Space'], ['下拉框聚焦时', 'Dropdown focused']);
  add('select-dismiss', 'controls', '关闭选项列表', 'Dismiss options', ['Escape'], ['下拉框展开时', 'Dropdown open']);
  add('sidebar-width', 'controls', '调整侧边栏宽度', 'Resize sidebar', ['←', '→', 'Shift+←', 'Shift+→', 'Home', 'End'], ['分隔条聚焦；10 / 40 px，最小 / 最大', 'Separator focused; 10 / 40 px, min / max']);
  const api = { groups, entries, accelerator: id => entries.find(entry => entry.id === id)?.accelerator };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MdViewShortcuts = api;
})(globalThis);
