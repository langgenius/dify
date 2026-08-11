# KnowledgeFS 详细功能测试用例

## 使用说明

### 通用前置条件

1. Chrome 已登录 `https://new-rag.dify.dev`。
2. 当前用户对 workspace 至少有 owner 权限；权限矩阵用例需额外的 editor 和 viewer 账号。
3. 新版入口为 `/datasets?view=new`。
4. 破坏性用例仅在 `KF-QA-*` 专用空间执行，不使用业务数据。
5. 合成文件上传、临时开启/关闭 QA API Access 已获用户确认；新建持久凭据、撤销密钥和永久删除仍需在执行前单独确认。

### 测试数据

- QA 空间：`KF-QA-20260811-066145`
- 唯一检索标记：`KF_QA_MARKER_20260811_X9Z`
- 网站：`https://example.com`
- 本地合成文件：`test-data/` 目录

### 结果符号

- `PASS`：本轮实测符合预期
- `FAIL`：本轮稳定复现缺陷
- `ENV`：流程已执行，但被模型/provider/额度等环境条件阻塞
- `ENV-BLOCKED`：已就绪但被浏览器、模型、provider 或服务端依赖阻塞，无法继续验证下游链路
- `PENDING-CONFIRM`：涉及新建/撤销持久凭据或永久删除，等待用户在操作前确认
- `NOT-RUN`：需额外账号、provider 凭据或大批量数据
- `STATIC-RISK`：代码审查发现的候选风险，未当作已确认缺陷

## A. 入口、路由与导航

| ID | P | 测试场景/步骤 | 预期结果 | 本轮结果 |
|---|---|---|---|---|
| TC-NAV-001 | P0 | 直接访问 `/datasets?view=new` | 进入新版 Knowledge 列表，New 按钮为 pressed | PASS |
| TC-NAV-002 | P0 | 在列表点击“旧版”，再切回“新版” | 路由、选中状态和列表内容同步；新版恢复 `view=new` | PASS |
| TC-NAV-003 | P0 | 在概览/Sources/Documents/Retrieval/Quality/Settings 刷新 | 深链可独立恢复，不回到列表或旧版 | PASS |
| TC-NAV-004 | P0 | 打开合法 space ID 的深链 | 左侧导航、名称、模式和页面内容加载正常 | PASS |
| TC-NAV-005 | P0 | 打开不存在的 UUID 空间 | 显示本地化的不存在/无权页，不泄露后端信息 | FAIL，见 KF-BUG-004 |
| TC-NAV-006 | P1 | 点击“欢迎使用新版知识库”，关闭后再进入 | 引导弹层可关闭，不阻断页面操作 | PASS |
| TC-NAV-007 | P1 | 左侧导航折叠/展开后逐项访问 | 每个链接路由正确，焦点与选中项一致 | PARTIAL，路由已验证 |
| TC-NAV-008 | P1 | 390×844 视口访问所有二级导航 | 所有页签有明确滚动/折叠可达性，不遮挡内容 | FAIL-CANDIDATE，见 KF-BUG-012 |
| TC-NAV-009 | P1 | 使用 Tab/Shift+Tab/Enter/Escape 访问页签、菜单、抽屉和对话框 | 键盘可完成主流程，焦点不丢失 | NOT-RUN |
| TC-NAV-010 | P1 | 用无 new-rag feature flag 的 workspace 访问 | 不显示新版入口或给出明确说明 | NOT-RUN |

## B. 列表、搜索和筛选

| ID | P | 测试场景/步骤 | 预期结果 | 本轮结果 |
|---|---|---|---|---|
| TC-LI-001 | P0 | 加载有数据的新版列表 | 每张卡显示名称、描述、文档/应用计数、更新时间 | PASS |
| TC-LI-002 | P0 | 输入名称子串 `ces` | 只显示 `ceshi` | PASS |
| TC-LI-003 | P0 | 输入大写 `CESHI` | 搜索大小写不敏感，显示 `ceshi` | PASS |
| TC-LI-004 | P1 | 输入不存在的唯一字符串 | 显示“无搜索结果”及清除条件入口 | FAIL，见 KF-BUG-011 |
| TC-LI-005 | P1 | 清空搜索框 | 恢复全部列表 | PASS |
| TC-LI-006 | P1 | 打开“创建者”下拉 | 显示成员搜索、列表和重置入口 | PASS |
| TC-LI-007 | P1 | 搜索不存在的创建者 | 显示“没有找到创建者” | PASS |
| TC-LI-008 | P1 | 选中当前创建者 | 条件显示“创建者: 1”，结果与成员匹配 | PASS |
| TC-LI-009 | P1 | 重置创建者筛选 | 标签和列表恢复 | PASS |
| TC-LI-010 | P1 | 创建新空间后回列表 | 新空间出现在列表前部，描述和计数正确 | PASS |
| TC-LI-011 | P1 | 点击“标签” | 如后端未提供则给出明确不可用提示 | PASS，提示 KnowledgeFS 待提供 metadata |
| TC-LI-012 | P1 | 点击“外部知识库 API” | 打开管理抽屉，无凭据泄露 | PASS |
| TC-LI-013 | P1 | 点击“服务 API” | 显示 endpoint 和 key 管理入口 | PASS |
| TC-LI-014 | P1 | 超过一页数据时搜索只在末页出现的名称 | 搜索全数据集，不只过滤已加载卡片 | STATIC-RISK，数据不足未实证 |
| TC-LI-015 | P2 | 连续快速改变搜索和创建者条件 | 旧请求不覆盖新请求，无闪回 | NOT-RUN |

