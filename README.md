# MdView

Windows 本地 Markdown 阅读器。支持代码语法高亮、目录导航、浅色 / 深色 / 暖纸 / 审阅纸 / 天蓝 / 跟随系统、字号记忆、拖入文件、代码复制及相对路径图片。

## 开发与验证

需要 Node.js 22.12+（本项目使用 Node.js 24），Windows x64。

```powershell
npm ci
npm run icons
npm start
npm test
npm run test:session
npm run test:acceptance
npm run build
npm run package
npm run release
```

`npm run package` 输出到 `dist/<时间戳>/MdView-win32-x64/`。双击其中的 `MdView.exe`，须保留同目录的资源与 DLL；整目录可复制到另一台 Windows x64 电脑，无需安装 Node.js。不需要管理员权限，不修改默认文件关联。

`npm run release` 同时生成 `MdView-0.1.0-Setup-x64.exe` 一键安装版和 `MdView-0.1.0-Portable-x64.exe` 单文件便携版，以及 `SHA256SUMS.txt` 校验文件。安装版安装到当前用户目录，创建桌面与开始菜单快捷方式，可在 Windows「已安装的应用」中卸载；安装或卸载遇到正在运行的已安装版本会退出，要求先保存并关闭，不强制终止编辑器。卸载保留偏好设置和用户文档。

便携版无须安装，首次启动会临时解压运行文件，偏好设置保存在 EXE 旁的 `MdView-data` 中；请放在可写目录，迁移时连同该文件夹一起复制。两种版本均无需联网下载安装组件。当前产物未配置数字签名，Windows 可能提示未知发布者。

`npm run test:release -- dist/<时间戳>` 验证首次安装、已安装程序、便携启动和设置目录，并检查安装器不会结束正在运行的编辑器。此测试会安装当前用户版本并保留启动的正常窗口；发现已有安装时停止，避免覆盖用户版本。截图和报告保存在 `artifacts/release-*/`，便携测试使用独立副本。

若安装已完成、只需续跑验证，追加 `--installed`；脚本先校验已安装 `app.asar` 与该发行目录一致，不会重新安装。卸载登记的 `DisplayName` 包含版本号，路径从 `DisplayIcon` 读取，不能依赖空的 `InstallLocation`。下次发行检查首次安装与续跑模式是否均一次通过。

命令行也可打开文件：`MdView.exe "D:\文档\示例.md"`，或将文件拖到程序窗口 / EXE 上。打包后可运行 `MdView.exe --smoke-test` 验证实际产物；测试使用独立临时偏好目录，截图与报告写入当前目录的 `artifacts/`。

## 使用

### 列表与纯文本复制 / Lists and plain-text copy

- 删除有序列表中间项后，后续编号按保留项连续计算；Backspace 将中间项提升为正文而拆分列表时，后半段沿用连续编号。保留明确的独立列表起始值（包括 0）及嵌套列表各自的计数，支持撤销 / 重做和保存重开。
- 阅读或编辑模式选中文字后，右键提供「无格式复制（带序号）」和「无格式复制（不带序号）」。两者只写入纯文本、去掉空白行；代码缩进及非空行文字保留，表格以 Tab 分隔列。图片及图片说明 / 未加载占位内容省略，链接只保留显示文字，不附带目标地址。
- 「带序号」保留列表结构序号 / 项目标记，以及开启标题自动序号时的生成前缀；「不带序号」仅省略这些生成的结构标记，**保留正文、代码和标题中手写的数字 / 序号**，不通过正则删改原文。Ctrl+C 仍是原生富文本复制；两种右键操作均不修改文档或撤销历史。
- **Plain-text copy** offers numbered and unnumbered variants in reader/editor text-selection context menus. Both remove blank lines, omit images (including alt/fallback text), preserve nonblank text/code indentation, and separate table cells with tabs. Unnumbered copy removes generated structural markers only, never manually written numbers. Ctrl+C keeps native rich-text behavior. Ordered lists retain zero/custom starts and independent nested counters.

### 清理操作 / Cleanup actions

