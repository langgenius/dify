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
"""

import json
import threading
import uuid
from collections.abc import Callable
from contextlib import contextmanager
from unittest.mock import MagicMock

import pytest
from pytest_mock import MockerFixture
from sqlalchemy.orm import Session

import services.app_generate_service as ags_module
from core.app.entities.app_invoke_entities import InvokeFrom
from enums import DeploymentEdition, QuotaType
from models.account import Account
from models.enums import AppStatus
from models.model import App, AppMode
from models.workflow import Workflow, WorkflowType
from services.app.generation.runtime import AppGenerationRuntime
from services.app_generate_service import AppGenerateService
from services.errors.app import (
    TriggerWorkflowServiceModeUnavailableError,
    WorkflowIdFormatError,
    WorkflowNotFoundError,
)
from services.workflow.variable_contracts import WorkflowExecutionVariables


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


def _make_app(mode: AppMode | str, *, max_active_requests: int = 0) -> App:
    app = App(
        id="app-id",
        tenant_id="tenant-id",
        name="App",
        description="",
        mode=AppMode.CHAT if isinstance(mode, str) and mode == "invalid-mode" else mode,
        status=AppStatus.NORMAL,
        enable_site=False,
        enable_api=False,
        api_rpm=0,
        api_rph=0,
        max_active_requests=max_active_requests,
    )
    if mode == "invalid-mode":
        app.mode = mode  # type: ignore[assignment]
    return app


def _make_user() -> Account:
    user = Account(name="User", email="user@example.com")
    user.id = "user-id"
    return user


class _RealSessionTest:
    @pytest.fixture(autouse=True)
    def _bind_session(self, sqlite_session: Session) -> None:
        self.session = sqlite_session


def _make_workflow(
    *,
    workflow_id: str = "workflow-id",
    created_by: str = "owner-id",
    node_types: tuple[str, ...] = (),
) -> Workflow:
    return Workflow(
        id=workflow_id,
        tenant_id="tenant-id",
        app_id="app-id",
        type=WorkflowType.WORKFLOW,
        version=Workflow.VERSION_DRAFT,
        graph=json.dumps(
            {
                "nodes": [
                    {"id": f"node-{index}", "data": {"type": node_type}} for index, node_type in enumerate(node_types)
                ],
                "edges": [],
            }
        ),
        features="{}",
        created_by=created_by,
        environment_variables=[],
        conversation_variables=[],
    )


@contextmanager
def _noop_rate_limit_context(rate_limit, request_id):
    """Drop-in replacement for rate_limit_context that doesn't touch Redis."""
    yield


# ---------------------------------------------------------------------------
# _build_streaming_task_on_subscribe
# ---------------------------------------------------------------------------
class _FakeTimer:
    def __init__(self, interval: float, function: Callable[[], bool]) -> None:
        self.interval = interval
        self.function = function
        self.daemon = False
        self.started = False
        self.cancelled = False

    def start(self) -> None:
        self.started = True

    def cancel(self) -> None:
        self.cancelled = True


def _unexpected_timer(interval: float, function: Callable[[], bool]) -> _FakeTimer:
    raise AssertionError("streams must not create a fallback timer")


