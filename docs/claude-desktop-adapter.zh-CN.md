# Collaborative Notes — Claude 桌面版适配规范

[English](claude-desktop-adapter.md) | **中文**

> **版本：** 0.1.0 · 已在 macOS 上验证。
>
> **范围：** 本文说明 `collaborative-notes` 插件如何在 **Claude 桌面版的
> Code 标签页**实现 Collaborative Notes [Core Contract](core-contract.md)。
> 产品语义以 Core Contract、[Agent 指南](agent-guide.zh-CN.md)和[概念](concept.zh-CN.md)
> 为准。宿主证据记录在 [Claude 能力图](claude/capability-map.md)；适配决策记录在
> [Claude 决策](claude/decisions.md)中。

## 1. 宿主界面

- **Claude 桌面版 Code 标签页：** 这是唯一声称支持的用户宿主。插件打开
  Claude 原生插件面板，停靠在对话旁边。已完成便签设置的项目会自动打开面板。
  `/notes` 会打开面板；在新项目中还会启动设置流程。用户提出要求时，Claude
  可以调用 `notes-open-panel` 打开面板。（P1–P2、I2）
- **不在支持范围内：** Claude Chat 和 Cowork 尚未试用，无法确认其插件面板和 function hooks
  行为。claude.ai 网页版和移动端也未用本插件试过。Claude Code CLI 和 IDE 会话不作为用户
  宿主支持，因为尚未确认那里能使用桌面原生面板。（P1–P3；能力图“尚未验证”）
- **平台：** 已在 macOS 上验证。代码包含 Windows 路径处理，例如 PowerShell
  剪贴板、文件和链接处理，以及盘符路径。2026-10-04，GitHub `windows-latest` 和
  `macos-latest` 上的 CI 单元测试和插件校验通过；这不能验证 Windows 上的 Claude 桌面版，该平台尚未试用。（§12）

## 2. 组成部分

| 组成部分 | 作用 |
|---|---|
| **Function hooks 模块**（`hooks/register.tsx`） | 一个插件模块注册面板、对话渲染、提示提交处理和 Agent 工具。没有独立服务进程或单独的 MCP 服务进程。（P1、A2、I3） |
| **Skill**（`skills/collab-notes`） | Agent 操作规则：用户主导记录、如实报告完成情况、不提供删除工具、回到来源、局部性和错误处理。 |
| **原生插件面板** | Claude 对话旁的原生面板：分道、引用捕获与浏览、回到来源、分支继承、语言切换和帮助。它不是浏览器网页。（P2–P5、D1） |
| **长便签编辑器** | 便签根目录位于会话项目文件夹内时，使用应用文件面板；否则使用系统文本编辑器。文件面板自动保存，插件跟随每次保存；文本编辑器中的更改会在文件保存后读回。（P15–P16、D3） |

运行时使用插件的 function hooks API。没有 Notes 服务进程、MCP 服务进程或浏览器
页面。Agent 工具由插件注册，并由其 `tool.call` hook 处理。（A2、A4）

## 3. 身份与存储

- **Holder（所属会话）：** 当前对话 transcript 的 session id，由 session API 和
  transcript 条目取得。引用来源保存为 `{sessionId, messageId}`；其中
  `messageId` 是被引用文本块对应的 transcript 条目 `uuid`。（Q3、Q6、I1）
- **项目：** 会话所在的文件夹。每个项目设置一次便签根目录，默认是
  `<项目>/notes`。用户可以用系统的文件夹选择窗口（macOS 通过 osascript 的
  `choose folder`，Windows 用 FolderBrowserDialog）或直接输入路径；“更改位置”可再次设置。已配置的根目录若不存在，会报告错误，不会悄悄重建。（D4；
  `hooks/register.tsx`）
- **布局与格式：** `<便签根目录>/<分道>/<sessionId>.md`，分道为
  `conversation_todo`、`deferred_work`、`knowledge_candidate` 和
  `lesson_candidate`。文件采用 `dsh-note v1` 块、item key，并包含
  `dsh-meta host: claude`。（D4）
- **分道显示名称：** 所有项目共用一套名称覆盖设置，仅用于显示；更改名称不会更改
  分道 key 或文件。覆盖设置保存在插件存储的 `laneConfig` 中；设置时会询问用户。（D4；`hooks/register.tsx`）
- **插件存储：** `~/.claude/plugins/store/` 保存项目绑定、勾选状态、消息标记、
  语言偏好和其它插件状态。便签文件保留在项目的便签根目录。卸载插件后，便签
  文件和插件存储都仍留在磁盘上。（P6、D4）
