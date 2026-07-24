"""Transaction contract tests for the SQLAlchemy IM Control Plane adapter."""

from collections.abc import Iterator
from datetime import UTC, datetime

import pytest
import sqlalchemy as sa
from sqlalchemy import select
from sqlalchemy.dialects import postgresql
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from core.human_input_v2.contact_directory import Contact
from core.human_input_v2.entities import IMBindingScope, IMProvider, IMSyncRunStatus
from core.human_input_v2.im_integration import (
    ActiveRunDecisionKind,
    ApplyReconciliationStatus,
    BindingResolutionKind,
    ConfigurationTransition,
    EncryptedCredentials,
    IMBinding,
    IMIdentity,
    IMIntegration,
    IntegrationRevisionToken,
    MatchKind,
    ProviderDirectoryEntry,
    ProviderTenantIdentity,
    ReconciliationAction,
    ReconciliationPlan,
    StaleRevision,
)
from core.human_input_v2.shared import (
    AccountId,
    ContactId,
    IMBindingId,
    IMIdentityId,
    IMSyncRunId,
    IntegrationId,
    UtcTimestamp,
    WorkspaceId,
)
from models.account import Account, AccountStatus
from models.human_input_v2 import (
    HumanInputContact,
    HumanInputIMBinding,
    HumanInputIMIdentity,
    HumanInputIMIntegration,
    HumanInputIMSyncResult,
    HumanInputIMSyncRun,
)
from repositories.human_input_v2.contact_directory.mappers import contact_to_record
from repositories.human_input_v2.im_integration.mappers import binding_to_record, identity_to_record
from repositories.human_input_v2.im_integration.repository import SQLAlchemyIMControlPlaneRepository

_NOW = UtcTimestamp(datetime(2026, 7, 25, 8, tzinfo=UTC))
_LATER = UtcTimestamp(datetime(2026, 7, 25, 9, tzinfo=UTC))
_WORKSPACE_ID = WorkspaceId("workspace-1")


@pytest.fixture
def repository_context(
    sqlite_engine: Engine,
) -> Iterator[tuple[SQLAlchemyIMControlPlaneRepository, sessionmaker[Session]]]:
    tables = [
        Account.__table__,
        HumanInputContact.__table__,
        HumanInputIMIntegration.__table__,
        HumanInputIMIdentity.__table__,
        HumanInputIMBinding.__table__,
        HumanInputIMSyncRun.__table__,
        HumanInputIMSyncResult.__table__,
    ]
    HumanInputIMIntegration.metadata.create_all(sqlite_engine, tables=tables)
    session_maker = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    return SQLAlchemyIMControlPlaneRepository(session_maker), session_maker


def _credentials(secret: str = "ciphertext") -> EncryptedCredentials:
    return EncryptedCredentials.from_mapping({"app_id": "app-1", "encrypted_app_secret": secret})


def _integration(integration_id: str = "integration-1") -> IMIntegration:
    return IMIntegration.create(
        integration_id=IntegrationId(integration_id),
        workspace_id=_WORKSPACE_ID,
        provider_tenant=ProviderTenantIdentity(IMProvider.FEISHU, "provider-tenant-1"),
        encrypted_credentials=_credentials(),
        configured_by_account_id=AccountId("account-1"),
        callback_url=None,
        now=_NOW,
    )


def _identity(integration_id: IntegrationId) -> IMIdentity:
    return IMIdentity.create(
        identity_id=IMIdentityId("identity-1"),
        integration_id=integration_id,
        provider=IMProvider.FEISHU,
        provider_user_id="provider-user-1",
        display_name="Reviewer",
        email="reviewer@example.com",
        raw_payload={},
        last_seen_sync_run_id=None,
        last_seen_at=_NOW,
        now=_NOW,
    )


def _binding(integration_id: IntegrationId) -> IMBinding:
    return IMBinding.create(
        binding_id=IMBindingId("binding-1"),
        integration_id=integration_id,
        scope=IMBindingScope.ORGANIZATION,
        scope_id=str(integration_id),
        contact_id=ContactId("contact-1"),
        identity_id=IMIdentityId("identity-1"),
        provider=IMProvider.FEISHU,
        bound_by_account_id=None,
        now=_NOW,
    )