- 搜索栏的 **删除当前匹配 / Delete current match** 仅删除当前文档中高亮的那一个匹配（包括跨加粗等行内格式、代码中的精确文字），不会批量删除其他结果。仅编辑模式可用；阅读时提示「切换编辑后可用」，空查询、无匹配、搜索中或文件忙碌时禁用。所有文档搜索中先点击目标结果，经正常草稿同步切换到该文档，再删除；不在后台静默修改其他文档。删除后重新搜索，可一次撤销，不保存磁盘文件。
- **编辑模式 → 右侧格式面板 → 文本清理** 提供「删除换行」「删除空白行」「清理多余空格」。优先处理非空选区，否则处理整个当前文档；弹框先显示范围、文档名称、保守规则和预计修改处数，默认聚焦取消；确认才执行，无变化时确认不可用。每次清理一个撤销步骤，不自动保存；文档切换或内容变化会取消过期预览。
- 「删除换行」只合并相邻、非空的顶层普通正文段落，英文/数字边界保留空格，两个汉字边界不加空格。显式 Markdown 硬换行保留；标题、列表、引用、表格、代码以及含行内代码、链接、图片、硬换行的段落均不合并。Markdown 普通软换行已由编辑器按正文空白解析，不将源码重写作为清理手段。
- 「删除空白行」只删除顶层正文空段落或仅有半角空格/Tab 的段落，选区只删除完全包含的段落节点。Markdown 必需的段落分隔不会消失；标题、列表、引用、表格和代码内部不处理。编辑器要求保留的最后空段落可能继续存在。
- 「清理多余空格」仅合并顶层正文重复半角空格为一个，并去除段落首尾多余半角空格；保留单个内部空格、中文之间单空格、英文单词、数字单位、标点分隔、序号后空格、Tab/四空格起始缩进、显式硬换行、行内代码、代码块、链接文字/地址和图片属性。标题、列表、引用、表格不处理；不声称能自动识别所有「有意义空格」，因此不提供无差别删除全部空格。
- **Text cleanup** is available in the editing format inspector. Selection takes precedence over the current document. Preview scope/count first, then apply an undoable model transaction. Cleanup excludes structural blocks and code; single meaningful spaces and explicit hard breaks are retained. Search's **Delete current match** is separate: it can delete exact code text intentionally, but never all search hits. Neither action saves files.


### 标题自动序号 / Automatic heading numbers

在「设置 → 偏好设置」切换「标题自动序号」（English: **Automatic heading numbers**）。默认关闭，在本机记忆开关；阅读正文、编辑正文和实时目录同步显示，插入、删除、调整级别或顺序后重新计算。仅使用 CSS 伪元素，不改变 Markdown、frontmatter、保存内容、标题锚点、搜索文字、编辑选区、撤销历史或未保存状态。

- H1：`一、`、`二、`…`十、`、`十一、`；每个 H1 重置后续层级。
- H2：`1. `、`2. `、`3. `，**不带 H1 编号**；H3：`3.1 `；H4：`3.1.1 `；H5 / H6 继续追加一层。
- 每个父级重置更深层级；跳级时缺失的 H2–H5 祖先按 1 起算，不产生 0、不插入虚拟标题。例如文档直接从 H4 开始显示 `1.1.1`，随后 H3 显示 `1.2`。
- 保留明确的手写序号，抑制该标题的自动前缀，但仍按一个标题计数，不以手写数值重新定位自动计数。例如 `一、资源网站`、`1. 标题`、`2、标题` 和 H3 的 `3.1 标题` 不重复编号。只识别中文数词加 `、`、1–3 位正整数加 `、` 或点/右括号及空格，以及与标题级别深度一致的点分数字。普通 `2026 年报`、`2026. 年报`、`3D 渲染` 不视作序号。
- 手写识别是保守规则，不校正错误序号；H3 的 `1.5 倍速` 与 `1.5 标题` 无法仅靠文字区分，会保留原文。混用手写和自动编号可能不连续；关闭功能总是恢复原始显示。代码、列表数字不参与标题计数。

Default off, persisted locally, and display-only in reader/editor/outline. Missing ancestor levels start at one; H1 is never included in decimal paths. Recognized manual prefixes remain verbatim and still count as headings, so mixed manual/automatic numbering is not corrected. Ambiguous decimal titles at the matching heading depth are preserved rather than rewritten. Generated numbers are not searchable or exported.


