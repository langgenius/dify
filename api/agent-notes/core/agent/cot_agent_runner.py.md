# `core/agent/cot_agent_runner.py` Design Notes

### Goal

Ensure Agent ReAct (CoT) responses **stream to the client as tokens are produced**, including the final answer.

This file is responsible for:

- orchestrating the ReAct loop (thought/action/observation),
- invoking tools when needed,
- emitting streamed `LLMResultChunk` deltas that the app pipeline converts into `agent_message` SSE events.

### Where this file sits in the architecture

- The agent app runner (`core/app/apps/agent_chat/app_runner.py`) constructs a `Cot*AgentRunner` and calls `run(...)`.
- This runner yields `LLMResultChunk` objects.
- The app pipeline converts those to:
  - `QueueAgentMessageEvent` → `StreamEvent.AGENT_MESSAGE` → SSE `agent_message`
  - `QueueAgentThoughtEvent` → SSE `agent_thought`
  - `QueueMessageEndEvent` → SSE `message_end`

### Streaming design

#### 1) Live streaming during generation

- The runner invokes the model with `stream=True`.
- It passes the model chunk generator to `CotAgentOutputParser.handle_react_stream_output(...)`.
- For each yielded **string chunk** from the parser, the runner immediately yields an `LLMResultChunk` delta with that text.

This is the primary “token streaming” path.

#### 2) Final Answer streaming without double emission

Problem:

- In ReAct JSON mode, the model can emit the final answer inside a JSON action object.
- If the parser already streamed `action_input` live, we must not emit it again at the end.

Mechanism:

- The parser sets `usage_dict["final_answer_streamed"] = True` once it starts streaming `action_input`.
- The runner tracks `final_answer_streamed_live` and skips the end-of-run fallback streaming when it is true.

Fallback:

- When the model output is not in a streamable ReAct JSON shape (or parsing fails), the runner uses `_stream_text_as_llm_chunks(...)` to stream the final answer at the end (still chunked, but not “as produced”).

### `_stream_text_as_llm_chunks` helper

- Purpose: provide a minimal streaming fallback for non-ReAct JSON outputs.
- Policy:
  - defaults to 1-character chunks
  - batches to 8 characters for large outputs to reduce SSE overhead
  - attaches usage only to the last chunk

### Testing

- Parser behavior is covered by:
  - `tests/unit_tests/core/agent/output_parser/test_cot_output_parser.py`
- Fallback helper behavior is covered by:
  - `tests/unit_tests/core/agent/test_cot_agent_runner_final_streaming.py`
