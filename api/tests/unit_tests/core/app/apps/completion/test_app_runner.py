from collections.abc import Callable
from dataclasses import dataclass, field
from decimal import Decimal
from types import SimpleNamespace

import pytest
from sqlalchemy import event
from sqlalchemy.orm import Session

import core.app.apps.completion.app_runner as module
from core.app.app_config.entities import (
    AppAdditionalFeatures,
    DatasetEntity,
    DatasetRetrieveConfigEntity,
    PromptTemplateEntity,
)
from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.apps.completion.app_config_manager import CompletionAppConfig
from core.app.apps.completion.app_runner import CompletionAppRunner
from core.app.entities.app_invoke_entities import InvokeFrom, ModelConfigWithCredentialsEntity
from core.credit_usage import CreditUsageAppType, CreditUsageCreatedBy
from core.model_manager import ModelInstance, ModelManager
from core.moderation.base import ModerationError
from core.rag.retrieval.dataset_retrieval import DatasetRetrieval
from graphon.file import FileUploadConfig
from graphon.file.models import ImageConfig
from graphon.model_runtime.entities.message_entities import ImagePromptMessageContent
from graphon.model_runtime.entities.model_entities import ModelType
from models.enums import ConversationFromSource
from models.model import App, AppMode, Conversation, IconType, Message

APP_ID = "00000000-0000-0000-0000-000000000001"
TENANT_ID = "00000000-0000-0000-0000-000000000002"


@dataclass(frozen=True)
class RecordedCall:
    args: tuple[object, ...]
    kwargs: dict[str, object]


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


class RecordingQueueManager(AppQueueManager):
    def __init__(self) -> None:
        self.published: list[tuple[object, PublishFrom]] = []

    def _publish(self, event: object, pub_from: PublishFrom) -> None:
        self.published.append((event, pub_from))


class RecordingDatasetRetrieval(DatasetRetrieval):
    def __init__(self, result: tuple[object, list[object]]) -> None:
        self.result = result
        self.calls: list[RecordedCall] = []

    def retrieve(self, *args: object, **kwargs: object) -> tuple[object, list[object]]:
        self.calls.append(RecordedCall(args=args, kwargs=kwargs))
        return self.result


class RecordingModelInstance(ModelInstance):
    def __init__(self, result: object = "invoke_result", implementation: Callable[..., object] | None = None) -> None:
        self.result = result
        self.implementation = implementation
        self.calls: list[RecordedCall] = []

    def invoke_llm(self, *args: object, **kwargs: object) -> object:
        self.calls.append(RecordedCall(args=args, kwargs=kwargs))
        if self.implementation is not None:
            return self.implementation(*args, **kwargs)
        return self.result


class RecordingModelManager(ModelManager):
    def __init__(self, model_instance: RecordingModelInstance) -> None:
        self.model_instance = model_instance
        self.calls: list[RecordedCall] = []

    def get_model_instance(self, *args: object, **kwargs: object) -> RecordingModelInstance:
        self.calls.append(RecordedCall(args=args, kwargs=kwargs))
        return self.model_instance


@pytest.fixture
def runner():
    return CompletionAppRunner()


def _build_app_config(dataset=None, external_tools=None, additional_features=None):
    return CompletionAppConfig.model_construct(
        app_id=APP_ID,
        tenant_id=TENANT_ID,
        app_mode=AppMode.COMPLETION,
        prompt_template=PromptTemplateEntity(
            prompt_type=PromptTemplateEntity.PromptType.SIMPLE,
            simple_prompt_template="Answer the query.",
        ),
        dataset=dataset,
        external_data_variables=external_tools or [],
        additional_features=additional_features,
        app_model_config_dict={"file_upload": {"enabled": True}},
    )


