import datetime
import time

import click
from werkzeug.exceptions import NotFound

import app
from configs import dify_config
from extensions.ext_database import db
from models.dataset import Embedding


@app.celery.task(queue='dataset')
def clean_embedding_cache_task():
    click.echo(click.style('Start clean embedding cache.', fg='green'))
    clean_days = int(dify_config.CLEAN_DAY_SETTING)
    start_at = time.perf_counter()
    thirty_days_ago = datetime.datetime.now() - datetime.timedelta(days=clean_days)
    page = 1
    while True:
        try:
            embeddings = db.session.query(Embedding).filter(Embedding.created_at < thirty_days_ago) \
                .order_by(Embedding.created_at.desc()).paginate(page=page, per_page=100)
        except NotFound:
            break
        for embedding in embeddings:
            db.session.delete(embedding)
        db.session.commit()
        page += 1
    end_at = time.perf_counter()
    click.echo(click.style('Cleaned embedding cache from db success latency: {}'.format(end_at - start_at), fg='green'))
