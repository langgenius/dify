from collections.abc import Callable, Generator, Iterator
from dataclasses import dataclass, field
from decimal import Decimal

import pytest
from flask import Flask
from redis import Redis
from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from core.app.app_config.entities import (
    AppAdditionalFeatures,
    DatasetEntity,
    DatasetRetrieveConfigEntity,
    EasyUIBasedAppModelConfigFrom,
    ExternalDataVariableEntity,
    ModelConfigEntity,
    PromptTemplateEntity,
)
from core.app.apps.completion.app_config_manager import CompletionAppConfig
from core.app.apps.completion.app_runner import CompletionAppRunner
from core.app.apps.message_based_app_queue_manager import MessageBasedAppQueueManager
from core.app.entities.app_invoke_entities import CompletionAppGenerateEntity, InvokeFrom
from core.credit_usage import CreditUsageAppType, CreditUsageCreatedBy
from core.entities.provider_configuration import ProviderModelBundle
from core.entities.provider_entities import CustomProviderConfiguration
from core.moderation.base import ModerationError
from core.plugin.impl.model import PluginModelClient
from core.plugin.impl.model_runtime import PluginModelRuntime
from core.plugin.impl.model_runtime_factory import create_plugin_model_runtime
from core.provider_manager import ProviderManager
from extensions.ext_database import db
from extensions.ext_redis import RedisClientWrapper
from graphon.file import FileUploadConfig
from graphon.file.models import ImageConfig
from graphon.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk, LLMResultChunkDelta
from graphon.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    ImagePromptMessageContent,
    UserPromptMessage,
)
from graphon.model_runtime.entities.model_entities import ModelType
from graphon.model_runtime.model_providers.base.large_language_model import LargeLanguageModel
from models.dataset import Dataset
from models.enums import ConversationFromSource
from models.model import App, AppMode, Conversation, IconType, Message
from services.knowledge.external.service import ExternalDatasetService
from tests.unit_tests.core.model_fixtures import make_model_config

APP_ID = "00000000-0000-0000-0000-000000000001"
TENANT_ID = "00000000-0000-0000-0000-000000000002"
PROVIDER = "langgenius/openai/openai"


@dataclass(frozen=True)
class RecordedCall:
    args: tuple[object, ...]
    kwargs: dict[str, object]


def record_delegated_calls[**P, R](function: Callable[P, R], calls: list[RecordedCall]) -> Callable[P, R]:
    """Record arguments without replacing the production method's behavior."""

    def recorded(*args: P.args, **kwargs: P.kwargs) -> R:
        calls.append(RecordedCall(args=args, kwargs=kwargs))
        return function(*args, **kwargs)

    return recorded


@dataclass
class CallRecorder:
    result: object = None
    results: list[object] | None = None
    error: Exception | None = None
    implementation: Callable[..., object] | None = None
    calls: list[RecordedCall] = field(default_factory=list)

    def __call__(self, *args: object, **kwargs: object) -> object:
        self.calls.append(RecordedCall(args=args, kwargs=kwargs))
        if self.error is not None:
            raise self.error
        if self.implementation is not None:
            return self.implementation(*args, **kwargs)
        if self.results is not None:
            return self.results.pop(0)
        return self.result


@pytest.fixture
def queue_manager(monkeypatch: pytest.MonkeyPatch) -> Iterator[MessageBasedAppQueueManager]:
    with Redis() as client:
        monkeypatch.setattr(client, "execute_command", lambda *_args, **_kwargs: None)
        redis = RedisClientWrapper()
        redis.initialize(client)
        monkeypatch.setattr("core.app.apps.base_app_queue_manager.redis_client", redis)
        monkeypatch.setattr("core.plugin.impl.model_runtime.redis_client", redis)
        yield MessageBasedAppQueueManager(
            task_id="task",
            user_id="user",
            invoke_from=InvokeFrom.SERVICE_API,
            conversation_id="conv",
            app_mode=AppMode.COMPLETION,
            message_id="msg",
        )


