"""SQLite transaction tests for guarded conditional reconciliation apply."""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime

import pytest
from sqlalchemy import Engine, event, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from core.human_input_v2.entities import (
    IMBindingScope,
    IMIntegrationStatus,
    IMProvider,
    IMSyncResultType,
    IMSyncRunStatus,
)
from core.human_input_v2.im_integration import (
    ActiveRunDecisionKind,
    ApplyReconciliationStatus,
    ConfigurationTransition,
    CurrentIMBindingState,
    CurrentIMIdentityState,
    EncryptedCredentials,
    IMBinding,
    IMIdentity,
    IMIntegration,
    IMSyncRun,
    IntegrationDeletion,
    IntegrationRevisionToken,
    ProviderTenantIdentity,
    ReconciliationInput,
    ReconciliationPlan,
    ReconciliationRunRef,
    SyncReconciler,
)
from core.human_input_v2.im_integration.adapters import DirectoryEntry, ProviderUserId
from core.human_input_v2.shared import (
    AccountId,
    ContactId,
    IMBindingId,
    IMIdentityId,
    IMSyncRunId,
    IntegrationId,
    TenantId,
    WorkspaceScope,
)
from models.account import Tenant
from models.human_input_v2 import (
    HumanInputIMBinding,
    HumanInputIMIdentity,
    HumanInputIMIntegration,
    HumanInputIMReconciliationChange,
    HumanInputIMSyncResult,
    HumanInputIMSyncRun,
    IMEncryptedCredentials,
)
from repositories.human_input_v2.im_integration.mappers import (
    binding_to_record,
    identity_to_record,
    integration_from_record,
    sync_run_to_record,
)
from repositories.human_input_v2.im_integration.unit_of_work import SQLAlchemyOrganizationIMWriteUnitOfWork

_NOW = datetime(2026, 8, 11, 8)
_LATER = datetime(2026, 8, 11, 9)
_INTEGRATION_ID = IntegrationId("integration-1")
_TENANT_ID = TenantId("workspace-1")


class _OwnedWriteLock:
    def __init__(self) -> None:
        self.held = False

    def __enter__(self) -> _OwnedWriteLock:
        self.held = True
        return self

    def __exit__(self, *unused: object) -> None:
        self.held = False

    def ensure_owned(self) -> None:
        if not self.held:
            raise RuntimeError("lock is not held")

    def extend(self) -> None:
        self.ensure_owned()


@pytest.fixture
def write_context(sqlite_engine: Engine) -> tuple[sessionmaker[Session], _OwnedWriteLock]:
    tables = [
        Tenant.__table__,
        HumanInputIMIntegration.__table__,
        HumanInputIMIdentity.__table__,
        HumanInputIMBinding.__table__,
        HumanInputIMSyncRun.__table__,
        HumanInputIMSyncResult.__table__,
        HumanInputIMReconciliationChange.__table__,
    ]
    HumanInputIMIntegration.metadata.create_all(sqlite_engine, tables=tables)
    session_maker = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    lock = _OwnedWriteLock()
    with session_maker.begin() as session:
        tenant = Tenant(name="IM reconciliation unit tests")
        tenant.id = str(_TENANT_ID)
        integration = HumanInputIMIntegration(
            provider=IMProvider.FEISHU,
            encrypted_credentials=IMEncryptedCredentials(ciphertext="opaque-ciphertext"),
            tenant_id=str(_TENANT_ID),
            provider_tenant_id="provider-tenant-1",
            app_identifier="app-1",
            status=IMIntegrationStatus.CONFIGURED,
            config_version=1,
        )
        integration.id = str(_INTEGRATION_ID)
        session.add_all((tenant, integration))
    return session_maker, lock


def _run_ref(run_id: str) -> ReconciliationRunRef:
    return ReconciliationRunRef(
        IMSyncRunId(run_id),
        IntegrationRevisionToken(_INTEGRATION_ID, 1),
        IMProvider.FEISHU,
    )


