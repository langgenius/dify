"""Testcontainers integration tests for rag_pipeline_workflow controller endpoints."""

from __future__ import annotations

import json
from datetime import datetime
from types import SimpleNamespace
from typing import TypedDict, Unpack
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy.orm import Session
from werkzeug.exceptions import BadRequest, Forbidden, HTTPException, NotFound

import services
from controllers.console import console_ns
from controllers.console.app.error import DraftWorkflowNotExist, DraftWorkflowNotSync
from controllers.console.datasets.rag_pipeline.rag_pipeline_workflow import (
    DefaultRagPipelineBlockConfigApi,
    DraftRagPipelineApi,
    DraftRagPipelineRunApi,
    PublishedAllRagPipelineApi,
    PublishedRagPipelineApi,
    PublishedRagPipelineRunApi,
    RagPipelineByIdApi,
    RagPipelineDatasourceVariableApi,
    RagPipelineDraftNodeRunApi,
    RagPipelineDraftRunIterationNodeApi,
    RagPipelineDraftRunLoopNodeApi,
    RagPipelineDraftWorkflowRestoreApi,
    RagPipelineRecommendedPluginApi,
    RagPipelineTaskStopApi,
    RagPipelineTransformApi,
    RagPipelineWorkflowLastRunApi,
)
from controllers.web.error import InvokeRateLimitError as InvokeRateLimitHttpError
from libs.datetime_utils import naive_utc_now
from models.account import Account
from models.workflow import Workflow
from services.errors.app import IsDraftWorkflowError, WorkflowHashNotEqualError, WorkflowNotFoundError
from services.errors.llm import InvokeRateLimitError

DEFAULT_WORKFLOW_TENANT_ID = "00000000-0000-0000-0000-000000000001"
DEFAULT_WORKFLOW_APP_ID = "00000000-0000-0000-0000-000000000002"
DEFAULT_WORKFLOW_CREATED_BY = "00000000-0000-0000-0000-000000000003"
type WorkflowVariablePayload = dict[str, object]


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
    updated_at: datetime
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
    updated_at: datetime
    environment_variables: list[WorkflowVariablePayload]
    conversation_variables: list[WorkflowVariablePayload]
    rag_pipeline_variables: list[WorkflowVariablePayload]


def unwrap(func):
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


def make_node_execution(**overrides):
    payload = {
        "id": "node-exec-1",
        "index": 1,
        "predecessor_node_id": None,
        "node_id": "node1",
        "node_type": "start",
        "title": "Start",
        "inputs_dict": {"query": "hello"},
        "process_data_dict": {},
        "outputs_dict": {"answer": "world"},
        "status": "succeeded",
        "error": None,
        "elapsed_time": 1.0,
        "execution_metadata_dict": {},
        "extras": {},
        "created_at": datetime(2026, 1, 1, 0, 0, 0),
        "created_by_role": "account",
        "created_by_account": None,
        "created_by_end_user": None,
        "finished_at": datetime(2026, 1, 1, 0, 0, 1),
        "inputs_truncated": False,
        "outputs_truncated": False,
        "process_data_truncated": False,
    }
    payload.update(overrides)
    return SimpleNamespace(**payload)


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


@pytest.fixture
def workflow_author(db_session_with_containers: Session) -> Account:
    account = Account(name="Alice", email=f"alice-{uuid4()}@example.com")
    db_session_with_containers.add(account)
    db_session_with_containers.commit()
    return account


