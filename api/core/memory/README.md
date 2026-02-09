# Memory Module

This module provides memory management for LLM conversations, enabling context retention across dialogue turns.

## Overview

The memory module contains two types of memory implementations:

1. **TokenBufferMemory** - Conversation-level memory (existing)
2. **NodeTokenBufferMemory** - Node-level memory (**Chatflow only**)

> **Note**: `NodeTokenBufferMemory` is only available in **Chatflow** (advanced-chat mode).
> This is because it requires both `conversation_id` and `node_id`, which are only present in Chatflow.
> Standard Workflow mode does not have `conversation_id` and therefore cannot use node-level memory.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Memory Architecture                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────-┐   │
│  │                      TokenBufferMemory                               │   │
│  │  Scope: Conversation                                                 │   │
│  │  Storage: Database (Message table)                                   │   │
│  │  Key: conversation_id                                                │   │
│  └─────────────────────────────────────────────────────────────────────-┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────-┐   │
│  │                    NodeTokenBufferMemory                             │   │
│  │  Scope: Node within Conversation                                     │   │
│  │  Storage: WorkflowNodeExecutionModel.outputs["context"]              │   │
│  │  Key: (conversation_id, node_id, workflow_run_id)                    │   │
│  └─────────────────────────────────────────────────────────────────────-┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## TokenBufferMemory (Existing)

### Purpose

`TokenBufferMemory` retrieves conversation history from the `Message` table and converts it to `PromptMessage` objects for LLM context.

### Key Features

- **Conversation-scoped**: All messages within a conversation are candidates
- **Thread-aware**: Uses `parent_message_id` to extract only the current thread (supports regeneration scenarios)
- **Token-limited**: Truncates history to fit within `max_token_limit`
- **File support**: Handles `MessageFile` attachments (images, documents, etc.)

### Data Flow

```
Message Table                    TokenBufferMemory              LLM
     │                                  │                        │
     │  SELECT * FROM messages          │                        │
     │  WHERE conversation_id = ?       │                        │
     │  ORDER BY created_at DESC        │                        │
     ├─────────────────────────────────▶│                        │
     │                                  │                        │
     │                    extract_thread_messages()              │
     │                                  │                        │
     │                    build_prompt_message_with_files()      │
     │                                  │                        │
     │                    truncate by max_token_limit            │
     │                                  │                        │
     │                                  │  Sequence[PromptMessage]
     │                                  ├───────────────────────▶│
     │                                  │                        │
```

### Thread Extraction

When a user regenerates a response, a new thread is created:

```
Message A (user)
    └── Message A' (assistant)
            └── Message B (user)
                    └── Message B' (assistant)
            └── Message A'' (assistant, regenerated)  ← New thread
                    └── Message C (user)
                            └── Message C' (assistant)
```

`extract_thread_messages()` traces back from the latest message using `parent_message_id` to get only the current thread: `[A, A'', C, C']`

### Usage

```python
from core.memory.token_buffer_memory import TokenBufferMemory

memory = TokenBufferMemory(conversation=conversation, model_instance=model_instance)
history = memory.get_history_prompt_messages(max_token_limit=2000, message_limit=100)
```

---

## NodeTokenBufferMemory

### Purpose

`NodeTokenBufferMemory` provides **node-scoped memory** within a conversation. Each LLM node in a workflow can maintain its own independent conversation history.

### Use Cases

1. **Multi-LLM Workflows**: Different LLM nodes need separate context
2. **Iterative Processing**: An LLM node in a loop needs to accumulate context across iterations
3. **Specialized Agents**: Each agent node maintains its own dialogue history

### Design: Zero Extra Storage

**Key insight**: LLM node already saves complete context in `outputs["context"]`.

Each LLM node execution outputs:
```python
outputs = {
    "text": clean_text,
    "context": self._build_context(prompt_messages, clean_text),  # Complete dialogue history!
    ...
}
```

This `outputs["context"]` contains:
- All previous user/assistant messages (excluding system prompt)
- The current assistant response

**No separate storage needed** - we just read from the last execution's `outputs["context"]`.

### Benefits

