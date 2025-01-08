from collections.abc import Sequence
from typing import Optional

import pytest

from configs import dify_config
from core.app.entities.app_invoke_entities import InvokeFrom, ModelConfigWithCredentialsEntity
from core.entities.provider_configuration import ProviderConfiguration, ProviderModelBundle
from core.entities.provider_entities import CustomConfiguration, SystemConfiguration
from core.file import File, FileTransferMethod, FileType
from core.model_runtime.entities.common_entities import I18nObject
from core.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    ImagePromptMessageContent,
    PromptMessage,
    PromptMessageRole,
    SystemPromptMessage,
    TextPromptMessageContent,
    UserPromptMessage,
)
from core.model_runtime.entities.model_entities import AIModelEntity, FetchFrom, ModelFeature, ModelType
from core.model_runtime.model_providers.model_provider_factory import ModelProviderFactory
from core.prompt.entities.advanced_prompt_entities import MemoryConfig
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
from core.workflow.nodes.llm.node import LLMNode
from models.enums import UserFrom
from models.provider import ProviderType
from models.workflow import WorkflowType
from tests.unit_tests.core.workflow.nodes.llm.test_scenarios import LLMNodeTestScenario


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
def llm_node():
    data = LLMNodeData(
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
    variable_pool = VariablePool(
        system_variables={},
        user_inputs={},
    )
    node = LLMNode(
        id="1",
        config={
            "id": "1",
            "data": data.model_dump(),
        },
        graph_init_params=GraphInitParams(
            tenant_id="1",
            app_id="1",
            workflow_type=WorkflowType.WORKFLOW,
            workflow_id="1",
            graph_config={},
            user_id="1",
            user_from=UserFrom.ACCOUNT,
            invoke_from=InvokeFrom.SERVICE_API,
            call_depth=0,
        ),
        graph=Graph(
            root_node_id="1",
            answer_stream_generate_routes=AnswerStreamGenerateRoute(
                answer_dependencies={},
                answer_generate_route={},
            ),
            end_stream_param=EndStreamParam(
                end_dependencies={},
                end_stream_variable_selector_mapping={},
            ),
        ),
        graph_runtime_state=GraphRuntimeState(
            variable_pool=variable_pool,
            start_at=0,
        ),
    )
    return node


@pytest.fixture
def model_config():
    # Create actual provider and model type instances
    model_provider_factory = ModelProviderFactory()
    provider_instance = model_provider_factory.get_provider_instance("openai")
    model_type_instance = provider_instance.get_model_instance(ModelType.LLM)

    # Create a ProviderModelBundle
    provider_model_bundle = ProviderModelBundle(
        configuration=ProviderConfiguration(
            tenant_id="1",
            provider=provider_instance.get_provider_schema(),
            preferred_provider_type=ProviderType.CUSTOM,
            using_provider_type=ProviderType.CUSTOM,
            system_configuration=SystemConfiguration(enabled=False),
            custom_configuration=CustomConfiguration(provider=None),
            model_settings=[],
        ),
        provider_instance=provider_instance,
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


def test_fetch_prompt_messages__vison_disabled(faker, llm_node, model_config):
    prompt_template = []
    llm_node.node_data.prompt_template = prompt_template

    fake_vision_detail = faker.random_element(
        [ImagePromptMessageContent.DETAIL.HIGH, ImagePromptMessageContent.DETAIL.LOW]
    )
    fake_remote_url = faker.url()
    files = [
        File(
            id="1",
            tenant_id="test",
            type=FileType.IMAGE,
            filename="test1.jpg",
            transfer_method=FileTransferMethod.REMOTE_URL,
            remote_url=fake_remote_url,
            storage_key="",
        )
    ]

    fake_query = faker.sentence()

    prompt_messages, _ = llm_node._fetch_prompt_messages(
        sys_query=fake_query,
        sys_files=files,
        context=None,
        memory=None,
        model_config=model_config,
        prompt_template=prompt_template,
        memory_config=None,
        vision_enabled=False,
        vision_detail=fake_vision_detail,
        variable_pool=llm_node.graph_runtime_state.variable_pool,
        jinja2_variables=[],
    )

    assert prompt_messages == [UserPromptMessage(content=fake_query)]


def test_fetch_prompt_messages__basic(faker, llm_node, model_config):
    # Setup dify config
    dify_config.MULTIMODAL_SEND_FORMAT = "url"

    # Generate fake values for prompt template
    fake_assistant_prompt = faker.sentence()
    fake_query = faker.sentence()
    fake_context = faker.sentence()
    fake_window_size = faker.random_int(min=1, max=3)
    fake_vision_detail = faker.random_element(
        [ImagePromptMessageContent.DETAIL.HIGH, ImagePromptMessageContent.DETAIL.LOW]
    )
    fake_remote_url = faker.url()

    # Setup mock memory with history messages
    mock_history = [
        UserPromptMessage(content=faker.sentence()),
        AssistantPromptMessage(content=faker.sentence()),
        UserPromptMessage(content=faker.sentence()),
        AssistantPromptMessage(content=faker.sentence()),
        UserPromptMessage(content=faker.sentence()),
        AssistantPromptMessage(content=faker.sentence()),
    ]

    # Setup memory configuration
    memory_config = MemoryConfig(
        role_prefix=MemoryConfig.RolePrefix(user="Human", assistant="Assistant"),
        window=MemoryConfig.WindowConfig(enabled=True, size=fake_window_size),
        query_prompt_template=None,
    )

    memory = MockTokenBufferMemory(history_messages=mock_history)

    # Test scenarios covering different file input combinations
    test_scenarios = [
        LLMNodeTestScenario(
            description="No files",
            sys_query=fake_query,
            sys_files=[],
            features=[],
            vision_enabled=False,
            vision_detail=None,
            window_size=fake_window_size,
            prompt_template=[
                LLMNodeChatModelMessage(
                    text=fake_context,
                    role=PromptMessageRole.SYSTEM,
                    edition_type="basic",
                ),
                LLMNodeChatModelMessage(
                    text="{#context#}",
                    role=PromptMessageRole.USER,
                    edition_type="basic",
                ),
                LLMNodeChatModelMessage(
                    text=fake_assistant_prompt,
                    role=PromptMessageRole.ASSISTANT,
                    edition_type="basic",
                ),
            ],
            expected_messages=[
                SystemPromptMessage(content=fake_context),
                UserPromptMessage(content=fake_context),
                AssistantPromptMessage(content=fake_assistant_prompt),
            ]
            + mock_history[fake_window_size * -2 :]
            + [
                UserPromptMessage(content=fake_query),
            ],
        ),
        LLMNodeTestScenario(
            description="User files",
            sys_query=fake_query,
            sys_files=[
                File(
                    tenant_id="test",
                    type=FileType.IMAGE,
                    filename="test1.jpg",
                    transfer_method=FileTransferMethod.REMOTE_URL,
                    remote_url=fake_remote_url,
                    extension=".jpg",
                    mime_type="image/jpg",
                    storage_key="",
                )
            ],
            vision_enabled=True,
            vision_detail=fake_vision_detail,
            features=[ModelFeature.VISION],
            window_size=fake_window_size,
            prompt_template=[
                LLMNodeChatModelMessage(
                    text=fake_context,
                    role=PromptMessageRole.SYSTEM,
                    edition_type="basic",
                ),
                LLMNodeChatModelMessage(
                    text="{#context#}",
                    role=PromptMessageRole.USER,
                    edition_type="basic",
                ),
                LLMNodeChatModelMessage(
                    text=fake_assistant_prompt,
                    role=PromptMessageRole.ASSISTANT,
                    edition_type="basic",
                ),
            ],
            expected_messages=[
                SystemPromptMessage(content=fake_context),
                UserPromptMessage(content=fake_context),
                AssistantPromptMessage(content=fake_assistant_prompt),
            ]
            + mock_history[fake_window_size * -2 :]
            + [
                UserPromptMessage(
                    content=[
                        TextPromptMessageContent(data=fake_query),
                        ImagePromptMessageContent(
                            url=fake_remote_url, mime_type="image/jpg", format="jpg", detail=fake_vision_detail
                        ),
                    ]
                ),
            ],
        ),
        LLMNodeTestScenario(
            description="Prompt template with variable selector of File",
            sys_query=fake_query,
            sys_files=[],
            vision_enabled=False,
            vision_detail=fake_vision_detail,
            features=[ModelFeature.VISION],
            window_size=fake_window_size,
            prompt_template=[
                LLMNodeChatModelMessage(
                    text="{{#input.image#}}",
                    role=PromptMessageRole.USER,
                    edition_type="basic",
                ),
            ],
            expected_messages=[
                UserPromptMessage(
                    content=[
                        ImagePromptMessageContent(
                            url=fake_remote_url, mime_type="image/jpg", format="jpg", detail=fake_vision_detail
                        ),
                    ]
                ),
            ]
            + mock_history[fake_window_size * -2 :]
            + [UserPromptMessage(content=fake_query)],
            file_variables={
                "input.image": File(
                    tenant_id="test",
                    type=FileType.IMAGE,
                    filename="test1.jpg",
                    transfer_method=FileTransferMethod.REMOTE_URL,
                    remote_url=fake_remote_url,
                    extension=".jpg",
                    mime_type="image/jpg",
                    storage_key="",
                )
            },
        ),
    ]

    for scenario in test_scenarios:
        model_config.model_schema.features = scenario.features

        for k, v in scenario.file_variables.items():
            selector = k.split(".")
            llm_node.graph_runtime_state.variable_pool.add(selector, v)

        # Call the method under test
        prompt_messages, _ = llm_node._fetch_prompt_messages(
            sys_query=scenario.sys_query,
            sys_files=scenario.sys_files,
            context=fake_context,
            memory=memory,
            model_config=model_config,
            prompt_template=scenario.prompt_template,
            memory_config=memory_config,
            vision_enabled=scenario.vision_enabled,
            vision_detail=scenario.vision_detail,
            variable_pool=llm_node.graph_runtime_state.variable_pool,
            jinja2_variables=[],
        )

        # Verify the result
        assert len(prompt_messages) == len(scenario.expected_messages), f"Scenario failed: {scenario.description}"
        assert (
            prompt_messages == scenario.expected_messages
        ), f"Message content mismatch in scenario: {scenario.description}"


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