def _persist_run(session_maker: sessionmaker[Session], run: ReconciliationRunRef) -> None:
    sync_run = IMSyncRun.create(
        sync_run_id=run.sync_run_id,
        integration_revision=run.integration_revision,
        provider=run.provider,
        started_by_account_id=None,
        now=_NOW,
    )
    with session_maker.begin() as session:
        session.add(sync_run_to_record(sync_run))


def _plan(
    run: ReconciliationRunRef,
    *entries: DirectoryEntry,
    identities: tuple[CurrentIMIdentityState, ...] = (),
    bindings: tuple[CurrentIMBindingState, ...] = (),
    reconciled_binding_ids: frozenset[IMBindingId] = frozenset(),
) -> ReconciliationPlan:
    generated = SyncReconciler.generate_plan(
        ReconciliationInput(run, entries, identities, bindings, reconciled_binding_ids, ())
    )
    assert isinstance(generated, ReconciliationPlan)
    return generated


def _assert_apply_writes_rolled_back(
    session_maker: sessionmaker[Session],
    run: ReconciliationRunRef,
) -> None:
    with session_maker() as session:
        stored_run = session.get_one(HumanInputIMSyncRun, str(run.sync_run_id))
        assert stored_run.status is IMSyncRunStatus.QUEUED
        assert session.scalar(select(func.count(HumanInputIMIdentity.id))) == 0
        assert session.scalar(select(func.count(HumanInputIMBinding.id))) == 0
        assert session.scalar(select(func.count(HumanInputIMReconciliationChange.id))) == 0
        assert session.scalar(select(func.count(HumanInputIMSyncResult.id))) == 0


def test_protected_repository_is_exposed_only_while_lock_and_transaction_are_active(write_context) -> None:
    session_maker, lock = write_context
    unit_of_work = SQLAlchemyOrganizationIMWriteUnitOfWork(session_maker, lock)

    with pytest.raises(RuntimeError, match="active"):
        _ = unit_of_work.protected_repository

    with unit_of_work as protected_repository:
        assert lock.held is True
        assert protected_repository is unit_of_work.protected_repository

    assert lock.held is False
    with pytest.raises(RuntimeError, match="active"):
        _ = unit_of_work.protected_repository


def test_active_run_creation_is_available_only_through_guarded_repository(write_context) -> None:
    session_maker, lock = write_context

    with SQLAlchemyOrganizationIMWriteUnitOfWork(session_maker, lock) as repository:
        created = repository.create_or_get_active_run(
            IntegrationRevisionToken(_INTEGRATION_ID, 1),
            organization_scope=WorkspaceScope(id=_TENANT_ID),
            sync_run_id=IMSyncRunId("run-created"),
            started_by_account_id=AccountId("account-1"),
            now=_NOW,
        )
        existing = repository.create_or_get_active_run(
            IntegrationRevisionToken(_INTEGRATION_ID, 1),
            organization_scope=WorkspaceScope(id=_TENANT_ID),
            sync_run_id=IMSyncRunId("run-duplicate"),
            started_by_account_id=AccountId("account-2"),
            now=_LATER,
        )

    assert created.kind is ActiveRunDecisionKind.CREATED
    assert created.run is not None
    assert existing.kind is ActiveRunDecisionKind.EXISTING_ACTIVE
    assert existing.run == created.run
    with session_maker() as session:
        assert session.scalar(select(func.count(HumanInputIMSyncRun.id))) == 1


