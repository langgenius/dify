# Memory Module

This module provides memory management for LLM conversations, enabling context retention across dialogue turns.

## Overview

The memory module contains two types of memory implementations:

1. **TokenBufferMemory** - Conversation-level memory (existing)
2. **NodeTokenBufferMemory** - Node-level memory (to be implemented, **Chatflow only**)

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
│  │  Storage: Object Storage (JSON file)                                 │   │
│  │  Key: (app_id, conversation_id, node_id)                             │   │
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

## NodeTokenBufferMemory (To Be Implemented)

### Purpose

`NodeTokenBufferMemory` provides **node-scoped memory** within a conversation. Each LLM node in a workflow can maintain its own independent conversation history.

### Use Cases

1. **Multi-LLM Workflows**: Different LLM nodes need separate context
2. **Iterative Processing**: An LLM node in a loop needs to accumulate context across iterations
3. **Specialized Agents**: Each agent node maintains its own dialogue history

### Design Decisions

#### Storage: Object Storage for Messages (No New Database Table)

| Aspect                    | Database             | Object Storage     |
| ------------------------- | -------------------- | ------------------ |
| Cost                      | High                 | Low                |
| Query Flexibility         | High                 | Low                |
| Schema Changes            | Migration required   | None               |
| Consistency with existing | ConversationVariable | File uploads, logs |

**Decision**: Store message data in object storage, but still use existing database tables for file metadata.

**What is stored in Object Storage:**

- Message content (text)
- Message metadata (role, token_count, created_at)
- File references (upload_file_id, tool_file_id, etc.)
- Thread relationships (message_id, parent_message_id)

**What still requires Database queries:**

- File reconstruction: When reading node memory, file references are used to query
  `UploadFile` / `ToolFile` tables via `file_factory.build_from_mapping()` to rebuild
  complete `File` objects with storage_key, mime_type, etc.

**Why this hybrid approach:**

- No database migration required (no new tables)
- Message data may be large, object storage is cost-effective
- File metadata is already in database, no need to duplicate
- Aligns with existing storage patterns (file uploads, logs)

#### Storage Key Format

```
node_memory/{app_id}/{conversation_id}/{node_id}.json
```

#### Data Structure

```json
{
  "version": 1,
  "messages": [
    {
      "message_id": "msg-001",
      "parent_message_id": null,
      "role": "user",
      "content": "Analyze this image",
      "files": [
        {
          "type": "image",
          "transfer_method": "local_file",
          "upload_file_id": "file-uuid-123",
          "belongs_to": "user"
        }
      ],
      "token_count": 15,
      "created_at": "2026-01-07T10:00:00Z"
    },
    {
      "message_id": "msg-002",
      "parent_message_id": "msg-001",
      "role": "assistant",
      "content": "This is a landscape image...",
      "files": [],
      "token_count": 50,
      "created_at": "2026-01-07T10:00:01Z"
    }
  ]
}
```

### Thread Support

Node memory also supports thread extraction (for regeneration scenarios):

```python
def _extract_thread(
    self,
    messages: list[NodeMemoryMessage],
    current_message_id: str
) -> list[NodeMemoryMessage]:
    """
    Extract messages belonging to the thread of current_message_id.
    Similar to extract_thread_messages() in TokenBufferMemory.
    """
    ...
```

### File Handling

Files are stored as references (not full metadata):

```python
class NodeMemoryFile(BaseModel):
    type: str                        # image, audio, video, document, custom
    transfer_method: str             # local_file, remote_url, tool_file
    upload_file_id: str | None       # for local_file
    tool_file_id: str | None         # for tool_file
    url: str | None                  # for remote_url
    belongs_to: str                  # user / assistant
```

When reading, files are rebuilt using `file_factory.build_from_mapping()`.

### API Design

```python
class NodeTokenBufferMemory:
    def __init__(
        self,
        app_id: str,
        conversation_id: str,
        node_id: str,
        model_instance: ModelInstance,
    ):
        """
        Initialize node-level memory.

        :param app_id: Application ID
        :param conversation_id: Conversation ID
        :param node_id: Node ID in the workflow
        :param model_instance: Model instance for token counting
        """
        ...

    def add_messages(
        self,
        message_id: str,
        parent_message_id: str | None,
        user_content: str,
        user_files: Sequence[File],
        assistant_content: str,
        assistant_files: Sequence[File],
    ) -> None:
        """
        Append a dialogue turn (user + assistant) to node memory.
        Call this after LLM node execution completes.

        :param message_id: Current message ID (from Message table)
        :param parent_message_id: Parent message ID (for thread tracking)
        :param user_content: User's text input
        :param user_files: Files attached by user
        :param assistant_content: Assistant's text response
        :param assistant_files: Files generated by assistant
        """
        ...

    def get_history_prompt_messages(
        self,
        current_message_id: str,
        tenant_id: str,
        max_token_limit: int = 2000,
        file_upload_config: FileUploadConfig | None = None,
    ) -> Sequence[PromptMessage]:
        """
        Retrieve history as PromptMessage sequence.

        :param current_message_id: Current message ID (for thread extraction)
        :param tenant_id: Tenant ID (for file reconstruction)
        :param max_token_limit: Maximum tokens for history
        :param file_upload_config: File upload configuration
        :return: Sequence of PromptMessage for LLM context
        """
        ...

    def flush(self) -> None:
        """
        Persist buffered changes to object storage.
        Call this at the end of node execution.
        """
        ...

    def clear(self) -> None:
        """
        Clear all messages in this node's memory.
        """
        ...
```

