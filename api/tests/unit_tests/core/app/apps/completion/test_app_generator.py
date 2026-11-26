import contextlib
import json
from datetime import UTC, datetime
from decimal import Decimal
from unittest.mock import MagicMock

import httpx
import pytest
from dify_trace_sdk.emitter import TraceScope
from dify_trace_sdk.events import TraceCorrelation, TraceEvent
from pydantic import ValidationError
from pytest_mock import MockerFixture
from sqlalchemy.orm import Session

import core.app.app_config.easy_ui_based_app.model_config.converter as model_config_converter_module
import core.app.apps.completion.app_generator as module
import core.plugin.impl.base as plugin_client_module
from core.app.app_config.entities import EasyUIBasedAppModelConfigFrom, ModelConfigEntity, PromptTemplateEntity
from core.app.apps.completion.app_config_manager import CompletionAppConfig
from core.app.apps.completion.app_generator import CompletionAppGenerator
from core.app.apps.exc import GenerateTaskStoppedError
from core.app.entities.app_invoke_entities import CompletionAppGenerateEntity, InvokeFrom
from core.entities.provider_configuration import ProviderConfiguration, ProviderConfigurations
from core.entities.provider_entities import (
    CustomConfiguration,
    CustomProviderConfiguration,
    SystemConfiguration,
)
from core.plugin.entities.plugin_daemon import PluginDaemonBasicResponse, PluginModelSchemaEntity
from core.plugin.impl.model_runtime_factory import create_plugin_model_runtime
from core.provider_manager import ProviderManager
from core.workflow.file_reference import resolve_file_record_id
from extensions.storage.storage_type import StorageType
from graphon.file import FileTransferMethod, FileType, FileUploadConfig
from graphon.model_runtime.entities.common_entities import I18nObject
from graphon.model_runtime.entities.llm_entities import LLMMode
from graphon.model_runtime.entities.model_entities import AIModelEntity, FetchFrom, ModelPropertyKey, ModelType
from graphon.model_runtime.entities.provider_entities import ConfigurateMethod, ProviderEntity
from graphon.model_runtime.errors.invoke import InvokeAuthorizationError
from graphon.model_runtime.model_providers.base.large_language_model import LargeLanguageModel
from models import Account, CreatorUserRole, UploadFile
from models.enums import ConversationFromSource
from models.enums import InvokeFrom as ModelInvokeFrom
from models.model import App, AppMode, AppModelConfig, Conversation, Message
from models.provider import ProviderType
from models.provider_ids import ModelProviderID
from tests.helpers.unit.core.model_fixtures import make_model_config

TABLES = (AppModelConfig, Conversation, Message)


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
            external_trace_id=None, session_id="session-1", parent_workflow_run_id=None, parent_node_execution_id=None
        ),
    )


@pytest.fixture
def generator(mocker: MockerFixture) -> CompletionAppGenerator:
    gen = CompletionAppGenerator()

    mocker.patch.object(module, "copy_current_request_context", side_effect=lambda fn: fn)

    flask_app = MagicMock()
    flask_app.app_context.return_value = contextlib.nullcontext()
    mocker.patch.object(module, "current_app", MagicMock(_get_current_object=MagicMock(return_value=flask_app)))

    thread = MagicMock()
    mocker.patch.object(module.threading, "Thread", return_value=thread)

    mocker.patch.object(module, "MessageBasedAppQueueManager", return_value=MagicMock())

    return gen


