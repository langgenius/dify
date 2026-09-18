from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from sqlalchemy import Engine
from sqlalchemy.orm import Session

from core.ops.base_trace_instance import BaseTraceInstance
from core.ops.entities.config_entity import BaseTracingConfig
from core.ops.entities.trace_entity import BaseTraceInfo
from models import Account, App, Tenant, TenantAccountJoin
from models.account import TenantAccountRole
from models.model import AppMode

TABLES = (App, Account, Tenant, TenantAccountJoin)


class ConcreteTraceInstance(BaseTraceInstance):
    def __init__(self, trace_config: BaseTracingConfig):
        super().__init__(trace_config)

    def trace(self, trace_info: BaseTraceInfo):
        super().trace(trace_info)


@pytest.fixture(autouse=True)
def _bind_production_sessions(monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine) -> None:
    """Bind both service-owned ORM sessions to the test's SQLite engine."""
    database = SimpleNamespace(engine=sqlite_engine)
    monkeypatch.setattr("core.ops.base_trace_instance.db", database)
    monkeypatch.setattr("models.account.db", database)


def _persist_app(session: Session, *, created_by: str | None) -> App:
    app = App(
        id="some_app_id",
        tenant_id="tenant_id",
        name="Trace App",
        description="",
        mode=AppMode.CHAT,
        icon_type=None,
        icon=None,
        icon_background=None,
        app_model_config_id=None,
        workflow_id=None,
        enable_site=True,
        enable_api=True,
        max_active_requests=None,
        created_by=created_by,
    )
    session.add(app)
    session.commit()
    return app


def _persist_account(session: Session) -> Account:
    account = Account(name="Creator", email="creator@example.com")
    account.id = "creator_id"
    session.add(account)
    session.commit()
    return account


def _trace_instance() -> ConcreteTraceInstance:
    # Tracing configuration is a domain collaborator, not an ORM session.
    return ConcreteTraceInstance(MagicMock(spec=BaseTracingConfig))


@pytest.mark.parametrize("sqlite_session", [TABLES], indirect=True)
def test_get_service_account_with_tenant_app_not_found(sqlite_session: Session):
    with pytest.raises(ValueError, match="App with id some_app_id not found"):
        _trace_instance().get_service_account_with_tenant("some_app_id")


@pytest.mark.parametrize("sqlite_session", [TABLES], indirect=True)
def test_get_service_account_with_tenant_no_creator(sqlite_session: Session):
    _persist_app(sqlite_session, created_by=None)

    with pytest.raises(ValueError, match="App with id some_app_id has no creator"):
        _trace_instance().get_service_account_with_tenant("some_app_id")


@pytest.mark.parametrize("sqlite_session", [TABLES], indirect=True)
def test_get_service_account_with_tenant_creator_not_found(sqlite_session: Session):
    _persist_app(sqlite_session, created_by="creator_id")

    with pytest.raises(ValueError, match="Creator account with id creator_id not found for app some_app_id"):
        _trace_instance().get_service_account_with_tenant("some_app_id")


@pytest.mark.parametrize("sqlite_session", [TABLES], indirect=True)
def test_get_service_account_with_tenant_tenant_not_found(sqlite_session: Session):
    _persist_app(sqlite_session, created_by="creator_id")
    _persist_account(sqlite_session)

    with pytest.raises(ValueError, match="Current tenant not found for account creator_id"):
        _trace_instance().get_service_account_with_tenant("some_app_id")


@pytest.mark.parametrize("sqlite_session", [TABLES], indirect=True)
def test_get_service_account_with_tenant_success(sqlite_session: Session):
    _persist_app(sqlite_session, created_by="creator_id")
    _persist_account(sqlite_session)
    tenant = Tenant(name="Workspace")
    tenant.id = "tenant_id"
    sqlite_session.add_all(
        [
            tenant,
            TenantAccountJoin(
                tenant_id=tenant.id,
                account_id="creator_id",
                current=True,
                role=TenantAccountRole.OWNER,
            ),
        ]
    )
    sqlite_session.commit()

    result = _trace_instance().get_service_account_with_tenant("some_app_id")

    assert result.id == "creator_id"
    assert result.current_tenant_id == "tenant_id"
    assert result.current_role == TenantAccountRole.OWNER
