from contextvars import Context
from types import SimpleNamespace

import pytest
from flask import Flask, has_app_context
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session

from core.ops.base_trace_instance import (
    ApplicationTracingHooksNotRegisteredError,
    BaseTraceInstance,
    application_tracing_hooks,
    bind_application_tracing_hooks,
)
from core.ops.entities.config_entity import BaseTracingConfig
from core.ops.entities.trace_entity import BaseTraceInfo
from models import Account, App, Tenant, TenantAccountJoin
from models.account import TenantAccountRole
from models.model import AppMode
from services.tracing.runtime_bridge import RuntimeApplicationTracingHooks
from tests.helpers.unit.config_override import apply_config_overrides

"""The execution port is gated before Flask lookup and bound per application."""


class TestApplicationTracingHooksCases:
    @staticmethod
    def test_disabled_port_needs_no_application_context(monkeypatch: pytest.MonkeyPatch) -> None:
        apply_config_overrides(monkeypatch, OPS_AGENT_TRACE_ENABLED=False)
        isolated_context = Context()
        assert not isolated_context.run(has_app_context)
        assert isolated_context.run(application_tracing_hooks) is None

    @staticmethod
    def test_enabled_port_reports_missing_registration_without_context(monkeypatch: pytest.MonkeyPatch) -> None:
        apply_config_overrides(monkeypatch, OPS_AGENT_TRACE_ENABLED=True)
        isolated_context = Context()
        assert not isolated_context.run(has_app_context)
        with pytest.raises(ApplicationTracingHooksNotRegisteredError, match="application_tracing_hooks_not_registered"):
            isolated_context.run(application_tracing_hooks)

    @staticmethod
    def test_enabled_port_reports_missing_registration_in_app(monkeypatch: pytest.MonkeyPatch) -> None:
        apply_config_overrides(monkeypatch, OPS_AGENT_TRACE_ENABLED=True)
        with Flask(__name__).app_context():
            with pytest.raises(
                ApplicationTracingHooksNotRegisteredError, match="application_tracing_hooks_not_registered"
            ):
                application_tracing_hooks()

    @staticmethod
    def test_port_does_not_leak_between_flask_applications(monkeypatch: pytest.MonkeyPatch) -> None:
        apply_config_overrides(monkeypatch, OPS_AGENT_TRACE_ENABLED=True)
        first, second = Flask("first"), Flask("second")
        first_hooks = RuntimeApplicationTracingHooks()
        second_hooks = RuntimeApplicationTracingHooks()
        bind_application_tracing_hooks(first, first_hooks)
        bind_application_tracing_hooks(second, second_hooks)
        with first.app_context():
            assert application_tracing_hooks() is first_hooks
            with second.app_context():
                assert application_tracing_hooks() is second_hooks
            assert application_tracing_hooks() is first_hooks
            apply_config_overrides(monkeypatch, OPS_AGENT_TRACE_ENABLED=False)
            assert application_tracing_hooks() is None


TABLES = (App, Account, Tenant, TenantAccountJoin)


class ConcreteTraceInstance(BaseTraceInstance):
    def __init__(self, trace_config: BaseTracingConfig):
        super().__init__(trace_config)

    def trace(self, trace_info: BaseTraceInfo):
        super().trace(trace_info)


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
    return ConcreteTraceInstance(BaseTracingConfig())


