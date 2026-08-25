"""Infrastructure-free tests for composite IM reconciliation planning."""

from __future__ import annotations

from datetime import datetime

import pytest

from core.human_input_v2.entities import IMProvider, IMSyncRemovalReason, IMSyncResultType, IMSyncRunStatus
from core.human_input_v2.im_integration import (
    BlockedReconciliation,
    ContactEmailMatchState,
    CreateIMBinding,
    CurrentIMBindingState,
    CurrentIMIdentityState,
    DeleteIMBinding,
    ExistingIMIdentityRef,
    IMIdentityUpsertKind,
    IMSyncRun,
    IntegrationRevisionToken,
    NewIMIdentityRef,
    ReconciliationBlockCode,
    ReconciliationInput,
    ReconciliationPlan,
    ReconciliationReasonCode,
    ReconciliationRunRef,
    ReplaceIMBinding,
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
    NormalizedEmail,
)

_NOW = datetime(2026, 7, 25, 8)
_RUN = ReconciliationRunRef(
    sync_run_id=IMSyncRunId("run-1"),
    integration_revision=IntegrationRevisionToken(IntegrationId("integration-1"), 3),
    provider=IMProvider.FEISHU,
)


def _entry(provider_user_id: str, *, display_name: str | None = None, email: str | None = None) -> DirectoryEntry:
    return DirectoryEntry(ProviderUserId(provider_user_id), display_name, email)


def _identity(
    identity_id: str,
    provider_user_id: str,
    *,
    display_name: str | None = None,
    email: str | None = None,
    last_seen_sync_run_id: str | None = None,
) -> CurrentIMIdentityState:
    return CurrentIMIdentityState(
        identity_id=IMIdentityId(identity_id),
        provider_user_id=ProviderUserId(provider_user_id),
        display_name=display_name,
        email=email,
        normalized_email=NormalizedEmail(email) if email else None,
        last_seen_sync_run_id=IMSyncRunId(last_seen_sync_run_id) if last_seen_sync_run_id else None,
    )


def _binding(binding_id: str, identity_id: str, contact_id: str) -> CurrentIMBindingState:
    return CurrentIMBindingState(
        binding_id=IMBindingId(binding_id),
        identity_id=IMIdentityId(identity_id),
        contact_id=ContactId(contact_id),
    )


def _contact(contact_id: str, email: str) -> ContactEmailMatchState:
    return ContactEmailMatchState(
        contact_id=ContactId(contact_id),
        display_name=f"Contact {contact_id}",
        email=email,
        normalized_email=NormalizedEmail(email),
        avatar_file_id=None,
    )


def _input(
    *,
    entries: tuple[DirectoryEntry, ...] = (),
    identities: tuple[CurrentIMIdentityState, ...] = (),
    bindings: tuple[CurrentIMBindingState, ...] = (),
    reconciled_binding_ids: frozenset[IMBindingId] = frozenset(),
    contacts: tuple[ContactEmailMatchState, ...] = (),
) -> ReconciliationInput:
    return ReconciliationInput(
        run=_RUN,
        directory_entries=entries,
        current_identities=identities,
        current_bindings=bindings,
        reconciled_binding_ids=reconciled_binding_ids,
        contacts_for_email_matching=contacts,
    )


def _plan(reconciliation_input: ReconciliationInput) -> ReconciliationPlan:
    generated = SyncReconciler.generate_plan(reconciliation_input)
    assert isinstance(generated, ReconciliationPlan)
    return generated


def test_sync_run_captures_complete_integration_revision() -> None:
    run = IMSyncRun.create(
        sync_run_id=IMSyncRunId("run-1"),
        integration_revision=_RUN.integration_revision,
        provider=IMProvider.FEISHU,
        started_by_account_id=AccountId("account-1"),
        now=_NOW,
    )

    assert run.integration_revision == _RUN.integration_revision
    assert run.status is IMSyncRunStatus.QUEUED
    assert run.is_active is True
    assert run.start(_NOW).start(_NOW).status is IMSyncRunStatus.RUNNING


def test_empty_input_produces_empty_composite_plan() -> None:
    plan = _plan(_input())

    assert plan == ReconciliationPlan(_RUN, (), (), (), (), ())


