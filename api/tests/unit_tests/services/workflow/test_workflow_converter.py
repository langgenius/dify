# test for api/services/workflow/workflow_converter.py
import json
from unittest.mock import MagicMock

import pytest

from core.app.app_config.entities import (
    AdvancedChatMessageEntity,
    AdvancedChatPromptTemplateEntity,
    AdvancedCompletionPromptTemplateEntity,
    DatasetEntity,
    DatasetRetrieveConfigEntity,
    ExternalDataVariableEntity,
    ModelConfigEntity,
    PromptTemplateEntity,
)
from core.helper import encrypter
from dify_graph.model_runtime.entities.llm_entities import LLMMode
from dify_graph.model_runtime.entities.message_entities import PromptMessageRole
from dify_graph.variables.input_entities import VariableEntity, VariableEntityType
from models.api_based_extension import APIBasedExtension, APIBasedExtensionPoint
from models.model import AppMode
from services.workflow.workflow_converter import WorkflowConverter


@pytest.fixture
def default_variables():
    value = [
        VariableEntity(
            variable="text_input",
            label="text-input",
            type=VariableEntityType.TEXT_INPUT,
        ),
        VariableEntity(
            variable="paragraph",
            label="paragraph",
            type=VariableEntityType.PARAGRAPH,
        ),
        VariableEntity(
            variable="select",
            label="select",
            type=VariableEntityType.SELECT,
        ),
    ]
    return value


def test__convert_to_start_node(default_variables):
    # act
    result = WorkflowConverter()._convert_to_start_node(default_variables)

    # assert
    assert isinstance(result["data"]["variables"][0]["type"], str)
    assert result["data"]["variables"][0]["type"] == "text-input"
    assert result["data"]["variables"][0]["variable"] == "text_input"
    assert result["data"]["variables"][1]["variable"] == "paragraph"
    assert result["data"]["variables"][2]["variable"] == "select"


def test__convert_to_http_request_node_for_chatbot(default_variables):
    """
    Test convert to http request nodes for chatbot
    :return:
    """
    app_model = MagicMock()
    app_model.id = "app_id"
    app_model.tenant_id = "tenant_id"
    app_model.mode = AppMode.CHAT

    api_based_extension_id = "api_based_extension_id"
    mock_api_based_extension = APIBasedExtension(
        tenant_id="tenant_id",
        name="api-1",
        api_key="encrypted_api_key",
        api_endpoint="https://dify.ai",
    )

    mock_api_based_extension.id = api_based_extension_id
    workflow_converter = WorkflowConverter()
    workflow_converter._get_api_based_extension = MagicMock(return_value=mock_api_based_extension)

    encrypter.decrypt_token = MagicMock(return_value="api_key")

    external_data_variables = [
        ExternalDataVariableEntity(
            variable="external_variable", type="api", config={"api_based_extension_id": api_based_extension_id}
        )
    ]

    nodes, _ = workflow_converter._convert_to_http_request_node(
        app_model=app_model, variables=default_variables, external_data_variables=external_data_variables
    )

    assert len(nodes) == 2
    assert nodes[0]["data"]["type"] == "http-request"

    http_request_node = nodes[0]

    assert http_request_node["data"]["method"] == "post"
    assert http_request_node["data"]["url"] == mock_api_based_extension.api_endpoint
    assert http_request_node["data"]["authorization"]["type"] == "api-key"
    assert http_request_node["data"]["authorization"]["config"] == {"type": "bearer", "api_key": "api_key"}
    assert http_request_node["data"]["body"]["type"] == "json"

    body_data = http_request_node["data"]["body"]["data"]

    assert body_data

    body_data_json = json.loads(body_data)
    assert body_data_json["point"] == APIBasedExtensionPoint.APP_EXTERNAL_DATA_TOOL_QUERY

    body_params = body_data_json["params"]
    assert body_params["app_id"] == app_model.id
    assert body_params["tool_variable"] == external_data_variables[0].variable
    assert len(body_params["inputs"]) == 3
    assert body_params["query"] == "{{#sys.query#}}"  # for chatbot

    code_node = nodes[1]
    assert code_node["data"]["type"] == "code"


