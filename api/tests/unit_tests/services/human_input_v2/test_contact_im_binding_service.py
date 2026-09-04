"""SQLite behavior tests for Channel-bound manual IM Binding commands."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

import pytest
import sqlalchemy as sa
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from core.human_input_v2.entities import HumanInputContactType, IMBindingScope, IMProvider
from core.human_input_v2.im_integration import IMBindingCommandError, IMBindingCommandErrorCode
from core.human_input_v2.shared import (
    AccountId,
    ContactId,
    DirectoryScope,
    IMBindingId,
    IMIdentityId,
    IMSyncRunId,
    TenantId,
    WorkspaceScope,
)
from models.account import Account, AccountStatus
from models.human_input_v2 import (
    ContactSubjectType,
    HumanInputContactIdentity,
    HumanInputIMBinding,
    HumanInputIMBindingWorkspaceOverride,
    HumanInputPlatformContactWorkspaceEntry,
    IMEncryptedCredentials,
)
from repositories.human_input_v2.im_channel_repository import (
    IMChannel,
    IMChannelId,
    IMChannelStatus,
    WebhookId,
)
from repositories.human_input_v2.im_identity_repository import IMIdentityObservation, OpaqueProviderPayload
from repositories.human_input_v2.sqlalchemy_im_identity_repository import SQLAlchemyIMIdentityRepository
from services.human_input_v2.im_contact_sync.binding_service import ContactIMBindingService

_NOW = datetime(2026, 8, 11, 8)
_TENANT_ID = TenantId("00000000-0000-0000-0000-000000000101")
_CONTACT_ID = ContactId("00000000-0000-0000-0000-000000000201")
_OTHER_CONTACT_ID = ContactId("00000000-0000-0000-0000-000000000202")
_CHANNEL_ID = IMChannelId("00000000-0000-0000-0000-000000000301")
_OTHER_CHANNEL_ID = IMChannelId("00000000-0000-0000-0000-000000000302")
_IDENTITY_ID = IMIdentityId("00000000-0000-0000-0000-000000000401")
_OTHER_IDENTITY_ID = IMIdentityId("00000000-0000-0000-0000-000000000402")
_ACCOUNT_ID = AccountId("00000000-0000-0000-0000-000000000501")
_OTHER_ACCOUNT_ID = AccountId("00000000-0000-0000-0000-000000000502")
_OWNER_SCOPE = WorkspaceScope(id=_TENANT_ID)


def _channel(channel_id: IMChannelId = _CHANNEL_ID) -> IMChannel:
    return IMChannel(
        id=channel_id,
        created_at=_NOW,
        updated_at=_NOW,
        provider=IMProvider.FEISHU,
        provider_tenant_id="provider-tenant-1",
        encrypted_credentials=IMEncryptedCredentials(ciphertext="opaque-ciphertext"),
        app_identifier="app-1",
        webhook_id=WebhookId("00000000000000000000000000000001"),
        config_version=1,
        status=IMChannelStatus.CONNECTED,
    )


def _observation(provider_user_id: str) -> IMIdentityObservation:
    return IMIdentityObservation(
        provider_user_id=provider_user_id,
        display_name="Reviewer",
        email="reviewer@example.com",
        raw_payload=OpaqueProviderPayload({}),
        sync_run_id=IMSyncRunId("00000000-0000-0000-0000-000000000601"),
        observed_at=_NOW,
    )


@dataclass(frozen=True)
class _BindingContext:
    sessions: sessionmaker[Session]
    service: ContactIMBindingService


@pytest.fixture
def binding_context(sqlite_engine: Engine) -> _BindingContext:
    sessions = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    account = Account(name="Reviewer", email="reviewer@example.com", status=AccountStatus.ACTIVE)
    account.id = str(_ACCOUNT_ID)
    contact_identity = HumanInputContactIdentity(
        subject_type=ContactSubjectType.ACCOUNT,
        account_id=account.id,
    )
    contact_identity.id = str(_CONTACT_ID)
    contact_identity.created_at = _NOW
    contact_identity.updated_at = _NOW
    platform_entry = HumanInputPlatformContactWorkspaceEntry(
        tenant_id=str(_TENANT_ID),
        contact_id=str(_CONTACT_ID),
        added_by_account_id=str(_ACCOUNT_ID),
    )
    platform_entry.id = "00000000-0000-0000-0000-000000000701"
    with sessions.begin() as session:
        session.add_all([account, contact_identity, platform_entry])
        SQLAlchemyIMIdentityRepository(session, _CHANNEL_ID).create(_IDENTITY_ID, _observation("provider-user-1"))
        SQLAlchemyIMIdentityRepository(session, _CHANNEL_ID).create(
            _OTHER_IDENTITY_ID,
            _observation("provider-user-2"),
        )
        SQLAlchemyIMIdentityRepository(session, _OTHER_CHANNEL_ID).create(
            IMIdentityId("00000000-0000-0000-0000-000000000499"),
            _observation("foreign-provider-user"),
        )

    def resolve_channel(_session: Session, owner_scope: DirectoryScope) -> IMChannel:
        assert owner_scope == _OWNER_SCOPE
        return _channel()

    return _BindingContext(
        sessions=sessions,
        service=ContactIMBindingService(sessions, resolve_channel, clock=lambda: _NOW),
    )


def test_default_create_and_delete_preserve_contact_projection_and_actor_metadata(
    binding_context: _BindingContext,
) -> None:
    contact = binding_context.service.create_organization_binding(
        organization_scope=_OWNER_SCOPE,
        tenant_id=_TENANT_ID,
        contact_id=_CONTACT_ID,
        identity_id=_IDENTITY_ID,
        bound_by_account_id=_ACCOUNT_ID,
    )

    assert contact.id == _CONTACT_ID
    assert contact.type is HumanInputContactType.PLATFORM
    assert contact.name == "Reviewer"
    assert contact.email == "reviewer@example.com"
    assert len(contact.im_bindings) == 1
    binding = contact.im_bindings[0]
    assert binding.scope is IMBindingScope.ORGANIZATION
    assert binding.contact_id == _CONTACT_ID
    assert binding.identity_id == _IDENTITY_ID
    assert binding.provider is IMProvider.FEISHU
    with binding_context.sessions() as session:
        record = session.get_one(HumanInputIMBinding, str(binding.id))
        assert record.channel_id == str(_CHANNEL_ID)
        assert record.bound_by_account_id == str(_ACCOUNT_ID)

    binding_context.service.delete_organization_binding(
        organization_scope=_OWNER_SCOPE,
        contact_id=_CONTACT_ID,
        binding_id=binding.id,
    )
    with binding_context.sessions() as session:
        assert session.scalar(sa.select(sa.func.count(HumanInputIMBinding.id))) == 0


def test_workspace_override_reuses_one_service_across_mutations_and_reset_falls_back_to_default(
    binding_context: _BindingContext,
) -> None:
    default_view = binding_context.service.create_organization_binding(
        organization_scope=_OWNER_SCOPE,
        tenant_id=_TENANT_ID,
        contact_id=_CONTACT_ID,
        identity_id=_IDENTITY_ID,
        bound_by_account_id=_ACCOUNT_ID,
    )
    default_binding = default_view.im_bindings[0]
    override_view = binding_context.service.set_workspace_override(
        organization_scope=_OWNER_SCOPE,
        tenant_id=_TENANT_ID,
        contact_id=_CONTACT_ID,
        identity_id=_OTHER_IDENTITY_ID,
        bound_by_account_id=_ACCOUNT_ID,
    )
    replaced_view = binding_context.service.set_workspace_override(
        organization_scope=_OWNER_SCOPE,
        tenant_id=_TENANT_ID,
        contact_id=_CONTACT_ID,
        identity_id=_OTHER_IDENTITY_ID,
        bound_by_account_id=_OTHER_ACCOUNT_ID,
    )

    override_binding = override_view.im_bindings[0]
    assert override_binding.scope is IMBindingScope.WORKSPACE
    assert override_binding.identity_id == _OTHER_IDENTITY_ID
    assert replaced_view.im_bindings[0].id == override_binding.id
    with binding_context.sessions() as session:
        override_record = session.get_one(HumanInputIMBindingWorkspaceOverride, str(override_binding.id))
        assert override_record.bound_by_account_id == str(_OTHER_ACCOUNT_ID)

    reset_view = binding_context.service.reset_workspace_override(
        organization_scope=_OWNER_SCOPE,
        tenant_id=_TENANT_ID,
        contact_id=_CONTACT_ID,
    )
    assert reset_view.im_bindings == (default_binding,)
    with binding_context.sessions() as session:
        assert session.scalar(sa.select(sa.func.count(HumanInputIMBinding.id))) == 1
        assert session.scalar(sa.select(sa.func.count(HumanInputIMBindingWorkspaceOverride.id))) == 0


def test_missing_or_foreign_identity_maps_to_stable_error_without_partial_binding(
    binding_context: _BindingContext,
) -> None:
    with pytest.raises(IMBindingCommandError) as error_info:
        binding_context.service.create_organization_binding(
            organization_scope=_OWNER_SCOPE,
            tenant_id=_TENANT_ID,
            contact_id=_CONTACT_ID,
            identity_id=IMIdentityId("00000000-0000-0000-0000-000000000499"),
            bound_by_account_id=None,
        )

    assert error_info.value.code is IMBindingCommandErrorCode.IDENTITY_NOT_FOUND
    with binding_context.sessions() as session:
        assert session.scalar(sa.select(sa.func.count(HumanInputIMBinding.id))) == 0


def test_contact_boundary_and_exact_delete_errors_are_stable(binding_context: _BindingContext) -> None:
    with pytest.raises(IMBindingCommandError) as missing_contact:
        binding_context.service.set_workspace_override(
            organization_scope=_OWNER_SCOPE,
            tenant_id=_TENANT_ID,
            contact_id=_OTHER_CONTACT_ID,
            identity_id=_IDENTITY_ID,
            bound_by_account_id=None,
        )
    assert missing_contact.value.code is IMBindingCommandErrorCode.CONTACT_NOT_FOUND

    with pytest.raises(IMBindingCommandError) as missing_binding:
        binding_context.service.delete_organization_binding(
            organization_scope=_OWNER_SCOPE,
            contact_id=_CONTACT_ID,
            binding_id=IMBindingId("00000000-0000-0000-0000-000000000999"),
        )
    assert missing_binding.value.code is IMBindingCommandErrorCode.BINDING_NOT_FOUND


def test_missing_channel_maps_to_not_configured_before_mutation(binding_context: _BindingContext) -> None:
    service = ContactIMBindingService(binding_context.sessions, lambda _session, _scope: None)

    with pytest.raises(IMBindingCommandError) as error_info:
        service.create_organization_binding(
            organization_scope=_OWNER_SCOPE,
            tenant_id=_TENANT_ID,
            contact_id=_CONTACT_ID,
            identity_id=_IDENTITY_ID,
            bound_by_account_id=None,
        )

    assert error_info.value.code is IMBindingCommandErrorCode.INTEGRATION_NOT_CONFIGURED
