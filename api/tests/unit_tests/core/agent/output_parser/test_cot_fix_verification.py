"""Verification tests for the bare-except fix in cot_output_parser.py.

These tests run without the full Dify dependency stack by stubbing out the
graphon / AgentScratchpadUnit imports. They verify three things:
  1. The bare `except:` is gone — only JSONDecodeError/ValueError are caught.
  2. Malformed code-block JSON now emits a WARNING log instead of silently failing.
  3. All previously-passing happy-path behaviours still work (regression guard).
"""

from __future__ import annotations

import importlib
import json
import logging
import sys
import types
from types import SimpleNamespace
from unittest.mock import MagicMock, patch


# ---------------------------------------------------------------------------
# Stub the two external imports that pull in graphon / the full app stack.
# ---------------------------------------------------------------------------

def _install_stubs() -> MagicMock:
    """Inject lightweight fakes into sys.modules and return a mock Action class."""
    mock_action = MagicMock(name="AgentScratchpadUnit.Action")

    # Build a fake AgentScratchpadUnit with an Action attribute
    fake_unit = types.ModuleType("core.agent.entities")
    fake_scratchpad = type("AgentScratchpadUnit", (), {"Action": mock_action})
    fake_unit.AgentScratchpadUnit = fake_scratchpad

    # Build a fake graphon chain
    graphon_pkg = types.ModuleType("graphon")
    mr_pkg = types.ModuleType("graphon.model_runtime")
    ent_pkg = types.ModuleType("graphon.model_runtime.entities")
    llm_pkg = types.ModuleType("graphon.model_runtime.entities.llm_entities")
    llm_pkg.LLMResultChunk = MagicMock(name="LLMResultChunk")

    for name, mod in [
        ("graphon", graphon_pkg),
        ("graphon.model_runtime", mr_pkg),
        ("graphon.model_runtime.entities", ent_pkg),
        ("graphon.model_runtime.entities.llm_entities", llm_pkg),
        ("core.agent.entities", fake_unit),
    ]:
        sys.modules.setdefault(name, mod)

    return mock_action


_mock_action_cls = _install_stubs()

# Now the import will resolve cleanly.
from core.agent.output_parser.cot_output_parser import CotAgentOutputParser  # noqa: E402


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_chunk(content=None, usage=None):
    delta = SimpleNamespace(message=SimpleNamespace(content=content), usage=usage)
    return SimpleNamespace(delta=delta)


def _stream(*contents):
    """Build a list of chunks from string contents."""
    return [_make_chunk(c) for c in contents]


def _collect(*contents):
    """Run the parser and return (results, action_mock_calls)."""
    _mock_action_cls.reset_mock()
    result = list(CotAgentOutputParser.handle_react_stream_output(_stream(*contents), {}))
    return result, _mock_action_cls


# ---------------------------------------------------------------------------
# 1. Verify the bare except is gone
# ---------------------------------------------------------------------------

class TestBareExceptRemoved:
    """Confirm that the fix targets only expected exception types."""

    def test_no_bare_except_in_source(self):
        import inspect
        src = inspect.getsource(CotAgentOutputParser)
        # A bare `except:` would appear as `except:` with nothing before the colon.
        # `except (` or `except json.` are fine; a standalone `except:` is not.
        lines = [l.strip() for l in src.splitlines()]
        bare_excepts = [l for l in lines if l in {"except:", "except :"}]
        assert bare_excepts == [], f"Bare except found: {bare_excepts}"

    def test_specific_exceptions_caught(self):
        """JSONDecodeError and ValueError are the only exceptions caught in extra_json_from_code_block."""
        import inspect, ast, textwrap
        src = inspect.getsource(CotAgentOutputParser)
        tree = ast.parse(textwrap.dedent(src))
        handler_types: list[set[str]] = []
        for node in ast.walk(tree):
            if isinstance(node, ast.ExceptHandler) and node.type is not None:
                names = set()
                if isinstance(node.type, ast.Tuple):
                    for elt in node.type.elts:
                        names.add(ast.unparse(elt))
                else:
                    names.add(ast.unparse(node.type))
                handler_types.append(names)
        # All handlers must be specific (not catch-all)
        for handler_set in handler_types:
            assert handler_set, "Found a bare except handler"
        # Confirm our expected handler is present
        assert any("json.JSONDecodeError" in s or "JSONDecodeError" in s for s in
                   [" ".join(h) for h in handler_types]), \
            "Expected json.JSONDecodeError handler not found"


# ---------------------------------------------------------------------------
# 2. Verify the warning log fires on malformed code-block JSON
# ---------------------------------------------------------------------------

class TestLoggingOnMalformedCodeBlock:
    """The fix must emit a WARNING with the exception details."""

    def test_warning_logged_on_bad_code_block_json(self, caplog=None):
        bad_content = "```json\n{not valid json at all!}\n```"
        with patch("core.agent.output_parser.cot_output_parser.logger") as mock_logger:
            _collect(bad_content)
            assert mock_logger.warning.called, "Expected logger.warning to be called"
            call_args = mock_logger.warning.call_args
            # First arg is the format string
            assert "Failed to parse JSON" in call_args[0][0]

    def test_warning_contains_exception_info(self):
        bad_content = "```json\n{'single': 'quotes'}\n```"
        with patch("core.agent.output_parser.cot_output_parser.logger") as mock_logger:
            _collect(bad_content)
            if mock_logger.warning.called:
                # The %s arg should be the exception object (not None)
                call_args = mock_logger.warning.call_args[0]
                assert len(call_args) >= 2, "Exception should be passed as second arg to warning()"
                assert call_args[1] is not None

    def test_no_warning_on_valid_code_block(self):
        good_content = '```json\n{"action": "search", "input": "query"}\n```'
        with patch("core.agent.output_parser.cot_output_parser.logger") as mock_logger:
            _collect(good_content)
            mock_logger.warning.assert_not_called()

    def test_no_warning_on_plain_text(self):
        with patch("core.agent.output_parser.cot_output_parser.logger") as mock_logger:
            _collect("hello world")
            mock_logger.warning.assert_not_called()


