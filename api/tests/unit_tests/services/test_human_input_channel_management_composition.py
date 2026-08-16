"""Composition tests for independent Email and IM management state."""

from dataclasses import replace
from datetime import datetime

from core.human_input_v2.channel_management import (
    ChannelHandlerRegistry,
    ChannelKind,
    ChannelProvider,
    ChannelRef,
    HumanInputChannelManagementContext,
    NewSecret,
    SaveEmailChannelCommand,
    SaveIMChannelCommand,
    SlackIMCandidate,
)
from core.human_input_v2.email_channel import (
    CreateEmailConfigurationResult,
    CreateEmailConfigurationStatus,
    DeleteEmailConfigurationResult,
    DeleteEmailConfigurationStatus,
    EmailChannelConfiguration,
    NewAPIKey,
    ProtectedAPIKey,
    ResendCandidate,
    UpdateEmailConfigurationResult,
    UpdateEmailConfigurationStatus,
)
from core.human_input_v2.entities import IMIntegrationStatus, IMProvider
from core.human_input_v2.im_integration import (
    EncryptedCredentials,
    IMIntegration,
    ProviderTenantIdentity,
    StaleRevision,
)
from core.human_input_v2.shared import (
    AccountId,
    EmailProviderId,
    IntegrationId,
    NormalizedEmail,
    TenantId,
)
from services.human_input_channel_management_service import HumanInputChannelManagementService
from services.human_input_email_channel_manager import HumanInputEmailChannelManager
from services.human_input_im_channel_manager import (
    ConfirmedIMConfiguration,
    IMProviderTestResult,
    build_human_input_im_channel_handlers,
)

_NOW = datetime(2026, 7, 28, 8)
_LATER = datetime(2026, 7, 28, 9)
_CONTEXT = HumanInputChannelManagementContext(
    tenant_id=TenantId("workspace-1"),
    actor_account_id=AccountId("account-1"),
    actor_email=NormalizedEmail("operator@example.com"),
)
_EMAIL_REF = ChannelRef(ChannelKind.EMAIL, ChannelProvider.RESEND)
_SLACK_REF = ChannelRef(ChannelKind.IM, ChannelProvider.SLACK)


class EmailRepository:
    def __init__(self, current: EmailChannelConfiguration) -> None:
        self.current = current
        self.writes: list[str] = []

    def load(self, tenant_id):
        return self.current if self.current.tenant_id == tenant_id else None

    def create(self, configuration):
        del configuration
        self.writes.append("create")
        return CreateEmailConfigurationResult(CreateEmailConfigurationStatus.CONFLICT, None)

    def update(self, configuration, *, expected, now):
        self.writes.append("update")
        if self.current.snapshot != expected:
            return UpdateEmailConfigurationResult(UpdateEmailConfigurationStatus.STALE, None)
        self.current = replace(configuration, updated_at=now)
        return UpdateEmailConfigurationResult(UpdateEmailConfigurationStatus.UPDATED, self.current)

    def delete(self, tenant_id):
        self.writes.append("delete")
        if self.current.tenant_id != tenant_id:
            return DeleteEmailConfigurationResult(DeleteEmailConfigurationStatus.NOT_CONFIGURED)
        raise AssertionError("delete is not used by this test")


class EmailValidator:
    def validate(self, settings):
        del settings

    def send_test(self, settings, recipient):
        del settings, recipient


class EmailProtector:
    def protect(self, tenant_id, api_key):
        del api_key
        return ProtectedAPIKey(f"{tenant_id}:protected")

    def reveal(self, tenant_id, protected_api_key):
        del tenant_id, protected_api_key
        return "existing-key"


class IMRepository:
    def __init__(self, current: IMIntegration) -> None:
        self.current = current
        self.mutations: list[str] = []

    def load_current_integration(self, tenant_id):
        if self.current.tenant_id == tenant_id:
            return self.current
        return None

    def create_integration(self, integration, *, organization_scope):
        del integration, organization_scope
        self.mutations.append("create")
        raise AssertionError("create is not used by this test")

    def compare_and_swap_configuration(self, transition, *, organization_scope):
        del organization_scope
        self.mutations.append("update")
        if self.current.revision != transition.expected_revision:
            return StaleRevision(transition.expected_revision, self.current.revision)
        self.current = transition.integration
        return self.current

    def compare_and_swap_delete(self, deletion, *, organization_scope):
        del deletion, organization_scope
        self.mutations.append("delete")
        raise AssertionError("delete is not used by this test")


