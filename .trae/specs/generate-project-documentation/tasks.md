# Tasks

- [x] Task 1: 创建文档目录结构与项目总览文档
  - [x] SubTask 1.1: 创建 `project-docs/` 子目录结构（architecture, features, flows, api, deployment）
  - [x] SubTask 1.2: 生成 `project-docs/architecture/overview.md` — 项目总览与架构概览文档

- [x] Task 2: 生成后端架构文档
  - [x] SubTask 2.1: 生成 `project-docs/architecture/backend.md` — 后端 DDD 分层架构、控制器-服务-核心域调用链路、数据库模型、Celery 异步任务、存储与缓存

- [x] Task 3: 生成前端架构文档
  - [x] SubTask 3.1: 生成 `project-docs/architecture/frontend.md` — Next.js 应用结构、路由体系、组件架构、状态管理、i18n

- [x] Task 4: 生成 Workflow 引擎功能文档
  - [x] SubTask 4.1: 生成 `project-docs/features/workflow.md` — 节点类型、执行引擎、变量系统、人工输入、触发器集成

- [x] Task 5: 生成 RAG 管道功能文档
  - [x] SubTask 5.1: 生成 `project-docs/features/rag-pipeline.md` — 数据源、文档处理、分块、嵌入、检索、重排序

- [x] Task 6: 生成 Agent 智能体功能文档
  - [x] SubTask 6.1: 生成 `project-docs/features/agent.md` — 策略模式、工具调用、记忆管理、插件策略适配

- [x] Task 7: 生成 Plugin 插件系统功能文档
  - [x] SubTask 7.1: 生成 `project-docs/features/plugin.md` — 插件架构、生命周期、端点机制、向后兼容

- [x] Task 8: 生成 MCP 集成功能文档
  - [x] SubTask 8.1: 生成 `project-docs/features/mcp.md` — MCP 客户端/服务器架构、认证、会话管理

- [x] Task 9: 生成 Trigger 触发器功能文档
  - [x] SubTask 9.1: 生成 `project-docs/features/trigger.md` — Webhook、定时调度、插件触发器

- [x] Task 10: 生成 Tool 工具系统功能文档
  - [x] SubTask 10.1: 生成 `project-docs/features/tools.md` — 内置/自定义/MCP/插件/Workflow 工具

- [x] Task 11: 生成 Model Provider 功能文档
  - [x] SubTask 11.1: 生成 `project-docs/features/model-provider.md` — 供应商注册、模型配置、负载均衡、配额

- [x] Task 12: 生成数据集管理功能文档
  - [x] SubTask 12.1: 生成 `project-docs/features/dataset.md` — 数据集生命周期、文档处理、分段、元数据、命中测试

- [x] Task 13: 生成用户与工作空间管理文档
  - [x] SubTask 13.1: 生成 `project-docs/features/user-workspace.md` — 账户体系、OAuth、工作空间、成员、API Key

- [x] Task 14: 生成部署架构文档
  - [x] SubTask 14.1: 生成 `project-docs/deployment/architecture.md` — Docker Compose、中间件、Nginx、SSRF 代理、环境变量

- [x] Task 15: 生成 API 接口文档
  - [x] SubTask 15.1: 生成 `project-docs/api/overview.md` — Console API、Service API、Web API 端点分类

- [x] Task 16: 生成功能闭环流程图文档
  - [x] SubTask 16.1: 生成 `project-docs/flows/app-lifecycle.md` — 应用创建与发布闭环流程
  - [x] SubTask 16.2: 生成 `project-docs/flows/workflow-execution.md` — Workflow 执行闭环流程
  - [x] SubTask 16.3: 生成 `project-docs/flows/rag-pipeline-flow.md` — RAG 知识库构建闭环流程
  - [x] SubTask 16.4: 生成 `project-docs/flows/agent-conversation.md` — Agent 对话闭环流程

- [x] Task 17: 生成功能逻辑流程图文档
  - [x] SubTask 17.1: 生成 `project-docs/flows/logic-flows.md` — 模块间关系图、数据流向图、核心功能交互图

# Task Dependencies
- [Task 2, Task 3] depend on [Task 1] (需要目录结构先创建)
- [Task 4 ~ Task 13] depend on [Task 1] (需要目录结构先创建)
- [Task 14] depend on [Task 1]
- [Task 15] depend on [Task 1]
- [Task 16, Task 17] depend on [Task 4, Task 5, Task 6] (流程图需要功能文档作为输入)
- Task 2 ~ Task 15 可并行执行（彼此无依赖）
- Task 16 ~ Task 17 可并行执行
