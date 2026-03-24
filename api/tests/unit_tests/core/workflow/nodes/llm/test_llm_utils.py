"""Tests for llm_utils module, specifically multimodal content handling and prompt message construction."""

import string
from unittest import mock
from unittest.mock import patch

import pytest

from core.model_manager import ModelInstance
from dify_graph.model_runtime.entities import ImagePromptMessageContent, PromptMessageRole, TextPromptMessageContent
from dify_graph.model_runtime.entities.message_entities import (
    SystemPromptMessage,
    UserPromptMessage,
)
from dify_graph.nodes.llm import llm_utils
from dify_graph.nodes.llm.entities import LLMNodeChatModelMessage
from dify_graph.nodes.llm.exc import NoPromptFoundError
from dify_graph.nodes.llm.llm_utils import (
    _truncate_multimodal_content,
    build_context,
    restore_multimodal_content_in_messages,
)
from dify_graph.runtime import VariablePool


@pytest.fixture
def variable_pool() -> VariablePool:
    pool = VariablePool.empty()
    pool.add(["node1", "output"], "resolved_value")
    pool.add(["node2", "text"], "hello world")
    pool.add(["start", "user_input"], "dynamic_param")
    return pool


class TestTruncateMultimodalContent:
    """Tests for _truncate_multimodal_content function."""

    def test_returns_message_unchanged_for_string_content(self):
        """String content should pass through unchanged."""
        message = UserPromptMessage(content="Hello, world!")
        result = _truncate_multimodal_content(message)
        assert result.content == "Hello, world!"

    def test_returns_message_unchanged_for_none_content(self):
        """None content should pass through unchanged."""
        message = UserPromptMessage(content=None)
        result = _truncate_multimodal_content(message)
        assert result.content is None

    def test_clears_base64_when_file_ref_present(self):
        """When file_ref is present, base64_data and url should be cleared."""
        image_content = ImagePromptMessageContent(
            format="png",
            base64_data=string.ascii_lowercase,
            url="https://example.com/image.png",
            mime_type="image/png",
            filename="test.png",
            file_ref="local:test-file-id",
        )
        message = UserPromptMessage(content=[image_content])

        result = _truncate_multimodal_content(message)

        assert isinstance(result.content, list)
        assert len(result.content) == 1
        result_content = result.content[0]
        assert isinstance(result_content, ImagePromptMessageContent)
        assert result_content.base64_data == ""
        assert result_content.url == ""
        assert result_content.file_ref == "local:test-file-id"

    def test_truncates_base64_when_no_file_ref(self):
        """When file_ref is missing (legacy), base64_data should be truncated."""
        long_base64 = "a" * 100
        image_content = ImagePromptMessageContent(
            format="png",
            base64_data=long_base64,
            mime_type="image/png",
            filename="test.png",
            file_ref=None,
        )
        message = UserPromptMessage(content=[image_content])

        result = _truncate_multimodal_content(message)

        assert isinstance(result.content, list)
        result_content = result.content[0]
        assert isinstance(result_content, ImagePromptMessageContent)
        assert "...[TRUNCATED]..." in result_content.base64_data
        assert len(result_content.base64_data) < len(long_base64)

    def test_preserves_text_content(self):
        """Text content should pass through unchanged."""
        text_content = TextPromptMessageContent(data="Hello!")
        image_content = ImagePromptMessageContent(
            format="png",
            base64_data="test123",
            mime_type="image/png",
            file_ref="local:file-id",
        )
        message = UserPromptMessage(content=[text_content, image_content])

        result = _truncate_multimodal_content(message)

        assert isinstance(result.content, list)
        assert len(result.content) == 2
        assert result.content[0].data == "Hello!"
        assert result.content[1].base64_data == ""


