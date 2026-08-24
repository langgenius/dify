"""Unit coverage for RAG workflow controllers using real models and disposable SQLite state."""

from __future__ import annotations

import json
from collections.abc import Iterator
from datetime import datetime
from inspect import unwrap as unwrap_all
from unittest.mock import MagicMock, patch
from uuid import UUID

import pytest
from flask import Flask
from sqlalchemy import Engine
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden, NotFound

from controllers.console.datasets.rag_pipeline import rag_pipeline_workflow as module
from controllers.console.datasets.rag_pipeline.rag_pipeline_workflow import (
    DraftWorkflowRunPayload,
    NodeIdQuery,
    PublishedWorkflowRunPayload,
    RagPipelineRecommendedPluginQuery,
    WorkflowListQuery,
    WorkflowUpdatePayload,
)
from controllers.web.error import InvokeRateLimitError as InvokeRateLimitHttpError
from models.account import Account, Tenant, TenantAccountRole
from models.dataset import Dataset, Pipeline
from models.engine import db
from models.enums import PermissionEnum
from models.tools import WorkflowToolProvider
from models.workflow import Workflow, WorkflowType
from services.errors.llm import InvokeRateLimitError
from services.errors.rag_pipeline import RagPipelineResourceNotFoundError
from services.rag_pipeline.rag_pipeline import RagPipelineService

DEFAULT_WORKFLOW_TENANT_ID = "00000000-0000-0000-0000-000000000001"
DEFAULT_WORKFLOW_APP_ID = "00000000-0000-0000-0000-000000000002"
DEFAULT_WORKFLOW_CREATED_BY = "00000000-0000-0000-0000-000000000003"
DEFAULT_WORKFLOW_ID = "00000000-0000-0000-0000-000000000004"
DEFAULT_DATASET_ID = "44444444-4444-4444-4444-444444444444"


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
    account = Account(name="Alice", email="alice@example.com")
    account.id = DEFAULT_WORKFLOW_CREATED_BY
    account.role = TenantAccountRole.EDITOR
    tenant = Tenant(name="Tenant")
    tenant.id = DEFAULT_WORKFLOW_TENANT_ID
    account._current_tenant = tenant
    return account


def _pipeline() -> Pipeline:
    pipeline = Pipeline(tenant_id=DEFAULT_WORKFLOW_TENANT_ID, name="Pipeline", description="desc")
    pipeline.id = DEFAULT_WORKFLOW_APP_ID
    return pipeline


def _dataset(*, tenant_id: str = DEFAULT_WORKFLOW_TENANT_ID, maintainer: str = DEFAULT_WORKFLOW_CREATED_BY) -> Dataset:
    return Dataset(
        id=DEFAULT_DATASET_ID,
        tenant_id=tenant_id,
        name="Dataset",
        created_by=maintainer,
        maintainer=maintainer,
        permission=PermissionEnum.ONLY_ME,
        provider="vendor",
    )


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
        Account.__table__.create(db.engine)
        WorkflowToolProvider.__table__.create(db.engine)
        Workflow.__table__.create(db.engine)
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

    response = handler(api, _pipeline())

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
        "installed_recommended_plugins": [{"name": "Dify Extractor", "meta": {"version": "1.0.0"}}],
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


def test_rag_pipeline_transform_rejects_read_only_member(sqlite_engine: Engine) -> None:
    account = _account()
    account.role = TenantAccountRole.NORMAL
    api = module.RagPipelineTransformApi()
    handler = unwrap_all(api.post)

    with Session(sqlite_engine) as session:
        session.add(_dataset())

        with (
            patch.object(module.dify_config, "RBAC_ENABLED", False),
            pytest.raises(Forbidden),
        ):
            handler(api, session, DEFAULT_WORKFLOW_TENANT_ID, account, UUID(DEFAULT_DATASET_ID))


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
            handler(api, session, DEFAULT_WORKFLOW_TENANT_ID, _account(), UUID(DEFAULT_DATASET_ID))

    transform_dataset.assert_not_called()