## C. 创建知识库

| ID | P | 测试场景/输入 | 预期结果 | 本轮结果 |
|---|---|---|---|---|
| TC-CR-001 | P0 | 点击“创建” | 打开创建对话框，默认从空白开始/only_me | PASS |
| TC-CR-002 | P0 | 名称留空 | 创建按钮禁用或显示必填错误 | PASS |
| TC-CR-003 | P0 | 名称仅空格 | 视为空值，禁止创建 | PASS |
| TC-CR-004 | P0 | 名称 1 字 | 创建成功 | NOT-RUN |
| TC-CR-005 | P0 | 名称精确 40 字 | 允许提交并保存成功 | PASS，在 QA Settings 验证同约束 |
| TC-CR-006 | P0 | 名称 41 字 | 字段级拦截，不请求后端 | FAIL，见 KF-BUG-002 |
| TC-CR-007 | P0 | 描述精确 2000 字 | 允许保存 | PASS，在 QA Settings 实测 |
| TC-CR-008 | P0 | 描述 2001 字 | 字段级拦截，不请求后端 | FAIL，Settings 同约束见 KF-BUG-003 |
| TC-CR-009 | P0 | 从空白开始 + 合法名称 | 只创建 1 个空间，202/provisioning 后进入 active Sources | PASS |
| TC-CR-010 | P0 | 在加载中连续双击“创建知识库” | 幂等，只创建 1 个空间 | NOT-RUN |
| TC-CR-011 | P0 | 提交后制造超时，再点重试 | 通过幂等 key 收敛到同一 space | NOT-RUN |
| TC-CR-012 | P1 | 可见权限选择 only_me | 只有 owner 可见，创建成功 | PASS |
| TC-CR-013 | P1 | 可见权限选择 all_team_members | 所有有效成员可以 viewer 身份查看 | NOT-RUN，缺多用户 |
| TC-CR-014 | P1 | 选择 partial_members 但不选成员 | 显示“至少一名成员”并禁止保存 | PASS，Settings 实测 |
| TC-CR-015 | P1 | 连接数据源方式创建 | 创建空间后进入 provider 配置，取消不留垃圾数据 | NOT-RUN |
| TC-CR-016 | P1 | 上传文件方式创建 | 创建与 staged upload claim 原子收敛，不重复文档 | ENV-BLOCKED，Documents 入口已证实 staging 服务异常，本轮未再创建空间 |
| TC-CR-017 | P1 | 模型配置 pending/fail/retry | 显示可解释状态和重试，不重复创建 | NOT-RUN |
| TC-CR-018 | P1 | 同 slug 不同创建意图/幂等载荷 | 返回可理解 409/4xx，不出现 500 | STATIC-RISK |

## D. 数据源与网站抓取

| ID | P | 测试场景/输入 | 预期结果 | 本轮结果 |
|---|---|---|---|---|
| TC-SO-001 | P0 | 空间打开 Sources | 显示空状态、常用 provider 和“添加数据源” | PASS |
| TC-SO-002 | P0 | 打开添加数据源 | 显示 Website/Online Documents/Online Drive 三类 | PASS |
| TC-SO-003 | P0 | 检查 provider 清单 | Firecrawl/Jina/WaterCrawl、Notion/Google Docs/Confluence、Drive/OneDrive/S3 入口正确 | PASS |
| TC-SO-004 | P0 | Website 根 URL 输入 `not-a-url` | 提示必须为 http(s)，抓取按钮禁用 | PASS |
| TC-SO-005 | P0 | Website 根 URL 输入 `https://example.com` | URL 校验通过，名称有效后可抓取 | PASS |
| TC-SO-006 | P0 | 最大页数输入 0 | 提示最小为 1，禁止抓取 | FAIL，可见 0/实际 1 |
| TC-SO-007 | P0 | 最大页数输入 1 | 允许抓取 1 页 | PASS |
| TC-SO-008 | P0 | 最大页数输入 1.5 | 提示只能是整数，禁止抓取 | FAIL，可见 1.5/实际 1 |
| TC-SO-009 | P0 | 最大页数输入 200 | 允许 | PASS |
| TC-SO-010 | P0 | 最大页数输入 1001 | 提示最大 200，禁止抓取 | FAIL，可见 1001/实际 200 |
| TC-SO-011 | P0 | Firecrawl 连接状态 | 显示已连接时才允许预览 | PASS |
| TC-SO-012 | P0 | Firecrawl 对 example.com 抓取预览 | 在可接受时间内返回页列表或明确失败 | ENV，36+ 秒仍 0 页 |
| TC-SO-013 | P0 | 抓取进行中点击 Stop | 进入 stopping，最终 stopped，表单可再操作 | PASS |
| TC-SO-014 | P0 | stopped 后点 Retry | 仅新建 1 个后续工作流，进度重置 | NOT-RUN，只检查入口 |
| TC-SO-015 | P0 | 抓取返回页面后全选/反选/单选 | 选中数量、最多 200 和添加按钮状态正确 | ENV |
| TC-SO-016 | P0 | 选择页面后“添加数据源” | 创建 source，文档进入解析/索引，不留临时 workflow | ENV |
| TC-SO-017 | P1 | 有草稿时点击取消/离开 | 弹出“放弃数据源更改”确认 | PASS |
| TC-SO-018 | P1 | 在确认对话框点“取消” | 草稿保留，返回配置页 | PASS |
| TC-SO-019 | P1 | 在确认对话框点“放弃草稿” | 临时配置/预览被清理，列表无 source | PENDING-CONFIRM |
| TC-SO-020 | P1 | 选 Jina Reader | 未安装时明确显示安装入口 | PASS，环境显示未安装 |
| TC-SO-021 | P1 | 选 WaterCrawl 并验证凭据 | 未安装/未配置时给出可操作的状态 | NOT-RUN |
| TC-SO-022 | P1 | 同时提供 connectionId 和 credentials | 请求被 422 拒绝，不创建 source | NOT-RUN |
| TC-SO-023 | P1 | Source PATCH 为空 payload | 拒绝无效操作，无 revision 变化 | NOT-RUN |
| TC-SO-024 | P1 | sync policy custom interval = 3599/3600/2592000/2592001 | 只允许 3600–2592000 秒 | NOT-RUN |
| TC-SO-025 | P1 | manual mode 同时提交 customInterval | 拒绝矛盾组合，不静默保留无效值 | STATIC-RISK |
| TC-SO-026 | P1 | stale expectedRevision/sourceVersion 保存数据源 | 返回 409，UI 提示刷新后重试 | NOT-RUN |
| TC-SO-027 | P1 | 删除 source 选 `documents=keep` | source 删除，文档和检索仍可用 | PENDING-CONFIRM |
| TC-SO-028 | P1 | 删除 source 选 `documents=cascade` | source 和所属文档按 durable job 完成清理 | PENDING-CONFIRM |

