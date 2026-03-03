"""Comprehensive unit tests for core/model_runtime/callbacks/base_callback.py"""

from unittest.mock import MagicMock, patch

import pytest

from dify_graph.model_runtime.callbacks.base_callback import (
    _TEXT_COLOR_MAPPING,
    Callback,
)
from dify_graph.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk
from dify_graph.model_runtime.entities.message_entities import PromptMessage, PromptMessageTool

# ---------------------------------------------------------------------------
# Concrete implementation of the abstract Callback for testing
# ---------------------------------------------------------------------------


class ConcreteCallback(Callback):
    """A minimal concrete subclass that satisfies all abstract methods."""

    def __init__(self, raise_error: bool = False):
        self.raise_error = raise_error
        # Track invocations
        self.before_invoke_calls: list[dict] = []
        self.new_chunk_calls: list[dict] = []
        self.after_invoke_calls: list[dict] = []
        self.invoke_error_calls: list[dict] = []

    def on_before_invoke(
        self,
        llm_instance,
        model,
        credentials,
        prompt_messages,
        model_parameters,
        tools=None,
        stop=None,
        stream=True,
        user=None,
    ):
        self.before_invoke_calls.append(
            {
                "llm_instance": llm_instance,
                "model": model,
                "credentials": credentials,
                "prompt_messages": prompt_messages,
                "model_parameters": model_parameters,
                "tools": tools,
                "stop": stop,
                "stream": stream,
                "user": user,
            }
        )
        # To cover the 'raise NotImplementedError()' in the base class
        try:
            super().on_before_invoke(
                llm_instance, model, credentials, prompt_messages, model_parameters, tools, stop, stream, user
            )
        except NotImplementedError:
            pass

    def on_new_chunk(
        self,
        llm_instance,
        chunk,
        model,
        credentials,
        prompt_messages,
        model_parameters,
        tools=None,
        stop=None,
        stream=True,
        user=None,
    ):
        self.new_chunk_calls.append(
            {
                "llm_instance": llm_instance,
                "chunk": chunk,
                "model": model,
                "credentials": credentials,
                "prompt_messages": prompt_messages,
                "model_parameters": model_parameters,
                "tools": tools,
                "stop": stop,
                "stream": stream,
                "user": user,
            }
        )
        try:
            super().on_new_chunk(
                llm_instance, chunk, model, credentials, prompt_messages, model_parameters, tools, stop, stream, user
            )
        except NotImplementedError:
            pass

    def on_after_invoke(
        self,
        llm_instance,
        result,
        model,
        credentials,
        prompt_messages,
        model_parameters,
        tools=None,
        stop=None,
        stream=True,
        user=None,
    ):
        self.after_invoke_calls.append(
            {
                "llm_instance": llm_instance,
                "result": result,
                "model": model,
                "credentials": credentials,
                "prompt_messages": prompt_messages,
                "model_parameters": model_parameters,
                "tools": tools,
                "stop": stop,
                "stream": stream,
                "user": user,
            }
        )
        try:
            super().on_after_invoke(
                llm_instance, result, model, credentials, prompt_messages, model_parameters, tools, stop, stream, user
            )
        except NotImplementedError:
            pass

    def on_invoke_error(
        self,
        llm_instance,
        ex,
        model,
        credentials,
        prompt_messages,
        model_parameters,
        tools=None,
        stop=None,
        stream=True,
        user=None,
    ):
        self.invoke_error_calls.append(
            {
                "llm_instance": llm_instance,
                "ex": ex,
                "model": model,
                "credentials": credentials,
                "prompt_messages": prompt_messages,
                "model_parameters": model_parameters,
                "tools": tools,
                "stop": stop,
                "stream": stream,
                "user": user,
            }
        )
        try:
            super().on_invoke_error(
                llm_instance, ex, model, credentials, prompt_messages, model_parameters, tools, stop, stream, user
            )
        except NotImplementedError:
            pass


