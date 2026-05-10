"""Domain errors and HTTP status mapping.

Errors are raised internally by services / routers, then translated to
OpenAI-shaped JSON responses by the FastAPI exception handlers wired in
``main.py``.

OpenAI error envelope (returned to clients):

.. code-block:: json

    {
      "error": {
        "message": "Invalid SDK key",
        "type": "invalid_request_error",
        "code": "invalid_sdk_key",
        "param": null
      }
    }
"""

from __future__ import annotations

from typing import Any


class GatewayError(Exception):
    """Base class for domain errors with explicit HTTP semantics.

    Subclasses set ``status_code``, ``error_type``, and ``code`` attributes.
    The exception handler reads these and renders the OpenAI envelope.
    """

    status_code: int = 500
    error_type: str = "internal_error"
    code: str = "internal_error"

    def __init__(self, message: str, *, param: str | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.param = param

    def to_openai_envelope(self) -> dict[str, Any]:
        return {
            "error": {
                "message": self.message,
                "type": self.error_type,
                "code": self.code,
                "param": self.param,
            }
        }


class InvalidSdkKeyError(GatewayError):
    """SDK key is missing, malformed, or not in the registry. → 401."""

    status_code = 401
    error_type = "invalid_request_error"
    code = "invalid_sdk_key"


class UnknownModelError(GatewayError):
    """Client requested a model the customer is not permitted to use. → 404."""

    status_code = 404
    error_type = "invalid_request_error"
    code = "model_not_found"


class InvalidRequestError(GatewayError):
    """Request body fails OpenAI schema or contradicts gateway constraints. → 400."""

    status_code = 400
    error_type = "invalid_request_error"
    code = "invalid_request"


class RateLimitError(GatewayError):
    """Client exceeded its rate limit. → 429.

    First-version is a placeholder; routing layer raises this when limiter
    middleware is wired in a future PR.
    """

    status_code = 429
    error_type = "rate_limit_error"
    code = "rate_limited"


class DifyUpstreamError(GatewayError):
    """Customer's Dify deployment returned non-2xx or is unreachable. → 502."""

    status_code = 502
    error_type = "upstream_error"
    code = "dify_upstream_error"


class DifyTimeoutError(GatewayError):
    """Customer's Dify deployment timed out. → 504."""

    status_code = 504
    error_type = "upstream_error"
    code = "dify_timeout"


class ServiceUnavailableError(GatewayError):
    """Gateway itself or a critical dependency is unavailable. → 503."""

    status_code = 503
    error_type = "service_unavailable"
    code = "service_unavailable"