def _persist_current_children(session_maker: sessionmaker[Session], integration_id: IntegrationId) -> None:
    with session_maker.begin() as session:
        session.add(identity_to_record(_identity(integration_id)))
        session.add(binding_to_record(_binding(integration_id)))


def test_configuration_cas_rotation_preserves_children_and_rejects_stale_revision(repository_context) -> None:
    repository, session_maker = repository_context
    integration = repository.create_integration(_integration())
    _persist_current_children(session_maker, integration.id)
    decision = integration.reconfigure(
        expected_revision=integration.revision,
        provider_tenant=integration.provider_tenant,
        encrypted_credentials=_credentials("rotated"),
        configured_by_account_id=AccountId("account-2"),
        callback_url=None,
        now=_LATER,
    )
    assert isinstance(decision, ConfigurationTransition)

    updated = repository.compare_and_swap_configuration(decision)

    assert isinstance(updated, IMIntegration)
    assert updated.revision == IntegrationRevisionToken(integration.id, 2)
    with session_maker() as session:
        assert session.scalar(sa.select(sa.func.count(HumanInputIMIdentity.id))) == 1
        assert session.scalar(sa.select(sa.func.count(HumanInputIMBinding.id))) == 1

    stale = repository.compare_and_swap_configuration(decision)
    assert stale == StaleRevision(expected=integration.revision, actual=updated.revision)


def test_provider_replacement_invalidates_current_children_in_same_transaction(repository_context) -> None:
    repository, session_maker = repository_context
    integration = repository.create_integration(_integration())
    _persist_current_children(session_maker, integration.id)
    decision = integration.reconfigure(
        expected_revision=integration.revision,
        provider_tenant=ProviderTenantIdentity(IMProvider.SLACK, "slack-workspace"),
        encrypted_credentials=EncryptedCredentials.from_mapping(
            {
                "client_id": "client-1",
                "encrypted_client_secret": "secret",
                "encrypted_signing_secret": "signing",
                "encrypted_bot_token": "token",
            }
        ),
        configured_by_account_id=AccountId("account-2"),
        callback_url=None,
        now=_LATER,
        replacement_integration_id=IntegrationId("integration-2"),
    )
    assert isinstance(decision, ConfigurationTransition)

    replacement = repository.compare_and_swap_configuration(decision)

    assert isinstance(replacement, IMIntegration)
    assert replacement.id == IntegrationId("integration-2")
    with session_maker() as session:
        assert session.get(HumanInputIMIntegration, "integration-1") is None
        assert session.get(HumanInputIMIntegration, "integration-2") is not None
        assert session.scalar(sa.select(sa.func.count(HumanInputIMIdentity.id))) == 0
        assert session.scalar(sa.select(sa.func.count(HumanInputIMBinding.id))) == 0


def test_delete_requires_complete_current_revision(repository_context) -> None:
    repository, session_maker = repository_context
    integration = repository.create_integration(_integration())

    stale = repository.compare_and_swap_delete(integration.plan_deletion(IntegrationRevisionToken(integration.id, 9)))
    assert isinstance(stale, StaleRevision)
    assert repository.compare_and_swap_delete(integration.plan_deletion(integration.revision)) is None
    with session_maker() as session:
        assert session.get(HumanInputIMIntegration, str(integration.id)) is None


def test_active_run_creation_returns_existing_state_and_rejects_stale_trigger(repository_context) -> None:
    repository, session_maker = repository_context
    integration = repository.create_integration(_integration())

    first = repository.create_or_get_active_run(
        integration.revision,
        sync_run_id=IMSyncRunId("run-1"),
        started_by_account_id=AccountId("account-1"),
        now=_NOW,
    )
    second = repository.create_or_get_active_run(
        integration.revision,
        sync_run_id=IMSyncRunId("run-2"),
        started_by_account_id=AccountId("account-2"),
        now=_LATER,
    )
    stale = repository.create_or_get_active_run(
        IntegrationRevisionToken(integration.id, 9),
        sync_run_id=IMSyncRunId("run-3"),
        started_by_account_id=None,
        now=_LATER,
    )

    assert first.kind is ActiveRunDecisionKind.CREATED
    assert second.kind is ActiveRunDecisionKind.EXISTING_ACTIVE
    assert second.run == first.run
    assert stale.kind is ActiveRunDecisionKind.STALE_REVISION
    with session_maker() as session:
        assert session.scalar(sa.select(sa.func.count(HumanInputIMSyncRun.id))) == 1