class TestDraftWorkflowApi:
    @pytest.fixture
    def app(self, flask_app_with_containers: Flask):
        return flask_app_with_containers

    def test_get_draft_success(self, app: Flask, workflow_author: Account):
        api = DraftRagPipelineApi()
        method = unwrap(api.get)

        pipeline = MagicMock()
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
            result = method(api, pipeline)

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

    def test_get_draft_not_exist(self, app: Flask):
        api = DraftRagPipelineApi()
        method = unwrap(api.get)

        pipeline = MagicMock()
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
                method(api, pipeline)

    def test_sync_hash_not_match(self, app: Flask):
        api = DraftRagPipelineApi()
        method = unwrap(api.post)

        pipeline = MagicMock()
        user = MagicMock()

        service = MagicMock()
        service.sync_draft_workflow.side_effect = WorkflowHashNotEqualError()

        with (
            app.test_request_context("/", json={"graph": {}, "features": {}}),
            patch.object(type(console_ns), "payload", {"graph": {}, "features": {}}),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow.current_account_with_tenant",
                return_value=(user, "t"),
            ),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow.RagPipelineService",
                return_value=service,
            ),
        ):
            with pytest.raises(DraftWorkflowNotSync):
                method(api, pipeline)

    def test_sync_invalid_text_plain(self, app: Flask):
        api = DraftRagPipelineApi()
        method = unwrap(api.post)

        pipeline = MagicMock()
        user = MagicMock()

        with (
            app.test_request_context("/", data="bad-json", headers={"Content-Type": "text/plain"}),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow.current_account_with_tenant",
                return_value=(user, "t"),
            ),
        ):
            response, status = method(api, pipeline)
            assert status == 400

    def test_restore_published_workflow_to_draft_success(self, app: Flask):
        api = RagPipelineDraftWorkflowRestoreApi()
        method = unwrap(api.post)

        pipeline = MagicMock()
        user = MagicMock(id="account-1")
        workflow = MagicMock(unique_hash="restored-hash", updated_at=None, created_at=datetime(2024, 1, 1))

        service = MagicMock()
        service.restore_published_workflow_to_draft.return_value = workflow

        with (
            app.test_request_context("/", method="POST"),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow.current_account_with_tenant",
                return_value=(user, "t"),
            ),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow.RagPipelineService",
                return_value=service,
            ),
        ):
            result = method(api, pipeline, "published-workflow")

        assert result["result"] == "success"
        assert result["hash"] == "restored-hash"

    def test_restore_published_workflow_to_draft_not_found(self, app: Flask):
        api = RagPipelineDraftWorkflowRestoreApi()
        method = unwrap(api.post)

        pipeline = MagicMock()
        user = MagicMock(id="account-1")

        service = MagicMock()
        service.restore_published_workflow_to_draft.side_effect = WorkflowNotFoundError("Workflow not found")

        with (
            app.test_request_context("/", method="POST"),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow.current_account_with_tenant",
                return_value=(user, "t"),
            ),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow.RagPipelineService",
                return_value=service,
            ),
        ):
            with pytest.raises(NotFound):
                method(api, pipeline, "published-workflow")

    def test_restore_published_workflow_to_draft_returns_400_for_draft_source(self, app: Flask):
        api = RagPipelineDraftWorkflowRestoreApi()
        method = unwrap(api.post)

        pipeline = MagicMock()
        user = MagicMock(id="account-1")

        service = MagicMock()
        service.restore_published_workflow_to_draft.side_effect = IsDraftWorkflowError(
            "source workflow must be published"
        )

        with (
            app.test_request_context("/", method="POST"),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow.current_account_with_tenant",
                return_value=(user, "t"),
            ),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow.RagPipelineService",
                return_value=service,
            ),
        ):
            with pytest.raises(HTTPException) as exc:
                method(api, pipeline, "draft-workflow")

        assert exc.value.code == 400
        assert exc.value.description == "source workflow must be published"


class TestDraftRunNodes:
    @pytest.fixture
    def app(self, flask_app_with_containers: Flask):
        return flask_app_with_containers

    def test_iteration_node_success(self, app: Flask):
        api = RagPipelineDraftRunIterationNodeApi()
        method = unwrap(api.post)

        pipeline = MagicMock()
        user = MagicMock()

        with (
            app.test_request_context("/", json={"inputs": {}}),
            patch.object(type(console_ns), "payload", {"inputs": {}}),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow.current_account_with_tenant",
                return_value=(user, "t"),
            ),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow.PipelineGenerateService.generate_single_iteration",
                return_value=MagicMock(),
            ),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow.helper.compact_generate_response",
                return_value={"ok": True},
            ),
        ):
            result = method(api, pipeline, "node")
            assert result == {"ok": True}

    def test_iteration_node_conversation_not_exists(self, app: Flask):
        api = RagPipelineDraftRunIterationNodeApi()
        method = unwrap(api.post)

        pipeline = MagicMock()
        user = MagicMock()

        with (
            app.test_request_context("/", json={"inputs": {}}),
            patch.object(type(console_ns), "payload", {"inputs": {}}),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow.current_account_with_tenant",
                return_value=(user, "t"),
            ),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow.PipelineGenerateService.generate_single_iteration",
                side_effect=services.errors.conversation.ConversationNotExistsError(),
            ),
        ):
            with pytest.raises(NotFound):
                method(api, pipeline, "node")

    def test_loop_node_success(self, app: Flask):
        api = RagPipelineDraftRunLoopNodeApi()
        method = unwrap(api.post)

        pipeline = MagicMock()
        user = MagicMock()

        with (
            app.test_request_context("/", json={"inputs": {}}),
            patch.object(type(console_ns), "payload", {"inputs": {}}),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow.current_account_with_tenant",
                return_value=(user, "t"),
            ),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow.PipelineGenerateService.generate_single_loop",
                return_value=MagicMock(),
            ),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow.helper.compact_generate_response",
                return_value={"ok": True},
            ),
        ):
            assert method(api, pipeline, "node") == {"ok": True}


