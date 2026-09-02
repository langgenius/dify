"""Domain-facing contracts for current IM Identity and Binding persistence."""

from __future__ import annotations

import inspect
from dataclasses import FrozenInstanceError, fields
from datetime import datetime

import pytest
from pydantic import RootModel, ValidationError
from sqlalchemy.orm import Session

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
    IMBindingRepositoryError,
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
    IMIdentityRepositoryError,
    OpaqueProviderPayload,
)
from repositories.human_input_v2.sqlalchemy_im_binding_repository import SQLAlchemyIMBindingRepository
from repositories.human_input_v2.sqlalchemy_im_identity_repository import SQLAlchemyIMIdentityRepository

_NOW = datetime(2026, 9, 1, 8)
_LATER = datetime(2026, 9, 1, 9)
_CHANNEL_ID = IMChannelId("00000000-0000-0000-0000-000000000001")
_IDENTITY_ID = IMIdentityId("00000000-0000-0000-0000-000000000002")
_BINDING_ID = IMBindingId("00000000-0000-0000-0000-000000000003")
_CONTACT_ID = ContactId("00000000-0000-0000-0000-000000000004")
_SYNC_RUN_ID = IMSyncRunId("00000000-0000-0000-0000-000000000005")
_TENANT_ID = TenantId("00000000-0000-0000-0000-000000000006")
_ACCOUNT_ID = AccountId("00000000-0000-0000-0000-000000000007")


def _identity() -> IMIdentity:
    return IMIdentity(
        id=_IDENTITY_ID,
        provider_user_id="provider-user-1",
        display_name="Reviewer",
        email="reviewer@example.com",
        last_seen_sync_run_id=_SYNC_RUN_ID,
        last_seen_at=_NOW,
        created_at=_NOW,
        updated_at=_LATER,
    )


def _assignment() -> IMBindingAssignment:
    return IMBindingAssignment(
        new_binding_id=_BINDING_ID,
        contact_id=_CONTACT_ID,
        identity_id=_IDENTITY_ID,
        assigned_at=_NOW,
    )


def _public_methods(protocol: type[object]) -> set[str]:
    return {name for name, value in protocol.__dict__.items() if not name.startswith("_") and inspect.isfunction(value)}


def test_identity_values_are_owner_free_frozen_and_slotted() -> None:
    identity = _identity()
    payload = OpaqueProviderPayload({"provider": {"id": "provider-user-1"}})
    observation = IMIdentityObservation(
        provider_user_id="provider-user-1",
        display_name="Reviewer",
        email="reviewer@example.com",
        raw_payload=payload,
        sync_run_id=_SYNC_RUN_ID,
        observed_at=_NOW,
    )
    page = IMIdentityPage(items=(identity,), page=1, limit=20, total=1)

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
    assert tuple(field.name for field in fields(IMIdentityObservation)) == (
        "provider_user_id",
        "display_name",
        "email",
        "raw_payload",
        "sync_run_id",
        "observed_at",
    )
    assert tuple(field.name for field in fields(IMIdentityPage)) == ("items", "page", "limit", "total")
    assert page.items == (identity,)
    assert not hasattr(identity, "__dict__")
    assert not hasattr(observation, "__dict__")
    assert not hasattr(page, "__dict__")

    frozen_attribute = "display_name"
    with pytest.raises(FrozenInstanceError):
        setattr(identity, frozen_attribute, "Changed")
    frozen_attribute = "email"
    with pytest.raises(FrozenInstanceError):
        setattr(observation, frozen_attribute, "changed@example.com")
    frozen_attribute = "total"
    with pytest.raises(FrozenInstanceError):
        setattr(page, frozen_attribute, 2)


def test_opaque_provider_payload_is_a_frozen_strict_json_object_root_model() -> None:
    payload = OpaqueProviderPayload({"provider": {"id": "provider-user-1"}, "roles": ["reviewer"]})

    assert isinstance(payload, RootModel)
    assert payload.root == {
        "provider": {"id": "provider-user-1"},
        "roles": ["reviewer"],
    }
    assert payload.model_config["frozen"] is True
    assert payload.model_config["strict"] is True
    assert payload.model_config["validate_default"] is True
    frozen_attribute = "root"
    with pytest.raises(ValidationError, match="frozen"):
        setattr(payload, frozen_attribute, {})
    with pytest.raises(ValidationError):
        OpaqueProviderPayload(["not", "an", "object"])


def test_binding_values_are_owner_free_frozen_and_distinguish_persistence_kind() -> None:
    assignment = _assignment()
    default_binding = IMBinding(
        id=_BINDING_ID,
        kind=IMBindingKind.DEFAULT,
        contact_id=_CONTACT_ID,
        identity_id=_IDENTITY_ID,
        created_at=_NOW,
        updated_at=_LATER,
    )
    override_binding = IMBinding(
        id=_BINDING_ID,
        kind=IMBindingKind.WORKSPACE_OVERRIDE,
        contact_id=_CONTACT_ID,
        identity_id=_IDENTITY_ID,
        created_at=_NOW,
        updated_at=_LATER,
    )

    assert [(kind.name, kind.value) for kind in IMBindingKind] == [
        ("DEFAULT", "default"),
        ("WORKSPACE_OVERRIDE", "workspace_override"),
    ]
    assert tuple(field.name for field in fields(IMBinding)) == (
        "id",
        "kind",
        "contact_id",
        "identity_id",
        "created_at",
        "updated_at",
    )
    assert tuple(field.name for field in fields(IMBindingAssignment)) == (
        "new_binding_id",
        "contact_id",
        "identity_id",
        "assigned_at",
    )
    assert default_binding != override_binding
    assert not hasattr(default_binding, "__dict__")
    assert not hasattr(assignment, "__dict__")

    frozen_attribute = "identity_id"
    with pytest.raises(FrozenInstanceError):
        setattr(default_binding, frozen_attribute, IMIdentityId("00000000-0000-0000-0000-000000000008"))
    frozen_attribute = "contact_id"
    with pytest.raises(FrozenInstanceError):
        setattr(assignment, frozen_attribute, ContactId("00000000-0000-0000-0000-000000000009"))