def test_unmatched_identity_apply_is_atomic_and_redelivery_is_idempotent(write_context) -> None:
    session_maker, lock = write_context
    run = _run_ref("run-1")
    _persist_run(session_maker, run)
    plan = _plan(run, DirectoryEntry(ProviderUserId("provider-user-1"), "Reviewer", None))

    with SQLAlchemyOrganizationIMWriteUnitOfWork(session_maker, lock) as repository:
        applied = repository.apply_plan(plan, now=_LATER)
    with SQLAlchemyOrganizationIMWriteUnitOfWork(session_maker, lock) as repository:
        replayed = repository.apply_plan(plan, now=_LATER)

    assert applied.status is ApplyReconciliationStatus.APPLIED
    assert applied.result_count == 1
    assert applied.change_count == 1
    assert replayed.status is ApplyReconciliationStatus.ALREADY_APPLIED
    assert replayed.result_count == 1
    assert replayed.change_count == 1
    with session_maker() as session:
        assert session.scalar(select(func.count(HumanInputIMIdentity.id))) == 1
        assert session.scalar(select(func.count(HumanInputIMBinding.id))) == 0
        assert session.scalar(select(func.count(HumanInputIMReconciliationChange.id))) == 1
        assert session.scalar(select(func.count(HumanInputIMSyncResult.id))) == 1
        result = session.scalar(select(HumanInputIMSyncResult))
        assert result is not None
        assert result.result_type is IMSyncResultType.NOT_MATCHED
        assert result.operation_key == plan.sync_results[0].operation_key


def test_changed_identity_precondition_rolls_back_plan_and_returns_stable_outcome(write_context) -> None:
    session_maker, lock = write_context
    run = _run_ref("run-precondition")
    _persist_run(session_maker, run)
    identity = IMIdentity.create(
        identity_id=IMIdentityId("identity-1"),
        integration_id=_INTEGRATION_ID,
        provider=IMProvider.FEISHU,
        provider_user_id="provider-user-1",
        display_name="Captured",
        email=None,
        raw_payload={},
        last_seen_sync_run_id=None,
        last_seen_at=_NOW,
        now=_NOW,
    )
    with session_maker.begin() as session:
        session.add(identity_to_record(identity))
    captured = CurrentIMIdentityState(
        identity.id,
        ProviderUserId(identity.provider_user_id),
        identity.display_name,
        identity.email,
        identity.normalized_email,
        identity.last_seen_sync_run_id,
    )
    plan = _plan(
        run,
        DirectoryEntry(ProviderUserId("provider-user-1"), "Planned", None),
        identities=(captured,),
    )
    with session_maker.begin() as session:
        session.get_one(HumanInputIMIdentity, str(identity.id)).display_name = "Concurrent"

    with SQLAlchemyOrganizationIMWriteUnitOfWork(session_maker, lock) as repository:
        outcome = repository.apply_plan(plan, now=_LATER)
    with SQLAlchemyOrganizationIMWriteUnitOfWork(session_maker, lock) as repository:
        replayed = repository.apply_plan(plan, now=_LATER)

    assert outcome.status is ApplyReconciliationStatus.PRECONDITION_FAILED
    assert replayed.status is ApplyReconciliationStatus.PRECONDITION_FAILED
    with session_maker() as session:
        stored_identity = session.get_one(HumanInputIMIdentity, str(identity.id))
        stored_run = session.get_one(HumanInputIMSyncRun, str(run.sync_run_id))
        assert stored_identity.display_name == "Concurrent"
        assert stored_run.status is IMSyncRunStatus.FAILED
        assert session.scalar(select(func.count(HumanInputIMReconciliationChange.id))) == 0


