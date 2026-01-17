# `tests/unit_tests/core/agent/output_parser/test_cot_output_parser.py` Design Notes

### Purpose

This test module validates the streaming and parsing contract for ReAct-style agent outputs produced by:

- `core/agent/output_parser/cot_output_parser.py`

It focuses on two things:

- **Action parsing correctness** across multiple formatting variants.
- **Streaming safety** for unfinished/partial `action_input` payloads.

### What we assert

#### 1) Action parsing across formats

The parameterized cases in `test_cot_output_parser()` cover common shapes the model may produce:

- Inline JSON action objects
- Fenced `json / `JSON blocks
- Code-block list wrappers (e.g. `[ {...} ]`)
- “weird” wrappers that still contain a JSON payload
- Non-JSON `Action:` text (baseline: no action parsed)

For “Final Answer” cases we assert:

- At least one `AgentScratchpadUnit.Action` is produced and equals the expected dict.
- The parser marks `usage_dict["final_answer_streamed"] = True`.

#### 2) Manual boundary cases (unfinished output)

Even though escape decoding is delegated to `json.loads`, the parser still performs minimal boundary checks to avoid emitting partial escape sequences mid-stream.

These tests validate that we do not emit:

- **partial unicode escapes** (unfinished `\\uXXXX`)
- a **dangling trailing backslash** at end-of-stream

### Why these tests matter

- ReAct models can output invalid or truncated JSON during streaming.
- The UI expects a stable incremental stream; emitting partial escape fragments creates “broken” text artifacts.
- These tests lock the expected behavior so future parser changes don’t regress streaming quality.
