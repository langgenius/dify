"""Consumer identity, ownership, usage and access-policy behavior with real persistence."""

from dataclasses import replace
from datetime import datetime, timedelta
from uuid import uuid4

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session, sessionmaker

from models.account import Account, AccountStatus, TenantAccountJoin
from models.end_user_connection import AppConnection, EndUserConnection
from models.enums import CreatorUserRole, CustomizeTokenStrategy, EndUserType, WorkflowRunTriggeredFrom
from models.model import App, AppMode, AppStar, EndUser, Site
from models.workflow import WorkflowRun, WorkflowType
from repositories.web_passport_repository import WebPassportRepository
from services.consumer_service import (
    ConsumerAppNotFoundError,
    ConsumerAppsQuery,
    ConsumerIdentity,
)
from services.end_user_connections.entities import AccountConnectionContext
from services.end_user_connections.errors import ConnectionNotFoundError
from services.web_identity_service import WebIdentityError
from tests.helpers.consumer import ConsumerHarness, consumer_connection_key, make_consumer_harness, new_consumer_run
from tests.helpers.end_user_api_key import make_harness
from tests.helpers.end_user_connection_contract import new_connection


@pytest.fixture
def harness(sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch) -> ConsumerHarness:
    return make_consumer_harness(sqlite_session_factory, monkeypatch)


def test_account_authentication_does_not_provision_workspace(harness: ConsumerHarness) -> None:
    assert harness.service.authenticate(harness.token()) == harness.identity
    with harness.oauth.base.sessions() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(TenantAccountJoin)) == 0


@pytest.mark.parametrize("source", [None, "webapp", "webapp_account", "webapp_login_token", "unknown"])
def test_app_tokens_cannot_become_consumer_identity(harness: ConsumerHarness, source: str) -> None:
    with pytest.raises(WebIdentityError):
        harness.service.authenticate(harness.token(source=source))


def test_banned_account_cannot_authenticate_or_continue_connection_management(harness: ConsumerHarness) -> None:
    base = harness.oauth.base
    connection = base.service.create_api_key(base.context, base.command())
    context = harness.service.connection_context(harness.identity, connection.id)
    with base.sessions.begin() as session:
        session.execute(
            sa.update(Account).where(Account.id == harness.identity.account_id).values(status=AccountStatus.BANNED)
        )
    with pytest.raises(WebIdentityError):
        harness.service.authenticate(harness.token())
    from services.end_user_connections.errors import ConnectionIdentityError

    with pytest.raises(ConnectionIdentityError):
        base.service.delete_connection(context, connection.id)


