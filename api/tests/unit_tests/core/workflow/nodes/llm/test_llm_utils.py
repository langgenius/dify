from unittest import mock

import pytest
from graphon.file import File, FileTransferMethod, FileType
from graphon.model_runtime.entities import (
    ImagePromptMessageContent,
    PromptMessageRole,
    TextPromptMessageContent,
)
from graphon.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    SystemPromptMessage,
    UserPromptMessage,
)
from graphon.model_runtime.entities.model_entities import (
    AIModelEntity,
    FetchFrom,
    ModelFeature,
    ModelPropertyKey,
    ModelType,
    ParameterRule,
    ParameterType,
)
from graphon.nodes.base.entities import VariableSelector
from graphon.nodes.llm import llm_utils
from graphon.nodes.llm.entities import LLMNodeChatModelMessage, LLMNodeCompletionModelPromptTemplate, MemoryConfig
from graphon.nodes.llm.exc import (
    InvalidVariableTypeError,
    MemoryRolePrefixRequiredError,
    NoPromptFoundError,
    TemplateTypeNotSupportError,
)
from graphon.runtime import VariablePool
from graphon.variables import ArrayAnySegment, ArrayFileSegment, NoneSegment

from core.model_manager import ModelInstance


def _build_model_schema(
    *,
    features: list[ModelFeature] | None = None,
    model_properties: dict[ModelPropertyKey, object] | None = None,
    parameter_rules: list[ParameterRule] | None = None,
) -> AIModelEntity:
    return AIModelEntity(
        model="gpt-3.5-turbo",
        label={"en_US": "GPT-3.5 Turbo"},
        model_type=ModelType.LLM,
        fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
        features=features,
        model_properties=model_properties or {},
        parameter_rules=parameter_rules or [],
    )


def _build_model_instance(*, model_schema: AIModelEntity | None = None) -> mock.MagicMock:
    model_instance = mock.MagicMock(spec=ModelInstance)
    model_instance.model_name = "gpt-3.5-turbo"
    model_instance.parameters = {}
    model_instance.get_model_schema.return_value = model_schema or _build_model_schema(features=[])
    model_instance.get_llm_num_tokens.return_value = 0
    return model_instance