# ---------------------------------------------------------------------------
# A subclass that deliberately leaves abstract methods un-implemented,
# used to verify that instantiation raises TypeError.
# ---------------------------------------------------------------------------


# ===========================================================================
# Tests for _TEXT_COLOR_MAPPING module-level constant
# ===========================================================================


class TestTextColorMapping:
    """Tests for the module-level _TEXT_COLOR_MAPPING dictionary."""

    def test_contains_all_expected_colors(self):
        expected_keys = {"blue", "yellow", "pink", "green", "red"}
        assert set(_TEXT_COLOR_MAPPING.keys()) == expected_keys

    def test_blue_escape_code(self):
        assert _TEXT_COLOR_MAPPING["blue"] == "36;1"

    def test_yellow_escape_code(self):
        assert _TEXT_COLOR_MAPPING["yellow"] == "33;1"

    def test_pink_escape_code(self):
        assert _TEXT_COLOR_MAPPING["pink"] == "38;5;200"

    def test_green_escape_code(self):
        assert _TEXT_COLOR_MAPPING["green"] == "32;1"

    def test_red_escape_code(self):
        assert _TEXT_COLOR_MAPPING["red"] == "31;1"

    def test_mapping_is_dict(self):
        assert isinstance(_TEXT_COLOR_MAPPING, dict)

    def test_all_values_are_strings(self):
        for key, value in _TEXT_COLOR_MAPPING.items():
            assert isinstance(value, str), f"Value for {key!r} should be str"


# ===========================================================================
# Tests for the Callback ABC itself
# ===========================================================================


class TestCallbackAbstract:
    """Tests verifying Callback is a proper ABC."""

    def test_cannot_instantiate_abstract_class_directly(self):
        """Callback cannot be instantiated since it has abstract methods."""
        with pytest.raises(TypeError):
            Callback()  # type: ignore[abstract]

    def test_concrete_subclass_can_be_instantiated(self):
        cb = ConcreteCallback()
        assert isinstance(cb, Callback)

    def test_default_raise_error_is_false(self):
        cb = ConcreteCallback()
        assert cb.raise_error is False

    def test_raise_error_can_be_set_to_true(self):
        cb = ConcreteCallback(raise_error=True)
        assert cb.raise_error is True

    def test_subclass_missing_on_before_invoke_raises_type_error(self):
        """A subclass missing any single abstract method cannot be instantiated."""

        class IncompleteCallback(Callback):
            def on_new_chunk(self, *a, **kw): ...
            def on_after_invoke(self, *a, **kw): ...
            def on_invoke_error(self, *a, **kw): ...

        with pytest.raises(TypeError):
            IncompleteCallback()  # type: ignore[abstract]

    def test_subclass_missing_on_new_chunk_raises_type_error(self):
        class IncompleteCallback(Callback):
            def on_before_invoke(self, *a, **kw): ...
            def on_after_invoke(self, *a, **kw): ...
            def on_invoke_error(self, *a, **kw): ...

        with pytest.raises(TypeError):
            IncompleteCallback()  # type: ignore[abstract]

    def test_subclass_missing_on_after_invoke_raises_type_error(self):
        class IncompleteCallback(Callback):
            def on_before_invoke(self, *a, **kw): ...
            def on_new_chunk(self, *a, **kw): ...
            def on_invoke_error(self, *a, **kw): ...

        with pytest.raises(TypeError):
            IncompleteCallback()  # type: ignore[abstract]

    def test_subclass_missing_on_invoke_error_raises_type_error(self):
        class IncompleteCallback(Callback):
            def on_before_invoke(self, *a, **kw): ...
            def on_new_chunk(self, *a, **kw): ...
            def on_after_invoke(self, *a, **kw): ...

        with pytest.raises(TypeError):
            IncompleteCallback()  # type: ignore[abstract]


# ===========================================================================
# Tests for on_before_invoke
# ===========================================================================


