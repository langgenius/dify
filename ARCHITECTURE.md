# Dify 架构与扩展点分析

## 📐 整体架构

Dify 是一个开源的 LLM 应用开发平台，采用前后端分离的架构：

```
ai-agent-sys/
├── api/                    # 后端 API (Python/Flask)
├── web/                    # 前端应用 (Next.js/React)
├── dify-agent/            # 独立 Agent 运行时
├── dify-agent-runtime/    # Agent 运行时核心
├── docker/                # Docker 部署配置
├── cli/                   # CLI 工具
├── e2e/                   # 端到端测试
├── packages/              # 共享包
└── sdks/                  # SDK
```

## 🎯 核心模块

### 1. 后端核心 (api/core/)

```
api/core/
├── agent/              # Agent 实现
├── app/                # 应用管理
├── workflow/           # 工作流引擎
│   └── nodes/          # 工作流节点（11种类型）
├── tools/              # 工具系统
│   ├── builtin_tool/   # 内置工具
│   ├── custom_tool/    # 自定义工具
│   ├── plugin_tool/    # 插件工具
│   └── mcp_tool/       # MCP 工具
├── plugin/             # 插件系统
├── extension/          # 扩展系统
├── rag/                # RAG 管道
├── mcp/                # Model Context Protocol
├── model_manager.py    # 模型管理
└── provider_manager.py # 提供商管理
```

### 2. 前端核心 (web/app/)

```
web/app/components/
├── workflow/           # 工作流可视化编辑器
│   ├── nodes/          # 节点 UI 组件
│   ├── block-selector/ # 节点选择器
│   └── panel/          # 配置面板
├── app/                # 应用界面
└── datasets/           # 数据集管理
```

## 🔌 主要扩展点

### 扩展点 1: 自定义工具 (Tools)

**位置**: `api/core/tools/`

**类型**:
- **内置工具** (`builtin_tool/`) - 预装工具
- **自定义工具** (`custom_tool/`) - 用户自定义
- **插件工具** (`plugin_tool/`) - 插件提供
- **MCP 工具** (`mcp_tool/`) - MCP 协议工具

**实现方式**:
```python
# 示例: api/core/tools/builtin_tool/providers/time/tools/current_time.py
from core.tools.builtin_tool.tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage

class CurrentTimeTool(BuiltinTool):
    def _invoke(self, session, user_id, tool_parameters, **kwargs):
        # 工具逻辑
        yield self.create_text_message(result)
```

**配置文件**:
```yaml
# provider.yaml
identity:
  author: Your Name
  name: tool_name
  label:
    en_US: Tool Name
    zh_Hans: 工具名称
  description:
    en_US: Tool description
  icon: icon.svg
  tags:
    - productivity
```

**前端扩展**: `web/app/components/workflow/nodes/tool/`

---

### 扩展点 2: 工作流节点 (Workflow Nodes)

**位置**: `api/core/workflow/nodes/`

**现有节点类型**:
1. `agent` - Agent 节点
2. `agent_v2` - Agent 节点 v2
3. `datasource` - 数据源节点
4. `human_input` - 人工输入节点
5. `knowledge_index` - 知识索引节点
6. `knowledge_retrieval` - 知识检索节点
7. `trigger_plugin` - 插件触发器
8. `trigger_schedule` - 定时触发器
9. `trigger_webhook` - Webhook 触发器

**节点工厂**: `api/core/workflow/node_factory.py`
- 负责创建和管理所有节点实例
- 使用 `graphon` 库作为底层引擎

**前端节点组件**: `web/app/components/workflow/nodes/`
- 每个节点类型对应一个前端组件
- 包含配置面板、UI 渲染、数据验证

---

### 扩展点 3: 插件系统 (Plugin System)

**位置**: `api/core/plugin/`

**核心组件**:
- `plugin_service.py` - 插件服务管理
- `impl/` - 插件实现
- `entities/` - 插件实体定义
- `endpoint/` - 插件端点

**插件类型**:
- **工具插件** - 提供新的工具能力
- **触发器插件** - 提供新的触发方式
- **模型提供商插件** - 接入新的 LLM 提供商

**相关服务**:
- `api/services/plugin/` - 插件服务层
- `api/controllers/inner_api/plugin/` - 插件 API
- `api/commands/plugin.py` - 插件 CLI

---

### 扩展点 4: 扩展系统 (Extension System)

