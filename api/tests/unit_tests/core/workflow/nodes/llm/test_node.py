import base64
import uuid
from collections.abc import Sequence
from typing import Optional
from unittest import mock

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom, ModelConfigWithCredentialsEntity
from core.entities.provider_configuration import ProviderConfiguration, ProviderModelBundle
from core.entities.provider_entities import CustomConfiguration, SystemConfiguration
from core.file import File, FileTransferMethod, FileType
from core.model_runtime.entities.common_entities import I18nObject
from core.model_runtime.entities.message_entities import (
    ImagePromptMessageContent,
    PromptMessage,
    PromptMessageRole,
    TextPromptMessageContent,
    UserPromptMessage,
)
from core.model_runtime.entities.model_entities import AIModelEntity, FetchFrom, ModelType
from core.model_runtime.model_providers.model_provider_factory import ModelProviderFactory
from core.variables import ArrayAnySegment, ArrayFileSegment, NoneSegment
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.graph_engine import Graph, GraphInitParams, GraphRuntimeState
from core.workflow.nodes.answer import AnswerStreamGenerateRoute
from core.workflow.nodes.end import EndStreamParam
from core.workflow.nodes.llm.entities import (
    ContextConfig,
    LLMNodeChatModelMessage,
    LLMNodeData,
    ModelConfig,
    VisionConfig,
    VisionConfigOptions,
)
from core.workflow.nodes.llm.file_saver import LLMFileSaver
from core.workflow.nodes.llm.node import LLMNode
from models.enums import UserFrom
from models.provider import ProviderType
from models.workflow import WorkflowType


class MockTokenBufferMemory:
    def __init__(self, history_messages=None):
        self.history_messages = history_messages or []

    def get_history_prompt_messages(
        self, max_token_limit: int = 2000, message_limit: Optional[int] = None
    ) -> Sequence[PromptMessage]:
        if message_limit is not None:
            return self.history_messages[-message_limit * 2 :]
        return self.history_messages


@pytest.fixture
def llm_node_data() -> LLMNodeData:
    return LLMNodeData(
        title="Test LLM",
        model=ModelConfig(provider="openai", name="gpt-3.5-turbo", mode="chat", completion_params={}),
        prompt_template=[],
        memory=None,
        context=ContextConfig(enabled=False),
        vision=VisionConfig(
            enabled=True,
            configs=VisionConfigOptions(
                variable_selector=["sys", "files"],
                detail=ImagePromptMessageContent.DETAIL.HIGH,
            ),
        ),
    )


@pytest.fixture
def graph_init_params() -> GraphInitParams:
    return GraphInitParams(
        tenant_id="1",
        app_id="1",
        workflow_type=WorkflowType.WORKFLOW,
        workflow_id="1",
        graph_config={},
        user_id="1",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.SERVICE_API,
        call_depth=0,
    )


@pytest.fixture
def graph() -> Graph:
    return Graph(
        root_node_id="1",
        answer_stream_generate_routes=AnswerStreamGenerateRoute(
            answer_dependencies={},
            answer_generate_route={},
        ),
        end_stream_param=EndStreamParam(
            end_dependencies={},
            end_stream_variable_selector_mapping={},
        ),
    )


@pytest.fixture
def graph_runtime_state() -> GraphRuntimeState:
    variable_pool = VariablePool(
        system_variables={},
        user_inputs={},
    )
    return GraphRuntimeState(
        variable_pool=variable_pool,
        start_at=0,
    )


@pytest.fixture
def llm_node(
    llm_node_data: LLMNodeData, graph_init_params: GraphInitParams, graph: Graph, graph_runtime_state: GraphRuntimeState
) -> LLMNode:
    mock_file_saver = mock.MagicMock(spec=LLMFileSaver)
    node = LLMNode(
        id="1",
        config={
            "id": "1",
            "data": llm_node_data.model_dump(),
        },
        graph_init_params=graph_init_params,
        graph=graph,
        graph_runtime_state=graph_runtime_state,
        llm_file_saver=mock_file_saver,
    )
    return node


