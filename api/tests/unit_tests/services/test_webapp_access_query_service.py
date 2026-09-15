from dataclasses import dataclass, field

import pytest

from enums import WebAppAccessMode
from services.webapp_access_query_service import (
    WebAppAccessAppNotFoundError,
    WebAppAccessQueryService,
    WebAppAccessReferenceRequiredError,
)


@dataclass
class AccessQueryStub:
    app_id: str | None = None
    error: Exception | None = None
    calls: list[str] = field(default_factory=list)

    def find_app_id_by_code(self, app_code: str) -> str | None:
        self.calls.append(app_code)
        if self.error is not None:
            raise self.error
        return self.app_id


@dataclass
class AccessPolicyStub:
    access_mode: WebAppAccessMode = WebAppAccessMode.PRIVATE
    allowed: bool = True
    access_mode_error: Exception | None = None
    access_mode_calls: list[str] = field(default_factory=list)
    permission_calls: list[tuple[str, str]] = field(default_factory=list)

    def get_access_mode(self, app_id: str) -> WebAppAccessMode:
        self.access_mode_calls.append(app_id)
        if self.access_mode_error is not None:
            raise self.access_mode_error
        return self.access_mode

    def is_user_allowed(self, *, user_id: str, app_id: str) -> bool:
        self.permission_calls.append((user_id, app_id))
        return self.allowed


@dataclass(frozen=True, slots=True)
class ServiceFixture:
    service: WebAppAccessQueryService
    access: AccessQueryStub
    policy: AccessPolicyStub


def _service(
    *,
    access: AccessQueryStub | None = None,
    enabled: bool = True,
    access_mode: WebAppAccessMode = WebAppAccessMode.PRIVATE,
    allowed: bool = True,
) -> ServiceFixture:
    access = access or AccessQueryStub()
    policy = AccessPolicyStub(access_mode=access_mode, allowed=allowed)
    return ServiceFixture(
        service=WebAppAccessQueryService(
            access=access,
            policy=policy,
            webapp_auth_enabled=enabled,
        ),
        access=access,
        policy=policy,
    )


def test_disabled_auth_returns_public_before_resolving_app() -> None:
    fixture = _service(enabled=False)

    assert fixture.service.get_access_mode(app_id=None, app_code=None) is WebAppAccessMode.PUBLIC
    assert fixture.access.calls == []
    assert fixture.policy.access_mode_calls == []


def test_enabled_auth_reads_access_mode_by_app_id() -> None:
    fixture = _service()

    assert fixture.service.get_access_mode(app_id="app-1", app_code=None) is WebAppAccessMode.PRIVATE
    assert fixture.access.calls == []
    assert fixture.policy.access_mode_calls == ["app-1"]


def test_app_code_takes_precedence_over_app_id() -> None:
    fixture = _service(
        access=AccessQueryStub(app_id="resolved-id"),
        access_mode=WebAppAccessMode.SSO_VERIFIED,
    )

    assert fixture.service.get_access_mode(app_id="ignored-id", app_code="code-1") is WebAppAccessMode.SSO_VERIFIED
    assert fixture.access.calls == ["code-1"]
    assert fixture.policy.access_mode_calls == ["resolved-id"]


def test_missing_app_code_raises_not_found() -> None:
    fixture = _service()

    with pytest.raises(WebAppAccessAppNotFoundError):
        fixture.service.get_access_mode(app_id="must-not-fallback", app_code="missing-code")

    assert fixture.policy.access_mode_calls == []


def test_enabled_auth_requires_app_id_or_code() -> None:
    fixture = _service()

    with pytest.raises(WebAppAccessReferenceRequiredError, match="^appId or appCode must be provided$"):
        fixture.service.get_access_mode(app_id=None, app_code=None)

    assert fixture.policy.access_mode_calls == []


def test_repository_failure_is_not_hidden() -> None:
    failure = TypeError("repository bug")
    fixture = _service(access=AccessQueryStub(error=failure))

    with pytest.raises(TypeError) as raised:
        fixture.service.get_access_mode(app_id=None, app_code="code-1")

    assert raised.value is failure


def test_access_mode_failure_is_not_hidden() -> None:
    fixture = _service()
    failure = TypeError("adapter bug")
    fixture.policy.access_mode_error = failure

    with pytest.raises(TypeError) as raised:
        fixture.service.get_access_mode(app_id="app-1", app_code=None)

    assert raised.value is failure


@pytest.mark.parametrize(
    ("access_mode", "expected"),
    [
        pytest.param(WebAppAccessMode.PUBLIC, False, id="public"),
        pytest.param(WebAppAccessMode.SSO_VERIFIED, False, id="sso-verified"),
        pytest.param(WebAppAccessMode.PRIVATE, True, id="private"),
        pytest.param(WebAppAccessMode.PRIVATE_ALL, True, id="private-all"),
    ],
)
def test_requires_permission_check_for_private_modes(access_mode: WebAppAccessMode, expected: bool) -> None:
    fixture = _service(access_mode=access_mode)

    assert fixture.service.requires_permission_check("app-1") is expected
    assert fixture.policy.access_mode_calls == ["app-1"]


def test_disabled_auth_still_reads_configured_mode_before_passport() -> None:
    fixture = _service(enabled=False, access_mode=WebAppAccessMode.PRIVATE)

    assert fixture.service.requires_permission_check("app-1") is True
    assert fixture.policy.access_mode_calls == ["app-1"]


def test_disabled_auth_allows_after_passport_without_querying_user_permission() -> None:
    fixture = _service(enabled=False, allowed=False)

    assert fixture.service.is_user_allowed(user_id="user-1", app_id="app-1") is True
    assert fixture.policy.permission_calls == []


def test_enabled_auth_delegates_user_permission() -> None:
    fixture = _service(allowed=False)

    assert fixture.service.is_user_allowed(user_id="user-1", app_id="app-1") is False
    assert fixture.policy.permission_calls == [("user-1", "app-1")]
