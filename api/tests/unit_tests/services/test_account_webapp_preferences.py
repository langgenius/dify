"""Independent WebApp usage, favorites and removal state."""

from datetime import datetime, timedelta
from uuid import uuid4

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session, sessionmaker

from models.account import Account, AccountStatus
from models.account_webapp import AccountWebApp
from models.end_user_connection import EndUserConnection
from models.model import App, AppStar, EndUser
from models.workflow import WorkflowRun
from services.consumer_service import ConsumerAppsQuery, ConsumerIdentity
from tests.helpers.consumer import ConsumerHarness, make_consumer_harness, new_consumer_run


@pytest.fixture
def harness(sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch) -> ConsumerHarness:
    return make_consumer_harness(sqlite_session_factory, monkeypatch)


def test_console_stars_are_not_webapp_favorites(harness: ConsumerHarness) -> None:
    base = harness.oauth.base
    with base.sessions.begin() as session:
        star = AppStar(
            tenant_id=base.context.tenant_id, account_id=harness.identity.account_id, app_id=base.context.app_id
        )
        session.add(star)
    assert not harness.service.list_apps(harness.identity, ConsumerAppsQuery(view="favorites")).data
    assert not harness.service.list_apps(harness.identity, ConsumerAppsQuery(view="shared")).data[0].is_favorite
    harness.service.set_favorite(harness.identity, base.context.app_id, enabled=True)
    assert harness.service.list_apps(harness.identity, ConsumerAppsQuery(view="favorites")).data[0].is_favorite
    assert not harness.service.list_apps(harness.identity, ConsumerAppsQuery()).data
    harness.service.set_favorite(harness.identity, base.context.app_id, enabled=False)
    with base.sessions() as session:
        assert session.get(AppStar, star.id) is not None
        state = session.scalar(sa.select(AccountWebApp))
        assert state is not None
        assert state.last_used_at is None


def test_removal_retains_data_and_new_usage_restores_without_restoring_favorite(
    harness: ConsumerHarness, monkeypatch: pytest.MonkeyPatch
) -> None:
    import repositories.app.console_repository as repository_module

    base = harness.oauth.base
    moment = datetime(2026, 11, 4, 10)
    monkeypatch.setattr(repository_module, "naive_utc_now", lambda: moment)
    harness.record_usage(moment - timedelta(minutes=1))
    harness.service.set_favorite(harness.identity, base.context.app_id, enabled=True)
    connection = base.service.create_api_key(base.context, base.command())
    with base.sessions.begin() as session:
        run = new_consumer_run(base, created_at=moment - timedelta(minutes=1))
        session.add(run)
        session.flush()
        run_id = run.id
    harness.service.remove_app(harness.identity, base.context.app_id)
    for view in ("recent", "favorites"):
        assert not harness.service.list_apps(harness.identity, ConsumerAppsQuery(view=view)).data
    assert harness.service.list_apps(harness.identity, ConsumerAppsQuery(view="shared")).data
    with base.sessions() as session:
        assert session.get(WorkflowRun, run_id) is not None
        assert session.get(EndUser, base.context.end_user_id) is not None
        assert session.get(EndUserConnection, connection.id) is not None
        state = session.scalar(sa.select(AccountWebApp))
        assert state is not None
        assert state.removed_at == moment
        assert state.favorited_at is None

    # Delayed and duplicate writes from before removal must preserve the tombstone.
    harness.record_usage(moment - timedelta(seconds=1))
    harness.record_usage(moment)
    assert not harness.service.list_apps(harness.identity, ConsumerAppsQuery()).data
    harness.record_usage(moment + timedelta(seconds=1))
    restored = harness.service.list_apps(harness.identity, ConsumerAppsQuery()).data[0]
    assert restored.last_used_at == moment + timedelta(seconds=1)
    assert not restored.is_favorite


def test_removal_is_account_scoped_and_works_after_access_is_revoked(harness: ConsumerHarness) -> None:
    base = harness.oauth.base
    harness.record_usage(datetime(2026, 11, 4))
    with base.sessions.begin() as session:
        other = Account(name="Other", email=f"{uuid4()}@example.com", status=AccountStatus.ACTIVE)
        session.add(other)
        session.flush()
        other_id = other.id
    harness.service.remove_app(ConsumerIdentity(other_id), base.context.app_id)
    assert harness.service.list_apps(harness.identity, ConsumerAppsQuery()).data
    harness.access.denied.add(base.context.app_id)
    with base.sessions.begin() as session:
        session.execute(sa.update(App).where(App.id == base.context.app_id).values(enable_site=False))
    harness.service.remove_app(harness.identity, base.context.app_id)
    harness.service.remove_app(harness.identity, base.context.app_id)
    harness.service.remove_app(harness.identity, str(uuid4()))
    with base.sessions() as session:
        state = session.scalar(sa.select(AccountWebApp))
        assert state is not None
        assert state.removed_at is not None
        assert session.scalar(sa.select(sa.func.count()).select_from(AccountWebApp)) == 1


def test_explicit_favorite_restores_a_removed_entry_without_fabricating_usage(
    harness: ConsumerHarness, monkeypatch: pytest.MonkeyPatch
) -> None:
    import repositories.app.console_repository as repository_module

    base = harness.oauth.base
    moment = datetime(2026, 11, 4)
    monkeypatch.setattr(repository_module, "naive_utc_now", lambda: moment)
    harness.service.set_favorite(harness.identity, base.context.app_id, enabled=True)
    harness.service.remove_app(harness.identity, base.context.app_id)
    harness.service.set_favorite(harness.identity, base.context.app_id, enabled=True)
    harness.service.set_favorite(harness.identity, base.context.app_id, enabled=True)
    assert not harness.service.list_apps(harness.identity, ConsumerAppsQuery()).data
    assert harness.service.list_apps(harness.identity, ConsumerAppsQuery(view="favorites")).data[0].is_favorite
    with base.sessions() as session:
        state = session.scalar(sa.select(AccountWebApp))
        assert state is not None
        assert state.favorited_at == moment
        assert state.removed_at is None
        assert state.last_used_at is None


def test_removal_precedes_the_first_delayed_usage_write(
    harness: ConsumerHarness, monkeypatch: pytest.MonkeyPatch
) -> None:
    import repositories.app.console_repository as repository_module

    removed_at = datetime(2026, 11, 4, 10)
    monkeypatch.setattr(repository_module, "naive_utc_now", lambda: removed_at)
    harness.service.remove_app(harness.identity, harness.oauth.base.context.app_id)
    harness.record_usage(removed_at - timedelta(seconds=1))
    assert not harness.service.list_apps(harness.identity, ConsumerAppsQuery()).data
    harness.record_usage(removed_at + timedelta(seconds=1))
    assert harness.service.list_apps(harness.identity, ConsumerAppsQuery()).data
