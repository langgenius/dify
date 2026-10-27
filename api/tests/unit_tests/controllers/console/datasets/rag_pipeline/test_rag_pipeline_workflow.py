from __future__ import annotations

import json
from collections.abc import Generator, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime
from inspect import unwrap
from inspect import unwrap as unwrap_all
from typing import TypedDict, Unpack
from unittest.mock import MagicMock, patch
from uuid import UUID, uuid4

import pytest
from flask import Flask
from pydantic import ValidationError
from sqlalchemy import Engine
from sqlalchemy.orm import Session, scoped_session, sessionmaker
from werkzeug.exceptions import BadRequest, Forbidden, HTTPException, NotFound

import models.workflow as workflow_models
import services
import services.rag_pipeline.rag_pipeline as rag_pipeline_service
from controllers.console.app.error import DraftWorkflowNotExist, DraftWorkflowNotSync
from controllers.console.datasets.rag_pipeline import rag_pipeline_workflow as module
from controllers.console.datasets.rag_pipeline import rag_pipeline_workflow as workflow_controller
from controllers.console.datasets.rag_pipeline import rag_pipeline_workflow as workflow_module
from controllers.console.datasets.rag_pipeline.rag_pipeline_workflow import (
    DatasourceListApi,
    DatasourceVariablesPayload,
    DefaultBlockConfigQuery,
    DefaultRagPipelineBlockConfigApi,
    DraftRagPipelineApi,
    NodeIdQuery,
    NodeRunPayload,
    NodeRunRequiredPayload,
    PublishedAllRagPipelineApi,
    PublishedRagPipelineApi,
    PublishedWorkflowRunPayload,
    RagPipelineByIdApi,
    RagPipelineDatasourceListResponse,
    RagPipelineDatasourceProviderResponse,
    RagPipelineDatasourceVariableApi,
    RagPipelineDraftNodeRunApi,
    RagPipelineDraftRunIterationNodeApi,
    RagPipelineDraftRunLoopNodeApi,
    RagPipelineDraftWorkflowRestoreApi,
    RagPipelineDraftWorkflowRunPayload,
    RagPipelineRecommendedPluginApi,
    RagPipelineRecommendedPluginQuery,
    RagPipelineTaskStopApi,
    RagPipelineWorkflowLastRunApi,
    RagPipelineWorkflowRunNodeExecutionListApi,
    WorkflowListQuery,
    WorkflowUpdatePayload,
)
from controllers.web.error import InvokeRateLimitError as InvokeRateLimitHttpError
from core.app.apps.pipeline.pipeline_generator import PipelineGenerator
from core.datasource.entities.datasource_entities import DatasourceParameter
from core.plugin.entities import OAuthSchema
from core.plugin.entities.plugin_daemon import PluginDatasourceProviderEntity
from core.plugin.impl.datasource import PluginDatasourceManager
from fields.workflow_run_fields import node_execution_response_source
from graphon.enums import WorkflowNodeExecutionStatus
from libs.datetime_utils import naive_utc_now
from models.account import Account, TenantAccountRole
from models.dataset import Dataset, Pipeline
from models.engine import db
from models.enums import CreatorUserRole, PermissionEnum
from models.tools import WorkflowToolProvider
from models.workflow import Workflow, WorkflowNodeExecutionModel, WorkflowNodeExecutionTriggeredFrom, WorkflowType
from services.errors.app import IsDraftWorkflowError, WorkflowHashNotEqualError, WorkflowNotFoundError
from services.errors.llm import InvokeRateLimitError
from services.errors.rag_pipeline import RagPipelineResourceNotFoundError
from services.rag_pipeline.rag_pipeline import RagPipelineService
from services.rag_pipeline.rag_pipeline_manage_service import RagPipelineManageService
from tests.helpers.unit.config_override import config_overrides_context
from tests.helpers.unit.controllers.error_body import raised_error
from tests.helpers.unit.model_factories import make_account as _rag_pipeline_workflow_make_account
from tests.helpers.unit.model_factories import make_dataset, make_tenant


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


class TestDatasourceCatalogCases:
    @staticmethod
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
                workflow_module.application_services().data_sources.providers,
                "get_datasource_credentials",
                return_value=credentials,
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
        assert identity["icon"].endswith(
            "/console/api/workspaces/current/plugin/icon?tenant_id=tenant-1&filename=icon.svg"
        )
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
        get_credentials.assert_called_once_with(
            tenant_id="tenant-1", provider="documents", plugin_id="example/documents"
        )

    @staticmethod
    def test_catalog_keeps_oauth_only_provider_unauthorized_without_credentials(app: Flask) -> None:
        provider = _provider()
        provider.declaration.credentials_schema = []
        provider.declaration.oauth_schema = OAuthSchema()
        api = DatasourceListApi()

        with (
            app.test_request_context("/rag/pipelines/datasource-plugins"),
            patch.object(PluginDatasourceManager, "fetch_datasource_providers", return_value=[provider]),
            patch.object(
                workflow_module.application_services().data_sources.providers,
                "get_datasource_credentials",
                return_value=None,
            ) as get_credentials,
        ):
            result = unwrap(api.get)(api, "tenant-1")

        assert result[0]["is_authorized"] is False
        assert result[0]["declaration"]["oauth_schema"] == {"client_schema": [], "credentials_schema": []}
        get_credentials.assert_called_once_with(
            tenant_id="tenant-1", provider="documents", plugin_id="example/documents"
        )

    @staticmethod
    def test_catalog_keeps_provider_visible_after_credential_failure(app: Flask) -> None:
        provider = _provider()
        api = DatasourceListApi()

        with (
            app.test_request_context("/rag/pipelines/datasource-plugins"),
            patch.object(PluginDatasourceManager, "fetch_datasource_providers", return_value=[provider]),
            patch.object(
                workflow_module.application_services().data_sources.providers,
                "get_datasource_credentials",
                side_effect=ValueError("decrypt failed"),
            ),
        ):
            result = unwrap(api.get)(api, "tenant-1")

        assert result == [provider.model_dump(mode="json")]
        assert result[0]["is_authorized"] is False

    @staticmethod
    def test_catalog_serializes_empty_list(app: Flask) -> None:
        api = DatasourceListApi()

        with (
            app.test_request_context("/rag/pipelines/datasource-plugins"),
            patch.object(RagPipelineManageService, "list_rag_pipeline_datasources", return_value=[]),
        ):
            result = unwrap(api.get)(api, "tenant-1")

        assert result == []

    @staticmethod
    def test_catalog_list_schema_reuses_datasource_domain_entities() -> None:
        schema = RagPipelineDatasourceListResponse.model_json_schema(mode="serialization")

        assert schema["type"] == "array"
        assert schema["items"] == {"$ref": "#/$defs/RagPipelineDatasourceProviderResponse"}
        declaration = schema["$defs"]["RagPipelineDatasourceProviderResponse"]["properties"]["declaration"]
        assert declaration == {"$ref": "#/$defs/DatasourceProviderEntityWithPlugin"}
        assert schema["$defs"]["DatasourceParameterType"]["enum"] == [
            value.value for value in DatasourceParameter.DatasourceParameterType
        ]

    @staticmethod
    def test_catalog_response_rejects_tool_only_parameter_types() -> None:
        payload = _provider().model_dump(mode="json")
        payload["declaration"]["datasources"][0]["parameters"][0]["type"] = "dynamic-select"

        with pytest.raises(ValidationError, match="string.*number.*boolean"):
            RagPipelineDatasourceProviderResponse.model_validate(payload)