def test__convert_to_http_request_node_for_workflow_app(default_variables):
    """
    Test convert to http request nodes for workflow app
    :return:
    """
    app_model = MagicMock()
    app_model.id = "app_id"
    app_model.tenant_id = "tenant_id"
    app_model.mode = AppMode.WORKFLOW

    api_based_extension_id = "api_based_extension_id"
    mock_api_based_extension = APIBasedExtension(
        tenant_id="tenant_id",
        name="api-1",
        api_key="encrypted_api_key",
        api_endpoint="https://dify.ai",
    )
    mock_api_based_extension.id = api_based_extension_id

    workflow_converter = WorkflowConverter()
    workflow_converter._get_api_based_extension = MagicMock(return_value=mock_api_based_extension)

    encrypter.decrypt_token = MagicMock(return_value="api_key")

    external_data_variables = [
        ExternalDataVariableEntity(
            variable="external_variable", type="api", config={"api_based_extension_id": api_based_extension_id}
        )
    ]

    nodes, _ = workflow_converter._convert_to_http_request_node(
        app_model=app_model, variables=default_variables, external_data_variables=external_data_variables
    )

    assert len(nodes) == 2
    assert nodes[0]["data"]["type"] == "http-request"

    http_request_node = nodes[0]

    assert http_request_node["data"]["method"] == "post"
    assert http_request_node["data"]["url"] == mock_api_based_extension.api_endpoint
    assert http_request_node["data"]["authorization"]["type"] == "api-key"
    assert http_request_node["data"]["authorization"]["config"] == {"type": "bearer", "api_key": "api_key"}
    assert http_request_node["data"]["body"]["type"] == "json"

    body_data = http_request_node["data"]["body"]["data"]

    assert body_data

    body_data_json = json.loads(body_data)
    assert body_data_json["point"] == APIBasedExtensionPoint.APP_EXTERNAL_DATA_TOOL_QUERY

    body_params = body_data_json["params"]
    assert body_params["app_id"] == app_model.id
    assert body_params["tool_variable"] == external_data_variables[0].variable
    assert len(body_params["inputs"]) == 3
    assert body_params["query"] == ""

    code_node = nodes[1]
    assert code_node["data"]["type"] == "code"


def test__convert_to_knowledge_retrieval_node_for_chatbot():
    new_app_mode = AppMode.ADVANCED_CHAT

    dataset_config = DatasetEntity(
        dataset_ids=["dataset_id_1", "dataset_id_2"],
        retrieve_config=DatasetRetrieveConfigEntity(
            retrieve_strategy=DatasetRetrieveConfigEntity.RetrieveStrategy.MULTIPLE,
            top_k=5,
            score_threshold=0.8,
            reranking_model={"reranking_provider_name": "cohere", "reranking_model_name": "rerank-english-v2.0"},
            reranking_enabled=True,
        ),
    )

    model_config = ModelConfigEntity(provider="openai", model="gpt-4", mode="chat", parameters={}, stop=[])

    node = WorkflowConverter()._convert_to_knowledge_retrieval_node(
        new_app_mode=new_app_mode, dataset_config=dataset_config, model_config=model_config
    )
    assert node is not None

    assert node["data"]["type"] == "knowledge-retrieval"
    assert node["data"]["query_variable_selector"] == ["sys", "query"]
    assert node["data"]["dataset_ids"] == dataset_config.dataset_ids
    assert node["data"]["retrieval_mode"] == dataset_config.retrieve_config.retrieve_strategy.value
    assert node["data"]["multiple_retrieval_config"] == {
        "top_k": dataset_config.retrieve_config.top_k,
        "score_threshold": dataset_config.retrieve_config.score_threshold,
        "reranking_model": dataset_config.retrieve_config.reranking_model,
    }


def test__convert_to_knowledge_retrieval_node_for_workflow_app():
    new_app_mode = AppMode.WORKFLOW

    dataset_config = DatasetEntity(
        dataset_ids=["dataset_id_1", "dataset_id_2"],
        retrieve_config=DatasetRetrieveConfigEntity(
            query_variable="query",
            retrieve_strategy=DatasetRetrieveConfigEntity.RetrieveStrategy.MULTIPLE,
            top_k=5,
            score_threshold=0.8,
            reranking_model={"reranking_provider_name": "cohere", "reranking_model_name": "rerank-english-v2.0"},
            reranking_enabled=True,
        ),
    )

    model_config = ModelConfigEntity(provider="openai", model="gpt-4", mode="chat", parameters={}, stop=[])

    node = WorkflowConverter()._convert_to_knowledge_retrieval_node(
        new_app_mode=new_app_mode, dataset_config=dataset_config, model_config=model_config
    )
    assert node is not None

    assert node["data"]["type"] == "knowledge-retrieval"
    assert node["data"]["query_variable_selector"] == ["start", dataset_config.retrieve_config.query_variable]
    assert node["data"]["dataset_ids"] == dataset_config.dataset_ids
    assert node["data"]["retrieval_mode"] == dataset_config.retrieve_config.retrieve_strategy.value
    assert node["data"]["multiple_retrieval_config"] == {
        "top_k": dataset_config.retrieve_config.top_k,
        "score_threshold": dataset_config.retrieve_config.score_threshold,
        "reranking_model": dataset_config.retrieve_config.reranking_model,
    }


