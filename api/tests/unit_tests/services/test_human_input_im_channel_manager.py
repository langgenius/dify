"""IM handler contract tests proving aggregate-owned CAS and replacement."""

from datetime import datetime

from core.human_input_v2.channel_management import (
    ChannelCapability,
    ChannelFailureCategory,
    ChannelHandlerRegistry,
    ChannelKind,
    ChannelProvider,
    ChannelRef,
    ChannelScopeKind,
    ChannelStatus,
    DeleteChannelCommand,
    HumanInputChannelManagementContext,
    IMChannelTestSummary,
    NewSecret,
    SaveIMChannelCommand,
    SlackIMCandidate,
)
from core.human_input_v2.channel_management import (
    TestIMChannelCommand as IMTestCommand,
)
from core.human_input_v2.entities import IMIntegrationStatus, IMProvider
from core.human_input_v2.im_integration import (
    ConfigurationTransitionKind,
    EncryptedCredentials,
    IMIntegration,
    IntegrationRevisionToken,
    ProviderTenantIdentity,
    StaleRevision,
)
from core.human_input_v2.shared import (
    AccountId,
    DirectoryScope,
    IntegrationId,
    NormalizedEmail,
    TenantId,
    WorkspaceScope,
)
from services.human_input_im_channel_manager import (
    ConfirmedIMConfiguration,
    HumanInputIMChannelManager,
    IMProviderConfigurationError,
    IMProviderTestResult,
    build_human_input_im_channel_handlers,
)

_NOW = datetime(2026, 7, 28, 8)
_LATER = datetime(2026, 7, 28, 9)
_CONTEXT = HumanInputChannelManagementContext(
    TenantId("workspace-1"),
    AccountId("account-1"),
    NormalizedEmail("operator@example.com"),
    organization_id="organization-1",
)
_SLACK_REF = ChannelRef(ChannelKind.IM, ChannelProvider.SLACK)
_FEISHU_REF = ChannelRef(ChannelKind.IM, ChannelProvider.FEISHU)
_DING_TALK_REF = ChannelRef(ChannelKind.IM, ChannelProvider.DING_TALK)
_CANDIDATE = SlackIMCandidate(
    "client",
    NewSecret("client-secret"),
    NewSecret("signing-secret"),
    NewSecret("xoxb-test-bot-token"),
    NewSecret("xapp-test-app-token"),
)


class FakeRepository:
    def __init__(self, current: IMIntegration | None = None) -> None:
        self.current = current
        self.transition_kind = None
        self.load_calls = 0
        self.loaded_tenant_ids: list[TenantId | None] = []
        self.write_scopes: list[DirectoryScope] = []

    def load_current_integration(self, tenant_id):
        self.load_calls += 1
        self.loaded_tenant_ids.append(tenant_id)
        if self.current is None or self.current.tenant_id == tenant_id:
            return self.current
        return None

    def create_integration(self, integration, *, organization_scope):
        self.write_scopes.append(organization_scope)
        if self.current is not None:
            raise ValueError("conflict")
        self.current = integration
        return integration

    def compare_and_swap_configuration(self, transition, *, organization_scope):
        self.write_scopes.append(organization_scope)
        if self.current is None or self.current.revision != transition.expected_revision:
            return StaleRevision(transition.expected_revision, self.current.revision if self.current else None)
        self.transition_kind = transition.kind
        self.current = transition.integration
        return self.current

    def compare_and_swap_delete(self, deletion, *, organization_scope):
        self.write_scopes.append(organization_scope)
        if self.current is None or self.current.revision != deletion.expected_revision:
            return StaleRevision(deletion.expected_revision, self.current.revision if self.current else None)
        self.current = None
        return None


class FakeProviderPort:
    def __init__(self, provider_tenant_id: str = "slack-workspace") -> None:
        self.provider_tenant_id = provider_tenant_id
        self.calls = 0

    def prepare(self, context, candidate, current):
        del context, candidate, current
        self.calls += 1
        return ConfirmedIMConfiguration(
            IMProvider.SLACK,
            self.provider_tenant_id,
            EncryptedCredentials.from_mapping(
                {
                    "client_id": "client",
                    "encrypted_client_secret": "cipher-1",
                    "encrypted_signing_secret": "cipher-2",
                    "encrypted_bot_token": "cipher-3",
                    "encrypted_app_token": "cipher-4",
                }
            ),
        )

    def test(self, context, candidate, current):
        del context, candidate, current
        self.calls += 1
        return IMProviderTestResult(
            self.provider_tenant_id,
            IMIntegrationStatus.CONNECTED,
            None,
            _LATER,
        )