def test_each_directory_entry_plans_create_update_or_refresh() -> None:
    existing_update = _identity("identity-update", "update", display_name="Old", email="old@example.com")
    existing_refresh = _identity("identity-refresh", "refresh", display_name="Same", email="same@example.com")

    plan = _plan(
        _input(
            entries=(
                _entry("refresh", display_name="Same", email="same@example.com"),
                _entry("create", display_name="New", email=" NEW@EXAMPLE.COM "),
                _entry("update", display_name="New", email="new@example.com"),
            ),
            identities=(existing_refresh, existing_update),
        )
    )

    assert [upsert.entry.provider_user_id for upsert in plan.identity_upserts] == ["create", "refresh", "update"]
    assert [upsert.kind for upsert in plan.identity_upserts] == [
        IMIdentityUpsertKind.CREATE,
        IMIdentityUpsertKind.REFRESH,
        IMIdentityUpsertKind.UPDATE,
    ]
    assert plan.identity_upserts[0].identity_ref == NewIMIdentityRef(ProviderUserId("create"))
    assert plan.identity_upserts[0].normalized_email == NormalizedEmail("new@example.com")
    assert plan.identity_upserts[1].identity_ref == ExistingIMIdentityRef(existing_refresh.identity_id)
    assert plan.identity_upserts[2].changed_fields == ("display_name", "email", "normalized_email")


def test_unmatched_entry_still_plans_identity_create_and_not_matched_result() -> None:
    plan = _plan(_input(entries=(_entry("unmatched", display_name="Unmatched"),)))

    assert plan.identity_upserts[0].kind is IMIdentityUpsertKind.CREATE
    assert plan.binding_mutations == ()
    assert [(item.result_type, item.reason_code) for item in plan.sync_results] == [
        (IMSyncResultType.NOT_MATCHED, ReconciliationReasonCode.MISSING_EMAIL.value)
    ]


def test_absent_identity_deletes_all_referencing_bindings_before_identity() -> None:
    identity = _identity("identity-1", "absent")
    organization_binding = _binding("binding-org", "identity-1", "contact-1")
    workspace_override = _binding("binding-workspace", "identity-1", "contact-2")

    plan = _plan(
        _input(
            identities=(identity,),
            bindings=(workspace_override, organization_binding),
            reconciled_binding_ids=frozenset({organization_binding.binding_id}),
        )
    )

    assert [mutation.before.binding_id for mutation in plan.binding_mutations] == [
        organization_binding.binding_id,
        workspace_override.binding_id,
    ]
    assert all(isinstance(mutation, DeleteIMBinding) for mutation in plan.binding_mutations)
    assert plan.identity_deletions[0].before == identity
    assert [item.result_type for item in plan.sync_results] == [IMSyncResultType.REMOVED, IMSyncResultType.REMOVED]


def test_unbound_absent_identity_has_no_removed_product_result() -> None:
    plan = _plan(_input(identities=(_identity("identity-1", "absent"),)))

    assert len(plan.identity_deletions) == 1
    assert plan.sync_results == ()


def test_provider_user_id_binding_precedes_conflicting_email_and_contact_admission() -> None:
    identity = _identity("identity-1", "provider-user", email="old@example.com")
    binding = _binding("binding-1", "identity-1", "contact-bound")

    plan = _plan(
        _input(
            entries=(_entry("provider-user", email="other@example.com"),),
            identities=(identity,),
            bindings=(binding,),
            reconciled_binding_ids=frozenset({binding.binding_id}),
            contacts=(_contact("contact-other", "other@example.com"),),
        )
    )

    assert plan.binding_mutations == ()
    assert [(item.result_type, item.binding_id, item.contact_id) for item in plan.sync_results] == [
        (IMSyncResultType.SKIPPED, binding.binding_id, binding.contact_id)
    ]


@pytest.mark.parametrize(
    ("email", "expected_reason"),
    [
        (None, ReconciliationReasonCode.MISSING_EMAIL),
        ("missing@example.com", ReconciliationReasonCode.NO_CONTACT_MATCH),
    ],
)
def test_email_fallback_without_contact_is_not_matched(
    email: str | None, expected_reason: ReconciliationReasonCode
) -> None:
    plan = _plan(_input(entries=(_entry("provider-user", email=email),)))

    assert plan.binding_mutations == ()
    assert plan.sync_results[0].reason_code == expected_reason.value


def test_unique_email_match_creates_binding() -> None:
    contact = _contact("contact-1", "reviewer@example.com")

    plan = _plan(_input(entries=(_entry("provider-user", email=" REVIEWER@EXAMPLE.COM "),), contacts=(contact,)))

    assert plan.binding_mutations == (
        CreateIMBinding(
            operation_key=plan.binding_mutations[0].operation_key,
            identity_ref=NewIMIdentityRef(ProviderUserId("provider-user")),
            contact_id=contact.contact_id,
            contact_precondition=contact,
            reason=ReconciliationReasonCode.NORMALIZED_EMAIL_MATCH,
        ),
    )
    assert plan.sync_results[0].result_type is IMSyncResultType.ADDED


