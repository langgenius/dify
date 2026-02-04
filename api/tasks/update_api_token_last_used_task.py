"""
Celery task for updating API token last_used_at timestamp asynchronously.
"""

import logging
from datetime import datetime

from celery import shared_task

from libs.api_token_updater import update_token_last_used_at

logger = logging.getLogger(__name__)


@shared_task(queue="api_token_update", bind=True)
def update_api_token_last_used_task(self, token: str, scope: str | None, update_time_iso: str):
    """
    Asynchronously update the last_used_at timestamp for an API token.

    Uses the unified update_token_last_used_at() method to avoid code duplication.

    Queue: api_token_update (dedicated queue to isolate from other tasks and
           prevent accumulation in production environment)

    Args:
        token: The API token string
        scope: The token type/scope (e.g., 'app', 'dataset')
        update_time_iso: ISO format timestamp for the update operation

    Returns:
        Dict with status and metadata

    Raises:
        Exception: Re-raises exceptions to allow Celery retry mechanism and monitoring
    """
    try:
        # Parse update_time from ISO format
        update_time = datetime.fromisoformat(update_time_iso)

        # Use unified update method
        result = update_token_last_used_at(token, scope, update_time, session=None)

        if result["status"] == "updated":
            logger.info("Updated last_used_at for token (async): %s... (scope: %s)", token[:10], scope)
        elif result["status"] == "failed":
            # If update failed, log and raise for retry
            error_msg = result.get("error", "Unknown error")
            logger.error("Failed to update last_used_at for token (async): %s", error_msg)
            raise Exception(f"Token update failed: {error_msg}")

        return result

    except Exception:
        # Log the error with full context (logger.exception includes traceback automatically)
        logger.exception("Error in update_api_token_last_used_task (token: %s..., scope: %s)", token[:10], scope)
        
        # Raise exception to let Celery handle retry and monitoring
        # This allows Flower and other monitoring tools to track failures
        raise