def test_reconciliation_apply_is_idempotent_and_eager_state_is_mapped(repository_context) -> None:
    repository, session_maker = repository_context
    integration = repository.create_integration(_integration())
    run_decision = repository.create_or_get_active_run(
        integration.revision,
        sync_run_id=IMSyncRunId("run-1"),
        started_by_account_id=AccountId("account-1"),
        now=_NOW,
    )
    assert run_decision.run is not None
    contact = Contact.organization_account(
        contact_id=ContactId("contact-1"),
        account_id=AccountId("account-1"),
        name="Reviewer",
        email="reviewer@example.com",
        now=_NOW,
    )
    with session_maker.begin() as session:
        session.add(contact_to_record(contact))
    entry = ProviderDirectoryEntry.create(
        provider_user_id="provider-user-1",
        display_name="Reviewer",
        email="reviewer@example.com",
        raw_payload={"provider": "value"},
    )
    plan = ReconciliationPlan(
        sync_run_id=run_decision.run.id,
        integration_revision=integration.revision,
        provider=IMProvider.FEISHU,
        actions=(
            ReconciliationAction(
                entry=entry,
                match_kind=MatchKind.NORMALIZED_EMAIL,
                identity_id=None,
                binding_id=None,
                contact_id=contact.id,
            ),
        ),
        removed_identity_ids=(),
    )

    applied = repository.apply_reconciliation(plan, now=_LATER)
    retried = repository.apply_reconciliation(plan, now=_LATER)
    state = repository.load_integration_state(integration.id)

    assert applied.status is ApplyReconciliationStatus.APPLIED
    assert applied.run.status is IMSyncRunStatus.SUCCEEDED
    assert retried.status is ApplyReconciliationStatus.ALREADY_APPLIED
    assert retried.results == applied.results
    assert len(state.identities) == 1
    assert len(state.bindings) == 1
    assert len(state.sync_runs) == 1
    assert len(state.sync_results) == 1
    with session_maker() as session:
        assert session.scalar(sa.select(sa.func.count(HumanInputIMIdentity.id))) == 1
        assert session.scalar(sa.select(sa.func.count(HumanInputIMBinding.id))) == 1
        assert session.scalar(sa.select(sa.func.count(HumanInputIMSyncResult.id))) == 1


def test_stale_reconciliation_appends_diagnostic_without_current_state_mutation(repository_context) -> None:
    repository, session_maker = repository_context
    integration = repository.create_integration(_integration())
    run_decision = repository.create_or_get_active_run(
        integration.revision,
        sync_run_id=IMSyncRunId("run-1"),
        started_by_account_id=None,
        now=_NOW,
    )
    assert run_decision.run is not None
    rotation = integration.reconfigure(
        expected_revision=integration.revision,
        provider_tenant=integration.provider_tenant,
        encrypted_credentials=_credentials("rotated"),
        configured_by_account_id=None,
        callback_url=None,
        now=_LATER,
    )
    assert isinstance(rotation, ConfigurationTransition)
    repository.compare_and_swap_configuration(rotation)
    plan = ReconciliationPlan(
        sync_run_id=run_decision.run.id,
        integration_revision=integration.revision,
        provider=IMProvider.FEISHU,
        actions=(),
        removed_identity_ids=(),
    )

    result = repository.apply_reconciliation(plan, now=_LATER)

    assert result.status is ApplyReconciliationStatus.STALE_REVISION
    assert result.results[0].reason_code == "stale_integration_revision"
    with session_maker() as session:
        assert session.scalar(sa.select(sa.func.count(HumanInputIMIdentity.id))) == 0
        assert session.scalar(sa.select(sa.func.count(HumanInputIMBinding.id))) == 0
        assert session.scalar(sa.select(sa.func.count(HumanInputIMSyncResult.id))) == 1


