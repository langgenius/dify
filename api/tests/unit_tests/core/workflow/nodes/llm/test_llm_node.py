import base64
import json
import uuid
from collections.abc import Sequence
from unittest import mock

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom
from core.model_runtime.entities.llm_entities import LLMResult, LLMUsage
from core.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    ImagePromptMessageContent,
    PromptMessage,
    PromptMessageRole,
    TextPromptMessageContent,
    UserPromptMessage,
)
from core.prompt.entities.advanced_prompt_entities import MemoryConfig
from core.variables import ArrayAnySegment, ArrayFileSegment, NoneSegment
from core.workflow.entities import GraphInitParams
from core.workflow.enums import NodeType, WorkflowNodeExecutionStatus
from core.workflow.file import File, FileTransferMethod, FileType
from core.workflow.node_events import (
    ModelInvokeCompletedEvent,
    StreamChunkEvent,
    StreamCompletedEvent,
)
from core.workflow.nodes.llm import llm_utils
from core.workflow.nodes.llm.entities import (
    ContextConfig,
    LLMNodeChatModelMessage,
    LLMNodeCompletionModelPromptTemplate,
    LLMNodeData,
    ModelConfig,
    VisionConfig,
    VisionConfigOptions,
)
from core.workflow.nodes.llm.exc import (
    InvalidContextStructureError,
    LLMNodeError,
    MemoryRolePrefixRequiredError,
    ModelNotExistError,
    VariableNotFoundError,
)
from core.workflow.nodes.llm.file_saver import LLMFileSaver
from core.workflow.nodes.llm.node import (
    LLMNode,
    _calculate_rest_token,
    _combine_message_content_with_role,
    _handle_completion_template,
    _handle_memory_completion_mode,
    _render_jinja2_message,
)
from core.workflow.runtime import GraphRuntimeState, VariablePool
from core.workflow.system_variable import SystemVariable
from models.enums import UserFrom


def make_usage():
    usage = LLMUsage.empty_usage()
    usage.total_tokens = 10
    usage.total_price = 0.01
    usage.currency = "USD"
    return usage


class MockTokenBufferMemory:
    def __init__(self, history_messages=None):
        self.history_messages = history_messages or []

    def get_history_prompt_messages(
        self, max_token_limit: int = 2000, message_limit: int | None = None
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
        reasoning_format="tagged",
    )


@pytest.fixture
def graph_init_params() -> GraphInitParams:
    return GraphInitParams(
        tenant_id="1",
        app_id="1",
        workflow_id="1",
        graph_config={},
        user_id="1",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.SERVICE_API,
        call_depth=0,
    )


@pytest.fixture
def graph_runtime_state() -> GraphRuntimeState:
    variable_pool = VariablePool(
        system_variables=SystemVariable.default(),
        user_inputs={},
    )
    return GraphRuntimeState(
        variable_pool=variable_pool,
        start_at=0,
    )


@pytest.fixture
def llm_node(
    llm_node_data: LLMNodeData, graph_init_params: GraphInitParams, graph_runtime_state: GraphRuntimeState
) -> LLMNode:
    mock_file_saver = mock.MagicMock(spec=LLMFileSaver)
    node_config = {
        "id": "1",
        "data": llm_node_data.model_dump(),
    }
    node = LLMNode(
        id="1",
        config=node_config,
        graph_init_params=graph_init_params,
        graph_runtime_state=graph_runtime_state,
        llm_file_saver=mock_file_saver,
    )
    return node


@pytest.fixture
def model_config():
    mock_schema = mock.MagicMock()
    mock_schema.model_properties = {}
    mock_schema.parameter_rules = []
    mock_schema.features = []

    mock_bundle = mock.MagicMock()

    return mock.MagicMock(
        provider="openai",
        model="gpt-3.5-turbo",
        model_schema=mock_schema,
        parameters={},
        provider_model_bundle=mock_bundle,
    )