@pytest.fixture
def model_runtime(monkeypatch: pytest.MonkeyPatch) -> tuple[ProviderModelBundle, list[RecordedCall], list[str]]:
    """Run the real manager, model, runtime and client; isolate configuration lookup and daemon I/O."""
    config = make_model_config(provider=PROVIDER, model="model", mode="completion")
    bundle = config.provider_model_bundle
    bundle.configuration.tenant_id = TENANT_ID
    bundle.configuration.custom_configuration.provider = CustomProviderConfiguration(credentials={"api_key": "token"})
    bundle.model_type_instance = LargeLanguageModel(
        provider_schema=bundle.configuration.provider,
        model_runtime=create_plugin_model_runtime(tenant_id=TENANT_ID),
    )
    calls: list[RecordedCall] = []
    events: list[str] = []

    def provider_bundle(
        _manager: ProviderManager, *, tenant_id: str, provider: str, model_type: ModelType
    ) -> ProviderModelBundle:
        assert (tenant_id, provider, model_type) == (TENANT_ID, PROVIDER, ModelType.LLM)
        return bundle

    def dispatch(_client: PluginModelClient, **kwargs: object) -> Generator[LLMResultChunk, None, None]:
        calls.append(RecordedCall(args=(), kwargs=kwargs))
        events.append("invoke")
        events.append("first-chunk")
        yield LLMResultChunk(
            model="model",
            delta=LLMResultChunkDelta(index=0, message=AssistantPromptMessage(content="answer")),
        )

    monkeypatch.setattr(ProviderManager, "get_provider_model_bundle", provider_bundle)
    monkeypatch.setattr(PluginModelRuntime, "invoke_llm", record_delegated_calls(PluginModelRuntime.invoke_llm, calls))
    monkeypatch.setattr(PluginModelClient, "_request_with_plugin_daemon_response_stream", dispatch)
    monkeypatch.setattr(PluginModelClient, "get_model_schema", lambda *_args, **_kwargs: config.model_schema)
    return bundle, calls, events


@pytest.fixture
def retrieval_app(sqlite_engine: Engine) -> Iterator[Flask]:
    """Bind the real Flask database extension for independent retrieval audit writes."""
    app = Flask(__name__)
    app.config["SQLALCHEMY_DATABASE_URI"] = sqlite_engine.url
    db.init_app(app)
    with app.app_context():
        try:
            yield app
        finally:
            db.engine.dispose()


@pytest.fixture
def runner() -> CompletionAppRunner:
    return CompletionAppRunner()


def _build_app_config(
    dataset: DatasetEntity | None = None,
    external_tools: list[ExternalDataVariableEntity] | None = None,
    additional_features: AppAdditionalFeatures | None = None,
) -> CompletionAppConfig:
    """None disables the corresponding optional retrieval, external-tool or feature configuration."""
    return CompletionAppConfig(
        app_id=APP_ID,
        tenant_id=TENANT_ID,
        app_mode=AppMode.COMPLETION,
        app_model_config_from=EasyUIBasedAppModelConfigFrom.APP_LATEST_CONFIG,
        app_model_config_id="model-config",
        model=ModelConfigEntity(provider=PROVIDER, model="model", mode="completion"),
        prompt_template=PromptTemplateEntity(
            prompt_type=PromptTemplateEntity.PromptType.SIMPLE,
            simple_prompt_template="Answer the query.",
        ),
        dataset=dataset,
        external_data_variables=external_tools or [],
        additional_features=additional_features,
        app_model_config_dict={"file_upload": {"enabled": True}},
    )


def _build_generate_entity(
    app_config: CompletionAppConfig, file_upload_config: FileUploadConfig | None = None
) -> CompletionAppGenerateEntity:
    """None leaves uploads unconfigured so the runner uses its default image detail."""
    model_conf = make_model_config(provider=PROVIDER, model="model", mode="completion")
    model_conf.parameters = {"max_tokens": 10}
    model_conf.stop = ["stop"]
    return CompletionAppGenerateEntity(
        task_id="task",
        app_config=app_config,
        model_conf=model_conf,
        inputs={"qvar": "query_from_input"},
        query="original_query",
        files=[],
        file_upload_config=file_upload_config,
        stream=True,
        user_id="user",
        invoke_from=InvokeFrom.SERVICE_API,
    )


