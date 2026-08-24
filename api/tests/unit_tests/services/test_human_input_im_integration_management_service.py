"""IM Integration application-owner contracts without provider or database I/O."""

from datetime import datetime

import pytest

from core.human_input_v2.entities import IMIntegrationStatus, IMProvider
from core.human_input_v2.im_integration import (
    ConfigurationTransition,
    ConfigurationTransitionKind,
    EncryptedCredentials,
    IMIntegration,
    IntegrationDeletion,
    IntegrationRevisionToken,
    ProviderTenantIdentity,
    StaleRevision,
)
from core.human_input_v2.im_integration.management import (
    ConfirmedIMConfiguration,
    IMIntegrationAlreadyExistsError,
    IMProviderConfigurationFailureKind,
    IMProviderTestResult,
)
from core.human_input_v2.im_provider import SlackIMIntegrationCredentials
from core.human_input_v2.shared import (
    AccountId,
    DeploymentScope,
    DirectoryScope,
    IntegrationId,
    TenantId,
    WorkspaceScope,
)
from services.human_input_v2.errors import (
    ChannelAlreadyConfiguredError,
    ChannelNotFoundError,
    ChannelProviderError,
    IMProviderConfigurationError,
    ProviderConfigurationUpdatedError,
    ProviderFailureKind,
    ReplacementRequiredError,
    UnexpectedChannelProviderError,
)
from services.human_input_v2.im_integration_management_service import HumanInputIMIntegrationManagementService

_NOW = datetime(2026, 8, 20, 8)
_LATER = datetime(2026, 8, 20, 9)
_SCOPE = WorkspaceScope(TenantId("workspace-1"))
_ACTOR_ID = AccountId("account-1")


def _slack_credentials() -> SlackIMIntegrationCredentials:
    return SlackIMIntegrationCredentials(
        provider=IMProvider.SLACK,
        client_id="client-id",
        client_secret="client-secret",
        signing_secret="signing-secret",
        bot_token="xoxb-bot-token",
        app_token="xapp-app-token",
    )


def _confirmed(
    *,
    provider: IMProvider = IMProvider.SLACK,
    provider_tenant_id: str = "provider-tenant-1",
    app_identifier: str = "client-id",
) -> ConfirmedIMConfiguration:
    credential_fields = {
        IMProvider.SLACK: {
            "client_id": app_identifier,
            "encrypted_client_secret": "cipher-client-secret",
            "encrypted_signing_secret": "cipher-signing-secret",
            "encrypted_bot_token": "cipher-bot-token",
            "encrypted_app_token": "cipher-app-token",
        },
        IMProvider.FEISHU: {
            "app_id": app_identifier,
            "encrypted_app_secret": "cipher-app-secret",
        },
    }
    return ConfirmedIMConfiguration(
        provider=provider,
        provider_tenant_id=provider_tenant_id,
        encrypted_credentials=EncryptedCredentials.from_mapping(credential_fields[provider]),
        callback_url=f"https://example.test/callback/{provider.value}",
        provider_tenant_display=None,
    )


def _integration(
    *,
    integration_id: str = "integration-1",
    provider: IMProvider = IMProvider.SLACK,
    provider_tenant_id: str = "provider-tenant-1",
    tenant_id: TenantId | None = _SCOPE.id,
    config_version: int = 1,
    status: IMIntegrationStatus = IMIntegrationStatus.CONFIGURED,
    safe_status_reason: str | None = None,
) -> IMIntegration:
    created = IMIntegration.create(
        integration_id=IntegrationId(integration_id),
        tenant_id=tenant_id,
        provider_tenant=ProviderTenantIdentity(provider, provider_tenant_id),
        encrypted_credentials=_confirmed(
            provider=provider,
            provider_tenant_id=provider_tenant_id,
        ).encrypted_credentials,
        configured_by_account_id=_ACTOR_ID,
        callback_url=f"https://example.test/callback/{provider.value}",
        now=_NOW,
    )
    return IMIntegration(
        id=created.id,
        tenant_id=created.tenant_id,
        provider_tenant=created.provider_tenant,
        encrypted_credentials=created.encrypted_credentials,
        configured_by_account_id=created.configured_by_account_id,
        callback_url=created.callback_url,
        config_version=config_version,
        status=status,
        safe_status_reason=safe_status_reason,
        last_checked_at=_LATER if safe_status_reason is not None else None,
        created_at=created.created_at,
        updated_at=_LATER if config_version > 1 or safe_status_reason is not None else created.updated_at,
    )