def test_fetch_files_with_file_segment():
    file = File(
        id="1",
        tenant_id="test",
        type=FileType.IMAGE,
        filename="test.jpg",
        transfer_method=FileTransferMethod.LOCAL_FILE,
        related_id="1",
        storage_key="",
    )
    variable_pool = VariablePool.empty()
    variable_pool.add(["sys", "files"], file)

    result = llm_utils.fetch_files(variable_pool=variable_pool, selector=["sys", "files"])
    assert result == [file]


def test_fetch_files_with_array_file_segment():
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
    variable_pool = VariablePool.empty()
    variable_pool.add(["sys", "files"], ArrayFileSegment(value=files))

    result = llm_utils.fetch_files(variable_pool=variable_pool, selector=["sys", "files"])
    assert result == files


def test_fetch_files_with_none_segment():
    variable_pool = VariablePool.empty()
    variable_pool.add(["sys", "files"], NoneSegment())

    result = llm_utils.fetch_files(variable_pool=variable_pool, selector=["sys", "files"])
    assert result == []


def test_fetch_files_with_array_any_segment():
    variable_pool = VariablePool.empty()
    variable_pool.add(["sys", "files"], ArrayAnySegment(value=[]))

    result = llm_utils.fetch_files(variable_pool=variable_pool, selector=["sys", "files"])
    assert result == []


