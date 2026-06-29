"""Unit tests for AgentAppGenerator.generate() and its worker thread.

Mirrors the agent_chat generator tests: every collaborator (config manager,
model converter, queue manager, thread, response converter, the agent backend
client stack) is patched at the module level, the generate entity class is
patched so no real pydantic entity is built, and the worker's flask-context
manager is replaced with a no-op so the thread body can run inline.
"""

from __future__ import annotations

import contextlib

import pytest
from pytest_mock import MockerFixture

from core.app.apps.agent_app.app_generator import AgentAppGenerator, AgentAppGeneratorError
from core.app.apps.exc import GenerateTaskStoppedError
from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom

MODULE = "core.app.apps.agent_app.app_generator"


class DummyAccount:
    def __init__(self, user_id: str) -> None:
        self.id = user_id
        self.session_id = f"session-{user_id}"


@pytest.fixture
def generator(mocker: MockerFixture) -> AgentAppGenerator:
    gen = AgentAppGenerator()
    mocker.patch(f"{MODULE}.current_app", new=mocker.MagicMock(_get_current_object=mocker.MagicMock()))
    mocker.patch(f"{MODULE}.contextvars.copy_context", return_value="ctx")
    return gen


class TestGenerateGuards:
    def test_rejects_blocking_mode(self, generator: AgentAppGenerator, mocker: MockerFixture):
        with pytest.raises(AgentAppGeneratorError, match="only supports streaming"):
            generator.generate(
                app_model=mocker.MagicMock(),
                user=DummyAccount("u"),
                args={},
                invoke_from=InvokeFrom.WEB_APP,
                streaming=False,
            )

    def test_requires_query(self, generator: AgentAppGenerator, mocker: MockerFixture):
        with pytest.raises(AgentAppGeneratorError, match="query is required"):
            generator.generate(
                app_model=mocker.MagicMock(),
                user=DummyAccount("u"),
                args={"inputs": {}},
                invoke_from=InvokeFrom.WEB_APP,
            )

    def test_rejects_blank_query(self, generator: AgentAppGenerator, mocker: MockerFixture):
        with pytest.raises(AgentAppGeneratorError, match="query is required"):
            generator.generate(
                app_model=mocker.MagicMock(),
                user=DummyAccount("u"),
                args={"query": "   ", "inputs": {}},
                invoke_from=InvokeFrom.WEB_APP,
            )