class TestOnBeforeInvoke:
    """Tests for the on_before_invoke callback method."""

    def setup_method(self):
        self.cb = ConcreteCallback()
        self.llm_instance = MagicMock()
        self.model = "gpt-4"
        self.credentials = {"api_key": "sk-test"}
        self.prompt_messages = [MagicMock(spec=PromptMessage)]
        self.model_parameters = {"temperature": 0.7}

    def test_on_before_invoke_called_with_required_args(self):
        self.cb.on_before_invoke(
            llm_instance=self.llm_instance,
            model=self.model,
            credentials=self.credentials,
            prompt_messages=self.prompt_messages,
            model_parameters=self.model_parameters,
        )
        assert len(self.cb.before_invoke_calls) == 1
        call = self.cb.before_invoke_calls[0]
        assert call["llm_instance"] is self.llm_instance
        assert call["model"] == self.model
        assert call["credentials"] == self.credentials
        assert call["prompt_messages"] is self.prompt_messages
        assert call["model_parameters"] is self.model_parameters

    def test_on_before_invoke_defaults_tools_none(self):
        self.cb.on_before_invoke(
            llm_instance=self.llm_instance,
            model=self.model,
            credentials=self.credentials,
            prompt_messages=self.prompt_messages,
            model_parameters=self.model_parameters,
        )
        assert self.cb.before_invoke_calls[0]["tools"] is None

    def test_on_before_invoke_defaults_stop_none(self):
        self.cb.on_before_invoke(
            llm_instance=self.llm_instance,
            model=self.model,
            credentials=self.credentials,
            prompt_messages=self.prompt_messages,
            model_parameters=self.model_parameters,
        )
        assert self.cb.before_invoke_calls[0]["stop"] is None

    def test_on_before_invoke_defaults_stream_true(self):
        self.cb.on_before_invoke(
            llm_instance=self.llm_instance,
            model=self.model,
            credentials=self.credentials,
            prompt_messages=self.prompt_messages,
            model_parameters=self.model_parameters,
        )
        assert self.cb.before_invoke_calls[0]["stream"] is True

    def test_on_before_invoke_defaults_user_none(self):
        self.cb.on_before_invoke(
            llm_instance=self.llm_instance,
            model=self.model,
            credentials=self.credentials,
            prompt_messages=self.prompt_messages,
            model_parameters=self.model_parameters,
        )
        assert self.cb.before_invoke_calls[0]["user"] is None

    def test_on_before_invoke_with_all_optional_args(self):
        tools = [MagicMock(spec=PromptMessageTool)]
        stop = ["stop1", "stop2"]
        self.cb.on_before_invoke(
            llm_instance=self.llm_instance,
            model=self.model,
            credentials=self.credentials,
            prompt_messages=self.prompt_messages,
            model_parameters=self.model_parameters,
            tools=tools,
            stop=stop,
            stream=False,
            user="user-123",
        )
        call = self.cb.before_invoke_calls[0]
        assert call["tools"] is tools
        assert call["stop"] == stop
        assert call["stream"] is False
        assert call["user"] == "user-123"

    def test_on_before_invoke_called_multiple_times(self):
        for i in range(3):
            self.cb.on_before_invoke(
                llm_instance=self.llm_instance,
                model=f"model-{i}",
                credentials=self.credentials,
                prompt_messages=self.prompt_messages,
                model_parameters=self.model_parameters,
            )
        assert len(self.cb.before_invoke_calls) == 3
        assert self.cb.before_invoke_calls[2]["model"] == "model-2"


# ===========================================================================
# Tests for on_new_chunk
# ===========================================================================