def test__convert_to_llm_node_for_chatbot_simple_chat_model(default_variables):
    new_app_mode = AppMode.ADVANCED_CHAT
    model = "gpt-4"
    model_mode = LLMMode.CHAT

    workflow_converter = WorkflowConverter()
    start_node = workflow_converter._convert_to_start_node(default_variables)
    graph = {
        "nodes": [start_node],
        "edges": [],  # no need
    }

    model_config_mock = MagicMock(spec=ModelConfigEntity)
    model_config_mock.provider = "openai"
    model_config_mock.model = model
    model_config_mock.mode = model_mode.value
    model_config_mock.parameters = {}
    model_config_mock.stop = []

    prompt_template = PromptTemplateEntity(
        prompt_type=PromptTemplateEntity.PromptType.SIMPLE,
        simple_prompt_template="You are a helpful assistant {{text_input}}, {{paragraph}}, {{select}}.",
    )

    llm_node = workflow_converter._convert_to_llm_node(
        original_app_mode=AppMode.CHAT,
        new_app_mode=new_app_mode,
        model_config=model_config_mock,
        graph=graph,
        prompt_template=prompt_template,
    )

    assert llm_node["data"]["type"] == "llm"
    assert llm_node["data"]["model"]["name"] == model
    assert llm_node["data"]["model"]["mode"] == model_mode.value
    template = prompt_template.simple_prompt_template
    assert template is not None
    for v in default_variables:
        template = template.replace("{{" + v.variable + "}}", "{{#start." + v.variable + "#}}")
    assert llm_node["data"]["prompt_template"][0]["text"] == template + "\n"
    assert llm_node["data"]["context"]["enabled"] is False


def test__convert_to_llm_node_for_chatbot_simple_completion_model(default_variables):
    new_app_mode = AppMode.ADVANCED_CHAT
    model = "gpt-3.5-turbo-instruct"
    model_mode = LLMMode.COMPLETION

    workflow_converter = WorkflowConverter()
    start_node = workflow_converter._convert_to_start_node(default_variables)
    graph = {
        "nodes": [start_node],
        "edges": [],  # no need
    }

    model_config_mock = MagicMock(spec=ModelConfigEntity)
    model_config_mock.provider = "openai"
    model_config_mock.model = model
    model_config_mock.mode = model_mode.value
    model_config_mock.parameters = {}
    model_config_mock.stop = []

    prompt_template = PromptTemplateEntity(
        prompt_type=PromptTemplateEntity.PromptType.SIMPLE,
        simple_prompt_template="You are a helpful assistant {{text_input}}, {{paragraph}}, {{select}}.",
    )

    llm_node = workflow_converter._convert_to_llm_node(
        original_app_mode=AppMode.CHAT,
        new_app_mode=new_app_mode,
        model_config=model_config_mock,
        graph=graph,
        prompt_template=prompt_template,
    )

    assert llm_node["data"]["type"] == "llm"
    assert llm_node["data"]["model"]["name"] == model
    assert llm_node["data"]["model"]["mode"] == model_mode.value
    template = prompt_template.simple_prompt_template
    assert template is not None
    for v in default_variables:
        template = template.replace("{{" + v.variable + "}}", "{{#start." + v.variable + "#}}")
    assert llm_node["data"]["prompt_template"]["text"] == template + "\n"
    assert llm_node["data"]["context"]["enabled"] is False


def test__convert_to_llm_node_for_chatbot_advanced_chat_model(default_variables):
    new_app_mode = AppMode.ADVANCED_CHAT
    model = "gpt-4"
    model_mode = LLMMode.CHAT

    workflow_converter = WorkflowConverter()
    start_node = workflow_converter._convert_to_start_node(default_variables)
    graph = {
        "nodes": [start_node],
        "edges": [],  # no need
    }

    model_config_mock = MagicMock(spec=ModelConfigEntity)
    model_config_mock.provider = "openai"
    model_config_mock.model = model
    model_config_mock.mode = model_mode.value
    model_config_mock.parameters = {}
    model_config_mock.stop = []

    prompt_template = PromptTemplateEntity(
        prompt_type=PromptTemplateEntity.PromptType.ADVANCED,
        advanced_chat_prompt_template=AdvancedChatPromptTemplateEntity(
            messages=[
                AdvancedChatMessageEntity(
                    text="You are a helpful assistant named {{name}}.\n\nContext:\n{{#context#}}",
                    role=PromptMessageRole.SYSTEM,
                ),
                AdvancedChatMessageEntity(text="Hi.", role=PromptMessageRole.USER),
                AdvancedChatMessageEntity(text="Hello!", role=PromptMessageRole.ASSISTANT),
            ]
        ),
    )

    llm_node = workflow_converter._convert_to_llm_node(
        original_app_mode=AppMode.CHAT,
        new_app_mode=new_app_mode,
        model_config=model_config_mock,
        graph=graph,
        prompt_template=prompt_template,
    )

    assert llm_node["data"]["type"] == "llm"
    assert llm_node["data"]["model"]["name"] == model
    assert llm_node["data"]["model"]["mode"] == model_mode.value
    assert isinstance(llm_node["data"]["prompt_template"], list)
    assert prompt_template.advanced_chat_prompt_template is not None
    assert len(llm_node["data"]["prompt_template"]) == len(prompt_template.advanced_chat_prompt_template.messages)
    template = prompt_template.advanced_chat_prompt_template.messages[0].text
    for v in default_variables:
        template = template.replace("{{" + v.variable + "}}", "{{#start." + v.variable + "#}}")
    assert llm_node["data"]["prompt_template"][0]["text"] == template


