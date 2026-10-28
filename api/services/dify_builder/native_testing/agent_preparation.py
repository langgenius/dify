"""Protected initial preparation and real persisted-Run binding, without execution admission."""

from dataclasses import dataclass
from typing import TYPE_CHECKING, Protocol

from dify_agent.client import DifyAgentClientError
from dify_agent.protocol.native_testing import (
    AgentParentNodeRef as WireParent,
)
from dify_agent.protocol.native_testing import (
    AgentPreparedConfigResponse,
    AgentPrepareRunPayload,
    AgentPrepareRunResponse,
    AgentReadPreparedConfigPayload,
    AgentRuntimeIdentity,
    ReadAgentRuntimeIdentity,
)

from runtime_contracts.builder.execution import (
    BuilderExecutionPolicyError,
    canonical_digest,
)
from runtime_contracts.builder.native.agent_contracts import (
    AgentDefinitionReceipt,
    AgentNodeAssociation,
    AgentParentNodeRef,
    AgentStartPreparation,
)

if TYPE_CHECKING:
    from services.dify_builder.native_testing.agent_runtime_config import (
        NativeAgentRuntimeConfigBuilder,
    )
    from services.dify_builder.native_testing.agent_workspace import (
        AgentTestWorkspaceService,
    )
    from services.dify_builder.native_testing.runtime_bridge import (
        NativeNodePreparation,
    )
    from services.dify_builder.native_testing.state_store import (
        NativeExecutionStateStore,
    )


class AgentRuntimeIdentityReader(Protocol):
    def read_run_identity_sync(self, run_id: str, selection: ReadAgentRuntimeIdentity) -> AgentRuntimeIdentity: ...