class TestOnNewChunk:
    """Tests for the on_new_chunk callback method."""

    def setup_method(self):
        self.cb = ConcreteCallback()
        self.llm_instance = MagicMock()
        self.chunk = MagicMock(spec=LLMResultChunk)
        self.model = "gpt-3.5-turbo"
        self.credentials = {"api_key": "sk-test"}
        self.prompt_messages = [MagicMock(spec=PromptMessage)]
        self.model_parameters = {"max_tokens": 256}

    def test_on_new_chunk_called_with_required_args(self):
        self.cb.on_new_chunk(
            llm_instance=self.llm_instance,
            chunk=self.chunk,
            model=self.model,
            credentials=self.credentials,
            prompt_messages=self.prompt_messages,
            model_parameters=self.model_parameters,
        )
        assert len(self.cb.new_chunk_calls) == 1
        call = self.cb.new_chunk_calls[0]
        assert call["llm_instance"] is self.llm_instance
        assert call["chunk"] is self.chunk
        assert call["model"] == self.model
        assert call["credentials"] == self.credentials

    def test_on_new_chunk_defaults_tools_none(self):
        self.cb.on_new_chunk(
            llm_instance=self.llm_instance,
            chunk=self.chunk,
            model=self.model,
            credentials=self.credentials,
            prompt_messages=self.prompt_messages,
            model_parameters=self.model_parameters,
        )
        assert self.cb.new_chunk_calls[0]["tools"] is None

    def test_on_new_chunk_defaults_stop_none(self):
        self.cb.on_new_chunk(
            llm_instance=self.llm_instance,
            chunk=self.chunk,
            model=self.model,
            credentials=self.credentials,
            prompt_messages=self.prompt_messages,
            model_parameters=self.model_parameters,
        )
        assert self.cb.new_chunk_calls[0]["stop"] is None

    def test_on_new_chunk_defaults_stream_true(self):
        self.cb.on_new_chunk(
            llm_instance=self.llm_instance,
            chunk=self.chunk,
            model=self.model,
            credentials=self.credentials,
            prompt_messages=self.prompt_messages,
            model_parameters=self.model_parameters,
        )
        assert self.cb.new_chunk_calls[0]["stream"] is True

    def test_on_new_chunk_defaults_user_none(self):
        self.cb.on_new_chunk(
            llm_instance=self.llm_instance,
            chunk=self.chunk,
            model=self.model,
            credentials=self.credentials,
            prompt_messages=self.prompt_messages,
            model_parameters=self.model_parameters,
        )
        assert self.cb.new_chunk_calls[0]["user"] is None

    def test_on_new_chunk_with_all_optional_args(self):
        tools = [MagicMock(spec=PromptMessageTool)]
        stop = ["END"]
        self.cb.on_new_chunk(
            llm_instance=self.llm_instance,
            chunk=self.chunk,
            model=self.model,
            credentials=self.credentials,
            prompt_messages=self.prompt_messages,
            model_parameters=self.model_parameters,
            tools=tools,
            stop=stop,
            stream=False,
            user="chunk-user",
        )
        call = self.cb.new_chunk_calls[0]
        assert call["tools"] is tools
        assert call["stop"] == stop
        assert call["stream"] is False
        assert call["user"] == "chunk-user"

    def test_on_new_chunk_called_multiple_times(self):
        for i in range(5):
            self.cb.on_new_chunk(
                llm_instance=self.llm_instance,
                chunk=self.chunk,
                model=self.model,
                credentials=self.credentials,
                prompt_messages=self.prompt_messages,
                model_parameters=self.model_parameters,
            )
        assert len(self.cb.new_chunk_calls) == 5


# ===========================================================================
# Tests for on_after_invoke
# ===========================================================================


