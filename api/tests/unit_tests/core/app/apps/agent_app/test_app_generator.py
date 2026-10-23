from __future__ import annotations

import contextlib
import inspect
from decimal import Decimal
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

import pytest
from pytest_mock import MockerFixture
from sqlalchemy import event, select
from sqlalchemy.orm import Session

import core.app.apps.agent_app.app_generator as module
import core.app.features.annotation_reply.annotation_reply as annotation_mod
import core.moderation.input_moderation as input_moderation_mod
from core.app.apps.agent_app import app_generator
from core.app.apps.agent_app.app_generator import (
    AgentAppGenerator,
    AgentAppGeneratorError,
    AgentAppNotPublishedError,
)
from core.app.apps.exc import GenerateTaskStoppedError
from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
from core.app.entities.queue_entities import (
    QueueAnnotationReplyEvent,
    QueueLLMChunkEvent,
    QueueMessageEndEvent,
)
from core.moderation.base import ModerationError
from models import Account as _app_generator_Account
from models import AppModelConfig
from models.account import Account as _resolve_agent_Account
from models.agent import (
    Agent,
    AgentConfigDraft,
    AgentConfigDraftType,
    AgentConfigSnapshot,
    AgentConfigVersionKind,
    AgentScope,
    AgentSource,
    AgentStatus,
    AgentWorkingResourceStatus,
    AgentWorkspaceBinding,
)
from models.agent_config_entities import AgentSoulConfig
from models.enums import AppStatus, ConversationFromSource
from models.model import App, AppMode, Conversation, Message, MessageAnnotation
from services.agent.workspace_service import (
    AgentWorkspaceBindingGenerationMismatchError,
    AgentWorkspaceService,
)
from tests.helpers.unit.model_factories import make_account, make_app, make_conversation, make_message

"""Unit tests for AgentAppGenerator.generate() and its worker thread.

Mirrors the agent_chat generator tests: every collaborator (config manager,
model converter, queue manager, thread, response converter, the agent backend
client stack) is patched at the module level, the generate entity class is
patched so no real pydantic entity is built, and the worker's flask-context
manager is replaced with a no-op so the thread body can run inline.
"""


MODULE = "core.app.apps.agent_app.app_generator"


def _app_generator_account(user_id: str = "user") -> _app_generator_Account:
    account = _app_generator_Account(name="User", email=f"{user_id}@example.com")
    account.id = user_id
    return account


def _app_generator_app(*, app_model_config_id: str | None = None) -> App:
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


def _app_generator_agent(*, agent_id: str = "agent1") -> Agent:
    return Agent(
        id=agent_id,
        tenant_id="tenant",
        name="Agent",
        scope=AgentScope.ROSTER,
        source=AgentSource.AGENT_APP,
        status=AgentStatus.ACTIVE,
        app_id="app1",
    )


def _app_generator_snapshot(*, snapshot_id: str = "snap1", agent_id: str = "agent1") -> AgentConfigSnapshot:
    return AgentConfigSnapshot(
        id=snapshot_id,
        tenant_id="tenant",
        agent_id=agent_id,
        version=1,
        config_snapshot=AgentSoulConfig(),
        home_snapshot_id="home-1",
    )


def _app_generator_conversation(*, invoke_from: InvokeFrom = InvokeFrom.WEB_APP) -> Conversation:
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


def _app_generator_message(*, query: str = "query") -> Message:
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


def _session() -> Session:
    assert _CURRENT_SESSION is not None
    return _CURRENT_SESSION


