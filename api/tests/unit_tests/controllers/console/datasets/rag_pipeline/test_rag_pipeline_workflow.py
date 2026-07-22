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
from werkzeug.exceptions import Forbidden

from controllers.console.datasets.rag_pipeline import rag_pipeline_workflow as module
from controllers.web.error import InvokeRateLimitError as InvokeRateLimitHttpError
from models.account import Account, TenantAccountRole
from models.dataset import Pipeline
from models.engine import db
from models.tools import WorkflowToolProvider
from models.workflow import Workflow, WorkflowType
from services.errors.llm import InvokeRateLimitError
from services.rag_pipeline.rag_pipeline import RagPipelineService

DEFAULT_WORKFLOW_TENANT_ID = "00000000-0000-0000-0000-000000000001"
DEFAULT_WORKFLOW_APP_ID = "00000000-0000-0000-0000-000000000002"
DEFAULT_WORKFLOW_CREATED_BY = "00000000-0000-0000-0000-000000000003"
DEFAULT_WORKFLOW_ID = "00000000-0000-0000-0000-000000000004"


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
    return account


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
        Account.__table__.create(db.engine)
        WorkflowToolProvider.__table__.create(db.engine)
        Workflow.__table__.create(db.engine)
        db.session.add(_account())
        db.session.commit()

        try:
            yield app
        finally:
            db.session.remove()


def test_draft_rag_pipeline_workflow_get_serializes_response_model(
    database_app: Flask,
) -> None:
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
        response = handler(api, _account(), pipeline=pipeline)

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
            _account(),
            pipeline=_pipeline(),
            workflow_id=DEFAULT_WORKFLOW_ID,
        )

    assert response["id"] == DEFAULT_WORKFLOW_ID
    assert response["marked_name"] == "Updated release"
    assert response["hash"] == expected_hash


def test_default_rag_pipeline_block_configs_serializes_root_response(database_app: Flask) -> None:
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
        response = handler(api, _pipeline())

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
        response = handler(api, DEFAULT_WORKFLOW_TENANT_ID, _account())

    assert response == recommended_plugins


def test_rag_pipeline_transform_rejects_read_only_member(app: Flask, sqlite_engine: Engine) -> None:
    account = _account()
    account.role = TenantAccountRole.NORMAL
    api = module.RagPipelineTransformApi()
    handler = unwrap_all(api.post)

    with (
        Session(sqlite_engine) as session,
        app.test_request_context("/"),
        pytest.raises(Forbidden),
    ):
        handler(api, session, account, UUID("44444444-4444-4444-4444-444444444444"))


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
        response = handler(api, session, _account(), pipeline.id)

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

    with (
        Session(sqlite_engine) as session,
        app.test_request_context("/", json=payload),
        patch.object(module, "load_rag_pipeline", return_value=pipeline),
        patch.object(module.PipelineGenerateService, "generate", side_effect=InvokeRateLimitError("limit")),
        pytest.raises(InvokeRateLimitHttpError),
    ):
        handler(api, session, _account(), pipeline.id)
