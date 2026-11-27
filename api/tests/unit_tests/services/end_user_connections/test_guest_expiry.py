"""Exercise expiry with persisted owners, real cascades and the pinned OAuth gateway."""

import logging
from collections.abc import Callable
from dataclasses import replace
from datetime import datetime, timedelta
from sqlite3 import Connection as SQLiteConnection
from uuid import uuid4

import pytest
import sqlalchemy as sa
from sqlalchemy import event
from sqlalchemy.orm import Session, sessionmaker

from clients.plugin.auth_entities import OAuthRevokeResult
from context.connection_execution import ConnectionExecutionContext, ExecutionConnectionSelection
from extensions.ext_redis import redis_client
from graphon.enums import WorkflowExecutionStatus
from models.end_user_connection import AppConnection, EndUserConnection, SessionConnection
from models.enums import CreatorUserRole, EndUserType, WorkflowRunTriggeredFrom
from models.model import EndUser
from models.workflow import WorkflowRun, WorkflowType
from repositories.web_migration_repository import WebMigrationRepository
from services.end_user_connection_oauth_adapters import RedisOAuthRefreshSingleFlight
from services.end_user_connections.contracts import ListConnectionsInput, UpdateConnectionInput
from services.end_user_connections.entities import ConnectionManagementContext, WebConnectionContext
from services.end_user_connections.guest_expiry import GuestConnectionExpiryService
from services.end_user_connections.management import StoredConnection
from services.end_user_connections.oauth_lifecycle import OAuthConnectionLifecycleService
from tests.helpers.end_user_api_key import PROVIDER
from tests.helpers.end_user_connection_contract import new_connection
from tests.helpers.end_user_oauth import OAuthHarness, make_oauth_harness

_NOW = datetime(2026, 11, 18, 12)
_RETENTION = timedelta(days=30)
_CUTOFF = _NOW - _RETENTION
_OLD = _CUTOFF - timedelta(days=1)


@pytest.fixture
def harness(
    sqlite_engine: sa.Engine,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
) -> OAuthHarness:
    """Enable real cascades and admit both Guest and Account Passports."""

    @event.listens_for(sqlite_engine, "connect")
    def enable_cascades(connection: SQLiteConnection, _record: object) -> None:
        connection.execute("PRAGMA foreign_keys=ON")

    config_overrides(WEBAPP_ACCOUNT_PASSPORT_ENABLED=True, END_USER_AUTH_ALLOW_ANONYMOUS=True)
    return make_oauth_harness(sqlite_session_factory, monkeypatch)


def _guest(harness: OAuthHarness) -> WebConnectionContext:
    """Keep the Account EndUser available as a migration target."""
    context = harness.base.context
    user = EndUser(
        tenant_id=context.tenant_id, app_id=context.app_id, type=EndUserType.BROWSER, session_id=str(uuid4())
    )
    with harness.base.sessions.begin() as session:
        session.add(user)
    return replace(context, end_user_id=user.id, account_id=None)


def _backdate(harness: OAuthHarness, connection_id: str, activity: datetime = _OLD) -> None:
    """Seed an old activity time without running the clock backward."""
    with harness.base.sessions.begin() as session:
        row = session.get(EndUserConnection, connection_id)
        assert row is not None
        row.last_active_at = activity


def _sweep(harness: OAuthHarness) -> None:
    """Run real cleanup with one-row pages; only the external revocation call is scripted."""
    GuestConnectionExpiryService(
        store=harness.base.repository,
        oauth=OAuthConnectionLifecycleService(
            store=harness.base.repository,
            gateway=harness.gateway,
            cipher=harness.base.cipher,
            refreshes=RedisOAuthRefreshSingleFlight(redis=redis_client),
        ),
        inactivity=_RETENTION,
        batch_size=1,
        clock=lambda: _NOW,
    ).run()


