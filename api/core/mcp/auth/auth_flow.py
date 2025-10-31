import base64
import hashlib
import json
import os
import secrets
import urllib.parse
from urllib.parse import urljoin, urlparse

from httpx import ConnectError, HTTPStatusError, RequestError
from pydantic import ValidationError

from core.entities.mcp_provider import MCPProviderEntity, MCPSupportGrantType
from core.helper import ssrf_proxy
from core.mcp.entities import AuthAction, AuthActionType, AuthResult, OAuthCallbackState
from core.mcp.error import MCPRefreshTokenError
from core.mcp.types import (
    LATEST_PROTOCOL_VERSION,
    OAuthClientInformation,
    OAuthClientInformationFull,
    OAuthClientMetadata,
    OAuthMetadata,
    OAuthTokens,
)
from extensions.ext_redis import redis_client

OAUTH_STATE_EXPIRY_SECONDS = 5 * 60  # 5 minutes expiry
OAUTH_STATE_REDIS_KEY_PREFIX = "oauth_state:"


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


def handle_callback(state_key: str, authorization_code: str) -> tuple[OAuthCallbackState, OAuthTokens]:
    """
    Handle the callback from the OAuth provider.

    Returns:
        A tuple of (callback_state, tokens) that can be used by the caller to save data.
    """
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

    return full_state_data, tokens


def check_support_resource_discovery(server_url: str) -> tuple[bool, str]:
    """Check if the server supports OAuth 2.0 Resource Discovery."""
    b_scheme, b_netloc, _, _, b_query, b_fragment = urlparse(server_url, "", True)
    url_for_resource_discovery = f"{b_scheme}://{b_netloc}/.well-known/oauth-protected-resource"
    if b_query:
        url_for_resource_discovery += f"?{b_query}"
    if b_fragment:
        url_for_resource_discovery += f"#{b_fragment}"
    try:
        headers = {"MCP-Protocol-Version": LATEST_PROTOCOL_VERSION, "User-Agent": "Dify"}
        response = ssrf_proxy.get(url_for_resource_discovery, headers=headers)
        if 200 <= response.status_code < 300:
            body = response.json()
            # Support both singular and plural forms
            if body.get("authorization_servers"):
                return True, body["authorization_servers"][0]
            elif body.get("authorization_server_url"):
                return True, body["authorization_server_url"][0]
            else:
                return False, ""
        return False, ""
    except RequestError:
        # Not support resource discovery, fall back to well-known OAuth metadata
        return False, ""


def discover_oauth_metadata(server_url: str, protocol_version: str | None = None) -> OAuthMetadata | None:
    """Looks up RFC 8414 OAuth 2.0 Authorization Server Metadata."""
    # First check if the server supports OAuth 2.0 Resource Discovery
    support_resource_discovery, oauth_discovery_url = check_support_resource_discovery(server_url)
    if support_resource_discovery:
        # The oauth_discovery_url is the authorization server base URL
        # Try OpenID Connect discovery first (more common), then OAuth 2.0
        urls_to_try = [
            urljoin(oauth_discovery_url + "/", ".well-known/oauth-authorization-server"),
            urljoin(oauth_discovery_url + "/", ".well-known/openid-configuration"),
        ]
    else:
        urls_to_try = [urljoin(server_url, "/.well-known/oauth-authorization-server")]

    headers = {"MCP-Protocol-Version": protocol_version or LATEST_PROTOCOL_VERSION}

    for url in urls_to_try:
        try:
            response = ssrf_proxy.get(url, headers=headers)
            if response.status_code == 404:
                continue
            if not response.is_success:
                response.raise_for_status()
            return OAuthMetadata.model_validate(response.json())
        except (RequestError, HTTPStatusError) as e:
            if isinstance(e, ConnectError):
                response = ssrf_proxy.get(url)
                if response.status_code == 404:
                    continue  # Try next URL
                if not response.is_success:
                    raise ValueError(f"HTTP {response.status_code} trying to load well-known OAuth metadata")
                return OAuthMetadata.model_validate(response.json())
            # For other errors, try next URL
            continue

    return None  # No metadata found


