import threading
from collections.abc import Callable, Generator, Sequence
from unittest.mock import create_autospec, patch
from uuid import uuid4

import pytest
from flask import Flask
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.trace import StatusCode, get_current_span

from core.rag.models.document import Document
from services.knowledge.admission.application import DatasetAdmissionLimits
from services.knowledge.entities.metadata import Condition
from services.knowledge.entities.retrieval import KnowledgeRetrievalRequest
from services.knowledge.retrieval.application import KnowledgeRetrievalApplicationService
from services.knowledge.retrieval.candidate_search import (
    CandidateReranker,
    CandidateSearch,
    DatasetDocumentFilter,
    InternalDatasetCandidateRetriever,
)
from services.knowledge.retrieval.metadata_filtering import MetadataFilterPlanner
from services.knowledge.retrieval.records import RetrievalFinalizer
from services.knowledge.retrieval.retrieval import (
    ExternalDatasetRetriever,
    RetrievalDatasetSnapshot,
)


@pytest.fixture
def memory_span_exporter() -> InMemorySpanExporter:
    """Provide a fresh exporter per test so assertions cannot observe another test's spans."""
    return InMemorySpanExporter()


@pytest.fixture
def tracer_provider_with_memory_exporter(
    memory_span_exporter: InMemorySpanExporter,
    monkeypatch: pytest.MonkeyPatch,
) -> Generator[TracerProvider]:
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(memory_span_exporter))
    monkeypatch.setattr("extensions.otel.decorators.base.get_tracer", provider.get_tracer)
    yield provider
    provider.shutdown()


def _candidate_search() -> CandidateSearch:
    internal_retrieval = create_autospec(InternalDatasetCandidateRetriever, instance=True, spec_set=True)
    no_documents: list[Document] = []
    internal_retrieval.retrieve.return_value = no_documents
    return CandidateSearch(
        internal_retrieval=internal_retrieval,
        external_retrieval=create_autospec(ExternalDatasetRetriever, instance=True, spec_set=True),
        reranker=create_autospec(CandidateReranker, instance=True, spec_set=True),
    )


class EmptyRetrievalRepository:
    def __init__(self) -> None:
        self.available_datasets: list[RetrievalDatasetSnapshot] = []

    def list_available_datasets(self, *, tenant_id: str, dataset_ids: Sequence[str]) -> list[RetrievalDatasetSnapshot]:
        del tenant_id, dataset_ids
        return self.available_datasets

    def get_available_dataset(self, *, tenant_id: str, dataset_id: str) -> RetrievalDatasetSnapshot | None:
        del tenant_id, dataset_id
        return None

    def list_metadata_field_names(self, *, tenant_id: str, dataset_ids: Sequence[str]) -> list[str]:
        del tenant_id, dataset_ids
        return []

    def filter_document_ids(
        self,
        *,
        tenant_id: str,
        dataset_ids: Sequence[str],
        logical_operator: str,
        conditions: Sequence[Condition] | None,
    ) -> dict[str, list[str]]:
        del tenant_id, dataset_ids, logical_operator, conditions
        return {}

    def expand_document_ids_filter(
        self, *, tenant_id: str, dataset_id: str, document_ids: Sequence[str]
    ) -> tuple[str, ...]:
        del tenant_id, dataset_id
        return tuple(document_ids)

    def record_app_query(
        self,
        *,
        tenant_id: str,
        dataset_ids: Sequence[str],
        query: str | None,
        attachment_ids: Sequence[str] | None,
        app_id: str,
        user_from: str,
        user_id: str,
    ) -> None:
        del tenant_id, dataset_ids, query, attachment_ids, app_id, user_from, user_id

    def increment_segment_hit_counts(self, segment_ids: Sequence[str]) -> None:
        del segment_ids


def _retrieval_application() -> tuple[KnowledgeRetrievalApplicationService, EmptyRetrievalRepository]:
    repository = EmptyRetrievalRepository()
    retrieval = KnowledgeRetrievalApplicationService(
        repository=repository,
        candidate_search=_candidate_search(),
        metadata_filters=create_autospec(MetadataFilterPlanner, instance=True, spec_set=True),
        finalizer=create_autospec(RetrievalFinalizer, instance=True, spec_set=True),
        limits=create_autospec(DatasetAdmissionLimits, instance=True, spec_set=True),
    )
    return retrieval, repository


@pytest.fixture(autouse=True)
def _otel_enabled(config_overrides: Callable[..., None]) -> None:
    config_overrides(ENABLE_OTEL=True)


@pytest.fixture
def retrieval_dataset() -> RetrievalDatasetSnapshot:
    return RetrievalDatasetSnapshot(
        id=str(uuid4()),
        tenant_id=str(uuid4()),
        name="Tracing test dataset",
        description=None,
        provider="dify",
        retrieval_model=None,
        indexing_technique="high_quality",
        embedding_model_provider="openai",
        embedding_model="text-embedding-3-small",
    )


def _request(dataset: RetrievalDatasetSnapshot) -> KnowledgeRetrievalRequest:
    return KnowledgeRetrievalRequest(
        tenant_id=dataset.tenant_id,
        user_id=str(uuid4()),
        app_id=str(uuid4()),
        user_from="account",
        dataset_ids=[dataset.id],
        retrieval_mode="multiple",
        query="test query",
        reranking_enable=False,
    )