**位置**: `api/core/extension/`

**文件**:
- `extension.py` - 扩展基类
- `extensible.py` - 可扩展接口
- `api_based_extension_requestor.py` - API 扩展请求器

**用途**:
- 定义扩展接口
- 支持基于 API 的外部扩展
- 扩展点注册和管理

---

### 扩展点 5: 模型提供商 (Model Providers)

**位置**: `api/core/provider_manager.py`

**功能**:
- 管理 LLM 模型提供商
- 支持 OpenAI、Anthropic、本地模型等
- 模型配置和认证

**扩展方式**:
- 添加新的模型提供商
- 自定义模型参数
- 接入私有部署模型

---

### 扩展点 6: RAG 管道 (RAG Pipeline)

**位置**: `api/core/rag/`

**组件**:
- 文档解析器
- 向量存储
- 检索器
- 重排序器

**扩展方向**:
- 自定义文档解析器
- 接入新的向量数据库
- 实现自定义检索策略

---

### 扩展点 7: MCP 集成 (Model Context Protocol)

**位置**: `api/core/mcp/`

**功能**:
- MCP 客户端 (`mcp_client.py`)
- 认证管理 (`auth/`)
- 会话管理 (`session/`)
- MCP 工具集成

**用途**:
- 通过 MCP 协议接入外部工具
- 标准化工具集成方式

---

## 🛠️ 推荐的定制开发方式

### 方案 1: 独立扩展目录（推荐）

创建独立的扩展目录，便于维护和同步：

```
api/
└── extensions/
    ├── custom_nodes/       # 自定义工作流节点
    ├── custom_tools/       # 自定义工具
    ├── custom_plugins/     # 自定义插件
    └── custom_providers/   # 自定义模型提供商

web/
└── extensions/
    └── custom_components/  # 自定义 UI 组件
```

### 方案 2: Fork 原有目录

直接在现有目录中添加：
- `api/core/tools/builtin_tool/providers/your_tool/`
- `api/core/workflow/nodes/your_node/`

**注意**: 需要在同步官方更新时处理冲突。

---

## 📋 开发工作流

### 1. 添加自定义工具

```bash
# 创建工具目录
mkdir -p api/core/tools/builtin_tool/providers/my_tool/tools

# 创建配置文件
cat > api/core/tools/builtin_tool/providers/my_tool/my_tool.yaml << EOF
identity:
  author: Your Name
  name: my_tool
  label:
    en_US: My Tool
  description:
    en_US: My custom tool
  icon: icon.svg
credentials_for_provider: {}
EOF

# 创建实现文件
# 编辑 api/core/tools/builtin_tool/providers/my_tool/tools/my_tool.py
```

### 2. 添加自定义工作流节点

```bash
# 后端节点
mkdir -p api/core/workflow/nodes/my_node

# 前端组件
mkdir -p web/app/components/workflow/nodes/my-node
```

### 3. 开发插件

```bash
# 插件开发
mkdir -p api/core/plugin/impl/my_plugin

# 注册插件
# 编辑相关注册文件
```

---

## 🧪 测试

### 后端测试
```bash
# 运行所有测试
make test

# 运行特定测试
make test TARGET_TESTS=./api/tests/unit/core/tools/

# 代码检查
make lint
make type-check
```

### 前端测试
```bash
cd web
pnpm test
```

---

## 📚 技术栈

### 后端
- **框架**: Flask
- **语言**: Python 3.10+
- **包管理**: uv
- **ORM**: SQLAlchemy
- **任务队列**: Celery
- **AI 库**: LangChain, Graphon

### 前端
- **框架**: Next.js 14
- **语言**: TypeScript
- **UI**: React, TailwindCSS
- **流程图**: ReactFlow
- **状态管理**: Zustand

---

## 🔗 相关文档

- [Dify 官方文档](https://docs.dify.ai/)
- [API 开发指南](api/AGENTS.md)
- [Dify Agent 指南](dify-agent/AGENTS.md)
- [同步指南](SYNC_GUIDE.md)

---

## 💡 最佳实践

1. **保持模块化** - 扩展代码独立存放
2. **遵循命名规范** - 与官方代码风格一致
3. **编写测试** - 确保扩展功能稳定
4. **文档先行** - 记录扩展的用途和用法
5. **定期同步** - 每 1-2 周同步官方更新
6. **版本管理** - 使用功能分支开发新特性
