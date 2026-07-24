"""Pure provider directory matching and immutable reconciliation plans."""

from __future__ import annotations

from dataclasses import dataclass, replace
from enum import StrEnum

from pydantic import JsonValue

from core.human_input_v2.contact_directory import ContactIdentitySource, ContactSnapshot
from core.human_input_v2.entities import IMProvider, IMSyncRemovalReason, IMSyncResultType, IMSyncRunStatus
from core.human_input_v2.shared import (
    AccountId,
    ContactId,
    IMBindingId,
    IMIdentityId,
    IMSyncResultId,
    IMSyncRunId,
    IntegrationId,
    NormalizedEmail,
    UtcTimestamp,
)

from .integration import IntegrationRevisionToken
from .records import IMBinding, IMIdentity, OpaqueProviderPayload


class MatchKind(StrEnum):
    """Stable explanation for how one provider entry was classified."""

    PROVIDER_USER_ID = "provider_user_id"
    NORMALIZED_EMAIL = "normalized_email"
    UNMATCHED = "unmatched"


@dataclass(frozen=True, slots=True)
class ProviderDirectoryEntry:
    """Provider-neutral directory values consumed by the pure reconciler."""

    provider_user_id: str
    display_name: str | None
    email: str | None
    normalized_email: NormalizedEmail | None
    raw_payload: OpaqueProviderPayload

    @classmethod
    def create(
        cls,
        *,
        provider_user_id: str,
        display_name: str | None,
        email: str | None,
        raw_payload: dict[str, JsonValue],
    ) -> ProviderDirectoryEntry:
        clean_email = email.strip() if email is not None else None
        return cls(
            provider_user_id=provider_user_id.strip(),
            display_name=display_name.strip() if display_name is not None else None,
            email=clean_email,
            normalized_email=NormalizedEmail(clean_email) if clean_email else None,
            raw_payload=OpaqueProviderPayload.from_mapping(raw_payload),
        )


@dataclass(frozen=True, slots=True)
class ReconciliationSnapshot:
    """Coherent current facts loaded before provider entries are matched."""

    identities: tuple[IMIdentity, ...] = ()
    bindings: tuple[IMBinding, ...] = ()
    contacts: tuple[ContactSnapshot, ...] = ()


@dataclass(frozen=True, slots=True)
class ReconciliationAction:
    """One provider entry match without persistence side effects."""

    entry: ProviderDirectoryEntry
    match_kind: MatchKind
    identity_id: IMIdentityId | None
    binding_id: IMBindingId | None
    contact_id: ContactId | None


@dataclass(frozen=True, slots=True)
class ReconciliationPlan:
    """Immutable plan whose captured revision must be checked again at apply."""

    sync_run_id: IMSyncRunId
    integration_revision: IntegrationRevisionToken
    provider: IMProvider
    actions: tuple[ReconciliationAction, ...]
    removed_identity_ids: tuple[IMIdentityId, ...]


@dataclass(frozen=True, slots=True)
class SyncResultFact:
    """Append-only outcome for one action, removed binding, or diagnostic.

    Removing an identity emits one fact per removed binding so every scope
    override remains auditable. An identity without bindings emits one fact
    whose binding and Contact fields are absent.
    """

    id: IMSyncResultId
    integration_id: IntegrationId
    sync_run_id: IMSyncRunId
    result_type: IMSyncResultType
    provider_user_id: str | None
    display_name: str | None
    email: str | None
    normalized_email: NormalizedEmail | None
    contact_id: ContactId | None
    identity_id: IMIdentityId | None
    binding_id: IMBindingId | None
    removal_reason: IMSyncRemovalReason | None
    reason_code: str | None
    reason_message: str | None
    directory_entry_payload: OpaqueProviderPayload | None
    contact_snapshot: SyncContactSnapshot | None
    identity_snapshot: SyncIdentitySnapshot | None
    created_at: UtcTimestamp
    updated_at: UtcTimestamp


@dataclass(frozen=True, slots=True)
class SyncContactSnapshot:
    """Immutable Contact display values retained by a historical result."""

    contact_id: ContactId
    name: str
    email: str | None
    avatar_file_id: str | None


@dataclass(frozen=True, slots=True)
class SyncIdentitySnapshot:
    """Immutable last-known provider identity retained after current deletion."""

    identity_id: IMIdentityId
    provider: IMProvider
    provider_user_id: str
    display_name: str | None
    email: str | None