class TestPipelineRunApis:
    @pytest.fixture
    def app(self, flask_app_with_containers: Flask):
        return flask_app_with_containers

    def test_draft_run_success(self, app: Flask):
        api = DraftRagPipelineRunApi()
        method = unwrap(api.post)

        pipeline = MagicMock()
        user = MagicMock()

        payload = {
            "inputs": {},
            "datasource_type": "x",
            "datasource_info_list": [],
            "start_node_id": "n",
        }

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow.current_account_with_tenant",
                return_value=(user, "t"),
            ),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow.PipelineGenerateService.generate",
                return_value=MagicMock(),
            ),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow.helper.compact_generate_response",
                return_value={"ok": True},
            ),
        ):
            assert method(api, pipeline) == {"ok": True}

    def test_draft_run_rate_limit(self, app: Flask):
        api = DraftRagPipelineRunApi()
        method = unwrap(api.post)

        pipeline = MagicMock()
        user = MagicMock()

        with (
            app.test_request_context(
                "/", json={"inputs": {}, "datasource_type": "x", "datasource_info_list": [], "start_node_id": "n"}
            ),
            patch.object(
                type(console_ns),
                "payload",
                {"inputs": {}, "datasource_type": "x", "datasource_info_list": [], "start_node_id": "n"},
            ),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow.current_account_with_tenant",
                return_value=(user, "t"),
            ),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow.PipelineGenerateService.generate",
                side_effect=InvokeRateLimitError("limit"),
            ),
        ):
            with pytest.raises(InvokeRateLimitHttpError):
                method(api, pipeline)


class TestDraftNodeRun:
    @pytest.fixture
    def app(self, flask_app_with_containers: Flask):
        return flask_app_with_containers

    def test_execution_not_found(self, app: Flask):
        api = RagPipelineDraftNodeRunApi()
        method = unwrap(api.post)

        pipeline = MagicMock()
        user = MagicMock()

        service = MagicMock()
        service.run_draft_workflow_node.return_value = None

        with (
            app.test_request_context("/", json={"inputs": {}}),
            patch.object(type(console_ns), "payload", {"inputs": {}}),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow.current_account_with_tenant",
                return_value=(user, "t"),
            ),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow.RagPipelineService",
                return_value=service,
            ),
        ):
            with pytest.raises(ValueError):
                method(api, pipeline, "node")


class TestPublishedPipelineApis:
    @pytest.fixture
    def app(self, flask_app_with_containers: Flask):
        return flask_app_with_containers

    def test_publish_success(self, app: Flask, db_session_with_containers: Session):
        from models.dataset import Pipeline

        api = PublishedRagPipelineApi()
        method = unwrap(api.post)

        tenant_id = str(uuid4())
        pipeline = Pipeline(
            tenant_id=tenant_id,
            name="test-pipeline",
            description="test",
            created_by=str(uuid4()),
        )
        db_session_with_containers.add(pipeline)
        db_session_with_containers.commit()
        db_session_with_containers.expire_all()

        user = MagicMock(id="u1")

        workflow = MagicMock(
            id=str(uuid4()),
            created_at=naive_utc_now(),
        )

        service = MagicMock()
        service.publish_workflow.return_value = workflow

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow.current_account_with_tenant",
                return_value=(user, "t"),
            ),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow.RagPipelineService",
                return_value=service,
            ),
        ):
            result = method(api, pipeline)

        assert result["result"] == "success"
        assert "created_at" in result


