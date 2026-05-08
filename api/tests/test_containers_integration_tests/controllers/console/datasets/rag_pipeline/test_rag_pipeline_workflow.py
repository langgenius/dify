"""Testcontainers integration tests for rag_pipeline_workflow controller endpoints."""

from __future__ import annotations

from datetime import datetime
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
from services.errors.app import IsDraftWorkflowError, WorkflowHashNotEqualError, WorkflowNotFoundError
from services.errors.llm import InvokeRateLimitError


def unwrap(func):
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


class TestDraftWorkflowApi:
    @pytest.fixture
    def app(self, flask_app_with_containers: Flask):
        return flask_app_with_containers

    def test_get_draft_success(self, app: Flask):
        api = DraftRagPipelineApi()
        method = unwrap(api.get)

        pipeline = MagicMock()
        workflow = MagicMock()

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
            assert result == workflow

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
        service.get_all_published_workflow.return_value = ([{"id": "w1"}], False)

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

        assert result["items"] == [{"id": "w1"}]
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

        workflow = MagicMock()

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

        assert result == workflow

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
        node_exec = MagicMock()

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
            assert result == node_exec

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
        service.set_datasource_variables.return_value = MagicMock()

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
            assert result is not None
