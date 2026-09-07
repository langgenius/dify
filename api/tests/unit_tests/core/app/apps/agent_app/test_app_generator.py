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
import json
from decimal import Decimal
from types import SimpleNamespace

import pytest
from pytest_mock import MockerFixture
from sqlalchemy import event
from sqlalchemy.orm import Session

import core.app.apps.agent_app.app_generator as module
from core.app.apps.agent_app.app_generator import (
    AgentAppGenerator,
    AgentAppGeneratorError,
)
from core.app.apps.agent_app.errors import AgentSessionSnapshotIncompatibleError
from core.app.apps.exc import GenerateTaskStoppedError
from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
from core.app.entities.queue_entities import QueueAnnotationReplyEvent
from core.workflow.file_reference import build_file_reference
from models import Account, AppModelConfig
from models.agent import Agent, AgentConfigSnapshot, AgentScope, AgentSource, AgentStatus
from models.agent_config_entities import AgentSoulConfig
from models.enums import AppStatus, ConversationFromSource
from models.model import App, AppMode, Conversation, Message, MessageAnnotation

MODULE = "core.app.apps.agent_app.app_generator"


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
    monkeypatch.setattr(module.db, "session", sqlite_session)
    yield
    _CURRENT_SESSION = None


def _session() -> Session:
    assert _CURRENT_SESSION is not None
    return _CURRENT_SESSION


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
                app_model=_app(),
                user=_account("u"),
                args={},
                invoke_from=InvokeFrom.WEB_APP,
                session=_session(),
                streaming=False,
            )

    def test_requires_query(self, generator: AgentAppGenerator):
        with pytest.raises(AgentAppGeneratorError, match="query is required"):
            generator.generate(
                app_model=_app(),
                user=_account("u"),
                args={"inputs": {}},
                invoke_from=InvokeFrom.WEB_APP,
                session=_session(),
            )

    def test_rejects_blank_query(self, generator: AgentAppGenerator):
        with pytest.raises(AgentAppGeneratorError, match="query is required"):
            generator.generate(
                app_model=_app(),
                user=_account("u"),
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
        app_model = _app(app_model_config_id=config.id)
        user = _account()

        generator._resolve_agent = mocker.MagicMock(return_value=(_agent(), "snap1", "snapshot", AgentSoulConfig()))
        generator._prepare_user_inputs = mocker.MagicMock(return_value={"x": 1})
        generator._init_generate_records = mocker.MagicMock(return_value=(_conversation(), _message()))
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
        assert generate_entity.call_args.kwargs["prompt_file_mappings"] == file_mappings
        assert "agent_runtime_exit_intent" not in generate_entity.call_args.kwargs

    def test_generate_loads_existing_conversation(self, generator: AgentAppGenerator, mocker: MockerFixture):
        app_model = _app()
        generator._resolve_agent = mocker.MagicMock(
            return_value=(_agent(agent_id="a"), "snap1", "snapshot", AgentSoulConfig())
        )
        generator._prepare_user_inputs = mocker.MagicMock(return_value={})
        generator._init_generate_records = mocker.MagicMock(return_value=(_conversation(), _message()))
        generator._handle_response = mocker.MagicMock(return_value="raw")
        get_conv = mocker.patch(f"{MODULE}.ConversationService.get_conversation", return_value=_conversation())
        mocker.patch(f"{MODULE}.AgentAppConfigManager.get_app_config", return_value=mocker.MagicMock(variables=[]))
        mocker.patch(f"{MODULE}.load_annotation_reply_config", return_value={"enabled": False})
        mocker.patch(f"{MODULE}.ModelConfigConverter.convert", return_value=mocker.MagicMock())
        mocker.patch(f"{MODULE}.TraceQueueManager", return_value=mocker.MagicMock())
        mocker.patch(f"{MODULE}.AgentAppGenerateEntity", return_value=mocker.MagicMock())
        mocker.patch(f"{MODULE}.MessageBasedAppQueueManager", return_value=mocker.MagicMock())
        mocker.patch(f"{MODULE}.threading.Thread", return_value=mocker.MagicMock())
        mocker.patch(f"{MODULE}.AgentAppGenerateResponseConverter.convert", return_value={"result": "ok"})
        session = _session()
        user = _account()

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
        app_model = _app()
        user = _account()

        generator._resolve_agent = mocker.MagicMock(return_value=(_agent(), "snap1", "snapshot", AgentSoulConfig()))
        generator._prepare_user_inputs = mocker.MagicMock(return_value={})
        generator._init_generate_records = mocker.MagicMock(return_value=(_conversation(), _message()))
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
        def ctx_manager(*args, **kwargs):
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
        generator._get_conversation = mocker.MagicMock(return_value=_conversation())
        generator._get_message = mocker.MagicMock(return_value=_message())
        generator._run_input_guards = mocker.MagicMock(return_value=(handled, guard_query, None))
        resolved_agent = _agent(agent_id="a")
        resolved_config = _snapshot(snapshot_id="s", agent_id="a")
        resolver_sessions: list[Session] = []

        def resolve_agent_by_id(**kwargs):
            resolver_sessions.append(kwargs["session"])
            return resolved_agent, resolved_config, AgentSoulConfig()

        generator._resolve_agent_by_id = mocker.MagicMock(side_effect=resolve_agent_by_id)
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
        return runner, resolver_sessions

    def _call(
        self,
        generator,
        mocker: MockerFixture,
        queue_manager,
        *,
        is_resume=False,
        query="query",
        session_scope_config_version_id="s",
        prompt_file_mappings=(),
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
                prompt_file_mappings=prompt_file_mappings,
            ),
            queue_manager=queue_manager,
            conversation_id="conv",
            message_id="msg",
            user_from=UserFrom.END_USER,
            is_resume=is_resume,
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

    def test_worker_appends_prompt_files_to_backend_query(self, generator, mocker: MockerFixture):
        runner, _ = self._wire(generator, mocker, guard_query="你看得见这张图片吗")
        queue_manager = mocker.MagicMock()
        file_mappings = [
            {
                "type": "image",
                "transfer_method": "local_file",
                "url": "",
                "upload_file_id": "upload-file-1",
            },
            {
                "type": "document",
                "transfer_method": "remote_url",
                "url": "https://example.com/source.pdf",
                "upload_file_id": "ignored",
            },
        ]
        expected_file_mappings = [
            {
                "transfer_method": "local_file",
                "reference": build_file_reference(record_id="upload-file-1"),
            },
            {
                "transfer_method": "remote_url",
                "url": "https://example.com/source.pdf",
            },
        ]

        self._call(
            generator,
            mocker,
            queue_manager,
            query="你看得见这张图片吗",
            prompt_file_mappings=file_mappings,
        )

        assert runner.run.call_args.kwargs["query"] == (
            "你看得见这张图片吗\nUser provided files: "
            "use dify-agent file download with the listed transfer_method and reference/url "
            "to get the files and investigate them\n"
            f"{json.dumps(expected_file_mappings, ensure_ascii=False, separators=(',', ':'))}"
        )

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

    def test_resume_skips_input_guards_and_consumes_reply(self, generator, mocker: MockerFixture):
        # ENG-638 (review): on resume the replayed query is NOT new end-user input.
        # Input guards must be skipped, even if moderation/annotation would match,
        # so the run continues and the human reply (deferred_tool_results) is used.
        runner, _ = self._wire(generator, mocker, handled=True)  # guards WOULD short-circuit
        queue_manager = mocker.MagicMock()

        self._call(generator, mocker, queue_manager, is_resume=True, query="the approved reply")

        generator._run_input_guards.assert_not_called()
        runner.run.assert_called_once()
        # the replayed paused-turn query flows straight to the runner (snapshot match)
        assert runner.run.call_args.kwargs["query"] == "the approved reply"

    def test_generate_task_stopped_is_swallowed(self, generator, mocker: MockerFixture):
        self._wire(generator, mocker, run_side_effect=GenerateTaskStoppedError())
        queue_manager = mocker.MagicMock()
        self._call(generator, mocker, queue_manager)
        queue_manager.publish_error.assert_not_called()

    def test_unexpected_error_is_published(self, generator: AgentAppGenerator, mocker: MockerFixture):
        self._wire(generator, mocker, run_side_effect=ValueError("boom"))
        queue_manager = mocker.MagicMock()
        self._call(generator, mocker, queue_manager)
        assert queue_manager.publish_error.called

    def test_session_configuration_change_is_published_without_unknown_error_log(
        self,
        generator: AgentAppGenerator,
        mocker: MockerFixture,
    ) -> None:
        error = AgentSessionSnapshotIncompatibleError()
        self._wire(generator, mocker, run_side_effect=error)
        queue_manager = mocker.MagicMock()
        info_log = mocker.patch(f"{MODULE}.logger.info")
        exception_log = mocker.patch(f"{MODULE}.logger.exception")

        self._call(generator, mocker, queue_manager)

        queue_manager.publish_error.assert_called_once_with(error, module.PublishFrom.APPLICATION_MANAGER)
        info_log.assert_called_once()
        exception_log.assert_not_called()


class TestResumeAfterFormSubmission:
    """ENG-638: a resume turn re-sends the paused turn's original query so the
    composition's user-prompt layer matches the suspended snapshot (never blank)."""

    def _wire(self, generator, mocker: MockerFixture):
        generator._resolve_agent = mocker.MagicMock(return_value=(_agent(), "snap1", "draft", AgentSoulConfig()))
        generator._init_generate_records = mocker.MagicMock(return_value=(_conversation(), _message()))
        generator._handle_response = mocker.MagicMock(return_value=None)
        get_conversation = mocker.patch(
            f"{MODULE}.ConversationService.get_conversation",
            return_value=_conversation(),
        )
        mocker.patch(f"{MODULE}.AgentAppConfigManager.get_app_config", return_value=mocker.MagicMock(variables=[]))
        mocker.patch(f"{MODULE}.load_annotation_reply_config", return_value={"enabled": False})
        mocker.patch(f"{MODULE}.ModelConfigConverter.convert", return_value=mocker.MagicMock())
        mocker.patch(f"{MODULE}.TraceQueueManager", return_value=mocker.MagicMock())
        mocker.patch(f"{MODULE}.MessageBasedAppQueueManager", return_value=mocker.MagicMock())
        mocker.patch(f"{MODULE}.threading.Thread", return_value=mocker.MagicMock())
        generator._resolve_resume_draft = mocker.MagicMock(return_value=(None, None))
        return (
            mocker.patch(
                f"{MODULE}.AgentAppGenerateEntity", return_value=mocker.MagicMock(task_id="t", user_id="user")
            ),
            get_conversation,
        )

    def test_resume_resends_paused_turn_query(self, generator, mocker: MockerFixture):
        entity, get_conversation = self._wire(generator, mocker)
        session = _session()
        config = AppModelConfig(app_id="app1")
        config.id = "config-1"
        session.add_all([config, _conversation(), _message(query="original question")])
        session.commit()
        app_model = _app(app_model_config_id=config.id)
        user = _account()

        generator.resume_after_form_submission(
            app_model=app_model,
            user=user,
            conversation_id="conv",
            form_id="form-1",
            invoke_from=InvokeFrom.WEB_APP,
            session=session,
        )

        # The paused turn's query is re-sent verbatim — never blank.
        assert entity.call_args.kwargs["query"] == "original question"
        assert "agent_runtime_exit_intent" not in entity.call_args.kwargs
        get_conversation.assert_called_once_with(
            app_model=app_model,
            conversation_id="conv",
            user=user,
            session=session,
        )
        assert generator._init_generate_records.call_args.kwargs["session"] is session
        assert session.get(AppModelConfig, "config-1") is config
        assert generator._resolve_agent.call_args.kwargs["session"] is session

    def test_resume_falls_back_to_placeholder_when_no_paused_message(self, generator, mocker: MockerFixture):
        entity, _ = self._wire(generator, mocker)
        session = _session()

        generator.resume_after_form_submission(
            app_model=_app(),
            user=_account(),
            conversation_id="conv",
            form_id="form-1",
            invoke_from=InvokeFrom.WEB_APP,
            session=session,
        )

        # No prior user message -> a non-blank placeholder, still never blank.
        assert entity.call_args.kwargs["query"] == "(resumed)"

    def test_resume_uses_build_draft_for_debugger_conversation(self, generator, mocker: MockerFixture):
        self._wire(generator, mocker)
        conversation = _conversation(invoke_from=InvokeFrom.DEBUGGER)
        mocker.patch(f"{MODULE}.ConversationService.get_conversation", return_value=conversation)
        generator._resolve_resume_draft.return_value = ("debug_build", "draft-build-1")
        account_user = Account(name="Test Account", email="test@example.com")
        account_user.id = "user"
        session = _session()
        config = AppModelConfig(app_id="app1")
        config.id = "config-1"
        session.add_all([config, conversation, _message(query="original question")])
        session.commit()
        app_model = _app(app_model_config_id=config.id)

        generator.resume_after_form_submission(
            app_model=app_model,
            user=account_user,
            conversation_id="conv",
            form_id="form-1",
            invoke_from=InvokeFrom.DEBUGGER,
            session=session,
        )

        assert generator._resolve_agent.call_args.kwargs["draft_type"] == "debug_build"
        assert generator._resolve_agent.call_args.kwargs["draft_id"] == "draft-build-1"
        assert generator._resolve_agent.call_args.kwargs["session"] is session
        assert generator._resolve_agent.call_args.kwargs["conversation"] is conversation
