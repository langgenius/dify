"""Unit coverage for RAG workflow controllers using real models and disposable SQLite state."""

from __future__ import annotations

import json
from collections.abc import Iterable, Iterator, Mapping
from dataclasses import dataclass, field
from datetime import datetime
from inspect import unwrap as unwrap_all
from typing import Never, cast
from unittest.mock import patch
from uuid import UUID

import pytest
from flask import Flask
from werkzeug.exceptions import Forbidden, NotFound

from controllers.common.errors import InvalidArgumentError
from controllers.console.datasets.rag_pipeline import rag_pipeline_workflow as module
from controllers.console.datasets.rag_pipeline.rag_pipeline_workflow import (
    DatasourceNodeRunPayload,
    NodeIdQuery,
    PublishedWorkflowRunPayload,
    RagPipelineDraftWorkflowRunPayload,
    RagPipelineRecommendedPluginQuery,
    WorkflowListQuery,
    WorkflowUpdatePayload,
)
from controllers.web.error import InvokeRateLimitError as InvokeRateLimitHttpError
from machinery.context import RequestContext
from models.account import Account, TenantAccountRole
from models.dataset import Pipeline
from models.engine import db
from models.tools import WorkflowToolProvider
from models.workflow import Workflow, WorkflowType
from services.errors.llm import InvokeRateLimitError
from services.errors.rag_pipeline import RagPipelineResourceNotFoundError
from services.knowledge.dataset_access import DatasetAccessDeniedError, DatasetNotFoundError
from services.knowledge.entities.pipeline_workflows import DatasourceNodeRun, PipelineRun
from services.knowledge.rag_pipeline.application import (
    PipelineConfigurationError,
    PipelineCredentialGateway,
    PipelineDatasetAccess,
    PipelineDatasetNotFoundError,
    PipelineDatasetSettings,
    PipelineWorkflowApplicationService,
    PipelineWorkflowOperations,
)
from services.rag_pipeline.rag_pipeline import RagPipelineService
from tests.unit_tests.model_factories import make_account, make_tenant

DEFAULT_WORKFLOW_TENANT_ID = "00000000-0000-0000-0000-000000000001"
DEFAULT_WORKFLOW_APP_ID = "00000000-0000-0000-0000-000000000002"
DEFAULT_WORKFLOW_CREATED_BY = "00000000-0000-0000-0000-000000000003"
DEFAULT_WORKFLOW_ID = "00000000-0000-0000-0000-000000000004"
DEFAULT_DATASET_ID = "44444444-4444-4444-4444-444444444444"


@dataclass
class _RecordingPipelineWorkflows:
    calls: list[tuple[str, str, str, PipelineRun]] = field(default_factory=list)
    node_calls: list[tuple[str, str, str, str, DatasourceNodeRun]] = field(default_factory=list)
    error: Exception | None = None

    def run_console_pipeline(
        self,
        *,
        workspace_id: str,
        actor_id: str,
        pipeline_id: str,
        command: PipelineRun,
    ) -> Mapping[str, object] | Iterable[str]:
        self.calls.append((workspace_id, actor_id, pipeline_id, command))
        if self.error is not None:
            raise self.error
        return {"event": "done"}

    def run_console_datasource_node(
        self,
        *,
        workspace_id: str,
        actor_id: str,
        pipeline_id: str,
        node_id: str,
        command: DatasourceNodeRun,
    ) -> Iterable[str]:
        self.node_calls.append((workspace_id, actor_id, pipeline_id, node_id, command))
        if self.error is not None:
            raise self.error
        return iter(("data: complete\n\n",))


@dataclass
class _TransformingPipelineWorkflows:
    calls: list[tuple[RequestContext, str]] = field(default_factory=list)
    result: Mapping[str, object] = field(
        default_factory=lambda: {"pipeline_id": "pipeline-1", "dataset_id": DEFAULT_DATASET_ID, "status": "success"}
    )
    error: Exception | None = None

    def transform_dataset(self, context: RequestContext, *, dataset_id: str) -> Mapping[str, object]:
        self.calls.append((context, dataset_id))
        if self.error is not None:
            raise self.error
        return self.result


@dataclass(frozen=True)
class _PreparedPipeline:
    datasource_plugin_specs: tuple[Mapping[str, object], ...]


