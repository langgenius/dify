import json
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from core.agent.output_parser.cot_output_parser import CotAgentOutputParser

# ============================================================
# Fixtures
# ============================================================


@pytest.fixture
def mock_action_class(mocker):
    mock_action = MagicMock()
    mocker.patch(
        "core.agent.output_parser.cot_output_parser.AgentScratchpadUnit.Action",
        mock_action,
    )
    return mock_action


@pytest.fixture
def usage_dict():
    return {}


@pytest.fixture
def make_chunk():
    def _make_chunk(content=None, usage=None):
        delta = SimpleNamespace(
            message=SimpleNamespace(content=content),
            usage=usage,
        )
        return SimpleNamespace(delta=delta)

    return _make_chunk


# ============================================================
# Test Suite
# ============================================================


class TestCotAgentOutputParser:
    # --------------------------------------------------------
    # Basic streaming & usage
    # --------------------------------------------------------

    def test_stream_plain_text(self, make_chunk, usage_dict):
        chunks = [make_chunk("hello world")]
        result = list(CotAgentOutputParser.handle_react_stream_output(chunks, usage_dict))
        assert "".join(result) == "hello world"

    def test_stream_empty_string(self, make_chunk, usage_dict):
        chunks = [make_chunk("")]
        result = list(CotAgentOutputParser.handle_react_stream_output(chunks, usage_dict))
        assert result == []

    def test_stream_none_content(self, make_chunk, usage_dict):
        chunks = [make_chunk(None)]
        result = list(CotAgentOutputParser.handle_react_stream_output(chunks, usage_dict))
        assert result == []

    @pytest.mark.parametrize("content", [123, 12.5, [], {}, object()])
    def test_non_string_content(self, make_chunk, usage_dict, content):
        chunks = [make_chunk(content)]
        result = list(CotAgentOutputParser.handle_react_stream_output(chunks, usage_dict))
        assert result == []

    def test_usage_update(self, make_chunk, usage_dict):
        usage_data = {"tokens": 99}
        chunks = [make_chunk("abc", usage=usage_data)]
        list(CotAgentOutputParser.handle_react_stream_output(chunks, usage_dict))
        assert usage_dict["usage"] == usage_data

    # --------------------------------------------------------
    # JSON parsing (direct + streaming)
    # --------------------------------------------------------

    def test_single_json_action_valid(self, make_chunk, usage_dict, mock_action_class):
        content = '{"action": "search", "input": "query"}'
        chunks = [make_chunk(content)]
        list(CotAgentOutputParser.handle_react_stream_output(chunks, usage_dict))
        mock_action_class.assert_called_once_with(action_name="search", action_input="query")

    def test_json_list_unwrap(self, make_chunk, usage_dict, mock_action_class):
        content = '[{"action": "lookup", "input": "abc"}]'
        chunks = [make_chunk(content)]
        list(CotAgentOutputParser.handle_react_stream_output(chunks, usage_dict))
        mock_action_class.assert_called_once_with(action_name="lookup", action_input="abc")

    def test_json_missing_fields_returns_string(self, make_chunk, usage_dict):
        content = '{"foo": "bar"}'
        chunks = [make_chunk(content)]
        result = list(CotAgentOutputParser.handle_react_stream_output(chunks, usage_dict))
        assert json.dumps({"foo": "bar"}) in result

    def test_invalid_json_string_input(self, make_chunk, usage_dict):
        content = "{invalid json}"
        chunks = [make_chunk(content)]
        result = list(CotAgentOutputParser.handle_react_stream_output(chunks, usage_dict))
        assert any("invalid json" in str(r) for r in result)

    def test_json_split_across_chunks(self, make_chunk, usage_dict, mock_action_class):
        chunks = [
            make_chunk('{"action": '),
            make_chunk('"multi", '),
            make_chunk('"input": "step"}'),
        ]
        list(CotAgentOutputParser.handle_react_stream_output(chunks, usage_dict))
        mock_action_class.assert_called_once_with(action_name="multi", action_input="step")

    def test_unclosed_json_at_end(self, make_chunk, usage_dict):
        chunks = [make_chunk('{"foo": "bar"')]
        result = list(CotAgentOutputParser.handle_react_stream_output(chunks, usage_dict))
        assert result

    # --------------------------------------------------------
    # Code block JSON extraction
    # --------------------------------------------------------

    def test_code_block_json_valid(self, make_chunk, usage_dict, mock_action_class):
        content = """```json
{"action": "lookup", "input": "abc"}
```"""
        chunks = [make_chunk(content)]
        list(CotAgentOutputParser.handle_react_stream_output(chunks, usage_dict))
        mock_action_class.assert_called_once_with(action_name="lookup", action_input="abc")

    def test_code_block_multiple_json(self, make_chunk, usage_dict, mock_action_class):
        # Multiple JSON objects inside single code fence (invalid combined JSON)
        # Parser should safely ignore invalid combined block
        content = """```json
{"action": "a1", "input": "x"}
{"action": "a2", "input": "y"}
```"""
        chunks = [make_chunk(content)]
        result = list(CotAgentOutputParser.handle_react_stream_output(chunks, usage_dict))
        # No valid parsed action expected due to invalid combined JSON
        assert mock_action_class.call_count == 0
        assert isinstance(result, list)

    def test_code_block_invalid_json(self, make_chunk, usage_dict):
        content = """```json
{invalid}
```"""
        chunks = [make_chunk(content)]
        result = list(CotAgentOutputParser.handle_react_stream_output(chunks, usage_dict))
        assert result

    def test_unclosed_code_block(self, make_chunk, usage_dict):
        chunks = [make_chunk('```json {"a":1}')]
        result = list(CotAgentOutputParser.handle_react_stream_output(chunks, usage_dict))
        assert result

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
    def test_prefix_handling(self, make_chunk, usage_dict, content):
        chunks = [make_chunk(content)]
        result = list(CotAgentOutputParser.handle_react_stream_output(chunks, usage_dict))
        # Ensure parser does not crash and returns iterable output
        assert isinstance(result, list)

    def test_prefix_mid_word_yield_delta_branch(self, make_chunk, usage_dict):
        chunks = [make_chunk("xaction: test")]
        result = list(CotAgentOutputParser.handle_react_stream_output(chunks, usage_dict))
        assert "x" in "".join(map(str, result))

    # --------------------------------------------------------
    # Mixed streaming scenarios
    # --------------------------------------------------------

    def test_text_json_text_mix(self, make_chunk, usage_dict, mock_action_class):
        content = 'start {"action": "mix", "input": "1"} end'
        chunks = [make_chunk(content)]
        result = list(CotAgentOutputParser.handle_react_stream_output(chunks, usage_dict))
        # JSON action should be parsed
        mock_action_class.assert_called_once()
        # Ensure surrounding text is streamed (character-level)
        joined = "".join(str(r) for r in result if not isinstance(r, MagicMock))
        assert "start" in joined or "end" in joined

    def test_multiple_code_blocks_in_stream(self, make_chunk, usage_dict, mock_action_class):
        content = '```json\n{"action":"a1","input":"x"}\n```middle```json\n{"action":"a2","input":"y"}\n```'
        chunks = [make_chunk(content)]
        list(CotAgentOutputParser.handle_react_stream_output(chunks, usage_dict))
        assert mock_action_class.call_count == 2

    def test_backtick_noise(self, make_chunk, usage_dict):
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
    def test_edge_inputs(self, make_chunk, usage_dict, content):
        chunks = [make_chunk(content)]
        result = list(CotAgentOutputParser.handle_react_stream_output(chunks, usage_dict))
        assert isinstance(result, list)
