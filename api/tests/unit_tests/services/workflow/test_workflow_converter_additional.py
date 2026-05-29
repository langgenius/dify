from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any, cast
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
from core.prompt.utils.prompt_template_parser import PromptTemplateParser
from models.api_based_extension import APIBasedExtension, APIBasedExtensionPoint
from models.model import Account, App, AppMode, AppModelConfig
from services.workflow import workflow_converter as converter_module
from services.workflow.workflow_converter import WorkflowConverter

try:
    from graphon.enums import BuiltinNodeTypes
    from graphon.model_runtime.entities.llm_entities import LLMMode
    from graphon.model_runtime.entities.message_entities import PromptMessageRole
    from graphon.variables.input_entities import VariableEntity, VariableEntityType
except ModuleNotFoundError:
    from dify_graph.enums import BuiltinNodeTypes
    from dify_graph.model_runtime.entities.llm_entities import LLMMode
    from dify_graph.model_runtime.entities.message_entities import PromptMessageRole
    from dify_graph.variables.input_entities import VariableEntity, VariableEntityType


@pytest.fixture
def converter() -> WorkflowConverter:
    return WorkflowConverter()


def _app_model(**kwargs: Any) -> App:
    return cast(App, SimpleNamespace(**kwargs))


def _account(**kwargs: Any) -> Account:
    return cast(Account, SimpleNamespace(**kwargs))


def _app_model_config(**kwargs: Any) -> AppModelConfig:
    return cast(AppModelConfig, SimpleNamespace(**kwargs))


def _build_start_graph() -> dict[str, Any]:
    return {
        "nodes": [
            {
                "id": "start",
                "position": None,
                "data": {"type": BuiltinNodeTypes.START, "variables": [{"variable": "name"}, {"variable": "city"}]},
            }
        ],
        "edges": [],
    }


def _build_model_config(mode: str | LLMMode) -> ModelConfigEntity:
    return ModelConfigEntity(provider="openai", model="gpt-4", mode=mode, parameters={}, stop=[])


@pytest.fixture
def default_variables() -> list[VariableEntity]:
    return [
        VariableEntity(variable="text_input", label="text-input", type=VariableEntityType.TEXT_INPUT),
        VariableEntity(variable="paragraph", label="paragraph", type=VariableEntityType.PARAGRAPH),
        VariableEntity(variable="select", label="select", type=VariableEntityType.SELECT),
    ]


def test__convert_to_start_node(default_variables: list[VariableEntity]) -> None:
    result = WorkflowConverter()._convert_to_start_node(default_variables)

    assert result["id"] == "start"
    assert result["data"]["type"] == BuiltinNodeTypes.START
    assert result["data"]["variables"][0]["type"] == "text-input"
    assert result["data"]["variables"][0]["variable"] == "text_input"


def test__convert_to_http_request_node_for_chatbot(default_variables: list[VariableEntity]) -> None:
    app_model = MagicMock()
    app_model.id = "app_id"
    app_model.tenant_id = "tenant_id"
    app_model.mode = AppMode.CHAT

    extension = APIBasedExtension(
        tenant_id="tenant_id",
        name="api-1",
        api_key="encrypted_api_key",
        api_endpoint="https://dify.ai",
    )
    extension.id = "api_based_extension_id"

    workflow_converter = WorkflowConverter()
    workflow_converter._get_api_based_extension = MagicMock(return_value=extension)
    encrypter.decrypt_token = MagicMock(return_value="api_key")

    external_data_variables = [
        ExternalDataVariableEntity(
            variable="external_variable",
            type="api",
            config={"api_based_extension_id": "api_based_extension_id"},
        ),
    ]

    nodes, mapping = workflow_converter._convert_to_http_request_node(
        app_model=app_model,
        variables=default_variables,
        external_data_variables=external_data_variables,
    )

    assert len(nodes) == 2
    assert nodes[0]["data"]["type"] == BuiltinNodeTypes.HTTP_REQUEST
    assert nodes[1]["data"]["type"] == BuiltinNodeTypes.CODE
    body = json.loads(nodes[0]["data"]["body"]["data"])
    assert body["point"] == APIBasedExtensionPoint.APP_EXTERNAL_DATA_TOOL_QUERY
    assert body["params"]["query"] == "{{#sys.query#}}"
    assert body["params"]["inputs"]["text_input"] == "{{#start.text_input#}}"
    assert mapping == {"external_variable": "code_1"}


