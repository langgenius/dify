"""Unified sync and async Python client for the Dify Agent HTTP API.

The shared ``Client`` covers both major public surfaces exposed by
``dify-agent``:

- run lifecycle endpoints such as ``/runs``, status polling, cancellation, and
  SSE event streaming, and
- sandbox file-operation endpoints such as ``/sandbox/files/list``,
  ``/sandbox/files/read``, and ``/sandbox/files/upload``.

API-side code in this repo reuses this concrete implementation directly for the
sandbox file endpoints, while keeping a small API-local adapter only for the
run lifecycle surface where additional backend error normalization is still
desired.
"""

from ._client import (
    Client,
    DifyAgentClientError,
    DifyAgentHTTPError,
    DifyAgentNotFoundError,
    DifyAgentStreamError,
    DifyAgentTimeoutError,
    DifyAgentValidationError,
)

__all__ = [
    "Client",
    "DifyAgentClientError",
    "DifyAgentHTTPError",
    "DifyAgentNotFoundError",
    "DifyAgentStreamError",
    "DifyAgentTimeoutError",
    "DifyAgentValidationError",
]
