"""Pure provider directory matching and immutable reconciliation plans."""

from __future__ import annotations

import hashlib
from collections import Counter, defaultdict
from dataclasses import dataclass
from enum import StrEnum

from core.human_input_v2.entities import IMProvider, IMSyncRemovalReason, IMSyncResultType
from core.human_input_v2.im_integration.adapters.entities import DirectoryEntry, ProviderUserId
from core.human_input_v2.shared import (
    ContactId,
    IMBindingId,
    IMIdentityId,
    IMSyncRunId,
    NormalizedEmail,
)

from .sync_records import IMChannelRevision


class IMIdentityUpsertKind(StrEnum):
    """Semantic identity outcome selected by the pure planner."""

    CREATE = "create"
    UPDATE = "update"
    REFRESH = "refresh"


class ReconciliationBlockCode(StrEnum):
    """Whole-plan input or current-state invariants that prevent safe apply."""

    DUPLICATE_PROVIDER_USER_ID = "duplicate_provider_user_id"
    DUPLICATE_CURRENT_IDENTITY = "duplicate_current_identity"
    INVALID_CURRENT_BINDING = "invalid_current_binding"
    INVALID_RECONCILED_BINDING_SET = "invalid_reconciled_binding_set"


class ReconciliationReasonCode(StrEnum):
    """Stable explanations for reconciliation changes and non-matches."""

    PROVIDER_USER_ID_MATCH = "provider_user_id_match"
    NORMALIZED_EMAIL_MATCH = "normalized_email_match"
    MISSING_EMAIL = "missing_email"
    NO_CONTACT_MATCH = "no_contact_match"
    AMBIGUOUS_CONTACT_EMAIL = "ambiguous_contact_email"
    AMBIGUOUS_PROVIDER_EMAIL = "ambiguous_provider_email"
    CONTACT_ALREADY_BOUND = "contact_already_bound"
    IDENTITY_ABSENT_FROM_DIRECTORY = "identity_absent_from_directory"
    BINDING_REPLACED = "binding_replaced"


@dataclass(frozen=True, slots=True)
class ReconciliationRunRef:
    """Immutable reconciliation namespace captured when a sync run starts."""

    sync_run_id: IMSyncRunId
    channel_revision: IMChannelRevision
    provider: IMProvider


@dataclass(frozen=True, slots=True)
class CurrentIMIdentityState:
    """Current persisted identity facts required by plan generation."""

    identity_id: IMIdentityId
    provider_user_id: ProviderUserId
    display_name: str | None
    email: str | None
    normalized_email: NormalizedEmail | None
    last_seen_sync_run_id: IMSyncRunId | None


@dataclass(frozen=True, slots=True)
class ContactEmailMatchState:
    """A scope-resolved Contact available for automatic email matching."""

    contact_id: ContactId
    display_name: str
    email: str | None
    normalized_email: NormalizedEmail
    avatar_file_id: str | None


@dataclass(frozen=True, slots=True)
class CurrentIMBindingState:
    """Current Contact-to-IM-identity binding without persistence scope."""

    binding_id: IMBindingId
    identity_id: IMIdentityId
    contact_id: ContactId


@dataclass(frozen=True, slots=True)
class ReconciliationInput:
    """Complete immutable facts loaded before the pure planner is invoked."""

    run: ReconciliationRunRef
    directory_entries: tuple[DirectoryEntry, ...]
    current_identities: tuple[CurrentIMIdentityState, ...]
    current_bindings: tuple[CurrentIMBindingState, ...]
    reconciled_binding_ids: frozenset[IMBindingId]
    contacts_for_email_matching: tuple[ContactEmailMatchState, ...]


@dataclass(frozen=True, slots=True)
class ExistingIMIdentityRef:
    identity_id: IMIdentityId


@dataclass(frozen=True, slots=True)
class NewIMIdentityRef:
    provider_user_id: ProviderUserId


type IMIdentityRef = ExistingIMIdentityRef | NewIMIdentityRef


@dataclass(frozen=True, slots=True)
class IMIdentityUpsert:
    operation_key: str
    kind: IMIdentityUpsertKind
    identity_ref: IMIdentityRef
    entry: DirectoryEntry
    normalized_email: NormalizedEmail | None
    before: CurrentIMIdentityState | None
    changed_fields: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class CreateIMBinding:
    operation_key: str
    identity_ref: IMIdentityRef
    contact_id: ContactId
    contact_precondition: ContactEmailMatchState
    reason: ReconciliationReasonCode

    def __post_init__(self) -> None:
        if self.contact_precondition.contact_id != self.contact_id:
            raise ValueError("Contact precondition must describe the binding target")


