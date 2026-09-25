# MdView

Windows 本地 Markdown 阅读器。支持代码语法高亮、目录导航、浅色 / 深色 / 暖纸 / 跟随系统、字号记忆、拖入文件、代码复制及相对路径图片。

## 开发与验证

需要 Node.js 22.12+（本项目使用 Node.js 24），Windows x64。

```powershell
npm ci
npm run icons
npm start
npm test
npm run test:desktop
npm run package
```

`npm run package` 输出到 `dist/<时间戳>/MdView-win32-x64/`。双击其中的 `MdView.exe`，须保留同目录的资源与 DLL；整目录可复制到另一台 Windows x64 电脑，无需安装 Node.js。不需要管理员权限，不修改默认文件关联。

命令行也可打开文件：`MdView.exe "D:\文档\示例.md"`，或将文件拖到程序窗口 / EXE 上。打包后可运行 `MdView.exe --smoke-test` 验证实际产物；测试使用独立临时偏好目录，截图与报告写入当前目录的 `artifacts/`。

## 使用

- `Ctrl+O` 打开；`Ctrl+R` 重新读取；`Ctrl+Shift+B` 切换目录；`F11` 全屏。
- 点击「编辑」或 `Ctrl+E`，直接在渲染内容中输入；支持标题、加粗、斜体、列表、引用、代码块、表格与撤销重做。`Ctrl+B` 加粗，`Ctrl+S` 保存，`Ctrl+Shift+S` 另存为。「完成编辑」返回阅读，不会自动保存。
- 未保存时关闭、打开或刷新会询问保存 / 不保存 / 取消。磁盘文件被其他程序修改后拒绝覆盖，可另存为保留草稿。欢迎文档必须另存为。
- 主题与字号在本机保存；文档内容不上传。进入编辑但未修改时保留原文；修改后保存会规范化 Markdown 排版，UTF-8 BOM 与原换行格式保留。
- `Ctrl`＋鼠标滚轮：向上放大、向下缩小阅读字号（13–24 px），工具栏字号同步更新并记忆；普通滚轮仍滚动文档。
- 每个代码块提供 `A−` / `A＋` 独立缩放（70%–200%），点击百分比恢复默认。正文与其他代码块不受单块缩放影响；刷新或重新打开文档后单块缩放复原。围栏代码和缩进代码均支持。
- 点击代码块的「单独查看」打开弹框，保留当前高亮、配色和缩放比例。弹框内可复制、点击 A− / A＋或使用 Ctrl＋滚轮独立缩放；关闭按钮或 Esc 返回原文，原代码字号和阅读位置不变。刷新 / 切换文档会关闭弹框。
- 代码块请标明语言，例如 `js`、`python`、`java`、`sql`。首版按 highlight.js 的 common 语言集合提供高亮，未知语言显示纯文本。
- 支持 UTF-8 Markdown，单文档最多 10 MB。
- 图片支持文档目录及子目录内的相对路径，合计最多 24 MB；支持 PNG、JPEG、GIF、WebP、BMP、AVIF、ICO。网络图片、SVG、绝对路径和越过文档目录的图片显示说明。
- 文内锚点与 HTTP(S) 网页链接可点击，网页交给默认浏览器；其他本地 Markdown 请通过打开文件读取。
- 暂不含自动监视文件变化、公式、Mermaid、任务列表复选框、PDF 导出和自动更新。

## 实现与安全边界

Electron 主进程使用 markdown-it 和 highlight.js 生成内容，只读取用户选定的文档及其目录内图片。原始 HTML 关闭，图片经真实路径校验后转换为 data URL；渲染进程禁用 Node、开启 sandbox 和 contextIsolation，CSP 禁止网络请求与内嵌脚本。外链只允许 HTTP(S)，文件错误保留当前阅读内容。

`src/markdown.cjs` 负责解析和受限图片读取；`src/document-file.cjs` 负责 UTF-8 与临时文件替换保存；`src/edit-session.cjs` 负责草稿、冲突与退出保护；`src/main.cjs` 负责桌面与 IPC。Tiptap 编辑器使用 esbuild 打包到 `src/generated/`，启动、桌面测试和打包命令会自动构建；无后端或数据库。

专属标志以书页和 V 形阅读视线为设计元素。`src/assets/mdview.svg` 是矢量源稿，`npm run icons` 使用 Electron 自带的浏览器渲染生成 PNG 和 16–256 px 的 Windows ICO，无需额外图像依赖。修改源稿后重新生成并打包，界面、窗口和 EXE 图标保持一致。

测试临时文件保留在系统临时目录用于排查，不自动清理。打包使用新时间戳目录，避免覆盖已有产物。

Windows 上修改含中文的源码优先使用补丁工具；不要用默认编码的 PowerShell 管道把中文脚本传给 Python。本次该方式曾将新增文案变成问号，已用 UTF-8 补丁修正并通过桌面截图核验；下次检查新增文案是否仍出现编码返工。

桌面测试使用软件离屏渲染并等待非空 `paint` 后保存截图（首帧可能为空，须在超时内继续等待）。Electron 44 隐藏窗口的 `capturePage` 在加上 `stayHidden` / `stayAwake` 后仍曾报 `UnknownVizError`，不要改回依赖隐藏 GPU 合成的截图方式。正常应用使用常规窗口与硬件加速；下次升级 Electron 时检查源码和打包产物测试是否均一次通过、所有截图均可解码。