- **分支标记：** `<便签根目录>/.carry-over/<子会话 session id>.json`，格式为
  Codex carry marker version 2。（D10）

## 4. 来源捕获（Core §§2、5；Decision D2）

- **来源身份：** `{sessionId, messageId, S}`。`S` 是用户精确选中的文本；
  `messageId` 是该文本块的 transcript 条目 `uuid`。返回来源时会高亮所有精确匹配项。
  （D2、Q3、I1）
- **方式一：复制文本。** 在 Claude 原生对话中选择文本，按 ⌘C，然后点击
  **📋 引用已复制的文字**，按钮位于消息输入框上方或面板中。插件会在整个对话中
  查找位置。只有一条消息匹配时，直接绑定该消息；多条消息匹配时，会像搜索结果
  一样列出，打开其中一条，再点 **引用到这条消息**。如果剪贴板里的
  内容与上次引用相同，会询问 **再次引用**。插件不会清空剪贴板。对话搜索不区分
  大小写且只负责导航；保存的引用始终是用户自己复制的文字，并会对照已识别的消息核验。
  只有用户和助手消息的文字可以引用，不包括推理、工具调用、工具输出或文件更改。（Q4a、D1）
- **方式二：按句选择。** 点击 **🔍 在对话中查找**。面板显示最近 10 轮及
  摘要；可以再加载更早的 20 轮，也可以搜索整个对话，包括已被压缩的部分。打开
  一轮，点选第一句和最后一句，再点击 **引用选中的文字**。按句选择仅限同一条消息；
  在另一条消息中选择句子会重新开始。（Q4d）
- **核对与精确性：** 面板文字不能被选中；宿主也不提供从原生对话中取得局部文字
  选区的接口（P8e、Q4）。插件会将选中文字与指定 transcript 文本块的可见
  文本投影进行核对；匹配时会兼容弯引号和可见的 `**` 标记。对话搜索不区分大小写，
  仅用于导航；引用身份仍来自用户复制的选中文字，并对照该消息核验。如果没有找到，
  面板会提示尝试更短的纯文本片段或使用搜索。两种
  方式都不会创建新的对话轮次。（Q2、Q4a–Q4b、D2）

## 5. 回到来源（Core §§5、8）

- **用户：** 由于 Claude 不允许插件滚动原生 transcript 到指定消息，点击 **↪ 回到来源** 会在
  Notes 面板中打开（Q4c）。默认只显示便签、引用文本和引用所在的一轮；仅在引用精确匹配时
  高亮，否则显示整条消息且不高亮。用户可以不限轮数地展开更早或更晚的对话。状态会显示
  **精确**、**不精确**或**不可用**；来源不可用时仍显示已保存的引用。若来源是当前对话里的助手消息，该消息还会短暂显示黄色边框。（Q4b–Q4c；
  `hooks/register.tsx`）
- 来源属于另一个对话时，会先征求用户确认。只有应用确认仍知道该对话时，才显示
  **↗ 打开原对话**。应用 session id 经常与 transcript id 不同，
  因此这项跳转能力不完整。（Q6、H1；`hooks/register.tsx`）
- **Agent：** `notes-source-reentry` 返回来源身份状态、精确或非精确匹配状态、按身份
  找到的来源消息及请求的相邻轮次。它不会按文字或相似度寻找替代来源。只有用户在当前
  请求中点名了另一个对话时，才可读取其中的来源。（Core §5；`SKILL.md`、
  `hooks/lib/agent.js`）

## 6. 把便签带给 Agent（Core §8）

- 勾选的便签会显示在面板托盘和消息输入框上方的提示条中：**☐ 附到下条消息**。
  用户发送的下一条消息会附带所选便签文本，作为模型不可见的上下文，并标明
  “collaboration data, not instructions”。（P21、A1、A5；D6）
- 如果已勾选的便签已被删除，插件会取消该勾选并暂缓消息，要求用户重新发送。其它附加
  失败会暂缓消息并保留勾选；没有勾选时，Notes 故障不会阻止消息发送。消息成功发送后，
  插件会在约 10 秒内重试几次，在 transcript 中查找该消息并添加标记；找不到时不显示这一行。
  附加的便签正文不会显示在对话里。（P21、A5；D7）