"""Unit coverage for RAG workflow controllers using real models and disposable SQLite state."""


_RAG_PIPELINE_WORKFLOW_DEFAULT_WORKFLOW_TENANT_ID = "00000000-0000-0000-0000-000000000001"
_RAG_PIPELINE_WORKFLOW_DEFAULT_WORKFLOW_APP_ID = "00000000-0000-0000-0000-000000000002"
_RAG_PIPELINE_WORKFLOW_DEFAULT_WORKFLOW_CREATED_BY = "00000000-0000-0000-0000-000000000003"
DEFAULT_WORKFLOW_ID = "00000000-0000-0000-0000-000000000004"
DEFAULT_DATASET_ID = "44444444-4444-4444-4444-444444444444"


def _make_workflow(**overrides: object) -> Workflow:
    workflow = Workflow(
        id=DEFAULT_WORKFLOW_ID,
        tenant_id=_RAG_PIPELINE_WORKFLOW_DEFAULT_WORKFLOW_TENANT_ID,
        app_id=_RAG_PIPELINE_WORKFLOW_DEFAULT_WORKFLOW_APP_ID,
        type=WorkflowType.WORKFLOW,
        version=Workflow.VERSION_DRAFT,
        marked_name="Release 1",
        marked_comment="Initial release",
        graph=json.dumps({"nodes": [], "edges": []}),
        _features=json.dumps({"file_upload": {"enabled": False}}),
        created_by=_RAG_PIPELINE_WORKFLOW_DEFAULT_WORKFLOW_CREATED_BY,
        updated_by=None,
        _environment_variables=[],
        _conversation_variables=[],
        _rag_pipeline_variables=[],
    )
    workflow.created_at = datetime(2024, 1, 1, 12, 0, 0)
    workflow.updated_at = datetime(2024, 1, 1, 12, 1, 0)
    for key, value in overrides.items():
        setattr(workflow, key, value)
    return workflow


def _account() -> Account:
    return _rag_pipeline_workflow_make_account(
        account_id=_RAG_PIPELINE_WORKFLOW_DEFAULT_WORKFLOW_CREATED_BY,
        name="Alice",
        email="alice@example.com",
        role=TenantAccountRole.EDITOR,
        tenant=make_tenant(tenant_id=_RAG_PIPELINE_WORKFLOW_DEFAULT_WORKFLOW_TENANT_ID, name="Tenant"),
    )


def _pipeline() -> Pipeline:
    pipeline = Pipeline(
        tenant_id=_RAG_PIPELINE_WORKFLOW_DEFAULT_WORKFLOW_TENANT_ID, name="Pipeline", description="desc"
    )
    pipeline.id = _RAG_PIPELINE_WORKFLOW_DEFAULT_WORKFLOW_APP_ID
    return pipeline


def _dataset(
    *,
    tenant_id: str = _RAG_PIPELINE_WORKFLOW_DEFAULT_WORKFLOW_TENANT_ID,
    maintainer: str = _RAG_PIPELINE_WORKFLOW_DEFAULT_WORKFLOW_CREATED_BY,
) -> Dataset:
    return make_dataset(
        dataset_id=DEFAULT_DATASET_ID,
        tenant_id=tenant_id,
        created_by=maintainer,
        maintainer=maintainer,
        permission=PermissionEnum.ONLY_ME,
        provider="vendor",
    )


def _persist_workflow(workflow: Workflow) -> None:
    db.session.add(workflow)
    db.session.commit()
    db.session.expunge(workflow)