def _current(provider: IMProvider = IMProvider.FEISHU) -> IMIntegration:
    return IMIntegration.create(
        integration_id=IntegrationId("integration-1"),
        tenant_id=_CONTEXT.tenant_id,
        provider_tenant=ProviderTenantIdentity(provider, "provider-tenant"),
        encrypted_credentials=EncryptedCredentials.from_mapping(
            {"app_id": "app", "encrypted_app_secret": "ciphertext"}
        ),
        configured_by_account_id=_CONTEXT.actor_account_id,
        callback_url=None,
        now=_NOW,
    )


def _command(current: IMIntegration | None) -> SaveIMChannelCommand:
    return SaveIMChannelCommand(
        ref=_SLACK_REF,
        candidate=_CANDIDATE,
        expected_integration_id=str(current.id) if current else None,
        expected_config_version=current.config_version if current else None,
    )


def test_provider_replacement_is_planned_by_im_aggregate() -> None:
    current = _current()
    repository = FakeRepository(current)
    manager = HumanInputIMChannelManager(
        _SLACK_REF,
        repository,
        FakeProviderPort(),
        clock=lambda: _LATER,
        id_factory=lambda: "integration-2",
    )

    result = manager.save(_CONTEXT, _command(current))

    assert result.view is not None
    assert repository.transition_kind is ConfigurationTransitionKind.PROVIDER_REPLACEMENT
    assert repository.current is not None
    assert repository.current.id == IntegrationId("integration-2")
    assert repository.write_scopes == [WorkspaceScope(id=_CONTEXT.tenant_id)]


def test_im_capabilities_expose_provider_replacement_without_unimplemented_secret_retention() -> None:
    manager = HumanInputIMChannelManager(
        _SLACK_REF,
        FakeRepository(),
        FakeProviderPort(),
    )

    assert ChannelCapability.PROVIDER_REPLACEMENT in manager.capabilities
    assert ChannelCapability.SECRET_RETENTION not in manager.capabilities


def test_supported_im_providers_share_current_management_capabilities() -> None:
    repository = FakeRepository()
    provider_port = FakeProviderPort()
    feishu = HumanInputIMChannelManager(_FEISHU_REF, repository, provider_port)
    ding_talk = HumanInputIMChannelManager(_DING_TALK_REF, repository, provider_port)

    assert feishu.capabilities == ding_talk.capabilities
    assert ChannelCapability.SECRET_RETENTION not in feishu.capabilities


def test_stale_complete_revision_is_rejected_before_provider_work() -> None:
    current = _current(IMProvider.SLACK)
    repository = FakeRepository(current)
    provider_port = FakeProviderPort()
    manager = HumanInputIMChannelManager(_SLACK_REF, repository, provider_port)
    command = SaveIMChannelCommand(
        _SLACK_REF,
        _CANDIDATE,
        expected_integration_id=str(current.id),
        expected_config_version=2,
    )

    result = manager.save(_CONTEXT, command)

    assert result.failure is not None
    assert result.failure.category is ChannelFailureCategory.STALE_CONFIGURATION
    assert provider_port.calls == 0


def test_same_provider_identity_rotation_preserves_aggregate_identity() -> None:
    current = _current(IMProvider.SLACK)
    provider_port = FakeProviderPort(provider_tenant_id="provider-tenant")
    repository = FakeRepository(current)
    manager = HumanInputIMChannelManager(
        _SLACK_REF,
        repository,
        provider_port,
        clock=lambda: _LATER,
        id_factory=lambda: "must-not-be-used",
    )

    result = manager.save(_CONTEXT, _command(current))

    assert result.view is not None
    assert repository.transition_kind is ConfigurationTransitionKind.CREDENTIAL_ROTATION
    assert repository.current is not None
    assert repository.current.id == current.id


def test_delete_delegates_complete_cas_to_control_plane() -> None:
    current = _current(IMProvider.SLACK)
    repository = FakeRepository(current)
    manager = HumanInputIMChannelManager(_SLACK_REF, repository, FakeProviderPort())

    result = manager.delete(
        _CONTEXT,
        DeleteChannelCommand(_SLACK_REF, str(current.id), current.config_version),
    )

    assert result.view is not None
    assert repository.current is None