def test__convert_to_llm_node_for_workflow_advanced_completion_model(default_variables):
    new_app_mode = AppMode.ADVANCED_CHAT
    model = "gpt-3.5-turbo-instruct"
    model_mode = LLMMode.COMPLETION

    workflow_converter = WorkflowConverter()
    start_node = workflow_converter._convert_to_start_node(default_variables)
    graph = {
        "nodes": [start_node],
        "edges": [],  # no need
    }

    model_config_mock = MagicMock(spec=ModelConfigEntity)
    model_config_mock.provider = "openai"
    model_config_mock.model = model
    model_config_mock.mode = model_mode.value
    model_config_mock.parameters = {}
    model_config_mock.stop = []

    prompt_template = PromptTemplateEntity(
        prompt_type=PromptTemplateEntity.PromptType.ADVANCED,
        advanced_completion_prompt_template=AdvancedCompletionPromptTemplateEntity(
            prompt="You are a helpful assistant named {{name}}.\n\nContext:\n{{#context#}}\n\nHuman: hi\nAssistant: ",
            role_prefix=AdvancedCompletionPromptTemplateEntity.RolePrefixEntity(user="Human", assistant="Assistant"),
        ),
    )

    llm_node = workflow_converter._convert_to_llm_node(
        original_app_mode=AppMode.CHAT,
        new_app_mode=new_app_mode,
        model_config=model_config_mock,
        graph=graph,
        prompt_template=prompt_template,
    )

    assert llm_node["data"]["type"] == "llm"
    assert llm_node["data"]["model"]["name"] == model
    assert llm_node["data"]["model"]["mode"] == model_mode.value
    assert isinstance(llm_node["data"]["prompt_template"], dict)
    assert prompt_template.advanced_completion_prompt_template is not None
    template = prompt_template.advanced_completion_prompt_template.prompt
    for v in default_variables:
        template = template.replace("{{" + v.variable + "}}", "{{#start." + v.variable + "#}}")
    assert llm_node["data"]["prompt_template"]["text"] == template


# === Merged from test_workflow_converter_additional.py ===


import json
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

import pytest

from core.app.app_config.entities import (
    AdvancedCompletionPromptTemplateEntity,
    DatasetEntity,
    DatasetRetrieveConfigEntity,
    ExternalDataVariableEntity,
    ModelConfigEntity,
    PromptTemplateEntity,
)
from core.prompt.utils.prompt_template_parser import PromptTemplateParser
from dify_graph.model_runtime.entities.llm_entities import LLMMode
from dify_graph.nodes import NodeType
from models.model import AppMode
from services.workflow import workflow_converter as converter_module
from services.workflow.workflow_converter import WorkflowConverter


@pytest.fixture
def converter() -> WorkflowConverter:
    return WorkflowConverter()


def _build_start_graph() -> dict[str, Any]:
    return {
        "nodes": [
            {
                "id": "start",
                "position": None,
                "data": {"type": NodeType.START, "variables": [{"variable": "name"}, {"variable": "city"}]},
            }
        ],
        "edges": [],
    }


def _build_model_config(mode: str | LLMMode) -> ModelConfigEntity:
    return ModelConfigEntity(provider="openai", model="gpt-4", mode=mode, parameters={}, stop=[])


def test_convert_to_workflow_should_raise_when_app_model_config_is_missing(converter: WorkflowConverter) -> None:
    # Arrange
    app_model = SimpleNamespace(app_model_config=None)

    # Act / Assert
    with pytest.raises(ValueError, match="App model config is required"):
        converter.convert_to_workflow(
            app_model=app_model,
            account=SimpleNamespace(id="account-1"),
            name="new-app",
            icon_type="emoji",
            icon="robot",
            icon_background="#fff",
        )


