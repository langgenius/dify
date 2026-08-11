# KnowledgeFS 全功能测试报告

配套交付：[详细测试用例](./knowledge-fs-detailed-test-cases.md) · [Workflow Knowledge Retrieval v2 补测报告](./knowledge-retrieval-v2-functional-test-report.md) · [合成测试数据](./test-data/)

## 1. 测试摘要

- 测试环境：`https://new-rag.dify.dev/datasets?view=new`
- 测试日期：2026-08-11
- 测试终端：用户已登录的 Google Chrome，桌面视口 + 390×844 移动视口
- 测试角色：当前 workspace 的 owner 用户
- 测试方法：真实浏览器功能测试、边界值、错误处理、状态流转、恢复性、静态代码/现有自动化测试对照
- 用例库：主矩阵已编制 242 条可执行用例；本轮另补 39 条 Workflow v2 已执行场景和 18 条真实运行断言。主矩阵原状态统计仍保留为 89 `PASS`、33 条含 `FAIL`、4 `ENV`、4 `ENV-BLOCKED`、27 `PENDING-CONFIRM`；Workflow 补测不混入旧统计，逐项结果见独立报告。
- 初始测试状态：Chrome 本地文件权限已修复，合成文件已实际提交到上传/Quality 页面；QA API Access 已完成 off→on→刷新→off→刷新并恢复关闭。初测时所有文档 staging 均失败或悬挂，QA 空间为 0 文档。
- 修复复测状态：原 19 个已确认缺陷中 18 个已完成代码修复、专项自动化回归及 Linear 状态同步；唯一未关闭的是 KF-BUG-014 / WTA-1928。该项复测时 TXT/Markdown staging 已成功，但测试环境的文档 claim 路由稳定返回 404，需部署当前 API 后完成 `staging → claim 202 → ready` 实链路复测。
- Workflow v2 补测状态：39 个浏览器/核心合同场景已执行；另有 15 个真实运行断言被 Workflow channel、permissions-ready KFS 或已索引语料条件阻塞，3 个被产品规格/实现阻塞（取消信号、error strategy、retry），并确认 1 个 endpoint 未配置时的节点错误映射合同缺口。KF-BUG-020～024 均已创建到 Linear 项目 `Make RAG Great Again` 的 Milestone `测试联调`；KF-BUG-020/021 已完成代码修复和专项自动化回归，待部署后做真实 Chrome 正向链路复测，KF-BUG-022～024 保持 Backlog。

## 2. 结论

初始功能测试表明 KnowledgeFS 新版的页面架构和大部分基础交互可用：新旧版切换、列表筛选、空库创建、空状态、概览指标、文档列表、任务抽屉、Fast/Deep 空库检索、Quality 参考问题创建/编辑、设置保存与 API Access 开关持久化均能正常工作。

经过原缺陷修复，除 KF-BUG-014 的测试环境部署阻塞外，KF-BUG-001～019 中其余 18 个均已修复并通过所属层专项回归。随后对 Workflow `knowledge-retrieval-v2` 的专项补测又确认 5 个新问题：新增节点白屏、运行通道不可用、时间过滤静默丢失、最后一个 node kind 无法清除，以及未解析空间缺少草稿期警告。最新状态以第 4 节缺陷表和独立补测报告为准。

当前仍不建议认定为“可全量发布”。以下 1～10 条保留初测时 KF-BUG-001～019 的原始阻断证据，其中除第 6 条对应的 KF-BUG-014 外均已有代码修复；Workflow v2 当前发布门禁另见其后的新增结论：

1. Fast/Deep 检索单次操作会生成重复记录/重复任务，存在重复计费和重复执行风险。
2. 创建名称超长和设置描述超长均缺少前端校验，后端拒绝后界面还给出错误或误导性归因。
3. 不存在的知识库深链会把后端 API 路由和候选路由直接暴露在英文 toast 中。
4. 网站抓取“最大页数”显示值与真实提交值不一致，越界值被静默截断。
5. 既有文档库的 Fast/Deep 在当前环境中全部返回 `Query generation failed`，Research 可进入流式过程但无召回；QA 空库 Fast/Deep 则可正常返回 0 分段。真实答案与引用仍受模型额度和上传失败双重阻塞。
6. 合法 TXT/Markdown staged upload 全部返回 `Internal Server Error`，无法创建任何文档，解析、分块、索引和引用链路整体被阻断。
7. 0 B 文件被前端视为有效并启用提交，后端 422 后只显示英文通用错误；精确 15 MiB 上传 43+ 秒无超时收敛。
8. 合法 2 行 Quality CSV 可正确预览，但导入仅报“未知错误”，刷新确认 0 行落库。
9. API Access 开启且刷新持久后，侧栏入口仍只弹空白“不可用”；旧 Dataset Service API Key 调用 KFS admission 得到 401，界面没有可用的 KFS 专属凭据路径。
10. QA 空库 Research 单击后 27+ 秒无任务、阶段、结果或错误，静默回到可重试状态；Fast/Deep 在同一空库均能正确显示 0 分段。

