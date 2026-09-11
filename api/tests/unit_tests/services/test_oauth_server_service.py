from unittest.mock import MagicMock

import pytest

from machinery.context import RequestContext
from services.entities.oauth_server_entities import (
    OAuthProviderAccount,
    OAuthProviderAccountRecord,
    OAuthProviderAccountStatus,
    OAuthProviderAppRecord,
)
from services.oauth_server_service import (
    OAuthServerClientNotFoundError,
    OAuthServerRequestError,
    OAuthServerService,
    OAuthServerUnauthorizedError,
)


@pytest.fixture
def provider_app() -> OAuthProviderAppRecord:
    return OAuthProviderAppRecord(
        app_icon="icon",
        client_id="client-1",
        client_secret="secret",
        app_label={"en-US": "Test App"},
        redirect_uris=("https://example.com/callback",),
        scope="read",
        auto_authorize=True,
    )


@pytest.fixture
def service(provider_app: OAuthProviderAppRecord) -> tuple[OAuthServerService, MagicMock, MagicMock]:
    repository = MagicMock()
    repository.get_provider_app_by_client_id.return_value = provider_app
    tokens = MagicMock()
    return (
        OAuthServerService(
            repository=repository,
            tokens=tokens,
            access_token_expires_in=43200,
        ),
        repository,
        tokens,
    )


def test_get_provider_validates_redirect_and_hides_credentials(
    service: tuple[OAuthServerService, MagicMock, MagicMock],
) -> None:
    oauth_server, repository, _tokens = service

    result = oauth_server.get_provider(
        client_id="client-1",
        redirect_uri="https://example.com/callback",
    )

    assert result.app_icon == "icon"
    assert result.app_label == {"en-US": "Test App"}
    assert result.scope == "read"
    assert result.auto_authorize is True
    repository.get_provider_app_by_client_id.assert_called_once_with("client-1")


def test_get_provider_rejects_invalid_redirect(
    service: tuple[OAuthServerService, MagicMock, MagicMock],
) -> None:
    oauth_server, _provider_apps, _tokens = service

    with pytest.raises(OAuthServerRequestError, match="redirect_uri is invalid"):
        oauth_server.get_provider(client_id="client-1", redirect_uri="https://invalid.example/callback")


def test_missing_client_is_reported_by_application_boundary(
    service: tuple[OAuthServerService, MagicMock, MagicMock],
) -> None:
    oauth_server, repository, _tokens = service
    repository.get_provider_app_by_client_id.return_value = None

    with pytest.raises(OAuthServerClientNotFoundError, match="client_id is invalid"):
        oauth_server.authorize(
            RequestContext("request-1", None, "account-1", "workspace-1"),
            client_id="missing",
        )


def test_authorize_uses_stable_request_context(
    service: tuple[OAuthServerService, MagicMock, MagicMock],
) -> None:
    oauth_server, _provider_apps, tokens = service
    tokens.issue_authorization_code.return_value = "code-1"
    context = RequestContext("request-1", "trace-1", "account-1", "workspace-1")

    result = oauth_server.authorize(context, client_id="client-1")

    assert result.code == "code-1"
    tokens.issue_authorization_code.assert_called_once_with("client-1", "account-1")


def test_exchange_authorization_code_validates_client_and_returns_token_contract(
    service: tuple[OAuthServerService, MagicMock, MagicMock],
) -> None:
    oauth_server, _provider_apps, tokens = service
    tokens.exchange_authorization_code.return_value = ("access-1", "refresh-1")

    result = oauth_server.exchange_token(
        client_id="client-1",
        grant_type="authorization_code",
        code="code-1",
        client_secret="secret",
        redirect_uri="https://example.com/callback",
        refresh_token=None,
    )

    assert result.access_token == "access-1"
    assert result.refresh_token == "refresh-1"
    assert result.token_type == "Bearer"
    assert result.expires_in == 43200
    tokens.exchange_authorization_code.assert_called_once_with("client-1", "code-1")


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"grant_type": "invalid"}, "invalid grant_type"),
        ({"code": None}, "code is required"),
        ({"client_secret": "invalid"}, "client_secret is invalid"),
        ({"redirect_uri": "https://invalid.example/callback"}, "redirect_uri is invalid"),
    ],
)
def test_exchange_authorization_code_rejects_invalid_requests(
    service: tuple[OAuthServerService, MagicMock, MagicMock],
    overrides: dict[str, str | None],
    message: str,
) -> None:
    oauth_server, _provider_apps, tokens = service
    values = {
        "client_id": "client-1",
        "grant_type": "authorization_code",
        "code": "code-1",
        "client_secret": "secret",
        "redirect_uri": "https://example.com/callback",
        "refresh_token": None,
        **overrides,
    }

    with pytest.raises(OAuthServerRequestError, match=message):
        oauth_server.exchange_token(**values)  # type: ignore[arg-type]

    tokens.exchange_authorization_code.assert_not_called()


