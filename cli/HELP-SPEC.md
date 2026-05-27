# SPEC — `difyctl` 统一帮助系统

> 状态：**草案 / 待评审**
> 负责人：CLI
> 范围：仅限 `cli/`。涉及 `src/framework/{run,help,command,registry}.ts`、`src/commands/help/*`，并新增一个 topic 注册表。不改动服务端 / wire shape。
> 关联：[`ARD.md`]（CLI 代码结构）、[`README.md`]（用户文档）。

本文档定义一套统一、自洽的帮助系统，**同时服务人类与 Agent**，取代当前三套彼此割裂的机制。文档同时记录评审中达成的设计决策，使后续实现有一个固定的目标可对齐。

> **实现进度：** 首个实现轮次（分支 `feat/help-please`）覆盖**阶段 1 + 2 + 4**；**阶段 3**（`agentGuide` 内容回填）与 **D3**（Agent skill 生成）推迟。决策 D1 = A、D2 = 注册表，已定（见 §7）。

---

## 1. 问题

`difyctl` 目前通过**三套互不共享模型**的机制对外提供帮助：

| #   | 形态         | 入口                                                  | 实现                                  | 受众             |
| --- | ------------ | ----------------------------------------------------- | ------------------------------------- | ---------------- |
| 1   | 顶层命令列表 | `difyctl` / `difyctl help` / `--help`                 | `run.ts` → `printTopLevelHelp`        | 人               |
| 2   | 单命令参考   | `difyctl <cmd> --help`                                | `help.ts` → `formatHelp`              | 人（+ Agent）    |
| 3   | 长文概念指南 | `help account` / `help environment` / `help external` | `commands/help/*`（被建模为**命令**） | Agent onboarding |

此外还有一条专门的 Agent 通道——`Command.agentGuide()`（`src/framework/command.ts:50`），其返回值会被追加到 `formatHelp` 的输出末尾（见 `src/framework/help.ts` 中 `new C().agentGuide()` 那段）。这是个好机制，但**只有一个命令**实现了它（`run/app`，见 `src/commands/run/app/guide.ts`）。

### 1.1 根因——`help` 既是动词又是命名空间

`run.ts` 拦截了所有 `argv[0] === 'help'` 的调用，并把剩余 token 当作*「要为之展示帮助的命令路径」*：

```ts
// src/framework/run.ts
if (argv.length === 0 || argv[0] === 'help' || argv.includes('--help') || argv.includes('-h')) {
  const helpArgv = argv.filter(a => a !== '--help' && a !== '-h' && a !== 'help')
  if (helpArgv.length > 0) {
    const resolved = resolveCommand(tree, helpArgv) // 针对*命令*树解析
    // …命中则渲染该命令帮助，否则继续往下
  }
  printTopLevelHelp(tree)
}
```

但概念指南是作为命令注册在命令树的 `help → account`（等）路径下的。于是 `difyctl help account` 先把 `help` 过滤掉，再尝试把 `['account']` 当顶层命令解析。顶层并不存在 `account` 命令，解析失败，代码**回落到 `printTopLevelHelp`**。

**已实测确认：** `difyctl help account` 的输出与裸 `difyctl help` 逐字节相同。这三个指南**通过任何调用方式都不可达**——因为 `argv[0]` 永远是 `help`，拦截器永远不会去运行注册的 `help/<topic>` 命令。更糟的是 `printTopLevelHelp` 仍然把它们**列出来并带描述**（`help account — Agent-onboarding text for account bearers`），于是人类和 Agent 被主动引导到一条死路。`README.md` 也宣传了它们（「Background docs: `difyctl help account`, …」）。

这些指南的测试（`account.test.ts` 等）只断言纯函数 `runHelpAccount()`——路由从未被测试，因此这个回归一直没被发现。

### 1.2 次要缺口

- **`agentGuide` 覆盖率 1/24。** 只有 `run/app` 提供了语义化的 Agent 指引。Agent 必须串联使用的命令——`resume app`（HITL 续跑，退出码 2）、`describe app`、`get app`、`auth login`——都只有一份干巴巴的 flag 列表。
- **没有机器可读的帮助。** `formatHelp` 和 `printTopLevelHelp` 永远输出纯文本，无视 `-o json`。想要发现命令面的 Agent 只能逐条命令地抓取文本。
- **跨命令契约散落各处。** 退出码（0/1/2/4/6）、`-o json` 错误信封、HITL `paused` 退出码 2 协议、retry 语义，分散在 `ARD.md`、`README.md`、`run/app/guide.ts` 中，没有单一的机器可读来源。
- **外观问题：** `flagLabel` 用 `', '` 连接所有片段，导致类型占位符前也带了逗号——`--workspace, <string>`、`-o, --output, <string>`。逗号本应只分隔*别名*。`auth devices` 分组打印时描述为空。

