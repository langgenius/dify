import datetime
import time

import click
from sqlalchemy import select, text
from sqlalchemy.exc import SQLAlchemyError

import app
from configs import dify_config
from core.db.session_factory import session_factory
from models.dataset import Embedding


@app.celery.task(queue="dataset")
def clean_embedding_cache_task():
    click.echo(click.style("Start clean embedding cache.", fg="green"))
    clean_days = int(dify_config.PLAN_SANDBOX_CLEAN_DAY_SETTING)
    start_at = time.perf_counter()
    thirty_days_ago = datetime.datetime.now() - datetime.timedelta(days=clean_days)
    with session_factory.create_session() as session:
        while True:
            try:
                embedding_ids = session.scalars(
                    select(Embedding.id)
                    .where(Embedding.created_at < thirty_days_ago)
                    .order_by(Embedding.created_at.desc())
                    .limit(100)
                ).all()
            except SQLAlchemyError:
                raise
            if embedding_ids:
                for embedding_id in embedding_ids:
                    session.execute(
                        text("DELETE FROM embeddings WHERE id = :embedding_id"), {"embedding_id": embedding_id}
                    )

                session.commit()
            else:
                break
    end_at = time.perf_counter()
    click.echo(click.style(f"Cleaned embedding cache from db success latency: {end_at - start_at}", fg="green"))