def _build_generate_entity(app_config, file_upload_config=None):
    model_conf = ModelConfigWithCredentialsEntity.model_construct(
        provider="provider",
        provider_model_bundle="bundle",
        model="model",
        parameters={"max_tokens": 10},
        stop=["stop"],
    )
    return SimpleNamespace(
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
    def test_run_app_not_found(self, runner, sqlite_session: Session):
        app_config = _build_app_config()
        app_generate_entity = _build_generate_entity(app_config)

        with pytest.raises(ValueError):
            runner.run(app_generate_entity, RecordingQueueManager(), _message(), sqlite_session)

    def test_run_moderation_error_outputs_direct(self, runner, sqlite_session: Session):
        _, message = _persist_records(sqlite_session)

        app_config = _build_app_config()
        app_generate_entity = _build_generate_entity(app_config)

        runner.organize_prompt_messages = CallRecorder(result=([], None))  # type: ignore[method-assign]
        runner.moderation_for_inputs = CallRecorder(error=ModerationError("blocked"))  # type: ignore[method-assign]
        direct_output = CallRecorder()
        handle_invoke_result = CallRecorder()
        runner.direct_output = direct_output  # type: ignore[method-assign]
        runner._handle_invoke_result = handle_invoke_result  # type: ignore[method-assign]

        runner.run(app_generate_entity, RecordingQueueManager(), message, sqlite_session)

        assert len(direct_output.calls) == 1
        assert handle_invoke_result.calls == []

    def test_run_hosting_moderation_stops(self, runner, sqlite_session: Session):
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

        runner.run(app_generate_entity, RecordingQueueManager(), message, sqlite_session)

        assert handle_invoke_result.calls == []

    def test_run_dataset_and_external_tools_flow(
        self, runner, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
    ):
        _, message = _persist_records(sqlite_session)

        retrieve_config = DatasetRetrieveConfigEntity(
            query_variable="qvar",
            retrieve_strategy=DatasetRetrieveConfigEntity.RetrieveStrategy.SINGLE,
        )
        dataset_config = DatasetEntity(dataset_ids=["ds"], retrieve_config=retrieve_config)
        additional_features = AppAdditionalFeatures(show_retrieve_source=True)
        app_config = _build_app_config(
            dataset=dataset_config,
            external_tools=["tool"],
            additional_features=additional_features,
        )

        file_upload_config = FileUploadConfig(image_config=ImageConfig(detail=ImagePromptMessageContent.DETAIL.HIGH))

        app_generate_entity = _build_generate_entity(app_config, file_upload_config=file_upload_config)

        runner.organize_prompt_messages = CallRecorder(  # type: ignore[method-assign]
            results=[(["pm1"], ["stop"]), (["pm2"], ["stop"])]
        )
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

        dataset_retrieval = RecordingDatasetRetrieval(("ctx", ["file1"]))
        monkeypatch.setattr(module, "DatasetRetrieval", lambda _: dataset_retrieval)

        model_instance = RecordingModelInstance()
        model_manager = RecordingModelManager(model_instance)
        monkeypatch.setattr(module.ModelManager, "for_tenant", staticmethod(lambda tenant_id: model_manager))

        runner.run(app_generate_entity, RecordingQueueManager(), message, sqlite_session)

        assert len(dataset_retrieval.calls) == 1
        assert dataset_retrieval.calls[0].kwargs["query"] == "query_from_input"
        assert len(handle_invoke_result.calls) == 1

    def test_run_closes_explicit_session_before_stream_consumption(
        self, runner, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
    ):
        _, message = _persist_records(sqlite_session)
        app_config = _build_app_config()
        app_generate_entity = _build_generate_entity(app_config)
        queue_manager = RecordingQueueManager()

        events = []
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

        def invoke_stream():
            events.append("first-chunk")
            yield "chunk"

        def invoke_llm(**kwargs):
            events.append("invoke")
            return invoke_stream()

        model_instance = RecordingModelInstance(implementation=invoke_llm)
        model_manager = RecordingModelManager(model_instance)
        monkeypatch.setattr(module.ModelManager, "for_tenant", staticmethod(lambda tenant_id: model_manager))
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
        runner,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_session: Session,
        stream: bool,
    ):
        _, message = _persist_records(sqlite_session)
        app_config = _build_app_config()
        app_generate_entity = _build_generate_entity(app_config)
        app_generate_entity.stream = stream

        runner.organize_prompt_messages = CallRecorder(result=(["prompt"], ["stop"]))  # type: ignore[method-assign]
        runner.moderation_for_inputs = CallRecorder(  # type: ignore[method-assign]
            result=(None, app_generate_entity.inputs, "query")
        )
        runner.check_hosting_moderation = CallRecorder(result=False)  # type: ignore[method-assign]
        runner.recalc_llm_max_tokens = CallRecorder()  # type: ignore[method-assign]
        runner._handle_invoke_result = CallRecorder()  # type: ignore[method-assign]

        model_instance = RecordingModelInstance()
        model_manager = RecordingModelManager(model_instance)
        model_manager_factory = CallRecorder(result=model_manager)
        monkeypatch.setattr(module.ModelManager, "for_tenant", staticmethod(model_manager_factory))

        runner.run(app_generate_entity, RecordingQueueManager(), message, sqlite_session)

        assert model_manager_factory.calls == [RecordedCall(args=(), kwargs={"tenant_id": TENANT_ID})]
        assert model_manager.calls == [
            RecordedCall(
                args=(),
                kwargs={
                    "tenant_id": TENANT_ID,
                    "provider": "provider",
                    "model_type": ModelType.LLM,
                    "model": "model",
                },
            )
        ]
        assert model_instance.calls == [
            RecordedCall(
                args=(),
                kwargs={
                    "prompt_messages": ["prompt"],
                    "model_parameters": {"max_tokens": 10},
                    "stop": ["stop"],
                    "stream": stream,
                    "request_metadata": {
                        "app_id": APP_ID,
                        "app_type": CreditUsageAppType.COMPLETION,
                        "created_by": CreditUsageCreatedBy.APP,
                    },
                },
            )
        ]

    def test_run_uses_low_image_detail_default(self, runner, sqlite_session: Session):
        _, message = _persist_records(sqlite_session)

        app_config = _build_app_config()
        app_generate_entity = _build_generate_entity(app_config, file_upload_config=None)

        organize_prompt_messages = CallRecorder(result=([], None))
        runner.organize_prompt_messages = organize_prompt_messages  # type: ignore[method-assign]
        runner.moderation_for_inputs = CallRecorder(  # type: ignore[method-assign]
            result=(None, app_generate_entity.inputs, "query")
        )
        runner.check_hosting_moderation = CallRecorder(result=True)  # type: ignore[method-assign]

        runner.run(app_generate_entity, RecordingQueueManager(), message, sqlite_session)

        assert organize_prompt_messages.calls[-1].kwargs["image_detail_config"] == ImagePromptMessageContent.DETAIL.LOW