## E. 文档上传、列表与任务

| ID | P | 测试场景/输入 | 预期结果 | 本轮结果 |
|---|---|---|---|---|
| TC-DO-001 | P0 | 空知识库打开 Documents | 显示“暂无文档”和上传入口 | PASS |
| TC-DO-002 | P0 | 点击“添加文档” | 打开上传表单，显示支持格式和 15 MB 限制 | PASS |
| TC-DO-003 | P0 | 上传 TXT/MD/CSV/JSONL/HTML/PDF/DOCX/XLSX 小文件 | staged upload 成功，claim 一次，文档进入 processing→ready | FAIL，3 个合法 TXT/MD 均显示 `Internal Server Error`，0 文档 |
| TC-DO-004 | P0 | 上传 Unicode 文件名和中文内容 | 文件名、内容、分块和下载名不乱码 | FAIL-BLOCKED，中文文件名本地显示正常，但 staging 500，无法验证解析 |
| TC-DO-005 | P0 | 上传空文件 | 返回 422，UI 明确说明空文件，无空文档 | FAIL，0 B 被计为有效并启用提交，后端 422 仅显示英文通用错误 |
| TC-DO-006 | P0 | 上传不支持 `.exe` | 客户端或服务端拒绝，无 staged upload 残留 | PASS，本地显示“不支持或无效的文件类型”，0/1 有效且提交禁用 |
| TC-DO-007 | P0 | 上传精确 15 MiB 文件 | 根据合同允许边界值，不会 413 | PARTIAL/FAIL，前端正确接收，但 43+ 秒停留“正在上传…”；取消后无文档 |
| TC-DO-008 | P0 | 上传 15 MiB + 1 byte | 返回 413，UI 提示超限，无计费/索引任务 | PASS，本地标记“超过 15 MB 限制”，0/1 有效且未 staging |
| TC-DO-009 | P0 | 同时上传合法、空、超限和不支持文件 | 每个文件独立结果，部分失败不丢成功项，可重试失败项 | PARTIAL/FAIL，合法文件逐个报错并另有汇总错误；未能进入 claim 部分成功 |
| TC-DO-010 | P0 | 对同一 staged upload 网络重试 | 同 upload ID 仅被 claim 一次，无重复文档 | ENV-BLOCKED，staging 未成功返回 upload ID |
| TC-DO-011 | P0 | claim 前 abort staged upload | 上传被废弃，不可再 claim | PARTIAL，取消 15 MiB in-flight 上传后表单关闭且 0 文档，但请求随后仍弹失败提示 |
| TC-DO-012 | P0 | claim 后再 abort | 拒绝废弃，已创建文档状态不被破坏 | ENV-BLOCKED，无可 claim 的 upload ID |
| TC-DO-013 | P0 | 不同用户或不同 space 试图 claim upload | 统一返回无权/不存在，不能跨用户移动文件 | NOT-RUN |
| TC-DO-014 | P1 | 上传同内容不同文件名 | 产品按规则创建两个 logical document 或明确去重，不静默丢失 | ENV-BLOCKED，两个文件均 staging 500，未创建 logical document |
| TC-DO-015 | P0 | 现有文档列表加载 | 显示名称、来源、状态、修订、更新时间 | PASS，7 条 |
| TC-DO-016 | P0 | 状态筛选 Ready | 只显示 ready 文档 | PASS，4 条 |
| TC-DO-017 | P0 | 状态筛选 Failed | 只显示 failed 文档 | PASS，3 条 |
| TC-DO-018 | P1 | 文档名大小写不敏感搜索 | 返回匹配项，清空后恢复 | PASS |
| TC-DO-019 | P1 | 搜索无匹配 | 显示明确无结果空状态 | PASS |
| TC-DO-020 | P0 | 打开 Tasks 抽屉 | 显示需关注/失败任务、原因和可用操作 | PASS，5 条失败/中断 |
| TC-DO-021 | P0 | 对失败任务点 Retry | 只创建一个 retry attempt，状态可跟踪 | PENDING-CONFIRM，不重试既有业务文档 |
| TC-DO-022 | P1 | 对进行中任务 Cancel | 任务进入 canceling/canceled，无半索引残留 | PENDING-CONFIRM |
| TC-DO-023 | P1 | 任务 SSE 断网再连 | 续接或 polling 收敛，不倒退、不重复任务 | NOT-RUN |
| TC-DO-024 | P1 | 打开 Metadata schema 对话框 | 显示现有 schema；能力未开放时按钮禁用且有说明 | PASS，Add Metadata 禁用 |
| TC-DO-025 | P1 | 勾选一个文档 | 显示批量操作条和正确选中计数 | PASS |
| TC-DO-026 | P1 | 选中文档后查看 Reindex/Download/Delete 状态 | 按权限和实现能力准确启用/禁用 | PASS，Reindex 可用，Download/Delete 禁用 |
| TC-DO-027 | P0 | 批量 Reindex 选择 1/1000/1001 文档 | 只允许 1–1000；单一 durable job，不重复 | PENDING-CONFIRM |
| TC-DO-028 | P0 | Reindex payload 同时包含 `all=true` 和 documentIds | 返回 422，不运行任务 | NOT-RUN |
| TC-DO-029 | P0 | 批量删除含存在/不存在 ID | 事件结果可追踪，幂等重放不多删 | PENDING-CONFIRM |
| TC-DO-030 | P1 | 行菜单打开 | 根据状态显示 rename/reindex/disable/archive/download/delete | PASS |
| TC-DO-031 | P1 | Rename 留空 | 保存禁用或字段必填 | PASS |
| TC-DO-032 | P1 | Rename 输入 304 字 | 按后端合同限制，超限时前端拦截 | FAIL-CANDIDATE，保存仍可用，未提交 |
| TC-DO-033 | P1 | Ready/Failed/Processing 文档的禁用、归档、下载按钮 | 按状态机正确启用，禁用项有解释 | PARTIAL，已检查当前状态 |
| TC-DO-034 | P1 | 两标签页并发 metadata PATCH，使用 stale rowVersion | 第二个返回 409，UI 刷新后可重试 | NOT-RUN |
| TC-DO-035 | P0 | 删除文档时重复使用同 Idempotency-Key/不同 payload | 同 payload 重放同结果，不同 payload 返回冲突 | PENDING-CONFIRM |

