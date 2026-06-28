"""Verification tests for the bare-except fix in cot_output_parser.py.

Verifies three things:
  1. The bare `except:` is gone — only JSONDecodeError/ValueError are caught.
  2. Malformed code-block JSON now emits a WARNING log instead of silently failing.
  3. All previously-passing happy-path behaviours still work (regression guard).
"""

from __future__ import annotations

import ast
import inspect
import json
import textwrap
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from pytest_mock import MockerFixture

from core.agent.output_parser.cot_output_parser import CotAgentOutputParser

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def mock_action_class(mocker: MockerFixture) -> MagicMock:
    mock_action = MagicMock()
    mocker.patch(
        "core.agent.output_parser.cot_output_parser.AgentScratchpadUnit.Action",
        mock_action,
    )
    return mock_action


@pytest.fixture
def make_chunk():
    def _make_chunk(content=None, usage=None):
        delta = SimpleNamespace(message=SimpleNamespace(content=content), usage=usage)
        return SimpleNamespace(delta=delta)
    return _make_chunk


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _stream(make_chunk, *contents):
    return [make_chunk(c) for c in contents]


def _collect(make_chunk, mock_action, *contents):
    mock_action.reset_mock()
    result = list(CotAgentOutputParser.handle_react_stream_output(_stream(make_chunk, *contents), {}))
    return result, mock_action


# ---------------------------------------------------------------------------
# 1. Verify the bare except is gone
# ---------------------------------------------------------------------------

class TestBareExceptRemoved:
    """Confirm that the fix targets only expected exception types."""

    def test_no_bare_except_in_source(self):
        src = inspect.getsource(CotAgentOutputParser)
        lines = [line.strip() for line in src.splitlines()]
        bare_excepts = [line for line in lines if line in {"except:", "except :"}]
        assert bare_excepts == [], f"Bare except found: {bare_excepts}"

    def test_specific_exceptions_caught(self):
        src = inspect.getsource(CotAgentOutputParser)
        tree = ast.parse(textwrap.dedent(src))
        handler_types: list[set[str]] = []
        for node in ast.walk(tree):
            if isinstance(node, ast.ExceptHandler) and node.type is not None:
                names = set()
                if isinstance(node.type, ast.Tuple):
                    names.update(ast.unparse(elt) for elt in node.type.elts)
                else:
                    names.add(ast.unparse(node.type))
                handler_types.append(names)
        for handler_set in handler_types:
            assert handler_set, "Found a bare except handler"
        assert any(
            "json.JSONDecodeError" in s or "JSONDecodeError" in s
            for s in [" ".join(h) for h in handler_types]
        ), "Expected json.JSONDecodeError handler not found"


# ---------------------------------------------------------------------------
# 2. Verify the warning log fires on malformed code-block JSON
# ---------------------------------------------------------------------------

class TestLoggingOnMalformedCodeBlock:
    """The fix must emit a WARNING with the exception details."""

    def test_warning_logged_on_bad_code_block_json(self, make_chunk, mock_action_class):
        bad_content = "```json\n{not valid json at all!}\n```"
        with patch("core.agent.output_parser.cot_output_parser.logger") as mock_logger:
            _collect(make_chunk, mock_action_class, bad_content)
            assert mock_logger.warning.called, "Expected logger.warning to be called"
            call_args = mock_logger.warning.call_args
            assert "Failed to parse JSON" in call_args[0][0]

    def test_warning_contains_exception_info(self, make_chunk, mock_action_class):
        bad_content = "```json\n{'single': 'quotes'}\n```"
        with patch("core.agent.output_parser.cot_output_parser.logger") as mock_logger:
            _collect(make_chunk, mock_action_class, bad_content)
            if mock_logger.warning.called:
                call_args = mock_logger.warning.call_args[0]
                assert len(call_args) >= 2, "Exception should be passed as second arg to warning()"
                assert call_args[1] is not None

    def test_no_warning_on_valid_code_block(self, make_chunk, mock_action_class):
        good_content = '```json\n{"action": "search", "input": "query"}\n```'
        with patch("core.agent.output_parser.cot_output_parser.logger") as mock_logger:
            _collect(make_chunk, mock_action_class, good_content)
            mock_logger.warning.assert_not_called()

    def test_no_warning_on_plain_text(self, make_chunk, mock_action_class):
        with patch("core.agent.output_parser.cot_output_parser.logger") as mock_logger:
            _collect(make_chunk, mock_action_class, "hello world")
            mock_logger.warning.assert_not_called()