@pytest.fixture(autouse=True)
def _bind_db_session(sqlite_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(module.db, "session", sqlite_session)


def _build_app_model() -> App:
    return App(
        id="app1",
        tenant_id="tenant",
        name="Completion app",
        description="",
        mode=AppMode.COMPLETION,
        app_model_config_id="cfg-current",
        enable_site=False,
        enable_api=False,
    )


def _build_user() -> Account:
    account = Account(name="User", email="user@example.com")
    account.id = "user"
    return account


def _build_app_model_config() -> AppModelConfig:
    return AppModelConfig(app_id="app1", model='{"provider": "x"}')


def _build_app_config() -> CompletionAppConfig:
    """A real config so ``generate()`` builds a real ``CompletionAppGenerateEntity``."""
    return CompletionAppConfig(
        app_id="app1",
        tenant_id="tenant",
        app_mode=AppMode.COMPLETION,
        app_model_config_from=EasyUIBasedAppModelConfigFrom.APP_LATEST_CONFIG,
        app_model_config_id="cfg-current",
        app_model_config_dict={"model": {"provider": "x"}},
        model=ModelConfigEntity(provider="openai", model="model", mode="completion"),
        prompt_template=PromptTemplateEntity(
            prompt_type=PromptTemplateEntity.PromptType.SIMPLE,
            simple_prompt_template="Answer the query.",
        ),
        variables=[],
    )


def _real_model_provider_manager() -> ProviderManager:
    """Real provider manager with a real predefined-model catalog injected through its request cache.

    Mirrors the fallback-catalog pattern from tests/unit_tests/core/test_provider_manager.py:
    the manager, configuration, model-type instance and plugin runtime are all real; only the
    provider catalog lookup is pre-seeded so no DB or plugin I/O is needed.
    """
    provider_schema = ProviderEntity(
        provider="openai",
        label=I18nObject(en_US="OpenAI"),
        supported_model_types=[ModelType.LLM],
        configurate_methods=[ConfigurateMethod.PREDEFINED_MODEL],
        models=[
            AIModelEntity(
                model="model",
                label=I18nObject(en_US="Model"),
                model_type=ModelType.LLM,
                fetch_from=FetchFrom.PREDEFINED_MODEL,
                model_properties={},
            )
        ],
    )
    configuration = ProviderConfiguration(
        tenant_id="tenant",
        provider=provider_schema,
        preferred_provider_type=ProviderType.CUSTOM,
        using_provider_type=ProviderType.CUSTOM,
        system_configuration=SystemConfiguration(enabled=False),
        custom_configuration=CustomConfiguration(
            provider=CustomProviderConfiguration(credentials={"api_key": "synthetic"})
        ),
        model_settings=[],
    )
    runtime = create_plugin_model_runtime(tenant_id="tenant")
    configuration.bind_model_runtime(runtime)
    manager = ProviderManager(model_runtime=runtime)
    catalog = ProviderConfigurations(tenant_id="tenant")
    catalog[str(ModelProviderID("openai"))] = configuration
    manager._configurations_cache["tenant"] = catalog
    return manager


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
        _inputs={},
        introduction="",
        system_instruction="",
        invoke_from=ModelInvokeFrom.WEB_APP,
        from_source=ConversationFromSource.CONSOLE,
        from_end_user_id=None,
        from_account_id="user",
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
        _inputs={"a": 1},
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
        invoke_from=ModelInvokeFrom.WEB_APP,
        from_source=ConversationFromSource.CONSOLE,
        from_end_user_id=None,
        from_account_id="user",
        workflow_run_id=None,
        app_mode=AppMode.COMPLETION,
    )
    session.add(message)
    session.flush()
    return message