def test_binding_mutations_reject_a_contact_precondition_for_another_target() -> None:
    contact = _contact("contact-1", "reviewer@example.com")

    with pytest.raises(ValueError, match="binding target"):
        CreateIMBinding(
            operation_key="create-binding",
            identity_ref=NewIMIdentityRef(ProviderUserId("provider-user")),
            contact_id=ContactId("contact-2"),
            contact_precondition=contact,
            reason=ReconciliationReasonCode.NORMALIZED_EMAIL_MATCH,
        )
    with pytest.raises(ValueError, match="binding target"):
        ReplaceIMBinding(
            operation_key="replace-binding",
            before=_binding("binding-1", "identity-1", "contact-2"),
            next_identity_ref=NewIMIdentityRef(ProviderUserId("provider-user")),
            contact_precondition=contact,
            reason=ReconciliationReasonCode.NORMALIZED_EMAIL_MATCH,
            removal_reason=IMSyncRemovalReason.BINDING_REPLACED,
        )


def test_duplicate_contact_email_recovers_with_warning_for_all_affected_identities() -> None:
    contacts = (_contact("contact-2", "same@example.com"), _contact("contact-1", "SAME@example.com"))
    entries = (_entry("provider-2", email="same@example.com"), _entry("provider-1", email="same@example.com"))

    plan = _plan(_input(entries=entries, contacts=contacts))

    assert plan.binding_mutations == ()
    assert [(item.provider_user_id, item.reason_code) for item in plan.sync_results] == [
        ("provider-1", ReconciliationReasonCode.AMBIGUOUS_CONTACT_EMAIL.value),
        ("provider-2", ReconciliationReasonCode.AMBIGUOUS_CONTACT_EMAIL.value),
    ]
    assert len(plan.warnings) == 1
    assert plan.warnings[0].reason is ReconciliationReasonCode.AMBIGUOUS_CONTACT_EMAIL
    assert plan.warnings[0].identity_refs == (
        NewIMIdentityRef(ProviderUserId("provider-1")),
        NewIMIdentityRef(ProviderUserId("provider-2")),
    )
    assert plan.warnings[0].contact_ids == (ContactId("contact-1"), ContactId("contact-2"))
    assert "same@example.com" not in plan.warnings[0].warning_key


def test_competing_provider_identities_do_not_bind_same_contact() -> None:
    contact = _contact("contact-1", "same@example.com")

    plan = _plan(
        _input(
            entries=(_entry("provider-2", email="same@example.com"), _entry("provider-1", email="same@example.com")),
            contacts=(contact,),
        )
    )

    assert plan.binding_mutations == ()
    assert [item.reason_code for item in plan.sync_results] == [
        ReconciliationReasonCode.AMBIGUOUS_PROVIDER_EMAIL.value,
        ReconciliationReasonCode.AMBIGUOUS_PROVIDER_EMAIL.value,
    ]


def test_contact_bound_to_present_identity_is_not_stolen() -> None:
    bound_identity = _identity("identity-bound", "bound", email="same@example.com")
    binding = _binding("binding-1", "identity-bound", "contact-1")

    plan = _plan(
        _input(
            entries=(
                _entry("bound", email="same@example.com"),
                _entry("candidate", email="same@example.com"),
            ),
            identities=(bound_identity,),
            bindings=(binding,),
            reconciled_binding_ids=frozenset({binding.binding_id}),
            contacts=(_contact("contact-1", "same@example.com"),),
        )
    )

    assert plan.binding_mutations == ()
    candidate_result = next(item for item in plan.sync_results if item.provider_user_id == "candidate")
    assert candidate_result.reason_code == ReconciliationReasonCode.CONTACT_ALREADY_BOUND.value


def test_binding_to_absent_identity_is_uniquely_replaced() -> None:
    absent_identity = _identity("identity-absent", "absent", email="same@example.com")
    binding = _binding("binding-1", "identity-absent", "contact-1")

    plan = _plan(
        _input(
            entries=(_entry("replacement", email="same@example.com"),),
            identities=(absent_identity,),
            bindings=(binding,),
            reconciled_binding_ids=frozenset({binding.binding_id}),
            contacts=(_contact("contact-1", "same@example.com"),),
        )
    )

    assert plan.binding_mutations == (
        ReplaceIMBinding(
            operation_key=plan.binding_mutations[0].operation_key,
            before=binding,
            next_identity_ref=NewIMIdentityRef(ProviderUserId("replacement")),
            contact_precondition=_contact("contact-1", "same@example.com"),
            reason=ReconciliationReasonCode.NORMALIZED_EMAIL_MATCH,
            removal_reason=IMSyncRemovalReason.BINDING_REPLACED,
        ),
    )
    assert [item.result_type for item in plan.sync_results] == [IMSyncResultType.ADDED, IMSyncResultType.REMOVED]
    assert len(plan.identity_deletions) == 1