def test_knowledge_retrieval_creates_a_child_otel_span(
    memory_span_exporter: InMemorySpanExporter,
    tracer_provider_with_memory_exporter: TracerProvider,
) -> None:
    """The retrieval entry point must be visible beneath its workflow node span."""
    request = KnowledgeRetrievalRequest(
        tenant_id=str(uuid4()),
        user_id=str(uuid4()),
        app_id=str(uuid4()),
        user_from="account",
        dataset_ids=[str(uuid4())],
        retrieval_mode="multiple",
        query="test query",
    )
    retrieval, repository = _retrieval_application()
    no_datasets: list[RetrievalDatasetSnapshot] = []
    repository.available_datasets = no_datasets

    with tracer_provider_with_memory_exporter.get_tracer(__name__).start_as_current_span(
        "knowledge-retrieval-node"
    ) as node_span:
        assert retrieval.retrieve(request, request_metadata=None).sources == []

    retrieval_span = next(
        span
        for span in memory_span_exporter.get_finished_spans()
        if span.name == "services.knowledge.retrieval.application.KnowledgeRetrievalApplicationService.retrieve"
    )
    node_span_context = node_span.get_span_context()
    assert retrieval_span.context is not None
    assert retrieval_span.context.trace_id == node_span_context.trace_id
    assert retrieval_span.parent is not None
    assert retrieval_span.parent.span_id == node_span_context.span_id


def test_multiple_retrieve_preserves_otel_context_in_dataset_thread(
    app: Flask,
    tracer_provider_with_memory_exporter: TracerProvider,
    retrieval_dataset: RetrievalDatasetSnapshot,
) -> None:
    """Per-query retrieval spans must remain in the workflow node trace."""
    retrieval = _candidate_search()
    observed_trace_ids: list[int] = []

    def record_active_trace(**_kwargs: object) -> None:
        observed_trace_ids.append(get_current_span().get_span_context().trace_id)

    with (
        app.app_context(),
        patch.object(retrieval, "_search_across_datasets", side_effect=record_active_trace),
        tracer_provider_with_memory_exporter.get_tracer(__name__).start_as_current_span(
            "knowledge-retrieval-node"
        ) as node_span,
    ):
        retrieval.search_multiple(
            request=_request(retrieval_dataset),
            datasets=[retrieval_dataset],
            document_filters={retrieval_dataset.id: DatasetDocumentFilter(None, None)},
            metadata_condition=None,
        )

    assert observed_trace_ids == [node_span.get_span_context().trace_id]


def test_retriever_thread_exception_sets_error_span_and_is_collected(
    app: Flask,
    memory_span_exporter: InMemorySpanExporter,
    tracer_provider_with_memory_exporter: TracerProvider,
) -> None:
    retrieval = _candidate_search()
    dataset = RetrievalDatasetSnapshot(
        id=str(uuid4()),
        tenant_id=str(uuid4()),
        name="Economy dataset",
        description=None,
        provider="dify",
        retrieval_model=None,
        indexing_technique="economy",
        embedding_model_provider=None,
        embedding_model=None,
    )
    cancel_event = threading.Event()
    thread_exceptions: list[Exception] = []
    expected_error = RuntimeError("retrieval failed")

    with patch.object(retrieval, "calculate_keyword_score", side_effect=expected_error):
        retrieval._search_across_datasets_safely(
            flask_app=app,
            datasets=[dataset],
            document_filters={dataset.id: DatasetDocumentFilter(None, None)},
            metadata_condition=None,
            all_documents=[],
            request=_request(dataset),
            weights=None,
            query="test query",
            attachment_id=None,
            cancel_event=cancel_event,
            exceptions=thread_exceptions,
        )

    retrieval_span = next(
        span
        for span in memory_span_exporter.get_finished_spans()
        if span.name.endswith("CandidateSearch._search_across_datasets")
    )
    assert retrieval_span.status.status_code == StatusCode.ERROR
    assert cancel_event.is_set()
    assert thread_exceptions == [expected_error]


def test_retriever_thread_exception_emits_skip_event_when_requested(
    app: Flask,
    memory_span_exporter: InMemorySpanExporter,
    tracer_provider_with_memory_exporter: TracerProvider,
    retrieval_dataset: RetrievalDatasetSnapshot,
) -> None:
    retrieval = _candidate_search()
    expected_error = RuntimeError("retrieval failed")
    documents: list[Document] = []

    with (
        patch.object(retrieval, "_retrieve_dataset", side_effect=expected_error),
        tracer_provider_with_memory_exporter.get_tracer(__name__).start_as_current_span("dataset-retrieval-parent"),
    ):
        retrieval._retrieve_dataset_safely(
            flask_app=app,
            dataset=retrieval_dataset,
            query="test query",
            top_k=4,
            document_filter=None,
            metadata_condition=None,
            attachment_ids=None,
            all_documents=documents,
        )

    parent_span = next(
        span for span in memory_span_exporter.get_finished_spans() if span.name == "dataset-retrieval-parent"
    )
    skip_event = next(event for event in parent_span.events if event.name == "dataset_retrieval.skipped")
    assert skip_event.attributes is not None
    assert skip_event.attributes["dataset_id"] == retrieval_dataset.id
    assert skip_event.attributes["error.message"] == "retrieval failed"
    assert documents == []