@pytest.fixture
def model_config():
    # Create actual provider and model type instances
    model_provider_factory = ModelProviderFactory(tenant_id="test")
    provider_instance = model_provider_factory.get_plugin_model_provider("openai")
    model_type_instance = model_provider_factory.get_model_type_instance("openai", ModelType.LLM)

    # Create a ProviderModelBundle
    provider_model_bundle = ProviderModelBundle(
        configuration=ProviderConfiguration(
            tenant_id="1",
            provider=provider_instance,
            preferred_provider_type=ProviderType.CUSTOM,
            using_provider_type=ProviderType.CUSTOM,
            system_configuration=SystemConfiguration(enabled=False),
            custom_configuration=CustomConfiguration(provider=None),
            model_settings=[],
        ),
        model_type_instance=model_type_instance,
    )

    # Create and return a ModelConfigWithCredentialsEntity
    return ModelConfigWithCredentialsEntity(
        provider="openai",
        model="gpt-3.5-turbo",
        model_schema=AIModelEntity(
            model="gpt-3.5-turbo",
            label=I18nObject(en_US="GPT-3.5 Turbo"),
            model_type=ModelType.LLM,
            fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
            model_properties={},
        ),
        mode="chat",
        credentials={},
        parameters={},
        provider_model_bundle=provider_model_bundle,
    )


def test_fetch_files_with_file_segment(llm_node):
    file = File(
        id="1",
        tenant_id="test",
        type=FileType.IMAGE,
        filename="test.jpg",
        transfer_method=FileTransferMethod.LOCAL_FILE,
        related_id="1",
        storage_key="",
    )
    llm_node.graph_runtime_state.variable_pool.add(["sys", "files"], file)

    result = llm_node._fetch_files(selector=["sys", "files"])
    assert result == [file]


def test_fetch_files_with_array_file_segment(llm_node):
    files = [
        File(
            id="1",
            tenant_id="test",
            type=FileType.IMAGE,
            filename="test1.jpg",
            transfer_method=FileTransferMethod.LOCAL_FILE,
            related_id="1",
            storage_key="",
        ),
        File(
            id="2",
            tenant_id="test",
            type=FileType.IMAGE,
            filename="test2.jpg",
            transfer_method=FileTransferMethod.LOCAL_FILE,
            related_id="2",
            storage_key="",
        ),
    ]
    llm_node.graph_runtime_state.variable_pool.add(["sys", "files"], ArrayFileSegment(value=files))

    result = llm_node._fetch_files(selector=["sys", "files"])
    assert result == files


def test_fetch_files_with_none_segment(llm_node):
    llm_node.graph_runtime_state.variable_pool.add(["sys", "files"], NoneSegment())

    result = llm_node._fetch_files(selector=["sys", "files"])
    assert result == []


def test_fetch_files_with_array_any_segment(llm_node):
    llm_node.graph_runtime_state.variable_pool.add(["sys", "files"], ArrayAnySegment(value=[]))

    result = llm_node._fetch_files(selector=["sys", "files"])
    assert result == []


def test_fetch_files_with_non_existent_variable(llm_node):
    result = llm_node._fetch_files(selector=["sys", "files"])
    assert result == []


# def test_fetch_prompt_messages__vison_disabled(faker, llm_node, model_config):
# TODO: Add test
# pass
# prompt_template = []
# llm_node.node_data.prompt_template = prompt_template

# fake_vision_detail = faker.random_element(
#     [ImagePromptMessageContent.DETAIL.HIGH, ImagePromptMessageContent.DETAIL.LOW]
# )
# fake_remote_url = faker.url()
# files = [
#     File(
#         id="1",
#         tenant_id="test",
#         type=FileType.IMAGE,
#         filename="test1.jpg",
#         transfer_method=FileTransferMethod.REMOTE_URL,
#         remote_url=fake_remote_url,
#         storage_key="",
#     )
# ]

# fake_query = faker.sentence()

# prompt_messages, _ = llm_node._fetch_prompt_messages(
#     sys_query=fake_query,
#     sys_files=files,
#     context=None,
#     memory=None,
#     model_config=model_config,
#     prompt_template=prompt_template,
#     memory_config=None,
#     vision_enabled=False,
#     vision_detail=fake_vision_detail,
#     variable_pool=llm_node.graph_runtime_state.variable_pool,
#     jinja2_variables=[],
# )

# assert prompt_messages == [UserPromptMessage(content=fake_query)]


# def test_fetch_prompt_messages__basic(faker, llm_node, model_config):
# TODO: Add test
# pass
# Setup dify config
# dify_config.MULTIMODAL_SEND_FORMAT = "url"

# # Generate fake values for prompt template
# fake_assistant_prompt = faker.sentence()
# fake_query = faker.sentence()
# fake_context = faker.sentence()
# fake_window_size = faker.random_int(min=1, max=3)
# fake_vision_detail = faker.random_element(
#     [ImagePromptMessageContent.DETAIL.HIGH, ImagePromptMessageContent.DETAIL.LOW]
# )
# fake_remote_url = faker.url()

