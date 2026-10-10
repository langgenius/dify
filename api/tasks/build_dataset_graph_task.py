"""Build the knowledge graph for chunks that were indexed before it was enabled."""

import logging
import time

import click
from celery import shared_task
from sqlalchemy import select

from core.db.session_factory import session_factory
from core.rag.graph.graph_index_service import GraphIndexService
from core.rag.index_processor.constant.doc_type import DocType
from core.rag.models.document import Document as IndexDocument
from models.dataset import Dataset, DatasetGraphExtractionFailure, Document, DocumentSegment
from models.enums import IndexingStatus, SegmentStatus
from services.knowledge.graph_build_state import clear_graph_build, mark_graph_build_active

logger = logging.getLogger(__name__)

_BATCH_SIZE = 50


@shared_task(queue="dataset")
def build_dataset_graph_task(dataset_id: str, tenant_id: str, only_failed: bool) -> None:
    """Extract the knowledge graph for a dataset's chunks, or retry only the failed ones.

    The console shows the graph as building until this finishes, whatever the
    outcome, so the marker is cleared even when the build raises.
    """
    try:
        _build(dataset_id, tenant_id, only_failed=only_failed)
    finally:
        clear_graph_build(dataset_id)


def _build(dataset_id: str, tenant_id: str, *, only_failed: bool) -> None:
    """Extract the knowledge graph for every searchable chunk of a dataset.

    Indexing only extracts the graph while the setting is enabled, and creating
    a knowledge base indexes its first documents before the setting can be
    turned on, so those chunks need this backfill. Re-adding a chunk replaces
    its provenance, which keeps redelivery idempotent. The setting is re-read
    per batch so turning the graph off stops further model calls, and each
    batch is read in a short session so extraction runs with no transaction
    open.
    """
    started = time.perf_counter()
    built = 0
    # None until the first page: segment ids are UUIDs on PostgreSQL, so an
    # empty-string cursor is not a valid comparison value.
    last_segment_id: str | None = None
    while True:
        with session_factory.create_session() as session:
            dataset = session.scalar(select(Dataset).where(Dataset.id == dataset_id, Dataset.tenant_id == tenant_id))
            if dataset is None:
                logger.info("Dataset %s not found, skipping knowledge graph build", dataset_id)
                return
            if GraphIndexService.get_setting(dataset) is None:
                logger.info("Knowledge graph disabled for dataset %s, stopping build", dataset_id)
                return
            query = (
                select(
                    DocumentSegment.id,
                    DocumentSegment.content,
                    DocumentSegment.index_node_id,
                    DocumentSegment.document_id,
                )
                .join(Document, Document.id == DocumentSegment.document_id)
                .where(
                    DocumentSegment.tenant_id == tenant_id,
                    DocumentSegment.dataset_id == dataset_id,
                    DocumentSegment.status == SegmentStatus.COMPLETED,
                    DocumentSegment.enabled.is_(True),
                    DocumentSegment.index_node_id.is_not(None),
                    Document.tenant_id == tenant_id,
                    Document.dataset_id == dataset_id,
                    Document.indexing_status == IndexingStatus.COMPLETED,
                    Document.enabled.is_(True),
                    Document.archived.is_(False),
                )
                .order_by(DocumentSegment.id)
                .limit(_BATCH_SIZE)
            )
            if only_failed:
                query = query.where(
                    DocumentSegment.index_node_id.in_(
                        select(DatasetGraphExtractionFailure.index_node_id).where(
                            DatasetGraphExtractionFailure.dataset_id == dataset_id
                        )
                    )
                )
            if last_segment_id is not None:
                query = query.where(DocumentSegment.id > last_segment_id)
            rows = session.execute(query).all()
            session.expunge(dataset)
        if not rows:
            break
        # Keep the console's "building" state alive across slow batches.
        mark_graph_build_active(dataset_id)
        last_segment_id = rows[-1].id
        chunks = [
            IndexDocument(
                page_content=row.content,
                metadata={
                    "doc_id": row.index_node_id,
                    "document_id": row.document_id,
                    "dataset_id": dataset_id,
                    "doc_type": DocType.TEXT,
                },
            )
            for row in rows
        ]
        with session_factory.create_session() as session:
            GraphIndexService.build_for_documents(dataset, chunks, session=session)
            session.commit()
        built += len(chunks)
    logger.info(
        click.style(
            f"Knowledge graph build for dataset {dataset_id} covered {built} chunks "
            f"in {time.perf_counter() - started:.2f}s",
            fg="green",
        )
    )