Workflow v2 初测结论仍保留为不可发布：发布会建立并精确同步 binding，但当时的测试部署在 Workflow channel/permissions 未就绪时，草稿完整运行、单节点运行、已发布 Web App、Service API blocking/streaming 都只显示“not bound”，且从选择器新增任意节点约 500 ms 后会使主编辑区白屏。当前代码已修复 KF-BUG-020/021：初始化器不再因新的 history 引用卸载 Workflow 子树；Settings 增加独立 `workflow_enabled` 开关；admission 将 binding、channel、space、authorization 状态细分，并通过稳定 marker 映射为 24 个 locale 的本地化错误。由于修复尚未部署到测试环境，真实 Fast/Deep/Research、引用、filters 和多空间合并仍保持 `ENV-BLOCKED`，不能把自动化回归提升为真实 E2E 通过。

## 3. 测试数据与环境影响

### 3.1 本轮创建的合成数据

- 测试知识库：`KF-QA-20260811-066145`
- Knowledge Space ID：`019fef0d-732b-73d4-95e6-e943be794403`
- 描述：`KnowledgeFS 功能测试专用；仅含合成数据；待确认后清理。`
- 可见权限：`only_me`
- API 访问：测试中临时启用并经刷新确认；已恢复为未启用并再次刷新确认
- 检索模式：Fast，Top K = 10（边界测试后已恢复）
- Quality 参考问题：1 条合成草稿，已验证创建和编辑；2 行 CSV 导入失败且刷新后无部分落库
- Firecrawl：1 个已停止的临时抓取草稿，未添加为数据源
- 文件：尝试 3 个小型 TXT/MD、0 B、精确 15 MiB、15 MiB+1、`.exe`；staging/本地校验后仍为 0 文档
- Dataset Service API Key：初测时创建 1 个临时 key 并完成鉴权；其历史清理状态与 Workflow App key 分开记录
- Workflow 测试 App：`KF-WF-V2-LIVE-CESHI-20260811`、`KF-WF-V2-UNRESOLVED-20260811`、`KF-WF-V2-QA-20260811`
- Workflow App API Key：已临时创建用于 blocking/streaming；测试后已删除，同 key 立即返回 401，完整 secret 未写入报告
- Workflow channel：初测部署的运行证据表明该通道关闭或不可用，且 Settings UI 当时无可发现开关；当前代码已增加独立 `workflow_enabled` 控件，但尚未部署复测。QA API Access 按合同仅控制 Service/Agent、保留 Workflow 现值；本轮临时开启后已恢复关闭

QA 空间的 Fast 和 Deep 各执行过一次 0 文档检索并正常返回 0 分段；这些“记录”刷新后不再显示。Research 单次执行没有生成可见记录。

### 3.2 对既有知识库的影响

在现有 `ceshi` 知识库中产生了以下合成检索记录，用于确认单次提交重复执行问题：

- Fast：3 条同一合成问题记录（首次 1 条 + 单次 Retry 额外生成 2 条）
- Deep：单次 Start 生成 2 条
- Research：1 条

既有知识库的名称、描述、可见权限、API 访问和 Top K 均已恢复到测试前状态。本轮没有删除任何现有数据。

## 4. 已确认缺陷

