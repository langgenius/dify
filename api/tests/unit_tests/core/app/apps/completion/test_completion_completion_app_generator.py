import contextlib
from types import SimpleNamespace
from unittest.mock import MagicMock, call

import pytest
from pydantic import ValidationError
from pytest_mock import MockerFixture

import core.app.apps.completion.app_generator as module
from core.app.apps.completion.app_generator import CompletionAppGenerator
from core.app.apps.exc import GenerateTaskStoppedError
from core.app.entities.app_invoke_entities import InvokeFrom
from graphon.file import FILE_MODEL_IDENTITY
from graphon.model_runtime.errors.invoke import InvokeAuthorizationError
from services.errors.app import MoreLikeThisDisabledError
from services.errors.message import MessageNotExistsError


@pytest.fixture
def generator(mocker: MockerFixture):
    gen = CompletionAppGenerator()

    mocker.patch.object(module, "copy_current_request_context", side_effect=lambda fn: fn)

    flask_app = MagicMock()
    flask_app.app_context.return_value = contextlib.nullcontext()
    mocker.patch.object(module, "current_app", MagicMock(_get_current_object=MagicMock(return_value=flask_app)))

    thread = MagicMock()
    mocker.patch.object(module.threading, "Thread", return_value=thread)

    mocker.patch.object(module, "MessageBasedAppQueueManager", return_value=MagicMock())
    mocker.patch.object(module, "TraceQueueManager", return_value=MagicMock())
    generate_entity = mocker.patch.object(
        module, "CompletionAppGenerateEntity", side_effect=lambda **kwargs: SimpleNamespace(**kwargs)
    )
    gen.generate_entity = generate_entity

    return gen


def _build_app_model():
    return MagicMock(tenant_id="tenant", id="app1", mode="completion", app_model_config_id="cfg-current")


def _build_user():
    return MagicMock(id="user", session_id="session")


def _build_app_model_config():
    config = MagicMock(id="cfg", app_id="app1")
    config.to_dict.return_value = {"model": {"provider": "x"}}
    return config