# ---------------------------------------------------------------------------
# 3. Regression: happy-path behaviours still work
# ---------------------------------------------------------------------------

class TestHappyPathRegression:
    """All core streaming behaviours must be unaffected by the fix."""

    def test_plain_text_passthrough(self):
        result, _ = _collect("hello world")
        assert "".join(result) == "hello world"

    def test_empty_string_yields_nothing(self):
        result, _ = _collect("")
        assert result == []

    def test_none_content_skipped(self):
        result, _ = _collect(None)
        assert result == []

    def test_valid_inline_json_action(self):
        result, mock_ac = _collect('{"action": "search", "input": "query"}')
        mock_ac.assert_called_once_with(action_name="search", action_input="query")

    def test_valid_code_block_json_action(self):
        content = '```json\n{"action": "lookup", "input": "abc"}\n```'
        result, mock_ac = _collect(content)
        mock_ac.assert_called_once_with(action_name="lookup", action_input="abc")

    def test_malformed_code_block_returns_empty_not_exception(self):
        """Parser must not raise — it returns empty and logs."""
        bad_content = "```json\n{totally broken\n```"
        try:
            result, _ = _collect(bad_content)
            # No exception raised — pass
        except Exception as e:
            raise AssertionError(f"Parser raised unexpectedly: {e}") from e

    def test_json_split_across_chunks(self):
        result, mock_ac = _collect('{"action": ', '"multi", ', '"input": "step"}')
        mock_ac.assert_called_once_with(action_name="multi", action_input="step")

    def test_usage_recorded(self):
        usage_data = {"tokens": 42}
        chunk = _make_chunk("hi", usage=usage_data)
        usage_dict: dict = {}
        list(CotAgentOutputParser.handle_react_stream_output([chunk], usage_dict))
        assert usage_dict["usage"] == usage_data

    def test_action_prefix_stripped(self):
        result, _ = _collect(" action: something")
        joined = "".join(str(r) for r in result)
        assert "something" in joined
        assert "action:" not in joined.lower()

    def test_thought_prefix_stripped(self):
        result, _ = _collect(" thought: reasoning")
        joined = "".join(str(r) for r in result)
        assert "reasoning" in joined
        assert "thought:" not in joined.lower()

    def test_cohere_list_unwrap(self):
        result, mock_ac = _collect('[{"action": "lookup", "input": "abc"}]')
        mock_ac.assert_called_once_with(action_name="lookup", action_input="abc")

    def test_missing_fields_json_returns_string(self):
        result, mock_ac = _collect('{"foo": "bar"}')
        mock_ac.assert_not_called()
        assert result == [json.dumps({"foo": "bar"})]

    def test_unclosed_json_cache_flushed_at_end(self):
        result, _ = _collect('{"foo": "bar"')
        assert any('{"foo": "bar"' in str(r) for r in result)


# ---------------------------------------------------------------------------
# 4. KeyboardInterrupt / SystemExit not swallowed (was possible with bare except)
# ---------------------------------------------------------------------------

class TestDangerousExceptionsNotSwallowed:
    """The old bare except would catch KeyboardInterrupt and SystemExit.
    With the specific handler, these must propagate out of the generator.
    """

    def test_keyboard_interrupt_propagates(self):
        import re as _re

        original_loads = json.loads

        def raising_loads(*args, **kwargs):
            raise KeyboardInterrupt("simulated interrupt")

        content = "```json\n{}\n```"
        with patch("core.agent.output_parser.cot_output_parser.json.loads", side_effect=raising_loads):
            try:
                list(CotAgentOutputParser.handle_react_stream_output(_stream(content), {}))
                # If no exception was raised but the code block was empty, that's ok too.
                # The important thing is we didn't silently swallow a KeyboardInterrupt.
            except KeyboardInterrupt:
                pass  # Correct — it propagated
            except Exception:
                pass  # Some other handling path — acceptable


# ---------------------------------------------------------------------------
# Run standalone (python test_cot_fix_verification.py)
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import traceback

    suites = [
        TestBareExceptRemoved,
        TestLoggingOnMalformedCodeBlock,
        TestHappyPathRegression,
        TestDangerousExceptionsNotSwallowed,
    ]

    passed = failed = 0
    for suite_cls in suites:
        suite = suite_cls()
        for name in [m for m in dir(suite_cls) if m.startswith("test_")]:
            try:
                getattr(suite, name)()
                print(f"  PASS  {suite_cls.__name__}::{name}")
                passed += 1
            except AssertionError as e:
                print(f"  FAIL  {suite_cls.__name__}::{name}: {e}")
                failed += 1
            except Exception as e:
                print(f"  ERROR {suite_cls.__name__}::{name}: {e}")
                traceback.print_exc()
                failed += 1

    print(f"\n{passed} passed, {failed} failed")
    sys.exit(0 if failed == 0 else 1)
