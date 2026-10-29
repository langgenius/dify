"""Stale sync lifecycle and serialization on real MySQL and PostgreSQL."""

import os
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack
from dataclasses import dataclass, replace
from threading import Barrier, Event
from uuid import uuid4

import pytest
import sqlalchemy as sa
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker
from testcontainers.community.mysql import MySqlContainer
from testcontainers.community.postgres import PostgresContainer

from core.human_input_v2.entities import IMProvider, IMSyncRunStatus
from core.human_input_v2.im_integration import IMSyncRun
from core.human_input_v2.im_integration.adapters import (
    CredentialTestFailure,
    CredentialTestFailureKind,
    Directory,
    DirectoryEntry,
    IMCardEventDecoder,
    IMDynamicCardMessaging,
    IMEventConsumer,
    IMEventStream,
    IMMessaging,
    IMWebhookHandler,
    ProviderUserId,
)
from core.human_input_v2.shared import AccountId, ContactId, DirectoryScope, IMSyncRunId, TenantId, WorkspaceScope
from libs.datetime_utils import naive_utc_now
from models.human_input_v2 import (
    HumanInputIMBinding,
    HumanInputIMBindingWorkspaceOverride,
    HumanInputIMChannel,
    HumanInputIMIdentity,
    HumanInputIMReconciliationChange,
    HumanInputIMSyncResult,
    HumanInputIMSyncRun,
)
from repositories.human_input_v2.channel_credentials import ChannelEncryptedCredentials
from repositories.human_input_v2.contact import Contact
from repositories.human_input_v2.im_channel_repository import IMChannel, IMChannelId, IMChannelStatus, WebhookId
from repositories.human_input_v2.im_integration.repository import SQLAlchemyIMControlPlaneRepository
from repositories.human_input_v2.sqlalchemy_im_channel_repository import (
    WorkspaceIMChannelReader,
    WorkspaceIMChannelWriter,
)
from services.human_input_v2.im_contact_sync.coordinator import IMChannelReconciliationService
from services.human_input_v2.im_contact_sync.service import IMSyncRunNotFoundError, IMSyncService
from services.human_input_v2.im_contact_sync.worker import IMContactSyncWorker


@pytest.fixture(scope="module", params=["mysql", "postgresql"])
def sync_engine(request: pytest.FixtureRequest) -> Iterator[Engine]:
    dialect = request.param
    external_url = os.environ.get(f"HITL_SYNC_TEST_{dialect.upper()}_URL")
    with ExitStack() as stack:
        if external_url is None:
            container = stack.enter_context(
                MySqlContainer("mysql:8.0", dialect="pymysql")
                if dialect == "mysql"
                else PostgresContainer("postgres:15-alpine")
            )
            external_url = container.get_connection_url()
        engine = sa.create_engine(external_url)
        models = (
            HumanInputIMChannel,
            HumanInputIMSyncRun,
            HumanInputIMSyncResult,
            HumanInputIMIdentity,
            HumanInputIMBinding,
            HumanInputIMBindingWorkspaceOverride,
            HumanInputIMReconciliationChange,
        )
        try:
            HumanInputIMChannel.metadata.create_all(
                engine, tables=[HumanInputIMChannel.metadata.tables[model.__tablename__] for model in models]
            )
            yield engine
        finally:
            engine.dispose()


_ACCOUNT_ID = AccountId("00000000-0000-0000-0000-000000000201")


class _EmptyContacts:
    def list_contacts(self, page: int, limit: int) -> tuple[Contact, ...]:
        return ()

    def get_contact(self, contact_id: ContactId) -> Contact | None:
        return None


class _Directory:
    def __init__(self, entered: Event | None = None, resume: Event | None = None) -> None:
        self._entered = entered
        self._resume = resume

    def read_directory(self) -> Directory:
        if self._entered is not None:
            self._entered.set()
        if self._resume is not None:
            assert self._resume.wait(timeout=20)
        return Directory((DirectoryEntry(ProviderUserId("user-1"), "Sync reviewer", "reviewer@example.com"),))


class _Adapter:
    provider = IMProvider.FEISHU

    def __init__(self, directory: _Directory) -> None:
        self.directory = directory

    @classmethod
    def card_event_decoder(cls) -> IMCardEventDecoder | None:
        return None

    def test_credentials(self) -> CredentialTestFailure:
        return CredentialTestFailure(CredentialTestFailureKind.UNKNOWN, "not exercised")

    @property
    def messaging(self) -> IMMessaging:
        raise AssertionError("sync must not send messages")

    @property
    def dynamic_card_messaging(self) -> IMDynamicCardMessaging | None:
        return None

    def create_webhook_handler(self, consumer: IMEventConsumer) -> IMWebhookHandler | None:
        return None

    def create_stream_handler(self, consumer: IMEventConsumer) -> IMEventStream | None:
        return None

    def close(self) -> None:
        pass


