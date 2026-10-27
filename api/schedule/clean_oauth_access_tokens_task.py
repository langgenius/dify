"""DELETE openapi_oauth_access_tokens past retention, and refresh tokens past expiry.

Revocation is UPDATE (token_id stays for audits) so access rows accumulate
across re-logins, and expired-but-never-presented rows have no hard-expire
trigger — both get pruned here. Spec: docs/specs/v1.0/server/tokens.md §Hard-expire.

A rotated refresh token stays until it expires: presenting it after the replay
grace must still find it, so the reuse revokes its grant.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import click
from sqlalchemy import or_
from sqlalchemy.orm import Session

import app
from configs import dify_config
from extensions.ext_database import db
from models.oauth import OpenAPIOAuthAccessToken, OpenAPIOAuthRefreshToken
from schedule._batch_delete import delete_in_batches

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class CleanedOAuthTokens:
    access_tokens: int
    refresh_tokens: int


def clean_oauth_tokens(session: Session, *, now: datetime, retention: timedelta) -> CleanedOAuthTokens:
    cutoff = now - retention
    access_candidates = or_(
        OpenAPIOAuthAccessToken.revoked_at < cutoff,
        # Zombies: expired but never re-presented, so middleware never flipped them.
        (OpenAPIOAuthAccessToken.revoked_at.is_(None)) & (OpenAPIOAuthAccessToken.expires_at < cutoff),
    )
    return CleanedOAuthTokens(
        access_tokens=delete_in_batches(session, OpenAPIOAuthAccessToken, access_candidates),
        refresh_tokens=delete_in_batches(session, OpenAPIOAuthRefreshToken, OpenAPIOAuthRefreshToken.expires_at <= now),
    )


@app.celery.task(queue="retention")
def clean_oauth_access_tokens_task():
    click.echo(click.style("Start clean openapi_oauth_access_tokens.", fg="green"))
    retention_days = int(dify_config.OAUTH_ACCESS_TOKEN_RETENTION_DAYS)
    start_at = time.perf_counter()

    with Session(db.engine) as session:
        cleaned = clean_oauth_tokens(session, now=datetime.now(UTC), retention=timedelta(days=retention_days))

    end_at = time.perf_counter()
    click.echo(
        click.style(
            f"Cleaned {cleaned.access_tokens} openapi_oauth_access_tokens rows older than {retention_days}d and "
            f"{cleaned.refresh_tokens} expired openapi_oauth_refresh_tokens rows in {end_at - start_at:.2f}s",
            fg="green",
        )
    )
