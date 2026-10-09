"""Regression coverage for the ``@property``→session-parameter refactor on ``App.tenant``.

The legacy ``@property`` reached for the global ``db.session`` internally and has been converted
to a plain method taking an explicit ``session`` (per the pattern established in
#41830/#41831 for ``InstalledApp.tenant`` / ``ApiToolProvider.tenant``, tracked in #40372).
"""

from uuid import uuid4

from sqlalchemy.orm import Session

from models.account import Tenant
from models.model import App, AppMode


def _persist_tenant(session: Session) -> Tenant:
    tenant = Tenant(name="Test Tenant")
    session.add(tenant)
    session.flush()
    return tenant


def _persist_app(session: Session, *, tenant_id: str) -> App:
    app = App(
        tenant_id=tenant_id,
        name="Test App",
        mode=AppMode.CHAT,
        enable_site=True,
        enable_api=False,
        created_by=str(uuid4()),
    )
    session.add(app)
    session.flush()
    return app


class TestAppTenant:
    def test_returns_the_matching_tenant(self, sqlite_session: Session) -> None:
        tenant = _persist_tenant(sqlite_session)
        app = _persist_app(sqlite_session, tenant_id=tenant.id)

        result = app.tenant(session=sqlite_session)

        assert result is not None
        assert result.id == tenant.id

    def test_returns_none_when_tenant_missing(self, sqlite_session: Session) -> None:
        app = _persist_app(sqlite_session, tenant_id=str(uuid4()))

        assert app.tenant(session=sqlite_session) is None
