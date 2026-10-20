"""Regression coverage for the ``@property``→session-parameter refactor on
``InstalledApp.tenant``.

The legacy ``@property`` reached for the global ``db.session`` internally and has been converted
to a plain method taking an explicit ``session: Session`` (per the pattern established in
#40370/#40797/#41394/#41830/#41885, tracked in #40372).
"""

from uuid import uuid4

from sqlalchemy.orm import Session

from models.account import Tenant
from models.model import InstalledApp


def _persist_tenant(session: Session) -> Tenant:
    tenant = Tenant(name="Test Tenant")
    session.add(tenant)
    session.flush()
    return tenant


def _persist_installed_app(session: Session, *, tenant_id: str) -> InstalledApp:
    installed_app = InstalledApp(
        tenant_id=tenant_id,
        app_id=str(uuid4()),
        app_owner_tenant_id=str(uuid4()),
        position=0,
        is_pinned=False,
        last_used_at=None,
    )
    session.add(installed_app)
    session.flush()
    return installed_app


class TestInstalledAppTenant:
    def test_returns_the_matching_tenant(self, sqlite_session: Session) -> None:
        tenant = _persist_tenant(sqlite_session)
        installed_app = _persist_installed_app(sqlite_session, tenant_id=tenant.id)

        result = installed_app.tenant(session=sqlite_session)

        assert result is not None
        assert result.id == tenant.id

    def test_returns_none_when_tenant_missing(self, sqlite_session: Session) -> None:
        installed_app = _persist_installed_app(sqlite_session, tenant_id=str(uuid4()))

        assert installed_app.tenant(session=sqlite_session) is None