class TestRagPipelineWorkflowCases:
    @staticmethod
    @pytest.fixture
    def database_app() -> Iterator[Flask]:
        app = Flask(__name__)
        app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
        db.init_app(app)

        with app.app_context():
            db.metadata.tables[Account.__tablename__].create(db.engine)
            db.metadata.tables[WorkflowToolProvider.__tablename__].create(db.engine)
            db.metadata.tables[Workflow.__tablename__].create(db.engine)
            db.session.add(_account())
            db.session.commit()

            try:
                yield app
            finally:
                db.session.remove()

    @staticmethod
    @pytest.mark.usefixtures("database_app")
    def test_draft_rag_pipeline_workflow_get_serializes_response_model() -> None:
        workflow = _make_workflow()
        expected_hash = workflow.unique_hash
        _persist_workflow(workflow)

        api = module.DraftRagPipelineApi()
        handler = unwrap_all(api.get)

        response = handler(api, db.session(), _pipeline())

        assert response["id"] == DEFAULT_WORKFLOW_ID
        assert response["graph"] == {"nodes": [], "edges": []}
        assert response["features"] == {"file_upload": {"enabled": False}}
        assert response["hash"] == expected_hash
        assert response["created_by"] == {
            "id": _RAG_PIPELINE_WORKFLOW_DEFAULT_WORKFLOW_CREATED_BY,
            "name": "Alice",
            "email": "alice@example.com",
        }
        assert response["updated_by"] is None
        assert response["created_at"] == int(datetime(2024, 1, 1, 12, 0, 0).timestamp())
        assert response["updated_at"] == int(datetime(2024, 1, 1, 12, 1, 0).timestamp())

    @staticmethod
    def test_published_rag_pipeline_workflows_serialize_items_before_session_closes(
        database_app: Flask,
    ) -> None:
        api = module.PublishedAllRagPipelineApi()
        handler = unwrap_all(api.get)
        workflow = _make_workflow(version="1")
        _persist_workflow(workflow)
        pipeline = _pipeline()
        pipeline.workflow_id = DEFAULT_WORKFLOW_ID

        with database_app.test_request_context(
            "/rag/pipelines/pipeline-1/workflows",
            method="GET",
            query_string={"page": 1, "limit": 10, "user_id": "", "named_only": "false"},
        ):
            response = handler(
                api, WorkflowListQuery(page=1, limit=10, user_id="", named_only=False), _account(), pipeline=pipeline
            )

        assert response["items"][0]["id"] == DEFAULT_WORKFLOW_ID
        assert response["page"] == 1
        assert response["limit"] == 10
        assert response["has_more"] is False

    @staticmethod
    def test_rag_pipeline_workflow_patch_serializes_response_model(
        database_app: Flask,
    ) -> None:
        workflow = _make_workflow(marked_name="Updated release")
        expected_hash = workflow.unique_hash
        _persist_workflow(workflow)
        payload: dict[str, object] = {"marked_name": "Updated release"}

        api = module.RagPipelineByIdApi()
        handler = unwrap_all(api.patch)

        with database_app.test_request_context(
            f"/rag/pipelines/{_RAG_PIPELINE_WORKFLOW_DEFAULT_WORKFLOW_APP_ID}/workflows/{DEFAULT_WORKFLOW_ID}",
            method="PATCH",
            json=payload,
        ):
            response = handler(
                api,
                WorkflowUpdatePayload.model_validate(payload),
                _account(),
                pipeline=_pipeline(),
                workflow_id=DEFAULT_WORKFLOW_ID,
            )

        assert response["id"] == DEFAULT_WORKFLOW_ID
        assert response["marked_name"] == "Updated release"
        assert response["hash"] == expected_hash

    @staticmethod
    @pytest.mark.usefixtures("database_app")
    def test_default_rag_pipeline_block_configs_serializes_root_response() -> None:
        block_configs = [{"type": "start", "config": {"title": "Start"}}]

        api = module.DefaultRagPipelineBlockConfigsApi()
        handler = unwrap_all(api.get)

        with patch.object(RagPipelineService, "get_default_block_configs", return_value=block_configs):
            response = handler(api, _pipeline())

        assert response == block_configs

    @staticmethod
    def test_draft_rag_pipeline_second_step_parameters_serializes_variables(database_app: Flask) -> None:
        variables = [
            {
                "belong_to_node_id": "shared",
                "type": "number",
                "label": "Chunk size",
                "variable": "chunk_size",
                "default_value": 1024,
                "required": True,
            }
        ]
        api = module.DraftRagPipelineSecondStepApi()
        handler = unwrap_all(api.get)

        with (
            database_app.test_request_context("/?node_id=node-1"),
            patch.object(RagPipelineService, "get_second_step_parameters", return_value=variables),
        ):
            response = handler(api, NodeIdQuery(node_id="node-1"), _pipeline())

        assert response["variables"] == variables

    @staticmethod
    def test_rag_pipeline_recommended_plugins_serializes_known_envelope(database_app: Flask) -> None:
        recommended_plugins = {
            "installed_recommended_plugins": [
                {
                    "id": "langgenius/dify_extractor/dify_extractor",
                    "author": "langgenius",
                    "name": "langgenius/dify_extractor/dify_extractor",
                    "description": {
                        "en_US": "Extract text",
                        "zh_Hans": "Extract text",
                        "pt_BR": "Extract text",
                        "ja_JP": "Extract text",
                    },
                    "icon": "/icon.svg",
                    "label": {
                        "en_US": "Dify Extractor",
                        "zh_Hans": "Dify Extractor",
                        "pt_BR": "Dify Extractor",
                        "ja_JP": "Dify Extractor",
                    },
                    "type": "builtin",
                }
            ],
            "uninstalled_recommended_plugins": [{"plugin_id": "langgenius/notion_datasource"}],
        }
        api = module.RagPipelineRecommendedPluginApi()
        handler = unwrap_all(api.get)

        with (
            database_app.test_request_context("/?type=tool"),
            patch.object(RagPipelineService, "get_recommended_plugins", return_value=recommended_plugins),
        ):
            response = handler(
                api,
                RagPipelineRecommendedPluginQuery(type="tool"),
                _RAG_PIPELINE_WORKFLOW_DEFAULT_WORKFLOW_TENANT_ID,
                _account(),
            )

        assert response == recommended_plugins

    @staticmethod
    def test_rag_pipeline_transform_rejects_read_only_member(sqlite_engine: Engine) -> None:
        account = _account()
        account.role = TenantAccountRole.NORMAL
        api = module.RagPipelineTransformApi()
        handler = unwrap_all(api.post)

        with Session(sqlite_engine) as session:
            session.add(_dataset())

            with (
                config_overrides_context(RBAC_ENABLED=False),
                pytest.raises(Forbidden),
            ):
                handler(
                    api, session, _RAG_PIPELINE_WORKFLOW_DEFAULT_WORKFLOW_TENANT_ID, account, UUID(DEFAULT_DATASET_ID)
                )

    @staticmethod
    def test_rag_pipeline_transform_rejects_dataset_from_another_tenant_before_service_call(
        sqlite_engine: Engine,
    ) -> None:
        api = module.RagPipelineTransformApi()
        handler = unwrap_all(api.post)

        with Session(sqlite_engine) as session:
            session.add(_dataset(tenant_id="00000000-0000-0000-0000-000000000099"))

            with (
                patch.object(module.RagPipelineTransformService, "transform_dataset") as transform_dataset,
                pytest.raises(NotFound),
            ):
                handler(
                    api,
                    session,
                    _RAG_PIPELINE_WORKFLOW_DEFAULT_WORKFLOW_TENANT_ID,
                    _account(),
                    UUID(DEFAULT_DATASET_ID),
                )

        transform_dataset.assert_not_called()

    @staticmethod
    def test_rag_pipeline_transform_enforces_legacy_dataset_permission_before_service_call(
        sqlite_engine: Engine,
    ) -> None:
        api = module.RagPipelineTransformApi()
        handler = unwrap_all(api.post)

        with Session(sqlite_engine) as session:
            session.add(_dataset(maintainer="00000000-0000-0000-0000-000000000099"))

            with (
                config_overrides_context(RBAC_ENABLED=False),
                patch.object(module.RagPipelineTransformService, "transform_dataset") as transform_dataset,
                pytest.raises(Forbidden),
            ):
                handler(
                    api,
                    session,
                    _RAG_PIPELINE_WORKFLOW_DEFAULT_WORKFLOW_TENANT_ID,
                    _account(),
                    UUID(DEFAULT_DATASET_ID),
                )

        transform_dataset.assert_not_called()

    @staticmethod
    def test_rag_pipeline_transform_passes_authorized_dataset_and_account_to_service(
        sqlite_engine: Engine,
    ) -> None:
        api = module.RagPipelineTransformApi()
        handler = unwrap_all(api.post)
        account = _account()
        expected = {"pipeline_id": "pipeline-1", "dataset_id": DEFAULT_DATASET_ID, "status": "success"}

        with Session(sqlite_engine) as session:
            dataset = _dataset()
            session.add(dataset)

            with (
                config_overrides_context(RBAC_ENABLED=False),
                patch.object(
                    module.RagPipelineTransformService, "transform_dataset", return_value=expected
                ) as transform,
            ):
                response = handler(
                    api, session, _RAG_PIPELINE_WORKFLOW_DEFAULT_WORKFLOW_TENANT_ID, account, UUID(DEFAULT_DATASET_ID)
                )

            transform.assert_called_once_with(dataset, account.id, session)

        assert response == expected

    @staticmethod
    def test_rag_pipeline_transform_maps_missing_pipeline_to_not_found(sqlite_engine: Engine) -> None:
        api = module.RagPipelineTransformApi()
        handler = unwrap_all(api.post)

        with Session(sqlite_engine) as session:
            session.add(_dataset())

            with (
                config_overrides_context(RBAC_ENABLED=False),
                patch.object(
                    module.RagPipelineTransformService,
                    "transform_dataset",
                    side_effect=RagPipelineResourceNotFoundError("Pipeline not found"),
                ),
                pytest.raises(NotFound, match="Pipeline not found"),
            ):
                handler(
                    api,
                    session,
                    _RAG_PIPELINE_WORKFLOW_DEFAULT_WORKFLOW_TENANT_ID,
                    _account(),
                    UUID(DEFAULT_DATASET_ID),
                )

    @staticmethod
    def test_rag_pipeline_transform_skips_legacy_acl_when_rbac_is_enabled(sqlite_engine: Engine) -> None:
        api = module.RagPipelineTransformApi()
        handler = unwrap_all(api.post)
        account = _account()
        account.role = TenantAccountRole.NORMAL
        expected = {"pipeline_id": "pipeline-1", "dataset_id": DEFAULT_DATASET_ID, "status": "success"}

        with Session(sqlite_engine) as session:
            session.add(_dataset(maintainer="00000000-0000-0000-0000-000000000099"))

            with (
                config_overrides_context(RBAC_ENABLED=True),
                patch.object(
                    module.RagPipelineTransformService, "transform_dataset", return_value=expected
                ) as transform,
            ):
                response = handler(
                    api, session, _RAG_PIPELINE_WORKFLOW_DEFAULT_WORKFLOW_TENANT_ID, account, UUID(DEFAULT_DATASET_ID)
                )

        assert response == expected
        transform.assert_called_once()

    @staticmethod
    @pytest.mark.parametrize(
        ("api_type", "payload"),
        [
            (
                module.DraftRagPipelineRunApi,
                {"inputs": {}, "datasource_type": "x", "datasource_info_list": [], "start_node_id": "node-1"},
            ),
            (
                module.PublishedRagPipelineRunApi,
                {
                    "inputs": {},
                    "datasource_type": "x",
                    "datasource_info_list": [],
                    "start_node_id": "node-1",
                    "response_mode": "blocking",
                },
            ),
        ],
    )
    def test_rag_pipeline_run_uses_sqlite_session(
        app: Flask,
        sqlite_engine: Engine,
        pipeline_application: PipelineGenerator,
        api_type: type,
        payload: dict[str, object],
    ) -> None:
        api = api_type()
        handler = unwrap_all(api.post)
        pipeline = _pipeline()

        with (
            Session(sqlite_engine) as session,
            app.test_request_context("/", json=payload),
            patch.object(module, "load_rag_pipeline", return_value=pipeline) as load_pipeline,
            patch.object(module.PipelineGenerateService, "generate", return_value={"event": "done"}) as generate,
            patch.object(module.helper, "compact_generate_response", return_value={"ok": True}),
        ):
            req_data = (
                RagPipelineDraftWorkflowRunPayload.model_validate(payload)
                if api_type is module.DraftRagPipelineRunApi
                else PublishedWorkflowRunPayload.model_validate(payload)
            )
            response = handler(api, req_data, session, _account(), pipeline.id)

        assert response == {"ok": True}
        load_pipeline.assert_called_once_with(session, pipeline.id)
        assert generate.call_args.kwargs["session"] is session
        assert generate.call_args.kwargs["generator"] is pipeline_application
        assert session.get_bind() is sqlite_engine

    @staticmethod
    @pytest.mark.parametrize("api_type", [module.DraftRagPipelineRunApi, module.PublishedRagPipelineRunApi])
    def test_rag_pipeline_run_translates_rate_limit(
        app: Flask,
        sqlite_engine: Engine,
        pipeline_application: PipelineGenerator,
        api_type: type,
    ) -> None:
        payload: dict[str, object] = {
            "inputs": {},
            "datasource_type": "x",
            "datasource_info_list": [],
            "start_node_id": "node-1",
        }
        api = api_type()
        handler = unwrap_all(api.post)
        pipeline = _pipeline()
        req_data = (
            RagPipelineDraftWorkflowRunPayload.model_validate(payload)
            if api_type is module.DraftRagPipelineRunApi
            else PublishedWorkflowRunPayload.model_validate(payload)
        )

        with (
            Session(sqlite_engine) as session,
            app.test_request_context("/", json=payload),
            patch.object(module, "load_rag_pipeline", return_value=pipeline),
            patch.object(
                module.PipelineGenerateService, "generate", side_effect=InvokeRateLimitError("limit")
            ) as generate,
            pytest.raises(InvokeRateLimitHttpError),
        ):
            handler(api, req_data, session, _account(), pipeline.id)

        assert generate.call_args.kwargs["session"] is session
        assert generate.call_args.kwargs["generator"] is pipeline_application


