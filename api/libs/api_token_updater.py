"""
Unified API Token update utilities.

This module provides a centralized method for updating API token last_used_at
to avoid code duplication between sync and async update paths.
"""

import logging
from datetime import datetime

from sqlalchemy import update
from sqlalchemy.orm import Session

from extensions.ext_database import db
from libs.datetime_utils import naive_utc_now
from models.model import ApiToken

logger = logging.getLogger(__name__)


def update_token_last_used_at(
    token: str,
    scope: str | None,
    start_time: datetime,
    session: Session | None = None
) -> dict:
    """
    Unified method to update API token last_used_at timestamp.
    
    This method is used by both:
    1. Direct database update (cache miss scenario)
    2. Async Celery task (cache hit scenario)
    
    Args:
        token: The API token string
        scope: The token type/scope (e.g., 'app', 'dataset')
        start_time: The request start time (for concurrency control)
        session: Optional existing session to use (if None, creates new one)
    
    Returns:
        Dict with status, rowcount, and other metadata
    """
    current_time = naive_utc_now()
    
    def _do_update(s: Session) -> dict:
        """Execute the update within the session."""
        update_stmt = (
            update(ApiToken)
            .where(
                ApiToken.token == token,
                ApiToken.type == scope,
                # Only update if last_used_at is older than start_time
                (ApiToken.last_used_at.is_(None) | (ApiToken.last_used_at < start_time)),
            )
            .values(last_used_at=current_time)
        )
        result = s.execute(update_stmt)
        
        rowcount = getattr(result, "rowcount", 0)
        if rowcount > 0:
            s.commit()
            logger.debug("Updated last_used_at for token: %s... (scope: %s)", token[:10], scope)
            return {"status": "updated", "rowcount": rowcount}
        else:
            logger.debug("No update needed for token: %s... (already up-to-date)", token[:10])
            return {"status": "no_update_needed", "reason": "last_used_at >= start_time"}
    
    try:
        if session:
            # Use provided session (sync path)
            return _do_update(session)
        else:
            # Create new session (async path)
            with Session(db.engine, expire_on_commit=False) as new_session:
                return _do_update(new_session)
    
    except Exception as e:
        logger.warning("Failed to update last_used_at for token: %s", e)
        return {"status": "failed", "error": str(e)}