@dataclass(frozen=True, slots=True)
class IMSyncRun:
    """Independent sync aggregate that captures one complete Integration token."""

    id: IMSyncRunId
    integration_revision: IntegrationRevisionToken
    provider: IMProvider
    status: IMSyncRunStatus
    added_count: int
    not_matched_count: int
    failed_count: int
    removed_count: int
    skipped_count: int
    started_by_account_id: AccountId | None
    started_at: UtcTimestamp | None
    finished_at: UtcTimestamp | None
    error_code: str | None
    error_message: str | None
    created_at: UtcTimestamp
    updated_at: UtcTimestamp

    @classmethod
    def create(
        cls,
        *,
        sync_run_id: IMSyncRunId,
        integration_revision: IntegrationRevisionToken,
        provider: IMProvider,
        started_by_account_id: AccountId | None,
        now: UtcTimestamp,
    ) -> IMSyncRun:
        return cls(
            id=sync_run_id,
            integration_revision=integration_revision,
            provider=provider,
            status=IMSyncRunStatus.QUEUED,
            added_count=0,
            not_matched_count=0,
            failed_count=0,
            removed_count=0,
            skipped_count=0,
            started_by_account_id=started_by_account_id,
            started_at=None,
            finished_at=None,
            error_code=None,
            error_message=None,
            created_at=now,
            updated_at=now,
        )

    @property
    def is_active(self) -> bool:
        return self.status in (IMSyncRunStatus.QUEUED, IMSyncRunStatus.RUNNING)

    def start(self, now: UtcTimestamp) -> IMSyncRun:
        if self.status is not IMSyncRunStatus.QUEUED:
            return self
        return replace(self, status=IMSyncRunStatus.RUNNING, started_at=now, updated_at=now)


class SyncReconciler:
    """Stateless matching policy with no provider or persistence dependencies."""

    @staticmethod
    def reconcile(
        *,
        sync_run_id: IMSyncRunId,
        integration_revision: IntegrationRevisionToken,
        provider: IMProvider,
        entries: tuple[ProviderDirectoryEntry, ...],
        snapshot: ReconciliationSnapshot,
    ) -> ReconciliationPlan:
        identities = {
            identity.provider_user_id: identity
            for identity in snapshot.identities
            if identity.integration_id == integration_revision.integration_id and identity.provider is provider
        }
        bindings_by_identity: dict[IMIdentityId, IMBinding] = {}
        for binding in sorted(snapshot.bindings, key=lambda item: item.scope.value, reverse=True):
            bindings_by_identity.setdefault(binding.identity_id, binding)
        contacts_by_email = {
            item.contact.normalized_email: item.contact
            for item in snapshot.contacts
            if item.account_available
            and item.contact.identity_source is ContactIdentitySource.ORGANIZATION_ACCOUNT
            and item.contact.normalized_email is not None
        }

        actions: list[ReconciliationAction] = []
        seen_provider_user_ids: set[str] = set()
        for entry in entries:
            seen_provider_user_ids.add(entry.provider_user_id)
            identity = identities.get(entry.provider_user_id)
            if identity is not None:
                matched_binding = bindings_by_identity.get(identity.id)
                actions.append(
                    ReconciliationAction(
                        entry=entry,
                        match_kind=MatchKind.PROVIDER_USER_ID,
                        identity_id=identity.id,
                        binding_id=matched_binding.id if matched_binding is not None else None,
                        contact_id=matched_binding.contact_id if matched_binding is not None else None,
                    )
                )
                continue

            contact = contacts_by_email.get(entry.normalized_email) if entry.normalized_email is not None else None
            actions.append(
                ReconciliationAction(
                    entry=entry,
                    match_kind=MatchKind.NORMALIZED_EMAIL if contact is not None else MatchKind.UNMATCHED,
                    identity_id=None,
                    binding_id=None,
                    contact_id=contact.id if contact is not None else None,
                )
            )

        removed = tuple(
            identity.id
            for identity in snapshot.identities
            if identity.integration_id == integration_revision.integration_id
            and identity.provider is provider
            and identity.provider_user_id not in seen_provider_user_ids
        )
        return ReconciliationPlan(sync_run_id, integration_revision, provider, tuple(actions), removed)
