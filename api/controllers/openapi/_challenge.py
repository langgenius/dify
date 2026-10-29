"""RFC 9728 §5.1: a bearer 401 tells the caller where the protected-resource metadata lives,
and which scopes to ask for (RFC 6750 §3).
"""

from collections.abc import Mapping
from http import HTTPStatus
from typing import Final

from flask import Blueprint, Response, request

from constants.oauth_bearer import OAuthScope
from services.oauth_metadata import protected_resource_metadata_url
from services.oauth_resource import OPENAPI_PATH
from services.oauth_token_adapters import discovery_enabled

OAUTH_PATH_PREFIX: Final = f"{OPENAPI_PATH}/oauth/"
BEARER_SCHEME: Final = "bearer"
RESOURCE_METADATA_PARAM: Final = "resource_metadata"
SCOPE_PARAM: Final = "scope"
ERROR_PARAM: Final = "error"


def bearer_params(params: Mapping[str, str]) -> str:
    return ", ".join(f'{name}="{value}"' for name, value in params.items())


def attach_resource_metadata_challenge(bp: Blueprint) -> None:
    @bp.after_request
    def _apply_challenge(response: Response) -> Response:  # pyright: ignore[reportUnusedFunction]
        if response.status_code != HTTPStatus.UNAUTHORIZED:
            return response
        if request.path.startswith(OAUTH_PATH_PREFIX):
            return response
        if not discovery_enabled():
            return response
        param = bearer_params(
            {
                RESOURCE_METADATA_PARAM: protected_resource_metadata_url(request.host_url),
                SCOPE_PARAM: OAuthScope.serialize(frozenset(OAuthScope)),
            }
        )
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
