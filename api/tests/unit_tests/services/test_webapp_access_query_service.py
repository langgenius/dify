from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from unittest.mock import MagicMock, create_autospec

import pytest

from enums import WebAppAccessMode
from services.webapp_access_query_service import (
    WebAppAccessAppNotFoundError,
    WebAppAccessQuery,
    WebAppAccessQueryService,
    WebAppAccessReferenceRequiredError,
)


def _unexpected_access_modes(*, app_ids: Sequence[str]) -> Mapping[str, WebAppAccessMode]:
    raise AssertionError(f"Unexpected batch access mode query: {app_ids}")


def _unexpected_user_permissions(*, user_id: str, app_ids: Sequence[str]) -> Mapping[str, bool]:
    raise AssertionError(f"Unexpected batch permission query: {user_id}, {app_ids}")


def _service(
    *,
    access: MagicMock,
    enabled: bool = True,
    access_mode: WebAppAccessMode = WebAppAccessMode.PRIVATE,
    allowed: bool = True,
) -> tuple[WebAppAccessQueryService, MagicMock, MagicMock]:
    access_mode_for_app = MagicMock(return_value=access_mode)
    is_user_allowed_for_app = MagicMock(return_value=allowed)
    return (
        WebAppAccessQueryService(
            access=access,
            webapp_auth_enabled=enabled,
            access_mode_for_app=access_mode_for_app,
            is_user_allowed_for_app=is_user_allowed_for_app,
            get_access_modes=_unexpected_access_modes,
            get_user_permissions=_unexpected_user_permissions,
        ),
        access_mode_for_app,
        is_user_allowed_for_app,
    )


def test_disabled_auth_returns_public_before_resolving_app() -> None:
    access: MagicMock = create_autospec(WebAppAccessQuery, instance=True, spec_set=True)
    service, access_mode_for_app, _ = _service(access=access, enabled=False)

    assert service.get_access_mode(app_id=None, app_code=None) is WebAppAccessMode.PUBLIC
    access.find_app_id_by_code.assert_not_called()
    access_mode_for_app.assert_not_called()


def test_enabled_auth_reads_access_mode_by_app_id() -> None:
    access: MagicMock = create_autospec(WebAppAccessQuery, instance=True, spec_set=True)
    service, access_mode_for_app, _ = _service(access=access)

    assert service.get_access_mode(app_id="app-1", app_code=None) is WebAppAccessMode.PRIVATE
    access.find_app_id_by_code.assert_not_called()
    access_mode_for_app.assert_called_once_with("app-1")


def test_app_code_takes_precedence_over_app_id() -> None:
    access: MagicMock = create_autospec(WebAppAccessQuery, instance=True, spec_set=True)
    access.find_app_id_by_code.return_value = "resolved-id"
    service, access_mode_for_app, _ = _service(access=access, access_mode=WebAppAccessMode.SSO_VERIFIED)

    assert service.get_access_mode(app_id="ignored-id", app_code="code-1") is WebAppAccessMode.SSO_VERIFIED
    access.find_app_id_by_code.assert_called_once_with("code-1")
    access_mode_for_app.assert_called_once_with("resolved-id")


def test_missing_app_code_raises_not_found() -> None:
    access: MagicMock = create_autospec(WebAppAccessQuery, instance=True, spec_set=True)
    access.find_app_id_by_code.return_value = None
    service, access_mode_for_app, _ = _service(access=access)

    with pytest.raises(WebAppAccessAppNotFoundError):
        service.get_access_mode(app_id="must-not-fallback", app_code="missing-code")

    access_mode_for_app.assert_not_called()


def test_enabled_auth_requires_app_id_or_code() -> None:
    access: MagicMock = create_autospec(WebAppAccessQuery, instance=True, spec_set=True)
    service, access_mode_for_app, _ = _service(access=access)

    with pytest.raises(WebAppAccessReferenceRequiredError, match="^appId or appCode must be provided$"):
        service.get_access_mode(app_id=None, app_code=None)

    access_mode_for_app.assert_not_called()


def test_repository_failure_is_not_hidden() -> None:
    access: MagicMock = create_autospec(WebAppAccessQuery, instance=True, spec_set=True)
    failure = TypeError("repository bug")
    access.find_app_id_by_code.side_effect = failure
    service, _, _ = _service(access=access)

    with pytest.raises(TypeError) as raised:
        service.get_access_mode(app_id=None, app_code="code-1")

    assert raised.value is failure


def test_access_mode_failure_is_not_hidden() -> None:
    access: MagicMock = create_autospec(WebAppAccessQuery, instance=True, spec_set=True)
    service, access_mode_for_app, _ = _service(access=access)
    failure = TypeError("adapter bug")
    access_mode_for_app.side_effect = failure

    with pytest.raises(TypeError) as raised:
        service.get_access_mode(app_id="app-1", app_code=None)

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
    access: MagicMock = create_autospec(WebAppAccessQuery, instance=True, spec_set=True)
    service, access_mode_for_app, _ = _service(access=access, access_mode=access_mode)

    assert service.requires_permission_check("app-1") is expected
    access_mode_for_app.assert_called_once_with("app-1")


def test_disabled_auth_still_reads_configured_mode_before_passport() -> None:
    access: MagicMock = create_autospec(WebAppAccessQuery, instance=True, spec_set=True)
    service, access_mode_for_app, _ = _service(
        access=access,
        enabled=False,
        access_mode=WebAppAccessMode.PRIVATE,
    )

    assert service.requires_permission_check("app-1") is True
    access_mode_for_app.assert_called_once_with("app-1")