def test_expiry_removes_live_choices_only_and_keeps_fixed_run_references(harness: OAuthHarness) -> None:
    base = harness.base
    guest = _guest(harness)
    expired = base.service.create_api_key(guest, base.command())
    at_boundary = base.service.create_api_key(guest, base.command())
    same_provider = base.service.create_api_key(guest, base.command())
    account = base.service.create_api_key(base.context, base.command())
    for connection, activity in [(expired, _OLD), (at_boundary, _CUTOFF), (same_provider, _NOW), (account, _OLD)]:
        _backdate(harness, connection.id, activity)

    service_user = EndUser(
        tenant_id=guest.tenant_id, app_id=guest.app_id, type=EndUserType.SERVICE_API, session_id=str(uuid4())
    )
    service_connection = replace(
        new_connection(),
        tenant_id=guest.tenant_id,
        account_id=None,
        end_user_id=service_user.id,
        last_active_at=_OLD,
    )
    unrelated_tenant = replace(service_connection, tenant_id=str(uuid4()), end_user_id=guest.end_user_id)
    session_id = str(uuid4())
    choices = {
        "tenant_id": guest.tenant_id,
        "app_id": guest.app_id,
        "workflow_id": base.workflow_id,
        "provider": PROVIDER,
    }
    pinned = ConnectionExecutionContext(
        tenant_id=guest.tenant_id,
        app_id=guest.app_id,
        end_user_id=guest.end_user_id,
        account_id=None,
        workflow_id=base.workflow_id,
        connection_revision=base.connection_revision,
        selections=(ExecutionConnectionSelection(node_id="tool-1", provider=PROVIDER, connection_id=expired.id),),
    ).model_dump_json()
    run = WorkflowRun(
        tenant_id=guest.tenant_id,
        app_id=guest.app_id,
        workflow_id=base.workflow_id,
        type=WorkflowType.WORKFLOW,
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        version="published",
        status=WorkflowExecutionStatus.SUCCEEDED,
        created_by_role=CreatorUserRole.END_USER,
        created_by=guest.end_user_id,
        connection_context=pinned,
    )
    with base.sessions.begin() as session:
        session.add_all([service_user, service_connection, unrelated_tenant, run])
        for node, connection in [("tool-1", expired), ("tool-2", same_provider)]:
            session.add_all(
                [
                    AppConnection(**choices, node_id=node, end_user_id=guest.end_user_id, connection_id=connection.id),
                    SessionConnection(**choices, node_id=node, session_id=session_id, connection_id=connection.id),
                ]
            )
    base.auth.calls.clear()
    _sweep(harness)
    _sweep(harness)  # Redelivery cannot replace defaults or repeat Provider operations.
    with base.sessions() as session:
        assert session.get(EndUserConnection, expired.id) is None
        assert session.get(EndUserConnection, service_connection.id) is not None
        assert session.get(EndUserConnection, unrelated_tenant.id) is not None
        assert session.get(EndUserConnection, at_boundary.id) is not None
        assert session.get(EndUserConnection, account.id) is not None
        for model in (AppConnection, SessionConnection):
            remaining = session.execute(sa.select(model.node_id, model.connection_id)).all()
            assert remaining == [("tool-2", same_provider.id)]
        persisted_run = session.get(WorkflowRun, run.id)
        assert persisted_run is not None
        assert persisted_run.connection_context == pinned
    assert base.auth.calls == []
    assert base.auth.revocations == []


def test_stale_candidate_is_rechecked_after_activity_and_reads_do_not_touch_it(harness: OAuthHarness) -> None:
    base = harness.base
    guest = _guest(harness)
    connection = base.service.create_api_key(guest, base.command())
    assert connection.last_active_at is not None
    assert connection.last_active_at >= connection.created_at
    _backdate(harness, connection.id)
    (candidate,) = base.repository.inactive_guests(before=_CUTOFF, after=None, limit=1)
    assert base.service.get_connection(guest, connection.id).last_active_at == _OLD
    assert base.service.list_connections(guest, ListConnectionsInput()).data[0].last_active_at == _OLD
    base.service.check_connection_result(guest, connection.id, connection_revision=base.connection_revision)
    assert base.service.get_connection(guest, connection.id).last_active_at == _OLD

    renamed = base.service.update_connection(guest, connection.id, UpdateConnectionInput(name="Renamed"))
    assert renamed.last_active_at is not None
    assert renamed.last_active_at > _OLD
    assert base.repository.expire_guest(candidate, before=_CUTOFF) is None
    assert base.service.get_connection(guest, connection.id) == renamed
    replaced = base.service.update_connection(
        guest,
        connection.id,
        UpdateConnectionInput(credentials={"api_key": "rotated-key"}, connection_revision=base.connection_revision),
    )
    assert replaced.last_active_at is not None
    assert replaced.last_active_at >= renamed.last_active_at


