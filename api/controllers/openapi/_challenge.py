"""RFC 9728 §5.1: a bearer 401 tells the caller where the protected-resource metadata lives."""

from http import HTTPStatus
from typing import Final

from flask import Blueprint, Response, request

from configs import dify_config
from services.oauth_metadata import protected_resource_metadata_url

OAUTH_PATH_PREFIX: Final = "/openapi/v1/oauth/"
BEARER_SCHEME: Final = "bearer"
RESOURCE_METADATA_PARAM: Final = "resource_metadata"


def attach_resource_metadata_challenge(bp: Blueprint) -> None:
    @bp.after_request
    def _apply_challenge(response: Response) -> Response:  # pyright: ignore[reportUnusedFunction]
        if response.status_code != HTTPStatus.UNAUTHORIZED:
            return response
        if request.path.startswith(OAUTH_PATH_PREFIX):
            return response
        if not dify_config.ENABLE_OAUTH_BEARER:
            return response
        param = f'{RESOURCE_METADATA_PARAM}="{protected_resource_metadata_url(request.host_url)}"'
        existing = response.headers.get("WWW-Authenticate")
        if existing is None:
            response.headers["WWW-Authenticate"] = f"Bearer {param}"
            return response
        scheme, _, params = existing.partition(" ")
        if scheme.lower() != BEARER_SCHEME:
            return response
        if RESOURCE_METADATA_PARAM in params:
            return response
        response.headers["WWW-Authenticate"] = f"{existing}, {param}" if params else f"{existing} {param}"
        return response