def test__convert_to_http_request_node_for_workflow_app(default_variables: list[VariableEntity]) -> None:
    app_model = MagicMock()
    app_model.id = "app_id"
    app_model.tenant_id = "tenant_id"
    app_model.mode = AppMode.WORKFLOW

    extension = APIBasedExtension(
        tenant_id="tenant_id",
        name="api-1",
        api_key="encrypted_api_key",
        api_endpoint="https://dify.ai",
    )
    extension.id = "api_based_extension_id"

    workflow_converter = WorkflowConverter()
    workflow_converter._get_api_based_extension = MagicMock(return_value=extension)
    encrypter.decrypt_token = MagicMock(return_value="api_key")

    external_data_variables = [
        ExternalDataVariableEntity(
            variable="external_variable",
            type="api",
            config={"api_based_extension_id": "api_based_extension_id"},
        ),
    ]

    nodes, _ = workflow_converter._convert_to_http_request_node(
        app_model=app_model,
        variables=default_variables,
        external_data_variables=external_data_variables,
    )

    body = json.loads(nodes[0]["data"]["body"]["data"])
    assert body["params"]["query"] == ""


def test__convert_to_knowledge_retrieval_node_for_chatbot() -> None:
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
        new_app_mode=AppMode.ADVANCED_CHAT,
        dataset_config=dataset_config,
        model_config=model_config,
    )

    assert node is not None
    assert node["data"]["query_variable_selector"] == ["sys", "query"]
    assert node["data"]["multiple_retrieval_config"]["top_k"] == 5


def test__convert_to_knowledge_retrieval_node_for_workflow_app() -> None:
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
        new_app_mode=AppMode.WORKFLOW,
        dataset_config=dataset_config,
        model_config=model_config,
    )

    assert node is not None
    assert node["data"]["query_variable_selector"] == ["start", "query"]


def test__convert_to_llm_node_for_chatbot_simple_chat_model(default_variables: list[VariableEntity]) -> None:
    workflow_converter = WorkflowConverter()
    graph = {"nodes": [workflow_converter._convert_to_start_node(default_variables)], "edges": []}
    model_config = ModelConfigEntity(provider="openai", model="gpt-4", mode=LLMMode.CHAT.value, parameters={}, stop=[])
    prompt_template = PromptTemplateEntity(
        prompt_type=PromptTemplateEntity.PromptType.SIMPLE,
        simple_prompt_template="You are a helper for {{text_input}} and {{paragraph}}",
    )

    node = workflow_converter._convert_to_llm_node(
        original_app_mode=AppMode.CHAT,
        new_app_mode=AppMode.ADVANCED_CHAT,
        model_config=model_config,
        graph=graph,
        prompt_template=prompt_template,
    )

    assert node["data"]["type"] == BuiltinNodeTypes.LLM
    assert node["data"]["memory"] is not None
    assert node["data"]["prompt_template"][0]["role"] == "user"
    assert "{{#start.text_input#}}" in node["data"]["prompt_template"][0]["text"]