class TestOnAfterInvoke:
    """Tests for the on_after_invoke callback method."""

    def setup_method(self):
        self.cb = ConcreteCallback()
        self.llm_instance = MagicMock()
        self.result = MagicMock(spec=LLMResult)
        self.model = "claude-3"
        self.credentials = {"api_key": "anthropic-key"}
        self.prompt_messages = [MagicMock(spec=PromptMessage)]
        self.model_parameters = {"temperature": 1.0}

    def test_on_after_invoke_called_with_required_args(self):
        self.cb.on_after_invoke(
            llm_instance=self.llm_instance,
            result=self.result,
            model=self.model,
            credentials=self.credentials,
            prompt_messages=self.prompt_messages,
            model_parameters=self.model_parameters,
        )
        assert len(self.cb.after_invoke_calls) == 1
        call = self.cb.after_invoke_calls[0]
        assert call["llm_instance"] is self.llm_instance
        assert call["result"] is self.result
        assert call["model"] == self.model
        assert call["credentials"] is self.credentials

    def test_on_after_invoke_defaults_tools_none(self):
        self.cb.on_after_invoke(
            llm_instance=self.llm_instance,
            result=self.result,
            model=self.model,
            credentials=self.credentials,
            prompt_messages=self.prompt_messages,
            model_parameters=self.model_parameters,
        )
        assert self.cb.after_invoke_calls[0]["tools"] is None

    def test_on_after_invoke_defaults_stop_none(self):
        self.cb.on_after_invoke(
            llm_instance=self.llm_instance,
            result=self.result,
            model=self.model,
            credentials=self.credentials,
            prompt_messages=self.prompt_messages,
            model_parameters=self.model_parameters,
        )
        assert self.cb.after_invoke_calls[0]["stop"] is None

    def test_on_after_invoke_defaults_stream_true(self):
        self.cb.on_after_invoke(
            llm_instance=self.llm_instance,
            result=self.result,
            model=self.model,
            credentials=self.credentials,
            prompt_messages=self.prompt_messages,
            model_parameters=self.model_parameters,
        )
        assert self.cb.after_invoke_calls[0]["stream"] is True

    def test_on_after_invoke_defaults_user_none(self):
        self.cb.on_after_invoke(
            llm_instance=self.llm_instance,
            result=self.result,
            model=self.model,
            credentials=self.credentials,
            prompt_messages=self.prompt_messages,
            model_parameters=self.model_parameters,
        )
        assert self.cb.after_invoke_calls[0]["user"] is None

    def test_on_after_invoke_with_all_optional_args(self):
        tools = [MagicMock(spec=PromptMessageTool)]
        stop = ["STOP"]
        self.cb.on_after_invoke(
            llm_instance=self.llm_instance,
            result=self.result,
            model=self.model,
            credentials=self.credentials,
            prompt_messages=self.prompt_messages,
            model_parameters=self.model_parameters,
            tools=tools,
            stop=stop,
            stream=False,
            user="after-user",
        )
        call = self.cb.after_invoke_calls[0]
        assert call["tools"] is tools
        assert call["stop"] == stop
        assert call["stream"] is False
        assert call["user"] == "after-user"


# ===========================================================================
# Tests for on_invoke_error
# ===========================================================================