---

## 2. 目标 / 非目标

### 目标

- 一套帮助模型，覆盖两种粒度（整体 CLI / 单命令）与两类受众（人类文本 / Agent 结构化）。
- `difyctl help <topic>` 可靠命中概念指南；路由 bug 在**结构层面**修复，而非打补丁。
- Agent 能在**单次调用**内拿到**整个命令面 + 全局契约**。
- 把高价值命令的 `agentGuide` 补齐到对等水平。

### 非目标

- 不改动命令行为、wire shape 或服务端端点。
- 不引入新的三方依赖。
- 不做交互式 / TUI 帮助。输出保持可管道化。
- 不在一次提交里重写所有命令的 `agentGuide`——回填是增量的（阶段 3）。
- 暂不实现 Agent skill 自动生成（见 §7 D3，待决策）。

---

## 3. 设计原则

1. **一个动词、两种粒度、两类受众。** `difyctl help X` ≡ `difyctl X --help`。同一份数据可渲染成人类文本，或在 `-o json|yaml` 下渲染成结构化输出。任何形态都不重复实现另一形态的数据。
1. **`help` 是动词，不是路径前缀。** 这与 `git` / `kubectl` / `gh` / oclif 一致。概念指南是 **topic**——一种与命令并列的资源类别，绝不建模为命令。
1. **topic 是数据，不是命令。** 建一个 `TOPICS` 注册表，复用现成的 `ENV_REGISTRY` 范式（`help environment` 本就是数据驱动的）。`commands/help/*` 从命令树移除。
1. **格式感知的单一渲染器。** `formatHelp` 与顶层渲染器都遵从已解析出的输出格式（`run.ts` 中已有 `sniffOutputFormat`）。文本与 JSON 走同一个函数。
1. **Agent 单次调用拿到全图。** `difyctl help -o json` 输出每个命令（description、args、flags、examples、`agentGuide`）**外加**全局契约（退出码、输出格式、错误信封、HITL 协议）。
1. **语义指引就近放在命令旁**（`agentGuide()`），跨命令的 Agent 契约则集中在一个 `agent` topic——这是对已有内容的收敛，不是新增负担。

---

## 4. 目标模型

| 调用                                | 行为                                                         |
| ----------------------------------- | ------------------------------------------------------------ |
| `difyctl help`                      | 总览：**COMMANDS** 段与 **GUIDES** 段，清晰分开。            |
| `difyctl help <cmd...>`             | 单命令帮助。与 `difyctl <cmd...> --help` 等价。              |
| `difyctl help <topic>`              | 概念指南：`account` / `external` / `environment` / `agent`。 |
| `difyctl <cmd...> --help [-o json]` | 单命令帮助，文本或结构化。                                   |
| `difyctl help -o json`              | 整棵命令树输出为 JSON——Agent 的站点地图。                    |

### 4.1 `help` 动词的解析顺序

当 `argv[0] === 'help'`（或出现 `--help`/`-h`）时，按以下顺序解析剩余 token：

```
1. 命令      — resolveCommand(tree, rest) 成功 → 渲染单命令帮助。
2. topic     — rest 为单个 token 且匹配某个 TOPICS 条目 → 渲染该 topic。
3. 都不是    — 输出纠错建议（复用 findSuggestions），非零退出。
4. 为空      — 输出顶层总览（COMMANDS + GUIDES）。
```

每种情况都自洽：

- `difyctl help get app` → 命令帮助。
- `difyctl help account` → topic 指南。
- `difyctl help xyz` → 「did you mean…」，退出码 1。
- `difyctl help` → 总览。

它在根层面消除了命名空间冲突：`help` 不再与 `help/*` 命令子树竞争，因为该子树已不存在。

---

## 5. topic 注册表

用一个 topic 模块（例如 `src/help/topics.ts`）替换 `src/commands/help/{account,environment,external}/*`：

```ts
export type HelpTopic = {
  name: string // 'account' | 'external' | 'environment' | 'agent'
  summary: string // 一行说明，显示在总览的 GUIDES 段
  render: () => string // 完整叙述文本
}

export const TOPICS: readonly HelpTopic[] = [account, external, environment, agent]
```

