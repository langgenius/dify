import datetime
import time
from typing import TypedDict

import click
from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError

import app
from configs import dify_config
from core.rag.index_processor.index_processor_factory import IndexProcessorFactory
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models.dataset import Dataset, DatasetAutoDisableLog, DatasetQuery, Document
from services.feature_service import FeatureService


class CleanupConfig(TypedDict):
    clean_day: datetime.datetime
    plan_filter: str | None
    add_logs: bool


@app.celery.task(queue="dataset")
def clean_unused_datasets_task():
    click.echo(click.style("Start clean unused datasets indexes.", fg="green"))
    start_at = time.perf_counter()

    # Define cleanup configurations
    cleanup_configs: list[CleanupConfig] = [
        {
            "clean_day": datetime.datetime.now() - datetime.timedelta(days=dify_config.PLAN_SANDBOX_CLEAN_DAY_SETTING),
            "plan_filter": None,
            "add_logs": True,
        },
        {
            "clean_day": datetime.datetime.now() - datetime.timedelta(days=dify_config.PLAN_PRO_CLEAN_DAY_SETTING),
            "plan_filter": "sandbox",
            "add_logs": False,
        },
    ]

    for config in cleanup_configs:
        clean_day = config["clean_day"]
        plan_filter = config["plan_filter"]
        add_logs = config["add_logs"]

        page = 1
        while True:
            try:
                # Subquery for counting new documents
                document_subquery_new = (
                    db.session.query(Document.dataset_id, func.count(Document.id).label("document_count"))
                    .where(
                        Document.indexing_status == "completed",
                        Document.enabled == True,
                        Document.archived == False,
                        Document.updated_at > clean_day,
                    )
                    .group_by(Document.dataset_id)
                    .subquery()
                )

                # Subquery for counting old documents
                document_subquery_old = (
                    db.session.query(Document.dataset_id, func.count(Document.id).label("document_count"))
                    .where(
                        Document.indexing_status == "completed",
                        Document.enabled == True,
                        Document.archived == False,
                        Document.updated_at < clean_day,
                    )
                    .group_by(Document.dataset_id)
                    .subquery()
                )

                # Main query with join and filter
                stmt = (
                    select(Dataset)
                    .outerjoin(document_subquery_new, Dataset.id == document_subquery_new.c.dataset_id)
                    .outerjoin(document_subquery_old, Dataset.id == document_subquery_old.c.dataset_id)
                    .where(
                        Dataset.created_at < clean_day,
                        func.coalesce(document_subquery_new.c.document_count, 0) == 0,
                        func.coalesce(document_subquery_old.c.document_count, 0) > 0,
                    )
                    .order_by(Dataset.created_at.desc())
                )

                datasets = db.paginate(stmt, page=page, per_page=50, error_out=False)

            except SQLAlchemyError:
                raise

            if datasets is None or datasets.items is None or len(datasets.items) == 0:
                break

            for dataset in datasets:
                dataset_query = db.session.scalars(
                    select(DatasetQuery).where(
                        DatasetQuery.created_at > clean_day, DatasetQuery.dataset_id == dataset.id
                    )
                ).all()

                if not dataset_query or len(dataset_query) == 0:
                    try:
                        should_clean = True

                        # Check plan filter if specified
                        if plan_filter:
                            features_cache_key = f"features:{dataset.tenant_id}"
                            plan_cache = redis_client.get(features_cache_key)
                            if plan_cache is None:
                                features = FeatureService.get_features(dataset.tenant_id)
                                redis_client.setex(features_cache_key, 600, features.billing.subscription.plan)
                                plan = features.billing.subscription.plan
                            else:
                                plan = plan_cache.decode()
                            should_clean = plan == plan_filter

                        if should_clean:
                            # Add auto disable log if required
                            if add_logs:
                                documents = db.session.scalars(
                                    select(Document).where(
                                        Document.dataset_id == dataset.id,
                                        Document.enabled == True,
                                        Document.archived == False,
                                    )
                                ).all()
                                for document in documents:
                                    dataset_auto_disable_log = DatasetAutoDisableLog(
                                        tenant_id=dataset.tenant_id,
                                        dataset_id=dataset.id,
                                        document_id=document.id,
                                    )
                                    db.session.add(dataset_auto_disable_log)

                            # Remove index
                            index_processor = IndexProcessorFactory(dataset.doc_form).init_index_processor()
                            index_processor.clean(dataset, None)

                            # Update document
                            db.session.query(Document).filter_by(dataset_id=dataset.id).update(
                                {Document.enabled: False}
                            )
                            db.session.commit()
                            click.echo(click.style(f"Cleaned unused dataset {dataset.id} from db success!", fg="green"))
                    except Exception as e:
                        click.echo(click.style(f"clean dataset index error: {e.__class__.__name__} {str(e)}", fg="red"))

            page += 1

    end_at = time.perf_counter()
    click.echo(click.style(f"Cleaned unused dataset from db success latency: {end_at - start_at}", fg="green"))
