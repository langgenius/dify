"""
Comprehensive unit tests for core/model_runtime/callbacks/logging_callback.py

Coverage targets:
  - LoggingCallback.on_before_invoke  (all branches: stop, tools, user, stream,
                                       prompt_message.name, model_parameters)
  - LoggingCallback.on_new_chunk      (writes to stdout)
  - LoggingCallback.on_after_invoke   (all branches: tool_calls present / absent)
  - LoggingCallback.on_invoke_error   (logs exception via logger.exception)
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from decimal import Decimal
from unittest.mock import MagicMock, patch

import pytest

from dify_graph.model_runtime.callbacks.logging_callback import LoggingCallback
from dify_graph.model_runtime.entities.llm_entities import (
    LLMResult,
    LLMResultChunk,
    LLMResultChunkDelta,
    LLMUsage,
)
from dify_graph.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    PromptMessageTool,
    SystemPromptMessage,
    UserPromptMessage,
)

# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------


def _make_usage() -> LLMUsage:
    """Return a minimal LLMUsage instance."""
    return LLMUsage(
        prompt_tokens=10,
        prompt_unit_price=Decimal("0.001"),
        prompt_price_unit=Decimal("0.001"),
        prompt_price=Decimal("0.01"),
        completion_tokens=20,
        completion_unit_price=Decimal("0.002"),
        completion_price_unit=Decimal("0.002"),
        completion_price=Decimal("0.04"),
        total_tokens=30,
        total_price=Decimal("0.05"),
        currency="USD",
        latency=0.5,
    )


def _make_llm_result(
    content: str = "hello world",
    tool_calls: list | None = None,
    model: str = "gpt-4",
    system_fingerprint: str | None = "fp-abc",
) -> LLMResult:
    """Return an LLMResult with an AssistantPromptMessage."""
    assistant_msg = AssistantPromptMessage(
        content=content,
        tool_calls=tool_calls or [],
    )
    return LLMResult(
        model=model,
        message=assistant_msg,
        usage=_make_usage(),
        system_fingerprint=system_fingerprint,
    )


def _make_chunk(content: str = "chunk-text") -> LLMResultChunk:
    """Return a minimal LLMResultChunk."""
    return LLMResultChunk(
        model="gpt-4",
        delta=LLMResultChunkDelta(
            index=0,
            message=AssistantPromptMessage(content=content),
        ),
    )


def _make_user_prompt(content: str = "Hello!", name: str | None = None) -> UserPromptMessage:
    return UserPromptMessage(content=content, name=name)


def _make_system_prompt(content: str = "You are helpful.") -> SystemPromptMessage:
    return SystemPromptMessage(content=content)


def _make_tool(name: str = "my_tool") -> PromptMessageTool:
    return PromptMessageTool(name=name, description="A tool", parameters={})


def _make_tool_call(
    call_id: str = "call-1",
    func_name: str = "some_func",
    arguments: str = '{"key": "value"}',
) -> AssistantPromptMessage.ToolCall:
    return AssistantPromptMessage.ToolCall(
        id=call_id,
        type="function",
        function=AssistantPromptMessage.ToolCall.ToolCallFunction(name=func_name, arguments=arguments),
    )


# ---------------------------------------------------------------------------
# Fixture: shared LoggingCallback instance (no heavy state)
# ---------------------------------------------------------------------------


@pytest.fixture
def cb() -> LoggingCallback:
    return LoggingCallback()


@pytest.fixture
def llm_instance() -> MagicMock:
    return MagicMock()


# ===========================================================================
# Tests for on_before_invoke
# ===========================================================================


class TestOnBeforeInvoke:
    """Tests for LoggingCallback.on_before_invoke."""

    def _invoke(
        self,
        cb: LoggingCallback,
        llm_instance: MagicMock,
        *,
        model: str = "gpt-4",
        credentials: dict | None = None,
        prompt_messages: list | None = None,
        model_parameters: dict | None = None,
        tools: list[PromptMessageTool] | None = None,
        stop: Sequence[str] | None = None,
        stream: bool = True,
        user: str | None = None,
    ):
        cb.on_before_invoke(
            llm_instance=llm_instance,
            model=model,
            credentials=credentials or {},
            prompt_messages=prompt_messages or [],
            model_parameters=model_parameters or {},
            tools=tools,
            stop=stop,
            stream=stream,
            user=user,
        )

    def test_minimal_call_does_not_raise(self, cb: LoggingCallback, llm_instance: MagicMock):
        """Calling with bare-minimum args should not raise."""
        self._invoke(cb, llm_instance)

    def test_model_name_printed(self, cb: LoggingCallback, llm_instance: MagicMock):
        """The model name must appear in print_text calls."""
        with patch.object(cb, "print_text") as mock_print:
            self._invoke(cb, llm_instance, model="claude-3")
        calls_text = " ".join(str(c) for c in mock_print.call_args_list)
        assert "claude-3" in calls_text

    def test_model_parameters_printed(self, cb: LoggingCallback, llm_instance: MagicMock):
        """Each key-value pair of model_parameters must be printed."""
        params = {"temperature": 0.7, "max_tokens": 512}
        with patch.object(cb, "print_text") as mock_print:
            self._invoke(cb, llm_instance, model_parameters=params)
        calls_text = " ".join(str(c) for c in mock_print.call_args_list)
        assert "temperature" in calls_text
        assert "0.7" in calls_text
        assert "max_tokens" in calls_text
        assert "512" in calls_text

    def test_empty_model_parameters(self, cb: LoggingCallback, llm_instance: MagicMock):
        """Empty model_parameters dict should not raise."""
        self._invoke(cb, llm_instance, model_parameters={})

    # ------------------------------------------------------------------
    # stop branch
    # ------------------------------------------------------------------

    def test_stop_branch_printed_when_provided(self, cb: LoggingCallback, llm_instance: MagicMock):
        """stop words must appear in output when provided."""
        with patch.object(cb, "print_text") as mock_print:
            self._invoke(cb, llm_instance, stop=["STOP", "END"])
        calls_text = " ".join(str(c) for c in mock_print.call_args_list)
        assert "stop" in calls_text

    def test_stop_branch_skipped_when_none(self, cb: LoggingCallback, llm_instance: MagicMock):
        """When stop=None the stop line must NOT appear."""
        with patch.object(cb, "print_text") as mock_print:
            self._invoke(cb, llm_instance, stop=None)
        calls_text = " ".join(str(c) for c in mock_print.call_args_list)
        assert "\tstop:" not in calls_text

    def test_stop_branch_skipped_when_empty_list(self, cb: LoggingCallback, llm_instance: MagicMock):
        """When stop=[] (falsy) the stop line must NOT appear."""
        with patch.object(cb, "print_text") as mock_print:
            self._invoke(cb, llm_instance, stop=[])
        calls_text = " ".join(str(c) for c in mock_print.call_args_list)
        assert "\tstop:" not in calls_text

    # ------------------------------------------------------------------
    # tools branch
    # ------------------------------------------------------------------

    def test_tools_branch_printed_when_provided(self, cb: LoggingCallback, llm_instance: MagicMock):
        """Tool names must appear in output when tools are provided."""
        tools = [_make_tool("search"), _make_tool("calculate")]
        with patch.object(cb, "print_text") as mock_print:
            self._invoke(cb, llm_instance, tools=tools)
        calls_text = " ".join(str(c) for c in mock_print.call_args_list)
        assert "search" in calls_text
        assert "calculate" in calls_text

    def test_tools_branch_skipped_when_none(self, cb: LoggingCallback, llm_instance: MagicMock):
        """When tools=None the Tools section must NOT appear."""
        with patch.object(cb, "print_text") as mock_print:
            self._invoke(cb, llm_instance, tools=None)
        calls_text = " ".join(str(c) for c in mock_print.call_args_list)
        assert "Tools:" not in calls_text

    def test_tools_branch_skipped_when_empty_list(self, cb: LoggingCallback, llm_instance: MagicMock):
        """When tools=[] (falsy) the Tools section must NOT appear."""
        with patch.object(cb, "print_text") as mock_print:
            self._invoke(cb, llm_instance, tools=[])
        calls_text = " ".join(str(c) for c in mock_print.call_args_list)
        assert "Tools:" not in calls_text

    # ------------------------------------------------------------------
    # user branch
    # ------------------------------------------------------------------

    def test_user_printed_when_provided(self, cb: LoggingCallback, llm_instance: MagicMock):
        """User string must appear in output when provided."""
        with patch.object(cb, "print_text") as mock_print:
            self._invoke(cb, llm_instance, user="alice")
        calls_text = " ".join(str(c) for c in mock_print.call_args_list)
        assert "alice" in calls_text

    def test_user_skipped_when_none(self, cb: LoggingCallback, llm_instance: MagicMock):
        """When user=None the User line must NOT appear."""
        with patch.object(cb, "print_text") as mock_print:
            self._invoke(cb, llm_instance, user=None)
        calls_text = " ".join(str(c) for c in mock_print.call_args_list)
        assert "User:" not in calls_text

    # ------------------------------------------------------------------
    # stream branch
    # ------------------------------------------------------------------

    def test_stream_true_prints_new_chunk_header(self, cb: LoggingCallback, llm_instance: MagicMock):
        """When stream=True the [on_llm_new_chunk] marker must be printed."""
        with patch.object(cb, "print_text") as mock_print:
            self._invoke(cb, llm_instance, stream=True)
        calls_text = " ".join(str(c) for c in mock_print.call_args_list)
        assert "[on_llm_new_chunk]" in calls_text

    def test_stream_false_no_new_chunk_header(self, cb: LoggingCallback, llm_instance: MagicMock):
        """When stream=False the [on_llm_new_chunk] marker must NOT appear."""
        with patch.object(cb, "print_text") as mock_print:
            self._invoke(cb, llm_instance, stream=False)
        calls_text = " ".join(str(c) for c in mock_print.call_args_list)
        assert "[on_llm_new_chunk]" not in calls_text

    # ------------------------------------------------------------------
    # prompt_messages branch
    # ------------------------------------------------------------------

    def test_prompt_message_with_name_printed(self, cb: LoggingCallback, llm_instance: MagicMock):
        """When a PromptMessage has a name it must be printed."""
        msg = _make_user_prompt("hi", name="bob")
        with patch.object(cb, "print_text") as mock_print:
            self._invoke(cb, llm_instance, prompt_messages=[msg])
        calls_text = " ".join(str(c) for c in mock_print.call_args_list)
        assert "bob" in calls_text

    def test_prompt_message_without_name_skips_name_line(self, cb: LoggingCallback, llm_instance: MagicMock):
        """When a PromptMessage has no name the name line must NOT appear."""
        msg = _make_user_prompt("hi", name=None)
        with patch.object(cb, "print_text") as mock_print:
            self._invoke(cb, llm_instance, prompt_messages=[msg])
        calls_text = " ".join(str(c) for c in mock_print.call_args_list)
        assert "\tname:" not in calls_text

    def test_prompt_message_role_and_content_printed(self, cb: LoggingCallback, llm_instance: MagicMock):
        """Role and content of each PromptMessage must appear in output."""
        msg = _make_system_prompt("Be concise.")
        with patch.object(cb, "print_text") as mock_print:
            self._invoke(cb, llm_instance, prompt_messages=[msg])
        calls_text = " ".join(str(c) for c in mock_print.call_args_list)
        assert "system" in calls_text
        assert "Be concise." in calls_text

    def test_multiple_prompt_messages_all_printed(self, cb: LoggingCallback, llm_instance: MagicMock):
        """All entries in prompt_messages are iterated and printed."""
        msgs = [
            _make_system_prompt("sys"),
            _make_user_prompt("user msg"),
        ]
        with patch.object(cb, "print_text") as mock_print:
            self._invoke(cb, llm_instance, prompt_messages=msgs)
        calls_text = " ".join(str(c) for c in mock_print.call_args_list)
        assert "sys" in calls_text
        assert "user msg" in calls_text

    # ------------------------------------------------------------------
    # Combination: everything provided
    # ------------------------------------------------------------------

    def test_all_optional_fields_combined(self, cb: LoggingCallback, llm_instance: MagicMock):
        """Supply stop, tools, user, multiple params, named message – no exception."""
        msgs = [_make_user_prompt("question", name="alice")]
        tools = [_make_tool("tool_a")]
        with patch.object(cb, "print_text"):
            self._invoke(
                cb,
                llm_instance,
                model="gpt-3.5",
                model_parameters={"temperature": 1.0, "top_p": 0.9},
                tools=tools,
                stop=["DONE"],
                stream=True,
                user="alice",
                prompt_messages=msgs,
            )


# ===========================================================================
# Tests for on_new_chunk
# ===========================================================================


class TestOnNewChunk:
    """Tests for LoggingCallback.on_new_chunk."""

    def test_chunk_content_written_to_stdout(self, cb: LoggingCallback, llm_instance: MagicMock):
        """on_new_chunk must write the chunk's text content to sys.stdout."""
        chunk = _make_chunk("hello from LLM")
        written = []

        with patch("sys.stdout") as mock_stdout:
            mock_stdout.write.side_effect = written.append
            cb.on_new_chunk(
                llm_instance=llm_instance,
                chunk=chunk,
                model="gpt-4",
                credentials={},
                prompt_messages=[],
                model_parameters={},
            )
            mock_stdout.write.assert_called_once_with("hello from LLM")
            mock_stdout.flush.assert_called_once()

    def test_chunk_content_empty_string(self, cb: LoggingCallback, llm_instance: MagicMock):
        """Works correctly even when the chunk content is an empty string."""
        chunk = _make_chunk("")
        with patch("sys.stdout") as mock_stdout:
            cb.on_new_chunk(
                llm_instance=llm_instance,
                chunk=chunk,
                model="gpt-4",
                credentials={},
                prompt_messages=[],
                model_parameters={},
            )
            mock_stdout.write.assert_called_once_with("")
            mock_stdout.flush.assert_called_once()

    def test_chunk_passes_all_optional_params(self, cb: LoggingCallback, llm_instance: MagicMock):
        """All optional parameters are accepted without errors."""
        chunk = _make_chunk("data")
        with patch("sys.stdout"):
            cb.on_new_chunk(
                llm_instance=llm_instance,
                chunk=chunk,
                model="gpt-4",
                credentials={"key": "secret"},
                prompt_messages=[_make_user_prompt("q")],
                model_parameters={"temperature": 0.5},
                tools=[_make_tool("t1")],
                stop=["EOS"],
                stream=True,
                user="bob",
            )


