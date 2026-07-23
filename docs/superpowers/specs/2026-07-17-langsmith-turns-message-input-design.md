# LangSmith Turns Message Input Design

## Problem

Unified tracing currently assigns the complete workflow input mapping to the root `message` span of a Chatflow trace. LangSmith therefore receives inputs such as `sys.app_id`, `sys.query`, and `sys.user_id` without an explicit conversational message schema. Its Turns view may select `sys.app_id` as the Human message instead of the actual query.

The query is already resolved by `OpsTraceManager` as `WorkflowTraceInfo.query`; no additional parsing is required.

## Design

### Canonical trace semantics

For workflow traces that have a `message_id`:

- The root `message` span represents the user turn.
- Its input is `WorkflowTraceInfo.query` when the query is non-empty.
- If the query is empty, its input falls back to the complete `workflow_run_inputs` mapping so file-only or non-text turns do not lose their input.
- The child `workflow` span continues to receive the complete `workflow_run_inputs` mapping unchanged.

For workflow traces without a `message_id`, the root workflow span remains unchanged and retains the complete workflow inputs.

All canonical message spans will carry `trace_entity_type: message` metadata so provider adapters can apply message-specific translation without relying on span names.

### LangSmith translation

The unified LangSmith adapter will translate a canonical message span whose input is a string into LangSmith's explicit message schema:

```json
{
  "messages": [
    {
      "role": "user",
      "content": "hi"
    }
  ]
}
```

Non-message spans and Mapping inputs remain unchanged. This keeps Dify-specific workflow keys out of the provider adapter and preserves existing behavior for workflow, tool, retriever, and LLM runs.

The legacy LangSmith implementation is not changed.

## Data flow

1. `OpsTraceManager` resolves `query` from `query` or `sys.query` and retains the complete workflow input mapping.
2. `CanonicalTraceBuilder` puts the resolved query on the root message span and the complete mapping on the child workflow span.
3. `UnifiedLangSmithAdapter` recognizes the message span through `trace_entity_type` and emits the string input using LangSmith's `messages` schema.
4. LangSmith Turns displays `sys.query` content as the Human message while trace details retain the complete inputs on the workflow run.

## Tests

Use a realistic Chatflow input mapping containing:

- `sys.app_id`
- `sys.dialogue_count`
- `sys.files`
- `sys.query`
- `sys.user_id`
- `sys.workflow_id`
- `sys.workflow_run_id`

Focused tests will verify:

1. The root message input equals the resolved query.
2. The child workflow input equals the complete original mapping.
3. LangSmith receives `messages: [{role: user, content: hi}]` for the message span.
4. A workflow without a message root retains the complete input mapping.
5. An empty query falls back to the complete input mapping.
6. Mapping inputs on non-message spans are still passed through unchanged.

## Scope

No new canonical entity types, provider interfaces, dependencies, legacy tracing changes, or general input filtering are introduced.
