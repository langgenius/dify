"""Sanitized diagnostics for a failed IM provider operation."""

import logging

from core.human_input_v2.entities import IMProvider


def log_provider_failure(
    logger: logging.Logger,
    provider: IMProvider,
    operation: str,
    *,
    provider_error_code: str | int | None = None,
    http_status: int | None = None,
) -> None:
    """Log a failed provider operation even when the SDK supplied no diagnostics."""
    attributes = {
        "im_provider": provider.value,
        "operation": operation,
        "provider_error_code": provider_error_code,
        "http_status": http_status,
    }
    logger.error(
        "IM provider operation failed: im_provider=%(im_provider)s operation=%(operation)s "
        "provider_error_code=%(provider_error_code)r http_status=%(http_status)s",
        attributes,
        extra={"attributes": attributes},
        stacklevel=2,
    )