def start_authorization(
    server_url: str,
    metadata: OAuthMetadata | None,
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
    metadata: OAuthMetadata | None,
    client_information: OAuthClientInformation,
    authorization_code: str,
    code_verifier: str,
    redirect_uri: str,
) -> OAuthTokens:
    """Exchanges an authorization code for an access token."""
    grant_type = MCPSupportGrantType.AUTHORIZATION_CODE.value

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

    response = ssrf_proxy.post(token_url, data=params)
    if not response.is_success:
        raise ValueError(f"Token exchange failed: HTTP {response.status_code}")
    return OAuthTokens.model_validate(response.json())


def refresh_authorization(
    server_url: str,
    metadata: OAuthMetadata | None,
    client_information: OAuthClientInformation,
    refresh_token: str,
) -> OAuthTokens:
    """Exchange a refresh token for an updated access token."""
    grant_type = MCPSupportGrantType.REFRESH_TOKEN.value

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
    try:
        response = ssrf_proxy.post(token_url, data=params)
    except ssrf_proxy.MaxRetriesExceededError as e:
        raise MCPRefreshTokenError(e) from e
    if not response.is_success:
        raise MCPRefreshTokenError(response.text)
    return OAuthTokens.model_validate(response.json())


def client_credentials_flow(
    server_url: str,
    metadata: OAuthMetadata | None,
    client_information: OAuthClientInformation,
    scope: str | None = None,
) -> OAuthTokens:
    """Execute Client Credentials Flow to get access token."""
    grant_type = MCPSupportGrantType.CLIENT_CREDENTIALS.value

    if metadata:
        token_url = metadata.token_endpoint
        if metadata.grant_types_supported and grant_type not in metadata.grant_types_supported:
            raise ValueError(f"Incompatible auth server: does not support grant type {grant_type}")
    else:
        token_url = urljoin(server_url, "/token")

    # Support both Basic Auth and body parameters for client authentication
    headers = {"Content-Type": "application/x-www-form-urlencoded"}
    data = {"grant_type": grant_type}

    if scope:
        data["scope"] = scope

    # If client_secret is provided, use Basic Auth (preferred method)
    if client_information.client_secret:
        credentials = f"{client_information.client_id}:{client_information.client_secret}"
        encoded_credentials = base64.b64encode(credentials.encode()).decode()
        headers["Authorization"] = f"Basic {encoded_credentials}"
    else:
        # Fall back to including credentials in the body
        data["client_id"] = client_information.client_id
        if client_information.client_secret:
            data["client_secret"] = client_information.client_secret

    response = ssrf_proxy.post(token_url, headers=headers, data=data)
    if not response.is_success:
        raise ValueError(
            f"Client credentials token request failed: HTTP {response.status_code}, Response: {response.text}"
        )

    return OAuthTokens.model_validate(response.json())


def register_client(
    server_url: str,
    metadata: OAuthMetadata | None,
    client_metadata: OAuthClientMetadata,
) -> OAuthClientInformationFull:
    """Performs OAuth 2.0 Dynamic Client Registration."""
    if metadata:
        if not metadata.registration_endpoint:
            raise ValueError("Incompatible auth server: does not support dynamic client registration")
        registration_url = metadata.registration_endpoint
    else:
        registration_url = urljoin(server_url, "/register")

    response = ssrf_proxy.post(
        registration_url,
        json=client_metadata.model_dump(),
        headers={"Content-Type": "application/json"},
    )
    if not response.is_success:
        response.raise_for_status()
    return OAuthClientInformationFull.model_validate(response.json())