def test_fetch_files_with_non_existent_variable():
    variable_pool = VariablePool.empty()
    result = llm_utils.fetch_files(variable_pool=variable_pool, selector=["sys", "files"])
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

    result = llm_node.handle_list_messages(
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
def llm_node_for_multimodal(llm_node_data, graph_init_params, graph_runtime_state) -> tuple[LLMNode, LLMFileSaver]:
    mock_file_saver: LLMFileSaver = mock.MagicMock(spec=LLMFileSaver)
    node_config = {
        "id": "1",
        "data": llm_node_data.model_dump(),
    }
    node = LLMNode(
        id="1",
        config=node_config,
        graph_init_params=graph_init_params,
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
        file = llm_node.save_multimodal_image_output(
            content=content,
            file_saver=mock_file_saver,
        )
        # Manually append to _file_outputs since the static method doesn't do it
        llm_node._file_outputs.append(file)
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
        file = llm_node.save_multimodal_image_output(
            content=content,
            file_saver=mock_file_saver,
        )
        # Manually append to _file_outputs since the static method doesn't do it
        llm_node._file_outputs.append(file)
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
        gen = llm_node._save_multimodal_output_and_convert_result_to_markdown(
            contents="hello world", file_saver=mock_file_saver, file_outputs=[]
        )
        assert list(gen) == ["hello world"]
        mock_file_saver.save_binary_string.assert_not_called()
        mock_file_saver.save_remote_url.assert_not_called()

    def test_text_prompt_message_content(self, llm_node_for_multimodal):
        llm_node, mock_file_saver = llm_node_for_multimodal
        gen = llm_node._save_multimodal_output_and_convert_result_to_markdown(
            contents=[TextPromptMessageContent(data="hello world")], file_saver=mock_file_saver, file_outputs=[]
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
            contents=[
                ImagePromptMessageContent(
                    format="png",
                    base64_data=image_b64_data,
                    mime_type="image/png",
                )
            ],
            file_saver=mock_file_saver,
            file_outputs=llm_node._file_outputs,
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
        gen = llm_node._save_multimodal_output_and_convert_result_to_markdown(
            contents=frozenset(["hello world"]), file_saver=mock_file_saver, file_outputs=[]
        )
        assert list(gen) == ["hello world"]
        mock_file_saver.save_binary_string.assert_not_called()
        mock_file_saver.save_remote_url.assert_not_called()

    def test_unknown_item_type(self, llm_node_for_multimodal):
        llm_node, mock_file_saver = llm_node_for_multimodal
        gen = llm_node._save_multimodal_output_and_convert_result_to_markdown(
            contents=[frozenset(["hello world"])], file_saver=mock_file_saver, file_outputs=[]
        )
        assert list(gen) == ["frozenset({'hello world'})"]
        mock_file_saver.save_binary_string.assert_not_called()
        mock_file_saver.save_remote_url.assert_not_called()

    def test_none_content(self, llm_node_for_multimodal):
        llm_node, mock_file_saver = llm_node_for_multimodal
        gen = llm_node._save_multimodal_output_and_convert_result_to_markdown(
            contents=None, file_saver=mock_file_saver, file_outputs=[]
        )
        assert list(gen) == []
        mock_file_saver.save_binary_string.assert_not_called()
        mock_file_saver.save_remote_url.assert_not_called()


class TestReasoningFormat:
    """Test cases for reasoning_format functionality"""

    def test_split_reasoning_separated_mode(self):
        """Test separated mode: tags are removed and content is extracted"""

        text_with_think = """
        <think>I need to explain what Dify is. It's an open source AI platform.
        </think>Dify is an open source AI platform.
        """

        clean_text, reasoning_content = LLMNode._split_reasoning(text_with_think, "separated")

        assert clean_text == "Dify is an open source AI platform."
        assert reasoning_content == "I need to explain what Dify is. It's an open source AI platform."

    def test_split_reasoning_tagged_mode(self):
        """Test tagged mode: original text is preserved"""

        text_with_think = """
        <think>I need to explain what Dify is. It's an open source AI platform.
        </think>Dify is an open source AI platform.
        """

        clean_text, reasoning_content = LLMNode._split_reasoning(text_with_think, "tagged")

        # Original text unchanged
        assert clean_text == text_with_think
        # Empty reasoning content in tagged mode
        assert reasoning_content == ""

    def test_split_reasoning_no_think_blocks(self):
        """Test behavior when no <think> tags are present"""

        text_without_think = "This is a simple answer without any thinking blocks."

        clean_text, reasoning_content = LLMNode._split_reasoning(text_without_think, "separated")

        assert clean_text == text_without_think
        assert reasoning_content == ""

    def test_reasoning_format_default_value(self):
        """Test that reasoning_format defaults to 'tagged' for backward compatibility"""

        node_data = LLMNodeData(
            title="Test LLM",
            model=ModelConfig(provider="openai", name="gpt-3.5-turbo", mode="chat", completion_params={}),
            prompt_template=[],
            context=ContextConfig(enabled=False),
        )

        assert node_data.reasoning_format == "tagged"

        text_with_think = """
        <think>I need to explain what Dify is. It's an open source AI platform.
        </think>Dify is an open source AI platform.
        """
        clean_text, reasoning_content = LLMNode._split_reasoning(text_with_think, node_data.reasoning_format)

        assert clean_text == text_with_think
        assert reasoning_content == ""


def test_fetch_jinja_inputs_array_object_and_string(llm_node):
    pool = llm_node.graph_runtime_state.variable_pool

    # Let VariablePool auto-convert native types
    pool.add(["node1", "a"], "hello")
    pool.add(["node1", "b"], {"x": 1})
    pool.add(["node1", "c"], ["one", "two"])

    llm_node.node_data.prompt_config = mock.MagicMock()
    llm_node.node_data.prompt_config.jinja2_variables = [
        mock.MagicMock(variable="a", value_selector=["node1", "a"]),
        mock.MagicMock(variable="b", value_selector=["node1", "b"]),
        mock.MagicMock(variable="c", value_selector=["node1", "c"]),
    ]

    result = llm_node._fetch_jinja_inputs(llm_node.node_data)

    assert result["a"] == "hello"
    assert json.loads(result["b"]) == {"x": 1}
    assert result["c"] == "one\ntwo"


def test_fetch_jinja_inputs_variable_not_found(llm_node):
    llm_node.node_data.prompt_config = mock.MagicMock()
    llm_node.node_data.prompt_config.jinja2_variables = [
        mock.MagicMock(variable="missing", value_selector=["missing"]),
    ]

    with pytest.raises(VariableNotFoundError):
        llm_node._fetch_jinja_inputs(llm_node.node_data)


def test_fetch_structured_output_schema_success():
    schema = {"type": "object"}
    result = LLMNode.fetch_structured_output_schema(structured_output={"schema": schema})
    assert result == schema


def test_fetch_structured_output_schema_empty():
    with pytest.raises(LLMNodeError):
        LLMNode.fetch_structured_output_schema(structured_output={})


def test_fetch_structured_output_schema_invalid_json():
    with pytest.raises(LLMNodeError):
        LLMNode.fetch_structured_output_schema(structured_output={"schema": "not-json"})


def test_fetch_structured_output_schema_not_dict():
    with pytest.raises(LLMNodeError):
        LLMNode.fetch_structured_output_schema(structured_output={"schema": ["list"]})


def test_handle_blocking_result_separated(llm_node):
    usage = LLMUsage.empty_usage()

    message = AssistantPromptMessage(content="<think>reason</think>answer")
    result = LLMResult(
        model="gpt-3.5-turbo",
        message=message,
        usage=usage,
    )
    event = LLMNode.handle_blocking_result(
        invoke_result=result,
        saver=mock.MagicMock(),
        file_outputs=[],
        reasoning_format="separated",
    )

    assert event.text == "answer"
    assert event.reasoning_content == "reason"


def test_handle_memory_completion_requires_role_prefix(model_config):
    memory = mock.MagicMock()
    memory.get_history_prompt_text.return_value = "history"

    memory_config = MemoryConfig(
        role_prefix=None,
        window=MemoryConfig.WindowConfig(enabled=False),
    )

    with pytest.raises(MemoryRolePrefixRequiredError):
        _handle_memory_completion_mode(
            memory=memory,
            memory_config=memory_config,
            model_config=model_config,
        )


def test_handle_completion_template_basic(llm_node):
    template = LLMNodeCompletionModelPromptTemplate(
        text="Hello {#context#}",
        edition_type="basic",
    )

    messages = _handle_completion_template(
        template=template,
        context="World",
        jinja2_variables=[],
        variable_pool=llm_node.graph_runtime_state.variable_pool,
    )

    assert "World" in messages[0].content[0].data


def test_combine_message_invalid_role():
    with pytest.raises(NotImplementedError):
        _combine_message_content_with_role(contents="x", role="invalid-role")


def test_render_jinja2_message(monkeypatch):
    mock_execute = mock.MagicMock(return_value={"result": "rendered"})
    monkeypatch.setattr(
        "core.workflow.nodes.llm.node.CodeExecutor.execute_workflow_code_template",
        mock_execute,
    )

    result = _render_jinja2_message(
        template="Hello {{name}}",
        jinja2_variables=[],
        variable_pool=VariablePool.empty(),
    )

    assert result == "rendered"


def test_calculate_rest_token(monkeypatch, model_config):
    # Fake context size
    model_config.model_schema.model_properties = {"context_size": 100}

    # Fake parameter rule for max_tokens
    fake_rule = mock.MagicMock()
    fake_rule.name = "max_tokens"
    fake_rule.use_template = None

    model_config.model_schema.parameter_rules = [fake_rule]
    model_config.parameters = {"max_tokens": 10}

    # Mock ModelInstance inside node.py
    mock_instance = mock.MagicMock()
    mock_instance.get_llm_num_tokens.return_value = 20

    monkeypatch.setattr(
        "core.workflow.nodes.llm.node.ModelInstance",
        lambda provider_model_bundle, model: mock_instance,
    )

    rest = _calculate_rest_token(prompt_messages=[], model_config=model_config)

    # 100 (context) - 10 (max_tokens) - 20 (current tokens) = 70
    assert rest == 70


def test_fetch_model_config_model_not_exist(monkeypatch, llm_node):
    mock_model = mock.MagicMock()
    mock_model.model_type_instance.get_model_schema.return_value = None

    monkeypatch.setattr(
        "core.workflow.nodes.llm.node.llm_utils.fetch_model_config",
        lambda tenant_id, node_data_model: (mock_model, mock.MagicMock(parameters={})),
    )

    with pytest.raises(ModelNotExistError):
        LLMNode._fetch_model_config(
            node_data_model=llm_node.node_data.model,
            tenant_id="1",
        )


# =========================================================
# _run() SUCCESS FLOW
# =========================================================


def test_llm_node_run_success(llm_node, monkeypatch):
    # 1️⃣ Patch fetch_model_config
    mock_model_instance = mock.MagicMock()
    mock_model_instance.model_type_instance.get_model_schema.return_value = {"schema": "ok"}

    mock_model_config = mock.MagicMock()
    mock_model_config.mode = "chat"
    mock_model_config.provider = "openai"
    mock_model_config.model = "gpt"
    mock_model_config.stop = None

    monkeypatch.setattr(
        "core.workflow.nodes.llm.node.LLMNode._fetch_model_config",
        lambda node_data_model, tenant_id: (mock_model_instance, mock_model_config),
    )

    # 2️⃣ Patch fetch_prompt_messages
    monkeypatch.setattr(
        "core.workflow.nodes.llm.node.LLMNode.fetch_prompt_messages",
        lambda **kwargs: ([], None),
    )

    # 3️⃣ Patch invoke_llm → yield streaming + completion
    def fake_invoke(**kwargs):
        yield StreamChunkEvent(selector=["1", "text"], chunk="hello", is_final=False)
        yield ModelInvokeCompletedEvent(
            text="final answer",
            usage=make_usage(),
            finish_reason="stop",
            reasoning_content="",
            structured_output=None,
        )

    monkeypatch.setattr(
        "core.workflow.nodes.llm.node.LLMNode.invoke_llm",
        lambda **kwargs: fake_invoke(),
    )

    # 4️⃣ Patch quota deduction
    monkeypatch.setattr(
        "core.workflow.nodes.llm.node.llm_utils.deduct_llm_quota",
        lambda **kwargs: None,
    )

    events = list(llm_node._run())

    # Last event must be StreamCompletedEvent success
    assert isinstance(events[-1], StreamCompletedEvent)
    assert events[-1].node_run_result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert events[-1].node_run_result.outputs["text"] == "final answer"


# =========================================================
# _run() VALUE ERROR FLOW
# =========================================================


def test_llm_node_run_value_error(llm_node, monkeypatch):
    monkeypatch.setattr(
        "core.workflow.nodes.llm.node.LLMNode._fetch_model_config",
        lambda **kwargs: (_ for _ in ()).throw(ValueError("fail")),
    )

    events = list(llm_node._run())

    assert isinstance(events[-1], StreamCompletedEvent)
    assert events[-1].node_run_result.status == WorkflowNodeExecutionStatus.FAILED
    assert "fail" in events[-1].node_run_result.error


# =========================================================
# _run() GENERIC EXCEPTION FLOW
# =========================================================


def test_llm_node_run_generic_exception(llm_node, monkeypatch):
    monkeypatch.setattr(
        "core.workflow.nodes.llm.node.LLMNode._fetch_model_config",
        lambda **kwargs: (_ for _ in ()).throw(Exception("boom")),
    )

    events = list(llm_node._run())

    assert events[-1].node_run_result.status == WorkflowNodeExecutionStatus.FAILED
    assert "boom" in events[-1].node_run_result.error


# =========================================================
# invoke_llm() structured branch
# =========================================================


def test_invoke_llm_structured(monkeypatch):
    mock_model_instance = mock.MagicMock()
    mock_model_instance.provider = "openai"
    mock_model_instance.credentials = {}
    mock_model_instance.model_type_instance.get_model_schema.return_value = {"schema": "ok"}

    monkeypatch.setattr(
        "core.workflow.nodes.llm.node.invoke_llm_with_structured_output",
        lambda **kwargs: [],
    )

    result = LLMNode.invoke_llm(
        node_data_model=mock.MagicMock(name="gpt", completion_params={}),
        model_instance=mock_model_instance,
        prompt_messages=[],
        stop=None,
        user_id="1",
        structured_output_enabled=True,
        structured_output={"schema": {"type": "object"}},
        file_saver=mock.MagicMock(),
        file_outputs=[],
        node_id="1",
        node_type="llm",
        reasoning_format="tagged",
    )

    assert hasattr(result, "__iter__")


# =========================================================
# handle_invoke_result STREAMING
# =========================================================


def test_handle_invoke_result_streaming():
    usage = LLMUsage.empty_usage()

    # Create a simple fake delta object
    class FakeDelta:
        def __init__(self):
            self.message = mock.MagicMock()
            self.message.content = "hello"
            self.usage = usage
            self.finish_reason = "stop"

    # Create fake chunk object
    class FakeChunk:
        def __init__(self):
            self.delta = FakeDelta()
            self.model = "gpt"
            self.prompt_messages = []

    def generator():
        yield FakeChunk()

    events = list(
        LLMNode.handle_invoke_result(
            invoke_result=generator(),
            file_saver=mock.MagicMock(),
            file_outputs=[],
            node_id="1",
            node_type=NodeType.LLM,
            reasoning_format="tagged",
        )
    )

    # Ensure completion event exists
    assert any(isinstance(e, ModelInvokeCompletedEvent) for e in events)


# =========================================================
# _fetch_context
# =========================================================


def test_fetch_context_string(llm_node):
    llm_node.node_data.context.enabled = True
    llm_node.node_data.context.variable_selector = ["node1", "ctx"]

    llm_node.graph_runtime_state.variable_pool.add(["node1", "ctx"], "hello world")

    events = list(llm_node._fetch_context(llm_node.node_data))

    assert events[0].context == "hello world"


def test_fetch_context_invalid_structure(llm_node):
    llm_node.node_data.context.enabled = True
    llm_node.node_data.context.variable_selector = ["node1", "ctx"]

    llm_node.graph_runtime_state.variable_pool.add(["node1", "ctx"], [{"invalid": 1}])

    with pytest.raises(InvalidContextStructureError):
        list(llm_node._fetch_context(llm_node.node_data))


# =========================================================
# _convert_to_original_retriever_resource
# =========================================================


def test_convert_to_original_retriever_resource(llm_node):
    context_dict = {
        "content": "text",
        "metadata": {
            "_source": "knowledge",
            "dataset_id": "1",
        },
    }

    result = llm_node._convert_to_original_retriever_resource(context_dict)

    assert result is not None
    assert result.dataset_id == "1"


# =========================================================
# _fetch_model_config error branch
# =========================================================


def test_fetch_model_config_error(monkeypatch, llm_node):
    mock_model = mock.MagicMock()
    mock_model.model_type_instance.get_model_schema.return_value = None

    monkeypatch.setattr(
        "core.workflow.nodes.llm.node.llm_utils.fetch_model_config",
        lambda tenant_id, node_data_model: (mock_model, mock.MagicMock(parameters={})),
    )

    with pytest.raises(ModelNotExistError):
        LLMNode._fetch_model_config(
            node_data_model=llm_node.node_data.model,
            tenant_id="1",
        )


# =========================================================
# _extract_variable_selector_to_variable_mapping
# =========================================================


def test_extract_variable_selector_mapping(llm_node):
    mapping = LLMNode._extract_variable_selector_to_variable_mapping(
        graph_config={},
        node_id="1",
        node_data=llm_node.node_data.model_dump(),
    )

    assert isinstance(mapping, dict)
