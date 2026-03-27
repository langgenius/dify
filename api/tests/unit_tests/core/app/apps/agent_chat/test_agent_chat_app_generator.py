import contextlib

import pytest
from graphon.model_runtime.errors.invoke import InvokeAuthorizationError
from pydantic import ValidationError

from core.app.apps.agent_chat.app_generator import AgentChatAppGenerator
from core.app.apps.exc import GenerateTaskStoppedError
from core.app.entities.app_invoke_entities import InvokeFrom


class DummyAccount:
    def __init__(self, user_id):
        self.id = user_id
        self.session_id = f"session-{user_id}"


@pytest.fixture
def generator(mocker):
    gen = AgentChatAppGenerator()
    mocker.patch(
        "core.app.apps.agent_chat.app_generator.current_app",
        new=mocker.MagicMock(_get_current_object=mocker.MagicMock()),
    )
    mocker.patch("core.app.apps.agent_chat.app_generator.contextvars.copy_context", return_value="ctx")
    return gen


class TestAgentChatAppGeneratorGenerate:
    def test_generate_rejects_blocking_mode(self, generator, mocker):
        app_model = mocker.MagicMock()
        user = DummyAccount("user")
        with pytest.raises(ValueError):
            generator.generate(app_model=app_model, user=user, args={}, invoke_from=mocker.MagicMock(), streaming=False)

    def test_generate_requires_query(self, generator, mocker):
        app_model = mocker.MagicMock()
        user = DummyAccount("user")
        with pytest.raises(ValueError):
            generator.generate(app_model=app_model, user=user, args={"inputs": {}}, invoke_from=mocker.MagicMock())

    def test_generate_rejects_non_string_query(self, generator, mocker):
        app_model = mocker.MagicMock()
        user = DummyAccount("user")
        with pytest.raises(ValueError):
            generator.generate(
                app_model=app_model,
                user=user,
                args={"query": 123, "inputs": {}},
                invoke_from=mocker.MagicMock(),
            )

    def test_generate_override_requires_debugger(self, generator, mocker):
        app_model = mocker.MagicMock()
        user = DummyAccount("user")

        with pytest.raises(ValueError):
            generator.generate(
                app_model=app_model,
                user=user,
                args={"query": "hi", "inputs": {}, "model_config": {"model": {"provider": "p"}}},
                invoke_from=InvokeFrom.WEB_APP,
            )

    def test_generate_success_with_debugger_override(self, generator, mocker):
        app_model = mocker.MagicMock(id="app1", tenant_id="tenant", mode="agent-chat")
        app_model_config = mocker.MagicMock(id="cfg1")
        app_model_config.to_dict.return_value = {"model": {"provider": "p"}}

        user = DummyAccount("user")
        invoke_from = InvokeFrom.DEBUGGER

        generator._get_app_model_config = mocker.MagicMock(return_value=app_model_config)
        generator._prepare_user_inputs = mocker.MagicMock(return_value={"x": 1})
        generator._init_generate_records = mocker.MagicMock(
            return_value=(mocker.MagicMock(id="conv", mode="agent-chat"), mocker.MagicMock(id="msg"))
        )
        generator._handle_response = mocker.MagicMock(return_value="response")

        mocker.patch(
            "core.app.apps.agent_chat.app_generator.AgentChatAppConfigManager.config_validate",
            return_value={"validated": True},
        )
        app_config = mocker.MagicMock(variables={}, prompt_template=mocker.MagicMock(), external_data_variables=[])
        mocker.patch(
            "core.app.apps.agent_chat.app_generator.AgentChatAppConfigManager.get_app_config",
            return_value=app_config,
        )
        mocker.patch(
            "core.app.apps.agent_chat.app_generator.ModelConfigConverter.convert",
            return_value=mocker.MagicMock(),
        )
        mocker.patch(
            "core.app.apps.agent_chat.app_generator.FileUploadConfigManager.convert",
            return_value=mocker.MagicMock(),
        )
        mocker.patch(
            "core.app.apps.agent_chat.app_generator.file_factory.build_from_mappings",
            return_value=["file-obj"],
        )
        mocker.patch(
            "core.app.apps.agent_chat.app_generator.ConversationService.get_conversation",
            return_value=mocker.MagicMock(id="conv"),
        )
        mocker.patch(
            "core.app.apps.agent_chat.app_generator.TraceQueueManager",
            return_value=mocker.MagicMock(),
        )

        queue_manager = mocker.MagicMock()
        mocker.patch(
            "core.app.apps.agent_chat.app_generator.MessageBasedAppQueueManager",
            return_value=queue_manager,
        )

        thread_obj = mocker.MagicMock()
        mocker.patch(
            "core.app.apps.agent_chat.app_generator.threading.Thread",
            return_value=thread_obj,
        )

        mocker.patch(
            "core.app.apps.agent_chat.app_generator.AgentChatAppGenerateResponseConverter.convert",
            return_value={"result": "ok"},
        )
        app_entity = mocker.MagicMock(task_id="task", user_id="user", invoke_from=invoke_from)
        mocker.patch(
            "core.app.apps.agent_chat.app_generator.AgentChatAppGenerateEntity",
            return_value=app_entity,
        )

        args = {
            "query": "hello",
            "inputs": {"name": "world"},
            "conversation_id": "conv",
            "model_config": {"model": {"provider": "p"}},
            "files": [{"id": "f1"}],
        }

        result = generator.generate(app_model=app_model, user=user, args=args, invoke_from=invoke_from, streaming=True)

        assert result == {"result": "ok"}
        thread_obj.start.assert_called_once()

    def test_generate_without_file_config(self, generator, mocker):
        app_model = mocker.MagicMock(id="app1", tenant_id="tenant", mode="agent-chat")
        app_model_config = mocker.MagicMock(id="cfg1")
        app_model_config.to_dict.return_value = {"model": {"provider": "p"}}

        user = DummyAccount("user")

        generator._get_app_model_config = mocker.MagicMock(return_value=app_model_config)
        generator._prepare_user_inputs = mocker.MagicMock(return_value={"x": 1})
        generator._init_generate_records = mocker.MagicMock(
            return_value=(mocker.MagicMock(id="conv", mode="agent-chat"), mocker.MagicMock(id="msg"))
        )
        generator._handle_response = mocker.MagicMock(return_value="response")

        mocker.patch(
            "core.app.apps.agent_chat.app_generator.AgentChatAppConfigManager.get_app_config",
            return_value=mocker.MagicMock(variables={}, prompt_template=mocker.MagicMock(), external_data_variables=[]),
        )
        mocker.patch(
            "core.app.apps.agent_chat.app_generator.ModelConfigConverter.convert",
            return_value=mocker.MagicMock(),
        )
        mocker.patch(
            "core.app.apps.agent_chat.app_generator.FileUploadConfigManager.convert",
            return_value=None,
        )
        mocker.patch(
            "core.app.apps.agent_chat.app_generator.file_factory.build_from_mappings",
            return_value=["file-obj"],
        )
        mocker.patch(
            "core.app.apps.agent_chat.app_generator.TraceQueueManager",
            return_value=mocker.MagicMock(),
        )

        mocker.patch(
            "core.app.apps.agent_chat.app_generator.MessageBasedAppQueueManager",
            return_value=mocker.MagicMock(),
        )

        thread_obj = mocker.MagicMock()
        mocker.patch(
            "core.app.apps.agent_chat.app_generator.threading.Thread",
            return_value=thread_obj,
        )

        mocker.patch(
            "core.app.apps.agent_chat.app_generator.AgentChatAppGenerateResponseConverter.convert",
            return_value={"result": "ok"},
        )
        app_entity = mocker.MagicMock(task_id="task", user_id="user", invoke_from=InvokeFrom.WEB_APP)
        mocker.patch(
            "core.app.apps.agent_chat.app_generator.AgentChatAppGenerateEntity",
            return_value=app_entity,
        )

        args = {"query": "hello", "inputs": {"name": "world"}}

        result = generator.generate(
            app_model=app_model,
            user=user,
            args=args,
            invoke_from=InvokeFrom.WEB_APP,
            streaming=True,
        )

        assert result == {"result": "ok"}


