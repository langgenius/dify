"""
Unit tests for Service API Workflow controllers.

Tests coverage for:
- WorkflowRunPayload and WorkflowLogQuery Pydantic models
- Workflow execution error handling
- App mode validation for workflow endpoints
- Workflow stop mechanism validation

Focus on:
- Pydantic model validation
- Error type mappings
- Service method interfaces
"""

import json
import sys
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from inspect import unwrap
from unittest.mock import Mock, patch
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, patch

import pytest
from flask import Flask
from sqlalchemy.orm import sessionmaker
from werkzeug.exceptions import BadRequest, NotFound

from controllers.service_api.app.error import NotWorkflowAppError
from controllers.service_api.app.workflow import (
    AppQueueManager,
    DifyAPIRepositoryFactory,
    GraphEngineManager,
    WorkflowAppLogApi,
    WorkflowLogQuery,
    WorkflowRunApi,
    WorkflowRunByIdApi,
    WorkflowRunDetailApi,
    WorkflowRunPayload,
    WorkflowRunResponse,
    WorkflowTaskStopApi,
)
from controllers.web.error import InvokeRateLimitError as InvokeRateLimitHttpError
from core.app.entities.app_invoke_entities import InvokeFrom
from graphon.enums import WorkflowExecutionStatus
from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
from models.model import App, AppMode, EndUser
from models.workflow import WorkflowAppLog, WorkflowAppLogCreatedFrom, WorkflowRun, WorkflowType
from services.app_generate_service import AppGenerateService
from services.errors.app import IsDraftWorkflowError, WorkflowNotFoundError
from services.errors.llm import InvokeRateLimitError
from services.workflow_app_service import LogView, LogViewDetails, WorkflowAppService


def _default_workflow_inputs() -> dict[str, object]:
    return {"input": "value"}


def _default_log_details() -> LogViewDetails:
    return {"trigger_metadata": {"node": "answer", "latency": 1.25}}


class _DbSessionStub:
    def get(self, *args: object, **kwargs: object) -> None:
        return None


@dataclass
class _DbStub:
    engine: object = field(default_factory=object)
    session: _DbSessionStub = field(default_factory=_DbSessionStub)


@dataclass
class _WorkflowRunRepositoryStub:
    run: WorkflowRun | None

    def get_workflow_run_by_id(self, *, tenant_id: str, app_id: str, run_id: str) -> WorkflowRun | None:
        return self.run if tenant_id and app_id and run_id else None

    def get_workflow_run_by_id_without_tenant(self, *, run_id: str) -> WorkflowRun | None:
        return self.run if run_id else None


class _BeginStub:
    def __enter__(self) -> object:
        return object()

    def __exit__(self, exc_type: object, exc: object, tb: object) -> bool:
        return False


class _SessionMakerStub:
    def __init__(self, *args: object, **kwargs: object) -> None:
        pass

    def begin(self) -> _BeginStub:
        return _BeginStub()


def _make_workflow_run(
    run_id: str = "run-1",
    *,
    workflow_id: str = "wf-1",
    inputs: dict[str, object] | None = None,
    outputs: dict[str, object] | None = None,
    created_at: datetime | None = None,
    finished_at: datetime | None = None,
) -> WorkflowRun:
    return WorkflowRun(
        id=run_id,
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id=workflow_id,
        type=WorkflowType.WORKFLOW,
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        version="2026-01-01",
        graph=json.dumps({"nodes": [], "edges": []}),
        inputs=json.dumps(inputs if inputs is not None else _default_workflow_inputs()),
        outputs=json.dumps(outputs if outputs is not None else {"output": "value"}),
        status=WorkflowExecutionStatus.SUCCEEDED,
        error=None,
        elapsed_time=0.1,
        total_tokens=10,
        total_steps=1,
        created_by_role=CreatorUserRole.END_USER,
        created_by="end-user-1",
        created_at=created_at or datetime(2026, 1, 1, tzinfo=UTC),
        finished_at=finished_at or datetime(2026, 1, 1, tzinfo=UTC),
        exceptions_count=0,
    )