def test_repository_error_roots_and_expected_failures_have_stable_hierarchies() -> None:
    assert IMIdentityRepositoryError.__bases__ == (Exception,)
    assert IMBindingRepositoryError.__bases__ == (Exception,)
    assert IMIdentityAlreadyExistsError.__bases__ == (IMIdentityRepositoryError,)
    assert IMIdentityNotFoundError.__bases__ == (IMIdentityRepositoryError,)
    assert IMIdentityInUseError.__bases__ == (IMIdentityRepositoryError,)
    assert IMBindingConflictError.__bases__ == (IMBindingRepositoryError,)
    assert IMBindingIdentityNotFoundError.__bases__ == (IMBindingRepositoryError,)
    assert StaleIMBindingWriteError.__bases__ == (IMBindingRepositoryError,)


def test_identity_repository_exposes_only_channel_bound_operations() -> None:
    assert _public_methods(IMIdentityRepository) == {
        "get",
        "get_by_provider_user_id",
        "list_all",
        "search",
        "create",
        "update",
        "delete",
    }
    assert tuple(inspect.signature(IMIdentityRepository.get).parameters) == ("self", "identity_id")
    assert tuple(inspect.signature(IMIdentityRepository.get_by_provider_user_id).parameters) == (
        "self",
        "provider_user_id",
    )
    assert tuple(inspect.signature(IMIdentityRepository.list_all).parameters) == ("self",)
    assert tuple(inspect.signature(IMIdentityRepository.search).parameters) == (
        "self",
        "keyword",
        "page",
        "limit",
    )
    assert tuple(inspect.signature(IMIdentityRepository.create).parameters) == (
        "self",
        "identity_id",
        "observation",
    )
    assert tuple(inspect.signature(IMIdentityRepository.update).parameters) == (
        "self",
        "identity_id",
        "observation",
    )
    assert tuple(inspect.signature(IMIdentityRepository.delete).parameters) == ("self", "identity_id")


def test_binding_repository_exposes_default_override_and_effective_operations() -> None:
    assert _public_methods(IMBindingRepository) == {
        "get",
        "list_all",
        "create",
        "replace",
        "delete",
        "set_workspace_override",
        "reset_workspace_override",
        "get_effective",
        "get_effective_many",
    }
    expected_parameters = {
        "get": ("self", "binding_id"),
        "list_all": ("self",),
        "create": ("self", "assignment", "bound_by_account_id"),
        "replace": (
            "self",
            "binding_id",
            "expected_identity_id",
            "next_identity_id",
            "bound_by_account_id",
            "updated_at",
        ),
        "delete": ("self", "binding_id", "expected_identity_id"),
        "set_workspace_override": ("self", "tenant_id", "assignment", "bound_by_account_id"),
        "reset_workspace_override": ("self", "tenant_id", "contact_id"),
        "get_effective": ("self", "tenant_id", "contact_id"),
        "get_effective_many": ("self", "tenant_id", "contact_ids"),
    }
    for method_name, parameter_names in expected_parameters.items():
        method = getattr(IMBindingRepository, method_name)
        assert tuple(inspect.signature(method).parameters) == parameter_names

    for method_name in ("create", "replace", "set_workspace_override"):
        signature = inspect.signature(getattr(IMBindingRepository, method_name))
        assert signature.parameters["bound_by_account_id"].kind is inspect.Parameter.KEYWORD_ONLY


def test_sqlalchemy_adapters_are_constructor_complete_and_intentionally_unimplemented() -> None:
    assert tuple(inspect.signature(SQLAlchemyIMIdentityRepository).parameters) == ("session", "channel_id")
    assert tuple(inspect.signature(SQLAlchemyIMBindingRepository).parameters) == ("session", "channel_id")
    session = Session()
    identity_repository = SQLAlchemyIMIdentityRepository(session, _CHANNEL_ID)
    binding_repository = SQLAlchemyIMBindingRepository(session, _CHANNEL_ID)

    with pytest.raises(NotImplementedError):
        identity_repository.get(_IDENTITY_ID)
    with pytest.raises(NotImplementedError):
        binding_repository.set_workspace_override(
            _TENANT_ID,
            _assignment(),
            bound_by_account_id=_ACCOUNT_ID,
        )
    with pytest.raises(NotImplementedError):
        binding_repository.get_effective(
            TenantId("00000000-0000-0000-0000-000000000010"),
            _CONTACT_ID,
        )

    assert not session.in_transaction()
    session.close()
