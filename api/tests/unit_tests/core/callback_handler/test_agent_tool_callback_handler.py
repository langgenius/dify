from io import StringIO
from typing import override

import pytest
from pytest_mock import MockerFixture, MockType

import core.callback_handler.agent_tool_callback_handler as module
from core.callback_handler.agent_tool_callback_handler import DifyAgentCallbackHandler
from tests.helpers.unit.config_override import apply_config_overrides

# -----------------------------
# Fixtures
# -----------------------------


@pytest.fixture
def enable_debug(monkeypatch: pytest.MonkeyPatch) -> None:
    apply_config_overrides(monkeypatch, DEBUG=True)


@pytest.fixture
def disable_debug(monkeypatch: pytest.MonkeyPatch) -> None:
    apply_config_overrides(monkeypatch, DEBUG=False)


@pytest.fixture
def mock_print(mocker: MockerFixture) -> MockType:
    return mocker.patch("builtins.print")


@pytest.fixture
def handler() -> DifyAgentCallbackHandler:
    return module.DifyAgentCallbackHandler(color="blue")


# -----------------------------
# get_colored_text Tests
# -----------------------------


class TestGetColoredText:
    @pytest.mark.parametrize(
        ("color", "expected_code"),
        [
            ("blue", "36;1"),
            ("yellow", "33;1"),
            ("pink", "38;5;200"),
            ("green", "32;1"),
            ("red", "31;1"),
        ],
    )
    def test_get_colored_text_valid_colors(self, color: str, expected_code: str) -> None:
        text = "hello"
        result = module.get_colored_text(text, color)
        assert expected_code in result
        assert text in result
        assert result.endswith("\u001b[0m")

    def test_get_colored_text_invalid_color_raises(self) -> None:
        with pytest.raises(KeyError):
            module.get_colored_text("hello", "invalid")

    def test_get_colored_text_empty_string(self) -> None:
        result = module.get_colored_text("", "green")
        assert "\u001b[" in result


# -----------------------------
# print_text Tests
# -----------------------------


class _FlushCountingStringIO(StringIO):
    def __init__(self) -> None:
        """Create an empty stream with zero recorded flushes."""
        super().__init__()
        self.flush_count = 0

    @override
    def flush(self) -> None:
        """Flush the open stream and record the successful call."""
        super().flush()
        self.flush_count += 1


class TestPrintText:
    def test_print_text_without_color(self, mock_print: MockType) -> None:
        module.print_text("hello")
        mock_print.assert_called_once_with("hello", end="", file=None)

    def test_print_text_with_color(self, mocker: MockerFixture, mock_print: MockType) -> None:
        mock_get_color = mocker.patch(
            "core.callback_handler.agent_tool_callback_handler.get_colored_text",
            return_value="colored_text",
        )

        module.print_text("hello", color="green")

        mock_get_color.assert_called_once_with("hello", "green")
        mock_print.assert_called_once_with("colored_text", end="", file=None)

    def test_print_text_with_file_flush(self, mocker: MockerFixture) -> None:
        output = _FlushCountingStringIO()
        mock_print = mocker.patch("builtins.print")

        module.print_text("hello", file=output)

        mock_print.assert_called_once_with("hello", end="", file=output)
        assert output.flush_count == 1

    def test_print_text_with_end_parameter(self, mock_print: MockType) -> None:
        module.print_text("hello", end="\n")
        mock_print.assert_called_once_with("hello", end="\n", file=None)


# -----------------------------
# DifyAgentCallbackHandler Tests
# -----------------------------


class TestDifyAgentCallbackHandler:
    def test_init_default_color(self) -> None:
        handler = module.DifyAgentCallbackHandler()
        assert handler.color == "green"
        assert handler.current_loop == 1

    @pytest.mark.usefixtures("enable_debug")
    def test_on_tool_start_debug_enabled(self, handler: DifyAgentCallbackHandler, mocker: MockerFixture) -> None:
        mock_print_text = mocker.patch("core.callback_handler.agent_tool_callback_handler.print_text")

        handler.on_tool_start("tool1", {"a": 1})

        mock_print_text.assert_called()

    @pytest.mark.usefixtures("disable_debug")
    def test_on_tool_start_debug_disabled(self, handler: DifyAgentCallbackHandler, mocker: MockerFixture) -> None:
        mock_print_text = mocker.patch("core.callback_handler.agent_tool_callback_handler.print_text")

        handler.on_tool_start("tool1", {"a": 1})

        mock_print_text.assert_not_called()

    @pytest.mark.usefixtures("enable_debug")
    def test_on_tool_end_debug_enabled(self, handler: DifyAgentCallbackHandler, mocker: MockerFixture) -> None:
        mock_print_text = mocker.patch("core.callback_handler.agent_tool_callback_handler.print_text")

        handler.on_tool_end(
            tool_name="tool1",
            tool_inputs={},
            tool_outputs="output",
        )

        assert mock_print_text.call_count >= 1

    @pytest.mark.usefixtures("enable_debug")
    def test_on_tool_error_debug_enabled(self, handler: DifyAgentCallbackHandler, mocker: MockerFixture) -> None:
        mock_print_text = mocker.patch("core.callback_handler.agent_tool_callback_handler.print_text")

        handler.on_tool_error(Exception("error"))

        mock_print_text.assert_called_once()

    @pytest.mark.usefixtures("disable_debug")
    def test_on_tool_error_debug_disabled(self, handler: DifyAgentCallbackHandler, mocker: MockerFixture) -> None:
        mock_print_text = mocker.patch("core.callback_handler.agent_tool_callback_handler.print_text")

        handler.on_tool_error(Exception("error"))

        mock_print_text.assert_not_called()

    @pytest.mark.parametrize("thought", ["thinking", ""])
    @pytest.mark.usefixtures("enable_debug")
    def test_on_agent_start(self, handler: DifyAgentCallbackHandler, mocker: MockerFixture, thought: str) -> None:
        mock_print_text = mocker.patch("core.callback_handler.agent_tool_callback_handler.print_text")

        handler.on_agent_start(thought)

        mock_print_text.assert_called()

    @pytest.mark.usefixtures("enable_debug")
    def test_on_agent_finish_increments_loop(self, handler: DifyAgentCallbackHandler, mocker: MockerFixture) -> None:
        mock_print_text = mocker.patch("core.callback_handler.agent_tool_callback_handler.print_text")

        current_loop = handler.current_loop
        handler.on_agent_finish()

        assert handler.current_loop == current_loop + 1
        mock_print_text.assert_called()

    @pytest.mark.usefixtures("enable_debug")
    def test_on_datasource_start_debug_enabled(self, handler: DifyAgentCallbackHandler, mocker: MockerFixture) -> None:
        mock_print_text = mocker.patch("core.callback_handler.agent_tool_callback_handler.print_text")

        handler.on_datasource_start("ds1", {"x": 1})

        mock_print_text.assert_called_once()

    @pytest.mark.usefixtures("disable_debug")
    def test_ignore_agent_property(self, handler: DifyAgentCallbackHandler) -> None:
        assert handler.ignore_agent is True

    @pytest.mark.usefixtures("disable_debug")
    def test_ignore_chat_model_property(self, handler: DifyAgentCallbackHandler) -> None:
        assert handler.ignore_chat_model is True

    @pytest.mark.usefixtures("enable_debug")
    def test_ignore_properties_when_debug_enabled(self, handler: DifyAgentCallbackHandler) -> None:
        assert handler.ignore_agent is False
        assert handler.ignore_chat_model is False