class TestBaseTraceInstanceCases:
    @staticmethod
    @pytest.fixture(autouse=True)
    def _bind_production_sessions(monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine) -> None:
        """Bind the service-owned ORM session to the test's SQLite engine."""
        database = SimpleNamespace(engine=sqlite_engine)
        monkeypatch.setattr("core.ops.base_trace_instance.db", database)

    @staticmethod
    @pytest.mark.parametrize("sqlite_session", [TABLES], indirect=True)
    def test_get_service_account_with_tenant_app_not_found(sqlite_session: Session):
        with pytest.raises(ValueError, match="App with id some_app_id not found"):
            _trace_instance().get_service_account_with_tenant("some_app_id")

    @staticmethod
    @pytest.mark.parametrize("sqlite_session", [TABLES], indirect=True)
    def test_get_service_account_with_tenant_no_creator(sqlite_session: Session):
        _persist_app(sqlite_session, created_by=None)

        with pytest.raises(ValueError, match="App with id some_app_id has no creator"):
            _trace_instance().get_service_account_with_tenant("some_app_id")

    @staticmethod
    @pytest.mark.parametrize("sqlite_session", [TABLES], indirect=True)
    def test_get_service_account_with_tenant_creator_not_found(sqlite_session: Session):
        _persist_app(sqlite_session, created_by="creator_id")

        with pytest.raises(ValueError, match="Creator account with id creator_id not found for app some_app_id"):
            _trace_instance().get_service_account_with_tenant("some_app_id")

    @staticmethod
    @pytest.mark.parametrize("sqlite_session", [TABLES], indirect=True)
    def test_get_service_account_with_tenant_tenant_not_found(sqlite_session: Session):
        _persist_app(sqlite_session, created_by="creator_id")
        _persist_account(sqlite_session)

        with pytest.raises(ValueError, match="App tenant tenant_id not found for account creator_id"):
            _trace_instance().get_service_account_with_tenant("some_app_id")

    @staticmethod
    @pytest.mark.parametrize("current", [True, False])
    @pytest.mark.parametrize("sqlite_session", [TABLES], indirect=True)
    def test_get_service_account_with_tenant_success(sqlite_session: Session, current: bool):
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
                    current=current,
                    role=TenantAccountRole.OWNER,
                ),
            ]
        )
        sqlite_session.commit()

        result = _trace_instance().get_service_account_with_tenant("some_app_id")

        assert result.id == "creator_id"
        assert result.current_tenant_id == "tenant_id"
        assert result.current_role == TenantAccountRole.OWNER

    @staticmethod
    @pytest.mark.parametrize("sqlite_session", [TABLES], indirect=True)
    def test_get_service_account_with_tenant_uses_app_workspace(sqlite_session: Session):
        _persist_app(sqlite_session, created_by="creator_id")
        _persist_account(sqlite_session)
        app_tenant = Tenant(name="App workspace")
        app_tenant.id = "tenant_id"
        current_tenant = Tenant(name="Current workspace")
        current_tenant.id = "other_tenant_id"
        sqlite_session.add_all(
            [
                app_tenant,
                current_tenant,
                TenantAccountJoin(
                    tenant_id="tenant_id",
                    account_id="creator_id",
                    current=False,
                    role=TenantAccountRole.EDITOR,
                ),
                TenantAccountJoin(
                    tenant_id="other_tenant_id",
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
        assert result.current_role == TenantAccountRole.EDITOR
        sqlite_session.expire_all()
        memberships = sqlite_session.scalars(
            select(TenantAccountJoin).where(TenantAccountJoin.account_id == "creator_id")
        ).all()
        assert {membership.tenant_id: membership.current for membership in memberships} == {
            "tenant_id": False,
            "other_tenant_id": True,
        }

    @staticmethod
    @pytest.mark.parametrize("sqlite_session", [TABLES], indirect=True)
    def test_get_service_account_with_tenant_requires_app_membership(sqlite_session: Session):
        _persist_app(sqlite_session, created_by="creator_id")
        _persist_account(sqlite_session)
        app_tenant = Tenant(name="App workspace")
        app_tenant.id = "tenant_id"
        current_tenant = Tenant(name="Current workspace")
        current_tenant.id = "other_tenant_id"
        sqlite_session.add_all(
            [
                app_tenant,
                current_tenant,
                TenantAccountJoin(
                    tenant_id="other_tenant_id",
                    account_id="creator_id",
                    current=True,
                    role=TenantAccountRole.OWNER,
                ),
            ]
        )
        sqlite_session.commit()

        with pytest.raises(ValueError, match="App tenant tenant_id not found for account creator_id"):
            _trace_instance().get_service_account_with_tenant("some_app_id")

    @staticmethod
    @pytest.mark.parametrize("sqlite_session", [TABLES], indirect=True)
    def test_get_service_account_with_tenant_requires_existing_app_tenant(sqlite_session: Session):
        _persist_app(sqlite_session, created_by="creator_id")
        _persist_account(sqlite_session)
        sqlite_session.add(
            TenantAccountJoin(
                tenant_id="tenant_id",
                account_id="creator_id",
                current=True,
                role=TenantAccountRole.OWNER,
            )
        )
        sqlite_session.commit()

        with pytest.raises(ValueError, match="App tenant tenant_id not found for account creator_id"):
            _trace_instance().get_service_account_with_tenant("some_app_id")
