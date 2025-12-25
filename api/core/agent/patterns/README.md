# Agent Patterns

A unified agent pattern module that powers both Agent V2 workflow nodes and agent applications. Strategies share a common execution contract while adapting to model capabilities and tool availability.

## Overview

The module applies a strategy pattern around LLM/tool orchestration. `StrategyFactory` auto-selects the best implementation based on model features or an explicit agent strategy, and each strategy streams logs and usage consistently.

## Key Features

- **Dual strategies**
  - `FunctionCallStrategy`: uses native LLM function/tool calling when the model exposes `TOOL_CALL`, `MULTI_TOOL_CALL`, or `STREAM_TOOL_CALL`.
  - `ReActStrategy`: ReAct (reasoning + acting) flow driven by `CotAgentOutputParser`, used when function calling is unavailable or explicitly requested.
- **Explicit or auto selection**
  - `StrategyFactory.create_strategy` prefers an explicit `AgentEntity.Strategy` (FUNCTION_CALLING or CHAIN_OF_THOUGHT).
  - Otherwise it falls back to function calling when tool-call features exist, or ReAct when they do not.
- **Unified execution contract**
  - `AgentPattern.run` yields streaming `AgentLog` entries and `LLMResultChunk` data, returning an `AgentResult` with text, files, usage, and `finish_reason`.
  - Iterations are configurable and hard-capped at 99 rounds; the last round forces a final answer by withholding tools.
- **Tool handling and hooks**
  - Tools convert to `PromptMessageTool` objects before invocation.
  - Optional `tool_invoke_hook` lets callers override tool execution (e.g., agent apps) while workflow runs use `ToolEngine.generic_invoke`.
  - Tool outputs support text, links, JSON, variables, blobs, retriever resources, and file attachments; `target=="self"` files are reloaded into model context, others are returned as outputs.
- **File-aware arguments**
  - Tool args accept `[File: <id>]` or `[Files: <id1, id2>]` placeholders that resolve to `File` objects before invocation, enabling models to reference uploaded files safely.
- **ReAct prompt shaping**
  - System prompts replace `{{instruction}}`, `{{tools}}`, and `{{tool_names}}` placeholders.
  - Adds `Observation` to stop sequences and appends scratchpad text so the model sees prior Thought/Action/Observation history.
- **Observability and accounting**
  - Standardized `AgentLog` entries for rounds, model thoughts, and tool calls, including usage aggregation (`LLMUsage`) across streaming and non-streaming paths.

## Architecture

```
agent/patterns/
├── base.py              # Shared utilities: logging, usage, tool invocation, file handling
├── function_call.py     # Native function-calling loop with tool execution
├── react.py             # ReAct loop with CoT parsing and scratchpad wiring
└── strategy_factory.py  # Strategy selection by model features or explicit override
```

## Usage

- For auto-selection:
  - Call `StrategyFactory.create_strategy(model_features, model_instance, context, tools, files, ...)` and run the returned strategy with prompt messages and model params.
- For explicit behavior:
  - Pass `agent_strategy=AgentEntity.Strategy.FUNCTION_CALLING` to force native calls (falls back to ReAct if unsupported), or `CHAIN_OF_THOUGHT` to force ReAct.
- Both strategies stream chunks and logs; collect the generator output until it returns an `AgentResult`.

## Integration Points

- **Model runtime**: delegates to `ModelInstance.invoke_llm` for both streaming and non-streaming calls.
- **Tool system**: defaults to `ToolEngine.generic_invoke`, with `tool_invoke_hook` for custom callers.
- **Files**: flows through `File` objects for tool inputs/outputs and model-context attachments.
- **Execution context**: `ExecutionContext` fields (user/app/conversation/message) propagate to tool invocations and logging.
