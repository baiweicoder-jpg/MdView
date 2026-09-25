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

- `Ctrl+O` 打开；`Ctrl+R` 重新读取；`Ctrl+B` 切换目录；`F11` 全屏。
- 主题与字号在本机保存；文档内容不上传、不改写。
- 代码块请标明语言，例如 `js`、`python`、`java`、`sql`。首版按 highlight.js 的 common 语言集合提供高亮，未知语言显示纯文本。
- 支持 UTF-8 Markdown，单文档最多 10 MB。
- 图片支持文档目录及子目录内的相对路径，合计最多 24 MB；支持 PNG、JPEG、GIF、WebP、BMP、AVIF、ICO。网络图片、SVG、绝对路径和越过文档目录的图片显示说明。
- 文内锚点与 HTTP(S) 网页链接可点击，网页交给默认浏览器；其他本地 Markdown 请通过打开文件读取。
- 首版不含编辑、自动监视文件变化、公式、Mermaid、任务列表复选框、PDF 导出和自动更新。

## 实现与安全边界

Electron 主进程使用 markdown-it 和 highlight.js 生成内容，只读取用户选定的文档及其目录内图片。原始 HTML 关闭，图片经真实路径校验后转换为 data URL；渲染进程禁用 Node、开启 sandbox 和 contextIsolation，CSP 禁止网络请求与内嵌脚本。外链只允许 HTTP(S)，文件错误保留当前阅读内容。

`src/markdown.cjs` 负责解析和受限文件读取；`src/main.cjs` 负责桌面与 IPC；`src/renderer.js` 和 `src/style.css` 负责阅读交互及主题。无 Web 构建流程、后端或数据库。

专属标志以书页和 V 形阅读视线为设计元素。`src/assets/mdview.svg` 是矢量源稿，`npm run icons` 使用 Electron 自带的浏览器渲染生成 PNG 和 16–256 px 的 Windows ICO，无需额外图像依赖。修改源稿后重新生成并打包，界面、窗口和 EXE 图标保持一致。

测试临时文件保留在系统临时目录用于排查，不自动清理。打包使用新时间戳目录，避免覆盖已有产物。

桌面测试使用软件离屏渲染并等待非空 `paint` 后保存截图（首帧可能为空，须在超时内继续等待）。Electron 44 隐藏窗口的 `capturePage` 在加上 `stayHidden` / `stayAwake` 后仍曾报 `UnknownVizError`，不要改回依赖隐藏 GPU 合成的截图方式。正常应用使用常规窗口与硬件加速；下次升级 Electron 时检查源码和打包产物测试是否均一次通过、所有截图均可解码。
