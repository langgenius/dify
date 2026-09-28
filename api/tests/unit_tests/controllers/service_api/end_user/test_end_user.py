from datetime import UTC, datetime
from inspect import unwrap
from uuid import UUID, uuid4

import pytest

from controllers.service_api.end_user import end_user as controller_module
from controllers.service_api.end_user.end_user import EndUserApi
from controllers.service_api.end_user.error import EndUserNotFoundError
from machinery.context import ServiceApiRequestContext
from models.model import App
from services.app_scoped_end_user_query_service import AppScopedEndUserNotFoundError
from services.entities.app_scoped_end_user_entities import AppScopedEndUserRecord


def _request_context(*, tenant_id: str = "workspace-1", app_id: str = "app-1") -> ServiceApiRequestContext:
    return ServiceApiRequestContext(
        tenant_id=tenant_id,
        app_id=app_id,
    )


class EndUserQueryServiceStub:
    def __init__(self, result: AppScopedEndUserRecord | Exception) -> None:
        self._result = result
        self.calls: list[tuple[ServiceApiRequestContext, str]] = []

    def get_by_id(self, context: ServiceApiRequestContext, end_user_id: str) -> AppScopedEndUserRecord:
        self.calls.append((context, end_user_id))
        if isinstance(self._result, Exception):
            raise self._result
        return self._result


class ApplicationServicesStub:
    def __init__(self, end_user_queries: EndUserQueryServiceStub) -> None:
        self.app_scoped_end_users = AppScopedEndUserServicesStub(end_user_queries)


class AppScopedEndUserServicesStub:
    def __init__(self, queries: EndUserQueryServiceStub) -> None:
        self.queries = queries


class TestEndUserApi:
    def test_get_end_user_returns_all_attributes(self, monkeypatch: pytest.MonkeyPatch) -> None:
        end_user = AppScopedEndUserRecord(
            id=str(uuid4()),
            tenant_id=str(uuid4()),
            app_id=str(uuid4()),
            type="service-api",
            external_user_id="external-123",
            name="Alice",
            is_anonymous=True,
            session_id="session-xyz",
            created_at=datetime(2024, 1, 1, tzinfo=UTC),
            updated_at=datetime(2024, 1, 2, tzinfo=UTC),
        )
        context = _request_context(tenant_id=end_user.tenant_id, app_id=end_user.app_id)
        service = EndUserQueryServiceStub(end_user)
        monkeypatch.setattr(
            controller_module,
            "application_services",
            lambda: ApplicationServicesStub(service),
        )

        result = unwrap(EndUserApi.get)(
            EndUserApi(),
            app_model=App(id=context.app_id, tenant_id=context.tenant_id),
            end_user_id=UUID(end_user.id),
        )

        assert service.calls == [(context, end_user.id)]
        assert result == {
            "id": end_user.id,
            "tenant_id": end_user.tenant_id,
            "app_id": end_user.app_id,
            "type": end_user.type,
            "external_user_id": end_user.external_user_id,
            "name": end_user.name,
            "is_anonymous": True,
            "session_id": end_user.session_id,
            "created_at": "2024-01-01T00:00:00Z",
            "updated_at": "2024-01-02T00:00:00Z",
        }

    def test_get_end_user_maps_application_not_found_error(self, monkeypatch: pytest.MonkeyPatch) -> None:
        context = _request_context()
        service = EndUserQueryServiceStub(AppScopedEndUserNotFoundError())
        monkeypatch.setattr(
            controller_module,
            "application_services",
            lambda: ApplicationServicesStub(service),
        )
        end_user_id = uuid4()

        with pytest.raises(EndUserNotFoundError):
            unwrap(EndUserApi.get)(
                EndUserApi(),
                app_model=App(id=context.app_id, tenant_id=context.tenant_id),
                end_user_id=end_user_id,
            )

        assert service.calls == [(context, str(end_user_id))]
