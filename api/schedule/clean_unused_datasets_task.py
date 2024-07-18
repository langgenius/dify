import datetime
import time

import click
from sqlalchemy import func
from werkzeug.exceptions import NotFound

import app
from configs import dify_config
from core.rag.index_processor.index_processor_factory import IndexProcessorFactory
from extensions.ext_database import db
from models.dataset import Dataset, DatasetQuery, Document


@app.celery.task(queue='dataset')
def clean_unused_datasets_task():
    click.echo(click.style('Start clean unused datasets indexes.', fg='green'))
    clean_days = int(dify_config.CLEAN_DAY_SETTING)
    start_at = time.perf_counter()
    thirty_days_ago = datetime.datetime.now() - datetime.timedelta(days=clean_days)
    page = 1
    while True:
        try:
            # Subquery for counting new documents
            document_subquery_new = db.session.query(
                Document.dataset_id,
                func.count(Document.id).label('document_count')
            ).filter(
                Document.indexing_status == 'completed',
                Document.enabled == True,
                Document.archived == False,
                Document.updated_at > thirty_days_ago
            ).group_by(Document.dataset_id).subquery()

            # Subquery for counting old documents
            document_subquery_old = db.session.query(
                Document.dataset_id,
                func.count(Document.id).label('document_count')
            ).filter(
                Document.indexing_status == 'completed',
                Document.enabled == True,
                Document.archived == False,
                Document.updated_at < thirty_days_ago
            ).group_by(Document.dataset_id).subquery()

            # Main query with join and filter
            datasets = (db.session.query(Dataset)
                        .outerjoin(
                document_subquery_new, Dataset.id == document_subquery_new.c.dataset_id
            ).outerjoin(
                document_subquery_old, Dataset.id == document_subquery_old.c.dataset_id
            ).filter(
                Dataset.created_at < thirty_days_ago,
                func.coalesce(document_subquery_new.c.document_count, 0) == 0,
                func.coalesce(document_subquery_old.c.document_count, 0) > 0
            ).order_by(
                Dataset.created_at.desc()
            ).paginate(page=page, per_page=50))

        except NotFound:
            break
        if datasets.items is None or len(datasets.items) == 0:
            break
        page += 1
        for dataset in datasets:
            dataset_query = db.session.query(DatasetQuery).filter(
                DatasetQuery.created_at > thirty_days_ago,
                DatasetQuery.dataset_id == dataset.id
            ).all()
            if not dataset_query or len(dataset_query) == 0:
                try:
                    # remove index
                    index_processor = IndexProcessorFactory(dataset.doc_form).init_index_processor()
                    index_processor.clean(dataset, None)

                    # update document
                    update_params = {
                        Document.enabled: False
                    }

                    Document.query.filter_by(dataset_id=dataset.id).update(update_params)
                    db.session.commit()
                    click.echo(click.style('Cleaned unused dataset {} from db success!'.format(dataset.id),
                                           fg='green'))
                except Exception as e:
                    click.echo(
                        click.style('clean dataset index error: {} {}'.format(e.__class__.__name__, str(e)),
                                    fg='red'))
    end_at = time.perf_counter()
    click.echo(click.style('Cleaned unused dataset from db success latency: {}'.format(end_at - start_at), fg='green'))