class TestBuildStreamingTaskOnSubscribe:
    def test_streams_starts_only_when_hook_is_invoked_without_creating_timer(
        self, monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
    ):
        config_overrides(PUBSUB_REDIS_CHANNEL_TYPE="streams")

        monkeypatch.setattr(ags_module.threading, "Timer", _unexpected_timer)
        called: list[int] = []

        on_subscribe = AppGenerateService._build_streaming_task_on_subscribe(lambda: called.append(1))

        assert called == []
        on_subscribe()
        on_subscribe()
        assert called == [1]

    @pytest.mark.parametrize("channel_type", ["pubsub", "sharded"])
    def test_pubsub_transports_keep_subscribe_hook_and_fallback_timer(
        self,
        monkeypatch: pytest.MonkeyPatch,
        channel_type: str,
        config_overrides: Callable[..., None],
    ):
        config_overrides(PUBSUB_REDIS_CHANNEL_TYPE=channel_type)
        timers: list[_FakeTimer] = []

        def build_timer(interval: float, function: Callable[[], bool]) -> _FakeTimer:
            timer = _FakeTimer(interval, function)
            timers.append(timer)
            return timer

        monkeypatch.setattr(ags_module.threading, "Timer", build_timer)
        called: list[int] = []

        on_subscribe = AppGenerateService._build_streaming_task_on_subscribe(lambda: called.append(1))

        assert called == []
        assert len(timers) == 1
        assert timers[0].interval == ags_module.SSE_TASK_START_FALLBACK_MS / 1000.0
        assert timers[0].started is True

        on_subscribe()

        assert called == [1]
        assert timers[0].cancelled is True

    def test_pubsub_fallback_starts_task_if_hook_is_never_invoked(
        self, monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
    ):
        config_overrides(PUBSUB_REDIS_CHANNEL_TYPE="pubsub")
        timers: list[_FakeTimer] = []

        def build_timer(interval: float, function: Callable[[], bool]) -> _FakeTimer:
            timer = _FakeTimer(interval, function)
            timers.append(timer)
            return timer

        monkeypatch.setattr(ags_module.threading, "Timer", build_timer)
        called: list[int] = []
        on_subscribe = AppGenerateService._build_streaming_task_on_subscribe(lambda: called.append(1))

        assert timers[0].function() is True
        on_subscribe()
        assert called == [1]

    def test_streams_retries_after_enqueue_failure(
        self, monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
    ):
        config_overrides(PUBSUB_REDIS_CHANNEL_TYPE="streams")
        monkeypatch.setattr(ags_module.threading, "Timer", _unexpected_timer)
        call_count = 0

        def _bad():
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise RuntimeError("boom")

        on_subscribe = AppGenerateService._build_streaming_task_on_subscribe(_bad)
        on_subscribe()
        assert call_count == 1
        on_subscribe()
        assert call_count == 2

    def test_concurrent_subscribe_only_starts_once(
        self, monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
    ):
        config_overrides(PUBSUB_REDIS_CHANNEL_TYPE="streams")
        monkeypatch.setattr(ags_module.threading, "Timer", _unexpected_timer)
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
    def test_both_zero_returns_zero(self, config_overrides: Callable[..., None]):
        config_overrides(APP_MAX_ACTIVE_REQUESTS=0, APP_DEFAULT_ACTIVE_REQUESTS=0)
        app = _make_app(AppMode.CHAT, max_active_requests=0)
        assert AppGenerateService._get_max_active_requests(app) == 0

    def test_app_limit_only(self, config_overrides: Callable[..., None]):
        config_overrides(APP_MAX_ACTIVE_REQUESTS=0, APP_DEFAULT_ACTIVE_REQUESTS=0)
        app = _make_app(AppMode.CHAT, max_active_requests=5)
        assert AppGenerateService._get_max_active_requests(app) == 5

    def test_config_limit_only(self, config_overrides: Callable[..., None]):
        config_overrides(APP_MAX_ACTIVE_REQUESTS=10, APP_DEFAULT_ACTIVE_REQUESTS=0)
        app = _make_app(AppMode.CHAT, max_active_requests=0)
        assert AppGenerateService._get_max_active_requests(app) == 10

    def test_both_non_zero_returns_min(self, config_overrides: Callable[..., None]):
        config_overrides(APP_MAX_ACTIVE_REQUESTS=20, APP_DEFAULT_ACTIVE_REQUESTS=0)
        app = _make_app(AppMode.CHAT, max_active_requests=5)
        assert AppGenerateService._get_max_active_requests(app) == 5

    def test_default_active_requests_used_when_app_has_none(self, config_overrides: Callable[..., None]):
        config_overrides(APP_MAX_ACTIVE_REQUESTS=0, APP_DEFAULT_ACTIVE_REQUESTS=15)
        app = _make_app(AppMode.CHAT, max_active_requests=0)
        assert AppGenerateService._get_max_active_requests(app) == 15