def _make_workflow_app_log() -> WorkflowAppLog:
    log = WorkflowAppLog(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="wf-1",
        workflow_run_id="log-run-1",
        created_from=WorkflowAppLogCreatedFrom.SERVICE_API,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="account-1",
    )
    log.id = "app-log-1"
    log.created_at = datetime(2026, 1, 1, 1, 0, 3, tzinfo=UTC)
    return log


def _make_workflow_log_page() -> dict[str, object]:
    return {
        "page": 1,
        "limit": 20,
        "total": 1,
        "has_more": False,
        "data": [LogView(_make_workflow_app_log(), _default_log_details())],
    }


def _make_app_model(
    *,
    app_id: str = "app-1",
    tenant_id: str = "tenant-1",
    mode: AppMode = AppMode.WORKFLOW,
) -> App:
    app = App()
    app.id = app_id
    app.tenant_id = tenant_id
    app.mode = mode
    return app


def _make_end_user(user_id: str = "end-user-1") -> EndUser:
    end_user = EndUser()
    end_user.id = user_id
    return end_user


def _expected_workflow_log_pagination_payload() -> dict[str, object]:
    return {
        "page": 1,
        "limit": 20,
        "total": 1,
        "has_more": False,
        "data": [
            {
                "id": "app-log-1",
                "workflow_run": {
                    "id": "log-run-1",
                    "version": "2026-01-01",
                    "status": "succeeded",
                    "triggered_from": "app-run",
                    "error": None,
                    "elapsed_time": 0.1,
                    "total_tokens": 10,
                    "total_steps": 1,
                    "created_at": 1767229200,
                    "finished_at": 1767229202,
                    "exceptions_count": 0,
                },
                "details": {"trigger_metadata": {"node": "answer", "latency": 1.25}},
                "created_from": "service-api",
                "created_by_role": "account",
                "created_by_account": None,
                "created_by_end_user": None,
                "created_at": 1767229203,
            }
        ],
    }


class TestWorkflowRunPayload:
    """Test suite for WorkflowRunPayload Pydantic model."""

    def test_payload_with_required_inputs(self):
        """Test payload with required inputs field."""
        payload = WorkflowRunPayload(inputs={"key": "value"})
        assert payload.inputs == {"key": "value"}
        assert payload.files is None
        assert payload.response_mode is None

    def test_payload_with_all_fields(self):
        """Test payload with all fields populated."""
        files = [{"type": "image", "url": "http://example.com/img.png"}]
        payload = WorkflowRunPayload(inputs={"param1": "value1", "param2": 123}, files=files, response_mode="streaming")
        assert payload.inputs == {"param1": "value1", "param2": 123}
        assert payload.files == files
        assert payload.response_mode == "streaming"

    def test_payload_response_mode_blocking(self):
        """Test payload with blocking response mode."""
        payload = WorkflowRunPayload(inputs={}, response_mode="blocking")
        assert payload.response_mode == "blocking"

    def test_payload_with_complex_inputs(self):
        """Test payload with nested complex inputs."""
        complex_inputs = {
            "config": {"nested": {"value": 123}},
            "items": ["item1", "item2"],
            "metadata": {"key": "value"},
        }
        payload = WorkflowRunPayload(inputs=complex_inputs)
        assert payload.inputs == complex_inputs

    def test_payload_with_empty_inputs(self):
        """Test payload with empty inputs dict."""
        payload = WorkflowRunPayload(inputs={})
        assert payload.inputs == {}

    def test_payload_with_multiple_files(self):
        """Test payload with multiple file attachments."""
        files = [
            {"type": "image", "url": "http://example.com/img1.png"},
            {"type": "document", "upload_file_id": "file_123"},
            {"type": "audio", "url": "http://example.com/audio.mp3"},
        ]
        payload = WorkflowRunPayload(inputs={}, files=files)
        assert payload.files is not None
        assert len(payload.files) == 3


