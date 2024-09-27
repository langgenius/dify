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
    VariableEntity,
    VariableEntityType,
)
from core.helper import encrypter
from core.model_runtime.entities.llm_entities import LLMMode
from core.model_runtime.entities.message_entities import PromptMessageRole
from models.api_based_extension import APIBasedExtension, APIBasedExtensionPoint
from models.model import AppMode
from services.workflow.workflow_converter import WorkflowConverter


@pytest.fixture()
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
    app_model.mode = AppMode.CHAT.value

    api_based_extension_id = "api_based_extension_id"
    mock_api_based_extension = APIBasedExtension(
        id=api_based_extension_id,
        name="api-1",
        api_key="encrypted_api_key",
        api_endpoint="https://dify.ai",
    )

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
    assert body_data_json["point"] == APIBasedExtensionPoint.APP_EXTERNAL_DATA_TOOL_QUERY.value

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
    app_model.mode = AppMode.WORKFLOW.value

    api_based_extension_id = "api_based_extension_id"
    mock_api_based_extension = APIBasedExtension(
        id=api_based_extension_id,
        name="api-1",
        api_key="encrypted_api_key",
        api_endpoint="https://dify.ai",
    )

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
    assert body_data_json["point"] == APIBasedExtensionPoint.APP_EXTERNAL_DATA_TOOL_QUERY.value

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
            prompt="You are a helpful assistant named {{name}}.\n\nContext:\n{{#context#}}\n\n"
            "Human: hi\nAssistant: ",
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
    template = prompt_template.advanced_completion_prompt_template.prompt
    for v in default_variables:
        template = template.replace("{{" + v.variable + "}}", "{{#start." + v.variable + "#}}")
    assert llm_node["data"]["prompt_template"]["text"] == template
