from collections.abc import Mapping
from datetime import UTC, datetime

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
    WebPassportAuthGateway,
    WebPassportNotFoundError,
    WebPassportRepository,
    WebPassportService,
    WebPassportTokenGateway,
    WebPassportUnauthorizedError,
)

APP = WebAppRecord(site_id="site-1", app_id="app-1", tenant_id="tenant-1", app_code="app-code")
NOW = datetime(2026, 8, 13, 12, 0, tzinfo=UTC)


class PassportRepository(WebPassportRepository):
    def __init__(self) -> None:
        self.app: WebAppRecord | None = APP
        self.active = True
        self.resolution = WebPassportEndUserResolution(app_active=True, end_user=EndUserRecord(id="end-user-1"))
        self.standard_calls: list[tuple[WebAppRecord, str | None]] = []
        self.authenticated_calls: list[tuple[WebAppRecord, str | None, str | None]] = []
        self.events: list[str] = []

    def get_active_web_app(self, app_code: str) -> WebAppRecord | None:
        assert app_code == "app-code"
        return self.app

    def is_web_app_active(self, app: WebAppRecord) -> bool:
        assert app == APP
        self.events.append("active")
        return self.active

    def resolve_standard_end_user(self, app: WebAppRecord, session_id: str | None) -> WebPassportEndUserResolution:
        self.standard_calls.append((app, session_id))
        return self.resolution

    def resolve_authenticated_end_user(
        self, app: WebAppRecord, *, end_user_id: str | None, session_id: str | None
    ) -> WebPassportEndUserResolution:
        self.authenticated_calls.append((app, end_user_id, session_id))
        return self.resolution


class PassportAuth(WebPassportAuthGateway):
    def __init__(self) -> None:
        self.enabled = False
        self.auth_type = WebAppAuthType.INTERNAL
        self.enabled_calls = 0
        self.auth_type_calls: list[str] = []
        self.events: list[str] = []

    def is_webapp_auth_enabled(self) -> bool:
        self.enabled_calls += 1
        return self.enabled

    def get_app_auth_type(self, app_id: str) -> WebAppAuthType:
        self.auth_type_calls.append(app_id)
        self.events.append("auth_type")
        return self.auth_type


class PassportTokens(WebPassportTokenGateway):
    def __init__(self) -> None:
        self.claims: dict[str, object] = {}
        self.token = "issued-token"
        self.verify_calls: list[str] = []
        self.issue_calls: list[dict[str, object]] = []

    def verify(self, token: str) -> Mapping[str, object]:
        self.verify_calls.append(token)
        return self.claims

    def issue(self, payload: Mapping[str, object]) -> str:
        self.issue_calls.append(dict(payload))
        return self.token


def _service(
    *,
    repository: PassportRepository | None = None,
    auth: PassportAuth | None = None,
    tokens: PassportTokens | None = None,
) -> tuple[WebPassportService, PassportRepository, PassportAuth, PassportTokens]:
    if repository is None:
        repository = PassportRepository()
    if auth is None:
        auth = PassportAuth()
    if tokens is None:
        tokens = PassportTokens()
    service = WebPassportService(
        passports=repository,
        auth=auth,
        tokens=tokens,
        now=lambda: NOW,
        access_token_expire_minutes=60,
    )
    return service, repository, auth, tokens


def _request(*, user_session_id: str | None = None, access_token: str | None = None) -> WebPassportRequest:
    return WebPassportRequest(app_code="app-code", user_session_id=user_session_id, access_token=access_token)


def test_issue_creates_anonymous_user_and_standard_passport() -> None:
    service, repository, _auth, tokens = _service()

    result = service.issue(_request())

    assert result.access_token == "issued-token"
    assert repository.standard_calls == [(APP, None)]
    assert tokens.issue_calls == [
        {
            "iss": "app-1",
            "sub": "Web API Passport",
            "app_id": "app-1",
            "app_code": "app-code",
            "end_user_id": "end-user-1",
        }
    ]


def test_issue_reuses_requested_session_user() -> None:
    service, repository, _auth, _tokens = _service()

    service.issue(_request(user_session_id="existing-session"))

    assert repository.standard_calls == [(APP, "existing-session")]


def test_issue_returns_not_found_for_inactive_app() -> None:
    repository = PassportRepository()
    repository.app = None
    service, _repository, auth, _tokens = _service(repository=repository)

    with pytest.raises(WebPassportNotFoundError):
        service.issue(_request())

    assert auth.enabled_calls == 0