class TestGenerateSuccess:
    def test_runtime_session_snapshot_id_is_stable_for_debugger_only(self):
        assert (
            AgentAppGenerator._runtime_session_snapshot_id(invoke_from=InvokeFrom.DEBUGGER, snapshot_id="snap-1")
            == "snap-1"
        )
        assert (
            AgentAppGenerator._runtime_session_snapshot_id(invoke_from=InvokeFrom.WEB_APP, snapshot_id="snap-1")
            == "snap-1"
        )

    def test_generate_orchestrates_and_starts_worker(self, generator, mocker: MockerFixture):
        app_model = mocker.MagicMock(id="app1", tenant_id="tenant", mode="agent")
        user = DummyAccount("user")

        generator._resolve_agent = mocker.MagicMock(
            return_value=(mocker.MagicMock(id="agent1"), mocker.MagicMock(id="snap1"), mocker.MagicMock())
        )
        generator._prepare_user_inputs = mocker.MagicMock(return_value={"x": 1})
        generator._init_generate_records = mocker.MagicMock(
            return_value=(mocker.MagicMock(id="conv", mode="agent"), mocker.MagicMock(id="msg"))
        )
        generator._handle_response = mocker.MagicMock(return_value="raw-response")

        mocker.patch(
            f"{MODULE}.AgentAppConfigManager.get_app_config",
            return_value=mocker.MagicMock(variables=[], tenant_id="tenant", app_id="app1"),
        )
        mocker.patch(f"{MODULE}.ModelConfigConverter.convert", return_value=mocker.MagicMock(model="gpt-4o-mini"))
        mocker.patch(f"{MODULE}.TraceQueueManager", return_value=mocker.MagicMock())
        mocker.patch(f"{MODULE}.AgentAppGenerateEntity", return_value=mocker.MagicMock(task_id="t", user_id="user"))
        mocker.patch(f"{MODULE}.MessageBasedAppQueueManager", return_value=mocker.MagicMock())
        thread_obj = mocker.MagicMock()
        mocker.patch(f"{MODULE}.threading.Thread", return_value=thread_obj)
        mocker.patch(f"{MODULE}.AgentAppGenerateResponseConverter.convert", return_value={"result": "ok"})

        result = generator.generate(
            app_model=app_model,
            user=user,
            args={"query": "hello", "inputs": {"name": "world"}},
            invoke_from=InvokeFrom.WEB_APP,
            streaming=True,
        )

        assert result == {"result": "ok"}
        thread_obj.start.assert_called_once()
        generator._resolve_agent.assert_called_once_with(
            app_model,
            invoke_from=InvokeFrom.WEB_APP,
            draft_type=None,
            user=user,
        )

    def test_generate_loads_existing_conversation(self, generator: AgentAppGenerator, mocker: MockerFixture):
        app_model = mocker.MagicMock(id="app1", tenant_id="tenant", mode="agent")
        generator._resolve_agent = mocker.MagicMock(
            return_value=(mocker.MagicMock(id="a"), mocker.MagicMock(id="s"), mocker.MagicMock())
        )
        generator._prepare_user_inputs = mocker.MagicMock(return_value={})
        generator._init_generate_records = mocker.MagicMock(
            return_value=(mocker.MagicMock(id="conv", mode="agent"), mocker.MagicMock(id="msg"))
        )
        generator._handle_response = mocker.MagicMock(return_value="raw")
        get_conv = mocker.patch(
            f"{MODULE}.ConversationService.get_conversation", return_value=mocker.MagicMock(id="conv")
        )
        mocker.patch(f"{MODULE}.AgentAppConfigManager.get_app_config", return_value=mocker.MagicMock(variables=[]))
        mocker.patch(f"{MODULE}.ModelConfigConverter.convert", return_value=mocker.MagicMock())
        mocker.patch(f"{MODULE}.TraceQueueManager", return_value=mocker.MagicMock())
        mocker.patch(f"{MODULE}.AgentAppGenerateEntity", return_value=mocker.MagicMock())
        mocker.patch(f"{MODULE}.MessageBasedAppQueueManager", return_value=mocker.MagicMock())
        mocker.patch(f"{MODULE}.threading.Thread", return_value=mocker.MagicMock())
        mocker.patch(f"{MODULE}.AgentAppGenerateResponseConverter.convert", return_value={"result": "ok"})

        generator.generate(
            app_model=app_model,
            user=DummyAccount("user"),
            args={"query": "hi", "inputs": {}, "conversation_id": "conv"},
            invoke_from=InvokeFrom.WEB_APP,
            streaming=True,
        )

        get_conv.assert_called_once()

    def test_generate_does_not_include_trace_session_id_in_extras(
        self, generator: AgentAppGenerator, mocker: MockerFixture
    ):
        app_model = mocker.MagicMock(id="app1", tenant_id="tenant", mode="agent")
        user = DummyAccount("user")

        generator._resolve_agent = mocker.MagicMock(
            return_value=(mocker.MagicMock(id="agent1"), mocker.MagicMock(id="snap1"), mocker.MagicMock())
        )
        generator._prepare_user_inputs = mocker.MagicMock(return_value={})
        generator._init_generate_records = mocker.MagicMock(
            return_value=(mocker.MagicMock(id="conv", mode="agent"), mocker.MagicMock(id="msg"))
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

    def _wire(self, generator: AgentAppGenerator, mocker: MockerFixture, *, run_side_effect=None, handled=False):
        generator._get_conversation = mocker.MagicMock(return_value=mocker.MagicMock(id="conv"))
        generator._get_message = mocker.MagicMock(return_value=mocker.MagicMock(id="msg"))
        generator._run_input_guards = mocker.MagicMock(return_value=(handled, "query"))
        generator._resolve_agent_by_id = mocker.MagicMock(
            return_value=(mocker.MagicMock(), mocker.MagicMock(), mocker.MagicMock())
        )
        mocker.patch(f"{MODULE}.db.session.get", return_value=mocker.MagicMock(id="app1"))
        mocker.patch(f"{MODULE}.db.session.close")
        mocker.patch(f"{MODULE}.DifyRunContext", return_value=mocker.MagicMock())
        mocker.patch(f"{MODULE}.build_dify_model_access", return_value=(mocker.MagicMock(), None))
        mocker.patch(f"{MODULE}.AgentAppRuntimeRequestBuilder", return_value=mocker.MagicMock())
        mocker.patch(f"{MODULE}.create_agent_backend_run_client", return_value=mocker.MagicMock())
        mocker.patch(f"{MODULE}.AgentBackendRunEventAdapter", return_value=mocker.MagicMock())
        mocker.patch(f"{MODULE}.AgentAppRuntimeSessionStore", return_value=mocker.MagicMock())
        runner = mocker.MagicMock()
        if run_side_effect is not None:
            runner.run.side_effect = run_side_effect
        mocker.patch(f"{MODULE}.AgentAppRunner", return_value=runner)
        return runner

    def _call(
        self,
        generator,
        mocker: MockerFixture,
        queue_manager,
        *,
        is_resume=False,
        query="query",
        runtime_session_snapshot_id="s",
    ):
        generator._generate_worker(
            flask_app=mocker.MagicMock(),
            context=mocker.MagicMock(),
            application_generate_entity=mocker.MagicMock(
                agent_id="a",
                agent_config_snapshot_id="s",
                agent_runtime_session_snapshot_id=runtime_session_snapshot_id,
                model_conf=mocker.MagicMock(model="m"),
                query=query,
            ),
            queue_manager=queue_manager,
            conversation_id="conv",
            message_id="msg",
            user_from=UserFrom.END_USER,
            is_resume=is_resume,
        )

    def test_happy_path_runs_backend(self, generator: AgentAppGenerator, mocker: MockerFixture):
        runner = self._wire(generator, mocker)
        queue_manager = mocker.MagicMock()
        self._call(generator, mocker, queue_manager)
        runner.run.assert_called_once()
        queue_manager.publish_error.assert_not_called()

    def test_worker_passes_runtime_session_scope_to_runner(self, generator, mocker: MockerFixture):
        runner = self._wire(generator, mocker)
        queue_manager = mocker.MagicMock()

        self._call(generator, mocker, queue_manager, runtime_session_snapshot_id=None)

        assert runner.run.call_args.kwargs["agent_config_snapshot_id"] == "s"
        assert runner.run.call_args.kwargs["session_scope_snapshot_id"] is None

    def test_input_guard_short_circuit_skips_backend(self, generator, mocker: MockerFixture):
        runner = self._wire(generator, mocker, handled=True)
        queue_manager = mocker.MagicMock()
        self._call(generator, mocker, queue_manager)
        runner.run.assert_not_called()

    def test_resume_skips_input_guards_and_consumes_reply(self, generator, mocker: MockerFixture):
        # ENG-638 (review): on resume the replayed query is NOT new end-user input.
        # Input guards must be skipped, even if moderation/annotation would match,
        # so the run continues and the human reply (deferred_tool_results) is used.
        runner = self._wire(generator, mocker, handled=True)  # guards WOULD short-circuit
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


class TestResumeAfterFormSubmission:
    """ENG-638: a resume turn re-sends the paused turn's original query so the
    composition's user-prompt layer matches the suspended snapshot (never blank)."""

    def _wire(self, generator, mocker: MockerFixture):
        generator._resolve_agent = mocker.MagicMock(
            return_value=(mocker.MagicMock(id="agent1"), mocker.MagicMock(id="snap1"), mocker.MagicMock())
        )
        generator._init_generate_records = mocker.MagicMock(
            return_value=(mocker.MagicMock(id="conv", mode="agent"), mocker.MagicMock(id="msg"))
        )
        generator._handle_response = mocker.MagicMock(return_value=None)
        mocker.patch(f"{MODULE}.ConversationService.get_conversation", return_value=mocker.MagicMock(id="conv"))
        mocker.patch(f"{MODULE}.AgentAppConfigManager.get_app_config", return_value=mocker.MagicMock(variables=[]))
        mocker.patch(f"{MODULE}.ModelConfigConverter.convert", return_value=mocker.MagicMock())
        mocker.patch(f"{MODULE}.TraceQueueManager", return_value=mocker.MagicMock())
        mocker.patch(f"{MODULE}.MessageBasedAppQueueManager", return_value=mocker.MagicMock())
        mocker.patch(f"{MODULE}.threading.Thread", return_value=mocker.MagicMock())
        return mocker.patch(
            f"{MODULE}.AgentAppGenerateEntity", return_value=mocker.MagicMock(task_id="t", user_id="user")
        )

    def test_resume_resends_paused_turn_query(self, generator, mocker: MockerFixture):
        entity = self._wire(generator, mocker)
        db_mock = mocker.patch(f"{MODULE}.db")
        db_mock.session.scalar.return_value = mocker.MagicMock(query="original question")

        generator.resume_after_form_submission(
            app_model=mocker.MagicMock(id="app1", tenant_id="tenant", mode="agent"),
            user=DummyAccount("user"),
            conversation_id="conv",
            invoke_from=InvokeFrom.WEB_APP,
        )

        # The paused turn's query is re-sent verbatim — never blank.
        assert entity.call_args.kwargs["query"] == "original question"

    def test_resume_falls_back_to_placeholder_when_no_paused_message(self, generator, mocker: MockerFixture):
        entity = self._wire(generator, mocker)
        db_mock = mocker.patch(f"{MODULE}.db")
        db_mock.session.scalar.return_value = None

        generator.resume_after_form_submission(
            app_model=mocker.MagicMock(id="app1", tenant_id="tenant", mode="agent"),
            user=DummyAccount("user"),
            conversation_id="conv",
            invoke_from=InvokeFrom.WEB_APP,
        )

        # No prior user message -> a non-blank placeholder, still never blank.
        assert entity.call_args.kwargs["query"] == "(resumed)"
