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

import sys
import uuid
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest
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
    WorkflowTaskStopApi,
)
from controllers.web.error import InvokeRateLimitError as InvokeRateLimitHttpError
from core.workflow.enums import WorkflowExecutionStatus
from models.model import App, AppMode
from services.app_generate_service import AppGenerateService
from services.errors.app import IsDraftWorkflowError, WorkflowNotFoundError
from services.errors.llm import InvokeRateLimitError
from services.workflow_app_service import WorkflowAppService


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

    def test_query_rejects_page_below_minimum(self):
        """Test query rejects page < 1."""
        with pytest.raises(ValueError):
            WorkflowLogQuery(page=0)

    def test_query_rejects_page_above_maximum(self):
        """Test query rejects page > 99999."""
        with pytest.raises(ValueError):
            WorkflowLogQuery(page=100000)

    def test_query_rejects_limit_below_minimum(self):
        """Test query rejects limit < 1."""
        with pytest.raises(ValueError):
            WorkflowLogQuery(limit=0)

    def test_query_rejects_limit_above_maximum(self):
        """Test query rejects limit > 100."""
        with pytest.raises(ValueError):
            WorkflowLogQuery(limit=101)

    def test_query_with_keyword_search(self):
        """Test query with keyword filter."""
        query = WorkflowLogQuery(keyword="workflow execution")
        assert query.keyword == "workflow execution"

    def test_query_with_date_filters(self):
        """Test query with before/after date filters."""
        query = WorkflowLogQuery(created_at__before="2024-12-31T23:59:59Z", created_at__after="2024-01-01T00:00:00Z")
        assert query.created_at__before == "2024-12-31T23:59:59Z"
        assert query.created_at__after == "2024-01-01T00:00:00Z"


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
        mock_pagination = Mock()
        mock_pagination.data = []
        mock_pagination.page = 1
        mock_pagination.limit = 20
        mock_pagination.total = 0
        mock_get_logs.return_value = mock_pagination

        service = WorkflowAppService()
        result = service.get_paginate_workflow_app_logs(
            session=Mock(),
            app_model=Mock(spec=App),
            keyword=None,
            status=None,
            created_at_before=None,
            created_at_after=None,
            page=1,
            limit=20,
            created_by_end_user_session_id=None,
            created_by_account=None,
        )

        assert result.page == 1
        assert result.limit == 20


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
    def test_generate_accepts_workflow_args(self, mock_generate):
        """Test generate accepts workflow-specific args."""
        mock_generate.return_value = {"result": "success"}

        result = AppGenerateService.generate(
            app_model=Mock(spec=App),
            user=Mock(),
            args={"inputs": {"key": "value"}, "workflow_id": "workflow_123"},
            invoke_from=Mock(),
            streaming=False,
        )

        assert result == {"result": "success"}
        mock_generate.assert_called_once()

    @patch.object(AppGenerateService, "generate")
    def test_generate_raises_workflow_not_found_error(self, mock_generate):
        """Test generate raises WorkflowNotFoundError."""
        mock_generate.side_effect = WorkflowNotFoundError("Workflow not found")

        with pytest.raises(WorkflowNotFoundError):
            AppGenerateService.generate(
                app_model=Mock(spec=App),
                user=Mock(),
                args={"workflow_id": "invalid_id"},
                invoke_from=Mock(),
                streaming=False,
            )

    @patch.object(AppGenerateService, "generate")
    def test_generate_raises_is_draft_workflow_error(self, mock_generate):
        """Test generate raises IsDraftWorkflowError."""
        mock_generate.side_effect = IsDraftWorkflowError("Workflow is draft")

        with pytest.raises(IsDraftWorkflowError):
            AppGenerateService.generate(
                app_model=Mock(spec=App),
                user=Mock(),
                args={"workflow_id": "draft_workflow"},
                invoke_from=Mock(),
                streaming=False,
            )

    @patch.object(AppGenerateService, "generate")
    def test_generate_supports_streaming_mode(self, mock_generate):
        """Test generate supports streaming response mode."""
        mock_stream = Mock()
        mock_generate.return_value = mock_stream

        result = AppGenerateService.generate(
            app_model=Mock(spec=App),
            user=Mock(),
            args={"inputs": {}, "response_mode": "streaming"},
            invoke_from=Mock(),
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
        from core.workflow.graph_engine.manager import GraphEngineManager

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
        mock_repo = Mock()
        mock_run = Mock()
        mock_run.id = str(uuid.uuid4())
        mock_run.status = "succeeded"
        mock_repo.get_workflow_run_by_id.return_value = mock_run
        mock_factory.return_value = mock_repo

        from repositories.factory import DifyAPIRepositoryFactory

        repo = DifyAPIRepositoryFactory.create_api_workflow_run_repository(Mock())

        result = repo.get_workflow_run_by_id(tenant_id="tenant_123", app_id="app_456", run_id="run_789")

        assert result.status == "succeeded"


class TestWorkflowRunDetailApi:
    def test_not_workflow_app(self, app) -> None:
        api = WorkflowRunDetailApi()
        handler = _unwrap(api.get)
        app_model = SimpleNamespace(mode=AppMode.CHAT.value)

        with app.test_request_context("/workflows/run/1", method="GET"):
            with pytest.raises(NotWorkflowAppError):
                handler(api, app_model=app_model, workflow_run_id="run")

    def test_success(self, monkeypatch: pytest.MonkeyPatch) -> None:
        run = SimpleNamespace(id="run")
        repo = SimpleNamespace(get_workflow_run_by_id=lambda **_kwargs: run)
        workflow_module = sys.modules["controllers.service_api.app.workflow"]
        monkeypatch.setattr(workflow_module, "db", SimpleNamespace(engine=object()))
        monkeypatch.setattr(
            DifyAPIRepositoryFactory,
            "create_api_workflow_run_repository",
            lambda *_args, **_kwargs: repo,
        )

        api = WorkflowRunDetailApi()
        handler = _unwrap(api.get)
        app_model = SimpleNamespace(mode=AppMode.WORKFLOW.value, tenant_id="t1", id="a1")

        assert handler(api, app_model=app_model, workflow_run_id="run") == run


class TestWorkflowRunApi:
    def test_not_workflow_app(self, app) -> None:
        api = WorkflowRunApi()
        handler = _unwrap(api.post)
        app_model = SimpleNamespace(mode=AppMode.CHAT.value)
        end_user = SimpleNamespace()

        with app.test_request_context("/workflows/run", method="POST", json={"inputs": {}}):
            with pytest.raises(NotWorkflowAppError):
                handler(api, app_model=app_model, end_user=end_user)

    def test_rate_limit(self, app, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            AppGenerateService,
            "generate",
            lambda *_args, **_kwargs: (_ for _ in ()).throw(InvokeRateLimitError("slow")),
        )

        api = WorkflowRunApi()
        handler = _unwrap(api.post)
        app_model = SimpleNamespace(mode=AppMode.WORKFLOW.value)
        end_user = SimpleNamespace()

        with app.test_request_context("/workflows/run", method="POST", json={"inputs": {}}):
            with pytest.raises(InvokeRateLimitHttpError):
                handler(api, app_model=app_model, end_user=end_user)


class TestWorkflowRunByIdApi:
    def test_not_found(self, app, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            AppGenerateService,
            "generate",
            lambda *_args, **_kwargs: (_ for _ in ()).throw(WorkflowNotFoundError("missing")),
        )

        api = WorkflowRunByIdApi()
        handler = _unwrap(api.post)
        app_model = SimpleNamespace(mode=AppMode.WORKFLOW.value)
        end_user = SimpleNamespace()

        with app.test_request_context("/workflows/1/run", method="POST", json={"inputs": {}}):
            with pytest.raises(NotFound):
                handler(api, app_model=app_model, end_user=end_user, workflow_id="w1")

    def test_draft_workflow(self, app, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            AppGenerateService,
            "generate",
            lambda *_args, **_kwargs: (_ for _ in ()).throw(IsDraftWorkflowError("draft")),
        )

        api = WorkflowRunByIdApi()
        handler = _unwrap(api.post)
        app_model = SimpleNamespace(mode=AppMode.WORKFLOW.value)
        end_user = SimpleNamespace()

        with app.test_request_context("/workflows/1/run", method="POST", json={"inputs": {}}):
            with pytest.raises(BadRequest):
                handler(api, app_model=app_model, end_user=end_user, workflow_id="w1")


class TestWorkflowTaskStopApi:
    def test_wrong_mode(self, app) -> None:
        api = WorkflowTaskStopApi()
        handler = _unwrap(api.post)
        app_model = SimpleNamespace(mode=AppMode.CHAT.value)
        end_user = SimpleNamespace()

        with app.test_request_context("/workflows/tasks/1/stop", method="POST"):
            with pytest.raises(NotWorkflowAppError):
                handler(api, app_model=app_model, end_user=end_user, task_id="t1")

    def test_success(self, app, monkeypatch: pytest.MonkeyPatch) -> None:
        stop_mock = Mock()
        send_mock = Mock()
        monkeypatch.setattr(AppQueueManager, "set_stop_flag_no_user_check", stop_mock)
        monkeypatch.setattr(GraphEngineManager, "send_stop_command", send_mock)

        api = WorkflowTaskStopApi()
        handler = _unwrap(api.post)
        app_model = SimpleNamespace(mode=AppMode.WORKFLOW.value)
        end_user = SimpleNamespace(id="u1")

        with app.test_request_context("/workflows/tasks/1/stop", method="POST"):
            response = handler(api, app_model=app_model, end_user=end_user, task_id="t1")

        assert response == {"result": "success"}
        stop_mock.assert_called_once_with("t1")
        send_mock.assert_called_once_with("t1")


class TestWorkflowAppLogApi:
    def test_success(self, app, monkeypatch: pytest.MonkeyPatch) -> None:
        class _SessionStub:
            def __enter__(self):
                return SimpleNamespace()

            def __exit__(self, exc_type, exc, tb):
                return False

        workflow_module = sys.modules["controllers.service_api.app.workflow"]
        monkeypatch.setattr(workflow_module, "db", SimpleNamespace(engine=object()))
        monkeypatch.setattr(workflow_module, "Session", lambda *_args, **_kwargs: _SessionStub())
        monkeypatch.setattr(
            WorkflowAppService,
            "get_paginate_workflow_app_logs",
            lambda *_args, **_kwargs: {"items": [], "total": 0},
        )

        api = WorkflowAppLogApi()
        handler = _unwrap(api.get)
        app_model = SimpleNamespace(id="a1")

        with app.test_request_context("/workflows/logs", method="GET"):
            response = handler(api, app_model=app_model)

        assert response == {"items": [], "total": 0}


# =============================================================================
# API Endpoint Tests
#
# ``WorkflowRunDetailApi``, ``WorkflowTaskStopApi``, and
# ``WorkflowAppLogApi`` use ``@validate_app_token`` which preserves
# ``__wrapped__`` via ``functools.wraps``.  We call the unwrapped method
# directly to bypass the decorator.
# =============================================================================

from tests.unit_tests.controllers.service_api.conftest import _unwrap


@pytest.fixture
def mock_workflow_app():
    app = Mock(spec=App)
    app.id = str(uuid.uuid4())
    app.tenant_id = str(uuid.uuid4())
    app.mode = AppMode.WORKFLOW.value
    return app


class TestWorkflowRunDetailApiGet:
    """Test suite for WorkflowRunDetailApi.get() endpoint.

    ``get`` is wrapped by ``@validate_app_token`` (preserves ``__wrapped__``)
    and ``@service_api_ns.marshal_with``.  We call the unwrapped method
    directly; ``marshal_with`` is a no-op when calling directly.
    """

    @patch("controllers.service_api.app.workflow.DifyAPIRepositoryFactory")
    @patch("controllers.service_api.app.workflow.db")
    def test_get_workflow_run_success(
        self,
        mock_db,
        mock_repo_factory,
        app,
        mock_workflow_app,
    ):
        """Test successful workflow run detail retrieval."""
        mock_run = Mock()
        mock_run.id = "run-1"
        mock_run.status = "succeeded"
        mock_repo = Mock()
        mock_repo.get_workflow_run_by_id.return_value = mock_run
        mock_repo_factory.create_api_workflow_run_repository.return_value = mock_repo

        from controllers.service_api.app.workflow import WorkflowRunDetailApi

        with app.test_request_context(
            f"/workflows/run/{mock_run.id}",
            method="GET",
        ):
            api = WorkflowRunDetailApi()
            result = _unwrap(api.get)(api, app_model=mock_workflow_app, workflow_run_id=mock_run.id)

        assert result == mock_run

    @patch("controllers.service_api.app.workflow.db")
    def test_get_workflow_run_wrong_app_mode(self, mock_db, app):
        """Test NotWorkflowAppError when app mode is not workflow or advanced_chat."""
        from controllers.service_api.app.workflow import WorkflowRunDetailApi

        mock_app = Mock(spec=App)
        mock_app.mode = AppMode.CHAT.value

        with app.test_request_context("/workflows/run/run-1", method="GET"):
            api = WorkflowRunDetailApi()
            with pytest.raises(NotWorkflowAppError):
                _unwrap(api.get)(api, app_model=mock_app, workflow_run_id="run-1")


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
        app,
        mock_workflow_app,
    ):
        """Test successful workflow task stop."""
        from controllers.service_api.app.workflow import WorkflowTaskStopApi

        with app.test_request_context("/workflows/tasks/task-1/stop", method="POST"):
            api = WorkflowTaskStopApi()
            result = _unwrap(api.post)(
                api,
                app_model=mock_workflow_app,
                end_user=Mock(),
                task_id="task-1",
            )

        assert result == {"result": "success"}
        mock_queue_mgr.set_stop_flag_no_user_check.assert_called_once_with("task-1")
        mock_graph_mgr.assert_called_once()
        mock_graph_mgr.return_value.send_stop_command.assert_called_once_with("task-1")

    def test_stop_workflow_task_wrong_app_mode(self, app):
        """Test NotWorkflowAppError when app mode is not workflow."""
        from controllers.service_api.app.workflow import WorkflowTaskStopApi

        mock_app = Mock(spec=App)
        mock_app.mode = AppMode.COMPLETION.value

        with app.test_request_context("/workflows/tasks/task-1/stop", method="POST"):
            api = WorkflowTaskStopApi()
            with pytest.raises(NotWorkflowAppError):
                _unwrap(api.post)(api, app_model=mock_app, end_user=Mock(), task_id="task-1")