- 文档信息紧凑显示为「本地文档 · 文件名 · 路径」，右侧显示「创建 / 更新」（English: Created / Updated），始终保持单行。按系统本地时区显示 `YYYY-MM-DD HH:mm`，悬停显示秒和时间含义，键盘 / 屏幕阅读器可读取完整说明；窄区域省略文字，极窄时隐藏可见日期但仍可悬停标题行查看。
- 已保存文件：创建取文件系统 `birthtime`，更新取磁盘 `mtime`，**不包含未保存编辑**；成功保存 / 另存为 / 重新读取后刷新目标文件的实际时间。原子保存可能替换文件，创建时间遵循目标文件系统的报告，不伪装为原稿最初写作时间；不以 `ctime` 代替创建时间。
- 未命名草稿：创建取新建时刻，更新仅随实际 Markdown 源码变化（包括改变源码的格式编辑、撤销 / 重做）刷新；聚焦、选择、主题 / 字号 / 搜索、重复无变化通知不会更新时间。时间随草稿恢复保存；旧版恢复记录缺少时间、时间无效或文件系统不提供创建时间时显示 `—`，不会补造历史时间。日期不插入 Markdown 正文或 frontmatter。
- 左侧共用「文档目录 / 打开的文档」面板，支持按文件名或路径搜索已打开文件；拖动右边缘调整宽度并记忆，双击恢复默认宽度。
- 打开、恢复或切换到横向标签栏外的文档时，标签栏仅沿水平方向滚动以显示当前文件名，不改变正文滚动或抢焦点；同一标签的普通刷新保留手动滚动位置。
- 「打开的文档」支持复选框 / Ctrl 多选、Shift 连选，以及全选当前筛选结果 / 清除选择。筛选会把选择限制在当前可见结果。「关闭标签」不删除磁盘文件，未保存项逐个走保存 / 不保存 / 取消；取消停止后续关闭，已完成的关闭不回滚。
- 「删除文件…」与关闭分开，确认后将实际文件移到回收站，所选文件的未保存修改会丢弃；未命名草稿不能删除磁盘文件，欢迎文档受保护。失败文件保留标签并报告，成功项才关闭并从恢复记录移除；批量操作不是整体事务，不提供永久删除。
- **Open files** supports checkbox/Ctrl selection, Shift ranges, and filtered Select all. Close tabs preserves disk files and asks about dirty drafts; Delete files is a separate confirmed Recycle Bin action, not permanent deletion. Untitled/welcome documents are protected; failures retain their tabs, and successful earlier operations are not rolled back. Active tabs are revealed horizontally without scrolling document content.
- `Ctrl+F` 搜索当前文档正文；`Ctrl+Shift+F` 搜索所有打开的文档，也可在「编辑」菜单打开。搜索栏支持切换范围、`Aa` 区分大小写、上 / 下一个、`Enter` / `Shift+Enter` 循环定位，`Escape` / `×` 关闭。全局结果显示文件名与纯文本摘要，点击保留当前修改并切换到正确的匹配位置；未命名、当前与后台标签的未保存草稿均参与搜索，不只搜索磁盘文件。左侧文件名过滤仍独立保留。
- 正文搜索按字面匹配（默认不区分大小写、不支持用户正则），包含标题、列表、表格和折叠代码；支持跨行内格式，不跨段落 / 单元格，不搜索 Markdown 标记、链接目标或图片二进制 / 说明。搜索不修改源码、正文选区或撤销历史，定位折叠代码时会展开该块。查询最多 256 个 UTF-16 单元；160 ms 防抖，后台线程逐标签扫描，取消旧任务。沿用最多 100 个标签、每份文档 10 MB 的限制；完整统计总匹配数，但最多显示 / 高亮 / 循环定位前 500 个，超出时明确提示，可缩小范围或细化查询。空查询与无匹配会清除高亮。
- 启动自动恢复上次打开的文件、标签顺序、当前标签、编辑模式和滚动位置（最多 100 个标签）。未命名文档内容备份在本机用户数据目录，退出无需先另存为，下次恢复草稿；备份失败会阻止退出。已有磁盘文件的未保存修改仍需确认保存 / 不保存 / 取消。缺失或无法读取的文件会跳过。
- 双击顶部标签栏空白处可新建并直接编辑；双击已有标签不会创建文件。
- **右击顶部文档标签的文件名**（不是操作系统标题栏）打开「复制文件全路径 / 打开所在文件夹 / 重命名」原生菜单；Tab 聚焦标签后也可用 `Shift+F10` 或菜单键。后台标签操作不会切换当前文档；关闭菜单不关闭标签，也不新建文档。英文界面对应 Copy full file path / Show in folder / Rename。
- 重命名弹框预填完整文件名并选中文件名主体，保留 `.md` / `.markdown` 扩展名；只允许同文件夹文件名，不接受路径、Windows 保留名称、无效字符、末尾空格或句点。Enter /「重命名」确认，`×` / Escape /「取消」返回。成功后真实移动磁盘文件，**不自动保存或丢弃未保存修改**；标签身份、当前编辑器撤销历史、相对图片、滚动位置和恢复路径保留，之后保存写到新路径。未命名文档三个动作禁用并显示「请先保存文档」；内置欢迎文档需先另存为后才可重命名。
- 已有目标（含其他打开标签）、外部修改 / 删除和权限失败均拒绝重命名，不覆盖文件。Windows 仅改大小写请先改为临时不同名称，再改为所需名称。安全移动采用同目录排他创建硬链接再删除旧名称，不写入文档内容；不支持硬链接的文件系统会失败而不是退化为可能覆盖的重命名。该两步移动不是崩溃事务：进程 / 电源中断可能留下两个名称；不会覆盖已有目标，仍应避免其他程序同时重命名 / 修改源文件。打开文件夹动作仅检查现存文件后请求系统定位，无法确认系统资源管理器实际显示结果。
- `npm test` 包含文件名与无覆盖移动回归；`npm run test:acceptance` 包含真实 Electron 顶部右击原生弹出、剪贴板、文件夹调用、活动 / 后台脏草稿、原生文件名输入、主题窄屏、取消及独立进程恢复路径测试。只替换 OS 文件夹显示调用，原生菜单确实弹出，测试直接调用其菜单项回调以免依赖系统菜单坐标。
- 高亮色与文字色在颜色选择器调整时立即应用到选区，无需额外点击「高亮」按钮；保留清除和恢复默认操作。

