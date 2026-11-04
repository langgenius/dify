"""In-memory tracing ports for tests; every other collaborator stays real."""

from collections.abc import Sequence
from typing import TYPE_CHECKING, Any, Literal, override

from dify_agent.layers.execution_context import ApplicationTracingContext
from dify_trace_sdk.egress import Egress
from dify_trace_sdk.emitter import TraceEmitter
from dify_trace_sdk.events import TraceEvent
from dify_trace_sdk.provider import TraceProvider

from core.helper.encrypter import obfuscated_token
from extensions.tracing import ApplicationTracingHooks
from services.app_tracing_config_service import AppTraceSettings
from services.tracing.adapters import StoredPolicyTraceScopes, WorkspaceTracingSecretCipher
from services.tracing.collection import AgentTraceSettings
from services.tracing.errors import TraceProviderUnavailableError, UnknownTraceProviderError
from services.tracing.provider_configs import ProviderConfigGateway
from services.tracing.providers import (
    SUPPORTED_PROVIDERS,
    ProviderConfigCodec,
    TraceProviderCatalog,
    TracingSecretCipher,
)
from services.tracing.registry import EntryPointTraceProviderCatalog
from services.tracing.scopes import TraceScopes, TracingPolicyQuery

if TYPE_CHECKING:
    from core.app.apps.agent_app.runtime_request_builder import AgentAppRuntimeBuildContext
    from core.app.entities.app_invoke_entities import AdvancedChatAppGenerateEntity, WorkflowAppGenerateEntity
    from core.workflow.nodes.agent_v2.runtime_request_builder import WorkflowAgentRuntimeBuildContext

AGENT_TRACE_SETTINGS = AgentTraceSettings(
    enabled=True,
    max_spans=4096,
    max_bytes=16_777_216,
    collection_timeout_seconds=180,
    export_lease_seconds=120,
    max_export_attempts=8,
    retention_days=7,
)
"""The deployment defaults with Agent trace collection enabled."""


class InstalledTraceProviders(TraceProviderCatalog):
    """Only the given provider classes are installed; other supported IDs are not."""

    def __init__(self, *providers: type[TraceProvider[Any]]) -> None:
        self._providers = {provider.id: provider for provider in providers}

    @override
    def resolve(self, provider_id: str) -> type[TraceProvider[Any]]:
        provider = self._providers.get(provider_id)
        if provider is not None:
            return provider
        if provider_id in SUPPORTED_PROVIDERS:
            raise TraceProviderUnavailableError(provider_id)
        raise UnknownTraceProviderError(provider_id)


class WorkspaceBoundCipher(TracingSecretCipher):
    """Reversible ``enc:<tenant>:<value>`` tokens that only their own workspace decrypts.

    ``decrypted`` lists every token decrypted, so tests can prove when credentials were not read.
    """

    def __init__(self) -> None:
        self.decrypted: list[str] = []

    @override
    def encrypt(self, tenant_id: str, value: str) -> str:
        return f"enc:{tenant_id}:{value}"

    @override
    def decrypt(self, tenant_id: str, tokens: Sequence[str]) -> list[str]:
        prefix = f"enc:{tenant_id}:"
        if not all(token.startswith(prefix) for token in tokens):
            raise ValueError("token was encrypted for another workspace")
        self.decrypted.extend(tokens)
        return [token.removeprefix(prefix) for token in tokens]

    @override
    def mask(self, value: str) -> str:
        return obfuscated_token(value)


def deployment_provider_configs(egress: Egress) -> ProviderConfigGateway:
    """The deployment's provider configuration gateway, reaching destinations only through ``egress``."""
    return ProviderConfigGateway(
        providers=EntryPointTraceProviderCatalog(),
        codec=ProviderConfigCodec(WorkspaceTracingSecretCipher()),
        egress=egress,
    )


class NoTracingPolicies(TracingPolicyQuery):
    """Producers that hold their app's policy never look it up."""

    @override
    def policy(self, *, tenant_id: str, app_id: str) -> AppTraceSettings | None:
        raise AssertionError(f"unexpected tracing policy lookup: app_id={app_id}")


def kernel_trace_scopes(
    emitter: TraceEmitter, *, policies: TracingPolicyQuery, enterprise_enabled: bool
) -> StoredPolicyTraceScopes:
    """Trace scopes as the composition root binds them for legacy producers."""
    return StoredPolicyTraceScopes(
        TraceScopes(emitter=emitter, policies=policies, enterprise_enabled=lambda: enterprise_enabled)
    )


class RecordingTracingHooks(ApplicationTracingHooks):
    """Agent collection hooks that record every call and answer each Agent run with ``tracing``."""

    def __init__(self, tracing: ApplicationTracingContext | None) -> None:
        self.tracing = tracing
        self.agent_apps: list[AgentAppRuntimeBuildContext] = []
        self.workflow_agents: list[tuple[WorkflowAgentRuntimeBuildContext, str | None]] = []
        self.frozen_runs: list[tuple[str, str, object]] = []
        """(workflow_id, workflow_run_id, conversation_id) of each frozen run."""
        self.terminals: list[tuple[str, str, str]] = []
        """(app_id, message_id, outcome) of each captured Agent app terminal."""

    @override
    def prepare_agent_app(self, context: "AgentAppRuntimeBuildContext") -> ApplicationTracingContext | None:
        self.agent_apps.append(context)
        return self.tracing

    @override
    def prepare_workflow_agent(
        self, context: "WorkflowAgentRuntimeBuildContext", conversation_id: str | None
    ) -> ApplicationTracingContext | None:
        self.workflow_agents.append((context, conversation_id))
        return self.tracing

    @override
    def freeze_workflow_run(
        self,
        entity: "AdvancedChatAppGenerateEntity | WorkflowAppGenerateEntity",
        *,
        workflow_id: str,
        workflow_run_id: str,
        conversation_id: object,
        graph_data: object,
    ) -> None:
        self.frozen_runs.append((workflow_id, workflow_run_id, conversation_id))

    @override
    def capture_agent_app_terminal(
        self,
        *,
        tenant_id: str,
        app_id: str,
        message_id: str,
        outcome: Literal["succeeded", "failed", "cancelled"],
        output: str | None,
    ) -> None:
        self.terminals.append((app_id, message_id, outcome))


class _NoStoredPolicies(TracingPolicyQuery):
    @override
    def policy(self, *, tenant_id: str, app_id: str) -> AppTraceSettings | None:
        return None


class _NoConsumer:
    def emit(self, event: TraceEvent) -> None:
        raise AssertionError(f"no scope exists, so nothing emits: kind={event.payload.kind}")


def untraced_scopes() -> TraceScopes:
    """The scopes of a deployment where no app traces and enterprise telemetry is off."""
    return TraceScopes(emitter=_NoConsumer(), policies=_NoStoredPolicies(), enterprise_enabled=lambda: False)
