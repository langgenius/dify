"""
Scheduled task to batch-update API token last_used_at timestamps.

Instead of updating the database on every request, token usage is recorded
in Redis as lightweight SET keys (api_token_active:{scope}:{token}).
This task runs periodically (default every 30 minutes) to flush those
records into the database in a single batch operation.
"""

import logging
import time
from datetime import datetime

import click
from sqlalchemy import update
from sqlalchemy.orm import Session

import app
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models.model import ApiToken
from services.api_token_service import ACTIVE_TOKEN_KEY_PREFIX

logger = logging.getLogger(__name__)


@app.celery.task(queue="api_token")
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

    try:
        # Collect all active token keys and their values (the actual usage timestamps)
        token_entries: list[tuple[str, str | None, datetime]] = []  # (token, scope, usage_time)
        keys_to_delete: list[str | bytes] = []

        for key in redis_client.scan_iter(match=f"{ACTIVE_TOKEN_KEY_PREFIX}*", count=200):
            if isinstance(key, bytes):
                key = key.decode("utf-8")
            scanned_count += 1

            # Read the value (ISO timestamp recorded at actual request time)
            value = redis_client.get(key)
            if not value:
                keys_to_delete.append(key)
                continue

            if isinstance(value, bytes):
                value = value.decode("utf-8")

            try:
                usage_time = datetime.fromisoformat(value)
            except (ValueError, TypeError):
                logger.warning("Invalid timestamp in key %s: %s", key, value)
                keys_to_delete.append(key)
                continue

            # Parse token info from key: api_token_active:{scope}:{token}
            suffix = key[len(ACTIVE_TOKEN_KEY_PREFIX) :]
            parts = suffix.split(":", 1)
            if len(parts) == 2:
                scope_str, token = parts
                scope = None if scope_str == "None" else scope_str
                token_entries.append((token, scope, usage_time))
            keys_to_delete.append(key)

        if not token_entries:
            click.echo(click.style("batch_update_api_token_last_used: no active tokens found.", fg="yellow"))
            # Still clean up any invalid keys
            if keys_to_delete:
                redis_client.delete(*keys_to_delete)
            return

        # Update each token in its own short transaction to avoid long transactions
        for token, scope, usage_time in token_entries:
            with Session(db.engine, expire_on_commit=False) as session, session.begin():
                stmt = (
                    update(ApiToken)
                    .where(
                        ApiToken.token == token,
                        ApiToken.type == scope,
                        (ApiToken.last_used_at.is_(None) | (ApiToken.last_used_at < usage_time)),
                    )
                    .values(last_used_at=usage_time)
                )
                result = session.execute(stmt)
                rowcount = getattr(result, "rowcount", 0)
                if rowcount > 0:
                    updated_count += 1

        # Delete processed keys from Redis
        if keys_to_delete:
            redis_client.delete(*keys_to_delete)

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