# ---------------------------------------------------------------------------
# generate – every AppMode branch
# ---------------------------------------------------------------------------
class TestGenerate(_RealSessionTest):
    """Tests for AppGenerateService.generate covering each mode."""

    @pytest.fixture(autouse=True)
    def _common(self, mocker: MockerFixture, config_overrides: Callable[..., None]):
        config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
        mocker.patch("services.app_generate_service.RateLimit", _DummyRateLimit)
        # Prevent AppExecutionParams.new from touching real models via isinstance
        mocker.patch(
            "services.app_generate_service.rate_limit_context",
            _noop_rate_limit_context,
        )

    # -- COMPLETION ---------------------------------------------------------
    @pytest.mark.parametrize("mode", [AppMode.WORKFLOW, AppMode.ADVANCED_CHAT])
    @pytest.mark.parametrize("entry", ["generate", "iteration", "loop"])
    def test_debug_generators_use_injected_loader_and_saver(
        self,
        monkeypatch: pytest.MonkeyPatch,
        workflow_variables: WorkflowExecutionVariables,
        mode: AppMode,
        entry: str,
        *,
        workflow_runtime: AppGenerationRuntime,
    ) -> None:
        from graphon.enums import BuiltinNodeTypes
        from services.app.generation.input_adapter import AppInputAdapter
        from services.workflow.execution.adapters.chatflow.app_generator import AdvancedChatAppGenerator
        from services.workflow.execution.adapters.workflow.app_generator import WorkflowAppGenerator

        workflow = _make_workflow()
        user = _make_user()
        monkeypatch.setattr(AppGenerateService, "_get_workflow", lambda *_args, **_kwargs: workflow)
        calls: list[str] = []

        def generate(generator: AppInputAdapter, **_kwargs: object) -> dict[str, str]:
            # Keep the real generator constructor and debugger saver selection.
            assert generator._draft_variable_loader == workflow_variables.workflow_loader
            assert generator._draft_variable_saver == workflow_variables.saver_factory
            loader = workflow_variables.workflow_loader(workflow, user.id)
            saver = generator._get_draft_var_saver_factory(InvokeFrom.DEBUGGER, user, tenant_id=workflow.tenant_id)
            saver(workflow.app_id, "node", BuiltinNodeTypes.CODE, "execution").save(
                process_data=None, outputs={"text": "injected value"}
            )
            assert loader.load_variables([["node", "text"]])[0].value == "injected value"
            calls.append(entry)
            return {"result": "ready"}

        generator_type = WorkflowAppGenerator if mode == AppMode.WORKFLOW else AdvancedChatAppGenerator
        method = {"generate": "generate", "iteration": "single_iteration_generate", "loop": "single_loop_generate"}[
            entry
        ]
        monkeypatch.setattr(generator_type, method, generate)
        app = _make_app(mode)
        if entry == "generate":
            result = AppGenerateService.generate(
                app_model=app,
                user=user,
                args={},
                invoke_from=InvokeFrom.DEBUGGER,
                session=self.session,
                streaming=False,
                variables=workflow_variables,
                runtime=workflow_runtime,
            )
        elif entry == "iteration":
            result = AppGenerateService.generate_single_iteration(
                workflow=workflow,
                app_model=app,
                user=user,
                node_id="node",
                args={},
                streaming=False,
                variables=workflow_variables,
                runtime=workflow_runtime,
            )
        else:
            result = AppGenerateService.generate_single_loop(
                workflow=workflow,
                app_model=app,
                user=user,
                node_id="node",
                args={},
                streaming=False,
                variables=workflow_variables,
                runtime=workflow_runtime,
            )
        assert result == {"result": "ready"}
        assert calls == [entry]

    def test_completion_mode(
        self,
        mocker: MockerFixture,
        *,
        workflow_variables: WorkflowExecutionVariables,
        workflow_runtime: AppGenerationRuntime,
    ):
        gen_spy = mocker.patch(
            "services.app_generate_service.CompletionAppGenerator.generate",
            return_value={"result": "ok"},
        )
        mocker.patch(
            "services.app_generate_service.convert_to_event_stream",
            side_effect=lambda x: x,
        )
        result = AppGenerateService.generate(
            app_model=_make_app(AppMode.COMPLETION),
            user=_make_user(),
            args={"inputs": {}},
            invoke_from=InvokeFrom.SERVICE_API,
            streaming=False,
            session=self.session,
            variables=workflow_variables,
            runtime=workflow_runtime,
        )
        assert result == {"result": "ok"}
        gen_spy.assert_called_once()

    # -- AGENT_CHAT via mode ------------------------------------------------
    def test_agent_chat_mode(
        self,
        mocker: MockerFixture,
        *,
        workflow_variables: WorkflowExecutionVariables,
        workflow_runtime: AppGenerationRuntime,
    ):
        generator = mocker.patch("services.app_generate_service.AgentChatAppGenerator")
        gen_spy = generator.return_value.generate
        gen_spy.return_value = {"result": "agent"}
        mocker.patch(
            "services.app_generate_service.convert_to_event_stream",
            side_effect=lambda x: x,
        )
        result = AppGenerateService.generate(
            app_model=_make_app(AppMode.AGENT_CHAT),
            user=_make_user(),
            args={"inputs": {}},
            invoke_from=InvokeFrom.SERVICE_API,
            streaming=False,
            session=self.session,
            variables=workflow_variables,
            runtime=workflow_runtime,
        )
        assert result == {"result": "agent"}
        gen_spy.assert_called_once()
        assert generator.call_args.kwargs["tool_invoker"] is workflow_runtime.agent_tool_invoker

    # -- AGENT_CHAT via is_agent flag (non-AGENT_CHAT mode) -----------------
    def test_agent_via_is_agent_flag(
        self,
        mocker: MockerFixture,
        *,
        workflow_variables: WorkflowExecutionVariables,
        workflow_runtime: AppGenerationRuntime,
    ):
        generator = mocker.patch("services.app_generate_service.AgentChatAppGenerator")
        gen_spy = generator.return_value.generate
        gen_spy.return_value = {"result": "agent-via-flag"}
        mocker.patch(
            "services.app_generate_service.convert_to_event_stream",
            side_effect=lambda x: x,
        )
        app = _make_app(AppMode.CHAT)
        is_agent = mocker.patch.object(App, "is_agent_with_session", return_value=True)
        session = self.session
        result = AppGenerateService.generate(
            app_model=app,
            user=_make_user(),
            args={"inputs": {}},
            invoke_from=InvokeFrom.SERVICE_API,
            streaming=False,
            session=session,
            variables=workflow_variables,
            runtime=workflow_runtime,
        )
        assert result == {"result": "agent-via-flag"}
        gen_spy.assert_called_once()
        assert generator.call_args.kwargs["tool_invoker"] is workflow_runtime.agent_tool_invoker
        is_agent.assert_called_once_with(session=session)

    # -- AGENT --------------------------------------------------------------
    def test_agent_mode_passes_session(
        self,
        mocker: MockerFixture,
        *,
        workflow_variables: WorkflowExecutionVariables,
        workflow_runtime: AppGenerationRuntime,
    ):
        gen_spy = mocker.patch(
            "services.app_generate_service.AgentAppGenerator.generate",
            return_value={"result": "agent"},
        )
        mocker.patch(
            "services.app_generate_service.convert_to_event_stream",
            side_effect=lambda x: x,
        )
        session = self.session

        result = AppGenerateService.generate(
            app_model=_make_app(AppMode.AGENT),
            user=_make_user(),
            args={"inputs": {}},
            invoke_from=InvokeFrom.SERVICE_API,
            streaming=True,
            session=session,
            variables=workflow_variables,
            runtime=workflow_runtime,
        )

        assert result == {"result": "agent"}

    # -- CHAT ---------------------------------------------------------------
    def test_chat_mode(
        self,
        mocker: MockerFixture,
        *,
        workflow_variables: WorkflowExecutionVariables,
        workflow_runtime: AppGenerationRuntime,
    ):
        gen_spy = mocker.patch(
            "services.app_generate_service.ChatAppGenerator.generate",
            return_value={"result": "chat"},
        )
        mocker.patch(
            "services.app_generate_service.convert_to_event_stream",
            side_effect=lambda x: x,
        )
        app = _make_app(AppMode.CHAT)
        result = AppGenerateService.generate(
            app_model=app,
            user=_make_user(),
            args={"inputs": {}},
            invoke_from=InvokeFrom.SERVICE_API,
            streaming=False,
            session=self.session,
            variables=workflow_variables,
            runtime=workflow_runtime,
        )
        assert result == {"result": "chat"}
        gen_spy.assert_called_once()

    # -- ADVANCED_CHAT blocking ---------------------------------------------
    def test_advanced_chat_blocking(
        self,
        mocker: MockerFixture,
        *,
        workflow_variables: WorkflowExecutionVariables,
        workflow_runtime: AppGenerationRuntime,
    ):
        workflow = _make_workflow()
        mocker.patch.object(AppGenerateService, "_get_workflow", return_value=workflow)

        retrieve_spy = mocker.patch("services.app_generate_service.WorkflowEventStream.retrieve_events")
        gen_spy = mocker.patch(
            "services.app_generate_service.AdvancedChatAppGenerator.generate",
            return_value={"result": "advanced-blocking"},
        )
        mocker.patch(
            "services.app_generate_service.convert_to_event_stream",
            side_effect=lambda x: x,
        )

        session = self.session
        result = AppGenerateService.generate(
            app_model=_make_app(AppMode.ADVANCED_CHAT),
            user=_make_user(),
            args={"workflow_id": None, "query": "hi", "inputs": {}},
            invoke_from=InvokeFrom.SERVICE_API,
            streaming=False,
            session=session,
            variables=workflow_variables,
            runtime=workflow_runtime,
        )
        assert result == {"result": "advanced-blocking"}
        call_kwargs = gen_spy.call_args.kwargs
        assert call_kwargs.get("streaming") is False
        assert "session" not in call_kwargs
        retrieve_spy.assert_not_called()

    # -- ADVANCED_CHAT streaming --------------------------------------------
    def test_advanced_chat_streaming(
        self,
        mocker: MockerFixture,
        config_overrides: Callable[..., None],
        *,
        workflow_variables: WorkflowExecutionVariables,
        workflow_runtime: AppGenerationRuntime,
    ):
        config_overrides(PUBSUB_REDIS_CHANNEL_TYPE="streams")
        workflow = _make_workflow()
        mocker.patch.object(AppGenerateService, "_get_workflow", return_value=workflow)
        mocker.patch(
            "services.app_generate_service.AppExecutionParams.new",
            return_value=MagicMock(workflow_run_id="wfr-1", model_dump_json=MagicMock(return_value="{}")),
        )
        delay_spy = mocker.patch("services.app_generate_service.workflow_based_app_execution_task.delay")
        gen_instance = MagicMock()
        gen_instance.retrieve_events.return_value = iter([])
        gen_instance.convert_to_event_stream.side_effect = lambda x: x
        mocker.patch(
            "services.app_generate_service.WorkflowEventStream",
            new=gen_instance,
        )

        result = AppGenerateService.generate(
            app_model=_make_app(AppMode.ADVANCED_CHAT),
            user=_make_user(),
            args={"workflow_id": None, "query": "hi", "inputs": {}},
            invoke_from=InvokeFrom.SERVICE_API,
            streaming=True,
            session=self.session,
            variables=workflow_variables,
            runtime=workflow_runtime,
        )
        # In streaming mode it should go through retrieve_events, not generate
        gen_instance.retrieve_events.assert_called_once()
        # Dispatch is gated on subscribe; simulate the SSE layer entering the
        # subscription, which is what actually invokes on_subscribe.
        on_subscribe = gen_instance.retrieve_events.call_args.kwargs["on_subscribe"]
        on_subscribe()
        delay_spy.assert_called_once()

    # -- WORKFLOW blocking --------------------------------------------------
    def test_workflow_blocking(
        self,
        mocker: MockerFixture,
        *,
        workflow_variables: WorkflowExecutionVariables,
        workflow_runtime: AppGenerationRuntime,
    ):
        workflow = _make_workflow()
        mocker.patch.object(AppGenerateService, "_get_workflow", return_value=workflow)
        gen_spy = mocker.patch(
            "services.app_generate_service.WorkflowAppGenerator.generate",
            return_value={"result": "workflow-blocking"},
        )
        mocker.patch(
            "services.app_generate_service.convert_to_event_stream",
            side_effect=lambda x: x,
        )

        session = self.session
        result = AppGenerateService.generate(
            app_model=_make_app(AppMode.WORKFLOW),
            user=_make_user(),
            args={"inputs": {}},
            invoke_from=InvokeFrom.SERVICE_API,
            streaming=False,
            session=session,
            variables=workflow_variables,
            runtime=workflow_runtime,
        )
        assert result == {"result": "workflow-blocking"}
        call_kwargs = gen_spy.call_args.kwargs
        assert call_kwargs.get("pause_state_config") is not None
        assert call_kwargs["pause_state_config"].state_owner_user_id == "owner-id"

    @pytest.mark.parametrize(
        "invoke_from",
        [InvokeFrom.OPENAPI, InvokeFrom.SERVICE_API, InvokeFrom.WEB_APP],
    )
    @pytest.mark.parametrize("node_type", ["trigger-plugin", "trigger-schedule", "trigger-webhook"])
    def test_trigger_workflow_rejects_manual_service_surfaces(
        self,
        invoke_from: InvokeFrom,
        node_type: str,
        mocker: MockerFixture,
        *,
        workflow_variables: WorkflowExecutionVariables,
        workflow_runtime: AppGenerationRuntime,
    ) -> None:
        workflow = _make_workflow(node_types=(node_type,))
        mocker.patch.object(AppGenerateService, "_get_workflow", return_value=workflow)
        generate = mocker.patch("services.app_generate_service.WorkflowAppGenerator.generate")

        with pytest.raises(TriggerWorkflowServiceModeUnavailableError):
            AppGenerateService.generate(
                app_model=_make_app(AppMode.WORKFLOW),
                user=_make_user(),
                args={"inputs": {}},
                invoke_from=invoke_from,
                streaming=False,
                session=MagicMock(),
                variables=workflow_variables,
                runtime=workflow_runtime,
            )

        generate.assert_not_called()

    def test_trigger_workflow_allows_trigger_execution(
        self,
        mocker: MockerFixture,
        *,
        workflow_variables: WorkflowExecutionVariables,
        workflow_runtime: AppGenerationRuntime,
    ) -> None:
        workflow = _make_workflow(node_types=("trigger-webhook",))
        mocker.patch.object(AppGenerateService, "_get_workflow", return_value=workflow)
        generate = mocker.patch(
            "services.app_generate_service.WorkflowAppGenerator.generate",
            return_value={"result": "trigger"},
        )
        mocker.patch(
            "services.app_generate_service.convert_to_event_stream",
            side_effect=lambda value: value,
        )

        result = AppGenerateService.generate(
            app_model=_make_app(AppMode.WORKFLOW),
            user=_make_user(),
            args={"inputs": {}},
            invoke_from=InvokeFrom.TRIGGER,
            streaming=False,
            session=MagicMock(),
            variables=workflow_variables,
            runtime=workflow_runtime,
        )

        assert result == {"result": "trigger"}
        generate.assert_called_once()

    def test_specific_start_workflow_version_remains_runnable(
        self,
        mocker: MockerFixture,
        *,
        workflow_variables: WorkflowExecutionVariables,
        workflow_runtime: AppGenerationRuntime,
    ) -> None:
        workflow_id = str(uuid.uuid4())
        workflow = _make_workflow(workflow_id=workflow_id, node_types=("start",))
        get_workflow = mocker.patch.object(AppGenerateService, "_get_workflow", return_value=workflow)
        mocker.patch(
            "services.app_generate_service.WorkflowAppGenerator.generate",
            return_value={"result": "version"},
        )
        mocker.patch(
            "services.app_generate_service.convert_to_event_stream",
            side_effect=lambda value: value,
        )
        app = _make_app(AppMode.WORKFLOW)
        session = MagicMock()

        result = AppGenerateService.generate(
            app_model=app,
            user=_make_user(),
            args={"inputs": {}, "workflow_id": workflow_id},
            invoke_from=InvokeFrom.SERVICE_API,
            streaming=False,
            session=session,
            variables=workflow_variables,
            runtime=workflow_runtime,
        )

        assert result == {"result": "version"}
        get_workflow.assert_called_once_with(app, InvokeFrom.SERVICE_API, workflow_id, session=session, snapshot=None)

    # -- WORKFLOW streaming -------------------------------------------------
    def test_workflow_streaming(
        self,
        mocker: MockerFixture,
        config_overrides: Callable[..., None],
        *,
        workflow_variables: WorkflowExecutionVariables,
        workflow_runtime: AppGenerationRuntime,
    ):
        config_overrides(PUBSUB_REDIS_CHANNEL_TYPE="streams")
        workflow = _make_workflow()
        mocker.patch.object(AppGenerateService, "_get_workflow", return_value=workflow)
        mocker.patch(
            "services.app_generate_service.AppExecutionParams.new",
            return_value=MagicMock(workflow_run_id="wfr-2", model_dump_json=MagicMock(return_value="{}")),
        )
        delay_spy = mocker.patch("services.app_generate_service.workflow_based_app_execution_task.delay")
        retrieve_spy = mocker.patch(
            "services.app_generate_service.WorkflowEventStream.retrieve_events",
            return_value=iter([]),
        )
        mocker.patch(
            "services.app_generate_service.convert_to_event_stream",
            side_effect=lambda x: x,
        )

        result = AppGenerateService.generate(
            app_model=_make_app(AppMode.WORKFLOW),
            user=_make_user(),
            args={"inputs": {}},
            invoke_from=InvokeFrom.SERVICE_API,
            streaming=True,
            session=self.session,
            variables=workflow_variables,
            runtime=workflow_runtime,
        )
        retrieve_spy.assert_called_once()
        # Dispatch is gated on subscribe; simulate the SSE layer entering the
        # subscription, which is what actually invokes on_subscribe.
        on_subscribe = retrieve_spy.call_args.kwargs["on_subscribe"]
        on_subscribe()
        delay_spy.assert_called_once()

    # -- Invalid mode -------------------------------------------------------
    def test_invalid_mode_raises(
        self,
        mocker: MockerFixture,
        *,
        workflow_variables: WorkflowExecutionVariables,
        workflow_runtime: AppGenerationRuntime,
    ):
        app = _make_app("invalid-mode")
        with pytest.raises(ValueError, match="Invalid app mode"):
            AppGenerateService.generate(
                app_model=app,
                user=_make_user(),
                args={},
                invoke_from=InvokeFrom.SERVICE_API,
                streaming=False,
                session=self.session,
                variables=workflow_variables,
                runtime=workflow_runtime,
            )