@pytest.mark.parametrize("sqlite_session", [TABLES], indirect=True)
class TestCompletionAppGenerator:
    def test_generate_invalid_query_type(self, generator: CompletionAppGenerator, sqlite_session: Session) -> None:
        with pytest.raises(ValueError, match="query must be a string"):
            generator.generate(
                session=sqlite_session,
                app_model=_build_app_model(),
                user=_build_user(),
                args={"query": 123, "inputs": {}, "files": []},
                invoke_from=InvokeFrom.WEB_APP,
                streaming=True,
            )

    def test_generate_override_not_debugger(self, generator: CompletionAppGenerator, sqlite_session: Session) -> None:
        with pytest.raises(ValueError, match="^$"):
            generator.generate(
                session=sqlite_session,
                app_model=_build_app_model(),
                user=_build_user(),
                args={"query": "q", "inputs": {}, "files": [], "model_config": {}},
                invoke_from=InvokeFrom.WEB_APP,
                streaming=False,
            )

    def test_generate_success_no_file_config(
        self,
        generator: CompletionAppGenerator,
        mocker: MockerFixture,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_session: Session,
    ) -> None:
        trace_scope = _trace_scope()
        scope_requests: list[dict[str, object]] = []

        def create_trace_scope(**kwargs: object) -> TraceScope:
            scope_requests.append(kwargs)
            return trace_scope

        monkeypatch.setattr(module, "create_trace_scope", create_trace_scope)
        app_model_config = _build_app_model_config()
        mocker.patch.object(generator, "_get_app_model_config", return_value=app_model_config)
        to_dict = mocker.patch.object(AppModelConfig, "to_dict", return_value={"model": {"provider": "x"}})
        annotation_reply = {"enabled": False}
        load_annotation_reply_config = mocker.patch.object(
            module,
            "load_annotation_reply_config",
            return_value=annotation_reply,
        )
        build_from_mappings = mocker.spy(module.file_factory, "build_from_mappings")

        app_config = _build_app_config()
        get_app_config = mocker.patch.object(
            module.CompletionAppConfigManager,
            "get_app_config",
            return_value=app_config,
        )
        mocker.patch.object(
            module.ModelConfigConverter,
            "convert",
            return_value=make_model_config(provider="openai", model="model", mode="completion"),
        )

        mocker.patch.object(generator, "_prepare_user_inputs", return_value={"k": "v"})

        conversation = Conversation(
            id="conv",
            app_id="app1",
            mode=AppMode.COMPLETION,
            name="Conversation",
            _inputs={},
            from_source=ConversationFromSource.CONSOLE,
        )
        message = Message(
            id="msg",
            app_id="app1",
            conversation_id="conv",
            _inputs={},
            query="q",
            message={},
            message_unit_price=Decimal(0),
            answer="",
            answer_unit_price=Decimal(0),
            currency="USD",
            from_source=ConversationFromSource.CONSOLE,
        )
        init_records = mocker.patch.object(generator, "_init_generate_records", return_value=(conversation, message))

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
        generate_entity = init_records.call_args.args[0]
        assert isinstance(generate_entity, CompletionAppGenerateEntity)
        extras = generate_entity.extras
        assert extras == {"trace_session_id": "session-1"}
        assert generate_entity.trace_scope is trace_scope
        assert scope_requests == [
            {"tenant_id": "tenant", "app_id": "app1", "app_tracing": None, "user_id": "user", "extras": extras}
        ]
        assert generate_entity.file_upload_config is None
        assert generate_entity.files == []
        build_from_mappings.assert_not_called()
        load_annotation_reply_config.assert_called_once_with(sqlite_session, "app1")
        to_dict.assert_called_once_with(annotation_reply=annotation_reply)
        assert get_app_config.call_args.kwargs["annotation_reply"] is annotation_reply

    def test_generate_success_with_files(
        self, generator: CompletionAppGenerator, mocker: MockerFixture, sqlite_session: Session
    ) -> None:
        app_model_config = _build_app_model_config()
        mocker.patch.object(generator, "_get_app_model_config", return_value=app_model_config)
        mocker.patch.object(AppModelConfig, "to_dict", return_value={"model": {"provider": "x"}})

        file_extra_config = FileUploadConfig(
            allowed_file_types=[FileType.DOCUMENT],
            allowed_file_extensions=[".pdf"],
            allowed_file_upload_methods=[FileTransferMethod.LOCAL_FILE],
        )
        mocker.patch.object(module.FileUploadConfigManager, "convert", return_value=file_extra_config)
        upload_file = UploadFile(
            tenant_id="tenant",
            storage_type=StorageType.LOCAL,
            key="upload_files/tenant/report.pdf",
            name="report.pdf",
            size=2048,
            extension="pdf",
            mime_type="application/pdf",
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by="user",
            created_at=datetime(2026, 1, 1, tzinfo=UTC),
            used=False,
            source_url="http://example.com/report.pdf",
        )
        sqlite_session.add(upload_file)
        sqlite_session.commit()

        app_config = _build_app_config()
        mocker.patch.object(module.CompletionAppConfigManager, "get_app_config", return_value=app_config)
        mocker.patch.object(
            module.ModelConfigConverter,
            "convert",
            return_value=make_model_config(provider="openai", model="model", mode="completion"),
        )

        mocker.patch.object(generator, "_prepare_user_inputs", return_value={"k": "v"})

        conversation = Conversation(
            id="conv",
            app_id="app1",
            mode=AppMode.COMPLETION,
            name="Conversation",
            _inputs={},
            from_source=ConversationFromSource.CONSOLE,
        )
        message = Message(
            id="msg",
            app_id="app1",
            conversation_id="conv",
            _inputs={},
            query="q",
            message={},
            message_unit_price=Decimal(0),
            answer="",
            answer_unit_price=Decimal(0),
            currency="USD",
            from_source=ConversationFromSource.CONSOLE,
        )
        init_records = mocker.patch.object(generator, "_init_generate_records", return_value=(conversation, message))

        mocker.patch.object(generator, "_handle_response", return_value="response")
        mocker.patch.object(module.CompletionAppGenerateResponseConverter, "convert", return_value="converted")

        result = generator.generate(
            session=sqlite_session,
            app_model=_build_app_model(),
            user=_build_user(),
            args={
                "query": "q",
                "inputs": {"a": 1},
                "files": [
                    {
                        "transfer_method": "local_file",
                        "upload_file_id": upload_file.id,
                        "type": "document",
                        "id": "file1",
                    },
                    # A caller-supplied mapping without ``transfer_method`` is not a file at all:
                    # the factory must drop it instead of raising on it.
                    {"type": "document", "id": "ignored"},
                ],
            },
            invoke_from=InvokeFrom.WEB_APP,
            streaming=False,
        )

        assert result == "converted"
        generate_entity = init_records.call_args.args[0]
        assert isinstance(generate_entity, CompletionAppGenerateEntity)
        assert len(generate_entity.files) == 1
        built_file = generate_entity.files[0]
        assert built_file.id == "file1"
        assert built_file.type == FileType.DOCUMENT
        assert built_file.transfer_method == FileTransferMethod.LOCAL_FILE
        assert built_file.filename == "report.pdf"
        assert built_file.extension == ".pdf"
        assert built_file.mime_type == "application/pdf"
        assert built_file.size == 2048
        assert built_file.remote_url == "http://example.com/report.pdf"
        assert built_file.storage_key == "upload_files/tenant/report.pdf"
        assert resolve_file_record_id(built_file.reference) == upload_file.id

    def test_generate_override_model_config_debugger(
        self,
        generator: CompletionAppGenerator,
        mocker: MockerFixture,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_session: Session,
    ) -> None:
        app_model_config = _build_app_model_config()
        mocker.patch.object(generator, "_get_app_model_config", return_value=app_model_config)

        override_config = {"model": {"provider": "override"}}
        mocker.patch.object(module.CompletionAppConfigManager, "config_validate", return_value=override_config)

        app_config = _build_app_config()
        # Leave the mode unset so the converter has to derive it from the model schema, and carry a
        # ``stop`` sequence inside the parameters so the converter has to lift it out of them.
        app_config.model.mode = None
        app_config.model.parameters = {"stop": ["END"], "temperature": 0.7}
        get_app_config = mocker.patch.object(
            module.CompletionAppConfigManager,
            "get_app_config",
            return_value=app_config,
        )
        mocker.patch.object(module.FileUploadConfigManager, "convert", return_value=None)

        provider_manager = _real_model_provider_manager()
        monkeypatch.setattr(
            model_config_converter_module, "create_plugin_provider_manager", lambda **_kwargs: provider_manager
        )
        daemon_requests: list[httpx.Request] = []
        schema_response = PluginDaemonBasicResponse[PluginModelSchemaEntity](
            code=0,
            message="",
            data=PluginModelSchemaEntity(
                model_schema=AIModelEntity(
                    model="model",
                    label=I18nObject(en_US="Model"),
                    model_type=ModelType.LLM,
                    fetch_from=FetchFrom.PREDEFINED_MODEL,
                    model_properties={ModelPropertyKey.MODE: LLMMode.COMPLETION.value},
                )
            ),
        )

        def schema_dispatch(request: httpx.Request) -> httpx.Response:
            daemon_requests.append(request)
            return httpx.Response(
                200,
                text=f"data: {schema_response.model_dump_json()}\n\n",
                headers={"Content-Type": "text/event-stream"},
            )

        mocker.patch.object(generator, "_prepare_user_inputs", return_value={"k": "v"})
        init_records = mocker.patch.object(
            generator,
            "_init_generate_records",
            return_value=(
                Conversation(
                    id="conv",
                    app_id="app1",
                    mode=AppMode.COMPLETION,
                    name="Conversation",
                    _inputs={},
                    from_source=ConversationFromSource.CONSOLE,
                ),
                Message(
                    id="msg",
                    app_id="app1",
                    conversation_id="conv",
                    _inputs={},
                    query="q",
                    message={},
                    message_unit_price=Decimal(0),
                    answer="",
                    answer_unit_price=Decimal(0),
                    currency="USD",
                    from_source=ConversationFromSource.CONSOLE,
                ),
            ),
        )
        mocker.patch.object(generator, "_handle_response", return_value="response")
        mocker.patch.object(module.CompletionAppGenerateResponseConverter, "convert", return_value="converted")

        with httpx.Client(transport=httpx.MockTransport(schema_dispatch)) as client, monkeypatch.context() as patch:
            patch.setattr(plugin_client_module, "_httpx_client", client)
            generator.generate(
                session=sqlite_session,
                app_model=_build_app_model(),
                user=_build_user(),
                args={"query": "q", "inputs": {}, "files": [], "model_config": override_config},
                invoke_from=InvokeFrom.DEBUGGER,
                streaming=True,
            )

        assert get_app_config.call_args.kwargs["override_config_dict"] == override_config
        generate_entity = init_records.call_args.args[0]
        assert isinstance(generate_entity, CompletionAppGenerateEntity)
        model_conf = generate_entity.model_conf
        assert model_conf.provider == "openai"
        assert model_conf.model == "model"
        assert model_conf.mode == LLMMode.COMPLETION
        assert model_conf.stop == ["END"]
        assert "stop" not in model_conf.parameters
        assert model_conf.parameters == {"temperature": 0.7}
        assert model_conf.credentials == {"api_key": "synthetic"}
        assert model_conf.model_schema.model == "model"
        assert isinstance(model_conf.provider_model_bundle.model_type_instance, LargeLanguageModel)
        assert model_conf.provider_model_bundle.configuration is provider_manager._configurations_cache["tenant"].get(
            "openai"
        )
        assert len(daemon_requests) == 1
        request = daemon_requests[0]
        assert request.method == "POST"
        assert request.url.path == "/plugin/tenant/dispatch/model/schema"
        assert request.headers["Content-Type"] == "application/json"
        assert request.headers["X-Plugin-ID"] == "langgenius/openai"
        assert json.loads(request.content) == {
            "data": {
                "provider": "openai",
                "model_type": "llm",
                "model": "model",
                "credentials": {"api_key": "synthetic"},
            }
        }

    @pytest.mark.parametrize(
        ("error", "should_publish"),
        [
            (GenerateTaskStoppedError(), False),
            (InvokeAuthorizationError("bad"), True),
            (
                ValidationError.from_exception_data(
                    "Model",
                    [{"type": "missing", "loc": ("x",), "input": {}}],
                ),
                True,
            ),
            (ValueError("bad"), True),
            (RuntimeError("boom"), True),
        ],
    )
    def test_generate_worker_error_handling(
        self,
        generator: CompletionAppGenerator,
        mocker: MockerFixture,
        sqlite_session: Session,
        error: Exception,
        should_publish: bool,
    ) -> None:
        flask_app = MagicMock()
        flask_app.app_context.return_value = contextlib.nullcontext()

        message = _persist_message(sqlite_session)
        mocker.patch.object(generator, "_get_message", return_value=message)

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