## F. 文档详情、修订、分块与 Metadata

| ID | P | 测试场景/步骤 | 预期结果 | 本轮结果 |
|---|---|---|---|---|
| TC-DD-001 | P0 | 打开 Ready 文档详情 | 标题、内容、来源、状态正常加载，无错误 toast | FAIL，内容成功但 3 条 404 toast |
| TC-DD-002 | P0 | 详情页不展示未授权原始内容 | viewer 仅读且内容遵循 workspace 隔离 | NOT-RUN |
| TC-DD-003 | P1 | 点击 Metadata “编辑” | 打开编辑器或明确提示不支持，按钮可恢复 | FAIL，见 KF-BUG-007 |
| TC-DD-004 | P1 | 查看 revisions 列表 | 按时间倒序，active revision 明确标识 | PENDING-CONFIRM，需自有文档 |
| TC-DD-005 | P1 | 切换不同 revision | 内容、chunk 和 outline 与修订一致，无版本竞态 | PENDING-CONFIRM |
| TC-DD-006 | P1 | 查看 revision chunks | 分页/游标无重复丢失，chunk 内容与解析结果一致 | PENDING-CONFIRM |
| TC-DD-007 | P1 | 打开单个 chunk 详情 | 显示标识、位置、内容和 metadata，新版不提供编辑假入口 | PENDING-CONFIRM |
| TC-DD-008 | P1 | 查看 outline | 层级顺序与原文档匹配，空 outline 有空状态 | PENDING-CONFIRM |
| TC-DD-009 | P1 | schema 名称 1/255/256 字及重名 | 允许 1–255，拒绝 256/重名/内建名 | PENDING-CONFIRM |
| TC-DD-010 | P1 | schema type 为 string/number/time | 每种类型保存和文档值校验正确 | PENDING-CONFIRM |
| TC-DD-011 | P1 | stale schema expectedRowVersion 更新/删除 | 返回 409，不静默覆盖 | PENDING-CONFIRM |
| TC-DD-012 | P1 | metadata value 与 schema type 不匹配 | 字段级拒绝，其他值不受影响 | PENDING-CONFIRM |

## G. 概览与可观测性

