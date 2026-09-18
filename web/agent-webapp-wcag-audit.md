# Agent Web App WCAG 2.2 A / AA 审计

- 日期：2026-09-17
- 分支：`codex/agent-webapp-wcag-audit`，基于本地 `main`，基线 `a9227cf6f9`。
- 实测页面：`http://localhost:3000/agent/9FUOWCUJQCcvlI4q`（new skill）。
- 方法：Computer Use 操作 Chrome；检查可访问性树、Tab / Shift+Tab / Escape、侧栏和关于弹窗，以及 200% / 400% 页面缩放；结合路由及组件源码核对。
- 以下原始问题表记录审计时的状态；修复对照见后文。排除 Agentation 和浏览器扩展的界面。

| 问题 id     | 违反的规则（带链接）                                                                                       | 问题描述                                                                                                                                                                                                                                                                             | 修改建议                                                                                                      |
| ----------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| AG-WCAG-001 | [2.4.7 焦点可见（AA）][focus-visible]                                                                      | **已复现。** 侧栏展开时，从消息输入框 Shift+Tab 会聚焦主区域的“Expand Sidebar”，但控件及焦点环完全不可见。`header/index.tsx:89` 的 `opacity-0` 没有移除后代按钮的键盘焦点。                                                                                                          | 不需要该入口时条件卸载或设为隐藏且不可聚焦；避免仅用透明度隐藏交互控件。                                      |
| AG-WCAG-002 | [2.4.7 焦点可见（AA）][focus-visible]、[2.4.11 焦点未被遮挡（最低要求）（AA）][focus-not-obscured-minimum] | **已复现。** 收起桌面侧栏后，Tab 仍会进入隐藏侧栏的“Start New chat”。`chat-with-history/index.tsx:43` 仅使用零宽度和裁切；另一个未展开的侧栏也仍挂载于屏幕外。                                                                                                                       | 对关闭的侧栏使用条件卸载或 `inert`；收起时将焦点移到可见的展开按钮。                                          |
| AG-WCAG-003 | [2.1.1 键盘（A）][keyboard]                                                                                | **已复现。** 移动布局打开侧栏后，Escape 无效，也没有可聚焦的关闭按钮；只有点击遮罩才能关闭。见 `header-in-mobile.tsx:123`。                                                                                                                                                          | 使用支持 Escape 的 Dialog/Drawer，提供有可访问名称的关闭按钮，并在关闭后恢复焦点。                            |
| AG-WCAG-004 | [2.4.3 焦点顺序（A）][focus-order]                                                                         | **已复现。** 移动侧栏打开后没有将焦点移入面板；下一次 Tab 进入被遮罩覆盖的背景“More”按钮。页面与覆盖式侧栏仍混在同一焦点顺序中。见 `header-in-mobile.tsx:123–137`。                                                                                                                  | 用模态抽屉管理焦点，打开时将焦点移入，背景设为不可交互，Tab 限制在面板内；关闭后返回触发器。                  |
| AG-WCAG-005 | [4.1.2 名称、角色、值（A）][name-role-value]                                                               | **已复现并核对源码。** “More → About”弹窗没有可访问名称。`share/text-generation/info-modal.tsx:27` 的 DialogContent 未关联标题，应用名称在第 49 行只是普通 div。                                                                                                                     | 将现有可见应用标题改为 DialogTitle，或使用 `aria-labelledby` 正确关联。                                       |
| AG-WCAG-006 | [2.4.7 焦点可见（AA）][focus-visible]                                                                      | **源码确认，待有历史会话时实测。** 历史会话“更多”按钮默认 `opacity-0`，仅鼠标悬停或菜单打开时显示，键盘聚焦不会使其可见。见 `sidebar/operation.tsx:49`。本次页面没有历史会话。                                                                                                       | 在 `focus-visible` 或所在行 `focus-within` 时显示按钮及焦点环。                                               |
| AG-WCAG-007 | [4.1.3 状态消息（AA）][status-messages]                                                                    | **源码确认，待 Agent 回复时实测。** Agent “Thinking”及处理进度通过普通内容和按钮名称更新，没有持久的状态播报区域；聊天容器也没有相应的 live region。焦点留在输入框时，这些状态变化缺少自动通知机制。见 `chat/answer/agent-roster-response-content.tsx:304` 和 `chat/index.tsx:195`。 | 增加持久的 `role="status"` / `aria-live="polite"` 状态区，适时播报开始、完成、失败；不要逐 token 或逐秒播报。 |

## 修复与 Review 对照（2026-09-18）

以下修复位于 `codex/agent-webapp-wcag-audit`，尚未提交。

