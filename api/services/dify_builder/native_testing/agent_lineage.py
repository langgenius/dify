"""Persisted Run lineage before any credential, provider, file or config work.

Reads use the exact S1 private selection and current protected state owners. All
backend/object I/O stays outside their short SQL writers. This owner validates
lineage only; no invocation permit is spent and no physical capability is ready.
"""

from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal

from dify_agent.client import DifyAgentClientError
from dify_agent.protocol.native_testing import (
    AgentNativeTestRef,
    AgentRuntimeIdentity,
    AgentRunTransportSelection,
    ReadAgentRuntimeIdentity,
)

from runtime_contracts.builder.execution import BuilderExecutionPolicyError
from runtime_contracts.builder.native.agent_contracts import (
    AgentNodeAssociation,
    AgentParentNodeRef,
    AgentPreparedConfig,
)
from services.dify_builder.native_testing.agent_preparation import (
    AgentPreparationService,
    AgentRuntimeIdentityReader,
)


@dataclass(frozen=True, slots=True)
class AgentServicePrincipal:
    """Request-local marker constructed only after the Agent bearer authenticates."""


@dataclass(frozen=True, slots=True)
class NativeAgentEndpointContext:
    ref: AgentNativeTestRef
    config: AgentPreparedConfig
    association: AgentNodeAssociation | None
    physical_owner_ready: bool = False
    native_test_profile: Literal["isolated", "confirmed"] = "isolated"


@dataclass
class NativeAgentEndpointLineage:
    backend: AgentRuntimeIdentityReader
    preparation_for_ref: Callable[..., AgentPreparationService]

    def resolve(
        self,
        *,
        principal: AgentServicePrincipal,
        selection: AgentRunTransportSelection,
        boundary: str,
        caller: dict,
    ) -> NativeAgentEndpointContext | None:
        if not isinstance(principal, AgentServicePrincipal) or not isinstance(selection, AgentRunTransportSelection):
            raise BuilderExecutionPolicyError("native_endpoint_principal_unavailable")
        if caller.get("agent_run_id", selection.agent_run_id) != selection.agent_run_id:
            raise BuilderExecutionPolicyError("native_endpoint_owner_mismatch")
        # Capture protected ownership before identity I/O so an owner/config
        # mutation during that read cannot become the new comparison baseline.
        store = None
        parent = None
        context = None
        config = None
        association = None
        control = boundary in {"prepare-run", "prepared-config"}
        if selection.parent_node is not None:
            parent = AgentParentNodeRef.model_validate(selection.parent_node.model_dump(mode="json"))
            store = self.preparation_for_ref(parent.ref).state_store
            context = store.load_context(ref=parent.ref)
            config = store.load_prepared_config(ref=parent.ref, parent_node=parent, config_ref=None)
            association = store.discover_agent_run(ref=parent.ref, parent_node=parent)
            if config.config_digest != selection.request_digest or (association is None and not control):
                raise BuilderExecutionPolicyError("native_agent_identity_mismatch")
        try:
            readback = self.backend.read_run_identity_sync(
                selection.agent_run_id,
                ReadAgentRuntimeIdentity(
                    parent_node=selection.parent_node,
                    request_digest=selection.request_digest,
                ),
            )
            actual = AgentRuntimeIdentity.model_validate(
                readback.model_dump(mode="json") if isinstance(readback, AgentRuntimeIdentity) else readback
            )
        except (
            DifyAgentClientError,
            ValueError,
            OSError,
            TimeoutError,
            BuilderExecutionPolicyError,
        ):
            raise BuilderExecutionPolicyError("native_agent_identity_unavailable") from None
        if (
            actual.run_id,
            actual.parent_node,
            actual.request_digest,
            actual.agent_generation,
        ) != (
            selection.agent_run_id,
            selection.parent_node,
            selection.request_digest,
            selection.agent_generation,
        ):
            raise BuilderExecutionPolicyError("native_agent_identity_mismatch")
        if actual.execution_mode == "ordinary" and actual.parent_node is None:
            return None
        if (
            actual.execution_mode != "builder_test"
            or store is None
            or parent is None
            or config is None
            or context is None
        ):
            raise BuilderExecutionPolicyError("native_agent_identity_mismatch")
        # Each S1 read checks current resources/RBAC after its own object I/O.
        # Repeat across the complete private identity/object boundary as well.
        current_config = store.load_prepared_config(ref=parent.ref, parent_node=parent, config_ref=config.config_ref)
        current_association = store.discover_agent_run(ref=parent.ref, parent_node=parent)
        if (
            current_config != config
            or current_association != association
            or store.load_context(ref=parent.ref) != context
        ):
            raise BuilderExecutionPolicyError("native_agent_owner_mismatch")
        if association is not None and (
            association.parent_node != parent
            or association.agent_run_id != actual.run_id
            or association.config_ref != config.config_ref
            or association.config_digest != actual.request_digest
            or association.workflow_native_run_id != config.workflow_native_run_id
            or association.workspace != config.workspace
            or config.workflow_native_run_id != context.native_run_id
        ):
            raise BuilderExecutionPolicyError("native_agent_owner_mismatch")
        for key, expected in (
            ("tenant_id", context.tenant_id),
            ("app_id", context.app_id),
            ("user_id", context.actor_id),
            ("user_from", "account"),
        ):
            if key in caller and caller[key] != expected:
                raise BuilderExecutionPolicyError("native_endpoint_owner_mismatch")
        # Creation and an unbound config read belong to initial generation zero.
        # A resumed bound Run may re-read its immutable config before acquiring
        # the workspace; exact current identity and association were proved above.
        if control and actual.agent_generation != 0 and (boundary != "prepared-config" or association is None):
            raise BuilderExecutionPolicyError("native_agent_identity_mismatch")
        return NativeAgentEndpointContext(
            ref=AgentNativeTestRef.model_validate(parent.ref.model_dump(mode="json")),
            config=config,
            association=association,
            native_test_profile=actual.native_test_profile,
        )