| ID | P | 测试场景/步骤 | 预期结果 | 本轮结果 |
|---|---|---|---|---|
| TC-OV-001 | P0 | 新建空间打开 Overview | 显示添加第一个数据源 onboarding，指标为— | PASS |
| TC-OV-002 | P0 | 有数据空间查看 24h/30d 指标 | 时间范围切换后查询数、回答率和对比值一致 | PASS，24h 0，30d 11/100% |
| TC-OV-003 | P1 | 需要关注列表分页 | 前后翻页稳定，不重复丢失 | PASS，2 页 |
| TC-OV-004 | P1 | 打开最近活动抽屉 | Today/30d 和活动事件显示正常 | PASS |
| TC-OV-005 | P1 | 最近活动按 operator 筛选 | 只显示对应 actor/System 事件 | PASS |
| TC-OV-006 | P1 | 资产概况文档/实体/关系/覆盖数 | 与后端 inventory 一致 | PASS，4/398/380/104 |
| TC-OV-007 | P1 | Documents 列表包含 failed 文档时核对 Overview “文档” | 标签说明是 total 还是 ready，各页口径一致 | AMBIGUOUS，Overview=4，列表/卡片=7 |
| TC-OV-008 | P1 | 新上传文档完成后不刷新查看指标 | 按设计实时/轮询更新，不长期过期 | PENDING-CONFIRM |
| TC-OV-009 | P1 | 删除文档/source/space 后核对 stats | durable job 完成后计数无残留 | PENDING-CONFIRM |

## H. Fast / Deep / Research 检索

| ID | P | 测试场景/输入 | 预期结果 | 本轮结果 |
|---|---|---|---|---|
| TC-RE-001 | P0 | 空库打开 Retrieval | 显示输入框、三种模式和空记录状态 | PASS |
| TC-RE-002 | P0 | 问题留空或仅空格 | Start 禁用 | PASS |
| TC-RE-003 | P0 | 问题精确 2000 字 | UI 允许，后端 query 长度约束不冲突 | PARTIAL，已核对 maxLength=2000 |
| TC-RE-004 | P0 | 问题 2001 字 | UI 拦截/字段错误，不静默截断 | NOT-RUN |
| TC-RE-005 | P0 | 单次 Fast Start | 只产生 1 个 admission、1 个 SSE 任务、1 条记录 | PASS，QA 空库 813 ms 返回 1 条记录、0 分段 |
| TC-RE-006 | P0 | 单次 Fast Retry | 只生成 1 个新 attempt，与原 trace 关联 | FAIL，生成 2 条，KF-BUG-001 |
| TC-RE-007 | P0 | 单次 Deep Start | 只产生 1 个任务和 1 条记录 | FAIL，生成 2 条，KF-BUG-001 |
| TC-RE-008 | P0 | 单次 Research Start | 只产生 1 个 research task，阶段流式更新 | FAIL/PARTIAL，既有库可启动；QA 空库单击后 27+ 秒无任务、阶段或错误，见 KF-BUG-019 |
| TC-RE-009 | P0 | Fast 对唯一 marker 检索 | 答案包含 marker，citation 定位到正确 chunk | PENDING-CONFIRM，需上传并有额度 |
| TC-RE-010 | P0 | Deep 对同一 marker 检索 | 深度检索只生成一个结果，引用可回溯 | PENDING-CONFIRM |
| TC-RE-011 | P0 | Research 对多文档问题 | 计划→检索→分析→结果完整，证据与冲突可查 | PENDING-CONFIRM |
| TC-RE-012 | P0 | 无结果查询 | 明确“无充分证据”，不编造引用 | PASS，QA 空库 Fast/Deep 明确“未召回分段”，0 引用 |
| TC-RE-013 | P0 | Fast/Deep 正常查询 | 流式完成且无错误，记录状态与答案一致 | PARTIAL，QA 空库正常 0 结果；既有库受模型额度阻塞 |
| TC-RE-014 | P1 | Research 无召回 | 阶段和最终错误一致，可重试 | FAIL/PARTIAL，QA 空库静默回到 idle；既有库显示检索失败/未召回 |
| TC-RE-015 | P1 | 有历史记录时加载 Retrieval | 不再显示“暂无测试记录” | FAIL，见 KF-BUG-010 |
| TC-RE-016 | P1 | SSE 进行中断网、恢复网络 | 续接原 trace，不重复计费/任务 | NOT-RUN |
| TC-RE-017 | P1 | 进行中取消查询 | 服务端停止，记录为 canceled，不持续消耗额度 | NOT-RUN |
| TC-RE-018 | P1 | activeDocumentIds 100/101 | 允许 100，拒绝 101，UI 显示限制 | NOT-RUN |
| TC-RE-019 | P1 | query images 1/4/5，重复 UUID | 最多 4，重复被去重或拒绝，5 张拒绝 | NOT-RUN |
| TC-RE-020 | P1 | 图片 10 MB 边界、总 32 MB 边界、伪装 MIME | 仅 gif/jpeg/png/webp，严格限制单张/总大小 | NOT-RUN |
| TC-RE-021 | P1 | 引用点击/键盘激活 | 定位正确文档、revision 和 chunk，焦点可返回 | PENDING-CONFIRM |
| TC-RE-022 | P1 | Auto 模式通过 App/Workflow Knowledge Retrieval v2 运行 | 按 Settings 自动选 Fast/Deep/Research，运行和发布一致 | NOT-RUN |
| TC-RE-023 | P1 | 用废弃 `/queries` 路由 | UI 不调用该路由；服务返回明确 503/deprecated | STATIC-VERIFIED |

## I. Quality：参考问题、问题案例与 Replay

