"""
API Token Service

Handles business logic for API token validation and caching,
including database queries and single-flight concurrency control.
"""

import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session
from werkzeug.exceptions import Unauthorized

from extensions.ext_database import db
from extensions.ext_redis import redis_client
from libs.api_token_cache import ApiTokenCache, record_token_usage
from models.model import ApiToken

logger = logging.getLogger(__name__)


def query_token_from_db(auth_token: str, scope: str | None) -> ApiToken:
    """
    Query API token from database and cache the result.

    last_used_at is NOT updated here -- it is handled by the periodic batch
    task via record_token_usage().

    Raises Unauthorized if token is invalid.
    """
    with Session(db.engine, expire_on_commit=False) as session:
        stmt = select(ApiToken).where(ApiToken.token == auth_token, ApiToken.type == scope)
        api_token = session.scalar(stmt)

        if not api_token:
            ApiTokenCache.set(auth_token, scope, None)
            raise Unauthorized("Access token is invalid")

        ApiTokenCache.set(auth_token, scope, api_token)
        record_token_usage(auth_token, scope)
        return api_token


def fetch_token_with_single_flight(auth_token: str, scope: str | None) -> ApiToken | Any:
    """
    Fetch token from DB with single-flight pattern using Redis lock.

    Ensures only one concurrent request queries the database for the same token.
    Falls back to direct query if lock acquisition fails.
    """
    logger.debug("Token cache miss, attempting to acquire query lock for scope: %s", scope)

    lock_key = f"api_token_query_lock:{scope}:{auth_token}"
    lock = redis_client.lock(lock_key, timeout=10, blocking_timeout=5)

    try:
        if lock.acquire(blocking=True):
            try:
                # Double-check cache after acquiring lock
                # (another concurrent request might have already cached it)
                cached_token = ApiTokenCache.get(auth_token, scope)
                if cached_token is not None:
                    logger.debug("Token cached by concurrent request, using cached version")
                    return cached_token

                return query_token_from_db(auth_token, scope)
            finally:
                lock.release()
        else:
            logger.warning("Lock timeout for token: %s, proceeding with direct query", auth_token[:10])
            return query_token_from_db(auth_token, scope)
    except Unauthorized:
        raise
    except Exception as e:
        logger.warning("Redis lock failed for token query: %s, proceeding anyway", e)
        return query_token_from_db(auth_token, scope)
