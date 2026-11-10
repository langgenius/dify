"""Unit tests for AgentAppGenerator.generate() and its worker thread.

Mirrors the agent_chat generator tests: every collaborator (config manager,
model converter, queue manager, thread, response converter, the agent backend
client stack) is patched at the module level, the generate entity class is
patched so no real pydantic entity is built, and the worker's flask-context
manager is replaced with a no-op so the thread body can run inline.
"""

from __future__ import annotations

import contextlib
import inspect
from dataclasses import dataclass
from decimal import Decimal
from unittest.mock import create_autospec

import pytest
from dify_trace_sdk.emitter import TraceScope
from dify_trace_sdk.events import TraceCorrelation, TraceEvent
from pytest_mock import MockerFixture
from sqlalchemy.orm import Session

from core.app.apps.exc import GenerateTaskStoppedError
from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
from core.app.entities.queue_entities import QueueAnnotationReplyEvent
from models import Account, AppModelConfig
from models.agent import Agent, AgentConfigSnapshot, AgentScope, AgentSource, AgentStatus
from models.agent_config_entities import AgentSoulConfig
from models.enums import AppStatus, ConversationFromSource
from models.model import App, AppMode, Conversation, Message, MessageAnnotation
from models.tool_runtime_contracts import WorkflowToolQueries
from services.app.generation.adapters import agent_app as module
from services.app.generation.adapters.agent_app import (
    AgentAppGenerator,
    AgentAppGeneratorError,
)
from services.app.generation.agent_config import AgentAppConfiguration, AgentAppConfigurations

MODULE = "services.app.generation.adapters.agent_app"


class _TraceRecorder:
    def __init__(self) -> None:
        self.events: list[TraceEvent] = []

    def emit(self, event: TraceEvent) -> None:
        self.events.append(event)


def _trace_scope() -> TraceScope:
    return TraceScope(
        emitter=_TraceRecorder(),
        tenant_id="tenant",
        app_id="app1",
        user_id="user",
        correlation=TraceCorrelation(
            external_trace_id=None, session_id=None, parent_workflow_run_id=None, parent_node_execution_id=None
        ),
    )


def _record_trace_scope_requests(monkeypatch: pytest.MonkeyPatch, trace_scope: TraceScope) -> list[dict[str, object]]:
    requests: list[dict[str, object]] = []

    def create_trace_scope(**kwargs: object) -> TraceScope:
        requests.append(kwargs)
        return trace_scope

    monkeypatch.setattr(module, "create_trace_scope", create_trace_scope)
    return requests


def _account(user_id: str = "user") -> Account:
    account = Account(name="User", email=f"{user_id}@example.com")
    account.id = user_id
    return account


def _app(*, app_model_config_id: str | None = None) -> App:
    return App(
        id="app1",
        tenant_id="tenant",
        name="Agent App",
        description="",
        mode=AppMode.AGENT,
        app_model_config_id=app_model_config_id,
        status=AppStatus.NORMAL,
        enable_site=False,
        enable_api=False,
        api_rpm=0,
        api_rph=0,
    )


@dataclass(frozen=True)
class _AppConfig:
    app_id: str
    tenant_id: str


def _agent(*, agent_id: str = "agent1") -> Agent:
    return Agent(
        id=agent_id,
        tenant_id="tenant",
        name="Agent",
        scope=AgentScope.ROSTER,
        source=AgentSource.AGENT_APP,
        status=AgentStatus.ACTIVE,
        app_id="app1",
    )


def _snapshot(*, snapshot_id: str = "snap1", agent_id: str = "agent1") -> AgentConfigSnapshot:
    return AgentConfigSnapshot(
        id=snapshot_id,
        tenant_id="tenant",
        agent_id=agent_id,
        version=1,
        config_snapshot=AgentSoulConfig(),
        home_snapshot_id="home-1",
    )


def _conversation(*, invoke_from: InvokeFrom = InvokeFrom.WEB_APP) -> Conversation:
    conversation = Conversation(
        id="conv",
        app_id="app1",
        mode=AppMode.AGENT,
        name="Conversation",
        invoke_from=invoke_from,
        from_source=ConversationFromSource.CONSOLE,
        from_account_id="user",
        is_deleted=False,
    )
    conversation._inputs = {}
    return conversation


