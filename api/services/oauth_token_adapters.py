"""Outer adapters for the OAuth token endpoint."""

from datetime import timedelta
from typing import override

from configs import dify_config
from services.oauth_token_contracts import OAuthTokenSettings


class DifyConfigOAuthTokenSettings(OAuthTokenSettings):
    @property
    @override
    def authorization_code_enabled(self) -> bool:
        return dify_config.ENABLE_OAUTH_AUTHORIZATION_CODE

    @property
    @override
    def auth_code_access_token_lifetime(self) -> timedelta:
        return timedelta(hours=dify_config.OAUTH_AUTH_CODE_ACCESS_TOKEN_TTL_HOURS)

    @property
    @override
    def authorization_code_ttl(self) -> timedelta:
        return timedelta(seconds=dify_config.OAUTH_AUTHORIZATION_CODE_TTL_SECONDS)

    @property
    @override
    def refresh_token_lifetime(self) -> timedelta:
        return timedelta(days=dify_config.OAUTH_REFRESH_TOKEN_TTL_DAYS)

    @property
    @override
    def refresh_reuse_grace(self) -> timedelta:
        return timedelta(minutes=dify_config.OAUTH_REFRESH_TOKEN_REUSE_GRACE_MINUTES)
