"""Application behavior tests for Channel-bound IM synchronization commands."""

from __future__ import annotations

import logging
from dataclasses import dataclass, replace
from datetime import datetime

import pytest
import sqlalchemy as sa
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from core.human_input_v2.entities import IMProvider, IMSyncResultType, IMSyncRunStatus
from core.human_input_v2.im_integration import SyncResultFact
from core.human_input_v2.im_integration.sync_records import (
    AccountIMSyncInitiator,
    IMSyncInitiator,
    SyncContactSnapshot,
    SysUserId,
    SysUserIMSyncInitiator,
)
from core.human_input_v2.shared import (
    AccountId,
    ContactId,
    DeploymentScope,
    DirectoryScope,
    IMBindingId,
    IMIdentityId,
    IMSyncResultId,
    IMSyncRunId,
    TenantId,
    WorkspaceScope,
)
from models.account import Account, AccountStatus, Tenant, TenantAccountJoin, TenantAccountRole
from models.human_input_v2 import ContactSubjectType, HumanInputContactIdentity, HumanInputIMSyncRun
from repositories.account.repository import SQLAlchemyAccountRepository
from repositories.human_input_v2.channel_credentials import ChannelEncryptedCredentials
from repositories.human_input_v2.im_binding_repository import IMBindingAssignment
from repositories.human_input_v2.im_channel_repository import (
    IMChannel,
    IMChannelId,
    IMChannelStatus,
    WebhookId,
)
from repositories.human_input_v2.im_identity_repository import IMIdentityObservation, OpaqueProviderPayload
from repositories.human_input_v2.im_integration.mappers import sync_result_to_record
from repositories.human_input_v2.sqlalchemy_im_binding_repository import SQLAlchemyIMBindingRepository
from repositories.human_input_v2.sqlalchemy_im_channel_repository import (
    DeploymentIMChannelReader,
    DeploymentIMChannelWriter,
    WorkspaceIMChannelReader,
    WorkspaceIMChannelWriter,
)
from repositories.human_input_v2.sqlalchemy_im_identity_repository import SQLAlchemyIMIdentityRepository
from services.human_input_v2.im_contact_sync.service import (
    IMChannelNotConfiguredError,
    IMSyncDispatchUnavailableError,
    IMSyncRevisionChangedError,
    IMSyncRunNotFoundError,
    IMSyncService,
)
from tests.helpers.unit.model_factories import make_upload_file

_NOW = datetime(2026, 8, 11, 8)
_TENANT_ID = TenantId("00000000-0000-0000-0000-000000000101")
_ACCOUNT_ID = AccountId("00000000-0000-0000-0000-000000000201")
_CHANNEL_ID = IMChannelId("00000000-0000-0000-0000-000000000301")
_RUN_ID = IMSyncRunId("00000000-0000-0000-0000-000000000401")
_IDENTITY_ID = IMIdentityId("00000000-0000-0000-0000-000000000501")
_SCOPE = WorkspaceScope(id=_TENANT_ID)


def _channel(*, config_version: int = 1) -> IMChannel:
    return IMChannel(
        id=_CHANNEL_ID,
        created_at=_NOW,
        updated_at=_NOW,
        provider=IMProvider.FEISHU,
        provider_tenant_id="provider-tenant-1",
        encrypted_credentials=ChannelEncryptedCredentials(ciphertext="opaque-ciphertext"),
        app_identifier="app-1",
        webhook_id=WebhookId("00000000000000000000000000000001"),
        config_version=config_version,
        status=IMChannelStatus.CONNECTED,
    )


