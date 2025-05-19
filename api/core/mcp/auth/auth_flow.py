import base64
import hashlib
import os
import urllib.parse
from typing import Optional
from urllib.parse import urljoin

import requests

from core.mcp.auth.auth_provider import OAuthClientProvider
from core.mcp.types import (
    OAuthClientInformation,
    OAuthClientInformationFull,
    OAuthClientMetadata,
    OAuthMetadata,
    OAuthTokens,
)

LATEST_PROTOCOL_VERSION = "1.0"


def generate_pkce_challenge() -> tuple[str, str]:
    """Generate PKCE challenge and verifier."""
    code_verifier = base64.urlsafe_b64encode(os.urandom(40)).decode("utf-8")
    code_verifier = code_verifier.replace("=", "").replace("+", "-").replace("/", "_")

    code_challenge = hashlib.sha256(code_verifier.encode("utf-8")).digest()
    code_challenge = base64.urlsafe_b64encode(code_challenge).decode("utf-8")
    code_challenge = code_challenge.replace("=", "").replace("+", "-").replace("/", "_")

    return code_verifier, code_challenge


def discover_oauth_metadata(server_url: str, protocol_version: Optional[str] = None) -> Optional[OAuthMetadata]:
    """Looks up RFC 8414 OAuth 2.0 Authorization Server Metadata."""
    url = urljoin(server_url, "/.well-known/oauth-authorization-server")

    try:
        headers = {"MCP-Protocol-Version": protocol_version or LATEST_PROTOCOL_VERSION}
        response = requests.get(url, headers=headers)
        if response.status_code == 404:
            return None
        if not response.ok:
            raise Exception(f"HTTP {response.status_code} trying to load well-known OAuth metadata")
        return OAuthMetadata.model_validate(response.json())
    except requests.RequestException as e:
        if isinstance(e, requests.ConnectionError):
            response = requests.get(url)
            if response.status_code == 404:
                return None
            if not response.ok:
                raise Exception(f"HTTP {response.status_code} trying to load well-known OAuth metadata")
            return OAuthMetadata.model_validate(response.json())
        raise


def start_authorization(
    server_url: str,
    metadata: Optional[OAuthMetadata],
    client_information: OAuthClientInformation,
    redirect_url: str,
    scope: Optional[str] = None,
) -> tuple[str, str]:
    """Begins the authorization flow."""
    response_type = "code"
    code_challenge_method = "S256"

    if metadata:
        authorization_url = metadata.authorization_endpoint
        if response_type not in metadata.response_types_supported:
            raise Exception(f"Incompatible auth server: does not support response type {response_type}")
        if (
            not metadata.code_challenge_methods_supported
            or code_challenge_method not in metadata.code_challenge_methods_supported
        ):
            raise Exception(f"Incompatible auth server: does not support code challenge method {code_challenge_method}")
    else:
        authorization_url = urljoin(server_url, "/authorize")

    code_verifier, code_challenge = generate_pkce_challenge()

    params = {
        "response_type": response_type,
        "client_id": client_information.client_id,
        "code_challenge": code_challenge,
        "code_challenge_method": code_challenge_method,
        "redirect_uri": redirect_url,
    }

    if scope:
        params["scope"] = scope

    authorization_url = f"{authorization_url}?{urllib.parse.urlencode(params)}"
    return authorization_url, code_verifier


def exchange_authorization(
    server_url: str,
    metadata: Optional[OAuthMetadata],
    client_information: OAuthClientInformation,
    authorization_code: str,
    code_verifier: str,
    redirect_uri: str,
) -> OAuthTokens:
    """Exchanges an authorization code for an access token."""
    grant_type = "authorization_code"

    if metadata:
        token_url = metadata.token_endpoint
        if metadata.grant_types_supported and grant_type not in metadata.grant_types_supported:
            raise Exception(f"Incompatible auth server: does not support grant type {grant_type}")
    else:
        token_url = urljoin(server_url, "/token")

    params = {
        "grant_type": grant_type,
        "client_id": client_information.client_id,
        "code": authorization_code,
        "code_verifier": code_verifier,
        "redirect_uri": redirect_uri,
    }

    if client_information.client_secret:
        params["client_secret"] = client_information.client_secret

    response = requests.post(token_url, data=params)
    if not response.ok:
        raise Exception(f"Token exchange failed: HTTP {response.status_code}")
    return OAuthTokens.model_validate(response.json())


def refresh_authorization(
    server_url: str,
    metadata: Optional[OAuthMetadata],
    client_information: OAuthClientInformation,
    refresh_token: str,
) -> OAuthTokens:
    """Exchange a refresh token for an updated access token."""
    grant_type = "refresh_token"

    if metadata:
        token_url = metadata.token_endpoint
        if metadata.grant_types_supported and grant_type not in metadata.grant_types_supported:
            raise Exception(f"Incompatible auth server: does not support grant type {grant_type}")
    else:
        token_url = urljoin(server_url, "/token")

    params = {
        "grant_type": grant_type,
        "client_id": client_information.client_id,
        "refresh_token": refresh_token,
    }

    if client_information.client_secret:
        params["client_secret"] = client_information.client_secret

    response = requests.post(token_url, data=params)
    if not response.ok:
        raise Exception(f"Token refresh failed: HTTP {response.status_code}")
    return OAuthTokens.parse_obj(response.json())


def register_client(
    server_url: str,
    metadata: Optional[OAuthMetadata],
    client_metadata: OAuthClientMetadata,
) -> OAuthClientInformationFull:
    """Performs OAuth 2.0 Dynamic Client Registration."""
    if metadata:
        if not metadata.registration_endpoint:
            raise Exception("Incompatible auth server: does not support dynamic client registration")
        registration_url = metadata.registration_endpoint
    else:
        registration_url = urljoin(server_url, "/register")

    response = requests.post(
        registration_url,
        json=client_metadata.model_dump(),
        headers={"Content-Type": "application/json"},
    )
    if not response.ok:
        response.raise_for_status()
    return OAuthClientInformationFull.model_validate(response.json())


def auth(
    provider: OAuthClientProvider,
    server_url: str,
    authorization_code: Optional[str] = None,
    scope: Optional[str] = None,
) -> dict[str, str]:
    """Orchestrates the full auth flow with a server."""
    metadata = discover_oauth_metadata(server_url)

    # Handle client registration if needed
    client_information = provider.client_information()
    if not client_information:
        if authorization_code is not None:
            raise Exception("Existing OAuth client information is required when exchanging an authorization code")

        full_information = register_client(server_url, metadata, provider.client_metadata)
        provider.save_client_information(full_information)
        client_information = full_information

    # Exchange authorization code for tokens
    if authorization_code is not None:
        code_verifier = provider.code_verifier()
        tokens = exchange_authorization(
            server_url,
            metadata,
            client_information,
            authorization_code,
            code_verifier,
            provider.redirect_url,
        )
        provider.save_tokens(tokens)
        return {"result": "success"}

    tokens = provider.tokens()

    # Handle token refresh or new authorization
    if tokens and tokens.refresh_token:
        try:
            new_tokens = refresh_authorization(server_url, metadata, client_information, tokens.refresh_token)
            provider.save_tokens(new_tokens)
            return {"result": "success"}
        except Exception as e:
            print(f"Could not refresh OAuth tokens: {e}")

    # Start new authorization flow
    authorization_url, code_verifier = start_authorization(
        server_url,
        metadata,
        client_information,
        provider.redirect_url,
        scope or provider.client_metadata.scope,
    )

    provider.save_code_verifier(code_verifier)
    return {"authorization_url": authorization_url}
