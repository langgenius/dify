# Agent 对话闭环流程

## 1. 流程概述

本文档描述 Dify 平台中 Agent（智能体）对话从初始化到结束的完整闭环流程。Agent 是 Dify 中的核心执行模式之一，赋予大语言模型自主推理和工具调用的能力，使其能够在多轮迭代中自主决定何时调用工具、如何组合工具输出，并最终生成完整回答。Agent 系统采用策略驱动设计，支持 CoT（思维链）和 Function Calling 两种核心策略，并通过 Token Buffer Memory 机制管理对话历史。

核心流程包括：
- **Agent 对话初始化**：创建会话 → 加载工具 → 初始化记忆 → 选择策略
- **Agent 推理与工具调用循环**：推理 → 解析工具调用 → 执行工具 → 观察结果 → 继续推理
- **Agent 记忆管理**：加载历史消息 → Token 裁剪 → 上下文窗口管理
- **Agent 对话结束与反馈**：输出最终答案 → 记录 Thought → 用户反馈 → 日志持久化

---

## 2. Agent 对话初始化流程图

```mermaid
flowchart TD
    A[用户发起对话请求] --> B[ChatService / CompletionService]
    B --> C{应用模式判断}
    C -->|Agent Chat| D[Agent 应用模式]
    C -->|Workflow Agent 节点| E[AgentNode._run]

    D --> F[BaseAgentRunner 初始化]
    E --> G[StrategyResolver.resolve<br/>解析策略]

    F --> H[_init_prompt_tools<br/>工具初始化]
    G --> H

    H --> I[加载 AgentToolEntity<br/>从 AppConfig.agent.tools]
    I --> J[加载 DatasetRetrieverTool<br/>知识库检索工具]
    J --> K[ToolManager.get_agent_tool_runtime<br/>获取工具运行时实例]
    K --> L[转换工具参数为 JSON Schema<br/>PromptMessageTool.parameters]
    L --> M[注册工具实例<br/>tool_instances + prompt_messages_tools]

    M --> N[初始化记忆<br/>TokenBufferMemory]
    N --> O[从数据库加载对话历史<br/>extract_thread_messages]
    O --> P[构建 PromptMessage 序列]
    P --> Q[计算 Token 数量]
    Q --> R{超出 max_token_limit?}
    R -->|是| S[从头部裁剪消息<br/>保留最近上下文]
    R -->|否| T[记忆初始化完成]

    S --> Q
    T --> U{策略选择}

    U -->|模型支持 Function Calling| V[FunctionCallAgentRunner<br/>FC 策略]
    U -->|模型不支持 FC - Chat 模式| W[CotChatAgentRunner<br/>CoT Chat 策略]
    U -->|模型不支持 FC - Completion 模式| X[CotCompletionAgentRunner<br/>CoT Completion 策略]
    U -->|插件策略| Y[PluginAgentStrategy<br/>插件自定义策略]

    V --> Z[Agent 初始化完成<br/>准备进入推理循环]
    W --> Z
    X --> Z
    Y --> Z

    style A fill:#e1f5fe
    style C fill:#fff3e0
    style U fill:#fff3e0
    style R fill:#fce4ec
    style Z fill:#c8e6c9
```

### 策略选择逻辑

| 条件 | 策略 | 实现类 | Prompt 组织方式 |
|------|------|--------|----------------|
| LLM 支持 Function Calling | FC 策略 | `FunctionCallAgentRunner` | System Prompt + 历史消息 + Tool 定义 |
| LLM 不支持 FC + Chat 模式 | CoT Chat | `CotChatAgentRunner` | System Prompt + 历史消息 + Scratchpad |
| LLM 不支持 FC + Completion 模式 | CoT Completion | `CotCompletionAgentRunner` | 拼接为单一 UserPromptMessage |
| 插件自定义策略 | 插件策略 | `PluginAgentStrategy` | 由插件定义 |

### 工具类型

| 工具来源 | 类型标识 | 说明 |
|----------|----------|------|
| 内置工具 | `BUILT_IN` | Dify 预置工具（网页搜索、天气查询等） |
| API 工具 | `API` | 用户自定义 API 工具 |
| 数据集检索 | `DATASET_RETRIEVAL` | 知识库检索工具 |
| 插件工具 | `PLUGIN` | 插件系统提供的工具 |
| MCP 工具 | `MCP` | MCP 协议提供的工具 |

