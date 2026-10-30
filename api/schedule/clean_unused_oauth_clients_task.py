"""DELETE dynamically registered OAuth clients that never got a token.

Anyone can register a client, so rows that never log anyone in are pruned after
``UNUSED_CLIENT_RETENTION``. Only the authorization-code redemption
stamps ``last_token_at``.
"""

from __future__ import annotations

import time
from datetime import UTC, datetime, timedelta
from typing import Final

import click
from sqlalchemy.orm import Session

import app
from extensions.ext_database import db
from models.oauth import OpenAPIOAuthClient
from schedule._batch_delete import delete_in_batches

UNUSED_CLIENT_RETENTION: Final = timedelta(days=7)


def clean_unused_oauth_clients(session: Session, *, cutoff: datetime) -> int:
    candidates = OpenAPIOAuthClient.last_token_at.is_(None) & (OpenAPIOAuthClient.created_at < cutoff)
    return delete_in_batches(session, OpenAPIOAuthClient, candidates)


@app.celery.task(queue="retention")
def clean_unused_oauth_clients_task():
    click.echo(click.style("Start clean unused openapi_oauth_clients.", fg="green"))
    start_at = time.perf_counter()

    with Session(db.engine) as session:
        deleted = clean_unused_oauth_clients(session, cutoff=datetime.now(UTC) - UNUSED_CLIENT_RETENTION)

    end_at = time.perf_counter()
    click.echo(
        click.style(
            f"Cleaned {deleted} unused openapi_oauth_clients rows older than {UNUSED_CLIENT_RETENTION.days}d "
            f"in {end_at - start_at:.2f}s",
            fg="green",
        )
    )