### Data Flow

```
Object Storage                  NodeTokenBufferMemory           LLM Node
     │                                  │                           │
     │                                  │◀── get_history_prompt_messages()
     │  storage.load(key)               │                           │
     │◀─────────────────────────────────┤                           │
     │                                  │                           │
     │  JSON data                       │                           │
     ├─────────────────────────────────▶│                           │
     │                                  │                           │
     │                    _extract_thread()                         │
     │                                  │                           │
     │                    _rebuild_files() via file_factory         │
     │                                  │                           │
     │                    _build_prompt_messages()                  │
     │                                  │                           │
     │                    _truncate_by_tokens()                     │
     │                                  │                           │
     │                                  │  Sequence[PromptMessage]  │
     │                                  ├──────────────────────────▶│
     │                                  │                           │
     │                                  │◀── LLM execution complete │
     │                                  │                           │
     │                                  │◀── add_messages()         │
     │                                  │                           │
     │  storage.save(key, data)         │                           │
     │◀─────────────────────────────────┤                           │
     │                                  │                           │
```

### Integration with LLM Node

```python
# In LLM Node execution

# 1. Fetch memory based on mode
if node_data.memory and node_data.memory.mode == MemoryMode.NODE:
    # Node-level memory (Chatflow only)
    memory = fetch_node_memory(
        variable_pool=variable_pool,
        app_id=app_id,
        node_id=self.node_id,
        node_data_memory=node_data.memory,
        model_instance=model_instance,
    )
elif node_data.memory and node_data.memory.mode == MemoryMode.CONVERSATION:
    # Conversation-level memory (existing behavior)
    memory = fetch_memory(
        variable_pool=variable_pool,
        app_id=app_id,
        node_data_memory=node_data.memory,
        model_instance=model_instance,
    )
else:
    memory = None

# 2. Get history for context
if memory:
    if isinstance(memory, NodeTokenBufferMemory):
        history = memory.get_history_prompt_messages(
            current_message_id=current_message_id,
            tenant_id=tenant_id,
            max_token_limit=max_token_limit,
        )
    else:  # TokenBufferMemory
        history = memory.get_history_prompt_messages(
            max_token_limit=max_token_limit,
        )
    prompt_messages = [*history, *current_messages]
else:
    prompt_messages = current_messages

# 3. Call LLM
response = model_instance.invoke(prompt_messages)

# 4. Append to node memory (only for NodeTokenBufferMemory)
if isinstance(memory, NodeTokenBufferMemory):
    memory.add_messages(
        message_id=message_id,
        parent_message_id=parent_message_id,
        user_content=user_input,
        user_files=user_files,
        assistant_content=response.content,
        assistant_files=response_files,
    )
    memory.flush()
```

### Configuration

Add to `MemoryConfig` in `core/workflow/nodes/llm/entities.py`:

```python
class MemoryMode(StrEnum):
    CONVERSATION = "conversation"  # Use TokenBufferMemory (default, existing behavior)
    NODE = "node"                  # Use NodeTokenBufferMemory (new, Chatflow only)

class MemoryConfig(BaseModel):
    # Existing fields
    role_prefix: RolePrefix | None = None
    window: MemoryWindowConfig | None = None
    query_prompt_template: str | None = None

    # Memory mode (new)
    mode: MemoryMode = MemoryMode.CONVERSATION
```

**Mode Behavior:**

| Mode           | Memory Class          | Scope                    | Availability  |
| -------------- | --------------------- | ------------------------ | ------------- |
| `conversation` | TokenBufferMemory     | Entire conversation      | All app modes |
| `node`         | NodeTokenBufferMemory | Per-node in conversation | Chatflow only |

> When `mode=node` is used in a non-Chatflow context (no conversation_id), it should
> fall back to no memory or raise a configuration error.

---

## Comparison

| Feature        | TokenBufferMemory        | NodeTokenBufferMemory     |
| -------------- | ------------------------ | ------------------------- |
| Scope          | Conversation             | Node within Conversation  |
| Storage        | Database (Message table) | Object Storage (JSON)     |
| Thread Support | Yes                      | Yes                       |
| File Support   | Yes (via MessageFile)    | Yes (via file references) |
| Token Limit    | Yes                      | Yes                       |
| Use Case       | Standard chat apps       | Complex workflows         |

---

## Future Considerations

1. **Cleanup Task**: Add a Celery task to clean up old node memory files
2. **Concurrency**: Consider Redis lock for concurrent node executions
3. **Compression**: Compress large memory files to reduce storage costs
4. **Extension**: Other nodes (Agent, Tool) may also benefit from node-level memory