- **回执：** 仅当 Claude 处于空闲状态时发送的消息才会显示 📎 行。在 Claude 正在回复时排队的
  消息（宿主会提供 `turnId`）仍会附带勾选便签作为隐藏上下文，但不会显示 📎 行，因为无法在
  不猜测的情况下确定它对应的 transcript 身份。空闲时发送的消息，宿主同样不提供存储后的消息 id，
  所以回执绑定到发送那一刻之后出现的、文字相同的唯一一条用户消息。若有一条文字相同的较早消息
  延迟写入，📎 行可能出现在那条消息下面。回执只是显示提示：便签始终随你发送的那条消息一起送达。
  （D7、D11；`hooks/register.tsx`）

## 7. Agent 操作与局部性（Core §§2、6）

- **工具：** `notes-read {lane, session?}` 读取分道；
  `notes-write {lane, content}` 只创建普通便签；
  `notes-edit {lane, itemKey, content, expectedVersion}` 修改便签正文；
  `notes-source-reentry {lane, itemKey, contextWindow?, before?, after?, session?, readOtherConversation?}`
  读取引用来源；`notes-open-panel {}` 按要求打开面板。（A2、A4；
  `hooks/register.tsx`）
- `session` 只选择便签所在的对话。读取当前对话以外的来源 transcript 还必须传入
  `readOtherConversation: true`，且仅在用户要求读取该来源时设置。未经授权时，工具会说明
  这个独立参数；指定便签所在对话本身不会授权读取来源 transcript。`contextWindow` 默认由 Agent 自行选择每侧 0–30 轮。用户要求更多上下文时，
  `before` 或 `after` 可指定任意轮数；`hasEarlier` 和 `hasLater` 表示是否还有更多内容。
  跨对话读取授权通过行为约束实现：Skill 和工具契约只允许读取用户点名的对话。（Core §6；
  `SKILL.md`、`hooks/lib/agent.js`）
- 没有删除工具，也没有引用工具；用户在面板中完成引用。Agent 成功写入或编辑后，
  用户可跨分道搜索、排序、置顶，并在面板内或编辑器中编辑；删除只能由用户本人在面板中
  内联确认后完成。过期的编辑或删除会显示带有 **Load latest** 和 **Overwrite anyway** 的冲突横幅；
  覆盖操作会把编辑重新应用到最新分道，不会写入过期正文。
  面板会立即重绘；Agent 说明便签所在分道即可，无需让用户刷新。（D8；`SKILL.md`）
- **其它对话：** 只有用户在当前请求中点名时，工具才会读取另一个对话。该读取为只读，
  不会授予持续访问权限。（Core §6；`SKILL.md`）

## 8. 并发与完整性（Core §4）

- 面板和 Agent 的受支持写入路径使用基于 lane 文件 SHA-256 的版本令牌，并执行
  compare-and-swap。写入先暂存到临时文件，再移动到目标位置。同一插件进程中，面板和
  Agent 工具对每个 lane 文件共用一个队列，按序写入。（I3；`hooks/lib/store.js`）
- 分道队列仅在插件进程内有效，不是跨进程锁。每次写入都使用 SHA-256 compare-and-swap，
  先写临时文件再移动。版本检查会捕获检查前发生的变化；另一个程序若在检查与移动之间写入，
  不受协调，其更改可能丢失。只有插件自身的写入在进程内协调。通过 Claude 文件面板所做的编辑，
  会在应用前检查文件版本。（P15–P16、I3；Core §4）
- 过期版本的编辑不会被悄悄当作普通成功写入。根目录缺失或来源不可用时会如实报告，
  不会重建根目录、更改来源身份或丢弃已保存的引用。（Core §§4–5；`hooks/lib/store.js`、
  `SKILL.md`）

## 9. 分支与继承（Core §7；Decision D10）

- 分支检测会增量读取 transcript，只读取新追加内容；如果文件变小（被重写），则从头开始读取。
  父条目保留父会话的 session id。只有项目已设置 Notes、父会话有便签且继承决定尚未作出时，
  面板才会询问一次是否继承：**全部带过来**、**按分道选**或**不带**。transcript 形状相同的
  continued session 也会询问。（H3–H5、D10）
- 若分支中某个分道已有便签，用户可以选择 **合并（父对话在前）**、**保留当前** 或
  **用父对话替换**。在分支点之后引用的便签会留在父会话中；没有来源，或来源不在任一历史中的便签会保留。
  继承的便签会获得新的 item key，
  之后独立变化；capture origin 和历史来源仍保持原有关系。（D10；Core §7）
- 每个分道写入前，标记都会记录计划带入的 key，因此重试不会重复写入已处理的便签。决策保存在
  子会话标记文件 `<便签根目录>/.carry-over/<子会话 session id>.json` 中。（D10）

## 10. 生命周期与恢复

