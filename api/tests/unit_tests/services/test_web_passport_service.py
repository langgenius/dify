from datetime import UTC, datetime
from unittest.mock import MagicMock

import pytest

from services.entities.passport_entities import (
    EndUserRecord,
    WebAppRecord,
    WebPassportEndUserResolution,
    WebPassportRequest,
)
from services.web_passport_service import (
    WebAppAuthType,
    WebPassportAuthenticationRequiredError,
    WebPassportNotFoundError,
    WebPassportService,
    WebPassportUnauthorizedError,
)

APP = WebAppRecord(site_id="site-1", app_id="app-1", tenant_id="tenant-1", app_code="app-code")
NOW = datetime(2026, 8, 13, 12, 0, tzinfo=UTC)


def _service(
    *,
    repository: MagicMock | None = None,
    auth: MagicMock | None = None,
    tokens: MagicMock | None = None,
) -> tuple[WebPassportService, MagicMock, MagicMock, MagicMock]:
    if repository is None:
        repository = MagicMock()
        repository.get_active_web_app.return_value = APP
        repository.is_web_app_active.return_value = True
        resolution = WebPassportEndUserResolution(app_active=True, end_user=EndUserRecord(id="end-user-1"))
        repository.resolve_standard_end_user.return_value = resolution
        repository.resolve_authenticated_end_user.return_value = resolution
    if auth is None:
        auth = MagicMock()
        auth.is_webapp_auth_enabled.return_value = False
    if tokens is None:
        tokens = MagicMock()
        tokens.issue.return_value = "issued-token"
    now = MagicMock(return_value=NOW)
    service = WebPassportService(
        passports=repository,
        auth=auth,
        tokens=tokens,
        now=now,
        access_token_expire_minutes=60,
    )
    return service, repository, auth, tokens


def _request(*, user_session_id: str | None = None, access_token: str | None = None) -> WebPassportRequest:
    return WebPassportRequest(app_code="app-code", user_session_id=user_session_id, access_token=access_token)


def test_issue_creates_anonymous_user_and_standard_passport() -> None:
    service, repository, _auth, tokens = _service()

    result = service.issue(_request())

    assert result.access_token == "issued-token"
    repository.resolve_standard_end_user.assert_called_once_with(APP, None)
    tokens.issue.assert_called_once_with(
        {
            "iss": "app-1",
            "sub": "Web API Passport",
            "app_id": "app-1",
            "app_code": "app-code",
            "end_user_id": "end-user-1",
        }
    )


def test_issue_reuses_requested_session_user() -> None:
    service, repository, _auth, _tokens = _service()

    service.issue(_request(user_session_id="existing-session"))

    repository.resolve_standard_end_user.assert_called_once_with(APP, "existing-session")


def test_issue_returns_not_found_for_inactive_app() -> None:
    repository = MagicMock()
    repository.get_active_web_app.return_value = None
    service, _repository, auth, _tokens = _service(repository=repository)

    with pytest.raises(WebPassportNotFoundError):
        service.issue(_request())

    auth.is_webapp_auth_enabled.assert_not_called()


def test_issue_revalidates_app_after_enterprise_io() -> None:
    auth = MagicMock()
    auth.is_webapp_auth_enabled.return_value = True
    auth.get_app_auth_type.return_value = WebAppAuthType.INTERNAL
    tokens = MagicMock()
    tokens.verify.return_value = {
        "token_source": "webapp_login_token",
        "auth_type": "internal",
        "session_id": "session-1",
    }
    service, repository, _auth, _tokens = _service(auth=auth, tokens=tokens)

    def app_is_active(_app: WebAppRecord) -> bool:
        auth.get_app_auth_type.assert_called_once_with(APP.app_id)
        return False

    repository.is_web_app_active.side_effect = app_is_active

    with pytest.raises(WebPassportNotFoundError):
        service.issue(_request(access_token="login-token"))

    repository.resolve_authenticated_end_user.assert_not_called()
    tokens.issue.assert_not_called()


def test_issue_returns_not_found_when_app_becomes_inactive_before_user_creation() -> None:
    service, repository, _auth, tokens = _service()
    repository.resolve_standard_end_user.return_value = WebPassportEndUserResolution(
        app_active=False,
        end_user=None,
    )

    with pytest.raises(WebPassportNotFoundError):
        service.issue(_request())

    tokens.issue.assert_not_called()