class TestWorkflowLogQuery:
    """Test suite for WorkflowLogQuery Pydantic model."""

    def test_query_with_defaults(self):
        """Test query with default values."""
        query = WorkflowLogQuery()
        assert query.keyword is None
        assert query.status is None
        assert query.created_at__before is None
        assert query.created_at__after is None
        assert query.created_by_end_user_session_id is None
        assert query.created_by_account is None
        assert query.page == 1
        assert query.limit == 20

    def test_query_with_all_filters(self):
        """Test query with all filter fields populated."""
        query = WorkflowLogQuery(
            keyword="search term",
            status="succeeded",
            created_at__before="2024-01-15T10:00:00Z",
            created_at__after="2024-01-01T00:00:00Z",
            created_by_end_user_session_id="session_123",
            created_by_account="user@example.com",
            page=2,
            limit=50,
        )
        assert query.keyword == "search term"
        assert query.status == "succeeded"
        assert query.created_at__before == "2024-01-15T10:00:00Z"
        assert query.created_at__after == "2024-01-01T00:00:00Z"
        assert query.created_by_end_user_session_id == "session_123"
        assert query.created_by_account == "user@example.com"
        assert query.page == 2
        assert query.limit == 50

    @pytest.mark.parametrize("status", ["succeeded", "failed", "stopped"])
    def test_query_valid_status_values(self, status):
        """Test all valid status values."""
        query = WorkflowLogQuery(status=status)
        assert query.status == status

    def test_query_pagination_limits(self):
        """Test query pagination boundaries."""
        query_min_page = WorkflowLogQuery(page=1)
        assert query_min_page.page == 1

        query_max_page = WorkflowLogQuery(page=99999)
        assert query_max_page.page == 99999

        query_min_limit = WorkflowLogQuery(limit=1)
        assert query_min_limit.limit == 1

        query_max_limit = WorkflowLogQuery(limit=100)
        assert query_max_limit.limit == 100

    def test_query_with_keyword_search(self):
        """Test query with keyword filter."""
        query = WorkflowLogQuery(keyword="workflow execution")
        assert query.keyword == "workflow execution"

    def test_query_with_date_filters(self):
        """Test query with before/after date filters."""
        query = WorkflowLogQuery(created_at__before="2024-12-31T23:59:59Z", created_at__after="2024-01-01T00:00:00Z")
        assert query.created_at__before == "2024-12-31T23:59:59Z"
        assert query.created_at__after == "2024-01-01T00:00:00Z"


class TestWorkflowRunResponse:
    def test_validates_workflow_run_object_shape_and_clears_paused_outputs(self):
        run = _make_workflow_run(run_id="run-paused")
        run.status = WorkflowExecutionStatus.PAUSED
        run.outputs = json.dumps({"should": "not leak"})

        result = WorkflowRunResponse.model_validate(run, from_attributes=True).model_dump(mode="json")

        assert result == {
            "id": "run-paused",
            "workflow_id": "wf-1",
            "status": "paused",
            "inputs": '{"input": "value"}',
            "outputs": {},
            "error": None,
            "total_steps": 1,
            "total_tokens": 10,
            "created_at": 1767225600,
            "finished_at": 1767225600,
            "elapsed_time": 0.1,
        }


class TestWorkflowAppService:
    """Test WorkflowAppService interface."""

    def test_service_exists(self):
        """Test WorkflowAppService class exists."""
        service = WorkflowAppService()
        assert service is not None

    def test_get_paginate_workflow_app_logs_method_exists(self):
        """Test get_paginate_workflow_app_logs method exists."""
        assert hasattr(WorkflowAppService, "get_paginate_workflow_app_logs")
        assert callable(WorkflowAppService.get_paginate_workflow_app_logs)

    @patch.object(WorkflowAppService, "get_paginate_workflow_app_logs")
    def test_get_paginate_workflow_app_logs_returns_pagination(self, mock_get_logs):
        """Test get_paginate_workflow_app_logs returns paginated result."""
        pagination = _make_workflow_log_page()
        mock_get_logs.return_value = pagination

        service = WorkflowAppService()
        result = service.get_paginate_workflow_app_logs(
            session=Mock(),
            app_model=_make_app_model(),
            keyword=None,
            status=None,
            created_at_before=None,
            created_at_after=None,
            page=1,
            limit=20,
            created_by_end_user_session_id=None,
            created_by_account=None,
        )

        assert result == pagination


