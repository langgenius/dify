"""DELETE oauth_access_tokens past retention. Revocation is UPDATE
(token_id stays for audits) so rows accumulate across re-logins, and
expired-but-never-presented rows have no hard-expire trigger — both get
pruned here. Spec: docs/specs/v1.0/server/tokens.md §Hard-expire.
"""

from __future__ import annotations

import logging
import time
from datetime import UTC, datetime, timedelta

import click
from sqlalchemy import delete, or_, select

import app
from configs import dify_config
from extensions.ext_database import db
from models.oauth import OAuthAccessToken

logger = logging.getLogger(__name__)

DELETE_BATCH_SIZE = 500


@app.celery.task(queue="retention")
def clean_oauth_access_tokens_task():
    click.echo(click.style("Start clean oauth_access_tokens.", fg="green"))
    retention_days = int(dify_config.OAUTH_ACCESS_TOKEN_RETENTION_DAYS)
    cutoff = datetime.now(UTC) - timedelta(days=retention_days)
    start_at = time.perf_counter()

    candidates = or_(
        OAuthAccessToken.revoked_at < cutoff,
        # Zombies: expired but never re-presented, so middleware never flipped them.
        (OAuthAccessToken.revoked_at.is_(None)) & (OAuthAccessToken.expires_at < cutoff),
    )

    total = 0
    while True:
        ids = db.session.scalars(select(OAuthAccessToken.id).where(candidates).limit(DELETE_BATCH_SIZE)).all()
        if not ids:
            break
        db.session.execute(delete(OAuthAccessToken).where(OAuthAccessToken.id.in_(ids)))
        db.session.commit()
        total += len(ids)

    end_at = time.perf_counter()
    click.echo(
        click.style(
            f"Cleaned {total} oauth_access_tokens rows older than {retention_days}d in {end_at - start_at:.2f}s",
            fg="green",
        )
    )