@dataclass
class _ServiceContext:
    sessions: sessionmaker[Session]
    dispatched: list[tuple[IMSyncRunId, DirectoryScope]]

    def service(self, *, channel_override: IMChannel | None = None) -> IMSyncService:
        def resolve_channel(session: Session, owner_scope: DirectoryScope) -> IMChannel | None:
            if channel_override is not None:
                return channel_override
            if isinstance(owner_scope, WorkspaceScope):
                return WorkspaceIMChannelReader(session, owner_scope.id).get()
            return DeploymentIMChannelReader(session).get()

        return IMSyncService(
            self.sessions,
            resolve_channel,
            lambda run_id, scope: self.dispatched.append((run_id, scope)),
            account_query=SQLAlchemyAccountRepository(self.sessions),
            clock=lambda: _NOW,
            run_id_factory=lambda: _RUN_ID,
        )


@pytest.fixture
def service_context(sqlite_engine: Engine) -> _ServiceContext:
    sessions = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    with sessions.begin() as session:
        WorkspaceIMChannelWriter(session, _TENANT_ID, _ACCOUNT_ID).create(_channel())
    return _ServiceContext(sessions, [])


def test_created_or_existing_active_run_is_serialized_and_dispatched_by_state(
    service_context: _ServiceContext,
) -> None:
    service = service_context.service()

    created = service.create_or_get_active_run(_SCOPE, AccountIMSyncInitiator(_ACCOUNT_ID))
    retried = service.create_or_get_active_run(_SCOPE, AccountIMSyncInitiator(_ACCOUNT_ID))

    assert created == retried
    assert created.run.channel_revision.channel_id == str(_CHANNEL_ID)
    assert service_context.dispatched == [(_RUN_ID, _SCOPE), (_RUN_ID, _SCOPE)]
    with service_context.sessions.begin() as session:
        session.get_one(HumanInputIMSyncRun, str(_RUN_ID)).status = IMSyncRunStatus.RUNNING

    running = service.create_or_get_active_run(_SCOPE, AccountIMSyncInitiator(_ACCOUNT_ID))
    assert running.run.status is IMSyncRunStatus.RUNNING
    assert service_context.dispatched == [(_RUN_ID, _SCOPE), (_RUN_ID, _SCOPE)]
    with service_context.sessions() as session:
        assert session.scalar(sa.select(sa.func.count(HumanInputIMSyncRun.id))) == 1


def test_dispatch_failure_occurs_after_queued_run_is_committed(
    service_context: _ServiceContext,
    caplog: pytest.LogCaptureFixture,
) -> None:
    def fail_dispatch(_run_id: IMSyncRunId, _scope: DirectoryScope) -> None:
        raise ConnectionError("queue unavailable")

    def resolve_channel(session: Session, scope: DirectoryScope) -> IMChannel | None:
        assert isinstance(scope, WorkspaceScope)
        return WorkspaceIMChannelReader(session, scope.id).get()

    service = IMSyncService(
        service_context.sessions,
        resolve_channel,
        fail_dispatch,
        account_query=SQLAlchemyAccountRepository(service_context.sessions),
        clock=lambda: _NOW,
        run_id_factory=lambda: _RUN_ID,
    )

    with caplog.at_level(logging.ERROR), pytest.raises(IMSyncDispatchUnavailableError) as error_info:
        service.create_or_get_active_run(_SCOPE, AccountIMSyncInitiator(_ACCOUNT_ID))

    assert isinstance(error_info.value.__cause__, ConnectionError)
    assert str(_RUN_ID) in caplog.text
    with service_context.sessions() as session:
        assert session.get(HumanInputIMSyncRun, str(_RUN_ID)) is not None


def test_missing_or_stale_channel_fails_before_run_creation(service_context: _ServiceContext) -> None:
    missing = IMSyncService(
        service_context.sessions,
        lambda _session, _scope: None,
        lambda _id, _scope: None,
        account_query=SQLAlchemyAccountRepository(service_context.sessions),
    )
    with pytest.raises(IMChannelNotConfiguredError):
        missing.create_or_get_active_run(_SCOPE, AccountIMSyncInitiator(_ACCOUNT_ID))

    with pytest.raises(IMSyncRevisionChangedError):
        service_context.service(channel_override=replace(_channel(), config_version=2)).create_or_get_active_run(
            _SCOPE,
            AccountIMSyncInitiator(_ACCOUNT_ID),
        )

    with service_context.sessions() as session:
        assert session.scalar(sa.select(sa.func.count(HumanInputIMSyncRun.id))) == 0


