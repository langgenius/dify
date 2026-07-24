"""Pure reconciliation tests for the IM Control Plane."""

from datetime import UTC, datetime

from core.human_input_v2.contact_directory import Contact, ContactSnapshot
from core.human_input_v2.entities import IMBindingScope, IMProvider, IMSyncRunStatus
from core.human_input_v2.im_integration import (
    IMBinding,
    IMIdentity,
    IMSyncRun,
    IntegrationRevisionToken,
    MatchKind,
    ProviderDirectoryEntry,
    ReconciliationSnapshot,
    SyncReconciler,
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

_NOW = UtcTimestamp(datetime(2026, 7, 25, 8, tzinfo=UTC))
_REVISION = IntegrationRevisionToken(IntegrationId("integration-1"), 3)


def _contact(contact_id: str, account_id: str, email: str, *, available: bool = True) -> ContactSnapshot:
    return ContactSnapshot(
        contact=Contact.organization_account(
            contact_id=ContactId(contact_id),
            account_id=AccountId(account_id),
            name=account_id,
            email=email,
            now=_NOW,
        ),
        account_available=available,
    )


def test_sync_run_captures_complete_integration_revision() -> None:
    run = IMSyncRun.create(
        sync_run_id=IMSyncRunId("run-1"),
        integration_revision=_REVISION,
        provider=IMProvider.FEISHU,
        started_by_account_id=AccountId("account-1"),
        now=_NOW,
    )

    assert run.integration_revision == _REVISION
    assert run.status is IMSyncRunStatus.QUEUED
    assert run.is_active is True


def test_sync_run_start_is_idempotent_after_leaving_queued_state() -> None:
    run = IMSyncRun.create(
        sync_run_id=IMSyncRunId("run-1"),
        integration_revision=_REVISION,
        provider=IMProvider.FEISHU,
        started_by_account_id=None,
        now=_NOW,
    )

    started = run.start(_NOW)

    assert started.status is IMSyncRunStatus.RUNNING
    assert started.start(_NOW) is started


def test_reconciler_prefers_provider_user_id_before_conflicting_email() -> None:
    first_contact = _contact("contact-1", "account-1", "first@example.com")
    other_contact = _contact("contact-2", "account-2", "other@example.com")
    identity = IMIdentity.create(
        identity_id=IMIdentityId("identity-1"),
        integration_id=_REVISION.integration_id,
        provider=IMProvider.FEISHU,
        provider_user_id="provider-user-1",
        display_name="Old Name",
        email="first@example.com",
        raw_payload={"source": "previous"},
        last_seen_sync_run_id=None,
        last_seen_at=_NOW,
        now=_NOW,
    )
    binding = IMBinding.create(
        binding_id=IMBindingId("binding-1"),
        integration_id=_REVISION.integration_id,
        scope=IMBindingScope.ORGANIZATION,
        scope_id=str(_REVISION.integration_id),
        contact_id=first_contact.contact.id,
        identity_id=identity.id,
        provider=IMProvider.FEISHU,
        bound_by_account_id=None,
        now=_NOW,
    )
    entry = ProviderDirectoryEntry.create(
        provider_user_id="provider-user-1",
        display_name="Current Name",
        email=" OTHER@EXAMPLE.COM ",
        raw_payload={"source": "provider"},
    )
    snapshot = ReconciliationSnapshot(
        identities=(identity,),
        bindings=(binding,),
        contacts=(first_contact, other_contact),
    )

    plan = SyncReconciler.reconcile(
        sync_run_id=IMSyncRunId("run-1"),
        integration_revision=_REVISION,
        provider=IMProvider.FEISHU,
        entries=(entry,),
        snapshot=snapshot,
    )

    assert len(plan.actions) == 1
    assert plan.actions[0].match_kind is MatchKind.PROVIDER_USER_ID
    assert plan.actions[0].identity_id == identity.id
    assert plan.actions[0].contact_id == first_contact.contact.id
    assert plan.removed_identity_ids == ()


def test_reconciler_uses_normalized_email_fallback_without_creating_contacts() -> None:
    contact = _contact("contact-1", "account-1", "reviewer@example.com")
    entry = ProviderDirectoryEntry.create(
        provider_user_id="provider-user-1",
        display_name="Reviewer",
        email=" REVIEWER@EXAMPLE.COM ",
        raw_payload={},
    )

    plan = SyncReconciler.reconcile(
        sync_run_id=IMSyncRunId("run-1"),
        integration_revision=_REVISION,
        provider=IMProvider.FEISHU,
        entries=(entry,),
        snapshot=ReconciliationSnapshot(contacts=(contact,)),
    )

    assert plan.actions[0].match_kind is MatchKind.NORMALIZED_EMAIL
    assert plan.actions[0].contact_id == contact.contact.id
    assert plan.actions[0].identity_id is None
    assert not hasattr(plan, "contacts_to_create")


def test_reconciler_does_not_use_external_contact_for_email_fallback() -> None:
    external_contact = ContactSnapshot(
        contact=Contact.external(
            contact_id=ContactId("contact-external"),
            workspace_id=WorkspaceId("workspace-1"),
            name="External Reviewer",
            email="reviewer@example.com",
            now=_NOW,
        ),
        account_available=True,
    )
    entry = ProviderDirectoryEntry.create(
        provider_user_id="provider-user-1",
        display_name="Reviewer",
        email="reviewer@example.com",
        raw_payload={},
    )

    plan = SyncReconciler.reconcile(
        sync_run_id=IMSyncRunId("run-1"),
        integration_revision=_REVISION,
        provider=IMProvider.FEISHU,
        entries=(entry,),
        snapshot=ReconciliationSnapshot(contacts=(external_contact,)),
    )

    assert plan.actions[0].match_kind is MatchKind.UNMATCHED
    assert plan.actions[0].contact_id is None


def test_reconciler_returns_unmatched_for_missing_or_ineligible_contact() -> None:
    unavailable = _contact("contact-1", "account-1", "reviewer@example.com", available=False)
    entries = (
        ProviderDirectoryEntry.create(
            provider_user_id="provider-user-1", display_name="Reviewer", email="reviewer@example.com", raw_payload={}
        ),
        ProviderDirectoryEntry.create(
            provider_user_id="provider-user-2", display_name="No Email", email=None, raw_payload={}
        ),
    )

    plan = SyncReconciler.reconcile(
        sync_run_id=IMSyncRunId("run-1"),
        integration_revision=_REVISION,
        provider=IMProvider.FEISHU,
        entries=entries,
        snapshot=ReconciliationSnapshot(contacts=(unavailable,)),
    )

    assert [action.match_kind for action in plan.actions] == [MatchKind.UNMATCHED, MatchKind.UNMATCHED]
    assert all(action.contact_id is None for action in plan.actions)


def test_reconciler_marks_missing_current_identities_for_removal() -> None:
    identity = IMIdentity.create(
        identity_id=IMIdentityId("identity-1"),
        integration_id=_REVISION.integration_id,
        provider=IMProvider.FEISHU,
        provider_user_id="missing-user",
        display_name=None,
        email=None,
        raw_payload={},
        last_seen_sync_run_id=None,
        last_seen_at=_NOW,
        now=_NOW,
    )

    plan = SyncReconciler.reconcile(
        sync_run_id=IMSyncRunId("run-1"),
        integration_revision=_REVISION,
        provider=IMProvider.FEISHU,
        entries=(),
        snapshot=ReconciliationSnapshot(identities=(identity,)),
    )

    assert plan.removed_identity_ids == (identity.id,)