class TestBuildContext:
    """Tests for build_context function."""

    def test_excludes_system_messages(self):
        """System messages should be excluded from context."""
        messages = [
            SystemPromptMessage(content="You are a helpful assistant."),
            UserPromptMessage(content="Hello!"),
        ]

        context = build_context(messages, "Hi there!")

        assert len(context) == 2
        assert context[0].content == "Hello!"
        assert context[1].content == "Hi there!"

    def test_appends_assistant_response(self):
        """Assistant response should be appended to context."""
        messages = [UserPromptMessage(content="What is 2+2?")]

        context = build_context(messages, "The answer is 4.")

        assert len(context) == 2
        assert context[1].content == "The answer is 4."

    def test_builds_context_with_tool_calls_from_generation_data(self):
        """Should reconstruct full conversation including tool calls when generation_data is provided."""
        from dify_graph.model_runtime.entities.llm_entities import LLMUsage
        from dify_graph.model_runtime.entities.message_entities import (
            AssistantPromptMessage,
            ToolPromptMessage,
        )
        from dify_graph.nodes.llm.entities import (
            LLMGenerationData,
            LLMTraceSegment,
            ModelTraceSegment,
            ToolCall,
            ToolTraceSegment,
        )

        messages = [UserPromptMessage(content="What's the weather in Beijing?")]

        generation_data = LLMGenerationData(
            text="The weather in Beijing is sunny, 25°C.",
            reasoning_contents=[],
            tool_calls=[],
            sequence=[],
            usage=LLMUsage.empty_usage(),
            finish_reason="stop",
            files=[],
            trace=[
                LLMTraceSegment(
                    type="model",
                    duration=0.5,
                    usage=None,
                    output=ModelTraceSegment(
                        text="Let me check the weather.",
                        reasoning=None,
                        tool_calls=[
                            ToolCall(
                                id="call_123",
                                name="get_weather",
                                arguments='{"city": "Beijing"}',
                            )
                        ],
                    ),
                ),
                LLMTraceSegment(
                    type="tool",
                    duration=0.3,
                    usage=None,
                    output=ToolTraceSegment(
                        id="call_123",
                        name="get_weather",
                        arguments='{"city": "Beijing"}',
                        output="Sunny, 25°C",
                    ),
                ),
            ],
        )

        accumulated_response = "Let me check the weather.The weather in Beijing is sunny, 25°C."
        context = build_context(messages, accumulated_response, generation_data)

        assert len(context) == 4
        assert context[0].content == "What's the weather in Beijing?"
        assert isinstance(context[1], AssistantPromptMessage)
        assert context[1].content == "Let me check the weather."
        assert len(context[1].tool_calls) == 1
        assert context[1].tool_calls[0].id == "call_123"
        assert context[1].tool_calls[0].function.name == "get_weather"
        assert isinstance(context[2], ToolPromptMessage)
        assert context[2].content == "Sunny, 25°C"
        assert context[2].tool_call_id == "call_123"
        assert isinstance(context[3], AssistantPromptMessage)
        assert context[3].content == "The weather in Beijing is sunny, 25°C."

    def test_builds_context_with_multiple_tool_calls(self):
        """Should handle multiple tool calls in a single conversation."""
        from dify_graph.model_runtime.entities.llm_entities import LLMUsage
        from dify_graph.model_runtime.entities.message_entities import (
            AssistantPromptMessage,
            ToolPromptMessage,
        )
        from dify_graph.nodes.llm.entities import (
            LLMGenerationData,
            LLMTraceSegment,
            ModelTraceSegment,
            ToolCall,
            ToolTraceSegment,
        )

        messages = [UserPromptMessage(content="Compare weather in Beijing and Shanghai")]

        generation_data = LLMGenerationData(
            text="Beijing is sunny at 25°C, Shanghai is cloudy at 22°C.",
            reasoning_contents=[],
            tool_calls=[],
            sequence=[],
            usage=LLMUsage.empty_usage(),
            finish_reason="stop",
            files=[],
            trace=[
                LLMTraceSegment(
                    type="model",
                    duration=0.5,
                    usage=None,
                    output=ModelTraceSegment(
                        text="I'll check both cities.",
                        reasoning=None,
                        tool_calls=[
                            ToolCall(id="call_1", name="get_weather", arguments='{"city": "Beijing"}'),
                            ToolCall(id="call_2", name="get_weather", arguments='{"city": "Shanghai"}'),
                        ],
                    ),
                ),
                LLMTraceSegment(
                    type="tool",
                    duration=0.2,
                    usage=None,
                    output=ToolTraceSegment(
                        id="call_1",
                        name="get_weather",
                        arguments='{"city": "Beijing"}',
                        output="Sunny, 25°C",
                    ),
                ),
                LLMTraceSegment(
                    type="tool",
                    duration=0.2,
                    usage=None,
                    output=ToolTraceSegment(
                        id="call_2",
                        name="get_weather",
                        arguments='{"city": "Shanghai"}',
                        output="Cloudy, 22°C",
                    ),
                ),
            ],
        )

        accumulated_response = "I'll check both cities.Beijing is sunny at 25°C, Shanghai is cloudy at 22°C."
        context = build_context(messages, accumulated_response, generation_data)

        assert len(context) == 5
        assert context[0].content == "Compare weather in Beijing and Shanghai"
        assert isinstance(context[1], AssistantPromptMessage)
        assert len(context[1].tool_calls) == 2
        assert isinstance(context[2], ToolPromptMessage)
        assert context[2].content == "Sunny, 25°C"
        assert isinstance(context[3], ToolPromptMessage)
        assert context[3].content == "Cloudy, 22°C"
        assert isinstance(context[4], AssistantPromptMessage)
        assert context[4].content == "Beijing is sunny at 25°C, Shanghai is cloudy at 22°C."

    def test_builds_context_without_generation_data(self):
        """Should fallback to simple context when no generation_data is provided."""
        messages = [UserPromptMessage(content="Hello!")]

        context = build_context(messages, "Hi there!", generation_data=None)

        assert len(context) == 2
        assert context[0].content == "Hello!"
        assert context[1].content == "Hi there!"

    def test_builds_context_with_empty_trace(self):
        """Should fallback to simple context when trace is empty."""
        from dify_graph.model_runtime.entities.llm_entities import LLMUsage
        from dify_graph.nodes.llm.entities import LLMGenerationData

        messages = [UserPromptMessage(content="Hello!")]

        generation_data = LLMGenerationData(
            text="Hi there!",
            reasoning_contents=[],
            tool_calls=[],
            sequence=[],
            usage=LLMUsage.empty_usage(),
            finish_reason="stop",
            files=[],
            trace=[],
        )

        context = build_context(messages, "Hi there!", generation_data)

        assert len(context) == 2
        assert context[0].content == "Hello!"
        assert context[1].content == "Hi there!"