def test_issue_revalidates_app_after_enterprise_io() -> None:
    auth = PassportAuth()
    auth.enabled = True
    auth.auth_type = WebAppAuthType.INTERNAL
    tokens = PassportTokens()
    tokens.claims = {
        "token_source": "webapp_login_token",
        "auth_type": "internal",
        "session_id": "session-1",
    }
    service, repository, _auth, _tokens = _service(auth=auth, tokens=tokens)

    repository.active = False
    repository.events = auth.events

    with pytest.raises(WebPassportNotFoundError):
        service.issue(_request(access_token="login-token"))

    assert auth.auth_type_calls == [APP.app_id]
    assert auth.events == ["auth_type", "active"]
    assert repository.authenticated_calls == []
    assert tokens.issue_calls == []


def test_issue_returns_not_found_when_app_becomes_inactive_before_user_creation() -> None:
    service, repository, _auth, tokens = _service()
    repository.resolution = WebPassportEndUserResolution(
        app_active=False,
        end_user=None,
    )

    with pytest.raises(WebPassportNotFoundError):
        service.issue(_request())

    assert tokens.issue_calls == []


def test_issue_requires_login_for_private_webapp() -> None:
    auth = PassportAuth()
    auth.enabled = True
    auth.auth_type = WebAppAuthType.INTERNAL
    service, _repository, _auth, _tokens = _service(auth=auth)

    with pytest.raises(WebPassportAuthenticationRequiredError):
        service.issue(_request())


def test_issue_rejects_wrong_login_token_source() -> None:
    auth = PassportAuth()
    auth.enabled = True
    auth.auth_type = WebAppAuthType.INTERNAL
    tokens = PassportTokens()
    tokens.claims = {"token_source": "other"}
    service, _repository, _auth, _tokens = _service(auth=auth, tokens=tokens)

    with pytest.raises(WebPassportUnauthorizedError, match="token source"):
        service.issue(_request(access_token="login-token"))


def test_issue_rejects_auth_type_mismatch() -> None:
    auth = PassportAuth()
    auth.enabled = True
    auth.auth_type = WebAppAuthType.EXTERNAL
    tokens = PassportTokens()
    tokens.claims = {
        "token_source": "webapp_login_token",
        "auth_type": "internal",
        "session_id": "session-1",
    }
    service, _repository, _auth, _tokens = _service(auth=auth, tokens=tokens)

    with pytest.raises(WebPassportAuthenticationRequiredError, match="external"):
        service.issue(_request(access_token="login-token"))


def test_issue_exchanges_enterprise_token_after_user_resolution() -> None:
    auth = PassportAuth()
    auth.enabled = True
    auth.auth_type = WebAppAuthType.INTERNAL
    tokens = PassportTokens()
    tokens.claims = {
        "token_source": "webapp_login_token",
        "user_id": "account-1",
        "end_user_id": "stale-end-user",
        "session_id": "session-1",
        "auth_type": "internal",
        "exp": 2_000_000_000,
    }
    tokens.token = "enterprise-token"
    service, repository, _auth, _tokens = _service(auth=auth, tokens=tokens)
    repository.resolution = WebPassportEndUserResolution(
        app_active=True,
        end_user=EndUserRecord(id="end-user-by-session"),
    )

    result = service.issue(_request(access_token="login-token"))

    assert result.access_token == "enterprise-token"
    assert repository.authenticated_calls == [(APP, "stale-end-user", "session-1")]
    assert tokens.issue_calls == [
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
    ]


def test_issue_requires_session_id_when_enterprise_user_is_missing() -> None:
    auth = PassportAuth()
    auth.enabled = True
    auth.auth_type = WebAppAuthType.INTERNAL
    tokens = PassportTokens()
    tokens.claims = {"token_source": "webapp_login_token", "auth_type": "internal"}
    service, repository, _auth, _tokens = _service(auth=auth, tokens=tokens)
    repository.resolution = WebPassportEndUserResolution(
        app_active=True,
        end_user=None,
    )

    with pytest.raises(WebPassportNotFoundError, match="Missing session_id"):
        service.issue(_request(access_token="login-token"))


def test_public_webapp_verifies_optional_login_token_then_uses_standard_flow() -> None:
    auth = PassportAuth()
    auth.enabled = True
    auth.auth_type = WebAppAuthType.PUBLIC
    tokens = PassportTokens()
    tokens.claims = {"token_source": "webapp_login_token"}
    tokens.token = "public-token"
    service, _repository, _auth, _tokens = _service(auth=auth, tokens=tokens)

    service.issue(_request(access_token="login-token"))

    assert tokens.verify_calls == ["login-token"]
    assert tokens.issue_calls[0]["iss"] == "app-1"