| ID | P | 测试场景/输入 | 预期结果 | 本轮结果 |
|---|---|---|---|---|
| TC-QA-001 | P0 | 空空间打开 Quality | 参考问题 0、问题案例 0，空状态正确 | PASS |
| TC-QA-002 | P0 | 切换参考问题/问题案例 | tab 选中和 `?tab=bad-cases` 路由一致 | PASS |
| TC-QA-003 | P0 | 创建问题与备注留空 | 在字段下显示必填错误，不创建记录 | PASS |
| TC-QA-004 | P0 | 触发必填错误后输入合法问题/备注 | 错误和红色边框立即清除 | FAIL，见 KF-BUG-008 |
| TC-QA-005 | P0 | 合法问题+备注，不选证据直接保存 | 创建 1 条 draft，列表计数+1 | PASS |
| TC-QA-006 | P0 | 编辑已有 draft 备注并保存 | 列表内容和更新时间同步 | PASS |
| TC-QA-007 | P1 | 勾选一条参考问题 | 显示“已选 1”、删除入口和清除选择 | PASS |
| TC-QA-008 | P1 | 有效证据文本后点“查找证据” | 返回候选 chunk 或明确无匹配，不报未知错误 | FAIL/ENV，当前为“未知错误” |
| TC-QA-009 | P0 | 导入合法 CSV（question/evidence/tags） | 显示行级预览和导入结果，未匹配证据保存草稿 | FAIL，2 行预览正确；提交后仅显示“未知错误”，刷新仍为 1 条、无部分成功 |
| TC-QA-010 | P0 | CSV 使用中文表头、quoted commas/tags | 正确解析，不错列/乱码 | PARTIAL，英文表头与 quoted tags 正确预览；中文表头未执行 |
| TC-QA-011 | P0 | CSV 500/501 行 | 允许 500，拒绝 501，告知上限 | NOT-RUN，基础 2 行导入已失败 |
| TC-QA-012 | P0 | CSV 精确 1 MiB/1 MiB+1 | 允许边界，超限拒绝且无部分落库 | NOT-RUN，基础 2 行导入已失败 |
| TC-QA-013 | P1 | CSV 包含合法与非法行 | 行级结果清晰，可重试失败行，不重复成功行 | NOT-RUN，基础 2 行导入已失败 |
| TC-QA-014 | P1 | 执行 replay run | 重测每个问题，显示通过/失败/无证据和可追溯 trace | PENDING-CONFIRM |
| TC-QA-015 | P1 | replay 进行中断网/刷新 | 状态可恢复，不重复执行同一问题 | NOT-RUN |
| TC-QA-016 | P1 | 问题案例从真实查询转入 | 保留 query/trace/evidence 关联，列表计数及时更新 | NOT-RUN |
| TC-QA-017 | P1 | 删除单个/批量参考问题 | 仅删除选中项，重复确认不多删 | PENDING-CONFIRM |

## J. Settings：基础信息、可见性与检索参数

| ID | P | 测试场景/输入 | 预期结果 | 本轮结果 |
|---|---|---|---|---|
| TC-ST-001 | P0 | 打开 Settings | 基础信息、API、模型、检索和危险操作加载正常 | PASS |
| TC-ST-002 | P0 | 名称留空/仅空格 | 显示必填错误，Save 禁用 | PASS |
| TC-ST-003 | P0 | 名称精确 40 字保存 | 保存成功，侧边栏/列表同步 | PASS，后已恢复 |
| TC-ST-004 | P0 | 名称 41 字 | 前端拦截和字段提示 | FAIL，创建页已证实 |
| TC-ST-005 | P0 | 描述精确 2000 字 | 保存成功 | PASS，后已恢复 |
| TC-ST-006 | P0 | 描述 2001 字 | 前端拦截，显示字段错误 | FAIL，见 KF-BUG-003 |
| TC-ST-007 | P0 | 合法名称/描述保存后刷新 | 持久值正确，Save 回到禁用 | PASS |
| TC-ST-008 | P1 | 改动后 Cancel | 恢复服务端值，不发 PATCH | PASS，可见性试改 |
| TC-ST-009 | P0 | 可见性 only_me/all/partial 下拉 | 三种选项齐全，与隐藏值一致 | PASS |
| TC-ST-010 | P0 | partial 不选任何成员 | 显示至少一人，禁止保存 | PASS |
| TC-ST-011 | P1 | partial 添加/移除成员并保存 | 成员权限和 auth epoch 正确更新 | NOT-RUN，缺多用户 |
| TC-ST-012 | P1 | API Access 开关 on/off | 立即保存或明确告知自动保存，侧边栏同步 | PASS，已恢复 off |
| TC-ST-013 | P0 | 系统推理模型下拉 | 只显示可用模型，缺失/失效时可解释 | PARTIAL，当前 gpt-5.6 |
| TC-ST-014 | P0 | Embedding 模型下拉 | 只显示可用 embedding，Fast/Deep 不允许缺失 | PARTIAL，当前 text-embedding-3-large |
| TC-ST-015 | P0 | 同时修改 embedding 与 retrieval settings | 产品要求拆分操作，返回明确 422 而非部分保存 | NOT-RUN |
| TC-ST-016 | P0 | embedding migration queued/running/succeeded/failed/canceled | 进度、checkpoint 和恢复入口清晰，激活前不破坏旧索引 | NOT-RUN |
| TC-ST-017 | P0 | 启用 Rerank 但不选模型 | 禁止保存并提示必选模型 | NOT-RUN |
| TC-ST-018 | P0 | Rerank 关闭时尝试启用 Fast/Deep Score threshold | threshold 禁用，规则清晰 | PASS，当前禁用 |
| TC-ST-019 | P0 | Retrieval mode Fast→Deep→Fast | 每次只保存一次，选中状态持久 | PASS，已恢复 Fast |
| TC-ST-020 | P0 | Retrieval mode Research | 模式保存并使 Retrieval 按钮语义变为开始研究 | PASS，在 Retrieval 已验证 |
| TC-ST-021 | P0 | Top K = 0 | 拦截或明确 clamp 到 1，显示值与保存值一致 | PASS，显示和 slider 均为 1 |
| TC-ST-022 | P0 | Top K = 1/10 | 允许边界值，持久后一致 | PASS |
| TC-ST-023 | P0 | Top K = 11 | 拦截或明确 clamp 到 10，显示值与保存值一致 | PASS，显示和 slider 均为 10 |
| TC-ST-024 | P0 | threshold = -0.01/0/1/1.01 | 只允许 0–1，保存值与显示一致 | NOT-RUN，rerank 未配置 |
| TC-ST-025 | P0 | 两标签页使用相同 expectedRevision 并发保存 | 第二次 409，给出刷新/合并引导，不静默覆盖 | NOT-RUN |
| TC-ST-026 | P1 | Save 返回 422/409/503 | 区分字段错误、冲突和服务不可用，不统一报网络 | FAIL，422 被误报网络 |
| TC-ST-027 | P0 | 点击删除空间 | 必须二次确认，完成后立即从列表隐藏 | PENDING-CONFIRM |

