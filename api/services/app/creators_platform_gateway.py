"""Creators Platform uploads, redirects and OAuth authorization adapter."""

from typing import BinaryIO, override

import httpx
from yarl import URL

from configs import dify_config
from core.helper import creators, ssrf_proxy
from services.app.console_service import CreatorsPlatform, CreatorsPlatformDisabledError
from services.oauth_server_service import OAuthServerService

_CREATORS_REQUEST_TIMEOUT = httpx.Timeout(30.0, connect=5.0)


class CreatorsPlatformGateway(CreatorsPlatform):
    def __init__(self, *, oauth: OAuthServerService) -> None:
        self._oauth = oauth

    @override
    def require_enabled(self) -> None:
        if not dify_config.CREATORS_PLATFORM_FEATURES_ENABLED:
            raise CreatorsPlatformDisabledError("Creators Platform features are not enabled")

    @override
    def upload(self, source: BinaryIO, *, filename: str) -> str:
        url = str(URL(str(dify_config.CREATORS_PLATFORM_API_URL)) / "api/v1/templates/anonymous-upload")
        response = ssrf_proxy.post(
            url,
            files={"file": (filename, source, "application/octet-stream")},
            timeout=_CREATORS_REQUEST_TIMEOUT,
            max_retries=0,
        )
        response.raise_for_status()
        data = response.json().get("data")
        claim_code = data.get("claim_code") if isinstance(data, dict) else None
        if not isinstance(claim_code, str) or not claim_code:
            raise ValueError("Creators Platform did not return a valid claim_code")
        return claim_code

    @override
    def authorize(self, account_id: str) -> str | None:
        client_id = dify_config.CREATORS_PLATFORM_OAUTH_CLIENT_ID
        if not client_id:
            return None
        return self._oauth.issue_authorization_code(client_id=client_id, account_id=account_id).code

    @override
    def redirect_url(self, claim_code: str, oauth_code: str | None) -> str:
        return creators.get_redirect_url(claim_code, oauth_code=oauth_code)
