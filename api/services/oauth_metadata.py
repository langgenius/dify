"""OAuth discovery documents: RFC 8414 authorization server and RFC 9728 protected resource."""

from typing import Any, Final

from configs import dify_config
from enums.oauth_client import TokenEndpointAuthMethod
from services.oauth_client_metadata import CODE_RESPONSE_TYPE, DEFAULT_GRANT_TYPES
from services.oauth_pkce import PkceMethod
from services.oauth_resource import OPENAPI_PATH, openapi_issuer_url
from services.oauth_token_adapters import authorization_code_enabled, cimd_enabled, dcr_enabled
from services.oauth_token_contracts import GrantType

WELL_KNOWN_PREFIX: Final = "/.well-known"
AUTHORIZATION_SERVER_PATH: Final = f"{WELL_KNOWN_PREFIX}/oauth-authorization-server{OPENAPI_PATH}"
PROTECTED_RESOURCE_PATH: Final = f"{WELL_KNOWN_PREFIX}/oauth-protected-resource{OPENAPI_PATH}"
AUTHORIZE_PAGE_PATH: Final = "/account/oauth/authorize"
BEARER_METHODS: Final = ("header",)


def protected_resource_metadata_url(request_origin: str) -> str:
    origin = openapi_issuer_url(request_origin).removesuffix(OPENAPI_PATH)
    return origin + PROTECTED_RESOURCE_PATH


def authorization_server_metadata(request_origin: str) -> dict[str, Any]:
    issuer = openapi_issuer_url(request_origin)
    auth_methods = [method.value for method in TokenEndpointAuthMethod]
    browser_flow = authorization_code_enabled()
    grants = [GrantType.DEVICE_CODE]
    if browser_flow:
        grants = [*DEFAULT_GRANT_TYPES, *grants]

    document: dict[str, Any] = {
        "issuer": issuer,
        "token_endpoint": f"{issuer}/oauth/token",
        "revocation_endpoint": f"{issuer}/oauth/revoke",
        "device_authorization_endpoint": f"{issuer}/oauth/device/code",
        "grant_types_supported": [grant.value for grant in grants],
        "response_types_supported": [CODE_RESPONSE_TYPE],
        "code_challenge_methods_supported": [method.value for method in PkceMethod],
        "token_endpoint_auth_methods_supported": auth_methods,
        "revocation_endpoint_auth_methods_supported": auth_methods,
        "client_id_metadata_document_supported": cimd_enabled(),
        "authorization_response_iss_parameter_supported": True,
    }
    if browser_flow:
        web_origin = (dify_config.CONSOLE_WEB_URL or request_origin).rstrip("/")
        document["authorization_endpoint"] = web_origin + AUTHORIZE_PAGE_PATH
    if dcr_enabled():
        document["registration_endpoint"] = f"{issuer}/oauth/register"
    return document


def protected_resource_metadata(request_origin: str) -> dict[str, Any]:
    issuer = openapi_issuer_url(request_origin)
    return {
        "resource": issuer,
        "authorization_servers": [issuer],
        "bearer_methods_supported": list(BEARER_METHODS),
    }
