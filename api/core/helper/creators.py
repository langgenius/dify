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
from services.oauth_server import OAuthServerService

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
    """Generate the redirect URL to the Creators Platform OAuth callback.

    Signs an OAuth authorization code for the current user and builds
    a URL pointing to the Creators Platform's existing OAuth callback
    endpoint, with the dsl_claim_code passed as a query parameter.

    The callback endpoint will process the OAuth code, authenticate the
    user, and redirect to the appropriate frontend page. The frontend
    landing page (login or root) stores the dsl_claim_code in localStorage
    before initiating the redirect.

    Args:
        user_account_id: The Dify user account ID.
        claim_code: The claim_code obtained from upload_dsl().

    Returns:
        The full redirect URL string.

    Raises:
        ValueError: If CREATORS_PLATFORM_OAUTH_CLIENT_ID is not configured.
    """
    client_id = str(dify_config.CREATORS_PLATFORM_OAUTH_CLIENT_ID)
    if not client_id:
        raise ValueError("CREATORS_PLATFORM_OAUTH_CLIENT_ID is not configured")

    oauth_code = OAuthServerService.sign_oauth_authorization_code(client_id, user_account_id)

    # Build the redirect URL to the Creators Platform callback endpoint
    callback_url = str(creators_platform_api_url / "api/v1/oauth/callback/dify")
    params = urlencode({
        "code": oauth_code,
        "dsl_claim_code": claim_code,
    })

    return f"{callback_url}?{params}"
