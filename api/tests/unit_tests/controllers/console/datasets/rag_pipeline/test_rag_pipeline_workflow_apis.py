"""Unit tests for rag_pipeline_workflow controller endpoints."""

from __future__ import annotations

import json
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import datetime
from inspect import unwrap
from typing import TypedDict, Unpack
from unittest.mock import MagicMock, Mock, create_autospec, patch
from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy import Engine
from sqlalchemy.orm import Session, scoped_session, sessionmaker
from werkzeug.exceptions import HTTPException

import models.workflow as workflow_models
import services
from controllers.common.errors import AccessDeniedError, InvalidRequestError, NotFoundError
from controllers.console.app.error import DraftWorkflowNotExist, DraftWorkflowNotSync
from controllers.console.datasets.rag_pipeline import rag_pipeline_workflow as workflow_controller
from controllers.console.datasets.rag_pipeline.rag_pipeline_workflow import (
    DatasourceVariablesPayload,
    DefaultBlockConfigQuery,
    DefaultRagPipelineBlockConfigApi,
    DraftRagPipelineApi,
    NodeRunPayload,
    NodeRunRequiredPayload,
    PublishedAllRagPipelineApi,
    PublishedRagPipelineApi,
    RagPipelineByIdApi,
    RagPipelineDatasourceVariableApi,
    RagPipelineDraftNodeRunApi,
    RagPipelineDraftRunIterationNodeApi,
    RagPipelineDraftRunLoopNodeApi,
    RagPipelineDraftWorkflowRestoreApi,
    RagPipelineRecommendedPluginApi,
    RagPipelineRecommendedPluginQuery,
    RagPipelineTaskStopApi,
    RagPipelineWorkflowLastRunApi,
    RagPipelineWorkflowRunNodeExecutionListApi,
    WorkflowListQuery,
    WorkflowUpdatePayload,
)
from extensions.ext_application_services import ApplicationServices
from fields.workflow_run_fields import node_execution_response_source
from graphon.enums import WorkflowNodeExecutionStatus
from libs.datetime_utils import naive_utc_now
from machinery.context import RequestContext
from models.account import Account, TenantAccountRole
from models.dataset import Pipeline
from models.enums import CreatorUserRole
from models.workflow import Workflow, WorkflowNodeExecutionModel, WorkflowNodeExecutionTriggeredFrom
from repositories.tools.provider_repository import ToolProviderRepository
from repositories.workflow.definition_repository import workflow_record, workflow_snapshot
from services.errors.app import IsDraftWorkflowError, WorkflowHashNotEqualError, WorkflowNotFoundError
from services.errors.workflow_service import WorkflowInUseError
from services.workflow.contracts import WorkflowOwner, WorkflowSnapshot
from services.workflow.draft_service import WorkflowDraftService

pytestmark = pytest.mark.usefixtures("pipeline_application")


DEFAULT_WORKFLOW_TENANT_ID = "00000000-0000-0000-0000-000000000001"
DEFAULT_WORKFLOW_APP_ID = "00000000-0000-0000-0000-000000000002"
DEFAULT_WORKFLOW_CREATED_BY = "00000000-0000-0000-0000-000000000003"
type WorkflowVariablePayload = dict[str, object]


@dataclass(frozen=True)
class SQLiteDatabase:
    """Expose the concrete SQLite engine and scoped session interface used by controller code."""

    engine: Engine
    session: scoped_session[Session]


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

    with database_session() as session:
        default_author = Account(name="Default Author", email="default-author@example.com")
        default_author.id = DEFAULT_WORKFLOW_CREATED_BY
        session.add(default_author)
        session.commit()

    try:
        yield database_session
    finally:
        database_session.remove()


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
        "tenant_id": DEFAULT_WORKFLOW_TENANT_ID,
        "app_id": DEFAULT_WORKFLOW_APP_ID,
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
        "created_by": DEFAULT_WORKFLOW_CREATED_BY,
        "finished_at": datetime(2026, 1, 1, 0, 0, 1),
    }
    payload.update(overrides)
    execution = WorkflowNodeExecutionModel(
        triggered_from=WorkflowNodeExecutionTriggeredFrom.RAG_PIPELINE_RUN,
        **payload,
    )
    execution.offload_data = []
    return execution