def test_latest_result_and_identity_queries_use_current_channel(service_context: _ServiceContext) -> None:
    service = service_context.service()
    summary = service.create_or_get_active_run(_SCOPE, AccountIMSyncInitiator(_ACCOUNT_ID))
    run = summary.run
    with service_context.sessions.begin() as session:
        identities = SQLAlchemyIMIdentityRepository(session, _CHANNEL_ID)
        identities.create(
            _IDENTITY_ID,
            IMIdentityObservation(
                provider_user_id="provider-user-1",
                display_name="Reviewer",
                email="reviewer@example.com",
                raw_payload=OpaqueProviderPayload({}),
                sync_run_id=run.id,
                observed_at=_NOW,
            ),
        )
        SQLAlchemyIMBindingRepository(session, _CHANNEL_ID).create(
            IMBindingAssignment(
                ContactId("00000000-0000-0000-0000-000000000601"),
                _IDENTITY_ID,
                _NOW,
            ),
            bound_by_account_id=None,
        )
        session.add(
            sync_result_to_record(
                SyncResultFact(
                    id=IMSyncResultId("00000000-0000-0000-0000-000000000701"),
                    channel_id=IMChannelId(str(_CHANNEL_ID)),
                    sync_run_id=run.id,
                    operation_key="result:not-matched:provider-user-1",
                    result_type=IMSyncResultType.NOT_MATCHED,
                    provider_user_id="provider-user-1",
                    display_name="Reviewer",
                    email="reviewer@example.com",
                    normalized_email=None,
                    contact_id=None,
                    identity_id=_IDENTITY_ID,
                    binding_id=IMBindingId("00000000-0000-0000-0000-000000000801"),
                    removal_reason=None,
                    reason_code="contact_not_found",
                    reason_message=None,
                    directory_entry_payload=None,
                    contact_snapshot=None,
                    identity_snapshot=None,
                    created_at=_NOW,
                    updated_at=_NOW,
                )
            )
        )

    assert service.get_latest_run(_SCOPE) == summary
    result_page = service.list_latest_results(_SCOPE, IMSyncResultType.NOT_MATCHED, page=1, limit=20)
    identity_page = service.search_identities(_SCOPE, keyword="REVIEWER", page=1, limit=20)
    assert [result.id for result in result_page.items] == [IMSyncResultId("00000000-0000-0000-0000-000000000701")]
    assert [identity.id for identity in identity_page.items] == [_IDENTITY_ID]
    assert identity_page.items[0].binding_status.value == "bound"