"""Unit tests for rag_pipeline_workflow controller endpoints."""


_RAG_PIPELINE_WORKFLOW_APIS_DEFAULT_WORKFLOW_TENANT_ID = "00000000-0000-0000-0000-000000000001"
_RAG_PIPELINE_WORKFLOW_APIS_DEFAULT_WORKFLOW_APP_ID = "00000000-0000-0000-0000-000000000002"
_RAG_PIPELINE_WORKFLOW_APIS_DEFAULT_WORKFLOW_CREATED_BY = "00000000-0000-0000-0000-000000000003"
type WorkflowVariablePayload = dict[str, object]


@dataclass(frozen=True)
class SQLiteDatabase:
    """Expose the concrete SQLite engine and scoped session interface used by controller code."""

    engine: Engine
    session: scoped_session[Session]


def empty_mapping() -> dict[str, object]:
    return {}


def empty_list() -> list[object]:
    return []


class WorkflowFactoryPayload(TypedDict):
    id: str
    tenant_id: str
    app_id: str
    type: str
    version: str
    marked_name: str
    marked_comment: str
    graph: str
    features: str
    created_by: str
    created_at: datetime
    updated_by: str | None
    updated_at: datetime | None
    environment_variables: list[WorkflowVariablePayload]
    conversation_variables: list[WorkflowVariablePayload]
    rag_pipeline_variables: list[WorkflowVariablePayload]


class WorkflowFactoryOverrides(TypedDict, total=False):
    id: str
    tenant_id: str
    app_id: str
    type: str
    version: str
    marked_name: str
    marked_comment: str
    graph: str
    features: str
    created_by: str
    created_at: datetime
    updated_by: str | None
    updated_at: datetime | None
    environment_variables: list[WorkflowVariablePayload]
    conversation_variables: list[WorkflowVariablePayload]
    rag_pipeline_variables: list[WorkflowVariablePayload]


