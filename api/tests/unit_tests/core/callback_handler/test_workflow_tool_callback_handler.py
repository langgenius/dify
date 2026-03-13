from unittest.mock import MagicMock, call

import pytest

from core.callback_handler.workflow_tool_callback_handler import (
    DifyWorkflowCallbackHandler,
)


class DummyToolInvokeMessage:
    """Lightweight dummy to simulate ToolInvokeMessage behavior."""

    def __init__(self, json_value: str):
        self._json_value = json_value

    def model_dump_json(self):
        return self._json_value


@pytest.fixture
def handler():
    """Fixture to create handler instance with deterministic color."""
    instance = DifyWorkflowCallbackHandler()
    instance.color = "blue"
    return instance


@pytest.fixture
def mock_print_text(mocker):
    """Mock print_text to avoid real stdout printing."""
    return mocker.patch("core.callback_handler.workflow_tool_callback_handler.print_text")


class TestDifyWorkflowCallbackHandler:
    def test_on_tool_execution_single_output_success(self, handler, mock_print_text):
        # Arrange
        tool_name = "test_tool"
        tool_inputs = {"a": 1}
        message = DummyToolInvokeMessage('{"key": "value"}')

        # Act
        results = list(
            handler.on_tool_execution(
                tool_name=tool_name,
                tool_inputs=tool_inputs,
                tool_outputs=[message],
            )
        )

        # Assert
        assert results == [message]
        assert mock_print_text.call_count == 4
        mock_print_text.assert_has_calls(
            [
                call("\n[on_tool_execution]\n", color="blue"),
                call("Tool: test_tool\n", color="blue"),
                call(
                    "Outputs: " + message.model_dump_json()[:1000] + "\n",
                    color="blue",
                ),
                call("\n"),
            ]
        )

    def test_on_tool_execution_multiple_outputs(self, handler, mock_print_text):
        # Arrange
        tool_name = "multi_tool"
        outputs = [
            DummyToolInvokeMessage('{"id": 1}'),
            DummyToolInvokeMessage('{"id": 2}'),
        ]

        # Act
        results = list(
            handler.on_tool_execution(
                tool_name=tool_name,
                tool_inputs={},
                tool_outputs=outputs,
            )
        )

        # Assert
        assert results == outputs
        assert mock_print_text.call_count == 4 * len(outputs)

    def test_on_tool_execution_empty_iterable(self, handler, mock_print_text):
        # Arrange
        tool_name = "empty_tool"

        # Act
        results = list(
            handler.on_tool_execution(
                tool_name=tool_name,
                tool_inputs={},
                tool_outputs=[],
            )
        )

        # Assert
        assert results == []
        mock_print_text.assert_not_called()

    @pytest.mark.parametrize(
        ("invalid_outputs", "expected_exception"),
        [
            (None, TypeError),
            (123, TypeError),
            ("not_iterable", AttributeError),
        ],
    )
    def test_on_tool_execution_invalid_outputs_type(self, handler, invalid_outputs, expected_exception):
        # Arrange
        tool_name = "invalid_tool"

        # Act & Assert
        with pytest.raises(expected_exception):
            list(
                handler.on_tool_execution(
                    tool_name=tool_name,
                    tool_inputs={},
                    tool_outputs=invalid_outputs,
                )
            )

    def test_on_tool_execution_long_json_truncation(self, handler, mock_print_text):
        # Arrange
        tool_name = "long_json_tool"
        long_json = "x" * 1500
        message = DummyToolInvokeMessage(long_json)

        # Act
        list(
            handler.on_tool_execution(
                tool_name=tool_name,
                tool_inputs={},
                tool_outputs=[message],
            )
        )

        # Assert
        expected_truncated = long_json[:1000]
        mock_print_text.assert_any_call(
            "Outputs: " + expected_truncated + "\n",
            color="blue",
        )

    def test_on_tool_execution_model_dump_json_exception(self, handler, mock_print_text):
        # Arrange
        tool_name = "exception_tool"
        bad_message = MagicMock()
        bad_message.model_dump_json.side_effect = ValueError("JSON error")

        # Act & Assert
        with pytest.raises(ValueError):
            list(
                handler.on_tool_execution(
                    tool_name=tool_name,
                    tool_inputs={},
                    tool_outputs=[bad_message],
                )
            )

        # Ensure first two prints happened before failure
        assert mock_print_text.call_count >= 2

    def test_on_tool_execution_none_message_id_and_trace_manager(self, handler, mock_print_text):
        # Arrange
        tool_name = "optional_params_tool"
        message = DummyToolInvokeMessage('{"data": "ok"}')

        # Act
        results = list(
            handler.on_tool_execution(
                tool_name=tool_name,
                tool_inputs={},
                tool_outputs=[message],
                message_id=None,
                timer=None,
                trace_manager=None,
            )
        )

        assert results == [message]
        assert mock_print_text.call_count == 4
