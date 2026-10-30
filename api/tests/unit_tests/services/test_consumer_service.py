"""Consumer identity, ownership, usage and access-policy behavior with real persistence."""

from dataclasses import replace
from datetime import datetime, timedelta
from uuid import uuid4

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session, sessionmaker

from models.account import Account, AccountStatus, TenantAccountJoin
from models.consumer import AccountAppUsage
from models.end_user_connection import AppConnection, EndUserConnection
from models.enums import CustomizeTokenStrategy
from models.model import App, AppStar, EndUser, Site
from services.consumer_service import ConsumerAppNotFoundError, ConsumerAppsQuery, ConsumerIdentity
from services.end_user_connections.contracts import UpdateConnectionInput
from services.end_user_connections.entities import AccountConnectionContext
from services.end_user_connections.errors import ConnectionConflictError, ConnectionNotFoundError
from services.web_identity_service import WebIdentityError
from tests.helpers.consumer import ConsumerHarness, make_consumer_harness
from tests.helpers.end_user_api_key import make_harness
from tests.helpers.end_user_connection_contract import new_connection


@pytest.fixture
def harness(sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch) -> ConsumerHarness:
    return make_consumer_harness(sqlite_session_factory, monkeypatch)


def test_account_authentication_does_not_provision_workspace(harness: ConsumerHarness) -> None:
    assert harness.service.authenticate(harness.token()) == harness.identity
    with harness.oauth.base.sessions() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(TenantAccountJoin)) == 0


@pytest.mark.parametrize("source", ["webapp", "webapp_account", "webapp_login_token", "unknown"])
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


def test_favorites_and_recent_are_account_scoped_and_recheck_access(harness: ConsumerHarness) -> None:
    base = harness.oauth.base
    app_id = base.context.app_id
    for _ in range(2):
        harness.service.set_favorite(harness.identity, app_id, enabled=True)
    now = datetime(2026, 10, 30, 10)
    for moment in (now, now - timedelta(days=1), now + timedelta(hours=1)):
        harness.service.record_usage(harness.identity, tenant_id=base.context.tenant_id, app_id=app_id, used_at=moment)
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
        assert session.scalar(sa.select(sa.func.count()).select_from(AccountAppUsage)) == 1
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
    assert [entry.connection.id for entry in result.data] == [owned.id]
    assert [app.id for app in result.data[0].apps] == [base.context.app_id]
    assert "original-secret" not in result.model_dump_json()
    for id_ in (foreign.id, guest.id, str(uuid4())):
        with pytest.raises(ConnectionNotFoundError):
            harness.service.get_connection(harness.identity, id_)
    harness.access.denied.add(base.context.app_id)
    assert harness.service.get_connection(harness.identity, owned.id).apps == ()


def test_orphan_connection_can_be_repaired_and_deleted_without_app(harness: ConsumerHarness) -> None:
    base = harness.oauth.base
    owned = base.service.create_api_key(base.context, base.command())
    context = harness.service.connection_context(harness.identity, owned.id)
    assert isinstance(context, AccountConnectionContext)
    revision = harness.service.connection_revision(harness.identity, owned.id).connection_revision
    with base.sessions.begin() as session:
        session.execute(sa.delete(EndUser).where(EndUser.id == base.context.end_user_id))
        session.execute(sa.delete(App).where(App.id == base.context.app_id))
    assert harness.service.get_connection(harness.identity, owned.id).connection.id == owned.id
    updated = harness.service.update_connection(
        harness.identity,
        owned.id,
        UpdateConnectionInput(
            name="Repaired",
            credentials={"api_key": "replacement-secret"},
            connection_revision=revision,
        ),
    )
    assert updated.name == "Repaired"
    harness.service.delete_connection(harness.identity, owned.id)
    with base.sessions() as session:
        assert session.get(EndUserConnection, owned.id) is None


def test_changed_owner_during_external_check_cannot_overwrite_credentials(harness: ConsumerHarness) -> None:
    base = harness.oauth.base
    owned = base.service.create_api_key(base.context, base.command())
    revision = harness.service.connection_revision(harness.identity, owned.id).connection_revision

    def change_owner() -> None:
        with base.sessions.begin() as session:
            session.execute(
                sa.update(EndUserConnection).where(EndUserConnection.id == owned.id).values(account_id=str(uuid4()))
            )

    base.auth.on_check = change_owner
    with pytest.raises((ConnectionNotFoundError, ConnectionConflictError)):
        harness.service.update_connection(
            harness.identity,
            owned.id,
            UpdateConnectionInput(
                credentials={"api_key": "uncommitted-secret"},
                connection_revision=revision,
            ),
        )
    with base.sessions() as session:
        row = session.get(EndUserConnection, owned.id)
        assert row is not None
        assert "uncommitted-secret" not in row.encrypted_credentials


def test_account_oauth_reauthorization_survives_app_deletion_and_rejects_replay(harness: ConsumerHarness) -> None:
    oauth = harness.oauth
    base = oauth.base
    created = oauth.finish(oauth.start())
    revision = harness.service.connection_revision(harness.identity, created.id).connection_revision
    start = harness.service.reauthorize(
        harness.identity,
        created.id,
        connection_revision=revision,
        callback_url="https://console.example/me/oauth",
    )
    with base.sessions.begin() as session:
        session.execute(sa.delete(App).where(App.id == base.context.app_id))
        session.execute(sa.delete(EndUser).where(EndUser.id == base.context.end_user_id))
    reauthorized = oauth.finish(start)
    assert reauthorized.id == created.id
    from services.end_user_connections.errors import ConnectionOAuthError

    with pytest.raises(ConnectionOAuthError):
        oauth.finish(start)
    harness.service.delete_connection(harness.identity, created.id)
    assert base.auth.revocations


def test_recent_pagination_fills_pages_after_denials_and_handles_equal_timestamps(harness: ConsumerHarness) -> None:
    base = harness.oauth.base
    app_ids = [base.context.app_id]
    for _ in range(5):
        other = make_harness(base.sessions)
        app_ids.append(other.context.app_id)
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
    moment = datetime(2026, 10, 30)
    for app_id in app_ids:
        with base.sessions() as session:
            app = session.get(App, app_id)
            assert app is not None
            tenant_id = app.tenant_id
        harness.service.record_usage(harness.identity, tenant_id=tenant_id, app_id=app_id, used_at=moment)
    app_ids.sort()
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
    assert {row.connection.id for row in (*first.data, *second.data)} == {row.id for row in rows}
