"""PostgreSQL and Redis end-to-end coverage for IM Contact reconciliation."""

from __future__ import annotations

import json
import threading
from dataclasses import replace
from datetime import datetime

import pytest
from sqlalchemy import delete, event, func, select, text, update
from sqlalchemy.orm import Session, sessionmaker

from core.human_input_v2.channel_management import (
    ChannelKind,
    ChannelProvider,
    ChannelRef,
    DeleteChannelCommand,
    HumanInputChannelManagementContext,
    NewSecret,
    SaveIMChannelCommand,
    SlackIMCandidate,
)
from core.human_input_v2.contact_directory import Contact
from core.human_input_v2.entities import (
    IMBindingScope,
    IMProvider,
    IMSyncResultType,
    IMSyncRunStatus,
)
from core.human_input_v2.im_integration import (
    ActiveRunDecisionKind,
    ApplyReconciliationStatus,
    ConfigurationTransition,
    EncryptedCredentials,
    IMBinding,
    IMIdentity,
    IMIntegration,
    IMSyncRun,
    IntegrationRevisionToken,
    ProviderTenantIdentity,
    ReconciliationPlan,
    ReconciliationRunRef,
    SyncContactSnapshot,
    SyncReconciler,
    SyncResultFact,
)
from core.human_input_v2.im_provider import Directory, DirectoryEntry, ProviderUserId
from core.human_input_v2.shared import (
    AccountId,
    ContactId,
    IMBindingId,
    IMIdentityId,
    IMSyncResultId,
    IMSyncRunId,
    IntegrationId,
    NormalizedEmail,
    TenantId,
    WorkspaceScope,
)
from extensions.ext_redis import redis_client
from models.account import Account, AccountStatus, Tenant, TenantAccountJoin, TenantAccountRole
from models.human_input_v2 import (
    HumanInputContact,
    HumanInputIMBinding,
    HumanInputIMIdentity,
    HumanInputIMIntegration,
    HumanInputIMReconciliationChange,
    HumanInputIMSyncResult,
    HumanInputIMSyncRun,
)
from repositories.human_input_v2.contact_directory.mappers import contact_to_record
from repositories.human_input_v2.im_integration.mappers import (
    binding_to_record,
    identity_to_record,
    integration_to_record,
    sync_result_to_record,
    sync_run_to_record,
)
from repositories.human_input_v2.im_integration.repository import SQLAlchemyIMControlPlaneRepository
from repositories.human_input_v2.im_integration.unit_of_work import SQLAlchemyOrganizationIMWriteUnitOfWork
from services.human_input_im_channel_manager import ConfirmedIMConfiguration, HumanInputIMChannelManager
from services.human_input_v2.im_contact_sync.composition import build_im_contact_sync_application
from services.human_input_v2.im_contact_sync.locking import (
    OrganizationIMWriteLock,
    OrganizationIMWriteLockLostError,
    OrganizationIMWriteLockUnavailableError,
    OrganizationIMWriteScope,
)
from tasks.im_contact_sync_tasks import reconcile_im_contacts_task

_HISTORICAL_AT = datetime(2026, 8, 10, 8)
_EXISTING_CONTACT_ID = ContactId("00000000-0000-0000-0000-000000000101")
_NEW_CONTACT_ID = ContactId("00000000-0000-0000-0000-000000000102")
_INTEGRATION_ID = IntegrationId("00000000-0000-0000-0000-000000000201")
_EXISTING_IDENTITY_ID = IMIdentityId("00000000-0000-0000-0000-000000000301")
_EXISTING_BINDING_ID = IMBindingId("00000000-0000-0000-0000-000000000401")
_HISTORICAL_RUN_ID = IMSyncRunId("00000000-0000-0000-0000-000000000501")
_HISTORICAL_RESULT_ID = IMSyncResultId("00000000-0000-0000-0000-000000000601")
_PRECONDITION_RUN_ID = IMSyncRunId("00000000-0000-0000-0000-000000000502")
_WAITING_RUN_ID = IMSyncRunId("00000000-0000-0000-0000-000000000504")
_REPLACEMENT_INTEGRATION_ID = IntegrationId("00000000-0000-0000-0000-000000000202")
_SLACK_REF = ChannelRef(ChannelKind.IM, ChannelProvider.SLACK)


