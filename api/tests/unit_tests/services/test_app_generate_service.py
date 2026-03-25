"""
Comprehensive unit tests for services.app_generate_service.AppGenerateService.

Covers:
  - _build_streaming_task_on_subscribe  (streams / pubsub / exception / idempotency)
  - generate                           (COMPLETION / AGENT_CHAT / CHAT / ADVANCED_CHAT / WORKFLOW / invalid mode,
                                         streaming & blocking, billing, quota-refund-on-error, rate_limit.exit)
  - _get_max_active_requests            (all limit combos)
  - generate_single_iteration           (ADVANCED_CHAT / WORKFLOW / invalid mode)
  - generate_single_loop                (ADVANCED_CHAT / WORKFLOW / invalid mode)
  - generate_more_like_this
  - _get_workflow                       (debugger / non-debugger / specific id / invalid format / not found)
  - get_response_generator              (ended / non-ended workflow run)
"""

import threading
import time
import uuid
from contextlib import contextmanager
from unittest.mock import MagicMock

import pytest

import services.app_generate_service as ags_module
from core.app.entities.app_invoke_entities import InvokeFrom
from models.model import AppMode
from services.app_generate_service import AppGenerateService
from services.errors.app import WorkflowIdFormatError, WorkflowNotFoundError


# ---------------------------------------------------------------------------
# Helpers / Fakes
# ---------------------------------------------------------------------------
class _DummyRateLimit:
    """Minimal stand-in for RateLimit that never touches Redis."""

    _instance_dict: dict[str, "_DummyRateLimit"] = {}

    def __new__(cls, client_id: str, max_active_requests: int):
        # avoid singleton caching across tests
        instance = object.__new__(cls)
        return instance

    def __init__(self, client_id: str, max_active_requests: int) -> None:
        self.client_id = client_id
        self.max_active_requests = max_active_requests
        self._exited: list[str] = []

    @staticmethod
    def gen_request_key() -> str:
        return "dummy-request-id"

    def enter(self, request_id: str | None = None) -> str:
        return request_id or "dummy-request-id"

    def exit(self, request_id: str) -> None:
        self._exited.append(request_id)

    def generate(self, generator, request_id: str):
        return generator


def _make_app(mode: AppMode | str, *, max_active_requests: int = 0, is_agent: bool = False) -> MagicMock:
    app = MagicMock()
    app.mode = mode
    app.id = "app-id"
    app.tenant_id = "tenant-id"
    app.max_active_requests = max_active_requests
    app.is_agent = is_agent
    return app


def _make_user() -> MagicMock:
    user = MagicMock()
    user.id = "user-id"
    return user


def _make_workflow(*, workflow_id: str = "workflow-id", created_by: str = "owner-id") -> MagicMock:
    workflow = MagicMock()
    workflow.id = workflow_id
    workflow.created_by = created_by
    return workflow


@contextmanager
def _noop_rate_limit_context(rate_limit, request_id):
    """Drop-in replacement for rate_limit_context that doesn't touch Redis."""
    yield