def _message() -> Message:
    return Message(
        id="msg",
        app_id=APP_ID,
        conversation_id="conv",
        inputs={},
        query="query",
        message={},
        message_unit_price=Decimal(0),
        answer="",
        answer_unit_price=Decimal(0),
        total_price=Decimal(0),
        currency="USD",
        invoke_from=InvokeFrom.SERVICE_API,
        from_source=ConversationFromSource.API,
        from_account_id="user",
        app_mode=AppMode.COMPLETION,
    )


def _persist_records(session: Session) -> tuple[App, Message]:
    app = App(
        id=APP_ID,
        tenant_id=TENANT_ID,
        name="Completion app",
        mode=AppMode.COMPLETION,
        icon_type=IconType.EMOJI,
        icon="chat",
        icon_background="#ffffff",
        enable_site=False,
        enable_api=False,
    )
    conversation = Conversation(
        id="conv",
        app_id=APP_ID,
        mode=AppMode.COMPLETION,
        name="Conversation",
        inputs={},
        invoke_from=InvokeFrom.SERVICE_API,
        from_source=ConversationFromSource.API,
        from_account_id="user",
    )
    message = _message()
    session.add_all([app, conversation, message])
    session.commit()
    return app, message


class TestCompletionAppRunner:
    def test_run_app_not_found(
        self, runner: CompletionAppRunner, sqlite_session: Session, queue_manager: MessageBasedAppQueueManager
    ) -> None:
        app_config = _build_app_config()
        app_generate_entity = _build_generate_entity(app_config)

        with pytest.raises(ValueError):
            runner.run(app_generate_entity, queue_manager, _message(), sqlite_session)

    def test_run_moderation_error_outputs_direct(
        self, runner: CompletionAppRunner, sqlite_session: Session, queue_manager: MessageBasedAppQueueManager
    ) -> None:
        _, message = _persist_records(sqlite_session)

        app_config = _build_app_config()
        app_generate_entity = _build_generate_entity(app_config)

        runner.organize_prompt_messages = CallRecorder(result=([], None))  # type: ignore[method-assign]
        runner.moderation_for_inputs = CallRecorder(error=ModerationError("blocked"))  # type: ignore[method-assign]
        direct_output = CallRecorder()
        handle_invoke_result = CallRecorder()
        runner.direct_output = direct_output  # type: ignore[method-assign]
        runner._handle_invoke_result = handle_invoke_result  # type: ignore[method-assign]

        runner.run(app_generate_entity, queue_manager, message, sqlite_session)

        assert len(direct_output.calls) == 1
        assert handle_invoke_result.calls == []

    def test_run_hosting_moderation_stops(
        self, runner: CompletionAppRunner, sqlite_session: Session, queue_manager: MessageBasedAppQueueManager
    ) -> None:
        _, message = _persist_records(sqlite_session)

        app_config = _build_app_config()
        app_generate_entity = _build_generate_entity(app_config)

        runner.organize_prompt_messages = CallRecorder(result=([], None))  # type: ignore[method-assign]
        runner.moderation_for_inputs = CallRecorder(  # type: ignore[method-assign]
            result=(None, app_generate_entity.inputs, "query")
        )
        runner.check_hosting_moderation = CallRecorder(result=True)  # type: ignore[method-assign]
        handle_invoke_result = CallRecorder()
        runner._handle_invoke_result = handle_invoke_result  # type: ignore[method-assign]

        runner.run(app_generate_entity, queue_manager, message, sqlite_session)

        assert handle_invoke_result.calls == []

    def test_run_dataset_and_external_tools_flow(
        self,
        runner: CompletionAppRunner,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_session: Session,
        queue_manager: MessageBasedAppQueueManager,
        model_runtime: tuple[ProviderModelBundle, list[RecordedCall], list[str]],
        retrieval_app: Flask,
    ) -> None:
        _, message = _persist_records(sqlite_session)
        dataset = Dataset(
            id="ds", tenant_id=TENANT_ID, name="External knowledge", provider="external", created_by="user"
        )
        sqlite_session.add(dataset)
        sqlite_session.commit()

        retrieve_config = DatasetRetrieveConfigEntity(
            query_variable="qvar",
            retrieve_strategy=DatasetRetrieveConfigEntity.RetrieveStrategy.SINGLE,
        )
        dataset_config = DatasetEntity(dataset_ids=["ds"], retrieve_config=retrieve_config)
        additional_features = AppAdditionalFeatures(show_retrieve_source=True)
        app_config = _build_app_config(
            dataset=dataset_config,
            external_tools=[ExternalDataVariableEntity(variable="tool", type="api", config={})],
            additional_features=additional_features,
        )

        file_upload_config = FileUploadConfig(image_config=ImageConfig(detail=ImagePromptMessageContent.DETAIL.HIGH))

        app_generate_entity = _build_generate_entity(app_config, file_upload_config=file_upload_config)

        organize_prompt_messages = CallRecorder(
            results=[([UserPromptMessage(content="pm1")], ["stop"]), ([UserPromptMessage(content="pm2")], ["stop"])]
        )
        runner.organize_prompt_messages = organize_prompt_messages  # type: ignore[method-assign]
        runner.moderation_for_inputs = CallRecorder(  # type: ignore[method-assign]
            result=(None, app_generate_entity.inputs, "query")
        )
        runner.fill_in_inputs_from_external_data_tools = CallRecorder(  # type: ignore[method-assign]
            result=app_generate_entity.inputs
        )
        runner.check_hosting_moderation = CallRecorder(result=False)  # type: ignore[method-assign]
        runner.recalc_llm_max_tokens = CallRecorder()  # type: ignore[method-assign]
        handle_invoke_result = CallRecorder()
        runner._handle_invoke_result = handle_invoke_result  # type: ignore[method-assign]

        retrieval_calls: list[dict[str, object]] = []

        def retrieve_external(**kwargs: object) -> list[dict[str, object]]:
            retrieval_calls.append(kwargs)
            return [{"content": "ctx", "metadata": {}, "score": 1.0, "title": "Document"}]

        monkeypatch.setattr(ExternalDatasetService, "fetch_external_knowledge_retrieval", retrieve_external)

        runner.run(app_generate_entity, queue_manager, message, sqlite_session)

        assert len(retrieval_calls) == 1
        assert retrieval_calls[0]["query"] == "query_from_input"
        assert retrieval_calls[0]["tenant_id"] == TENANT_ID
        assert retrieval_calls[0]["dataset_id"] == dataset.id
        assert organize_prompt_messages.calls[-1].kwargs["context"] == "ctx"
        assert organize_prompt_messages.calls[-1].kwargs["context_files"] == []
        assert len(handle_invoke_result.calls) == 1

    def test_run_closes_explicit_session_before_stream_consumption(
        self,
        runner: CompletionAppRunner,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_session: Session,
        queue_manager: MessageBasedAppQueueManager,
        model_runtime: tuple[ProviderModelBundle, list[RecordedCall], list[str]],
    ) -> None:
        _, message = _persist_records(sqlite_session)
        app_config = _build_app_config()
        app_generate_entity = _build_generate_entity(app_config)

        _, _, events = model_runtime
        session = sqlite_session
        original_close = session.close

        def record_commit(_session: Session) -> None:
            events.append("commit")

        def record_close() -> None:
            events.append("close")
            original_close()

        runner.organize_prompt_messages = CallRecorder(result=([], None))  # type: ignore[method-assign]
        runner.moderation_for_inputs = CallRecorder(  # type: ignore[method-assign]
            result=(None, app_generate_entity.inputs, "query")
        )
        runner.check_hosting_moderation = CallRecorder(result=False)  # type: ignore[method-assign]
        runner.recalc_llm_max_tokens = CallRecorder()  # type: ignore[method-assign]
        handle_invoke_result = CallRecorder(implementation=lambda invoke_result, **kwargs: list(invoke_result))
        runner._handle_invoke_result = handle_invoke_result  # type: ignore[method-assign]

        monkeypatch.setattr(session, "close", record_close)

        event.listen(session, "after_commit", record_commit)
        try:
            runner.run(app_generate_entity, queue_manager, message, session)
        finally:
            event.remove(session, "after_commit", record_commit)

        assert events == ["commit", "close", "invoke", "first-chunk"]
        assert len(handle_invoke_result.calls) == 1
        handle_call = handle_invoke_result.calls[0]
        assert handle_call.args == ()
        assert handle_call.kwargs["queue_manager"] is queue_manager
        assert handle_call.kwargs | {"invoke_result": None} == {
            "invoke_result": None,
            "queue_manager": queue_manager,
            "stream": True,
            "message_id": "msg",
            "user_id": "user",
            "tenant_id": TENANT_ID,
        }

    @pytest.mark.parametrize("stream", [False, True])
    def test_run_invokes_model_resolved_by_model_manager(
        self,
        runner: CompletionAppRunner,
        sqlite_session: Session,
        stream: bool,
        queue_manager: MessageBasedAppQueueManager,
        model_runtime: tuple[ProviderModelBundle, list[RecordedCall], list[str]],
    ) -> None:
        _, message = _persist_records(sqlite_session)
        app_config = _build_app_config()
        app_generate_entity = _build_generate_entity(app_config)
        app_generate_entity.stream = stream

        runner.organize_prompt_messages = CallRecorder(  # type: ignore[method-assign]
            result=([UserPromptMessage(content="prompt")], ["stop"])
        )
        runner.moderation_for_inputs = CallRecorder(  # type: ignore[method-assign]
            result=(None, app_generate_entity.inputs, "query")
        )
        runner.check_hosting_moderation = CallRecorder(result=False)  # type: ignore[method-assign]
        runner.recalc_llm_max_tokens = CallRecorder()  # type: ignore[method-assign]
        results: list[LLMResult | list[LLMResultChunk]] = []

        def handle_result(invoke_result: LLMResult | Generator[LLMResultChunk, None, None], **_kwargs: object) -> None:
            results.append(invoke_result if isinstance(invoke_result, LLMResult) else list(invoke_result))

        runner._handle_invoke_result = handle_result  # type: ignore[method-assign]

        runner.run(app_generate_entity, queue_manager, message, sqlite_session)

        bundle, calls, _ = model_runtime
        assert bundle.configuration.tenant_id == TENANT_ID
        assert len(calls) == 2
        assert isinstance(calls[0].args[0], PluginModelRuntime)
        assert calls[0].kwargs["request_metadata"] == {
            "app_id": APP_ID,
            "app_type": CreditUsageAppType.COMPLETION,
            "created_by": CreditUsageCreatedBy.APP,
        }
        assert calls[1:] == [
            RecordedCall(
                args=(),
                kwargs={
                    "method": "POST",
                    "path": f"plugin/{TENANT_ID}/dispatch/llm/invoke",
                    "type_": LLMResultChunk,
                    "headers": {"X-Plugin-ID": "langgenius/openai", "Content-Type": "application/json"},
                    "data": {
                        "app_id": APP_ID,
                        "data": {
                            "provider": "openai",
                            "model_type": "llm",
                            "model": "model",
                            "credentials": {"api_key": "token"},
                            "prompt_messages": [{"role": "user", "content": "prompt", "name": None}],
                            "model_parameters": {"max_tokens": 10},
                            "tools": None,
                            "stop": ["stop"],
                            "stream": stream,
                        },
                    },
                },
            )
        ]
        assert len(results) == 1
        result = results[0]
        if stream:
            assert isinstance(result, list)
            assert result[0].delta.message.content == "answer"
        else:
            assert isinstance(result, LLMResult)
            assert result.message.content == "answer"

    def test_run_uses_low_image_detail_default(
        self, runner: CompletionAppRunner, sqlite_session: Session, queue_manager: MessageBasedAppQueueManager
    ) -> None:
        _, message = _persist_records(sqlite_session)

        app_config = _build_app_config()
        app_generate_entity = _build_generate_entity(app_config, file_upload_config=None)

        organize_prompt_messages = CallRecorder(result=([], None))
        runner.organize_prompt_messages = organize_prompt_messages  # type: ignore[method-assign]
        runner.moderation_for_inputs = CallRecorder(  # type: ignore[method-assign]
            result=(None, app_generate_entity.inputs, "query")
        )
        runner.check_hosting_moderation = CallRecorder(result=True)  # type: ignore[method-assign]

        runner.run(app_generate_entity, queue_manager, message, sqlite_session)

        assert organize_prompt_messages.calls[-1].kwargs["image_detail_config"] == ImagePromptMessageContent.DETAIL.LOW