| 编号       | 优先级         | 模块                   | 摘要                                                                         | 状态                                                      |
| ---------- | -------------- | ---------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------- |
| KF-BUG-001 | P1 / Major     | Retrieval              | Fast/Deep 单次开始或重试生成两条记录/任务                                    | 已修复；WTA-1914 Done                                     |
| KF-BUG-002 | P1 / Major     | Create                 | 41 字名称可提交，后端拒绝后误报“权限”                                        | 已修复；WTA-1915 Done                                     |
| KF-BUG-003 | P1 / Major     | Settings               | 2001 字描述可提交，后端拒绝后误报“网络”                                      | 已修复；WTA-1916 Done                                     |
| KF-BUG-004 | P1 / Major     | Error handling         | 不存在空间的 404 toast 暴露后端 API 路由                                     | 已修复；WTA-1917 Done                                     |
| KF-BUG-005 | P1 / Major     | Website source         | 抓取页数显示值与实际提交值静默不一致                                         | 已修复；WTA-1918 Done                                     |
| KF-BUG-006 | P2 / Major     | Document detail        | 详情内容已加载时同时出现 3 条相同英文 404 toast                              | 已修复；WTA-1919 Done                                     |
| KF-BUG-007 | P2 / Major     | Metadata               | 详情页点击“编辑”后按钮永久禁用，无编辑器和反馈                               | 已修复；WTA-1920 Done                                     |
| KF-BUG-008 | P2 / Normal    | Quality                | 必填错误在输入合法值后不消失，查找证据只报“未知错误”                         | 已修复；WTA-1921 Done                                     |
| KF-BUG-009 | P2 / Normal    | External API           | 非法 endpoint 同时弹出两条错误，中英混用                                     | 已修复；WTA-1922 Done                                     |
| KF-BUG-010 | P3 / Minor     | Retrieval              | 有大量历史记录时仍显示“暂无测试记录”                                         | 已修复；WTA-1923 Done                                     |
| KF-BUG-011 | P3 / Minor     | List                   | 搜索无结果时列表全空，无“无结果”解释和清除指引                               | 已修复；WTA-1924 Done                                     |
| KF-BUG-012 | P3 / Usability | Responsive             | 390 px 下顶部功能导航超出视口，“设置”无明显可达性提示                        | 已修复；WTA-1925 Done                                     |
| KF-BUG-013 | P2 / Normal    | Service API            | Key 已成功鉴权调用 200，密钥列表“最后使用”仍持续显示“从未”                   | 已修复；WTA-1926 Done                                     |
| KF-BUG-014 | P1 / Major     | Document upload        | 合法 TXT/Markdown staged upload 全部报 `Internal Server Error`，0 文档       | 复测阻塞：staging 已成功，claim 端点 404；WTA-1928 未关闭 |
| KF-BUG-015 | P1 / Major     | Upload validation      | 0 B 文件被计为有效并启用提交，422 仅显示英文通用错误                         | 已修复；WTA-1929 Done                                     |
| KF-BUG-016 | P2 / Major     | Upload recovery        | 精确 15 MiB 上传 43+ 秒持续“正在上传…”，无超时/失败收敛                      | 已修复；WTA-1930 Done                                     |
| KF-BUG-017 | P1 / Major     | Quality CSV            | 合法 2 行 CSV 预览正确，提交只报“未知错误”且 0 行落库                        | 已修复；WTA-1931 Done                                     |
| KF-BUG-018 | P1 / Major     | KnowledgeFS API        | API Access 已启用但侧栏仅弹空白“不可用”，无 KFS 凭据路径                     | 已修复；WTA-1932 Done                                     |
| KF-BUG-019 | P1 / Major     | Research               | 空库 Research 单次启动后无任务、阶段、结果或错误反馈                         | 已修复；WTA-1933 Done                                     |
| KF-BUG-020 | P1 / Major     | Workflow v2 UI         | 从节点选择器新增 KnowledgeFS 检索后主编辑区空白，未处理 `AbortError`         | 已修复；WTA-1954 Done；待部署后真实 Chrome 复测           |
| KF-BUG-021 | P1 / Blocker   | Workflow v2 runtime    | Settings UI 无 Workflow channel 开关；channel/permissions 失败统一误报未绑定 | 已修复；WTA-1953 Done；待部署后真实运行复测               |
| KF-BUG-022 | P1 / Major     | Workflow v2 filters    | `created_after` / `created_before` 保存后静默丢失                            | 已建单；WTA-1956 Backlog                                  |
| KF-BUG-023 | P2 / Normal    | Workflow v2 filters    | 最后一个 node kind 无法取消                                                  | 已建单；WTA-1955 Backlog                                  |
| KF-BUG-024 | P2 / Normal    | Workflow v2 validation | 未解析空间在草稿无持久警告，发布才显示原始英文与内部 ID                      | 已建单；WTA-1957 Backlog                                  |

### 4.1 修复验证

