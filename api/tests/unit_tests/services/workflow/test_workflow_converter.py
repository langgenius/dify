from __future__ import annotations

import json
from typing import Any

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
from core.prompt.utils.prompt_template_parser import PromptTemplateParser
from models.api_based_extension import APIBasedExtensionPoint
from models.model import App, AppMode
from models.workflow_conversion import ConversionExtension
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
    defaults: dict[str, Any] = {
        "id": "app-1",
        "tenant_id": "tenant-1",
        "name": "Source App",
        "description": "",
        "mode": AppMode.CHAT,
        "enable_site": True,
        "enable_api": True,
        "max_active_requests": 0,
    }
    defaults.update(kwargs)
    return App(**defaults)


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
    app_model = _app_model(id="app_id", tenant_id="tenant_id", mode=AppMode.CHAT)

    extension = ConversionExtension(
        id="api_based_extension_id",
        name="api-1",
        api_key="api_key",
        api_endpoint="https://dify.ai",
    )

    workflow_converter = WorkflowConverter()

    external_data_variables = [
        ExternalDataVariableEntity(
            variable="external_variable",
            type="api",
            config={"api_based_extension_id": "api_based_extension_id"},
        ),
    ]

    nodes, mapping = workflow_converter._convert_to_http_request_node(
        app_id=app_model.id,
        app_mode=AppMode(app_model.mode),
        variables=default_variables,
        external_data_variables=external_data_variables,
        extensions={extension.id: extension},
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
    app_model = _app_model(id="app_id", tenant_id="tenant_id", mode=AppMode.WORKFLOW)

    extension = ConversionExtension(
        id="api_based_extension_id",
        name="api-1",
        api_key="api_key",
        api_endpoint="https://dify.ai",
    )

    workflow_converter = WorkflowConverter()

    external_data_variables = [
        ExternalDataVariableEntity(
            variable="external_variable",
            type="api",
            config={"api_based_extension_id": "api_based_extension_id"},
        ),
    ]

    nodes, _ = workflow_converter._convert_to_http_request_node(
        app_id=app_model.id,
        app_mode=AppMode(app_model.mode),
        variables=default_variables,
        external_data_variables=external_data_variables,
        extensions={extension.id: extension},
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


def test_convert_to_http_request_node_should_skip_non_api_and_missing_extension_id(
    converter: WorkflowConverter,
) -> None:
    app_model = _app_model(id="app-1", tenant_id="tenant-1", mode=AppMode.CHAT)
    external_data_variables = [
        ExternalDataVariableEntity(variable="skip_type", type="dataset", config={"api_based_extension_id": "x"}),
        ExternalDataVariableEntity(variable="skip_config", type="api", config={}),
    ]

    nodes, mapping = converter._convert_to_http_request_node(
        app_id=app_model.id,
        app_mode=AppMode(app_model.mode),
        variables=[],
        external_data_variables=external_data_variables,
        extensions={},
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


def test_graph_helpers_should_create_edges_and_append_nodes(converter: WorkflowConverter) -> None:
    graph = {"nodes": [{"id": "start", "position": None, "data": {"type": BuiltinNodeTypes.START}}], "edges": []}
    node = {"id": "llm", "position": None, "data": {"type": BuiltinNodeTypes.LLM}}

    edge = converter._create_edge("start", "llm")
    updated_graph = converter._append_node(graph, node)

    assert edge == {"id": "start-llm", "source": "start", "target": "llm"}
    assert updated_graph["nodes"][-1]["id"] == "llm"
    assert updated_graph["edges"][-1]["source"] == "start"