def test_snapshot_load_and_effective_binding_use_mapped_owner_scoped_facts(repository_context) -> None:
    repository, session_maker = repository_context
    integration = repository.create_integration(_integration())
    run_decision = repository.create_or_get_active_run(
        integration.revision,
        sync_run_id=IMSyncRunId("run-1"),
        started_by_account_id=None,
        now=_NOW,
    )
    assert run_decision.run is not None
    contact = Contact.organization_account(
        contact_id=ContactId("contact-1"),
        account_id=AccountId("account-1"),
        name="Reviewer",
        email="reviewer@example.com",
        now=_NOW,
    )
    with session_maker.begin() as session:
        session.add(contact_to_record(contact))
        session.add(identity_to_record(_identity(integration.id)))
        session.add(binding_to_record(_binding(integration.id)))

    snapshot = repository.load_reconciliation_snapshot(run_decision.run.id)
    effective = repository.resolve_effective_binding(
        integration_id=integration.id,
        provider=IMProvider.FEISHU,
        workspace_id=_WORKSPACE_ID,
        contact_id=contact.id,
    )

    assert len(snapshot.identities) == 1
    assert len(snapshot.bindings) == 1
    assert {item.contact.id for item in snapshot.contacts} == {contact.id}
    assert effective.kind is BindingResolutionKind.ORGANIZATION_BINDING
    assert effective.binding is not None
    assert effective.binding.provider_user_id == "provider-user-1"


def test_reconciliation_snapshot_marks_disabled_account_contact_unavailable(repository_context) -> None:
    repository, session_maker = repository_context
    integration = repository.create_integration(_integration())
    run_decision = repository.create_or_get_active_run(
        integration.revision,
        sync_run_id=IMSyncRunId("run-1"),
        started_by_account_id=None,
        now=_NOW,
    )
    assert run_decision.run is not None
    account = Account(name="Disabled", email="disabled@example.com", status=AccountStatus.BANNED)
    account.id = "account-disabled"
    contact = Contact.organization_account(
        contact_id=ContactId("contact-disabled"),
        account_id=AccountId(account.id),
        name="Disabled",
        email="disabled@example.com",
        now=_NOW,
    )
    with session_maker.begin() as session:
        session.add(account)
        session.add(contact_to_record(contact))

    snapshot = repository.load_reconciliation_snapshot(run_decision.run.id)

    assert len(snapshot.contacts) == 1
    assert snapshot.contacts[0].account_available is False


def test_reconciliation_updates_provider_match_and_removes_absent_identity(repository_context) -> None:
    repository, session_maker = repository_context
    integration = repository.create_integration(_integration())
    run_decision = repository.create_or_get_active_run(
        integration.revision,
        sync_run_id=IMSyncRunId("run-1"),
        started_by_account_id=None,
        now=_NOW,
    )
    assert run_decision.run is not None
    contacts = (
        Contact.organization_account(
            contact_id=ContactId("contact-1"),
            account_id=AccountId("account-1"),
            name="First Reviewer",
            email="first@example.com",
            now=_NOW,
        ),
        Contact.organization_account(
            contact_id=ContactId("contact-2"),
            account_id=AccountId("account-2"),
            name="Removed Reviewer",
            email="removed@example.com",
            now=_NOW,
        ),
    )
    first_identity = _identity(integration.id)
    removed_identity = IMIdentity.create(
        identity_id=IMIdentityId("identity-removed"),
        integration_id=integration.id,
        provider=IMProvider.FEISHU,
        provider_user_id="provider-user-removed",
        display_name="Removed Reviewer",
        email="removed@example.com",
        raw_payload={},
        last_seen_sync_run_id=None,
        last_seen_at=_NOW,
        now=_NOW,
    )
    first_binding = _binding(integration.id)
    removed_binding = IMBinding.create(
        binding_id=IMBindingId("binding-removed"),
        integration_id=integration.id,
        scope=IMBindingScope.ORGANIZATION,
        scope_id=str(integration.id),
        contact_id=contacts[1].id,
        identity_id=removed_identity.id,
        provider=IMProvider.FEISHU,
        bound_by_account_id=None,
        now=_NOW,
    )
    with session_maker.begin() as session:
        session.add_all([contact_to_record(contact) for contact in contacts])
        session.add_all([identity_to_record(first_identity), identity_to_record(removed_identity)])
        session.add_all([binding_to_record(first_binding), binding_to_record(removed_binding)])
    plan = ReconciliationPlan(
        sync_run_id=run_decision.run.id,
        integration_revision=integration.revision,
        provider=IMProvider.FEISHU,
        actions=(
            ReconciliationAction(
                entry=ProviderDirectoryEntry.create(
                    provider_user_id=first_identity.provider_user_id,
                    display_name="Updated Reviewer",
                    email="updated@example.com",
                    raw_payload={"updated": True},
                ),
                match_kind=MatchKind.PROVIDER_USER_ID,
                identity_id=first_identity.id,
                binding_id=first_binding.id,
                contact_id=contacts[0].id,
            ),
        ),
        removed_identity_ids=(removed_identity.id,),
    )

    result = repository.apply_reconciliation(plan, now=_LATER)

    assert result.status is ApplyReconciliationStatus.APPLIED
    assert result.run.skipped_count == 1
    assert result.run.removed_count == 1
    with session_maker() as session:
        updated = session.get_one(HumanInputIMIdentity, str(first_identity.id))
        assert updated.display_name == "Updated Reviewer"
        assert updated.last_seen_sync_run_id == str(run_decision.run.id)
        assert session.get(HumanInputIMIdentity, str(removed_identity.id)) is None
        removed_result = session.scalar(
            select(HumanInputIMSyncResult).where(HumanInputIMSyncResult.im_identity_id == str(removed_identity.id))
        )
        assert removed_result is not None
        assert removed_result.identity_snapshot is not None
        assert removed_result.identity_snapshot.provider_user_id == "provider-user-removed"