- 选择「文件 → 新建空白文档」或 `Ctrl+N` 创建空白文档，自动进入编辑并聚焦正文，无须先选择文件位置；首次 `Ctrl+S` 选择文件名后保存，取消保存会保留草稿。
- 通过「设置 → 偏好设置」指定默认保存文件夹，设置会持久保存，也可恢复系统文档目录。新建文档与「另存为」默认使用此文件夹；已有文件的普通保存仍写回原位置。
- 顶部使用紧凑的单行菜单栏，左侧菜单弹出原生菜单，右侧显示快捷图标，不额外增加工具栏。默认显示编辑、保存、打开、新建；「设置 → 偏好设置 → 菜单栏快捷操作」可勾选配置，也可全部隐藏。支持 F10 / Alt 聚焦菜单和方向键导航，原有快捷键保留。
- 支持同时打开多个文件（类似 Notepad++）：顶部标签栏并列显示，点击切换，带未保存圆点标记，`×` 关闭单个标签。新建或打开文件会追加标签而非替换；打开已打开的文件则切到对应标签。`Ctrl+Tab` / `Ctrl+Shift+Tab` 循环切换，`Ctrl+W` 关闭当前标签；单独关闭未保存标签仍询问保存 / 不保存 / 取消，选择不保存会删除该标签的恢复内容。
- `Ctrl+O` 或「打开 Markdown…」可在原生文件选择框中一次选择多份 `.md` / `.markdown` 文件（Ctrl / Shift 多选），按选择框返回的顺序追加标签，最后一份成功打开的文件为当前标签；重复路径仅切换已有标签，保留未保存草稿。部分文件无效或无法读取时继续打开其余文件，并显示包含文件路径的错误。取消不改变文档；沿用 100 标签及单文件 10 MB 限制。
- 打开选择框优先定位到已配置且仍存在的默认保存文件夹；未配置、目录被移动 / 删除或不可访问时保留系统选择框的默认行为，不创建目录、不修改保存设置。
- **Open Markdown (Ctrl+O)** supports selecting multiple `.md` / `.markdown` files. Tabs follow the picker’s returned order; the last successful file becomes active. Existing tabs and unsaved drafts are preserved, duplicates switch tabs, and a failed file does not stop later files (errors include paths). Cancel leaves documents unchanged. The picker starts in the configured default save folder when it exists; otherwise it uses the native default without creating folders. The existing 100-tab / 10 MB limits still apply.
- `Ctrl+R` 重新读取；`Ctrl+Shift+B` 切换目录；`F11` 全屏。
- 选择「编辑 → 编辑模式」或 `Ctrl+E`，直接在渲染内容中输入。右侧「格式」面板按文字样式、段落与内容、表格、编辑历史分组，可点击右上角按钮折叠 / 展开（记忆状态）；选中标题或加粗等内容时面板自动高亮对应按钮，表格操作仅在光标位于表格内时可用。`Ctrl+B` 加粗，`Ctrl+S` 保存，`Ctrl+Shift+S` 另存为。再次切换「编辑模式」返回阅读，不会自动保存。
- 已有文件未保存时关闭或重新读取会询问保存 / 不保存 / 取消。磁盘文件被其他程序修改后拒绝覆盖，可另存为保留草稿。欢迎文档必须另存为。
- 在「查看 → 主题」或「设置 → 偏好设置 → 阅读外观」选择 **审阅纸 / Review paper**：暖灰纸底、衬线标题、灰青强调色，行内代码、引用与表格使用同色系背景；深色代码区采用低饱和蓝、青、鼠尾草绿与砂金色高亮。正文取消固定宽度上限，随窗口和侧栏 / 格式面板占用的空间动态伸缩，左右保留自适应留白。阅读、编辑与单独查看代码共用配色，保留复制、折叠、换行、缩放和语言选择；主题只改变显示，不插入报告专用卡片或改写 Markdown。主题回归可运行 `npm run test:theme`，也包含在完整验收链中。
- **天蓝 / Sky blue**：浅蓝阅读底色、深蓝正文与标题，玫粉色强调粗体及行内代码；深蓝代码区的 TXT、text、plaintext 和未标注语言的纯文本以浅粉色显示，编程语言保留语法配色。表格使用清晰蓝色网格、加粗表头下边线和交替浅色行。正文宽度自适应，阅读、编辑及代码单独查看同步生效，不修改源文件。主题测试检查文字对比度至少 4.5:1、表格边框与单元格背景至少 3:1，以及中英入口、切换后模型与选择不变和重载记忆。
- 主题与字号在本机保存；文档内容不上传。进入编辑但未修改时保留原文；修改后保存会规范化 Markdown 排版，UTF-8 BOM 与原换行格式保留。
- 阅读和编辑模式均支持 `Ctrl`＋鼠标滚轮：向上放大、向下缩小正文字号（13–24 px），设置中的字号同步更新并记忆；仅调整显示，不修改文档内容。普通滚轮仍滚动文档。
- 每个代码块提供「折叠 / 展开」及「换行 / 不换行」；阅读、编辑和单独查看弹框均可用，仅影响当前块的显示，不修改 Markdown，重新打开后复原。长单词也能换行，关闭换行后恢复横向滚动。
- 编辑模式的「去空行 / Clean」删除当前代码块全部空行（含仅有空格或 Tab 的行），保留非空行缩进及语言；一次撤销可完整恢复，保存后重开仍保留清理结果。阅读模式与只读的单独查看弹框不提供删除操作；需要修改请回到正文编辑。
- 每个代码块提供 `A−` / `A＋` 独立缩放（70%–200%），点击百分比恢复默认。正文与其他代码块不受单块缩放影响；刷新或重新打开文档后单块缩放复原。围栏代码和缩进代码均支持。
- 点击代码块的「单独查看」打开弹框，保留当前高亮、配色和缩放比例。弹框内可复制、点击 A− / A＋或使用 Ctrl＋滚轮独立缩放；关闭按钮或 Esc 返回原文，原代码字号和阅读位置不变。刷新 / 切换文档会关闭弹框。
- 代码块请标明语言，例如 `js`、`python`、`java`、`sql`。首版按 highlight.js 的 common 语言集合提供高亮，未知语言显示纯文本。
- 编辑时可在代码块左上角下拉框修改语言（包括纯文本）；更改会写入 Markdown 围栏，不改动代码内容。代码块内 `Tab` 插入两个空格，选中多行可整体缩进；`Shift+Tab` 减少行首缩进，支持撤销。
- 「设置 → 界面语言」或「偏好设置 → 界面语言」可即时切换简体中文 / English，并记住选择；仅翻译应用界面，不翻译文档正文、代码或已有文件名。
- 右侧格式面板支持标题 1–6、删除线、下划线、高亮、行内代码、任务列表、分隔线与日期插入。任务列表使用 `- [ ]` / `- [x]`，编辑时可勾选，阅读时只读；支持嵌套及与普通无序项混排，暂不支持有序复选列表。高亮使用 `==文字==`，下划线使用无属性的 `<u>文字</u>`；这些扩展不代表支持任意 HTML。日期插入本地 `YYYY-MM-DD` 文本，不会自动更新。
- 支持 UTF-8 Markdown，单文档最多 10 MB。
- 选中文字后，在右侧「颜色」区点击高亮颜色或文字颜色，使用颜色选择器设置；可清除高亮或恢复默认文字颜色。颜色保存为受限的 `<mark data-color="#rrggbb">文字</mark>` / `<span data-color="#rrggbb">文字</span>` 扩展，MdView 保存重开后保留，其他 Markdown 阅读器可能不显示这些颜色。只接受六位十六进制颜色，不开放任意 HTML 或 style 属性。
- 任务项的复选框与第一行文字并排显示，不附加项目圆点；混排的普通列表项保留圆点。
- 图片支持文档目录及子目录内的相对路径，合计最多 24 MB；支持 PNG、JPEG、GIF、WebP、BMP、AVIF、ICO。网络图片、SVG、绝对路径和越过文档目录的图片显示说明。
- 编辑模式可用 Ctrl+V 粘贴剪贴板 PNG 图片（如截图），支持撤销和重做。图片作为 PNG data URL 嵌入 Markdown，保存重开和另存为无需复制附件；单张规范化 PNG 最多 2 MB，整个文档仍限 10 MB，文件体积会增加。仅接受受限的 PNG，不接收 SVG 或任意 data URL。
- 编辑模式中选中或悬停图片，使用图片上的 `−` / `+` 每次缩小 / 放大 32 px，`↺` 恢复原始尺寸；按钮支持键盘聚焦，提示为中英双语。每张图片独立设置，支持撤销 / 重做，不改变原始图片数据和宽高比。显示宽度限 32–1600 px，窄窗口自动缩至可用宽度。
- 同一段落内的图片可并排显示：连续粘贴图片（或在图片之间仅输入空格），不要按 Enter 新建段落；已有分段图片可在段落开头用 Backspace 合并。阅读和编辑均按可用空间自动换行，Enter 保留独立段落。
- 图片尺寸保存为受限 Markdown 扩展，如 `![图片](assets/photo.png){width=240}`；后缀必须紧跟图片，只接受 32–1600 的整数像素，不接受百分比、style 或任意 HTML。无后缀表示原始尺寸，保存重开和草稿恢复保留尺寸；其他 Markdown 软件可能把后缀显示为文字。此功能是显示尺寸调整，不是裁剪 / 压缩；选中图片后可用四边和四角的八个手柄等比调整尺寸。
- Ctrl / Cmd 点击图片可逐张多选，Shift 点击可连续选择；右击选中图片可统一为首张图片的显示高度，或输入共同宽度 / 高度。保持各自比例，整组调整可一步撤销；整数像素取整可能产生轻微高度差，不可实现的尺寸会提示。
- 全选后粘贴会替换全部内容，局部选中则替换选区，支持文字、网址与 PNG 图片；粘贴网址不再仅给原选区添加链接。
- 编辑器 `Ctrl+V` 自动识别 Markdown 源码：标题、围栏代码、连续列表项、管道表格、成对加粗 / 高亮、Markdown 链接及受限下划线 / 颜色语法。在当前光标或选区插入结构化内容，保留前后正文，一次撤销可恢复；不在每次输入时重解析全文。即使浏览器同时提供 HTML，明确的 Markdown 源码也优先按 Markdown 解析；普通富文本仍保留原有 HTML 粘贴行为，普通段落与独立网址不触发转换。
- `Ctrl+Shift+V` 保留纯文本，不转换 Markdown；在代码块内粘贴始终保留源码（含 `@url:` 文本），不执行或请求其中的地址。图片粘贴优先级不变。Markdown 粘贴源码及插入后保存内容均限 10 MB（UTF-8）；超限保持原文并提示。解析沿用受限规则，原始 HTML / SVG 不执行，网络图片不加载。
- 表格中右击单元格选择行 / 列，再 Shift 点击另一单元格可连续多选；右击高亮区域可批量删除，也可在当前位置上方 / 下方插入行、左侧 / 右侧插入列，支持撤销。右键菜单的「插入行数」接受 **1–100 的整数**，上 / 下方插入以当前行或行选区边界为准；整批一次撤销，超过 10000 个单元格则整体拒绝，不截断。首行始终是唯一表头。