class FakeRepository:
    def __init__(self, events: list[str], current: IMIntegration | None = None) -> None:
        self._events = events
        self.current = current
        self.transition: ConfigurationTransition | None = None
        self.deletion: IntegrationDeletion | None = None
        self.force_create_conflict = False
        self.force_stale = False

    def load_current_integration(self, tenant_id: TenantId | None) -> IMIntegration | None:
        self._events.append("load")
        if self.current is None or self.current.tenant_id != tenant_id:
            return None
        return self.current

    def create_integration(
        self,
        integration: IMIntegration,
        *,
        organization_scope: DirectoryScope,
    ) -> IMIntegration:
        self._events.append("create")
        assert organization_scope == _scope_for_owner(integration.tenant_id)
        if self.force_create_conflict or self.current is not None:
            raise IMIntegrationAlreadyExistsError
        self.current = integration
        return integration

    def compare_and_swap_configuration(
        self,
        transition: ConfigurationTransition,
        *,
        organization_scope: DirectoryScope,
    ) -> IMIntegration | StaleRevision:
        self._events.append("compare_and_swap_configuration")
        assert self.current is not None
        assert organization_scope == _scope_for_owner(self.current.tenant_id)
        self.transition = transition
        if self.force_stale or self.current.revision != transition.expected_revision:
            return StaleRevision(transition.expected_revision, self.current.revision)
        self.current = transition.integration
        return self.current

    def compare_and_swap_delete(
        self,
        deletion: IntegrationDeletion,
        *,
        organization_scope: DirectoryScope,
    ) -> None | StaleRevision:
        self._events.append("compare_and_swap_delete")
        assert self.current is not None
        assert organization_scope == _scope_for_owner(self.current.tenant_id)
        self.deletion = deletion
        if self.force_stale or self.current.revision != deletion.expected_revision:
            return StaleRevision(deletion.expected_revision, self.current.revision)
        self.current = None
        return None


class FakeProviderPort:
    def __init__(self, events: list[str], confirmed: ConfirmedIMConfiguration | None = None) -> None:
        self._events = events
        self.confirmed = confirmed or _confirmed()
        self.failure: Exception | None = None
        self.available = (IMProvider.SLACK, IMProvider.FEISHU)

    def available_providers(self) -> tuple[IMProvider, ...]:
        self._events.append("available_providers")
        return self.available

    def prepare(self, scope: DirectoryScope, credentials) -> ConfirmedIMConfiguration:
        self._events.append("prepare")
        assert scope == _SCOPE
        assert credentials.provider in self.available
        if self.failure is not None:
            raise self.failure
        return self.confirmed

    def test(self, scope: DirectoryScope, credentials) -> IMProviderTestResult:
        self._events.append("test")
        assert scope == _SCOPE
        assert credentials.provider in self.available
        if self.failure is not None:
            raise self.failure
        return IMProviderTestResult(
            provider=self.confirmed.provider,
            provider_tenant_id=self.confirmed.provider_tenant_id,
        )


def _scope_for_owner(tenant_id: TenantId | None) -> DirectoryScope:
    return DeploymentScope() if tenant_id is None else WorkspaceScope(tenant_id)


def _service(
    repository: FakeRepository,
    provider_port: FakeProviderPort,
) -> HumanInputIMIntegrationManagementService:
    return HumanInputIMIntegrationManagementService(
        repository,
        provider_port,
        clock=lambda: _LATER,
        id_factory=lambda: "integration-new",
    )


def test_available_providers_are_delegated_without_configuration_reads() -> None:
    events: list[str] = []
    service = _service(FakeRepository(events), FakeProviderPort(events))

    assert service.available_providers() == (IMProvider.SLACK, IMProvider.FEISHU)
    assert events == ["available_providers"]


def test_ordinary_create_rejects_a_second_integration_before_provider_io() -> None:
    events: list[str] = []
    current = _integration()
    repository = FakeRepository(events, current)
    provider_port = FakeProviderPort(events)

    with pytest.raises(ChannelAlreadyConfiguredError):
        _service(repository, provider_port).create(_SCOPE, _ACTOR_ID, _slack_credentials())

    assert events == ["load"]
    assert repository.current == current


def test_create_prepares_before_atomic_persistence_and_returns_safe_owner_view() -> None:
    events: list[str] = []
    repository = FakeRepository(events)
    service = _service(repository, FakeProviderPort(events))

    view = service.create(_SCOPE, _ACTOR_ID, _slack_credentials())

    assert events == ["load", "prepare", "create"]
    assert view.id == IntegrationId("integration-new")
    assert view.provider is IMProvider.SLACK
    assert view.status is IMIntegrationStatus.CONFIGURED
    assert view.safe_status_reason is None
    assert view.app_identifier == "client-id"
    assert view.webhook_url == "https://example.test/callback/slack"
    assert view.revision == repository.current.revision if repository.current is not None else False
    assert "cipher-client-secret" not in repr(view)