@dataclass(frozen=True, slots=True)
class ReplaceIMBinding:
    operation_key: str
    before: CurrentIMBindingState
    next_identity_ref: IMIdentityRef
    contact_precondition: ContactEmailMatchState
    reason: ReconciliationReasonCode
    removal_reason: IMSyncRemovalReason

    def __post_init__(self) -> None:
        if self.contact_precondition.contact_id != self.before.contact_id:
            raise ValueError("Contact precondition must describe the binding target")


@dataclass(frozen=True, slots=True)
class DeleteIMBinding:
    operation_key: str
    before: CurrentIMBindingState
    reason: ReconciliationReasonCode
    removal_reason: IMSyncRemovalReason


type IMBindingMutation = CreateIMBinding | ReplaceIMBinding | DeleteIMBinding


@dataclass(frozen=True, slots=True)
class IMIdentityDeletion:
    operation_key: str
    before: CurrentIMIdentityState
    reason: ReconciliationReasonCode


@dataclass(frozen=True, slots=True)
class PlannedSyncResult:
    operation_key: str
    result_type: IMSyncResultType
    provider_user_id: ProviderUserId | None
    identity_ref: IMIdentityRef | None
    binding_id: IMBindingId | None
    contact_id: ContactId | None
    reason_code: str | None


@dataclass(frozen=True, slots=True)
class PlannedReconciliationWarning:
    warning_key: str
    reason: ReconciliationReasonCode
    identity_refs: tuple[IMIdentityRef, ...]
    contact_ids: tuple[ContactId, ...]


@dataclass(frozen=True, slots=True)
class ReconciliationPlan:
    """Complete deterministic plan applied in dependency order."""

    run: ReconciliationRunRef
    identity_upserts: tuple[IMIdentityUpsert, ...]
    binding_mutations: tuple[IMBindingMutation, ...]
    identity_deletions: tuple[IMIdentityDeletion, ...]
    sync_results: tuple[PlannedSyncResult, ...]
    warnings: tuple[PlannedReconciliationWarning, ...]


@dataclass(frozen=True, slots=True)
class ReconciliationBlock:
    code: ReconciliationBlockCode
    subject_key: str | None
    message: str


@dataclass(frozen=True, slots=True)
class BlockedReconciliation:
    run: ReconciliationRunRef
    blockers: tuple[ReconciliationBlock, ...]


type PlanGenerationResult = ReconciliationPlan | BlockedReconciliation


