import base64
import hashlib
import json
import os
import secrets
import urllib.parse
from typing import Optional
from urllib.parse import urljoin

import requests
from pydantic import BaseModel, ValidationError

from core.mcp.auth.auth_provider import OAuthClientProvider
from core.mcp.types import (
    OAuthClientInformation,
    OAuthClientInformationFull,
    OAuthClientMetadata,
    OAuthMetadata,
    OAuthTokens,
)
from extensions.ext_redis import redis_client

LATEST_PROTOCOL_VERSION = "1.0"
OAUTH_STATE_EXPIRY_SECONDS = 5 * 60  # 5 minutes expiry
OAUTH_STATE_REDIS_KEY_PREFIX = "oauth_state:"


class OAuthCallbackState(BaseModel):
    provider_id: str
    tenant_id: str
    server_url: str
    metadata: OAuthMetadata | None = None
    client_information: OAuthClientInformation
    code_verifier: str
    redirect_uri: str


def generate_pkce_challenge() -> tuple[str, str]:
    """Generate PKCE challenge and verifier."""
    code_verifier = base64.urlsafe_b64encode(os.urandom(40)).decode("utf-8")
    code_verifier = code_verifier.replace("=", "").replace("+", "-").replace("/", "_")

    code_challenge_hash = hashlib.sha256(code_verifier.encode("utf-8")).digest()
    code_challenge = base64.urlsafe_b64encode(code_challenge_hash).decode("utf-8")
    code_challenge = code_challenge.replace("=", "").replace("+", "-").replace("/", "_")

    return code_verifier, code_challenge


def _create_secure_redis_state(state_data: OAuthCallbackState) -> str:
    """Create a secure state parameter by storing state data in Redis and returning a random state key."""
    # Generate a secure random state key
    state_key = secrets.token_urlsafe(32)

    # Store the state data in Redis with expiration
    redis_key = f"{OAUTH_STATE_REDIS_KEY_PREFIX}{state_key}"
    redis_client.setex(redis_key, OAUTH_STATE_EXPIRY_SECONDS, state_data.model_dump_json())

    return state_key


def _retrieve_redis_state(state_key: str) -> OAuthCallbackState:
    """Retrieve and decode OAuth state data from Redis using the state key, then delete it."""
    redis_key = f"{OAUTH_STATE_REDIS_KEY_PREFIX}{state_key}"

    # Get state data from Redis
    state_data = redis_client.get(redis_key)

    if not state_data:
        raise ValueError("State parameter has expired or does not exist")

    # Delete the state data from Redis immediately after retrieval to prevent reuse
    redis_client.delete(redis_key)

    try:
        # Parse and validate the state data
        oauth_state = OAuthCallbackState.model_validate_json(state_data)

        return oauth_state
    except ValidationError as e:
        raise ValueError(f"Invalid state parameter: {str(e)}")


def handle_callback(state_key: str, authorization_code: str) -> OAuthCallbackState:
    """Handle the callback from the OAuth provider."""
    # Retrieve state data from Redis (state is automatically deleted after retrieval)
    full_state_data = _retrieve_redis_state(state_key)

    tokens = exchange_authorization(
        full_state_data.server_url,
        full_state_data.metadata,
        full_state_data.client_information,
        authorization_code,
        full_state_data.code_verifier,
        full_state_data.redirect_uri,
    )
    provider = OAuthClientProvider(full_state_data.provider_id, full_state_data.tenant_id, for_list=True)
    provider.save_tokens(tokens)
    return full_state_data


def discover_oauth_metadata(server_url: str, protocol_version: Optional[str] = None) -> Optional[OAuthMetadata]:
    """Looks up RFC 8414 OAuth 2.0 Authorization Server Metadata."""
    url = urljoin(server_url, "/.well-known/oauth-authorization-server")

    try:
        headers = {"MCP-Protocol-Version": protocol_version or LATEST_PROTOCOL_VERSION}
        response = requests.get(url, headers=headers)
        if response.status_code == 404:
            return None
        if not response.ok:
            raise ValueError(f"HTTP {response.status_code} trying to load well-known OAuth metadata")
        return OAuthMetadata.model_validate(response.json())
    except requests.RequestException as e:
        if isinstance(e, requests.ConnectionError):
            response = requests.get(url)
            if response.status_code == 404:
                return None
            if not response.ok:
                raise ValueError(f"HTTP {response.status_code} trying to load well-known OAuth metadata")
            return OAuthMetadata.model_validate(response.json())
        raise