---

## 3. Agent 推理与工具调用循环流程图

```mermaid
flowchart TD
    A[进入推理循环<br/>iteration_step = 1] --> B{iteration_step <= max_iteration?}
    B -->|否| C[AgentMaxIterationError<br/>超出最大迭代次数]

    B -->|是| D{iteration_step == max_iteration?}
    D -->|是| E[移除所有工具<br/>强制模型输出最终答案]
    D -->|否| F[保留工具定义]

    E --> G[调用 LLM]
    F --> G

    G --> H{策略类型}
    H -->|CoT| I[CotAgentOutputParser<br/>解析流式输出]
    H -->|FC| J[解析 tool_calls<br/>LLMResultChunk.delta]

    I --> K{解析结果}
    K -->|Final Answer| L[输出最终答案<br/>循环结束]
    K -->|Action| M[提取 action_name + action_input]

    J --> N{LLM 返回 tool_calls?}
    N -->|否| L
    N -->|是| O[提取 tool_call_id + function.name + function.arguments]

    M --> P[ToolEngine.agent_invoke<br/>执行工具]
    O --> P

    P --> Q{工具执行结果}
    Q -->|成功| R[ToolInvokeMessage<br/>工具返回内容]
    Q -->|工具不存在| S[返回错误提示<br/>不中断执行]
    Q -->|执行异常| T[记录异常信息<br/>作为 Observation]

    R --> U[记录 Observation 到 Scratchpad<br/>CoT: AgentScratchpadUnit]
    S --> U
    T --> U

    U --> V[保存 MessageAgentThought<br/>推理过程持久化]
    V --> W[CoT: ToolPromptMessage<br/>FC: ToolPromptMessage]
    W --> X[iteration_step += 1]
    X --> B

    L --> Y[保存最终 Message<br/>记录 LLM 用量]
    Y --> Z[对话完成]

    style A fill:#e1f5fe
    style G fill:#fff3e0
    style H fill:#fff3e0
    style P fill:#fce4ec
    style L fill:#e8f5e9
    style Z fill:#c8e6c9
```

### CoT 策略推理循环时序图

```mermaid
sequenceDiagram
    participant User as 用户
    participant Runner as CotAgentRunner
    participant LLM as 大语言模型
    participant Parser as CotOutputParser
    participant TE as ToolEngine
    participant DB as 数据库

    User->>Runner: 发送查询
    Runner->>Runner: 组织 Prompt Messages<br/>System + History + Query + Scratchpad
    Runner->>LLM: 调用 LLM（流式）
    LLM-->>Parser: 流式输出
    Parser->>Parser: 解析 Thought / Action / Final Answer

    alt 工具调用
        Parser-->>Runner: Action(name, input)
        Runner->>TE: agent_invoke(tool, parameters)
        TE-->>Runner: ToolInvokeMessage
        Runner->>DB: 保存 AgentThought
        Runner->>Runner: 追加 Observation 到 Scratchpad
        Runner->>LLM: 继续调用 LLM
    else 最终答案
        Parser-->>Runner: Final Answer
        Runner->>DB: 保存最终 Message
        Runner-->>User: 返回答案
    end
```

### FC 策略推理循环时序图

```mermaid
sequenceDiagram
    participant User as 用户
    participant Runner as FunctionCallAgentRunner
    participant LLM as 大语言模型
    participant TE as ToolEngine
    participant DB as 数据库

    User->>Runner: 发送查询
    Runner->>Runner: 组织 Prompt Messages<br/>System + History + Query + Tool 定义
    Runner->>LLM: 调用 LLM with tools
    LLM-->>Runner: tool_calls 或 文本回复

    alt 工具调用
        loop 每个 tool_call
            Runner->>TE: agent_invoke(tool, parameters)
            TE-->>Runner: ToolInvokeMessage
        end
        Runner->>DB: 保存 AgentThought
        Runner->>Runner: 追加 ToolPromptMessage
        Runner->>LLM: 继续调用 LLM
    else 最终答案
        LLM-->>Runner: 纯文本回复
        Runner->>DB: 保存最终 Message
        Runner-->>User: 返回答案
    end
```