def _message(*, query: str = "query") -> Message:
    message = Message(
        id="msg",
        app_id="app1",
        conversation_id="conv",
        query=query,
        message={"role": "user", "content": query},
        answer="",
        message_unit_price=Decimal(0),
        answer_unit_price=Decimal(0),
        currency="USD",
        from_source=ConversationFromSource.CONSOLE,
        from_account_id="user",
    )
    message._inputs = {}
    return message


_CURRENT_SESSION: Session | None = None


@pytest.fixture(autouse=True)
def _bind_real_session(sqlite_session: Session, monkeypatch: pytest.MonkeyPatch):
    global _CURRENT_SESSION
    _CURRENT_SESSION = sqlite_session
    sqlite_session.add(_app())
    sqlite_session.commit()
    yield
    _CURRENT_SESSION = None


def _session() -> Session:
    assert _CURRENT_SESSION is not None
    return _CURRENT_SESSION


@pytest.fixture
def generator(tool_providers, mocker: MockerFixture, *, annotation_replies, app_records) -> AgentAppGenerator:
    gen = AgentAppGenerator(
        agent_configs=create_autospec(AgentAppConfigurations, instance=True, spec_set=True),
        annotations=annotation_replies,
        records=app_records,
        tool_providers=tool_providers,
        workflow_queries=create_autospec(WorkflowToolQueries, instance=True, spec_set=True),
    )
    mocker.patch(f"{MODULE}.current_app", new=mocker.MagicMock(_get_current_object=mocker.MagicMock()))
    mocker.patch(f"{MODULE}.contextvars.copy_context", return_value="ctx")
    gen._agent_configs.resolve.return_value = AgentAppConfiguration(
        "agent1", "snap1", "snapshot", AgentSoulConfig(), "home-1"
    )
    gen._agent_configs.version.return_value = AgentAppConfiguration("a", "s", "snapshot", AgentSoulConfig(), "home-1")
    return gen


class TestGenerateGuards:
    def test_rejects_blocking_mode(self, generator: AgentAppGenerator):
        with pytest.raises(AgentAppGeneratorError, match="only supports streaming"):
            generator.generate(
                app_model=_app(),
                user=_account("u"),
                args={},
                invoke_from=InvokeFrom.WEB_APP,
                streaming=False,
            )

    def test_requires_query(self, generator: AgentAppGenerator):
        with pytest.raises(AgentAppGeneratorError, match="query is required"):
            generator.generate(
                app_model=_app(),
                user=_account("u"),
                args={"inputs": {}},
                invoke_from=InvokeFrom.WEB_APP,
            )

    def test_rejects_blank_query(self, generator: AgentAppGenerator):
        with pytest.raises(AgentAppGeneratorError, match="query is required"):
            generator.generate(
                app_model=_app(),
                user=_account("u"),
                args={"query": "   ", "inputs": {}},
                invoke_from=InvokeFrom.WEB_APP,
            )


