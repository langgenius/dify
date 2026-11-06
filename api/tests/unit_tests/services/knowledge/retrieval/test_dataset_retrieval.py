import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.app.app_config.entities import DatasetRetrieveConfigEntity
from core.app.apps.message_based_app_queue_manager import MessageBasedAppQueueManager
from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.entities.queue_entities import QueueRetrieverResourcesEvent
from core.rag.index_processor.constant.index_type import IndexTechniqueType
from core.rag.models.document import Document
from core.rag.retrieval.retrieval_methods import RetrievalMethod
from extensions.application_services.retrieval import build_dataset_retrieval
from extensions.ext_storage import storage
from models.dataset import Dataset, DatasetKeywordTable, DocumentSegment
from models.enums import IndexingStatus, SegmentStatus
from repositories.knowledge.keyword_table_repository import save_keyword_table
from services.knowledge.retrieval.adapters.resource_events import DatasetIndexToolCallbackHandler
from services.knowledge.retrieval.dataset_retrieval import DatasetRetrieval
from tests.helpers.unit.model_factories import make_document


def _persist_keyword_dataset(
    session: Session,
    *,
    retrieval_model: dict[str, object] | None,
    segment_count: int = 5,
) -> Dataset:
    """Persist one high-quality dataset whose keyword index has deterministic cardinality."""
    dataset = Dataset(
        id="dataset-1",
        tenant_id="tenant-1",
        name="Knowledge",
        created_by="user-1",
        provider="vendor",
        indexing_technique=IndexTechniqueType.HIGH_QUALITY,
        retrieval_model=retrieval_model,
    )
    document = make_document(
        document_id="document-1",
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        created_by="user-1",
    )
    document.indexing_status = IndexingStatus.COMPLETED
    node_ids = [f"node-{position}" for position in range(1, segment_count + 1)]
    segments = [
        DocumentSegment(
            tenant_id=dataset.tenant_id,
            dataset_id=dataset.id,
            document_id=document.id,
            position=position,
            content=f"Python document {position}",
            word_count=3,
            tokens=3,
            created_by="user-1",
            index_node_id=node_id,
            index_node_hash=f"hash-{position}",
            status=SegmentStatus.COMPLETED,
        )
        for position, node_id in enumerate(node_ids, start=1)
    ]
    keyword_table = save_keyword_table(
        storage=storage,
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        storage_type="database",
        table={"python": set(node_ids)},
    )
    session.add_all(
        [
            dataset,
            document,
            *segments,
            DatasetKeywordTable(dataset_id=dataset.id, data_source_type="database", keyword_table=keyword_table),
        ]
    )
    session.commit()
    return dataset


def _retrieve_dataset(
    retrieval: DatasetRetrieval,
    queue_manager: MessageBasedAppQueueManager,
    *,
    query: str,
    top_k: int,
) -> str:
    """Run the real Agent entry point against the persisted single dataset."""
    return retrieval.retrieve_dataset(
        tenant_id="tenant-1",
        app_id="app-1",
        user_id="user-1",
        dataset_id="dataset-1",
        query=query,
        config=DatasetRetrieveConfigEntity(retrieve_strategy=DatasetRetrieveConfigEntity.RetrieveStrategy.SINGLE),
        top_k=top_k,
        inputs={},
        invoke_from=InvokeFrom.DEBUGGER,
        return_resource=False,
        hit_callback=DatasetIndexToolCallbackHandler(queue_manager),
    )