class SyncReconciler:
    """Stateless composite planner with no transport or infrastructure dependencies."""

    @staticmethod
    def generate_plan(reconciliation_input: ReconciliationInput) -> PlanGenerationResult:
        blockers = _validate_input(reconciliation_input)
        if blockers:
            return BlockedReconciliation(reconciliation_input.run, blockers)

        entries = tuple(sorted(reconciliation_input.directory_entries, key=lambda entry: str(entry.provider_user_id)))
        identities = tuple(
            sorted(reconciliation_input.current_identities, key=lambda identity: str(identity.identity_id))
        )
        current_identity_by_provider_id = {identity.provider_user_id: identity for identity in identities}
        directory_provider_ids = {entry.provider_user_id for entry in entries}

        identity_upserts: list[IMIdentityUpsert] = []
        identity_ref_by_provider_id: dict[ProviderUserId, IMIdentityRef] = {}
        normalized_email_by_provider_id: dict[ProviderUserId, NormalizedEmail | None] = {}
        for entry in entries:
            current_identity = current_identity_by_provider_id.get(entry.provider_user_id)
            normalized_email = _normalize_email(entry.email)
            identity_ref: IMIdentityRef
            if current_identity is None:
                kind = IMIdentityUpsertKind.CREATE
                identity_ref = NewIMIdentityRef(entry.provider_user_id)
                changed_fields: tuple[str, ...] = ()
            else:
                identity_ref = ExistingIMIdentityRef(current_identity.identity_id)
                changed_fields = _changed_identity_fields(current_identity, entry, normalized_email)
                kind = IMIdentityUpsertKind.UPDATE if changed_fields else IMIdentityUpsertKind.REFRESH
            identity_ref_by_provider_id[entry.provider_user_id] = identity_ref
            normalized_email_by_provider_id[entry.provider_user_id] = normalized_email
            identity_upserts.append(
                IMIdentityUpsert(
                    operation_key=_stable_key("identity", kind.value, str(entry.provider_user_id)),
                    kind=kind,
                    identity_ref=identity_ref,
                    entry=entry,
                    normalized_email=normalized_email,
                    before=current_identity,
                    changed_fields=changed_fields,
                )
            )

        current_identity_by_id = {identity.identity_id: identity for identity in identities}
        current_binding_by_id = {
            binding.binding_id: binding
            for binding in sorted(reconciliation_input.current_bindings, key=lambda binding: str(binding.binding_id))
        }
        reconciled_bindings = tuple(
            current_binding_by_id[binding_id]
            for binding_id in sorted(reconciliation_input.reconciled_binding_ids, key=str)
        )
        reconciled_binding_by_identity = {binding.identity_id: binding for binding in reconciled_bindings}
        reconciled_binding_by_contact = {binding.contact_id: binding for binding in reconciled_bindings}

        preserved_binding_by_provider_id: dict[ProviderUserId, CurrentIMBindingState] = {}
        for entry in entries:
            identity = current_identity_by_provider_id.get(entry.provider_user_id)
            if identity is None:
                continue
            binding = reconciled_binding_by_identity.get(identity.identity_id)
            if binding is not None:
                preserved_binding_by_provider_id[entry.provider_user_id] = binding

        unbound_entries_by_email: dict[NormalizedEmail, list[DirectoryEntry]] = defaultdict(list)
        for entry in entries:
            normalized_email = normalized_email_by_provider_id[entry.provider_user_id]
            if entry.provider_user_id not in preserved_binding_by_provider_id and normalized_email is not None:
                unbound_entries_by_email[normalized_email].append(entry)

        contacts_by_email: dict[NormalizedEmail, list[ContactEmailMatchState]] = defaultdict(list)
        for contact in sorted(
            reconciliation_input.contacts_for_email_matching, key=lambda contact: str(contact.contact_id)
        ):
            contacts_by_email[contact.normalized_email].append(contact)

        binding_mutations: list[IMBindingMutation] = []
        sync_results: list[PlannedSyncResult] = []
        warnings: list[PlannedReconciliationWarning] = []
        replaced_binding_ids: set[IMBindingId] = set()
        warned_contact_emails: set[NormalizedEmail] = set()

        for entry in entries:
            identity_ref = identity_ref_by_provider_id[entry.provider_user_id]
            preserved_binding = preserved_binding_by_provider_id.get(entry.provider_user_id)
            if preserved_binding is not None:
                sync_results.append(
                    _planned_result(
                        IMSyncResultType.SKIPPED,
                        entry.provider_user_id,
                        identity_ref,
                        binding_id=preserved_binding.binding_id,
                        contact_id=preserved_binding.contact_id,
                        reason=ReconciliationReasonCode.PROVIDER_USER_ID_MATCH,
                    )
                )
                continue

            normalized_email = normalized_email_by_provider_id[entry.provider_user_id]
            if normalized_email is None:
                sync_results.append(
                    _not_matched_result(entry.provider_user_id, identity_ref, ReconciliationReasonCode.MISSING_EMAIL)
                )
                continue

            matching_contacts = contacts_by_email.get(normalized_email, [])
            if len(matching_contacts) > 1:
                sync_results.append(
                    _not_matched_result(
                        entry.provider_user_id, identity_ref, ReconciliationReasonCode.AMBIGUOUS_CONTACT_EMAIL
                    )
                )
                if normalized_email not in warned_contact_emails:
                    affected_entries = unbound_entries_by_email[normalized_email]
                    warnings.append(
                        PlannedReconciliationWarning(
                            warning_key=_stable_key(
                                "warning",
                                ReconciliationReasonCode.AMBIGUOUS_CONTACT_EMAIL.value,
                                str(normalized_email),
                            ),
                            reason=ReconciliationReasonCode.AMBIGUOUS_CONTACT_EMAIL,
                            identity_refs=tuple(
                                identity_ref_by_provider_id[item.provider_user_id]
                                for item in sorted(affected_entries, key=lambda item: str(item.provider_user_id))
                            ),
                            contact_ids=tuple(contact.contact_id for contact in matching_contacts),
                        )
                    )
                    warned_contact_emails.add(normalized_email)
                continue

            if not matching_contacts:
                sync_results.append(
                    _not_matched_result(entry.provider_user_id, identity_ref, ReconciliationReasonCode.NO_CONTACT_MATCH)
                )
                continue

            if len(unbound_entries_by_email[normalized_email]) > 1:
                sync_results.append(
                    _not_matched_result(
                        entry.provider_user_id, identity_ref, ReconciliationReasonCode.AMBIGUOUS_PROVIDER_EMAIL
                    )
                )
                continue

            contact = matching_contacts[0]
            occupying_binding = reconciled_binding_by_contact.get(contact.contact_id)
            if occupying_binding is not None:
                occupying_identity = current_identity_by_id[occupying_binding.identity_id]
                if occupying_identity.provider_user_id in directory_provider_ids:
                    sync_results.append(
                        _not_matched_result(
                            entry.provider_user_id, identity_ref, ReconciliationReasonCode.CONTACT_ALREADY_BOUND
                        )
                    )
                    continue
                binding_mutations.append(
                    ReplaceIMBinding(
                        operation_key=_stable_key(
                            "binding", "replace", str(occupying_binding.binding_id), str(entry.provider_user_id)
                        ),
                        before=occupying_binding,
                        next_identity_ref=identity_ref,
                        contact_precondition=contact,
                        reason=ReconciliationReasonCode.NORMALIZED_EMAIL_MATCH,
                        removal_reason=IMSyncRemovalReason.BINDING_REPLACED,
                    )
                )
                replaced_binding_ids.add(occupying_binding.binding_id)
            else:
                binding_mutations.append(
                    CreateIMBinding(
                        operation_key=_stable_key(
                            "binding", "create", str(entry.provider_user_id), str(contact.contact_id)
                        ),
                        identity_ref=identity_ref,
                        contact_id=contact.contact_id,
                        contact_precondition=contact,
                        reason=ReconciliationReasonCode.NORMALIZED_EMAIL_MATCH,
                    )
                )
            sync_results.append(
                _planned_result(
                    IMSyncResultType.ADDED,
                    entry.provider_user_id,
                    identity_ref,
                    binding_id=None,
                    contact_id=contact.contact_id,
                    reason=ReconciliationReasonCode.NORMALIZED_EMAIL_MATCH,
                )
            )

        absent_identities = tuple(
            identity for identity in identities if identity.provider_user_id not in directory_provider_ids
        )
        absent_identity_ids = {identity.identity_id for identity in absent_identities}
        for binding in current_binding_by_id.values():
            if binding.identity_id not in absent_identity_ids:
                continue
            previous_identity = current_identity_by_id[binding.identity_id]
            if binding.binding_id in replaced_binding_ids:
                removal_reason = IMSyncRemovalReason.BINDING_REPLACED
                reason = ReconciliationReasonCode.BINDING_REPLACED
            else:
                removal_reason = IMSyncRemovalReason.NOT_PRESENT_IN_DIRECTORY
                reason = ReconciliationReasonCode.IDENTITY_ABSENT_FROM_DIRECTORY
                binding_mutations.append(
                    DeleteIMBinding(
                        operation_key=_stable_key("binding", "delete", str(binding.binding_id)),
                        before=binding,
                        reason=reason,
                        removal_reason=removal_reason,
                    )
                )
            sync_results.append(
                _planned_result(
                    IMSyncResultType.REMOVED,
                    previous_identity.provider_user_id,
                    ExistingIMIdentityRef(previous_identity.identity_id),
                    binding_id=binding.binding_id,
                    contact_id=binding.contact_id,
                    reason=reason,
                )
            )

        identity_deletions = tuple(
            IMIdentityDeletion(
                operation_key=_stable_key("identity", "delete", str(identity.identity_id)),
                before=identity,
                reason=ReconciliationReasonCode.IDENTITY_ABSENT_FROM_DIRECTORY,
            )
            for identity in absent_identities
        )
        return ReconciliationPlan(
            run=reconciliation_input.run,
            identity_upserts=tuple(identity_upserts),
            binding_mutations=tuple(binding_mutations),
            identity_deletions=identity_deletions,
            sync_results=tuple(sync_results),
            warnings=tuple(warnings),
        )