@pytest.mark.parametrize(
    ("source_mode", "expected_mode"),
    [
        (AppMode.CHAT, AppMode.ADVANCED_CHAT),
        (AppMode.COMPLETION, AppMode.WORKFLOW),
    ],
)
def test_convert_to_workflow_should_create_new_app_with_fallback_fields(
    converter: WorkflowConverter,
    monkeypatch: pytest.MonkeyPatch,
    source_mode: AppMode,
    expected_mode: AppMode,
) -> None:
    # Arrange
    class FakeApp:
        def __init__(self) -> None:
            self.id = "new-app-id"

    workflow = SimpleNamespace(app_id=None)
    convert_mock = MagicMock(return_value=workflow)
    monkeypatch.setattr(converter, "convert_app_model_config_to_workflow", convert_mock)
    monkeypatch.setattr(converter_module, "App", FakeApp)
    db_session = SimpleNamespace(add=MagicMock(), flush=MagicMock(), commit=MagicMock())
    monkeypatch.setattr(converter_module, "db", SimpleNamespace(session=db_session))
    monkeypatch.setattr(converter_module.app_was_created, "send", MagicMock())
    account = SimpleNamespace(id="account-1")
    app_model = SimpleNamespace(
        tenant_id="tenant-1",
        name="Source App",
        mode=source_mode,
        icon_type="emoji",
        icon="sparkles",
        icon_background="#123456",
        enable_site=True,
        enable_api=True,
        api_rpm=10,
        api_rph=100,
        is_public=False,
        app_model_config=SimpleNamespace(id="config-1"),
    )

    # Act
    new_app = converter.convert_to_workflow(
        app_model=app_model,
        account=account,
        name="",
        icon_type="",
        icon="",
        icon_background="",
    )

    # Assert
    assert new_app.name == "Source App(workflow)"
    assert new_app.mode == expected_mode
    assert new_app.icon_type == "emoji"
    assert new_app.icon == "sparkles"
    assert new_app.icon_background == "#123456"
    assert new_app.created_by == "account-1"
    assert workflow.app_id == "new-app-id"
    db_session.add.assert_called_once()
    db_session.flush.assert_called_once()
    db_session.commit.assert_called_once()
    converter_module.app_was_created.send.assert_called_once_with(new_app, account=account)