@dataclass
class AgentPreparationService:
    state_store: "NativeExecutionStateStore"
    backend: AgentRuntimeIdentityReader
    workspace: "AgentTestWorkspaceService | None"
    config_builder: "NativeAgentRuntimeConfigBuilder | None"

    def prepare_initial(self, *, association: "NativeNodePreparation") -> AgentStartPreparation:
        from services.dify_builder.native_testing.state_store import _agent_boundary

        with _agent_boundary():
            return self._prepare_initial(association=association)

    def _prepare_initial(self, *, association: "NativeNodePreparation") -> AgentStartPreparation:
        if self.workspace is None or self.config_builder is None:
            raise BuilderExecutionPolicyError("native_agent_preparation_unavailable")
        context = association.resolve()
        node = association.bound_node
        definition = self.config_builder.load_definition(context=context, node_id=association.node_id)
        definition_receipt = AgentDefinitionReceipt(association.node_id, definition.stamp)
        # The bound node's own mutable data cannot override the stored published graph.
        nodes = context.graph.get("nodes")
        if not isinstance(nodes, list):
            raise BuilderExecutionPolicyError("native_agent_owner_mismatch")
        selected = next(
            (item for item in nodes if isinstance(item, dict) and item.get("id") == association.node_id),
            None,
        )
        if selected is None or not isinstance(selected.get("data"), dict):
            raise BuilderExecutionPolicyError("native_agent_owner_mismatch")
        from core.workflow.nodes.agent_v2.entities import DifyAgentNodeData

        expected_node = DifyAgentNodeData.model_validate(selected["data"])
        bound_data = node.node_data.model_dump(mode="json")
        if node.node_data != expected_node:
            raise BuilderExecutionPolicyError("native_agent_config_mismatch")
        inputs = self.config_builder.typed_inputs(runtime_state=association.runtime_state, definition=definition)
        execution_id = association.execution_id
        input_ref = self.state_store.store_node_inputs(
            ref=context.ref,
            generation=context.generation,
            native_execution_id=execution_id,
            inputs=inputs,
        )
        parent = AgentParentNodeRef(
            ref=context.ref,
            execution_id=execution_id,
            input_result_ref=input_ref,
            input_digest=canonical_digest(inputs),
        )
        workspace = self.workspace.prepare(
            ref=context.ref,
            pinned_snapshot_id=definition.snapshot_id,
            input_file_refs=(),
        )
        request = self.config_builder.compose(
            context=context,
            definition=definition,
            parent_node=parent,
            workspace=workspace,
            inputs=inputs,
        )
        if (
            association.bound_node.node_data.model_dump(mode="json") != bound_data
            or association.resolve() != context
            or association.execution_id != execution_id
            or self.config_builder.load_definition(context=context, node_id=association.node_id) != definition
            or self.config_builder.typed_inputs(runtime_state=association.runtime_state, definition=definition)
            != inputs
        ):
            raise BuilderExecutionPolicyError("native_agent_owner_mismatch")
        config = request.model_dump(mode="json", include={"composition", "session_snapshot"})
        claim = self.state_store.claim_agent_create(
            ref=context.ref,
            parent_node=parent,
            expected_invocation_generation=context.generation,
            config=config,
            definition_receipt=definition_receipt,
        )
        return AgentStartPreparation(claim, parent, request)

    def read_prepared_config(self, *, payload: AgentReadPreparedConfigPayload) -> AgentPreparedConfigResponse:
        parent = AgentParentNodeRef.model_validate(payload.parent_node.model_dump(mode="json"))
        owned = self.state_store.load_prepared_config(ref=parent.ref, parent_node=parent, config_ref=payload.config_ref)
        return AgentPreparedConfigResponse(
            parent_node=WireParent.model_validate(parent.model_dump(mode="json")),
            config_ref=owned.config_ref,
            config_digest=owned.config_digest,
            config=owned.config,
        )

    def bind_created_run(self, *, payload: AgentPrepareRunPayload) -> AgentPrepareRunResponse:
        parent = AgentParentNodeRef.model_validate(payload.parent_node.model_dump(mode="json"))
        context = self.state_store.load_context(ref=parent.ref)
        owned = self.state_store.load_prepared_config(ref=parent.ref, parent_node=parent, config_ref=None)
        if owned.config_digest != payload.request_digest:
            raise BuilderExecutionPolicyError("native_agent_config_mismatch")
        selection = ReadAgentRuntimeIdentity(parent_node=payload.parent_node, request_digest=owned.config_digest)
        try:
            actual = AgentRuntimeIdentity.model_validate(
                self.backend.read_run_identity_sync(payload.agent_run_id, selection).model_dump(mode="json")
            )
        except (DifyAgentClientError, ValueError, BuilderExecutionPolicyError):
            raise BuilderExecutionPolicyError("native_agent_identity_unavailable") from None
        if (
            actual.run_id,
            actual.execution_mode,
            actual.native_test_profile,
            actual.parent_node,
            actual.request_digest,
            actual.agent_generation,
        ) != (
            payload.agent_run_id,
            "builder_test",
            self.config_builder.profile if self.config_builder is not None else "isolated",
            payload.parent_node,
            owned.config_digest,
            0,
        ):
            raise BuilderExecutionPolicyError("native_agent_identity_mismatch")
        # Backend HTTP and all decryption/readback happened outside the root writer.
        # Recheck complete current ownership and bytes after that async boundary.
        current = self.state_store.load_prepared_config(ref=parent.ref, parent_node=parent, config_ref=owned.config_ref)
        if current != owned or self.state_store.load_context(ref=parent.ref) != context:
            raise BuilderExecutionPolicyError("native_agent_owner_mismatch")
        association = AgentNodeAssociation(
            parent_node=parent,
            workflow_native_run_id=owned.workflow_native_run_id,
            agent_run_id=actual.run_id,
            config_ref=owned.config_ref,
            config_digest=owned.config_digest,
            pinned_snapshot_id=owned.workspace.pinned_snapshot_id,
            home_snapshot_id=owned.workspace.home_snapshot_id,
            workspace=owned.workspace,
        )
        selected = self.state_store.bind_agent_run(
            ref=parent.ref,
            parent_node=parent,
            expected_invocation_generation=context.generation,
            association=association,
        )
        return AgentPrepareRunResponse(
            config_ref=owned.config_ref,
            config_digest=owned.config_digest,
            association_object_ref=selected,
        )


def agent_preparation_for_ref(ref):
    """Shared service auth identifies the backend; actor always comes from stored SQL."""
    from sqlalchemy import select
    from sqlalchemy.orm import Session

    from core.dify_builder.models import Actor
    from extensions.ext_database import db
    from models.dify_builder import DifyBuilderExecutionRequest
    from services.dify_builder.wiring import build_native_agent_preparation_service

    with Session(db.engine) as session:
        row = session.scalar(
            select(DifyBuilderExecutionRequest).where(DifyBuilderExecutionRequest.id == ref.request_id)
        )
        if row is None or row.context_digest != ref.context_digest:
            raise BuilderExecutionPolicyError("native_agent_owner_mismatch")
        actor = Actor(account_id=row.actor_id, tenant_id=row.tenant_id)
        profile = row.context.get("profile", {}).get("profile_id")
    if profile == "builder-agent-confirmed-v1":
        from services.dify_builder.native_testing.agent_confirmed_workspace import build_confirmed_agent_preparation
        from services.dify_builder.wiring import _NativeAgentIdentityReader

        return build_confirmed_agent_preparation(actor=actor, backend=_NativeAgentIdentityReader())
    return build_native_agent_preparation_service(actor=actor)