## K. 权限、成员、API 和应用绑定

| ID | P | 测试场景/角色 | 预期结果 | 本轮结果 |
|---|---|---|---|---|
| TC-AU-001 | P0 | owner 访问列表/详情/上传/设置/成员/API/删除 | 所有功能可用 | PARTIAL，owner 主流程通过 |
| TC-AU-002 | P0 | editor 访问读/编辑/文档写/检索 | 允许；成员/API key/删库按合同禁止 | NOT-RUN |
| TC-AU-003 | P0 | viewer 访问读/检索 | 只读和 query 允许；所有写操作隐藏/禁止 | NOT-RUN |
| TC-AU-004 | P0 | only_me 下非 owner 访问深链 | 与不存在资源统一为 404 | NOT-RUN |
| TC-AU-005 | P0 | all_team_members 的未显式成员 | 以 viewer 访问，不获得编辑权 | NOT-RUN |
| TC-AU-006 | P0 | partial_members 的非选中成员 | 列表不可见，深链 404 | NOT-RUN |
| TC-AU-007 | P0 | RBAC 查询异常 | fail closed，不使用本地角色绕过 | NOT-RUN |
| TC-AU-008 | P0 | 成员被移除/可见性收窄时仍打开详情 | 页面下一次请求立即失效，旧 SSE/token 不能继续 | NOT-RUN |
| TC-AU-009 | P0 | 用旧 API credential 在撤权后访问 | 立即 401/403/404，不等 TTL 过期 | NOT-RUN |
| TC-AU-010 | P0 | External API endpoint 为 `not-a-url` | 只显示一条本地化字段错误，不保存 | FAIL，见 KF-BUG-009 |
| TC-AU-011 | P1 | External API 合法 endpoint/key 创建并测试 | 保存后可编辑/撤销，key 不再明文显示 | NOT-RUN，无可用外部 API |
| TC-AU-012 | P0 | 创建 Service API Key | 只在创建瞬间显示 secret，复制和撤销可用 | PASS，已创建 1 枚临时 key |
| TC-AU-013 | P0 | 撤销 Service API Key 后重试访问 | 立即失效，不会继续签发空间 token | PENDING-CONFIRM |
| TC-AU-014 | P0 | Agent/Agent Chat 绑定 Agent channel | 只允许支持的 app 类型且 space active/channel enabled | NOT-RUN |
| TC-AU-015 | P0 | Workflow/Advanced Chat 绑定 Workflow channel | 最多 10 个 space，第 11 个有明确错误 | NOT-RUN |
| TC-AU-016 | P0 | 解除 app binding 后运行已发布 app | 旧 binding 不再可用，运行给出明确错误 | NOT-RUN |
| TC-AU-017 | P0 | 使用新 Service API Key 请求 `/v1/datasets` | 返回 200 和合法分页 JSON | PASS |
| TC-AU-018 | P0 | 将 Service API Key 修改一位后请求 | 返回 401，不返回数据 | PASS |
| TC-AU-019 | P1 | 合法 key 使用成功后重新打开密钥列表 | 最后使用时间更新 | FAIL，仍显示“从未”，KF-BUG-013 |
| TC-AU-020 | P0 | QA space API Access = off 时用有效 key 请求该 space ID | 返回不可见/404 | PASS，返回 404 |
| TC-AU-021 | P0 | QA space API Access on→刷新→off→刷新 | 即时保存；两次刷新均与服务端一致，最终恢复关闭 | PASS，开启显示“已启用”，最终确认 `aria-checked=false` |
| TC-AU-022 | P0 | 用旧 Dataset Service API Key 调用 KFS admission | 旧 key 不可冒充 KFS scoped credential | PASS，API 域名返回 401 `knowledge_fs_invalid_credential` |
| TC-AU-023 | P0 | API Access 已开启时点击空间侧栏“API 访问” | 显示可用 endpoint、专属 credential 创建/管理或明确下一步 | FAIL，只弹空白“不可用”对话框，见 KF-BUG-018 |

