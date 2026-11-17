"""The shape `HttpRequestNode.get_default_config()` returns, so its readers stop guessing with `object`.

`get_default_config` is graphon's and is annotated `-> Mapping[str, object]`; the fields below are what that
mapping actually holds, so a caller validates the mapping once at the boundary
(`HttpRequestDefaultBlockConfig.model_validate(raw)`) and reads attributes instead of casting sub-mappings.

Invariants:
- `config.timeout` always carries the three request timeouts and the three configured maxima together.
- `retry_config.retry_enabled` is a bool, never the string the editor's form control produces.
"""

from typing import Literal

from pydantic import BaseModel

__all__ = [
    "HttpRequestDefaultAuthorization",
    "HttpRequestDefaultBlockConfig",
    "HttpRequestDefaultBody",
    "HttpRequestDefaultNodeConfig",
    "HttpRequestDefaultRetryConfig",
    "HttpRequestDefaultTimeout",
]


class HttpRequestDefaultAuthorization(BaseModel):
    """The authorization a fresh http-request block starts with, as `get_default_config` fills it."""

    type: Literal["no-auth"]


class HttpRequestDefaultBody(BaseModel):
    """The body a fresh http-request block starts with; the request body itself is edited later."""

    type: Literal["none"]


class HttpRequestDefaultTimeout(BaseModel):
    """The three request timeouts resolved from the node data, next to the three configured maxima."""

    connect: int | None = None
    read: int | None = None
    write: int | None = None
    max_connect_timeout: int
    max_read_timeout: int
    max_write_timeout: int


class HttpRequestDefaultNodeConfig(BaseModel):
    """The `config` of a fresh http-request block: everything the editor pre-fills for the request itself."""

    method: str
    authorization: HttpRequestDefaultAuthorization
    body: HttpRequestDefaultBody
    timeout: HttpRequestDefaultTimeout
    ssl_verify: bool


class HttpRequestDefaultRetryConfig(BaseModel):
    """The retry policy a fresh http-request block starts with."""

    max_retries: int
    retry_interval: float
    retry_enabled: bool


class HttpRequestDefaultBlockConfig(BaseModel):
    """A fresh http-request block config, as the editor receives it before anyone edits it.

    Precondition: the value came from `HttpRequestNode.get_default_config()`, with or without filters.
    Postcondition: every field the editor reads is present and typed, so no `Mapping`-shaped lookup is needed.
    """

    type: str
    config: HttpRequestDefaultNodeConfig
    retry_config: HttpRequestDefaultRetryConfig
