from inspect import unwrap
from unittest.mock import patch

import pytest
from flask import Flask
from pydantic import ValidationError

from controllers.console.datasets.rag_pipeline.rag_pipeline_workflow import (
    DatasourceListApi,
    RagPipelineDatasourceListResponse,
    RagPipelineDatasourceProviderResponse,
)
from core.datasource.entities.datasource_entities import DatasourceParameter
from core.plugin.entities import OAuthSchema
from core.plugin.entities.plugin_daemon import PluginDatasourceProviderEntity
from core.plugin.impl.datasource import PluginDatasourceManager
from services.datasource_provider_service import DatasourceProviderService
from services.rag_pipeline.rag_pipeline_manage_service import RagPipelineManageService


def _provider() -> PluginDatasourceProviderEntity:
    return PluginDatasourceProviderEntity.model_validate(
        {
            "provider": "documents",
            "plugin_id": "example/documents",
            "plugin_unique_identifier": "example/documents:0.0.1@checksum",
            "declaration": {
                "identity": {
                    "author": "example",
                    "name": "documents",
                    "label": {"en_US": "Documents"},
                    "description": {"en_US": "Import documents"},
                    "icon": "icon.svg",
                    "tags": None,
                },
                "provider_type": "online_document",
                "credentials_schema": [{"type": "secret-input", "name": "token", "required": True}],
                "datasources": [
                    {
                        "identity": {
                            "author": "example",
                            "name": "pages",
                            "provider": "documents",
                            "label": {"en_US": "Pages"},
                        },
                        "description": {"en_US": "Import pages"},
                        "parameters": [
                            {
                                "name": "limit",
                                "type": "number",
                                "label": {"en_US": "Limit"},
                                "description": {"en_US": "Maximum pages"},
                                "required": True,
                                "default": 0,
                                "min": 0,
                                "max": 100,
                            },
                            {
                                "name": "archived",
                                "type": "boolean",
                                "label": {"en_US": "Archived"},
                                "description": {"en_US": "Include archived pages"},
                                "required": True,
                                "default": False,
                            },
                        ],
                        "output_schema": {
                            "type": "object",
                            "properties": {"page": {"anyOf": [{"type": "string"}, {"type": "null"}]}},
                            "additionalProperties": False,
                        },
                    }
                ],
            },
        }
    )


@pytest.mark.parametrize("credentials", [None, {"token": "secret"}])
def test_catalog_serializes_real_plugin_and_local_file_providers(
    app: Flask, credentials: dict[str, str] | None
) -> None:
    provider = _provider()
    api = DatasourceListApi()

    with (
        app.test_request_context("/rag/pipelines/datasource-plugins"),
        patch.object(
            PluginDatasourceManager, "_request_with_plugin_daemon_response", return_value=[provider]
        ) as request,
        patch.object(
            DatasourceProviderService, "get_datasource_credentials", return_value=credentials
        ) as get_credentials,
    ):
        result = unwrap(api.get)(api, "tenant-1")

    local_file, remote = result
    assert local_file["provider"] == "file"
    assert local_file["declaration"]["provider_type"] == "local_file"
    assert local_file["declaration"]["identity"]["name"] == "langgenius/file/file"
    assert local_file["is_authorized"] is True
    assert local_file["declaration"]["datasources"][0]["identity"]["provider"] == "langgenius/file/file"
    assert local_file["declaration"]["datasources"][0]["output_schema"] is None
    assert remote == provider.model_dump(mode="json")
    assert remote["provider"] == "documents"
    assert remote["plugin_unique_identifier"] == "example/documents:0.0.1@checksum"
    assert remote["is_authorized"] is bool(credentials)
    identity = remote["declaration"]["identity"]
    assert identity["name"] == "example/documents/documents"
    assert identity["icon"].endswith("/console/api/workspaces/current/plugin/icon?tenant_id=tenant-1&filename=icon.svg")
    assert identity["tags"] is None
    assert identity["label"]["pt_BR"] == "Documents"
    datasource = remote["declaration"]["datasources"][0]
    assert datasource["identity"]["provider"] == "example/documents/documents"
    assert datasource["identity"]["icon"] is None
    assert datasource["parameters"][0]["default"] == 0
    assert type(datasource["parameters"][0]["default"]) is int
    assert datasource["parameters"][0]["min"] == 0
    assert datasource["parameters"][0]["max"] == 100
    assert datasource["parameters"][1]["default"] is False
    assert datasource["output_schema"]["properties"]["page"] == {"anyOf": [{"type": "string"}, {"type": "null"}]}
    assert datasource["output_schema"]["additionalProperties"] is False
    request.assert_called_once()
    assert request.call_args.args[:3] == (
        "GET",
        "plugin/tenant-1/management/datasources",
        list[PluginDatasourceProviderEntity],
    )
    get_credentials.assert_called_once_with(tenant_id="tenant-1", provider="documents", plugin_id="example/documents")


