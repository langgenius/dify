"""
Scheduled task to batch-update API token last_used_at timestamps.

Instead of updating the database on every request, token usage is recorded
in Redis as lightweight SET keys (api_token_active:{scope}:{token}).
This task runs periodically (default every 30 minutes) to flush those
records into the database in a single batch operation.
"""

import logging
import time

import click
from sqlalchemy import update
from sqlalchemy.orm import Session

import app
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from libs.datetime_utils import naive_utc_now
from models.model import ApiToken

logger = logging.getLogger(__name__)

ACTIVE_TOKEN_KEY_PREFIX = "api_token_active:"


@app.celery.task(queue="dataset")
def batch_update_api_token_last_used():
    """
    Batch update last_used_at for all recently active API tokens.

    Scans Redis for api_token_active:* keys, parses the token and scope
    from each key, and performs a batch database update.
    """
    click.echo(click.style("batch_update_api_token_last_used: start.", fg="green"))
    start_at = time.perf_counter()

    updated_count = 0
    scanned_count = 0
    current_time = naive_utc_now()

    try:
        # Collect all active token keys
        keys_to_process: list[str] = []
        for key in redis_client.scan_iter(match=f"{ACTIVE_TOKEN_KEY_PREFIX}*", count=200):
            if isinstance(key, bytes):
                key = key.decode("utf-8")
            keys_to_process.append(key)
            scanned_count += 1

        if not keys_to_process:
            click.echo(click.style("batch_update_api_token_last_used: no active tokens found.", fg="yellow"))
            return

        # Parse token info from keys: api_token_active:{scope}:{token}
        token_scope_pairs: list[tuple[str, str | None]] = []
        for key in keys_to_process:
            # Strip prefix
            suffix = key[len(ACTIVE_TOKEN_KEY_PREFIX):]
            # Split into scope:token (scope may be "None")
            parts = suffix.split(":", 1)
            if len(parts) == 2:
                scope_str, token = parts
                scope = None if scope_str == "None" else scope_str
                token_scope_pairs.append((token, scope))

        # Batch update in database
        with Session(db.engine, expire_on_commit=False) as session:
            for token, scope in token_scope_pairs:
                stmt = (
                    update(ApiToken)
                    .where(
                        ApiToken.token == token,
                        ApiToken.type == scope,
                        (ApiToken.last_used_at.is_(None) | (ApiToken.last_used_at < current_time)),
                    )
                    .values(last_used_at=current_time)
                )
                result = session.execute(stmt)
                rowcount = getattr(result, "rowcount", 0)
                if rowcount > 0:
                    updated_count += 1

            if updated_count > 0:
                session.commit()

        # Delete processed keys from Redis
        if keys_to_process:
            redis_client.delete(*[k.encode("utf-8") if isinstance(k, str) else k for k in keys_to_process])

    except Exception:
        logger.exception("batch_update_api_token_last_used failed")

    elapsed = time.perf_counter() - start_at
    click.echo(
        click.style(
            f"batch_update_api_token_last_used: done. "
            f"scanned={scanned_count}, updated={updated_count}, elapsed={elapsed:.2f}s",
            fg="green",
        )
    )
