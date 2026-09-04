"""Behavioral contracts for Channel-bound current IM Binding persistence."""

from __future__ import annotations

from dataclasses import fields
from datetime import datetime
from functools import partial

import pytest
import sqlalchemy as sa
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from core.human_input_v2.shared import AccountId, ContactId, IMBindingId, IMIdentityId, IMSyncRunId, TenantId
from models.human_input_v2 import HumanInputIMBinding, HumanInputIMBindingWorkspaceOverride
from repositories.human_input_v2.im_binding_repository import (
    IMBinding,
    IMBindingAssignment,
    IMBindingConflictError,
    IMBindingIdentityNotFoundError,
    IMBindingKind,
    IMBindingRepositoryError,
)
from repositories.human_input_v2.im_channel_repository import IMChannelId
from repositories.human_input_v2.im_identity_repository import IMIdentityObservation, OpaqueProviderPayload
from repositories.human_input_v2.sqlalchemy_im_binding_repository import SQLAlchemyIMBindingRepository
from repositories.human_input_v2.sqlalchemy_im_identity_repository import SQLAlchemyIMIdentityRepository

_NOW = datetime(2026, 9, 1, 8)
_LATER = datetime(2026, 9, 1, 9)
_CHANNEL_ONE = IMChannelId("00000000-0000-0000-0000-000000000101")
_CHANNEL_TWO = IMChannelId("00000000-0000-0000-0000-000000000102")
_TENANT_ONE = TenantId("00000000-0000-0000-0000-000000000201")
_TENANT_TWO = TenantId("00000000-0000-0000-0000-000000000202")
_CONTACT_ONE = ContactId("00000000-0000-0000-0000-000000000301")
_CONTACT_TWO = ContactId("00000000-0000-0000-0000-000000000302")
_CONTACT_THREE = ContactId("00000000-0000-0000-0000-000000000303")
_IDENTITY_ONE = IMIdentityId("00000000-0000-0000-0000-000000000401")
_IDENTITY_TWO = IMIdentityId("00000000-0000-0000-0000-000000000402")
_IDENTITY_THREE = IMIdentityId("00000000-0000-0000-0000-000000000403")
_RUN_ID = IMSyncRunId("00000000-0000-0000-0000-000000000501")
_ACCOUNT_ONE = AccountId("00000000-0000-0000-0000-000000000601")
_ACCOUNT_TWO = AccountId("00000000-0000-0000-0000-000000000602")


def _seed_identities(engine: Engine, channel_id: IMChannelId, *identity_ids: IMIdentityId) -> None:
    with Session(engine) as session, session.begin():
        repository = SQLAlchemyIMIdentityRepository(session, channel_id)
        for index, identity_id in enumerate(identity_ids, start=1):
            repository.create(
                identity_id,
                IMIdentityObservation(
                    provider_user_id=f"provider-user-{channel_id}-{index}",
                    display_name=f"User {index}",
                    email=f"user-{index}@example.com",
                    raw_payload=OpaqueProviderPayload({"index": index}),
                    sync_run_id=_RUN_ID,
                    observed_at=_NOW,
                ),
            )


def _assignment(
    contact_id: ContactId,
    identity_id: IMIdentityId,
    assigned_at: datetime = _NOW,
) -> IMBindingAssignment:
    return IMBindingAssignment(contact_id, identity_id, assigned_at)


def test_binding_values_are_owner_free_and_expected_errors_share_a_direct_root() -> None:
    binding = IMBinding(IMBindingId("binding-1"), IMBindingKind.DEFAULT, _CONTACT_ONE, _IDENTITY_ONE, _NOW, _NOW)

    assert tuple(field.name for field in fields(IMBinding)) == (
        "id",
        "kind",
        "contact_id",
        "identity_id",
        "created_at",
        "updated_at",
    )
    assert tuple(field.name for field in fields(IMBindingAssignment)) == (
        "contact_id",
        "identity_id",
        "assigned_at",
    )
    assert IMBindingRepositoryError.__bases__ == (Exception,)
    assert isinstance(hash(binding), int)


def test_default_create_is_idempotent_and_get_list_are_channel_scoped(sqlite_engine: Engine) -> None:
    _seed_identities(sqlite_engine, _CHANNEL_ONE, _IDENTITY_ONE)
    _seed_identities(sqlite_engine, _CHANNEL_TWO, _IDENTITY_TWO)

    with Session(sqlite_engine, expire_on_commit=False) as session:
        first = SQLAlchemyIMBindingRepository(session, _CHANNEL_ONE)
        created = first.create(_assignment(_CONTACT_ONE, _IDENTITY_ONE), bound_by_account_id=_ACCOUNT_ONE)
        retried = first.create(_assignment(_CONTACT_ONE, _IDENTITY_ONE, _LATER), bound_by_account_id=_ACCOUNT_TWO)

        assert retried == created
        assert created.kind is IMBindingKind.DEFAULT
        assert first.get(created.id) == created
        assert first.list_all() == (created,)
        assert SQLAlchemyIMBindingRepository(session, _CHANNEL_TWO).get(created.id) is None
        record = session.get_one(HumanInputIMBinding, str(created.id))
        assert record.channel_id == str(_CHANNEL_ONE)
        assert record.bound_by_account_id == str(_ACCOUNT_ONE)
        assert not hasattr(created, "channel_id")
        assert not hasattr(created, "bound_by_account_id")