| 审计问题        | 功能变化                                                                                                | 代码位置                                                                                                                                              | Review 操作                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| AG-001          | 展开侧栏时，透明的顶部展开入口退出焦点及辅助技术导航。                                                  | `app/components/base/chat/chat-with-history/header/index.tsx`：`inert` / `aria-hidden`。                                                              | 侧栏展开，从输入框 Shift+Tab，不应停在透明控件。                     |
| AG-002          | 收起的侧栏与未打开的悬浮侧栏不可聚焦；切换后焦点回到可见按钮；移动端不挂载桌面浮层。                    | `chat-with-history/index.tsx`：隐藏状态、焦点引用与同步；`header/index.tsx`、`sidebar/index.tsx`：按钮 ref。以上均在 `app/components/base/chat/` 下。 | 收起、Tab、Shift+Tab、Enter 展开；检查焦点始终可见。                 |
| AG-003 / AG-004 | 移动侧栏支持关闭按钮与 Escape；焦点进入面板、限制在面板内，关闭后恢复。相同实现的聊天设置面板同步修复。 | `app/components/base/chat/chat-with-history/header-in-mobile.tsx`：Dify UI Dialog anatomy。                                                           | 打开侧栏或聊天设置，反复 Tab / Shift+Tab，再 Escape；背景不可操作。  |
| AG-005          | 关于弹窗使用可见应用标题作为可访问名称；空标题回退到本地化“关于”。                                      | `app/components/share/text-generation/info-modal.tsx`：DialogTitle。                                                                                  | 更多 → 关于，检查弹窗可访问名称。                                    |
| AG-006          | 会话“更多”按钮在键盘聚焦时显示并可操作。                                                                | `app/components/base/chat/chat-with-history/sidebar/operation.tsx`：focus-visible 显示规则。                                                          | 鼠标移开，通过 Tab 到更多按钮，Enter 打开菜单。                      |
| AG-007          | Agent 开始响应时播报“思考中”，结束时播报“回复已结束”；不播报流式 token、秒数或初次加载的历史。          | `app/components/base/chat/chat/index.tsx`：持久 status 区域和生命周期同步；`i18n/*/agent-v-2.json`：24 种语言的结束文案。                             | 发送后保持输入焦点，检查读屏通知；手动停止也应说“结束”，不误报成功。 |
| 规则基线        | 清理移动侧栏已经消除的 8 条旧键盘/静态元素交互违规抑制。                                                | 仓库根 `oxlint-suppressions.json`，仅该组件两项计数被移除。                                                                                           | 确认没有新增规则豁免。                                               |

注：Agent 当前的 `isResponding` 不区分成功、手动停止和失败，因此结束播报使用中性文案，不声称回复成功。读屏实际语音仍需 VoiceOver 复测。

## 修复验证结果

- 228 个相关单元测试通过，覆盖移动面板、Chat 状态播报、关于弹窗及侧栏/顶部原有行为。
- 2 个 Chromium 回归测试通过，覆盖真实 Tab 跳过隐藏节点、切换侧栏焦点恢复、会话更多按钮聚焦可见，以及 portal 菜单关闭后的可见焦点返回。
- 本次修改的格式、lint / 类型检查通过（0 错误，4 条既有警告）；本地化 JSON 和本报告的 ESLint 检查通过。
- `git diff --check` 通过。没有提交或推送代码；VoiceOver 实际语音尚未验证。

## 原审计代码位置

上表相对组件位置均位于 `app/components/base/chat/` 下，唯“关于”弹窗位于 `app/components/share/text-generation/info-modal.tsx`。

- AG-WCAG-001：`app/components/base/chat/chat-with-history/header/index.tsx:89`
- AG-WCAG-002：`app/components/base/chat/chat-with-history/index.tsx:43`
- AG-WCAG-003、004：`app/components/base/chat/chat-with-history/header-in-mobile.tsx:123`
- AG-WCAG-005：`app/components/share/text-generation/info-modal.tsx:27`
- AG-WCAG-006：`app/components/base/chat/chat-with-history/sidebar/operation.tsx:49`
- AG-WCAG-007：`app/components/base/chat/chat/answer/agent-roster-response-content.tsx:304`、`app/components/base/chat/chat/index.tsx:195`

## 检查边界

Lighthouse 工具因浏览器配置占用未能运行；没有获得自动对比度测量结果，也没有完成 VoiceOver 语音复测。本次没有提交消息、上传文件或生成历史会话。历史会话操作、流式回复、错误状态仍需场景复测；上述清单不是完整 WCAG 合规认证。

没有把“仅有 placeholder”直接判为缺少可访问名称：实测输入框名称为“Talk to new skill”。没有把缺少 main、固定最小宽度、没有焦点边框等源码特征单独当成已复现违规；关于弹窗本次放大检查仍可操作，精确 320 CSS px 重排和文字间距检查尚未完成。

[focus-not-obscured-minimum]: https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html
[focus-order]: https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html
[focus-visible]: https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html
[keyboard]: https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html
[name-role-value]: https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html
[status-messages]: https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html
