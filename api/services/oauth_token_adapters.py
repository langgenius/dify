"""Outer adapters for the OAuth token endpoint."""

from datetime import timedelta
from typing import override

from configs import dify_config
from services.oauth_token_contracts import OAuthTokenSettings


def authorization_code_enabled() -> bool:
    """The browser flow needs bearer auth: without it no token the flow issues could be used."""
    if not dify_config.ENABLE_OAUTH_BEARER:
        return False
    return dify_config.ENABLE_OAUTH_AUTHORIZATION_CODE


def dcr_enabled() -> bool:
    if not authorization_code_enabled():
        return False
    return dify_config.ENABLE_OAUTH_DCR


def cimd_enabled() -> bool:
    if not authorization_code_enabled():
        return False
    return dify_config.ENABLE_OAUTH_CIMD


class DifyConfigOAuthTokenSettings(OAuthTokenSettings):
    @property
    @override
    def authorization_code_enabled(self) -> bool:
        return authorization_code_enabled()

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
