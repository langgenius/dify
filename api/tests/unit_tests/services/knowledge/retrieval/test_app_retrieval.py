from datetime import UTC, datetime
from unittest.mock import MagicMock

from dify_trace_sdk.emitter import TraceScope
from dify_trace_sdk.events import DatasetRetrieved, TraceCorrelation, TraceEvent

from core.app.app_config.entities import DatasetEntity, DatasetRetrieveConfigEntity, EasyUIBasedAppConfig
from core.app.entities.app_invoke_entities import (
    EasyUIBasedAppGenerateEntity,
    InvokeFrom,
    ModelConfigWithCredentialsEntity,
)
from graphon.model_runtime.entities.llm_entities import LLMUsage
from libs.datetime_utils import Timing
from models.model import AppMode
from services.knowledge.entities.retrieval import (
    KnowledgeRetrievalResult,
    KnowledgeRetrievalTrace,
    RetrievedTraceDocument,
)
from services.knowledge.retrieval.app_retrieval import retrieve_app_context


class _TraceRecorder:
    def __init__(self) -> None:
        self.events: list[TraceEvent] = []

    def emit(self, event: TraceEvent) -> None:
        self.events.append(event)


def test_retrieve_app_context_emits_dataset_retrieval_event() -> None:
    recorder = _TraceRecorder()
    timing = Timing(
        started_at=datetime(2026, 1, 1, tzinfo=UTC),
        ended_at=datetime(2026, 1, 1, 0, 0, 1, tzinfo=UTC),
    )
    retriever = MagicMock()
    retriever.retrieve.return_value = KnowledgeRetrievalResult(
        sources=[],
        usage=LLMUsage.empty_usage(),
        context="retrieved context",
        trace=KnowledgeRetrievalTrace(
            documents=(
                RetrievedTraceDocument(
                    page_content="answer",
                    provider="dify",
                    metadata={"dataset_id": "dataset-1", "document_id": "document-1"},
                ),
            ),
            timer=timing,
        ),
    )
    entity = EasyUIBasedAppGenerateEntity.model_construct(
        task_id="task-1",
        inputs={},
        files=[],
        stream=False,
        user_id="user-1",
        invoke_from=InvokeFrom.SERVICE_API,
        model_conf=ModelConfigWithCredentialsEntity.model_construct(provider="openai", mode="chat", model="model"),
        app_config=EasyUIBasedAppConfig.model_construct(tenant_id="tenant-1", app_id="app-1", app_mode=AppMode.CHAT),
        trace_scope=TraceScope(
            emitter=recorder,
            tenant_id="tenant-1",
            app_id="app-1",
            user_id="user-1",
            correlation=TraceCorrelation(
                external_trace_id="trace-1",
                session_id="session-1",
                parent_workflow_run_id=None,
                parent_node_execution_id=None,
            ),
        ),
    )
    dataset_config = DatasetEntity(
        dataset_ids=["dataset-1"],
        retrieve_config=DatasetRetrieveConfigEntity(retrieve_strategy="multiple"),
    )

    context, files = retrieve_app_context(
        knowledge_retrieval=retriever,
        application_generate_entity=entity,
        app_id="app-1",
        tenant_id="tenant-1",
        dataset_config=dataset_config,
        query="question",
        show_retrieve_source=False,
        hit_callback=MagicMock(),
        message_id="message-1",
        inputs=None,
        vision_enabled=False,
    )

    assert context == "retrieved context"
    assert files == []
    (event,) = recorder.events
    assert event.correlation.external_trace_id == "trace-1"
    assert isinstance(event.payload, DatasetRetrieved)
    assert event.payload.message_id == "message-1"
    assert event.payload.started_at == timing.started_at
    assert event.payload.ended_at == timing.ended_at
    assert event.payload.documents[0]["page_content"] == "answer"
    assert event.payload.documents[0]["provider"] == "dify"
    assert event.payload.documents[0]["metadata"] == {
        "dataset_id": "dataset-1",
        "document_id": "document-1",
    }