# ---------------------------------------------------------------------------
# generate – billing / quota
# ---------------------------------------------------------------------------
class TestGenerateBilling(_RealSessionTest):
    @pytest.fixture(autouse=True)
    def _common(self, mocker: MockerFixture):
        mocker.patch("services.app_generate_service.RateLimit", _DummyRateLimit)
        mocker.patch(
            "services.app_generate_service.rate_limit_context",
            _noop_rate_limit_context,
        )

    def test_cloud_edition_consumes_quota(
        self,
        mocker: MockerFixture,
        config_overrides: Callable[..., None],
        *,
        workflow_variables: WorkflowExecutionVariables,
        workflow_runtime: AppGenerationRuntime,
    ):
        config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
        quota_charge = MagicMock()
        reserve_mock = mocker.patch(
            "services.app_generate_service.QuotaService.reserve",
            return_value=quota_charge,
        )
        mocker.patch(
            "services.app_generate_service.CompletionAppGenerator.generate",
            return_value={"ok": True},
        )
        mocker.patch(
            "services.app_generate_service.convert_to_event_stream",
            side_effect=lambda x: x,
        )

        AppGenerateService.generate(
            app_model=_make_app(AppMode.COMPLETION),
            user=_make_user(),
            args={"inputs": {}},
            invoke_from=InvokeFrom.SERVICE_API,
            streaming=False,
            session=self.session,
            variables=workflow_variables,
            runtime=workflow_runtime,
        )
        reserve_mock.assert_called_once_with(QuotaType.WORKFLOW, "tenant-id")
        quota_charge.commit.assert_called_once()

    def test_billing_quota_exceeded_raises_rate_limit_error(
        self,
        mocker: MockerFixture,
        config_overrides: Callable[..., None],
        *,
        workflow_variables: WorkflowExecutionVariables,
        workflow_runtime: AppGenerationRuntime,
    ):
        from services.errors.app import QuotaExceededError
        from services.errors.llm import InvokeRateLimitError

        config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
        mocker.patch(
            "services.app_generate_service.QuotaService.reserve",
            side_effect=QuotaExceededError(feature="workflow", tenant_id="t", required=1),
        )

        with pytest.raises(InvokeRateLimitError):
            AppGenerateService.generate(
                app_model=_make_app(AppMode.COMPLETION),
                user=_make_user(),
                args={"inputs": {}},
                invoke_from=InvokeFrom.SERVICE_API,
                streaming=False,
                session=self.session,
                variables=workflow_variables,
                runtime=workflow_runtime,
            )

    def test_exception_refunds_quota_and_exits_rate_limit(
        self,
        mocker: MockerFixture,
        config_overrides: Callable[..., None],
        *,
        workflow_variables: WorkflowExecutionVariables,
        workflow_runtime: AppGenerationRuntime,
    ):
        config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
        quota_charge = MagicMock()
        mocker.patch(
            "services.app_generate_service.QuotaService.reserve",
            return_value=quota_charge,
        )
        mocker.patch(
            "services.app_generate_service.CompletionAppGenerator.generate",
            side_effect=RuntimeError("boom"),
        )
        mocker.patch(
            "services.app_generate_service.convert_to_event_stream",
            side_effect=lambda x: x,
        )

        with pytest.raises(RuntimeError, match="boom"):
            AppGenerateService.generate(
                app_model=_make_app(AppMode.COMPLETION),
                user=_make_user(),
                args={"inputs": {}},
                invoke_from=InvokeFrom.SERVICE_API,
                streaming=False,
                session=self.session,
                variables=workflow_variables,
                runtime=workflow_runtime,
            )
        quota_charge.refund.assert_called_once()

    def test_rate_limit_exit_called_in_finally_for_blocking(
        self,
        mocker: MockerFixture,
        config_overrides: Callable[..., None],
        *,
        workflow_variables: WorkflowExecutionVariables,
        workflow_runtime: AppGenerationRuntime,
    ):
        """For non-streaming (blocking) calls, rate_limit.exit should be called in finally."""
        config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)

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
            "services.app_generate_service.convert_to_event_stream",
            side_effect=lambda x: x,
        )

        AppGenerateService.generate(
            app_model=_make_app(AppMode.COMPLETION),
            user=_make_user(),
            args={"inputs": {}},
            invoke_from=InvokeFrom.SERVICE_API,
            streaming=False,
            session=self.session,
            variables=workflow_variables,
            runtime=workflow_runtime,
        )
        # exit is called in finally block for non-streaming
        assert exit_calls == ["dummy-request-id"]

    def test_blocking_failure_exits_rate_limit_once(
        self,
        mocker: MockerFixture,
        config_overrides: Callable[..., None],
        *,
        workflow_variables: WorkflowExecutionVariables,
        workflow_runtime: AppGenerationRuntime,
    ):
        config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
        quota_charge = MagicMock()
        mocker.patch(
            "services.app_generate_service.QuotaService.reserve",
            return_value=quota_charge,
        )
        exit_calls: list[str] = []

        class _TrackingRateLimit(_DummyRateLimit):
            def exit(self, request_id: str) -> None:
                exit_calls.append(request_id)

        mocker.patch("services.app_generate_service.RateLimit", _TrackingRateLimit)
        mocker.patch(
            "services.app_generate_service.CompletionAppGenerator.generate",
            side_effect=RuntimeError("boom"),
        )

        with pytest.raises(RuntimeError, match="boom"):
            AppGenerateService.generate(
                app_model=_make_app(AppMode.COMPLETION),
                user=_make_user(),
                args={"inputs": {}},
                invoke_from=InvokeFrom.SERVICE_API,
                streaming=False,
                session=self.session,
                variables=workflow_variables,
                runtime=workflow_runtime,
            )

        quota_charge.refund.assert_called_once()
        assert exit_calls == ["dummy-request-id"]

    def test_streaming_failure_exits_rate_limit_once(
        self,
        mocker: MockerFixture,
        config_overrides: Callable[..., None],
        *,
        workflow_variables: WorkflowExecutionVariables,
        workflow_runtime: AppGenerationRuntime,
    ):
        config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
        quota_charge = MagicMock()
        mocker.patch(
            "services.app_generate_service.QuotaService.reserve",
            return_value=quota_charge,
        )
        exit_calls: list[str] = []

        class _TrackingRateLimit(_DummyRateLimit):
            def exit(self, request_id: str) -> None:
                exit_calls.append(request_id)

        mocker.patch("services.app_generate_service.RateLimit", _TrackingRateLimit)
        mocker.patch(
            "services.app_generate_service.CompletionAppGenerator.generate",
            side_effect=RuntimeError("boom"),
        )

        with pytest.raises(RuntimeError, match="boom"):
            AppGenerateService.generate(
                app_model=_make_app(AppMode.COMPLETION),
                user=_make_user(),
                args={"inputs": {}},
                invoke_from=InvokeFrom.SERVICE_API,
                streaming=True,
                session=self.session,
                variables=workflow_variables,
                runtime=workflow_runtime,
            )

        quota_charge.refund.assert_called_once()
        assert exit_calls == ["dummy-request-id"]