# # Setup mock memory with history messages
# mock_history = [
#     UserPromptMessage(content=faker.sentence()),
#     AssistantPromptMessage(content=faker.sentence()),
#     UserPromptMessage(content=faker.sentence()),
#     AssistantPromptMessage(content=faker.sentence()),
#     UserPromptMessage(content=faker.sentence()),
#     AssistantPromptMessage(content=faker.sentence()),
# ]

# # Setup memory configuration
# memory_config = MemoryConfig(
#     role_prefix=MemoryConfig.RolePrefix(user="Human", assistant="Assistant"),
#     window=MemoryConfig.WindowConfig(enabled=True, size=fake_window_size),
#     query_prompt_template=None,
# )

# memory = MockTokenBufferMemory(history_messages=mock_history)

# # Test scenarios covering different file input combinations
# test_scenarios = [
#     LLMNodeTestScenario(
#         description="No files",
#         sys_query=fake_query,
#         sys_files=[],
#         features=[],
#         vision_enabled=False,
#         vision_detail=None,
#         window_size=fake_window_size,
#         prompt_template=[
#             LLMNodeChatModelMessage(
#                 text=fake_context,
#                 role=PromptMessageRole.SYSTEM,
#                 edition_type="basic",
#             ),
#             LLMNodeChatModelMessage(
#                 text="{#context#}",
#                 role=PromptMessageRole.USER,
#                 edition_type="basic",
#             ),
#             LLMNodeChatModelMessage(
#                 text=fake_assistant_prompt,
#                 role=PromptMessageRole.ASSISTANT,
#                 edition_type="basic",
#             ),
#         ],
#         expected_messages=[
#             SystemPromptMessage(content=fake_context),
#             UserPromptMessage(content=fake_context),
#             AssistantPromptMessage(content=fake_assistant_prompt),
#         ]
#         + mock_history[fake_window_size * -2 :]
#         + [
#             UserPromptMessage(content=fake_query),
#         ],
#     ),
#     LLMNodeTestScenario(
#         description="User files",
#         sys_query=fake_query,
#         sys_files=[
#             File(
#                 tenant_id="test",
#                 type=FileType.IMAGE,
#                 filename="test1.jpg",
#                 transfer_method=FileTransferMethod.REMOTE_URL,
#                 remote_url=fake_remote_url,
#                 extension=".jpg",
#                 mime_type="image/jpg",
#                 storage_key="",
#             )
#         ],
#         vision_enabled=True,
#         vision_detail=fake_vision_detail,
#         features=[ModelFeature.VISION],
#         window_size=fake_window_size,
#         prompt_template=[
#             LLMNodeChatModelMessage(
#                 text=fake_context,
#                 role=PromptMessageRole.SYSTEM,
#                 edition_type="basic",
#             ),
#             LLMNodeChatModelMessage(
#                 text="{#context#}",
#                 role=PromptMessageRole.USER,
#                 edition_type="basic",
#             ),
#             LLMNodeChatModelMessage(
#                 text=fake_assistant_prompt,
#                 role=PromptMessageRole.ASSISTANT,
#                 edition_type="basic",
#             ),
#         ],
#         expected_messages=[
#             SystemPromptMessage(content=fake_context),
#             UserPromptMessage(content=fake_context),
#             AssistantPromptMessage(content=fake_assistant_prompt),
#         ]
#         + mock_history[fake_window_size * -2 :]
#         + [
#             UserPromptMessage(
#                 content=[
#                     TextPromptMessageContent(data=fake_query),
#                     ImagePromptMessageContent(
#                         url=fake_remote_url, mime_type="image/jpg", format="jpg", detail=fake_vision_detail
#                     ),
#                 ]
#             ),
#         ],
#     ),
#     LLMNodeTestScenario(
#         description="Prompt template with variable selector of File",
#         sys_query=fake_query,
#         sys_files=[],
#         vision_enabled=False,
#         vision_detail=fake_vision_detail,
#         features=[ModelFeature.VISION],
#         window_size=fake_window_size,
#         prompt_template=[
#             LLMNodeChatModelMessage(
#                 text="{{#input.image#}}",
#                 role=PromptMessageRole.USER,
#                 edition_type="basic",
#             ),
#         ],
#         expected_messages=[
#             UserPromptMessage(
#                 content=[
#                     ImagePromptMessageContent(
#                         url=fake_remote_url, mime_type="image/jpg", format="jpg", detail=fake_vision_detail
#                     ),
#                 ]
#             ),
#         ]
#         + mock_history[fake_window_size * -2 :]
#         + [UserPromptMessage(content=fake_query)],
#         file_variables={
#             "input.image": File(
#                 tenant_id="test",
#                 type=FileType.IMAGE,
#                 filename="test1.jpg",
#                 transfer_method=FileTransferMethod.REMOTE_URL,
#                 remote_url=fake_remote_url,
#                 extension=".jpg",
#                 mime_type="image/jpg",
#                 storage_key="",
#             )
#         },
#     ),
# ]