class TestWorkflowAppLogApiGet:
    """Test suite for WorkflowAppLogApi.get() endpoint.

    ``get`` is wrapped by ``@validate_app_token`` and
    ``@service_api_ns.marshal_with``.
    """

    @patch("controllers.service_api.app.workflow.WorkflowAppService")
    @patch("controllers.service_api.app.workflow.db")
    def test_get_workflow_logs_success(
        self,
        mock_db,
        mock_wf_svc_cls,
        app,
        mock_workflow_app,
    ):
        """Test successful workflow log retrieval."""
        mock_pagination = Mock()
        mock_pagination.data = []
        mock_svc_instance = Mock()
        mock_svc_instance.get_paginate_workflow_app_logs.return_value = mock_pagination
        mock_wf_svc_cls.return_value = mock_svc_instance

        # Mock Session context manager
        mock_session = Mock()
        mock_db.engine = Mock()
        mock_session.__enter__ = Mock(return_value=mock_session)
        mock_session.__exit__ = Mock(return_value=False)

        from controllers.service_api.app.workflow import WorkflowAppLogApi

        with app.test_request_context(
            "/workflows/logs?page=1&limit=20",
            method="GET",
        ):
            with patch("controllers.service_api.app.workflow.Session", return_value=mock_session):
                api = WorkflowAppLogApi()
                result = _unwrap(api.get)(api, app_model=mock_workflow_app)

        assert result == mock_pagination
