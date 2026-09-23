from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field

import pytest

from enums import WebAppAccessMode
from services.installed_app_access_service import (
    InstalledAppAccessDeniedError,
    InstalledAppAccessService,
    InstalledAppNotFoundError,
    InstalledAppRef,
)

_REF = InstalledAppRef(id="installation-1", app_id="app-1", tenant_id="workspace-1", app_mode="completion")


class _Store:
    def __init__(
        self,
        *,
        result: InstalledAppRef | None,
        events: list[tuple[str, ...]],
        error: Exception | None = None,
    ) -> None:
        self._result = result
        self._events = events
        self._error = error

    def resolve(self, *, installed_app_id: str, tenant_id: str) -> InstalledAppRef | None:
        self._events.append(("resolve", installed_app_id, tenant_id))
        if self._error is not None:
            raise self._error
        return self._result


def _unexpected_access_modes(*, app_ids: Sequence[str]) -> Mapping[str, WebAppAccessMode]:
    pytest.fail(f"Unexpected batch access-mode query: {app_ids=}")


def _unexpected_user_permissions(*, user_id: str, app_ids: Sequence[str]) -> Mapping[str, bool]:
    pytest.fail(f"Unexpected batch permission query: {user_id=}, {app_ids=}")


def _unexpected_single_permission(*, user_id: str, app_id: str) -> bool:
    pytest.fail(f"Visibility must use batch permission checks: {user_id=}, {app_id=}")


@dataclass
class _BatchAccess:
    modes: Mapping[str, WebAppAccessMode] = field(default_factory=dict)
    permissions: Mapping[str, bool] = field(default_factory=dict)
    events: list[tuple[str, ...]] = field(default_factory=list)
    modes_error: Exception | None = None
    permissions_error: Exception | None = None

    def get_access_modes(self, *, app_ids: Sequence[str]) -> Mapping[str, WebAppAccessMode]:
        self.events.append(("modes", *app_ids))
        if self.modes_error is not None:
            raise self.modes_error
        return self.modes

    def get_user_permissions(self, *, user_id: str, app_ids: Sequence[str]) -> Mapping[str, bool]:
        self.events.append(("permissions", user_id, *app_ids))
        if self.permissions_error is not None:
            raise self.permissions_error
        return self.permissions


@pytest.mark.parametrize("allowed", [True, False])
def test_access_resolves_workspace_installation_before_checking_target_app(allowed: bool) -> None:
    events: list[tuple[str, ...]] = []

    def is_user_allowed(*, user_id: str, app_id: str) -> bool:
        events.append(("authorize", user_id, app_id))
        return allowed

    service = InstalledAppAccessService(
        installed_apps=_Store(result=_REF, events=events),
        is_user_allowed=is_user_allowed,
        get_access_modes=_unexpected_access_modes,
        get_user_permissions=_unexpected_user_permissions,
    )

    if allowed:
        assert service.get_access(installed_app_id=_REF.id, tenant_id=_REF.tenant_id, account_id="account-1") is _REF
    else:
        with pytest.raises(InstalledAppAccessDeniedError):
            service.get_access(installed_app_id=_REF.id, tenant_id=_REF.tenant_id, account_id="account-1")

    assert events == [("resolve", _REF.id, _REF.tenant_id), ("authorize", "account-1", _REF.app_id)]


def test_missing_installation_does_not_check_permission() -> None:
    events: list[tuple[str, ...]] = []

    def unexpected_permission_check(*, user_id: str, app_id: str) -> bool:
        pytest.fail(f"Missing installation reached the permission provider: {user_id=}, {app_id=}")

    service = InstalledAppAccessService(
        installed_apps=_Store(result=None, events=events),
        is_user_allowed=unexpected_permission_check,
        get_access_modes=_unexpected_access_modes,
        get_user_permissions=_unexpected_user_permissions,
    )

    with pytest.raises(InstalledAppNotFoundError, match="^Installed app not found$"):
        service.get_access(installed_app_id="missing", tenant_id=_REF.tenant_id, account_id="account-1")

    assert events == [("resolve", "missing", _REF.tenant_id)]


@pytest.mark.parametrize("failure_source", ["store", "permission"])
def test_dependency_errors_propagate_unchanged(failure_source: str) -> None:
    events: list[tuple[str, ...]] = []
    failure = RuntimeError("dependency unavailable")

    def is_user_allowed(*, user_id: str, app_id: str) -> bool:
        events.append(("authorize", user_id, app_id))
        raise failure

    service = InstalledAppAccessService(
        installed_apps=_Store(result=_REF, events=events, error=failure if failure_source == "store" else None),
        is_user_allowed=is_user_allowed,
        get_access_modes=_unexpected_access_modes,
        get_user_permissions=_unexpected_user_permissions,
    )

    with pytest.raises(RuntimeError) as raised:
        service.get_access(installed_app_id=_REF.id, tenant_id=_REF.tenant_id, account_id="account-1")

    assert raised.value is failure
    assert len(events) == (1 if failure_source == "store" else 2)