- **首次插入表格**也可在右侧格式面板指定 1–100 行（含首行表头），默认 3 行、固定沿用原来的 3 列；再点「插入表格」于当前编辑选区创建，一次撤销可移除。非法数量不会截断或创建表格。**Insert table** accepts 1–100 total rows including its header, defaults to 3 rows, and keeps 3 columns.
- 表格中普通文本光标位于最后一行时，**Enter** 追加一行并跳到对应列；**Shift+Enter** 跳到表格下方的空段落；第一行（含表头）**Ctrl+Enter** 跳到表格上方的空段落，使表格下移。优先复用相邻空段落。其他行保持原快捷键；非空选区、输入法组词和只读模式不触发表格结构操作。
- 编辑表格悬停或键盘聚焦时显示顶部 / 左侧的浅色操作轨道；每个列 / 行边界的蓝色 `+` 分别插入列 / 行，并显示贯穿表格的蓝色预览线。直接拖动单元格列边界调整该列宽度，右边缘 `↔` 等比调整表格总宽，紧凑的 `↺` 恢复自动宽度。Tab 可聚焦控件，左右方向键调整 10 px（Shift 为 50 px）。每列限定 50–1600 px；一次拖动一次撤销，Escape / 失焦 / 指针取消取消修改。宽表格在阅读和编辑中均可横向滚动；不提供表格合并操作，不改写已有文档。
- 列宽使用 MdView 的受限 Markdown 扩展保存：表格前单独一段 `{table-widths=120,240}`，与后面的标准管道表格用空行分开。只接受与列数一致的整数像素列表，不接受 CSS / 任意 HTML；对齐标记仍保留。其他 Markdown 软件可能把该行显示为普通文字，删除该元数据段即可回到普通 GFM 表格。无尺寸修改的表格不新增此段；恢复自动宽度会移除尺寸段。
- 「正文 / 标题」下拉框使用适配主题的浮层，支持方向键、Enter、Escape，保留正文选区。
- 拖动图片主体可在当前文档中跨段落移动或调整同行图片顺序，松开到插入位置即可；保留图片地址、说明、标题和尺寸，不复制图片（Ctrl 拖动也移动）。每次移动独立撤销 / 重做；取消或拖到编辑区外不改变内容。尺寸按钮和边角手柄仍仅用于缩放。
- 「设置 → 偏好设置」可开启网站图标，默认关闭。开启后自动向链接网站的 `/favicon.ico` 请求图标，不发送链接路径、查询参数或正文，不使用第三方图标服务。不支持或获取失败时保留普通文字链接；仅支持可解析到公网 IPv4、默认端口的网站及 PNG / PNG 内核 ICO 图标。
- HTTP(S) 网页链接在**阅读模式普通单击**打开默认浏览器；**编辑模式 Ctrl+单击**打开，普通单击只放置光标。Tab 聚焦链接后，阅读按 Enter、编辑按 Ctrl+Enter；两种模式均可右键「在浏览器打开链接」，与表格操作 / 无格式复制菜单共存。编辑区悬停提示解释快捷键，不改动链接原文或源码，不自动打开粘贴的网址。
- 仅接受显式 `http://` / `https://` 绝对地址，主进程和渲染层均解析校验；拒绝带用户名 / 密码（包括空凭据分隔符）、空白 / 控制字符、反斜杠混淆、`javascript:` / `data:` / `file:` / 应用自定义协议。原始目标交给默认浏览器，不在 MdView 中导航或创建窗口。文内锚点仍沿用阅读模式跳转；其他本地 Markdown 请通过打开文件读取。
- **Web links:** ordinary click / focused-link Enter in reading mode; Ctrl+click / focused-link Ctrl+Enter in editing mode; or use **Open link in browser** in the context menu. Ordinary editing clicks and text selection do not launch links. Only validated absolute HTTP(S) URLs without credentials, raw whitespace/control characters or backslashes are accepted by both renderer and main process. Pasting never launches a URL; opening does not change the document.
- 暂不含自动监视文件变化、公式、Mermaid、PDF 导出和自动更新。