# ---------------------------------------------------------------------------
# _get_workflow
# ---------------------------------------------------------------------------
class TestGetWorkflow(_RealSessionTest):
    def test_debugger_fetches_draft(self):
        workflow = _make_workflow()
        self.session.add(workflow)
        self.session.commit()
        assert (
            AppGenerateService._get_workflow(_make_app(AppMode.WORKFLOW), InvokeFrom.DEBUGGER, session=self.session)
            is workflow
        )

    def test_debugger_raises_when_no_draft(self):
        with pytest.raises(ValueError, match="Workflow not initialized"):
            AppGenerateService._get_workflow(_make_app(AppMode.WORKFLOW), InvokeFrom.DEBUGGER, session=self.session)

    def test_non_debugger_fetches_published(self):
        workflow = _make_workflow()
        workflow.version = "published"
        self.session.add(workflow)
        self.session.commit()
        app = _make_app(AppMode.WORKFLOW)
        app.workflow_id = workflow.id
        assert AppGenerateService._get_workflow(app, InvokeFrom.SERVICE_API, session=self.session) is workflow

    def test_non_debugger_raises_when_no_published(self):
        with pytest.raises(ValueError, match="Workflow not published"):
            AppGenerateService._get_workflow(_make_app(AppMode.WORKFLOW), InvokeFrom.SERVICE_API, session=self.session)

    def test_specific_workflow_id_valid_uuid(self):
        workflow = _make_workflow(workflow_id=str(uuid.uuid4()))
        workflow.version = "published"
        self.session.add(workflow)
        self.session.commit()
        assert (
            AppGenerateService._get_workflow(
                _make_app(AppMode.WORKFLOW), InvokeFrom.SERVICE_API, workflow_id=workflow.id, session=self.session
            )
            is workflow
        )

    def test_specific_workflow_id_invalid_uuid(self):
        with pytest.raises(WorkflowIdFormatError):
            AppGenerateService._get_workflow(
                _make_app(AppMode.WORKFLOW), InvokeFrom.SERVICE_API, workflow_id="not-a-uuid", session=self.session
            )

    @pytest.mark.parametrize("owner", ["missing", "other-tenant", "other-app"])
    def test_specific_workflow_id_not_found(self, owner: str):
        workflow = _make_workflow(workflow_id=str(uuid.uuid4()))
        workflow.version = "published"
        if owner != "missing":
            if owner == "other-tenant":
                workflow.tenant_id = owner
            else:
                workflow.app_id = owner
            self.session.add(workflow)
            self.session.commit()
        with pytest.raises(WorkflowNotFoundError):
            AppGenerateService._get_workflow(
                _make_app(AppMode.WORKFLOW), InvokeFrom.SERVICE_API, workflow_id=workflow.id, session=self.session
            )