@pytest.mark.parametrize(
    ("owner_scope", "initiator", "account_status"),
    [
        (_SCOPE, AccountIMSyncInitiator(_ACCOUNT_ID), AccountStatus.ACTIVE),
        (DeploymentScope(), SysUserIMSyncInitiator(SysUserId(str(_ACCOUNT_ID))), AccountStatus.ACTIVE),
        (DeploymentScope(), SysUserIMSyncInitiator(SysUserId(str(_ACCOUNT_ID))), AccountStatus.BANNED),
    ],
    ids=["workspace", "deployment", "deployment-inactive-contact"],
)
def test_latest_results_keep_only_currently_eligible_uploaded_contact_avatars(
    sqlite_engine: Engine,
    owner_scope: DirectoryScope,
    initiator: IMSyncInitiator,
    account_status: AccountStatus,
) -> None:
    service_context = _ServiceContext(sessionmaker(bind=sqlite_engine, expire_on_commit=False), [])
    with service_context.sessions.begin() as session:
        if isinstance(owner_scope, WorkspaceScope):
            WorkspaceIMChannelWriter(session, owner_scope.id, _ACCOUNT_ID).create(_channel())
        else:
            DeploymentIMChannelWriter(session).create(_channel())
    service = service_context.service()
    run = service.create_or_get_active_run(owner_scope, initiator).run
    contact_id = ContactId("00000000-0000-0000-0000-000000000601")
    hidden_contact_id = ContactId("00000000-0000-0000-0000-000000000602")
    eligible_avatar_id = "00000000-0000-0000-0000-000000000901"
    other_avatar_id = "00000000-0000-0000-0000-000000000902"
    snapshot_created_at = datetime(2025, 1, 2, 3, 4, 5)
    snapshot_avatars = {
        "matching-upload": (
            contact_id,
            eligible_avatar_id,
            eligible_avatar_id if account_status == AccountStatus.ACTIVE else None,
        ),
        "changed-upload": (contact_id, other_avatar_id, None),
        "hidden-contact": (hidden_contact_id, eligible_avatar_id, None),
        "http-external": (
            hidden_contact_id,
            "http://avatars.example.com/legacy.png",
            "http://avatars.example.com/legacy.png",
        ),
        "https-external": (
            hidden_contact_id,
            "https://avatars.example.com/legacy.png",
            "https://avatars.example.com/legacy.png",
        ),
        "no-avatar": (hidden_contact_id, None, None),
        "legacy-plaintext": (hidden_contact_id, "legacy-avatar-reference", None),
    }

    with service_context.sessions.begin() as session:
        tenant = Tenant(name="Workspace")
        tenant.id = str(_TENANT_ID)
        account = Account(
            name="Current Contact", email="contact@example.com", avatar=eligible_avatar_id, status=account_status
        )
        account.id = str(_ACCOUNT_ID)
        identity = HumanInputContactIdentity(
            subject_type=ContactSubjectType.ACCOUNT,
            account_id=str(_ACCOUNT_ID),
        )
        identity.id = str(contact_id)
        identity.created_at = _NOW
        identity.updated_at = _NOW
        if isinstance(owner_scope, WorkspaceScope):
            session.add(
                TenantAccountJoin(tenant_id=str(_TENANT_ID), account_id=str(_ACCOUNT_ID), role=TenantAccountRole.NORMAL)
            )
        session.add_all(
            [
                tenant,
                account,
                identity,
                make_upload_file(
                    file_id=eligible_avatar_id,
                    tenant_id=str(_TENANT_ID),
                    created_by=str(_ACCOUNT_ID),
                    extension="png",
                    mime_type="image/png",
                    created_at=_NOW,
                ),
            ]
        )
        for index, (label, (snapshot_contact_id, avatar_file_id, _expected_avatar)) in enumerate(
            snapshot_avatars.items(), start=1
        ):
            session.add(
                sync_result_to_record(
                    SyncResultFact(
                        id=IMSyncResultId(f"00000000-0000-0000-0000-{index:012d}"),
                        channel_id=_CHANNEL_ID,
                        sync_run_id=run.id,
                        operation_key=label,
                        result_type=IMSyncResultType.SKIPPED,
                        provider_user_id=f"provider-user-{index}",
                        display_name=f"Provider Name {index}",
                        email=f"provider-{index}@example.com",
                        normalized_email=None,
                        contact_id=snapshot_contact_id,
                        identity_id=None,
                        binding_id=None,
                        removal_reason=None,
                        reason_code="already_bound",
                        reason_message=None,
                        directory_entry_payload=None,
                        contact_snapshot=SyncContactSnapshot(
                            contact_id=snapshot_contact_id,
                            name=f"Snapshot Name {index}",
                            email=f"snapshot-{index}@example.com",
                            avatar_file_id=avatar_file_id,
                            created_at=snapshot_created_at,
                        ),
                        identity_snapshot=None,
                        created_at=_NOW,
                        updated_at=_NOW,
                    )
                )
            )

    page = service.list_latest_results(owner_scope, IMSyncResultType.SKIPPED, page=1, limit=20)
    snapshots = {result.operation_key: result.contact_snapshot for result in page.items}

    assert page.total == len(snapshot_avatars)
    assert all(snapshot is not None for snapshot in snapshots.values())
    assert {label: snapshot.avatar_file_id for label, snapshot in snapshots.items() if snapshot is not None} == {
        label: expected_avatar for label, (_contact, _stored, expected_avatar) in snapshot_avatars.items()
    }
    changed_snapshot = snapshots["changed-upload"]
    assert changed_snapshot is not None
    assert changed_snapshot.name == "Snapshot Name 2"
    assert changed_snapshot.created_at == snapshot_created_at


