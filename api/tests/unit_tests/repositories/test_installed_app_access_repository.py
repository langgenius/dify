from uuid import uuid4

import pytest
from sqlalchemy import inspect
from sqlalchemy.orm import Session, sessionmaker

from models.model import App, AppMode, InstalledApp
from repositories.installed_app_access_repository import SQLAlchemyInstalledAppAccessRepository
from services.installed_app_access_service import InstalledAppRef

_VIEWER_TENANT_ID = "11111111-1111-4111-8111-111111111111"
_OWNER_TENANT_ID = "22222222-2222-4222-8222-222222222222"


def _installation(*, app_id: str) -> InstalledApp:
    return InstalledApp(
        app_id=app_id,
        tenant_id=_VIEWER_TENANT_ID,
        app_owner_tenant_id=_OWNER_TENANT_ID,
        position=0,
        is_pinned=False,
        last_used_at=None,
    )


def test_resolve_returns_pure_reference_to_cross_workspace_app(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        # Admission must not add public, published, or app-mode constraints.
        app = App(
            tenant_id=_OWNER_TENANT_ID,
            name="Installed app",
            mode=AppMode.AGENT,
            is_public=False,
            enable_site=True,
            enable_api=True,
        )
        session.add(app)
        session.flush()
        installed_app = _installation(app_id=app.id)
        session.add(installed_app)
        session.flush()
        installed_app_id = installed_app.id
        app_id = app.id

    repository = SQLAlchemyInstalledAppAccessRepository(session_factory=sqlite_session_factory)
    result = repository.resolve(installed_app_id=installed_app_id, tenant_id=_VIEWER_TENANT_ID)

    assert result == InstalledAppRef(id=installed_app_id, app_id=app_id, tenant_id=_VIEWER_TENANT_ID)
    assert inspect(result, raiseerr=False) is None
    with sqlite_session_factory() as session:
        assert session.get(InstalledApp, installed_app_id) is not None


def test_missing_installation_returns_none(sqlite_session_factory: sessionmaker[Session]) -> None:
    repository = SQLAlchemyInstalledAppAccessRepository(session_factory=sqlite_session_factory)

    assert repository.resolve(installed_app_id=str(uuid4()), tenant_id=_VIEWER_TENANT_ID) is None


@pytest.mark.parametrize("orphaned", [False, True])
def test_other_workspace_cannot_resolve_or_clean_up_installation(
    sqlite_session_factory: sessionmaker[Session],
    orphaned: bool,
) -> None:
    with sqlite_session_factory.begin() as session:
        app_id = str(uuid4())
        if not orphaned:
            app = App(
                id=app_id,
                tenant_id=_OWNER_TENANT_ID,
                name="Installed app",
                mode=AppMode.COMPLETION,
                enable_site=True,
                enable_api=True,
            )
            session.add(app)
        installed_app = _installation(app_id=app_id)
        session.add(installed_app)
        session.flush()
        installed_app_id = installed_app.id

    repository = SQLAlchemyInstalledAppAccessRepository(session_factory=sqlite_session_factory)

    assert repository.resolve(installed_app_id=installed_app_id, tenant_id=_OWNER_TENANT_ID) is None
    with sqlite_session_factory() as session:
        assert session.get(InstalledApp, installed_app_id) is not None


def test_orphan_cleanup_is_committed_and_idempotent(sqlite_session_factory: sessionmaker[Session]) -> None:
    with sqlite_session_factory.begin() as session:
        installed_app = _installation(app_id=str(uuid4()))
        session.add(installed_app)
        session.flush()
        installed_app_id = installed_app.id

    repository = SQLAlchemyInstalledAppAccessRepository(session_factory=sqlite_session_factory)

    assert repository.resolve(installed_app_id=installed_app_id, tenant_id=_VIEWER_TENANT_ID) is None
    with sqlite_session_factory() as session:
        assert session.get(InstalledApp, installed_app_id) is None
    assert repository.resolve(installed_app_id=installed_app_id, tenant_id=_VIEWER_TENANT_ID) is None