## 实现与安全边界

### 快捷键速查 / Keyboard shortcuts

按 **F1**，或打开 **查看 → 快捷键速查**（**View → Keyboard shortcuts**）。面板按文件与标签、查看与导航、文档搜索、文字编辑、段落 / 列表 / 代码、界面操作分组；可按中英文命令名称、按键或使用场景筛选。`Ctrl+F` / `Ctrl+Shift+F` 仍用于正文搜索，而不是速查筛选。

按 **Escape** 或点击右上角 **×** 关闭，焦点返回原控件；Tab / Shift+Tab 在面板内循环。面板支持简体中文 / English、浅色 / 深色 / 暖纸和窄窗口滚动。只展示已有快捷键，不执行列表项，也不修改文档、选区或撤销历史。编辑器、代码、表格与搜索专属键有上下文说明；鼠标滚轮说明独立于按键列表，界面缩放与正文字号明确区分。

已有弹框或文件操作期间不会叠加打开速查。速查打开时暂停底层应用菜单快捷键；关闭窗口仍经过原有未保存确认，取消后保留草稿。原生菜单优先：`Ctrl+E` 切换模式、`Ctrl+Shift+S` 另存为、`Ctrl+Shift+B` 切换侧边栏，不将被覆盖的 Tiptap 行内代码 / 删除线 / 引用默认键错误列为可用快捷键。