def test_visibility_skips_external_queries_when_empty() -> None:
    events: list[tuple[str, ...]] = []
    service = InstalledAppAccessService(
        installed_apps=_Store(result=_REF, events=events, error=AssertionError("Visibility must not resolve an app")),
        is_user_allowed=_unexpected_single_permission,
        get_access_modes=_unexpected_access_modes,
        get_user_permissions=_unexpected_user_permissions,
    )

    visible = service.get_visible_app_ids(user_id="account-1", app_ids=[])

    assert visible == frozenset()
    assert isinstance(visible, frozenset)
    assert events == []


def test_visibility_filters_modes_then_permissions_preserving_batch_order_and_duplicates() -> None:
    app_ids = ["public", "sso", "missing", "private", "private-all", "public", "also-public", "denied", "no-permission"]
    batches = _BatchAccess(
        modes={
            "public": WebAppAccessMode.PUBLIC,
            "sso": WebAppAccessMode.SSO_VERIFIED,
            "private": WebAppAccessMode.PRIVATE,
            "private-all": WebAppAccessMode.PRIVATE_ALL,
            "also-public": WebAppAccessMode.PUBLIC,
            "denied": WebAppAccessMode.PRIVATE,
            "no-permission": WebAppAccessMode.PUBLIC,
        },
        permissions={
            "public": True,
            "private": True,
            "private-all": True,
            "also-public": True,
            "denied": False,
            "sso": True,
            "missing": True,
            "not-requested": True,
        },
    )
    events: list[tuple[str, ...]] = []
    service = InstalledAppAccessService(
        installed_apps=_Store(result=_REF, events=events, error=AssertionError("Visibility must not resolve an app")),
        is_user_allowed=_unexpected_single_permission,
        get_access_modes=batches.get_access_modes,
        get_user_permissions=batches.get_user_permissions,
    )

    visible = service.get_visible_app_ids(user_id="account-1", app_ids=app_ids)

    assert visible == frozenset({"public", "private", "private-all", "also-public"})
    assert isinstance(visible, frozenset)
    assert batches.events == [
        ("modes", *app_ids),
        (
            "permissions",
            "account-1",
            "public",
            "private",
            "private-all",
            "public",
            "also-public",
            "denied",
            "no-permission",
        ),
    ]
    assert events == []


@pytest.mark.parametrize("app_ids", [["missing"], ["sso", "missing", "sso"]])
def test_visibility_skips_permission_query_when_no_mode_is_eligible(app_ids: list[str]) -> None:
    batches = _BatchAccess(
        modes={"sso": WebAppAccessMode.SSO_VERIFIED},
        permissions_error=AssertionError("Empty candidates must not reach the permission provider"),
    )
    service = InstalledAppAccessService(
        installed_apps=_Store(result=_REF, events=[], error=AssertionError("Visibility must not resolve an app")),
        is_user_allowed=_unexpected_single_permission,
        get_access_modes=batches.get_access_modes,
        get_user_permissions=batches.get_user_permissions,
    )

    assert service.get_visible_app_ids(user_id="account-1", app_ids=app_ids) == frozenset()
    assert batches.events == [("modes", *app_ids)]


@pytest.mark.parametrize("failure_source", ["modes", "permissions"])
def test_visibility_preserves_dependency_exception_and_query_order(failure_source: str) -> None:
    failure = RuntimeError("Enterprise request failed")
    batches = _BatchAccess(modes={"app-1": WebAppAccessMode.PUBLIC})
    if failure_source == "modes":
        batches.modes_error = failure
    else:
        batches.permissions_error = failure
    service = InstalledAppAccessService(
        installed_apps=_Store(result=_REF, events=[], error=AssertionError("Visibility must not resolve an app")),
        is_user_allowed=_unexpected_single_permission,
        get_access_modes=batches.get_access_modes,
        get_user_permissions=batches.get_user_permissions,
    )

    with pytest.raises(RuntimeError) as raised:
        service.get_visible_app_ids(user_id="account-1", app_ids=["app-1"])

    assert raised.value is failure
    assert batches.events == (
        [("modes", "app-1")]
        if failure_source == "modes"
        else [("modes", "app-1"), ("permissions", "account-1", "app-1")]
    )


def test_single_app_admission_does_not_apply_list_sso_filter() -> None:
    events: list[tuple[str, ...]] = []
    batches = _BatchAccess(modes={_REF.app_id: WebAppAccessMode.SSO_VERIFIED}, permissions={_REF.app_id: False})

    def allowed(*, user_id: str, app_id: str) -> bool:
        events.append(("authorize", user_id, app_id))
        return True

    service = InstalledAppAccessService(
        installed_apps=_Store(result=_REF, events=events),
        is_user_allowed=allowed,
        get_access_modes=batches.get_access_modes,
        get_user_permissions=batches.get_user_permissions,
    )

    admitted = service.get_access(installed_app_id=_REF.id, tenant_id=_REF.tenant_id, account_id="account-1")

    assert admitted is _REF
    assert batches.events == []
    assert events == [("resolve", _REF.id, _REF.tenant_id), ("authorize", "account-1", _REF.app_id)]
