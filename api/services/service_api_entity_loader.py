"""Service API helpers for entity loads with transient-DB mapping."""

from typing import Any

from sqlalchemy.exc import DBAPIError
from werkzeug.exceptions import ServiceUnavailable


def session_get_or_service_unavailable[T](session: Any, entity: type[T], ident: object) -> T | None:
    """Load an entity, mapping invalidated DB connections to HTTP 503."""
    try:
        return session.get(entity, ident)
    except DBAPIError as exc:
        if exc.connection_invalidated:
            raise ServiceUnavailable("Unable to validate app token. Please try again later.") from exc
        raise