def _validate_input(reconciliation_input: ReconciliationInput) -> tuple[ReconciliationBlock, ...]:
    blockers: list[ReconciliationBlock] = []
    directory_provider_ids = [entry.provider_user_id for entry in reconciliation_input.directory_entries]
    for provider_user_id, count in Counter(directory_provider_ids).items():
        if count > 1:
            blockers.append(
                ReconciliationBlock(
                    ReconciliationBlockCode.DUPLICATE_PROVIDER_USER_ID,
                    str(provider_user_id),
                    "Directory contains a duplicate Provider user ID.",
                )
            )

    current_identity_ids = [identity.identity_id for identity in reconciliation_input.current_identities]
    current_provider_ids = [identity.provider_user_id for identity in reconciliation_input.current_identities]
    for identity_id, count in Counter(current_identity_ids).items():
        if count > 1:
            blockers.append(
                ReconciliationBlock(
                    ReconciliationBlockCode.DUPLICATE_CURRENT_IDENTITY,
                    f"identity_id:{identity_id}",
                    "Current identity ID is not unique.",
                )
            )
    for provider_user_id, count in Counter(current_provider_ids).items():
        if count > 1:
            blockers.append(
                ReconciliationBlock(
                    ReconciliationBlockCode.DUPLICATE_CURRENT_IDENTITY,
                    f"provider_user_id:{provider_user_id}",
                    "Current Provider user ID is not unique.",
                )
            )

    current_identity_id_set = set(current_identity_ids)
    binding_ids = [binding.binding_id for binding in reconciliation_input.current_bindings]
    for binding_id, count in Counter(binding_ids).items():
        if count > 1:
            blockers.append(
                ReconciliationBlock(
                    ReconciliationBlockCode.INVALID_CURRENT_BINDING,
                    str(binding_id),
                    "Current IM binding ID is not unique.",
                )
            )
    for binding in reconciliation_input.current_bindings:
        if binding.identity_id not in current_identity_id_set:
            blockers.append(
                ReconciliationBlock(
                    ReconciliationBlockCode.INVALID_CURRENT_BINDING,
                    str(binding.binding_id),
                    "Current IM binding references an identity outside current identities.",
                )
            )

    current_binding_id_set = set(binding_ids)
    for binding_id in reconciliation_input.reconciled_binding_ids - current_binding_id_set:
        blockers.append(
            ReconciliationBlock(
                ReconciliationBlockCode.INVALID_RECONCILED_BINDING_SET,
                str(binding_id),
                "Reconciled IM binding ID is not present in current bindings.",
            )
        )
    reconciled_bindings = [
        binding
        for binding in reconciliation_input.current_bindings
        if binding.binding_id in reconciliation_input.reconciled_binding_ids
    ]
    for identity_id, count in Counter(binding.identity_id for binding in reconciled_bindings).items():
        if count > 1:
            blockers.append(
                ReconciliationBlock(
                    ReconciliationBlockCode.INVALID_RECONCILED_BINDING_SET,
                    f"identity_id:{identity_id}",
                    "Reconciled IM bindings are not one-to-one by identity.",
                )
            )
    for contact_id, count in Counter(binding.contact_id for binding in reconciled_bindings).items():
        if count > 1:
            blockers.append(
                ReconciliationBlock(
                    ReconciliationBlockCode.INVALID_RECONCILED_BINDING_SET,
                    f"contact_id:{contact_id}",
                    "Reconciled IM bindings are not one-to-one by Contact.",
                )
            )
    return tuple(sorted(blockers, key=lambda block: (block.code.value, block.subject_key or "", block.message)))