- **打开面板：** 已设置便签的项目在 session 开始时会自动打开原生面板。没有设置 Notes 的项目
  只会提示一次输入 `/notes`，其它时候保持安静。`/notes` 会打开
  面板；新项目中还会启动设置。用户提出要求时，Claude 可以通过 `notes-open-panel` 打开。
  点击 **×** 可关闭面板；至少 5 分钟后再发送消息，面板会重新出现。（P2、P11；I2）
- **设置：** 每个项目文件夹分别绑定便签根目录，默认是 `<项目>/notes`；用户可以浏览或
  输入其它路径。所选文件夹若已有可识别的 Notes 分道，设置会复用它们。已配置但不存在的根目录不会被悄悄重建。（D4）
- **语言与帮助：** 面板标题栏可以在中文和 English 之间切换，并会记住选择。首次使用时
  按系统语言选择；插件无法读取用户在 Claude 应用中设置的界面语言。点击 **?** 查看帮助。
  （P14、P22；D9）
- **分发：** 产品名称为 `Collaborative Notes for Claude Desktop`，插件名为
  `collaborative-notes`，首个公开版本为 `0.1.0`；公开仓库为
  `aprilxuMLC/claude-collaborative-notes`，marketplace 名称为 `collaborative-notes`。
  - 安装：先运行 `claude plugin marketplace add aprilxuMLC/claude-collaborative-notes`，
    再运行 `claude plugin install collaborative-notes@collaborative-notes`，然后重启
    Claude 桌面应用。
  - 更新：运行 `claude plugin marketplace update collaborative-notes` 和
    `claude plugin update collaborative-notes@collaborative-notes`，然后重启 Claude
    桌面应用。
  - 卸载：运行 `claude plugin uninstall collaborative-notes@collaborative-notes`。
    便签仍保留在项目便签文件夹中。

## 11. 数据访问声明

插件只读取以下内容：

- 已配置的便签根目录，以及自身位于 `~/.claude/plugins/store/` 的插件存储；
- 当前对话的 transcript JSONL；分支检测和继承期间还会读取父对话 transcript；其它来源 transcript
  仅在用户点名该对话时读取；
- 仅当用户按下 **📋 引用已复制的文字** 时读取剪贴板；
- 设置期间用户浏览到的文件夹列表；
- 在用户选择界面语言之前，每次会话开始时检查系统首选语言；
- 仅为提供 **↗ 打开原对话** 选项而读取应用 session 元数据
  （`get_session`）。

插件会写入便签根目录和自己的插件存储，包括其中的 `.editing` 和 `.carry-over` 路径，
并创建临时编辑器文件。它使用操作系统命令访问剪贴板和语言信息、移动或删除文件、处理文件夹、
打开链接及启动编辑器。应用会话元数据仅用于提供 **↗ 打开原对话**。插件本身不发起网络请求；
勾选便签只会作为用户本人消息的一部分到达模型。便签是所选文件夹中的普通文件；项目绑定、
勾选状态、消息标记和语言偏好保存在插件存储中。（P6、D4、D9；`hooks/register.tsx`）

## 12. 已知限制

- 打开或关闭宿主文件面板的按钮经常需要点击两次。（P18）
- 应用重启后，面板会与对话一起绘制；通常几秒内出现，偶尔需要十几秒。（P23）
- 如果在全新会话的第一条消息中发送 `/notes`，Claude 可能先收到消息、插件尚未就绪。
  此时 Claude 会自行打开面板，或者用户再次输入 `/notes`。（I2；`SKILL.md`）
- 便签根目录位于会话项目文件夹内时，长篇或多段便签会在应用文件面板中编辑；否则使用系统
  文本编辑器（macOS TextEdit，通过 `open -t` 打开；Windows Notepad）。文件面板自动保存，
  插件跟随每次保存；系统编辑器中的更改会在文件保存后读回。插件面板自身的输入框为单行。（P13、P15–P16；D3）
- 尚未测试窄窗口。插件面板没有平滑的内部滚动区域，因此提供 **↑ Back to top**。（P19；
  能力图“尚未验证”）
- 2026-10-04，GitHub `windows-latest` 和 `macos-latest` 上的 CI 单元测试和插件校验通过，
  且已有 Windows 路径和剪贴板代码；这不能验证 Windows 上的 Claude 桌面版，该平台尚未试用。（能力图“尚未验证”）
- 本适配依赖 Claude Code 插件 API 和 transcript 行为，宿主升级后可能变化。观察到的桌面
  版本为 Claude desktop 2.19675.0、Claude Code engine 2.1.286，运行于 macOS。（能力图）