@pytest.mark.parametrize("mode", [AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
def test_favorites_and_recent_are_account_scoped_and_recheck_access(harness: ConsumerHarness, mode: AppMode) -> None:
    base = harness.oauth.base
    app_id = base.context.app_id
    for _ in range(2):
        harness.service.set_favorite(harness.identity, app_id, enabled=True)
    now = datetime(2026, 10, 30, 10)
    with base.sessions.begin() as session:
        session.execute(sa.update(App).where(App.id == app_id).values(mode=mode))
        for moment in (now, now - timedelta(days=1), now + timedelta(hours=1)):
            run = new_consumer_run(base, created_at=moment)
            run.type = WorkflowType.CHAT if mode == AppMode.ADVANCED_CHAT else WorkflowType.WORKFLOW
            session.add(run)
    for view in ("recent", "favorites", "shared"):
        result = harness.service.list_apps(harness.identity, ConsumerAppsQuery(view=view))
        assert [app.id for app in result.data] == [app_id]
        assert result.data[0].is_favorite
        assert result.data[0].last_used_at == now + timedelta(hours=1)
    other = ConsumerIdentity(str(uuid4()))
    assert not harness.service.list_apps(other, ConsumerAppsQuery()).data
    assert not harness.service.list_apps(other, ConsumerAppsQuery(view="favorites")).data
    with base.sessions() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(AppStar)) == 1
    harness.access.denied.add(app_id)
    assert not harness.service.list_apps(harness.identity, ConsumerAppsQuery(view="favorites")).data
    with pytest.raises(ConsumerAppNotFoundError):
        harness.service.set_favorite(harness.identity, app_id, enabled=True)
    for _ in range(2):
        harness.service.set_favorite(harness.identity, app_id, enabled=False)


def test_unpublished_app_cannot_be_favorited_or_listed(harness: ConsumerHarness) -> None:
    base = harness.oauth.base
    with base.sessions.begin() as session:
        session.execute(sa.update(App).where(App.id == base.context.app_id).values(enable_site=False))
    with pytest.raises(ConsumerAppNotFoundError):
        harness.service.set_favorite(harness.identity, base.context.app_id, enabled=True)
    assert not harness.service.list_apps(harness.identity, ConsumerAppsQuery(view="shared")).data


@pytest.mark.parametrize("mode", [AppMode.CHAT, AppMode.COMPLETION, AppMode.AGENT_CHAT, AppMode.AGENT])
def test_consumer_apps_support_only_chatflow_and_workflow(harness: ConsumerHarness, mode: AppMode) -> None:
    base = harness.oauth.base
    harness.service.set_favorite(harness.identity, base.context.app_id, enabled=True)
    with base.sessions.begin() as session:
        session.add(new_consumer_run(base, created_at=datetime(2026, 10, 30)))
        session.execute(sa.update(App).where(App.id == base.context.app_id).values(mode=mode))
    for view in ("recent", "favorites", "shared"):
        assert not harness.service.list_apps(harness.identity, ConsumerAppsQuery(view=view)).data
    with pytest.raises(ConsumerAppNotFoundError):
        harness.service.set_favorite(harness.identity, base.context.app_id, enabled=True)


def test_passport_without_execution_is_not_recent_and_log_deletion_removes_recent_usage(
    harness: ConsumerHarness,
) -> None:
    base = harness.oauth.base
    harness.service.set_favorite(harness.identity, base.context.app_id, enabled=True)
    assert not harness.service.list_apps(harness.identity, ConsumerAppsQuery()).data
    favorites = harness.service.list_apps(harness.identity, ConsumerAppsQuery(view="favorites"))
    assert favorites.data[0].last_used_at is None
    with base.sessions.begin() as session:
        run = new_consumer_run(base, created_at=datetime(2026, 10, 30))
        session.add(run)
        session.flush()
        run_id = run.id
    assert harness.service.list_apps(harness.identity, ConsumerAppsQuery()).data[0].last_used_at == run.created_at
    with base.sessions.begin() as session:
        session.execute(sa.delete(WorkflowRun).where(WorkflowRun.id == run_id))
    assert not harness.service.list_apps(harness.identity, ConsumerAppsQuery()).data
    assert harness.service.list_apps(harness.identity, ConsumerAppsQuery(view="favorites")).data[0].last_used_at is None


@pytest.mark.parametrize("mismatch", ["tenant", "app", "role", "source", "account", "guest", "type"])
def test_recent_usage_requires_the_complete_passport_execution_owner_chain(
    harness: ConsumerHarness, mismatch: str
) -> None:
    base = harness.oauth.base
    now = datetime(2026, 10, 30)
    with base.sessions.begin() as session:
        session.add(new_consumer_run(base, created_at=now))
        unrelated = new_consumer_run(base, created_at=now + timedelta(days=1))
        if mismatch == "tenant":
            unrelated.tenant_id = str(uuid4())
        elif mismatch == "app":
            unrelated.app_id = str(uuid4())
        elif mismatch == "role":
            unrelated.created_by_role = CreatorUserRole.ACCOUNT
        elif mismatch == "source":
            unrelated.triggered_from = WorkflowRunTriggeredFrom.DEBUGGING
        else:
            account_id = None
            if mismatch == "type":
                account_id = harness.identity.account_id
            elif mismatch == "account":
                account_id = str(uuid4())
            user = EndUser(
                tenant_id=base.context.tenant_id,
                app_id=base.context.app_id,
                type=EndUserType.SERVICE_API if mismatch == "type" else EndUserType.BROWSER,
                account_id=account_id,
                session_id=str(uuid4()),
            )
            session.add(user)
            unrelated.created_by = user.id
        session.add(unrelated)
    result = harness.service.list_apps(harness.identity, ConsumerAppsQuery())
    assert [app.id for app in result.data] == [base.context.app_id]
    assert result.data[0].last_used_at == now


def test_connection_queries_do_not_decrypt_or_expose_foreign_and_guest_credentials(harness: ConsumerHarness) -> None:
    base = harness.oauth.base
    owned = base.service.create_api_key(base.context, base.command())
    foreign = replace(new_connection(), tenant_id=base.context.tenant_id, account_id=str(uuid4()))
    guest = replace(new_connection(), tenant_id=base.context.tenant_id, account_id=None, end_user_id=str(uuid4()))
    with base.sessions.begin() as session:
        session.add_all([foreign, guest])
        session.add(
            AppConnection(
                tenant_id=base.context.tenant_id,
                app_id=base.context.app_id,
                workflow_id=base.workflow_id,
                node_id="tool-1",
                end_user_id=base.context.end_user_id,
                provider=owned.provider,
                connection_id=owned.id,
            )
        )
    result = harness.service.list_connections(harness.identity, provider=None, cursor=None, limit=20)
    assert [entry.key for entry in result.data] == [consumer_connection_key(owned)]
    assert result.data[0].webapps_count == 1
    apps = harness.service.list_connection_apps(harness.identity, result.data[0].key, cursor=None, limit=20)
    assert [app.id for app in apps.data] == [base.context.app_id]
    assert "original-secret" not in result.model_dump_json()
    for connection in (foreign, guest, new_connection()):
        with pytest.raises(ConnectionNotFoundError):
            harness.service.delete_connection(harness.identity, consumer_connection_key(connection))
        with pytest.raises(ConnectionNotFoundError):
            harness.service.list_connection_apps(
                harness.identity, consumer_connection_key(connection), cursor=None, limit=20
            )
    harness.access.denied.add(base.context.app_id)
    result = harness.service.list_connections(harness.identity, provider=None, cursor=None, limit=20)
    assert result.data[0].webapps_count == 0
    assert not harness.service.list_connection_apps(harness.identity, result.data[0].key, cursor=None, limit=20).data


def test_orphan_connection_can_be_disconnected_without_app(harness: ConsumerHarness) -> None:
    base = harness.oauth.base
    owned = base.service.create_api_key(base.context, base.command())
    context = harness.service.connection_context(harness.identity, owned.id)
    assert isinstance(context, AccountConnectionContext)
    with base.sessions.begin() as session:
        session.execute(sa.delete(EndUser).where(EndUser.id == base.context.end_user_id))
        session.execute(sa.delete(App).where(App.id == base.context.app_id))
    result = harness.service.list_connections(harness.identity, provider=None, cursor=None, limit=20)
    assert [entry.key for entry in result.data] == [consumer_connection_key(owned)]
    harness.service.delete_connection(harness.identity, consumer_connection_key(owned))
    with base.sessions() as session:
        assert session.get(EndUserConnection, owned.id) is None


def test_disconnect_rejects_foreign_connections_without_calling_revoke(harness: ConsumerHarness) -> None:
    base = harness.oauth.base
    with base.sessions.begin() as session:
        foreign = replace(new_connection(), tenant_id=base.context.tenant_id, account_id=str(uuid4()))
        session.add(foreign)
    with pytest.raises(ConnectionNotFoundError):
        harness.service.delete_connection(harness.identity, consumer_connection_key(foreign))
    assert base.auth.revocations == []


def test_disconnect_oauth_connection_revokes_original_grant_without_app(harness: ConsumerHarness) -> None:
    base = harness.oauth.base
    connection = harness.oauth.finish(harness.oauth.start())
    with base.sessions.begin() as session:
        session.execute(sa.delete(App).where(App.id == base.context.app_id))
        session.execute(sa.delete(EndUser).where(EndUser.id == base.context.end_user_id))
    harness.service.delete_connection(harness.identity, consumer_connection_key(connection))
    with base.sessions() as session:
        assert session.get(EndUserConnection, connection.id) is None
    assert len(base.auth.revocations) == 1
    assert base.auth.revocations[0][1] == harness.identity.account_id


@pytest.mark.parametrize("same_time", [False, True])
def test_recent_pagination_fills_pages_after_denials_and_handles_equal_timestamps(
    harness: ConsumerHarness, same_time: bool
) -> None:
    base = harness.oauth.base
    bases = [base]
    for _ in range(5):
        other = make_harness(base.sessions)
        bases.append(other)
        with base.sessions.begin() as session:
            session.add(
                Site(
                    app_id=other.context.app_id,
                    title="Another App",
                    default_language="en-US",
                    customize_token_strategy=CustomizeTokenStrategy.NOT_ALLOW,
                    code=str(uuid4()),
                )
            )
    passports = WebPassportRepository(session_factory=base.sessions, generate_session_id=lambda: str(uuid4()))
    moment = datetime(2026, 10, 30)
    used_at_by_app: dict[str, datetime] = {}
    for index, item in enumerate(bases):
        with base.sessions() as session:
            code = session.scalar(sa.select(Site.code).where(Site.app_id == item.context.app_id))
            assert code is not None
        app = passports.get_active_web_app(code)
        assert app is not None
        resolution = passports.resolve_account_end_user(app, harness.identity.account_id)
        assert resolution.end_user is not None
        with base.sessions.begin() as session:
            used_at = moment if same_time else moment + timedelta(minutes=index)
            used_at_by_app[item.context.app_id] = used_at
            run = new_consumer_run(item, created_at=used_at)
            run.created_by = resolution.end_user.id
            session.add(run)
    app_ids = [item.context.app_id for item in bases]
    app_ids.sort(key=lambda app_id: (-used_at_by_app[app_id].timestamp(), app_id))
    harness.access.denied.update(app_ids[:2])
    first = harness.service.list_apps(harness.identity, ConsumerAppsQuery(limit=2))
    assert [app.id for app in first.data] == app_ids[2:4]
    assert first.has_more
    second = harness.service.list_apps(harness.identity, ConsumerAppsQuery(limit=2, cursor=first.next_cursor))
    assert [app.id for app in second.data] == app_ids[4:]
    assert not second.has_more
    assert second.next_cursor is None
    with pytest.raises(ValueError, match="cursor"):
        harness.service.list_apps(ConsumerIdentity(str(uuid4())), ConsumerAppsQuery(cursor=first.next_cursor))
    with pytest.raises(ValueError, match="cursor"):
        harness.service.list_apps(harness.identity, ConsumerAppsQuery(view="favorites", cursor=first.next_cursor))


def test_connections_paginate_across_tenants_without_merging_provider_names(harness: ConsumerHarness) -> None:
    base = harness.oauth.base
    rows = [replace(new_connection(), tenant_id=str(uuid4()), account_id=harness.identity.account_id) for _ in range(3)]
    with base.sessions.begin() as session:
        session.add_all(rows)
    first = harness.service.list_connections(harness.identity, provider=None, cursor=None, limit=2)
    second = harness.service.list_connections(harness.identity, provider=None, cursor=first.next_cursor, limit=2)
    assert len(first.data) == 2
    assert first.has_more
    assert len(second.data) == 1
    assert not second.has_more
    assert {row.key for row in (*first.data, *second.data)} == {consumer_connection_key(row) for row in rows}
