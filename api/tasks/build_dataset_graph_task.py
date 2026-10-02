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
from models.dataset import Dataset, Document, DocumentSegment
from models.enums import IndexingStatus, SegmentStatus

logger = logging.getLogger(__name__)

_BATCH_SIZE = 50


@shared_task(queue="dataset")
def build_dataset_graph_task(dataset_id: str, tenant_id: str) -> None:
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
    last_segment_id = ""
    while True:
        with session_factory.create_session() as session:
            dataset = session.scalar(select(Dataset).where(Dataset.id == dataset_id, Dataset.tenant_id == tenant_id))
            if dataset is None:
                logger.info("Dataset %s not found, skipping knowledge graph build", dataset_id)
                return
            if GraphIndexService.get_setting(dataset) is None:
                logger.info("Knowledge graph disabled for dataset %s, stopping build", dataset_id)
                return
            rows = session.execute(
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
                    DocumentSegment.id > last_segment_id,
                    Document.tenant_id == tenant_id,
                    Document.dataset_id == dataset_id,
                    Document.indexing_status == IndexingStatus.COMPLETED,
                    Document.enabled.is_(True),
                    Document.archived.is_(False),
                )
                .order_by(DocumentSegment.id)
                .limit(_BATCH_SIZE)
            ).all()
            session.expunge(dataset)
        if not rows:
            break
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