@dataclass
class _AuthorizationOperations:
    run_called: bool = False

    def prepare_pipeline(self, scope: object, *, command: PipelineRun) -> _PreparedPipeline:
        del scope, command
        return _PreparedPipeline(
            (
                {
                    "node_id": "node-1",
                    "provider_name": "notion",
                    "plugin_id": "plugin-1",
                    "datasource_type": "online_document",
                },
            )
        )

    def run_prepared_pipeline(self, prepared: object, *, command: PipelineRun) -> Mapping[str, object]:
        del prepared, command
        self.run_called = True
        return {"status": "unexpected"}


@dataclass
class _AuthorizationCredentials:
    actors: list[str] = field(default_factory=list)

    def resolve_visible(
        self,
        *,
        workspace_id: str,
        actor_id: str,
        provider: str,
        plugin_id: str,
        datasource_type: str,
        credential_id: str | None,
    ) -> None:
        del workspace_id, provider, plugin_id, datasource_type, credential_id
        self.actors.append(actor_id)
        raise PipelineConfigurationError("Datasource credential is not available to this actor")


class _UnusedDatasetSettings:
    def initialize_creator_access(self, context: RequestContext, *, dataset_id: str) -> Never:
        del context, dataset_id
        raise AssertionError("dataset settings must not be used before credential authorization")

    def prepare_rag_pipeline_dataset_settings(
        self,
        context: RequestContext,
        *,
        dataset_id: str,
        settings: object,
        has_published: bool,
    ) -> Never:
        del context, dataset_id, settings, has_published
        raise AssertionError("dataset settings must not be used before credential authorization")


@dataclass(frozen=True)
class _KnowledgeServices:
    pipeline_workflows: (
        _RecordingPipelineWorkflows | _TransformingPipelineWorkflows | PipelineWorkflowApplicationService
    )


@dataclass(frozen=True)
class _ApplicationServices:
    knowledge: _KnowledgeServices


def _make_workflow(**overrides: object) -> Workflow:
    workflow = Workflow(
        id=DEFAULT_WORKFLOW_ID,
        tenant_id=DEFAULT_WORKFLOW_TENANT_ID,
        app_id=DEFAULT_WORKFLOW_APP_ID,
        type=WorkflowType.WORKFLOW,
        version=Workflow.VERSION_DRAFT,
        marked_name="Release 1",
        marked_comment="Initial release",
        graph=json.dumps({"nodes": [], "edges": []}),
        features=json.dumps({"file_upload": {"enabled": False}}),
        created_by=DEFAULT_WORKFLOW_CREATED_BY,
        created_at=datetime(2024, 1, 1, 12, 0, 0),
        updated_by=None,
        updated_at=datetime(2024, 1, 1, 12, 1, 0),
        environment_variables=[],
        conversation_variables=[],
        rag_pipeline_variables=[],
    )
    for key, value in overrides.items():
        setattr(workflow, key, value)
    return workflow


def _account() -> Account:
    return make_account(
        account_id=DEFAULT_WORKFLOW_CREATED_BY,
        name="Alice",
        email="alice@example.com",
        role=TenantAccountRole.EDITOR,
        tenant=make_tenant(tenant_id=DEFAULT_WORKFLOW_TENANT_ID, name="Tenant"),
    )


def _pipeline() -> Pipeline:
    pipeline = Pipeline(tenant_id=DEFAULT_WORKFLOW_TENANT_ID, name="Pipeline", description="desc")
    pipeline.id = DEFAULT_WORKFLOW_APP_ID
    return pipeline


def _persist_workflow(workflow: Workflow) -> None:
    db.session.add(workflow)
    db.session.commit()
    db.session.expunge(workflow)


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
        "id": DEFAULT_WORKFLOW_CREATED_BY,
        "name": "Alice",
        "email": "alice@example.com",
    }
    assert response["updated_by"] is None
    assert response["created_at"] == int(datetime(2024, 1, 1, 12, 0, 0).timestamp())
    assert response["updated_at"] == int(datetime(2024, 1, 1, 12, 1, 0).timestamp())


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
        f"/rag/pipelines/{DEFAULT_WORKFLOW_APP_ID}/workflows/{DEFAULT_WORKFLOW_ID}", method="PATCH", json=payload
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