class TestWorkflowExecutionStatus:
    """Test WorkflowExecutionStatus enum."""

    def test_succeeded_status_exists(self):
        """Test succeeded status value exists."""
        status = WorkflowExecutionStatus("succeeded")
        assert status.value == "succeeded"

    def test_failed_status_exists(self):
        """Test failed status value exists."""
        status = WorkflowExecutionStatus("failed")
        assert status.value == "failed"

    def test_stopped_status_exists(self):
        """Test stopped status value exists."""
        status = WorkflowExecutionStatus("stopped")
        assert status.value == "stopped"


class TestAppGenerateServiceWorkflow:
    """Test AppGenerateService workflow integration."""

    @patch.object(AppGenerateService, "generate")
    def test_generate_accepts_workflow_args(self, mock_generate: MagicMock):
        """Test generate accepts workflow-specific args."""
        mock_generate.return_value = {"result": "success"}

        result = AppGenerateService.generate(
            app_model=_make_app_model(),
            user=_make_end_user(),
            args={"inputs": {"key": "value"}, "workflow_id": "workflow_123"},
            invoke_from=InvokeFrom.SERVICE_API,
            session=MagicMock(),
            streaming=False,
        )

        assert result == {"result": "success"}
        mock_generate.assert_called_once()

    @patch.object(AppGenerateService, "generate")
    def test_generate_raises_workflow_not_found_error(self, mock_generate: MagicMock):
        """Test generate raises WorkflowNotFoundError."""
        mock_generate.side_effect = WorkflowNotFoundError("Workflow not found")

        with pytest.raises(WorkflowNotFoundError):
            AppGenerateService.generate(
                app_model=_make_app_model(),
                user=_make_end_user(),
                args={"workflow_id": "invalid_id"},
                invoke_from=InvokeFrom.SERVICE_API,
                session=MagicMock(),
                streaming=False,
            )

    @patch.object(AppGenerateService, "generate")
    def test_generate_raises_is_draft_workflow_error(self, mock_generate: MagicMock):
        """Test generate raises IsDraftWorkflowError."""
        mock_generate.side_effect = IsDraftWorkflowError("Workflow is draft")

        with pytest.raises(IsDraftWorkflowError):
            AppGenerateService.generate(
                app_model=_make_app_model(),
                user=_make_end_user(),
                args={"workflow_id": "draft_workflow"},
                invoke_from=InvokeFrom.SERVICE_API,
                session=MagicMock(),
                streaming=False,
            )

    @patch.object(AppGenerateService, "generate")
    def test_generate_supports_streaming_mode(self, mock_generate: MagicMock):
        """Test generate supports streaming response mode."""
        mock_stream = Mock()
        mock_generate.return_value = mock_stream

        result = AppGenerateService.generate(
            app_model=_make_app_model(),
            user=_make_end_user(),
            args={"inputs": {}, "response_mode": "streaming"},
            invoke_from=InvokeFrom.SERVICE_API,
            session=MagicMock(),
            streaming=True,
        )

        assert result == mock_stream


class TestWorkflowStopMechanism:
    """Test workflow stop mechanisms."""

    def test_app_queue_manager_has_stop_flag_method(self):
        """Test AppQueueManager has set_stop_flag_no_user_check method."""
        from core.app.apps.base_app_queue_manager import AppQueueManager

        assert hasattr(AppQueueManager, "set_stop_flag_no_user_check")

    def test_graph_engine_manager_has_send_stop_command(self):
        """Test GraphEngineManager has send_stop_command method."""
        from graphon.graph_engine.manager import GraphEngineManager

        assert hasattr(GraphEngineManager, "send_stop_command")


class TestWorkflowRunRepository:
    """Test workflow run repository interface."""

    def test_repository_factory_can_create_workflow_run_repository(self):
        """Test DifyAPIRepositoryFactory can create workflow run repository."""
        from repositories.factory import DifyAPIRepositoryFactory

        assert hasattr(DifyAPIRepositoryFactory, "create_api_workflow_run_repository")

    @patch("repositories.factory.DifyAPIRepositoryFactory.create_api_workflow_run_repository")
    def test_workflow_run_repository_get_by_id(self, mock_factory):
        """Test workflow run repository get_workflow_run_by_id method."""
        run = _make_workflow_run(run_id=str(uuid.uuid4()))
        mock_factory.return_value = _WorkflowRunRepositoryStub(run=run)

        from repositories.factory import DifyAPIRepositoryFactory

        repo = DifyAPIRepositoryFactory.create_api_workflow_run_repository(sessionmaker())

        result = repo.get_workflow_run_by_id(tenant_id="tenant_123", app_id="app_456", run_id="run_789")

        assert result == run