def auth(
    provider: MCPProviderEntity,
    authorization_code: str | None = None,
    state_param: str | None = None,
) -> AuthResult:
    """
    Orchestrates the full auth flow with a server using secure Redis state storage.

    This function performs only network operations and returns actions that need
    to be performed by the caller (such as saving data to database).

    Args:
        provider: The MCP provider entity
        authorization_code: Optional authorization code from OAuth callback
        state_param: Optional state parameter from OAuth callback

    Returns:
        AuthResult containing actions to be performed and response data
    """
    actions: list[AuthAction] = []
    server_url = provider.decrypt_server_url()
    server_metadata = discover_oauth_metadata(server_url)
    client_metadata = provider.client_metadata
    provider_id = provider.id
    tenant_id = provider.tenant_id
    client_information = provider.retrieve_client_information()
    redirect_url = provider.redirect_url

    # Determine grant type based on server metadata
    if not server_metadata:
        raise ValueError("Failed to discover OAuth metadata from server")

    supported_grant_types = server_metadata.grant_types_supported or []

    # Convert to lowercase for comparison
    supported_grant_types_lower = [gt.lower() for gt in supported_grant_types]

    # Determine which grant type to use
    effective_grant_type = None
    if MCPSupportGrantType.AUTHORIZATION_CODE.value in supported_grant_types_lower:
        effective_grant_type = MCPSupportGrantType.AUTHORIZATION_CODE.value
    else:
        effective_grant_type = MCPSupportGrantType.CLIENT_CREDENTIALS.value

    # Get stored credentials
    credentials = provider.decrypt_credentials()

    if not client_information:
        if authorization_code is not None:
            raise ValueError("Existing OAuth client information is required when exchanging an authorization code")

        # For client credentials flow, we don't need to register client dynamically
        if effective_grant_type == MCPSupportGrantType.CLIENT_CREDENTIALS.value:
            # Client should provide client_id and client_secret directly
            raise ValueError("Client credentials flow requires client_id and client_secret to be provided")

        try:
            full_information = register_client(server_url, server_metadata, client_metadata)
        except RequestError as e:
            raise ValueError(f"Could not register OAuth client: {e}")

        # Return action to save client information
        actions.append(
            AuthAction(
                action_type=AuthActionType.SAVE_CLIENT_INFO,
                data={"client_information": full_information.model_dump()},
                provider_id=provider_id,
                tenant_id=tenant_id,
            )
        )

        client_information = full_information

    # Handle client credentials flow
    if effective_grant_type == MCPSupportGrantType.CLIENT_CREDENTIALS.value:
        # Direct token request without user interaction
        try:
            scope = credentials.get("scope")
            tokens = client_credentials_flow(
                server_url,
                server_metadata,
                client_information,
                scope,
            )

            # Return action to save tokens and grant type
            token_data = tokens.model_dump()
            token_data["grant_type"] = MCPSupportGrantType.CLIENT_CREDENTIALS.value

            actions.append(
                AuthAction(
                    action_type=AuthActionType.SAVE_TOKENS,
                    data=token_data,
                    provider_id=provider_id,
                    tenant_id=tenant_id,
                )
            )

            return AuthResult(actions=actions, response={"result": "success"})
        except (RequestError, ValueError, KeyError) as e:
            # RequestError: HTTP request failed
            # ValueError: Invalid response data
            # KeyError: Missing required fields in response
            raise ValueError(f"Client credentials flow failed: {e}")

    # Exchange authorization code for tokens (Authorization Code flow)
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
            server_metadata,
            client_information,
            authorization_code,
            code_verifier,
            redirect_uri,
        )

        # Return action to save tokens
        actions.append(
            AuthAction(
                action_type=AuthActionType.SAVE_TOKENS,
                data=tokens.model_dump(),
                provider_id=provider_id,
                tenant_id=tenant_id,
            )
        )

        return AuthResult(actions=actions, response={"result": "success"})

    provider_tokens = provider.retrieve_tokens()

    # Handle token refresh or new authorization
    if provider_tokens and provider_tokens.refresh_token:
        try:
            new_tokens = refresh_authorization(
                server_url, server_metadata, client_information, provider_tokens.refresh_token
            )

            # Return action to save new tokens
            actions.append(
                AuthAction(
                    action_type=AuthActionType.SAVE_TOKENS,
                    data=new_tokens.model_dump(),
                    provider_id=provider_id,
                    tenant_id=tenant_id,
                )
            )

            return AuthResult(actions=actions, response={"result": "success"})
        except (RequestError, ValueError, KeyError) as e:
            # RequestError: HTTP request failed
            # ValueError: Invalid response data
            # KeyError: Missing required fields in response
            raise ValueError(f"Could not refresh OAuth tokens: {e}")

    # Start new authorization flow (only for authorization code flow)
    authorization_url, code_verifier = start_authorization(
        server_url,
        server_metadata,
        client_information,
        redirect_url,
        provider_id,
        tenant_id,
    )

    # Return action to save code verifier
    actions.append(
        AuthAction(
            action_type=AuthActionType.SAVE_CODE_VERIFIER,
            data={"code_verifier": code_verifier},
            provider_id=provider_id,
            tenant_id=tenant_id,
        )
    )

    return AuthResult(actions=actions, response={"authorization_url": authorization_url})
