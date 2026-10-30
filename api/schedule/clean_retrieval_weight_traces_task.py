"""DELETE retrieval_weight_traces past RETRIEVAL_WEIGHT_TRACE_RETENTION_DAYS.

Scheduled whether or not tracing is enabled, so traces collected before tracing was
switched off still age out.
"""

import logging
import time

import click

import app
from core.db.session_factory import get_session_maker
from extensions.application_services.retrieval_weight_traces import build_weighted_score_trace_retention_service

logger = logging.getLogger(__name__)


@app.celery.task(queue="retention")
def clean_retrieval_weight_traces_task():
    click.echo(click.style("Start clean retrieval_weight_traces.", fg="green"))
    start_at = time.perf_counter()
    deleted = build_weighted_score_trace_retention_service(database_client=get_session_maker()).purge_expired()
    end_at = time.perf_counter()
    click.echo(click.style(f"Cleaned {deleted} retrieval_weight_traces rows in {end_at - start_at:.2f}s", fg="green"))
