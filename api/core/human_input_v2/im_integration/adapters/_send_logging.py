"""Sanitized diagnostics for a provider response to a message send."""

import logging
from typing import Annotated

from pydantic import Field, StringConstraints, TypeAdapter, ValidationError

from core.human_input_v2.entities import IMProvider

# Codes are compact identifiers or integers. Reject prose, URLs and other
# unstructured values even when the SDK places them in the error-code field.
_ERROR_CODE = TypeAdapter(
    Annotated[str, StringConstraints(strict=True, pattern=r"^[A-Za-z0-9][A-Za-z0-9_.]{0,63}$")]
    | Annotated[int, Field(strict=True, ge=-(2**31), lt=2**31)]
    | None
)
_HTTP_STATUS = TypeAdapter(Annotated[int, Field(strict=True, ge=100, le=599)] | None)


def log_send_rejection(
    logger: logging.Logger,
    provider: IMProvider,
    operation: str,
    *,
    provider_error_code: object,
    http_status: object,
) -> None:
    """Log validated metadata from a rejected send for a fixed provider operation.

    Code and status are independent so an invalid or missing field cannot
    suppress the other. The log never includes the SDK exception or payloads.
    """
    try:
        code = _ERROR_CODE.validate_python(provider_error_code)
    except ValidationError:
        code = None
    try:
        status = _HTTP_STATUS.validate_python(http_status)
    except ValidationError:
        status = None
    attributes = {
        "im_provider": provider.value,
        "operation": operation,
        "provider_error_code": code,
        "http_status": status,
    }
    logger.error(
        "IM message acceptance could not be confirmed: im_provider=%(im_provider)s operation=%(operation)s "
        "provider_error_code=%(provider_error_code)s http_status=%(http_status)s",
        attributes,
        extra={"attributes": attributes},
        stacklevel=2,
    )
