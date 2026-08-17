"""Resend Email handler with validation-before-write and explicit key retention."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import replace

from pydantic import NaiveDatetime

from core.helper import encrypter
from core.human_input_v2.channel_management import (
    ChannelCapability,
    ChannelFailureCategory,
    ChannelKind,
    ChannelOperationResult,
    ChannelProvider,
    ChannelRef,
    ChannelScope,
    ChannelScopeKind,
    ChannelStatus,
    ChannelTestResult,
    ChannelView,
    DeleteChannelCommand,
    HumanInputChannelManagementContext,
    ResendChannelSummary,
    ResendChannelTestSummary,
    SaveEmailChannelCommand,
    TestEmailChannelCommand,
)
from core.human_input_v2.channel_management.commands import SaveChannelCommand, TestChannelCommand
from core.human_input_v2.email_channel import (
    CreateEmailConfigurationStatus,
    DeleteEmailConfigurationStatus,
    EmailChannelConfiguration,
    EmailChannelRepository,
    EmailCredentialProtector,
    EmailProviderOperationError,
    EmailProviderValidationError,
    EmailProviderValidator,
    NewAPIKey,
    ProtectedAPIKey,
    ResendCandidate,
    ResendProviderSettings,
    RetainExistingAPIKey,
    UpdateEmailConfigurationStatus,
)
from core.human_input_v2.shared import EmailProviderId, NormalizedEmail, TenantId
from libs.datetime_utils import naive_utc_now
from libs.uuid_utils import uuidv7


class DifyEmailCredentialProtector:
    """Tenant RSA adapter implementing the Email credential protection port."""

    def protect(self, tenant_id: TenantId, api_key: str) -> ProtectedAPIKey:
        return ProtectedAPIKey(encrypter.encrypt_token(str(tenant_id), api_key))

    def reveal(self, tenant_id: TenantId, protected_api_key: ProtectedAPIKey) -> str:
        return encrypter.decrypt_token(str(tenant_id), protected_api_key.value)


class HumanInputEmailChannelManager:
    """One registered Resend handler; concrete provider I/O is injected."""

    ref = ChannelRef(ChannelKind.EMAIL, ChannelProvider.RESEND)
    capabilities = frozenset(
        (
            ChannelCapability.CONFIGURE,
            ChannelCapability.TEST,
            ChannelCapability.DELETE,
            ChannelCapability.SECRET_RETENTION,
        )
    )

    def __init__(
        self,
        repository: EmailChannelRepository,
        validator: EmailProviderValidator,
        protector: EmailCredentialProtector,
        *,
        clock: Callable[[], NaiveDatetime] = naive_utc_now,
        id_factory: Callable[[], str] = lambda: str(uuidv7()),
    ) -> None:
        self._repository = repository
        self._validator = validator
        self._protector = protector
        self._clock = clock
        self._id_factory = id_factory

    def get(self, context: HumanInputChannelManagementContext) -> ChannelOperationResult:
        return ChannelOperationResult.success(self._view(context, self._repository.load(context.tenant_id)))

    def test(
        self,
        context: HumanInputChannelManagementContext,
        command: TestChannelCommand,
    ) -> ChannelOperationResult:
        if not isinstance(command, TestEmailChannelCommand) or command.ref != self.ref:
            return ChannelOperationResult.failed(
                ChannelFailureCategory.VALIDATION_FAILURE,
                "channel_candidate_mismatch",
            )
        current = self._repository.load(context.tenant_id)
        settings_or_failure = self._provider_settings(context.tenant_id, command.candidate, current)
        if isinstance(settings_or_failure, ChannelOperationResult):
            return settings_or_failure
        validation_failure = self._validate(settings_or_failure, send_to=context.actor_email)
        if validation_failure is not None:
            return validation_failure
        return ChannelOperationResult.tested(
            ChannelTestResult(
                ref=self.ref,
                scope=ChannelScope(ChannelScopeKind.WORKSPACE, str(context.tenant_id)),
                status=ChannelStatus.CONNECTED,
                summary=ResendChannelTestSummary(
                    recipient_email=context.actor_email,
                    sender_email=command.candidate.sender_email,
                    sender_name=command.candidate.sender_name,
                ),
                checked_at=self._clock(),
            )
        )

    def save(
        self,
        context: HumanInputChannelManagementContext,
        command: SaveChannelCommand,
    ) -> ChannelOperationResult:
        if not isinstance(command, SaveEmailChannelCommand) or command.ref != self.ref:
            return ChannelOperationResult.failed(
                ChannelFailureCategory.VALIDATION_FAILURE,
                "channel_candidate_mismatch",
            )
        current = self._repository.load(context.tenant_id)
        settings_or_failure = self._provider_settings(context.tenant_id, command.candidate, current)
        if isinstance(settings_or_failure, ChannelOperationResult):
            return settings_or_failure
        validation_failure = self._validate(settings_or_failure)
        if validation_failure is not None:
            return validation_failure

        try:
            protected_key = (
                current.protected_api_key
                if isinstance(command.candidate.api_key, RetainExistingAPIKey) and current is not None
                else self._protector.protect(context.tenant_id, settings_or_failure.api_key)
            )
        except Exception:
            return ChannelOperationResult.failed(ChannelFailureCategory.CHANNEL_FAILURE, "credential_protection_failed")

        now = self._clock()
        if current is None:
            configuration = EmailChannelConfiguration(
                id=EmailProviderId(self._id_factory()),
                tenant_id=context.tenant_id,
                sender_email=command.candidate.sender_email,
                sender_name=command.candidate.sender_name,
                protected_api_key=protected_key,
                configured_by_account_id=context.actor_account_id,
                created_at=now,
                updated_at=now,
            )
            create_result = self._repository.create(configuration)
            if create_result.status is CreateEmailConfigurationStatus.CONFLICT or create_result.configuration is None:
                return ChannelOperationResult.failed(ChannelFailureCategory.CONFLICT)
            return ChannelOperationResult.success(self._view(context, create_result.configuration))

        replacement = replace(
            current,
            sender_email=command.candidate.sender_email,
            sender_name=command.candidate.sender_name,
            protected_api_key=protected_key,
            configured_by_account_id=context.actor_account_id,
        )
        update_result = self._repository.update(replacement, expected=current.snapshot, now=now)
        if update_result.status is UpdateEmailConfigurationStatus.STALE or update_result.configuration is None:
            return ChannelOperationResult.failed(ChannelFailureCategory.STALE_CONFIGURATION)
        return ChannelOperationResult.success(self._view(context, update_result.configuration))

    def delete(
        self,
        context: HumanInputChannelManagementContext,
        command: DeleteChannelCommand,
    ) -> ChannelOperationResult:
        if command.ref != self.ref:
            return ChannelOperationResult.failed(
                ChannelFailureCategory.VALIDATION_FAILURE,
                "channel_candidate_mismatch",
            )
        result = self._repository.delete(context.tenant_id)
        if result.status is DeleteEmailConfigurationStatus.NOT_CONFIGURED:
            return ChannelOperationResult.failed(ChannelFailureCategory.NOT_CONFIGURED)
        return ChannelOperationResult.success(self._view(context, None))

    def _provider_settings(
        self,
        tenant_id: TenantId,
        candidate: ResendCandidate,
        current: EmailChannelConfiguration | None,
    ) -> ResendProviderSettings | ChannelOperationResult:
        if isinstance(candidate.api_key, NewAPIKey):
            api_key = candidate.api_key.value
        else:
            if current is None:
                return ChannelOperationResult.failed(
                    ChannelFailureCategory.NOT_CONFIGURED,
                    "cannot_retain_missing_api_key",
                )
            try:
                api_key = self._protector.reveal(tenant_id, current.protected_api_key)
            except Exception:
                return ChannelOperationResult.failed(
                    ChannelFailureCategory.CHANNEL_FAILURE,
                    "credential_reveal_failed",
                )
        return ResendProviderSettings(candidate.sender_email, candidate.sender_name, api_key)

    def _validate(
        self,
        settings: ResendProviderSettings,
        *,
        send_to: NormalizedEmail | None = None,
    ) -> ChannelOperationResult | None:
        try:
            self._validator.validate(settings)
            if send_to is not None:
                self._validator.send_test(settings, send_to)
        except EmailProviderValidationError as error:
            return ChannelOperationResult.failed(ChannelFailureCategory.VALIDATION_FAILURE, error.code)
        except EmailProviderOperationError as error:
            return ChannelOperationResult.failed(ChannelFailureCategory.PROVIDER_FAILURE, error.code)
        except Exception:
            return ChannelOperationResult.failed(ChannelFailureCategory.PROVIDER_FAILURE, "provider_failure")
        return None

    def _view(
        self,
        context: HumanInputChannelManagementContext,
        configuration: EmailChannelConfiguration | None,
    ) -> ChannelView:
        return ChannelView(
            ref=self.ref,
            scope=ChannelScope(ChannelScopeKind.WORKSPACE, str(context.tenant_id)),
            configured=configuration is not None,
            status=ChannelStatus.CONFIGURED if configuration is not None else ChannelStatus.NOT_CONFIGURED,
            capabilities=self.capabilities,
            summary=ResendChannelSummary(
                configuration.sender_email if configuration is not None else None,
                configuration.sender_name if configuration is not None else None,
                configuration is not None,
            ),
        )