def test_catalog_keeps_oauth_only_provider_unauthorized_without_credentials(app: Flask) -> None:
    provider = _provider()
    provider.declaration.credentials_schema = []
    provider.declaration.oauth_schema = OAuthSchema()
    api = DatasourceListApi()

    with (
        app.test_request_context("/rag/pipelines/datasource-plugins"),
        patch.object(PluginDatasourceManager, "fetch_datasource_providers", return_value=[provider]),
        patch.object(DatasourceProviderService, "get_datasource_credentials", return_value=None) as get_credentials,
    ):
        result = unwrap(api.get)(api, "tenant-1")

    assert result[0]["is_authorized"] is False
    assert result[0]["declaration"]["oauth_schema"] == {"client_schema": [], "credentials_schema": []}
    get_credentials.assert_called_once_with(tenant_id="tenant-1", provider="documents", plugin_id="example/documents")


def test_catalog_keeps_provider_visible_after_credential_failure(app: Flask) -> None:
    provider = _provider()
    api = DatasourceListApi()

    with (
        app.test_request_context("/rag/pipelines/datasource-plugins"),
        patch.object(PluginDatasourceManager, "fetch_datasource_providers", return_value=[provider]),
        patch.object(DatasourceProviderService, "get_datasource_credentials", side_effect=ValueError("decrypt failed")),
    ):
        result = unwrap(api.get)(api, "tenant-1")

    assert result == [provider.model_dump(mode="json")]
    assert result[0]["is_authorized"] is False


def test_catalog_serializes_empty_list(app: Flask) -> None:
    api = DatasourceListApi()

    with (
        app.test_request_context("/rag/pipelines/datasource-plugins"),
        patch.object(RagPipelineManageService, "list_rag_pipeline_datasources", return_value=[]),
    ):
        result = unwrap(api.get)(api, "tenant-1")

    assert result == []


def test_catalog_list_schema_reuses_datasource_domain_entities() -> None:
    schema = RagPipelineDatasourceListResponse.model_json_schema(mode="serialization")

    assert schema["type"] == "array"
    assert schema["items"] == {"$ref": "#/$defs/RagPipelineDatasourceProviderResponse"}
    declaration = schema["$defs"]["RagPipelineDatasourceProviderResponse"]["properties"]["declaration"]
    assert declaration == {"$ref": "#/$defs/DatasourceProviderEntityWithPlugin"}
    assert schema["$defs"]["DatasourceParameterType"]["enum"] == [
        value.value for value in DatasourceParameter.DatasourceParameterType
    ]


def test_catalog_response_rejects_tool_only_parameter_types() -> None:
    payload = _provider().model_dump(mode="json")
    payload["declaration"]["datasources"][0]["parameters"][0]["type"] = "dynamic-select"

    with pytest.raises(ValidationError, match="string.*number.*boolean"):
        RagPipelineDatasourceProviderResponse.model_validate(payload)