def test_disabled_auth_allows_after_passport_without_querying_user_permission() -> None:
    access: MagicMock = create_autospec(WebAppAccessQuery, instance=True, spec_set=True)
    service, _, is_user_allowed_for_app = _service(access=access, enabled=False, allowed=False)

    assert service.is_user_allowed(user_id="user-1", app_id="app-1") is True
    is_user_allowed_for_app.assert_not_called()


def test_enabled_auth_delegates_user_permission() -> None:
    access: MagicMock = create_autospec(WebAppAccessQuery, instance=True, spec_set=True)
    service, _, is_user_allowed_for_app = _service(access=access, allowed=False)

    assert service.is_user_allowed(user_id="user-1", app_id="app-1") is False
    is_user_allowed_for_app.assert_called_once_with("user-1", "app-1")


@dataclass
class _BatchQueries:
    access_modes: Mapping[str, WebAppAccessMode] = field(default_factory=dict)
    user_permissions: Mapping[str, bool] = field(default_factory=dict)
    mode_requests: list[tuple[str, ...]] = field(default_factory=list)
    permission_requests: list[tuple[str, tuple[str, ...]]] = field(default_factory=list)
    mode_error: Exception | None = None
    permission_error: Exception | None = None

    def get_access_modes(self, *, app_ids: Sequence[str]) -> Mapping[str, WebAppAccessMode]:
        self.mode_requests.append(tuple(app_ids))
        if self.mode_error is not None:
            raise self.mode_error
        return self.access_modes

    def get_user_permissions(self, *, user_id: str, app_ids: Sequence[str]) -> Mapping[str, bool]:
        self.permission_requests.append((user_id, tuple(app_ids)))
        if self.permission_error is not None:
            raise self.permission_error
        return self.user_permissions

    def find_app_id_by_code(self, app_code: str) -> str | None:
        raise AssertionError(f"Batch queries must not resolve app codes: {app_code}")

    def get_access_mode(self, app_id: str) -> WebAppAccessMode:
        raise AssertionError(f"Batch queries must not use single-app lookups: {app_id}")

    def is_user_allowed(self, user_id: str, app_id: str) -> bool:
        raise AssertionError(f"Batch queries must not use single-app permissions: {user_id}, {app_id}")


def _batch_service(queries: _BatchQueries, *, enabled: bool = True) -> WebAppAccessQueryService:
    return WebAppAccessQueryService(
        access=queries,
        webapp_auth_enabled=enabled,
        access_mode_for_app=queries.get_access_mode,
        is_user_allowed_for_app=queries.is_user_allowed,
        get_access_modes=queries.get_access_modes,
        get_user_permissions=queries.get_user_permissions,
    )


@pytest.mark.parametrize(
    ("enabled", "app_ids"),
    [
        pytest.param(False, ("app-b", "app-a", "app-b"), id="disabled-auth"),
        pytest.param(False, (), id="disabled-empty"),
        pytest.param(True, (), id="enabled-empty"),
    ],
)
def test_disabled_or_empty_batch_queries_return_public_access_without_external_calls(
    enabled: bool, app_ids: tuple[str, ...]
) -> None:
    queries = _BatchQueries(
        mode_error=AssertionError("Must not query modes"),
        permission_error=AssertionError("Must not query permissions"),
    )
    service = _batch_service(queries, enabled=enabled)

    assert service.batch_get_access_modes(app_ids=app_ids) == dict.fromkeys(app_ids, WebAppAccessMode.PUBLIC)
    assert service.batch_get_user_permissions(user_id="viewer", app_ids=app_ids) == dict.fromkeys(app_ids, True)
    assert queries.mode_requests == []
    assert queries.permission_requests == []


def test_enabled_batch_queries_preserve_order_duplicates_missing_results_and_sso_mode() -> None:
    app_ids = ("private", "sso", "public", "private", "missing")
    queries = _BatchQueries(
        access_modes={
            "private": WebAppAccessMode.PRIVATE,
            "sso": WebAppAccessMode.SSO_VERIFIED,
            "public": WebAppAccessMode.PUBLIC,
        },
        user_permissions={"private": False, "sso": True, "public": True},
    )
    service = _batch_service(queries)

    modes = service.batch_get_access_modes(app_ids=app_ids)
    permissions = service.batch_get_user_permissions(user_id="viewer", app_ids=app_ids)

    assert modes == queries.access_modes
    assert modes["sso"] is WebAppAccessMode.SSO_VERIFIED
    assert "missing" not in modes
    assert permissions == queries.user_permissions
    assert "missing" not in permissions
    assert queries.mode_requests == [app_ids]
    assert queries.permission_requests == [("viewer", app_ids)]


@pytest.mark.parametrize("failure_stage", ["modes", "permissions"])
@pytest.mark.parametrize("failure", [ConnectionError("batch unavailable"), ValueError("invalid batch response")])
def test_batch_callback_errors_propagate_without_wrapping(failure_stage: str, failure: Exception) -> None:
    queries = _BatchQueries(mode_error=failure, permission_error=failure)
    service = _batch_service(queries)

    if failure_stage == "modes":
        with pytest.raises(type(failure)) as raised:
            service.batch_get_access_modes(app_ids=("app-1",))
        assert queries.mode_requests == [("app-1",)]
        assert queries.permission_requests == []
    else:
        with pytest.raises(type(failure)) as raised:
            service.batch_get_user_permissions(user_id="viewer", app_ids=("app-1",))
        assert queries.mode_requests == []
        assert queries.permission_requests == [("viewer", ("app-1",))]
    assert raised.value is failure
