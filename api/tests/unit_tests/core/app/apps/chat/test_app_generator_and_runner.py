from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest
from graphon.model_runtime.errors.invoke import InvokeAuthorizationError

from core.app.apps.chat.app_generator import ChatAppGenerator
from core.app.apps.chat.app_runner import ChatAppRunner
from core.app.apps.exc import GenerateTaskStoppedError
from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.entities.queue_entities import QueueAnnotationReplyEvent
from core.moderation.base import ModerationError
from models.model import AppMode


class DummyGenerateEntity:
    def __init__(self, **kwargs):
        self.__dict__.update(kwargs)


class DummyQueueManager:
    def __init__(self, *args, **kwargs):
        self.published = []

    def publish_error(self, error, pub_from):
        self.published.append((error, pub_from))

    def publish(self, event, pub_from):
        self.published.append((event, pub_from))


class TestChatAppGenerator:
    def test_generate_requires_query(self):
        generator = ChatAppGenerator()
        with pytest.raises(ValueError):
            generator.generate(
                app_model=SimpleNamespace(),
                user=SimpleNamespace(),
                args={"inputs": {}},
                invoke_from=InvokeFrom.SERVICE_API,
                streaming=False,
            )

    def test_generate_rejects_non_string_query(self):
        generator = ChatAppGenerator()
        with pytest.raises(ValueError):
            generator.generate(
                app_model=SimpleNamespace(),
                user=SimpleNamespace(),
                args={"query": 1, "inputs": {}},
                invoke_from=InvokeFrom.SERVICE_API,
                streaming=False,
            )

    def test_generate_debugger_overrides_model_config(self):
        generator = ChatAppGenerator()
        app_model = SimpleNamespace(id="app-1", tenant_id="tenant-1")
        user = SimpleNamespace(id="user-1", session_id="session-1")
        args = {"query": "hi", "inputs": {}, "model_config": {"foo": "bar"}}

        with (
            patch("core.app.apps.chat.app_generator.ConversationService.get_conversation", return_value=None),
            patch("core.app.apps.chat.app_generator.ChatAppConfigManager.config_validate", return_value={"x": 1}),
            patch(
                "core.app.apps.chat.app_generator.ChatAppConfigManager.get_app_config",
                return_value=SimpleNamespace(
                    variables=[], external_data_variables=[], app_model_config_dict={}, app_mode=AppMode.CHAT
                ),
            ),
            patch("core.app.apps.chat.app_generator.ModelConfigConverter.convert", return_value=SimpleNamespace()),
            patch("core.app.apps.chat.app_generator.FileUploadConfigManager.convert", return_value=None),
            patch("core.app.apps.chat.app_generator.file_factory.build_from_mappings", return_value=[]),
            patch("core.app.apps.chat.app_generator.ChatAppGenerateEntity", DummyGenerateEntity),
            patch("core.app.apps.chat.app_generator.TraceQueueManager", return_value=SimpleNamespace()),
            patch("core.app.apps.chat.app_generator.MessageBasedAppQueueManager", DummyQueueManager),
            patch(
                "core.app.apps.chat.app_generator.ChatAppGenerateResponseConverter.convert", return_value={"ok": True}
            ),
            patch.object(ChatAppGenerator, "_get_app_model_config", return_value=SimpleNamespace(to_dict=lambda: {})),
            patch.object(ChatAppGenerator, "_prepare_user_inputs", return_value={}),
            patch.object(
                ChatAppGenerator,
                "_init_generate_records",
                return_value=(SimpleNamespace(id="c1", mode="chat"), SimpleNamespace(id="m1")),
            ),
            patch.object(ChatAppGenerator, "_handle_response", return_value={"response": True}),
            patch("core.app.apps.chat.app_generator.copy_current_request_context", side_effect=lambda f: f),
            patch("core.app.apps.chat.app_generator.threading.Thread") as mock_thread,
        ):
            mock_thread.return_value.start.return_value = None
            result = generator.generate(app_model, user, args, InvokeFrom.DEBUGGER, streaming=False)

        assert result == {"ok": True}

    def test_generate_rejects_model_config_override_for_non_debugger(self):
        generator = ChatAppGenerator()
        with pytest.raises(ValueError):
            with (
                patch.object(
                    ChatAppGenerator, "_get_app_model_config", return_value=SimpleNamespace(to_dict=lambda: {})
                ),
            ):
                generator.generate(
                    app_model=SimpleNamespace(tenant_id="t1", id="a1", mode=AppMode.CHAT.value),
                    user=SimpleNamespace(id="u1", session_id="s1"),
                    args={"query": "hi", "inputs": {}, "model_config": {"foo": "bar"}},
                    invoke_from=InvokeFrom.SERVICE_API,
                    streaming=False,
                )

    def test_generate_worker_handles_exceptions(self):
        generator = ChatAppGenerator()
        queue_manager = DummyQueueManager()
        entity = DummyGenerateEntity(task_id="t1", user_id="u1")

        with (
            patch.object(ChatAppGenerator, "_get_conversation", return_value=SimpleNamespace()),
            patch.object(ChatAppGenerator, "_get_message", return_value=SimpleNamespace()),
            patch("core.app.apps.chat.app_generator.ChatAppRunner.run", side_effect=InvokeAuthorizationError()),
            patch("core.app.apps.chat.app_generator.db.session.close"),
        ):
            generator._generate_worker(
                flask_app=Mock(app_context=Mock(return_value=Mock(__enter__=Mock(), __exit__=Mock()))),
                application_generate_entity=entity,
                queue_manager=queue_manager,
                conversation_id="c1",
                message_id="m1",
            )

        assert queue_manager.published

        with (
            patch.object(ChatAppGenerator, "_get_conversation", return_value=SimpleNamespace()),
            patch.object(ChatAppGenerator, "_get_message", return_value=SimpleNamespace()),
            patch("core.app.apps.chat.app_generator.ChatAppRunner.run", side_effect=GenerateTaskStoppedError()),
            patch("core.app.apps.chat.app_generator.db.session.close"),
        ):
            generator._generate_worker(
                flask_app=Mock(app_context=Mock(return_value=Mock(__enter__=Mock(), __exit__=Mock()))),
                application_generate_entity=entity,
                queue_manager=queue_manager,
                conversation_id="c1",
                message_id="m1",
            )


