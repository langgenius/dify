"""Account-scoped Connection grouping, associated Apps and group disconnects."""

from dataclasses import replace
from uuid import uuid4

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session, sessionmaker

from constants.end_user_connections import ConnectionCredentialType, OAuthClientSource
from models.end_user_connection import AppConnection, EndUserConnection, SessionConnection
from models.enums import CustomizeTokenStrategy
from models.model import App, Site
from services.end_user_connections.errors import ConnectionNotFoundError
from tests.helpers.consumer import ConsumerHarness, consumer_connection_key, make_consumer_harness
from tests.helpers.end_user_api_key import ConnectionHarness, make_harness
from tests.helpers.end_user_connection_contract import new_connection


@pytest.fixture
def harness(sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch) -> ConsumerHarness:
    return make_consumer_harness(sqlite_session_factory, monkeypatch)


def _oauth_row(harness: ConsumerHarness, *, tenant_id: str, label: str | None) -> EndUserConnection:
    return replace(
        new_connection(),
        account_id=harness.identity.account_id,
        tenant_id=tenant_id,
        credential_type=ConnectionCredentialType.OAUTH2,
        oauth_client_source=OAuthClientSource.WORKSPACE,
        account_label=label,
    )


def _selection(connection: EndUserConnection, base: ConnectionHarness, *, node_id: str) -> AppConnection:
    return AppConnection(
        tenant_id=base.context.tenant_id,
        app_id=base.context.app_id,
        workflow_id=base.workflow_id,
        end_user_id=base.context.end_user_id,
        node_id=node_id,
        provider=connection.provider,
        connection_id=connection.id,
    )


def test_groups_merge_across_tenants_and_deduplicate_accessible_webapps(harness: ConsumerHarness) -> None:
    base = harness.oauth.base
    other = make_harness(base.sessions)
    first = _oauth_row(harness, tenant_id=base.context.tenant_id, label="al***@example.com")
    duplicate = replace(first, name="Another name")
    cross_tenant = replace(first, tenant_id=other.context.tenant_id)
    foreign = replace(first, account_id=str(uuid4()))
    guest = replace(first, account_id=None, end_user_id=str(uuid4()))
    provider = replace(first, provider="vendor/other/calendar")
    without_label = [replace(first, account_label=label) for label in (None, "")]
    api_key = replace(new_connection(), account_id=harness.identity.account_id)
    with base.sessions.begin() as session:
        session.add_all([first, duplicate, cross_tenant, foreign, guest, provider, *without_label, api_key])
        session.add(
            Site(
                app_id=other.context.app_id,
                title="Other App",
                default_language="en-US",
                customize_token_strategy=CustomizeTokenStrategy.NOT_ALLOW,
                code=str(uuid4()),
            )
        )
        session.add_all(
            [
                _selection(first, base, node_id="one"),
                _selection(duplicate, base, node_id="two"),
                _selection(cross_tenant, other, node_id="one"),
                SessionConnection(
                    tenant_id=base.context.tenant_id,
                    app_id=base.context.app_id,
                    workflow_id=base.workflow_id,
                    node_id="one",
                    session_id=str(uuid4()),
                    provider=first.provider,
                    connection_id=first.id,
                ),
            ]
        )

    page = harness.service.list_connections(harness.identity, provider=None, cursor=None, limit=20)
    assert len(page.data) == 5
    representative = min((first, duplicate, cross_tenant), key=lambda row: row.id)
    key = consumer_connection_key(representative)
    group = next(item for item in page.data if item.key == key)
    assert group.webapps_count == 2
    assert group.name == representative.name
    assert group.connection_type == ConnectionCredentialType.OAUTH2
    assert group.account_label == first.account_label
    for connection in without_label:
        assert consumer_connection_key(connection) in {item.key for item in page.data}
        assert base.repository.account_connection_group(harness.identity, connection.id).connection_id is not None
    assert all(len(str(item.key)) == 36 for item in page.data)

    app_ids = sorted((base.context.app_id, other.context.app_id))
    apps = harness.service.list_connection_apps(harness.identity, key, cursor=None, limit=1)
    assert [app.id for app in apps.data] == app_ids[:1]
    assert apps.has_more
    rest = harness.service.list_connection_apps(harness.identity, key, cursor=apps.next_cursor, limit=1)
    assert [app.id for app in rest.data] == app_ids[1:]
    assert not rest.has_more

    seen = []
    cursor = None
    for _ in range(5):
        current = harness.service.list_connections(harness.identity, provider=None, cursor=cursor, limit=1)
        seen.extend(current.data)
        cursor = current.next_cursor
        if not current.has_more:
            break
    assert len(seen) == len({item.key for item in seen}) == 5
    assert next(item for item in seen if item.key == key).webapps_count == 2
    assert cursor is None

    harness.access.denied.add(other.context.app_id)
    page = harness.service.list_connections(harness.identity, provider=first.provider, cursor=None, limit=20)
    assert next(item for item in page.data if item.key == key).webapps_count == 1
    assert all(item.provider == first.provider for item in page.data)
    assert [
        app.id for app in harness.service.list_connection_apps(harness.identity, key, cursor=None, limit=20).data
    ] == [base.context.app_id]
    with base.sessions.begin() as session:
        session.execute(sa.update(App).where(App.id == base.context.app_id).values(enable_site=False))
    assert not harness.service.list_connection_apps(harness.identity, key, cursor=None, limit=20).data


