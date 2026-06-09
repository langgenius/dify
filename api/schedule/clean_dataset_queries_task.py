"""Periodic cleanup for the ``dataset_queries`` table.

Every RAG retrieval and hit-testing operation inserts a row, and this table
grows without bound unless we actively prune it.

Important invariant: ``clean_unused_datasets_task`` reads
``DatasetQuery.created_at`` to decide whether a dataset has been queried
recently (window = ``PLAN_SANDBOX_CLEAN_DAY_SETTING``). Deleting rows younger
than that window would cause datasets to be incorrectly marked unused and have
their documents disabled. We therefore clamp the effective retention to
``max(CLEAN_DATASET_QUERIES_RETENTION_DAYS, PLAN_SANDBOX_CLEAN_DAY_SETTING)``.
"""

import datetime
import logging
import time

import click
from redis.exceptions import LockError
from sqlalchemy import delete, select

import app
from configs import dify_config
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models.dataset import DatasetQuery

logger = logging.getLogger(__name__)


def _effective_retention_days() -> int:
    """Return the retention days after clamping to the minimum safe threshold."""
    requested = dify_config.CLEAN_DATASET_QUERIES_RETENTION_DAYS
    minimum = dify_config.PLAN_SANDBOX_CLEAN_DAY_SETTING
    if requested < minimum:
        logger.warning(
            "CLEAN_DATASET_QUERIES_RETENTION_DAYS (%d) < PLAN_SANDBOX_CLEAN_DAY_SETTING (%d); "
            "clamping to %d to avoid breaking clean_unused_datasets_task",
            requested,
            minimum,
            minimum,
        )
        return minimum
    return requested


@app.celery.task(queue="dataset")
def clean_dataset_queries_task() -> None:
    """Delete ``dataset_queries`` rows older than the effective retention window."""
    click.echo(click.style("Start clean dataset_queries.", fg="green"))
    start_at = time.perf_counter()

    retention_days = _effective_retention_days()
    cutoff_date = datetime.datetime.now() - datetime.timedelta(days=retention_days)
    batch_size = dify_config.CLEAN_DATASET_QUERIES_BATCH_SIZE

    try:
        with redis_client.lock(
            "retention:clean_dataset_queries_task",
            timeout=dify_config.CLEAN_DATASET_QUERIES_LOCK_TTL,
            blocking=False,
        ):
            total_deleted = 0
            batch_count = 0

            while True:
                batch_count += 1
                ids = db.session.scalars(
                    select(DatasetQuery.id).where(DatasetQuery.created_at < cutoff_date).limit(batch_size)
                ).all()

                if not ids:
                    break

                db.session.execute(delete(DatasetQuery).where(DatasetQuery.id.in_(ids)))
                db.session.commit()
                total_deleted += len(ids)

            end_at = time.perf_counter()
            click.echo(
                click.style(
                    f"Cleaned {total_deleted} dataset_queries rows "
                    f"older than {retention_days} days "
                    f"in {batch_count} batches, latency: {end_at - start_at:.2f}s",
                    fg="green",
                )
            )

    except LockError:
        end_at = time.perf_counter()
        logger.warning("clean_dataset_queries_task: lock already held, skip current execution")
        click.echo(
            click.style(
                f"clean_dataset_queries_task: skipped (lock already held), latency: {end_at - start_at:.2f}s",
                fg="yellow",
            )
        )
        return
    except Exception:
        end_at = time.perf_counter()
        logger.exception("clean_dataset_queries_task failed")
        click.echo(
            click.style(
                f"clean_dataset_queries_task: failed after {end_at - start_at:.2f}s",
                fg="red",
            )
        )
        raise
