# test for api/services/workflow/workflow_converter.py
import json
from unittest.mock import MagicMock

import pytest

from core.entities.application_entities import VariableEntity, ExternalDataVariableEntity
from core.helper import encrypter
from models.api_based_extension import APIBasedExtension, APIBasedExtensionPoint
from models.model import AppMode
from services.workflow.workflow_converter import WorkflowConverter


@pytest.fixture
def default_variables():
    return [
        VariableEntity(
            variable="text-input",
            label="text-input",
            type=VariableEntity.Type.TEXT_INPUT
        ),
        VariableEntity(
            variable="paragraph",
            label="paragraph",
            type=VariableEntity.Type.PARAGRAPH
        ),
        VariableEntity(
            variable="select",
            label="select",
            type=VariableEntity.Type.SELECT
        )
    ]


def test__convert_to_start_node(default_variables):
    # act
    result = WorkflowConverter()._convert_to_start_node(default_variables)

    # assert
    assert result["data"]["variables"][0]["variable"] == "text-input"
    assert result["data"]["variables"][1]["variable"] == "paragraph"
    assert result["data"]["variables"][2]["variable"] == "select"


def test__convert_to_http_request_node(default_variables):
    """
    Test convert to http request nodes
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
            variable="external_variable",
            type="api",
            config={
                "api_based_extension_id": api_based_extension_id
            }
        )
    ]

    nodes = workflow_converter._convert_to_http_request_node(
        app_model=app_model,
        variables=default_variables,
        external_data_variables=external_data_variables
    )

    assert len(nodes) == 2
    assert nodes[0]["data"]["type"] == "http-request"

    http_request_node = nodes[0]

    assert len(http_request_node["data"]["variables"]) == 4  # appended _query variable
    assert http_request_node["data"]["method"] == "post"
    assert http_request_node["data"]["url"] == mock_api_based_extension.api_endpoint
    assert http_request_node["data"]["authorization"]["type"] == "api-key"
    assert http_request_node["data"]["authorization"]["config"] == {
        "type": "bearer",
        "api_key": "api_key"
    }
    assert http_request_node["data"]["body"]["type"] == "json"

    body_data = http_request_node["data"]["body"]["data"]

    assert body_data

    body_data_json = json.loads(body_data)
    assert body_data_json["point"] == APIBasedExtensionPoint.APP_EXTERNAL_DATA_TOOL_QUERY.value

    body_params = body_data_json["params"]
    assert body_params["app_id"] == app_model.id
    assert body_params["tool_variable"] == external_data_variables[0].variable
    assert len(body_params["inputs"]) == 3
    assert body_params["query"] == "{{_query}}"  # for chatbot

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
            variable="external_variable",
            type="api",
            config={
                "api_based_extension_id": api_based_extension_id
            }
        )
    ]

    nodes = workflow_converter._convert_to_http_request_node(
        app_model=app_model,
        variables=default_variables,
        external_data_variables=external_data_variables
    )

    assert len(nodes) == 2
    assert nodes[0]["data"]["type"] == "http-request"

    http_request_node = nodes[0]

    assert len(http_request_node["data"]["variables"]) == 3
    assert http_request_node["data"]["method"] == "post"
    assert http_request_node["data"]["url"] == mock_api_based_extension.api_endpoint
    assert http_request_node["data"]["authorization"]["type"] == "api-key"
    assert http_request_node["data"]["authorization"]["config"] == {
        "type": "bearer",
        "api_key": "api_key"
    }
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