### 迭代控制参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `max_iteration` | 用户配置 | Agent 最大迭代次数 |
| 实际上限 | `min(max_iteration, 99) + 1` | 系统硬性上限为 100 次 |
| `function_call_state` | `True` | 是否继续调用工具 |

### AgentThought 持久化内容

| 字段 | 说明 |
|------|------|
| `thought` | 推理过程文本（Thought） |
| `tool` | 调用的工具名称 |
| `tool_input` | 工具调用参数 |
| `observation` | 工具返回结果（Observation） |
| `message_id` | 关联的消息 ID |
| `message_chain_id` | 消息链 ID |

---

## 4. Agent 记忆管理流程图

```mermaid
flowchart TD
    A[TokenBufferMemory 初始化] --> B[配置参数<br/>max_token_limit / message_limit]
    B --> C[从数据库加载对话消息<br/>按 created_at 排序]

    C --> D[extract_thread_messages<br/>提取线程消息]
    D --> E[遍历消息列表]
    E --> F{消息包含文件?}
    F -->|是| G[_build_prompt_message_with_files<br/>构建含文件的 PromptMessage]
    F -->|否| H[构建纯文本 PromptMessage]

    G --> I[添加到消息序列]
    H --> I

    I --> J[计算 Token 总数<br/>model_instance.get_num_tokens]
    J --> K{Token 数 > max_token_limit?}
    K -->|是| L[从头部移除最早的消息]
    L --> J
    K -->|否| M{消息条数 > message_limit?}
    M -->|是| L
    M -->|否| N[记忆构建完成<br/>返回 PromptMessage 序列]

    N --> O{Agent 策略类型}
    O -->|CoT| P[AgentHistoryPromptTransform<br/>格式化为 ReAct 风格]
    O -->|FC| Q[直接使用历史消息<br/>+ Tool 定义]
    O -->|Workflow Agent| R[AgentRuntimeSupport.fetch_memory<br/>配置 memory.window.size]

    P --> S[注入到 Agent Runner<br/>作为上下文]
    Q --> S
    R --> S

    style A fill:#e1f5fe
    style K fill:#fce4ec
    style N fill:#e8f5e9
    style S fill:#c8e6c9
```

### 记忆裁剪策略

```mermaid
flowchart LR
    subgraph 裁剪前
        direction TB
        M1[消息1<br/>最早] --- M2[消息2] --- M3[消息3] --- M4[消息4<br/>最近]
    end

    subgraph 裁剪后
        direction TB
        M3_2[消息3] --- M4_2[消息4<br/>最近]
    end

    M1 -.->|超出限制<br/>移除| X[丢弃]
    M2 -.->|超出限制<br/>移除| X
    M3 --> M3_2
    M4 --> M4_2
```

### 记忆管理参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `max_token_limit` | 2000 | 历史消息最大 Token 数 |
| `message_limit` | 500 | 加载的最大消息条数 |
| `memory.window.size` | 可配置 | Workflow Agent 记忆窗口大小 |

### 记忆在 Agent 中的应用

| Agent 类型 | 记忆组件 | 组织方式 |
|------------|----------|----------|
| CoT Chat Runner | `AgentHistoryPromptTransform` + `TokenBufferMemory` | System Prompt + 历史消息 + Scratchpad |
| CoT Completion Runner | `AgentHistoryPromptTransform` + `TokenBufferMemory` | 拼接为单一 UserPromptMessage |
| FC Runner | `AgentHistoryPromptTransform` | System Prompt + 历史消息 + Tool 定义 |
| Workflow Agent Node | `AgentRuntimeSupport.fetch_memory()` | 通过 `memory.window.size` 配置 |

---

## 5. Agent 对话结束与反馈流程图