def default_workflow_payload() -> WorkflowFactoryPayload:
    return {
        "id": "workflow-1",
        "tenant_id": DEFAULT_WORKFLOW_TENANT_ID,
        "app_id": DEFAULT_WORKFLOW_APP_ID,
        "type": "workflow",
        "version": "1",
        "marked_name": "Release 1",
        "marked_comment": "Initial release",
        "graph": json.dumps({"nodes": [], "edges": []}),
        "features": json.dumps({"file_upload": {"enabled": False}}),
        "created_by": DEFAULT_WORKFLOW_CREATED_BY,
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
    return Workflow(**payload)


def make_account(*, id: str = "account-1", role: TenantAccountRole = TenantAccountRole.EDITOR) -> Account:
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
        service.get_draft_workflow_record.return_value = workflow_record(workflow, sqlite_session)

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
        service.get_draft_workflow_record.return_value = None

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow.RagPipelineService",
                return_value=service,
            ),
        ):
            with pytest.raises(DraftWorkflowNotExist):
                method(api, sqlite_session, pipeline)

    def test_sync_hash_not_match(self, app: Flask, workflow_application: ApplicationServices) -> None:
        api = DraftRagPipelineApi()
        method = unwrap(api.post)

        pipeline = make_pipeline()
        user = make_account()

        service = create_autospec(WorkflowDraftService, instance=True)
        service.sync.side_effect = WorkflowHashNotEqualError()

        with (
            app.test_request_context("/", json={"graph": empty_mapping(), "features": empty_mapping()}),
            patch.object(workflow_controller, "application_services", return_value=workflow_application),
            patch.object(workflow_application.workflow_drafts, "restore", service.restore),
            patch.object(workflow_application.workflow_drafts, "sync", service.sync),
        ):
            with pytest.raises(DraftWorkflowNotSync):
                method(api, RequestContext("test", None, user.id, pipeline.tenant_id), pipeline.id)

    def test_sync_invalid_text_plain(self, app: Flask) -> None:
        api = DraftRagPipelineApi()
        method = unwrap(api.post)

        pipeline = make_pipeline()
        user = make_account()

        with (
            app.test_request_context("/", data="bad-json", headers={"Content-Type": "text/plain"}),
        ):
            response, status = method(api, RequestContext("test", None, user.id, pipeline.tenant_id), pipeline.id)
            assert status == 400

    def test_restore_published_workflow_to_draft_success(
        self, app: Flask, workflow_application: ApplicationServices
    ) -> None:
        api = RagPipelineDraftWorkflowRestoreApi()
        method = unwrap(api.post)

        pipeline = make_pipeline()
        user = make_account(id="account-1")
        workflow = make_workflow(
            graph=json.dumps({"nodes": [{"id": "restored"}], "edges": []}),
            created_at=datetime(2024, 1, 1),
        )

        service = create_autospec(WorkflowDraftService, instance=True)
        service.restore.return_value = workflow_snapshot(workflow)

        with (
            app.test_request_context("/", method="POST"),
            patch.object(workflow_controller, "application_services", return_value=workflow_application),
            patch.object(workflow_application.workflow_drafts, "restore", service.restore),
            patch.object(workflow_application.workflow_drafts, "sync", service.sync),
        ):
            result = method(
                api, RequestContext("test", None, user.id, pipeline.tenant_id), pipeline.id, "published-workflow"
            )

        assert result["result"] == "success"
        assert result["hash"] == workflow.unique_hash

    def test_restore_published_workflow_to_draft_not_found(
        self, app: Flask, workflow_application: ApplicationServices
    ) -> None:
        api = RagPipelineDraftWorkflowRestoreApi()
        method = unwrap(api.post)

        pipeline = make_pipeline()
        user = make_account(id="account-1")

        service = create_autospec(WorkflowDraftService, instance=True)
        service.restore.side_effect = WorkflowNotFoundError("Workflow not found")

        with (
            app.test_request_context("/", method="POST"),
            patch.object(workflow_controller, "application_services", return_value=workflow_application),
            patch.object(workflow_application.workflow_drafts, "restore", service.restore),
            patch.object(workflow_application.workflow_drafts, "sync", service.sync),
        ):
            with pytest.raises(NotFoundError):
                method(
                    api, RequestContext("test", None, user.id, pipeline.tenant_id), pipeline.id, "published-workflow"
                )

    def test_restore_published_workflow_to_draft_returns_400_for_draft_source(
        self, app: Flask, workflow_application: ApplicationServices
    ) -> None:
        api = RagPipelineDraftWorkflowRestoreApi()
        method = unwrap(api.post)

        pipeline = make_pipeline()
        user = make_account(id="account-1")

        service = create_autospec(WorkflowDraftService, instance=True)
        service.restore.side_effect = IsDraftWorkflowError("source workflow must be published")

        with (
            app.test_request_context("/", method="POST"),
            patch.object(workflow_controller, "application_services", return_value=workflow_application),
            patch.object(workflow_application.workflow_drafts, "restore", service.restore),
            patch.object(workflow_application.workflow_drafts, "sync", service.sync),
        ):
            with pytest.raises(HTTPException) as exc:
                method(api, RequestContext("test", None, user.id, pipeline.tenant_id), pipeline.id, "draft-workflow")

        assert exc.value.code == 400
        assert exc.value.description == "source workflow must be published"


