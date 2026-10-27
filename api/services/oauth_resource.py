"""Canonical resource (RFC 8707) of the OpenAPI group."""

from typing import Final

from configs import dify_config

OPENAPI_PATH: Final = "/openapi/v1"
ACCEPTED_RESOURCE_PATHS: Final = (OPENAPI_PATH,)


class InvalidResourceError(Exception):
    pass


def openapi_issuer_url(request_origin: str) -> str:
    return (dify_config.CONSOLE_API_URL or request_origin).rstrip("/") + OPENAPI_PATH


def resolve_resource(value: str | None, *, issuer: str) -> str:
    """Missing means the issuer. Otherwise the value must be the issuer's origin plus an accepted path, exactly."""
    if value is None:
        return issuer
    origin = issuer.removesuffix(OPENAPI_PATH)
    if value in {origin + path for path in ACCEPTED_RESOURCE_PATHS}:
        return value
    raise InvalidResourceError(value)
