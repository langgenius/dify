from unittest.mock import MagicMock, patch

import pytest

from core.model_runtime.entities.message_entities import AssistantPromptMessage
from core.model_runtime.model_providers.__base.large_language_model import _increase_tool_call

ToolCall = AssistantPromptMessage.ToolCall

# CASE 1: Single tool call
INPUTS_CASE_1 = [
    ToolCall(id="1", type="function", function=ToolCall.ToolCallFunction(name="func_foo", arguments="")),
    ToolCall(id="", type="function", function=ToolCall.ToolCallFunction(name="", arguments='{"arg1": ')),
    ToolCall(id="", type="function", function=ToolCall.ToolCallFunction(name="", arguments='"value"}')),
]
EXPECTED_CASE_1 = [
    ToolCall(
        id="1", type="function", function=ToolCall.ToolCallFunction(name="func_foo", arguments='{"arg1": "value"}')
    ),
]

# CASE 2: Tool call sequences where IDs are anchored to the first chunk (vLLM/SiliconFlow ...)
INPUTS_CASE_2 = [
    ToolCall(id="1", type="function", function=ToolCall.ToolCallFunction(name="func_foo", arguments="")),
    ToolCall(id="", type="function", function=ToolCall.ToolCallFunction(name="", arguments='{"arg1": ')),
    ToolCall(id="", type="function", function=ToolCall.ToolCallFunction(name="", arguments='"value"}')),
    ToolCall(id="2", type="function", function=ToolCall.ToolCallFunction(name="func_bar", arguments="")),
    ToolCall(id="", type="function", function=ToolCall.ToolCallFunction(name="", arguments='{"arg2": ')),
    ToolCall(id="", type="function", function=ToolCall.ToolCallFunction(name="", arguments='"value"}')),
]
EXPECTED_CASE_2 = [
    ToolCall(
        id="1", type="function", function=ToolCall.ToolCallFunction(name="func_foo", arguments='{"arg1": "value"}')
    ),
    ToolCall(
        id="2", type="function", function=ToolCall.ToolCallFunction(name="func_bar", arguments='{"arg2": "value"}')
    ),
]

# CASE 3: Tool call sequences where IDs are anchored to every chunk (SGLang ...)
INPUTS_CASE_3 = [
    ToolCall(id="1", type="function", function=ToolCall.ToolCallFunction(name="func_foo", arguments="")),
    ToolCall(id="1", type="function", function=ToolCall.ToolCallFunction(name="", arguments='{"arg1": ')),
    ToolCall(id="1", type="function", function=ToolCall.ToolCallFunction(name="", arguments='"value"}')),
    ToolCall(id="2", type="function", function=ToolCall.ToolCallFunction(name="func_bar", arguments="")),
    ToolCall(id="2", type="function", function=ToolCall.ToolCallFunction(name="", arguments='{"arg2": ')),
    ToolCall(id="2", type="function", function=ToolCall.ToolCallFunction(name="", arguments='"value"}')),
]
EXPECTED_CASE_3 = [
    ToolCall(
        id="1", type="function", function=ToolCall.ToolCallFunction(name="func_foo", arguments='{"arg1": "value"}')
    ),
    ToolCall(
        id="2", type="function", function=ToolCall.ToolCallFunction(name="func_bar", arguments='{"arg2": "value"}')
    ),
]

# CASE 4: Tool call sequences with no IDs
INPUTS_CASE_4 = [
    ToolCall(id="", type="function", function=ToolCall.ToolCallFunction(name="func_foo", arguments="")),
    ToolCall(id="", type="function", function=ToolCall.ToolCallFunction(name="", arguments='{"arg1": ')),
    ToolCall(id="", type="function", function=ToolCall.ToolCallFunction(name="", arguments='"value"}')),
    ToolCall(id="", type="function", function=ToolCall.ToolCallFunction(name="func_bar", arguments="")),
    ToolCall(id="", type="function", function=ToolCall.ToolCallFunction(name="", arguments='{"arg2": ')),
    ToolCall(id="", type="function", function=ToolCall.ToolCallFunction(name="", arguments='"value"}')),
]
EXPECTED_CASE_4 = [
    ToolCall(
        id="RANDOM_ID_1",
        type="function",
        function=ToolCall.ToolCallFunction(name="func_foo", arguments='{"arg1": "value"}'),
    ),
    ToolCall(
        id="RANDOM_ID_2",
        type="function",
        function=ToolCall.ToolCallFunction(name="func_bar", arguments='{"arg2": "value"}'),
    ),
]


def _run_case(inputs: list[ToolCall], expected: list[ToolCall]):
    actual = []
    _increase_tool_call(inputs, actual)
    assert actual == expected


def test__increase_tool_call():
    # case 1:
    _run_case(INPUTS_CASE_1, EXPECTED_CASE_1)

    # case 2:
    _run_case(INPUTS_CASE_2, EXPECTED_CASE_2)

    # case 3:
    _run_case(INPUTS_CASE_3, EXPECTED_CASE_3)

    # case 4:
    mock_id_generator = MagicMock()
    mock_id_generator.side_effect = [_exp_case.id for _exp_case in EXPECTED_CASE_4]
    with patch("core.model_runtime.model_providers.__base.large_language_model._gen_tool_call_id", mock_id_generator):
        _run_case(INPUTS_CASE_4, EXPECTED_CASE_4)


def test__increase_tool_call__no_id_no_name_first_delta_should_raise():
    inputs = [
        ToolCall(id="", type="function", function=ToolCall.ToolCallFunction(name="", arguments='{"arg1": ')),
        ToolCall(id="", type="function", function=ToolCall.ToolCallFunction(name="func_foo", arguments='"value"}')),
    ]
    actual: list[ToolCall] = []
    with patch("core.model_runtime.model_providers.__base.large_language_model._gen_tool_call_id", MagicMock()):
        with pytest.raises(ValueError):
            _increase_tool_call(inputs, actual)
