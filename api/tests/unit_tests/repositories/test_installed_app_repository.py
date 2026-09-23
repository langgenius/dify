from dataclasses import replace
from datetime import datetime
from uuid import uuid4

import pytest
from sqlalchemy import event, inspect
from sqlalchemy.orm import Session, sessionmaker

from models.model import App, AppMode, InstalledApp
from repositories.installed_app_repository import SQLAlchemyInstalledAppRepository
from services.installed_app_access_service import InstalledAppNotFoundError, InstalledAppRef

_USED_AT = datetime(2026, 9, 6, 12, 30, 45)
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

    repository = SQLAlchemyInstalledAppRepository(session_factory=sqlite_session_factory)
    result = repository.resolve(installed_app_id=installed_app_id, tenant_id=_VIEWER_TENANT_ID)

    assert result == InstalledAppRef(id=installed_app_id, app_id=app_id, tenant_id=_VIEWER_TENANT_ID)
    assert inspect(result, raiseerr=False) is None
    with sqlite_session_factory() as session:
        assert session.get(InstalledApp, installed_app_id) is not None


def test_missing_installation_returns_none(sqlite_session_factory: sessionmaker[Session]) -> None:
    repository = SQLAlchemyInstalledAppRepository(session_factory=sqlite_session_factory)

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

    repository = SQLAlchemyInstalledAppRepository(session_factory=sqlite_session_factory)

    assert repository.resolve(installed_app_id=installed_app_id, tenant_id=_OWNER_TENANT_ID) is None
    with sqlite_session_factory() as session:
        assert session.get(InstalledApp, installed_app_id) is not None


def test_orphan_cleanup_is_committed_and_idempotent(sqlite_session_factory: sessionmaker[Session]) -> None:
    with sqlite_session_factory.begin() as session:
        installed_app = _installation(app_id=str(uuid4()))
        session.add(installed_app)
        session.flush()
        installed_app_id = installed_app.id

    repository = SQLAlchemyInstalledAppRepository(session_factory=sqlite_session_factory)

    assert repository.resolve(installed_app_id=installed_app_id, tenant_id=_VIEWER_TENANT_ID) is None
    with sqlite_session_factory() as session:
        assert session.get(InstalledApp, installed_app_id) is None
    assert repository.resolve(installed_app_id=installed_app_id, tenant_id=_VIEWER_TENANT_ID) is None


@pytest.fixture
def installed_app(sqlite_session_factory: sessionmaker[Session]) -> InstalledApp:
    with sqlite_session_factory.begin() as session:
        app = App(tenant_id=str(uuid4()), name="Shared app", mode=AppMode.COMPLETION, enable_site=True, enable_api=True)
        session.add(app)
        session.flush()
        installation = InstalledApp(
            tenant_id=str(uuid4()),
            app_id=app.id,
            app_owner_tenant_id=app.tenant_id,
            position=7,
            is_pinned=True,
        )
        session.add(installation)
    return installation


def _reference(installation: InstalledApp) -> InstalledAppRef:
    return InstalledAppRef(id=installation.id, app_id=installation.app_id, tenant_id=installation.tenant_id)


def test_record_commits_usage_for_cross_workspace_app_without_changing_installation_settings(
    sqlite_session_factory: sessionmaker[Session], installed_app: InstalledApp
) -> None:
    repository = SQLAlchemyInstalledAppRepository(session_factory=sqlite_session_factory)

    repository.record(installed_app=_reference(installed_app), used_at=_USED_AT)

    with sqlite_session_factory() as session:
        stored = session.get(InstalledApp, installed_app.id)
        assert stored is not None
        assert stored.last_used_at == _USED_AT
        assert stored.tenant_id != stored.app_owner_tenant_id
        assert stored.app_owner_tenant_id == installed_app.app_owner_tenant_id
        assert stored.position == 7
        assert stored.is_pinned is True


@pytest.mark.parametrize("field", ["id", "tenant_id", "app_id"])
def test_record_requires_every_part_of_admitted_installation_scope(
    sqlite_session_factory: sessionmaker[Session], installed_app: InstalledApp, field: str
) -> None:
    reference = replace(_reference(installed_app), **{field: str(uuid4())})
    repository = SQLAlchemyInstalledAppRepository(session_factory=sqlite_session_factory)

    with pytest.raises(InstalledAppNotFoundError, match=reference.id):
        repository.record(installed_app=reference, used_at=_USED_AT)

    with sqlite_session_factory() as session:
        stored = session.get(InstalledApp, installed_app.id)
        assert stored is not None
        assert stored.last_used_at is None


def test_record_is_repeatable_and_committed_usage_survives_a_later_rollback(
    sqlite_session_factory: sessionmaker[Session], installed_app: InstalledApp
) -> None:
    repository = SQLAlchemyInstalledAppRepository(session_factory=sqlite_session_factory)
    repository.record(installed_app=_reference(installed_app), used_at=_USED_AT)
    repository.record(installed_app=_reference(installed_app), used_at=_USED_AT)

    with sqlite_session_factory() as session:
        stored = session.get(InstalledApp, installed_app.id)
        assert stored is not None
        stored.last_used_at = None
        session.flush()
        session.rollback()

    with sqlite_session_factory() as session:
        stored = session.get(InstalledApp, installed_app.id)
        assert stored is not None
        assert stored.last_used_at == _USED_AT


def test_record_rolls_back_and_preserves_commit_error(
    sqlite_session_factory: sessionmaker[Session], installed_app: InstalledApp
) -> None:
    failure = RuntimeError("usage commit unavailable")
    repository_factory = sessionmaker(bind=sqlite_session_factory.kw["bind"], expire_on_commit=False)

    @event.listens_for(repository_factory, "before_commit")
    def fail_commit(_session: Session) -> None:
        raise failure

    repository = SQLAlchemyInstalledAppRepository(session_factory=repository_factory)
    with pytest.raises(RuntimeError) as raised:
        repository.record(installed_app=_reference(installed_app), used_at=_USED_AT)

    assert raised.value is failure
    with sqlite_session_factory() as session:
        stored = session.get(InstalledApp, installed_app.id)
        assert stored is not None
        assert stored.last_used_at is None
