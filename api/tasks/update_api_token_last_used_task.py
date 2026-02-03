"""
Celery task for updating API token last_used_at timestamp asynchronously.
"""

import logging
from datetime import datetime

from celery import shared_task
from sqlalchemy import update
from sqlalchemy.orm import Session

from extensions.ext_database import db
from libs.datetime_utils import naive_utc_now
from models.model import ApiToken

logger = logging.getLogger(__name__)


@shared_task(queue="dataset", bind=True)
def update_api_token_last_used_task(self, token: str, scope: str | None, start_time_iso: str):
    """
    Asynchronously update the last_used_at timestamp for an API token.

    Uses timestamp comparison to ensure only updates when last_used_at is older
    than the request start time, providing natural concurrency control.

    Args:
        token: The API token string
        scope: The token type/scope (e.g., 'app', 'dataset')
        start_time_iso: ISO format timestamp of when the request started
    """
    try:
        # Parse start_time from ISO format
        start_time = datetime.fromisoformat(start_time_iso)
        # Update database
        current_time = naive_utc_now()

        with Session(db.engine, expire_on_commit=False) as session:
            update_stmt = (
                update(ApiToken)
                .where(
                    ApiToken.token == token,
                    ApiToken.type == scope,
                    (ApiToken.last_used_at.is_(None) | (ApiToken.last_used_at < start_time)),
                )
                .values(last_used_at=current_time)
            )
            result = session.execute(update_stmt)
            
            # Check if any rows were updated
            rowcount = getattr(result, "rowcount", 0)
            if rowcount > 0:
                session.commit()
                logger.info("Updated last_used_at for token (async): %s... (scope: %s)", token[:10], scope)
                return {"status": "updated", "rowcount": rowcount, "start_time": start_time_iso}
            else:
                logger.debug("No update needed for token: %s... (already up-to-date)", token[:10])
                return {"status": "no_update_needed", "reason": "last_used_at >= start_time"}

    except Exception as e:
        logger.warning("Failed to update last_used_at for token (async): %s", e)
        # Don't retry on failure to avoid blocking the queue
        return {"status": "failed", "error": str(e)}