class TestRestoreMultimodalContentInMessages:
    """Tests for restore_multimodal_content_in_messages function."""

    @patch("dify_graph.file.file_manager.restore_multimodal_content")
    def test_restores_multimodal_content(self, mock_restore):
        """Should restore multimodal content in messages."""
        restored_content = ImagePromptMessageContent(
            format="png",
            base64_data="restored-base64",
            mime_type="image/png",
            file_ref="local:abc123",
        )
        mock_restore.return_value = restored_content

        truncated_content = ImagePromptMessageContent(
            format="png",
            base64_data="",
            mime_type="image/png",
            file_ref="local:abc123",
        )
        message = UserPromptMessage(content=[truncated_content])

        result = restore_multimodal_content_in_messages([message])

        assert len(result) == 1
        assert result[0].content[0].base64_data == "restored-base64"
        mock_restore.assert_called_once()

    def test_passes_through_string_content(self):
        """String content should pass through unchanged."""
        message = UserPromptMessage(content="Hello!")

        result = restore_multimodal_content_in_messages([message])

        assert len(result) == 1
        assert result[0].content == "Hello!"

    def test_passes_through_text_content(self):
        """TextPromptMessageContent should pass through unchanged."""
        text_content = TextPromptMessageContent(data="Hello!")
        message = UserPromptMessage(content=[text_content])

        result = restore_multimodal_content_in_messages([message])

        assert len(result) == 1
        assert result[0].content[0].data == "Hello!"


def _fetch_prompt_messages_with_mocked_content(content):
    variable_pool = VariablePool.empty()
    model_instance = mock.MagicMock(spec=ModelInstance)
    prompt_template = [
        LLMNodeChatModelMessage(
            text="You are a classifier.",
            role=PromptMessageRole.SYSTEM,
            edition_type="basic",
        )
    ]

    with (
        mock.patch(
            "dify_graph.nodes.llm.llm_utils.fetch_model_schema",
            return_value=mock.MagicMock(features=[]),
        ),
        mock.patch(
            "dify_graph.nodes.llm.llm_utils.handle_list_messages",
            return_value=[SystemPromptMessage(content=content)],
        ),
        mock.patch(
            "dify_graph.nodes.llm.llm_utils.handle_memory_chat_mode",
            return_value=[],
        ),
    ):
        return llm_utils.fetch_prompt_messages(
            sys_query=None,
            sys_files=[],
            context=None,
            memory=None,
            model_instance=model_instance,
            prompt_template=prompt_template,
            stop=["END"],
            memory_config=None,
            vision_enabled=False,
            vision_detail=ImagePromptMessageContent.DETAIL.HIGH,
            variable_pool=variable_pool,
            jinja2_variables=[],
            template_renderer=None,
        )