@pytest.mark.usefixtures("database_app")
def test_default_rag_pipeline_block_configs_serializes_root_response() -> None:
    block_configs = [{"type": "start", "config": {"title": "Start"}}]

    api = module.DefaultRagPipelineBlockConfigsApi()
    handler = unwrap_all(api.get)

    with patch.object(RagPipelineService, "get_default_block_configs", return_value=block_configs):
        response = handler(api, _pipeline())

    assert response == block_configs


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
        response = handler(api, RagPipelineRecommendedPluginQuery(type="tool"), DEFAULT_WORKFLOW_TENANT_ID, _account())

    assert response == recommended_plugins


def test_rag_pipeline_transform_calls_application_service(monkeypatch: pytest.MonkeyPatch) -> None:
    api = module.RagPipelineTransformApi()
    handler = unwrap_all(api.post)
    workflows = _TransformingPipelineWorkflows()
    context = RequestContext(
        "request-1",
        None,
        DEFAULT_WORKFLOW_CREATED_BY,
        DEFAULT_WORKFLOW_TENANT_ID,
    )
    monkeypatch.setattr(
        module,
        "application_services",
        lambda: _ApplicationServices(knowledge=_KnowledgeServices(pipeline_workflows=workflows)),
    )

    response = handler(api, context, UUID(DEFAULT_DATASET_ID))

    assert response == {
        "pipeline_id": "pipeline-1",
        "dataset_id": DEFAULT_DATASET_ID,
        "status": "success",
    }
    assert workflows.calls == [(context, DEFAULT_DATASET_ID)]