def _build_image_file(
    *,
    file_id: str,
    related_id: str,
    remote_url: str,
    extension: str = ".png",
    mime_type: str = "image/png",
) -> File:
    return File(
        id=file_id,
        type=FileType.IMAGE,
        filename=f"{file_id}{extension}",
        transfer_method=FileTransferMethod.REMOTE_URL,
        remote_url=remote_url,
        related_id=related_id,
        extension=extension,
        mime_type=mime_type,
        storage_key="",
    )


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
            "graphon.nodes.llm.llm_utils.fetch_model_schema",
            return_value=mock.MagicMock(features=[]),
        ),
        mock.patch(
            "graphon.nodes.llm.llm_utils.handle_list_messages",
            return_value=[SystemPromptMessage(content=content)],
        ),
        mock.patch(
            "graphon.nodes.llm.llm_utils.handle_memory_chat_mode",
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


def test_fetch_model_schema_raises_when_model_schema_is_missing():
    model_instance = _build_model_instance()
    model_instance.get_model_schema.return_value = None

    with pytest.raises(ValueError, match="Model schema not found for gpt-3.5-turbo"):
        llm_utils.fetch_model_schema(model_instance=model_instance)


def test_fetch_files_supports_known_segments_and_rejects_invalid_types():
    file = _build_image_file(file_id="image", related_id="image-related", remote_url="https://example.com/image.png")
    variable_pool = VariablePool.empty()
    variable_pool.add(["input", "file"], file)
    variable_pool.add(["input", "files"], ArrayFileSegment(value=[file]))
    variable_pool.add(["input", "none"], NoneSegment())
    variable_pool.add(["input", "empty"], ArrayAnySegment(value=[]))
    variable_pool.add(["input", "invalid"], {"a": 1})

    assert llm_utils.fetch_files(variable_pool, ["input", "file"]) == [file]
    assert llm_utils.fetch_files(variable_pool, ["input", "files"]) == [file]
    assert llm_utils.fetch_files(variable_pool, ["input", "none"]) == []
    assert llm_utils.fetch_files(variable_pool, ["input", "empty"]) == []

    with pytest.raises(InvalidVariableTypeError, match="Invalid variable type"):
        llm_utils.fetch_files(variable_pool, ["input", "invalid"])


def test_fetch_files_returns_empty_for_missing_variable():
    assert llm_utils.fetch_files(VariablePool.empty(), ["input", "missing"]) == []


def test_convert_history_messages_to_text_skips_system_messages_and_formats_images():
    history_text = llm_utils.convert_history_messages_to_text(
        history_messages=[
            SystemPromptMessage(content="skip"),
            UserPromptMessage(
                content=[
                    TextPromptMessageContent(data="Question"),
                    ImagePromptMessageContent(
                        format="png",
                        url="https://example.com/image.png",
                        mime_type="image/png",
                    ),
                ]
            ),
            AssistantPromptMessage(content="Answer"),
        ],
        human_prefix="Human",
        ai_prefix="Assistant",
    )

    assert history_text == "Human: Question\n[image]\nAssistant: Answer"


def test_fetch_memory_text_uses_prompt_memory_interface():
    memory = mock.MagicMock()
    memory.get_history_prompt_messages.return_value = [UserPromptMessage(content="Question")]

    memory_text = llm_utils.fetch_memory_text(
        memory=memory,
        max_token_limit=321,
        message_limit=2,
        human_prefix="Human",
        ai_prefix="Assistant",
    )

    assert memory_text == "Human: Question"
    memory.get_history_prompt_messages.assert_called_once_with(max_token_limit=321, message_limit=2)


def test_handle_list_messages_renders_jinja2_messages():
    variable_pool = VariablePool.empty()
    variable_pool.add(["input", "name"], "Dify")
    renderer = mock.MagicMock()
    renderer.render_template.return_value = "Hello Dify"

    prompt_messages = llm_utils.handle_list_messages(
        messages=[
            LLMNodeChatModelMessage(
                text="ignored",
                jinja2_text="Hello {{ name }}",
                role=PromptMessageRole.SYSTEM,
                edition_type="jinja2",
            )
        ],
        context="",
        jinja2_variables=[VariableSelector(variable="name", value_selector=["input", "name"])],
        variable_pool=variable_pool,
        vision_detail_config=ImagePromptMessageContent.DETAIL.HIGH,
        template_renderer=renderer,
    )

    assert prompt_messages == [SystemPromptMessage(content=[TextPromptMessageContent(data="Hello Dify")])]
    renderer.render_template.assert_called_once_with("Hello {{ name }}", {"name": "Dify"})


def test_handle_list_messages_splits_text_and_file_content():
    variable_pool = VariablePool.empty()
    image_file = _build_image_file(
        file_id="image-file",
        related_id="image-related",
        remote_url="https://example.com/file.png",
    )
    variable_pool.add(["input", "image"], image_file)

    with mock.patch(
        "graphon.nodes.llm.llm_utils.file_manager.to_prompt_message_content",
        return_value=ImagePromptMessageContent(
            format="png",
            url="https://example.com/file.png",
            mime_type="image/png",
            detail=ImagePromptMessageContent.DETAIL.HIGH,
        ),
    ) as mock_to_prompt:
        prompt_messages = llm_utils.handle_list_messages(
            messages=[
                LLMNodeChatModelMessage(
                    text="Analyze {{#input.image#}}",
                    role=PromptMessageRole.USER,
                    edition_type="basic",
                )
            ],
            context="",
            jinja2_variables=[],
            variable_pool=variable_pool,
            vision_detail_config=ImagePromptMessageContent.DETAIL.HIGH,
        )

    assert prompt_messages == [
        UserPromptMessage(content=[TextPromptMessageContent(data="Analyze ")]),
        UserPromptMessage(
            content=[
                ImagePromptMessageContent(
                    format="png",
                    url="https://example.com/file.png",
                    mime_type="image/png",
                    detail=ImagePromptMessageContent.DETAIL.HIGH,
                )
            ]
        ),
    ]
    mock_to_prompt.assert_called_once()


def test_handle_list_messages_supports_array_file_segments():
    variable_pool = VariablePool.empty()
    first_file = _build_image_file(file_id="first", related_id="first-related", remote_url="https://example.com/1.png")
    second_file = _build_image_file(
        file_id="second",
        related_id="second-related",
        remote_url="https://example.com/2.png",
    )
    variable_pool.add(["input", "images"], ArrayFileSegment(value=[first_file, second_file]))

    first_prompt = ImagePromptMessageContent(
        format="png",
        url="https://example.com/1.png",
        mime_type="image/png",
        detail=ImagePromptMessageContent.DETAIL.HIGH,
    )
    second_prompt = ImagePromptMessageContent(
        format="png",
        url="https://example.com/2.png",
        mime_type="image/png",
        detail=ImagePromptMessageContent.DETAIL.HIGH,
    )

    with mock.patch(
        "graphon.nodes.llm.llm_utils.file_manager.to_prompt_message_content",
        side_effect=[first_prompt, second_prompt],
    ):
        prompt_messages = llm_utils.handle_list_messages(
            messages=[
                LLMNodeChatModelMessage(
                    text="{{#input.images#}}",
                    role=PromptMessageRole.USER,
                    edition_type="basic",
                )
            ],
            context="",
            jinja2_variables=[],
            variable_pool=variable_pool,
            vision_detail_config=ImagePromptMessageContent.DETAIL.HIGH,
        )

    assert prompt_messages == [UserPromptMessage(content=[first_prompt, second_prompt])]


def test_render_jinja2_message_handles_empty_template_success_and_missing_renderer():
    variable_pool = VariablePool.empty()
    variable_pool.add(["input", "name"], "Dify")
    variables = [VariableSelector(variable="name", value_selector=["input", "name"])]

    assert (
        llm_utils.render_jinja2_message(
            template="",
            jinja2_variables=variables,
            variable_pool=variable_pool,
            template_renderer=None,
        )
        == ""
    )

    with pytest.raises(ValueError, match="template_renderer is required"):
        llm_utils.render_jinja2_message(
            template="Hello {{ name }}",
            jinja2_variables=variables,
            variable_pool=variable_pool,
            template_renderer=None,
        )

    renderer = mock.MagicMock()
    renderer.render_template.return_value = "Hello Dify"
    assert (
        llm_utils.render_jinja2_message(
            template="Hello {{ name }}",
            jinja2_variables=variables,
            variable_pool=variable_pool,
            template_renderer=renderer,
        )
        == "Hello Dify"
    )


def test_handle_completion_template_supports_basic_and_jinja2_templates():
    variable_pool = VariablePool.empty()
    variable_pool.add(["input", "name"], "Dify")
    renderer = mock.MagicMock()
    renderer.render_template.return_value = "Hello Dify"

    basic_messages = llm_utils.handle_completion_template(
        template=LLMNodeCompletionModelPromptTemplate(
            text="Summarize {{#context#}}",
            edition_type="basic",
        ),
        context="the docs",
        jinja2_variables=[],
        variable_pool=variable_pool,
    )
    jinja_messages = llm_utils.handle_completion_template(
        template=LLMNodeCompletionModelPromptTemplate(
            text="ignored",
            jinja2_text="Hello {{ name }}",
            edition_type="jinja2",
        ),
        context="",
        jinja2_variables=[VariableSelector(variable="name", value_selector=["input", "name"])],
        variable_pool=variable_pool,
        template_renderer=renderer,
    )

    assert basic_messages == [
        UserPromptMessage(content=[TextPromptMessageContent(data="Summarize the docs")]),
    ]
    assert jinja_messages == [
        UserPromptMessage(content=[TextPromptMessageContent(data="Hello Dify")]),
    ]


def test_combine_message_content_with_role_handles_all_supported_roles():
    contents = [TextPromptMessageContent(data="hello")]

    assert llm_utils.combine_message_content_with_role(contents=contents, role=PromptMessageRole.USER) == (
        UserPromptMessage(content=contents)
    )
    assert llm_utils.combine_message_content_with_role(contents=contents, role=PromptMessageRole.ASSISTANT) == (
        AssistantPromptMessage(content=contents)
    )
    assert llm_utils.combine_message_content_with_role(contents=contents, role=PromptMessageRole.SYSTEM) == (
        SystemPromptMessage(content=contents)
    )

    with pytest.raises(NotImplementedError, match="Role custom is not supported"):
        llm_utils.combine_message_content_with_role(contents=contents, role="custom")  # type: ignore[arg-type]


def test_calculate_rest_token_uses_context_size_and_template_alias():
    model_instance = _build_model_instance(
        model_schema=_build_model_schema(
            model_properties={ModelPropertyKey.CONTEXT_SIZE: 4096},
            parameter_rules=[
                ParameterRule(
                    name="output_limit",
                    use_template="max_tokens",
                    label={"en_US": "Output Limit"},
                    type=ParameterType.INT,
                )
            ],
        )
    )
    model_instance.parameters = {"max_tokens": 512}
    model_instance.get_llm_num_tokens.return_value = 256

    assert (
        llm_utils.calculate_rest_token(
            prompt_messages=[UserPromptMessage(content="hello")],
            model_instance=model_instance,
        )
        == 3328
    )


def test_handle_memory_chat_mode_returns_empty_without_memory_and_uses_window_when_present():
    model_instance = _build_model_instance()
    memory = mock.MagicMock()
    memory.get_history_prompt_messages.return_value = [UserPromptMessage(content="Question")]

    assert (
        llm_utils.handle_memory_chat_mode(
            memory=None,
            memory_config=None,
            model_instance=model_instance,
        )
        == []
    )

    with mock.patch("graphon.nodes.llm.llm_utils.calculate_rest_token", return_value=123) as mock_rest:
        messages = llm_utils.handle_memory_chat_mode(
            memory=memory,
            memory_config=MemoryConfig(window=MemoryConfig.WindowConfig(enabled=True, size=2)),
            model_instance=model_instance,
        )

    assert messages == [UserPromptMessage(content="Question")]
    mock_rest.assert_called_once()
    memory.get_history_prompt_messages.assert_called_once_with(max_token_limit=123, message_limit=2)


def test_handle_memory_completion_mode_validates_role_prefix_and_formats_history():
    model_instance = _build_model_instance()
    memory = mock.MagicMock()
    memory.get_history_prompt_messages.return_value = [
        UserPromptMessage(content="Question"),
        AssistantPromptMessage(content="Answer"),
    ]

    assert (
        llm_utils.handle_memory_completion_mode(
            memory=None,
            memory_config=None,
            model_instance=model_instance,
        )
        == ""
    )

    with (
        mock.patch("graphon.nodes.llm.llm_utils.calculate_rest_token", return_value=456),
        pytest.raises(MemoryRolePrefixRequiredError, match="Memory role prefix is required"),
    ):
        llm_utils.handle_memory_completion_mode(
            memory=memory,
            memory_config=MemoryConfig(window=MemoryConfig.WindowConfig(enabled=True, size=2)),
            model_instance=model_instance,
        )

    with mock.patch("graphon.nodes.llm.llm_utils.calculate_rest_token", return_value=456):
        history_text = llm_utils.handle_memory_completion_mode(
            memory=memory,
            memory_config=MemoryConfig(
                role_prefix=MemoryConfig.RolePrefix(user="Human", assistant="Assistant"),
                window=MemoryConfig.WindowConfig(enabled=False),
            ),
            model_instance=model_instance,
        )

    assert history_text == "Human: Question\nAssistant: Answer"
    memory.get_history_prompt_messages.assert_called_with(max_token_limit=456, message_limit=None)


def test_append_file_prompts_merges_with_existing_user_content_or_appends_new_message():
    file = _build_image_file(file_id="image", related_id="image-related", remote_url="https://example.com/image.png")
    file_prompt = ImagePromptMessageContent(
        format="png",
        url="https://example.com/image.png",
        mime_type="image/png",
        detail=ImagePromptMessageContent.DETAIL.HIGH,
    )
    prompt_messages = [UserPromptMessage(content=[TextPromptMessageContent(data="Question")])]

    with mock.patch(
        "graphon.nodes.llm.llm_utils.file_manager.to_prompt_message_content",
        return_value=file_prompt,
    ):
        llm_utils._append_file_prompts(
            prompt_messages=prompt_messages,
            files=[file],
            vision_enabled=True,
            vision_detail=ImagePromptMessageContent.DETAIL.HIGH,
        )

    assert prompt_messages == [
        UserPromptMessage(content=[file_prompt, TextPromptMessageContent(data="Question")]),
    ]

    prompt_messages = [SystemPromptMessage(content="System prompt")]
    with mock.patch(
        "graphon.nodes.llm.llm_utils.file_manager.to_prompt_message_content",
        return_value=file_prompt,
    ):
        llm_utils._append_file_prompts(
            prompt_messages=prompt_messages,
            files=[file],
            vision_enabled=True,
            vision_detail=ImagePromptMessageContent.DETAIL.HIGH,
        )

    assert prompt_messages[-1] == UserPromptMessage(content=[file_prompt])


def test_fetch_prompt_messages_chat_mode_includes_query_memory_and_supported_files():
    model_instance = _build_model_instance(model_schema=_build_model_schema(features=[ModelFeature.VISION]))
    memory = mock.MagicMock()
    memory.get_history_prompt_messages.return_value = [AssistantPromptMessage(content="history")]
    sys_file = _build_image_file(file_id="sys", related_id="sys-related", remote_url="https://example.com/sys.png")
    context_file = _build_image_file(
        file_id="context",
        related_id="context-related",
        remote_url="https://example.com/context.png",
    )
    file_prompts = [
        ImagePromptMessageContent(
            format="png",
            url="https://example.com/sys.png",
            mime_type="image/png",
            detail=ImagePromptMessageContent.DETAIL.HIGH,
        ),
        ImagePromptMessageContent(
            format="png",
            url="https://example.com/context.png",
            mime_type="image/png",
            detail=ImagePromptMessageContent.DETAIL.HIGH,
        ),
    ]

    with mock.patch(
        "graphon.nodes.llm.llm_utils.file_manager.to_prompt_message_content",
        side_effect=file_prompts,
    ):
        prompt_messages, stop = llm_utils.fetch_prompt_messages(
            sys_query="current question",
            sys_files=[sys_file],
            context="",
            memory=memory,
            model_instance=model_instance,
            prompt_template=[
                LLMNodeChatModelMessage(
                    text="Before query",
                    role=PromptMessageRole.USER,
                    edition_type="basic",
                )
            ],
            stop=("STOP",),
            memory_config=MemoryConfig(window=MemoryConfig.WindowConfig(enabled=False)),
            vision_enabled=True,
            vision_detail=ImagePromptMessageContent.DETAIL.HIGH,
            variable_pool=VariablePool.empty(),
            jinja2_variables=[],
            context_files=[context_file],
        )

    assert stop == ("STOP",)
    assert prompt_messages[0] == UserPromptMessage(content="Before query")
    assert prompt_messages[1] == AssistantPromptMessage(content="history")
    assert prompt_messages[2] == UserPromptMessage(
        content=[
            file_prompts[1],
            file_prompts[0],
            TextPromptMessageContent(data="current question"),
        ]
    )


def test_fetch_prompt_messages_completion_mode_updates_list_content_with_histories_and_query():
    model_instance = _build_model_instance(model_schema=_build_model_schema(features=[]))
    memory = mock.MagicMock()
    memory.get_history_prompt_messages.return_value = [
        UserPromptMessage(content="previous question"),
        AssistantPromptMessage(content="previous answer"),
    ]

    prompt_messages, stop = llm_utils.fetch_prompt_messages(
        sys_query="latest question",
        sys_files=[],
        context="",
        memory=memory,
        model_instance=model_instance,
        prompt_template=LLMNodeCompletionModelPromptTemplate(
            text="Prompt header\n#histories#",
            edition_type="basic",
        ),
        stop=("HALT",),
        memory_config=MemoryConfig(
            role_prefix=MemoryConfig.RolePrefix(user="Human", assistant="Assistant"),
            window=MemoryConfig.WindowConfig(enabled=True, size=2),
        ),
        vision_enabled=False,
        vision_detail=ImagePromptMessageContent.DETAIL.HIGH,
        variable_pool=VariablePool.empty(),
        jinja2_variables=[],
    )

    assert stop == ("HALT",)
    assert prompt_messages == [
        UserPromptMessage(
            content="latest question\nPrompt header\nHuman: previous question\nAssistant: previous answer"
        )
    ]

    memory.get_history_prompt_messages.return_value = [
        UserPromptMessage(content="another question"),
        AssistantPromptMessage(content="another answer"),
    ]

    prompt_messages, _ = llm_utils.fetch_prompt_messages(
        sys_query="latest question",
        sys_files=[],
        context="",
        memory=memory,
        model_instance=model_instance,
        prompt_template=LLMNodeCompletionModelPromptTemplate(
            text="Prompt header",
            edition_type="basic",
        ),
        stop=None,
        memory_config=MemoryConfig(
            role_prefix=MemoryConfig.RolePrefix(user="Human", assistant="Assistant"),
            window=MemoryConfig.WindowConfig(enabled=True, size=2),
        ),
        vision_enabled=False,
        vision_detail=ImagePromptMessageContent.DETAIL.HIGH,
        variable_pool=VariablePool.empty(),
        jinja2_variables=[],
    )

    assert prompt_messages == [
        UserPromptMessage(content="latest question\nHuman: another question\nAssistant: another answer\nPrompt header")
    ]


def test_fetch_prompt_messages_filters_content_unsupported_by_model_features():
    model_instance = _build_model_instance(model_schema=_build_model_schema(features=[ModelFeature.DOCUMENT]))
    prompt_template = [
        LLMNodeChatModelMessage(
            text="You are a classifier.",
            role=PromptMessageRole.SYSTEM,
            edition_type="basic",
        )
    ]

    with (
        mock.patch(
            "graphon.nodes.llm.llm_utils.handle_list_messages",
            return_value=[
                SystemPromptMessage(
                    content=[
                        TextPromptMessageContent(data="You are a classifier."),
                        ImagePromptMessageContent(
                            format="png",
                            url="https://example.com/image.png",
                            mime_type="image/png",
                        ),
                    ]
                )
            ],
        ),
        mock.patch("graphon.nodes.llm.llm_utils.handle_memory_chat_mode", return_value=[]),
    ):
        prompt_messages, stop = llm_utils.fetch_prompt_messages(
            sys_query=None,
            sys_files=[],
            context="",
            memory=None,
            model_instance=model_instance,
            prompt_template=prompt_template,
            stop=("END",),
            memory_config=None,
            vision_enabled=False,
            vision_detail=ImagePromptMessageContent.DETAIL.HIGH,
            variable_pool=VariablePool.empty(),
            jinja2_variables=[],
        )

    assert stop == ("END",)
    assert prompt_messages == [SystemPromptMessage(content="You are a classifier.")]


def test_fetch_prompt_messages_completion_mode_supports_string_content_and_invalid_template_type():
    model_instance = _build_model_instance(model_schema=_build_model_schema(features=[]))

    with (
        mock.patch(
            "graphon.nodes.llm.llm_utils.handle_completion_template",
            return_value=[UserPromptMessage(content="Prefix #histories# and #sys.query#")],
        ),
        mock.patch(
            "graphon.nodes.llm.llm_utils.handle_memory_completion_mode",
            return_value="history text",
        ),
    ):
        prompt_messages, stop = llm_utils.fetch_prompt_messages(
            sys_query="latest question",
            sys_files=[],
            context="",
            memory=None,
            model_instance=model_instance,
            prompt_template=LLMNodeCompletionModelPromptTemplate(
                text="ignored",
                edition_type="basic",
            ),
            stop=("HALT",),
            memory_config=None,
            vision_enabled=False,
            vision_detail=ImagePromptMessageContent.DETAIL.HIGH,
            variable_pool=VariablePool.empty(),
            jinja2_variables=[],
        )

    assert stop == ("HALT",)
    assert prompt_messages == [UserPromptMessage(content="Prefix history text and latest question")]

    with pytest.raises(TemplateTypeNotSupportError):
        llm_utils.fetch_prompt_messages(
            sys_query=None,
            sys_files=[],
            context="",
            memory=None,
            model_instance=model_instance,
            prompt_template=object(),  # type: ignore[arg-type]
            stop=None,
            memory_config=None,
            vision_enabled=False,
            vision_detail=ImagePromptMessageContent.DETAIL.HIGH,
            variable_pool=VariablePool.empty(),
            jinja2_variables=[],
        )

    invalid_prompt = mock.MagicMock()
    invalid_prompt.content = object()
    with (
        mock.patch(
            "graphon.nodes.llm.llm_utils.handle_completion_template",
            return_value=[invalid_prompt],
        ),
        mock.patch(
            "graphon.nodes.llm.llm_utils.handle_memory_completion_mode",
            return_value="history text",
        ),
        pytest.raises(ValueError, match="Invalid prompt content type"),
    ):
        llm_utils.fetch_prompt_messages(
            sys_query="latest question",
            sys_files=[],
            context="",
            memory=None,
            model_instance=model_instance,
            prompt_template=LLMNodeCompletionModelPromptTemplate(
                text="ignored",
                edition_type="basic",
            ),
            stop=None,
            memory_config=None,
            vision_enabled=False,
            vision_detail=ImagePromptMessageContent.DETAIL.HIGH,
            variable_pool=VariablePool.empty(),
            jinja2_variables=[],
        )

    with (
        mock.patch(
            "graphon.nodes.llm.llm_utils.handle_completion_template",
            return_value=[UserPromptMessage(content="Prefix only")],
        ),
        mock.patch(
            "graphon.nodes.llm.llm_utils.handle_memory_completion_mode",
            return_value="history text",
        ),
    ):
        prompt_messages, _ = llm_utils.fetch_prompt_messages(
            sys_query=None,
            sys_files=[],
            context="",
            memory=None,
            model_instance=model_instance,
            prompt_template=LLMNodeCompletionModelPromptTemplate(
                text="ignored",
                edition_type="basic",
            ),
            stop=None,
            memory_config=None,
            vision_enabled=False,
            vision_detail=ImagePromptMessageContent.DETAIL.HIGH,
            variable_pool=VariablePool.empty(),
            jinja2_variables=[],
        )

    assert prompt_messages == [UserPromptMessage(content="history text\nPrefix only")]