def test_valid_reconciliation_failure_rolls_back_current_state_and_results(repository_context, monkeypatch) -> None:
    repository, session_maker = repository_context
    integration = repository.create_integration(_integration())
    run_decision = repository.create_or_get_active_run(
        integration.revision,
        sync_run_id=IMSyncRunId("run-1"),
        started_by_account_id=None,
        now=_NOW,
    )
    assert run_decision.run is not None
    contact = Contact.organization_account(
        contact_id=ContactId("contact-1"),
        account_id=AccountId("account-1"),
        name="Reviewer",
        email="reviewer@example.com",
        now=_NOW,
    )
    with session_maker.begin() as session:
        session.add(contact_to_record(contact))
    plan = ReconciliationPlan(
        sync_run_id=run_decision.run.id,
        integration_revision=integration.revision,
        provider=IMProvider.FEISHU,
        actions=(
            ReconciliationAction(
                entry=ProviderDirectoryEntry.create(
                    provider_user_id="provider-user-1",
                    display_name="Reviewer",
                    email="reviewer@example.com",
                    raw_payload={},
                ),
                match_kind=MatchKind.NORMALIZED_EMAIL,
                identity_id=None,
                binding_id=None,
                contact_id=contact.id,
            ),
        ),
        removed_identity_ids=(),
    )

    monkeypatch.setattr(
        repository, "_append_result_record", lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("boom"))
    )

    with pytest.raises(RuntimeError, match="boom"):
        repository.apply_reconciliation(plan, now=_LATER)

    with session_maker() as session:
        assert session.scalar(sa.select(sa.func.count(HumanInputIMIdentity.id))) == 0
        assert session.scalar(sa.select(sa.func.count(HumanInputIMBinding.id))) == 0
        assert session.scalar(sa.select(sa.func.count(HumanInputIMSyncResult.id))) == 0
        run = session.get_one(HumanInputIMSyncRun, str(run_decision.run.id))
        assert run.status is IMSyncRunStatus.QUEUED


def test_locked_integration_statement_uses_complete_token_and_for_update() -> None:
    token = IntegrationRevisionToken(IntegrationId("integration-1"), 4)

    statement = SQLAlchemyIMControlPlaneRepository._locked_integration_statement(token)
    compiled = str(statement.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))

    assert "human_input_im_integrations.id = 'integration-1'" in compiled
    assert "human_input_im_integrations.config_version = 4" in compiled
    assert compiled.endswith("FOR UPDATE")
