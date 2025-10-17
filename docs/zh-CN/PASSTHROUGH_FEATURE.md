# Passthrough 参数功能

## 概述

Passthrough 参数功能允许用户通过 Dify 工作流系统将自定义数据从 Web 应用程序传递到插件。这个功能为插件集成提供了更灵活的数据传递机制。

## 功能特性

- **通用数据传递**：支持传递任意字符串数据到插件
- **工作流集成**：完全集成到 Dify 工作流系统中
- **插件兼容**：与现有插件系统完全兼容
- **类型安全**：提供完整的类型检查和验证

## 使用场景

### 1. API 集成
传递 API 密钥或认证令牌到外部服务插件：

```json
{
  "inputs": {
    "query": "查询内容",
    "passthrough": "api_key_12345"
  }
}
```

### 2. 用户偏好设置
传递用户特定的配置到插件：

```json
{
  "inputs": {
    "query": "翻译内容",
    "passthrough": "en-zh"
  }
}
```

### 3. 会话管理
传递会话令牌用于认证的 API 调用：

```json
{
  "inputs": {
    "query": "用户请求",
    "passthrough": "session_token_abc123"
  }
}
```

### 4. 自定义元数据
传递插件需要的任何自定义数据：

```json
{
  "inputs": {
    "query": "处理请求",
    "passthrough": "{\"location\":\"Beijing\",\"timezone\":\"UTC+8\"}"
  }
}
```

## API 使用方法

### 工作流运行 API

通过 `/workflows/run` 端点传递 passthrough 参数：

```bash
curl -X POST 'https://api.dify.ai/v1/workflows/run' \
--header 'Authorization: Bearer {api_key}' \
--header 'Content-Type: application/json' \
--data-raw '{
    "inputs": {
        "query": "用户查询",
        "passthrough": "custom_data_here"
    },
    "response_mode": "streaming",
    "user": "user_id"
}'
```

### 参数说明

- `inputs.passthrough`：可选参数，用于传递自定义数据到插件
- 数据类型：字符串
- 最大长度：建议不超过 10KB

## 插件开发

### 在插件中接收 passthrough 参数

插件可以通过 `tool_parameters` 或运行时上下文接收 passthrough 参数：

```python
def invoke(self, user_id: str, tool_parameters: dict, **kwargs):
    # 从运行时上下文获取 passthrough 参数
    passthrough = kwargs.get('passthrough')
    
    if passthrough:
        # 使用 passthrough 数据进行处理
        print(f"Received passthrough data: {passthrough}")
    
    # 继续正常的工具处理逻辑
    return self._process_tool_request(tool_parameters, passthrough)
```

### 插件工具管理器

插件工具管理器会自动将 passthrough 参数传递给插件：

```python
# 在 PluginToolManager.invoke 中
data = {
    "user_id": user_id,
    "conversation_id": conversation_id,
    "app_id": app_id,
    "message_id": message_id,
    "passthrough": passthrough,  # 自动传递
    "data": {
        "provider": tool_provider_id.provider_name,
        "tool": tool_name,
        "credentials": credentials,
        "credential_type": credential_type,
        "tool_parameters": tool_parameters,
    },
}
```

## 数据流

```
Web 应用 → API → 工作流服务 → 工具节点 → 插件
    ↓         ↓        ↓         ↓        ↓
passthrough → inputs → SystemVariable → ToolEngine → Plugin
```

### 详细流程

1. **Web 应用**：通过 `inputs.passthrough` 发送数据
2. **API 层**：接收并传递给工作流服务
3. **工作流服务**：从 `user_inputs` 中提取 passthrough 参数
4. **SystemVariable**：将 passthrough 存储为系统变量
5. **工具节点**：从变量池获取 passthrough 参数
6. **ToolEngine**：将 passthrough 传递给工具
7. **插件**：接收并使用 passthrough 数据

## 系统变量

Passthrough 参数作为系统变量存储在 `SystemVariable` 中：

```python
class SystemVariable(BaseModel):
    # ... 其他字段
    passthrough: str | None = None
```

可以通过 `SystemVariableKey.PASSTHROUGH` 访问：

```python
from core.workflow.enums import SystemVariableKey

# 获取 passthrough 参数
passthrough = variable_pool.get(["sys", SystemVariableKey.PASSTHROUGH])
```

## 测试

### 单元测试

```python
def test_tool_node_with_passthrough_parameter(self):
    """测试工具节点正确传递 passthrough 参数"""
    tool_config = {
        "data": {
            "type": "tool",
            "title": "Test Tool",
            "provider_type": "builtin",
            "provider_id": "test_provider",
            "tool_name": "test_tool",
        },
        "id": "1",
    }

    passthrough_value = "test_passthrough_data"
    tool_node = init_tool_node_with_passthrough(tool_config, passthrough_value)

    with patch('core.tools.tool_engine.ToolEngine.generic_invoke') as mock_invoke:
        mock_invoke.return_value = iter([mock_message])
        list(tool_node._run())
        
        # 验证 passthrough 参数被正确传递
        call_args = mock_invoke.call_args
        assert call_args.kwargs['passthrough'] == passthrough_value
```

### 集成测试

```python
def test_workflow_service_passthrough_extraction(self):
    """测试工作流服务正确提取 passthrough 参数"""
    user_inputs_with_passthrough = {
        "query": "test query",
        "passthrough": "test_passthrough_data"
    }

    variable_pool = _setup_variable_pool(
        query="test query",
        files=[],
        user_id="test_user",
        user_inputs=user_inputs_with_passthrough,
        workflow=mock_workflow,
        node_type=NodeType.START,
        conversation_id="test_conversation",
        conversation_variables=[]
    )

    # 验证 passthrough 被正确提取
    assert variable_pool.system_variables.passthrough == "test_passthrough_data"
```

## 最佳实践

### 1. 数据格式
- 使用 JSON 字符串传递结构化数据
- 保持数据简洁，避免传递过大的数据
- 对敏感数据进行适当的编码或加密

### 2. 错误处理
- 在插件中检查 passthrough 参数是否存在
- 提供合理的默认值
- 记录 passthrough 参数的使用情况

### 3. 安全性
- 验证 passthrough 数据的格式和内容
- 避免在 passthrough 中传递敏感信息
- 使用适当的认证和授权机制

### 4. 性能考虑
- 限制 passthrough 数据的大小
- 避免在 passthrough 中传递大量数据
- 考虑使用缓存机制

## 兼容性

- **向后兼容**：现有插件无需修改即可继续工作
- **可选参数**：passthrough 参数是可选的，不影响现有功能
- **类型安全**：提供完整的类型检查和验证

## 限制

- **数据类型**：仅支持字符串类型
- **大小限制**：建议不超过 10KB
- **存储**：passthrough 数据不会持久化存储

## 更新日志

### v0.6.0
- 添加 passthrough 参数功能
- 支持从 Web 应用传递自定义数据到插件
- 完整的工作流集成
- 全面的测试覆盖

## 相关链接

- [Dify 工作流文档](../workflow/README.md)
- [插件开发指南](../plugin/README.md)
- [API 参考文档](../api/README.md)
- [贡献指南](../CONTRIBUTING.md)