def test_rag_pipeline_transform_enforces_legacy_dataset_permission_before_service_call(
    sqlite_engine: Engine,
) -> None:
    api = module.RagPipelineTransformApi()
    handler = unwrap_all(api.post)

    with Session(sqlite_engine) as session:
        session.add(_dataset(maintainer="00000000-0000-0000-0000-000000000099"))

        with (
            patch.object(module.dify_config, "RBAC_ENABLED", False),
            patch.object(module.RagPipelineTransformService, "transform_dataset") as transform_dataset,
            pytest.raises(Forbidden),
        ):
            handler(api, session, DEFAULT_WORKFLOW_TENANT_ID, _account(), UUID(DEFAULT_DATASET_ID))

    transform_dataset.assert_not_called()


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
            patch.object(module.dify_config, "RBAC_ENABLED", False),
            patch.object(module.RagPipelineTransformService, "transform_dataset", return_value=expected) as transform,
        ):
            response = handler(api, session, DEFAULT_WORKFLOW_TENANT_ID, account, UUID(DEFAULT_DATASET_ID))

        transform.assert_called_once_with(dataset, account.id, session)

    assert response == expected


def test_rag_pipeline_transform_maps_missing_pipeline_to_not_found(sqlite_engine: Engine) -> None:
    api = module.RagPipelineTransformApi()
    handler = unwrap_all(api.post)

    with Session(sqlite_engine) as session:
        session.add(_dataset())

        with (
            patch.object(module.dify_config, "RBAC_ENABLED", False),
            patch.object(
                module.RagPipelineTransformService,
                "transform_dataset",
                side_effect=RagPipelineResourceNotFoundError("Pipeline not found"),
            ),
            pytest.raises(NotFound, match="Pipeline not found"),
        ):
            handler(api, session, DEFAULT_WORKFLOW_TENANT_ID, _account(), UUID(DEFAULT_DATASET_ID))


def test_rag_pipeline_transform_skips_legacy_acl_when_rbac_is_enabled(sqlite_engine: Engine) -> None:
    api = module.RagPipelineTransformApi()
    handler = unwrap_all(api.post)
    account = _account()
    account.role = TenantAccountRole.NORMAL
    expected = {"pipeline_id": "pipeline-1", "dataset_id": DEFAULT_DATASET_ID, "status": "success"}

    with Session(sqlite_engine) as session:
        session.add(_dataset(maintainer="00000000-0000-0000-0000-000000000099"))

        with (
            patch.object(module.dify_config, "RBAC_ENABLED", True),
            patch.object(module.RagPipelineTransformService, "transform_dataset", return_value=expected) as transform,
        ):
            response = handler(api, session, DEFAULT_WORKFLOW_TENANT_ID, account, UUID(DEFAULT_DATASET_ID))

    assert response == expected
    transform.assert_called_once()


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
        patch.object(module.PipelineGenerateService, "generate", return_value=MagicMock()) as generate,
        patch.object(module.helper, "compact_generate_response", return_value={"ok": True}),
    ):
        req_data = (
            DraftWorkflowRunPayload.model_validate(payload)
            if api_type is module.DraftRagPipelineRunApi
            else PublishedWorkflowRunPayload.model_validate(payload)
        )
        response = handler(api, req_data, session, _account(), pipeline.id)

    assert response == {"ok": True}
    load_pipeline.assert_called_once_with(session, pipeline.id)
    assert generate.call_args.kwargs["session"] is session
    assert session.get_bind() is sqlite_engine


@pytest.mark.parametrize("api_type", [module.DraftRagPipelineRunApi, module.PublishedRagPipelineRunApi])
def test_rag_pipeline_run_translates_rate_limit(
    app: Flask,
    sqlite_engine: Engine,
    api_type: type,
) -> None:
    payload = {
        "inputs": {},
        "datasource_type": "x",
        "datasource_info_list": [],
        "start_node_id": "node-1",
    }
    api = api_type()
    handler = unwrap_all(api.post)
    pipeline = _pipeline()
    req_data = (
        DraftWorkflowRunPayload.model_validate(payload)
        if api_type is module.DraftRagPipelineRunApi
        else PublishedWorkflowRunPayload.model_validate(payload)
    )

    with (
        Session(sqlite_engine) as session,
        app.test_request_context("/", json=payload),
        patch.object(module, "load_rag_pipeline", return_value=pipeline),
        patch.object(module.PipelineGenerateService, "generate", side_effect=InvokeRateLimitError("limit")),
        pytest.raises(InvokeRateLimitHttpError),
    ):
        handler(api, req_data, session, _account(), pipeline.id)
