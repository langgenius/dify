"""Behavioral contracts for Channel-bound current IM Identity persistence."""

from __future__ import annotations

from dataclasses import fields
from datetime import datetime

import pytest
import sqlalchemy as sa
from pydantic import ValidationError
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from core.human_input_v2.shared import IMIdentityId, IMSyncRunId
from models.human_input_v2 import (
    HumanInputIMBinding,
    HumanInputIMBindingWorkspaceOverride,
    HumanInputIMIdentity,
)
from repositories.human_input_v2.im_channel_repository import IMChannelId
from repositories.human_input_v2.im_identity_repository import (
    IMIdentity,
    IMIdentityAlreadyExistsError,
    IMIdentityInUseError,
    IMIdentityNotFoundError,
    IMIdentityObservation,
    IMIdentityRepositoryError,
    OpaqueProviderPayload,
)
from repositories.human_input_v2.sqlalchemy_im_identity_repository import SQLAlchemyIMIdentityRepository

_NOW = datetime(2026, 9, 1, 8)
_LATER = datetime(2026, 9, 1, 9)
_CHANNEL_ONE = IMChannelId("00000000-0000-0000-0000-000000000101")
_CHANNEL_TWO = IMChannelId("00000000-0000-0000-0000-000000000102")
_IDENTITY_ONE = IMIdentityId("00000000-0000-0000-0000-000000000201")
_IDENTITY_TWO = IMIdentityId("00000000-0000-0000-0000-000000000202")
_RUN_ONE = IMSyncRunId("00000000-0000-0000-0000-000000000301")
_RUN_TWO = IMSyncRunId("00000000-0000-0000-0000-000000000302")


def _observation(
    provider_user_id: str,
    *,
    display_name: str | None = " Alice Example ",
    email: str | None = " Alice@Example.COM ",
    sync_run_id: IMSyncRunId = _RUN_ONE,
    observed_at: datetime = _NOW,
) -> IMIdentityObservation:
    return IMIdentityObservation(
        provider_user_id=provider_user_id,
        display_name=display_name,
        email=email,
        raw_payload=OpaqueProviderPayload({"provider_user_id": provider_user_id, "active": True}),
        sync_run_id=sync_run_id,
        observed_at=observed_at,
    )


def _create_committed_identity(
    engine: Engine,
    channel_id: IMChannelId,
    identity_id: IMIdentityId,
    provider_user_id: str,
) -> IMIdentity:
    with Session(engine, expire_on_commit=False) as session, session.begin():
        return SQLAlchemyIMIdentityRepository(session, channel_id).create(
            identity_id,
            _observation(provider_user_id),
        )


def test_identity_value_and_payload_are_owner_free_immutable_contracts() -> None:
    identity = IMIdentity(
        id=_IDENTITY_ONE,
        provider_user_id="provider-user-1",
        display_name="Alice",
        email="alice@example.com",
        last_seen_sync_run_id=_RUN_ONE,
        last_seen_at=_NOW,
        created_at=_NOW,
        updated_at=_NOW,
    )

    assert tuple(field.name for field in fields(IMIdentity)) == (
        "id",
        "provider_user_id",
        "display_name",
        "email",
        "last_seen_sync_run_id",
        "last_seen_at",
        "created_at",
        "updated_at",
    )
    assert IMIdentityRepositoryError.__bases__ == (Exception,)
    assert OpaqueProviderPayload.model_config == {
        "frozen": True,
        "strict": True,
        "validate_default": True,
    }
    assert isinstance(hash(identity), int)
    with pytest.raises(ValidationError):
        OpaqueProviderPayload.model_validate(["not", "an", "object"])


def test_create_canonicalizes_query_facts_and_maps_only_safe_current_values(sqlite_engine: Engine) -> None:
    with Session(sqlite_engine, expire_on_commit=False) as session:
        repository = SQLAlchemyIMIdentityRepository(session, _CHANNEL_ONE)
        created = repository.create(_IDENTITY_ONE, _observation("  Provider-User-1  "))
        record = session.get_one(HumanInputIMIdentity, str(_IDENTITY_ONE))

        assert created == IMIdentity(
            id=_IDENTITY_ONE,
            provider_user_id="Provider-User-1",
            display_name="Alice Example",
            email="Alice@Example.COM",
            last_seen_sync_run_id=_RUN_ONE,
            last_seen_at=_NOW,
            created_at=_NOW,
            updated_at=_NOW,
        )
        assert record.channel_id == str(_CHANNEL_ONE)
        assert record.normalized_name == "alice example"
        assert record.normalized_email == "alice@example.com"
        assert record.raw_payload.root == {"provider_user_id": "  Provider-User-1  ", "active": True}
        assert not hasattr(created, "channel_id")
        assert not hasattr(created, "raw_payload")


def test_blank_optional_profile_facts_are_persisted_as_null_pairs(sqlite_engine: Engine) -> None:
    with Session(sqlite_engine) as session:
        repository = SQLAlchemyIMIdentityRepository(session, _CHANNEL_ONE)
        repository.create(
            _IDENTITY_ONE,
            _observation("provider-user-1", display_name=" \t ", email="\n"),
        )
        record = session.get_one(HumanInputIMIdentity, str(_IDENTITY_ONE))

        assert (record.display_name, record.normalized_name) == (None, None)
        assert (record.email, record.normalized_email) == (None, None)