def start_authorization(
    server_url: str,
    metadata: Optional[OAuthMetadata],
    client_information: OAuthClientInformation,
    redirect_url: str,
    provider_id: str,
    tenant_id: str,
) -> tuple[str, str]:
    """Begins the authorization flow with secure Redis state storage."""
    response_type = "code"
    code_challenge_method = "S256"

    if metadata:
        authorization_url = metadata.authorization_endpoint
        if response_type not in metadata.response_types_supported:
            raise ValueError(f"Incompatible auth server: does not support response type {response_type}")
        if (
            not metadata.code_challenge_methods_supported
            or code_challenge_method not in metadata.code_challenge_methods_supported
        ):
            raise ValueError(
                f"Incompatible auth server: does not support code challenge method {code_challenge_method}"
            )
    else:
        authorization_url = urljoin(server_url, "/authorize")

    code_verifier, code_challenge = generate_pkce_challenge()

    # Prepare state data with all necessary information
    state_data = OAuthCallbackState(
        provider_id=provider_id,
        tenant_id=tenant_id,
        server_url=server_url,
        metadata=metadata,
        client_information=client_information,
        code_verifier=code_verifier,
        redirect_uri=redirect_url,
    )

    # Store state data in Redis and generate secure state key
    state_key = _create_secure_redis_state(state_data)

    params = {
        "response_type": response_type,
        "client_id": client_information.client_id,
        "code_challenge": code_challenge,
        "code_challenge_method": code_challenge_method,
        "redirect_uri": redirect_url,
        "state": state_key,
    }

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
            raise ValueError(f"Incompatible auth server: does not support grant type {grant_type}")
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
        raise ValueError(f"Token exchange failed: HTTP {response.status_code}")
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
            raise ValueError(f"Incompatible auth server: does not support grant type {grant_type}")
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
        raise ValueError(f"Token refresh failed: HTTP {response.status_code}")
    return OAuthTokens.model_validate(response.json())


def register_client(
    server_url: str,
    metadata: Optional[OAuthMetadata],
    client_metadata: OAuthClientMetadata,
) -> OAuthClientInformationFull:
    """Performs OAuth 2.0 Dynamic Client Registration."""
    if metadata:
        if not metadata.registration_endpoint:
            raise ValueError("Incompatible auth server: does not support dynamic client registration")
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
    state_param: Optional[str] = None,
    for_list: bool = False,
) -> dict[str, str]:
    """Orchestrates the full auth flow with a server using secure Redis state storage."""
    metadata = discover_oauth_metadata(server_url)

    # Handle client registration if needed
    client_information = provider.client_information()
    if not client_information:
        if authorization_code is not None:
            raise ValueError("Existing OAuth client information is required when exchanging an authorization code")
        try:
            full_information = register_client(server_url, metadata, provider.client_metadata)
        except requests.RequestException as e:
            raise ValueError(f"Could not register OAuth client: {e}")
        provider.save_client_information(full_information)
        client_information = full_information

    # Exchange authorization code for tokens
    if authorization_code is not None:
        if not state_param:
            raise ValueError("State parameter is required when exchanging authorization code")

        try:
            # Retrieve state data from Redis using state key
            full_state_data = _retrieve_redis_state(state_param)

            code_verifier = full_state_data.code_verifier
            redirect_uri = full_state_data.redirect_uri

            if not code_verifier or not redirect_uri:
                raise ValueError("Missing code_verifier or redirect_uri in state data")

        except (json.JSONDecodeError, ValueError) as e:
            raise ValueError(f"Invalid state parameter: {e}")

        tokens = exchange_authorization(
            server_url,
            metadata,
            client_information,
            authorization_code,
            code_verifier,
            redirect_uri,
        )
        provider.save_tokens(tokens)
        return {"result": "success"}

    provider_tokens = provider.tokens()

    # Handle token refresh or new authorization
    if provider_tokens and provider_tokens.refresh_token:
        try:
            new_tokens = refresh_authorization(server_url, metadata, client_information, provider_tokens.refresh_token)
            provider.save_tokens(new_tokens)
            return {"result": "success"}
        except Exception as e:
            raise ValueError(f"Could not refresh OAuth tokens: {e}")

    # Start new authorization flow
    authorization_url, code_verifier = start_authorization(
        server_url,
        metadata,
        client_information,
        provider.redirect_url,
        provider.mcp_provider.id,
        provider.mcp_provider.tenant_id,
    )

    provider.save_code_verifier(code_verifier)
    return {"authorization_url": authorization_url}