class TestMiscApis:
    @pytest.fixture
    def app(self, flask_app_with_containers: Flask):
        return flask_app_with_containers

    def test_task_stop(self, app: Flask):
        api = RagPipelineTaskStopApi()
        method = unwrap(api.post)

        pipeline = MagicMock()
        user = MagicMock(id="u1")

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow.current_account_with_tenant",
                return_value=(user, "t"),
            ),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow.AppQueueManager.set_stop_flag"
            ) as stop_mock,
        ):
            result = method(api, pipeline, "task-1")
            stop_mock.assert_called_once()
            assert result["result"] == "success"

    def test_transform_forbidden(self, app: Flask):
        api = RagPipelineTransformApi()
        method = unwrap(api.post)

        user = MagicMock(has_edit_permission=False, is_dataset_operator=False)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow.current_account_with_tenant",
                return_value=(user, "t"),
            ),
        ):
            with pytest.raises(Forbidden):
                method(api, "ds1")

    def test_recommended_plugins(self, app: Flask):
        api = RagPipelineRecommendedPluginApi()
        method = unwrap(api.get)

        service = MagicMock()
        service.get_recommended_plugins.return_value = [{"id": "p1"}]

        with (
            app.test_request_context("/?type=all"),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow.RagPipelineService",
                return_value=service,
            ),
        ):
            result = method(api)
            assert result == [{"id": "p1"}]


class TestPublishedRagPipelineRunApi:
    @pytest.fixture
    def app(self, flask_app_with_containers: Flask):
        return flask_app_with_containers

    def test_published_run_success(self, app: Flask):
        api = PublishedRagPipelineRunApi()
        method = unwrap(api.post)

        pipeline = MagicMock()
        user = MagicMock()

        payload = {
            "inputs": {},
            "datasource_type": "x",
            "datasource_info_list": [],
            "start_node_id": "n",
            "response_mode": "blocking",
        }

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow.current_account_with_tenant",
                return_value=(user, "t"),
            ),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow.PipelineGenerateService.generate",
                return_value=MagicMock(),
            ),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow.helper.compact_generate_response",
                return_value={"ok": True},
            ),
        ):
            result = method(api, pipeline)
            assert result == {"ok": True}

    def test_published_run_rate_limit(self, app: Flask):
        api = PublishedRagPipelineRunApi()
        method = unwrap(api.post)

        pipeline = MagicMock()
        user = MagicMock()

        payload = {
            "inputs": {},
            "datasource_type": "x",
            "datasource_info_list": [],
            "start_node_id": "n",
        }

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow.current_account_with_tenant",
                return_value=(user, "t"),
            ),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow.PipelineGenerateService.generate",
                side_effect=InvokeRateLimitError("limit"),
            ),
        ):
            with pytest.raises(InvokeRateLimitHttpError):
                method(api, pipeline)


class TestDefaultBlockConfigApi:
    @pytest.fixture
    def app(self, flask_app_with_containers: Flask):
        return flask_app_with_containers

    def test_get_block_config_success(self, app: Flask):
        api = DefaultRagPipelineBlockConfigApi()
        method = unwrap(api.get)

        pipeline = MagicMock()

        service = MagicMock()
        service.get_default_block_config.return_value = {"k": "v"}

        with (
            app.test_request_context("/?q={}"),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow.RagPipelineService",
                return_value=service,
            ),
        ):
            result = method(api, pipeline, "llm")
            assert result == {"k": "v"}

    def test_get_block_config_invalid_json(self, app: Flask):
        api = DefaultRagPipelineBlockConfigApi()
        method = unwrap(api.get)

        pipeline = MagicMock()

        with app.test_request_context("/?q=bad-json"):
            with pytest.raises(ValueError):
                method(api, pipeline, "llm")