@pytest.mark.parametrize(
    ("error", "http_error"),
    [
        (DatasetNotFoundError(), NotFound),
        (PipelineDatasetNotFoundError(), NotFound),
        (RagPipelineResourceNotFoundError("Pipeline not found"), NotFound),
        (DatasetAccessDeniedError("private dataset"), Forbidden),
    ],
)
def test_rag_pipeline_transform_maps_application_errors(
    error: Exception,
    http_error: type[Exception],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    api = module.RagPipelineTransformApi()
    handler = unwrap_all(api.post)
    workflows = _TransformingPipelineWorkflows(error=error)
    monkeypatch.setattr(
        module,
        "application_services",
        lambda: _ApplicationServices(knowledge=_KnowledgeServices(pipeline_workflows=workflows)),
    )

    with pytest.raises(http_error, match=str(error)):
        handler(
            api,
            RequestContext("request-1", None, DEFAULT_WORKFLOW_CREATED_BY, DEFAULT_WORKFLOW_TENANT_ID),
            UUID(DEFAULT_DATASET_ID),
        )


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
def test_rag_pipeline_run_uses_actor_aware_application_service(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    api_type: type,
    payload: dict[str, object],
) -> None:
    api = api_type()
    handler = unwrap_all(api.post)
    workflows = _RecordingPipelineWorkflows()
    monkeypatch.setattr(
        module,
        "application_services",
        lambda: _ApplicationServices(knowledge=_KnowledgeServices(pipeline_workflows=workflows)),
    )

    with (
        app.test_request_context("/", json=payload),
        patch.object(module.helper, "compact_generate_response", return_value={"ok": True}),
    ):
        req_data = (
            RagPipelineDraftWorkflowRunPayload.model_validate(payload)
            if api_type is module.DraftRagPipelineRunApi
            else PublishedWorkflowRunPayload.model_validate(payload)
        )
        response = handler(api, req_data, DEFAULT_WORKFLOW_TENANT_ID, _account(), UUID(DEFAULT_WORKFLOW_APP_ID))

    assert response == {"ok": True}
    assert len(workflows.calls) == 1
    workspace_id, actor_id, pipeline_id, command = workflows.calls[0]
    assert (workspace_id, actor_id, pipeline_id) == (
        DEFAULT_WORKFLOW_TENANT_ID,
        DEFAULT_WORKFLOW_CREATED_BY,
        DEFAULT_WORKFLOW_APP_ID,
    )
    assert command.is_published is (api_type is module.PublishedRagPipelineRunApi)
    assert command.streaming is (api_type is module.DraftRagPipelineRunApi)


@pytest.mark.parametrize(
    ("api_type", "payload"),
    [
        (
            module.DraftRagPipelineRunApi,
            {
                "inputs": {},
                "datasource_type": "online_document",
                "datasource_info_list": [{"page": {"page_id": "page-1"}, "credential_id": "other-member-private"}],
                "start_node_id": "node-1",
            },
        ),
        (
            module.PublishedRagPipelineRunApi,
            {
                "inputs": {},
                "datasource_type": "online_document",
                "datasource_info_list": [{"page": {"page_id": "page-1"}, "credential_id": "other-member-private"}],
                "start_node_id": "node-1",
                "response_mode": "blocking",
            },
        ),
    ],
)
def test_http_pipeline_run_rejects_private_credential_not_visible_to_actor(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    api_type: type,
    payload: dict[str, object],
) -> None:
    operations = _AuthorizationOperations()
    credentials = _AuthorizationCredentials()
    service = PipelineWorkflowApplicationService(
        operations=cast("PipelineWorkflowOperations", operations),
        credentials=cast("PipelineCredentialGateway", credentials),
        dataset_access=cast("PipelineDatasetAccess", object()),
        dataset_settings=cast("PipelineDatasetSettings", _UnusedDatasetSettings()),
    )
    monkeypatch.setattr(
        module,
        "application_services",
        lambda: _ApplicationServices(knowledge=_KnowledgeServices(pipeline_workflows=service)),
    )
    api = api_type()
    handler = unwrap_all(api.post)
    request_model = (
        RagPipelineDraftWorkflowRunPayload.model_validate(payload)
        if api_type is module.DraftRagPipelineRunApi
        else PublishedWorkflowRunPayload.model_validate(payload)
    )

    with app.test_request_context("/", json=payload), pytest.raises(InvalidArgumentError, match="not available"):
        handler(api, request_model, DEFAULT_WORKFLOW_TENANT_ID, _account(), UUID(DEFAULT_WORKFLOW_APP_ID))

    assert credentials.actors == [DEFAULT_WORKFLOW_CREATED_BY]
    assert operations.run_called is False


@pytest.mark.parametrize(
    ("api_type", "is_published"),
    [
        (module.RagPipelineDraftDatasourceNodeRunApi, False),
        (module.RagPipelinePublishedDatasourceNodeRunApi, True),
    ],
)
def test_datasource_node_run_uses_actor_aware_application_service(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    api_type: type,
    is_published: bool,
) -> None:
    api = api_type()
    handler = unwrap_all(api.post)
    workflows = _RecordingPipelineWorkflows()
    monkeypatch.setattr(
        module,
        "application_services",
        lambda: _ApplicationServices(knowledge=_KnowledgeServices(pipeline_workflows=workflows)),
    )
    payload: dict[str, object] = {
        "inputs": {"query": "hello"},
        "datasource_type": "online_document",
        "credential_id": "actor-visible",
    }

    with (
        app.test_request_context("/", json=payload),
        patch.object(module.helper, "compact_generate_response", return_value={"ok": True}),
    ):
        response = handler(
            api,
            DatasourceNodeRunPayload.model_validate(payload),
            DEFAULT_WORKFLOW_TENANT_ID,
            _account(),
            UUID(DEFAULT_WORKFLOW_APP_ID),
            "node-1",
        )

    assert response == {"ok": True}
    assert workflows.node_calls == [
        (
            DEFAULT_WORKFLOW_TENANT_ID,
            DEFAULT_WORKFLOW_CREATED_BY,
            DEFAULT_WORKFLOW_APP_ID,
            "node-1",
            DatasourceNodeRun(
                inputs={"query": "hello"},
                datasource_type="online_document",
                is_published=is_published,
                credential_id="actor-visible",
            ),
        )
    ]


@pytest.mark.parametrize("api_type", [module.DraftRagPipelineRunApi, module.PublishedRagPipelineRunApi])
def test_rag_pipeline_run_translates_rate_limit(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
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
    workflows = _RecordingPipelineWorkflows(error=InvokeRateLimitError("limit"))
    monkeypatch.setattr(
        module,
        "application_services",
        lambda: _ApplicationServices(knowledge=_KnowledgeServices(pipeline_workflows=workflows)),
    )
    req_data = (
        RagPipelineDraftWorkflowRunPayload.model_validate(payload)
        if api_type is module.DraftRagPipelineRunApi
        else PublishedWorkflowRunPayload.model_validate(payload)
    )

    with app.test_request_context("/", json=payload), pytest.raises(InvokeRateLimitHttpError):
        handler(api, req_data, DEFAULT_WORKFLOW_TENANT_ID, _account(), UUID(DEFAULT_WORKFLOW_APP_ID))

    assert len(workflows.calls) == 1
