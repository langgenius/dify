# Passthrough Parameter Feature

## Overview

The Passthrough parameter feature allows users to pass custom data from web applications to plugins through the Dify workflow system. This feature provides a more flexible data transmission mechanism for plugin integration.

## Features

- **Generic Data Transmission**: Support passing arbitrary string data to plugins
- **Workflow Integration**: Fully integrated into the Dify workflow system
- **Plugin Compatibility**: Fully compatible with existing plugin systems
- **Type Safety**: Provides complete type checking and validation

## Use Cases

### 1. API Integration

Pass API keys or authentication tokens to external service plugins:

```json
{
  "inputs": {
    "query": "query content",
    "passthrough": "api_key_12345"
  }
}
```

### 2. User Preferences

Pass user-specific configuration to plugins:

```json
{
  "inputs": {
    "query": "translation content",
    "passthrough": "en-zh"
  }
}
```

### 3. Session Management

Pass session tokens for authenticated API calls:

```json
{
  "inputs": {
    "query": "user request",
    "passthrough": "session_token_abc123"
  }
}
```

### 4. Custom Metadata

Pass any custom data needed by plugins:

```json
{
  "inputs": {
    "query": "process request",
    "passthrough": "{\"location\":\"Beijing\",\"timezone\":\"UTC+8\"}"
  }
}
```

## API Usage

### Workflow Run API

Pass passthrough parameter through the `/workflows/run` endpoint:

```bash
curl -X POST 'https://api.dify.ai/v1/workflows/run' \
--header 'Authorization: Bearer {api_key}' \
--header 'Content-Type: application/json' \
--data-raw '{
    "inputs": {
        "query": "user query",
        "passthrough": "custom_data_here"
    },
    "response_mode": "streaming",
    "user": "user_id"
}'
```

### Parameter Description

- `inputs.passthrough`: Optional parameter for passing custom data to plugins
- Data type: String
- Maximum length: Recommended not to exceed 10KB

## Plugin Development

### Receiving Passthrough Parameters in Plugins

Plugin developers need to implement the `_invoke` method to receive passthrough parameters:

```python
def _invoke(
    self,
    user_id: str,
    tool_parameters: dict,
    conversation_id: str | None = None,
    app_id: str | None = None,
    message_id: str | None = None,
    passthrough: str | None = None,  # passthrough parameter passed as named argument
) -> ToolInvokeMessage | list[ToolInvokeMessage] | Generator[ToolInvokeMessage, None, None]:
    # Use passthrough parameter directly
    if passthrough:
        # Use passthrough data for processing
        print(f"Received passthrough data: {passthrough}")
    
    # Continue with normal tool processing logic
    return self._process_tool_request(tool_parameters, passthrough)
```

### Plugin Tool Manager

The plugin tool manager automatically passes passthrough parameters to plugins:

```python
# In PluginToolManager.invoke
data = {
    "user_id": user_id,
    "conversation_id": conversation_id,
    "app_id": app_id,
    "message_id": message_id,
    "passthrough": passthrough,  # Automatically passed
    "data": {
        "provider": tool_provider_id.provider_name,
        "tool": tool_name,
        "credentials": credentials,
        "credential_type": credential_type,
        "tool_parameters": tool_parameters,
    },
}
```

## Data Flow

```
Web App → API → Workflow Service → Tool Node → Plugin
    ↓       ↓         ↓            ↓         ↓
passthrough → inputs → SystemVariable → ToolEngine → Plugin
```

### Detailed Flow

1. **Web App**: Sends data through `inputs.passthrough`
1. **API Layer**: Receives and passes to workflow service
1. **Workflow Service**: Extracts passthrough parameter from `user_inputs`
1. **SystemVariable**: Stores passthrough as system variable
1. **Tool Node**: Gets passthrough parameter from variable pool
1. **ToolEngine**: Passes passthrough to tool
1. **Plugin**: Receives and uses passthrough data

## System Variables

Passthrough parameters are stored as system variables in `SystemVariable`:

```python
class SystemVariable(BaseModel):
    # ... other fields
    passthrough: str | None = None
```

Can be accessed through `SystemVariableKey.PASSTHROUGH`:

```python
from core.workflow.enums import SystemVariableKey

# Get passthrough parameter
passthrough = variable_pool.get(["sys", SystemVariableKey.PASSTHROUGH])
```

## Testing

### Unit Tests

```python
def test_tool_node_with_passthrough_parameter(self):
    """Test that tool node correctly passes passthrough parameter"""
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
        
        # Verify passthrough parameter was correctly passed
        call_args = mock_invoke.call_args
        assert call_args.kwargs['passthrough'] == passthrough_value
```

### Integration Tests

```python
def test_workflow_service_passthrough_extraction(self):
    """Test that workflow service correctly extracts passthrough parameter"""
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

    # Verify passthrough was correctly extracted
    assert variable_pool.system_variables.passthrough == "test_passthrough_data"
```

## Best Practices

### 1. Data Format

- Use JSON strings to pass structured data
- Keep data concise, avoid passing overly large data
- Encode or encrypt sensitive data appropriately

### 2. Error Handling

- Check if passthrough parameter exists in plugins
- Provide reasonable default values
- Log passthrough parameter usage

### 3. Security

- Validate passthrough data format and content
- Avoid passing sensitive information in passthrough
- Use appropriate authentication and authorization mechanisms

### 4. Performance Considerations

- Limit passthrough data size
- Avoid passing large amounts of data in passthrough
- Consider using caching mechanisms

## Compatibility

- **Backward Compatible**: Existing plugins continue to work without modification
- **Optional Parameter**: passthrough parameter is optional and doesn't affect existing functionality
- **Type Safe**: Provides complete type checking and validation

## Limitations

- **Data Type**: Only supports string type
- **Size Limit**: Recommended not to exceed 10KB
- **Storage**: passthrough data is not persisted

## Changelog

### v0.6.0

- Added passthrough parameter feature
- Support passing custom data from web apps to plugins
- Complete workflow integration
- Comprehensive test coverage

## Related Links

- [Dify Workflow Documentation](../workflow/README.md)
- [Plugin Development Guide](../plugin/README.md)
- [API Reference Documentation](../api/README.md)
- [Contributing Guide](../CONTRIBUTING.md)