```mermaid
flowchart TD
    A[Agent 推理循环结束] --> B{结束原因}

    B -->|Final Answer| C[输出最终答案]
    B -->|Max Iteration| D[AgentMaxIterationError<br/>强制终止]
    B -->|用户停止| E[手动停止对话]
    B -->|执行异常| F[记录异常信息]

    C --> G[保存最终 Message 记录]
    D --> H[保存错误 Message<br/>包含迭代次数信息]
    E --> I[标记对话为 stopped]
    F --> J[保存异常 Message<br/>包含错误堆栈]

    G --> K[记录 LLM 用量<br/>token_usage + latency]
    H --> K
    J --> K

    K --> L[更新对话统计<br/>dialogue_count += 1]
    L --> M[持久化 MessageAgentThought<br/>完整推理链]

    M --> N{流式输出处理}
    N -->|流式| O[SSE 事件流<br/>message → message_end]
    N -->|非流式| P[JSON 同步返回]

    O --> Q[用户收到回复]
    P --> Q

    Q --> R{用户反馈}
    R -->|like| S[记录正面反馈<br/>FeedbackRating.LIKE]
    R -->|dislike| T[记录负面反馈<br/>FeedbackRating.DISLIKE]
    R -->|无反馈| U[对话结束]

    S --> V[反馈持久化<br/>MessageFeedback 记录]
    T --> V
    V --> W[反馈用于分析优化<br/>LLMOps 监控]

    U --> X[对话日志归档]
    W --> X

    style A fill:#e1f5fe
    style B fill:#fff3e0
    style C fill:#e8f5e9
    style Q fill:#e8f5e9
    style X fill:#c8e6c9
```

### 对话结束场景

| 结束原因 | 触发条件 | 处理方式 | 用户体验 |
|----------|----------|----------|----------|
| Final Answer | LLM 输出最终答案 | 正常保存 Message | 收到完整回复 |
| 最大迭代 | 超过 max_iteration | 抛出 AgentMaxIterationError | 收到错误提示 |
| 用户停止 | 用户主动停止 | 标记 stopped | 对话中断 |
| 执行异常 | LLM 调用失败等 | 记录异常信息 | 收到错误提示 |

### 反馈机制

| 反馈类型 | 标识 | 来源 | 用途 |
|----------|------|------|------|
| 点赞 | `like` | 用户 / 管理员标注 | 优化 Prompt 和模型选择 |
| 点踩 | `dislike` | 用户 / 管理员标注 | 定位问题、改进回答质量 |
| 管理员标注 | `admin` | 管理员后台标注 | 训练数据收集、Annotation Reply |

### 消息持久化内容

| 实体 | 说明 |
|------|------|
| `Message` | 对话消息记录，包含查询、回复、Token 用量 |
| `MessageAgentThought` | 每轮推理的 Thought/Action/Observation |
| `MessageFile` | 消息中的文件附件 |
| `MessageChain` | 消息链，关联同一对话的多条消息 |
| `MessageFeedback` | 用户反馈记录 |

---

## 6. 流程步骤说明表格

### Agent 对话初始化步骤

| 步骤 | 操作 | 执行组件 | 输入 | 输出 |
|------|------|----------|------|------|
| 1 | 接收对话请求 | ChatService | 用户查询 + 会话 ID | 请求上下文 |
| 2 | 初始化 Agent Runner | BaseAgentRunner | AppConfig + 模型配置 | Runner 实例 |
| 3 | 加载工具 | _init_prompt_tools | AgentToolEntity + DatasetRetrieverTool | tool_instances + prompt_messages_tools |
| 4 | 初始化记忆 | TokenBufferMemory | 会话 ID + max_token_limit | PromptMessage 序列 |
| 5 | 选择策略 | 策略选择逻辑 | 模型能力检测 | 具体 Runner 实例 |
| 6 | 组织 Prompt | AgentRunner | System Prompt + 历史 + 工具 | 完整 Prompt Messages |

### Agent 推理循环步骤

| 步骤 | 操作 | 执行组件 | 输入 | 输出 |
|------|------|----------|------|------|
| 1 | 调用 LLM | AgentRunner | Prompt Messages + Tool 定义 | LLM 流式输出 |
| 2 | 解析输出 | CotOutputParser / FC 解析 | 流式 Chunk | Action / Final Answer |
| 3 | 提取工具调用 | AgentRunner | action_name + action_input | 工具调用参数 |
| 4 | 执行工具 | ToolEngine.agent_invoke | Tool 实例 + 参数 | ToolInvokeMessage |
| 5 | 记录 Observation | AgentRunner | 工具返回结果 | Scratchpad 更新 |
| 6 | 持久化 Thought | MessageAgentThought | thought + tool + observation | 数据库记录 |
| 7 | 追加工具结果 | AgentRunner | ToolPromptMessage | 更新 Prompt Messages |
| 8 | 检查迭代 | AgentRunner | iteration_step | 继续循环 / 结束 |