class TestTypeCoercionViaResolve:
    """Type coercion is tested through the public resolve_completion_params_variables API."""

    def test_numeric_string_coerced_to_float(self):
        pool = VariablePool.empty()
        pool.add(["n", "v"], "0.7")
        result = llm_utils.resolve_completion_params_variables({"p": "{{#n.v#}}"}, pool)
        assert result["p"] == 0.7

    def test_integer_string_coerced_to_int(self):
        pool = VariablePool.empty()
        pool.add(["n", "v"], "1024")
        result = llm_utils.resolve_completion_params_variables({"p": "{{#n.v#}}"}, pool)
        assert result["p"] == 1024

    def test_boolean_string_coerced_to_bool(self):
        pool = VariablePool.empty()
        pool.add(["n", "v"], "true")
        result = llm_utils.resolve_completion_params_variables({"p": "{{#n.v#}}"}, pool)
        assert result["p"] is True

    def test_plain_string_stays_string(self):
        pool = VariablePool.empty()
        pool.add(["n", "v"], "json_object")
        result = llm_utils.resolve_completion_params_variables({"p": "{{#n.v#}}"}, pool)
        assert result["p"] == "json_object"

    def test_json_object_string_stays_string(self):
        pool = VariablePool.empty()
        pool.add(["n", "v"], '{"key": "val"}')
        result = llm_utils.resolve_completion_params_variables({"p": "{{#n.v#}}"}, pool)
        assert result["p"] == '{"key": "val"}'

    def test_mixed_text_and_variable_stays_string(self):
        pool = VariablePool.empty()
        pool.add(["n", "v"], "0.7")
        result = llm_utils.resolve_completion_params_variables({"p": "val={{#n.v#}}"}, pool)
        assert result["p"] == "val=0.7"


class TestResolveCompletionParamsVariables:
    def test_plain_string_values_unchanged(self, variable_pool: VariablePool):
        params = {"response_format": "json", "custom_param": "static_value"}

        result = llm_utils.resolve_completion_params_variables(params, variable_pool)

        assert result == {"response_format": "json", "custom_param": "static_value"}

    def test_numeric_values_unchanged(self, variable_pool: VariablePool):
        params = {"temperature": 0.7, "top_p": 0.9, "max_tokens": 1024}

        result = llm_utils.resolve_completion_params_variables(params, variable_pool)

        assert result == {"temperature": 0.7, "top_p": 0.9, "max_tokens": 1024}

    def test_boolean_values_unchanged(self, variable_pool: VariablePool):
        params = {"stream": True, "echo": False}

        result = llm_utils.resolve_completion_params_variables(params, variable_pool)

        assert result == {"stream": True, "echo": False}

    def test_list_values_unchanged(self, variable_pool: VariablePool):
        params = {"stop": ["Human:", "Assistant:"]}

        result = llm_utils.resolve_completion_params_variables(params, variable_pool)

        assert result == {"stop": ["Human:", "Assistant:"]}

    def test_single_variable_reference_resolved(self, variable_pool: VariablePool):
        params = {"response_format": "{{#node1.output#}}"}

        result = llm_utils.resolve_completion_params_variables(params, variable_pool)

        assert result == {"response_format": "resolved_value"}

    def test_multiple_variable_references_resolved(self, variable_pool: VariablePool):
        params = {
            "param_a": "{{#node1.output#}}",
            "param_b": "{{#node2.text#}}",
        }

        result = llm_utils.resolve_completion_params_variables(params, variable_pool)

        assert result == {"param_a": "resolved_value", "param_b": "hello world"}

    def test_mixed_text_and_variable_resolved(self, variable_pool: VariablePool):
        params = {"prompt_prefix": "prefix_{{#node1.output#}}_suffix"}

        result = llm_utils.resolve_completion_params_variables(params, variable_pool)

        assert result == {"prompt_prefix": "prefix_resolved_value_suffix"}

    def test_mixed_params_types(self, variable_pool: VariablePool):
        params = {
            "temperature": 0.7,
            "response_format": "{{#node1.output#}}",
            "custom_string": "no_vars_here",
            "max_tokens": 512,
            "stop": ["\n"],
        }

        result = llm_utils.resolve_completion_params_variables(params, variable_pool)

        assert result == {
            "temperature": 0.7,
            "response_format": "resolved_value",
            "custom_string": "no_vars_here",
            "max_tokens": 512,
            "stop": ["\n"],
        }

    def test_empty_params(self, variable_pool: VariablePool):
        result = llm_utils.resolve_completion_params_variables({}, variable_pool)

        assert result == {}

    def test_unresolvable_variable_keeps_selector_text(self):
        pool = VariablePool.empty()
        params = {"format": "{{#nonexistent.var#}}"}

        result = llm_utils.resolve_completion_params_variables(params, pool)

        assert result["format"] == "nonexistent.var"

    def test_multiple_variables_in_single_value(self, variable_pool: VariablePool):
        params = {"combined": "{{#node1.output#}} and {{#node2.text#}}"}

        result = llm_utils.resolve_completion_params_variables(params, variable_pool)

        assert result == {"combined": "resolved_value and hello world"}

    def test_original_params_not_mutated(self, variable_pool: VariablePool):
        original = {"response_format": "{{#node1.output#}}", "temperature": 0.5}
        original_copy = dict(original)

        _ = llm_utils.resolve_completion_params_variables(original, variable_pool)

        assert original == original_copy

    def test_long_value_truncated(self):
        pool = VariablePool.empty()
        pool.add(["node1", "big"], "x" * 2000)
        params = {"param": "{{#node1.big#}}"}

        result = llm_utils.resolve_completion_params_variables(params, pool)

        assert len(result["param"]) == llm_utils.MAX_RESOLVED_VALUE_LENGTH


