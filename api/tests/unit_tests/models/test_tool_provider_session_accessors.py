"""Regression coverage for the ``@property``→session-parameter refactor on tool provider accessors.

Covers four of `api/models/tools.py`'s legacy `@property` accessors that reached for the global
``db.session`` internally and have been converted to plain methods taking an explicit
``session: Session`` (per the pattern established in #40370/#40797/#41394, tracked in #40372):

- ``ApiToolProvider.tenant``
- ``WorkflowToolProvider.user``
- ``WorkflowToolProvider.tenant``
- ``WorkflowToolProvider.app``

Each accessor is exercised against the real ``sqlite_session`` fixture (a genuine SQLAlchemy
``Session`` bound to a pristine full-schema SQLite database) so the assertions cover actual
query behaviour rather than a mock's recorded call.
"""

from uuid import uuid4

from sqlalchemy.orm import Session

from core.tools.entities.tool_entities import ApiProviderSchemaType
from models.account import Account, Tenant
from models.model import App, AppMode
from models.tools import ApiToolProvider, WorkflowToolProvider


def _persist_account(session: Session) -> Account:
    account = Account(name="Test Account", email="test@example.com")
    session.add(account)
    session.flush()
    return account


def _persist_tenant(session: Session) -> Tenant:
    tenant = Tenant(name="Test Tenant")
    session.add(tenant)
    session.flush()
    return tenant


def _persist_app(session: Session, *, tenant_id: str) -> App:
    app = App(
        tenant_id=tenant_id,
        name="Test App",
        mode=AppMode.WORKFLOW,
        enable_site=True,
        enable_api=True,
        created_by=str(uuid4()),
    )
    session.add(app)
    session.flush()
    return app


def _api_tool_provider(*, tenant_id: str) -> ApiToolProvider:
    return ApiToolProvider(
        tenant_id=tenant_id,
        user_id=str(uuid4()),
        name="Test API Provider",
        icon="{}",
        schema="{}",
        schema_type_str=ApiProviderSchemaType.OPENAPI,
        description="",
        tools_str="[]",
        credentials_str="{}",
    )


def _workflow_tool_provider(*, tenant_id: str, app_id: str, user_id: str) -> WorkflowToolProvider:
    return WorkflowToolProvider(
        name="Test Workflow Provider",
        label="Test Workflow Provider",
        icon="{}",
        app_id=app_id,
        version="1",
        user_id=user_id,
        tenant_id=tenant_id,
        description="",
    )


class TestApiToolProviderTenant:
    def test_returns_persisted_tenant(self, sqlite_session: Session) -> None:
        tenant = _persist_tenant(sqlite_session)
        provider = _api_tool_provider(tenant_id=tenant.id)

        result = provider.tenant(session=sqlite_session)

        assert result is not None
        assert result.id == tenant.id

    def test_returns_none_when_tenant_missing(self, sqlite_session: Session) -> None:
        provider = _api_tool_provider(tenant_id=str(uuid4()))

        assert provider.tenant(session=sqlite_session) is None


class TestWorkflowToolProviderUser:
    def test_returns_persisted_user(self, sqlite_session: Session) -> None:
        tenant = _persist_tenant(sqlite_session)
        app = _persist_app(sqlite_session, tenant_id=tenant.id)
        account = _persist_account(sqlite_session)
        provider = _workflow_tool_provider(tenant_id=tenant.id, app_id=app.id, user_id=account.id)

        result = provider.user(session=sqlite_session)

        assert result is not None
        assert result.id == account.id

    def test_returns_none_when_user_missing(self, sqlite_session: Session) -> None:
        tenant = _persist_tenant(sqlite_session)
        app = _persist_app(sqlite_session, tenant_id=tenant.id)
        provider = _workflow_tool_provider(tenant_id=tenant.id, app_id=app.id, user_id=str(uuid4()))

        assert provider.user(session=sqlite_session) is None


class TestWorkflowToolProviderTenant:
    def test_returns_persisted_tenant(self, sqlite_session: Session) -> None:
        tenant = _persist_tenant(sqlite_session)
        app = _persist_app(sqlite_session, tenant_id=tenant.id)
        provider = _workflow_tool_provider(tenant_id=tenant.id, app_id=app.id, user_id=str(uuid4()))

        result = provider.tenant(session=sqlite_session)

        assert result is not None
        assert result.id == tenant.id

    def test_returns_none_when_tenant_missing(self, sqlite_session: Session) -> None:
        tenant = _persist_tenant(sqlite_session)
        app = _persist_app(sqlite_session, tenant_id=tenant.id)
        provider = _workflow_tool_provider(tenant_id=str(uuid4()), app_id=app.id, user_id=str(uuid4()))

        assert provider.tenant(session=sqlite_session) is None


class TestWorkflowToolProviderApp:
    def test_returns_persisted_app(self, sqlite_session: Session) -> None:
        tenant = _persist_tenant(sqlite_session)
        app = _persist_app(sqlite_session, tenant_id=tenant.id)
        provider = _workflow_tool_provider(tenant_id=tenant.id, app_id=app.id, user_id=str(uuid4()))

        result = provider.app(session=sqlite_session)

        assert result is not None
        assert result.id == app.id

    def test_returns_none_when_app_missing(self, sqlite_session: Session) -> None:
        tenant = _persist_tenant(sqlite_session)
        provider = _workflow_tool_provider(tenant_id=tenant.id, app_id=str(uuid4()), user_id=str(uuid4()))

        assert provider.app(session=sqlite_session) is None
