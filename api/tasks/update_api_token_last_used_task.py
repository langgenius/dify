"""
Celery task for updating API token last_used_at timestamp asynchronously.
"""

import logging
from datetime import datetime

from celery import shared_task

from libs.api_token_updater import update_token_last_used_at

logger = logging.getLogger(__name__)


@shared_task(queue="api_token_update", bind=True)
def update_api_token_last_used_task(self, token: str, scope: str | None, start_time_iso: str):
    """
    Asynchronously update the last_used_at timestamp for an API token.

    Uses the unified update_token_last_used_at() method to avoid code duplication.

    Queue: api_token_update (dedicated queue to isolate from other tasks and
           prevent accumulation in production environment)

    Args:
        token: The API token string
        scope: The token type/scope (e.g., 'app', 'dataset')
        start_time_iso: ISO format timestamp of when the request started

    Returns:
        Dict with status and metadata
    """
    try:
        # Parse start_time from ISO format
        start_time = datetime.fromisoformat(start_time_iso)

        # Use unified update method
        result = update_token_last_used_at(token, scope, start_time, session=None)

        if result["status"] == "updated":
            logger.info("Updated last_used_at for token (async): %s... (scope: %s)", token[:10], scope)

        return result

    except Exception as e:
        logger.warning("Failed to update last_used_at for token (async): %s", e)
        return {"status": "failed", "error": str(e)}