# for scenario in test_scenarios:
#     model_config.model_schema.features = scenario.features

#     for k, v in scenario.file_variables.items():
#         selector = k.split(".")
#         llm_node.graph_runtime_state.variable_pool.add(selector, v)

#     # Call the method under test
#     prompt_messages, _ = llm_node._fetch_prompt_messages(
#         sys_query=scenario.sys_query,
#         sys_files=scenario.sys_files,
#         context=fake_context,
#         memory=memory,
#         model_config=model_config,
#         prompt_template=scenario.prompt_template,
#         memory_config=memory_config,
#         vision_enabled=scenario.vision_enabled,
#         vision_detail=scenario.vision_detail,
#         variable_pool=llm_node.graph_runtime_state.variable_pool,
#         jinja2_variables=[],
#     )

# # Verify the result
# assert len(prompt_messages) == len(scenario.expected_messages), f"Scenario failed: {scenario.description}"
# assert prompt_messages == scenario.expected_messages, (
#     f"Message content mismatch in scenario: {scenario.description}"
# )


def test_handle_list_messages_basic(llm_node):
    messages = [
        LLMNodeChatModelMessage(
            text="Hello, {#context#}",
            role=PromptMessageRole.USER,
            edition_type="basic",
        )
    ]
    context = "world"
    jinja2_variables = []
    variable_pool = llm_node.graph_runtime_state.variable_pool
    vision_detail_config = ImagePromptMessageContent.DETAIL.HIGH

    result = llm_node._handle_list_messages(
        messages=messages,
        context=context,
        jinja2_variables=jinja2_variables,
        variable_pool=variable_pool,
        vision_detail_config=vision_detail_config,
    )

    assert len(result) == 1
    assert isinstance(result[0], UserPromptMessage)
    assert result[0].content == [TextPromptMessageContent(data="Hello, world")]


@pytest.fixture
def llm_node_for_multimodal(
    llm_node_data, graph_init_params, graph, graph_runtime_state
) -> tuple[LLMNode, LLMFileSaver]:
    mock_file_saver: LLMFileSaver = mock.MagicMock(spec=LLMFileSaver)
    node = LLMNode(
        id="1",
        config={
            "id": "1",
            "data": llm_node_data.model_dump(),
        },
        graph_init_params=graph_init_params,
        graph=graph,
        graph_runtime_state=graph_runtime_state,
        llm_file_saver=mock_file_saver,
    )
    return node, mock_file_saver


class TestLLMNodeSaveMultiModalImageOutput:
    def test_llm_node_save_inline_output(self, llm_node_for_multimodal: tuple[LLMNode, LLMFileSaver]):
        llm_node, mock_file_saver = llm_node_for_multimodal
        content = ImagePromptMessageContent(
            format="png",
            base64_data=base64.b64encode(b"test-data").decode(),
            mime_type="image/png",
        )
        mock_file = File(
            id=str(uuid.uuid4()),
            tenant_id="1",
            type=FileType.IMAGE,
            transfer_method=FileTransferMethod.TOOL_FILE,
            related_id=str(uuid.uuid4()),
            filename="test-file.png",
            extension=".png",
            mime_type="image/png",
            size=9,
        )
        mock_file_saver.save_binary_string.return_value = mock_file
        file = llm_node._save_multimodal_image_output(content=content)
        assert llm_node._file_outputs == [mock_file]
        assert file == mock_file
        mock_file_saver.save_binary_string.assert_called_once_with(
            data=b"test-data", mime_type="image/png", file_type=FileType.IMAGE
        )

    def test_llm_node_save_url_output(self, llm_node_for_multimodal: tuple[LLMNode, LLMFileSaver]):
        llm_node, mock_file_saver = llm_node_for_multimodal
        content = ImagePromptMessageContent(
            format="png",
            url="https://example.com/image.png",
            mime_type="image/jpg",
        )
        mock_file = File(
            id=str(uuid.uuid4()),
            tenant_id="1",
            type=FileType.IMAGE,
            transfer_method=FileTransferMethod.TOOL_FILE,
            related_id=str(uuid.uuid4()),
            filename="test-file.png",
            extension=".png",
            mime_type="image/png",
            size=9,
        )
        mock_file_saver.save_remote_url.return_value = mock_file
        file = llm_node._save_multimodal_image_output(content=content)
        assert llm_node._file_outputs == [mock_file]
        assert file == mock_file
        mock_file_saver.save_remote_url.assert_called_once_with(content.url, FileType.IMAGE)


