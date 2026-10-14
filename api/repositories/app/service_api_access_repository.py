"""Bounded Service API app and owner reads returning scalar admission data."""

from typing import override

from sqlalchemy import String, cast, select
from sqlalchemy.orm import Session, sessionmaker

from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.model import App
from services.app.service_api_access_service import ServiceApiAppAccess, ServiceApiAppAccessStore


class ServiceApiAppAccessRepository(ServiceApiAppAccessStore):
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @override
    def get_access(self, *, app_id: str, tenant_id: str | None) -> ServiceApiAppAccess | None:
        with self._session_factory() as session:
            # Read status verbatim so abnormal persisted values reach the admission policy.
            statement = select(
                App.id, App.tenant_id, cast(App.status, String), App.enable_api, Tenant.status
            ).outerjoin(Tenant, Tenant.id == App.tenant_id)
            statement = statement.where(App.id == app_id)
            if tenant_id is not None:
                statement = statement.where(App.tenant_id == tenant_id)
            app = session.execute(statement).one_or_none()
            if app is None:
                return None
            admitted_app_id, admitted_tenant_id, app_status, enable_api, workspace_status = app
            owner_id = session.execute(
                select(Account.id)
                .join(TenantAccountJoin, TenantAccountJoin.account_id == Account.id)
                .where(
                    TenantAccountJoin.tenant_id == admitted_tenant_id, TenantAccountJoin.role == TenantAccountRole.OWNER
                )
            ).scalar_one_or_none()
            return ServiceApiAppAccess(
                app_id=admitted_app_id,
                tenant_id=admitted_tenant_id,
                app_status=app_status,
                enable_api=enable_api,
                workspace_status=workspace_status,
                account_id=owner_id,
            )