class TestDraftRunNodes:
    def test_iteration_node_success(self, app: Flask) -> None:
        api = RagPipelineDraftRunIterationNodeApi()
        method = unwrap(api.post)

        pipeline = make_pipeline()
        user = make_account()

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
        user = make_account()

        with (
            app.test_request_context("/", json={"inputs": empty_mapping()}),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow.PipelineGenerateService.generate_single_iteration",
                side_effect=services.errors.conversation.ConversationNotExistsError(),
            ),
        ):
            with pytest.raises(NotFoundError):
                method(api, NodeRunPayload(), user, pipeline, "node")

    def test_loop_node_success(self, app: Flask) -> None:
        api = RagPipelineDraftRunLoopNodeApi()
        method = unwrap(api.post)

        pipeline = make_pipeline()
        user = make_account()

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
        user = make_account()

        with (
            app.test_request_context("/", json={"inputs": empty_mapping()}),
            patch.object(
                workflow_controller.application_services().knowledge.pipeline_execution,
                "run_draft_workflow_node",
                return_value=None,
            ),
        ):
            with pytest.raises(ValueError):
                method(api, NodeRunRequiredPayload(inputs={}), user, pipeline, "node")


class TestPublishedPipelineApis:
    @pytest.mark.parametrize("outcome", ["success", "conflict", "missing", "invalid"])
    def test_publish(
        self, app: Flask, workflow_application: ApplicationServices, monkeypatch: pytest.MonkeyPatch, outcome: str
    ) -> None:
        api = PublishedRagPipelineApi()
        method = unwrap(api.post)
        context = RequestContext("test", None, "account-1", "tenant-1")
        calls: list[tuple[RequestContext, str]] = []
        workflow = workflow_snapshot(make_workflow(id="published", created_at=naive_utc_now()))

        def publish(context: RequestContext, pipeline_id: str) -> WorkflowSnapshot:
            calls.append((context, pipeline_id))
            if outcome == "invalid":
                raise workflow_controller.RagPipelinePublicationError("Invalid configuration")
            if outcome == "conflict":
                raise workflow_controller.WorkflowHashNotEqualError()
            if outcome == "missing":
                raise workflow_controller.WorkflowNotFoundError("Pipeline not found")
            return workflow

        monkeypatch.setattr(workflow_controller, "application_services", lambda: workflow_application)
        monkeypatch.setattr(workflow_application.knowledge.pipeline_publication, "publish", publish)
        with app.test_request_context("/", method="POST"):
            if outcome == "success":
                result = method(api, context, "pipeline-1")
                assert result["result"] == "success"
                assert "created_at" in result
            else:
                with pytest.raises(HTTPException) as error:
                    method(api, context, "pipeline-1")
                assert error.value.code == {"conflict": 409, "missing": 404, "invalid": 400}[outcome]
        assert calls == [(context, "pipeline-1")]


class TestMiscApis:
    def test_task_stop(self, app: Flask) -> None:
        api = RagPipelineTaskStopApi()
        method = unwrap(api.post)

        pipeline = make_pipeline()
        user = make_account(id="u1")

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
            "installed_recommended_plugins": [{"id": "p1"}],
            "uninstalled_recommended_plugins": [{"id": "p2"}],
        }
        service.get_recommended_plugins.return_value = recommended_plugins
        user = make_account()
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
            service.get_recommended_plugins.assert_called_once_with(
                "all", user, tenant_id, tool_providers=workflow_controller.application_services().tools.tool_providers
            )


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
            with pytest.raises(ValueError):
                method(api, DefaultBlockConfigQuery(q="bad-json"), pipeline, "llm")


