"""Unit tests for CotAgentOutputParser.

Verifies expected parsing behavior for streaming content and JSON payloads,
including edge cases such as empty/non-string content and malformed JSON.
Uses production model chunks and scratchpad actions. Implementation under test:
core.agent.output_parser.cot_output_parser.CotAgentOutputParser.
"""

import json

import pytest

from core.agent.entities import AgentScratchpadUnit
from core.agent.output_parser.cot_output_parser import CotAgentOutputParser
from graphon.model_runtime.entities.llm_entities import LLMResultChunk, LLMResultChunkDelta, LLMUsage
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage


@pytest.fixture
def usage_dict():
    return {}


@pytest.fixture
def make_chunk():
    def _make_chunk(content: str | None = None, usage: LLMUsage | None = None) -> LLMResultChunk:
        return LLMResultChunk(
            model="test-model",
            delta=LLMResultChunkDelta(index=0, message=AssistantPromptMessage(content=content), usage=usage),
        )

    return _make_chunk


# ============================================================
# Test Suite
# ============================================================


class TestCotAgentOutputParser:
    """Validate CotAgentOutputParser streaming + JSON parsing behavior.

    Lifecycle: no explicit setup/teardown; relies on pytest fixtures for
    production chunk/action models. Invariants: non-string/empty content
    yields no output, usage gets recorded when provided, and valid action JSON
    results in Action instantiation. Usage: invoke via pytest (e.g.,
    `pytest -k TestCotAgentOutputParser`).
    """

    # --------------------------------------------------------
    # Basic streaming & usage
    # --------------------------------------------------------

    def test_stream_plain_text(self, make_chunk, usage_dict) -> None:
        chunks = [make_chunk("hello world")]
        result = list(CotAgentOutputParser.handle_react_stream_output(chunks, usage_dict))
        assert "".join(result) == "hello world"

    def test_stream_empty_string(self, make_chunk, usage_dict) -> None:
        chunks = [make_chunk("")]
        result = list(CotAgentOutputParser.handle_react_stream_output(chunks, usage_dict))
        assert result == []

    def test_stream_none_content(self, make_chunk, usage_dict) -> None:
        chunks = [make_chunk(None)]
        result = list(CotAgentOutputParser.handle_react_stream_output(chunks, usage_dict))
        assert result == []

    @pytest.mark.parametrize("content", [123, 12.5, [], {}, object()])
    def test_non_string_content(self, make_chunk, usage_dict, content) -> None:
        # Deliberately corrupt only the message content to exercise the parser's
        # defensive handling of malformed provider output.
        chunk = make_chunk()
        chunk.delta.message = chunk.delta.message.model_copy(update={"content": content})
        result = list(CotAgentOutputParser.handle_react_stream_output([chunk], usage_dict))
        assert result == []

    def test_usage_update(self, make_chunk, usage_dict) -> None:
        usage_data = LLMUsage.empty_usage().model_copy(update={"total_tokens": 99})
        chunks = [make_chunk("abc", usage=usage_data)]
        list(CotAgentOutputParser.handle_react_stream_output(chunks, usage_dict))
        assert usage_dict["usage"] == usage_data

    # --------------------------------------------------------
    # JSON parsing (direct + streaming)
    # --------------------------------------------------------

    def test_single_json_action_valid(self, make_chunk, usage_dict) -> None:
        content = '{"action": "search", "input": "query"}'
        chunks = [make_chunk(content)]
        result = list(CotAgentOutputParser.handle_react_stream_output(chunks, usage_dict))
        assert result == [AgentScratchpadUnit.Action(action_name="search", action_input="query")]

    def test_json_list_unwrap(self, make_chunk, usage_dict) -> None:
        content = '[{"action": "lookup", "input": "abc"}]'
        chunks = [make_chunk(content)]
        result = list(CotAgentOutputParser.handle_react_stream_output(chunks, usage_dict))
        assert [item for item in result if isinstance(item, AgentScratchpadUnit.Action)] == [
            AgentScratchpadUnit.Action(action_name="lookup", action_input="abc")
        ]

    def test_json_missing_fields_returns_string(self, make_chunk, usage_dict) -> None:
        content = '{"foo": "bar"}'
        chunks = [make_chunk(content)]
        result = list(CotAgentOutputParser.handle_react_stream_output(chunks, usage_dict))
        # Expect the serialized JSON to be yielded as a single element.
        assert result == [json.dumps({"foo": "bar"})]

    def test_invalid_json_string_input(self, make_chunk, usage_dict) -> None:
        content = "{invalid json}"
        chunks = [make_chunk(content)]
        result = list(CotAgentOutputParser.handle_react_stream_output(chunks, usage_dict))
        assert any("invalid json" in str(r) for r in result)

    def test_json_split_across_chunks(self, make_chunk, usage_dict) -> None:
        chunks = [
            make_chunk('{"action": '),
            make_chunk('"multi", '),
            make_chunk('"input": "step"}'),
        ]
        result = list(CotAgentOutputParser.handle_react_stream_output(chunks, usage_dict))
        assert result == [AgentScratchpadUnit.Action(action_name="multi", action_input="step")]

    def test_unclosed_json_at_end(self, make_chunk, usage_dict) -> None:
        chunks = [make_chunk('{"foo": "bar"')]
        result = list(CotAgentOutputParser.handle_react_stream_output(chunks, usage_dict))
        assert all(isinstance(item, str) for item in result)
        assert any('{"foo": "bar"' in item for item in result)

    # --------------------------------------------------------
    # Code block JSON extraction
    # --------------------------------------------------------

    def test_code_block_json_valid(self, make_chunk, usage_dict) -> None:
        content = """```json
{"action": "lookup", "input": "abc"}
```"""
        chunks = [make_chunk(content)]
        result = list(CotAgentOutputParser.handle_react_stream_output(chunks, usage_dict))
        assert [item for item in result if isinstance(item, AgentScratchpadUnit.Action)] == [
            AgentScratchpadUnit.Action(action_name="lookup", action_input="abc")
        ]

    def test_code_block_multiple_json(self, make_chunk, usage_dict) -> None:
        # Multiple JSON objects inside single code fence (invalid combined JSON)
        # Parser should safely ignore invalid combined block
        content = """```json
{"action": "a1", "input": "x"}
{"action": "a2", "input": "y"}
```"""
        chunks = [make_chunk(content)]
        result = list(CotAgentOutputParser.handle_react_stream_output(chunks, usage_dict))
        # No valid parsed action expected due to invalid combined JSON
        assert not any(isinstance(item, AgentScratchpadUnit.Action) for item in result)
        assert isinstance(result, list)

    def test_code_block_invalid_json(self, make_chunk, usage_dict) -> None:
        content = """```json
{invalid}
```"""
        chunks = [make_chunk(content)]
        result = list(CotAgentOutputParser.handle_react_stream_output(chunks, usage_dict))
        assert result

    def test_unclosed_code_block(self, make_chunk, usage_dict) -> None:
        chunks = [make_chunk('```json {"a":1}')]
        result = list(CotAgentOutputParser.handle_react_stream_output(chunks, usage_dict))
        assert all(isinstance(item, str) for item in result)
        assert any('```json {"a":1}' in item for item in result)

    # --------------------------------------------------------
    # Action / Thought prefix handling
    # --------------------------------------------------------

    @pytest.mark.parametrize(
        "content",
        [
            " action: something",
            " ACTION: something",
            " thought: reasoning",
            " THOUGHT: reasoning",
        ],
    )
    def test_prefix_handling(self, make_chunk, usage_dict, content) -> None:
        chunks = [make_chunk(content)]
        result = list(CotAgentOutputParser.handle_react_stream_output(chunks, usage_dict))
        joined = "".join(str(item) for item in result)
        expected_word = "something" if "action:" in content.lower() else "reasoning"
        assert expected_word in joined
        assert "action:" not in joined.lower()
        assert "thought:" not in joined.lower()

    def test_prefix_mid_word_yield_delta_branch(self, make_chunk, usage_dict) -> None:
        chunks = [make_chunk("xaction: test")]
        result = list(CotAgentOutputParser.handle_react_stream_output(chunks, usage_dict))
        assert "x" in "".join(map(str, result))

    # --------------------------------------------------------
    # Trailing incomplete marker prefixes (issue #43350)
    # --------------------------------------------------------

    @pytest.mark.parametrize("marker", ["action:", "thought:", "ACTION:", "THOUGHT:"])
    @pytest.mark.parametrize("prefix_len", range(1, 7))
    def test_trailing_incomplete_prefix_is_flushed(self, make_chunk, usage_dict, marker, prefix_len) -> None:
        text = f"hello {marker[:prefix_len]}"
        chunks = [make_chunk(text)]
        result = list(CotAgentOutputParser.handle_react_stream_output(chunks, usage_dict))
        assert "".join(result) == text

    @pytest.mark.parametrize("marker", ["action:", "thought:"])
    def test_trailing_incomplete_prefix_is_flushed_char_by_char(self, make_chunk, usage_dict, marker) -> None:
        for prefix_len in range(1, len(marker)):
            text = f"hello {marker[:prefix_len]}"
            chunks = [make_chunk(char) for char in text]
            result = list(CotAgentOutputParser.handle_react_stream_output(chunks, usage_dict))
            assert "".join(result) == text

    def test_trailing_incomplete_prefix_after_complete_marker(self, make_chunk, usage_dict) -> None:
        text = "thought: ok\nhello acti"
        chunks = [make_chunk(text)]
        result = list(CotAgentOutputParser.handle_react_stream_output(chunks, usage_dict))
        joined = "".join(result)
        assert "ok" in joined
        assert "hello acti" in joined

    @pytest.mark.parametrize("marker", ["action:", "thought:", "ACTION:", "THOUGHT:"])
    def test_complete_trailing_marker_still_consumed(self, make_chunk, usage_dict, marker) -> None:
        chunks = [make_chunk(f"hello {marker}")]
        result = list(CotAgentOutputParser.handle_react_stream_output(chunks, usage_dict))
        joined = "".join(result).lower()
        assert "hello" in joined
        assert "action:" not in joined
        assert "thought:" not in joined

    # --------------------------------------------------------
    # Mixed streaming scenarios
    # --------------------------------------------------------

    def test_text_json_text_mix(self, make_chunk, usage_dict) -> None:
        content = 'start {"action": "mix", "input": "1"} end'
        chunks = [make_chunk(content)]
        result = list(CotAgentOutputParser.handle_react_stream_output(chunks, usage_dict))
        # JSON action should be parsed
        assert [item for item in result if isinstance(item, AgentScratchpadUnit.Action)] == [
            AgentScratchpadUnit.Action(action_name="mix", action_input="1")
        ]
        # Ensure surrounding text is streamed (character-level)
        joined = "".join(str(r) for r in result if isinstance(r, str))
        assert "start" in joined
        assert "end" in joined

    def test_multiple_code_blocks_in_stream(self, make_chunk, usage_dict) -> None:
        content = '```json\n{"action":"a1","input":"x"}\n```middle```json\n{"action":"a2","input":"y"}\n```'
        chunks = [make_chunk(content)]
        result = list(CotAgentOutputParser.handle_react_stream_output(chunks, usage_dict))
        assert [item for item in result if isinstance(item, AgentScratchpadUnit.Action)] == [
            AgentScratchpadUnit.Action(action_name="a1", action_input="x"),
            AgentScratchpadUnit.Action(action_name="a2", action_input="y"),
        ]

    def test_backtick_noise(self, make_chunk, usage_dict) -> None:
        chunks = [make_chunk("text with ` random ` backticks")]
        result = list(CotAgentOutputParser.handle_react_stream_output(chunks, usage_dict))
        assert "text with" in "".join(result)

    # --------------------------------------------------------
    # Boundary & edge inputs
    # --------------------------------------------------------

    @pytest.mark.parametrize(
        "content",
        [
            "```",
            "{",
            "}",
            "```json",
            "action:",
            "thought:",
            "   ",
        ],
    )
    def test_edge_inputs(self, make_chunk, usage_dict, content) -> None:
        chunks = [make_chunk(content)]
        result = list(CotAgentOutputParser.handle_react_stream_output(chunks, usage_dict))
        assert all(isinstance(item, str) for item in result)
        joined = "".join(result)
        if content == "   ":
            assert result == [] or joined == content
        if content in {"```", "{", "}", "```json"}:
            assert content in joined
        if content.lower() in {"action:", "thought:"}:
            assert "action:" not in joined.lower()
            assert "thought:" not in joined.lower()

    # --------------------------------------------------------
    # Malformed action payloads (issue #45200)
    # --------------------------------------------------------

    def test_multi_item_json_list_is_not_an_action(self, make_chunk, usage_dict) -> None:
        # A JSON list with more than one item is not a single action. The
        # direct answer it carries must reach the user as text instead of
        # raising AttributeError ('list' object has no attribute 'items').
        content = '```json\n[{"name": "a"}, {"name": "b"}]\n```'
        chunks = [make_chunk(content)]
        result = list(CotAgentOutputParser.handle_react_stream_output(chunks, usage_dict))
        assert all(isinstance(item, str) for item in result)
        assert json.loads("".join(result)) == [{"name": "a"}, {"name": "b"}]

    @pytest.mark.parametrize("payload", ["[]", "[1]"])
    def test_non_object_json_list_is_not_an_action(self, make_chunk, usage_dict, payload) -> None:
        # An empty or non-object list used to raise AttributeError
        # ('int' object has no attribute 'items'); it is plain text now.
        content = f"```json\n{payload}\n```"
        chunks = [make_chunk(content)]
        result = list(CotAgentOutputParser.handle_react_stream_output(chunks, usage_dict))
        assert all(isinstance(item, str) for item in result)
        assert json.loads("".join(result)) == json.loads(payload)

    def test_multi_action_list_runs_first_action(self, make_chunk, usage_dict) -> None:
        # The prompt allows exactly one action per turn: a list of actions
        # runs the first one instead of crashing or running all of them.
        content = '```json\n[{"action": "search", "input": "q1"}, {"action": "lookup", "input": "q2"}]\n```'
        chunks = [make_chunk(content)]
        result = list(CotAgentOutputParser.handle_react_stream_output(chunks, usage_dict))
        assert [item for item in result if isinstance(item, AgentScratchpadUnit.Action)] == [
            AgentScratchpadUnit.Action(action_name="search", action_input="q1")
        ]

    def test_non_string_action_name_is_text(self, make_chunk, usage_dict) -> None:
        # A non-string action name used to raise a pydantic ValidationError
        # from AgentScratchpadUnit.Action; it is treated as text now.
        content = '{"action": ["search"], "action_input": {"q": "x"}}'
        chunks = [make_chunk(content)]
        result = list(CotAgentOutputParser.handle_react_stream_output(chunks, usage_dict))
        assert all(isinstance(item, str) for item in result)
        assert json.loads("".join(result)) == {"action": ["search"], "action_input": {"q": "x"}}

    def test_extra_field_after_action_does_not_override_tool(self, make_chunk, usage_dict) -> None:
        # Extra fields after the action used to override the tool name (the
        # last non-input key won, so a trailing "reason" became the action).
        content = '{"action": "search", "action_input": {"q": "x"}, "reason": "need data"}'
        chunks = [make_chunk(content)]
        result = list(CotAgentOutputParser.handle_react_stream_output(chunks, usage_dict))
        assert result == [AgentScratchpadUnit.Action(action_name="search", action_input={"q": "x"})]

    def test_non_action_json_preserves_non_ascii(self, make_chunk, usage_dict) -> None:
        # json.dumps defaults escaped non-ASCII to \uXXXX sequences; keep the
        # model's text as-is when a payload is not an action.
        content = '{"foo": "中文"}'
        chunks = [make_chunk(content)]
        result = list(CotAgentOutputParser.handle_react_stream_output(chunks, usage_dict))
        assert result == ['{"foo": "中文"}']

    @pytest.mark.parametrize(
        "action_input",
        [[1, 2], 5],
    )
    def test_wrong_typed_action_input_is_text(self, make_chunk, usage_dict, action_input) -> None:
        # A non-dict/str action input used to raise a pydantic ValidationError
        # from AgentScratchpadUnit.Action; it is treated as text now.
        payload = {"action": "search", "action_input": action_input}
        content = json.dumps(payload)
        chunks = [make_chunk(content)]
        result = list(CotAgentOutputParser.handle_react_stream_output(chunks, usage_dict))
        assert all(isinstance(item, str) for item in result)
        assert json.loads("".join(result)) == payload
