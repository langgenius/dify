import contextlib
import logging
import time

import click
from werkzeug.exceptions import NotFound

from core.indexing_runner import DocumentIsPausedError, IndexingRunner
from events.document_index_event import document_index_created
from extensions.ext_database import db
from libs.datetime_utils import naive_utc_now
from models.dataset import Document

logger = logging.getLogger(__name__)


@document_index_created.connect
def handle(sender, **kwargs):
    dataset_id = sender
    document_ids = kwargs.get("document_ids", [])
    documents = []
    start_at = time.perf_counter()
    for document_id in document_ids:
        logger.info(click.style(f"Start process document: {document_id}", fg="green"))

        document = (
            db.session.query(Document)
            .where(
                Document.id == document_id,
                Document.dataset_id == dataset_id,
            )
            .first()
        )

        if not document:
            raise NotFound("Document not found")

        document.indexing_status = "parsing"
        document.processing_started_at = naive_utc_now()
        documents.append(document)
        db.session.add(document)
    db.session.commit()

    with contextlib.suppress(Exception):
        try:
            indexing_runner = IndexingRunner()
            indexing_runner.run(documents)
            end_at = time.perf_counter()
            logger.info(click.style(f"Processed dataset: {dataset_id} latency: {end_at - start_at}", fg="green"))
        except DocumentIsPausedError as ex:
            logger.info(click.style(str(ex), fg="yellow"))
