"""IO-free reconciliation input adaptation and plan generation."""

from __future__ import annotations

from core.human_input_v2.im_integration import (
    ContactEmailMatchState,
    CurrentIMBindingState,
    CurrentIMIdentityState,
    IMSyncRun,
    PlanGenerationResult,
    ReconciliationInput,
    ReconciliationRunRef,
    SyncReconciler,
)
from core.human_input_v2.im_integration.adapters.entities import DirectoryEntry, ProviderUserId
from core.human_input_v2.shared import NormalizedEmail
from repositories.human_input_v2.im_binding_repository import IMBinding
from repositories.human_input_v2.im_identity_repository import IMIdentity


def generate_reconciliation_plan(
    run: IMSyncRun,
    directory_entries: tuple[DirectoryEntry, ...],
    current_identities: tuple[IMIdentity, ...],
    current_bindings: tuple[IMBinding, ...],
    contacts_for_email_matching: tuple[ContactEmailMatchState, ...],
) -> PlanGenerationResult:
    """Compute a plan exclusively from already-loaded immutable values."""

    identity_states = tuple(
        CurrentIMIdentityState(
            identity_id=identity.id,
            provider_user_id=ProviderUserId(identity.provider_user_id),
            display_name=identity.display_name,
            email=identity.email,
            normalized_email=_normalize_email(identity.email),
            last_seen_sync_run_id=identity.last_seen_sync_run_id,
        )
        for identity in current_identities
    )
    binding_states = tuple(
        CurrentIMBindingState(
            binding_id=binding.id,
            identity_id=binding.identity_id,
            contact_id=binding.contact_id,
        )
        for binding in current_bindings
    )
    return SyncReconciler.generate_plan(
        ReconciliationInput(
            run=ReconciliationRunRef(run.id, run.channel_revision, run.provider),
            directory_entries=directory_entries,
            current_identities=identity_states,
            current_bindings=binding_states,
            reconciled_binding_ids=frozenset(binding.id for binding in current_bindings),
            contacts_for_email_matching=contacts_for_email_matching,
        )
    )


def _normalize_email(email: str | None) -> NormalizedEmail | None:
    if email is None or not email.strip():
        return None
    try:
        return NormalizedEmail(email)
    except ValueError:
        return None


__all__ = ["generate_reconciliation_plan"]