class _Directory:
    def read_directory(self) -> Directory:
        return Directory(
            (
                DirectoryEntry(
                    ProviderUserId("provider-user-existing"),
                    "Existing Reviewer",
                    "existing-reviewer@example.com",
                ),
                DirectoryEntry(
                    ProviderUserId("provider-user-new"),
                    "New Reviewer",
                    "new-reviewer@example.com",
                ),
            )
        )


class _Adapter:
    def __init__(self) -> None:
        self.directory = _Directory()
        self.closed = False

    def close(self) -> None:
        self.closed = True


def _account(name: str, email: str) -> Account:
    return Account(
        name=name,
        email=email,
        password="hashed-password",
        password_salt="salt",
        interface_language="en-US",
        timezone="UTC",
    )


def _seed_historical_state(session: Session) -> tuple[WorkspaceScope, AccountId]:
    tenant = Tenant(name="IM Contact Sync E2E")
    existing_account = _account("Existing Reviewer", "existing-reviewer@example.com")
    new_account = _account("New Reviewer", "new-reviewer@example.com")
    session.add_all((tenant, existing_account, new_account))
    session.flush()
    tenant_id = TenantId(tenant.id)
    session.add_all(
        (
            TenantAccountJoin(
                tenant_id=tenant.id,
                account_id=existing_account.id,
                current=True,
                role=TenantAccountRole.OWNER,
            ),
            TenantAccountJoin(
                tenant_id=tenant.id,
                account_id=new_account.id,
                current=True,
                role=TenantAccountRole.NORMAL,
            ),
        )
    )
    existing_contact = Contact.workspace_member(
        contact_id=_EXISTING_CONTACT_ID,
        tenant_id=tenant_id,
        account_id=AccountId(existing_account.id),
        name=existing_account.name,
        email=existing_account.email,
        now=_HISTORICAL_AT,
    )
    new_contact = Contact.workspace_member(
        contact_id=_NEW_CONTACT_ID,
        tenant_id=tenant_id,
        account_id=AccountId(new_account.id),
        name=new_account.name,
        email=new_account.email,
        now=_HISTORICAL_AT,
    )
    integration = IMIntegration.create(
        integration_id=_INTEGRATION_ID,
        tenant_id=tenant_id,
        provider_tenant=ProviderTenantIdentity(IMProvider.FEISHU, "provider-tenant-1"),
        encrypted_credentials=EncryptedCredentials.from_mapping(
            {"app_id": "app-1", "encrypted_app_secret": "ciphertext"}
        ),
        configured_by_account_id=AccountId(existing_account.id),
        callback_url=None,
        now=_HISTORICAL_AT,
    )
    identity = IMIdentity.create(
        identity_id=_EXISTING_IDENTITY_ID,
        integration_id=integration.id,
        provider=IMProvider.FEISHU,
        provider_user_id="provider-user-existing",
        display_name="Existing Reviewer",
        email="existing-reviewer@example.com",
        raw_payload={},
        last_seen_sync_run_id=None,
        last_seen_at=_HISTORICAL_AT,
        now=_HISTORICAL_AT,
    )
    binding = IMBinding.create(
        binding_id=_EXISTING_BINDING_ID,
        integration_id=integration.id,
        scope=IMBindingScope.ORGANIZATION,
        scope_id=str(integration.id),
        contact_id=existing_contact.id,
        identity_id=identity.id,
        provider=IMProvider.FEISHU,
        bound_by_account_id=AccountId(existing_account.id),
        now=_HISTORICAL_AT,
    )
    historical_run = replace(
        IMSyncRun.create(
            sync_run_id=_HISTORICAL_RUN_ID,
            integration_revision=IntegrationRevisionToken(integration.id, 1),
            provider=IMProvider.FEISHU,
            started_by_account_id=AccountId(existing_account.id),
            now=_HISTORICAL_AT,
        ),
        status=IMSyncRunStatus.SUCCEEDED,
        skipped_count=1,
        started_at=_HISTORICAL_AT,
        finished_at=_HISTORICAL_AT,
    )
    historical_result = SyncResultFact(
        id=_HISTORICAL_RESULT_ID,
        integration_id=integration.id,
        sync_run_id=historical_run.id,
        operation_key=None,
        result_type=IMSyncResultType.SKIPPED,
        provider_user_id=identity.provider_user_id,
        display_name=identity.display_name,
        email=identity.email,
        normalized_email=identity.normalized_email,
        contact_id=existing_contact.id,
        identity_id=identity.id,
        binding_id=binding.id,
        removal_reason=None,
        reason_code=None,
        reason_message=None,
        directory_entry_payload=None,
        contact_snapshot=SyncContactSnapshot(
            contact_id=existing_contact.id,
            name=existing_contact.name,
            email=existing_contact.email,
            avatar_file_id=None,
        ),
        identity_snapshot=None,
        created_at=_HISTORICAL_AT,
        updated_at=_HISTORICAL_AT,
    )
    session.add_all(
        (
            contact_to_record(existing_contact),
            contact_to_record(new_contact),
            integration_to_record(integration),
            identity_to_record(identity),
            binding_to_record(binding),
            sync_run_to_record(historical_run),
            sync_result_to_record(historical_result),
        )
    )
    session.commit()

    legacy_snapshot = json.dumps(
        {
            "contact_id": str(existing_contact.id),
            "name": existing_contact.name,
            "email": existing_contact.email,
            "avatar_file_id": None,
        }
    )
    session.execute(
        text("UPDATE human_input_im_sync_results SET contact_snapshot = :snapshot WHERE id = :result_id"),
        {"snapshot": legacy_snapshot, "result_id": str(historical_result.id)},
    )
    session.commit()
    return WorkspaceScope(id=tenant_id), AccountId(existing_account.id)