def test_stale_revision_appends_one_idempotent_terminal_diagnostic(write_context) -> None:
    session_maker, lock = write_context
    run = _run_ref("run-stale")
    _persist_run(session_maker, run)
    plan = _plan(run)
    with session_maker.begin() as session:
        session.get_one(HumanInputIMIntegration, str(_INTEGRATION_ID)).config_version = 2

    with SQLAlchemyOrganizationIMWriteUnitOfWork(session_maker, lock) as repository:
        outcome = repository.apply_plan(plan, now=_LATER)
    with SQLAlchemyOrganizationIMWriteUnitOfWork(session_maker, lock) as repository:
        replayed = repository.apply_plan(plan, now=_LATER)

    assert outcome.status is ApplyReconciliationStatus.STALE_REVISION
    assert outcome.result_count == 1
    assert replayed.status is ApplyReconciliationStatus.STALE_REVISION
    assert replayed.result_count == 1
    with session_maker() as session:
        diagnostic = session.scalar(select(HumanInputIMSyncResult))
        assert diagnostic is not None
        assert diagnostic.result_type is IMSyncResultType.FAILED
        assert diagnostic.reason_code == ApplyReconciliationStatus.STALE_REVISION.value
        assert diagnostic.operation_key == "diagnostic:stale_revision"
        assert session.scalar(select(func.count(HumanInputIMIdentity.id))) == 0
        assert session.scalar(select(func.count(HumanInputIMReconciliationChange.id))) == 0


def test_explicit_terminal_diagnostic_is_guarded_and_idempotent(write_context) -> None:
    session_maker, lock = write_context
    run = _run_ref("run-directory-failure")
    _persist_run(session_maker, run)

    with SQLAlchemyOrganizationIMWriteUnitOfWork(session_maker, lock) as repository:
        failed = repository.fail_run(
            run.sync_run_id,
            ApplyReconciliationStatus.DIRECTORY_READ_FAILED,
            now=_LATER,
            message="Provider directory could not be read.",
        )
    with SQLAlchemyOrganizationIMWriteUnitOfWork(session_maker, lock) as repository:
        replayed = repository.fail_run(
            run.sync_run_id,
            ApplyReconciliationStatus.DIRECTORY_READ_FAILED,
            now=_LATER,
            message="Provider directory could not be read.",
        )

    assert failed.status is ApplyReconciliationStatus.DIRECTORY_READ_FAILED
    assert replayed.status is ApplyReconciliationStatus.DIRECTORY_READ_FAILED
    with session_maker() as session:
        stored_run = session.get_one(HumanInputIMSyncRun, str(run.sync_run_id))
        stored_result = session.scalar(
            select(HumanInputIMSyncResult).where(HumanInputIMSyncResult.sync_run_id == str(run.sync_run_id))
        )
        assert stored_run.status is IMSyncRunStatus.FAILED
        assert stored_run.error_code == ApplyReconciliationStatus.DIRECTORY_READ_FAILED.value
        assert stored_run.error_message == "Provider directory could not be read."
        assert stored_result is not None
        assert stored_result.reason_code == ApplyReconciliationStatus.DIRECTORY_READ_FAILED.value
        assert (
            session.scalar(
                select(func.count(HumanInputIMSyncResult.id)).where(
                    HumanInputIMSyncResult.sync_run_id == str(run.sync_run_id)
                )
            )
            == 1
        )


def test_absent_unbound_identity_writes_only_identity_change(write_context) -> None:
    session_maker, lock = write_context
    run = _run_ref("run-unbound-deletion")
    _persist_run(session_maker, run)
    identity = IMIdentity.create(
        identity_id=IMIdentityId("identity-unbound"),
        integration_id=_INTEGRATION_ID,
        provider=IMProvider.FEISHU,
        provider_user_id="provider-user-unbound",
        display_name="Unbound Reviewer",
        email=None,
        raw_payload={},
        last_seen_sync_run_id=None,
        last_seen_at=_NOW,
        now=_NOW,
    )
    with session_maker.begin() as session:
        session.add(identity_to_record(identity))
    plan = _plan(
        run,
        identities=(
            CurrentIMIdentityState(
                identity.id,
                ProviderUserId(identity.provider_user_id),
                identity.display_name,
                identity.email,
                identity.normalized_email,
                identity.last_seen_sync_run_id,
            ),
        ),
    )

    with SQLAlchemyOrganizationIMWriteUnitOfWork(session_maker, lock) as repository:
        outcome = repository.apply_plan(plan, now=_LATER)

    assert outcome.status is ApplyReconciliationStatus.APPLIED
    assert outcome.result_count == 0
    assert outcome.change_count == 1
    with session_maker() as session:
        assert session.scalar(select(func.count(HumanInputIMIdentity.id))) == 0
        assert session.scalar(select(func.count(HumanInputIMSyncResult.id))) == 0
        assert session.scalar(select(func.count(HumanInputIMReconciliationChange.id))) == 1