def test_oauth_expiry_uses_the_original_grant_after_commit(
    harness: OAuthHarness, caplog: pytest.LogCaptureFixture
) -> None:
    base = harness.base
    account = base.context
    guest = _guest(harness)
    base.context = guest
    connection = harness.finish(harness.start())
    _backdate(harness, connection.id)
    migration = WebMigrationRepository(session_factory=base.sessions)
    source = migration.get_claim_source(app_code=harness.app_code, app_id=guest.app_id, end_user_id=guest.end_user_id)
    assert source is not None
    assert source.connection_count == 1

    claimed_counts = []

    def during_revoke() -> None:
        with base.sessions() as session:
            assert session.get(EndUserConnection, connection.id) is None
        # The delete has committed, so the Provider call holds no write transaction
        # and the row can no longer be claimed by a concurrent writer.
        claimed_counts.append(migration.claim_guest(source, account_end_user_id=account.end_user_id).connections)

    base.auth.on_revoke = during_revoke
    with caplog.at_level(logging.INFO):
        _sweep(harness)
        _sweep(harness)
    assert claimed_counts == [0]
    assert len(base.auth.revocations) == 1
    assert base.auth.revocations[0][0:3] == (guest.tenant_id, guest.end_user_id, PROVIDER)
    assert base.auth.revocations[0][4]["access_token"] == "access-secret"
    assert "access-secret" not in caplog.text
    with base.sessions() as session:
        assert session.get(EndUserConnection, connection.id) is None


@pytest.mark.parametrize(
    ("outcome", "expects_warning"),
    [("revoked", False), ("unsupported", False), ("failed", True), ("temporarily_unavailable", True)],
)
def test_revocation_outcomes_never_restore_or_block_local_deletion(
    harness: OAuthHarness, caplog: pytest.LogCaptureFixture, outcome: str, expects_warning: bool
) -> None:
    """A provider result is terminal: the grant stays deleted and the sweep completes."""
    base = harness.base
    base.context = _guest(harness)
    connection = harness.finish(harness.start())
    _backdate(harness, connection.id)
    base.auth.revoke_result = OAuthRevokeResult.model_validate(
        {"status": outcome, "reason_code": None, "retryable": False}
    )
    with caplog.at_level(logging.WARNING):
        _sweep(harness)
    assert len(base.auth.revocations) == 1
    assert ("revocation incomplete" in caplog.text) is expects_warning
    with base.sessions() as session:
        assert session.get(EndUserConnection, connection.id) is None


def test_revocation_transport_failure_is_logged_without_secrets(
    harness: OAuthHarness, caplog: pytest.LogCaptureFixture
) -> None:
    base = harness.base
    base.context = _guest(harness)
    connection = harness.finish(harness.start())
    _backdate(harness, connection.id)

    def explode() -> None:
        raise ValueError("the upstream error echoes access-secret")

    base.auth.on_revoke = explode
    with caplog.at_level(logging.WARNING):
        _sweep(harness)
        _sweep(harness)
    assert "access-secret" not in caplog.text
    assert "Pinned OAuth revocation unavailable" in caplog.text
    assert len(base.auth.revocations) == 1
    with base.sessions() as session:
        assert session.get(EndUserConnection, connection.id) is None


def test_unexpected_revoker_exception_is_a_warning_after_local_deletion(
    harness: OAuthHarness, caplog: pytest.LogCaptureFixture
) -> None:
    """An exception escaping the revocation port neither fails the sweep nor leaks its details."""
    base = harness.base
    base.context = _guest(harness)
    connection = harness.finish(harness.start())
    _backdate(harness, connection.id)

    attempts: list[tuple[ConnectionManagementContext, str]] = []

    class FailingRevoker:
        def revoke_deleted(self, context: ConnectionManagementContext, record: StoredConnection) -> None:
            attempts.append((context, record.access.id))
            raise RuntimeError("sensitive-provider-detail")

    expiry = GuestConnectionExpiryService(
        store=base.repository,
        oauth=FailingRevoker(),
        inactivity=_RETENTION,
        batch_size=1,
        clock=lambda: _NOW,
    )
    logger_name = "services.end_user_connections.guest_expiry"
    with caplog.at_level(logging.WARNING, logger=logger_name):
        expiry.run()
        expiry.run()

    assert attempts == [(base.context, connection.id)]
    assert [record for record in caplog.record_tuples if record[0] == logger_name] == [
        (
            logger_name,
            logging.WARNING,
            "Guest Connection deleted locally; best-effort OAuth revocation did not complete: "
            f"connection_id={connection.id}",
        ),
    ]
    assert "sensitive-provider-detail" not in caplog.text
    with base.sessions() as session:
        assert session.get(EndUserConnection, connection.id) is None