def test_existing_state_remains_readable_and_new_run_starts_forward_only_history(
    db_session_with_containers: Session,
    monkeypatch,
) -> None:
    scope, actor_id = _seed_historical_state(db_session_with_containers)
    sessions = sessionmaker(bind=db_session_with_containers.get_bind(), expire_on_commit=False)
    adapter = _Adapter()
    adapter_factory_calls: list[IntegrationId] = []

    def adapter_factory(integration: IMIntegration) -> _Adapter:
        adapter_factory_calls.append(integration.id)
        return adapter

    dispatched: list[tuple[tuple[str, str, str | None], str]] = []

    def capture_dispatch(*, args, queue: str) -> None:
        dispatched.append((args, queue))

    monkeypatch.setattr(reconcile_im_contacts_task, "apply_async", capture_dispatch)
    application = build_im_contact_sync_application(
        session_maker=sessions,
        adapter_factory=adapter_factory,
    )

    historical_page = application.sync_service.list_latest_results(
        scope,
        IMSyncResultType.SKIPPED,
        page=1,
        limit=20,
    )
    assert historical_page.total == 1
    assert historical_page.items[0].operation_key is None
    assert historical_page.items[0].contact_snapshot is not None
    assert historical_page.items[0].contact_snapshot.created_at is None
    assert db_session_with_containers.scalar(select(func.count(HumanInputIMReconciliationChange.id))) == 0

    new_run = application.sync_service.create_or_get_active_run(scope, actor_id)
    assert dispatched == [((str(new_run.id), "workspace", str(scope.id)), "human_input_contact_sync")]

    executed_statements: list[str] = []

    def capture_statement(_connection, _cursor, statement, _parameters, _context, _executemany) -> None:
        executed_statements.append(statement)

    engine = db_session_with_containers.get_bind()
    event.listen(engine, "before_cursor_execute", capture_statement)
    try:
        terminal_run = application.worker.execute(new_run.id, scope)
    finally:
        event.remove(engine, "before_cursor_execute", capture_statement)

    assert terminal_run.status is IMSyncRunStatus.SUCCEEDED
    assert terminal_run.added_count == 1
    assert terminal_run.skipped_count == 1
    assert adapter.closed is True
    assert adapter_factory_calls == [_INTEGRATION_ID]
    protected_snapshot_tables = (
        "human_input_im_identities",
        "human_input_im_bindings",
        "human_input_contacts",
    )
    assert not any(
        "FOR UPDATE" in statement.upper() and any(table_name in statement for table_name in protected_snapshot_tables)
        for statement in executed_statements
    )
    latest_added = application.sync_service.list_latest_results(
        scope,
        IMSyncResultType.ADDED,
        page=1,
        limit=20,
    )
    assert latest_added.total == 1
    assert latest_added.items[0].contact_id == _NEW_CONTACT_ID
    assert latest_added.items[0].contact_snapshot is not None
    assert latest_added.items[0].contact_snapshot.created_at == _HISTORICAL_AT

    replayed = application.worker.execute(new_run.id, scope)
    assert replayed == terminal_run
    assert adapter_factory_calls == [_INTEGRATION_ID]

    db_session_with_containers.expire_all()
    assert db_session_with_containers.scalar(select(func.count(HumanInputIMIdentity.id))) == 2
    assert db_session_with_containers.scalar(select(func.count(HumanInputIMBinding.id))) == 2
    assert db_session_with_containers.scalar(select(func.count(HumanInputIMSyncResult.id))) == 3
    assert db_session_with_containers.scalar(select(func.count(HumanInputIMReconciliationChange.id))) == 3
    assert (
        db_session_with_containers.scalar(
            select(func.count(HumanInputIMReconciliationChange.id)).where(
                HumanInputIMReconciliationChange.sync_run_id == str(_HISTORICAL_RUN_ID)
            )
        )
        == 0
    )
    assert set(db_session_with_containers.scalars(select(HumanInputIMReconciliationChange.sync_run_id)).all()) == {
        str(new_run.id)
    }