class TestOnInvokeError:
    """Tests for the on_invoke_error callback method."""

    def setup_method(self):
        self.cb = ConcreteCallback()
        self.llm_instance = MagicMock()
        self.ex = ValueError("something went wrong")
        self.model = "gemini-pro"
        self.credentials = {"api_key": "google-key"}
        self.prompt_messages = [MagicMock(spec=PromptMessage)]
        self.model_parameters = {"top_p": 0.9}

    def test_on_invoke_error_called_with_required_args(self):
        self.cb.on_invoke_error(
            llm_instance=self.llm_instance,
            ex=self.ex,
            model=self.model,
            credentials=self.credentials,
            prompt_messages=self.prompt_messages,
            model_parameters=self.model_parameters,
        )
        assert len(self.cb.invoke_error_calls) == 1
        call = self.cb.invoke_error_calls[0]
        assert call["llm_instance"] is self.llm_instance
        assert call["ex"] is self.ex
        assert call["model"] == self.model
        assert call["credentials"] is self.credentials

    def test_on_invoke_error_defaults_tools_none(self):
        self.cb.on_invoke_error(
            llm_instance=self.llm_instance,
            ex=self.ex,
            model=self.model,
            credentials=self.credentials,
            prompt_messages=self.prompt_messages,
            model_parameters=self.model_parameters,
        )
        assert self.cb.invoke_error_calls[0]["tools"] is None

    def test_on_invoke_error_defaults_stop_none(self):
        self.cb.on_invoke_error(
            llm_instance=self.llm_instance,
            ex=self.ex,
            model=self.model,
            credentials=self.credentials,
            prompt_messages=self.prompt_messages,
            model_parameters=self.model_parameters,
        )
        assert self.cb.invoke_error_calls[0]["stop"] is None

    def test_on_invoke_error_defaults_stream_true(self):
        self.cb.on_invoke_error(
            llm_instance=self.llm_instance,
            ex=self.ex,
            model=self.model,
            credentials=self.credentials,
            prompt_messages=self.prompt_messages,
            model_parameters=self.model_parameters,
        )
        assert self.cb.invoke_error_calls[0]["stream"] is True

    def test_on_invoke_error_defaults_user_none(self):
        self.cb.on_invoke_error(
            llm_instance=self.llm_instance,
            ex=self.ex,
            model=self.model,
            credentials=self.credentials,
            prompt_messages=self.prompt_messages,
            model_parameters=self.model_parameters,
        )
        assert self.cb.invoke_error_calls[0]["user"] is None

    def test_on_invoke_error_with_all_optional_args(self):
        tools = [MagicMock(spec=PromptMessageTool)]
        stop = ["HALT"]
        self.cb.on_invoke_error(
            llm_instance=self.llm_instance,
            ex=self.ex,
            model=self.model,
            credentials=self.credentials,
            prompt_messages=self.prompt_messages,
            model_parameters=self.model_parameters,
            tools=tools,
            stop=stop,
            stream=False,
            user="error-user",
        )
        call = self.cb.invoke_error_calls[0]
        assert call["tools"] is tools
        assert call["stop"] == stop
        assert call["stream"] is False
        assert call["user"] == "error-user"

    def test_on_invoke_error_accepts_various_exception_types(self):
        for exc in [RuntimeError("r"), KeyError("k"), Exception("e")]:
            self.cb.on_invoke_error(
                llm_instance=self.llm_instance,
                ex=exc,
                model=self.model,
                credentials=self.credentials,
                prompt_messages=self.prompt_messages,
                model_parameters=self.model_parameters,
            )
        assert len(self.cb.invoke_error_calls) == 3


# ===========================================================================
# Tests for print_text (concrete method on Callback)
# ===========================================================================


class TestPrintText:
    """Tests for the concrete print_text method."""

    def setup_method(self):
        self.cb = ConcreteCallback()

    def test_print_text_without_color_prints_plain_text(self, capsys):
        self.cb.print_text("hello world")
        captured = capsys.readouterr()
        assert captured.out == "hello world"

    def test_print_text_with_color_prints_colored_text(self, capsys):
        self.cb.print_text("colored text", color="blue")
        captured = capsys.readouterr()
        # Should contain ANSI escape sequences
        assert "colored text" in captured.out
        assert "\001b[" in captured.out or "\033[" in captured.out or "\x1b[" in captured.out

    def test_print_text_without_color_no_ansi(self, capsys):
        self.cb.print_text("plain text", color=None)
        captured = capsys.readouterr()
        assert captured.out == "plain text"
        # No ANSI escape sequences
        assert "\x1b" not in captured.out

    def test_print_text_default_end_is_empty_string(self, capsys):
        self.cb.print_text("no newline")
        captured = capsys.readouterr()
        assert not captured.out.endswith("\n")

    def test_print_text_with_custom_end(self, capsys):
        self.cb.print_text("with newline", end="\n")
        captured = capsys.readouterr()
        assert captured.out.endswith("\n")

    def test_print_text_with_empty_string(self, capsys):
        self.cb.print_text("", color=None)
        captured = capsys.readouterr()
        assert captured.out == ""

    @pytest.mark.parametrize("color", ["blue", "yellow", "pink", "green", "red"])
    def test_print_text_all_colors_work(self, color, capsys):
        """Verify no KeyError is thrown for any valid color."""
        self.cb.print_text("test", color=color)
        captured = capsys.readouterr()
        assert "test" in captured.out

    def test_print_text_calls_get_colored_text_when_color_given(self):
        with patch.object(self.cb, "_get_colored_text", return_value="[COLORED]") as mock_gct:
            with patch("builtins.print") as mock_print:
                self.cb.print_text("hello", color="green")
                mock_gct.assert_called_once_with("hello", "green")
                mock_print.assert_called_once_with("[COLORED]", end="")

    def test_print_text_does_not_call_get_colored_text_when_no_color(self):
        with patch.object(self.cb, "_get_colored_text") as mock_gct:
            with patch("builtins.print"):
                self.cb.print_text("hello", color=None)
                mock_gct.assert_not_called()

    def test_print_text_passes_end_to_print(self):
        with patch("builtins.print") as mock_print:
            self.cb.print_text("text", end="---")
            mock_print.assert_called_once_with("text", end="---")