def test__convert_to_llm_node_for_chatbot_simple_chat_model_with_empty_template(
    default_variables: list[VariableEntity],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workflow_converter = WorkflowConverter()
    graph = {"nodes": [workflow_converter._convert_to_start_node(default_variables)], "edges": []}
    model_config = ModelConfigEntity(provider="openai", model="gpt-4", mode=LLMMode.CHAT.value, parameters={}, stop=[])
    prompt_template = PromptTemplateEntity(
        prompt_type=PromptTemplateEntity.PromptType.SIMPLE,
        simple_prompt_template="ignored",
    )
    monkeypatch.setattr(
        converter_module.SimplePromptTransform,
        "get_prompt_template",
        lambda self, **kwargs: {"prompt_template": PromptTemplateParser(""), "prompt_rules": {}},
    )

    node = workflow_converter._convert_to_llm_node(
        original_app_mode=AppMode.CHAT,
        new_app_mode=AppMode.ADVANCED_CHAT,
        model_config=model_config,
        graph=graph,
        prompt_template=prompt_template,
    )

    assert node["data"]["prompt_template"] == []


def test__convert_to_llm_node_for_chatbot_advanced_chat_model(default_variables: list[VariableEntity]) -> None:
    workflow_converter = WorkflowConverter()
    graph = {"nodes": [workflow_converter._convert_to_start_node(default_variables)], "edges": []}
    model_config = ModelConfigEntity(provider="openai", model="gpt-4", mode=LLMMode.CHAT.value, parameters={}, stop=[])
    prompt_template = PromptTemplateEntity(
        prompt_type=PromptTemplateEntity.PromptType.ADVANCED,
        advanced_chat_prompt_template=AdvancedChatPromptTemplateEntity(
            messages=[AdvancedChatMessageEntity(text="Hello {{text_input}}", role=PromptMessageRole.USER)]
        ),
    )

    node = workflow_converter._convert_to_llm_node(
        original_app_mode=AppMode.CHAT,
        new_app_mode=AppMode.ADVANCED_CHAT,
        model_config=model_config,
        graph=graph,
        prompt_template=prompt_template,
    )

    assert isinstance(node["data"]["prompt_template"], list)
    assert node["data"]["prompt_template"][0]["role"] == PromptMessageRole.USER.value


def test__convert_to_llm_node_for_chatbot_advanced_chat_model_without_template(
    default_variables: list[VariableEntity],
) -> None:
    workflow_converter = WorkflowConverter()
    graph = {"nodes": [workflow_converter._convert_to_start_node(default_variables)], "edges": []}
    model_config = ModelConfigEntity(provider="openai", model="gpt-4", mode=LLMMode.CHAT.value, parameters={}, stop=[])
    prompt_template = PromptTemplateEntity(
        prompt_type=PromptTemplateEntity.PromptType.ADVANCED,
        advanced_chat_prompt_template=None,
    )

    node = workflow_converter._convert_to_llm_node(
        original_app_mode=AppMode.CHAT,
        new_app_mode=AppMode.WORKFLOW,
        model_config=model_config,
        graph=graph,
        prompt_template=prompt_template,
    )

    assert node["data"]["prompt_template"] == []
    assert node["data"]["memory"] is None


def test__convert_to_llm_node_for_workflow_advanced_completion_model(default_variables: list[VariableEntity]) -> None:
    workflow_converter = WorkflowConverter()
    graph = {"nodes": [workflow_converter._convert_to_start_node(default_variables)], "edges": []}
    model_config = ModelConfigEntity(
        provider="openai",
        model="gpt-3.5-turbo-instruct",
        mode=LLMMode.COMPLETION.value,
        parameters={},
        stop=[],
    )
    prompt_template = PromptTemplateEntity(
        prompt_type=PromptTemplateEntity.PromptType.ADVANCED,
        advanced_completion_prompt_template=AdvancedCompletionPromptTemplateEntity(
            prompt="Hello {{text_input}} and {{#query#}}",
            role_prefix=AdvancedCompletionPromptTemplateEntity.RolePrefixEntity(user="Human", assistant="Assistant"),
        ),
    )

    node = workflow_converter._convert_to_llm_node(
        original_app_mode=AppMode.COMPLETION,
        new_app_mode=AppMode.ADVANCED_CHAT,
        model_config=model_config,
        graph=graph,
        prompt_template=prompt_template,
    )

    assert node["data"]["prompt_template"]["text"].find("{{#sys.query#}}") != -1
    assert node["data"]["memory"]["role_prefix"]["user"] == "Human"


def test__convert_to_end_node() -> None:
    node = WorkflowConverter()._convert_to_end_node()
    assert node["id"] == "end"
    assert node["data"]["type"] == BuiltinNodeTypes.END


def test__convert_to_answer_node() -> None:
    node = WorkflowConverter()._convert_to_answer_node()
    assert node["id"] == "answer"
    assert node["data"]["type"] == BuiltinNodeTypes.ANSWER


def test_convert_to_workflow_should_raise_when_app_model_config_is_missing(converter: WorkflowConverter) -> None:
    app_model = _app_model(app_model_config=None)

    with pytest.raises(ValueError, match="App model config is required"):
        converter.convert_to_workflow(
            app_model=app_model,
            account=_account(id="account-1"),
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
    class FakeApp:
        def __init__(self) -> None:
            self.id = "new-app-id"

    workflow = SimpleNamespace(app_id=None)
    monkeypatch.setattr(converter, "convert_app_model_config_to_workflow", MagicMock(return_value=workflow))
    monkeypatch.setattr(converter_module, "App", FakeApp)

    db_session = SimpleNamespace(add=MagicMock(), flush=MagicMock(), commit=MagicMock())
    monkeypatch.setattr(converter_module, "db", SimpleNamespace(session=db_session))

    send_mock = MagicMock()
    monkeypatch.setattr(converter_module.app_was_created, "send", send_mock)

    account = _account(id="account-1")
    app_model = _app_model(
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
        app_model_config=_app_model_config(id="config-1"),
    )

    new_app = converter.convert_to_workflow(
        app_model=app_model,
        account=account,
        name="",
        icon_type="",
        icon="",
        icon_background="",
    )

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
    send_mock.assert_called_once_with(new_app, account=account)


def test_convert_app_model_config_to_workflow_should_build_advanced_chat_graph_and_features(
    converter: WorkflowConverter,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app_model = _app_model(id="app-1", tenant_id="tenant-1", mode=AppMode.CHAT)
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
        MagicMock(
            return_value={"id": "start", "position": None, "data": {"type": BuiltinNodeTypes.START, "variables": []}}
        ),
    )
    monkeypatch.setattr(
        converter,
        "_convert_to_http_request_node",
        MagicMock(
            return_value=(
                [{"id": "http", "position": None, "data": {"type": BuiltinNodeTypes.HTTP_REQUEST}}],
                {"ext": "code_1"},
            )
        ),
    )
    monkeypatch.setattr(
        converter,
        "_convert_to_knowledge_retrieval_node",
        MagicMock(
            return_value={"id": "knowledge", "position": None, "data": {"type": BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL}}
        ),
    )
    monkeypatch.setattr(
        converter,
        "_convert_to_llm_node",
        MagicMock(return_value={"id": "llm", "position": None, "data": {"type": BuiltinNodeTypes.LLM}}),
    )
    monkeypatch.setattr(
        converter,
        "_convert_to_answer_node",
        MagicMock(return_value={"id": "answer", "position": None, "data": {"type": BuiltinNodeTypes.ANSWER}}),
    )
    monkeypatch.setattr(converter_module, "Workflow", FakeWorkflow)

    db_session = SimpleNamespace(add=MagicMock(), commit=MagicMock())
    monkeypatch.setattr(converter_module, "db", SimpleNamespace(session=db_session))

    workflow = converter.convert_app_model_config_to_workflow(
        app_model=app_model,
        app_model_config=_app_model_config(id="cfg"),
        account_id="account-1",
    )

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
    app_model = _app_model(id="app-1", tenant_id="tenant-1", mode=AppMode.COMPLETION)
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
        MagicMock(
            return_value={"id": "start", "position": None, "data": {"type": BuiltinNodeTypes.START, "variables": []}}
        ),
    )
    monkeypatch.setattr(converter, "_convert_to_knowledge_retrieval_node", MagicMock(return_value=None))
    monkeypatch.setattr(
        converter,
        "_convert_to_llm_node",
        MagicMock(return_value={"id": "llm", "position": None, "data": {"type": BuiltinNodeTypes.LLM}}),
    )
    monkeypatch.setattr(
        converter,
        "_convert_to_end_node",
        MagicMock(return_value={"id": "end", "position": None, "data": {"type": BuiltinNodeTypes.END}}),
    )
    monkeypatch.setattr(converter_module, "Workflow", FakeWorkflow)

    db_session = SimpleNamespace(add=MagicMock(), commit=MagicMock())
    monkeypatch.setattr(converter_module, "db", SimpleNamespace(session=db_session))

    workflow = converter.convert_app_model_config_to_workflow(
        app_model=app_model,
        app_model_config=_app_model_config(id="cfg"),
        account_id="account-1",
    )

    graph = json.loads(workflow.graph)
    node_ids = [node["id"] for node in graph["nodes"]]
    assert node_ids == ["start", "llm", "end"]

    features = json.loads(workflow.features)
    assert set(features.keys()) == {"text_to_speech", "file_upload", "sensitive_word_avoidance"}


def test_convert_to_app_config_should_route_to_correct_manager(
    converter: WorkflowConverter,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    agent_result = SimpleNamespace(kind="agent")
    chat_result = SimpleNamespace(kind="chat")
    completion_result = SimpleNamespace(kind="completion")
    monkeypatch.setattr(
        converter_module.AgentChatAppConfigManager, "get_app_config", MagicMock(return_value=agent_result)
    )
    monkeypatch.setattr(converter_module.ChatAppConfigManager, "get_app_config", MagicMock(return_value=chat_result))
    monkeypatch.setattr(
        converter_module.CompletionAppConfigManager,
        "get_app_config",
        MagicMock(return_value=completion_result),
    )

    from_agent_mode = converter._convert_to_app_config(
        app_model=_app_model(mode=AppMode.AGENT_CHAT, is_agent=False),
        app_model_config=_app_model_config(id="cfg-1"),
    )
    from_agent_flag = converter._convert_to_app_config(
        app_model=_app_model(mode=AppMode.CHAT, is_agent=True),
        app_model_config=_app_model_config(id="cfg-2"),
    )
    from_chat_mode = converter._convert_to_app_config(
        app_model=_app_model(mode=AppMode.CHAT, is_agent=False),
        app_model_config=_app_model_config(id="cfg-3"),
    )
    from_completion_mode = converter._convert_to_app_config(
        app_model=_app_model(mode=AppMode.COMPLETION, is_agent=False),
        app_model_config=_app_model_config(id="cfg-4"),
    )

    assert from_agent_mode is agent_result
    assert from_agent_flag is agent_result
    assert from_chat_mode is chat_result
    assert from_completion_mode is completion_result


def test_convert_to_app_config_should_raise_for_invalid_app_mode(converter: WorkflowConverter) -> None:
    app_model = _app_model(mode=AppMode.WORKFLOW, is_agent=False)

    with pytest.raises(ValueError, match="Invalid app mode"):
        converter._convert_to_app_config(app_model=app_model, app_model_config=_app_model_config(id="cfg"))


def test_convert_to_http_request_node_should_skip_non_api_and_missing_extension_id(
    converter: WorkflowConverter,
) -> None:
    app_model = _app_model(id="app-1", tenant_id="tenant-1", mode=AppMode.CHAT)
    external_data_variables = [
        ExternalDataVariableEntity(variable="skip_type", type="dataset", config={"api_based_extension_id": "x"}),
        ExternalDataVariableEntity(variable="skip_config", type="api", config={}),
    ]

    nodes, mapping = converter._convert_to_http_request_node(
        app_model=app_model,
        variables=[],
        external_data_variables=external_data_variables,
    )

    assert nodes == []
    assert mapping == {}


def test_convert_to_knowledge_retrieval_node_should_return_none_for_workflow_without_query_variable(
    converter: WorkflowConverter,
) -> None:
    dataset_config = DatasetEntity(
        dataset_ids=["ds-1"],
        retrieve_config=DatasetRetrieveConfigEntity(
            query_variable=None,
            retrieve_strategy=DatasetRetrieveConfigEntity.RetrieveStrategy.MULTIPLE,
        ),
    )
    model_config = _build_model_config(mode=LLMMode.CHAT)

    node = converter._convert_to_knowledge_retrieval_node(
        new_app_mode=AppMode.WORKFLOW,
        dataset_config=dataset_config,
        model_config=model_config,
    )

    assert node is None


def test_convert_to_llm_node_should_raise_when_simple_chat_template_missing(
    converter: WorkflowConverter,
) -> None:
    graph = _build_start_graph()
    model_config = _build_model_config(mode=LLMMode.CHAT)
    prompt_template = PromptTemplateEntity(prompt_type=PromptTemplateEntity.PromptType.SIMPLE)

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
    graph = _build_start_graph()
    model_config = _build_model_config(mode=LLMMode.COMPLETION)
    prompt_template = PromptTemplateEntity(prompt_type=PromptTemplateEntity.PromptType.SIMPLE)

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
    graph = _build_start_graph()
    model_config = _build_model_config(mode=LLMMode.COMPLETION)
    prompt_template = PromptTemplateEntity(
        prompt_type=PromptTemplateEntity.PromptType.ADVANCED,
        advanced_completion_prompt_template=None,
    )

    llm_node = converter._convert_to_llm_node(
        original_app_mode=AppMode.COMPLETION,
        new_app_mode=AppMode.WORKFLOW,
        graph=graph,
        model_config=model_config,
        prompt_template=prompt_template,
    )

    assert llm_node["data"]["prompt_template"]["text"] == ""
    assert llm_node["data"]["memory"] is None


def test_replace_template_variables_should_replace_start_and_external_references(converter: WorkflowConverter) -> None:
    template = "Hello {{name}} from {{city}} with {{weather}}"
    variables = [{"variable": "name"}, {"variable": "city"}]
    external_mapping = {"weather": "code_1"}

    result = converter._replace_template_variables(template, variables, external_mapping)

    assert result == "Hello {{#start.name#}} from {{#start.city#}} with {{#code_1.result#}}"


def test_graph_helpers_should_create_edges_append_nodes_and_choose_mode(converter: WorkflowConverter) -> None:
    graph = {"nodes": [{"id": "start", "position": None, "data": {"type": BuiltinNodeTypes.START}}], "edges": []}
    node = {"id": "llm", "position": None, "data": {"type": BuiltinNodeTypes.LLM}}

    edge = converter._create_edge("start", "llm")
    updated_graph = converter._append_node(graph, node)
    workflow_mode = converter._get_new_app_mode(_app_model(mode=AppMode.COMPLETION))
    advanced_chat_mode = converter._get_new_app_mode(_app_model(mode=AppMode.CHAT))

    assert edge == {"id": "start-llm", "source": "start", "target": "llm"}
    assert updated_graph["nodes"][-1]["id"] == "llm"
    assert updated_graph["edges"][-1]["source"] == "start"
    assert workflow_mode == AppMode.WORKFLOW
    assert advanced_chat_mode == AppMode.ADVANCED_CHAT


def test_get_api_based_extension_should_raise_when_extension_not_found(
    converter: WorkflowConverter,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db_session = SimpleNamespace(scalar=MagicMock(return_value=None))
    monkeypatch.setattr(converter_module, "db", SimpleNamespace(session=db_session))

    with pytest.raises(ValueError, match="API Based Extension not found"):
        converter._get_api_based_extension(tenant_id="tenant-1", api_based_extension_id="ext-1")
    db_session.scalar.assert_called_once()


def test_get_api_based_extension_should_return_entity_when_found(
    converter: WorkflowConverter,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    extension = SimpleNamespace(id="ext-1")
    db_session = SimpleNamespace(scalar=MagicMock(return_value=extension))
    monkeypatch.setattr(converter_module, "db", SimpleNamespace(session=db_session))

    result = converter._get_api_based_extension(tenant_id="tenant-1", api_based_extension_id="ext-1")

    assert result is extension
    db_session.scalar.assert_called_once()
