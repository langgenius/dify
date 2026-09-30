import logging
import time

import click
from sqlalchemy import select
from werkzeug.exceptions import NotFound

from core.db.session_factory import session_factory
from events.document_index_event import document_index_created
from libs.datetime_utils import naive_utc_now
from models.dataset import Document
from models.enums import IndexingStatus
from services.knowledge.indexing.adapters.execution import build_document_indexing_service
from services.knowledge.indexing.errors import DocumentIsPausedError
from services.knowledge.resource_scope import DatasetRef

logger = logging.getLogger(__name__)


@document_index_created.connect
def handle(sender, **kwargs):
    dataset_id = sender
    document_ids = kwargs.get("document_ids", [])
    start_at = time.perf_counter()
    try:
        indexing_service = build_document_indexing_service(
            session_factory=session_factory.get_session_maker(), enforce_vector_space_admission=True
        )
        with session_factory.create_session() as session:
            documents = []
            for document_id in document_ids:
                logger.info(click.style(f"Start process document: {document_id}", fg="green"))

                document = session.scalar(
                    select(Document).where(
                        Document.id == document_id,
                        Document.dataset_id == dataset_id,
                    )
                )

                if not document:
                    raise NotFound("Document not found")

                document.indexing_status = IndexingStatus.PARSING
                document.processing_started_at = naive_utc_now()
                documents.append(document)
                session.add(document)
            document_refs = [DatasetRef(doc.tenant_id, doc.dataset_id).document(doc.id) for doc in documents]
            # Persist the status transition before extraction and indexing begin.
            session.commit()
            indexing_service.run(document_refs)
        end_at = time.perf_counter()
        logger.info(click.style(f"Processed dataset: {dataset_id} latency: {end_at - start_at}", fg="green"))
    except DocumentIsPausedError as ex:
        logger.info(click.style(str(ex), fg="yellow"))
    except Exception:
        logger.exception("Document index event handler failed, dataset_id: %s", dataset_id)
