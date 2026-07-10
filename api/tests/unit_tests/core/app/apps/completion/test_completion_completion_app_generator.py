import contextlib
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from pydantic import ValidationError
from pytest_mock import MockerFixture
from sqlalchemy.orm import Session

import core.app.apps.completion.app_generator as module
from core.app.apps.completion.app_generator import CompletionAppGenerator
from core.app.apps.exc import GenerateTaskStoppedError
from core.app.entities.app_invoke_entities import InvokeFrom
from graphon.model_runtime.errors.invoke import InvokeAuthorizationError
from models.enums import ConversationFromSource
from models.model import AppMode, AppModelConfig, Conversation, Message
from services.errors.app import MoreLikeThisDisabledError
from services.errors.message import MessageNotExistsError

TABLES = (AppModelConfig, Conversation, Message)


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
    return MagicMock(tenant_id="tenant", id="app1", mode="completion")


def _build_user():
    return MagicMock(id="user", session_id="session")


def _build_app_model_config():
    config = MagicMock(id="cfg")
    config.to_dict.return_value = {"model": {"provider": "x"}}
    return config


def _persist_message(
    session: Session,
    *,
    message_id: str = "msg",
    app_id: str = "app1",
    app_model_config: AppModelConfig | None = None,
) -> Message:
    conversation = Conversation(
        app_id=app_id,
        app_model_config_id=app_model_config.id if app_model_config else None,
        model_provider=None,
        override_model_configs=None,
        model_id=None,
        mode=AppMode.COMPLETION,
        name="completion conversation",
        summary=None,
        inputs={},
        introduction="",
        system_instruction="",
        invoke_from=InvokeFrom.WEB_APP,
        from_source=ConversationFromSource.CONSOLE,
        from_end_user_id=None,
        from_account_id=None,
        read_at=None,
        read_account_id=None,
    )
    session.add(conversation)
    session.flush()

    message = Message(
        id=message_id,
        app_id=app_id,
        model_provider=None,
        model_id=None,
        override_model_configs=None,
        conversation_id=conversation.id,
        inputs={"a": 1},
        query="q",
        message={},
        message_unit_price=Decimal(0),
        answer="",
        answer_unit_price=Decimal(0),
        parent_message_id=None,
        total_price=None,
        currency="USD",
        error=None,
        message_metadata=None,
        invoke_from=InvokeFrom.WEB_APP,
        from_source=ConversationFromSource.CONSOLE,
        from_end_user_id=None,
        from_account_id=None,
        workflow_run_id=None,
        app_mode=AppMode.COMPLETION,
    )
    session.add(message)
    session.flush()
    return message


