"""Creators admission and OAuth use the configured client and explicit account identity."""

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import cast
from urllib.parse import parse_qs, urlsplit

import pytest

from services.app import creators_platform_gateway as gateway_module
from services.app.console_service import CreatorsPlatformDisabledError
from services.entities.oauth_server_entities import OAuthAuthorizationCode
from services.oauth_server_service import OAuthServerService


@pytest.fixture(autouse=True)
def creators_url(config_overrides: Callable[..., None]) -> None:
    config_overrides(CREATORS_PLATFORM_API_URL="https://creators.example.com/")


@dataclass
class OAuth:
    calls: list[tuple[str, str]] = field(default_factory=list)

    def issue_authorization_code(self, *, client_id: str, account_id: str) -> OAuthAuthorizationCode:
        self.calls.append((client_id, account_id))
        return OAuthAuthorizationCode(code="code + &")


@pytest.mark.parametrize("client_id", ["", "client"])
def test_gateway_uses_configured_oauth_client_and_encodes_redirect(
    config_overrides: Callable[..., None],
    client_id: str,
) -> None:
    config_overrides(CREATORS_PLATFORM_FEATURES_ENABLED=True, CREATORS_PLATFORM_OAUTH_CLIENT_ID=client_id)
    oauth = OAuth()
    gateway = gateway_module.CreatorsPlatformGateway(oauth=cast(OAuthServerService, oauth))
    gateway.require_enabled()
    code = gateway.authorize("actor")
    assert oauth.calls == ([("client", "actor")] if client_id else [])
    url = urlsplit(gateway.redirect_url("claim + &", code))
    assert url.path == ""
    assert parse_qs(url.query) == {
        "dsl_claim_code": ["claim + &"],
        **({"oauth_code": ["code + &"]} if client_id else {}),
    }


def test_gateway_rejects_disabled_feature(config_overrides: Callable[..., None]) -> None:
    config_overrides(CREATORS_PLATFORM_FEATURES_ENABLED=False)
    gateway = gateway_module.CreatorsPlatformGateway(oauth=cast(OAuthServerService, OAuth()))
    with pytest.raises(CreatorsPlatformDisabledError):
        gateway.require_enabled()