- Web：14 个所属功能 spec、507 个测试全部通过；全量 `pnpm type-check` 通过。
- Dify API：5 个相关测试文件、172 个测试全部通过；目标 Ruff 检查通过。
- KnowledgeFS API：Golden Question gateway 回归 5/5 通过；API package TypeScript 检查通过。
- Workflow v2 Web：6 个关联 spec 文件整体 22/22 通过，其中 16 项为 v2 直接断言、6 项为同一 hook spec 的通用节点元数据用例。
- Workflow v2 Dify API：节点、admission、binding、execution、capability、broker、runtime、DTO、operation、controller 与 remote HTTP 共 13 个关联文件，文件整体 340/340 通过；部分 controller/DTO/remote 用例并非 v2 专属。这些仍是 mocked/fake/mock HTTP/进程内合同，不替代真实 KFS 正向链路。
- KF-BUG-020 专项：更宽的 Workflow 组合回归为 9 个 spec、27 个测试通过；回归证明 history 引用变化后 Workflow 子树仍保持挂载。根因是通用 `WorkflowHistoryStoreInitializer` 在约 500 ms 的 history 保存产生新对象后返回空内容并卸载整棵子树，Console `AbortError` 是查询观察者随卸载取消的后果，而非 KnowledgeFS 请求根因。
- KF-BUG-020/021 最终组合：Web 7 个 spec、70 个测试通过，Dify API admission/node 18 个测试通过；全量 Web TypeScript 检查及目标 locale ESLint 通过。覆盖独立 Workflow Access 保存/失败回滚、四类 admission 错误、稳定 marker、运行表面映射与 24 个 locale 本地化。上述结果均为本地分层自动化，尚未替代部署后的真实 Chrome/Web/Service 正向召回。
- 补丁完整性：`git diff --check` 通过；本轮未创建 Git commit。
- Linear：KF-BUG-020 / WTA-1954 与 KF-BUG-021 / WTA-1953 均已更新为 `Done` 并指派给 `jyong`；KF-BUG-022～024 分别为 WTA-1956、WTA-1955、WTA-1957，状态保持 `Backlog`。五项均归属项目 `Make RAG Great Again`、Milestone `测试联调`；WTA-1928 仍保持未关闭。

### 4.2 Linear Issue 映射

