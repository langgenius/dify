from unittest.mock import MagicMock

import pytest

import core.callback_handler.agent_tool_callback_handler as module

# -----------------------------
# Fixtures
# -----------------------------


@pytest.fixture
def enable_debug(mocker):
    mocker.patch.object(module.dify_config, "DEBUG", True)


@pytest.fixture
def disable_debug(mocker):
    mocker.patch.object(module.dify_config, "DEBUG", False)


@pytest.fixture
def mock_print(mocker):
    return mocker.patch("builtins.print")


@pytest.fixture
def handler():
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
    def test_get_colored_text_valid_colors(self, color, expected_code):
        text = "hello"
        result = module.get_colored_text(text, color)
        assert expected_code in result
        assert text in result
        assert result.endswith("\u001b[0m")

    def test_get_colored_text_invalid_color_raises(self):
        with pytest.raises(KeyError):
            module.get_colored_text("hello", "invalid")

    def test_get_colored_text_empty_string(self):
        result = module.get_colored_text("", "green")
        assert "\u001b[" in result


# -----------------------------
# print_text Tests
# -----------------------------


class TestPrintText:
    def test_print_text_without_color(self, mock_print):
        module.print_text("hello")
        mock_print.assert_called_once_with("hello", end="", file=None)

    def test_print_text_with_color(self, mocker, mock_print):
        mock_get_color = mocker.patch(
            "core.callback_handler.agent_tool_callback_handler.get_colored_text",
            return_value="colored_text",
        )

        module.print_text("hello", color="green")

        mock_get_color.assert_called_once_with("hello", "green")
        mock_print.assert_called_once_with("colored_text", end="", file=None)

    def test_print_text_with_file_flush(self, mocker):
        mock_file = MagicMock()
        mock_print = mocker.patch("builtins.print")

        module.print_text("hello", file=mock_file)

        mock_print.assert_called_once_with("hello", end="", file=mock_file)
        mock_file.flush.assert_called_once()

    def test_print_text_with_end_parameter(self, mock_print):
        module.print_text("hello", end="\n")
        mock_print.assert_called_once_with("hello", end="\n", file=None)


# -----------------------------
# DifyAgentCallbackHandler Tests
# -----------------------------


class TestDifyAgentCallbackHandler:
    def test_init_default_color(self):
        handler = module.DifyAgentCallbackHandler()
        assert handler.color == "green"
        assert handler.current_loop == 1

    def test_on_tool_start_debug_enabled(self, handler, enable_debug, mocker):
        mock_print_text = mocker.patch("core.callback_handler.agent_tool_callback_handler.print_text")

        handler.on_tool_start("tool1", {"a": 1})

        mock_print_text.assert_called()

    def test_on_tool_start_debug_disabled(self, handler, disable_debug, mocker):
        mock_print_text = mocker.patch("core.callback_handler.agent_tool_callback_handler.print_text")

        handler.on_tool_start("tool1", {"a": 1})

        mock_print_text.assert_not_called()

    def test_on_tool_end_debug_enabled_and_trace(self, handler, enable_debug, mocker):
        mock_print_text = mocker.patch("core.callback_handler.agent_tool_callback_handler.print_text")
        mock_trace_manager = MagicMock()

        handler.on_tool_end(
            tool_name="tool1",
            tool_inputs={"a": 1},
            tool_outputs="output",
            message_id="msg1",
            timer=123,
            trace_manager=mock_trace_manager,
        )

        assert mock_print_text.call_count >= 1
        mock_trace_manager.add_trace_task.assert_called_once()

    def test_on_tool_end_without_trace_manager(self, handler, enable_debug, mocker):
        mock_print_text = mocker.patch("core.callback_handler.agent_tool_callback_handler.print_text")

        handler.on_tool_end(
            tool_name="tool1",
            tool_inputs={},
            tool_outputs="output",
        )

        assert mock_print_text.call_count >= 1

    def test_on_tool_error_debug_enabled(self, handler, enable_debug, mocker):
        mock_print_text = mocker.patch("core.callback_handler.agent_tool_callback_handler.print_text")

        handler.on_tool_error(Exception("error"))

        mock_print_text.assert_called_once()

    def test_on_tool_error_debug_disabled(self, handler, disable_debug, mocker):
        mock_print_text = mocker.patch("core.callback_handler.agent_tool_callback_handler.print_text")

        handler.on_tool_error(Exception("error"))

        mock_print_text.assert_not_called()

    @pytest.mark.parametrize("thought", ["thinking", ""])
    def test_on_agent_start(self, handler, enable_debug, mocker, thought):
        mock_print_text = mocker.patch("core.callback_handler.agent_tool_callback_handler.print_text")

        handler.on_agent_start(thought)

        mock_print_text.assert_called()

    def test_on_agent_finish_increments_loop(self, handler, enable_debug, mocker):
        mock_print_text = mocker.patch("core.callback_handler.agent_tool_callback_handler.print_text")

        current_loop = handler.current_loop
        handler.on_agent_finish()

        assert handler.current_loop == current_loop + 1
        mock_print_text.assert_called()

    def test_on_datasource_start_debug_enabled(self, handler, enable_debug, mocker):
        mock_print_text = mocker.patch("core.callback_handler.agent_tool_callback_handler.print_text")

        handler.on_datasource_start("ds1", {"x": 1})

        mock_print_text.assert_called_once()

    def test_ignore_agent_property(self, disable_debug, handler):
        assert handler.ignore_agent is True

    def test_ignore_chat_model_property(self, disable_debug, handler):
        assert handler.ignore_chat_model is True

    def test_ignore_properties_when_debug_enabled(self, enable_debug, handler):
        assert handler.ignore_agent is False
        assert handler.ignore_chat_model is False