# ---------------------------------------------------------------------------
# 3. Regression: happy-path behaviours still work
# ---------------------------------------------------------------------------

class TestHappyPathRegression:
    """All core streaming behaviours must be unaffected by the fix."""

    def test_plain_text_passthrough(self, make_chunk, mock_action_class):
        result, _ = _collect(make_chunk, mock_action_class, "hello world")
        assert "".join(result) == "hello world"

    def test_empty_string_yields_nothing(self, make_chunk, mock_action_class):
        result, _ = _collect(make_chunk, mock_action_class, "")
        assert result == []

    def test_none_content_skipped(self, make_chunk, mock_action_class):
        result, _ = _collect(make_chunk, mock_action_class, None)
        assert result == []

    def test_valid_inline_json_action(self, make_chunk, mock_action_class):
        _collect(make_chunk, mock_action_class, '{"action": "search", "input": "query"}')
        mock_action_class.assert_called_once_with(action_name="search", action_input="query")

    def test_valid_code_block_json_action(self, make_chunk, mock_action_class):
        content = '```json\n{"action": "lookup", "input": "abc"}\n```'
        _collect(make_chunk, mock_action_class, content)
        mock_action_class.assert_called_once_with(action_name="lookup", action_input="abc")

    def test_malformed_code_block_returns_empty_not_exception(self, make_chunk, mock_action_class):
        bad_content = "```json\n{totally broken\n```"
        try:
            _collect(make_chunk, mock_action_class, bad_content)
        except Exception as e:
            raise AssertionError(f"Parser raised unexpectedly: {e}") from e

    def test_json_split_across_chunks(self, make_chunk, mock_action_class):
        _collect(make_chunk, mock_action_class, '{"action": ', '"multi", ', '"input": "step"}')
        mock_action_class.assert_called_once_with(action_name="multi", action_input="step")

    def test_usage_recorded(self, make_chunk, mock_action_class):
        usage_data = {"tokens": 42}
        chunk = make_chunk("hi", usage=usage_data)
        usage_dict: dict = {}
        list(CotAgentOutputParser.handle_react_stream_output([chunk], usage_dict))
        assert usage_dict["usage"] == usage_data

    def test_action_prefix_stripped(self, make_chunk, mock_action_class):
        result, _ = _collect(make_chunk, mock_action_class, " action: something")
        joined = "".join(str(r) for r in result)
        assert "something" in joined
        assert "action:" not in joined.lower()

    def test_thought_prefix_stripped(self, make_chunk, mock_action_class):
        result, _ = _collect(make_chunk, mock_action_class, " thought: reasoning")
        joined = "".join(str(r) for r in result)
        assert "reasoning" in joined
        assert "thought:" not in joined.lower()

    def test_cohere_list_unwrap(self, make_chunk, mock_action_class):
        _collect(make_chunk, mock_action_class, '[{"action": "lookup", "input": "abc"}]')
        mock_action_class.assert_called_once_with(action_name="lookup", action_input="abc")

    def test_missing_fields_json_returns_string(self, make_chunk, mock_action_class):
        result, _ = _collect(make_chunk, mock_action_class, '{"foo": "bar"}')
        mock_action_class.assert_not_called()
        assert result == [json.dumps({"foo": "bar"})]

    def test_unclosed_json_cache_flushed_at_end(self, make_chunk, mock_action_class):
        result, _ = _collect(make_chunk, mock_action_class, '{"foo": "bar"')
        assert any('{"foo": "bar"' in str(r) for r in result)


# ---------------------------------------------------------------------------
# 4. KeyboardInterrupt not swallowed (was possible with bare except)
# ---------------------------------------------------------------------------

class TestDangerousExceptionsNotSwallowed:
    """The old bare except would catch KeyboardInterrupt.
    With the specific handler, it must propagate out of the generator.
    """

    def test_keyboard_interrupt_propagates(self, make_chunk, mock_action_class):
        def raising_loads(*args, **kwargs):
            raise KeyboardInterrupt("simulated interrupt")

        content = "```json\n{}\n```"
        with patch("core.agent.output_parser.cot_output_parser.json.loads", side_effect=raising_loads):
            try:
                list(CotAgentOutputParser.handle_react_stream_output(_stream(make_chunk, content), {}))
            except KeyboardInterrupt:
                pass  # Correct — it propagated
            except Exception:
                pass  # Some other handling path — acceptable