def test_reads_search_and_update_are_channel_scoped(sqlite_engine: Engine) -> None:
    _create_committed_identity(sqlite_engine, _CHANNEL_ONE, _IDENTITY_ONE, "shared-user")
    _create_committed_identity(sqlite_engine, _CHANNEL_TWO, _IDENTITY_TWO, "shared-user")

    with Session(sqlite_engine, expire_on_commit=False) as session:
        first = SQLAlchemyIMIdentityRepository(session, _CHANNEL_ONE)
        second = SQLAlchemyIMIdentityRepository(session, _CHANNEL_TWO)

        assert first.get(_IDENTITY_TWO) is None
        assert first.get_by_provider_user_id(" shared-user ") == first.get(_IDENTITY_ONE)
        assert first.list_all() == (first.get(_IDENTITY_ONE),)
        assert first.search(keyword="ALICE", page=1, limit=20).items == (first.get(_IDENTITY_ONE),)
        assert first.search(keyword="shared-USER", page=1, limit=20).total == 1
        assert second.search(keyword="alice@example.com", page=1, limit=20).total == 1

        with pytest.raises(IMIdentityNotFoundError):
            first.update(_IDENTITY_TWO, _observation("shared-user", observed_at=_LATER))

        updated = first.update(
            _IDENTITY_ONE,
            _observation(
                "ignored-new-provider-id",
                display_name=" Updated Name ",
                email=" UPDATED@EXAMPLE.COM ",
                sync_run_id=_RUN_TWO,
                observed_at=_LATER,
            ),
        )
        assert updated.provider_user_id == "shared-user"
        assert updated.display_name == "Updated Name"
        assert updated.email == "UPDATED@EXAMPLE.COM"
        assert updated.last_seen_sync_run_id == _RUN_TWO
        assert updated.created_at == _NOW
        assert updated.updated_at == _LATER


@pytest.mark.parametrize(("page", "limit"), [(0, 1), (-1, 1), (1, 0), (1, 101)])
def test_search_rejects_invalid_page_boundaries(sqlite_engine: Engine, page: int, limit: int) -> None:
    with Session(sqlite_engine) as session:
        with pytest.raises(ValueError):
            SQLAlchemyIMIdentityRepository(session, _CHANNEL_ONE).search(page=page, limit=limit)


def test_duplicate_provider_user_is_local_to_one_channel(sqlite_engine: Engine) -> None:
    _create_committed_identity(sqlite_engine, _CHANNEL_ONE, _IDENTITY_ONE, "shared-user")
    _create_committed_identity(sqlite_engine, _CHANNEL_TWO, _IDENTITY_TWO, "shared-user")

    with Session(sqlite_engine) as session:
        with pytest.raises(IMIdentityAlreadyExistsError):
            SQLAlchemyIMIdentityRepository(session, _CHANNEL_ONE).create(
                IMIdentityId("00000000-0000-0000-0000-000000000203"),
                _observation(" shared-user "),
            )
        session.rollback()

    with Session(sqlite_engine) as session:
        rows = session.scalars(sa.select(HumanInputIMIdentity).order_by(HumanInputIMIdentity.channel_id)).all()
        assert [(row.channel_id, row.provider_user_id) for row in rows] == [
            (str(_CHANNEL_ONE), "shared-user"),
            (str(_CHANNEL_TWO), "shared-user"),
        ]


@pytest.mark.parametrize("binding_kind", ["default", "workspace_override"])
def test_delete_rejects_an_identity_referenced_by_either_binding_table(
    sqlite_engine: Engine,
    binding_kind: str,
) -> None:
    _create_committed_identity(sqlite_engine, _CHANNEL_ONE, _IDENTITY_ONE, "provider-user-1")
    with Session(sqlite_engine) as session, session.begin():
        if binding_kind == "default":
            binding = HumanInputIMBinding(
                channel_id=str(_CHANNEL_ONE),
                contact_id="00000000-0000-0000-0000-000000000401",
                im_identity_id=str(_IDENTITY_ONE),
            )
        else:
            binding = HumanInputIMBindingWorkspaceOverride(
                channel_id=str(_CHANNEL_ONE),
                tenant_id="00000000-0000-0000-0000-000000000501",
                contact_id="00000000-0000-0000-0000-000000000401",
                im_identity_id=str(_IDENTITY_ONE),
            )
        binding.id = "00000000-0000-0000-0000-000000000601"
        session.add(binding)

    with Session(sqlite_engine) as session:
        with pytest.raises(IMIdentityInUseError):
            SQLAlchemyIMIdentityRepository(session, _CHANNEL_ONE).delete(_IDENTITY_ONE)
        assert session.get(HumanInputIMIdentity, str(_IDENTITY_ONE)) is not None


def test_delete_is_idempotent_channel_scoped_and_caller_rollback_safe(sqlite_engine: Engine) -> None:
    _create_committed_identity(sqlite_engine, _CHANNEL_TWO, _IDENTITY_ONE, "foreign-user")
    with Session(sqlite_engine) as session:
        repository = SQLAlchemyIMIdentityRepository(session, _CHANNEL_ONE)
        assert repository.delete(_IDENTITY_ONE) is None
        assert repository.delete(IMIdentityId("00000000-0000-0000-0000-000000000999")) is None
        session.rollback()

    with Session(sqlite_engine) as session:
        assert session.get(HumanInputIMIdentity, str(_IDENTITY_ONE)) is not None

    with Session(sqlite_engine) as session:
        repository = SQLAlchemyIMIdentityRepository(session, _CHANNEL_ONE)
        repository.create(_IDENTITY_TWO, _observation("rollback-user"))
        assert repository.get(_IDENTITY_TWO) is not None
        session.rollback()

    with Session(sqlite_engine) as session:
        assert session.get(HumanInputIMIdentity, str(_IDENTITY_TWO)) is None