- `account` / `external` 保留现有静态文本（从 `account.ts` / `external.ts` 原样迁入）。
- `environment` 继续从 `ENV_REGISTRY` 生成（迁移 `runHelpEnvironment`）。
- `agent` 是**新增**（阶段 3）：收敛后的 Agent 契约——auth / bearer 模型、输出格式、退出码、JSON 错误信封、HITL `paused` 协议、retry 语义。内容来源于现有的 `ARD.md` / `README.md` / `run/app/guide.ts`。

纯渲染函数（`runHelpAccount` 等）及其现有单测以最小改动随迁移保留；新增测试覆盖**路由**（`difyctl help account` 确实渲染 account 指南）。

---

## 6. 结构化（Agent）输出

### 6.1 单命令 `-o json`

`difyctl get app --help -o json` →

```jsonc
{
  "command": "get app",
  "description": "...",
  "args": [{ "name": "id", "required": false, "description": "app id" }],
  "flags": [{ "name": "workspace", "char": null, "type": "string", "default": null, "description": "..." }],
  "examples": ["difyctl get app", "difyctl get app -o json"],
  "agentGuide": "…完整文本或 null…"
}
```

### 6.2 全图 `difyctl help -o json`

```jsonc
{
  "bin": "difyctl",
  "contract": {
    "exitCodes": { "0": "success", "1": "generic", "2": "usage / HITL paused", "4": "auth", "6": "version/compat" },
    "outputFormats": ["json", "yaml", "name", "wide", "text"],
    "errorEnvelope": { "...": "-o json 下写到 stderr 的形态" },
    "hitl": { "...": "exit-2 paused 协议；用 difyctl resume app … 续跑" }
  },
  "commands": ["… 每条形如 §6.1 …"],
  "topics": [{ "name": "account", "summary": "…" }]
}
```

JSON 形态保持稳定且只增不减（允许新增字段，不删除 / 不改类型现有字段）——与 `README.md` 已对命令输出承诺的契约一致。

---

## 7. 决策记录

以下是评审中两个待定问题。已记录答案，进入阶段 2/3 前需最终确认。

### D1 — `agentGuide` 在哪里渲染？→ **方案 A（已定）**

- **A.（选定）** `agentGuide` 保持为**单个字符串**，整体输出：人类 `--help` 末尾追加，结构化输出（`-o json`）里作为 `agentGuide` 字段原样带上。不拆 summary/full、不改基类签名。
- **B.** guide 仅出现在 `-o json`。受众切分干净；但人类终端看不到提示。
- **C.** 人类文本只显示摘要、完整 guide 进 `-o json`，需给 `agentGuide` 加 `{ summary, full }` 结构。

理由：多数命令的 guide 短小，不需要像文章一样区分摘要与全文；强行拆 summary/full 会给基类与每个实现者增加无谓结构。保持单字符串最简单、可逆，且不阻碍 `-o json` 把它整体带出。属阶段 3，本期不实现，仅定档。

### D2 — topic 是否迁出命令树？→ **是，注册表（已定）**

- **注册表（选定）：** 移除 `commands/help/*`，新增 `TOPICS`。结构性修复 bug，终结「被宣传却不可达 / 在命令列表里重复」的问题。改动文件更多。
- **最小补丁（备选）：** 保留 `commands/help/*`；在 `run.ts` 让 help 动词尝试 `resolveCommand(['help', ...rest])` 并*运行*命中的命令。diff 更小，但 `help` 仍是动词 + 命名空间双重身份，且这些指南只能经 `help` 调用，与其他所有命令不一致。

理由：注册表是诚实的模型，也是唯一能消除根因的方案。最小补丁仅在必须控制 diff 体量时作为备选。

### D3 — 是否自动生成给 Agent 用的 skill？→ **待决策（本期暂不实现）**

需求：`difyctl` 能产出一份 agent-skill 包（`SKILL.md` + 可选 `reference/*.md`），Agent 安装后即获得驱动本 CLI 的能力。它本质上是 §6.2 单一事实源的**又一种渲染**（与 `-o json` 并列），入口形如 `difyctl skill init [dir]`。

**依赖：** 阶段 2 的 JSON 基座（`contract` + 命令树）。基座完成前不决策、不实现——届时再回到本条定夺。

设计空间（存档，留待将来定）：