class TestGenerateSuccess:
    def test_generate_orchestrates_and_starts_worker(
        self, generator: AgentAppGenerator, mocker: MockerFixture, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Admitted generation forwards its scope and configuration to the worker."""
        trace_scope = _trace_scope()
        scope_requests = _record_trace_scope_requests(monkeypatch, trace_scope)
        config = AppModelConfig(app_id="app1")
        config.id = "config-1"
        session = _session()
        session.add(config)
        session.commit()
        app_model = _app(app_model_config_id=config.id)
        user = _account()

        generator._prepare_user_inputs = mocker.MagicMock(return_value={"x": 1})
        generator._init_generate_records = mocker.MagicMock(return_value=(_conversation(), _message()))
        generator._handle_response = mocker.MagicMock(return_value="raw-response")

        mocker.patch(
            f"{MODULE}.AgentAppConfigManager.get_app_config",
            return_value=mocker.MagicMock(variables=[], tenant_id="tenant", app_id="app1"),
        )
        mocker.patch(f"{MODULE}.ModelConfigConverter.convert", return_value=mocker.MagicMock(model="gpt-4o-mini"))
        file_upload_config = mocker.MagicMock()
        mocker.patch(f"{MODULE}.FileUploadConfigManager.convert", return_value=file_upload_config)
        parsed_file = mocker.MagicMock()
        build_files = mocker.patch(f"{MODULE}.file_factory.build_from_mappings", return_value=[parsed_file])
        generate_entity = mocker.patch(
            f"{MODULE}.AgentAppGenerateEntity", return_value=mocker.MagicMock(task_id="t", user_id="user")
        )
        mocker.patch(f"{MODULE}.MessageBasedAppQueueManager", return_value=mocker.MagicMock())
        thread_obj = mocker.MagicMock()
        thread_constructor = mocker.patch(f"{MODULE}.threading.Thread", return_value=thread_obj)
        mocker.patch(f"{MODULE}.AgentAppGenerateResponseConverter.convert", return_value={"result": "ok"})
        file_mappings = [
            {
                "type": "image",
                "transfer_method": "local_file",
                "url": "",
                "upload_file_id": "upload-file-1",
            }
        ]

        result = generator.generate(
            app_model=app_model,
            user=user,
            args={"query": "hello", "inputs": {"name": "world"}, "files": file_mappings},
            invoke_from=InvokeFrom.WEB_APP,
            streaming=True,
        )

        assert result == {"result": "ok"}
        thread_obj.start.assert_called_once()
        worker_call = thread_constructor.call_args
        inspect.signature(worker_call.kwargs["target"]).bind(**worker_call.kwargs["kwargs"])
        generator._agent_configs.resolve.assert_called_once_with(
            tenant_id=app_model.tenant_id,
            app_id=app_model.id,
            account_id=user.id,
            debug=False,
            draft_type=None,
            conversation_id=None,
        )
        assert generate_entity.call_args.kwargs["agent_session_scope_config_version_id"] == "snap1"
        assert session.get(AppModelConfig, "config-1").id == config.id
        build_files.assert_called_once()
        assert build_files.call_args.kwargs["mappings"] == file_mappings
        assert generate_entity.call_args.kwargs["files"] == [parsed_file]
        assert generate_entity.call_args.kwargs["file_upload_config"] is file_upload_config
        assert "agent_runtime_exit_intent" not in generate_entity.call_args.kwargs
        extras = generate_entity.call_args.kwargs["extras"]
        assert generate_entity.call_args.kwargs["trace_scope"] is trace_scope
        assert scope_requests == [
            {"tenant_id": "tenant", "app_id": "app1", "app_tracing": None, "user_id": "user", "extras": extras}
        ]

    def test_generate_loads_existing_conversation(self, generator: AgentAppGenerator, mocker: MockerFixture):
        app_model = _app()
        generator._prepare_user_inputs = mocker.MagicMock(return_value={})
        generator._init_generate_records = mocker.MagicMock(return_value=(_conversation(), _message()))
        generator._handle_response = mocker.MagicMock(return_value="raw")
        get_conv = mocker.patch.object(generator._records, "conversation", return_value=_conversation())
        mocker.patch(f"{MODULE}.AgentAppConfigManager.get_app_config", return_value=mocker.MagicMock(variables=[]))
        mocker.patch.object(generator._records, "annotation_config", return_value={"enabled": False})
        mocker.patch(f"{MODULE}.ModelConfigConverter.convert", return_value=mocker.MagicMock())
        mocker.patch(f"{MODULE}.AgentAppGenerateEntity", return_value=mocker.MagicMock())
        mocker.patch(f"{MODULE}.MessageBasedAppQueueManager", return_value=mocker.MagicMock())
        mocker.patch(f"{MODULE}.threading.Thread", return_value=mocker.MagicMock())
        mocker.patch(f"{MODULE}.AgentAppGenerateResponseConverter.convert", return_value={"result": "ok"})
        user = _account()

        generator.generate(
            app_model=app_model,
            user=user,
            args={"query": "hi", "inputs": {}, "conversation_id": "conv"},
            invoke_from=InvokeFrom.WEB_APP,
            streaming=True,
        )

        get_conv.assert_called_once_with(
            app_id="app1",
            conversation_id="conv",
            account_id="user",
            end_user_id=None,
        )
        assert generator._agent_configs.resolve.call_args.kwargs["conversation_id"] == "conv"
        assert "session" not in generator._init_generate_records.call_args.kwargs

    def test_generate_does_not_include_trace_session_id_in_extras(
        self, generator: AgentAppGenerator, mocker: MockerFixture, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Agent scope creation receives only admitted extras, not client session IDs."""
        scope_requests = _record_trace_scope_requests(monkeypatch, _trace_scope())
        app_model = _app()
        user = _account()

        generator._prepare_user_inputs = mocker.MagicMock(return_value={})
        generator._init_generate_records = mocker.MagicMock(return_value=(_conversation(), _message()))
        generator._handle_response = mocker.MagicMock(return_value="raw-response")

        mocker.patch(
            f"{MODULE}.AgentAppConfigManager.get_app_config",
            return_value=mocker.MagicMock(variables=[], tenant_id="tenant", app_id="app1"),
        )
        mocker.patch(f"{MODULE}.ModelConfigConverter.convert", return_value=mocker.MagicMock(model="gpt-4o-mini"))
        generate_entity = mocker.patch(
            f"{MODULE}.AgentAppGenerateEntity", return_value=mocker.MagicMock(task_id="t", user_id="user")
        )
        mocker.patch(f"{MODULE}.MessageBasedAppQueueManager", return_value=mocker.MagicMock())
        mocker.patch(f"{MODULE}.threading.Thread", return_value=mocker.MagicMock())
        mocker.patch(f"{MODULE}.AgentAppGenerateResponseConverter.convert", return_value={"result": "ok"})

        generator.generate(
            app_model=app_model,
            user=user,
            args={"query": "hello", "inputs": {}, "trace_session_id": "session-1"},
            invoke_from=InvokeFrom.WEB_APP,
            streaming=True,
        )

        assert generate_entity.call_args.kwargs["extras"] == {"auto_generate_conversation_name": True}
        assert [request["extras"] for request in scope_requests] == [{"auto_generate_conversation_name": True}]


class TestGenerateWorker:
    @pytest.fixture(autouse=True)
    def patch_context(self, mocker: MockerFixture):
        @contextlib.contextmanager
        def ctx_manager[**P](*args: P.args, **kwargs: P.kwargs):
            yield

        mocker.patch("libs.flask_utils.preserve_flask_contexts", ctx_manager)

    def _wire(
        self,
        generator: AgentAppGenerator,
        mocker: MockerFixture,
        *,
        run_side_effect=None,
        handled=False,
        guard_query="query",
        real_guards=False,
    ):
        mocker.patch.object(generator._records, "load", return_value=(_app(), _conversation(), _message()))
        if not real_guards:
            generator._run_input_guards = mocker.MagicMock(return_value=(handled, guard_query, None))
        session = _session()
        if session.get(App, "app1") is None:
            session.add(_app())
            session.commit()
        mocker.patch(f"{MODULE}.DifyRunContext", return_value=mocker.MagicMock())
        mocker.patch(f"{MODULE}.AgentAppRuntimeRequestBuilder", return_value=mocker.MagicMock())
        mocker.patch(f"{MODULE}.create_agent_backend_run_client", return_value=mocker.MagicMock())
        mocker.patch(f"{MODULE}.AgentBackendRunEventAdapter", return_value=mocker.MagicMock())
        mocker.patch(f"{MODULE}.AgentAppWorkspaceStore", return_value=mocker.MagicMock())
        runner = mocker.MagicMock()
        if run_side_effect is not None:
            runner.run.side_effect = run_side_effect
        mocker.patch(f"{MODULE}.AgentAppRunner", return_value=runner)
        return runner, generator._agent_configs.version

    def _call(
        self,
        generator,
        mocker: MockerFixture,
        queue_manager,
        *,
        query="query",
        session_scope_config_version_id="s",
        files=(),
        file_upload_config=None,
        inputs=None,
    ):
        class _GenerateEntity:
            user_id = "user-1"
            invoke_from = InvokeFrom.WEB_APP

            def __init__(self, **kwargs: object) -> None:
                self.__dict__.update(kwargs)

        class _ModelConf:
            model = "m"

        generator._generate_worker(
            flask_app=mocker.MagicMock(),
            context=mocker.MagicMock(),
            application_generate_entity=_GenerateEntity(
                app_config=_AppConfig(app_id="app1", tenant_id="tenant"),
                agent_id="a",
                agent_config_snapshot_id="s",
                agent_config_version_kind="snapshot",
                agent_session_scope_config_version_id=session_scope_config_version_id,
                model_conf=_ModelConf(),
                query=query,
                inputs=inputs or {},
                trace_scope=_trace_scope(),
                files=files,
                file_upload_config=file_upload_config,
            ),
            queue_manager=queue_manager,
            conversation_id="conv",
            message_id="msg",
            user_from=UserFrom.END_USER,
        )

    def test_happy_path_runs_backend(self, generator: AgentAppGenerator, mocker: MockerFixture):
        runner, resolver_sessions = self._wire(generator, mocker)
        queue_manager = mocker.MagicMock()
        self._call(generator, mocker, queue_manager)
        runner.run.assert_called_once()
        resolver_sessions.assert_called_once_with(
            tenant_id="tenant", app_id="app1", agent_id="a", version_id="s", version_kind="snapshot", account_id=None
        )
        assert runner.run.call_args.kwargs["home_snapshot_id"] == "home-1"
        assert "home_snapshot_ref" not in runner.run.call_args.kwargs
        queue_manager.publish_error.assert_not_called()

    @pytest.mark.parametrize("overridden", [False, True])
    def test_worker_passes_moderated_inputs_to_runner(self, generator, mocker, overridden):
        """Successful moderation reaches the migrated runner with the checked input values."""
        runner, _ = self._wire(generator, mocker, real_guards=True)
        expected = {"name": "[redacted]"} if overridden else {"name": "original"}
        moderation = mocker.patch(
            "core.moderation.input_moderation.InputModeration.check",
            return_value=(overridden, expected, "query"),
        )
        mocker.patch.object(generator._annotations, "query", return_value=None)

        self._call(generator, mocker, mocker.MagicMock(), inputs={"name": "original"})

        assert moderation.call_args.kwargs["inputs"] == {"name": "original"}
        runner.run.assert_called_once()
        assert runner.run.call_args.kwargs["inputs"] == expected

    def test_worker_passes_session_scope_config_version_to_runner(self, generator, mocker: MockerFixture):
        runner, _ = self._wire(generator, mocker)
        queue_manager = mocker.MagicMock()

        self._call(generator, mocker, queue_manager, session_scope_config_version_id=None)

        assert runner.run.call_args.kwargs["agent_config_snapshot_id"] == "s"
        assert runner.run.call_args.kwargs["session_scope_snapshot_id"] is None

    def test_worker_passes_files_to_backend_runner_without_rewriting_query(self, generator, mocker: MockerFixture):
        runner, _ = self._wire(generator, mocker, guard_query="你看得见这张图片吗")
        queue_manager = mocker.MagicMock()
        files = [mocker.MagicMock(), mocker.MagicMock()]

        self._call(
            generator,
            mocker,
            queue_manager,
            query="你看得见这张图片吗",
            files=files,
        )

        assert runner.run.call_args.kwargs["query"] == "你看得见这张图片吗"
        assert runner.run.call_args.kwargs["files"] == files
        assert runner.run.call_args.kwargs["image_detail_config"] is None

    def test_input_guard_short_circuit_skips_backend(self, generator, mocker: MockerFixture):
        runner, _ = self._wire(generator, mocker, handled=True)
        queue_manager = mocker.MagicMock()
        self._call(generator, mocker, queue_manager)
        runner.run.assert_not_called()

    def test_annotation_reply_publishes_after_guard_result(self, generator, mocker: MockerFixture):
        runner, _ = self._wire(generator, mocker, handled=True)
        annotation_reply = MessageAnnotation(
            app_id="app1",
            question="query",
            content="annotated answer",
            account_id="user",
        )
        generator._run_input_guards.return_value = (True, "query", annotation_reply)
        events: list[str] = []
        queue_manager = mocker.MagicMock()

        def guard_result(**_kwargs):
            events.append("queried")
            return True, "query", annotation_reply

        generator._run_input_guards.side_effect = guard_result

        def publish(event, *_args):
            if isinstance(event, QueueAnnotationReplyEvent):
                events.append("publish")

        queue_manager.publish.side_effect = publish

        self._call(generator, mocker, queue_manager)

        assert events == ["queried", "publish"]
        runner.run.assert_not_called()

    def test_generate_task_stopped_is_swallowed(
        self, generator: AgentAppGenerator, mocker: MockerFixture, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A local stop must not fabricate a backend tracing terminal."""
        self._wire(generator, mocker, run_side_effect=GenerateTaskStoppedError())

        def application_tracing_hooks() -> None:
            raise AssertionError("stop intent must not invent a tracing terminal")

        monkeypatch.setattr(module, "application_tracing_hooks", application_tracing_hooks)
        queue_manager = mocker.MagicMock()
        self._call(generator, mocker, queue_manager)
        queue_manager.publish_error.assert_not_called()

    def test_unexpected_error_is_published(self, generator: AgentAppGenerator, mocker: MockerFixture):
        self._wire(generator, mocker, run_side_effect=ValueError("boom"))
        queue_manager = mocker.MagicMock()
        self._call(generator, mocker, queue_manager)
        assert queue_manager.publish_error.called
