from collections.abc import Callable, Iterable
from typing import override
from unittest.mock import MagicMock, call

import pytest
from pytest_mock import MockerFixture

from core.callback_handler.workflow_tool_callback_handler import (
    DifyWorkflowCallbackHandler,
)
from core.tools.entities.tool_entities import ToolInvokeMessage


class DummyToolInvokeMessage(ToolInvokeMessage):
    """Dummy whose serialized form is exactly the JSON the test passes in."""

    @override
    def model_dump_json(self, **kwargs: object) -> str:
        message = self.message
        assert isinstance(message, ToolInvokeMessage.TextMessage)
        return message.text


def _dummy_message(json_value: str) -> DummyToolInvokeMessage:
    return DummyToolInvokeMessage(
        type=ToolInvokeMessage.MessageType.TEXT,
        message=ToolInvokeMessage.TextMessage(text=json_value),
    )


@pytest.fixture
def handler() -> DifyWorkflowCallbackHandler:
    """Fixture to create handler instance with deterministic color."""
    instance = DifyWorkflowCallbackHandler()
    instance.color = "blue"
    return instance


@pytest.fixture
def mock_print_text(mocker: MockerFixture) -> MagicMock:
    """Mock print_text to avoid real stdout printing."""
    return mocker.patch("core.callback_handler.workflow_tool_callback_handler.print_text")


@pytest.fixture
def enable_debug(config_overrides: Callable[..., None]) -> None:
    """Force DEBUG on so the handler emits its verbose stdout traces."""
    config_overrides(DEBUG=True)


class TestDifyWorkflowCallbackHandler:
    def test_on_tool_execution_single_output_success(
        self, handler: DifyWorkflowCallbackHandler, mock_print_text: MagicMock, enable_debug: None
    ) -> None:
        # Arrange
        tool_name = "test_tool"
        tool_inputs = {"a": 1}
        message = _dummy_message('{"key": "value"}')

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

    def test_on_tool_execution_multiple_outputs(
        self, handler: DifyWorkflowCallbackHandler, mock_print_text: MagicMock, enable_debug: None
    ) -> None:
        # Arrange
        tool_name = "multi_tool"
        outputs = [
            _dummy_message('{"id": 1}'),
            _dummy_message('{"id": 2}'),
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

    def test_on_tool_execution_empty_iterable(
        self, handler: DifyWorkflowCallbackHandler, mock_print_text: MagicMock
    ) -> None:
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

    def test_on_tool_execution_skips_print_when_debug_disabled(
        self,
        handler: DifyWorkflowCallbackHandler,
        mock_print_text: MagicMock,
        config_overrides: Callable[..., None],
    ) -> None:
        """When DEBUG is off, outputs are still yielded but nothing is printed
        and model_dump_json() is never invoked."""
        # Arrange
        config_overrides(DEBUG=False)
        message = MagicMock()

        # Act
        results = list(
            handler.on_tool_execution(
                tool_name="quiet_tool",
                tool_inputs={},
                tool_outputs=[message],
            )
        )

        # Assert
        assert results == [message]
        mock_print_text.assert_not_called()
        message.model_dump_json.assert_not_called()

    @pytest.mark.parametrize(
        ("invalid_outputs", "expected_exception"),
        [
            (None, TypeError),
            (123, TypeError),
            ("not_iterable", AttributeError),
        ],
    )
    def test_on_tool_execution_invalid_outputs_type(
        self,
        handler: DifyWorkflowCallbackHandler,
        invalid_outputs: Iterable[ToolInvokeMessage],
        expected_exception: type[BaseException],
        enable_debug: None,
    ) -> None:
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

    def test_on_tool_execution_long_json_truncation(
        self, handler: DifyWorkflowCallbackHandler, mock_print_text: MagicMock, enable_debug: None
    ) -> None:
        # Arrange
        tool_name = "long_json_tool"
        long_json = "x" * 1500
        message = _dummy_message(long_json)

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

    def test_on_tool_execution_model_dump_json_exception(
        self, handler: DifyWorkflowCallbackHandler, mock_print_text: MagicMock, enable_debug: None
    ) -> None:
        # Arrange
        tool_name = "exception_tool"
        bad_message = MagicMock()
        bad_message.model_dump_json.side_effect = ValueError("JSON error")

        # Act & Assert
        with pytest.raises(ValueError, match="JSON error"):
            list(
                handler.on_tool_execution(
                    tool_name=tool_name,
                    tool_inputs={},
                    tool_outputs=[bad_message],
                )
            )

        # Ensure first two prints happened before failure
        assert mock_print_text.call_count >= 2