- **内容密度：** 瘦（仅契约 + 指向 `difyctl help -o json` 自查命令全集） / 胖（冻入全部命令快照，会与二进制漂移） / 混合偏瘦（契约 + 核心工作流 `login → get app → describe → run/resume` 内联，命令全集现取）。倾向**混合偏瘦**——skill 的持久价值是*契约与约定*（Agent 难自推、又少变），per-command flag 易变、宜现查；冻全集等于主动制造漂移。
- **生成时机：** 以运行时生成器为引擎（Agent 装到的 skill 与其本机二进制版本一致），CI 用同一命令产出一份签入仓库的副本（照搬 `tree:gen` / `tree:check`）。skill 内记录生成时的 difyctl 版本，正文让 Agent 先 `difyctl version` 自验。
- **形态：** 目录式（`SKILL.md` 精简 + `reference/*.md` 按需加载），frontmatter 的 `description` 写好**触发条件**；把「写 SKILL.md 格式」隔离成独立 writer（外部约定，可能演进）。
- **安全：** skill 会教 Agent 跑可变更命令（`create/delete member`、`run app`），正文须标注破坏性命令、强调默认 `-o json` + 检查退出码。

---

## 8. 实现分期

每个阶段都可独立交付、独立测试。

### 阶段 1 — 修模型 + 路由（核心）

- 新增 `src/help/topics.ts` 与 `TOPICS`；迁入 `account` / `external` / `environment` 的渲染逻辑。
- 从命令树移除 `src/commands/help/*`；执行 `pnpm tree:gen`。
- 按 §4.1 的解析顺序（命令 → topic → 建议 → 总览）重写 `run.ts` 的 help 分支。
- `printTopLevelHelp` 增加列出 `TOPICS` 的 **GUIDES** 段。
- 测试：**路由级**测试（`difyctl help account` 渲染 account 指南；`difyctl help get app` 渲染命令帮助；`difyctl help xyz` 给建议并非零退出）。保留迁移过来的纯渲染单测。
- 更新 `README.md`，使被宣传的 `help <topic>` 路径重新生效。

### 阶段 2 — Agent 站点地图（结构化帮助）

- `formatHelp` 与顶层渲染器接受格式参数，按 §6 输出 JSON/YAML。
- 在 `run.ts` 的 help 分支经 `sniffOutputFormat` 传入格式。
- 增加 `contract` 块（退出码、格式、错误信封、HITL）。
- 测试：`help -o json` 可解析；包含全部命令 + topic + contract；单命令 `--help -o json` 符合 §6.1。

### 阶段 3 — 内容回填（增量）

- 新增 `agent` topic，收敛跨命令契约。
- 按 `run/app/guide.ts` 结构，给 `resume app`、`describe app`、`get app`、`auth login` 回填 `agentGuide`。
- 若 D1 = C：引入 `{ summary, full }`（或首段）约定并更新渲染器。

### 阶段 4 — 打磨

- 修 `flagLabel`：别名用 `, ` 连接，再用 ` ` 接 `<type>` → `--workspace <string>`、`-o, --output <string>`。
- 给父分组（如 `auth devices`）一个描述，或消除末尾空格。

---

## 9. 验收标准

- [ ] `difyctl help account` / `help external` / `help environment` 渲染各自指南（而非顶层列表）。由路由测试覆盖。
- [ ] `difyctl help` 展示分开的 COMMANDS 与 GUIDES 段；无死链 / 重复条目。
- [ ] `difyctl help xyz`（未知）给出建议并非零退出。
- [ ] `difyctl help -o json` 返回合法 JSON，含每个命令、每个 topic、以及全局 `contract`。
- [ ] `difyctl <cmd> --help -o json` 返回 §6.1 的单命令形态。
- [ ] 若 D1 = C，`run app --help`（人类）不再倾倒完整 guide；完整 guide 仍可经 `-o json` 获取。
- [ ] `agentGuide` 出现在 `run app`、`resume app`、`describe app`、`get app`、`auth login` 上。
- [ ] flag 标签渲染时 `<type>` 前不再有多余逗号。
- [ ] `pnpm test`、`pnpm type-check`、`pnpm lint`、`pnpm tree:check` 全部通过。

---

## 10. 风险

- **移除 `commands/help/*` 改变命令树。** 由 CI 中的 `pnpm tree:gen` + `tree:check` 兜底；无外部消费者依赖这些路径（它们本就不可达）。
- **JSON 形态成为契约。** 保持只增不减；在 `README.md` 中与现有输出格式保证一并说明其稳定性。
- **`agentGuide` 结构变更（D1=C）** 触及唯一的现有实现者（`run/app`）。影响面小——单一调用点，已被测试覆盖。

[`ARD.md`]: ./ARD.md
[`README.md`]: ./README.md