def test_integration_revision_remains_complete_identity_and_version() -> None:
    current = _current(IMProvider.SLACK)
    assert current.revision == IntegrationRevisionToken(IntegrationId("integration-1"), 1)


def test_each_supported_im_provider_has_one_handler_and_one_view() -> None:
    repository = FakeRepository(_current(IMProvider.SLACK))
    provider_port = FakeProviderPort()
    handlers = build_human_input_im_channel_handlers(repository, provider_port)
    registry = ChannelHandlerRegistry(handlers)

    results = tuple(handler.get(_CONTEXT) for handler in registry.handlers())

    assert all(result.view is not None for result in results)
    views = tuple(result.view for result in results if result.view is not None)
    assert {handler.ref for handler in handlers} == {_SLACK_REF, _FEISHU_REF, _DING_TALK_REF}
    assert {view.ref for view in views} == {_SLACK_REF, _FEISHU_REF, _DING_TALK_REF}
    assert [view.ref for view in views if view.configured] == [_SLACK_REF]
    assert repository.load_calls == 3


def test_im_provider_failure_is_mapped_without_raw_diagnostics() -> None:
    class FailingProviderPort(FakeProviderPort):
        def test(self, context, candidate, current):
            del context, candidate, current
            raise IMProviderConfigurationError("permission_denied", provider_failure=True)

    manager = HumanInputIMChannelManager(_SLACK_REF, FakeRepository(), FailingProviderPort())

    result = manager.test(
        _CONTEXT,
        IMTestCommand(_SLACK_REF, _CANDIDATE),
    )

    assert result.failure is not None
    assert result.failure.category is ChannelFailureCategory.PROVIDER_FAILURE
    assert result.failure.code == "permission_denied"
    assert "client-secret" not in repr(result)


def test_im_candidate_test_result_does_not_mix_with_current_integration_state() -> None:
    current = _current(IMProvider.SLACK)
    repository = FakeRepository(current)
    provider_port = FakeProviderPort("tested-slack-workspace")
    manager = HumanInputIMChannelManager(_SLACK_REF, repository, provider_port)

    result = manager.test(_CONTEXT, IMTestCommand(_SLACK_REF, _CANDIDATE))

    assert result.view is None
    assert result.test_result is not None
    assert result.test_result.ref == _SLACK_REF
    assert result.test_result.status is ChannelStatus.CONNECTED
    assert result.test_result.summary == IMChannelTestSummary("tested-slack-workspace")
    assert result.test_result.checked_at == _LATER
    assert not hasattr(result.test_result.summary, "integration_id")
    assert not hasattr(result.test_result.summary, "config_version")
    assert repository.current == current


def test_im_status_mapping_uses_persisted_snapshot_without_provider_work() -> None:
    current = _current(IMProvider.SLACK).record_diagnostics(
        status=IMIntegrationStatus.PERMISSION_ISSUE,
        safe_status_reason="missing_scope",
        checked_at=_LATER,
    )
    repository = FakeRepository(current)
    provider_port = FakeProviderPort()
    manager = HumanInputIMChannelManager(_SLACK_REF, repository, provider_port)

    result = manager.get(_CONTEXT)

    assert result.view is not None
    assert result.view.status is ChannelStatus.ERROR
    assert result.view.safe_status_reason == "missing_scope"
    assert result.view.last_checked_at == _LATER
    assert provider_port.calls == 0


def test_im_handler_maps_trusted_context_to_owner_and_effective_scope() -> None:
    repository = FakeRepository()
    manager = HumanInputIMChannelManager(_SLACK_REF, repository, FakeProviderPort())

    organization_result = manager.get(_CONTEXT)
    deployment_context = HumanInputChannelManagementContext(
        TenantId("workspace-ignored"),
        AccountId("account-1"),
        NormalizedEmail("operator@example.com"),
        deployment_id="deployment-1",
        use_deployment_im_scope=True,
    )
    deployment_result = manager.get(deployment_context)

    assert repository.loaded_tenant_ids == [_CONTEXT.tenant_id, None]
    assert organization_result.view is not None
    assert organization_result.view.scope.kind is ChannelScopeKind.ORGANIZATION
    assert organization_result.view.scope.scope_id == "organization-1"
    assert deployment_result.view is not None
    assert deployment_result.view.scope.kind is ChannelScopeKind.DEPLOYMENT
    assert deployment_result.view.scope.scope_id == "deployment-1"