def test_group_disconnect_removes_all_members_and_revokes_each_owned_oauth_grant(harness: ConsumerHarness) -> None:
    base = harness.oauth.base
    created = harness.oauth.finish(harness.oauth.start())
    with base.sessions.begin() as session:
        original = session.get(EndUserConnection, created.id)
        assert original is not None
        duplicate = replace(original, name="Second Connection")
        foreign = replace(original, account_id=str(uuid4()))
        guest = replace(original, account_id=None, end_user_id=str(uuid4()))
        session.add_all([duplicate, foreign, guest])
    key = consumer_connection_key(created)
    page = harness.service.list_connections(harness.identity, provider=None, cursor=None, limit=20)
    assert [str(item.key) for item in page.data] == [min(created.id, duplicate.id)]
    harness.service.delete_connection(harness.identity, consumer_connection_key(duplicate))
    with base.sessions() as session:
        assert set(session.scalars(sa.select(EndUserConnection.id))) == {foreign.id, guest.id}
    assert len(base.auth.revocations) == 2
    assert not harness.service.list_connections(harness.identity, provider=None, cursor=None, limit=20).data
    with pytest.raises(ConnectionNotFoundError):
        harness.service.list_connection_apps(harness.identity, key, cursor=None, limit=20)


def test_any_owned_member_resolves_the_group_and_refresh_replaces_a_deleted_key(harness: ConsumerHarness) -> None:
    base = harness.oauth.base
    members = [_oauth_row(harness, tenant_id=base.context.tenant_id, label="al***") for _ in range(2)]
    members.sort(key=lambda row: row.id)
    with base.sessions.begin() as session:
        session.add_all(members)
    key = consumer_connection_key(members[0])
    assert (
        harness.service.list_connection_apps(
            harness.identity, consumer_connection_key(members[1]), cursor=None, limit=20
        ).data
        == ()
    )
    with base.sessions.begin() as session:
        session.execute(sa.delete(EndUserConnection).where(EndUserConnection.id == min(row.id for row in members)))
    page = harness.service.list_connections(harness.identity, provider=None, cursor=None, limit=20)
    assert [item.key for item in page.data] == [consumer_connection_key(members[1])]
    with pytest.raises(ConnectionNotFoundError):
        harness.service.delete_connection(harness.identity, key)
    cursor = base.repository.account_connection_group(harness.identity, members[1].id).encode()
    with pytest.raises(ValueError, match="cursor"):
        harness.service.list_connections(harness.identity, provider="vendor/other/calendar", cursor=cursor, limit=20)


@pytest.mark.parametrize("key", ["invalid", "W10", "bnVsbA", "e30", "Li4vLi4v", ""])
def test_malformed_group_cursors_cannot_query_connections(harness: ConsumerHarness, key: str) -> None:
    with pytest.raises(ValueError, match="group key"):
        harness.service.list_connections(harness.identity, provider=None, cursor=key, limit=20)