`src/shortcuts-data.js` 是显式菜单加速键与中英速查文案的共同来源；`shortcuts.js` / `shortcuts.css` 只负责模态速查界面。未新增 IPC 通道。`npm test` 校验目录与已安装编辑器键位，`npm run test:acceptance` 包含实际 Electron F1 / 原生菜单、过滤、焦点、未保存保护、文档历史不变、语言、三种主题及窄窗口回归。

Electron 主进程使用 markdown-it 和 highlight.js 生成内容，只读取用户选定的文档及其目录内图片。原始 HTML 关闭，图片经真实路径校验后转换为 data URL；渲染进程禁用 Node、开启 sandbox 和 contextIsolation，CSP 禁止网络请求与内嵌脚本。外链只允许 HTTP(S)，文件错误保留当前阅读内容。

`src/markdown.cjs` 负责解析和受限图片读取；`src/document-file.cjs` 负责 UTF-8 与临时文件替换保存；`src/edit-session.cjs` 负责多标签的草稿、冲突与退出保护（每个标签独立保存未保存状态）；`src/main.cjs` 负责桌面与 IPC。Tiptap 编辑器使用 esbuild 打包到 `src/generated/`，启动、桌面测试和打包命令会自动构建；无后端或数据库。

`src/content-search*.{js,cjs,css}` 提供正文搜索、可取消的解析线程和高亮。IPC 只接受已打开标签 ID，搜索前同步活动草稿，不开放文件路径搜索；复用生产 Markdown 解析规则，无文件读取或网络访问。阅读模式使用 CSS Custom Highlight / Range，编辑模式使用 ProseMirror decorations。`npm test` 包含搜索核心 / 取消测试，`npm run test:acceptance` 包含实际主进程、preload 和渲染界面的搜索回归（原生快捷键、草稿切换、精确定位、撤销、主题、关闭及过期结果）。

专属标志以书页和 V 形阅读视线为设计元素。`src/assets/mdview.svg` 是矢量源稿，`npm run icons` 使用 Electron 自带的浏览器渲染生成 PNG 和 16–256 px 的 Windows ICO，无需额外图像依赖。修改源稿后重新生成并打包，界面、窗口和 EXE 图标保持一致。

测试临时文件保留在系统临时目录用于排查，不自动清理。打包使用新时间戳目录，避免覆盖已有产物。

Windows 上修改含中文的源码优先使用补丁工具；不要用默认编码的 PowerShell 管道把中文脚本传给 Python。本次该方式曾将新增文案变成问号，已用 UTF-8 补丁修正并通过桌面截图核验；下次检查新增文案是否仍出现编码返工。

桌面测试使用软件离屏渲染并等待非空 `paint` 后保存截图（首帧可能为空，须在超时内继续等待）。Electron 44 隐藏窗口的 `capturePage` 在加上 `stayHidden` / `stayAwake` 后仍曾报 `UnknownVizError`，不要改回依赖隐藏 GPU 合成的截图方式。正常应用使用常规窗口与硬件加速；下次升级 Electron 时检查源码和打包产物测试是否均一次通过、所有截图均可解码。