# ===========================================================================
# Tests for on_after_invoke
# ===========================================================================


class TestOnAfterInvoke:
    """Tests for LoggingCallback.on_after_invoke."""

    def _invoke(
        self,
        cb: LoggingCallback,
        llm_instance: MagicMock,
        result: LLMResult,
        **kwargs,
    ):
        cb.on_after_invoke(
            llm_instance=llm_instance,
            result=result,
            model=result.model,
            credentials={},
            prompt_messages=[],
            model_parameters={},
            **kwargs,
        )

    def test_basic_result_printed(self, cb: LoggingCallback, llm_instance: MagicMock):
        """After-invoke header, content, model, usage, fingerprint must be printed."""
        result = _make_llm_result()
        with patch.object(cb, "print_text") as mock_print:
            self._invoke(cb, llm_instance, result)
        calls_text = " ".join(str(c) for c in mock_print.call_args_list)
        assert "[on_llm_after_invoke]" in calls_text
        assert "hello world" in calls_text
        assert "gpt-4" in calls_text
        assert "fp-abc" in calls_text

    def test_no_tool_calls_skips_tool_call_block(self, cb: LoggingCallback, llm_instance: MagicMock):
        """When there are no tool_calls the 'Tool calls:' block must NOT appear."""
        result = _make_llm_result(tool_calls=[])
        with patch.object(cb, "print_text") as mock_print:
            self._invoke(cb, llm_instance, result)
        calls_text = " ".join(str(c) for c in mock_print.call_args_list)
        assert "Tool calls:" not in calls_text

    def test_with_tool_calls_prints_all_fields(self, cb: LoggingCallback, llm_instance: MagicMock):
        """When tool_calls exist their id, name, and JSON arguments must be printed."""
        tc = _make_tool_call(
            call_id="call-xyz",
            func_name="fetch_data",
            arguments='{"url": "https://example.com"}',
        )
        result = _make_llm_result(tool_calls=[tc])
        with patch.object(cb, "print_text") as mock_print:
            self._invoke(cb, llm_instance, result)
        calls_text = " ".join(str(c) for c in mock_print.call_args_list)
        assert "Tool calls:" in calls_text
        assert "call-xyz" in calls_text
        assert "fetch_data" in calls_text
        # arguments should be JSON-dumped
        assert "https://example.com" in calls_text

    def test_multiple_tool_calls_all_printed(self, cb: LoggingCallback, llm_instance: MagicMock):
        """All tool calls in the list must be iterated."""
        tcs = [
            _make_tool_call("id-1", "func_a", '{"a": 1}'),
            _make_tool_call("id-2", "func_b", '{"b": 2}'),
        ]
        result = _make_llm_result(tool_calls=tcs)
        with patch.object(cb, "print_text") as mock_print:
            self._invoke(cb, llm_instance, result)
        calls_text = " ".join(str(c) for c in mock_print.call_args_list)
        assert "id-1" in calls_text
        assert "func_a" in calls_text
        assert "id-2" in calls_text
        assert "func_b" in calls_text

    def test_system_fingerprint_none_printed(self, cb: LoggingCallback, llm_instance: MagicMock):
        """When system_fingerprint is None it should still be printed (as None)."""
        result = _make_llm_result(system_fingerprint=None)
        with patch.object(cb, "print_text") as mock_print:
            self._invoke(cb, llm_instance, result)
        calls_text = " ".join(str(c) for c in mock_print.call_args_list)
        assert "System Fingerprint: None" in calls_text

    def test_usage_printed(self, cb: LoggingCallback, llm_instance: MagicMock):
        """The usage object must appear in the printed output."""
        result = _make_llm_result()
        with patch.object(cb, "print_text") as mock_print:
            self._invoke(cb, llm_instance, result)
        calls_text = " ".join(str(c) for c in mock_print.call_args_list)
        assert "Usage:" in calls_text

    def test_tool_call_arguments_are_json_dumped(self, cb: LoggingCallback, llm_instance: MagicMock):
        """Verify json.dumps is applied to the arguments field (a string)."""
        raw_args = '{"x": 42}'
        tc = _make_tool_call(arguments=raw_args)
        result = _make_llm_result(tool_calls=[tc])
        with patch.object(cb, "print_text") as mock_print:
            self._invoke(cb, llm_instance, result)

        # Check if any call to print_text included the expected (json-encoded) arguments
        # json.dumps(raw_args) produces a string starting and ending with quotes
        expected_substring = json.dumps(raw_args)
        found = any(expected_substring in str(call.args[0]) for call in mock_print.call_args_list)
        assert found, f"Expected {expected_substring} to be printed in one of the calls"

    def test_optional_params_accepted(self, cb: LoggingCallback, llm_instance: MagicMock):
        """All optional parameters should be accepted without error."""
        result = _make_llm_result()
        cb.on_after_invoke(
            llm_instance=llm_instance,
            result=result,
            model=result.model,
            credentials={"key": "secret"},
            prompt_messages=[_make_user_prompt("q")],
            model_parameters={"temperature": 0.9},
            tools=[_make_tool("t")],
            stop=["<EOS>"],
            stream=False,
            user="carol",
        )


