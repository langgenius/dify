import datetime
import time

import click
from sqlalchemy import text
from werkzeug.exceptions import NotFound

import app
from configs import dify_config
from extensions.ext_database import db
from models.dataset import Embedding


@app.celery.task(queue="dataset")
def clean_embedding_cache_task():
    click.echo(click.style("Start clean embedding cache.", fg="green"))
    clean_days = int(dify_config.CLEAN_DAY_SETTING)
    start_at = time.perf_counter()
    thirty_days_ago = datetime.datetime.now() - datetime.timedelta(days=clean_days)
    while True:
        try:
            embedding_ids = (
                db.session.query(Embedding.id)
                .filter(Embedding.created_at < thirty_days_ago)
                .order_by(Embedding.created_at.desc())
                .limit(100)
                .all()
            )
            embedding_ids = [embedding_id[0] for embedding_id in embedding_ids]
        except NotFound:
            break
        if embedding_ids:
            for embedding_id in embedding_ids:
                db.session.execute(
                    text("DELETE FROM embeddings WHERE id = :embedding_id"), {"embedding_id": embedding_id}
                )

            db.session.commit()
        else:
            break
    end_at = time.perf_counter()
    click.echo(click.style("Cleaned embedding cache from db success latency: {}".format(end_at - start_at), fg="green"))