def test_update_rejects_path_identity_and_owner_revision_mismatch_before_provider_io() -> None:
    current = _integration()
    for channel_id, expected_revision, expected_error, expected_events in (
        (IntegrationId("integration-other"), current.revision, ChannelNotFoundError, ["load"]),
        (
            current.id,
            IntegrationRevisionToken(current.id, current.config_version + 1),
            ProviderConfigurationUpdatedError,
            ["load", "prepare"],
        ),
    ):
        events: list[str] = []
        repository = FakeRepository(events, current)
        service = _service(repository, FakeProviderPort(events))

        with pytest.raises(expected_error):
            service.update(_SCOPE, channel_id, expected_revision, _ACTOR_ID, _slack_credentials())

        assert events == expected_events
        assert repository.current == current


def test_same_provider_tenant_rotation_preserves_identity_and_children() -> None:
    events: list[str] = []
    current = _integration()
    repository = FakeRepository(events, current)
    provider_port = FakeProviderPort(events, _confirmed(provider_tenant_id="provider-tenant-1"))
    service = _service(repository, provider_port)
    snapshot = service.get_current(_SCOPE)
    assert snapshot is not None
    events.clear()

    rotated = service.update(
        _SCOPE,
        current.id,
        snapshot.revision,
        _ACTOR_ID,
        _slack_credentials(),
    )

    assert events == ["load", "prepare", "compare_and_swap_configuration"]
    assert repository.transition is not None
    assert repository.transition.kind is ConfigurationTransitionKind.CREDENTIAL_ROTATION
    assert not repository.transition.invalidation.invalidate_identities
    assert not repository.transition.invalidation.invalidate_bindings
    assert rotated.id == current.id
    assert repository.current is not None
    assert repository.current.config_version == current.config_version + 1


def test_cross_provider_update_requires_replacement_before_provider_io() -> None:
    events: list[str] = []
    current = _integration()
    repository = FakeRepository(events, current)
    provider_port = FakeProviderPort(events)
    service = _service(repository, provider_port)
    snapshot = service.get_current(_SCOPE)
    assert snapshot is not None
    events.clear()

    class FeishuCredentials:
        provider = IMProvider.FEISHU

    with pytest.raises(ReplacementRequiredError):
        service.update(_SCOPE, current.id, snapshot.revision, _ACTOR_ID, FeishuCredentials())

    assert events == ["load"]
    assert repository.current == current


def test_provider_tenant_change_requires_replacement_after_validation_without_mutation() -> None:
    events: list[str] = []
    current = _integration()
    repository = FakeRepository(events, current)
    provider_port = FakeProviderPort(events, _confirmed(provider_tenant_id="provider-tenant-2"))
    service = _service(repository, provider_port)
    snapshot = service.get_current(_SCOPE)
    assert snapshot is not None
    events.clear()

    with pytest.raises(ReplacementRequiredError):
        service.update(_SCOPE, current.id, snapshot.revision, _ACTOR_ID, _slack_credentials())

    assert events == ["load", "prepare"]
    assert repository.current == current
    assert repository.transition is None


def test_stale_revision_wins_over_provider_tenant_replacement() -> None:
    events: list[str] = []
    current = _integration()
    repository = FakeRepository(events, current)
    provider_port = FakeProviderPort(events, _confirmed(provider_tenant_id="provider-tenant-2"))
    service = _service(repository, provider_port)
    stale_revision = IntegrationRevisionToken(current.id, current.config_version + 1)

    with pytest.raises(ProviderConfigurationUpdatedError):
        service.update(_SCOPE, current.id, stale_revision, _ACTOR_ID, _slack_credentials())

    assert events == ["load", "prepare"]
    assert repository.current == current
    assert repository.transition is None


def test_explicit_replacement_uses_aggregate_transition_and_scoped_cleanup() -> None:
    events: list[str] = []
    current = _integration()
    repository = FakeRepository(events, current)
    provider_port = FakeProviderPort(
        events,
        _confirmed(
            provider=IMProvider.FEISHU,
            provider_tenant_id="feishu-tenant",
            app_identifier="feishu-app",
        ),
    )
    service = _service(repository, provider_port)
    snapshot = service.get_current(_SCOPE)
    assert snapshot is not None
    events.clear()

    class FeishuCredentials:
        provider = IMProvider.FEISHU

    replacement = service.replace(
        _SCOPE,
        current.id,
        snapshot.revision,
        _ACTOR_ID,
        FeishuCredentials(),
    )

    assert events == ["load", "prepare", "compare_and_swap_configuration"]
    assert repository.transition is not None
    assert repository.transition.kind is ConfigurationTransitionKind.PROVIDER_REPLACEMENT
    assert repository.transition.expected_revision == current.revision
    assert repository.transition.invalidation.invalidate_identities
    assert repository.transition.invalidation.invalidate_bindings
    assert replacement.id == IntegrationId("integration-new")
    assert replacement.provider is IMProvider.FEISHU
    assert repository.current is not None
    assert repository.current.config_version == 1