class TestTypeCoercionViaResolve:
    """Type coercion is tested through the public resolve_completion_params_variables API."""

    def test_numeric_string_coerced_to_float(self):
        pool = VariablePool.empty()
        pool.add(["n", "v"], "0.7")
        result = llm_utils.resolve_completion_params_variables({"p": "{{#n.v#}}"}, pool)
        assert result["p"] == 0.7

    def test_integer_string_coerced_to_int(self):
        pool = VariablePool.empty()
        pool.add(["n", "v"], "1024")
        result = llm_utils.resolve_completion_params_variables({"p": "{{#n.v#}}"}, pool)
        assert result["p"] == 1024

    def test_boolean_string_coerced_to_bool(self):
        pool = VariablePool.empty()
        pool.add(["n", "v"], "true")
        result = llm_utils.resolve_completion_params_variables({"p": "{{#n.v#}}"}, pool)
        assert result["p"] is True

    def test_plain_string_stays_string(self):
        pool = VariablePool.empty()
        pool.add(["n", "v"], "json_object")
        result = llm_utils.resolve_completion_params_variables({"p": "{{#n.v#}}"}, pool)
        assert result["p"] == "json_object"

    def test_json_object_string_stays_string(self):
        pool = VariablePool.empty()
        pool.add(["n", "v"], '{"key": "val"}')
        result = llm_utils.resolve_completion_params_variables({"p": "{{#n.v#}}"}, pool)
        assert result["p"] == '{"key": "val"}'

    def test_mixed_text_and_variable_stays_string(self):
        pool = VariablePool.empty()
        pool.add(["n", "v"], "0.7")
        result = llm_utils.resolve_completion_params_variables({"p": "val={{#n.v#}}"}, pool)
        assert result["p"] == "val=0.7"