@pytest.mark.parametrize(
    ("second_contact", "second_identity"),
    [(_CONTACT_ONE, _IDENTITY_TWO), (_CONTACT_TWO, _IDENTITY_ONE)],
)
def test_default_create_rejects_endpoint_conflicts(
    sqlite_engine: Engine,
    second_contact: ContactId,
    second_identity: IMIdentityId,
) -> None:
    _seed_identities(sqlite_engine, _CHANNEL_ONE, _IDENTITY_ONE, _IDENTITY_TWO)
    with Session(sqlite_engine) as session:
        repository = SQLAlchemyIMBindingRepository(session, _CHANNEL_ONE)
        repository.create(_assignment(_CONTACT_ONE, _IDENTITY_ONE), bound_by_account_id=None)
        with pytest.raises(IMBindingConflictError):
            repository.create(_assignment(second_contact, second_identity), bound_by_account_id=None)


@pytest.mark.parametrize("operation", ["create", "override"])
def test_writes_reject_missing_and_cross_channel_identities(sqlite_engine: Engine, operation: str) -> None:
    _seed_identities(sqlite_engine, _CHANNEL_TWO, _IDENTITY_ONE)
    with Session(sqlite_engine) as session:
        repository = SQLAlchemyIMBindingRepository(session, _CHANNEL_ONE)
        if operation == "create":
            mutation = partial(
                repository.create,
                _assignment(_CONTACT_ONE, _IDENTITY_ONE),
                bound_by_account_id=None,
            )
        else:
            mutation = partial(
                repository.set_workspace_override,
                _TENANT_ONE,
                _assignment(_CONTACT_ONE, _IDENTITY_ONE),
                bound_by_account_id=None,
            )
        with pytest.raises(IMBindingIdentityNotFoundError):
            mutation()
        assert session.scalar(sa.select(sa.func.count(HumanInputIMBinding.id))) == 0
        assert session.scalar(sa.select(sa.func.count(HumanInputIMBindingWorkspaceOverride.id))) == 0


def test_replace_and_delete_are_exact_idempotent_and_channel_scoped(sqlite_engine: Engine) -> None:
    _seed_identities(sqlite_engine, _CHANNEL_ONE, _IDENTITY_ONE, _IDENTITY_TWO)
    with Session(sqlite_engine, expire_on_commit=False) as session:
        repository = SQLAlchemyIMBindingRepository(session, _CHANNEL_ONE)
        created = repository.create(_assignment(_CONTACT_ONE, _IDENTITY_ONE), bound_by_account_id=_ACCOUNT_ONE)

        assert (
            repository.replace(
                created.id,
                expected_identity_id=_IDENTITY_TWO,
                next_identity_id=_IDENTITY_TWO,
                bound_by_account_id=_ACCOUNT_TWO,
                updated_at=_LATER,
            )
            is None
        )
        assert (
            SQLAlchemyIMBindingRepository(session, _CHANNEL_TWO).replace(
                created.id,
                expected_identity_id=_IDENTITY_ONE,
                next_identity_id=_IDENTITY_TWO,
                bound_by_account_id=_ACCOUNT_TWO,
                updated_at=_LATER,
            )
            is None
        )
        replaced = repository.replace(
            created.id,
            expected_identity_id=_IDENTITY_ONE,
            next_identity_id=_IDENTITY_TWO,
            bound_by_account_id=_ACCOUNT_TWO,
            updated_at=_LATER,
        )
        assert replaced == IMBinding(
            created.id,
            IMBindingKind.DEFAULT,
            _CONTACT_ONE,
            _IDENTITY_TWO,
            _NOW,
            _LATER,
        )

        repository.delete(created.id, expected_identity_id=_IDENTITY_ONE)
        assert repository.get(created.id) == replaced
        SQLAlchemyIMBindingRepository(session, _CHANNEL_TWO).delete(
            created.id,
            expected_identity_id=_IDENTITY_TWO,
        )
        assert repository.get(created.id) == replaced
        assert repository.delete(created.id, expected_identity_id=_IDENTITY_TWO) is None
        assert repository.delete(created.id, expected_identity_id=_IDENTITY_TWO) is None
        assert repository.get(created.id) is None