# ---------------------------------------------------------------------------
# _build_streaming_task_on_subscribe
# ---------------------------------------------------------------------------
class TestBuildStreamingTaskOnSubscribe:
    """Tests for AppGenerateService._build_streaming_task_on_subscribe."""

    def test_streams_mode_starts_immediately(self, monkeypatch):
        monkeypatch.setattr(ags_module.dify_config, "PUBSUB_REDIS_CHANNEL_TYPE", "streams")
        called = []
        cb = AppGenerateService._build_streaming_task_on_subscribe(lambda: called.append(1))
        # task started immediately during build
        assert called == [1]
        # calling the returned callback is idempotent
        cb()
        assert called == [1]  # not called again

    def test_pubsub_mode_starts_on_subscribe(self, monkeypatch):
        monkeypatch.setattr(ags_module.dify_config, "PUBSUB_REDIS_CHANNEL_TYPE", "pubsub")
        monkeypatch.setattr(ags_module, "SSE_TASK_START_FALLBACK_MS", 60_000)  # large to prevent timer
        called = []
        cb = AppGenerateService._build_streaming_task_on_subscribe(lambda: called.append(1))
        assert called == []
        cb()
        assert called == [1]
        # second call is idempotent
        cb()
        assert called == [1]

    def test_sharded_mode_starts_on_subscribe(self, monkeypatch):
        """sharded is treated like pubsub (i.e. not 'streams')."""
        monkeypatch.setattr(ags_module.dify_config, "PUBSUB_REDIS_CHANNEL_TYPE", "sharded")
        monkeypatch.setattr(ags_module, "SSE_TASK_START_FALLBACK_MS", 60_000)
        called = []
        cb = AppGenerateService._build_streaming_task_on_subscribe(lambda: called.append(1))
        assert called == []
        cb()
        assert called == [1]

    def test_pubsub_fallback_timer_fires(self, monkeypatch):
        """When nobody subscribes fast enough the fallback timer fires."""
        monkeypatch.setattr(ags_module.dify_config, "PUBSUB_REDIS_CHANNEL_TYPE", "pubsub")
        monkeypatch.setattr(ags_module, "SSE_TASK_START_FALLBACK_MS", 50)  # 50 ms
        called = []
        _cb = AppGenerateService._build_streaming_task_on_subscribe(lambda: called.append(1))
        time.sleep(0.2)  # give the timer time to fire
        assert called == [1]

    def test_exception_in_start_task_returns_false(self, monkeypatch):
        """When start_task raises, _try_start returns False and next call retries."""
        monkeypatch.setattr(ags_module.dify_config, "PUBSUB_REDIS_CHANNEL_TYPE", "streams")
        call_count = 0

        def _bad():
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise RuntimeError("boom")

        cb = AppGenerateService._build_streaming_task_on_subscribe(_bad)
        # first call inside build raised, but is caught; second call via cb succeeds
        assert call_count == 1
        cb()
        assert call_count == 2

    def test_concurrent_subscribe_only_starts_once(self, monkeypatch):
        monkeypatch.setattr(ags_module.dify_config, "PUBSUB_REDIS_CHANNEL_TYPE", "pubsub")
        monkeypatch.setattr(ags_module, "SSE_TASK_START_FALLBACK_MS", 60_000)
        call_count = 0

        def _inc():
            nonlocal call_count
            call_count += 1

        cb = AppGenerateService._build_streaming_task_on_subscribe(_inc)
        threads = [threading.Thread(target=cb) for _ in range(10)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        assert call_count == 1


# ---------------------------------------------------------------------------
# _get_max_active_requests
# ---------------------------------------------------------------------------
class TestGetMaxActiveRequests:
    def test_both_zero_returns_zero(self, monkeypatch):
        monkeypatch.setattr(ags_module.dify_config, "APP_MAX_ACTIVE_REQUESTS", 0)
        monkeypatch.setattr(ags_module.dify_config, "APP_DEFAULT_ACTIVE_REQUESTS", 0)
        app = _make_app(AppMode.CHAT, max_active_requests=0)
        assert AppGenerateService._get_max_active_requests(app) == 0

    def test_app_limit_only(self, monkeypatch):
        monkeypatch.setattr(ags_module.dify_config, "APP_MAX_ACTIVE_REQUESTS", 0)
        monkeypatch.setattr(ags_module.dify_config, "APP_DEFAULT_ACTIVE_REQUESTS", 0)
        app = _make_app(AppMode.CHAT, max_active_requests=5)
        assert AppGenerateService._get_max_active_requests(app) == 5

    def test_config_limit_only(self, monkeypatch):
        monkeypatch.setattr(ags_module.dify_config, "APP_MAX_ACTIVE_REQUESTS", 10)
        monkeypatch.setattr(ags_module.dify_config, "APP_DEFAULT_ACTIVE_REQUESTS", 0)
        app = _make_app(AppMode.CHAT, max_active_requests=0)
        assert AppGenerateService._get_max_active_requests(app) == 10

    def test_both_non_zero_returns_min(self, monkeypatch):
        monkeypatch.setattr(ags_module.dify_config, "APP_MAX_ACTIVE_REQUESTS", 20)
        monkeypatch.setattr(ags_module.dify_config, "APP_DEFAULT_ACTIVE_REQUESTS", 0)
        app = _make_app(AppMode.CHAT, max_active_requests=5)
        assert AppGenerateService._get_max_active_requests(app) == 5

    def test_default_active_requests_used_when_app_has_none(self, monkeypatch):
        monkeypatch.setattr(ags_module.dify_config, "APP_MAX_ACTIVE_REQUESTS", 0)
        monkeypatch.setattr(ags_module.dify_config, "APP_DEFAULT_ACTIVE_REQUESTS", 15)
        app = _make_app(AppMode.CHAT, max_active_requests=0)
        assert AppGenerateService._get_max_active_requests(app) == 15


# ---------------------------------------------------------------------------
# generate – every AppMode branch
# ---------------------------------------------------------------------------
class TestGenerate:
    """Tests for AppGenerateService.generate covering each mode."""

    @pytest.fixture(autouse=True)
    def _common(self, mocker, monkeypatch):
        monkeypatch.setattr(ags_module.dify_config, "BILLING_ENABLED", False)
        mocker.patch("services.app_generate_service.RateLimit", _DummyRateLimit)
        # Prevent AppExecutionParams.new from touching real models via isinstance
        mocker.patch(
            "services.app_generate_service.rate_limit_context",
            _noop_rate_limit_context,
        )

    # -- COMPLETION ---------------------------------------------------------
    def test_completion_mode(self, mocker):
        gen_spy = mocker.patch(
            "services.app_generate_service.CompletionAppGenerator.generate",
            return_value={"result": "ok"},
        )
        mocker.patch(
            "services.app_generate_service.CompletionAppGenerator.convert_to_event_stream",
            side_effect=lambda x: x,
        )
        result = AppGenerateService.generate(
            app_model=_make_app(AppMode.COMPLETION),
            user=_make_user(),
            args={"inputs": {}},
            invoke_from=InvokeFrom.SERVICE_API,
            streaming=False,
        )
        assert result == {"result": "ok"}
        gen_spy.assert_called_once()

    # -- AGENT_CHAT via mode ------------------------------------------------
    def test_agent_chat_mode(self, mocker):
        gen_spy = mocker.patch(
            "services.app_generate_service.AgentChatAppGenerator.generate",
            return_value={"result": "agent"},
        )
        mocker.patch(
            "services.app_generate_service.AgentChatAppGenerator.convert_to_event_stream",
            side_effect=lambda x: x,
        )
        result = AppGenerateService.generate(
            app_model=_make_app(AppMode.AGENT_CHAT),
            user=_make_user(),
            args={"inputs": {}},
            invoke_from=InvokeFrom.SERVICE_API,
            streaming=False,
        )
        assert result == {"result": "agent"}
        gen_spy.assert_called_once()

    # -- AGENT_CHAT via is_agent flag (non-AGENT_CHAT mode) -----------------
    def test_agent_via_is_agent_flag(self, mocker):
        gen_spy = mocker.patch(
            "services.app_generate_service.AgentChatAppGenerator.generate",
            return_value={"result": "agent-via-flag"},
        )
        mocker.patch(
            "services.app_generate_service.AgentChatAppGenerator.convert_to_event_stream",
            side_effect=lambda x: x,
        )
        app = _make_app(AppMode.CHAT, is_agent=True)
        result = AppGenerateService.generate(
            app_model=app,
            user=_make_user(),
            args={"inputs": {}},
            invoke_from=InvokeFrom.SERVICE_API,
            streaming=False,
        )
        assert result == {"result": "agent-via-flag"}
        gen_spy.assert_called_once()

    # -- CHAT ---------------------------------------------------------------
    def test_chat_mode(self, mocker):
        gen_spy = mocker.patch(
            "services.app_generate_service.ChatAppGenerator.generate",
            return_value={"result": "chat"},
        )
        mocker.patch(
            "services.app_generate_service.ChatAppGenerator.convert_to_event_stream",
            side_effect=lambda x: x,
        )
        app = _make_app(AppMode.CHAT, is_agent=False)
        result = AppGenerateService.generate(
            app_model=app,
            user=_make_user(),
            args={"inputs": {}},
            invoke_from=InvokeFrom.SERVICE_API,
            streaming=False,
        )
        assert result == {"result": "chat"}
        gen_spy.assert_called_once()

    # -- ADVANCED_CHAT blocking ---------------------------------------------
    def test_advanced_chat_blocking(self, mocker):
        workflow = _make_workflow()
        mocker.patch.object(AppGenerateService, "_get_workflow", return_value=workflow)

        retrieve_spy = mocker.patch("services.app_generate_service.AdvancedChatAppGenerator.retrieve_events")
        gen_spy = mocker.patch(
            "services.app_generate_service.AdvancedChatAppGenerator.generate",
            return_value={"result": "advanced-blocking"},
        )
        mocker.patch(
            "services.app_generate_service.AdvancedChatAppGenerator.convert_to_event_stream",
            side_effect=lambda x: x,
        )

        result = AppGenerateService.generate(
            app_model=_make_app(AppMode.ADVANCED_CHAT),
            user=_make_user(),
            args={"workflow_id": None, "query": "hi", "inputs": {}},
            invoke_from=InvokeFrom.SERVICE_API,
            streaming=False,
        )
        assert result == {"result": "advanced-blocking"}
        assert gen_spy.call_args.kwargs.get("streaming") is False
        retrieve_spy.assert_not_called()

    # -- ADVANCED_CHAT streaming --------------------------------------------
    def test_advanced_chat_streaming(self, mocker, monkeypatch):
        workflow = _make_workflow()
        mocker.patch.object(AppGenerateService, "_get_workflow", return_value=workflow)
        mocker.patch(
            "services.app_generate_service.AppExecutionParams.new",
            return_value=MagicMock(workflow_run_id="wfr-1", model_dump_json=MagicMock(return_value="{}")),
        )
        delay_spy = mocker.patch("services.app_generate_service.workflow_based_app_execution_task.delay")
        # Let _build_streaming_task_on_subscribe call the real on_subscribe
        # so the inner closure (line 165) actually executes.
        monkeypatch.setattr(ags_module.dify_config, "PUBSUB_REDIS_CHANNEL_TYPE", "streams")
        gen_instance = MagicMock()
        gen_instance.retrieve_events.return_value = iter([])
        gen_instance.convert_to_event_stream.side_effect = lambda x: x
        mocker.patch(
            "services.app_generate_service.AdvancedChatAppGenerator",
            return_value=gen_instance,
        )

        result = AppGenerateService.generate(
            app_model=_make_app(AppMode.ADVANCED_CHAT),
            user=_make_user(),
            args={"workflow_id": None, "query": "hi", "inputs": {}},
            invoke_from=InvokeFrom.SERVICE_API,
            streaming=True,
        )
        # In streaming mode it should go through retrieve_events, not generate
        gen_instance.retrieve_events.assert_called_once()
        # The inner on_subscribe closure was invoked by _build_streaming_task_on_subscribe
        delay_spy.assert_called_once()

    # -- WORKFLOW blocking --------------------------------------------------
    def test_workflow_blocking(self, mocker):
        workflow = _make_workflow()
        mocker.patch.object(AppGenerateService, "_get_workflow", return_value=workflow)
        gen_spy = mocker.patch(
            "services.app_generate_service.WorkflowAppGenerator.generate",
            return_value={"result": "workflow-blocking"},
        )
        mocker.patch(
            "services.app_generate_service.WorkflowAppGenerator.convert_to_event_stream",
            side_effect=lambda x: x,
        )

        result = AppGenerateService.generate(
            app_model=_make_app(AppMode.WORKFLOW),
            user=_make_user(),
            args={"inputs": {}},
            invoke_from=InvokeFrom.SERVICE_API,
            streaming=False,
        )
        assert result == {"result": "workflow-blocking"}
        call_kwargs = gen_spy.call_args.kwargs
        assert call_kwargs.get("pause_state_config") is not None
        assert call_kwargs["pause_state_config"].state_owner_user_id == "owner-id"

    # -- WORKFLOW streaming -------------------------------------------------
    def test_workflow_streaming(self, mocker, monkeypatch):
        workflow = _make_workflow()
        mocker.patch.object(AppGenerateService, "_get_workflow", return_value=workflow)
        mocker.patch(
            "services.app_generate_service.AppExecutionParams.new",
            return_value=MagicMock(workflow_run_id="wfr-2", model_dump_json=MagicMock(return_value="{}")),
        )
        delay_spy = mocker.patch("services.app_generate_service.workflow_based_app_execution_task.delay")
        # Let _build_streaming_task_on_subscribe invoke the real on_subscribe
        # so the inner closure (line 216) actually executes.
        monkeypatch.setattr(ags_module.dify_config, "PUBSUB_REDIS_CHANNEL_TYPE", "streams")
        retrieve_spy = mocker.patch(
            "services.app_generate_service.MessageBasedAppGenerator.retrieve_events",
            return_value=iter([]),
        )
        mocker.patch(
            "services.app_generate_service.WorkflowAppGenerator.convert_to_event_stream",
            side_effect=lambda x: x,
        )

        result = AppGenerateService.generate(
            app_model=_make_app(AppMode.WORKFLOW),
            user=_make_user(),
            args={"inputs": {}},
            invoke_from=InvokeFrom.SERVICE_API,
            streaming=True,
        )
        retrieve_spy.assert_called_once()
        # The inner on_subscribe closure was invoked by _build_streaming_task_on_subscribe
        delay_spy.assert_called_once()

    # -- Invalid mode -------------------------------------------------------
    def test_invalid_mode_raises(self, mocker):
        app = _make_app("invalid-mode", is_agent=False)
        with pytest.raises(ValueError, match="Invalid app mode"):
            AppGenerateService.generate(
                app_model=app,
                user=_make_user(),
                args={},
                invoke_from=InvokeFrom.SERVICE_API,
                streaming=False,
            )


# ---------------------------------------------------------------------------
# generate – billing / quota
# ---------------------------------------------------------------------------
class TestGenerateBilling:
    @pytest.fixture(autouse=True)
    def _common(self, mocker, monkeypatch):
        mocker.patch("services.app_generate_service.RateLimit", _DummyRateLimit)
        mocker.patch(
            "services.app_generate_service.rate_limit_context",
            _noop_rate_limit_context,
        )

    def test_billing_enabled_consumes_quota(self, mocker, monkeypatch):
        monkeypatch.setattr(ags_module.dify_config, "BILLING_ENABLED", True)
        quota_charge = MagicMock()
        consume_mock = mocker.patch(
            "services.app_generate_service.QuotaType.WORKFLOW.consume",
            return_value=quota_charge,
        )
        mocker.patch(
            "services.app_generate_service.CompletionAppGenerator.generate",
            return_value={"ok": True},
        )
        mocker.patch(
            "services.app_generate_service.CompletionAppGenerator.convert_to_event_stream",
            side_effect=lambda x: x,
        )

        AppGenerateService.generate(
            app_model=_make_app(AppMode.COMPLETION),
            user=_make_user(),
            args={"inputs": {}},
            invoke_from=InvokeFrom.SERVICE_API,
            streaming=False,
        )
        consume_mock.assert_called_once_with("tenant-id")

    def test_billing_quota_exceeded_raises_rate_limit_error(self, mocker, monkeypatch):
        from services.errors.app import QuotaExceededError
        from services.errors.llm import InvokeRateLimitError

        monkeypatch.setattr(ags_module.dify_config, "BILLING_ENABLED", True)
        mocker.patch(
            "services.app_generate_service.QuotaType.WORKFLOW.consume",
            side_effect=QuotaExceededError(feature="workflow", tenant_id="t", required=1),
        )

        with pytest.raises(InvokeRateLimitError):
            AppGenerateService.generate(
                app_model=_make_app(AppMode.COMPLETION),
                user=_make_user(),
                args={"inputs": {}},
                invoke_from=InvokeFrom.SERVICE_API,
                streaming=False,
            )

    def test_exception_refunds_quota_and_exits_rate_limit(self, mocker, monkeypatch):
        monkeypatch.setattr(ags_module.dify_config, "BILLING_ENABLED", True)
        quota_charge = MagicMock()
        mocker.patch(
            "services.app_generate_service.QuotaType.WORKFLOW.consume",
            return_value=quota_charge,
        )
        mocker.patch(
            "services.app_generate_service.CompletionAppGenerator.generate",
            side_effect=RuntimeError("boom"),
        )
        mocker.patch(
            "services.app_generate_service.CompletionAppGenerator.convert_to_event_stream",
            side_effect=lambda x: x,
        )

        with pytest.raises(RuntimeError, match="boom"):
            AppGenerateService.generate(
                app_model=_make_app(AppMode.COMPLETION),
                user=_make_user(),
                args={"inputs": {}},
                invoke_from=InvokeFrom.SERVICE_API,
                streaming=False,
            )
        quota_charge.refund.assert_called_once()

    def test_rate_limit_exit_called_in_finally_for_blocking(self, mocker, monkeypatch):
        """For non-streaming (blocking) calls, rate_limit.exit should be called in finally."""
        monkeypatch.setattr(ags_module.dify_config, "BILLING_ENABLED", False)

        exit_calls: list[str] = []

        class _TrackingRateLimit(_DummyRateLimit):
            def exit(self, request_id: str) -> None:
                exit_calls.append(request_id)

        mocker.patch("services.app_generate_service.RateLimit", _TrackingRateLimit)
        mocker.patch(
            "services.app_generate_service.CompletionAppGenerator.generate",
            return_value={"ok": True},
        )
        mocker.patch(
            "services.app_generate_service.CompletionAppGenerator.convert_to_event_stream",
            side_effect=lambda x: x,
        )

        AppGenerateService.generate(
            app_model=_make_app(AppMode.COMPLETION),
            user=_make_user(),
            args={"inputs": {}},
            invoke_from=InvokeFrom.SERVICE_API,
            streaming=False,
        )
        # exit is called in finally block for non-streaming
        assert len(exit_calls) >= 1


# ---------------------------------------------------------------------------
# _get_workflow
# ---------------------------------------------------------------------------
class TestGetWorkflow:
    def test_debugger_fetches_draft(self, mocker):
        draft_wf = _make_workflow()
        ws = MagicMock()
        ws.get_draft_workflow.return_value = draft_wf
        mocker.patch("services.app_generate_service.WorkflowService", return_value=ws)

        result = AppGenerateService._get_workflow(_make_app(AppMode.WORKFLOW), InvokeFrom.DEBUGGER)
        assert result is draft_wf
        ws.get_draft_workflow.assert_called_once()

    def test_debugger_raises_when_no_draft(self, mocker):
        ws = MagicMock()
        ws.get_draft_workflow.return_value = None
        mocker.patch("services.app_generate_service.WorkflowService", return_value=ws)

        with pytest.raises(ValueError, match="Workflow not initialized"):
            AppGenerateService._get_workflow(_make_app(AppMode.WORKFLOW), InvokeFrom.DEBUGGER)

    def test_non_debugger_fetches_published(self, mocker):
        pub_wf = _make_workflow()
        ws = MagicMock()
        ws.get_published_workflow.return_value = pub_wf
        mocker.patch("services.app_generate_service.WorkflowService", return_value=ws)

        result = AppGenerateService._get_workflow(_make_app(AppMode.WORKFLOW), InvokeFrom.SERVICE_API)
        assert result is pub_wf
        ws.get_published_workflow.assert_called_once()

    def test_non_debugger_raises_when_no_published(self, mocker):
        ws = MagicMock()
        ws.get_published_workflow.return_value = None
        mocker.patch("services.app_generate_service.WorkflowService", return_value=ws)

        with pytest.raises(ValueError, match="Workflow not published"):
            AppGenerateService._get_workflow(_make_app(AppMode.WORKFLOW), InvokeFrom.SERVICE_API)

    def test_specific_workflow_id_valid_uuid(self, mocker):
        valid_uuid = str(uuid.uuid4())
        specific_wf = _make_workflow(workflow_id=valid_uuid)
        ws = MagicMock()
        ws.get_published_workflow_by_id.return_value = specific_wf
        mocker.patch("services.app_generate_service.WorkflowService", return_value=ws)

        result = AppGenerateService._get_workflow(
            _make_app(AppMode.WORKFLOW), InvokeFrom.SERVICE_API, workflow_id=valid_uuid
        )
        assert result is specific_wf
        ws.get_published_workflow_by_id.assert_called_once()

    def test_specific_workflow_id_invalid_uuid(self, mocker):
        ws = MagicMock()
        mocker.patch("services.app_generate_service.WorkflowService", return_value=ws)

        with pytest.raises(WorkflowIdFormatError):
            AppGenerateService._get_workflow(
                _make_app(AppMode.WORKFLOW), InvokeFrom.SERVICE_API, workflow_id="not-a-uuid"
            )

    def test_specific_workflow_id_not_found(self, mocker):
        valid_uuid = str(uuid.uuid4())
        ws = MagicMock()
        ws.get_published_workflow_by_id.return_value = None
        mocker.patch("services.app_generate_service.WorkflowService", return_value=ws)

        with pytest.raises(WorkflowNotFoundError):
            AppGenerateService._get_workflow(
                _make_app(AppMode.WORKFLOW), InvokeFrom.SERVICE_API, workflow_id=valid_uuid
            )


# ---------------------------------------------------------------------------
# generate_single_iteration
# ---------------------------------------------------------------------------
class TestGenerateSingleIteration:
    def test_advanced_chat_mode(self, mocker):
        workflow = _make_workflow()
        mocker.patch.object(AppGenerateService, "_get_workflow", return_value=workflow)
        gen_spy = mocker.patch(
            "services.app_generate_service.AdvancedChatAppGenerator.convert_to_event_stream",
            side_effect=lambda x: x,
        )
        iter_spy = mocker.patch(
            "services.app_generate_service.AdvancedChatAppGenerator.single_iteration_generate",
            return_value={"event": "iteration"},
        )
        app = _make_app(AppMode.ADVANCED_CHAT)
        result = AppGenerateService.generate_single_iteration(
            app_model=app, user=_make_user(), node_id="n1", args={"k": "v"}
        )
        iter_spy.assert_called_once()
        assert result == {"event": "iteration"}

    def test_workflow_mode(self, mocker):
        workflow = _make_workflow()
        mocker.patch.object(AppGenerateService, "_get_workflow", return_value=workflow)
        mocker.patch(
            "services.app_generate_service.AdvancedChatAppGenerator.convert_to_event_stream",
            side_effect=lambda x: x,
        )
        iter_spy = mocker.patch(
            "services.app_generate_service.WorkflowAppGenerator.single_iteration_generate",
            return_value={"event": "wf-iteration"},
        )
        app = _make_app(AppMode.WORKFLOW)
        result = AppGenerateService.generate_single_iteration(
            app_model=app, user=_make_user(), node_id="n1", args={"k": "v"}
        )
        iter_spy.assert_called_once()
        assert result == {"event": "wf-iteration"}

    def test_invalid_mode_raises(self, mocker):
        app = _make_app(AppMode.CHAT)
        with pytest.raises(ValueError, match="Invalid app mode"):
            AppGenerateService.generate_single_iteration(app_model=app, user=_make_user(), node_id="n1", args={})


# ---------------------------------------------------------------------------
# generate_single_loop
# ---------------------------------------------------------------------------
class TestGenerateSingleLoop:
    def test_advanced_chat_mode(self, mocker):
        workflow = _make_workflow()
        mocker.patch.object(AppGenerateService, "_get_workflow", return_value=workflow)
        mocker.patch(
            "services.app_generate_service.AdvancedChatAppGenerator.convert_to_event_stream",
            side_effect=lambda x: x,
        )
        loop_spy = mocker.patch(
            "services.app_generate_service.AdvancedChatAppGenerator.single_loop_generate",
            return_value={"event": "loop"},
        )
        app = _make_app(AppMode.ADVANCED_CHAT)
        result = AppGenerateService.generate_single_loop(
            app_model=app, user=_make_user(), node_id="n1", args=MagicMock()
        )
        loop_spy.assert_called_once()
        assert result == {"event": "loop"}

    def test_workflow_mode(self, mocker):
        workflow = _make_workflow()
        mocker.patch.object(AppGenerateService, "_get_workflow", return_value=workflow)
        mocker.patch(
            "services.app_generate_service.AdvancedChatAppGenerator.convert_to_event_stream",
            side_effect=lambda x: x,
        )
        loop_spy = mocker.patch(
            "services.app_generate_service.WorkflowAppGenerator.single_loop_generate",
            return_value={"event": "wf-loop"},
        )
        app = _make_app(AppMode.WORKFLOW)
        result = AppGenerateService.generate_single_loop(
            app_model=app, user=_make_user(), node_id="n1", args=MagicMock()
        )
        loop_spy.assert_called_once()
        assert result == {"event": "wf-loop"}

    def test_invalid_mode_raises(self, mocker):
        app = _make_app(AppMode.COMPLETION)
        with pytest.raises(ValueError, match="Invalid app mode"):
            AppGenerateService.generate_single_loop(app_model=app, user=_make_user(), node_id="n1", args=MagicMock())


# ---------------------------------------------------------------------------
# generate_more_like_this
# ---------------------------------------------------------------------------
class TestGenerateMoreLikeThis:
    def test_delegates_to_completion_generator(self, mocker):
        gen_spy = mocker.patch(
            "services.app_generate_service.CompletionAppGenerator.generate_more_like_this",
            return_value={"result": "similar"},
        )
        result = AppGenerateService.generate_more_like_this(
            app_model=_make_app(AppMode.COMPLETION),
            user=_make_user(),
            message_id="msg-1",
            invoke_from=InvokeFrom.SERVICE_API,
            streaming=True,
        )
        assert result == {"result": "similar"}
        gen_spy.assert_called_once()
        assert gen_spy.call_args.kwargs["stream"] is True


# ---------------------------------------------------------------------------
# get_response_generator
# ---------------------------------------------------------------------------
class TestGetResponseGenerator:
    def test_non_ended_workflow_run(self, mocker):
        app = _make_app(AppMode.ADVANCED_CHAT)
        workflow_run = MagicMock()
        workflow_run.id = "run-1"
        workflow_run.status.is_ended.return_value = False

        gen_instance = MagicMock()
        gen_instance.retrieve_events.return_value = iter([{"event": "started"}])
        gen_instance.convert_to_event_stream.side_effect = lambda x: x
        mocker.patch(
            "services.app_generate_service.AdvancedChatAppGenerator",
            return_value=gen_instance,
        )

        result = AppGenerateService.get_response_generator(app_model=app, workflow_run=workflow_run)
        gen_instance.retrieve_events.assert_called_once()

    def test_ended_workflow_run_still_returns_generator(self, mocker):
        """Even when the run is ended, the current code still returns a generator (TODO branch)."""
        app = _make_app(AppMode.WORKFLOW)
        workflow_run = MagicMock()
        workflow_run.id = "run-2"
        workflow_run.status.is_ended.return_value = True

        gen_instance = MagicMock()
        gen_instance.retrieve_events.return_value = iter([])
        gen_instance.convert_to_event_stream.side_effect = lambda x: x
        mocker.patch(
            "services.app_generate_service.AdvancedChatAppGenerator",
            return_value=gen_instance,
        )

        result = AppGenerateService.get_response_generator(app_model=app, workflow_run=workflow_run)
        # current impl falls through the TODO and still creates a generator
        gen_instance.retrieve_events.assert_called_once()