@pytest.mark.parametrize("sqlite_session", [TABLES], indirect=True)
class TestCompletionAppGenerator:
    def test_generate_invalid_query_type(self, generator, sqlite_session: Session):
        with pytest.raises(ValueError):
            generator.generate(
                session=sqlite_session,
                app_model=_build_app_model(),
                user=_build_user(),
                args={"query": 123, "inputs": {}, "files": []},
                invoke_from=InvokeFrom.WEB_APP,
                streaming=True,
            )

    def test_generate_override_not_debugger(self, generator, sqlite_session: Session):
        with pytest.raises(ValueError):
            generator.generate(
                session=sqlite_session,
                app_model=_build_app_model(),
                user=_build_user(),
                args={"query": "q", "inputs": {}, "files": [], "model_config": {}},
                invoke_from=InvokeFrom.WEB_APP,
                streaming=False,
            )

    def test_generate_success_no_file_config(self, generator, mocker: MockerFixture, sqlite_session: Session):
        app_model_config = _build_app_model_config()
        mocker.patch.object(generator, "_get_app_model_config", return_value=app_model_config)
        mocker.patch.object(module.FileUploadConfigManager, "convert", return_value=None)
        mocker.patch.object(module.file_factory, "build_from_mappings")

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
            session=sqlite_session,
            app_model=_build_app_model(),
            user=_build_user(),
            args={"query": "q", "inputs": {"a": 1}, "files": [], "trace_session_id": "session-1"},
            invoke_from=InvokeFrom.WEB_APP,
            streaming=True,
        )

        assert result == "converted"
        assert generator.generate_entity.call_args.kwargs["extras"]["trace_session_id"] == "session-1"
        module.file_factory.build_from_mappings.assert_not_called()

    def test_generate_success_with_files(self, generator, mocker: MockerFixture, sqlite_session: Session):
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
            session=sqlite_session,
            app_model=_build_app_model(),
            user=_build_user(),
            args={"query": "q", "inputs": {"a": 1}, "files": [{"id": "f"}]},
            invoke_from=InvokeFrom.WEB_APP,
            streaming=False,
        )

        assert result == "converted"
        module.file_factory.build_from_mappings.assert_called_once()

    def test_generate_override_model_config_debugger(self, generator, mocker: MockerFixture, sqlite_session: Session):
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
            session=sqlite_session,
            app_model=_build_app_model(),
            user=_build_user(),
            args={"query": "q", "inputs": {}, "files": [], "model_config": override_config},
            invoke_from=InvokeFrom.DEBUGGER,
            streaming=True,
        )

        assert get_app_config.call_args.kwargs["override_config_dict"] == override_config

    def test_generate_more_like_this_message_not_found(self, generator, sqlite_session: Session):
        _persist_message(sqlite_session, app_id="other-app")

        with pytest.raises(MessageNotExistsError):
            generator.generate_more_like_this(
                session=sqlite_session,
                app_model=_build_app_model(),
                message_id="msg",
                user=_build_user(),
                invoke_from=InvokeFrom.WEB_APP,
            )

    def test_generate_more_like_this_disabled(self, generator, sqlite_session: Session):
        app_model = _build_app_model()
        app_model.app_model_config = MagicMock(more_like_this=False, more_like_this_dict={"enabled": False})

        _persist_message(sqlite_session)

        with pytest.raises(MoreLikeThisDisabledError):
            generator.generate_more_like_this(
                session=sqlite_session,
                app_model=app_model,
                message_id="msg",
                user=_build_user(),
                invoke_from=InvokeFrom.WEB_APP,
            )

    def test_generate_more_like_this_app_model_config_missing(self, generator, sqlite_session: Session):
        app_model = _build_app_model()
        app_model.app_model_config = None

        _persist_message(sqlite_session)

        with pytest.raises(MoreLikeThisDisabledError):
            generator.generate_more_like_this(
                session=sqlite_session,
                app_model=app_model,
                message_id="msg",
                user=_build_user(),
                invoke_from=InvokeFrom.WEB_APP,
            )

    def test_generate_more_like_this_message_config_none(self, generator, sqlite_session: Session):
        app_model = _build_app_model()
        app_model.app_model_config = MagicMock(more_like_this=True, more_like_this_dict={"enabled": True})

        _persist_message(sqlite_session)

        with pytest.raises(ValueError):
            generator.generate_more_like_this(
                session=sqlite_session,
                app_model=app_model,
                message_id="msg",
                user=_build_user(),
                invoke_from=InvokeFrom.WEB_APP,
            )

    def test_generate_more_like_this_success(self, generator, mocker: MockerFixture, sqlite_session: Session):
        app_model = _build_app_model()
        app_model.app_model_config = MagicMock(more_like_this=True, more_like_this_dict={"enabled": True})

        app_model_config = AppModelConfig(app_id="app1")
        sqlite_session.add(app_model_config)
        sqlite_session.flush()
        _persist_message(sqlite_session, app_model_config=app_model_config)
        mocker.patch.object(
            AppModelConfig,
            "to_dict",
            return_value={
                "model": {"completion_params": {"temperature": 0.1}},
                "file_upload": {"enabled": True},
            },
        )

        mocker.patch.object(module.FileUploadConfigManager, "convert", return_value=None)
        build_from_mappings = mocker.patch.object(module.file_factory, "build_from_mappings")

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
            session=sqlite_session,
            app_model=app_model,
            message_id="msg",
            user=_build_user(),
            invoke_from=InvokeFrom.WEB_APP,
            stream=True,
        )

        assert result == "converted"
        override_dict = get_app_config.call_args.kwargs["override_config_dict"]
        assert override_dict["model"]["completion_params"]["temperature"] == 0.9
        build_from_mappings.assert_not_called()

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
    def test_generate_worker_error_handling(
        self,
        generator,
        mocker: MockerFixture,
        sqlite_session: Session,
        error,
        should_publish,
    ):
        flask_app = MagicMock()
        flask_app.app_context.return_value = contextlib.nullcontext()

        mocker.patch.object(module, "db", SimpleNamespace(session=sqlite_session))

        mocker.patch.object(generator, "_get_message", return_value=MagicMock())

        runner_instance = MagicMock()
        runner_instance.run.side_effect = error
        mocker.patch.object(module, "CompletionAppRunner", return_value=runner_instance)

        queue_manager = MagicMock()
        generator._generate_worker(
            flask_app=flask_app,
            session=sqlite_session,
            application_generate_entity=MagicMock(),
            queue_manager=queue_manager,
            message_id="msg",
        )

        assert queue_manager.publish_error.called is should_publish