def test_issue_requires_login_for_private_webapp() -> None:
    auth = MagicMock()
    auth.is_webapp_auth_enabled.return_value = True
    auth.get_app_auth_type.return_value = WebAppAuthType.INTERNAL
    service, _repository, _auth, _tokens = _service(auth=auth)

    with pytest.raises(WebPassportAuthenticationRequiredError):
        service.issue(_request())


def test_issue_rejects_wrong_login_token_source() -> None:
    auth = MagicMock()
    auth.is_webapp_auth_enabled.return_value = True
    auth.get_app_auth_type.return_value = WebAppAuthType.INTERNAL
    tokens = MagicMock()
    tokens.verify.return_value = {"token_source": "other"}
    service, _repository, _auth, _tokens = _service(auth=auth, tokens=tokens)

    with pytest.raises(WebPassportUnauthorizedError, match="token source"):
        service.issue(_request(access_token="login-token"))


def test_issue_rejects_auth_type_mismatch() -> None:
    auth = MagicMock()
    auth.is_webapp_auth_enabled.return_value = True
    auth.get_app_auth_type.return_value = WebAppAuthType.EXTERNAL
    tokens = MagicMock()
    tokens.verify.return_value = {
        "token_source": "webapp_login_token",
        "auth_type": "internal",
        "session_id": "session-1",
    }
    service, _repository, _auth, _tokens = _service(auth=auth, tokens=tokens)

    with pytest.raises(WebPassportAuthenticationRequiredError, match="external"):
        service.issue(_request(access_token="login-token"))


def test_issue_exchanges_enterprise_token_after_user_resolution() -> None:
    auth = MagicMock()
    auth.is_webapp_auth_enabled.return_value = True
    auth.get_app_auth_type.return_value = WebAppAuthType.INTERNAL
    tokens = MagicMock()
    tokens.verify.return_value = {
        "token_source": "webapp_login_token",
        "user_id": "account-1",
        "end_user_id": "stale-end-user",
        "session_id": "session-1",
        "auth_type": "internal",
        "exp": 2_000_000_000,
    }
    tokens.issue.return_value = "enterprise-token"
    service, repository, _auth, _tokens = _service(auth=auth, tokens=tokens)
    repository.resolve_authenticated_end_user.return_value = WebPassportEndUserResolution(
        app_active=True,
        end_user=EndUserRecord(id="end-user-by-session"),
    )

    result = service.issue(_request(access_token="login-token"))

    assert result.access_token == "enterprise-token"
    repository.resolve_authenticated_end_user.assert_called_once_with(
        APP,
        end_user_id="stale-end-user",
        session_id="session-1",
    )
    tokens.issue.assert_called_once_with(
        {
            "iss": "site-1",
            "sub": "Web API Passport",
            "app_id": "app-1",
            "app_code": "app-code",
            "user_id": "account-1",
            "end_user_id": "end-user-by-session",
            "auth_type": "internal",
            "granted_at": int(NOW.timestamp()),
            "token_source": "webapp",
            "exp": 2_000_000_000,
        }
    )


def test_issue_requires_session_id_when_enterprise_user_is_missing() -> None:
    auth = MagicMock()
    auth.is_webapp_auth_enabled.return_value = True
    auth.get_app_auth_type.return_value = WebAppAuthType.INTERNAL
    tokens = MagicMock()
    tokens.verify.return_value = {"token_source": "webapp_login_token", "auth_type": "internal"}
    service, repository, _auth, _tokens = _service(auth=auth, tokens=tokens)
    repository.resolve_authenticated_end_user.return_value = WebPassportEndUserResolution(
        app_active=True,
        end_user=None,
    )

    with pytest.raises(WebPassportNotFoundError, match="Missing session_id"):
        service.issue(_request(access_token="login-token"))


def test_public_webapp_verifies_optional_login_token_then_uses_standard_flow() -> None:
    auth = MagicMock()
    auth.is_webapp_auth_enabled.return_value = True
    auth.get_app_auth_type.return_value = WebAppAuthType.PUBLIC
    tokens = MagicMock()
    tokens.verify.return_value = {"token_source": "webapp_login_token"}
    tokens.issue.return_value = "public-token"
    service, _repository, _auth, _tokens = _service(auth=auth, tokens=tokens)

    service.issue(_request(access_token="login-token"))

    tokens.verify.assert_called_once_with("login-token")
    assert tokens.issue.call_args.args[0]["iss"] == "app-1"