class TestCompletionAppGenerator:
    def test_generate_invalid_query_type(self, generator):
        with pytest.raises(ValueError):
            generator.generate(
                session=MagicMock(),
                app_model=_build_app_model(),
                user=_build_user(),
                args={"query": 123, "inputs": {}, "files": []},
                invoke_from=InvokeFrom.WEB_APP,
                streaming=True,
            )

    def test_generate_override_not_debugger(self, generator):
        with pytest.raises(ValueError):
            generator.generate(
                session=MagicMock(),
                app_model=_build_app_model(),
                user=_build_user(),
                args={"query": "q", "inputs": {}, "files": [], "model_config": {}},
                invoke_from=InvokeFrom.WEB_APP,
                streaming=False,
            )

    def test_generate_success_no_file_config(self, generator, mocker: MockerFixture):
        app_model_config = _build_app_model_config()
        mocker.patch.object(generator, "_get_app_model_config", return_value=app_model_config)
        annotation_reply = {"enabled": False}
        load_annotation_reply_config = mocker.patch.object(
            module,
            "load_annotation_reply_config",
            return_value=annotation_reply,
        )
        mocker.patch.object(module.FileUploadConfigManager, "convert", return_value=None)
        mocker.patch.object(module.file_factory, "build_from_mappings")

        app_config = MagicMock(variables=["v"], to_dict=MagicMock(return_value={}))
        get_app_config = mocker.patch.object(
            module.CompletionAppConfigManager,
            "get_app_config",
            return_value=app_config,
        )
        mocker.patch.object(module.ModelConfigConverter, "convert", return_value=MagicMock())

        mocker.patch.object(generator, "_prepare_user_inputs", return_value={"k": "v"})

        conversation = MagicMock(id="conv", mode="completion")
        message = MagicMock(id="msg")
        mocker.patch.object(generator, "_init_generate_records", return_value=(conversation, message))

        mocker.patch.object(generator, "_handle_response", return_value="response")
        mocker.patch.object(module.CompletionAppGenerateResponseConverter, "convert", return_value="converted")

        session = MagicMock()
        result = generator.generate(
            session=session,
            app_model=_build_app_model(),
            user=_build_user(),
            args={"query": "q", "inputs": {"a": 1}, "files": [], "trace_session_id": "session-1"},
            invoke_from=InvokeFrom.WEB_APP,
            streaming=True,
        )

        assert result == "converted"
        assert generator.generate_entity.call_args.kwargs["extras"]["trace_session_id"] == "session-1"
        module.file_factory.build_from_mappings.assert_not_called()
        load_annotation_reply_config.assert_called_once_with(session, "app1")
        app_model_config.to_dict.assert_called_once_with(annotation_reply=annotation_reply)
        assert get_app_config.call_args.kwargs["annotation_reply"] is annotation_reply

    def test_generate_success_with_files(self, generator, mocker: MockerFixture):
        app_model_config = _build_app_model_config()
        mocker.patch.object(generator, "_get_app_model_config", return_value=app_model_config)

        file_extra_config = MagicMock()
        mocker.patch.object(module.FileUploadConfigManager, "convert", return_value=file_extra_config)
        mocker.patch.object(module.file_factory, "build_from_mappings", return_value=["file1"])

        app_config = MagicMock(variables=["v"], to_dict=MagicMock(return_value={}))
        mocker.patch.object(module.CompletionAppConfigManager, "get_app_config", return_value=app_config)
        mocker.patch.object(module.ModelConfigConverter, "convert", return_value=MagicMock())

        mocker.patch.object(generator, "_prepare_user_inputs", return_value={"k": "v"})

        conversation = MagicMock(id="conv", mode="completion")
        message = MagicMock(id="msg")
        mocker.patch.object(generator, "_init_generate_records", return_value=(conversation, message))

        mocker.patch.object(generator, "_handle_response", return_value="response")
        mocker.patch.object(module.CompletionAppGenerateResponseConverter, "convert", return_value="converted")

        result = generator.generate(
            session=MagicMock(),
            app_model=_build_app_model(),
            user=_build_user(),
            args={"query": "q", "inputs": {"a": 1}, "files": [{"id": "f"}]},
            invoke_from=InvokeFrom.WEB_APP,
            streaming=False,
        )

        assert result == "converted"
        module.file_factory.build_from_mappings.assert_called_once()

    def test_generate_override_model_config_debugger(self, generator, mocker: MockerFixture):
        app_model_config = _build_app_model_config()
        mocker.patch.object(generator, "_get_app_model_config", return_value=app_model_config)

        override_config = {"model": {"provider": "override"}}
        mocker.patch.object(module.CompletionAppConfigManager, "config_validate", return_value=override_config)

        app_config = MagicMock(variables=["v"], to_dict=MagicMock(return_value={}))
        get_app_config = mocker.patch.object(
            module.CompletionAppConfigManager,
            "get_app_config",
            return_value=app_config,
        )
        mocker.patch.object(module.FileUploadConfigManager, "convert", return_value=None)
        mocker.patch.object(module.ModelConfigConverter, "convert", return_value=MagicMock())
        mocker.patch.object(generator, "_prepare_user_inputs", return_value={"k": "v"})
        mocker.patch.object(
            generator,
            "_init_generate_records",
            return_value=(MagicMock(id="conv", mode="completion"), MagicMock(id="msg")),
        )
        mocker.patch.object(generator, "_handle_response", return_value="response")
        mocker.patch.object(module.CompletionAppGenerateResponseConverter, "convert", return_value="converted")

        generator.generate(
            session=MagicMock(),
            app_model=_build_app_model(),
            user=_build_user(),
            args={"query": "q", "inputs": {}, "files": [], "model_config": override_config},
            invoke_from=InvokeFrom.DEBUGGER,
            streaming=True,
        )

        assert get_app_config.call_args.kwargs["override_config_dict"] == override_config

    def test_generate_more_like_this_message_not_found(self, generator, mocker: MockerFixture):
        session = mocker.MagicMock()
        session.scalar.return_value = None

        with pytest.raises(MessageNotExistsError):
            generator.generate_more_like_this(
                session=session,
                app_model=_build_app_model(),
                message_id="msg",
                user=_build_user(),
                invoke_from=InvokeFrom.WEB_APP,
            )

    def test_generate_more_like_this_disabled(self, generator, mocker: MockerFixture):
        app_model = _build_app_model()
        current_config = MagicMock(more_like_this=False, more_like_this_dict={"enabled": False})

        message = MagicMock()
        session = mocker.MagicMock()
        session.scalar.return_value = message
        session.get.return_value = current_config

        with pytest.raises(MoreLikeThisDisabledError):
            generator.generate_more_like_this(
                session=session,
                app_model=app_model,
                message_id="msg",
                user=_build_user(),
                invoke_from=InvokeFrom.WEB_APP,
            )

    def test_generate_more_like_this_app_model_config_missing(self, generator, mocker: MockerFixture):
        app_model = _build_app_model()
        app_model.app_model_config_id = None

        message = MagicMock()
        session = mocker.MagicMock()
        session.scalar.return_value = message

        with pytest.raises(MoreLikeThisDisabledError):
            generator.generate_more_like_this(
                session=session,
                app_model=app_model,
                message_id="msg",
                user=_build_user(),
                invoke_from=InvokeFrom.WEB_APP,
            )

    def test_generate_more_like_this_message_config_none(self, generator, mocker: MockerFixture):
        app_model = _build_app_model()
        current_config = MagicMock(more_like_this=True, more_like_this_dict={"enabled": True})

        message = MagicMock(conversation_id="conv-1")
        conversation = MagicMock(app_model_config_id=None)
        session = mocker.MagicMock()
        session.scalar.return_value = message
        session.get.side_effect = [current_config, conversation]

        with pytest.raises(ValueError):
            generator.generate_more_like_this(
                session=session,
                app_model=app_model,
                message_id="msg",
                user=_build_user(),
                invoke_from=InvokeFrom.WEB_APP,
            )

    def test_generate_more_like_this_success(self, generator, mocker: MockerFixture):
        app_model = _build_app_model()
        current_config = MagicMock(more_like_this=True, more_like_this_dict={"enabled": True})

        message = module.Message(id="msg", app_id="app1", conversation_id="conv-1", query="q")
        message.inputs = {"attachment": {"dify_model_identity": FILE_MODEL_IDENTITY}}
        message_files = [{"id": "f"}]
        message_files_with_session = mocker.patch.object(
            module.Message,
            "message_files_with_session",
            return_value=message_files,
        )

        app_model_config = MagicMock(app_id="app1")
        app_model_config.to_dict.return_value = {
            "model": {"completion_params": {"temperature": 0.1}},
            "file_upload": {"enabled": True},
        }
        annotation_reply = {"enabled": False}
        load_annotation_reply_config = mocker.patch.object(
            module,
            "load_annotation_reply_config",
            return_value=annotation_reply,
        )
        conversation = MagicMock(app_model_config_id="cfg-message")

        session = mocker.MagicMock()
        session.scalar.side_effect = [message, "tenant"]
        session.get.side_effect = [current_config, conversation, app_model_config]

        global_session = MagicMock()
        global_session.scalar.side_effect = AssertionError("global session must not be used")
        global_session.scalars.side_effect = AssertionError("global session must not be used")
        mocker.patch.object(module.db, "session", global_session)

        def restore_input_file(*, file_mapping, tenant_resolver):
            assert file_mapping["dify_model_identity"] == FILE_MODEL_IDENTITY
            assert tenant_resolver() == "tenant"
            return "input-file"

        mocker.patch("models.model.build_file_from_input_mapping", side_effect=restore_input_file)

        file_extra_config = MagicMock()
        mocker.patch.object(module.FileUploadConfigManager, "convert", return_value=file_extra_config)
        build_from_mappings = mocker.patch.object(module.file_factory, "build_from_mappings", return_value=["file1"])

        app_config = MagicMock(variables=["v"], to_dict=MagicMock(return_value={}))
        get_app_config = mocker.patch.object(
            module.CompletionAppConfigManager,
            "get_app_config",
            return_value=app_config,
        )
        mocker.patch.object(module.ModelConfigConverter, "convert", return_value=MagicMock())

        mocker.patch.object(
            generator,
            "_init_generate_records",
            return_value=(MagicMock(id="conv", mode="completion"), MagicMock(id="msg")),
        )
        mocker.patch.object(generator, "_handle_response", return_value="response")
        mocker.patch.object(module.CompletionAppGenerateResponseConverter, "convert", return_value="converted")

        result = generator.generate_more_like_this(
            session=session,
            app_model=app_model,
            message_id="msg",
            user=_build_user(),
            invoke_from=InvokeFrom.WEB_APP,
            stream=True,
        )

        assert result == "converted"
        assert session.get.call_args_list == [
            call(module.AppModelConfig, "cfg-current"),
            call(module.Conversation, "conv-1"),
            call(module.AppModelConfig, "cfg-message"),
        ]
        load_annotation_reply_config.assert_called_once_with(session, "app1")
        app_model_config.to_dict.assert_called_once_with(annotation_reply=annotation_reply)
        assert session.scalar.call_count == 2
        message_files_with_session.assert_called_once_with(session=session)
        build_from_mappings.assert_called_once_with(
            mappings=message_files,
            tenant_id="tenant",
            config=file_extra_config,
            access_controller=generator._file_access_controller,
        )
        assert global_session.mock_calls == []
        assert generator.generate_entity.call_args.kwargs["inputs"] == {"attachment": "input-file"}
        override_dict = get_app_config.call_args.kwargs["override_config_dict"]
        assert override_dict["model"]["completion_params"]["temperature"] == 0.9

    @pytest.mark.parametrize(
        ("error", "should_publish"),
        [
            (GenerateTaskStoppedError(), False),
            (InvokeAuthorizationError("bad"), True),
            (
                ValidationError.from_exception_data(
                    "Model",
                    [{"type": "missing", "loc": ("x",), "msg": "Field required", "input": {}}],
                ),
                True,
            ),
            (ValueError("bad"), True),
            (RuntimeError("boom"), True),
        ],
    )
    def test_generate_worker_error_handling(self, generator, mocker: MockerFixture, error, should_publish):
        flask_app = MagicMock()
        flask_app.app_context.return_value = contextlib.nullcontext()

        session = mocker.MagicMock()
        session_context = mocker.MagicMock()
        session_context.__enter__.return_value = session
        create_session = mocker.patch.object(module.session_factory, "create_session")
        create_session.return_value = session_context
        mocker.patch.object(module.db, "session")

        mocker.patch.object(generator, "_get_message", return_value=MagicMock())

        runner_instance = MagicMock()
        runner_instance.run.side_effect = error
        mocker.patch.object(module, "CompletionAppRunner", return_value=runner_instance)

        queue_manager = MagicMock()
        generator._generate_worker(
            flask_app=flask_app,
            application_generate_entity=MagicMock(),
            queue_manager=queue_manager,
            message_id="msg",
        )

        assert queue_manager.publish_error.called is should_publish
