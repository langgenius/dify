"""SQLite behavior tests for Channel-bound manual IM Binding commands."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, replace
from datetime import datetime
from importlib import import_module
from inspect import unwrap
from types import SimpleNamespace
from uuid import UUID

import pytest
import sqlalchemy as sa
from flask import Flask
from flask.typing import ResponseReturnValue
from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from controllers.console.workspace import human_input
from controllers.console.workspace.human_input import WorkspaceContactIMBindingsApi
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
from repositories.human_input_v2.contact import ExternalContact, IMBinding
from repositories.human_input_v2.im_binding_repository import IMBindingAssignment
from repositories.human_input_v2.im_channel_repository import (
    IMChannel,
    IMChannelId,
    IMChannelStatus,
    WebhookId,
)
from repositories.human_input_v2.im_identity_repository import IMIdentityObservation, OpaqueProviderPayload
from repositories.human_input_v2.sqlalchemy_contact_repository import (
    SQLAlchemyContactIMBindingRepository,
    SQLAlchemyContactRepository,
)
from repositories.human_input_v2.sqlalchemy_im_binding_repository import SQLAlchemyIMBindingRepository
from repositories.human_input_v2.sqlalchemy_im_identity_repository import SQLAlchemyIMIdentityRepository
from services.human_input_v2.contact_service import ContactManagementService
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
    contact = binding_context.service.set_organization_binding(
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


def test_contact_details_follow_effective_binding_and_reset(binding_context: _BindingContext) -> None:
    binding_context.service.set_organization_binding(
        organization_scope=_OWNER_SCOPE,
        tenant_id=_TENANT_ID,
        contact_id=_CONTACT_ID,
        identity_id=_IDENTITY_ID,
        bound_by_account_id=_ACCOUNT_ID,
    )
    override = binding_context.service.set_workspace_override(
        organization_scope=_OWNER_SCOPE,
        tenant_id=_TENANT_ID,
        contact_id=_CONTACT_ID,
        identity_id=_OTHER_IDENTITY_ID,
        bound_by_account_id=_ACCOUNT_ID,
    )
    with binding_context.sessions.begin() as session:
        SQLAlchemyIMIdentityRepository(session, _CHANNEL_ID).update(
            _OTHER_IDENTITY_ID,
            replace(_observation("provider-user-2"), display_name="Workspace Reviewer", email="override@example.com"),
        )

    with binding_context.sessions() as session:
        service = ContactManagementService(
            SQLAlchemyContactRepository(session),
            SQLAlchemyContactIMBindingRepository(session, _channel()),
            SQLAlchemyIMIdentityRepository(session, _CHANNEL_ID),
        )
        details = service.get_contact_details(_TENANT_ID, _CONTACT_ID)
        assert details is not None
        assert details.contact.contact.email == "reviewer@example.com"
        assert len(details.im_binding_details) == 1
        binding = details.im_binding_details[0]
        assert binding.binding.id == override.im_bindings[0].id
        assert binding.binding.scope is IMBindingScope.WORKSPACE
        assert binding.identity.id == _OTHER_IDENTITY_ID
        assert binding.identity.provider_user_id == "provider-user-2"
        assert binding.identity.display_name == "Workspace Reviewer"
        assert binding.identity.email == "override@example.com"
        assert details.contact.im_bindings == (binding.binding,)

    binding_context.service.reset_workspace_override(
        organization_scope=_OWNER_SCOPE, tenant_id=_TENANT_ID, contact_id=_CONTACT_ID
    )
    with binding_context.sessions() as session:
        service = ContactManagementService(
            SQLAlchemyContactRepository(session),
            SQLAlchemyContactIMBindingRepository(session, _channel()),
            SQLAlchemyIMIdentityRepository(session, _CHANNEL_ID),
        )
        details = service.get_contact_details(_TENANT_ID, _CONTACT_ID)
        assert details is not None
        binding = details.im_binding_details[0]
        assert binding.binding.scope is IMBindingScope.ORGANIZATION
        assert binding.identity.id == _IDENTITY_ID
        assert binding.identity.email == "reviewer@example.com"


def test_contact_details_read_identities_in_one_batch(
    binding_context: _BindingContext, monkeypatch: pytest.MonkeyPatch
) -> None:
    bindings = (
        IMBinding(IMBindingId("binding-1"), IMBindingScope.ORGANIZATION, _CONTACT_ID, _IDENTITY_ID, IMProvider.FEISHU),
        IMBinding(
            IMBindingId("binding-2"), IMBindingScope.WORKSPACE, _CONTACT_ID, _OTHER_IDENTITY_ID, IMProvider.FEISHU
        ),
    )

    def read_bindings(tenant_id: TenantId, contact_ids: Sequence[ContactId]) -> Sequence[IMBinding]:
        return bindings if tenant_id == _TENANT_ID and _CONTACT_ID in contact_ids else ()

    statements: list[str] = []

    def capture_statement(
        _connection: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        statements.append(statement)

    with binding_context.sessions() as session:
        binding_repository = SQLAlchemyContactIMBindingRepository(session, _channel())
        monkeypatch.setattr(binding_repository, "get_im_bindings", read_bindings)
        service = ContactManagementService(
            SQLAlchemyContactRepository(session),
            binding_repository,
            SQLAlchemyIMIdentityRepository(session, _CHANNEL_ID),
        )
        connection = session.connection()
        event.listen(connection, "before_cursor_execute", capture_statement)
        try:
            details = service.get_contact_details(_TENANT_ID, _CONTACT_ID)
        finally:
            event.remove(connection, "before_cursor_execute", capture_statement)

    assert details is not None
    assert tuple(detail.identity.id for detail in details.im_binding_details) == (_IDENTITY_ID, _OTHER_IDENTITY_ID)
    # One contact query and one identity query, regardless of the number of bindings.
    assert len(statements) == 2


def test_contact_details_are_workspace_and_channel_scoped(binding_context: _BindingContext) -> None:
    binding_context.service.set_organization_binding(
        organization_scope=_OWNER_SCOPE,
        tenant_id=_TENANT_ID,
        contact_id=_CONTACT_ID,
        identity_id=_IDENTITY_ID,
        bound_by_account_id=_ACCOUNT_ID,
    )
    with binding_context.sessions() as session:
        service = ContactManagementService(
            SQLAlchemyContactRepository(session),
            SQLAlchemyContactIMBindingRepository(session, _channel()),
            SQLAlchemyIMIdentityRepository(session, _CHANNEL_ID),
        )
        assert service.get_contact_details(TenantId("00000000-0000-0000-0000-000000000999"), _CONTACT_ID) is None
        assert service.get_contact_details(_TENANT_ID, _OTHER_CONTACT_ID) is None
        for channel in (None, _channel(_OTHER_CHANNEL_ID)):
            service = ContactManagementService(
                SQLAlchemyContactRepository(session),
                SQLAlchemyContactIMBindingRepository(session, channel),
                SQLAlchemyIMIdentityRepository(session, channel.id) if channel is not None else None,
            )
            details = service.get_contact_details(_TENANT_ID, _CONTACT_ID)
            assert details is not None
            assert details.im_binding_details == ()
            assert details.contact.im_bindings == ()


def test_contact_details_allow_missing_identity_profile_and_unbound_contacts(binding_context: _BindingContext) -> None:
    with binding_context.sessions.begin() as session:
        contacts = SQLAlchemyContactRepository(session)
        contacts.save_external_contact(
            _TENANT_ID, ExternalContact(_OTHER_CONTACT_ID, "External", "external@example.com", None, _NOW)
        )
        service = ContactManagementService(
            contacts,
            SQLAlchemyContactIMBindingRepository(session, _channel()),
            SQLAlchemyIMIdentityRepository(session, _CHANNEL_ID),
        )
        for contact_id in (_CONTACT_ID, _OTHER_CONTACT_ID):
            details = service.get_contact_details(_TENANT_ID, contact_id)
            assert details is not None
            assert details.im_binding_details == ()
        SQLAlchemyIMIdentityRepository(session, _CHANNEL_ID).update(
            _IDENTITY_ID, replace(_observation("provider-user-1"), display_name=None, email=None)
        )
    binding_context.service.set_organization_binding(
        organization_scope=_OWNER_SCOPE,
        tenant_id=_TENANT_ID,
        contact_id=_CONTACT_ID,
        identity_id=_IDENTITY_ID,
        bound_by_account_id=_ACCOUNT_ID,
    )
    with binding_context.sessions() as session:
        service = ContactManagementService(
            SQLAlchemyContactRepository(session),
            SQLAlchemyContactIMBindingRepository(session, _channel()),
            SQLAlchemyIMIdentityRepository(session, _CHANNEL_ID),
        )
        details = service.get_contact_details(_TENANT_ID, _CONTACT_ID)
        assert details is not None
        identity = details.im_binding_details[0].identity
        assert identity.provider_user_id == "provider-user-1"
        assert identity.display_name is None
        assert identity.email is None


def test_workspace_override_reuses_one_service_across_mutations_and_reset_falls_back_to_default(
    binding_context: _BindingContext,
) -> None:
    default_view = binding_context.service.set_organization_binding(
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


@pytest.mark.parametrize("with_override", [False, True])
def test_put_replaces_default_binding_and_retries_are_idempotent(
    binding_context: _BindingContext,
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    with_override: bool,
) -> None:
    monkeypatch.setattr(
        import_module("controllers.console.workspace.human_input"),
        "build_im_contact_sync_application",
        lambda: SimpleNamespace(binding_service=binding_context.service),
    )
    with binding_context.sessions() as session:
        account = session.get_one(Account, str(_ACCOUNT_ID))

    def put(identity_id: IMIdentityId) -> object:
        with app.test_request_context(method="PUT", json={"identity_id": str(identity_id)}):
            return unwrap(WorkspaceContactIMBindingsApi.put)(
                WorkspaceContactIMBindingsApi(), str(_TENANT_ID), account, str(_CONTACT_ID)
            )

    first = put(_IDENTITY_ID)
    assert isinstance(first, dict)
    original_id = first["contact"]["im_bindings"][0]["id"]
    override = None
    if with_override:
        override = binding_context.service.set_workspace_override(
            organization_scope=_OWNER_SCOPE,
            tenant_id=_TENANT_ID,
            contact_id=_CONTACT_ID,
            identity_id=_IDENTITY_ID,
            bound_by_account_id=_OTHER_ACCOUNT_ID,
        ).im_bindings[0]

    replacement = put(_OTHER_IDENTITY_ID)
    assert isinstance(replacement, dict)
    with binding_context.sessions() as session:
        assert session.get(HumanInputIMBinding, original_id) is None
        record = session.scalars(sa.select(HumanInputIMBinding)).one()
        assert record.im_identity_id == str(_OTHER_IDENTITY_ID)
        assert record.bound_by_account_id == str(_ACCOUNT_ID)
        new_id = record.id
        if override is not None:
            stored_override = session.get_one(HumanInputIMBindingWorkspaceOverride, str(override.id))
            assert stored_override.im_identity_id == str(_IDENTITY_ID)
            assert stored_override.bound_by_account_id == str(_OTHER_ACCOUNT_ID)
            assert replacement["contact"]["im_bindings"][0]["id"] == str(override.id)
        else:
            assert replacement["contact"]["im_bindings"][0]["id"] == new_id

    assert put(_OTHER_IDENTITY_ID) == replacement
    with binding_context.sessions() as session:
        assert session.scalars(sa.select(HumanInputIMBinding.id)).one() == new_id

    if with_override:
        reset = binding_context.service.reset_workspace_override(
            organization_scope=_OWNER_SCOPE, tenant_id=_TENANT_ID, contact_id=_CONTACT_ID
        )
        assert str(reset.im_bindings[0].id) == new_id
        assert reset.im_bindings[0].identity_id == _OTHER_IDENTITY_ID


@pytest.mark.parametrize("occupied", [False, True])
def test_failed_default_replacement_preserves_original_binding(
    binding_context: _BindingContext, occupied: bool
) -> None:
    original = binding_context.service.set_organization_binding(
        organization_scope=_OWNER_SCOPE,
        tenant_id=_TENANT_ID,
        contact_id=_CONTACT_ID,
        identity_id=_IDENTITY_ID,
        bound_by_account_id=_ACCOUNT_ID,
    ).im_bindings[0]
    next_identity_id = IMIdentityId("00000000-0000-0000-0000-000000000499")
    expected_error = IMBindingCommandErrorCode.IDENTITY_NOT_FOUND
    if occupied:
        with binding_context.sessions.begin() as session:
            SQLAlchemyIMBindingRepository(session, _CHANNEL_ID).create(
                IMBindingAssignment(_OTHER_CONTACT_ID, _OTHER_IDENTITY_ID, _NOW),
                bound_by_account_id=None,
            )
        next_identity_id = _OTHER_IDENTITY_ID
        expected_error = IMBindingCommandErrorCode.BINDING_CONFLICT

    with pytest.raises(IMBindingCommandError) as error_info:
        binding_context.service.set_organization_binding(
            organization_scope=_OWNER_SCOPE,
            tenant_id=_TENANT_ID,
            contact_id=_CONTACT_ID,
            identity_id=next_identity_id,
            bound_by_account_id=_OTHER_ACCOUNT_ID,
        )
    assert error_info.value.code is expected_error
    with binding_context.sessions() as session:
        record = session.get_one(HumanInputIMBinding, str(original.id))
        assert record.im_identity_id == str(_IDENTITY_ID)
        assert record.bound_by_account_id == str(_ACCOUNT_ID)


def test_replacement_insert_failure_rolls_back_deleted_binding(binding_context: _BindingContext) -> None:
    original = binding_context.service.set_organization_binding(
        organization_scope=_OWNER_SCOPE,
        tenant_id=_TENANT_ID,
        contact_id=_CONTACT_ID,
        identity_id=_IDENTITY_ID,
        bound_by_account_id=_ACCOUNT_ID,
    ).im_bindings[0]
    with binding_context.sessions.begin() as session:
        session.execute(
            sa.text("""
            CREATE TRIGGER reject_binding_insert BEFORE INSERT ON human_input_im_bindings
            BEGIN
                SELECT RAISE(ABORT, 'binding insert unavailable');
            END
        """)
        )

    with pytest.raises(IntegrityError, match="binding insert unavailable"):
        binding_context.service.set_organization_binding(
            organization_scope=_OWNER_SCOPE,
            tenant_id=_TENANT_ID,
            contact_id=_CONTACT_ID,
            identity_id=_OTHER_IDENTITY_ID,
            bound_by_account_id=_OTHER_ACCOUNT_ID,
        )

    with binding_context.sessions() as session:
        record = session.scalars(sa.select(HumanInputIMBinding)).one()
        assert record.id == str(original.id)
        assert record.im_identity_id == str(_IDENTITY_ID)
        assert record.bound_by_account_id == str(_ACCOUNT_ID)


def test_missing_or_foreign_identity_maps_to_stable_error_without_partial_binding(
    binding_context: _BindingContext,
) -> None:
    with pytest.raises(IMBindingCommandError) as error_info:
        binding_context.service.set_organization_binding(
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
        service.set_organization_binding(
            organization_scope=_OWNER_SCOPE,
            tenant_id=_TENANT_ID,
            contact_id=_CONTACT_ID,
            identity_id=_IDENTITY_ID,
            bound_by_account_id=None,
        )

    assert error_info.value.code is IMBindingCommandErrorCode.INTEGRATION_NOT_CONFIGURED


@pytest.mark.parametrize(
    ("contact_id", "expected_status"),
    [(_CONTACT_ID, 200), (_OTHER_CONTACT_ID, 404)],
)
def test_delete_binding_through_uuid_route(
    binding_context: _BindingContext,
    monkeypatch: pytest.MonkeyPatch,
    contact_id: ContactId,
    expected_status: int,
) -> None:
    contact = binding_context.service.set_organization_binding(
        organization_scope=_OWNER_SCOPE,
        tenant_id=_TENANT_ID,
        contact_id=_CONTACT_ID,
        identity_id=_IDENTITY_ID,
        bound_by_account_id=_ACCOUNT_ID,
    )
    binding = contact.im_bindings[0]
    monkeypatch.setattr(
        human_input,
        "build_im_contact_sync_application",
        lambda: SimpleNamespace(binding_service=binding_context.service),
    )
    app = Flask(__name__)

    @app.delete("/workspaces/current/human-input/contacts/<uuid:contact_id>/im-bindings")
    def delete_binding(contact_id: UUID) -> ResponseReturnValue:
        # Isolate authentication while retaining Flask's path conversion and the real binding service.
        return unwrap(human_input.WorkspaceContactIMBindingsApi.delete)(
            human_input.WorkspaceContactIMBindingsApi(), str(_TENANT_ID), contact_id
        )

    response = app.test_client().delete(
        f"/workspaces/current/human-input/contacts/{contact_id}/im-bindings",
        query_string={"binding_id": str(binding.id)},
    )

    assert response.status_code == expected_status
    response_body = response.get_json()
    assert response_body is not None
    with binding_context.sessions() as session:
        remaining = session.get(HumanInputIMBinding, str(binding.id))
        if expected_status == 200:
            assert response_body == {}
            assert remaining is None
        else:
            assert response_body["code"] == "im_binding_not_found"
            assert remaining is not None