class TestChatAppRunner:
    def test_run_raises_when_app_missing(self):
        runner = ChatAppRunner()
        app_config = SimpleNamespace(
            app_id="app-1", tenant_id="tenant-1", prompt_template=None, external_data_variables=[]
        )
        app_generate_entity = DummyGenerateEntity(
            app_config=app_config,
            model_conf=SimpleNamespace(provider_model_bundle=None, model=None, parameters={}, app_model_config_dict={}),
            inputs={},
            query="hi",
            files=[],
            file_upload_config=None,
            conversation_id=None,
            stream=False,
            user_id="user-1",
            invoke_from=InvokeFrom.SERVICE_API,
        )

        with patch("core.app.apps.chat.app_runner.db.session.scalar", return_value=None):
            with pytest.raises(ValueError):
                runner.run(app_generate_entity, DummyQueueManager(), SimpleNamespace(), SimpleNamespace(id="m1"))

    def test_run_moderation_error_direct_output(self):
        runner = ChatAppRunner()
        app_config = SimpleNamespace(
            app_id="app-1",
            tenant_id="tenant-1",
            prompt_template=None,
            external_data_variables=[],
            dataset=None,
            additional_features=None,
        )
        app_generate_entity = DummyGenerateEntity(
            app_config=app_config,
            model_conf=SimpleNamespace(provider_model_bundle=None, model=None, parameters={}, app_model_config_dict={}),
            inputs={},
            query="hi",
            files=[],
            file_upload_config=None,
            conversation_id=None,
            stream=False,
            user_id="user-1",
            invoke_from=InvokeFrom.SERVICE_API,
        )

        with (
            patch(
                "core.app.apps.chat.app_runner.db.session.scalar",
                return_value=SimpleNamespace(id="app-1", tenant_id="tenant-1"),
            ),
            patch.object(ChatAppRunner, "organize_prompt_messages", return_value=([], [])),
            patch.object(ChatAppRunner, "moderation_for_inputs", side_effect=ModerationError("blocked")),
            patch.object(ChatAppRunner, "direct_output") as mock_direct,
        ):
            runner.run(app_generate_entity, DummyQueueManager(), SimpleNamespace(), SimpleNamespace(id="m1"))

        mock_direct.assert_called_once()

    def test_run_annotation_reply_short_circuits(self):
        runner = ChatAppRunner()
        app_config = SimpleNamespace(
            app_id="app-1",
            tenant_id="tenant-1",
            prompt_template=None,
            external_data_variables=[],
            dataset=None,
            additional_features=None,
        )
        app_generate_entity = DummyGenerateEntity(
            app_config=app_config,
            model_conf=SimpleNamespace(provider_model_bundle=None, model=None, parameters={}, app_model_config_dict={}),
            inputs={},
            query="hi",
            files=[],
            file_upload_config=None,
            conversation_id=None,
            stream=False,
            user_id="user-1",
            invoke_from=InvokeFrom.SERVICE_API,
        )

        annotation = SimpleNamespace(id="ann-1", content="answer")

        with (
            patch(
                "core.app.apps.chat.app_runner.db.session.scalar",
                return_value=SimpleNamespace(id="app-1", tenant_id="tenant-1"),
            ),
            patch.object(ChatAppRunner, "organize_prompt_messages", return_value=([], [])),
            patch.object(ChatAppRunner, "moderation_for_inputs", return_value=(None, {}, "hi")),
            patch.object(ChatAppRunner, "query_app_annotations_to_reply", return_value=annotation),
            patch.object(ChatAppRunner, "direct_output") as mock_direct,
        ):
            queue_manager = DummyQueueManager()
            runner.run(app_generate_entity, queue_manager, SimpleNamespace(), SimpleNamespace(id="m1"))

        assert any(isinstance(item[0], QueueAnnotationReplyEvent) for item in queue_manager.published)
        mock_direct.assert_called_once()

    def test_run_returns_when_hosting_moderation_blocks(self):
        runner = ChatAppRunner()
        app_config = SimpleNamespace(
            app_id="app-1",
            tenant_id="tenant-1",
            prompt_template=None,
            external_data_variables=[],
            dataset=None,
            additional_features=None,
        )
        app_generate_entity = DummyGenerateEntity(
            app_config=app_config,
            model_conf=SimpleNamespace(provider_model_bundle=None, model=None, parameters={}, app_model_config_dict={}),
            inputs={},
            query="hi",
            files=[],
            file_upload_config=None,
            conversation_id=None,
            stream=False,
            user_id="user-1",
            invoke_from=InvokeFrom.SERVICE_API,
        )

        with (
            patch(
                "core.app.apps.chat.app_runner.db.session.scalar",
                return_value=SimpleNamespace(id="app-1", tenant_id="tenant-1"),
            ),
            patch.object(ChatAppRunner, "organize_prompt_messages", return_value=([], [])),
            patch.object(ChatAppRunner, "moderation_for_inputs", return_value=(None, {}, "hi")),
            patch.object(ChatAppRunner, "query_app_annotations_to_reply", return_value=None),
            patch.object(ChatAppRunner, "check_hosting_moderation", return_value=True),
        ):
            runner.run(app_generate_entity, DummyQueueManager(), SimpleNamespace(), SimpleNamespace(id="m1"))