## L. 恢复性、错误映射与非功能

| ID | P | 测试场景 | 预期结果 | 本轮结果 |
|---|---|---|---|---|
| TC-RS-001 | P0 | API 返回 401 | 刷新身份后仅重放一次，不重复 reindex/query 等 POST | NOT-RUN |
| TC-RS-002 | P0 | API 返回 403/404 | 无权与不存在对外表现一致，不泄露资源 | FAIL-PARTIAL，404 toast 泄露路由 |
| TC-RS-003 | P0 | API 返回 409 revision conflict | 保留编辑，提示刷新/合并，不静默覆盖 | NOT-RUN |
| TC-RS-004 | P0 | API 返回 422 field validation | 错误映射到具体字段和限制 | FAIL，名称/描述均只给通用错误 |
| TC-RS-005 | P1 | API 返回 429 | 显示重试时间，按 Retry-After 控制，不密集重试 | NOT-RUN |
| TC-RS-006 | P1 | API 返回 503 | 区分服务不可用与网络断开，保留可重试数据 | ENV/PARTIAL |
| TC-RS-007 | P1 | 断网后在表单点 Save，恢复后 Retry | 不丢输入，仅提交一次 | NOT-RUN |
| TC-RS-008 | P1 | 长任务刷新/关闭再进入 | 根据 durable job ID 恢复进度，不新建任务 | NOT-RUN |
| TC-RS-009 | P1 | 快速连续点击 Start/Retry/Save | 前端防抖+后端幂等，仅一次运行 | FAIL，Retrieval 已复现重复 |
| TC-RS-010 | P1 | 多标签页交错加载列表/详情并返回 | 旧响应不覆盖新路由，焦点和状态正确 | NOT-RUN |
| TC-RS-011 | P1 | 390 px/768 px/1280 px 响应式 | 无内容遮挡、不可达导航和水平滚动陷阱 | PARTIAL，390 px 有导航溢出 |
| TC-RS-012 | P1 | WCAG A/AA 自动扫描新版六个页面 | 无 serious/critical，表单标签和对比度合格 | NOT-RUN，现有 a11y E2E 只扫 legacy |
| TC-RS-013 | P2 | Chrome 缩放 200%、系统大字体 | 无截断、遮挡、无法滚动的对话框 | NOT-RUN |

## M. Legacy Dataset / RAG Pipeline 回归高风险用例

> 新版 KnowledgeFS 与旧 Dataset 后端仍并存。以下是为防止切流/兼容回归必须保留的用例，本轮没有在业务数据上执行。

| ID | P | 测试场景 | 预期结果 | 本轮结果 |
|---|---|---|---|---|
| TC-LG-001 | P0 | 旧 segment 创建不传 `attachment_ids` | 正常创建、建向量且返回 2xx；不得“500 但已部分落库” | STATIC-RISK |
| TC-LG-002 | P0 | 旧 metadata rename 重名/冲突 | 明确失败，刷新后真实名称不变 | STATIC-RISK |
| TC-LG-003 | P0 | 旧 metadata delete 不存在 ID | 返回 404/4xx，不吞异常后 204 | STATIC-RISK |
| TC-LG-004 | P0 | 删除仍被 App/Workflow 使用的 dataset | use-check 阻止并指明关联应用，不断链 | STATIC-RISK |
| TC-LG-005 | P1 | hit test topK 0/超大/负数/NaN，score 越界 | 统一严格校验，不进入模型/数据库 | NOT-RUN |
| TC-LG-006 | P1 | segment 空内容、QA 空 answer、disabled 后编辑 | 按状态机拒绝，无向量残留 | NOT-RUN |
| TC-LG-007 | P1 | 上传后快速 pause/resume/retry/delete/archive | 按 indexing/paused/error/archived 状态机仅允许合法操作 | NOT-RUN |
| TC-LG-008 | P1 | Pipeline draft 用 JSON/text/plain/其他 Content-Type | 只接受 application/json 或 text/plain JSON，其他 415 | NOT-RUN |
| TC-LG-009 | P1 | 两标签页保存同一 draft hash | 第二次 DraftWorkflowNotSync，不静默覆盖 | NOT-RUN |
| TC-LG-010 | P1 | 无 draft/缺 knowledge-index node/缺 embedding/不兼容 chunk 发布 | 发布前完整验证，不产生半成品 published version | NOT-RUN |
| TC-LG-011 | P1 | 删除 active workflow/draft，restore draft | 阻止删 active/draft；只能从 published restore | NOT-RUN |
| TC-LG-012 | P1 | DSL import 无效 YAML/依赖 pending/export secret | 失败 400，依赖待确认 202，默认 export 剥离凭据 | NOT-RUN |

## 测试执行建议顺序

1. 先解决 KF-BUG-001–005，补充有额度的模型环境。
2. 经用户确认后执行 TC-DO-003–014，等索引 ready。
3. 紧接执行 TC-DD-004–012、TC-RE-009–011、TC-QA-009–017，保证同一批合成语料可串联校验。
4. 使用 owner/editor/viewer 三账号执行 TC-AU-001–009，并在正在运行的 SSE 中撤权。
5. 最后执行删除和清理，核对列表、FS、检索、概览和 App binding 全部无残留。