class NodeExecutionOverrides(TypedDict, total=False):
    id: str
    tenant_id: str
    app_id: str
    workflow_id: str
    workflow_run_id: str | None
    index: int
    predecessor_node_id: str | None
    node_execution_id: str | None
    node_id: str
    node_type: str
    title: str
    inputs: str | None
    process_data: str | None
    outputs: str | None
    status: WorkflowNodeExecutionStatus
    error: str | None
    elapsed_time: float
    execution_metadata: str | None
    created_at: datetime
    created_by_role: CreatorUserRole
    created_by: str
    finished_at: datetime | None


def make_node_execution(**overrides: Unpack[NodeExecutionOverrides]) -> WorkflowNodeExecutionModel:
    payload: NodeExecutionOverrides = {
        "id": "node-exec-1",
        "tenant_id": _RAG_PIPELINE_WORKFLOW_APIS_DEFAULT_WORKFLOW_TENANT_ID,
        "app_id": _RAG_PIPELINE_WORKFLOW_APIS_DEFAULT_WORKFLOW_APP_ID,
        "workflow_id": "workflow-1",
        "workflow_run_id": None,
        "index": 1,
        "predecessor_node_id": None,
        "node_execution_id": None,
        "node_id": "node1",
        "node_type": "start",
        "title": "Start",
        "inputs": json.dumps({"query": "hello"}),
        "process_data": json.dumps({}),
        "outputs": json.dumps({"answer": "world"}),
        "status": WorkflowNodeExecutionStatus.SUCCEEDED,
        "error": None,
        "elapsed_time": 1.0,
        "execution_metadata": json.dumps({}),
        "created_at": datetime(2026, 1, 1, 0, 0, 0),
        "created_by_role": CreatorUserRole.ACCOUNT,
        "created_by": _RAG_PIPELINE_WORKFLOW_APIS_DEFAULT_WORKFLOW_CREATED_BY,
        "finished_at": datetime(2026, 1, 1, 0, 0, 1),
    }
    payload.update(overrides)
    created_at = payload.pop("created_at")
    execution = WorkflowNodeExecutionModel(
        triggered_from=WorkflowNodeExecutionTriggeredFrom.RAG_PIPELINE_RUN,
        **payload,
    )
    execution.created_at = created_at
    execution.offload_data = []
    return execution


def default_workflow_payload() -> WorkflowFactoryPayload:
    return {
        "id": "workflow-1",
        "tenant_id": _RAG_PIPELINE_WORKFLOW_APIS_DEFAULT_WORKFLOW_TENANT_ID,
        "app_id": _RAG_PIPELINE_WORKFLOW_APIS_DEFAULT_WORKFLOW_APP_ID,
        "type": "workflow",
        "version": "1",
        "marked_name": "Release 1",
        "marked_comment": "Initial release",
        "graph": json.dumps({"nodes": [], "edges": []}),
        "features": json.dumps({"file_upload": {"enabled": False}}),
        "created_by": _RAG_PIPELINE_WORKFLOW_APIS_DEFAULT_WORKFLOW_CREATED_BY,
        "created_at": datetime(2024, 1, 1, 12, 0, 0),
        "updated_by": None,
        "updated_at": datetime(2024, 1, 1, 12, 1, 0),
        "environment_variables": [],
        "conversation_variables": [],
        "rag_pipeline_variables": [],
    }


def make_workflow(**overrides: Unpack[WorkflowFactoryOverrides]) -> Workflow:
    payload = default_workflow_payload()
    payload.update(overrides)
    workflow = Workflow(
        id=payload["id"],
        tenant_id=payload["tenant_id"],
        app_id=payload["app_id"],
        type=WorkflowType(payload["type"]),
        version=payload["version"],
        marked_name=payload["marked_name"],
        marked_comment=payload["marked_comment"],
        graph=payload["graph"],
        _features=payload["features"],
        created_by=payload["created_by"],
        updated_by=payload["updated_by"],
        _environment_variables=payload["environment_variables"],
        _conversation_variables=payload["conversation_variables"],
        _rag_pipeline_variables=payload["rag_pipeline_variables"],
    )
    workflow.created_at = payload["created_at"]
    workflow.updated_at = payload["updated_at"]
    return workflow


def _rag_pipeline_workflow_apis_make_account(
    *, id: str = "account-1", role: TenantAccountRole = TenantAccountRole.EDITOR
) -> Account:
    account = Account(name="Alice", email=f"{id}@example.com")
    account.id = id
    account.role = role
    return account


def make_pipeline(
    *,
    id: str = "pipeline-1",
    tenant_id: str = "tenant-1",
    workflow_id: str | None = None,
    is_published: bool = False,
) -> Pipeline:
    pipeline = Pipeline(tenant_id=tenant_id, name="test-pipeline", description="test")
    pipeline.id = id
    pipeline.workflow_id = workflow_id
    pipeline.is_published = is_published
    return pipeline


