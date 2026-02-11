"""
Helper module for Creators Platform integration.

Provides functionality to upload DSL files to the Creators Platform
and generate redirect URLs with OAuth authorization codes.
"""

import logging
from urllib.parse import urlencode

import httpx
from yarl import URL

from configs import dify_config

logger = logging.getLogger(__name__)

creators_platform_api_url = URL(str(dify_config.CREATORS_PLATFORM_API_URL))


def upload_dsl(dsl_file_bytes: bytes, filename: str = "template.yaml") -> str:
    """Upload a DSL file to the Creators Platform anonymous upload endpoint.

    Args:
        dsl_file_bytes: Raw bytes of the DSL file (YAML or ZIP).
        filename: Original filename for the upload.

    Returns:
        The claim_code string used to retrieve the DSL later.

    Raises:
        httpx.HTTPStatusError: If the upload request fails.
        ValueError: If the response does not contain a valid claim_code.
    """
    url = str(creators_platform_api_url / "api/v1/templates/anonymous-upload")
    response = httpx.post(url, files={"file": (filename, dsl_file_bytes)}, timeout=30)
    response.raise_for_status()

    data = response.json()
    claim_code = data.get("data", {}).get("claim_code")
    if not claim_code:
        raise ValueError("Creators Platform did not return a valid claim_code")

    return claim_code


def get_redirect_url(user_account_id: str, claim_code: str) -> str:
    """Generate the redirect URL to the Creators Platform frontend.

    Redirects to the Creators Platform root page with the dsl_claim_code.
    If CREATORS_PLATFORM_OAUTH_CLIENT_ID is configured (Dify Cloud),
    also signs an OAuth authorization code so the frontend can
    automatically authenticate the user via the OAuth callback.

    For self-hosted Dify without OAuth client_id configured, only the
    dsl_claim_code is passed and the user must log in manually.

    Args:
        user_account_id: The Dify user account ID.
        claim_code: The claim_code obtained from upload_dsl().

    Returns:
        The full redirect URL string.
    """
    base_url = str(dify_config.CREATORS_PLATFORM_API_URL).rstrip("/")
    params: dict[str, str] = {"dsl_claim_code": claim_code}

    client_id = str(dify_config.CREATORS_PLATFORM_OAUTH_CLIENT_ID or "")
    if client_id:
        from services.oauth_server import OAuthServerService

        oauth_code = OAuthServerService.sign_oauth_authorization_code(client_id, user_account_id)
        params["oauth_code"] = oauth_code

    return f"{base_url}?{urlencode(params)}"
