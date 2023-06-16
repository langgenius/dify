import datetime
import logging
import time

import click
from celery import shared_task
from werkzeug.exceptions import NotFound

from core.data_source.notion import NotionPageReader
from core.index.keyword_table_index import KeywordTableIndex
from core.index.vector_index import VectorIndex
from core.indexing_runner import IndexingRunner, DocumentIsPausedException
from core.llm.error import ProviderTokenNotInitError
from extensions.ext_database import db
from models.dataset import Document, Dataset, DocumentSegment
from models.source import DataSourceBinding


@shared_task
def document_indexing_sync_task(dataset_id: str, document_id: str):
    """
    Async update document
    :param dataset_id:
    :param document_id:

    Usage: document_indexing_sync_task.delay(dataset_id, document_id)
    """
    logging.info(click.style('Start sync document: {}'.format(document_id), fg='green'))
    start_at = time.perf_counter()

    document = db.session.query(Document).filter(
        Document.id == document_id,
        Document.dataset_id == dataset_id
    ).first()

    if not document:
        raise NotFound('Document not found')

    data_source_info = document.data_source_info_dict
    if document.data_source_type == 'notion_import':
        if not data_source_info or 'notion_page_id' not in data_source_info \
                or 'notion_workspace_id' not in data_source_info:
            raise ValueError("no notion page found")
        workspace_id = data_source_info['notion_workspace_id']
        page_id = data_source_info['notion_page_id']
        page_edited_time = data_source_info['last_edited_time']
        data_source_binding = DataSourceBinding.query.filter(
            db.and_(
                DataSourceBinding.tenant_id == document.tenant_id,
                DataSourceBinding.provider == 'notion',
                DataSourceBinding.disabled == False,
                DataSourceBinding.source_info['workspace_id'] == f'"{workspace_id}"'
            )
        ).first()
        if not data_source_binding:
            raise ValueError('Data source binding not found.')
        reader = NotionPageReader(integration_token=data_source_binding.access_token)
        last_edited_time = reader.get_page_last_edited_time(page_id)
        # check the page is updated
        if last_edited_time != page_edited_time:
            document.indexing_status = 'parsing'
            document.processing_started_at = datetime.datetime.utcnow()
            db.session.commit()

            # delete all document segment and index
            try:
                dataset = db.session.query(Dataset).filter(Dataset.id == dataset_id).first()
                if not dataset:
                    raise Exception('Dataset not found')

                vector_index = VectorIndex(dataset=dataset)
                keyword_table_index = KeywordTableIndex(dataset=dataset)

                segments = db.session.query(DocumentSegment).filter(DocumentSegment.document_id == document_id).all()
                index_node_ids = [segment.index_node_id for segment in segments]

                # delete from vector index
                vector_index.del_nodes(index_node_ids)

                # delete from keyword index
                if index_node_ids:
                    keyword_table_index.del_nodes(index_node_ids)

                for segment in segments:
                    db.session.delete(segment)

                end_at = time.perf_counter()
                logging.info(
                    click.style('Cleaned document when document update data source or process rule: {} latency: {}'.format(document_id, end_at - start_at), fg='green'))
            except Exception:
                logging.exception("Cleaned document when document update data source or process rule failed")
            try:
                indexing_runner = IndexingRunner()
                indexing_runner.run([document])
                end_at = time.perf_counter()
                logging.info(click.style('update document: {} latency: {}'.format(document.id, end_at - start_at), fg='green'))
            except DocumentIsPausedException:
                logging.info(click.style('Document update paused, document id: {}'.format(document.id), fg='yellow'))
            except ProviderTokenNotInitError as e:
                document.indexing_status = 'error'
                document.error = str(e.description)
                document.stopped_at = datetime.datetime.utcnow()
                db.session.commit()
            except Exception as e:
                logging.exception("consume update document failed")
                document.indexing_status = 'error'
                document.error = str(e)
                document.stopped_at = datetime.datetime.utcnow()
                db.session.commit()
