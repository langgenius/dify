"""Channel-bound SQLAlchemy persistence for current IM Bindings."""

from __future__ import annotations

from collections.abc import Sequence
from typing import override

import sqlalchemy as sa
from pydantic import NaiveDatetime
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from core.human_input_v2.shared import AccountId, ContactId, IMBindingId, IMIdentityId, TenantId
from libs.datetime_utils import ensure_naive_utc
from libs.uuid_utils import uuidv7
from models.human_input_v2 import (
    HumanInputIMBinding,
    HumanInputIMBindingWorkspaceOverride,
)

from .im_binding_repository import (
    IMBinding,
    IMBindingAssignment,
    IMBindingConflictError,
    IMBindingIdentityNotFoundError,
    IMBindingKind,
    IMBindingRepository,
)
from .im_channel_repository import IMChannelId
from .sqlalchemy_im_identity_repository import _lock_current_identity

# TODO(QuantumGhost): this does not seems right...
_DEFAULT_ENDPOINT_CONSTRAINTS = frozenset(
    {
        "human_input_im_bindings_channel_contact_uq",
        "human_input_im_bindings_channel_identity_uq",
    }
)
_OVERRIDE_ENDPOINT_CONSTRAINTS = frozenset(
    {
        "hiimwbo_channel_tenant_contact_uq",
        "hiimwbo_channel_tenant_identity_uq",
    }
)
_SQLITE_DEFAULT_ENDPOINTS = frozenset(
    {
        "human_input_im_bindings.channel_id, human_input_im_bindings.contact_id",
        "human_input_im_bindings.channel_id, human_input_im_bindings.im_identity_id",
    }
)
_SQLITE_OVERRIDE_ENDPOINTS = frozenset(
    {
        (
            "human_input_im_workspace_binding_overrides.channel_id, "
            "human_input_im_workspace_binding_overrides.tenant_id, "
            "human_input_im_workspace_binding_overrides.contact_id"
        ),
        (
            "human_input_im_workspace_binding_overrides.channel_id, "
            "human_input_im_workspace_binding_overrides.tenant_id, "
            "human_input_im_workspace_binding_overrides.im_identity_id"
        ),
    }
)


def _default_binding_from_record(record: HumanInputIMBinding) -> IMBinding:
    return IMBinding(
        id=IMBindingId(record.id),
        kind=IMBindingKind.DEFAULT,
        contact_id=ContactId(record.contact_id),
        identity_id=IMIdentityId(record.im_identity_id),
        created_at=ensure_naive_utc(record.created_at),
        updated_at=ensure_naive_utc(record.updated_at),
    )


def _override_binding_from_record(record: HumanInputIMBindingWorkspaceOverride) -> IMBinding:
    return IMBinding(
        id=IMBindingId(record.id),
        kind=IMBindingKind.WORKSPACE_OVERRIDE,
        contact_id=ContactId(record.contact_id),
        identity_id=IMIdentityId(record.im_identity_id),
        created_at=ensure_naive_utc(record.created_at),
        updated_at=ensure_naive_utc(record.updated_at),
    )


def _is_endpoint_conflict(error: IntegrityError, *, workspace_override: bool) -> bool:
    message = str(error.orig).lower()
    constraint_names = _OVERRIDE_ENDPOINT_CONSTRAINTS if workspace_override else _DEFAULT_ENDPOINT_CONSTRAINTS
    sqlite_targets = _SQLITE_OVERRIDE_ENDPOINTS if workspace_override else _SQLITE_DEFAULT_ENDPOINTS
    return any(name in message for name in constraint_names) or any(target in message for target in sqlite_targets)