def test_malformed_provider_email_persists_as_unmatched_without_rolling_back_valid_entries(
    db_session_with_containers: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    scope, actor_id = _seed_historical_state(db_session_with_containers)
    sessions = sessionmaker(bind=db_session_with_containers.get_bind(), expire_on_commit=False)

    class DirectoryWithMalformedEmail:
        def read_directory(self) -> Directory:
            return Directory(
                (
                    DirectoryEntry(
                        ProviderUserId("provider-user-existing"),
                        "Existing Reviewer",
                        "existing-reviewer@example.com",
                    ),
                    DirectoryEntry(
                        ProviderUserId("provider-user-malformed"),
                        "Malformed Reviewer",
                        "not-an-email",
                    ),
                )
            )

    class AdapterWithMalformedEmail:
        directory = DirectoryWithMalformedEmail()

        def close(self) -> None:
            pass

    monkeypatch.setattr(reconcile_im_contacts_task, "apply_async", lambda **_kwargs: None)
    application = build_im_contact_sync_application(
        session_maker=sessions,
        adapter_factory=lambda _integration: AdapterWithMalformedEmail(),
    )

    active_run = application.sync_service.create_or_get_active_run(scope, actor_id)
    terminal_run = application.worker.execute(active_run.id, scope)

    assert terminal_run.status is IMSyncRunStatus.SUCCEEDED
    assert terminal_run.not_matched_count == 1
    assert terminal_run.skipped_count == 1
    db_session_with_containers.expire_all()
    identities = db_session_with_containers.scalars(
        select(HumanInputIMIdentity)
        .where(HumanInputIMIdentity.integration_id == str(_INTEGRATION_ID))
        .order_by(HumanInputIMIdentity.provider_user_id)
    ).all()
    assert [identity.provider_user_id for identity in identities] == [
        "provider-user-existing",
        "provider-user-malformed",
    ]
    assert identities[1].email == "not-an-email"
    assert identities[1].normalized_email is None
    assert (
        db_session_with_containers.scalar(
            select(func.count(HumanInputIMSyncResult.id)).where(
                HumanInputIMSyncResult.sync_run_id == str(active_run.id),
                HumanInputIMSyncResult.result_type == IMSyncResultType.NOT_MATCHED,
            )
        )
        == 1
    )


@pytest.mark.parametrize("precondition_change", ["email", "account_status", "membership", "deleted"])
def test_apply_rejects_a_changed_automatic_contact_target(
    db_session_with_containers: Session,
    precondition_change: str,
) -> None:
    scope, actor_id = _seed_historical_state(db_session_with_containers)
    sessions = sessionmaker(bind=db_session_with_containers.get_bind(), expire_on_commit=False)
    active_run = IMSyncRun.create(
        sync_run_id=_PRECONDITION_RUN_ID,
        integration_revision=IntegrationRevisionToken(_INTEGRATION_ID, 1),
        provider=IMProvider.FEISHU,
        started_by_account_id=actor_id,
        now=_HISTORICAL_AT,
    )
    db_session_with_containers.add(sync_run_to_record(active_run))
    db_session_with_containers.commit()

    run_ref = ReconciliationRunRef(active_run.id, active_run.integration_revision, active_run.provider)
    directory_entries = (
        DirectoryEntry(
            ProviderUserId("provider-user-new"),
            "New Reviewer",
            "new-reviewer@example.com",
        ),
    )
    with _write_unit_of_work(sessions, scope) as protected_repository:
        reconciliation_input = protected_repository.load_reconciliation_input(
            run_ref,
            directory_entries,
            scope,
        )
        plan = SyncReconciler.generate_plan(reconciliation_input)
    assert isinstance(plan, ReconciliationPlan)

    target_contact = db_session_with_containers.get_one(HumanInputContact, str(_NEW_CONTACT_ID))
    assert target_contact.account_id is not None
    if precondition_change == "email":
        db_session_with_containers.execute(
            update(HumanInputContact)
            .where(HumanInputContact.id == str(_NEW_CONTACT_ID))
            .values(
                email="changed-reviewer@example.com",
                normalized_email="changed-reviewer@example.com",
            )
        )
    elif precondition_change == "account_status":
        db_session_with_containers.execute(
            update(Account).where(Account.id == target_contact.account_id).values(status=AccountStatus.BANNED)
        )
    elif precondition_change == "membership":
        db_session_with_containers.execute(
            delete(TenantAccountJoin).where(
                TenantAccountJoin.tenant_id == str(scope.id),
                TenantAccountJoin.account_id == target_contact.account_id,
            )
        )
    else:
        db_session_with_containers.delete(target_contact)
    db_session_with_containers.commit()

    with _write_unit_of_work(sessions, scope) as protected_repository:
        apply_result = protected_repository.apply_plan(plan, now=_HISTORICAL_AT)

    assert apply_result.status is ApplyReconciliationStatus.PRECONDITION_FAILED
    db_session_with_containers.expire_all()
    run_record = db_session_with_containers.get(HumanInputIMSyncRun, str(active_run.id))
    assert run_record is not None
    assert run_record.status is IMSyncRunStatus.FAILED
    assert db_session_with_containers.scalar(select(func.count(HumanInputIMIdentity.id))) == 1
    assert db_session_with_containers.scalar(select(func.count(HumanInputIMBinding.id))) == 1
    assert db_session_with_containers.scalar(select(func.count(HumanInputIMReconciliationChange.id))) == 0


def test_real_redis_lock_has_bounded_acquisition_and_explicit_ttl_extension(
    flask_app_with_containers,
) -> None:
    del flask_app_with_containers
    lock_scope = OrganizationIMWriteScope.for_workspace(TenantId("lock-contract-workspace"))
    write_lock = OrganizationIMWriteLock(
        redis_client,
        lock_scope,
        acquisition_timeout_seconds=1,
        lease_seconds=2,
    )

    with write_lock:
        redis_client.pexpire(lock_scope.redis_key, 200)
        assert 0 < redis_client.pttl(lock_scope.redis_key) <= 200
        write_lock.extend()
        assert redis_client.pttl(lock_scope.redis_key) > 1_500

        contending_lock = OrganizationIMWriteLock(
            redis_client,
            lock_scope,
            acquisition_timeout_seconds=0.05,
            lease_seconds=2,
        )
        with pytest.raises(OrganizationIMWriteLockUnavailableError):
            with contending_lock:
                raise AssertionError("contending lock unexpectedly acquired")

    assert redis_client.exists(lock_scope.redis_key) == 0


def test_redis_ownership_loss_rolls_back_the_postgresql_transaction(
    db_session_with_containers: Session,
) -> None:
    scope, actor_id = _seed_historical_state(db_session_with_containers)
    sessions = sessionmaker(bind=db_session_with_containers.get_bind(), expire_on_commit=False)
    lock_scope = OrganizationIMWriteScope.for_workspace(scope.id)

    def write_then_lose_ownership() -> None:
        with _write_unit_of_work(sessions, scope) as protected_repository:
            decision = protected_repository.create_or_get_active_run(
                IntegrationRevisionToken(_INTEGRATION_ID, 1),
                organization_scope=scope,
                sync_run_id=_WAITING_RUN_ID,
                started_by_account_id=actor_id,
                now=_HISTORICAL_AT,
            )
            assert decision.kind is ActiveRunDecisionKind.CREATED
            redis_client.delete(lock_scope.redis_key)

    with pytest.raises(OrganizationIMWriteLockLostError):
        write_then_lose_ownership()

    db_session_with_containers.expire_all()
    assert db_session_with_containers.get(HumanInputIMSyncRun, str(_WAITING_RUN_ID)) is None


@pytest.mark.parametrize("release_kind", ["commit", "rollback"])
def test_waiting_integration_replacement_starts_sql_only_after_lock_release(
    db_session_with_containers: Session,
    release_kind: str,
) -> None:
    scope, actor_id = _seed_historical_state(db_session_with_containers)
    sessions = sessionmaker(bind=db_session_with_containers.get_bind(), expire_on_commit=False)
    transition = _replacement_transition(scope, actor_id)
    writer_started = threading.Event()
    writer_finished = threading.Event()
    writer_sql_started = threading.Event()
    writer_thread_id: list[int] = []
    writer_errors: list[Exception] = []

    def observe_writer_sql(_connection, _cursor, _statement, _parameters, _context, _executemany) -> None:
        if writer_thread_id and threading.get_ident() == writer_thread_id[0]:
            writer_sql_started.set()

    def replace_integration() -> None:
        writer_thread_id.append(threading.get_ident())
        writer_started.set()
        try:
            with _write_unit_of_work(sessions, scope) as protected_repository:
                replaced = protected_repository.compare_and_swap_configuration(
                    transition,
                    organization_scope=scope,
                )
                assert isinstance(replaced, IMIntegration)
        except Exception as error:
            writer_errors.append(error)
        finally:
            writer_finished.set()

    engine = db_session_with_containers.get_bind()
    event.listen(engine, "before_cursor_execute", observe_writer_sql)
    holder = _write_unit_of_work(sessions, scope)
    holder.__enter__()
    writer_thread = threading.Thread(target=replace_integration, name=f"integration-replacement-{release_kind}")
    try:
        writer_thread.start()
        assert writer_started.wait(timeout=1)
        assert not writer_sql_started.wait(timeout=0.2)
        with sessions() as read_session:
            assert read_session.get(HumanInputIMIntegration, str(_INTEGRATION_ID)) is not None
        assert not writer_finished.is_set()
    finally:
        if release_kind == "commit":
            holder.__exit__(None, None, None)
        else:
            rollback_error = RuntimeError("exercise rollback release")
            holder.__exit__(type(rollback_error), rollback_error, rollback_error.__traceback__)
        writer_thread.join(timeout=5)
        event.remove(engine, "before_cursor_execute", observe_writer_sql)

    assert not writer_thread.is_alive()
    assert writer_finished.is_set()
    assert writer_sql_started.is_set()
    assert writer_errors == []
    db_session_with_containers.expire_all()
    assert db_session_with_containers.get(HumanInputIMIntegration, str(_INTEGRATION_ID)) is None
    assert db_session_with_containers.get(HumanInputIMIntegration, str(_REPLACEMENT_INTEGRATION_ID)) is not None


def test_im_channel_manager_replaces_and_deletes_integration_through_the_organization_lock(
    db_session_with_containers: Session,
) -> None:
    scope, actor_id = _seed_historical_state(db_session_with_containers)
    sessions = sessionmaker(bind=db_session_with_containers.get_bind(), expire_on_commit=False)
    repository = SQLAlchemyIMControlPlaneRepository(
        sessions,
        lambda organization_scope: _write_unit_of_work(sessions, organization_scope),
    )

    class _SlackProviderPort:
        def prepare(self, context, candidate, current):
            del context, candidate, current
            return ConfirmedIMConfiguration(
                provider=IMProvider.SLACK,
                provider_tenant_id="slack-workspace",
                encrypted_credentials=EncryptedCredentials.from_mapping(
                    {
                        "client_id": "client-id",
                        "encrypted_client_secret": "client-secret",
                        "encrypted_signing_secret": "signing-secret",
                        "encrypted_bot_token": "bot-token",
                        "encrypted_app_token": "app-token",
                    }
                ),
            )

    manager = HumanInputIMChannelManager(
        _SLACK_REF,
        repository,
        _SlackProviderPort(),
        clock=lambda: _HISTORICAL_AT,
        id_factory=lambda: str(_REPLACEMENT_INTEGRATION_ID),
    )
    context = HumanInputChannelManagementContext(
        tenant_id=scope.id,
        actor_account_id=actor_id,
        actor_email=NormalizedEmail("existing-reviewer@example.com"),
    )
    candidate = SlackIMCandidate(
        client_id="client-id",
        client_secret=NewSecret("client-secret"),
        signing_secret=NewSecret("signing-secret"),
        bot_token=NewSecret("bot-token"),
        app_token=NewSecret("app-token"),
    )

    replaced = manager.save(
        context,
        SaveIMChannelCommand(
            ref=_SLACK_REF,
            candidate=candidate,
            expected_integration_id=str(_INTEGRATION_ID),
            expected_config_version=1,
        ),
    )

    assert replaced.view is not None
    current = repository.load_current_integration(scope.id)
    assert current is not None
    assert current.id == _REPLACEMENT_INTEGRATION_ID
    assert current.provider_tenant.provider is IMProvider.SLACK

    deleted = manager.delete(
        context,
        DeleteChannelCommand(
            ref=_SLACK_REF,
            expected_integration_id=str(current.id),
            expected_config_version=current.config_version,
        ),
    )

    assert deleted.view is not None
    assert repository.load_current_integration(scope.id) is None


def test_concurrent_workers_commit_one_reconciliation_fact_set(
    db_session_with_containers: Session,
    monkeypatch,
) -> None:
    scope, actor_id = _seed_historical_state(db_session_with_containers)
    sessions = sessionmaker(bind=db_session_with_containers.get_bind(), expire_on_commit=False)
    monkeypatch.setattr(reconcile_im_contacts_task, "apply_async", lambda **_kwargs: None)
    application = build_im_contact_sync_application(
        session_maker=sessions,
        adapter_factory=lambda _integration: _Adapter(),
    )
    active_run = application.sync_service.create_or_get_active_run(scope, actor_id)
    assert active_run.id != _HISTORICAL_RUN_ID
    start_barrier = threading.Barrier(3)
    terminal_runs: list[IMSyncRun] = []
    worker_errors: list[Exception] = []

    def execute_worker() -> None:
        try:
            start_barrier.wait(timeout=2)
            terminal_runs.append(application.worker.execute(active_run.id, scope))
        except Exception as error:
            worker_errors.append(error)

    workers = tuple(
        threading.Thread(target=execute_worker, name=f"im-contact-sync-worker-{index}") for index in range(2)
    )
    for worker in workers:
        worker.start()
    start_barrier.wait(timeout=2)
    for worker in workers:
        worker.join(timeout=10)

    assert all(not worker.is_alive() for worker in workers)
    assert worker_errors == []
    assert len(terminal_runs) == 2
    assert all(run.status is IMSyncRunStatus.SUCCEEDED for run in terminal_runs)
    db_session_with_containers.expire_all()
    assert db_session_with_containers.scalar(select(func.count(HumanInputIMIdentity.id))) == 2
    assert db_session_with_containers.scalar(select(func.count(HumanInputIMBinding.id))) == 2
    assert db_session_with_containers.scalar(select(func.count(HumanInputIMSyncResult.id))) == 3
    assert db_session_with_containers.scalar(select(func.count(HumanInputIMReconciliationChange.id))) == 3


def _replacement_transition(scope: WorkspaceScope, actor_id: AccountId) -> ConfigurationTransition:
    current = IMIntegration.create(
        integration_id=_INTEGRATION_ID,
        tenant_id=scope.id,
        provider_tenant=ProviderTenantIdentity(IMProvider.FEISHU, "provider-tenant-1"),
        encrypted_credentials=EncryptedCredentials.from_mapping(
            {"app_id": "app-1", "encrypted_app_secret": "ciphertext"}
        ),
        configured_by_account_id=actor_id,
        callback_url=None,
        now=_HISTORICAL_AT,
    )
    transition = current.reconfigure(
        expected_revision=current.revision,
        provider_tenant=ProviderTenantIdentity(IMProvider.FEISHU, "provider-tenant-2"),
        encrypted_credentials=EncryptedCredentials.from_mapping(
            {"app_id": "app-2", "encrypted_app_secret": "ciphertext-2"}
        ),
        configured_by_account_id=actor_id,
        callback_url=None,
        replacement_integration_id=_REPLACEMENT_INTEGRATION_ID,
        now=_HISTORICAL_AT,
    )
    assert isinstance(transition, ConfigurationTransition)
    return transition


def _write_unit_of_work(
    sessions: sessionmaker[Session],
    scope: WorkspaceScope,
) -> SQLAlchemyOrganizationIMWriteUnitOfWork:
    return SQLAlchemyOrganizationIMWriteUnitOfWork(
        sessions,
        OrganizationIMWriteLock(
            redis_client,
            OrganizationIMWriteScope.for_workspace(scope.id),
            acquisition_timeout_seconds=1,
            lease_seconds=10,
        ),
    )