class TestWorkflowRunDetailApi:
    def test_not_workflow_app(self, app: Flask) -> None:
        api = WorkflowRunDetailApi()
        handler = unwrap(api.get)
        app_model = _make_app_model(mode=AppMode.CHAT)

        with app.test_request_context("/workflows/run/1", method="GET"):
            with pytest.raises(NotWorkflowAppError):
                handler(api, app_model=app_model, workflow_run_id="run")

    def test_success(self, monkeypatch: pytest.MonkeyPatch) -> None:
        run = _make_workflow_run(run_id="run")
        repo = _WorkflowRunRepositoryStub(run=run)
        workflow_module = sys.modules["controllers.service_api.app.workflow"]
        monkeypatch.setattr(workflow_module, "db", _DbStub())
        monkeypatch.setattr(
            DifyAPIRepositoryFactory,
            "create_api_workflow_run_repository",
            lambda *_args, **_kwargs: repo,
        )

        api = WorkflowRunDetailApi()
        handler = unwrap(api.get)
        app_model = _make_app_model(app_id="a1", tenant_id="t1")

        result = handler(api, app_model=app_model, workflow_run_id="run")
        assert result["id"] == "run"
        assert result["workflow_id"] == "wf-1"
        assert result["status"] == "succeeded"


class TestWorkflowRunApi:
    def test_not_workflow_app(self, app: Flask) -> None:
        api = WorkflowRunApi()
        handler = unwrap(api.post)
        app_model = _make_app_model(mode=AppMode.CHAT)
        end_user = _make_end_user()

        with app.test_request_context("/workflows/run", method="POST", json={"inputs": {}}):
            with pytest.raises(NotWorkflowAppError):
                handler(api, session=Mock(), app_model=app_model, end_user=end_user)

    def test_rate_limit(self, app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            AppGenerateService,
            "generate",
            lambda *_args, **_kwargs: (_ for _ in ()).throw(InvokeRateLimitError("slow")),
        )

        api = WorkflowRunApi()
        handler = unwrap(api.post)
        app_model = _make_app_model()
        end_user = _make_end_user()

        with app.test_request_context("/workflows/run", method="POST", json={"inputs": {}}):
            with pytest.raises(InvokeRateLimitHttpError):
                handler(api, session=Mock(), app_model=app_model, end_user=end_user)


class TestWorkflowRunByIdApi:
    def test_not_found(self, app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            AppGenerateService,
            "generate",
            lambda *_args, **_kwargs: (_ for _ in ()).throw(WorkflowNotFoundError("missing")),
        )

        api = WorkflowRunByIdApi()
        handler = unwrap(api.post)
        app_model = _make_app_model()
        end_user = _make_end_user()

        with app.test_request_context("/workflows/1/run", method="POST", json={"inputs": {}}):
            with pytest.raises(NotFound):
                handler(api, session=Mock(), app_model=app_model, end_user=end_user, workflow_id="w1")

    def test_draft_workflow(self, app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            AppGenerateService,
            "generate",
            lambda *_args, **_kwargs: (_ for _ in ()).throw(IsDraftWorkflowError("draft")),
        )

        api = WorkflowRunByIdApi()
        handler = unwrap(api.post)
        app_model = _make_app_model()
        end_user = _make_end_user()

        with app.test_request_context("/workflows/1/run", method="POST", json={"inputs": {}}):
            with pytest.raises(BadRequest):
                handler(api, session=Mock(), app_model=app_model, end_user=end_user, workflow_id="w1")