class TestPublishedAllRagPipelineApi:
    def test_get_published_workflows_success(self, app: Flask, sqlite_session: Session) -> None:
        api = PublishedAllRagPipelineApi()
        method = unwrap(api.get)

        pipeline = make_pipeline()
        user = make_account(id="u1")

        service = MagicMock()
        service.get_all_published_workflow.return_value = (
            [workflow_record(make_workflow(id="w1"), sqlite_session)],
            False,
        )

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
        user = make_account(id="u1")

        with (
            app.test_request_context("/?user_id=u2"),
        ):
            with pytest.raises(AccessDeniedError):
                method(api, WorkflowListQuery(user_id="u2"), user, pipeline)


class TestRagPipelineByIdApi:
    def test_patch_success(self, app: Flask, sqlite_session: Session) -> None:
        api = RagPipelineByIdApi()
        method = unwrap(api.patch)

        pipeline = make_pipeline(tenant_id="t1")
        user = make_account(id="u1")

        workflow = make_workflow(id="w1", marked_name="test")

        service = MagicMock()
        service.update_workflow.return_value = workflow_record(workflow, sqlite_session)

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
        user = make_account()

        with app.test_request_context("/", json={}):
            result, status = method(api, WorkflowUpdatePayload(), user, pipeline, "w1")
            assert status == 400

    @pytest.mark.parametrize("in_use", [False, True])
    def test_delete_delegates_to_application(
        self, app: Flask, workflow_application: ApplicationServices, in_use: bool
    ) -> None:
        api = RagPipelineByIdApi()
        method = unwrap(api.delete)
        context = RequestContext("delete", None, "account", "tenant")
        delete = Mock(side_effect=WorkflowInUseError("currently in use by pipeline") if in_use else None)
        with (
            app.test_request_context("/", method="DELETE"),
            patch.object(workflow_controller, "application_services", return_value=workflow_application),
            patch.object(workflow_application.console_workflows, "delete", delete),
        ):
            if in_use:
                with pytest.raises(InvalidRequestError, match="currently in use by pipeline"):
                    method(api, context, "pipeline", "version")
            else:
                assert method(api, context, "pipeline", "version") == (None, 204)
        delete.assert_called_once_with(context, WorkflowOwner("pipeline", "pipeline"), "version")


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
            with pytest.raises(NotFoundError):
                method(api, pipeline, "node1")


class TestRagPipelineWorkflowRunNodeExecutionListApi:
    def test_get_node_executions_passes_current_user(
        self, app: Flask, *, tool_providers: ToolProviderRepository
    ) -> None:
        api = RagPipelineWorkflowRunNodeExecutionListApi()
        method = unwrap(api.get)

        user = make_account()
        pipeline = make_pipeline()
        run_id = uuid4()
        node_exec = make_node_execution(workflow_run_id=str(run_id))

        session_stub = MagicMock()
        session_stub.scalar.return_value = None
        service = MagicMock()
        service.get_rag_pipeline_workflow_run_node_executions.return_value = [
            node_execution_response_source(node_exec, session=session_stub, tool_providers=tool_providers)
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
            tool_providers=workflow_controller.application_services().tools.tool_providers,
        )
        assert result["data"][0]["id"] == "node-exec-1"
        assert result["data"][0]["inputs"] == {"query": "hello"}
        assert result["data"][0]["outputs"] == {"answer": "world"}


class TestRagPipelineDatasourceVariableApi:
    def test_set_datasource_variables_success(self, app: Flask) -> None:
        api = RagPipelineDatasourceVariableApi()
        method = unwrap(api.post)

        pipeline = make_pipeline()
        user = make_account()

        payload = {
            "datasource_type": "db",
            "datasource_info": empty_mapping(),
            "start_node_id": "n1",
            "start_node_title": "Node",
        }

        with (
            app.test_request_context("/", json=payload),
            patch.object(
                workflow_controller.application_services().knowledge.pipeline_execution,
                "set_datasource_variables",
                return_value=make_node_execution(node_id="n1"),
            ),
        ):
            result = method(api, DatasourceVariablesPayload.model_validate(payload), user, pipeline)
            assert result["node_id"] == "n1"
            assert result["process_data"] == {}
