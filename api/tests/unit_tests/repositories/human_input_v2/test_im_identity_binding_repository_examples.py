"""Behavioral Repository doubles and mapping examples for current IM state."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, replace
from datetime import datetime

import pytest
from pydantic import NaiveDatetime

from core.human_input_v2.shared import (
    AccountId,
    ContactId,
    IMBindingId,
    IMIdentityId,
    IMSyncRunId,
    TenantId,
)
from repositories.human_input_v2.im_binding_repository import (
    IMBinding,
    IMBindingAssignment,
    IMBindingConflictError,
    IMBindingIdentityNotFoundError,
    IMBindingKind,
    IMBindingRepository,
    StaleIMBindingWriteError,
)
from repositories.human_input_v2.im_channel_repository import IMChannelId
from repositories.human_input_v2.im_identity_repository import (
    IMIdentity,
    IMIdentityAlreadyExistsError,
    IMIdentityInUseError,
    IMIdentityNotFoundError,
    IMIdentityObservation,
    IMIdentityPage,
    IMIdentityRepository,
    OpaqueProviderPayload,
)

_NOW = datetime(2026, 9, 2, 8)
_LATER = datetime(2026, 9, 2, 9)
_WORKSPACE_CHANNEL_ID = IMChannelId("00000000-0000-0000-0000-000000000101")
_DEPLOYMENT_CHANNEL_ID = IMChannelId("00000000-0000-0000-0000-000000000102")
_IDENTITY_ID = IMIdentityId("00000000-0000-0000-0000-000000000201")
_OTHER_IDENTITY_ID = IMIdentityId("00000000-0000-0000-0000-000000000202")
_BINDING_ID = IMBindingId("00000000-0000-0000-0000-000000000301")
_OVERRIDE_ID = IMBindingId("00000000-0000-0000-0000-000000000302")
_CONTACT_ID = ContactId("00000000-0000-0000-0000-000000000401")
_OTHER_CONTACT_ID = ContactId("00000000-0000-0000-0000-000000000402")
_SYNC_RUN_ID = IMSyncRunId("00000000-0000-0000-0000-000000000501")
_TENANT_ID = TenantId("00000000-0000-0000-0000-000000000601")
_ACCOUNT_ID = AccountId("00000000-0000-0000-0000-000000000701")


@dataclass(frozen=True, slots=True)
class _IdentityRecord:
    channel_id: IMChannelId
    id: IMIdentityId
    provider_user_id: str
    display_name: str | None
    normalized_name: str | None
    email: str | None
    normalized_email: str | None
    raw_payload: OpaqueProviderPayload
    last_seen_sync_run_id: IMSyncRunId
    last_seen_at: NaiveDatetime
    created_at: NaiveDatetime
    updated_at: NaiveDatetime


@dataclass(frozen=True, slots=True)
class _DefaultBindingRecord:
    channel_id: IMChannelId
    id: IMBindingId
    contact_id: ContactId
    identity_id: IMIdentityId
    bound_by_account_id: AccountId | None
    created_at: NaiveDatetime
    updated_at: NaiveDatetime


@dataclass(frozen=True, slots=True)
class _WorkspaceOverrideRecord:
    channel_id: IMChannelId
    tenant_id: TenantId
    id: IMBindingId
    contact_id: ContactId
    identity_id: IMIdentityId
    bound_by_account_id: AccountId | None
    created_at: NaiveDatetime
    updated_at: NaiveDatetime


def _canonical_pair(value: str | None) -> tuple[str | None, str | None]:
    if value is None or not (source := value.strip()):
        return None, None
    return source, source.casefold()


def _identity_record_from_observation(
    channel_id: IMChannelId,
    identity_id: IMIdentityId,
    observation: IMIdentityObservation,
    *,
    created_at: NaiveDatetime | None = None,
) -> _IdentityRecord:
    display_name, normalized_name = _canonical_pair(observation.display_name)
    email, normalized_email = _canonical_pair(observation.email)
    return _IdentityRecord(
        channel_id=channel_id,
        id=identity_id,
        provider_user_id=observation.provider_user_id.strip(),
        display_name=display_name,
        normalized_name=normalized_name,
        email=email,
        normalized_email=normalized_email,
        raw_payload=observation.raw_payload,
        last_seen_sync_run_id=observation.sync_run_id,
        last_seen_at=observation.observed_at,
        created_at=created_at or observation.observed_at,
        updated_at=observation.observed_at,
    )


def _identity_from_record(record: _IdentityRecord) -> IMIdentity:
    return IMIdentity(
        id=record.id,
        provider_user_id=record.provider_user_id,
        display_name=record.display_name,
        email=record.email,
        last_seen_sync_run_id=record.last_seen_sync_run_id,
        last_seen_at=record.last_seen_at,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


def _binding_from_record(record: _DefaultBindingRecord | _WorkspaceOverrideRecord) -> IMBinding:
    kind = IMBindingKind.DEFAULT if isinstance(record, _DefaultBindingRecord) else IMBindingKind.WORKSPACE_OVERRIDE
    return IMBinding(
        id=record.id,
        kind=kind,
        contact_id=record.contact_id,
        identity_id=record.identity_id,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


class _IdentityRepositoryDouble:
    """In-memory double for one Channel-bound Identity capability."""

    def __init__(
        self,
        channel_id: IMChannelId,
        *,
        in_use_identity_ids: frozenset[IMIdentityId] = frozenset(),
    ) -> None:
        self._channel_id = channel_id
        self._in_use_identity_ids = in_use_identity_ids
        self._records: dict[IMIdentityId, _IdentityRecord] = {}

    def record(self, identity_id: IMIdentityId) -> _IdentityRecord:
        return self._records[identity_id]

    def get(self, identity_id: IMIdentityId) -> IMIdentity | None:
        record = self._records.get(identity_id)
        return _identity_from_record(record) if record is not None else None

    def get_by_provider_user_id(self, provider_user_id: str) -> IMIdentity | None:
        canonical_provider_user_id = provider_user_id.strip()
        record = next(
            (
                candidate
                for candidate in self._records.values()
                if candidate.provider_user_id == canonical_provider_user_id
            ),
            None,
        )
        return _identity_from_record(record) if record is not None else None

    def list_all(self) -> tuple[IMIdentity, ...]:
        return tuple(_identity_from_record(record) for record in self._records.values())

    def search(self, *, keyword: str = "", page: int, limit: int) -> IMIdentityPage:
        canonical_keyword = keyword.strip().casefold()
        matches = tuple(
            record
            for record in self._records.values()
            if not canonical_keyword
            or canonical_keyword in record.provider_user_id.casefold()
            or (record.normalized_name is not None and canonical_keyword in record.normalized_name)
            or (record.normalized_email is not None and canonical_keyword in record.normalized_email)
        )
        offset = (page - 1) * limit
        return IMIdentityPage(
            items=tuple(_identity_from_record(record) for record in matches[offset : offset + limit]),
            page=page,
            limit=limit,
            total=len(matches),
        )

    def create(self, identity_id: IMIdentityId, observation: IMIdentityObservation) -> IMIdentity:
        provider_user_id = observation.provider_user_id.strip()
        if self.get_by_provider_user_id(provider_user_id) is not None:
            raise IMIdentityAlreadyExistsError
        record = _identity_record_from_observation(self._channel_id, identity_id, observation)
        self._records[identity_id] = record
        return _identity_from_record(record)

    def update(self, identity_id: IMIdentityId, observation: IMIdentityObservation) -> IMIdentity:
        current = self._records.get(identity_id)
        if current is None:
            raise IMIdentityNotFoundError
        updated = _identity_record_from_observation(
            self._channel_id,
            identity_id,
            replace(observation, provider_user_id=current.provider_user_id),
            created_at=current.created_at,
        )
        self._records[identity_id] = updated
        return _identity_from_record(updated)

    def delete(self, identity_id: IMIdentityId) -> IMIdentity:
        current = self._records.get(identity_id)
        if current is None:
            raise IMIdentityNotFoundError
        if identity_id in self._in_use_identity_ids:
            raise IMIdentityInUseError
        del self._records[identity_id]
        return _identity_from_record(current)


class _BindingRepositoryDouble:
    """In-memory double for one Channel-bound Binding capability."""

    def __init__(self, channel_id: IMChannelId, identity_ids: frozenset[IMIdentityId]) -> None:
        self._channel_id = channel_id
        self._identity_ids = identity_ids
        self._defaults: dict[IMBindingId, _DefaultBindingRecord] = {}
        self._overrides: dict[tuple[TenantId, ContactId], _WorkspaceOverrideRecord] = {}

    def _require_identity(self, identity_id: IMIdentityId) -> None:
        if identity_id not in self._identity_ids:
            raise IMBindingIdentityNotFoundError

    def get(self, binding_id: IMBindingId) -> IMBinding | None:
        record = self._defaults.get(binding_id)
        return _binding_from_record(record) if record is not None else None

    def _get_default_for_contact(self, contact_id: ContactId) -> IMBinding | None:
        record = next(
            (candidate for candidate in self._defaults.values() if candidate.contact_id == contact_id),
            None,
        )
        return _binding_from_record(record) if record is not None else None

    def list_all(self) -> tuple[IMBinding, ...]:
        return tuple(_binding_from_record(record) for record in self._defaults.values())

    def create(
        self,
        assignment: IMBindingAssignment,
        *,
        bound_by_account_id: AccountId | None,
    ) -> IMBinding:
        self._require_identity(assignment.identity_id)
        existing_contact = self._get_default_for_contact(assignment.contact_id)
        if existing_contact is not None:
            if existing_contact.identity_id == assignment.identity_id:
                return existing_contact
            raise IMBindingConflictError
        if any(record.identity_id == assignment.identity_id for record in self._defaults.values()):
            raise IMBindingConflictError
        record = _DefaultBindingRecord(
            channel_id=self._channel_id,
            id=assignment.new_binding_id,
            contact_id=assignment.contact_id,
            identity_id=assignment.identity_id,
            bound_by_account_id=bound_by_account_id,
            created_at=assignment.assigned_at,
            updated_at=assignment.assigned_at,
        )
        self._defaults[record.id] = record
        return _binding_from_record(record)

    def replace(
        self,
        binding_id: IMBindingId,
        *,
        expected_identity_id: IMIdentityId,
        next_identity_id: IMIdentityId,
        bound_by_account_id: AccountId | None,
        updated_at: NaiveDatetime,
    ) -> IMBinding:
        current = self._defaults.get(binding_id)
        if current is None or current.identity_id != expected_identity_id:
            raise StaleIMBindingWriteError
        self._require_identity(next_identity_id)
        if any(
            record.id != binding_id and record.identity_id == next_identity_id for record in self._defaults.values()
        ):
            raise IMBindingConflictError
        updated = replace(
            current,
            identity_id=next_identity_id,
            bound_by_account_id=bound_by_account_id,
            updated_at=updated_at,
        )
        self._defaults[binding_id] = updated
        return _binding_from_record(updated)

    def delete(
        self,
        binding_id: IMBindingId,
        *,
        expected_identity_id: IMIdentityId,
    ) -> IMBinding:
        current = self._defaults.get(binding_id)
        if current is None or current.identity_id != expected_identity_id:
            raise StaleIMBindingWriteError
        del self._defaults[binding_id]
        return _binding_from_record(current)

    def set_workspace_override(
        self,
        tenant_id: TenantId,
        assignment: IMBindingAssignment,
        *,
        bound_by_account_id: AccountId | None,
    ) -> IMBinding:
        self._require_identity(assignment.identity_id)
        key = (tenant_id, assignment.contact_id)
        if any(
            override_key != key and override_key[0] == tenant_id and record.identity_id == assignment.identity_id
            for override_key, record in self._overrides.items()
        ):
            raise IMBindingConflictError
        current = self._overrides.get(key)
        if current is None:
            record = _WorkspaceOverrideRecord(
                channel_id=self._channel_id,
                tenant_id=tenant_id,
                id=assignment.new_binding_id,
                contact_id=assignment.contact_id,
                identity_id=assignment.identity_id,
                bound_by_account_id=bound_by_account_id,
                created_at=assignment.assigned_at,
                updated_at=assignment.assigned_at,
            )
        else:
            record = replace(
                current,
                identity_id=assignment.identity_id,
                bound_by_account_id=bound_by_account_id,
                updated_at=assignment.assigned_at,
            )
        self._overrides[key] = record
        return _binding_from_record(record)

    def reset_workspace_override(
        self,
        tenant_id: TenantId,
        contact_id: ContactId,
    ) -> IMBinding | None:
        record = self._overrides.pop((tenant_id, contact_id), None)
        return _binding_from_record(record) if record is not None else None

    def get_effective(
        self,
        tenant_id: TenantId,
        contact_id: ContactId,
    ) -> IMBinding | None:
        override = self._overrides.get((tenant_id, contact_id))
        if override is not None:
            return _binding_from_record(override)
        return self._get_default_for_contact(contact_id)

    def get_effective_many(
        self,
        tenant_id: TenantId,
        contact_ids: Sequence[ContactId],
    ) -> tuple[IMBinding, ...]:
        bindings = (self.get_effective(tenant_id, contact_id) for contact_id in dict.fromkeys(contact_ids))
        return tuple(binding for binding in bindings if binding is not None)


def _observation(
    *,
    display_name: str | None = "Reviewer",
    email: str | None = "reviewer@example.com",
    observed_at: NaiveDatetime = _NOW,
) -> IMIdentityObservation:
    return IMIdentityObservation(
        provider_user_id=" provider-user-1 ",
        display_name=display_name,
        email=email,
        raw_payload=OpaqueProviderPayload({"provider": {"user_id": "provider-user-1"}}),
        sync_run_id=_SYNC_RUN_ID,
        observed_at=observed_at,
    )


def _assignment(
    *,
    binding_id: IMBindingId = _BINDING_ID,
    contact_id: ContactId = _CONTACT_ID,
    identity_id: IMIdentityId = _IDENTITY_ID,
    assigned_at: NaiveDatetime = _NOW,
) -> IMBindingAssignment:
    return IMBindingAssignment(
        new_binding_id=binding_id,
        contact_id=contact_id,
        identity_id=identity_id,
        assigned_at=assigned_at,
    )


@pytest.mark.parametrize(("display_name", "email"), [(None, None), (" \t", "\n ")])
def test_identity_repository_mapping_persists_blank_optional_pairs_as_null(
    display_name: str | None,
    email: str | None,
) -> None:
    repository_double = _IdentityRepositoryDouble(_WORKSPACE_CHANNEL_ID)
    repository: IMIdentityRepository = repository_double

    identity = repository.create(_IDENTITY_ID, _observation(display_name=display_name, email=email))
    record = repository_double.record(_IDENTITY_ID)

    assert (record.display_name, record.normalized_name) == (None, None)
    assert (record.email, record.normalized_email) == (None, None)
    assert (identity.display_name, identity.email) == (None, None)


def test_identity_repository_mapping_derives_canonical_pairs_from_observation() -> None:
    repository_double = _IdentityRepositoryDouble(_WORKSPACE_CHANNEL_ID)
    repository: IMIdentityRepository = repository_double
    observation = _observation(
        display_name="  ReViewer Name  ",
        email="  Reviewer@Example.COM  ",
    )

    identity = repository.create(_IDENTITY_ID, observation)
    record = repository_double.record(_IDENTITY_ID)

    assert record.provider_user_id == "provider-user-1"
    assert (record.display_name, record.normalized_name) == ("ReViewer Name", "reviewer name")
    assert (record.email, record.normalized_email) == ("Reviewer@Example.COM", "reviewer@example.com")
    assert record.raw_payload.root == observation.raw_payload.root
    assert identity.display_name == "ReViewer Name"
    assert identity.email == "Reviewer@Example.COM"
    assert not hasattr(identity, "normalized_name")
    assert not hasattr(identity, "normalized_email")


def test_workspace_and_deployment_channels_map_to_identical_owner_free_values() -> None:
    workspace_identity_record = _identity_record_from_observation(
        _WORKSPACE_CHANNEL_ID,
        _IDENTITY_ID,
        _observation(),
    )
    deployment_identity_record = replace(workspace_identity_record, channel_id=_DEPLOYMENT_CHANNEL_ID)
    workspace_default_record = _DefaultBindingRecord(
        channel_id=_WORKSPACE_CHANNEL_ID,
        id=_BINDING_ID,
        contact_id=_CONTACT_ID,
        identity_id=_IDENTITY_ID,
        bound_by_account_id=_ACCOUNT_ID,
        created_at=_NOW,
        updated_at=_LATER,
    )
    deployment_default_record = replace(
        workspace_default_record,
        channel_id=_DEPLOYMENT_CHANNEL_ID,
        bound_by_account_id=None,
    )

    assert _identity_from_record(workspace_identity_record) == _identity_from_record(deployment_identity_record)
    assert _binding_from_record(workspace_default_record) == _binding_from_record(deployment_default_record)


@pytest.mark.parametrize("channel_id", [_WORKSPACE_CHANNEL_ID, _DEPLOYMENT_CHANNEL_ID])
def test_binding_kind_is_derived_only_from_persisted_table_record(channel_id: IMChannelId) -> None:
    default_record = _DefaultBindingRecord(
        channel_id=channel_id,
        id=_BINDING_ID,
        contact_id=_CONTACT_ID,
        identity_id=_IDENTITY_ID,
        bound_by_account_id=None,
        created_at=_NOW,
        updated_at=_NOW,
    )
    override_record = _WorkspaceOverrideRecord(
        channel_id=channel_id,
        tenant_id=_TENANT_ID,
        id=_OVERRIDE_ID,
        contact_id=_CONTACT_ID,
        identity_id=_OTHER_IDENTITY_ID,
        bound_by_account_id=_ACCOUNT_ID,
        created_at=_NOW,
        updated_at=_LATER,
    )

    assert _binding_from_record(default_record).kind is IMBindingKind.DEFAULT
    assert _binding_from_record(override_record).kind is IMBindingKind.WORKSPACE_OVERRIDE


def test_separate_repository_doubles_satisfy_identity_and_binding_contracts() -> None:
    identity_double = _IdentityRepositoryDouble(_WORKSPACE_CHANNEL_ID)
    identity_repository: IMIdentityRepository = identity_double
    binding_repository: IMBindingRepository = _BindingRepositoryDouble(
        _WORKSPACE_CHANNEL_ID,
        frozenset({_IDENTITY_ID, _OTHER_IDENTITY_ID}),
    )

    identity = identity_repository.create(_IDENTITY_ID, _observation())
    default_binding = binding_repository.create(_assignment(), bound_by_account_id=None)
    override = binding_repository.set_workspace_override(
        _TENANT_ID,
        _assignment(binding_id=_OVERRIDE_ID, identity_id=_OTHER_IDENTITY_ID, assigned_at=_LATER),
        bound_by_account_id=_ACCOUNT_ID,
    )

    assert identity_repository.get_by_provider_user_id("provider-user-1") == identity
    assert identity_repository.search(keyword="REVIEWER", page=1, limit=20).items == (identity,)
    assert default_binding.kind is IMBindingKind.DEFAULT
    assert override.kind is IMBindingKind.WORKSPACE_OVERRIDE
    assert binding_repository.get_effective(_TENANT_ID, _CONTACT_ID) == override
    assert binding_repository.reset_workspace_override(_TENANT_ID, _CONTACT_ID) == override
    assert binding_repository.get_effective(_TENANT_ID, _CONTACT_ID) == default_binding


def test_repository_doubles_preserve_published_conflict_and_lifecycle_semantics() -> None:
    identity_repository = _IdentityRepositoryDouble(
        _WORKSPACE_CHANNEL_ID,
        in_use_identity_ids=frozenset({_IDENTITY_ID}),
    )
    binding_repository = _BindingRepositoryDouble(
        _WORKSPACE_CHANNEL_ID,
        frozenset({_IDENTITY_ID, _OTHER_IDENTITY_ID}),
    )
    identity_repository.create(_IDENTITY_ID, _observation())
    binding_repository.create(_assignment(), bound_by_account_id=None)

    with pytest.raises(IMIdentityAlreadyExistsError):
        identity_repository.create(_OTHER_IDENTITY_ID, _observation())
    with pytest.raises(IMIdentityInUseError):
        identity_repository.delete(_IDENTITY_ID)
    with pytest.raises(IMBindingConflictError):
        binding_repository.create(
            _assignment(binding_id=_OVERRIDE_ID, identity_id=_OTHER_IDENTITY_ID),
            bound_by_account_id=None,
        )
    with pytest.raises(IMBindingIdentityNotFoundError):
        binding_repository.set_workspace_override(
            _TENANT_ID,
            _assignment(identity_id=IMIdentityId("00000000-0000-0000-0000-000000000999")),
            bound_by_account_id=None,
        )

    first_override = binding_repository.set_workspace_override(
        _TENANT_ID,
        _assignment(binding_id=_OVERRIDE_ID, identity_id=_OTHER_IDENTITY_ID),
        bound_by_account_id=None,
    )
    replaced_override = binding_repository.set_workspace_override(
        _TENANT_ID,
        _assignment(
            binding_id=IMBindingId("00000000-0000-0000-0000-000000000999"),
            identity_id=_IDENTITY_ID,
            assigned_at=_LATER,
        ),
        bound_by_account_id=_ACCOUNT_ID,
    )

    assert replaced_override.id == first_override.id
    assert replaced_override.created_at == first_override.created_at
    assert replaced_override.updated_at == _LATER


def test_identity_provider_user_uniqueness_is_channel_local() -> None:
    workspace_repository = _IdentityRepositoryDouble(_WORKSPACE_CHANNEL_ID)
    deployment_repository = _IdentityRepositoryDouble(_DEPLOYMENT_CHANNEL_ID)

    workspace_identity = workspace_repository.create(_IDENTITY_ID, _observation())
    deployment_identity = deployment_repository.create(_OTHER_IDENTITY_ID, _observation())

    assert workspace_identity.provider_user_id == deployment_identity.provider_user_id
    with pytest.raises(IMIdentityAlreadyExistsError):
        workspace_repository.create(_OTHER_IDENTITY_ID, _observation())


def test_binding_identity_can_be_reused_across_kinds_and_target_workspaces() -> None:
    repository = _BindingRepositoryDouble(
        _WORKSPACE_CHANNEL_ID,
        frozenset({_IDENTITY_ID}),
    )
    other_tenant_id = TenantId("00000000-0000-0000-0000-000000000602")
    third_contact_id = ContactId("00000000-0000-0000-0000-000000000403")
    second_override_id = IMBindingId("00000000-0000-0000-0000-000000000303")

    default_binding = repository.create(_assignment(), bound_by_account_id=None)
    first_override = repository.set_workspace_override(
        _TENANT_ID,
        _assignment(binding_id=_OVERRIDE_ID, contact_id=_OTHER_CONTACT_ID),
        bound_by_account_id=None,
    )
    second_override = repository.set_workspace_override(
        other_tenant_id,
        _assignment(binding_id=second_override_id, contact_id=third_contact_id),
        bound_by_account_id=None,
    )

    assert default_binding.identity_id == _IDENTITY_ID
    assert first_override.identity_id == _IDENTITY_ID
    assert second_override.identity_id == _IDENTITY_ID


def test_conflicting_binding_write_preserves_existing_state() -> None:
    repository = _BindingRepositoryDouble(
        _WORKSPACE_CHANNEL_ID,
        frozenset({_IDENTITY_ID, _OTHER_IDENTITY_ID}),
    )
    existing = repository.create(_assignment(), bound_by_account_id=None)

    with pytest.raises(IMBindingConflictError):
        repository.create(
            _assignment(binding_id=_OVERRIDE_ID, identity_id=_OTHER_IDENTITY_ID),
            bound_by_account_id=None,
        )

    assert repository.list_all() == (existing,)
