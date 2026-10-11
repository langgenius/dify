"""Creators Platform uploads, redirects and OAuth authorization adapter."""

from typing import override

from configs import dify_config
from core.helper import creators
from services.app.console_service import CreatorsPlatform, CreatorsPlatformDisabledError
from services.oauth_server_service import OAuthServerService


class CreatorsPlatformGateway(CreatorsPlatform):
    def __init__(self, *, oauth: OAuthServerService) -> None:
        self._oauth = oauth

    @override
    def require_enabled(self) -> None:
        if not dify_config.CREATORS_PLATFORM_FEATURES_ENABLED:
            raise CreatorsPlatformDisabledError("Creators Platform features are not enabled")

    @override
    def upload(self, dsl: str) -> str:
        return creators.upload_dsl(dsl.encode("utf-8"))

    @override
    def authorize(self, account_id: str) -> str | None:
        client_id = dify_config.CREATORS_PLATFORM_OAUTH_CLIENT_ID
        if not client_id:
            return None
        return self._oauth.issue_authorization_code(client_id=client_id, account_id=account_id).code

    @override
    def redirect_url(self, claim_code: str, oauth_code: str | None) -> str:
        return creators.get_redirect_url(claim_code, oauth_code=oauth_code)