def test_refresh_token_grant_delegates_to_repository(
    service: tuple[OAuthServerService, MagicMock, MagicMock],
) -> None:
    oauth_server, _provider_apps, tokens = service
    tokens.refresh_access_token.return_value = ("access-2", "refresh-1")

    result = oauth_server.exchange_token(
        client_id="client-1",
        grant_type="refresh_token",
        code=None,
        client_secret=None,
        redirect_uri=None,
        refresh_token="refresh-1",
    )

    assert result.access_token == "access-2"
    assert result.refresh_token == "refresh-1"
    tokens.refresh_access_token.assert_called_once_with("client-1", "refresh-1")


def test_get_account_returns_active_account_without_requiring_workspace_membership(
    service: tuple[OAuthServerService, MagicMock, MagicMock],
) -> None:
    oauth_server, repository, tokens = service
    tokens.resolve_account_id.return_value = "account-1"
    repository.get_account_by_id.return_value = OAuthProviderAccountRecord(
        id="account-1",
        name="Test User",
        email="test@example.com",
        avatar=None,
        interface_language="en-US",
        timezone="UTC",
        status=OAuthProviderAccountStatus.ACTIVE,
    )

    assert oauth_server.get_account(client_id="client-1", access_token="access-1") == OAuthProviderAccount(
        id="account-1",
        name="Test User",
        email="test@example.com",
        avatar=None,
        interface_language="en-US",
        timezone="UTC",
    )
    tokens.resolve_account_id.assert_called_once_with("client-1", "access-1")
    repository.get_account_by_id.assert_called_once_with("account-1")


def test_get_account_rejects_invalid_token(
    service: tuple[OAuthServerService, MagicMock, MagicMock],
) -> None:
    oauth_server, _provider_apps, tokens = service
    tokens.resolve_account_id.return_value = None

    with pytest.raises(OAuthServerUnauthorizedError, match="access_token or client_id is invalid"):
        oauth_server.get_account(client_id="client-1", access_token="invalid")


def test_get_account_validates_client_before_missing_token(
    service: tuple[OAuthServerService, MagicMock, MagicMock],
) -> None:
    oauth_server, repository, tokens = service
    repository.get_provider_app_by_client_id.return_value = None

    with pytest.raises(OAuthServerClientNotFoundError, match="client_id is invalid"):
        oauth_server.get_account(client_id="missing", access_token=None)

    tokens.resolve_account_id.assert_not_called()


@pytest.mark.parametrize(
    ("status", "message"),
    [
        (OAuthProviderAccountStatus.PENDING, "Account is not active"),
        (OAuthProviderAccountStatus.UNINITIALIZED, "Account is not active"),
        (OAuthProviderAccountStatus.BANNED, "Account is banned"),
        (OAuthProviderAccountStatus.CLOSED, "Account is not active"),
    ],
)
def test_get_account_rejects_inactive_account(
    service: tuple[OAuthServerService, MagicMock, MagicMock],
    status: OAuthProviderAccountStatus,
    message: str,
) -> None:
    oauth_server, repository, tokens = service
    tokens.resolve_account_id.return_value = "account-1"
    repository.get_account_by_id.return_value = OAuthProviderAccountRecord(
        id="account-1",
        name="Test User",
        email="test@example.com",
        avatar=None,
        interface_language=None,
        timezone=None,
        status=status,
    )

    with pytest.raises(OAuthServerUnauthorizedError, match=message):
        oauth_server.get_account(client_id="client-1", access_token="access-1")
