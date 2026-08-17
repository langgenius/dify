"""SQLite transaction tests for guarded conditional reconciliation apply."""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime

import pytest
from sqlalchemy import Engine, event, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from core.human_input_v2.contact_directory import Contact
from core.human_input_v2.entities import (
    IMBindingScope,
    IMIntegrationStatus,
    IMProvider,
    IMSyncRemovalReason,
    IMSyncResultType,
    IMSyncRunStatus,
)
from core.human_input_v2.im_integration import (
    ActiveRunDecisionKind,
    ApplyReconciliationStatus,
    ConfigurationTransition,
    ContactEmailMatchState,
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
from core.human_input_v2.im_provider import DirectoryEntry, ProviderUserId
from core.human_input_v2.shared import (
    AccountId,
    ContactId,
    IMBindingId,
    IMIdentityId,
    IMSyncRunId,
    IntegrationId,
    NormalizedEmail,
    TenantId,
    WorkspaceScope,
)
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.human_input_v2 import (
    FeishuIMIntegrationEncryptedCredentials,
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
        Account.__table__,
        TenantAccountJoin.__table__,
        HumanInputIMIntegration.__table__,
        HumanInputContact.__table__,
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
            encrypted_credentials=FeishuIMIntegrationEncryptedCredentials(
                app_id="app-1", encrypted_app_secret="ciphertext"
            ),
            tenant_id=str(_TENANT_ID),
            provider_tenant_id="provider-tenant-1",
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


def _workspace_contact(
    session_maker: sessionmaker[Session],
    *,
    contact_id: ContactId,
    account_id: AccountId,
    name: str,
    email: str,
) -> Contact:
    account = Account(
        name=name,
        email=email,
        password="hashed-password",
        password_salt="salt",
        interface_language="en-US",
        timezone="UTC",
    )
    account.id = str(account_id)
    contact = Contact.workspace_member(
        contact_id=contact_id,
        tenant_id=_TENANT_ID,
        account_id=account_id,
        name=name,
        email=email,
        now=_NOW,
    )
    with session_maker.begin() as session:
        session.add_all(
            (
                account,
                TenantAccountJoin(
                    tenant_id=str(_TENANT_ID),
                    account_id=str(account_id),
                    current=True,
                    role=TenantAccountRole.NORMAL,
                ),
                contact_to_record(contact),
            )
        )
    return contact


def _plan(
    run: ReconciliationRunRef,
    *entries: DirectoryEntry,
    identities: tuple[CurrentIMIdentityState, ...] = (),
    bindings: tuple[CurrentIMBindingState, ...] = (),
    reconciled_binding_ids: frozenset[IMBindingId] = frozenset(),
    contacts: tuple[ContactEmailMatchState, ...] = (),
) -> ReconciliationPlan:
    generated = SyncReconciler.generate_plan(
        ReconciliationInput(run, entries, identities, bindings, reconciled_binding_ids, contacts)
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


def test_configuration_rotation_is_available_only_through_guarded_repository(write_context) -> None:
    session_maker, lock = write_context
    with session_maker() as session:
        current = integration_from_record(session.get_one(HumanInputIMIntegration, str(_INTEGRATION_ID)))
    transition = current.reconfigure(
        expected_revision=current.revision,
        provider_tenant=ProviderTenantIdentity(IMProvider.FEISHU, "provider-tenant-1"),
        encrypted_credentials=EncryptedCredentials.from_mapping({"app_id": "app-1", "encrypted_app_secret": "rotated"}),
        configured_by_account_id=AccountId("account-2"),
        callback_url=None,
        now=_LATER,
    )
    assert isinstance(transition, ConfigurationTransition)

    with SQLAlchemyOrganizationIMWriteUnitOfWork(session_maker, lock) as repository:
        updated = repository.compare_and_swap_configuration(
            transition,
            organization_scope=WorkspaceScope(id=_TENANT_ID),
        )

    assert isinstance(updated, IMIntegration)
    assert updated.config_version == 2
    with session_maker() as session:
        stored = session.get_one(HumanInputIMIntegration, str(_INTEGRATION_ID))
        assert stored.config_version == 2
        assert stored.configured_by_account_id == "account-2"


def test_provider_replacement_invalidates_current_children_inside_guarded_transaction(write_context) -> None:
    session_maker, lock = write_context
    identity = IMIdentity.create(
        identity_id=IMIdentityId("identity-replaced"),
        integration_id=_INTEGRATION_ID,
        provider=IMProvider.FEISHU,
        provider_user_id="provider-user-replaced",
        display_name="Replaced",
        email=None,
        raw_payload={},
        last_seen_sync_run_id=None,
        last_seen_at=_NOW,
        now=_NOW,
    )
    binding = IMBinding.create(
        binding_id=IMBindingId("binding-replaced"),
        integration_id=_INTEGRATION_ID,
        scope=IMBindingScope.ORGANIZATION,
        scope_id=str(_INTEGRATION_ID),
        contact_id=ContactId("contact-replaced"),
        identity_id=identity.id,
        provider=IMProvider.FEISHU,
        bound_by_account_id=None,
        now=_NOW,
    )
    with session_maker.begin() as session:
        current = integration_from_record(session.get_one(HumanInputIMIntegration, str(_INTEGRATION_ID)))
        session.add(identity_to_record(identity))
        session.add(binding_to_record(binding))
    transition = current.reconfigure(
        expected_revision=current.revision,
        provider_tenant=ProviderTenantIdentity(IMProvider.SLACK, "slack-workspace"),
        encrypted_credentials=EncryptedCredentials.from_mapping(
            {
                "client_id": "client-1",
                "encrypted_client_secret": "secret",
                "encrypted_signing_secret": "signing",
                "encrypted_bot_token": "bot-token",
                "encrypted_app_token": "app-token",
            }
        ),
        configured_by_account_id=AccountId("account-2"),
        callback_url=None,
        now=_LATER,
        replacement_integration_id=IntegrationId("integration-replacement"),
    )
    assert isinstance(transition, ConfigurationTransition)

    with SQLAlchemyOrganizationIMWriteUnitOfWork(session_maker, lock) as repository:
        replacement = repository.compare_and_swap_configuration(
            transition,
            organization_scope=WorkspaceScope(id=_TENANT_ID),
        )

    assert isinstance(replacement, IMIntegration)
    assert replacement.id == IntegrationId("integration-replacement")
    with session_maker() as session:
        assert session.get(HumanInputIMIntegration, str(_INTEGRATION_ID)) is None
        assert session.get(HumanInputIMIntegration, "integration-replacement") is not None
        assert session.scalar(select(func.count(HumanInputIMIdentity.id))) == 0
        assert session.scalar(select(func.count(HumanInputIMBinding.id))) == 0


def test_integration_creation_is_available_only_through_guarded_repository(write_context) -> None:
    session_maker, lock = write_context
    with session_maker.begin() as session:
        session.delete(session.get_one(HumanInputIMIntegration, str(_INTEGRATION_ID)))
    integration = IMIntegration.create(
        integration_id=IntegrationId("integration-created"),
        tenant_id=_TENANT_ID,
        provider_tenant=ProviderTenantIdentity(IMProvider.FEISHU, "provider-tenant-created"),
        encrypted_credentials=EncryptedCredentials.from_mapping(
            {"app_id": "app-created", "encrypted_app_secret": "ciphertext"}
        ),
        configured_by_account_id=AccountId("account-1"),
        callback_url=None,
        now=_NOW,
    )

    with SQLAlchemyOrganizationIMWriteUnitOfWork(session_maker, lock) as repository:
        created = repository.create_integration(
            integration,
            organization_scope=WorkspaceScope(id=_TENANT_ID),
        )

    assert created == integration
    with session_maker() as session:
        assert session.get(HumanInputIMIntegration, "integration-created") is not None


def test_integration_deletion_invalidates_current_children_inside_guarded_transaction(write_context) -> None:
    session_maker, lock = write_context
    identity = IMIdentity.create(
        identity_id=IMIdentityId("identity-deleted"),
        integration_id=_INTEGRATION_ID,
        provider=IMProvider.FEISHU,
        provider_user_id="provider-user-deleted",
        display_name="Deleted",
        email=None,
        raw_payload={},
        last_seen_sync_run_id=None,
        last_seen_at=_NOW,
        now=_NOW,
    )
    binding = IMBinding.create(
        binding_id=IMBindingId("binding-deleted"),
        integration_id=_INTEGRATION_ID,
        scope=IMBindingScope.ORGANIZATION,
        scope_id=str(_INTEGRATION_ID),
        contact_id=ContactId("contact-deleted"),
        identity_id=identity.id,
        provider=IMProvider.FEISHU,
        bound_by_account_id=None,
        now=_NOW,
    )
    with session_maker.begin() as session:
        session.add(identity_to_record(identity))
        session.add(binding_to_record(binding))

    with SQLAlchemyOrganizationIMWriteUnitOfWork(session_maker, lock) as repository:
        deleted = repository.compare_and_swap_delete(
            IntegrationDeletion(IntegrationRevisionToken(_INTEGRATION_ID, 1)),
            organization_scope=WorkspaceScope(id=_TENANT_ID),
        )

    assert deleted is None
    with session_maker() as session:
        assert session.get(HumanInputIMIntegration, str(_INTEGRATION_ID)) is None
        assert session.scalar(select(func.count(HumanInputIMIdentity.id))) == 0
        assert session.scalar(select(func.count(HumanInputIMBinding.id))) == 0


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


def test_binding_replacement_preserves_planned_removal_reason(write_context) -> None:
    session_maker, lock = write_context
    run = _run_ref("run-replacement")
    _persist_run(session_maker, run)
    contact = _workspace_contact(
        session_maker,
        contact_id=ContactId("contact-1"),
        account_id=AccountId("account-1"),
        name="Reviewer",
        email="reviewer@example.com",
    )
    previous_identity = IMIdentity.create(
        identity_id=IMIdentityId("identity-previous"),
        integration_id=_INTEGRATION_ID,
        provider=IMProvider.FEISHU,
        provider_user_id="provider-user-previous",
        display_name="Previous Reviewer",
        email="reviewer@example.com",
        raw_payload={},
        last_seen_sync_run_id=None,
        last_seen_at=_NOW,
        now=_NOW,
    )
    previous_binding = IMBinding.create(
        binding_id=IMBindingId("binding-1"),
        integration_id=_INTEGRATION_ID,
        scope=IMBindingScope.ORGANIZATION,
        scope_id=str(_INTEGRATION_ID),
        contact_id=contact.id,
        identity_id=previous_identity.id,
        provider=IMProvider.FEISHU,
        bound_by_account_id=None,
        now=_NOW,
    )
    with session_maker.begin() as session:
        session.add(identity_to_record(previous_identity))
        session.add(binding_to_record(previous_binding))
    captured_identity = CurrentIMIdentityState(
        previous_identity.id,
        ProviderUserId(previous_identity.provider_user_id),
        previous_identity.display_name,
        previous_identity.email,
        previous_identity.normalized_email,
        previous_identity.last_seen_sync_run_id,
    )
    captured_binding = CurrentIMBindingState(
        previous_binding.id,
        previous_binding.identity_id,
        previous_binding.contact_id,
    )
    plan = _plan(
        run,
        DirectoryEntry(ProviderUserId("provider-user-next"), "Reviewer", "reviewer@example.com"),
        identities=(captured_identity,),
        bindings=(captured_binding,),
        reconciled_binding_ids=frozenset((previous_binding.id,)),
        contacts=(
            ContactEmailMatchState(
                contact.id,
                contact.name,
                contact.email,
                NormalizedEmail("reviewer@example.com"),
                contact.avatar_file_id,
            ),
        ),
    )

    with SQLAlchemyOrganizationIMWriteUnitOfWork(session_maker, lock) as repository:
        outcome = repository.apply_plan(plan, now=_LATER)

    assert outcome.status is ApplyReconciliationStatus.APPLIED
    with session_maker() as session:
        removed_result = session.scalar(
            select(HumanInputIMSyncResult).where(HumanInputIMSyncResult.result_type == IMSyncResultType.REMOVED)
        )
        assert removed_result is not None
        assert removed_result.removal_reason is IMSyncRemovalReason.BINDING_REPLACED


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


def test_unique_contact_match_creates_binding_and_records_both_mutations(write_context) -> None:
    session_maker, lock = write_context
    run = _run_ref("run-binding-create")
    _persist_run(session_maker, run)
    contact = _workspace_contact(
        session_maker,
        contact_id=ContactId("contact-create"),
        account_id=AccountId("account-create"),
        name="New Reviewer",
        email="new-reviewer@example.com",
    )
    plan = _plan(
        run,
        DirectoryEntry(
            ProviderUserId("provider-user-create"),
            "New Reviewer",
            "new-reviewer@example.com",
        ),
        contacts=(
            ContactEmailMatchState(
                contact.id,
                contact.name,
                contact.email,
                NormalizedEmail("new-reviewer@example.com"),
                contact.avatar_file_id,
            ),
        ),
    )

    with SQLAlchemyOrganizationIMWriteUnitOfWork(session_maker, lock) as repository:
        outcome = repository.apply_plan(plan, now=_LATER)

    assert outcome.status is ApplyReconciliationStatus.APPLIED
    assert outcome.result_count == 1
    assert outcome.change_count == 2
    with session_maker() as session:
        assert session.scalar(select(func.count(HumanInputIMIdentity.id))) == 1
        assert session.scalar(select(func.count(HumanInputIMBinding.id))) == 1
        result = session.scalar(select(HumanInputIMSyncResult))
        assert result is not None
        assert result.result_type is IMSyncResultType.ADDED
        assert result.im_binding_id is not None


def test_absent_bound_identity_deletes_binding_before_identity(write_context) -> None:
    session_maker, lock = write_context
    run = _run_ref("run-bound-deletion")
    _persist_run(session_maker, run)
    contact = Contact.organization_account(
        contact_id=ContactId("contact-delete"),
        account_id=AccountId("account-delete"),
        name="Departed Reviewer",
        email="departed@example.com",
        now=_NOW,
    )
    identity = IMIdentity.create(
        identity_id=IMIdentityId("identity-delete"),
        integration_id=_INTEGRATION_ID,
        provider=IMProvider.FEISHU,
        provider_user_id="provider-user-delete",
        display_name="Departed Reviewer",
        email="departed@example.com",
        raw_payload={},
        last_seen_sync_run_id=None,
        last_seen_at=_NOW,
        now=_NOW,
    )
    binding = IMBinding.create(
        binding_id=IMBindingId("binding-delete"),
        integration_id=_INTEGRATION_ID,
        scope=IMBindingScope.ORGANIZATION,
        scope_id=str(_INTEGRATION_ID),
        contact_id=contact.id,
        identity_id=identity.id,
        provider=IMProvider.FEISHU,
        bound_by_account_id=None,
        now=_NOW,
    )
    with session_maker.begin() as session:
        session.add(contact_to_record(contact))
        session.add(identity_to_record(identity))
        session.add(binding_to_record(binding))
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
        bindings=(CurrentIMBindingState(binding.id, binding.identity_id, binding.contact_id),),
        reconciled_binding_ids=frozenset((binding.id,)),
    )

    with SQLAlchemyOrganizationIMWriteUnitOfWork(session_maker, lock) as repository:
        outcome = repository.apply_plan(plan, now=_LATER)

    assert outcome.status is ApplyReconciliationStatus.APPLIED
    assert outcome.result_count == 1
    assert outcome.change_count == 2
    with session_maker() as session:
        assert session.scalar(select(func.count(HumanInputIMBinding.id))) == 0
        assert session.scalar(select(func.count(HumanInputIMIdentity.id))) == 0
        removed_result = session.scalar(select(HumanInputIMSyncResult))
        assert removed_result is not None
        assert removed_result.result_type is IMSyncResultType.REMOVED
        assert removed_result.removal_reason is IMSyncRemovalReason.NOT_PRESENT_IN_DIRECTORY


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