@dataclass(frozen=True)
class _SyncContext:
    sessions: sessionmaker[Session]
    scope: WorkspaceScope
    channel: IMChannel

    def resolve_channel(self, session: Session, scope: DirectoryScope) -> IMChannel | None:
        assert scope == self.scope
        return WorkspaceIMChannelReader(session, self.scope.id).get()

    def service(self) -> IMSyncService:
        return IMSyncService(self.sessions, self.resolve_channel, lambda _run, _scope: None)

    def worker(self, directory: _Directory | None = None) -> IMContactSyncWorker:
        def reconciliation(scope: DirectoryScope) -> IMChannelReconciliationService:
            with self.sessions() as session:
                channel = self.resolve_channel(session, scope)
                assert channel is not None
            return IMChannelReconciliationService(
                self.sessions,
                channel,
                lambda _channel: _Adapter(directory or _Directory()),
                lambda _session: _EmptyContacts(),
            )

        return IMContactSyncWorker(self.service(), reconciliation)

    def rotate(self) -> IMChannel:
        updated = replace(self.channel, config_version=2, updated_at=naive_utc_now())
        with self.sessions.begin() as session:
            return WorkspaceIMChannelWriter(session, self.scope.id, _ACCOUNT_ID).update(updated, 1)


@pytest.fixture
def sync_context(sync_engine: Engine) -> _SyncContext:
    now = naive_utc_now()
    channel = IMChannel(
        id=IMChannelId(str(uuid4())),
        provider=IMProvider.FEISHU,
        provider_tenant_id="test-tenant",
        encrypted_credentials=ChannelEncryptedCredentials(ciphertext="test-envelope"),
        app_identifier="test-app",
        webhook_id=WebhookId(uuid4().hex),
        config_version=1,
        status=IMChannelStatus.CONNECTED,
        created_at=now,
        updated_at=now,
    )
    context = _SyncContext(
        sessionmaker(sync_engine, expire_on_commit=False), WorkspaceScope(TenantId(str(uuid4()))), channel
    )
    with context.sessions.begin() as session:
        WorkspaceIMChannelWriter(session, context.scope.id, _ACCOUNT_ID).create(channel)
    return context


@pytest.mark.parametrize("status", [IMSyncRunStatus.QUEUED, IMSyncRunStatus.RUNNING])
@pytest.mark.parametrize("recovery", ["worker", "trigger"])
def test_revision_rotation_retires_old_run_and_new_worker_succeeds(
    sync_context: _SyncContext, status: IMSyncRunStatus, recovery: str
) -> None:
    old = sync_context.service().create_or_get_active_run(sync_context.scope, None)
    with sync_context.sessions.begin() as session:
        session.get_one(HumanInputIMSyncRun, str(old.id)).status = status
    sync_context.rotate()
    if recovery == "worker":
        terminal = sync_context.worker().execute(old.id, sync_context.scope)
        assert terminal.status is IMSyncRunStatus.FAILED
        assert terminal.error_code == "stale_revision"
    current = sync_context.service().create_or_get_active_run(sync_context.scope, None)
    assert current.id != old.id
    assert current.channel_revision.config_version == 2
    assert current.status is IMSyncRunStatus.QUEUED
    assert sync_context.worker().execute(current.id, sync_context.scope).status is IMSyncRunStatus.SUCCEEDED
    assert sync_context.worker().execute(old.id, sync_context.scope).status is IMSyncRunStatus.FAILED
    with sync_context.sessions() as session:
        saved = session.get_one(HumanInputIMSyncRun, str(old.id))
        assert saved.status is IMSyncRunStatus.FAILED
        assert saved.finished_at is not None
        assert saved.failed_count == 1
        facts = session.scalars(
            sa.select(HumanInputIMSyncResult).where(HumanInputIMSyncResult.sync_run_id == str(old.id))
        ).all()
        assert len(facts) == 1
        assert facts[0].reason_code == "stale_revision"
        identities = session.scalars(
            sa.select(HumanInputIMIdentity).where(HumanInputIMIdentity.channel_id == str(sync_context.channel.id))
        ).all()
        assert len(identities) == 1
        assert identities[0].last_seen_sync_run_id == str(current.id)


