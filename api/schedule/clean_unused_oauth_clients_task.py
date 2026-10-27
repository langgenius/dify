"""DELETE dynamically registered OAuth clients that never got a token.

Anyone can register a client, so rows that never log anyone in are pruned after
OAUTH_UNUSED_DCR_CLIENT_RETENTION_DAYS. Only the authorization-code redemption
stamps ``last_token_at``.
"""

from __future__ import annotations

import time
from datetime import UTC, datetime, timedelta

import click
from sqlalchemy.orm import Session

import app
from configs import dify_config
from extensions.ext_database import db
from models.oauth import OpenAPIOAuthClient
from schedule._batch_delete import delete_in_batches


def clean_unused_oauth_clients(session: Session, *, cutoff: datetime) -> int:
    candidates = OpenAPIOAuthClient.last_token_at.is_(None) & (OpenAPIOAuthClient.created_at < cutoff)
    return delete_in_batches(session, OpenAPIOAuthClient, candidates)


@app.celery.task(queue="retention")
def clean_unused_oauth_clients_task():
    click.echo(click.style("Start clean unused openapi_oauth_clients.", fg="green"))
    retention_days = dify_config.OAUTH_UNUSED_DCR_CLIENT_RETENTION_DAYS
    start_at = time.perf_counter()

    with Session(db.engine) as session:
        deleted = clean_unused_oauth_clients(session, cutoff=datetime.now(UTC) - timedelta(days=retention_days))

    end_at = time.perf_counter()
    click.echo(
        click.style(
            f"Cleaned {deleted} unused openapi_oauth_clients rows older than {retention_days}d "
            f"in {end_at - start_at:.2f}s",
            fg="green",
        )
    )