| Aspect | Old Design (Object Storage) | New Design (outputs["context"]) |
|--------|----------------------------|--------------------------------|
| Storage | Separate JSON file | Already in WorkflowNodeExecutionModel |
| Concurrency | Race condition risk | No issue (each execution is INSERT) |
| Cleanup | Need separate cleanup task | Follows node execution lifecycle |
| Migration | Required | None |
| Complexity | High | Low |

### Data Flow

```
WorkflowNodeExecutionModel        NodeTokenBufferMemory           LLM Node
     │                                  │                           │
     │                                  │◀── get_history_prompt_messages()
     │                                  │                           │
     │  SELECT outputs FROM             │                           │
     │  workflow_node_executions        │                           │
     │  WHERE workflow_run_id = ?       │                           │
     │  AND node_id = ?                 │                           │
     │◀─────────────────────────────────┤                           │
     │                                  │                           │
     │  outputs["context"]              │                           │
     ├─────────────────────────────────▶│                           │
     │                                  │                           │
     │                    deserialize PromptMessages                │
     │                                  │                           │
     │                    truncate by max_token_limit               │
     │                                  │                           │
     │                                  │  Sequence[PromptMessage]  │
     │                                  ├──────────────────────────▶│
     │                                  │                           │
```

### Thread Tracking

Thread extraction still uses `Message` table's `parent_message_id` structure:

1. Query `Message` table for conversation → get thread's `workflow_run_ids`
2. Get the last completed `workflow_run_id` in the thread
3. Query `WorkflowNodeExecutionModel` for that execution's `outputs["context"]`

### API

```python
class NodeTokenBufferMemory:
    def __init__(
        self,
        app_id: str,
        conversation_id: str,
        node_id: str,
        tenant_id: str,
        model_instance: ModelInstance,
    ):
        """Initialize node-level memory."""
        ...

    def get_history_prompt_messages(
        self,
        *,
        max_token_limit: int = 2000,
        message_limit: int | None = None,
    ) -> Sequence[PromptMessage]:
        """
        Retrieve history as PromptMessage sequence.
        
        Reads from last completed execution's outputs["context"].
        """
        ...

    # Legacy methods (no-op, kept for compatibility)
    def add_messages(self, *args, **kwargs) -> None: pass
    def flush(self) -> None: pass
    def clear(self) -> None: pass
```

### Configuration

Add to `MemoryConfig` in `core/workflow/nodes/llm/entities.py`:

```python
class MemoryMode(StrEnum):
    CONVERSATION = "conversation"  # Use TokenBufferMemory (default)
    NODE = "node"                  # Use NodeTokenBufferMemory (Chatflow only)

class MemoryConfig(BaseModel):
    role_prefix: RolePrefix | None = None
    window: MemoryWindowConfig | None = None
    query_prompt_template: str | None = None
    mode: MemoryMode = MemoryMode.CONVERSATION
```

**Mode Behavior:**

| Mode           | Memory Class          | Scope                    | Availability  |
| -------------- | --------------------- | ------------------------ | ------------- |
| `conversation` | TokenBufferMemory     | Entire conversation      | All app modes |
| `node`         | NodeTokenBufferMemory | Per-node in conversation | Chatflow only |

> When `mode=node` is used in a non-Chatflow context (no conversation_id), it falls back to no memory.

---

## Comparison

| Feature        | TokenBufferMemory        | NodeTokenBufferMemory              |
| -------------- | ------------------------ | ---------------------------------- |
| Scope          | Conversation             | Node within Conversation           |
| Storage        | Database (Message table) | WorkflowNodeExecutionModel.outputs |
| Thread Support | Yes                      | Yes                                |
| File Support   | Yes (via MessageFile)    | Yes (via context serialization)    |
| Token Limit    | Yes                      | Yes                                |
| Use Case       | Standard chat apps       | Complex workflows                  |

---

## Extending to Other Nodes

Currently only **LLM Node** outputs `context` in its outputs. To enable node memory for other nodes:

1. Add `outputs["context"] = self._build_context(prompt_messages, response)` in the node
2. The `NodeTokenBufferMemory` will automatically pick it up

Nodes that could potentially support this:
- `question_classifier`
- `parameter_extractor`
- `agent`

---

## Future Considerations

1. **Cleanup**: Node memory lifecycle follows `WorkflowNodeExecutionModel`, which already has cleanup mechanisms
2. **Compression**: For very long conversations, consider summarization strategies
3. **Extension**: Other nodes may benefit from node-level memory
