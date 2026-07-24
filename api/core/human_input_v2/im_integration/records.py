"""Current IM identity and binding values shared by sync and resolution."""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass

from pydantic import JsonValue

from core.human_input_v2.entities import IMBindingScope, IMProvider
from core.human_input_v2.shared import (
    AccountId,
    ContactId,
    IMBindingId,
    IMIdentityId,
    IMSyncRunId,
    IntegrationId,
    NormalizedEmail,
    UtcTimestamp,
)


@dataclass(frozen=True, slots=True)
class OpaqueProviderPayload:
    """Immutable provider JSON retained only for persistence diagnostics."""

    _serialized: str

    @classmethod
    def from_mapping(cls, values: Mapping[str, JsonValue]) -> OpaqueProviderPayload:
        return cls(json.dumps(dict(values), sort_keys=True, separators=(",", ":")))

    def to_mapping(self) -> dict[str, JsonValue]:
        value = json.loads(self._serialized)
        if not isinstance(value, dict):
            raise ValueError("provider payload must be a JSON object")
        return value


@dataclass(frozen=True, slots=True)
class IMIdentity:
    """Current provider identity independent from ORM lifetime and raw clients."""

    id: IMIdentityId
    integration_id: IntegrationId
    provider: IMProvider
    provider_user_id: str
    display_name: str | None
    normalized_name: str | None
    email: str | None
    normalized_email: NormalizedEmail | None
    raw_payload: OpaqueProviderPayload
    last_seen_sync_run_id: IMSyncRunId | None
    last_seen_at: UtcTimestamp | None
    created_at: UtcTimestamp
    updated_at: UtcTimestamp

    def __post_init__(self) -> None:
        if not self.provider_user_id.strip():
            raise ValueError("provider user id must not be blank")

    @classmethod
    def create(
        cls,
        *,
        identity_id: IMIdentityId,
        integration_id: IntegrationId,
        provider: IMProvider,
        provider_user_id: str,
        display_name: str | None,
        email: str | None,
        raw_payload: Mapping[str, JsonValue],
        last_seen_sync_run_id: IMSyncRunId | None,
        last_seen_at: UtcTimestamp | None,
        now: UtcTimestamp,
        created_at: UtcTimestamp | None = None,
    ) -> IMIdentity:
        clean_name = display_name.strip() if display_name is not None else None
        clean_email = email.strip() if email is not None else None
        return cls(
            id=identity_id,
            integration_id=integration_id,
            provider=provider,
            provider_user_id=provider_user_id.strip(),
            display_name=clean_name,
            normalized_name=clean_name.casefold() if clean_name else None,
            email=clean_email,
            normalized_email=NormalizedEmail(clean_email) if clean_email else None,
            raw_payload=OpaqueProviderPayload.from_mapping(raw_payload),
            last_seen_sync_run_id=last_seen_sync_run_id,
            last_seen_at=last_seen_at,
            created_at=created_at or now,
            updated_at=now,
        )


@dataclass(frozen=True, slots=True)
class IMBinding:
    """Current Contact-to-provider identity association in one resolution scope."""

    id: IMBindingId
    integration_id: IntegrationId
    scope: IMBindingScope
    scope_id: str
    contact_id: ContactId
    identity_id: IMIdentityId
    provider: IMProvider
    bound_by_account_id: AccountId | None
    created_at: UtcTimestamp
    updated_at: UtcTimestamp

    def __post_init__(self) -> None:
        if not self.scope_id.strip():
            raise ValueError("binding scope id must not be blank")
        if self.scope is IMBindingScope.ORGANIZATION and self.scope_id != str(self.integration_id):
            raise ValueError("organization binding scope must be its integration")

    @classmethod
    def create(
        cls,
        *,
        binding_id: IMBindingId,
        integration_id: IntegrationId,
        scope: IMBindingScope,
        scope_id: str,
        contact_id: ContactId,
        identity_id: IMIdentityId,
        provider: IMProvider,
        bound_by_account_id: AccountId | None,
        now: UtcTimestamp,
        created_at: UtcTimestamp | None = None,
    ) -> IMBinding:
        return cls(
            id=binding_id,
            integration_id=integration_id,
            scope=scope,
            scope_id=scope_id,
            contact_id=contact_id,
            identity_id=identity_id,
            provider=provider,
            bound_by_account_id=bound_by_account_id,
            created_at=created_at or now,
            updated_at=now,
        )