class IMProviderPort:
    def prepare(self, context, candidate, current):
        del context, candidate, current
        return ConfirmedIMConfiguration(
            provider=IMProvider.SLACK,
            provider_tenant_id="slack-workspace",
            encrypted_credentials=EncryptedCredentials.from_mapping(
                {
                    "client_id": "client",
                    "encrypted_client_secret": "cipher-2",
                    "encrypted_signing_secret": "cipher-3",
                    "encrypted_bot_token": "cipher-4",
                    "encrypted_app_token": "cipher-5",
                }
            ),
        )

    def test(self, context, candidate, current):
        del context, candidate, current
        return IMProviderTestResult(
            provider_tenant_id="slack-workspace",
            status=IMIntegrationStatus.CONNECTED,
            safe_status_reason=None,
            checked_at=_LATER,
        )


def _email_configuration() -> EmailChannelConfiguration:
    return EmailChannelConfiguration(
        id=EmailProviderId("email-1"),
        tenant_id=_CONTEXT.tenant_id,
        sender_email=NormalizedEmail("old@example.com"),
        sender_name="Old Sender",
        protected_api_key=ProtectedAPIKey("workspace-1:protected"),
        configured_by_account_id=_CONTEXT.actor_account_id,
        created_at=_NOW,
        updated_at=_NOW,
    )


def _im_integration() -> IMIntegration:
    return IMIntegration.create(
        integration_id=IntegrationId("integration-1"),
        tenant_id=_CONTEXT.tenant_id,
        provider_tenant=ProviderTenantIdentity(IMProvider.SLACK, "slack-workspace"),
        encrypted_credentials=EncryptedCredentials.from_mapping(
            {
                "client_id": "client",
                "encrypted_client_secret": "cipher-1",
                "encrypted_signing_secret": "cipher-1",
                "encrypted_bot_token": "cipher-1",
                "encrypted_app_token": "cipher-1",
            }
        ),
        configured_by_account_id=_CONTEXT.actor_account_id,
        callback_url=None,
        now=_NOW,
    )


def test_real_email_and_im_managers_coexist_and_mutate_independently() -> None:
    email_repository = EmailRepository(_email_configuration())
    im_repository = IMRepository(_im_integration())
    email_manager = HumanInputEmailChannelManager(
        email_repository,
        EmailValidator(),
        EmailProtector(),
        clock=lambda: _LATER,
    )
    im_handlers = build_human_input_im_channel_handlers(
        im_repository,
        IMProviderPort(),
        clock=lambda: _LATER,
    )
    service = HumanInputChannelManagementService(ChannelHandlerRegistry((email_manager, *im_handlers)))

    listed = service.list_channels(_CONTEXT)

    assert {view.ref for view in listed.channels if view.configured} == {_EMAIL_REF, _SLACK_REF}

    original_im = im_repository.current
    email_result = service.save_channel(
        _CONTEXT,
        SaveEmailChannelCommand(
            _EMAIL_REF,
            ResendCandidate(
                NormalizedEmail("new@example.com"),
                "New Sender",
                NewAPIKey("new-email-key"),
            ),
        ),
    )

    assert email_result.view is not None
    assert email_repository.writes == ["update"]
    assert im_repository.current == original_im
    assert im_repository.mutations == []

    updated_email = email_repository.current
    im_result = service.save_channel(
        _CONTEXT,
        SaveIMChannelCommand(
            ref=_SLACK_REF,
            candidate=SlackIMCandidate(
                client_id="client",
                client_secret=NewSecret("new-client-secret"),
                signing_secret=NewSecret("new-signing-secret"),
                bot_token=NewSecret("new-bot-token"),
                app_token=NewSecret("new-app-token"),
            ),
            expected_integration_id=str(original_im.id),
            expected_config_version=original_im.config_version,
        ),
    )

    assert im_result.view is not None
    assert im_repository.mutations == ["update"]
    assert email_repository.current == updated_email
    assert email_repository.writes == ["update"]