class SQLAlchemyIMBindingRepository(IMBindingRepository):
    """Persist Bindings through one caller-owned Session and trusted Channel."""

    def __init__(self, session: Session, channel_id: IMChannelId) -> None:
        self._session = session
        self._channel_id = channel_id

    @override
    def get(self, binding_id: IMBindingId) -> IMBinding | None:
        record = self._session.scalar(
            sa.select(HumanInputIMBinding)
            .where(
                HumanInputIMBinding.channel_id == str(self._channel_id),
                HumanInputIMBinding.id == str(binding_id),
            )
            .execution_options(autoflush=False)
        )
        return _default_binding_from_record(record) if record is not None else None

    @override
    def list_all(self) -> tuple[IMBinding, ...]:
        records = self._session.scalars(
            sa.select(HumanInputIMBinding)
            .where(HumanInputIMBinding.channel_id == str(self._channel_id))
            .order_by(HumanInputIMBinding.id)
            .execution_options(autoflush=False)
        ).all()
        return tuple(_default_binding_from_record(record) for record in records)

    @override
    def create(
        self,
        assignment: IMBindingAssignment,
        *,
        bound_by_account_id: AccountId | None,
    ) -> IMBinding:
        self._require_identity(assignment.identity_id)
        existing_contact = self._get_default_for_contact(assignment.contact_id)
        if existing_contact is not None:
            if existing_contact.im_identity_id == str(assignment.identity_id):
                return _default_binding_from_record(existing_contact)
            raise IMBindingConflictError("Contact already has a different default IM Binding")
        if self._get_default_for_identity(assignment.identity_id) is not None:
            raise IMBindingConflictError("IM Identity already has a different default Contact")

        record = HumanInputIMBinding(
            channel_id=str(self._channel_id),
            contact_id=str(assignment.contact_id),
            im_identity_id=str(assignment.identity_id),
            bound_by_account_id=(str(bound_by_account_id) if bound_by_account_id is not None else None),
        )
        record.id = str(uuidv7())
        record.created_at = assignment.assigned_at
        record.updated_at = assignment.assigned_at
        try:
            self._session.add(record)
            self._session.flush([record])
        except IntegrityError as error:
            if _is_endpoint_conflict(error, workspace_override=False):
                raise IMBindingConflictError("Default IM Binding endpoint is already assigned") from error
            raise
        return _default_binding_from_record(record)

    @override
    def replace(
        self,
        binding_id: IMBindingId,
        *,
        expected_identity_id: IMIdentityId,
        next_identity_id: IMIdentityId,
        bound_by_account_id: AccountId | None,
        updated_at: NaiveDatetime,
    ) -> IMBinding | None:
        # TODO(QuantumGhost): this seems incorrect. We should delete
        # the old record and create a new record.
        record = self._session.scalar(
            sa.select(HumanInputIMBinding)
            .where(
                HumanInputIMBinding.channel_id == str(self._channel_id),
                HumanInputIMBinding.id == str(binding_id),
                HumanInputIMBinding.im_identity_id == str(expected_identity_id),
            )
            .execution_options(autoflush=False)
        )
        if record is None:
            return None
        self._require_identity(next_identity_id)
        occupying_record = self._get_default_for_identity(next_identity_id)
        if occupying_record is not None and occupying_record.id != record.id:
            raise IMBindingConflictError("IM Identity already has a different default Contact")
        record.im_identity_id = str(next_identity_id)
        record.bound_by_account_id = str(bound_by_account_id) if bound_by_account_id is not None else None
        record.updated_at = updated_at
        try:
            self._session.flush([record])
        except IntegrityError as error:
            if _is_endpoint_conflict(error, workspace_override=False):
                raise IMBindingConflictError("Default IM Binding endpoint is already assigned") from error
            raise
        return _default_binding_from_record(record)

    @override
    def delete(
        self,
        binding_id: IMBindingId,
        *,
        expected_identity_id: IMIdentityId,
    ) -> None:
        record = self._session.scalar(
            sa.select(HumanInputIMBinding)
            .where(
                HumanInputIMBinding.channel_id == str(self._channel_id),
                HumanInputIMBinding.id == str(binding_id),
                HumanInputIMBinding.im_identity_id == str(expected_identity_id),
            )
            .execution_options(autoflush=False)
        )
        if record is None:
            return
        self._session.delete(record)
        self._session.flush()

    @override
    def set_workspace_override(
        self,
        tenant_id: TenantId,
        assignment: IMBindingAssignment,
        *,
        bound_by_account_id: AccountId | None,
    ) -> IMBinding:
        self._require_identity(assignment.identity_id)
        record = self._get_workspace_override_for_contact(tenant_id, assignment.contact_id)
        occupying_record = self._get_workspace_override_for_identity(tenant_id, assignment.identity_id)
        if occupying_record is not None and (record is None or occupying_record.id != record.id):
            raise IMBindingConflictError("IM Identity already overrides a different Contact in this workspace")

        if record is None:
            record = HumanInputIMBindingWorkspaceOverride(
                channel_id=str(self._channel_id),
                tenant_id=str(tenant_id),
                contact_id=str(assignment.contact_id),
                im_identity_id=str(assignment.identity_id),
                bound_by_account_id=(str(bound_by_account_id) if bound_by_account_id is not None else None),
            )
            record.id = str(uuidv7())
            record.created_at = assignment.assigned_at
            self._session.add(record)
        else:
            # TODO(QuantumGhost): this should be a replace instead of an update.
            record.im_identity_id = str(assignment.identity_id)
            record.bound_by_account_id = str(bound_by_account_id) if bound_by_account_id is not None else None
        record.updated_at = assignment.assigned_at
        try:
            self._session.flush([record])
        except IntegrityError as error:
            if _is_endpoint_conflict(error, workspace_override=True):
                raise IMBindingConflictError("Workspace IM Binding endpoint is already assigned") from error
            raise
        return _override_binding_from_record(record)

    @override
    def reset_workspace_override(
        self,
        tenant_id: TenantId,
        contact_id: ContactId,
    ) -> IMBinding | None:
        record = self._get_workspace_override_for_contact(tenant_id, contact_id)
        if record is None:
            return None
        binding = _override_binding_from_record(record)
        self._session.delete(record)
        self._session.flush()
        return binding

    @override
    def get_effective(
        self,
        tenant_id: TenantId,
        contact_id: ContactId,
    ) -> IMBinding | None:
        override = self._get_workspace_override_for_contact(tenant_id, contact_id)
        if override is not None:
            return _override_binding_from_record(override)
        default = self._get_default_for_contact(contact_id)
        return _default_binding_from_record(default) if default is not None else None

    @override
    def get_effective_many(
        self,
        tenant_id: TenantId,
        contact_ids: Sequence[ContactId],
    ) -> tuple[IMBinding, ...]:
        distinct_contact_ids = tuple(dict.fromkeys(contact_ids))
        if not distinct_contact_ids:
            return ()
        contact_id_values = [str(contact_id) for contact_id in distinct_contact_ids]
        overrides = self._session.scalars(
            sa.select(HumanInputIMBindingWorkspaceOverride)
            .where(
                HumanInputIMBindingWorkspaceOverride.channel_id == str(self._channel_id),
                HumanInputIMBindingWorkspaceOverride.tenant_id == str(tenant_id),
                HumanInputIMBindingWorkspaceOverride.contact_id.in_(contact_id_values),
            )
            .execution_options(autoflush=False)
        ).all()
        defaults = self._session.scalars(
            sa.select(HumanInputIMBinding)
            .where(
                HumanInputIMBinding.channel_id == str(self._channel_id),
                HumanInputIMBinding.contact_id.in_(contact_id_values),
            )
            .execution_options(autoflush=False)
        ).all()
        override_by_contact = {record.contact_id: record for record in overrides}
        default_by_contact = {record.contact_id: record for record in defaults}
        result: list[IMBinding] = []
        for contact_id in distinct_contact_ids:
            contact_key = str(contact_id)
            override = override_by_contact.get(contact_key)
            if override is not None:
                result.append(_override_binding_from_record(override))
                continue
            default = default_by_contact.get(contact_key)
            if default is not None:
                result.append(_default_binding_from_record(default))
        return tuple(result)

    def _require_identity(self, identity_id: IMIdentityId) -> None:
        if not _lock_current_identity(self._session, self._channel_id, identity_id):
            raise IMBindingIdentityNotFoundError("IM Identity is not current in the bound Channel")

    def _get_default_for_contact(self, contact_id: ContactId) -> HumanInputIMBinding | None:
        return self._session.scalar(
            sa.select(HumanInputIMBinding)
            .where(
                HumanInputIMBinding.channel_id == str(self._channel_id),
                HumanInputIMBinding.contact_id == str(contact_id),
            )
            .execution_options(autoflush=False)
        )

    def _get_default_for_identity(self, identity_id: IMIdentityId) -> HumanInputIMBinding | None:
        return self._session.scalar(
            sa.select(HumanInputIMBinding)
            .where(
                HumanInputIMBinding.channel_id == str(self._channel_id),
                HumanInputIMBinding.im_identity_id == str(identity_id),
            )
            .execution_options(autoflush=False)
        )

    def _get_workspace_override_for_contact(
        self,
        tenant_id: TenantId,
        contact_id: ContactId,
    ) -> HumanInputIMBindingWorkspaceOverride | None:
        return self._session.scalar(
            sa.select(HumanInputIMBindingWorkspaceOverride)
            .where(
                HumanInputIMBindingWorkspaceOverride.channel_id == str(self._channel_id),
                HumanInputIMBindingWorkspaceOverride.tenant_id == str(tenant_id),
                HumanInputIMBindingWorkspaceOverride.contact_id == str(contact_id),
            )
            .execution_options(autoflush=False)
        )

    def _get_workspace_override_for_identity(
        self,
        tenant_id: TenantId,
        identity_id: IMIdentityId,
    ) -> HumanInputIMBindingWorkspaceOverride | None:
        return self._session.scalar(
            sa.select(HumanInputIMBindingWorkspaceOverride)
            .where(
                HumanInputIMBindingWorkspaceOverride.channel_id == str(self._channel_id),
                HumanInputIMBindingWorkspaceOverride.tenant_id == str(tenant_id),
                HumanInputIMBindingWorkspaceOverride.im_identity_id == str(identity_id),
            )
            .execution_options(autoflush=False)
        )


__all__ = ["SQLAlchemyIMBindingRepository"]
