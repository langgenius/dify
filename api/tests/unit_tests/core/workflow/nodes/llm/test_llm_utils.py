from unittest import mock

import pytest

from core.model_manager import ModelInstance
from dify_graph.model_runtime.entities import ImagePromptMessageContent, PromptMessageRole, TextPromptMessageContent
from dify_graph.model_runtime.entities.message_entities import SystemPromptMessage
from dify_graph.nodes.llm import llm_utils
from dify_graph.nodes.llm.entities import LLMNodeChatModelMessage
from dify_graph.nodes.llm.exc import NoPromptFoundError
from dify_graph.runtime import VariablePool


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
