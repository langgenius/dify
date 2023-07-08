import logging
import time

import click
from celery import shared_task

from core.index.index import IndexBuilder
from extensions.ext_database import db
from models.dataset import DocumentSegment, Dataset, DatasetKeywordTable, DatasetQuery, DatasetProcessRule, \
    AppDatasetJoin, Document


@shared_task
def clean_dataset_task(dataset_id: str, tenant_id: str, indexing_technique: str, index_struct: str):
    """
    Clean dataset when dataset deleted.
    :param dataset_id: dataset id
    :param tenant_id: tenant id
    :param indexing_technique: indexing technique
    :param index_struct: index struct dict

    Usage: clean_dataset_task.delay(dataset_id, tenant_id, indexing_technique, index_struct)
    """
    logging.info(click.style('Start clean dataset when dataset deleted: {}'.format(dataset_id), fg='green'))
    start_at = time.perf_counter()

    try:
        dataset = Dataset(
            id=dataset_id,
            tenant_id=tenant_id,
            indexing_technique=indexing_technique,
            index_struct=index_struct
        )

        documents = db.session.query(Document).filter(Document.dataset_id == dataset_id).all()
        segments = db.session.query(DocumentSegment).filter(DocumentSegment.dataset_id == dataset_id).all()

        vector_index = IndexBuilder.get_index(dataset, 'high_quality')
        kw_index = IndexBuilder.get_index(dataset, 'economy')

        # delete from vector index
        if vector_index:
            try:
                vector_index.delete()
            except Exception:
                logging.exception("Delete doc index failed when dataset deleted.")

        # delete from keyword index
        try:
            kw_index.delete()
        except Exception:
            logging.exception("Delete nodes index failed when dataset deleted.")

        for document in documents:
            db.session.delete(document)

        for segment in segments:
            db.session.delete(segment)

        db.session.query(DatasetProcessRule).filter(DatasetProcessRule.dataset_id == dataset_id).delete()
        db.session.query(DatasetQuery).filter(DatasetQuery.dataset_id == dataset_id).delete()
        db.session.query(AppDatasetJoin).filter(AppDatasetJoin.dataset_id == dataset_id).delete()

        db.session.commit()

        end_at = time.perf_counter()
        logging.info(
            click.style('Cleaned dataset when dataset deleted: {} latency: {}'.format(dataset_id, end_at - start_at), fg='green'))
    except Exception:
        logging.exception("Cleaned dataset when dataset deleted failed")