# ===========================================================================
# Tests for on_invoke_error
# ===========================================================================


class TestOnInvokeError:
    """Tests for LoggingCallback.on_invoke_error."""

    def _invoke_error(
        self,
        cb: LoggingCallback,
        llm_instance: MagicMock,
        ex: Exception,
        **kwargs,
    ):
        cb.on_invoke_error(
            llm_instance=llm_instance,
            ex=ex,
            model="gpt-4",
            credentials={},
            prompt_messages=[],
            model_parameters={},
            **kwargs,
        )

    def test_prints_error_header(self, cb: LoggingCallback, llm_instance: MagicMock):
        """The [on_llm_invoke_error] banner must be printed."""
        with patch.object(cb, "print_text") as mock_print:
            with patch("dify_graph.model_runtime.callbacks.logging_callback.logger") as mock_logger:
                self._invoke_error(cb, llm_instance, RuntimeError("boom"))
        calls_text = " ".join(str(c) for c in mock_print.call_args_list)
        assert "[on_llm_invoke_error]" in calls_text

    def test_exception_logged_via_logger_exception(self, cb: LoggingCallback, llm_instance: MagicMock):
        """logger.exception must be called with the exception."""
        ex = ValueError("something went wrong")
        with patch.object(cb, "print_text"):
            with patch("dify_graph.model_runtime.callbacks.logging_callback.logger") as mock_logger:
                self._invoke_error(cb, llm_instance, ex)
        mock_logger.exception.assert_called_once_with(ex)

    def test_exception_type_variety(self, cb: LoggingCallback, llm_instance: MagicMock):
        """Works with any exception type (TypeError, IOError, etc.)."""
        for exc_cls in (TypeError, IOError, KeyError, Exception):
            ex = exc_cls("error")
            with patch.object(cb, "print_text"):
                with patch("dify_graph.model_runtime.callbacks.logging_callback.logger") as mock_logger:
                    self._invoke_error(cb, llm_instance, ex)
            mock_logger.exception.assert_called_once_with(ex)

    def test_optional_params_accepted(self, cb: LoggingCallback, llm_instance: MagicMock):
        """All optional parameters should be accepted without error."""
        ex = RuntimeError("fail")
        with patch.object(cb, "print_text"):
            with patch("dify_graph.model_runtime.callbacks.logging_callback.logger"):
                cb.on_invoke_error(
                    llm_instance=llm_instance,
                    ex=ex,
                    model="gpt-4",
                    credentials={"key": "secret"},
                    prompt_messages=[_make_user_prompt("q")],
                    model_parameters={"temperature": 0.7},
                    tools=[_make_tool("t")],
                    stop=["STOP"],
                    stream=True,
                    user="dave",
                )


