"""Channel handler adapter over the existing IM aggregate and repository."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Protocol

from pydantic import NaiveDatetime

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
    IMCandidate,
    IMChannelSummary,
    IMChannelTestSummary,
    SaveIMChannelCommand,
    TestIMChannelCommand,
)
from core.human_input_v2.channel_management.commands import SaveChannelCommand, TestChannelCommand
from core.human_input_v2.entities import IMIntegrationStatus, IMProvider
from core.human_input_v2.im_integration import (
    EncryptedCredentials,
    IMControlPlaneRepository,
    IMIntegration,
    IntegrationRevisionToken,
    ProviderTenantIdentity,
    StaleRevision,
)
from core.human_input_v2.shared import (
    DeploymentScope,
    DirectoryScope,
    IntegrationId,
    TenantId,
    WorkspaceScope,
)
from libs.datetime_utils import naive_utc_now
from libs.uuid_utils import uuidv7


@dataclass(frozen=True, slots=True)
class ConfirmedIMConfiguration:
    """Provider-validated and protected input accepted by the IM aggregate."""

    provider: IMProvider
    provider_tenant_id: str
    encrypted_credentials: EncryptedCredentials = field(repr=False)


@dataclass(frozen=True, slots=True)
class IMProviderTestResult:
    """Credential-free provider diagnostics returned by a candidate test."""

    provider_tenant_id: str
    status: IMIntegrationStatus
    safe_status_reason: str | None
    checked_at: NaiveDatetime


class IMProviderConfigurationError(Exception):
    """Classified safe failure raised by an IM provider application port."""

    code: str
    provider_failure: bool

    def __init__(self, code: str, *, provider_failure: bool = False) -> None:
        super().__init__(code)
        self.code = code
        self.provider_failure = provider_failure


class IMProviderConfigurationPort(Protocol):
    """Existing provider application boundary used before aggregate decisions."""

    def prepare(
        self,
        context: HumanInputChannelManagementContext,
        candidate: IMCandidate,
        current: IMIntegration | None,
    ) -> ConfirmedIMConfiguration:
        """Validate, resolve provider identity, and protect candidate credentials."""
        ...

    def test(
        self,
        context: HumanInputChannelManagementContext,
        candidate: IMCandidate,
        current: IMIntegration | None,
    ) -> IMProviderTestResult:
        """Test candidate settings without persistence."""
        ...


_BASE_CAPABILITIES = frozenset(
    (
        ChannelCapability.CONFIGURE,
        ChannelCapability.TEST,
        ChannelCapability.DELETE,
        ChannelCapability.PROVIDER_REPLACEMENT,
    )
)
_SUPPORTED_IM_PROVIDERS = (
    ChannelProvider.SLACK,
    ChannelProvider.FEISHU,
    ChannelProvider.DING_TALK,
)
_SUPPORTED_IM_REFS = frozenset(ChannelRef(ChannelKind.IM, provider) for provider in _SUPPORTED_IM_PROVIDERS)


class HumanInputIMChannelManager:
    """One IM provider handler delegating lifecycle decisions to the shared aggregate."""

    capabilities = _BASE_CAPABILITIES

    def __init__(
        self,
        ref: ChannelRef,
        repository: IMControlPlaneRepository,
        provider_port: IMProviderConfigurationPort,
        *,
        clock: Callable[[], NaiveDatetime] = naive_utc_now,
        id_factory: Callable[[], str] = lambda: str(uuidv7()),
    ) -> None:
        if ref not in _SUPPORTED_IM_REFS:
            raise ValueError("unsupported IM channel ref")
        self.ref = ref
        self._repository = repository
        self._provider_port = provider_port
        self._clock = clock
        self._id_factory = id_factory

    def get(self, context: HumanInputChannelManagementContext) -> ChannelOperationResult:
        current = self._repository.load_current_integration(self._owner_tenant_id(context))
        return ChannelOperationResult.success(self._view(context, self._matching(current)))

    def test(
        self,
        context: HumanInputChannelManagementContext,
        command: TestChannelCommand,
    ) -> ChannelOperationResult:
        if not isinstance(command, TestIMChannelCommand) or command.ref != self.ref:
            return self._mismatch()
        current = self._repository.load_current_integration(self._owner_tenant_id(context))
        try:
            result = self._provider_port.test(context, command.candidate, current)
        except IMProviderConfigurationError as error:
            category = (
                ChannelFailureCategory.PROVIDER_FAILURE
                if error.provider_failure
                else ChannelFailureCategory.VALIDATION_FAILURE
            )
            return ChannelOperationResult.failed(category, error.code)
        except Exception:
            return ChannelOperationResult.failed(ChannelFailureCategory.PROVIDER_FAILURE, "provider_failure")
        test_result = ChannelTestResult(
            ref=self.ref,
            scope=self._scope(context),
            status=self._status(result.status),
            summary=IMChannelTestSummary(result.provider_tenant_id),
            safe_status_reason=result.safe_status_reason,
            checked_at=result.checked_at,
        )
        return ChannelOperationResult.tested(test_result)

    def save(
        self,
        context: HumanInputChannelManagementContext,
        command: SaveChannelCommand,
    ) -> ChannelOperationResult:
        if not isinstance(command, SaveIMChannelCommand) or command.ref != self.ref:
            return self._mismatch()
        owner_tenant_id = self._owner_tenant_id(context)
        current = self._repository.load_current_integration(owner_tenant_id)
        expected = self._expected_revision(command)
        if (current is None and expected is not None) or (
            current is not None and (expected is None or expected != current.revision)
        ):
            return ChannelOperationResult.failed(ChannelFailureCategory.STALE_CONFIGURATION)

        try:
            confirmed = self._provider_port.prepare(context, command.candidate, current)
        except IMProviderConfigurationError as error:
            category = (
                ChannelFailureCategory.PROVIDER_FAILURE
                if error.provider_failure
                else ChannelFailureCategory.VALIDATION_FAILURE
            )
            return ChannelOperationResult.failed(category, error.code)
        except Exception:
            return ChannelOperationResult.failed(ChannelFailureCategory.PROVIDER_FAILURE, "provider_failure")
        if confirmed.provider.value != self.ref.provider.value:
            return self._mismatch()

        now = self._clock()
        organization_scope = self._organization_write_scope(context)
        if current is None:
            integration = IMIntegration.create(
                integration_id=IntegrationId(self._id_factory()),
                tenant_id=owner_tenant_id,
                provider_tenant=ProviderTenantIdentity(confirmed.provider, confirmed.provider_tenant_id),
                encrypted_credentials=confirmed.encrypted_credentials,
                configured_by_account_id=context.actor_account_id,
                callback_url=None,
                now=now,
            )
            try:
                created_integration = self._repository.create_integration(
                    integration,
                    organization_scope=organization_scope,
                )
            except ValueError:
                return ChannelOperationResult.failed(ChannelFailureCategory.CONFLICT)
            return ChannelOperationResult.success(self._view(context, created_integration))

        transition = current.reconfigure(
            expected_revision=current.revision,
            provider_tenant=ProviderTenantIdentity(confirmed.provider, confirmed.provider_tenant_id),
            encrypted_credentials=confirmed.encrypted_credentials,
            configured_by_account_id=context.actor_account_id,
            callback_url=current.callback_url,
            now=now,
            replacement_integration_id=(
                IntegrationId(self._id_factory())
                if confirmed.provider is not current.provider_tenant.provider
                or confirmed.provider_tenant_id != current.provider_tenant.provider_tenant_id
                else None
            ),
        )
        if isinstance(transition, StaleRevision):
            return ChannelOperationResult.failed(ChannelFailureCategory.STALE_CONFIGURATION)
        persisted_result = self._repository.compare_and_swap_configuration(
            transition,
            organization_scope=organization_scope,
        )
        if isinstance(persisted_result, StaleRevision):
            return ChannelOperationResult.failed(ChannelFailureCategory.STALE_CONFIGURATION)
        return ChannelOperationResult.success(self._view(context, persisted_result))

    def delete(
        self,
        context: HumanInputChannelManagementContext,
        command: DeleteChannelCommand,
    ) -> ChannelOperationResult:
        if command.ref != self.ref:
            return self._mismatch()
        current = self._repository.load_current_integration(self._owner_tenant_id(context))
        current = self._matching(current)
        if current is None:
            return ChannelOperationResult.failed(ChannelFailureCategory.NOT_CONFIGURED)
        expected = self._expected_revision(command)
        if expected is None or expected != current.revision:
            return ChannelOperationResult.failed(ChannelFailureCategory.STALE_CONFIGURATION)
        deletion = current.plan_deletion(expected)
        if isinstance(deletion, StaleRevision):
            return ChannelOperationResult.failed(ChannelFailureCategory.STALE_CONFIGURATION)
        result = self._repository.compare_and_swap_delete(
            deletion,
            organization_scope=self._organization_write_scope(context),
        )
        if isinstance(result, StaleRevision):
            return ChannelOperationResult.failed(ChannelFailureCategory.STALE_CONFIGURATION)
        return ChannelOperationResult.success(self._view(context, None))

    def _matching(self, integration: IMIntegration | None) -> IMIntegration | None:
        if integration is None or integration.provider_tenant.provider.value != self.ref.provider.value:
            return None
        return integration

    def _view(
        self,
        context: HumanInputChannelManagementContext,
        integration: IMIntegration | None,
    ) -> ChannelView:
        return ChannelView(
            ref=self.ref,
            scope=self._scope(context),
            configured=integration is not None,
            status=self._status(integration.status) if integration is not None else ChannelStatus.NOT_CONFIGURED,
            capabilities=self.capabilities,
            summary=IMChannelSummary(
                integration.provider_tenant.provider_tenant_id if integration is not None else None,
                integration.id if integration is not None else None,
                integration.config_version if integration is not None else None,
            ),
            safe_status_reason=integration.safe_status_reason if integration is not None else None,
            last_checked_at=integration.last_checked_at if integration is not None else None,
        )

    @staticmethod
    def _expected_revision(
        command: SaveIMChannelCommand | DeleteChannelCommand,
    ) -> IntegrationRevisionToken | None:
        if command.expected_integration_id is None or command.expected_config_version is None:
            return None
        return IntegrationRevisionToken(
            IntegrationId(command.expected_integration_id),
            command.expected_config_version,
        )

    @staticmethod
    def _owner_tenant_id(context: HumanInputChannelManagementContext) -> TenantId | None:
        return None if context.use_deployment_im_scope else context.tenant_id

    @staticmethod
    def _organization_write_scope(context: HumanInputChannelManagementContext) -> DirectoryScope:
        if context.use_deployment_im_scope:
            return DeploymentScope()
        return WorkspaceScope(id=context.tenant_id)

    @staticmethod
    def _scope(context: HumanInputChannelManagementContext) -> ChannelScope:
        if context.use_deployment_im_scope:
            assert context.deployment_id is not None
            return ChannelScope(ChannelScopeKind.DEPLOYMENT, context.deployment_id)
        if context.organization_id is not None:
            return ChannelScope(ChannelScopeKind.ORGANIZATION, context.organization_id)
        return ChannelScope(ChannelScopeKind.WORKSPACE, str(context.tenant_id))

    @staticmethod
    def _status(status: IMIntegrationStatus) -> ChannelStatus:
        if status is IMIntegrationStatus.NOT_CONFIGURED:
            return ChannelStatus.NOT_CONFIGURED
        if status is IMIntegrationStatus.CONFIGURED:
            return ChannelStatus.CONFIGURED
        if status is IMIntegrationStatus.CONNECTED:
            return ChannelStatus.CONNECTED
        return ChannelStatus.ERROR

    @staticmethod
    def _mismatch() -> ChannelOperationResult:
        return ChannelOperationResult.failed(
            ChannelFailureCategory.VALIDATION_FAILURE,
            "channel_candidate_mismatch",
        )


def build_human_input_im_channel_handlers(
    repository: IMControlPlaneRepository,
    provider_port: IMProviderConfigurationPort,
    *,
    clock: Callable[[], NaiveDatetime] = naive_utc_now,
    id_factory: Callable[[], str] = lambda: str(uuidv7()),
) -> tuple[HumanInputIMChannelManager, ...]:
    """Build one independently addressable handler per supported IM provider."""

    return tuple(
        HumanInputIMChannelManager(
            ChannelRef(ChannelKind.IM, provider),
            repository,
            provider_port,
            clock=clock,
            id_factory=id_factory,
        )
        for provider in _SUPPORTED_IM_PROVIDERS
    )