def test_concurrent_old_workers_and_triggers_leave_one_new_active_run(sync_context: _SyncContext) -> None:
    old = sync_context.service().create_or_get_active_run(sync_context.scope, None)
    sync_context.rotate()
    barrier = Barrier(4)

    def execute(trigger: bool) -> IMSyncRun:
        barrier.wait(timeout=10)
        if trigger:
            return sync_context.service().create_or_get_active_run(sync_context.scope, None)
        return sync_context.worker().execute(old.id, sync_context.scope)

    with ThreadPoolExecutor(max_workers=4) as executor:
        runs = tuple(executor.map(execute, (True, True, False, False)))
    assert runs[0].id == runs[1].id != old.id
    assert runs[0].channel_revision.config_version == 2
    assert runs[2].status is runs[3].status is IMSyncRunStatus.FAILED
    with sync_context.sessions() as session:
        active = session.scalars(
            sa.select(HumanInputIMSyncRun).where(
                HumanInputIMSyncRun.channel_id == str(sync_context.channel.id),
                HumanInputIMSyncRun.status.in_((IMSyncRunStatus.QUEUED, IMSyncRunStatus.RUNNING)),
            )
        ).all()
        assert [run.id for run in active] == [str(runs[0].id)]
        assert (
            session.scalar(
                sa.select(sa.func.count(HumanInputIMSyncResult.id)).where(
                    HumanInputIMSyncResult.sync_run_id == str(old.id)
                )
            )
            == 1
        )


def test_late_old_apply_cannot_overwrite_new_revision_state(sync_context: _SyncContext) -> None:
    old = sync_context.service().create_or_get_active_run(sync_context.scope, None)
    entered, resume = Event(), Event()
    with ThreadPoolExecutor(max_workers=1) as executor:
        pending = executor.submit(sync_context.worker(_Directory(entered, resume)).execute, old.id, sync_context.scope)
        try:
            assert entered.wait(timeout=10)
            sync_context.rotate()
            current = sync_context.service().create_or_get_active_run(sync_context.scope, None)
            assert sync_context.worker().execute(current.id, sync_context.scope).status is IMSyncRunStatus.SUCCEEDED
        finally:
            resume.set()
        assert pending.result(timeout=20).status is IMSyncRunStatus.FAILED
    with sync_context.sessions() as session:
        identity = session.scalar(
            sa.select(HumanInputIMIdentity).where(HumanInputIMIdentity.channel_id == str(sync_context.channel.id))
        )
        assert identity is not None
        assert identity.last_seen_sync_run_id == str(current.id)
        assert (
            session.scalar(
                sa.select(sa.func.count(HumanInputIMSyncResult.id)).where(
                    HumanInputIMSyncResult.sync_run_id == str(old.id)
                )
            )
            == 1
        )


def test_stale_completion_is_scoped_current_and_caller_rollback_owned(sync_context: _SyncContext) -> None:
    old = sync_context.service().create_or_get_active_run(sync_context.scope, None)
    current = sync_context.rotate()
    with sync_context.sessions() as session:
        assert (
            SQLAlchemyIMControlPlaneRepository(session, sync_context.channel).finish_stale_run(
                old.id, now=naive_utc_now()
            )
            is None
        )
    with sync_context.sessions() as session:
        replacement = SQLAlchemyIMControlPlaneRepository(session, current).create_or_get_active_run(
            sync_run_id=IMSyncRunId(str(uuid4())), started_by_account_id=None, now=naive_utc_now()
        )
        assert replacement.run is not None
        assert replacement.run.id != old.id
        session.rollback()
    with sync_context.sessions() as session:
        assert session.get_one(HumanInputIMSyncRun, str(old.id)).status is IMSyncRunStatus.QUEUED
        assert session.get(HumanInputIMSyncRun, str(replacement.run.id)) is None
        assert (
            session.scalar(
                sa.select(sa.func.count(HumanInputIMSyncResult.id)).where(
                    HumanInputIMSyncResult.sync_run_id == str(old.id)
                )
            )
            == 0
        )
    foreign = replace(current, id=IMChannelId(str(uuid4())), webhook_id=WebhookId(uuid4().hex), config_version=1)
    foreign_scope = WorkspaceScope(TenantId(str(uuid4())))
    with sync_context.sessions.begin() as session:
        WorkspaceIMChannelWriter(session, foreign_scope.id, _ACCOUNT_ID).create(foreign)
    service = IMChannelReconciliationService(
        sync_context.sessions, foreign, lambda _channel: _Adapter(_Directory()), lambda _session: _EmptyContacts()
    )
    with pytest.raises(IMSyncRunNotFoundError):
        service.reconcile(old.id)
    with sync_context.sessions.begin() as session:
        assert (
            SQLAlchemyIMControlPlaneRepository(session, foreign).finish_stale_run(old.id, now=naive_utc_now()) is None
        )
        assert session.get_one(HumanInputIMSyncRun, str(old.id)).status is IMSyncRunStatus.QUEUED