class TestAgentChatAppGeneratorWorker:
    @pytest.fixture(autouse=True)
    def patch_context(self, mocker):
        @contextlib.contextmanager
        def ctx_manager(*args, **kwargs):
            yield

        mocker.patch("core.app.apps.agent_chat.app_generator.preserve_flask_contexts", ctx_manager)

    def test_generate_worker_handles_generate_task_stopped(self, generator, mocker):
        queue_manager = mocker.MagicMock()
        generator._get_conversation = mocker.MagicMock(return_value=mocker.MagicMock())
        generator._get_message = mocker.MagicMock(return_value=mocker.MagicMock())

        runner = mocker.MagicMock()
        runner.run.side_effect = GenerateTaskStoppedError()
        mocker.patch("core.app.apps.agent_chat.app_generator.AgentChatAppRunner", return_value=runner)
        mocker.patch("core.app.apps.agent_chat.app_generator.db.session.close")

        generator._generate_worker(
            flask_app=mocker.MagicMock(),
            context=mocker.MagicMock(),
            application_generate_entity=mocker.MagicMock(),
            queue_manager=queue_manager,
            conversation_id="conv",
            message_id="msg",
        )

        queue_manager.publish_error.assert_not_called()

    @pytest.mark.parametrize(
        "error",
        [
            InvokeAuthorizationError("bad"),
            ValidationError.from_exception_data("TestModel", []),
            ValueError("bad"),
            Exception("bad"),
        ],
    )
    def test_generate_worker_publishes_errors(self, generator, mocker, error):
        queue_manager = mocker.MagicMock()
        generator._get_conversation = mocker.MagicMock(return_value=mocker.MagicMock())
        generator._get_message = mocker.MagicMock(return_value=mocker.MagicMock())

        runner = mocker.MagicMock()
        runner.run.side_effect = error
        mocker.patch("core.app.apps.agent_chat.app_generator.AgentChatAppRunner", return_value=runner)
        mocker.patch("core.app.apps.agent_chat.app_generator.db.session.close")

        generator._generate_worker(
            flask_app=mocker.MagicMock(),
            context=mocker.MagicMock(),
            application_generate_entity=mocker.MagicMock(),
            queue_manager=queue_manager,
            conversation_id="conv",
            message_id="msg",
        )

        assert queue_manager.publish_error.called

    def test_generate_worker_logs_value_error_when_debug(self, generator, mocker):
        queue_manager = mocker.MagicMock()
        generator._get_conversation = mocker.MagicMock(return_value=mocker.MagicMock())
        generator._get_message = mocker.MagicMock(return_value=mocker.MagicMock())

        runner = mocker.MagicMock()
        runner.run.side_effect = ValueError("bad")
        mocker.patch("core.app.apps.agent_chat.app_generator.AgentChatAppRunner", return_value=runner)
        mocker.patch("core.app.apps.agent_chat.app_generator.db.session.close")

        mocker.patch("core.app.apps.agent_chat.app_generator.dify_config", new=mocker.MagicMock(DEBUG=True))
        logger = mocker.patch("core.app.apps.agent_chat.app_generator.logger")

        generator._generate_worker(
            flask_app=mocker.MagicMock(),
            context=mocker.MagicMock(),
            application_generate_entity=mocker.MagicMock(),
            queue_manager=queue_manager,
            conversation_id="conv",
            message_id="msg",
        )

        logger.exception.assert_called_once()