class TestAppGeneratorCases:
    @staticmethod
    @pytest.fixture(autouse=True)
    def _bind_real_session(sqlite_session: Session, monkeypatch: pytest.MonkeyPatch):
        global _CURRENT_SESSION
        _CURRENT_SESSION = sqlite_session
        monkeypatch.setattr(module.db, "session", sqlite_session)
        yield
        _CURRENT_SESSION = None

    @staticmethod
    @pytest.fixture
    def generator(mocker: MockerFixture) -> AgentAppGenerator:
        gen = AgentAppGenerator()
        mocker.patch(f"{MODULE}.current_app", new=mocker.MagicMock(_get_current_object=mocker.MagicMock()))
        mocker.patch(f"{MODULE}.contextvars.copy_context", return_value="ctx")
        return gen

    class TestGenerateGuards:
        def test_rejects_blocking_mode(self, generator: AgentAppGenerator):
            with pytest.raises(AgentAppGeneratorError, match="only supports streaming"):
                generator.generate(
                    app_model=_app_generator_app(),
                    user=_app_generator_account("u"),
                    args={},
                    invoke_from=InvokeFrom.WEB_APP,
                    session=_session(),
                    streaming=False,
                )

        def test_requires_query(self, generator: AgentAppGenerator):
            with pytest.raises(AgentAppGeneratorError, match="query is required"):
                generator.generate(
                    app_model=_app_generator_app(),
                    user=_app_generator_account("u"),
                    args={"inputs": {}},
                    invoke_from=InvokeFrom.WEB_APP,
                    session=_session(),
                )

        def test_rejects_blank_query(self, generator: AgentAppGenerator):
            with pytest.raises(AgentAppGeneratorError, match="query is required"):
                generator.generate(
                    app_model=_app_generator_app(),
                    user=_app_generator_account("u"),
                    args={"query": "   ", "inputs": {}},
                    invoke_from=InvokeFrom.WEB_APP,
                    session=_session(),
                )

    class TestGenerateSuccess:
        def test_session_scope_config_version_id_preserves_draft_or_snapshot_id(self):
            assert (
                AgentAppGenerator._session_scope_config_version_id(
                    invoke_from=InvokeFrom.DEBUGGER, config_version_id="draft-1"
                )
                == "draft-1"
            )
            assert (
                AgentAppGenerator._session_scope_config_version_id(
                    invoke_from=InvokeFrom.WEB_APP, config_version_id="snapshot-1"
                )
                == "snapshot-1"
            )

        def test_generate_orchestrates_and_starts_worker(self, generator, mocker: MockerFixture):
            config = AppModelConfig(app_id="app1")
            config.id = "config-1"
            session = _session()
            session.add(config)
            session.commit()
            app_model = _app_generator_app(app_model_config_id=config.id)
            user = _app_generator_account()

            generator._resolve_agent = mocker.MagicMock(
                return_value=(_app_generator_agent(), "snap1", "snapshot", AgentSoulConfig())
            )
            generator._prepare_user_inputs = mocker.MagicMock(return_value={"x": 1})
            generator._init_generate_records = mocker.MagicMock(
                return_value=(_app_generator_conversation(), _app_generator_message())
            )
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
            mocker.patch(f"{MODULE}.TraceQueueManager", return_value=mocker.MagicMock())
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
                session=session,
                streaming=True,
            )

            assert result == {"result": "ok"}
            thread_obj.start.assert_called_once()
            worker_call = thread_constructor.call_args
            inspect.signature(worker_call.kwargs["target"]).bind(**worker_call.kwargs["kwargs"])
            generator._resolve_agent.assert_called_once_with(
                app_model,
                invoke_from=InvokeFrom.WEB_APP,
                draft_type=None,
                user=user,
                session=session,
                conversation=None,
            )
            assert session.get(AppModelConfig, "config-1") is config
            build_files.assert_called_once()
            assert build_files.call_args.kwargs["mappings"] == file_mappings
            assert generate_entity.call_args.kwargs["files"] == [parsed_file]
            assert generate_entity.call_args.kwargs["file_upload_config"] is file_upload_config
            assert "agent_runtime_exit_intent" not in generate_entity.call_args.kwargs

        def test_generate_loads_existing_conversation(self, generator: AgentAppGenerator, mocker: MockerFixture):
            app_model = _app_generator_app()
            generator._resolve_agent = mocker.MagicMock(
                return_value=(_app_generator_agent(agent_id="a"), "snap1", "snapshot", AgentSoulConfig())
            )
            generator._prepare_user_inputs = mocker.MagicMock(return_value={})
            generator._init_generate_records = mocker.MagicMock(
                return_value=(_app_generator_conversation(), _app_generator_message())
            )
            generator._handle_response = mocker.MagicMock(return_value="raw")
            get_conv = mocker.patch(
                f"{MODULE}.ConversationService.get_conversation", return_value=_app_generator_conversation()
            )
            mocker.patch(f"{MODULE}.AgentAppConfigManager.get_app_config", return_value=mocker.MagicMock(variables=[]))
            mocker.patch(f"{MODULE}.load_annotation_reply_config", return_value={"enabled": False})
            mocker.patch(f"{MODULE}.ModelConfigConverter.convert", return_value=mocker.MagicMock())
            mocker.patch(f"{MODULE}.TraceQueueManager", return_value=mocker.MagicMock())
            mocker.patch(f"{MODULE}.AgentAppGenerateEntity", return_value=mocker.MagicMock())
            mocker.patch(f"{MODULE}.MessageBasedAppQueueManager", return_value=mocker.MagicMock())
            mocker.patch(f"{MODULE}.threading.Thread", return_value=mocker.MagicMock())
            mocker.patch(f"{MODULE}.AgentAppGenerateResponseConverter.convert", return_value={"result": "ok"})
            session = _session()
            user = _app_generator_account()

            generator.generate(
                app_model=app_model,
                user=user,
                args={"query": "hi", "inputs": {}, "conversation_id": "conv"},
                invoke_from=InvokeFrom.WEB_APP,
                session=session,
                streaming=True,
            )

            get_conv.assert_called_once_with(
                app_model=app_model,
                conversation_id="conv",
                user=user,
                session=session,
            )
            assert generator._resolve_agent.call_args.kwargs["conversation"].id == "conv"
            assert generator._init_generate_records.call_args.kwargs["session"] is session

        def test_generate_does_not_include_trace_session_id_in_extras(
            self, generator: AgentAppGenerator, mocker: MockerFixture
        ):
            app_model = _app_generator_app()
            user = _app_generator_account()

            generator._resolve_agent = mocker.MagicMock(
                return_value=(_app_generator_agent(), "snap1", "snapshot", AgentSoulConfig())
            )
            generator._prepare_user_inputs = mocker.MagicMock(return_value={})
            generator._init_generate_records = mocker.MagicMock(
                return_value=(_app_generator_conversation(), _app_generator_message())
            )
            generator._handle_response = mocker.MagicMock(return_value="raw-response")

            mocker.patch(
                f"{MODULE}.AgentAppConfigManager.get_app_config",
                return_value=mocker.MagicMock(variables=[], tenant_id="tenant", app_id="app1"),
            )
            mocker.patch(f"{MODULE}.ModelConfigConverter.convert", return_value=mocker.MagicMock(model="gpt-4o-mini"))
            mocker.patch(f"{MODULE}.TraceQueueManager", return_value=mocker.MagicMock())
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
                session=_session(),
                streaming=True,
            )

            assert generate_entity.call_args.kwargs["extras"] == {"auto_generate_conversation_name": True}

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
        ):
            generator._get_conversation = mocker.MagicMock(return_value=_app_generator_conversation())
            generator._get_message = mocker.MagicMock(return_value=_app_generator_message())
            generator._run_input_guards = mocker.MagicMock(return_value=(handled, guard_query, None))
            resolved_agent = _app_generator_agent(agent_id="a")
            resolved_config = _app_generator_snapshot(snapshot_id="s", agent_id="a")
            resolver_sessions: list[Session] = []

            def resolve_agent_by_id(**kwargs):
                resolver_sessions.append(kwargs["session"])
                return resolved_agent, resolved_config, AgentSoulConfig()

            generator._resolve_agent_by_id = mocker.MagicMock(side_effect=resolve_agent_by_id)
            session = _session()
            if session.get(App, "app1") is None:
                session.add(_app_generator_app())
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
            return runner, resolver_sessions

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
        ):
            generator._generate_worker(
                flask_app=mocker.MagicMock(),
                context=mocker.MagicMock(),
                application_generate_entity=mocker.MagicMock(
                    app_config=SimpleNamespace(app_id="app1", tenant_id="tenant"),
                    agent_id="a",
                    agent_config_snapshot_id="s",
                    agent_session_scope_config_version_id=session_scope_config_version_id,
                    model_conf=mocker.MagicMock(model="m"),
                    query=query,
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
            assert resolver_sessions == [generator._resolve_agent_by_id.call_args.kwargs["session"]]
            assert resolver_sessions[0].get_bind() is not None
            assert runner.run.call_args.kwargs["home_snapshot_id"] == "home-1"
            assert "home_snapshot_ref" not in runner.run.call_args.kwargs
            queue_manager.publish_error.assert_not_called()

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

        def test_annotation_reply_publishes_after_guard_transaction_commits(self, generator, mocker: MockerFixture):
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

            def record_commit(_session: Session) -> None:
                events.append("commit")

            def publish(event, *_args):
                if isinstance(event, QueueAnnotationReplyEvent):
                    events.append("publish")

            queue_manager.publish.side_effect = publish

            event.listen(type(_session()), "after_commit", record_commit)
            try:
                self._call(generator, mocker, queue_manager)
            finally:
                event.remove(type(_session()), "after_commit", record_commit)

            assert events == ["commit", "publish"]
            runner.run.assert_not_called()

        def test_generate_task_stopped_is_swallowed(self, generator, mocker: MockerFixture):
            self._wire(generator, mocker, run_side_effect=GenerateTaskStoppedError())
            # A locally stopped consumer does not prove runtime cancellation. The
            # runner must hand off the typed terminal it actually observed.
            mocker.patch(
                "core.ops.base_trace_instance.application_tracing_hooks",
                side_effect=AssertionError("stop intent must not invent a tracing terminal"),
            )
            queue_manager = mocker.MagicMock()
            self._call(generator, mocker, queue_manager)
            queue_manager.publish_error.assert_not_called()

        def test_unexpected_error_is_published(self, generator: AgentAppGenerator, mocker: MockerFixture):
            self._wire(generator, mocker, run_side_effect=ValueError("boom"))
            queue_manager = mocker.MagicMock()
            self._call(generator, mocker, queue_manager)
            assert queue_manager.publish_error.called


"""Unit tests for AgentAppGenerator._run_input_guards.

The guards apply content moderation + annotation reply before the Agent backend
call, mirroring the EasyUI chat runners. They can short-circuit the turn (a
blocked/preset moderation answer or a matched annotation) and publish a direct
answer, or pass through a possibly moderation-sanitized query.
"""


class _FakeQueueManager:
    def __init__(self) -> None:
        self.events: list[Any] = []

    def publish(self, event: Any, _from: Any) -> None:
        self.events.append(event)


def _make_entity(query: str = "hello") -> SimpleNamespace:
    return SimpleNamespace(
        app_config=SimpleNamespace(app_id="app-1", tenant_id="tenant-1"),
        model_conf=SimpleNamespace(model="gpt-4o-mini"),
        inputs={},
        query=query,
        trace_manager=None,
        user_id="user-1",
        invoke_from=SimpleNamespace(),
    )


def _input_guards_app() -> App:
    return make_app(name="Agent App", mode=AppMode.AGENT_CHAT, icon_type=None)


def _input_guards_message() -> Message:
    return make_message(message_id="msg-1")


def _patch_moderation(monkeypatch: pytest.MonkeyPatch, *, returns=None, raises: Exception | None = None) -> None:
    class _FakeModeration:
        def check(self, **kwargs: Any):
            if raises is not None:
                raise raises
            return returns

    monkeypatch.setattr(input_moderation_mod, "InputModeration", _FakeModeration)


def _patch_annotation(monkeypatch: pytest.MonkeyPatch, *, reply=None) -> None:
    class _FakeAnnotation:
        def query(self, **kwargs: Any):
            return reply

    monkeypatch.setattr(annotation_mod, "AnnotationReplyFeature", _FakeAnnotation)


def _answer_text(events: list[Any]) -> str:
    end = next(e for e in events if isinstance(e, QueueMessageEndEvent))
    return end.llm_result.message.content


def _saved_user_query(events: list[Any]) -> str:
    end = next(e for e in events if isinstance(e, QueueMessageEndEvent))
    prompt_messages = end.llm_result.prompt_messages
    assert len(prompt_messages) == 1
    return prompt_messages[0].content


class TestInputGuardsCases:
    class TestRunInputGuards:
        def test_no_guards_passes_through(self, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session):
            _patch_moderation(monkeypatch, returns=(False, {}, "hello"))
            _patch_annotation(monkeypatch, reply=None)
            qm = _FakeQueueManager()

            handled, query, annotation_reply = AgentAppGenerator()._run_input_guards(
                session=sqlite_session,
                application_generate_entity=_make_entity("hello"),
                app_model=_input_guards_app(),
                message=_input_guards_message(),
                queue_manager=qm,
            )

            assert handled is False
            assert query == "hello"
            assert annotation_reply is None
            assert qm.events == []

        def test_moderation_override_sanitizes_query(self, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session):
            _patch_moderation(monkeypatch, returns=(True, {}, "[redacted]"))
            _patch_annotation(monkeypatch, reply=None)
            qm = _FakeQueueManager()

            handled, query, annotation_reply = AgentAppGenerator()._run_input_guards(
                session=sqlite_session,
                application_generate_entity=_make_entity("leak my secret"),
                app_model=_input_guards_app(),
                message=_input_guards_message(),
                queue_manager=qm,
            )

            assert handled is False
            assert query == "[redacted]"
            assert annotation_reply is None
            assert qm.events == []

        def test_moderation_block_short_circuits(self, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session):
            _patch_moderation(monkeypatch, raises=ModerationError("blocked preset answer"))
            _patch_annotation(monkeypatch, reply=None)
            qm = _FakeQueueManager()

            handled, _, annotation_reply = AgentAppGenerator()._run_input_guards(
                session=sqlite_session,
                application_generate_entity=_make_entity("forbidden"),
                app_model=_input_guards_app(),
                message=_input_guards_message(),
                queue_manager=qm,
            )

            assert handled is True
            assert annotation_reply is None
            assert any(isinstance(e, QueueLLMChunkEvent) for e in qm.events)
            assert _answer_text(qm.events) == "blocked preset answer"
            assert _saved_user_query(qm.events) == "forbidden"

        def test_annotation_hit_short_circuits(self, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session):
            _patch_moderation(monkeypatch, returns=(False, {}, "what is your name"))
            annotation = MessageAnnotation(
                app_id="app-1",
                question="what is your name",
                content="I am the annotated Iris.",
                account_id="account-1",
            )
            annotation.id = "anno-1"
            _patch_annotation(monkeypatch, reply=annotation)
            qm = _FakeQueueManager()

            handled, _, annotation_reply = AgentAppGenerator()._run_input_guards(
                session=sqlite_session,
                application_generate_entity=_make_entity("what is your name"),
                app_model=_input_guards_app(),
                message=_input_guards_message(),
                queue_manager=qm,
            )

            assert handled is True
            assert annotation_reply.id == "anno-1"
            assert qm.events == []


"""Unit tests for AgentAppGenerator agent/snapshot resolution.

Covers the DB-backed resolution helpers (the bound roster Agent + its published
Agent Soul snapshot) including every not-found error path, using persisted rows
in the shared SQLite test database.
"""


_SOUL_DICT = {
    "model": {
        "plugin_id": "langgenius/openai",
        "model_provider": "langgenius/openai/openai",
        "model": "gpt-4o-mini",
    },
    "prompt": {"system_prompt": "You are Iris."},
}


def _resolve_agent_agent(
    *,
    agent_id: str = "agent-1",
    scope: AgentScope = AgentScope.ROSTER,
    source: AgentSource = AgentSource.AGENT_APP,
    active_snapshot_id: str | None = "snap-1",
    published: bool = True,
) -> Agent:
    return Agent(
        id=agent_id,
        tenant_id="t1",
        name=f"Agent {agent_id}",
        scope=scope,
        source=source,
        app_id="app-1" if scope == AgentScope.ROSTER else None,
        backing_app_id="app-1" if scope == AgentScope.WORKFLOW_ONLY else None,
        active_config_snapshot_id=active_snapshot_id,
        active_config_has_model=True,
        active_config_is_published=published,
        created_by="creator-1",
        updated_by="updater-1",
    )


def _resolve_agent_snapshot(
    *, snapshot_id: str = "snap-1", agent_id: str = "agent-1", home_snapshot_id: str = "home-1"
) -> AgentConfigSnapshot:
    return AgentConfigSnapshot(
        id=snapshot_id,
        tenant_id="t1",
        agent_id=agent_id,
        version=1,
        config_snapshot=AgentSoulConfig.model_validate(_SOUL_DICT),
        home_snapshot_id=home_snapshot_id,
        created_by="creator-1",
    )


def _resolve_agent_app() -> App:
    return make_app(
        tenant_id="t1",
        name="Agent App",
        mode=AppMode.AGENT_CHAT,
        icon_type=None,
        enable_site=False,
        enable_api=False,
    )


def _resolve_agent_account() -> _resolve_agent_Account:
    return make_account(account_id="user-1", name="Agent User", email="agent-user@example.com")


def _resolve_agent_conversation(*, binding_id: str) -> Conversation:
    return make_conversation(agent_workspace_binding_id=binding_id)


def _binding(
    *,
    home_snapshot_id: str = "home-1",
    version_id: str = "snap-1",
    version_kind: AgentConfigVersionKind = AgentConfigVersionKind.SNAPSHOT,
) -> AgentWorkspaceBinding:
    return AgentWorkspaceBinding(
        id="binding-1",
        tenant_id="t1",
        app_id="app-1",
        workspace_id="workspace-1",
        agent_id="agent-1",
        base_home_snapshot_id=home_snapshot_id,
        agent_config_version_id=version_id,
        agent_config_version_kind=version_kind,
        backend_binding_ref="backend-binding-1",
        status=AgentWorkingResourceStatus.ACTIVE,
    )


def _persist(session: Session, *models: object) -> None:
    session.add_all(models)
    session.commit()


class TestResolveAgentCases:
    class TestResolveAgentById:
        def test_success_returns_agent_snapshot_soul(self, sqlite_session: Session):
            agent = _resolve_agent_agent()
            snapshot = _resolve_agent_snapshot()
            sqlite_session.add_all([agent, snapshot])
            sqlite_session.commit()

            resolved_agent, resolved_snapshot, soul = AgentAppGenerator._resolve_agent_by_id(
                tenant_id="t1", agent_id="agent-1", snapshot_id="snap-1", session=sqlite_session
            )

            assert resolved_agent is agent
            assert resolved_snapshot is snapshot
            assert soul.prompt.system_prompt == "You are Iris."
            assert soul.model is not None
            assert soul.model.model == "gpt-4o-mini"

        def test_agent_missing_raises(self, sqlite_session: Session):
            with pytest.raises(AgentAppGeneratorError, match="Agent not found"):
                AgentAppGenerator._resolve_agent_by_id(
                    tenant_id="t1", agent_id="x", snapshot_id="snap-1", session=sqlite_session
                )

        def test_no_published_version_raises(self, sqlite_session: Session):
            sqlite_session.add(_resolve_agent_agent(active_snapshot_id=None))
            sqlite_session.commit()
            with pytest.raises(AgentAppGeneratorError, match="no published version"):
                AgentAppGenerator._resolve_agent_by_id(
                    tenant_id="t1", agent_id="agent-1", snapshot_id=None, session=sqlite_session
                )

        def test_snapshot_missing_raises(self, sqlite_session: Session):
            sqlite_session.add(_resolve_agent_agent())
            sqlite_session.commit()
            with pytest.raises(AgentAppGeneratorError, match="published version not found"):
                AgentAppGenerator._resolve_agent_by_id(
                    tenant_id="t1",
                    agent_id="agent-1",
                    snapshot_id="snap-1",
                    session=sqlite_session,
                )

    class TestResolveDebugDraft:
        def test_missing_shared_draft_is_created_with_supplied_session(self, sqlite_session: Session):
            agent = _resolve_agent_agent()
            sqlite_session.add_all([agent, _resolve_agent_snapshot()])
            sqlite_session.commit()
            flush_count = 0

            def _record_flush(_session: Session, _context: object) -> None:
                nonlocal flush_count
                flush_count += 1

            event.listen(sqlite_session, "after_flush", _record_flush)

            draft = AgentAppGenerator._resolve_debug_draft(
                tenant_id="t1",
                agent=agent,
                draft_type=None,
                draft_id=None,
                account_id=None,
                session=sqlite_session,
            )

            assert draft.draft_type == AgentConfigDraftType.DRAFT
            assert draft.base_snapshot_id == "snap-1"
            assert sqlite_session.scalar(select(AgentConfigDraft).where(AgentConfigDraft.id == draft.id)) is draft
            assert flush_count == 1

        def test_stale_workflow_only_shared_draft_is_rebased_to_active_snapshot(self, sqlite_session: Session):
            agent = _resolve_agent_agent(scope=AgentScope.WORKFLOW_ONLY, active_snapshot_id="snap-2")
            draft = AgentConfigDraft(
                id="draft-1",
                tenant_id="t1",
                agent_id="agent-1",
                draft_type=AgentConfigDraftType.DRAFT,
                account_id=None,
                draft_owner_key="",
                base_snapshot_id="snap-1",
                home_snapshot_id="home-1",
                config_snapshot=AgentSoulConfig.model_validate({"prompt": {"system_prompt": "old"}}),
            )
            active_snapshot = AgentConfigSnapshot(
                id="snap-2",
                tenant_id="t1",
                agent_id="agent-1",
                version=2,
                config_snapshot=AgentSoulConfig.model_validate({"prompt": {"system_prompt": "new"}}),
                home_snapshot_id="home-2",
                created_by="creator-1",
            )
            sqlite_session.add_all([agent, draft, active_snapshot])
            sqlite_session.commit()
            flush_count = 0

            def _record_flush(_session: Session, _context: object) -> None:
                nonlocal flush_count
                flush_count += 1

            event.listen(sqlite_session, "after_flush", _record_flush)

            resolved = AgentAppGenerator._resolve_debug_draft(
                tenant_id="t1",
                agent=agent,
                draft_type=None,
                account_id=None,
                session=sqlite_session,
            )

            assert resolved is draft
            assert resolved.id == "draft-1"
            assert resolved.base_snapshot_id == "snap-2"
            assert resolved.home_snapshot_id == "home-2"
            assert resolved.config_snapshot_dict["prompt"]["system_prompt"] == "new"
            assert flush_count == 1

        def test_build_draft_is_not_rebased_to_active_snapshot(self, sqlite_session: Session):
            agent = _resolve_agent_agent(scope=AgentScope.WORKFLOW_ONLY, active_snapshot_id="snap-2")
            draft = AgentConfigDraft(
                id="build-draft-1",
                tenant_id="t1",
                agent_id="agent-1",
                draft_type=AgentConfigDraftType.DEBUG_BUILD,
                account_id="account-1",
                draft_owner_key="account-1",
                base_snapshot_id="snap-1",
                home_snapshot_id="home-build",
                config_snapshot=AgentSoulConfig.model_validate({"prompt": {"system_prompt": "build edit"}}),
            )
            sqlite_session.add_all([agent, draft])
            sqlite_session.commit()

            resolved = AgentAppGenerator._resolve_debug_draft(
                tenant_id="t1",
                agent=agent,
                draft_type=AgentConfigDraftType.DEBUG_BUILD.value,
                account_id="account-1",
                session=sqlite_session,
            )

            assert resolved is draft
            assert resolved.base_snapshot_id == "snap-1"
            assert resolved.config_snapshot_dict["prompt"]["system_prompt"] == "build edit"
            assert not sqlite_session.dirty

        def test_build_draft_uses_exact_draft_id(self, sqlite_session: Session):
            agent = _resolve_agent_agent(scope=AgentScope.WORKFLOW_ONLY, active_snapshot_id="snap-2")
            draft = AgentConfigDraft(
                id="exact-build-draft",
                tenant_id="t1",
                agent_id="agent-1",
                draft_type=AgentConfigDraftType.DEBUG_BUILD,
                account_id="account-1",
                draft_owner_key="account-1",
                base_snapshot_id="snap-1",
                home_snapshot_id="home-build",
                config_snapshot=AgentSoulConfig(),
            )
            newer_decoy = AgentConfigDraft(
                id="newer-build-draft",
                tenant_id="t1",
                agent_id="agent-1",
                draft_type=AgentConfigDraftType.DEBUG_BUILD,
                account_id="account-1",
                draft_owner_key="account-1-decoy",
                base_snapshot_id="snap-2",
                home_snapshot_id="home-decoy",
                config_snapshot=AgentSoulConfig(prompt={"system_prompt": "decoy"}),
            )
            sqlite_session.add_all([agent, draft, newer_decoy])
            sqlite_session.commit()

            resolved = AgentAppGenerator._resolve_debug_draft(
                tenant_id="t1",
                agent=agent,
                draft_type=AgentConfigDraftType.DEBUG_BUILD.value,
                draft_id="exact-build-draft",
                account_id="account-1",
                session=sqlite_session,
            )

            assert resolved is draft
            assert resolved.id == "exact-build-draft"

    class TestResolveAgent:
        @pytest.fixture(autouse=True)
        def _publish_visibility(self, monkeypatch: pytest.MonkeyPatch) -> None:
            def is_publish_visible(*, agent: Agent, **_kwargs: object) -> bool:
                return agent.active_config_is_published

            monkeypatch.setattr(
                app_generator,
                "agent_has_workflow_callable_active_snapshot",
                is_publish_visible,
            )

        def test_success_chains_to_resolve_by_id(self, sqlite_session: Session):
            bound_agent = _resolve_agent_agent()
            snapshot = _resolve_agent_snapshot()
            _persist(sqlite_session, bound_agent, snapshot)
            app_model = _resolve_agent_app()

            agent, config_id, config_version_kind, soul = AgentAppGenerator()._resolve_agent(
                app_model,
                invoke_from=InvokeFrom.WEB_APP,
                draft_type=None,
                user=_resolve_agent_account(),
                session=sqlite_session,
            )

            assert agent is bound_agent
            assert config_id == snapshot.id
            assert config_version_kind == "snapshot"
            assert soul.model is not None

        def test_unpublished_draft_still_resolves_active_snapshot(
            self, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
        ):
            bound_agent = _resolve_agent_agent(published=False)
            snapshot = _resolve_agent_snapshot()
            _persist(sqlite_session, bound_agent, snapshot)
            app_model = _resolve_agent_app()
            monkeypatch.setattr(app_generator, "agent_has_workflow_callable_active_snapshot", lambda **_kwargs: True)

            agent, config_id, config_version_kind, soul = AgentAppGenerator()._resolve_agent(
                app_model,
                invoke_from=InvokeFrom.WEB_APP,
                draft_type=None,
                user=_resolve_agent_account(),
                session=sqlite_session,
            )

            assert agent is bound_agent
            assert config_id == snapshot.id
            assert config_version_kind == "snapshot"
            assert soul.prompt.system_prompt == "You are Iris."

        def test_existing_conversation_resolves_binding_snapshot_instead_of_latest_active_snapshot(
            self, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
        ):
            bound_agent = _resolve_agent_agent(active_snapshot_id="snap-2")
            pinned_snapshot = _resolve_agent_snapshot()
            _persist(sqlite_session, bound_agent, pinned_snapshot)
            conversation = _resolve_agent_conversation(binding_id="binding-1")
            binding = _binding()
            get_active_binding = MagicMock(return_value=binding)
            validate_generation = MagicMock()
            monkeypatch.setattr(AgentWorkspaceService, "get_active_binding", get_active_binding)
            monkeypatch.setattr(AgentWorkspaceService, "validate_binding_generation", validate_generation)
            app_model = _resolve_agent_app()

            _, config_id, config_version_kind, soul = AgentAppGenerator()._resolve_agent(
                app_model,
                invoke_from=InvokeFrom.WEB_APP,
                draft_type=None,
                user=_resolve_agent_account(),
                session=sqlite_session,
                conversation=conversation,
            )

            assert config_id == "snap-1"
            assert config_version_kind == "snapshot"
            assert soul.prompt.system_prompt == "You are Iris."
            assert get_active_binding.call_args.kwargs["binding_id"] == "binding-1"
            validate_generation.assert_called_once_with(
                binding,
                base_home_snapshot_id="home-1",
                agent_config_version_id="snap-1",
                agent_config_version_kind=AgentConfigVersionKind.SNAPSHOT,
            )

        def test_existing_conversation_rejects_unavailable_binding(
            self, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
        ):
            bound_agent = _resolve_agent_agent(active_snapshot_id="snap-active")
            _persist(sqlite_session, bound_agent)
            conversation = _resolve_agent_conversation(binding_id="binding-missing")
            monkeypatch.setattr(AgentWorkspaceService, "get_active_binding", MagicMock(return_value=None))

            with pytest.raises(AgentAppGeneratorError, match="Conversation participant Binding is unavailable"):
                AgentAppGenerator()._resolve_agent(
                    _resolve_agent_app(),
                    invoke_from=InvokeFrom.WEB_APP,
                    draft_type=None,
                    user=_resolve_agent_account(),
                    session=sqlite_session,
                    conversation=conversation,
                )

        @pytest.mark.parametrize(
            ("binding_home_id", "binding_version_kind", "snapshot_home_id"),
            [
                ("home-binding", AgentConfigVersionKind.SNAPSHOT, "home-other"),
                ("home-pinned", AgentConfigVersionKind.DRAFT, "home-pinned"),
            ],
        )
        def test_existing_conversation_generation_mismatch_does_not_fallback_to_active_snapshot(
            self,
            monkeypatch: pytest.MonkeyPatch,
            sqlite_session: Session,
            binding_home_id: str,
            binding_version_kind: AgentConfigVersionKind,
            snapshot_home_id: str,
        ):
            bound_agent = _resolve_agent_agent(active_snapshot_id="snap-active")
            conversation = _resolve_agent_conversation(binding_id="binding-1")
            binding = _binding(
                home_snapshot_id=binding_home_id,
                version_id="snap-pinned",
                version_kind=binding_version_kind,
            )
            pinned_snapshot = _resolve_agent_snapshot(snapshot_id="snap-pinned", home_snapshot_id=snapshot_home_id)
            _persist(sqlite_session, bound_agent, pinned_snapshot)
            monkeypatch.setattr(AgentWorkspaceService, "get_active_binding", MagicMock(return_value=binding))

            with pytest.raises(AgentWorkspaceBindingGenerationMismatchError):
                AgentAppGenerator()._resolve_agent(
                    _resolve_agent_app(),
                    invoke_from=InvokeFrom.WEB_APP,
                    draft_type=None,
                    user=_resolve_agent_account(),
                    session=sqlite_session,
                    conversation=conversation,
                )

        def test_unpublished_imported_agent_is_not_available_to_public_runtime(self, sqlite_session: Session):
            bound_agent = _resolve_agent_agent(source=AgentSource.IMPORTED, published=False)
            _persist(sqlite_session, bound_agent)
            app_model = _resolve_agent_app()

            with pytest.raises(AgentAppNotPublishedError, match="not been published"):
                AgentAppGenerator()._resolve_agent(
                    app_model,
                    invoke_from=InvokeFrom.WEB_APP,
                    draft_type=None,
                    user=_resolve_agent_account(),
                    session=sqlite_session,
                )

        def test_never_published_agent_app_is_not_available_to_public_runtime(self, sqlite_session: Session):
            bound_agent = _resolve_agent_agent(published=False)
            _persist(sqlite_session, bound_agent)

            with pytest.raises(AgentAppNotPublishedError, match="not been published"):
                AgentAppGenerator()._resolve_agent(
                    _resolve_agent_app(),
                    invoke_from=InvokeFrom.WEB_APP,
                    draft_type=None,
                    user=_resolve_agent_account(),
                    session=sqlite_session,
                )

        def test_unpublished_imported_agent_remains_available_to_debugger(self, sqlite_session: Session):
            bound_agent = _resolve_agent_agent(source=AgentSource.IMPORTED, published=False)
            draft = AgentConfigDraft(
                id="draft-1",
                tenant_id="t1",
                agent_id="agent-1",
                draft_type=AgentConfigDraftType.DRAFT,
                account_id=None,
                draft_owner_key="",
                base_snapshot_id="snap-1",
                home_snapshot_id="home-1",
                config_snapshot=AgentSoulConfig.model_validate(_SOUL_DICT),
            )
            _persist(sqlite_session, bound_agent, draft)
            app_model = _resolve_agent_app()

            agent, config_id, config_version_kind, soul = AgentAppGenerator()._resolve_agent(
                app_model,
                invoke_from=InvokeFrom.DEBUGGER,
                draft_type=None,
                user=_resolve_agent_account(),
                session=sqlite_session,
            )

            assert agent is bound_agent
            assert config_id == draft.id
            assert config_version_kind == "draft"
            assert soul.prompt.system_prompt == "You are Iris."

        def test_agent_without_active_snapshot_raises_before_model_resolution(self, sqlite_session: Session):
            bound_agent = _resolve_agent_agent(active_snapshot_id=None, published=False)
            _persist(sqlite_session, bound_agent)
            app_model = _resolve_agent_app()

            with pytest.raises(AgentAppNotPublishedError, match="not been published"):
                AgentAppGenerator()._resolve_agent(
                    app_model,
                    invoke_from=InvokeFrom.WEB_APP,
                    draft_type=None,
                    user=_resolve_agent_account(),
                    session=sqlite_session,
                )

        def test_unbound_app_raises(self, sqlite_session: Session):
            app_model = _resolve_agent_app()
            with pytest.raises(AgentAppGeneratorError, match="has no bound Agent"):
                AgentAppGenerator()._resolve_agent(
                    app_model,
                    invoke_from=InvokeFrom.WEB_APP,
                    draft_type=None,
                    user=_resolve_agent_account(),
                    session=sqlite_session,
                )