def test_convert_app_model_config_to_workflow_should_build_advanced_chat_graph_and_features(
    converter: WorkflowConverter,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Arrange
    app_model = SimpleNamespace(id="app-1", tenant_id="tenant-1", mode=AppMode.CHAT)
    app_config = SimpleNamespace(
        variables=[SimpleNamespace(variable="name")],
        external_data_variables=[SimpleNamespace(variable="ext")],
        dataset=SimpleNamespace(id="dataset"),
        model=SimpleNamespace(),
        prompt_template=SimpleNamespace(),
        additional_features=SimpleNamespace(file_upload=SimpleNamespace()),
        app_model_config_dict={
            "opening_statement": "hello",
            "suggested_questions": ["q1"],
            "suggested_questions_after_answer": True,
            "speech_to_text": True,
            "text_to_speech": {"enabled": True},
            "file_upload": {"enabled": True},
            "sensitive_word_avoidance": {"enabled": True},
            "retriever_resource": {"enabled": True},
        },
    )

    class FakeWorkflow:
        VERSION_DRAFT = "draft"

        def __init__(self, **kwargs: Any) -> None:
            self.__dict__.update(kwargs)

    monkeypatch.setattr(converter, "_get_new_app_mode", MagicMock(return_value=AppMode.ADVANCED_CHAT))
    monkeypatch.setattr(converter, "_convert_to_app_config", MagicMock(return_value=app_config))
    monkeypatch.setattr(
        converter,
        "_convert_to_start_node",
        MagicMock(return_value={"id": "start", "position": None, "data": {"type": NodeType.START, "variables": []}}),
    )
    monkeypatch.setattr(
        converter,
        "_convert_to_http_request_node",
        MagicMock(
            return_value=(
                [{"id": "http", "position": None, "data": {"type": NodeType.HTTP_REQUEST}}],
                {"ext": "code_1"},
            )
        ),
    )
    monkeypatch.setattr(
        converter,
        "_convert_to_knowledge_retrieval_node",
        MagicMock(return_value={"id": "knowledge", "position": None, "data": {"type": NodeType.KNOWLEDGE_RETRIEVAL}}),
    )
    monkeypatch.setattr(
        converter,
        "_convert_to_llm_node",
        MagicMock(return_value={"id": "llm", "position": None, "data": {"type": NodeType.LLM}}),
    )
    monkeypatch.setattr(
        converter,
        "_convert_to_answer_node",
        MagicMock(return_value={"id": "answer", "position": None, "data": {"type": NodeType.ANSWER}}),
    )
    monkeypatch.setattr(converter_module, "Workflow", FakeWorkflow)
    db_session = SimpleNamespace(add=MagicMock(), commit=MagicMock())
    monkeypatch.setattr(converter_module, "db", SimpleNamespace(session=db_session))

    # Act
    workflow = converter.convert_app_model_config_to_workflow(
        app_model=app_model,
        app_model_config=SimpleNamespace(id="cfg"),
        account_id="account-1",
    )

    # Assert
    graph = json.loads(workflow.graph)
    node_ids = [node["id"] for node in graph["nodes"]]
    assert node_ids == ["start", "http", "knowledge", "llm", "answer"]
    features = json.loads(workflow.features)
    assert "opening_statement" in features
    assert "retriever_resource" in features
    db_session.add.assert_called_once()
    db_session.commit.assert_called_once()


def test_convert_app_model_config_to_workflow_should_build_workflow_mode_with_end_node(
    converter: WorkflowConverter,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Arrange
    app_model = SimpleNamespace(id="app-1", tenant_id="tenant-1", mode=AppMode.COMPLETION)
    app_config = SimpleNamespace(
        variables=[SimpleNamespace(variable="name")],
        external_data_variables=[],
        dataset=SimpleNamespace(id="dataset"),
        model=SimpleNamespace(),
        prompt_template=SimpleNamespace(),
        additional_features=None,
        app_model_config_dict={
            "text_to_speech": {"enabled": False},
            "file_upload": {"enabled": False},
            "sensitive_word_avoidance": {"enabled": False},
        },
    )

    class FakeWorkflow:
        VERSION_DRAFT = "draft"

        def __init__(self, **kwargs: Any) -> None:
            self.__dict__.update(kwargs)

    monkeypatch.setattr(converter, "_get_new_app_mode", MagicMock(return_value=AppMode.WORKFLOW))
    monkeypatch.setattr(converter, "_convert_to_app_config", MagicMock(return_value=app_config))
    monkeypatch.setattr(
        converter,
        "_convert_to_start_node",
        MagicMock(return_value={"id": "start", "position": None, "data": {"type": NodeType.START, "variables": []}}),
    )
    monkeypatch.setattr(converter, "_convert_to_knowledge_retrieval_node", MagicMock(return_value=None))
    monkeypatch.setattr(
        converter,
        "_convert_to_llm_node",
        MagicMock(return_value={"id": "llm", "position": None, "data": {"type": NodeType.LLM}}),
    )
    monkeypatch.setattr(
        converter,
        "_convert_to_end_node",
        MagicMock(return_value={"id": "end", "position": None, "data": {"type": NodeType.END}}),
    )
    monkeypatch.setattr(converter_module, "Workflow", FakeWorkflow)
    db_session = SimpleNamespace(add=MagicMock(), commit=MagicMock())
    monkeypatch.setattr(converter_module, "db", SimpleNamespace(session=db_session))

    # Act
    workflow = converter.convert_app_model_config_to_workflow(
        app_model=app_model,
        app_model_config=SimpleNamespace(id="cfg"),
        account_id="account-1",
    )

    # Assert
    graph = json.loads(workflow.graph)
    node_ids = [node["id"] for node in graph["nodes"]]
    assert node_ids == ["start", "llm", "end"]
    features = json.loads(workflow.features)
    assert set(features.keys()) == {"text_to_speech", "file_upload", "sensitive_word_avoidance"}


def test_convert_to_app_config_should_route_to_correct_manager(
    converter: WorkflowConverter,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Arrange
    agent_result = SimpleNamespace(kind="agent")
    chat_result = SimpleNamespace(kind="chat")
    completion_result = SimpleNamespace(kind="completion")
    monkeypatch.setattr(converter_module.AgentChatAppConfigManager, "get_app_config", MagicMock(return_value=agent_result))
    monkeypatch.setattr(converter_module.ChatAppConfigManager, "get_app_config", MagicMock(return_value=chat_result))
    monkeypatch.setattr(
        converter_module.CompletionAppConfigManager,
        "get_app_config",
        MagicMock(return_value=completion_result),
    )

    # Act
    from_agent_mode = converter._convert_to_app_config(
        app_model=SimpleNamespace(mode=AppMode.AGENT_CHAT, is_agent=False),
        app_model_config=SimpleNamespace(id="cfg-1"),
    )
    from_agent_flag = converter._convert_to_app_config(
        app_model=SimpleNamespace(mode=AppMode.CHAT, is_agent=True),
        app_model_config=SimpleNamespace(id="cfg-2"),
    )
    from_chat_mode = converter._convert_to_app_config(
        app_model=SimpleNamespace(mode=AppMode.CHAT, is_agent=False),
        app_model_config=SimpleNamespace(id="cfg-3"),
    )
    from_completion_mode = converter._convert_to_app_config(
        app_model=SimpleNamespace(mode=AppMode.COMPLETION, is_agent=False),
        app_model_config=SimpleNamespace(id="cfg-4"),
    )

    # Assert
    assert from_agent_mode is agent_result
    assert from_agent_flag is agent_result
    assert from_chat_mode is chat_result
    assert from_completion_mode is completion_result


def test_convert_to_app_config_should_raise_for_invalid_app_mode(converter: WorkflowConverter) -> None:
    # Arrange
    app_model = SimpleNamespace(mode=AppMode.WORKFLOW, is_agent=False)

    # Act / Assert
    with pytest.raises(ValueError, match="Invalid app mode"):
        converter._convert_to_app_config(app_model=app_model, app_model_config=SimpleNamespace(id="cfg"))


def test_convert_to_http_request_node_should_skip_non_api_and_missing_extension_id(
    converter: WorkflowConverter,
) -> None:
    # Arrange
    app_model = SimpleNamespace(id="app-1", tenant_id="tenant-1", mode=AppMode.CHAT)
    external_data_variables = [
        ExternalDataVariableEntity(variable="skip_type", type="dataset", config={"api_based_extension_id": "x"}),
        ExternalDataVariableEntity(variable="skip_config", type="api", config={}),
    ]

    # Act
    nodes, mapping = converter._convert_to_http_request_node(
        app_model=app_model,
        variables=[],
        external_data_variables=external_data_variables,
    )

    # Assert
    assert nodes == []
    assert mapping == {}


def test_convert_to_knowledge_retrieval_node_should_return_none_for_workflow_without_query_variable(
    converter: WorkflowConverter,
) -> None:
    # Arrange
    dataset_config = DatasetEntity(
        dataset_ids=["ds-1"],
        retrieve_config=DatasetRetrieveConfigEntity(
            query_variable=None,
            retrieve_strategy=DatasetRetrieveConfigEntity.RetrieveStrategy.MULTIPLE,
        ),
    )
    model_config = _build_model_config(mode=LLMMode.CHAT)

    # Act
    node = converter._convert_to_knowledge_retrieval_node(
        new_app_mode=AppMode.WORKFLOW,
        dataset_config=dataset_config,
        model_config=model_config,
    )

    # Assert
    assert node is None


def test_convert_to_llm_node_should_raise_when_simple_chat_template_missing(
    converter: WorkflowConverter,
) -> None:
    # Arrange
    graph = _build_start_graph()
    model_config = _build_model_config(mode=LLMMode.CHAT)
    prompt_template = PromptTemplateEntity(prompt_type=PromptTemplateEntity.PromptType.SIMPLE)

    # Act / Assert
    with pytest.raises(ValueError, match="Simple prompt template is required"):
        converter._convert_to_llm_node(
            original_app_mode=AppMode.CHAT,
            new_app_mode=AppMode.ADVANCED_CHAT,
            graph=graph,
            model_config=model_config,
            prompt_template=prompt_template,
        )


def test_convert_to_llm_node_should_raise_when_prompt_template_parser_type_is_invalid_for_chat(
    converter: WorkflowConverter,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Arrange
    graph = _build_start_graph()
    model_config = _build_model_config(mode=LLMMode.CHAT)
    prompt_template = PromptTemplateEntity(
        prompt_type=PromptTemplateEntity.PromptType.SIMPLE,
        simple_prompt_template="Hello {{name}}",
    )
    monkeypatch.setattr(
        converter_module.SimplePromptTransform,
        "get_prompt_template",
        lambda self, **kwargs: {"prompt_template": "invalid"},
    )

    # Act / Assert
    with pytest.raises(TypeError, match="Expected PromptTemplateParser"):
        converter._convert_to_llm_node(
            original_app_mode=AppMode.CHAT,
            new_app_mode=AppMode.ADVANCED_CHAT,
            graph=graph,
            model_config=model_config,
            prompt_template=prompt_template,
        )


def test_convert_to_llm_node_should_raise_when_simple_completion_template_missing(
    converter: WorkflowConverter,
) -> None:
    # Arrange
    graph = _build_start_graph()
    model_config = _build_model_config(mode=LLMMode.COMPLETION)
    prompt_template = PromptTemplateEntity(prompt_type=PromptTemplateEntity.PromptType.SIMPLE)

    # Act / Assert
    with pytest.raises(ValueError, match="Simple prompt template is required"):
        converter._convert_to_llm_node(
            original_app_mode=AppMode.COMPLETION,
            new_app_mode=AppMode.WORKFLOW,
            graph=graph,
            model_config=model_config,
            prompt_template=prompt_template,
        )


def test_convert_to_llm_node_should_raise_when_completion_prompt_rules_type_is_invalid(
    converter: WorkflowConverter,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Arrange
    graph = _build_start_graph()
    model_config = _build_model_config(mode=LLMMode.COMPLETION)
    prompt_template = PromptTemplateEntity(
        prompt_type=PromptTemplateEntity.PromptType.SIMPLE,
        simple_prompt_template="Hello {{name}}",
    )
    monkeypatch.setattr(
        converter_module.SimplePromptTransform,
        "get_prompt_template",
        lambda self, **kwargs: {"prompt_template": PromptTemplateParser("Hello {{name}}"), "prompt_rules": "invalid"},
    )

    # Act / Assert
    with pytest.raises(TypeError, match="Expected dict for prompt_rules"):
        converter._convert_to_llm_node(
            original_app_mode=AppMode.COMPLETION,
            new_app_mode=AppMode.ADVANCED_CHAT,
            graph=graph,
            model_config=model_config,
            prompt_template=prompt_template,
        )


def test_convert_to_llm_node_should_use_empty_text_for_advanced_completion_without_template(
    converter: WorkflowConverter,
) -> None:
    # Arrange
    graph = _build_start_graph()
    model_config = _build_model_config(mode=LLMMode.COMPLETION)
    prompt_template = PromptTemplateEntity(
        prompt_type=PromptTemplateEntity.PromptType.ADVANCED,
        advanced_completion_prompt_template=None,
    )

    # Act
    llm_node = converter._convert_to_llm_node(
        original_app_mode=AppMode.COMPLETION,
        new_app_mode=AppMode.WORKFLOW,
        graph=graph,
        model_config=model_config,
        prompt_template=prompt_template,
    )

    # Assert
    assert llm_node["data"]["prompt_template"]["text"] == ""
    assert llm_node["data"]["memory"] is None


def test_replace_template_variables_should_replace_start_and_external_references(converter: WorkflowConverter) -> None:
    # Arrange
    template = "Hello {{name}} from {{city}} with {{weather}}"
    variables = [{"variable": "name"}, {"variable": "city"}]
    external_mapping = {"weather": "code_1"}

    # Act
    result = converter._replace_template_variables(template, variables, external_mapping)

    # Assert
    assert result == "Hello {{#start.name#}} from {{#start.city#}} with {{#code_1.result#}}"


def test_graph_helpers_should_create_edges_append_nodes_and_choose_mode(converter: WorkflowConverter) -> None:
    # Arrange
    graph = {"nodes": [{"id": "start", "position": None, "data": {"type": NodeType.START}}], "edges": []}
    node = {"id": "llm", "position": None, "data": {"type": NodeType.LLM}}

    # Act
    edge = converter._create_edge("start", "llm")
    updated_graph = converter._append_node(graph, node)
    workflow_mode = converter._get_new_app_mode(SimpleNamespace(mode=AppMode.COMPLETION))
    advanced_chat_mode = converter._get_new_app_mode(SimpleNamespace(mode=AppMode.CHAT))

    # Assert
    assert edge == {"id": "start-llm", "source": "start", "target": "llm"}
    assert updated_graph["nodes"][-1]["id"] == "llm"
    assert updated_graph["edges"][-1]["source"] == "start"
    assert workflow_mode == AppMode.WORKFLOW
    assert advanced_chat_mode == AppMode.ADVANCED_CHAT


def test_get_api_based_extension_should_raise_when_extension_not_found(
    converter: WorkflowConverter,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Arrange
    query_mock = MagicMock()
    query_mock.where.return_value = query_mock
    query_mock.first.return_value = None
    db_session = SimpleNamespace(query=MagicMock(return_value=query_mock))
    monkeypatch.setattr(converter_module, "db", SimpleNamespace(session=db_session))

    # Act / Assert
    with pytest.raises(ValueError, match="API Based Extension not found"):
        converter._get_api_based_extension(tenant_id="tenant-1", api_based_extension_id="ext-1")


def test_get_api_based_extension_should_return_entity_when_found(
    converter: WorkflowConverter,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Arrange
    extension = SimpleNamespace(id="ext-1")
    query_mock = MagicMock()
    query_mock.where.return_value = query_mock
    query_mock.first.return_value = extension
    db_session = SimpleNamespace(query=MagicMock(return_value=query_mock))
    monkeypatch.setattr(converter_module, "db", SimpleNamespace(session=db_session))

    # Act
    result = converter._get_api_based_extension(tenant_id="tenant-1", api_based_extension_id="ext-1")

    # Assert
    assert result is extension
