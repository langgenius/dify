import datetime
import time

import click
from sqlalchemy import func
from werkzeug.exceptions import NotFound

import app
from configs import dify_config
from core.rag.index_processor.index_processor_factory import IndexProcessorFactory
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models.dataset import Dataset, DatasetAutoDisableLog, DatasetQuery, Document
from services.feature_service import FeatureService


@app.celery.task(queue="dataset")
def clean_unused_datasets_task():
    click.echo(click.style("Start clean unused datasets indexes.", fg="green"))
    plan_sandbox_clean_day_setting = dify_config.PLAN_SANDBOX_CLEAN_DAY_SETTING
    plan_pro_clean_day_setting = dify_config.PLAN_PRO_CLEAN_DAY_SETTING
    start_at = time.perf_counter()
    plan_sandbox_clean_day = datetime.datetime.now() - datetime.timedelta(days=plan_sandbox_clean_day_setting)
    plan_pro_clean_day = datetime.datetime.now() - datetime.timedelta(days=plan_pro_clean_day_setting)
    while True:
        try:
            # Subquery for counting new documents
            document_subquery_new = (
                db.session.query(Document.dataset_id, func.count(Document.id).label("document_count"))
                .filter(
                    Document.indexing_status == "completed",
                    Document.enabled == True,
                    Document.archived == False,
                    Document.updated_at > plan_sandbox_clean_day,
                )
                .group_by(Document.dataset_id)
                .subquery()
            )

            # Subquery for counting old documents
            document_subquery_old = (
                db.session.query(Document.dataset_id, func.count(Document.id).label("document_count"))
                .filter(
                    Document.indexing_status == "completed",
                    Document.enabled == True,
                    Document.archived == False,
                    Document.updated_at < plan_sandbox_clean_day,
                )
                .group_by(Document.dataset_id)
                .subquery()
            )

            # Main query with join and filter
            datasets = (
                Dataset.query.outerjoin(document_subquery_new, Dataset.id == document_subquery_new.c.dataset_id)
                .outerjoin(document_subquery_old, Dataset.id == document_subquery_old.c.dataset_id)
                .filter(
                    Dataset.created_at < plan_sandbox_clean_day,
                    func.coalesce(document_subquery_new.c.document_count, 0) == 0,
                    func.coalesce(document_subquery_old.c.document_count, 0) > 0,
                )
                .order_by(Dataset.created_at.desc())
                .paginate(page=1, per_page=50)
            )

        except NotFound:
            break
        if datasets.items is None or len(datasets.items) == 0:
            break
        for dataset in datasets:
            dataset_query = (
                db.session.query(DatasetQuery)
                .filter(DatasetQuery.created_at > plan_sandbox_clean_day, DatasetQuery.dataset_id == dataset.id)
                .all()
            )
            if not dataset_query or len(dataset_query) == 0:
                try:
                    # add auto disable log
                    documents = (
                        db.session.query(Document)
                        .filter(
                            Document.dataset_id == dataset.id,
                            Document.enabled == True,
                            Document.archived == False,
                        )
                        .all()
                    )
                    for document in documents:
                        dataset_auto_disable_log = DatasetAutoDisableLog(
                            tenant_id=dataset.tenant_id,
                            dataset_id=dataset.id,
                            document_id=document.id,
                        )
                        db.session.add(dataset_auto_disable_log)
                    # remove index
                    index_processor = IndexProcessorFactory(dataset.doc_form).init_index_processor()
                    index_processor.clean(dataset, None)

                    # update document
                    update_params = {Document.enabled: False}

                    Document.query.filter_by(dataset_id=dataset.id).update(update_params)
                    db.session.commit()
                    click.echo(click.style("Cleaned unused dataset {} from db success!".format(dataset.id), fg="green"))
                except Exception as e:
                    click.echo(
                        click.style("clean dataset index error: {} {}".format(e.__class__.__name__, str(e)), fg="red")
                    )
    while True:
        try:
            # Subquery for counting new documents
            document_subquery_new = (
                db.session.query(Document.dataset_id, func.count(Document.id).label("document_count"))
                .filter(
                    Document.indexing_status == "completed",
                    Document.enabled == True,
                    Document.archived == False,
                    Document.updated_at > plan_pro_clean_day,
                )
                .group_by(Document.dataset_id)
                .subquery()
            )

            # Subquery for counting old documents
            document_subquery_old = (
                db.session.query(Document.dataset_id, func.count(Document.id).label("document_count"))
                .filter(
                    Document.indexing_status == "completed",
                    Document.enabled == True,
                    Document.archived == False,
                    Document.updated_at < plan_pro_clean_day,
                )
                .group_by(Document.dataset_id)
                .subquery()
            )

            # Main query with join and filter
            datasets = (
                Dataset.query.outerjoin(document_subquery_new, Dataset.id == document_subquery_new.c.dataset_id)
                .outerjoin(document_subquery_old, Dataset.id == document_subquery_old.c.dataset_id)
                .filter(
                    Dataset.created_at < plan_pro_clean_day,
                    func.coalesce(document_subquery_new.c.document_count, 0) == 0,
                    func.coalesce(document_subquery_old.c.document_count, 0) > 0,
                )
                .order_by(Dataset.created_at.desc())
                .paginate(page=1, per_page=50)
            )

        except NotFound:
            break
        if datasets.items is None or len(datasets.items) == 0:
            break
        for dataset in datasets:
            dataset_query = (
                db.session.query(DatasetQuery)
                .filter(DatasetQuery.created_at > plan_pro_clean_day, DatasetQuery.dataset_id == dataset.id)
                .all()
            )
            if not dataset_query or len(dataset_query) == 0:
                try:
                    features_cache_key = f"features:{dataset.tenant_id}"
                    plan_cache = redis_client.get(features_cache_key)
                    if plan_cache is None:
                        features = FeatureService.get_features(dataset.tenant_id)
                        redis_client.setex(features_cache_key, 600, features.billing.subscription.plan)
                        plan = features.billing.subscription.plan
                    else:
                        plan = plan_cache.decode()
                    if plan == "sandbox":
                        # add auto disable log
                        documents = (
                            db.session.query(Document)
                            .filter(
                                Document.dataset_id == dataset.id,
                                Document.enabled == True,
                                Document.archived == False,
                            )
                            .all()
                        )
                        for document in documents:
                            dataset_auto_disable_log = DatasetAutoDisableLog(
                                tenant_id=dataset.tenant_id,
                                dataset_id=dataset.id,
                                document_id=document.id,
                            )
                            db.session.add(dataset_auto_disable_log)
                        # remove index
                        index_processor = IndexProcessorFactory(dataset.doc_form).init_index_processor()
                        index_processor.clean(dataset, None)

                        # update document
                        update_params = {Document.enabled: False}

                        Document.query.filter_by(dataset_id=dataset.id).update(update_params)
                        db.session.commit()
                        click.echo(
                            click.style("Cleaned unused dataset {} from db success!".format(dataset.id), fg="green")
                        )
                except Exception as e:
                    click.echo(
                        click.style("clean dataset index error: {} {}".format(e.__class__.__name__, str(e)), fg="red")
                    )
    end_at = time.perf_counter()
    click.echo(click.style("Cleaned unused dataset from db success latency: {}".format(end_at - start_at), fg="green"))
