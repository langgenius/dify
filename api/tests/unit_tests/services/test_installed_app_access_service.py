import pytest

from services.installed_app_access_service import (
    InstalledAppAccessDeniedError,
    InstalledAppAccessService,
    InstalledAppNotFoundError,
    InstalledAppRef,
)

_REF = InstalledAppRef(id="installation-1", app_id="app-1", tenant_id="workspace-1")


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


@pytest.mark.parametrize("allowed", [True, False])
def test_access_resolves_workspace_installation_before_checking_target_app(allowed: bool) -> None:
    events: list[tuple[str, ...]] = []

    def is_user_allowed(*, user_id: str, app_id: str) -> bool:
        events.append(("authorize", user_id, app_id))
        return allowed

    service = InstalledAppAccessService(
        installed_apps=_Store(result=_REF, events=events),
        is_user_allowed=is_user_allowed,
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
    )

    with pytest.raises(RuntimeError) as raised:
        service.get_access(installed_app_id=_REF.id, tenant_id=_REF.tenant_id, account_id="account-1")

    assert raised.value is failure
    assert len(events) == (1 if failure_source == "store" else 2)
