# `core/agent/output_parser/cot_output_parser.py` Design Notes

### Goal

Enable **true streaming** for Agent ReAct “Final Answer” output by emitting the `action_input` text **as it is produced** (token-by-token / chunk-by-chunk), instead of waiting until the full JSON action object is complete.

### Where this file sits in the architecture

- This parser consumes streamed `LLMResultChunk` from the model runtime and outputs a mixed stream of:
  - **plain text** chunks (shown live in UI), and
  - **`AgentScratchpadUnit.Action`** objects (used by the runner to decide “tool call vs final answer”).
- The downstream runner (`core/agent/cot_agent_runner.py`) wraps these text chunks into `LLMResultChunk` deltas which become `agent_message` SSE events.

### Key behaviors

#### 1) Early “Final Answer” detection via partial JSON parsing

- Function: `_maybe_mark_final_action(action_json: str) -> bool`
- Strategy:
  - First try `pydantic_core.from_json(action_json, allow_partial=True)` to parse **partial JSON** and detect whether `"action": "Final Answer"` is present early.
  - If strict parsing fails (common when models emit non-strict JSON such as literal newlines inside strings), fall back to a lightweight regex match for the `"action"` field.

This gives us a reliable “we are in Final Answer mode” signal **before** `action_input` is complete.

#### 2) Streaming `action_input` text while JSON is incomplete

- Function: `_stream_action_input_incrementally(...) -> (emitted_text, cursor, pending_raw)`
- Strategy:
  - Locate the `"action_input": "` field and track a cursor into the JSON buffer.
  - Append new raw bytes to `pending_raw`.
  - Decode only the **largest safe prefix** of `pending_raw` using `json.loads(f'"{prefix}"', strict=False)` so:
    - escapes are decoded by the JSON implementation (not hand-rolled),
    - incomplete escape fragments at stream boundaries are not emitted (kept in `pending_raw`).

This keeps streaming stable and avoids broken escape artifacts.

#### 3) Supported action JSON layouts

This parser supports the common ReAct layouts encountered in practice:

- Inline JSON: `Action: {"action": "...", "action_input": "..."}`
- Fenced JSON blocks: \`Action: ````` json ... ```` (and case variants like  `````JSON)
- List wrapper in code blocks: \`Action: \`\`\`[{"action": ..., "action_input": ...}]\`\`\`\`

For fenced blocks, the parser maintains a “code JSON capture” state to stream `action_input` even before the closing fences appear.

### State machine (high-level)

- Track whether we are currently inside:
  - a fenced code block,
  - an inline JSON object.
- Maintain per-mode streaming state:
  - “Final Answer detected” flag
  - cursor position into JSON buffer for `action_input`
  - `pending_raw` buffer for incomplete escape sequences

### Contract with the runner

- When `Final Answer` is detected and `action_input` streaming begins:
  - the parser yields the `action_input` content as plain text increments
  - sets `usage_dict["final_answer_streamed"] = True`
- The runner uses this flag to avoid double-streaming (i.e., it won’t re-emit the final answer at the end if it was already streamed live).

### Tests

Unit tests live in:

- `tests/unit_tests/core/agent/output_parser/test_cot_output_parser.py`

They cover:

- Action parsing across multiple JSON formats.
- “Manual boundary” edge cases:
  - unfinished `\\uXXXX` escape
  - trailing `\\` at end of stream
