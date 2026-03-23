from unittest import mock

import pytest

from core.model_manager import ModelInstance
from dify_graph.model_runtime.entities import (
    ImagePromptMessageContent,
    PromptMessageRole,
    TextPromptMessageContent,
)
from dify_graph.model_runtime.entities.message_entities import SystemPromptMessage
from dify_graph.nodes.llm import llm_utils
from dify_graph.nodes.llm.entities import LLMNodeChatModelMessage
from dify_graph.nodes.llm.exc import NoPromptFoundError
from dify_graph.runtime import VariablePool


@pytest.fixture
def variable_pool() -> VariablePool:
    pool = VariablePool.empty()
    pool.add(["node1", "output"], "resolved_value")
    pool.add(["node2", "text"], "hello world")
    pool.add(["start", "user_input"], "dynamic_param")
    return pool


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