# ===========================================================================
# Tests for _get_colored_text (private helper method)
# ===========================================================================


class TestGetColoredText:
    """Tests for the _get_colored_text private method."""

    def setup_method(self):
        self.cb = ConcreteCallback()

    @pytest.mark.parametrize(("color", "expected_code"), list(_TEXT_COLOR_MAPPING.items()))
    def test_get_colored_text_uses_correct_escape_code(self, color, expected_code):
        result = self.cb._get_colored_text("text", color)
        assert expected_code in result

    @pytest.mark.parametrize("color", ["blue", "yellow", "pink", "green", "red"])
    def test_get_colored_text_contains_input_text(self, color):
        result = self.cb._get_colored_text("hello", color)
        assert "hello" in result

    @pytest.mark.parametrize("color", ["blue", "yellow", "pink", "green", "red"])
    def test_get_colored_text_starts_with_escape(self, color):
        result = self.cb._get_colored_text("text", color)
        # Should start with an ANSI escape (\x1b or \u001b)
        assert result.startswith("\x1b[") or result.startswith("\u001b[")

    @pytest.mark.parametrize("color", ["blue", "yellow", "pink", "green", "red"])
    def test_get_colored_text_ends_with_reset(self, color):
        result = self.cb._get_colored_text("text", color)
        # Should end with the ANSI reset code
        assert result.endswith("\x1b[0m") or result.endswith("\u001b[0m")

    def test_get_colored_text_returns_string(self):
        result = self.cb._get_colored_text("text", "blue")
        assert isinstance(result, str)

    def test_get_colored_text_blue_exact_format(self):
        result = self.cb._get_colored_text("hello", "blue")
        expected = f"\u001b[{_TEXT_COLOR_MAPPING['blue']}m\033[1;3mhello\u001b[0m"
        assert result == expected

    def test_get_colored_text_red_exact_format(self):
        result = self.cb._get_colored_text("error", "red")
        expected = f"\u001b[{_TEXT_COLOR_MAPPING['red']}m\033[1;3merror\u001b[0m"
        assert result == expected

    def test_get_colored_text_green_exact_format(self):
        result = self.cb._get_colored_text("ok", "green")
        expected = f"\u001b[{_TEXT_COLOR_MAPPING['green']}m\033[1;3mok\u001b[0m"
        assert result == expected

    def test_get_colored_text_yellow_exact_format(self):
        result = self.cb._get_colored_text("warn", "yellow")
        expected = f"\u001b[{_TEXT_COLOR_MAPPING['yellow']}m\033[1;3mwarn\u001b[0m"
        assert result == expected

    def test_get_colored_text_pink_exact_format(self):
        result = self.cb._get_colored_text("info", "pink")
        expected = f"\u001b[{_TEXT_COLOR_MAPPING['pink']}m\033[1;3minfo\u001b[0m"
        assert result == expected

    def test_get_colored_text_empty_string(self):
        result = self.cb._get_colored_text("", "blue")
        assert isinstance(result, str)
        # Empty text should still have escape codes
        assert _TEXT_COLOR_MAPPING["blue"] in result

    def test_get_colored_text_invalid_color_raises_key_error(self):
        with pytest.raises(KeyError):
            self.cb._get_colored_text("text", "purple")

    def test_get_colored_text_with_special_characters(self):
        special = "hello\nworld\ttab"
        result = self.cb._get_colored_text(special, "blue")
        assert special in result

    def test_get_colored_text_with_long_text(self):
        long_text = "a" * 10000
        result = self.cb._get_colored_text(long_text, "green")
        assert long_text in result