def _normalize_email(email: str | None) -> NormalizedEmail | None:
    if email is None or not email.strip():
        return None
    try:
        return NormalizedEmail(email)
    except ValueError:
        return None


def _changed_identity_fields(
    current_identity: CurrentIMIdentityState,
    entry: DirectoryEntry,
    normalized_email: NormalizedEmail | None,
) -> tuple[str, ...]:
    desired_values = (
        ("display_name", current_identity.display_name, entry.display_name),
        ("email", current_identity.email, entry.email),
        ("normalized_email", current_identity.normalized_email, normalized_email),
    )
    return tuple(
        field_name for field_name, current_value, desired_value in desired_values if current_value != desired_value
    )


def _stable_key(kind: str, operation: str, *subjects: str) -> str:
    semantic_key = "\x1f".join((kind, operation, *subjects)).encode()
    return f"{kind}:{operation}:{hashlib.sha256(semantic_key).hexdigest()}"


def _not_matched_result(
    provider_user_id: ProviderUserId,
    identity_ref: IMIdentityRef,
    reason: ReconciliationReasonCode,
) -> PlannedSyncResult:
    return _planned_result(
        IMSyncResultType.NOT_MATCHED,
        provider_user_id,
        identity_ref,
        binding_id=None,
        contact_id=None,
        reason=reason,
    )


def _planned_result(
    result_type: IMSyncResultType,
    provider_user_id: ProviderUserId,
    identity_ref: IMIdentityRef,
    *,
    binding_id: IMBindingId | None,
    contact_id: ContactId | None,
    reason: ReconciliationReasonCode,
) -> PlannedSyncResult:
    subjects = (
        str(provider_user_id),
        str(binding_id) if binding_id is not None else "",
        str(contact_id) if contact_id is not None else "",
        reason.value,
    )
    return PlannedSyncResult(
        operation_key=_stable_key("result", result_type.value, *subjects),
        result_type=result_type,
        provider_user_id=provider_user_id,
        identity_ref=identity_ref,
        binding_id=binding_id,
        contact_id=contact_id,
        reason_code=reason.value,
    )
