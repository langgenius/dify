# Agent Patterns

A unified agent pattern module that provides common agent execution strategies for both Agent V2 nodes and Agent Applications in Dify.

## Overview

This module implements a strategy pattern for agent execution, automatically selecting the appropriate strategy based on model capabilities. It serves as the core engine for agent-based interactions across different components of the Dify platform.

## Key Features

### 1. Multiple Agent Strategies

- **Function Call Strategy**: Leverages native function/tool calling capabilities of advanced LLMs (e.g., GPT-4, Claude)
- **ReAct Strategy**: Implements the ReAct (Reasoning + Acting) approach for models without native function calling support

### 2. Automatic Strategy Selection

The `StrategyFactory` intelligently selects the optimal strategy based on model features:

- Models with `TOOL_CALL`, `MULTI_TOOL_CALL`, or `STREAM_TOOL_CALL` capabilities → Function Call Strategy
- Other models → ReAct Strategy

### 3. Unified Interface

- Common base class (`AgentPattern`) ensures consistent behavior across strategies
- Seamless integration with both workflow nodes and standalone agent applications
- Standardized input/output formats for easy consumption

### 4. Advanced Capabilities

- **Streaming Support**: Real-time response streaming for better user experience
- **File Handling**: Built-in support for processing and managing files during agent execution
- **Iteration Control**: Configurable maximum iterations with safety limits (capped at 99)
- **Tool Management**: Flexible tool integration supporting various tool types
- **Context Propagation**: Execution context for tracing, auditing, and debugging

## Architecture

```
agent/patterns/
├── base.py              # Abstract base class defining the agent pattern interface
├── function_call.py     # Implementation using native LLM function calling
├── react.py            # Implementation using ReAct prompting approach
└── strategy_factory.py  # Factory for automatic strategy selection
```

## Usage

The module is designed to be used by:

1. **Agent V2 Nodes**: In workflow orchestration for complex agent tasks
1. **Agent Applications**: For standalone conversational agents
1. **Custom Implementations**: As a foundation for building specialized agent behaviors

## Integration Points

- **Model Runtime**: Interfaces with Dify's model runtime for LLM interactions
- **Tool System**: Integrates with the tool framework for external capabilities
- **Memory Management**: Compatible with conversation memory systems
- **File Management**: Handles file inputs/outputs during agent execution

## Benefits

1. **Consistency**: Unified implementation reduces code duplication and maintenance overhead
1. **Flexibility**: Easy to extend with new strategies or customize existing ones
1. **Performance**: Optimized for each model's capabilities to ensure best performance
1. **Reliability**: Built-in safety mechanisms and error handling