def test_claim_winner_cannot_be_revoked_even_from_a_preclaim_scan(harness: OAuthHarness) -> None:
    base = harness.base
    account = base.context
    guest = _guest(harness)
    base.context = guest
    connection = harness.finish(harness.start())
    _backdate(harness, connection.id)
    (candidate,) = base.repository.inactive_guests(before=_CUTOFF, after=None, limit=1)
    migration = WebMigrationRepository(session_factory=base.sessions)
    source = migration.get_claim_source(app_code=harness.app_code, app_id=guest.app_id, end_user_id=guest.end_user_id)
    assert source is not None
    assert migration.claim_guest(source, account_end_user_id=account.end_user_id).connections == 1
    assert base.repository.expire_guest(candidate, before=_CUTOFF) is None
    _sweep(harness)
    assert base.auth.revocations == []
    with base.sessions() as session:
        kept = session.get(EndUserConnection, connection.id)
        assert kept is not None
        assert kept.account_id == account.account_id
        assert kept.last_active_at == _OLD


def test_automatic_oauth_refresh_does_not_extend_activity_but_reauthorization_does(harness: OAuthHarness) -> None:
    base = harness.base
    base.context = _guest(harness)
    connection = harness.finish(harness.start())
    assert connection.last_active_at is not None
    assert connection.last_active_at >= connection.created_at
    assert not connection.manual_revocation_required_on_expiry
    _backdate(harness, connection.id)
    with base.sessions.begin() as session:
        row = session.get(EndUserConnection, connection.id)
        assert row is not None
        row.expires_at = datetime(2000, 1, 1)
    base.service.check_connection_result(base.context, connection.id, connection_revision=base.connection_revision)
    assert len(harness.handler.refreshes) == 1
    assert base.service.get_connection(base.context, connection.id).last_active_at == _OLD

    attempt = harness.service.reauthorize_oauth(
        base.context,
        connection.id,
        callback_url="http://web-api.example/api/connections/oauth",
        connection_revision=base.connection_revision,
    )
    updated = harness.finish(attempt)
    assert updated.id == connection.id
    assert updated.last_active_at is not None
    assert updated.last_active_at > _OLD


def test_failed_deletion_rolls_back_one_connection_and_does_not_block_later_pages(
    harness: OAuthHarness, caplog: pytest.LogCaptureFixture
) -> None:
    base = harness.base
    base.context = _guest(harness)
    oauth = harness.finish(harness.start())
    api_key = base.service.create_api_key(base.context, base.command())
    _backdate(harness, oauth.id, _OLD - timedelta(days=1))
    _backdate(harness, api_key.id)
    with base.sessions.begin() as session:
        session.execute(
            sa.text(
                "CREATE TRIGGER reject_guest_expiry BEFORE DELETE ON end_user_connections "
                f"WHEN OLD.id = '{oauth.id}' BEGIN SELECT RAISE(ABORT, 'sensitive-db-detail'); END"
            )
        )
    with caplog.at_level(logging.ERROR):
        _sweep(harness)
    assert base.auth.revocations == []
    assert f"expiry failed: connection_id={oauth.id}" in caplog.text
    assert "sensitive-db-detail" not in caplog.text
    with base.sessions.begin() as session:
        assert session.get(EndUserConnection, oauth.id) is not None
        assert session.get(EndUserConnection, api_key.id) is None
        session.execute(sa.text("DROP TRIGGER reject_guest_expiry"))
    _sweep(harness)
    assert len(base.auth.revocations) == 1
    with base.sessions() as session:
        assert session.get(EndUserConnection, oauth.id) is None