def test_latest_queries_fail_closed_without_a_current_run(service_context: _ServiceContext) -> None:
    with pytest.raises(IMSyncRunNotFoundError):
        service_context.service().get_latest_run(_SCOPE)


@pytest.mark.parametrize(
    ("owner_scope", "started_by", "account_id", "sys_user_id", "display_name"),
    [
        (_SCOPE, AccountIMSyncInitiator(_ACCOUNT_ID), _ACCOUNT_ID, None, "Workspace Owner"),
        (DeploymentScope(), SysUserIMSyncInitiator(SysUserId(str(_ACCOUNT_ID))), None, str(_ACCOUNT_ID), ""),
    ],
    ids=["ce-saas-account", "ee-administrator"],
)
def test_sync_run_preserves_initiating_identity_when_another_caller_reuses_it(
    sqlite_engine: Engine,
    owner_scope: DirectoryScope,
    started_by: IMSyncInitiator,
    account_id: AccountId | None,
    sys_user_id: str | None,
    display_name: str,
) -> None:
    sessions = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    channel = _channel()
    with sessions.begin() as session:
        account = Account(name="Workspace Owner", email="owner@example.com")
        account.id = str(_ACCOUNT_ID)
        session.add(account)
        if isinstance(owner_scope, WorkspaceScope):
            WorkspaceIMChannelWriter(session, owner_scope.id, _ACCOUNT_ID).create(channel)
        else:
            DeploymentIMChannelWriter(session).create(channel)
    service = IMSyncService(
        sessions,
        lambda _session, _scope: channel,
        lambda _run_id, _scope: None,
        account_query=SQLAlchemyAccountRepository(sessions),
    )

    created = service.create_or_get_active_run(owner_scope, started_by)
    next_initiator = (
        AccountIMSyncInitiator(AccountId("00000000-0000-0000-0000-000000000202"))
        if isinstance(started_by, AccountIMSyncInitiator)
        else SysUserIMSyncInitiator(SysUserId("00000000-0000-0000-0000-000000000202"))
    )
    reused = service.create_or_get_active_run(owner_scope, next_initiator)

    assert reused == created
    assert created.initiator_display_name == display_name
    assert service.get_latest_run(owner_scope).initiator_display_name == display_name
    loaded = service.load_run(created.run.id)
    assert loaded is not None
    assert loaded.started_by == started_by
    with sessions() as session:
        stored = session.get_one(HumanInputIMSyncRun, str(created.run.id))
        assert stored.started_by_account_id == account_id
        assert stored.started_by_sys_user_id == sys_user_id


def test_sync_run_returns_current_account_name(service_context: _ServiceContext) -> None:
    with service_context.sessions.begin() as session:
        account = Account(name="Original Admin", email="initiator@example.com")
        account.id = str(_ACCOUNT_ID)
        session.add(account)
    service = service_context.service()
    service.create_or_get_active_run(_SCOPE, AccountIMSyncInitiator(_ACCOUNT_ID))
    with service_context.sessions.begin() as session:
        account = session.get_one(Account, str(_ACCOUNT_ID))
        account.name = "Renamed Admin"

    assert service.get_latest_run(_SCOPE).initiator_display_name == "Renamed Admin"

    with service_context.sessions.begin() as session:
        session.delete(session.get_one(Account, str(_ACCOUNT_ID)))

    assert service.get_latest_run(_SCOPE).initiator_display_name == ""