def test_llm_node_image_file_to_markdown(llm_node: LLMNode):
    mock_file = mock.MagicMock(spec=File)
    mock_file.generate_url.return_value = "https://example.com/image.png"
    markdown = llm_node._image_file_to_markdown(mock_file)
    assert markdown == "![](https://example.com/image.png)"


class TestSaveMultimodalOutputAndConvertResultToMarkdown:
    def test_str_content(self, llm_node_for_multimodal):
        llm_node, mock_file_saver = llm_node_for_multimodal
        gen = llm_node._save_multimodal_output_and_convert_result_to_markdown("hello world")
        assert list(gen) == ["hello world"]
        mock_file_saver.save_binary_string.assert_not_called()
        mock_file_saver.save_remote_url.assert_not_called()

    def test_text_prompt_message_content(self, llm_node_for_multimodal):
        llm_node, mock_file_saver = llm_node_for_multimodal
        gen = llm_node._save_multimodal_output_and_convert_result_to_markdown(
            [TextPromptMessageContent(data="hello world")]
        )
        assert list(gen) == ["hello world"]
        mock_file_saver.save_binary_string.assert_not_called()
        mock_file_saver.save_remote_url.assert_not_called()

    def test_image_content_with_inline_data(self, llm_node_for_multimodal, monkeypatch):
        llm_node, mock_file_saver = llm_node_for_multimodal

        image_raw_data = b"PNG_DATA"
        image_b64_data = base64.b64encode(image_raw_data).decode()

        mock_saved_file = File(
            id=str(uuid.uuid4()),
            tenant_id="1",
            type=FileType.IMAGE,
            transfer_method=FileTransferMethod.TOOL_FILE,
            filename="test.png",
            extension=".png",
            size=len(image_raw_data),
            related_id=str(uuid.uuid4()),
            url="https://example.com/test.png",
            storage_key="test_storage_key",
        )
        mock_file_saver.save_binary_string.return_value = mock_saved_file
        gen = llm_node._save_multimodal_output_and_convert_result_to_markdown(
            [
                ImagePromptMessageContent(
                    format="png",
                    base64_data=image_b64_data,
                    mime_type="image/png",
                )
            ]
        )
        yielded_strs = list(gen)
        assert len(yielded_strs) == 1

        # This assertion requires careful handling.
        # `FILES_URL` settings can vary across environments, which might lead to fragile tests.
        #
        # Rather than asserting the complete URL returned by _save_multimodal_output_and_convert_result_to_markdown,
        # we verify that the result includes the markdown image syntax and the expected file URL path.
        expected_file_url_path = f"/files/tools/{mock_saved_file.related_id}.png"
        assert yielded_strs[0].startswith("![](")
        assert expected_file_url_path in yielded_strs[0]
        assert yielded_strs[0].endswith(")")
        mock_file_saver.save_binary_string.assert_called_once_with(
            data=image_raw_data,
            mime_type="image/png",
            file_type=FileType.IMAGE,
        )
        assert mock_saved_file in llm_node._file_outputs

    def test_unknown_content_type(self, llm_node_for_multimodal):
        llm_node, mock_file_saver = llm_node_for_multimodal
        gen = llm_node._save_multimodal_output_and_convert_result_to_markdown(frozenset(["hello world"]))
        assert list(gen) == ["frozenset({'hello world'})"]
        mock_file_saver.save_binary_string.assert_not_called()
        mock_file_saver.save_remote_url.assert_not_called()

    def test_unknown_item_type(self, llm_node_for_multimodal):
        llm_node, mock_file_saver = llm_node_for_multimodal
        gen = llm_node._save_multimodal_output_and_convert_result_to_markdown([frozenset(["hello world"])])
        assert list(gen) == ["frozenset({'hello world'})"]
        mock_file_saver.save_binary_string.assert_not_called()
        mock_file_saver.save_remote_url.assert_not_called()

    def test_none_content(self, llm_node_for_multimodal):
        llm_node, mock_file_saver = llm_node_for_multimodal
        gen = llm_node._save_multimodal_output_and_convert_result_to_markdown(None)
        assert list(gen) == []
        mock_file_saver.save_binary_string.assert_not_called()
        mock_file_saver.save_remote_url.assert_not_called()