# ===========================================================================
# Tests for print_text (inherited from Callback, exercised through LoggingCallback)
# ===========================================================================


class TestPrintText:
    """Verify that print_text from the Callback base class works correctly."""

    def test_print_text_with_color(self, cb: LoggingCallback, capsys):
        """print_text with a known colour should emit an ANSI escape sequence."""
        cb.print_text("hello", color="blue")
        captured = capsys.readouterr()
        assert "hello" in captured.out
        # ANSI escape codes should be present
        assert "\x1b[" in captured.out

    def test_print_text_without_color(self, cb: LoggingCallback, capsys):
        """print_text without colour should print plain text."""
        cb.print_text("plain text")
        captured = capsys.readouterr()
        assert "plain text" in captured.out

    def test_print_text_all_colours(self, cb: LoggingCallback, capsys):
        """Verify all supported colour keys don't raise."""
        for colour in ("blue", "yellow", "pink", "green", "red"):
            cb.print_text("x", color=colour)
        captured = capsys.readouterr()
        # All outputs should contain 'x' (5 calls)
        assert captured.out.count("x") >= 5


# ===========================================================================
# Integration-style test: real print_text called (no mocking)
# ===========================================================================


class TestLoggingCallbackIntegration:
    """Light integration tests – real print_text calls, just checking no exceptions."""

    def test_on_before_invoke_full_run(self, capsys):
        """Full on_before_invoke run with all optional fields – verifies real output."""
        cb = LoggingCallback()
        llm = MagicMock()
        msgs = [_make_user_prompt("Who are you?", name="tester")]
        tools = [_make_tool("calculator")]
        cb.on_before_invoke(
            llm_instance=llm,
            model="gpt-4-turbo",
            credentials={"api_key": "sk-xxx"},
            prompt_messages=msgs,
            model_parameters={"temperature": 0.8},
            tools=tools,
            stop=["STOP"],
            stream=True,
            user="test_user",
        )
        captured = capsys.readouterr()
        assert "gpt-4-turbo" in captured.out
        assert "calculator" in captured.out
        assert "test_user" in captured.out
        assert "STOP" in captured.out
        assert "tester" in captured.out

    def test_on_new_chunk_full_run(self, capsys):
        """Full on_new_chunk run – verifies real stdout write."""
        cb = LoggingCallback()
        chunk = _make_chunk("streaming token")
        cb.on_new_chunk(
            llm_instance=MagicMock(),
            chunk=chunk,
            model="gpt-4",
            credentials={},
            prompt_messages=[],
            model_parameters={},
        )
        captured = capsys.readouterr()
        assert "streaming token" in captured.out

    def test_on_after_invoke_full_run_with_tool_calls(self, capsys):
        """Full on_after_invoke run with tool calls – verifies real output."""
        cb = LoggingCallback()
        tc = _make_tool_call("call-99", "do_thing", '{"n": 5}')
        result = _make_llm_result(content="result content", tool_calls=[tc], system_fingerprint="fp-xyz")
        cb.on_after_invoke(
            llm_instance=MagicMock(),
            result=result,
            model=result.model,
            credentials={},
            prompt_messages=[],
            model_parameters={},
        )
        captured = capsys.readouterr()
        assert "result content" in captured.out
        assert "call-99" in captured.out
        assert "do_thing" in captured.out
        assert "fp-xyz" in captured.out

    def test_on_invoke_error_full_run(self, capsys):
        """Full on_invoke_error run – just verifies no exception is raised."""
        cb = LoggingCallback()
        ex = RuntimeError("something bad happened")
        # logger.exception writes to stderr; we just confirm it doesn't crash
        cb.on_invoke_error(
            llm_instance=MagicMock(),
            ex=ex,
            model="gpt-4",
            credentials={},
            prompt_messages=[],
            model_parameters={},
        )
        captured = capsys.readouterr()
        assert "[on_llm_invoke_error]" in captured.out