class TestRagPipelineWorkflowApisCases:
    pytestmark = pytest.mark.usefixtures("pipeline_application")

    @staticmethod
    @pytest.fixture(autouse=True)
    def sqlite_database(
        monkeypatch: pytest.MonkeyPatch,
        sqlite_engine: Engine,
    ) -> Iterator[scoped_session[Session]]:
        """Route controller transactions and model author lookups through SQLite."""

        database_session = scoped_session(sessionmaker(bind=sqlite_engine, expire_on_commit=False))
        database = SQLiteDatabase(engine=sqlite_engine, session=database_session)
        monkeypatch.setattr(workflow_controller, "db", database)
        monkeypatch.setattr(workflow_models, "db", database)
        monkeypatch.setattr(rag_pipeline_service, "db", database)

        with database_session() as session:
            default_author = Account(name="Default Author", email="default-author@example.com")
            default_author.id = _RAG_PIPELINE_WORKFLOW_APIS_DEFAULT_WORKFLOW_CREATED_BY
            session.add(default_author)
            session.commit()

        try:
            yield database_session
        finally:
            database_session.remove()

    @staticmethod
    @pytest.fixture
    def workflow_author(sqlite_database: scoped_session[Session]) -> Account:
        account = Account(name="Alice", email=f"alice-{uuid4()}@example.com")
        account.id = str(uuid4())
        sqlite_database.add(account)
        sqlite_database.commit()
        return account

    class TestDraftWorkflowApi:
        def test_get_draft_success(self, app: Flask, workflow_author: Account, sqlite_session: Session) -> None:
            api = DraftRagPipelineApi()
            method = unwrap(api.get)

            pipeline = make_pipeline()
            workflow = make_workflow(created_by=workflow_author.id)

            service = MagicMock()
            service.get_draft_workflow.return_value = workflow

            with (
                app.test_request_context("/"),
                patch(
                    "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow.RagPipelineService",
                    return_value=service,
                ),
            ):
                result = method(api, sqlite_session, pipeline)

            assert result["id"] == "workflow-1"
            assert result["graph"] == {"nodes": [], "edges": []}
            assert result["features"] == {"file_upload": {"enabled": False}}
            assert result["hash"] == workflow.unique_hash
            assert result["created_by"] == {
                "id": workflow_author.id,
                "name": workflow_author.name,
                "email": workflow_author.email,
            }
            assert result["updated_by"] is None

        def test_get_draft_not_exist(self, app: Flask, sqlite_session: Session) -> None:
            api = DraftRagPipelineApi()
            method = unwrap(api.get)

            pipeline = make_pipeline()
            service = MagicMock()
            service.get_draft_workflow.return_value = None

            with (
                app.test_request_context("/"),
                patch(
                    "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow.RagPipelineService",
                    return_value=service,
                ),
            ):
                with pytest.raises(DraftWorkflowNotExist):
                    method(api, sqlite_session, pipeline)

        def test_sync_hash_not_match(self, app: Flask) -> None:
            api = DraftRagPipelineApi()
            method = unwrap(api.post)

            pipeline = make_pipeline()
            user = _rag_pipeline_workflow_apis_make_account()

            service = MagicMock()
            service.sync_draft_workflow.side_effect = WorkflowHashNotEqualError()

            with (
                app.test_request_context("/", json={"graph": empty_mapping(), "features": empty_mapping()}),
                patch(
                    "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow.RagPipelineService",
                    return_value=service,
                ),
            ):
                with pytest.raises(DraftWorkflowNotSync):
                    method(api, user, pipeline)

        def test_sync_invalid_text_plain(self, app: Flask) -> None:
            api = DraftRagPipelineApi()
            method = unwrap(api.post)

            pipeline = make_pipeline()
            user = _rag_pipeline_workflow_apis_make_account()

            with (
                app.test_request_context("/", data="bad-json", headers={"Content-Type": "text/plain"}),
            ):
                response, status = raised_error(lambda: method(api, user, pipeline))
                assert status == 400

        def test_restore_published_workflow_to_draft_success(self, app: Flask) -> None:
            api = RagPipelineDraftWorkflowRestoreApi()
            method = unwrap(api.post)

            pipeline = make_pipeline()
            user = _rag_pipeline_workflow_apis_make_account(id="account-1")
            workflow = make_workflow(
                graph=json.dumps({"nodes": [{"id": "restored"}], "edges": []}),
                created_at=datetime(2024, 1, 1),
            )

            service = MagicMock()
            service.restore_published_workflow_to_draft.return_value = workflow

            with (
                app.test_request_context("/", method="POST"),
                patch(
                    "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow.RagPipelineService",
                    return_value=service,
                ),
            ):
                result = method(api, user, pipeline, "published-workflow")

            assert result["result"] == "success"
            assert result["hash"] == workflow.unique_hash

        def test_restore_published_workflow_to_draft_not_found(self, app: Flask) -> None:
            api = RagPipelineDraftWorkflowRestoreApi()
            method = unwrap(api.post)

            pipeline = make_pipeline()
            user = _rag_pipeline_workflow_apis_make_account(id="account-1")

            service = MagicMock()
            service.restore_published_workflow_to_draft.side_effect = WorkflowNotFoundError("Workflow not found")

            with (
                app.test_request_context("/", method="POST"),
                patch(
                    "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow.RagPipelineService",
                    return_value=service,
                ),
            ):
                with pytest.raises(NotFound):
                    method(api, user, pipeline, "published-workflow")

        def test_restore_published_workflow_to_draft_returns_400_for_draft_source(self, app: Flask) -> None:
            api = RagPipelineDraftWorkflowRestoreApi()
            method = unwrap(api.post)

            pipeline = make_pipeline()
            user = _rag_pipeline_workflow_apis_make_account(id="account-1")

            service = MagicMock()
            service.restore_published_workflow_to_draft.side_effect = IsDraftWorkflowError(
                "source workflow must be published"
            )

            with (
                app.test_request_context("/", method="POST"),
                patch(
                    "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow.RagPipelineService",
                    return_value=service,
                ),
            ):
                with pytest.raises(HTTPException) as exc:
                    method(api, user, pipeline, "draft-workflow")

            assert exc.value.code == 400
            assert exc.value.description == "source workflow must be published"

    class TestDraftRunNodes:
        def test_iteration_node_success(self, app: Flask) -> None:
            api = RagPipelineDraftRunIterationNodeApi()
            method = unwrap(api.post)

            pipeline = make_pipeline()
            user = _rag_pipeline_workflow_apis_make_account()

            with (
                app.test_request_context("/", json={"inputs": empty_mapping()}),
                patch(
                    "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow.PipelineGenerateService.generate_single_iteration",
                    return_value=MagicMock(),
                ),
                patch(
                    "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow.helper.compact_generate_response",
                    return_value={"ok": True},
                ),
            ):
                result = method(api, NodeRunPayload(), user, pipeline, "node")
                assert result == {"ok": True}

        def test_iteration_node_conversation_not_exists(self, app: Flask) -> None:
            api = RagPipelineDraftRunIterationNodeApi()
            method = unwrap(api.post)

            pipeline = make_pipeline()
            user = _rag_pipeline_workflow_apis_make_account()

            with (
                app.test_request_context("/", json={"inputs": empty_mapping()}),
                patch(
                    "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow.PipelineGenerateService.generate_single_iteration",
                    side_effect=services.errors.conversation.ConversationNotExistsError(),
                ),
            ):
                with pytest.raises(NotFound):
                    method(api, NodeRunPayload(), user, pipeline, "node")

        def test_loop_node_success(self, app: Flask) -> None:
            api = RagPipelineDraftRunLoopNodeApi()
            method = unwrap(api.post)

            pipeline = make_pipeline()
            user = _rag_pipeline_workflow_apis_make_account()

            with (
                app.test_request_context("/", json={"inputs": empty_mapping()}),
                patch(
                    "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow.PipelineGenerateService.generate_single_loop",
                    return_value=MagicMock(),
                ),
                patch(
                    "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow.helper.compact_generate_response",
                    return_value={"ok": True},
                ),
            ):
                assert method(api, NodeRunPayload(), user, pipeline, "node") == {"ok": True}

    class TestDraftNodeRun:
        def test_execution_not_found(self, app: Flask) -> None:
            api = RagPipelineDraftNodeRunApi()
            method = unwrap(api.post)

            pipeline = make_pipeline()
            user = _rag_pipeline_workflow_apis_make_account()

            service = MagicMock()
            service.run_draft_workflow_node.return_value = None

            with (
                app.test_request_context("/", json={"inputs": empty_mapping()}),
                patch(
                    "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow.RagPipelineService",
                    return_value=service,
                ),
            ):
                with pytest.raises(ValueError, match="Workflow node execution not found"):
                    method(api, NodeRunRequiredPayload(inputs={}), user, pipeline, "node")

    class TestPublishedPipelineApis:
        def test_get_published_workflow_preserves_response_fields(
            self, app: Flask, workflow_author: Account, sqlite_database: scoped_session[Session]
        ) -> None:
            workflow = make_workflow(id=str(uuid4()), created_by=workflow_author.id)
            sqlite_database.add(workflow)
            sqlite_database.commit()
            pipeline = make_pipeline(
                id=workflow.app_id,
                tenant_id=workflow.tenant_id,
                workflow_id=workflow.id,
                is_published=True,
            )

            with app.test_request_context("/"):
                result = unwrap(PublishedRagPipelineApi.get)(PublishedRagPipelineApi(), pipeline)

            assert result["id"] == workflow.id
            assert result["graph"] == {"nodes": [], "edges": []}
            assert result["hash"] == workflow.unique_hash
            assert result["created_by"]["id"] == workflow_author.id

        @pytest.mark.parametrize("is_published", [False, True])
        def test_get_without_published_workflow_returns_null(self, app: Flask, is_published: bool) -> None:
            pipeline = make_pipeline(
                id=_RAG_PIPELINE_WORKFLOW_APIS_DEFAULT_WORKFLOW_APP_ID,
                tenant_id=_RAG_PIPELINE_WORKFLOW_APIS_DEFAULT_WORKFLOW_TENANT_ID,
                workflow_id=str(uuid4()),
                is_published=is_published,
            )

            with app.test_request_context("/"):
                result = unwrap(PublishedRagPipelineApi.get)(PublishedRagPipelineApi(), pipeline)

            assert result is None

        def test_publish_success(self, app: Flask) -> None:
            api = PublishedRagPipelineApi()
            method = unwrap(api.post)

            tenant_id = str(uuid4())
            pipeline = Pipeline(
                tenant_id=tenant_id,
                name="test-pipeline",
                description="test",
                created_by=str(uuid4()),
            )
            user = _rag_pipeline_workflow_apis_make_account(id="u1")

            workflow = make_workflow(id=str(uuid4()), created_at=naive_utc_now())

            service = MagicMock()
            service.publish_workflow.return_value = workflow

            with (
                app.test_request_context("/"),
                patch(
                    "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow.RagPipelineService",
                    return_value=service,
                ),
            ):
                result = method(api, user, pipeline)

            assert result["result"] == "success"
            assert "created_at" in result

    class TestMiscApis:
        def test_task_stop(self, app: Flask) -> None:
            api = RagPipelineTaskStopApi()
            method = unwrap(api.post)

            pipeline = make_pipeline()
            user = _rag_pipeline_workflow_apis_make_account(id="u1")

            with (
                app.test_request_context("/"),
                patch(
                    "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow.AppQueueManager.set_stop_flag"
                ) as stop_mock,
            ):
                result = method(api, user, pipeline, "task-1")
                stop_mock.assert_called_once()
                assert result["result"] == "success"

        def test_recommended_plugins(self, app: Flask) -> None:
            api = RagPipelineRecommendedPluginApi()
            method = unwrap(api.get)

            service = MagicMock()
            recommended_plugins = {
                "installed_recommended_plugins": [
                    {
                        "id": "p1",
                        "author": "langgenius",
                        "name": "p1",
                        "description": {
                            "en_US": "Plugin one",
                            "zh_Hans": "Plugin one",
                            "pt_BR": "Plugin one",
                            "ja_JP": "Plugin one",
                        },
                        "icon": "/icon.svg",
                        "label": {
                            "en_US": "Plugin one",
                            "zh_Hans": "Plugin one",
                            "pt_BR": "Plugin one",
                            "ja_JP": "Plugin one",
                        },
                        "type": "builtin",
                    }
                ],
                "uninstalled_recommended_plugins": [{"id": "p2"}],
            }
            service.get_recommended_plugins.return_value = recommended_plugins
            user = _rag_pipeline_workflow_apis_make_account()
            tenant_id = "tenant-1"

            with (
                app.test_request_context("/?type=all"),
                patch(
                    "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow.RagPipelineService",
                    return_value=service,
                ),
            ):
                result = method(api, RagPipelineRecommendedPluginQuery(type="all"), tenant_id, user)
                assert result == recommended_plugins
                service.get_recommended_plugins.assert_called_once_with("all", user, tenant_id)

    class TestDefaultBlockConfigApi:
        def test_get_block_config_success(self, app: Flask) -> None:
            api = DefaultRagPipelineBlockConfigApi()
            method = unwrap(api.get)

            pipeline = make_pipeline()

            service = MagicMock()
            service.get_default_block_config.return_value = {"k": "v"}

            with (
                app.test_request_context("/?q={}"),
                patch(
                    "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow.RagPipelineService",
                    return_value=service,
                ),
            ):
                result = method(api, DefaultBlockConfigQuery(q="{}"), pipeline, "llm")
                assert result == {"k": "v"}

        def test_get_block_config_invalid_json(self, app: Flask) -> None:
            api = DefaultRagPipelineBlockConfigApi()
            method = unwrap(api.get)

            pipeline = make_pipeline()

            with app.test_request_context("/?q=bad-json"):
                with pytest.raises(ValueError, match="Invalid filters"):
                    method(api, DefaultBlockConfigQuery(q="bad-json"), pipeline, "llm")

    class TestPublishedAllRagPipelineApi:
        def test_get_published_workflows_success(self, app: Flask) -> None:
            api = PublishedAllRagPipelineApi()
            method = unwrap(api.get)

            pipeline = make_pipeline()
            user = _rag_pipeline_workflow_apis_make_account(id="u1")

            service = MagicMock()
            service.get_all_published_workflow.return_value = ([make_workflow(id="w1")], False)

            with (
                app.test_request_context("/"),
                patch(
                    "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow.RagPipelineService",
                    return_value=service,
                ),
            ):
                result = method(api, WorkflowListQuery(), user, pipeline)

            assert result["items"][0]["id"] == "w1"
            assert result["items"][0]["graph"] == {"nodes": [], "edges": []}
            assert result["has_more"] is False

        def test_get_published_workflows_forbidden(self, app: Flask) -> None:
            api = PublishedAllRagPipelineApi()
            method = unwrap(api.get)

            pipeline = make_pipeline()
            user = _rag_pipeline_workflow_apis_make_account(id="u1")

            with (
                app.test_request_context("/?user_id=u2"),
            ):
                with pytest.raises(Forbidden):
                    method(api, WorkflowListQuery(user_id="u2"), user, pipeline)

    class TestRagPipelineByIdApi:
        def test_patch_success(self, app: Flask) -> None:
            api = RagPipelineByIdApi()
            method = unwrap(api.patch)

            pipeline = make_pipeline(tenant_id="t1")
            user = _rag_pipeline_workflow_apis_make_account(id="u1")

            workflow = make_workflow(id="w1", marked_name="test")

            service = MagicMock()
            service.update_workflow.return_value = workflow

            payload = {"marked_name": "test"}

            with (
                app.test_request_context("/", json=payload),
                patch(
                    "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow.RagPipelineService",
                    return_value=service,
                ),
            ):
                result = method(api, WorkflowUpdatePayload.model_validate(payload), user, pipeline, "w1")

            assert result["id"] == "w1"
            assert result["marked_name"] == "test"
            assert result["hash"] == workflow.unique_hash

        def test_patch_no_fields(self, app: Flask) -> None:
            api = RagPipelineByIdApi()
            method = unwrap(api.patch)

            pipeline = make_pipeline()
            user = _rag_pipeline_workflow_apis_make_account()

            with app.test_request_context("/", json={}):
                result, status = raised_error(lambda: method(api, WorkflowUpdatePayload(), user, pipeline, "w1"))
                assert status == 400
                assert result == {"code": "invalid_param", "message": "No valid fields to update"}

        @pytest.mark.parametrize("transaction_fails", [False, True], ids=["commit-succeeds", "commit-fails"])
        def test_delete_retires_candidates_only_after_transaction_exit(
            self,
            app: Flask,
            transaction_fails: bool,
        ) -> None:
            api = RagPipelineByIdApi()
            method = unwrap(api.delete)

            pipeline = make_pipeline(tenant_id="t1", workflow_id="active-workflow")
            user = _rag_pipeline_workflow_apis_make_account()

            events: list[str] = []
            error = RuntimeError("commit failed")
            workflow_service = MagicMock()
            workflow_service.delete_workflow.side_effect = lambda **_kwargs: events.append("delete") or ["inline-agent"]
            transaction_factory = MagicMock()

            @contextmanager
            def transaction() -> Generator[Session]:
                events.append("transaction-enter")
                with Session() as session:
                    yield session
                events.append("transaction-exit")
                if transaction_fails:
                    raise error

            transaction_factory.begin.side_effect = transaction

            with (
                app.test_request_context("/", method="DELETE"),
                patch(
                    "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow.WorkflowService",
                    return_value=workflow_service,
                ),
                patch(
                    "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow.sessionmaker",
                    return_value=transaction_factory,
                ),
                patch(
                    "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow."
                    "WorkflowAgentRetirementService.retire_unowned"
                ) as retire_unowned,
            ):
                retire_unowned.side_effect = lambda **_kwargs: events.append("retire")
                if transaction_fails:
                    with pytest.raises(RuntimeError) as exc_info:
                        method(api, user, pipeline, "old-workflow")
                    assert exc_info.value is error
                else:
                    result = method(api, user, pipeline, "old-workflow")
                    assert result == (None, 204)

            workflow_service.delete_workflow.assert_called_once()
            assert events == ["transaction-enter", "delete", "transaction-exit"] + (
                [] if transaction_fails else ["retire"]
            )
            if transaction_fails:
                retire_unowned.assert_not_called()
            else:
                retire_unowned.assert_called_once_with(
                    tenant_id=pipeline.tenant_id,
                    agent_ids=["inline-agent"],
                    account_id=user.id,
                )

        def test_delete_active_workflow_rejected(self, app: Flask) -> None:
            api = RagPipelineByIdApi()
            method = unwrap(api.delete)

            pipeline = make_pipeline(tenant_id="t1", workflow_id="active-workflow")
            user = _rag_pipeline_workflow_apis_make_account()

            with app.test_request_context("/", method="DELETE"):
                with pytest.raises(BadRequest, match="currently in use by pipeline"):
                    method(api, user, pipeline, "active-workflow")

    class TestRagPipelineWorkflowLastRunApi:
        def test_last_run_success(self, app: Flask) -> None:
            api = RagPipelineWorkflowLastRunApi()
            method = unwrap(api.get)

            pipeline = make_pipeline()
            workflow = make_workflow()
            node_exec = make_node_execution()

            service = MagicMock()
            service.get_draft_workflow.return_value = workflow
            service.get_node_last_run.return_value = node_exec

            with (
                app.test_request_context("/"),
                patch(
                    "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow.RagPipelineService",
                    return_value=service,
                ),
            ):
                result = method(api, pipeline, "node1")
                assert result["id"] == "node-exec-1"
                assert result["inputs"] == {"query": "hello"}
                assert result["outputs"] == {"answer": "world"}

        def test_last_run_not_found(self, app: Flask) -> None:
            api = RagPipelineWorkflowLastRunApi()
            method = unwrap(api.get)

            pipeline = make_pipeline()

            service = MagicMock()
            service.get_draft_workflow.return_value = None

            with (
                app.test_request_context("/"),
                patch(
                    "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow.RagPipelineService",
                    return_value=service,
                ),
            ):
                with pytest.raises(NotFound):
                    method(api, pipeline, "node1")

    class TestRagPipelineWorkflowRunNodeExecutionListApi:
        def test_get_node_executions_passes_current_user(self, app: Flask) -> None:
            api = RagPipelineWorkflowRunNodeExecutionListApi()
            method = unwrap(api.get)

            user = _rag_pipeline_workflow_apis_make_account()
            pipeline = make_pipeline()
            run_id = uuid4()
            node_exec = make_node_execution(workflow_run_id=str(run_id))

            session_stub = MagicMock()
            session_stub.scalar.return_value = None
            service = MagicMock()
            service.get_rag_pipeline_workflow_run_node_executions.return_value = [
                node_execution_response_source(node_exec, session=session_stub)
            ]

            with (
                app.test_request_context("/"),
                patch(
                    "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow.RagPipelineService",
                    return_value=service,
                ),
            ):
                result = method(api, user, pipeline, run_id)

            service.get_rag_pipeline_workflow_run_node_executions.assert_called_once_with(
                pipeline=pipeline,
                run_id=str(run_id),
                user=user,
            )
            assert result["data"][0]["id"] == "node-exec-1"
            assert result["data"][0]["inputs"] == {"query": "hello"}
            assert result["data"][0]["outputs"] == {"answer": "world"}

    class TestRagPipelineDatasourceVariableApi:
        def test_set_datasource_variables_success(self, app: Flask) -> None:
            api = RagPipelineDatasourceVariableApi()
            method = unwrap(api.post)

            pipeline = make_pipeline()
            user = _rag_pipeline_workflow_apis_make_account()

            payload = {
                "datasource_type": "db",
                "datasource_info": empty_mapping(),
                "start_node_id": "n1",
                "start_node_title": "Node",
            }

            service = MagicMock()
            service.set_datasource_variables.return_value = make_node_execution(node_id="n1")

            with (
                app.test_request_context("/", json=payload),
                patch(
                    "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow.RagPipelineService",
                    return_value=service,
                ),
            ):
                result = method(api, DatasourceVariablesPayload.model_validate(payload), user, pipeline)
                assert result["node_id"] == "n1"
                assert result["process_data"] == {}
