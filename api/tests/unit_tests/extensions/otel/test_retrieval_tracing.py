import threading
from unittest.mock import MagicMock, patch
from uuid import uuid4

from opentelemetry.trace import StatusCode, get_current_span, get_tracer

from core.rag.rerank.rerank_type import RerankMode
from core.rag.retrieval.dataset_retrieval import DatasetRetrieval
from core.workflow.nodes.knowledge_retrieval.retrieval import KnowledgeRetrievalRequest
from models.dataset import Dataset


def test_knowledge_retrieval_creates_a_child_otel_span(
    memory_span_exporter,
    tracer_provider_with_memory_exporter,
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
    retrieval = DatasetRetrieval()

    with (
        patch("extensions.otel.decorators.base.dify_config.ENABLE_OTEL", True),
        patch.object(retrieval, "_check_knowledge_rate_limit"),
        patch.object(retrieval, "_get_available_datasets", return_value=[]),
        get_tracer(__name__).start_as_current_span("knowledge-retrieval-node") as node_span,
    ):
        assert retrieval.knowledge_retrieval(MagicMock(), request) == []

    retrieval_span = next(
        span
        for span in memory_span_exporter.get_finished_spans()
        if span.name == "core.rag.retrieval.dataset_retrieval.DatasetRetrieval.knowledge_retrieval"
    )
    node_span_context = node_span.get_span_context()
    assert retrieval_span.context.trace_id == node_span_context.trace_id
    assert retrieval_span.parent is not None
    assert retrieval_span.parent.span_id == node_span_context.span_id


def test_multiple_retrieve_preserves_otel_context_in_dataset_thread(
    app,
    tracer_provider_with_memory_exporter,
) -> None:
    """Per-dataset retrieval spans must remain in the workflow node trace."""
    retrieval = DatasetRetrieval()
    dataset = MagicMock(spec=Dataset)
    dataset.id = str(uuid4())
    dataset.indexing_technique = "high_quality"
    dataset.embedding_model = "text-embedding-3-small"
    dataset.embedding_model_provider = "openai"
    observed_trace_ids: list[int] = []

    def record_active_trace(**_kwargs: object) -> None:
        observed_trace_ids.append(get_current_span().get_span_context().trace_id)

    with (
        app.app_context(),
        patch("extensions.otel.decorators.base.dify_config.ENABLE_OTEL", True),
        patch.object(retrieval, "_multiple_retrieve_thread", side_effect=record_active_trace),
        patch.object(retrieval, "_on_query"),
        get_tracer(__name__).start_as_current_span("knowledge-retrieval-node") as node_span,
    ):
        retrieval.multiple_retrieve(
            app_id=str(uuid4()),
            tenant_id=str(uuid4()),
            user_id=str(uuid4()),
            user_from="account",
            available_datasets=[dataset],
            query="test query",
            top_k=4,
            score_threshold=0.0,
            reranking_mode=RerankMode.RERANKING_MODEL,
            reranking_enable=False,
        )

    assert observed_trace_ids == [node_span.get_span_context().trace_id]


def test_retriever_thread_exception_sets_error_span_and_is_collected(
    app,
    memory_span_exporter,
    tracer_provider_with_memory_exporter,
) -> None:
    retrieval = DatasetRetrieval()
    cancel_event = threading.Event()
    thread_exceptions: list[Exception] = []
    expected_error = RuntimeError("retrieval failed")

    with (
        patch("extensions.otel.decorators.base.dify_config.ENABLE_OTEL", True),
        patch("core.rag.retrieval.dataset_retrieval.session_factory.create_session"),
        patch.object(retrieval, "_retriever", side_effect=expected_error),
    ):
        retrieval._run_retriever_thread_safely(
            flask_app=app,
            dataset_id=str(uuid4()),
            query="test query",
            top_k=4,
            all_documents=[],
            document_ids_filter=None,
            metadata_condition=None,
            attachment_ids=None,
            cancel_event=cancel_event,
            thread_exceptions=thread_exceptions,
        )

    retrieval_span = next(
        span
        for span in memory_span_exporter.get_finished_spans()
        if span.name.endswith("DatasetRetrieval._run_retriever_thread")
    )
    assert retrieval_span.status.status_code == StatusCode.ERROR
    assert cancel_event.is_set()
    assert thread_exceptions == [expected_error]