def test_non_reconciled_override_does_not_compete_but_is_deleted_before_absent_identity() -> None:
    absent_identity = _identity("identity-absent", "absent")
    override = _binding("binding-override", "identity-absent", "contact-override")
    contact = _contact("contact-override", "same@example.com")

    plan = _plan(
        _input(
            entries=(_entry("new", email="same@example.com"),),
            identities=(absent_identity,),
            bindings=(override,),
            contacts=(contact,),
        )
    )

    assert isinstance(plan.binding_mutations[0], CreateIMBinding)
    assert isinstance(plan.binding_mutations[1], DeleteIMBinding)
    assert plan.identity_deletions[0].before == absent_identity


def test_structural_corruption_returns_all_deterministically_ordered_blockers() -> None:
    duplicate_identity_a = _identity("identity-1", "duplicate")
    duplicate_identity_b = _identity("identity-1", "duplicate")
    dangling_binding = _binding("binding-1", "missing", "contact-1")

    generated = SyncReconciler.generate_plan(
        _input(
            entries=(_entry("provider-duplicate"), _entry("provider-duplicate")),
            identities=(duplicate_identity_b, duplicate_identity_a),
            bindings=(dangling_binding, dangling_binding),
            reconciled_binding_ids=frozenset({IMBindingId("missing-binding")}),
        )
    )

    assert isinstance(generated, BlockedReconciliation)
    assert [block.code for block in generated.blockers] == sorted([block.code for block in generated.blockers], key=str)
    assert {block.code for block in generated.blockers} == {
        ReconciliationBlockCode.DUPLICATE_PROVIDER_USER_ID,
        ReconciliationBlockCode.DUPLICATE_CURRENT_IDENTITY,
        ReconciliationBlockCode.INVALID_CURRENT_BINDING,
        ReconciliationBlockCode.INVALID_RECONCILED_BINDING_SET,
    }


@pytest.mark.parametrize(
    "bindings",
    [
        (_binding("binding-1", "identity-1", "contact-1"), _binding("binding-2", "identity-1", "contact-2")),
        (_binding("binding-1", "identity-1", "contact-1"), _binding("binding-2", "identity-2", "contact-1")),
    ],
)
def test_reconciled_binding_subset_must_be_one_to_one(bindings: tuple[CurrentIMBindingState, ...]) -> None:
    generated = SyncReconciler.generate_plan(
        _input(
            identities=(_identity("identity-1", "provider-1"), _identity("identity-2", "provider-2")),
            bindings=bindings,
            reconciled_binding_ids=frozenset(binding.binding_id for binding in bindings),
        )
    )

    assert isinstance(generated, BlockedReconciliation)
    assert ReconciliationBlockCode.INVALID_RECONCILED_BINDING_SET in {block.code for block in generated.blockers}


def test_planner_output_is_independent_of_fact_order() -> None:
    facts = {
        "entries": (_entry("provider-2", email="two@example.com"), _entry("provider-1", email="one@example.com")),
        "identities": (_identity("identity-3", "absent"),),
        "contacts": (_contact("contact-2", "two@example.com"), _contact("contact-1", "one@example.com")),
    }

    first = SyncReconciler.generate_plan(_input(**facts))
    second = SyncReconciler.generate_plan(
        _input(
            entries=tuple(reversed(facts["entries"])),
            identities=tuple(reversed(facts["identities"])),
            contacts=tuple(reversed(facts["contacts"])),
        )
    )

    assert first == second


def test_projected_plan_converges_without_second_binding_mutation() -> None:
    contact = _contact("contact-1", "same@example.com")
    first = _plan(_input(entries=(_entry("provider-1", email="same@example.com"),), contacts=(contact,)))
    created_identity = CurrentIMIdentityState(
        identity_id=IMIdentityId("created-provider-1"),
        provider_user_id=ProviderUserId("provider-1"),
        display_name=None,
        email="same@example.com",
        normalized_email=NormalizedEmail("same@example.com"),
        last_seen_sync_run_id=_RUN.sync_run_id,
    )
    created_binding = CurrentIMBindingState(
        binding_id=IMBindingId("created-binding-1"),
        identity_id=created_identity.identity_id,
        contact_id=contact.contact_id,
    )

    second = _plan(
        _input(
            entries=(_entry("provider-1", email="same@example.com"),),
            identities=(created_identity,),
            bindings=(created_binding,),
            reconciled_binding_ids=frozenset({created_binding.binding_id}),
            contacts=(contact,),
        )
    )

    assert len(first.binding_mutations) == 1
    assert second.binding_mutations == ()
    assert second.sync_results[0].result_type is IMSyncResultType.SKIPPED