def test_repository_cas_loss_maps_to_provider_configuration_updated() -> None:
    events: list[str] = []
    current = _integration()
    repository = FakeRepository(events, current)
    repository.force_stale = True
    service = _service(repository, FakeProviderPort(events))
    snapshot = service.get_current(_SCOPE)
    assert snapshot is not None

    with pytest.raises(ProviderConfigurationUpdatedError):
        service.update(_SCOPE, current.id, snapshot.revision, _ACTOR_ID, _slack_credentials())

    assert repository.current == current


def test_delete_uses_complete_domain_cas_and_returns_addressed_identity() -> None:
    events: list[str] = []
    current = _integration()
    repository = FakeRepository(events, current)
    service = _service(repository, FakeProviderPort(events))
    snapshot = service.get_current(_SCOPE)
    assert snapshot is not None
    events.clear()

    deleted_id = service.delete(_SCOPE, current.id, snapshot.revision)

    assert deleted_id == current.id
    assert events == ["load", "compare_and_swap_delete"]
    assert repository.deletion is not None
    assert repository.deletion.expected_revision == IntegrationRevisionToken(current.id, current.config_version)
    assert repository.current is None


def test_candidate_test_uses_only_submitted_credentials_and_never_reads_or_writes_state() -> None:
    events: list[str] = []
    current = _integration()
    repository = FakeRepository(events, current)
    service = _service(repository, FakeProviderPort(events))

    result = service.test(_SCOPE, _slack_credentials())

    assert result is None
    assert events == ["test"]
    assert repository.current == current


@pytest.mark.parametrize(
    ("failure_kind", "expected_kind"),
    [
        (IMProviderConfigurationFailureKind.INVALID_CREDENTIALS, ProviderFailureKind.INVALID_CREDENTIALS),
        (IMProviderConfigurationFailureKind.CONNECTION_FAILURE, ProviderFailureKind.CONNECTION_FAILURE),
    ],
)
def test_expected_provider_failures_are_safely_classified(
    failure_kind: IMProviderConfigurationFailureKind,
    expected_kind: ProviderFailureKind,
) -> None:
    events: list[str] = []
    repository = FakeRepository(events)
    provider_port = FakeProviderPort(events)
    provider_port.failure = IMProviderConfigurationError(failure_kind)

    with pytest.raises(ChannelProviderError) as captured:
        _service(repository, provider_port).create(_SCOPE, _ACTOR_ID, _slack_credentials())

    assert captured.value.kind is expected_kind
    assert "client-secret" not in repr(captured.value)
    assert events == ["load", "prepare"]


def test_unexpected_provider_failure_is_detail_free_and_preserves_state() -> None:
    events: list[str] = []
    current = _integration()
    repository = FakeRepository(events, current)
    provider_port = FakeProviderPort(events)
    provider_port.failure = RuntimeError("raw provider response with client-secret")
    service = _service(repository, provider_port)
    snapshot = service.get_current(_SCOPE)
    assert snapshot is not None

    with pytest.raises(UnexpectedChannelProviderError) as captured:
        service.update(_SCOPE, current.id, snapshot.revision, _ACTOR_ID, _slack_credentials())

    assert "raw provider response" not in str(captured.value)
    assert "client-secret" not in repr(captured.value)
    assert repository.current == current


@pytest.mark.parametrize(
    "domain_status",
    [
        IMIntegrationStatus.CONFIGURED,
        IMIntegrationStatus.CONNECTED,
        IMIntegrationStatus.PERMISSION_ISSUE,
        IMIntegrationStatus.CALLBACK_ERROR,
        IMIntegrationStatus.CONNECTION_ERROR,
    ],
)
def test_persisted_status_projects_without_provider_io(
    domain_status: IMIntegrationStatus,
) -> None:
    events: list[str] = []
    safe_reason = (
        None
        if domain_status in (IMIntegrationStatus.CONFIGURED, IMIntegrationStatus.CONNECTED)
        else "Safe operator description."
    )
    repository = FakeRepository(
        events,
        _integration(status=domain_status, safe_status_reason=safe_reason),
    )

    snapshot = _service(repository, FakeProviderPort(events)).get_current(_SCOPE)

    assert snapshot is not None
    assert snapshot.status is domain_status
    assert snapshot.safe_status_reason == safe_reason
    assert events == ["load"]


def test_deployment_scope_maps_to_the_deployment_owned_integration() -> None:
    events: list[str] = []
    repository = FakeRepository(events, _integration(tenant_id=None))
    service = _service(repository, FakeProviderPort(events))

    snapshot = service.get_current(DeploymentScope())

    assert snapshot is not None
    assert snapshot.id == IntegrationId("integration-1")
    assert events == ["load"]