def test_workspace_overrides_preserve_identity_and_timestamp_and_support_one_repository_across_tenants(
    sqlite_engine: Engine,
) -> None:
    _seed_identities(sqlite_engine, _CHANNEL_ONE, _IDENTITY_ONE, _IDENTITY_TWO, _IDENTITY_THREE)
    with Session(sqlite_engine, expire_on_commit=False) as session:
        repository = SQLAlchemyIMBindingRepository(session, _CHANNEL_ONE)
        default = repository.create(_assignment(_CONTACT_ONE, _IDENTITY_ONE), bound_by_account_id=None)
        first_override = repository.set_workspace_override(
            _TENANT_ONE,
            _assignment(_CONTACT_TWO, _IDENTITY_ONE),
            bound_by_account_id=_ACCOUNT_ONE,
        )
        other_workspace = repository.set_workspace_override(
            _TENANT_TWO,
            _assignment(_CONTACT_THREE, _IDENTITY_ONE),
            bound_by_account_id=_ACCOUNT_TWO,
        )
        replaced_override = repository.set_workspace_override(
            _TENANT_ONE,
            _assignment(_CONTACT_TWO, _IDENTITY_TWO, _LATER),
            bound_by_account_id=_ACCOUNT_TWO,
        )

        assert default.identity_id == first_override.identity_id == other_workspace.identity_id
        assert first_override.kind is IMBindingKind.WORKSPACE_OVERRIDE
        assert other_workspace.kind is IMBindingKind.WORKSPACE_OVERRIDE
        assert replaced_override.id == first_override.id
        assert replaced_override.created_at == first_override.created_at == _NOW
        assert replaced_override.updated_at == _LATER
        assert replaced_override.identity_id == _IDENTITY_TWO
        stored = session.get_one(HumanInputIMBindingWorkspaceOverride, str(first_override.id))
        assert stored.bound_by_account_id == str(_ACCOUNT_TWO)


def test_workspace_override_conflicts_only_within_the_target_workspace(sqlite_engine: Engine) -> None:
    _seed_identities(sqlite_engine, _CHANNEL_ONE, _IDENTITY_ONE)
    with Session(sqlite_engine) as session:
        repository = SQLAlchemyIMBindingRepository(session, _CHANNEL_ONE)
        repository.set_workspace_override(
            _TENANT_ONE,
            _assignment(_CONTACT_ONE, _IDENTITY_ONE),
            bound_by_account_id=None,
        )
        with pytest.raises(IMBindingConflictError):
            repository.set_workspace_override(
                _TENANT_ONE,
                _assignment(_CONTACT_TWO, _IDENTITY_ONE),
                bound_by_account_id=None,
            )
        second_workspace = repository.set_workspace_override(
            _TENANT_TWO,
            _assignment(_CONTACT_TWO, _IDENTITY_ONE),
            bound_by_account_id=None,
        )
        assert second_workspace.contact_id == _CONTACT_TWO


def test_effective_reads_apply_override_first_precedence_and_preserve_request_order(sqlite_engine: Engine) -> None:
    _seed_identities(sqlite_engine, _CHANNEL_ONE, _IDENTITY_ONE, _IDENTITY_TWO, _IDENTITY_THREE)
    with Session(sqlite_engine, expire_on_commit=False) as session:
        repository = SQLAlchemyIMBindingRepository(session, _CHANNEL_ONE)
        first_default = repository.create(_assignment(_CONTACT_ONE, _IDENTITY_ONE), bound_by_account_id=None)
        second_default = repository.create(_assignment(_CONTACT_TWO, _IDENTITY_TWO), bound_by_account_id=None)
        override = repository.set_workspace_override(
            _TENANT_ONE,
            _assignment(_CONTACT_ONE, _IDENTITY_THREE),
            bound_by_account_id=None,
        )

        assert repository.get_effective(_TENANT_ONE, _CONTACT_ONE) == override
        assert repository.get_effective(_TENANT_TWO, _CONTACT_ONE) == first_default
        assert repository.get_effective(_TENANT_ONE, _CONTACT_THREE) is None
        assert repository.get_effective_many(
            _TENANT_ONE,
            (_CONTACT_TWO, _CONTACT_ONE, _CONTACT_TWO, _CONTACT_THREE),
        ) == (second_default, override)

        reset = repository.reset_workspace_override(_TENANT_ONE, _CONTACT_ONE)
        assert reset == override
        assert repository.get_effective(_TENANT_ONE, _CONTACT_ONE) == first_default
        assert repository.reset_workspace_override(_TENANT_ONE, _CONTACT_ONE) is None


def test_caller_rollback_removes_the_complete_flushed_write_set(sqlite_engine: Engine) -> None:
    _seed_identities(sqlite_engine, _CHANNEL_ONE, _IDENTITY_ONE, _IDENTITY_TWO)
    with Session(sqlite_engine) as session:
        repository = SQLAlchemyIMBindingRepository(session, _CHANNEL_ONE)
        repository.create(_assignment(_CONTACT_ONE, _IDENTITY_ONE), bound_by_account_id=None)
        repository.set_workspace_override(
            _TENANT_ONE,
            _assignment(_CONTACT_TWO, _IDENTITY_TWO),
            bound_by_account_id=None,
        )
        assert session.scalar(sa.select(sa.func.count(HumanInputIMBinding.id))) == 1
        assert session.scalar(sa.select(sa.func.count(HumanInputIMBindingWorkspaceOverride.id))) == 1
        session.rollback()

    with Session(sqlite_engine) as session:
        assert session.scalar(sa.select(sa.func.count(HumanInputIMBinding.id))) == 0
        assert session.scalar(sa.select(sa.func.count(HumanInputIMBindingWorkspaceOverride.id))) == 0