# ---------------------------------------------------------------------------
# generate_single_iteration
# ---------------------------------------------------------------------------
class TestGenerateSingleIteration(_RealSessionTest):
    def test_advanced_chat_mode(
        self,
        mocker: MockerFixture,
        *,
        workflow_variables: WorkflowExecutionVariables,
        workflow_runtime: AppGenerationRuntime,
    ):
        workflow = _make_workflow()
        mocker.patch.object(AppGenerateService, "_get_workflow", return_value=workflow)
        gen_spy = mocker.patch(
            "services.app_generate_service.convert_to_event_stream",
            side_effect=lambda x: x,
        )
        iter_spy = mocker.patch(
            "services.app_generate_service.AdvancedChatAppGenerator.single_iteration_generate",
            return_value={"event": "iteration"},
        )
        app = _make_app(AppMode.ADVANCED_CHAT)
        session = self.session
        result = AppGenerateService.generate_single_iteration(
            workflow=workflow,
            app_model=app,
            user=_make_user(),
            node_id="n1",
            args={"k": "v"},
            variables=workflow_variables,
            runtime=workflow_runtime,
        )
        iter_spy.assert_called_once()
        assert result == {"event": "iteration"}

    def test_workflow_mode(
        self,
        mocker: MockerFixture,
        *,
        workflow_variables: WorkflowExecutionVariables,
        workflow_runtime: AppGenerationRuntime,
    ):
        workflow = _make_workflow()
        mocker.patch.object(AppGenerateService, "_get_workflow", return_value=workflow)
        mocker.patch(
            "services.app_generate_service.convert_to_event_stream",
            side_effect=lambda x: x,
        )
        iter_spy = mocker.patch(
            "services.app_generate_service.WorkflowAppGenerator.single_iteration_generate",
            return_value={"event": "wf-iteration"},
        )
        app = _make_app(AppMode.WORKFLOW)
        session = self.session
        result = AppGenerateService.generate_single_iteration(
            workflow=workflow,
            app_model=app,
            user=_make_user(),
            node_id="n1",
            args={"k": "v"},
            variables=workflow_variables,
            runtime=workflow_runtime,
        )
        iter_spy.assert_called_once()
        assert "session" not in iter_spy.call_args.kwargs
        assert result == {"event": "wf-iteration"}

    def test_invalid_mode_raises(
        self,
        mocker: MockerFixture,
        *,
        workflow_variables: WorkflowExecutionVariables,
        workflow_runtime: AppGenerationRuntime,
    ):
        app = _make_app(AppMode.CHAT)
        with pytest.raises(ValueError, match="Invalid app mode"):
            AppGenerateService.generate_single_iteration(
                workflow=_make_workflow(),
                app_model=app,
                user=_make_user(),
                node_id="n1",
                args={},
                variables=workflow_variables,
                runtime=workflow_runtime,
            )


