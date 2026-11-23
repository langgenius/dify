"""Sanitized diagnostics for an IM provider rejection."""

import logging
from typing import Annotated

from pydantic import Field, TypeAdapter, ValidationError

from core.human_input_v2.entities import IMProvider

_HTTP_STATUS = TypeAdapter(Annotated[int, Field(strict=True, ge=100, le=599)] | None)


def log_provider_rejection(
    logger: logging.Logger,
    provider: IMProvider,
    operation: str,
    *,
    provider_error_code: str | int | None,
    http_status: object,
) -> None:
    """Log an SDK-provided code verbatim with independently validated HTTP status."""
    try:
        status = _HTTP_STATUS.validate_python(http_status)
    except ValidationError:
        status = None
    attributes = {
        "im_provider": provider.value,
        "operation": operation,
        "provider_error_code": provider_error_code,
        "http_status": status,
    }
    logger.error(
        "IM provider rejected the request: im_provider=%(im_provider)s operation=%(operation)s "
        "provider_error_code=%(provider_error_code)r http_status=%(http_status)s",
        attributes,
        extra={"attributes": attributes},
        stacklevel=2,
    )