class TestWorkflowTaskStopApi:
    def test_wrong_mode(self, app: Flask) -> None:
        api = WorkflowTaskStopApi()
        handler = unwrap(api.post)
        app_model = _make_app_model(mode=AppMode.CHAT)
        end_user = _make_end_user()

        with app.test_request_context("/workflows/tasks/1/stop", method="POST"):
            with pytest.raises(NotWorkflowAppError):
                handler(api, app_model=app_model, end_user=end_user, task_id="t1")

    def test_success(self, app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
        stop_mock = Mock()
        send_mock = Mock()
        monkeypatch.setattr(AppQueueManager, "set_stop_flag_no_user_check", stop_mock)
        monkeypatch.setattr(GraphEngineManager, "send_stop_command", send_mock)

        api = WorkflowTaskStopApi()
        handler = unwrap(api.post)
        app_model = _make_app_model()
        end_user = _make_end_user(user_id="u1")

        with app.test_request_context("/workflows/tasks/1/stop", method="POST"):
            response = handler(api, app_model=app_model, end_user=end_user, task_id="t1")

        assert response == {"result": "success"}
        stop_mock.assert_called_once_with("t1")
        send_mock.assert_called_once_with("t1")


class TestWorkflowAppLogApi:
    def test_success(self, app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
        workflow_module = sys.modules["controllers.service_api.app.workflow"]
        workflow_model_module = sys.modules["models.workflow"]
        monkeypatch.setattr(workflow_module, "db", _DbStub())
        monkeypatch.setattr(workflow_model_module, "db", _DbStub())
        monkeypatch.setattr(workflow_module, "sessionmaker", _SessionMakerStub)
        monkeypatch.setattr(
            WorkflowAppService,
            "get_paginate_workflow_app_logs",
            lambda *_args, **_kwargs: _make_workflow_log_page(),
        )
        monkeypatch.setattr(
            DifyAPIRepositoryFactory,
            "create_api_workflow_run_repository",
            lambda *_args, **_kwargs: _WorkflowRunRepositoryStub(
                run=_make_workflow_run(
                    run_id="log-run-1",
                    created_at=datetime(2026, 1, 1, 1, tzinfo=UTC),
                    finished_at=datetime(2026, 1, 1, 1, 0, 2, tzinfo=UTC),
                )
            ),
        )

        api = WorkflowAppLogApi()
        handler = unwrap(api.get)
        app_model = _make_app_model(app_id="a1")

        with app.test_request_context("/workflows/logs", method="GET"):
            response = handler(api, app_model=app_model)

        assert response == _expected_workflow_log_pagination_payload()


# =============================================================================
# API Endpoint Tests
#
# ``WorkflowRunDetailApi``, ``WorkflowTaskStopApi``, and
# ``WorkflowAppLogApi`` use ``@validate_app_token`` which preserves
# ``__wrapped__`` via ``functools.wraps``.  We call the unwrapped method
# directly to bypass the decorator.
# =============================================================================


@pytest.fixture
def workflow_app() -> App:
    return _make_app_model(app_id=str(uuid.uuid4()), tenant_id=str(uuid.uuid4()))


class TestWorkflowRunDetailApiGet:
    """Test suite for WorkflowRunDetailApi.get() endpoint.

    ``get`` is wrapped by ``@validate_app_token`` (preserves ``__wrapped__``),
    and we call the unwrapped method directly in tests.
    """

    @patch("controllers.service_api.app.workflow.DifyAPIRepositoryFactory")
    @patch("controllers.service_api.app.workflow.db")
    def test_get_workflow_run_success(
        self,
        mock_db,
        mock_repo_factory,
        app: Flask,
        workflow_app: App,
    ):
        """Test successful workflow run detail retrieval."""
        run = _make_workflow_run(run_id="run-1")
        mock_repo_factory.create_api_workflow_run_repository.return_value = _WorkflowRunRepositoryStub(run=run)

        from controllers.service_api.app.workflow import WorkflowRunDetailApi

        with app.test_request_context(
            f"/workflows/run/{run.id}",
            method="GET",
        ):
            api = WorkflowRunDetailApi()
            result = unwrap(api.get)(api, app_model=workflow_app, workflow_run_id=run.id)

        assert result == {
            "id": "run-1",
            "workflow_id": "wf-1",
            "status": "succeeded",
            "inputs": '{"input": "value"}',
            "outputs": {"output": "value"},
            "error": None,
            "total_steps": 1,
            "total_tokens": 10,
            "created_at": 1767225600,
            "finished_at": 1767225600,
            "elapsed_time": 0.1,
        }

    @patch("controllers.service_api.app.workflow.db")
    def test_get_workflow_run_wrong_app_mode(self, mock_db, app: Flask):
        """Test NotWorkflowAppError when app mode is not workflow or advanced_chat."""
        from controllers.service_api.app.workflow import WorkflowRunDetailApi

        app_model = _make_app_model(mode=AppMode.CHAT)

        with app.test_request_context("/workflows/run/run-1", method="GET"):
            api = WorkflowRunDetailApi()
            with pytest.raises(NotWorkflowAppError):
                unwrap(api.get)(api, app_model=app_model, workflow_run_id="run-1")


class TestWorkflowTaskStopApiPost:
    """Test suite for WorkflowTaskStopApi.post() endpoint.

    ``post`` is wrapped by ``@validate_app_token(fetch_user_arg=...)``.
    """

    @patch("controllers.service_api.app.workflow.GraphEngineManager")
    @patch("controllers.service_api.app.workflow.AppQueueManager")
    def test_stop_workflow_task_success(
        self,
        mock_queue_mgr,
        mock_graph_mgr,
        app: Flask,
        workflow_app: App,
    ):
        """Test successful workflow task stop."""
        from controllers.service_api.app.workflow import WorkflowTaskStopApi

        with app.test_request_context("/workflows/tasks/task-1/stop", method="POST"):
            api = WorkflowTaskStopApi()
            result = unwrap(api.post)(
                api,
                app_model=workflow_app,
                end_user=_make_end_user(),
                task_id="task-1",
            )

        assert result == {"result": "success"}
        mock_queue_mgr.set_stop_flag_no_user_check.assert_called_once_with("task-1")
        mock_graph_mgr.assert_called_once()
        mock_graph_mgr.return_value.send_stop_command.assert_called_once_with("task-1")

    def test_stop_workflow_task_wrong_app_mode(self, app: Flask):
        """Test NotWorkflowAppError when app mode is not workflow."""
        from controllers.service_api.app.workflow import WorkflowTaskStopApi

        app_model = _make_app_model(mode=AppMode.COMPLETION)

        with app.test_request_context("/workflows/tasks/task-1/stop", method="POST"):
            api = WorkflowTaskStopApi()
            with pytest.raises(NotWorkflowAppError):
                unwrap(api.post)(api, app_model=app_model, end_user=_make_end_user(), task_id="task-1")


class TestWorkflowAppLogApiGet:
    """Test suite for WorkflowAppLogApi.get() endpoint.

    ``get`` is wrapped by ``@validate_app_token``.
    """

    @patch("controllers.service_api.app.workflow.WorkflowAppService")
    @patch("controllers.service_api.app.workflow.db")
    def test_get_workflow_logs_success(
        self,
        mock_db,
        mock_wf_svc_cls,
        app: Flask,
        workflow_app: App,
    ):
        """Test successful workflow log retrieval."""
        mock_svc_instance = Mock()
        mock_svc_instance.get_paginate_workflow_app_logs.return_value = _make_workflow_log_page()
        mock_wf_svc_cls.return_value = mock_svc_instance
        mock_repo = _WorkflowRunRepositoryStub(
            run=_make_workflow_run(
                run_id="log-run-1",
                created_at=datetime(2026, 1, 1, 1, tzinfo=UTC),
                finished_at=datetime(2026, 1, 1, 1, 0, 2, tzinfo=UTC),
            )
        )

        # Mock sessionmaker(...).begin() context manager
        mock_db.engine = object()
        mock_db.session.get.return_value = None

        from controllers.service_api.app.workflow import WorkflowAppLogApi

        with app.test_request_context(
            "/workflows/logs?page=1&limit=20",
            method="GET",
        ):
            with (
                patch("controllers.service_api.app.workflow.sessionmaker", _SessionMakerStub),
                patch("models.workflow.db", _DbStub()),
                patch(
                    "repositories.factory.DifyAPIRepositoryFactory.create_api_workflow_run_repository",
                    return_value=mock_repo,
                ),
            ):
                api = WorkflowAppLogApi()
                result = unwrap(api.get)(api, app_model=workflow_app)

        assert result == _expected_workflow_log_pagination_payload()
