from datetime import datetime

import pytest

from machinery.context import ServiceApiRequestContext
from services.app_scoped_end_user_query_service import AppScopedEndUserNotFoundError, AppScopedEndUserQueryService
from services.entities.app_scoped_end_user_entities import AppScopedEndUserRecord


def _context() -> ServiceApiRequestContext:
    return ServiceApiRequestContext(
        tenant_id="workspace-1",
        app_id="app-1",
    )


def _record() -> AppScopedEndUserRecord:
    timestamp = datetime(2026, 1, 1)
    return AppScopedEndUserRecord(
        id="end-user-1",
        tenant_id="workspace-1",
        app_id="app-1",
        type="service-api",
        external_user_id="external-1",
        name="Alice",
        is_anonymous=False,
        session_id="session-1",
        created_at=timestamp,
        updated_at=timestamp,
    )


class RecordingEndUserQuery:
    def __init__(self, result: AppScopedEndUserRecord | None) -> None:
        self._result = result
        self.calls: list[tuple[str, str, str]] = []

    def find_by_id(self, *, tenant_id: str, app_id: str, end_user_id: str) -> AppScopedEndUserRecord | None:
        self.calls.append((tenant_id, app_id, end_user_id))
        return self._result


def test_get_scopes_query_to_admitted_workspace_and_app() -> None:
    record = _record()
    query = RecordingEndUserQuery(record)
    service = AppScopedEndUserQueryService(end_users=query)

    result = service.get_by_id(_context(), "end-user-1")

    assert result == record
    assert query.calls == [("workspace-1", "app-1", "end-user-1")]


def test_get_raises_framework_neutral_not_found_error() -> None:
    query = RecordingEndUserQuery(None)
    service = AppScopedEndUserQueryService(end_users=query)

    with pytest.raises(AppScopedEndUserNotFoundError):
        service.get_by_id(_context(), "missing")

    assert query.calls == [("workspace-1", "app-1", "missing")]