# ===========================================================================
# Integration-style tests: full workflow through a ConcreteCallback
# ===========================================================================


class TestConcreteCallbackIntegration:
    """End-to-end workflow tests using ConcreteCallback."""

    def test_full_invocation_lifecycle(self):
        """Simulate a complete LLM invocation lifecycle through all callbacks."""
        cb = ConcreteCallback()
        llm_instance = MagicMock()
        model = "gpt-4o"
        credentials = {"api_key": "sk-xyz"}
        prompt_messages = [MagicMock(spec=PromptMessage)]
        model_parameters = {"temperature": 0.5}
        tools = [MagicMock(spec=PromptMessageTool)]
        stop = ["<END>"]
        user = "user-abc"

        # 1. Before invoke
        cb.on_before_invoke(
            llm_instance=llm_instance,
            model=model,
            credentials=credentials,
            prompt_messages=prompt_messages,
            model_parameters=model_parameters,
            tools=tools,
            stop=stop,
            stream=True,
            user=user,
        )

        # 2. Multiple chunks during streaming
        for i in range(3):
            chunk = MagicMock(spec=LLMResultChunk)
            cb.on_new_chunk(
                llm_instance=llm_instance,
                chunk=chunk,
                model=model,
                credentials=credentials,
                prompt_messages=prompt_messages,
                model_parameters=model_parameters,
                tools=tools,
                stop=stop,
                stream=True,
                user=user,
            )

        # 3. After invoke
        result = MagicMock(spec=LLMResult)
        cb.on_after_invoke(
            llm_instance=llm_instance,
            result=result,
            model=model,
            credentials=credentials,
            prompt_messages=prompt_messages,
            model_parameters=model_parameters,
            tools=tools,
            stop=stop,
            stream=True,
            user=user,
        )

        assert len(cb.before_invoke_calls) == 1
        assert len(cb.new_chunk_calls) == 3
        assert len(cb.after_invoke_calls) == 1
        assert len(cb.invoke_error_calls) == 0

    def test_error_lifecycle(self):
        """Simulate an invoke that results in an error."""
        cb = ConcreteCallback()
        llm_instance = MagicMock()
        model = "gpt-4"
        credentials = {}
        prompt_messages = []
        model_parameters = {}

        cb.on_before_invoke(
            llm_instance=llm_instance,
            model=model,
            credentials=credentials,
            prompt_messages=prompt_messages,
            model_parameters=model_parameters,
        )

        ex = RuntimeError("API timeout")
        cb.on_invoke_error(
            llm_instance=llm_instance,
            ex=ex,
            model=model,
            credentials=credentials,
            prompt_messages=prompt_messages,
            model_parameters=model_parameters,
        )

        assert len(cb.before_invoke_calls) == 1
        assert len(cb.invoke_error_calls) == 1
        assert cb.invoke_error_calls[0]["ex"] is ex
        assert len(cb.after_invoke_calls) == 0

    def test_print_text_with_color_in_integration(self, capsys):
        """verify print_text works correctly in a concrete instance."""
        cb = ConcreteCallback()
        cb.print_text("SUCCESS", color="green", end="\n")
        captured = capsys.readouterr()
        assert "SUCCESS" in captured.out
        assert "\n" in captured.out

    def test_print_text_no_color_in_integration(self, capsys):
        cb = ConcreteCallback()
        cb.print_text("plain output")
        captured = capsys.readouterr()
        assert captured.out == "plain output"