class TestResolveCompletionParamsVariables:
    def test_plain_string_values_unchanged(self, variable_pool: VariablePool):
        params = {"response_format": "json", "custom_param": "static_value"}

        result = llm_utils.resolve_completion_params_variables(params, variable_pool)

        assert result == {"response_format": "json", "custom_param": "static_value"}

    def test_numeric_values_unchanged(self, variable_pool: VariablePool):
        params = {"temperature": 0.7, "top_p": 0.9, "max_tokens": 1024}

        result = llm_utils.resolve_completion_params_variables(params, variable_pool)

        assert result == {"temperature": 0.7, "top_p": 0.9, "max_tokens": 1024}

    def test_boolean_values_unchanged(self, variable_pool: VariablePool):
        params = {"stream": True, "echo": False}

        result = llm_utils.resolve_completion_params_variables(params, variable_pool)

        assert result == {"stream": True, "echo": False}

    def test_list_values_unchanged(self, variable_pool: VariablePool):
        params = {"stop": ["Human:", "Assistant:"]}

        result = llm_utils.resolve_completion_params_variables(params, variable_pool)

        assert result == {"stop": ["Human:", "Assistant:"]}

    def test_single_variable_reference_resolved(self, variable_pool: VariablePool):
        params = {"response_format": "{{#node1.output#}}"}

        result = llm_utils.resolve_completion_params_variables(params, variable_pool)

        assert result == {"response_format": "resolved_value"}

    def test_multiple_variable_references_resolved(self, variable_pool: VariablePool):
        params = {
            "param_a": "{{#node1.output#}}",
            "param_b": "{{#node2.text#}}",
        }

        result = llm_utils.resolve_completion_params_variables(params, variable_pool)

        assert result == {"param_a": "resolved_value", "param_b": "hello world"}

    def test_mixed_text_and_variable_resolved(self, variable_pool: VariablePool):
        params = {"prompt_prefix": "prefix_{{#node1.output#}}_suffix"}

        result = llm_utils.resolve_completion_params_variables(params, variable_pool)

        assert result == {"prompt_prefix": "prefix_resolved_value_suffix"}

    def test_mixed_params_types(self, variable_pool: VariablePool):
        """Non-string params pass through; string params with variables get resolved."""
        params = {
            "temperature": 0.7,
            "response_format": "{{#node1.output#}}",
            "custom_string": "no_vars_here",
            "max_tokens": 512,
            "stop": ["\n"],
        }

        result = llm_utils.resolve_completion_params_variables(params, variable_pool)

        assert result == {
            "temperature": 0.7,
            "response_format": "resolved_value",
            "custom_string": "no_vars_here",
            "max_tokens": 512,
            "stop": ["\n"],
        }

    def test_empty_params(self, variable_pool: VariablePool):
        result = llm_utils.resolve_completion_params_variables({}, variable_pool)

        assert result == {}

    def test_unresolvable_variable_keeps_selector_text(self):
        """When a referenced variable doesn't exist in the pool, convert_template
        falls back to the raw selector path (e.g. 'nonexistent.var')."""
        pool = VariablePool.empty()
        params = {"format": "{{#nonexistent.var#}}"}

        result = llm_utils.resolve_completion_params_variables(params, pool)

        assert result["format"] == "nonexistent.var"

    def test_multiple_variables_in_single_value(self, variable_pool: VariablePool):
        params = {"combined": "{{#node1.output#}} and {{#node2.text#}}"}

        result = llm_utils.resolve_completion_params_variables(params, variable_pool)

        assert result == {"combined": "resolved_value and hello world"}

    def test_original_params_not_mutated(self, variable_pool: VariablePool):
        original = {"response_format": "{{#node1.output#}}", "temperature": 0.5}
        original_copy = dict(original)

        _ = llm_utils.resolve_completion_params_variables(original, variable_pool)

        assert original == original_copy

    def test_long_value_truncated(self):
        pool = VariablePool.empty()
        pool.add(["node1", "big"], "x" * 2000)
        params = {"param": "{{#node1.big#}}"}

        result = llm_utils.resolve_completion_params_variables(params, pool)

        assert len(result["param"]) == llm_utils.MAX_RESOLVED_VALUE_LENGTH


def test_fetch_prompt_messages_skips_messages_when_all_contents_are_filtered_out():
    with pytest.raises(NoPromptFoundError):
        _fetch_prompt_messages_with_mocked_content(
            [
                ImagePromptMessageContent(
                    format="url",
                    url="https://example.com/image.png",
                    mime_type="image/png",
                ),
            ]
        )


def test_fetch_prompt_messages_flattens_single_text_content_after_filtering_unsupported_multimodal_items():
    prompt_messages, stop = _fetch_prompt_messages_with_mocked_content(
        [
            TextPromptMessageContent(data="You are a classifier."),
            ImagePromptMessageContent(
                format="url",
                url="https://example.com/image.png",
                mime_type="image/png",
            ),
        ]
    )

    assert stop == ["END"]
    assert prompt_messages == [SystemPromptMessage(content="You are a classifier.")]


def test_fetch_prompt_messages_keeps_list_content_when_multiple_supported_items_remain():
    prompt_messages, stop = _fetch_prompt_messages_with_mocked_content(
        [
            TextPromptMessageContent(data="You are"),
            TextPromptMessageContent(data=" a classifier."),
            ImagePromptMessageContent(
                format="url",
                url="https://example.com/image.png",
                mime_type="image/png",
            ),
        ]
    )

    assert stop == ["END"]
    assert prompt_messages == [
        SystemPromptMessage(
            content=[
                TextPromptMessageContent(data="You are"),
                TextPromptMessageContent(data=" a classifier."),
            ]
        )
    ]