以下缺陷均已创建到 Linear 项目 [Make RAG Great Again](https://linear.app/dify/project/make-rag-great-again-b9f26b73ca33/issues)，Team 为 `WTA`，初始状态为 `Backlog`，Milestone 为 `测试联调`。优先级映射为 P1 → High、P2 → Medium、P3 → Low。

| 缺陷       | Linear Issue                                       | Linear 优先级 | 状态             |
| ---------- | -------------------------------------------------- | ------------- | ---------------- |
| KF-BUG-001 | [WTA-1914](https://linear.app/dify/issue/WTA-1914) | High          | Done             |
| KF-BUG-002 | [WTA-1915](https://linear.app/dify/issue/WTA-1915) | High          | Done             |
| KF-BUG-003 | [WTA-1916](https://linear.app/dify/issue/WTA-1916) | High          | Done             |
| KF-BUG-004 | [WTA-1917](https://linear.app/dify/issue/WTA-1917) | High          | Done             |
| KF-BUG-005 | [WTA-1918](https://linear.app/dify/issue/WTA-1918) | High          | Done             |
| KF-BUG-006 | [WTA-1919](https://linear.app/dify/issue/WTA-1919) | Medium        | Done             |
| KF-BUG-007 | [WTA-1920](https://linear.app/dify/issue/WTA-1920) | Medium        | Done             |
| KF-BUG-008 | [WTA-1921](https://linear.app/dify/issue/WTA-1921) | Medium        | Done             |
| KF-BUG-009 | [WTA-1922](https://linear.app/dify/issue/WTA-1922) | Medium        | Done             |
| KF-BUG-010 | [WTA-1923](https://linear.app/dify/issue/WTA-1923) | Low           | Done             |
| KF-BUG-011 | [WTA-1924](https://linear.app/dify/issue/WTA-1924) | Low           | Done             |
| KF-BUG-012 | [WTA-1925](https://linear.app/dify/issue/WTA-1925) | Low           | Done             |
| KF-BUG-013 | [WTA-1926](https://linear.app/dify/issue/WTA-1926) | Medium        | Done             |
| KF-BUG-014 | [WTA-1928](https://linear.app/dify/issue/WTA-1928) | High          | 未关闭           |
| KF-BUG-015 | [WTA-1929](https://linear.app/dify/issue/WTA-1929) | High          | Done             |
| KF-BUG-016 | [WTA-1930](https://linear.app/dify/issue/WTA-1930) | Medium        | Done             |
| KF-BUG-017 | [WTA-1931](https://linear.app/dify/issue/WTA-1931) | High          | Done             |
| KF-BUG-018 | [WTA-1932](https://linear.app/dify/issue/WTA-1932) | High          | Done             |
| KF-BUG-019 | [WTA-1933](https://linear.app/dify/issue/WTA-1933) | High          | Done             |
| KF-BUG-020 | [WTA-1954](https://linear.app/dify/issue/WTA-1954) | High          | Done；待部署实测 |
| KF-BUG-021 | [WTA-1953](https://linear.app/dify/issue/WTA-1953) | High          | Done；待部署实测 |
| KF-BUG-022 | [WTA-1956](https://linear.app/dify/issue/WTA-1956) | High          | Backlog          |
| KF-BUG-023 | [WTA-1955](https://linear.app/dify/issue/WTA-1955) | Medium        | Backlog          |
| KF-BUG-024 | [WTA-1957](https://linear.app/dify/issue/WTA-1957) | Medium        | Backlog          |

### KF-BUG-001：Fast/Deep 单次操作重复提交

**前置条件**：进入有历史数据的知识库 `ceshi` → 检索测试。

**步骤**：

1. Fast 输入唯一问题 `KF_QA_NO_RESULT_20260811_X9Z`。
2. 点击一次“开始测试”，等待失败。
3. 点击一次“重试”。
4. 切换 Deep，输入普通问题，点击一次“开始测试”。

**期望**：每次用户操作仅产生 1 个请求、1 个任务和 1 条记录。

**实际**：Fast 单次 Retry 额外生成 2 条；Deep 单次 Start 生成 2 条，其中一条显示 0s，另一条显示 1s。

**影响**：重复模型调用、重复计费、任务历史污染、Quality 归档和观测指标失真。

### KF-BUG-002：创建名称超长时前端放行并误导性报错

**步骤**：创建知识库 → 从空白开始 → 输入 41 个中文字符 → 点击创建。

**期望**：前端限制为 40 个字符，或在字段下明确提示“不超过 40 个字符”并禁用提交。

**实际**：页面接受 41 字，创建按钮仍可用；后端拒绝后同时出现英文 `KnowledgeFS request is invalid.` 与“请检查权限后重试”。权限说明与真实原因无关。

**对照**：同一测试库设置为精确 40 字时保存成功。

### KF-BUG-003：设置描述超长后误报网络错误

**步骤**：设置 → 描述输入 2001 字 → 保存。

**期望**：最多 2000 字；超限时字段级提示并禁止保存。

**实际**：保存按钮可用；后端返回无效请求，界面主告警却是“无法保存更改。请检查网络后重试”，同时还有英文 toast。

**对照**：精确 2000 字保存成功，随后已恢复原描述。

### KF-BUG-004：404 错误泄露内部 API 路由

**步骤**：直接访问 `/datasets/new/00000000-0000-0000-0000-000000000000`。

**期望**：仅显示本地化的“知识库不存在或无权访问”，不向用户暴露内部路由。

**实际**：主页正确显示“未找到知识库”，但 toast 包含完整 `/console/api/knowledge-fs/spaces/...` 请求 URI 和多个候选后端路由。

**影响**：开发细节泄露、中英文不一致，也使标准 404 用户体验变差。

### KF-BUG-005：抓取页数越界被静默截断

**步骤**：添加数据源 → Website/Firecrawl → 有效 URL → 展开抓取选项 → 依次输入 `0`、`1.5`、`1001`。

**期望**：只接受 1–200 的整数；无效时提示并禁止抓取。

**实际**：用户可见文本分别保留为 `0`、`1.5`、`1001`，内部 number 值却静默变为 `1`、`1`、`200`，“抓取并预览”仍可用。

**影响**：用户对抓取规模的认知与实际执行不一致，可造成内容缺失且难以定位。

### KF-BUG-013：Service API Key 最后使用时间不更新

**步骤**：

1. 在“服务 API → API 密钥”中创建一枚临时 key。
2. 使用该 key 请求 `GET https://new-rag-api.dify.dev/v1/datasets?page=1&limit=1`，得到 HTTP 200 和合法 JSON 结构。
3. 将 key 末位替换后重试，得到 HTTP 401，证明 200 来自该新 key 的有效鉴权。
4. 多次关闭并重新打开 API 密钥列表。

**期望**：“最后使用”更新为实际调用时间或在明确的可接受延迟后更新。

**实际**：列表持续显示“从未”。

**影响**：凭据审计信息不可靠，管理员无法正确判断闲置、泄露或正在使用的 key。

### KF-BUG-014 / 015 / 016：文档上传链路不可用且边界恢复不一致

**小文件步骤**：在 QA 空间 Documents → 添加文档，一次选择 `kf-qa-marker.txt`、`kf-qa-duplicate.txt`、`kf-qa-unicode-中文.md`。

**实际**：三个文件均被 UI 计为有效并立即 staging；随后同时出现 1 条“无法上传这些文档，请重试。”和 3 条 `Internal Server Error`。点击“添加并处理”后页面不跳转，刷新 Documents 仍为 0 文档，确认不存在表面失败/后台部分成功。

**空文件步骤**：单独选择 0 B `kf-qa-empty.txt`。

**实际**：UI 显示“1 个中 1 个有效”、`TXT · 0 B`、预览按钮和可用的“添加并处理”；后端拒绝后仅显示“无法上传这些文档，请重试。”与英文 `The request was well-formed but was unable to be followed due to semantic errors.`，没有“空文件”字段级原因。

**边界步骤**：分别选择 15,728,640 B 和 15,728,641 B 文件。

**实际**：上限+1 正确本地拒绝；精确上限正确进入 staging，但 43+ 秒仍停留“正在上传…”，主按钮仍可用。点击取消后表单关闭且 0 文档，但稍后仍出现上传失败提示，说明 in-flight 请求没有及时收敛到取消状态。

**影响**：当前环境无法通过 UI 建立任何新文档；同时空文件会浪费请求，长上传缺少超时和可解释的恢复状态。

**2026-08-11 修复后复测**：在同一 QA 空间分别重新选择 `kf-qa-unicode-中文.md`（230 B）与 `kf-qa-marker.txt`（315 B），两者 staged upload 均成功，文件由“正在上传”收敛为可提交状态，说明最初的 staging 500 已不再复现。点击“添加并处理”后，Console API 的 `POST /console/api/knowledge-fs/spaces/019fef0d-732b-73d4-95e6-e943be794403/documents` 稳定返回 404；同一 staged TXT 重试仍为 404。页面无法 claim、解析或索引文档，并再次泄露候选内部路由。两次取消后暂存对象均已清理，Documents 保持 0 文档。当前仓库已包含该 POST 路由，因此更符合测试环境前后端部署版本不一致；本地已将 claim 请求设为 silent，避免部署后继续向用户泄露原始路由。部署当前 API 并完成 TXT/Markdown `staging → claim 202 → ready` smoke 前，WTA-1928 不应标记 Done。

### KF-BUG-017：Quality CSV 可预览但无法导入

**步骤**：Quality → 导入 CSV → 选择包含 `question,evidence,tags` 的 2 行 UTF-8 合成 CSV；两行 tags 均使用 quoted comma。

**期望**：两行预览后导入；没有文档证据匹配时按页面说明保存为草稿，并给出逐行结果。

**实际**：预览内容、中文和 tags 均正确；点击导入只在弹窗内显示“未知错误”。关闭弹窗并刷新后参考问题仍为 1 条，确认没有部分成功。

### KF-BUG-018：开启 API Access 后无可用 KnowledgeFS 凭据入口

**步骤**：Settings 打开 API Access，等待即时保存并刷新；点击侧栏“API 访问”。

**实际**：开关和侧栏均稳定显示已启用，但弹窗只有标题“不可用”和一个无标签关闭按钮，没有 endpoint、权限动作、创建/选择 KFS credential 或解释。使用现有 Dataset Service API Key 请求 API 域名的 KFS admission，得到 401 `knowledge_fs_invalid_credential`；Web 域名同一路径为 HTML 404。完成验证后已关闭 API Access 并刷新确认。

**影响**：管理员可以打开能力开关，却无法从产品界面获得真正可用的 KFS credential，形成“已启用但不可调用”的死路。

### KF-BUG-019：空库 Research 失败静默

**步骤**：QA 空库 Retrieval，选择 Research，输入合成问题，单击一次“开始研究”。

**期望**：至少创建一条记录并显示计划/检索阶段；若空库不支持 Research，应明确提示无文档或无证据。

**实际**：观察 27+ 秒后仍无记录、阶段、结果、toast 或错误；按钮恢复为可点击。相同空库的 Fast/Deep 分别在 813 ms/720 ms 正常返回 0 分段和本地化空结果。

## 5. 环境问题、受限项与待复测风险

| 编号     | 现象                                                                             | 当前判定                                                                         | 下一步                                             |
| -------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------- |
| ENV-001  | 页面显示模型消息额度为 0；既有 `ceshi` 的 Fast/Deep 均 `Query generation failed` | 更像模型/额度环境阻塞；QA 空库 Fast/Deep 的 0 结果链路可用                       | 补充可用模型额度后复测真实答案和引用               |
| ENV-002  | 既有库 Research 流式步骤可见，最终“检索失败/未召回分段”                          | 链路启动正常，语料/模型不可用；QA 空库另有静默失败缺陷                           | 文件上传并建立索引后复测                           |
| ENV-003  | Firecrawl 对 `https://example.com` 36+ 秒仍 0 页                                 | 未能区分 provider/网络/产品超时                                                  | 有 provider 观测日志时复测；本轮 Stop 状态流转正常 |
| ENV-004  | Jina Reader 显示“集成未安装”                                                     | 环境能力缺失，非功能缺陷                                                         | 安装并配置凭据后测试                               |
| ENV-005  | Chrome 扩展最初拒绝文件选择                                                      | **已解决**：用户开启 file URL 访问后，多文件、Unicode 和 15 MiB 文件均可交给页面 | 无；后续失败已确认发生在应用 staging 层            |
| RISK-001 | 列表搜索实现可能只过滤已加载页                                                   | 代码侧候选风险，当前只有 6 个空间无法实证                                        | 准备超过一页的数据后搜索末页项                     |
| RISK-002 | 旧版 segment 无 `attachment_ids` 可能接口 500 但数据部分落库                     | 后端静态审查候选                                                                 | 在可清理的 legacy 测试库通过 UI/API 复测           |
| RISK-003 | 旧版 metadata rename/delete 可能吞异常后表面成功                                 | 后端静态审查候选                                                                 | 每次操作后刷新并核对真实 metadata                  |
| RISK-004 | 删除仍被 App 使用的 legacy dataset 可能未调用 use-check                          | 后端静态审查候选                                                                 | 使用专用 App+dataset 验证防误删                    |

## 6. 已执行功能覆盖

下表记录初始真实环境测试结果，用于保留原始证据；修复后的最新状态以第 4 节为准。

| 功能域                          | 已实测内容                                                                                                                                                                            | 结果                                                                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 入口/路由                       | `/datasets?view=new`、Legacy/New 切换、刷新、列表回显、不存在 ID 深链                                                                                                                 | 主流程通过；404 toast 有泄露问题                                                                                                                          |
| 列表                            | 大小写不敏感搜索、无结果、创建者筛选/搜索/重置、新库排序                                                                                                                              | 通过；无结果缺少空状态                                                                                                                                    |
| 创建                            | 空库、名称空白/41/精确40字、描述、only_me、异步加载后进入 Sources                                                                                                                     | 合法创建通过；超长校验失败                                                                                                                                |
| 概览                            | 无数据 onboarding、24h/30d 指标、需关注分页、最近活动抽屉与运营者筛选、资产图谱                                                                                                       | 通过                                                                                                                                                      |
| 数据源目录                      | Website/Online Documents/Drive，Firecrawl/Jina/WaterCrawl/Notion/Google Docs/Confluence/Drive/OneDrive/S3 入口                                                                        | 目录可用；部分集成未安装                                                                                                                                  |
| Website                         | URL 格式、抓取选项、最大页数边界、实际 Firecrawl preview、Stop、Retry 入口、草稿离开确认                                                                                              | Stop 通过；页数校验失败；preview 环境阻塞                                                                                                                 |
| 文档列表/上传                   | Ready/Failed 筛选、搜索、无结果、任务抽屉、选择/批量操作、行菜单、重命名；真实 TXT/MD/Unicode/0 B/15 MiB/15 MiB+1/`.exe`                                                              | 列表主流程通过；合法 staging 失败、空文件校验和大文件恢复异常                                                                                             |
| 文档详情                        | 内容加载、metadata 区、编辑入口                                                                                                                                                       | 内容加载成功，同时有重复 404；metadata 编辑异常                                                                                                           |
| Retrieval                       | 空白输入、2000 字 UI 上限属性、Fast/Deep/Research，Start、Retry、记录、空库 0 结果、Research 流式阶段                                                                                 | QA Fast/Deep 空结果通过；既有库重复/额度失败；QA Research 静默                                                                                            |
| Quality                         | 空状态、参考问题/问题案例 tab、新建必填校验、创建草稿、编辑、选择、2 行 CSV 预览与提交                                                                                                | 创建/编辑与 CSV 解析通过；CSV 提交未知错误、校验清除异常                                                                                                  |
| Settings                        | 名称 40/41、描述 2000/2001、可见权限、partial 零成员、API Access off/on/off 持久化、Fast/Deep、Top K 0/1/10/11、Rerank/threshold 依赖                                                 | API Access 已恢复 off；描述超长错误处理失败                                                                                                               |
| API 入口                        | External Knowledge API；Dataset Service API key 创建/正负鉴权；KFS admission Web/API 域名；空间 API Access                                                                            | Dataset key 200/错误 key 401；KFS admission 对旧 key 返回结构化 401；空间 API 面板不可用；最后使用不更新                                                  |
| Workflow Knowledge Retrieval v2 | 节点可见、DSL 导入/导出、空间搜索与 1/6 选择、四种 mode 表面、Top N、filters、输出变量、16000/16001 查询、发布/版本/binding、完整/单步/Web/Service blocking/streaming、日志、key 撤销 | 初测配置和控制面大部通过并确认 KF-BUG-020～024；020/021 已完成代码修复和专项回归，022～024 Backlog；真实召回仍待部署及 channel/permissions-ready 环境复测 |
| 响应式                          | 390×844 下上传页、顶部功能导航                                                                                                                                                        | 内容可用；导航超出视口待改进                                                                                                                              |

## 7. 暂未执行的破坏性/需授权用例

以下用例已就绪，但本轮未在没有明确确认的情况下执行：

1. 真实文件上传已执行：`.exe` 与 15 MiB+1 本地拒绝符合预期；KF-BUG-015/016 已修复。小型 TXT/Markdown staging 复测已成功，但 claim 端点仍在测试环境返回 404；部署当前 API 后继续部分成功、重复与 Unicode 内容验证。
2. 解析和索引仍被 claim 404 与 0 文档阻断；部署同步后验证 revision/chunk/outline/metadata、重命名、重建索引、禁用、批量任务、取消/重试和下载。
3. 基础 Quality CSV 初测可预览但无法导入；KF-BUG-017 的“匹配能力不可用时保存草稿”已完成代码修复和 API 回归。500/501 行、1 MiB 边界、中文表头和部分错误恢复仍需部署后实链路复测。
4. QA API Access on/off 与恢复已完成。KF-BUG-018 已补齐 KnowledgeFS 专属 credential 的创建、列表、撤销及 admission endpoint 说明；部署后仍需在真实环境执行两步 admission+SSE，现有 Dataset Service API Key 按安全边界继续应被 401 拒绝。
5. 永久清理仍需操作前确认：删除 1 条参考问题、1 个已停止 Firecrawl 草稿和整个 QA 空间；撤销临时 Dataset Service API Key。
6. Workflow v2 的 KF-BUG-020/021 修复需先部署，再在 Settings 启用 `workflow_enabled=true`，并提供 permissions ready、Capability v2 可达且含已索引唯一 marker 的空间，才能执行 WF2-LIVE-001～015；WF2-LIVE-016～018 需先定义/实现取消、error strategy 和 retry 支持。当前不能把专项单元/组件测试记作这些真实运行断言的端到端通过。

## 8. 自动化覆盖现状

- `web/features/new-rag` 约 642 个前端单元/组件测试，功能广，但主要基于 mocked API 和 happy-dom。
- Dify 后端 KnowledgeFS 相关约 511 个 Python test function，但 `api/tests/integration_tests` 没有真实 KnowledgeFS 集成链路覆盖。
- 独立 `knowledge-fs/` 约 4131 个 TypeScript test declaration，大部分 E2E 仍使用 in-memory/fake/stub。
- 现有 Cucumber 只覆盖旧 Dataset API 和少量 Knowledge Retrieval 节点，没有 `/datasets?view=new` 的真实 Chrome E2E。
- 本轮已执行 6 个 Workflow v2 Web 关联 spec（文件整体 22/22，其中 16 项为 v2 直接断言）和 13 个 Dify API 关联测试文件（文件整体 340/340，部分非 v2 专属）；仍未发现真实 Workflow → App admission/capability → KnowledgeFS `/retrieval-tests` 的跨服务 E2E。
- 结论：当前最大缺口是登录态真实 Chrome + Dify BFF + KnowledgeFS + 对象存储 + 解析/索引 + 模型 + provider 的跨服务链路。

## 9. 发布建议

1. KF-BUG-014 仍是全量发布门禁，需通过 TXT/Markdown `staging → claim 202 → ready`。Workflow v2 的 KF-BUG-020/021 已完成代码修复，但发布前仍必须部署后用真实 Chrome 验证新增节点持续可见，并在启用的 Workflow channel 上由 Web/Service 返回唯一 marker 与 citation；KF-BUG-022 的时间过滤静默丢失也应在发布前修复。
2. 为所有 KnowledgeFS API 建立统一的错误码→本地化字段错误映射，不直接显示后端原始 message。
3. 为 query admission/stream 和 UI Start/Retry 增加端到端幂等性用例，以记录 ID、trace ID 和计费事件三重断言“一次操作只有一次执行”。
4. 为新版列表、创建、文件上传、真实索引、Fast/Deep/Research 引用、Quality replay 增加 Playwright/Cucumber 浏览器回归。
5. 在测试环境配置一个有额度的固定模型和一个稳定的合成 provider，避免功能回归长期被“额度为 0”阻塞。
6. 为 Workflow v2 建立登录态 E2E：创建节点并等待超过 history 保存窗口 → 确认编辑器未卸载 → 选择空间 → 启用 Workflow Access → 发布 → Web/Service 执行 → 断言每空间恰好一次 JSON `/retrieval-tests` → 核对 marker/citation → 撤权后旧 capability 立即失败；并覆盖四类 admission marker 的本地化展示。
7. 明确 Workflow v2 是否支持 stop/cancel、fail-branch/default-value 和 retry；若支持，先补 cancellation signal 与节点 allowlist，再执行 WF2-LIVE-016～018；若不支持，应在产品文档和 UI 中明确说明。
8. 修复并回归 `KNOWLEDGE_FS_BASE_URL` 未配置时的节点错误边界：composition root 会 fail closed，但当前 `_service()`/draft runtime 解析可能绕过 v2 的受控错误映射。