class TestPublishedAllRagPipelineApi:
    @pytest.fixture
    def app(self, flask_app_with_containers: Flask):
        return flask_app_with_containers

    def test_get_published_workflows_success(self, app: Flask):
        api = PublishedAllRagPipelineApi()
        method = unwrap(api.get)

        pipeline = MagicMock()
        user = MagicMock(id="u1")

        service = MagicMock()
        service.get_all_published_workflow.return_value = ([make_workflow(id="w1")], False)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow.current_account_with_tenant",
                return_value=(user, "t"),
            ),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow.RagPipelineService",
                return_value=service,
            ),
        ):
            result = method(api, pipeline)

        assert result["items"][0]["id"] == "w1"
        assert result["items"][0]["graph"] == {"nodes": [], "edges": []}
        assert result["has_more"] is False

    def test_get_published_workflows_forbidden(self, app: Flask):
        api = PublishedAllRagPipelineApi()
        method = unwrap(api.get)

        pipeline = MagicMock()
        user = MagicMock(id="u1")

        with (
            app.test_request_context("/?user_id=u2"),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow.current_account_with_tenant",
                return_value=(user, "t"),
            ),
        ):
            with pytest.raises(Forbidden):
                method(api, pipeline)


class TestRagPipelineByIdApi:
    @pytest.fixture
    def app(self, flask_app_with_containers: Flask):
        return flask_app_with_containers

    def test_patch_success(self, app: Flask):
        api = RagPipelineByIdApi()
        method = unwrap(api.patch)

        pipeline = MagicMock(tenant_id="t1")
        user = MagicMock(id="u1")

        workflow = make_workflow(id="w1", marked_name="test")

        service = MagicMock()
        service.update_workflow.return_value = workflow

        payload = {"marked_name": "test"}

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow.current_account_with_tenant",
                return_value=(user, "t"),
            ),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow.RagPipelineService",
                return_value=service,
            ),
        ):
            result = method(api, pipeline, "w1")

        assert result["id"] == "w1"
        assert result["marked_name"] == "test"
        assert result["hash"] == workflow.unique_hash

    def test_patch_no_fields(self, app: Flask):
        api = RagPipelineByIdApi()
        method = unwrap(api.patch)

        pipeline = MagicMock()
        user = MagicMock()

        with (
            app.test_request_context("/", json={}),
            patch.object(type(console_ns), "payload", {}),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow.current_account_with_tenant",
                return_value=(user, "t"),
            ),
        ):
            result, status = method(api, pipeline, "w1")
            assert status == 400

    def test_delete_success(self, app: Flask):
        api = RagPipelineByIdApi()
        method = unwrap(api.delete)

        pipeline = MagicMock(tenant_id="t1", workflow_id="active-workflow", id="pipeline-1")

        workflow_service = MagicMock()

        with (
            app.test_request_context("/", method="DELETE"),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow.WorkflowService",
                return_value=workflow_service,
            ),
        ):
            result = method(api, pipeline, "old-workflow")

        workflow_service.delete_workflow.assert_called_once()
        assert result == (None, 204)

    def test_delete_active_workflow_rejected(self, app: Flask):
        api = RagPipelineByIdApi()
        method = unwrap(api.delete)

        pipeline = MagicMock(tenant_id="t1", workflow_id="active-workflow", id="pipeline-1")

        with app.test_request_context("/", method="DELETE"):
            with pytest.raises(BadRequest, match="currently in use by pipeline"):
                method(api, pipeline, "active-workflow")


class TestRagPipelineWorkflowLastRunApi:
    @pytest.fixture
    def app(self, flask_app_with_containers: Flask):
        return flask_app_with_containers

    def test_last_run_success(self, app: Flask):
        api = RagPipelineWorkflowLastRunApi()
        method = unwrap(api.get)

        pipeline = MagicMock()
        workflow = MagicMock()
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

    def test_last_run_not_found(self, app: Flask):
        api = RagPipelineWorkflowLastRunApi()
        method = unwrap(api.get)

        pipeline = MagicMock()

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


class TestRagPipelineDatasourceVariableApi:
    @pytest.fixture
    def app(self, flask_app_with_containers: Flask):
        return flask_app_with_containers

    def test_set_datasource_variables_success(self, app: Flask):
        api = RagPipelineDatasourceVariableApi()
        method = unwrap(api.post)

        pipeline = MagicMock()
        user = MagicMock()

        payload = {
            "datasource_type": "db",
            "datasource_info": {},
            "start_node_id": "n1",
            "start_node_title": "Node",
        }

        service = MagicMock()
        service.set_datasource_variables.return_value = make_node_execution(node_id="n1")

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow.current_account_with_tenant",
                return_value=(user, "t"),
            ),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow.RagPipelineService",
                return_value=service,
            ),
        ):
            result = method(api, pipeline)
            assert result["node_id"] == "n1"
            assert result["process_data"] == {}