# ---------------------------------------------------------------------------
# generate_single_loop
# ---------------------------------------------------------------------------
class TestGenerateSingleLoop(_RealSessionTest):
    def test_advanced_chat_mode(
        self,
        mocker: MockerFixture,
        *,
        workflow_variables: WorkflowExecutionVariables,
        workflow_runtime: AppGenerationRuntime,
    ):
        workflow = _make_workflow()
        mocker.patch.object(AppGenerateService, "_get_workflow", return_value=workflow)
        mocker.patch(
            "services.app_generate_service.convert_to_event_stream",
            side_effect=lambda x: x,
        )
        loop_spy = mocker.patch(
            "services.app_generate_service.AdvancedChatAppGenerator.single_loop_generate",
            return_value={"event": "loop"},
        )
        app = _make_app(AppMode.ADVANCED_CHAT)
        session = self.session
        result = AppGenerateService.generate_single_loop(
            workflow=workflow,
            app_model=app,
            user=_make_user(),
            node_id="n1",
            args=MagicMock(),
            variables=workflow_variables,
            runtime=workflow_runtime,
        )
        loop_spy.assert_called_once()
        assert result == {"event": "loop"}

    def test_workflow_mode(
        self,
        mocker: MockerFixture,
        *,
        workflow_variables: WorkflowExecutionVariables,
        workflow_runtime: AppGenerationRuntime,
    ):
        workflow = _make_workflow()
        mocker.patch.object(AppGenerateService, "_get_workflow", return_value=workflow)
        mocker.patch(
            "services.app_generate_service.convert_to_event_stream",
            side_effect=lambda x: x,
        )
        loop_spy = mocker.patch(
            "services.app_generate_service.WorkflowAppGenerator.single_loop_generate",
            return_value={"event": "wf-loop"},
        )
        app = _make_app(AppMode.WORKFLOW)
        session = self.session
        result = AppGenerateService.generate_single_loop(
            workflow=workflow,
            app_model=app,
            user=_make_user(),
            node_id="n1",
            args=MagicMock(),
            variables=workflow_variables,
            runtime=workflow_runtime,
        )
        loop_spy.assert_called_once()
        assert "session" not in loop_spy.call_args.kwargs
        assert result == {"event": "wf-loop"}

    def test_invalid_mode_raises(
        self,
        mocker: MockerFixture,
        *,
        workflow_variables: WorkflowExecutionVariables,
        workflow_runtime: AppGenerationRuntime,
    ):
        app = _make_app(AppMode.COMPLETION)
        with pytest.raises(ValueError, match="Invalid app mode"):
            AppGenerateService.generate_single_loop(
                workflow=_make_workflow(),
                app_model=app,
                user=_make_user(),
                node_id="n1",
                args=MagicMock(),
                variables=workflow_variables,
                runtime=workflow_runtime,
            )


# ---------------------------------------------------------------------------
# generate_more_like_this
# ---------------------------------------------------------------------------
class TestGenerateMoreLikeThis(_RealSessionTest):
    def test_delegates_to_completion_generator(
        self, mocker: MockerFixture, app_records, annotation_replies, workflow_runtime
    ):
        gen_spy = mocker.patch(
            "services.app_generate_service.CompletionAppGenerator.generate_more_like_this",
            return_value={"result": "similar"},
        )
        session = self.session
        result = AppGenerateService.generate_more_like_this(
            retrieval=workflow_runtime.retrieval,
            records=app_records,
            annotations=annotation_replies,
            app_model=_make_app(AppMode.COMPLETION),
            user=_make_user(),
            message_id="msg-1",
            invoke_from=InvokeFrom.SERVICE_API,
            session=session,
            streaming=True,
        )
        assert result == {"result": "similar"}
        gen_spy.assert_called_once()
        assert gen_spy.call_args.kwargs["stream"] is True