def test_change_log_constraint_failure_rolls_back_current_state(write_context) -> None:
    session_maker, lock = write_context
    run = _run_ref("run-change-log-failure")
    _persist_run(session_maker, run)
    plan = _plan(
        run,
        DirectoryEntry(ProviderUserId("provider-user-a"), "Reviewer A", None),
        DirectoryEntry(ProviderUserId("provider-user-b"), "Reviewer B", None),
    )
    duplicate_change_key_plan = replace(
        plan,
        identity_upserts=(
            plan.identity_upserts[0],
            replace(plan.identity_upserts[1], operation_key=plan.identity_upserts[0].operation_key),
        ),
    )

    with pytest.raises(IntegrityError):
        with SQLAlchemyOrganizationIMWriteUnitOfWork(session_maker, lock) as repository:
            repository.apply_plan(duplicate_change_key_plan, now=_LATER)

    _assert_apply_writes_rolled_back(session_maker, run)


def test_product_result_constraint_failure_rolls_back_changes_and_current_state(write_context) -> None:
    session_maker, lock = write_context
    run = _run_ref("run-result-failure")
    _persist_run(session_maker, run)
    plan = _plan(
        run,
        DirectoryEntry(ProviderUserId("provider-user-a"), "Reviewer A", None),
        DirectoryEntry(ProviderUserId("provider-user-b"), "Reviewer B", None),
    )
    duplicate_result_key_plan = replace(
        plan,
        sync_results=(
            plan.sync_results[0],
            replace(plan.sync_results[1], operation_key=plan.sync_results[0].operation_key),
        ),
    )

    with pytest.raises(IntegrityError):
        with SQLAlchemyOrganizationIMWriteUnitOfWork(session_maker, lock) as repository:
            repository.apply_plan(duplicate_result_key_plan, now=_LATER)

    _assert_apply_writes_rolled_back(session_maker, run)


def test_terminal_run_flush_failure_rolls_back_current_state_and_facts(write_context) -> None:
    session_maker, lock = write_context
    run = _run_ref("run-terminal-failure")
    _persist_run(session_maker, run)
    plan = _plan(run, DirectoryEntry(ProviderUserId("provider-user-1"), "Reviewer", None))

    def reject_terminal_run_update(*_unused: object) -> None:
        raise RuntimeError("terminal run update rejected")

    event.listen(HumanInputIMSyncRun, "before_update", reject_terminal_run_update)
    try:
        with pytest.raises(RuntimeError, match="terminal run update rejected"):
            with SQLAlchemyOrganizationIMWriteUnitOfWork(session_maker, lock) as repository:
                repository.apply_plan(plan, now=_LATER)
    finally:
        event.remove(HumanInputIMSyncRun, "before_update", reject_terminal_run_update)

    _assert_apply_writes_rolled_back(session_maker, run)


def test_lock_ownership_loss_before_commit_rolls_back_current_state_and_facts(write_context) -> None:
    session_maker, lock = write_context
    run = _run_ref("run-lock-loss")
    _persist_run(session_maker, run)
    plan = _plan(run, DirectoryEntry(ProviderUserId("provider-user-1"), "Reviewer", None))

    def apply_then_lose_lock() -> None:
        with SQLAlchemyOrganizationIMWriteUnitOfWork(session_maker, lock) as repository:
            outcome = repository.apply_plan(plan, now=_LATER)
            assert outcome.status is ApplyReconciliationStatus.APPLIED
            lock.held = False

    with pytest.raises(RuntimeError, match="lock is not held"):
        apply_then_lose_lock()

    _assert_apply_writes_rolled_back(session_maker, run)