### Agent 记忆管理步骤

| 步骤 | 操作 | 执行组件 | 输入 | 输出 |
|------|------|----------|------|------|
| 1 | 加载历史消息 | TokenBufferMemory | conversation_id | 消息列表 |
| 2 | 提取线程消息 | extract_thread_messages | 消息列表 | PromptMessage 序列 |
| 3 | 构建 PromptMessage | TokenBufferMemory | 消息 + 文件 | PromptMessage |
| 4 | 计算 Token 数 | model_instance | PromptMessage 序列 | Token 总数 |
| 5 | 裁剪超限消息 | TokenBufferMemory | max_token_limit | 裁剪后序列 |
| 6 | 格式化历史 | AgentHistoryPromptTransform | PromptMessage 序列 | ReAct / FC 格式 |

### Agent 对话结束步骤

| 步骤 | 操作 | 执行组件 | 输入 | 输出 |
|------|------|----------|------|------|
| 1 | 输出最终答案 | AgentRunner | Final Answer | 流式 / 同步响应 |
| 2 | 保存 Message | MessageService | 查询 + 回复 + 用量 | Message 记录 |
| 3 | 更新对话统计 | ConversationService | dialogue_count | 统计更新 |
| 4 | 发送响应 | Controller | 响应数据 | HTTP 响应 |
| 5 | 接收反馈 | FeedbackService | like / dislike | Feedback 记录 |
| 6 | 日志归档 | LLMOps | 完整对话链 | 分析数据 |

---

## 7. 关键决策点说明

### 决策点 1：策略选择

| 决策 | 条件 | 影响 |
|------|------|------|
| Function Calling | LLM 原生支持 FC | 模型直接输出结构化 tool_calls，解析效率高 |
| CoT Chat | LLM 不支持 FC + Chat 模式 | 通过 ReAct Prompt 引导，输出 Action 格式 |
| CoT Completion | LLM 不支持 FC + Completion 模式 | 拼接为单一 Prompt，适合单轮场景 |
| 插件策略 | 用户配置了插件 Agent 策略 | 由插件定义推理逻辑，通过 PluginAgentClient 调用 |

### 决策点 2：工具调用判断

| 决策 | 条件 | 影响 |
|------|------|------|
| CoT - Final Answer | 解析输出为 Final Answer | 推理循环结束，输出最终答案 |
| CoT - Action | 解析输出包含 Action | 提取工具名和参数，执行工具调用 |
| FC - tool_calls | LLM 返回 tool_calls | 逐个执行工具调用，结果追加到对话 |
| FC - 纯文本 | LLM 返回纯文本 | 推理循环结束，输出最终答案 |
| 工具不存在 | 工具名称不在注册列表 | 返回错误提示，不中断执行循环 |

### 决策点 3：迭代控制

| 决策 | 条件 | 影响 |
|------|------|------|
| 继续迭代 | iteration_step < max_iteration 且有工具调用 | 继续推理循环 |
| 强制结束 | iteration_step == max_iteration | 移除所有工具，强制模型输出最终答案 |
| 超出上限 | iteration_step > min(max_iteration, 99) + 1 | 抛出 AgentMaxIterationError |
| 用户停止 | 用户主动停止对话 | 标记对话为 stopped |

### 决策点 4：记忆裁剪

| 决策 | 条件 | 影响 |
|------|------|------|
| 保留全部 | Token 数 ≤ max_token_limit | 使用完整历史消息 |
| 从头部裁剪 | Token 数 > max_token_limit | 移除最早的消息，保留最近上下文 |
| 最低保留 | 仅剩 1 条消息 | 保留至少 1 条消息，确保上下文不空 |

### 决策点 5：对话结束处理

| 决策 | 条件 | 影响 |
|------|------|------|
| 正常结束 | LLM 输出 Final Answer | 保存完整 Message，记录 Token 用量 |
| 迭代超限 | 超过最大迭代次数 | 保存错误信息，提示用户调整 |
| 异常终止 | LLM 调用失败等 | 保存异常信息，支持重试 |
| 用户停止 | 用户主动停止 | 标记 stopped，保留已有输出 |
