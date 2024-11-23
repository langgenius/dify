import datetime
import logging
import time

import click
from celery import shared_task
from werkzeug.exceptions import NotFound

from core.indexing_runner import DocumentIsPausedError, IndexingRunner
from core.rag.extractor.notion_extractor import NotionExtractor
from core.rag.index_processor.index_processor_factory import IndexProcessorFactory
from extensions.ext_database import db
from models.dataset import Dataset, Document, DocumentSegment
from models.source import DataSourceOauthBinding


@shared_task(queue="dataset")
def document_indexing_sync_task(dataset_id: str, document_id: str):
    """
    Async update document
    :param dataset_id:
    :param document_id:

    Usage: document_indexing_sync_task.delay(dataset_id, document_id)
    """
    logging.info(click.style("Start sync document: {}".format(document_id), fg="green"))
    start_at = time.perf_counter()

    document = db.session.query(Document).filter(Document.id == document_id, Document.dataset_id == dataset_id).first()

    if not document:
        raise NotFound("Document not found")

    data_source_info = document.data_source_info_dict
    if document.data_source_type == "notion_import":
        if (
            not data_source_info
            or "notion_page_id" not in data_source_info
            or "notion_workspace_id" not in data_source_info
        ):
            raise ValueError("no notion page found")
        workspace_id = data_source_info["notion_workspace_id"]
        page_id = data_source_info["notion_page_id"]
        page_type = data_source_info["type"]
        page_edited_time = data_source_info["last_edited_time"]
        data_source_binding = DataSourceOauthBinding.query.filter(
            db.and_(
                DataSourceOauthBinding.tenant_id == document.tenant_id,
                DataSourceOauthBinding.provider == "notion",
                DataSourceOauthBinding.disabled == False,
                DataSourceOauthBinding.source_info["workspace_id"] == f'"{workspace_id}"',
            )
        ).first()
        if not data_source_binding:
            raise ValueError("Data source binding not found.")

        loader = NotionExtractor(
            notion_workspace_id=workspace_id,
            notion_obj_id=page_id,
            notion_page_type=page_type,
            notion_access_token=data_source_binding.access_token,
            tenant_id=document.tenant_id,
        )

        last_edited_time = loader.get_notion_last_edited_time()

        # check the page is updated
        if last_edited_time != page_edited_time:
            document.indexing_status = "parsing"
            document.processing_started_at = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
            db.session.commit()

            # delete all document segment and index
            try:
                dataset = db.session.query(Dataset).filter(Dataset.id == dataset_id).first()
                if not dataset:
                    raise Exception("Dataset not found")
                index_type = document.doc_form
                index_processor = IndexProcessorFactory(index_type).init_index_processor()

                segments = db.session.query(DocumentSegment).filter(DocumentSegment.document_id == document_id).all()
                index_node_ids = [segment.index_node_id for segment in segments]

                # delete from vector index
                index_processor.clean(dataset, index_node_ids)

                for segment in segments:
                    db.session.delete(segment)

                end_at = time.perf_counter()
                logging.info(
                    click.style(
                        "Cleaned document when document update data source or process rule: {} latency: {}".format(
                            document_id, end_at - start_at
                        ),
                        fg="green",
                    )
                )
            except Exception:
                logging.exception("Cleaned document when document update data source or process rule failed")

            try:
                indexing_runner = IndexingRunner()
                indexing_runner.run([document])
                end_at = time.perf_counter()
                logging.info(
                    click.style("update document: {} latency: {}".format(document.id, end_at - start_at), fg="green")
                )
            except DocumentIsPausedError as ex:
                logging.info(click.style(str(ex), fg="yellow"))
            except Exception:
                pass