def test_external_context_preserves_document_metadata_in_published_resources(
    sqlite_session_factory: sessionmaker[Session],
    agent_queue_manager: MessageBasedAppQueueManager,
) -> None:
    """Publish external metadata unchanged through the production resource callback."""
    metadata = {
        "dataset_id": "external-dataset",
        "dataset_name": "External knowledge",
        "document_id": "external-document",
        "title": "External document",
        "score": 0.9,
        "category": "reference",
        "attributes": {"region": "global"},
    }
    document = Document(page_content="Retrieved content", metadata=metadata, provider="external")
    retrieval = build_dataset_retrieval(sqlite_session_factory)()
    assert isinstance(retrieval, DatasetRetrieval)

    context, files = retrieval._context(
        all_documents=[document],
        tenant_id="tenant",
        available_datasets_ids=["external-dataset"],
        show_retrieve_source=True,
        vision_enabled=False,
        invoke_from=InvokeFrom.SERVICE_API,
        hit_callback=DatasetIndexToolCallbackHandler(agent_queue_manager),
    )

    message = agent_queue_manager._q.get_nowait()
    assert message is not None
    assert isinstance(message.event, QueueRetrieverResourcesEvent)
    assert len(message.event.retriever_resources) == 1
    resource = message.event.retriever_resources[0]
    assert resource.doc_metadata == metadata
    assert resource.document_id == "external-document"
    assert resource.content == "Retrieved content"
    assert document.metadata == metadata
    assert context == "Retrieved content"
    assert files == []


@pytest.mark.parametrize(
    "stored_settings",
    [
        pytest.param(
            {"top_k": 2, "reranking_enable": False, "score_threshold_enabled": False},
            id="missing-search-method",
        ),
        pytest.param({}, id="empty-settings"),
        pytest.param(None, id="unset-settings"),
    ],
)
def test_dataset_tool_defaults_missing_search_method_without_mutating_stored_settings(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    agent_queue_manager: MessageBasedAppQueueManager,
    stored_settings: dict[str, object] | None,
) -> None:
    """Accept partial or empty legacy settings without persisting normalized defaults."""
    _persist_keyword_dataset(sqlite_session, retrieval_model=stored_settings)
    retrieval = build_dataset_retrieval(sqlite_session_factory)()
    assert isinstance(retrieval, DatasetRetrieval)

    # Settings are resolved before the real RetrievalService skips an empty query,
    # so this exercises the missing-key regression without a vector backend.
    result = _retrieve_dataset(retrieval, agent_queue_manager, query="", top_k=2)

    assert result == ""
    sqlite_session.expire_all()
    persisted = sqlite_session.scalar(select(Dataset).where(Dataset.id == "dataset-1"))
    assert persisted is not None
    assert persisted.retrieval_model == stored_settings


@pytest.mark.usefixtures("agent_runtime_app")
@pytest.mark.parametrize("top_k", [0, 2])
def test_dataset_tool_preserves_explicit_search_method_and_resolved_top_k(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    agent_queue_manager: MessageBasedAppQueueManager,
    top_k: int,
) -> None:
    """Honor the tool's resolved limit, including zero, and its explicit search method."""
    _persist_keyword_dataset(
        sqlite_session,
        retrieval_model={
            "search_method": RetrievalMethod.KEYWORD_SEARCH,
            "reranking_enable": False,
            "score_threshold_enabled": False,
        },
    )
    retrieval = build_dataset_retrieval(sqlite_session_factory)()
    assert isinstance(retrieval, DatasetRetrieval)

    context = _retrieve_dataset(retrieval, agent_queue_manager, query="python", top_k=top_k)

    assert context.count("Python document") == top_k


@pytest.mark.usefixtures("agent_runtime_app")
def test_regular_retriever_keeps_shared_missing_top_k_default(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    """Calls without a tool override keep the shared four-document default."""
    dataset = _persist_keyword_dataset(
        sqlite_session,
        retrieval_model={
            "search_method": RetrievalMethod.KEYWORD_SEARCH,
            "reranking_enable": False,
            "score_threshold_enabled": False,
        },
    )
    retrieval = build_dataset_retrieval(sqlite_session_factory)()
    assert isinstance(retrieval, DatasetRetrieval)
    documents: list[Document] = []

    retrieval._retriever(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        query="python",
        top_k=2,
        all_documents=documents,
    )

    assert len(documents) == 4
