# Agent V2 Node

Agent V2 is a workflow node that enables agent functionality within Dify workflows.

## Purpose

Agent V2 was created to provide a direct implementation of agent capabilities without plugin dependencies. It automatically selects the appropriate execution strategy based on the model's capabilities.

## Key Differences from V1

- **File Handling**: Supports file transfer between tools and models, enabling multi-modal workflows
- **Direct Implementation**: No plugin system dependency
- **Automatic Strategy Selection**: Chooses between Function Call and ReAct based on model features
- **Unified Architecture**: Uses the shared agent patterns module
- **Better Error Handling**: More granular control over error scenarios

## Features

### Strategy Selection

- Function Call: For models with native tool calling support
- ReAct: For models without native tool calling

### Tool Support

- Built-in tools
- API tools
- MCP (Model Context Protocol) tools
- Workflow tools
- Plugin tools

### LLM Node Compatibility

Inherits all LLM node features:

- Prompt templates
- Memory management
- Vision support
- Context injection
- Streaming output
- Structured output

## Configuration Structure

```yaml
# Model configuration
model:
  provider: string
  name: string
  mode: chat/completion

# Tools configuration
tools:
  - type: builtin/api/mcp/workflow/plugin
    provider_name: string
    tool_name: string
    enabled: boolean
    parameters: {}

# Memory configuration (optional)
memory:
  type: window
  window:
    size: number

# Other LLM node configurations
prompt_template: []
context: {}
vision: {}
```

## Implementation Details

1. The node receives configuration and initializes
1. Model features are detected to determine strategy
1. Tools are loaded and validated
1. Agent pattern is created using StrategyFactory
1. Execution proceeds with the selected strategy
1. Results include text output, files, and usage statistics

## Usage in Workflows

Input:

- Variables from previous nodes
- Files (via vision field for vision-enabled models, or via prompt for model/tool processing)
- Context data

Output:

- `text`: Agent response
- `files`: Generated files
- `usage`: Token usage data
- `finish_reason`: Completion reason

## Error Handling

Supports standard workflow error strategies:

- Default to node default value
- Fail workflow
- Continue on error

With configurable retry settings.

## Notes

- Maximum iterations are capped at 99 for safety
- File handling includes both input processing and output generation
- Execution context is propagated for tracing and debugging
