"""Adopt an existing ordinary Workflow Agent workspace for confirmed control.

This module allocates no workspace and asserts no isolation or physical native
scope. The normal node/session owner has already created the real binding.
"""

from dataclasses import asdict

from sqlalchemy import select

from models.agent import (
    Agent,
    AgentConfigSnapshot,
    AgentConfigVersionKind,
    AgentHomeSnapshot,
    AgentWorkingResourceStatus,
    AgentWorkspace,
    AgentWorkspaceBinding,
    WorkflowAgentNodeBinding,
)
from models.dify_builder import DifyBuilderExecutionRequest
from models.dify_builder_native_tests import NativeTestInvocation
from models.workflow import WorkflowNodeExecutionModel, WorkflowRun
from services.dify_builder.execution_contracts import BuilderExecutionPolicyError, canonical_digest
from services.dify_builder.native_testing.agent_contracts import (
    AgentDefinitionReceipt,
    AgentStartPreparation,
    AgentTestWorkspaceRef,
)
from services.dify_builder.native_testing.agent_runtime_config import NativeAgentRuntimeConfigBuilder
from services.dify_builder.native_testing.private_reads import validate_invocation_workflow

ALLOCATION = "_agent_confirmed_workspace_v1"


def current_confirmed_workspace(*, session, owned, context, allocation, definition_receipt=None):
    """Current complete SQL owner chain, usable inside the existing root lock."""
    from core.workflow.nodes.agent_v2.session_store import WorkflowAgentSessionScope
    from services.agent import access_service
    from services.agent.workspace_service import AgentWorkspaceService

    request = session.get(DifyBuilderExecutionRequest, context.ref.request_id)
    if request is None or request.context.get("profile", {}).get("profile_id") != "builder-agent-confirmed-v1":
        raise BuilderExecutionPolicyError("native_agent_profile_mismatch")
    if not isinstance(allocation, dict) or set(allocation) != {"scope", "workspace"}:
        raise BuilderExecutionPolicyError("native_workspace_owner_mismatch")
    scope = WorkflowAgentSessionScope(**allocation["scope"])
    workspace_ref = AgentTestWorkspaceRef.model_validate(allocation["workspace"])
    if workspace_ref.workspace_generation != 0:
        raise BuilderExecutionPolicyError("native_workspace_owner_mismatch")
    if (
        scope.tenant_id,
        scope.app_id,
        scope.workflow_id,
        scope.workflow_run_id,
        scope.conversation_id,
        scope.agent_config_snapshot_id,
    ) != (
        context.tenant_id,
        context.app_id,
        context.workflow_id,
        context.native_run_id,
        None,
        workspace_ref.pinned_snapshot_id,
    ):
        raise BuilderExecutionPolicyError("native_workspace_owner_mismatch")
    run = session.get(WorkflowRun, context.native_run_id)
    execution = session.get(WorkflowNodeExecutionModel, scope.node_execution_id)
    if (
        run is None
        or execution is None
        or (run.tenant_id, run.app_id, run.workflow_id, run.created_by)
        != (context.tenant_id, context.app_id, context.workflow_id, context.actor_id)
        or (
            execution.tenant_id,
            execution.app_id,
            execution.workflow_id,
            execution.workflow_run_id,
            execution.node_id,
            execution.agent_workspace_binding_id,
        )
        != (
            context.tenant_id,
            context.app_id,
            context.workflow_id,
            context.native_run_id,
            scope.node_id,
            workspace_ref.binding_id,
        )
    ):
        raise BuilderExecutionPolicyError("native_agent_owner_mismatch")
    binding = AgentWorkspaceService.get_active_binding(
        session=session,
        tenant_id=context.tenant_id,
        binding_id=workspace_ref.binding_id,
        expected_owner_scope=scope.workspace_owner,
    )
    workspace = session.get(AgentWorkspace, workspace_ref.workspace_id)
    snapshot = session.get(AgentConfigSnapshot, workspace_ref.pinned_snapshot_id)
    home_id = workspace_ref.home_snapshot_id
    home = session.get(AgentHomeSnapshot, home_id) if home_id is not None else None
    agent = session.get(Agent, scope.agent_id)
    if binding is None or workspace is None or snapshot is None or agent is None:
        raise BuilderExecutionPolicyError("native_workspace_owner_mismatch")
    if home_id is not None and (
        home is None
        or (home.tenant_id, home.agent_id, home.status)
        != (context.tenant_id, scope.agent_id, AgentWorkingResourceStatus.ACTIVE)
    ):
        raise BuilderExecutionPolicyError("native_agent_pin_mismatch")
    if (
        binding.workspace_id,
        binding.agent_id,
        binding.base_home_snapshot_id,
        binding.agent_config_version_id,
        binding.agent_config_version_kind,
        binding.backend_binding_ref,
        workspace.backend_workspace_ref,
        snapshot.tenant_id,
        snapshot.agent_id,
        snapshot.home_snapshot_id,
        agent.tenant_id,
        agent.active_config_snapshot_id,
    ) != (
        workspace_ref.workspace_id,
        scope.agent_id,
        home_id,
        snapshot.id,
        AgentConfigVersionKind.SNAPSHOT,
        workspace_ref.backend_binding_ref,
        workspace_ref.backend_workspace_ref,
        context.tenant_id,
        scope.agent_id,
        home_id,
        context.tenant_id,
        snapshot.id,
    ):
        raise BuilderExecutionPolicyError("native_agent_pin_mismatch")
    workflow = validate_invocation_workflow(
        session, tenant_id=context.tenant_id, app_id=context.app_id, workflow_id=context.workflow_id
    )
    node_binding = session.scalar(
        select(WorkflowAgentNodeBinding).where(
            WorkflowAgentNodeBinding.id == scope.workflow_agent_binding_id,
            WorkflowAgentNodeBinding.tenant_id == context.tenant_id,
            WorkflowAgentNodeBinding.app_id == context.app_id,
            WorkflowAgentNodeBinding.workflow_id == context.workflow_id,
            WorkflowAgentNodeBinding.workflow_version == workflow.version,
            WorkflowAgentNodeBinding.node_id == scope.node_id,
            WorkflowAgentNodeBinding.agent_id == scope.agent_id,
            WorkflowAgentNodeBinding.current_snapshot_id == snapshot.id,
        )
    )
    if node_binding is None:
        raise BuilderExecutionPolicyError("native_agent_pin_mismatch")
    access_service.require_builder_agent_access(
        session=session, tenant_id=context.tenant_id, actor_id=context.actor_id, app_id=context.app_id
    )
    from models.agent_config_entities import AgentSoulConfig, WorkflowNodeJobConfig

    nodes = [node for node in context.graph.get("nodes", []) if node.get("id") == scope.node_id]
    if len(nodes) != 1:
        raise BuilderExecutionPolicyError("native_agent_pin_mismatch")
    stamp = canonical_digest(
        {
            "node": nodes[0],
            "soul": AgentSoulConfig.model_validate(snapshot.config_snapshot_dict).model_dump(mode="json"),
            "job": WorkflowNodeJobConfig.model_validate(node_binding.node_job_config_dict).model_dump(mode="json"),
        }
    )
    if definition_receipt is not None and (definition_receipt.node_id, definition_receipt.stamp) != (
        scope.node_id,
        stamp,
    ):
        raise BuilderExecutionPolicyError("native_agent_owner_mismatch")
    return workspace_ref, canonical_digest({"allocation": allocation, "definition": stamp})


def prepare_confirmed_agent_request(
    *, service, ref, parent_node, node_id, stored_session, inputs, request=None
) -> AgentStartPreparation:
    """Persist an inert request using the real normal session owner, before create."""
    context = service.state_store.load_context(ref=ref)
    loader = service.state_store.loader
    builder = NativeAgentRuntimeConfigBuilder(loader=loader, profile="confirmed")
    definition = builder.load_definition(context=context, node_id=node_id)
    if (
        stored_session.scope.node_id != node_id
        or stored_session.scope.node_execution_id != parent_node.execution_id
        or parent_node.ref != ref
    ):
        raise BuilderExecutionPolicyError("native_agent_owner_mismatch")
    if canonical_digest(inputs) != parent_node.input_digest:
        raise BuilderExecutionPolicyError("native_journal_input_mismatch")
    with loader.session_factory() as session:
        binding = session.get(AgentWorkspaceBinding, stored_session.binding_id)
        workspace = session.get(AgentWorkspace, stored_session.workspace_id)
        if binding is None or workspace is None:
            raise BuilderExecutionPolicyError("native_pinned_home_unavailable")
        workspace_ref = AgentTestWorkspaceRef(
            binding_id=binding.id,
            workspace_id=workspace.id,
            backend_binding_ref=binding.backend_binding_ref,
            backend_workspace_ref=workspace.backend_workspace_ref,
            pinned_snapshot_id=definition.snapshot_id,
            home_snapshot_id=binding.base_home_snapshot_id,
            workspace_generation=0,
        )
    allocation = {"scope": asdict(stored_session.scope), "workspace": workspace_ref.model_dump(mode="json")}
    with loader.locked(ref=ref) as (session, owned, _scope):
        current_confirmed_workspace(session=session, owned=owned, context=context, allocation=allocation)
        invocation = session.scalar(
            select(NativeTestInvocation).where(
                NativeTestInvocation.tenant_id == owned.tenant_id,
                NativeTestInvocation.request_id == ref.request_id,
                NativeTestInvocation.invocation_id == ref.invocation_id,
                NativeTestInvocation.active.is_(True),
            )
        )
        if invocation is None:
            raise BuilderExecutionPolicyError("native_invocation_mismatch")
        previous = invocation.bindings.get(ALLOCATION)
        if previous is not None and previous != allocation:
            raise BuilderExecutionPolicyError("native_agent_single_workspace_limit")
        invocation.bindings = {**invocation.bindings, ALLOCATION: allocation}
    if request is None:
        request = builder.compose(
            context=context, definition=definition, parent_node=parent_node, workspace=workspace_ref, inputs=inputs
        )
    if (
        request.execution_mode != "builder_test"
        or request.native_test_profile != "confirmed"
        or request.native_test_ref is None
        or request.native_parent_node is None
        or request.native_test_ref.model_dump(mode="json") != parent_node.ref.model_dump(mode="json")
        or request.native_parent_node.model_dump(mode="json") != parent_node.model_dump(mode="json")
    ):
        raise BuilderExecutionPolicyError("native_agent_profile_mismatch")
    config = request.model_dump(mode="json", include={"composition", "session_snapshot"})
    claim = service.state_store.claim_agent_create(
        ref=ref,
        parent_node=parent_node,
        expected_invocation_generation=context.generation,
        config=config,
        definition_receipt=AgentDefinitionReceipt(node_id, definition.stamp),
    )
    return AgentStartPreparation(claim=claim, parent_node=parent_node, request=request)


def build_confirmed_agent_preparation(*, actor, backend):
    """Read/bind callbacks and normal-workspace preparation, without A7 allocation."""
    from sqlalchemy.orm import sessionmaker

    from extensions.ext_database import db
    from services.dify_builder.native_testing.agent_operations import AgentOperationBindingResolver
    from services.dify_builder.native_testing.agent_preparation import AgentPreparationService
    from services.dify_builder.native_testing.repository import OwnedNativeTestLoader
    from services.dify_builder.native_testing.state_store import NativeExecutionStateStore

    loader = OwnedNativeTestLoader(
        sessionmaker(bind=db.engine, expire_on_commit=False), actor=actor, resolver=AgentOperationBindingResolver()
    )
    return AgentPreparationService(
        state_store=NativeExecutionStateStore(loader),
        backend=backend,
        workspace=None,
        config_builder=NativeAgentRuntimeConfigBuilder(loader=loader, profile="confirmed"),
    )


def load_confirmed_agent_parent(*, service, ref, execution_id):
    """Find original typed input identity; absence never overwrites a saved input.

    The independent node-input logical key exists before child-create reservation.
    Protected config without that input is corrupt/unknown and cannot start over.
    """
    from models.dify_builder_native_tests import NativePayloadObject
    from services.dify_builder.native_testing.agent_contracts import AgentParentNodeRef

    loader = service.state_store.loader
    owned = loader.load(ref=ref)
    with loader.session_factory() as session:
        row = session.scalar(
            select(NativePayloadObject).where(
                NativePayloadObject.tenant_id == owned.tenant_id,
                NativePayloadObject.request_id == ref.request_id,
                NativePayloadObject.invocation_id == ref.invocation_id,
                NativePayloadObject.kind == "result",
                NativePayloadObject.logical_key == "node-input:" + execution_id,
            )
        )
        configs = list(
            session.scalars(
                select(NativePayloadObject.id)
                .where(
                    NativePayloadObject.tenant_id == owned.tenant_id,
                    NativePayloadObject.request_id == ref.request_id,
                    NativePayloadObject.invocation_id == ref.invocation_id,
                    NativePayloadObject.kind == "result",
                    NativePayloadObject.logical_key.like("agent-config:%"),
                )
                .limit(2)
            )
        )
        input_ref = None if row is None else row.id
    if input_ref is None:
        if configs:
            raise BuilderExecutionPolicyError("native_agent_input_unavailable")
        return None
    inputs = service.state_store.load_result(ref=ref, result_ref=input_ref)
    parent = AgentParentNodeRef(
        ref=ref, execution_id=execution_id, input_result_ref=input_ref, input_digest=canonical_digest(inputs)
    )
    if configs:
        config = service.state_store.load_prepared_config(ref=ref, parent_node=parent, config_ref=None)
        if config.parent_node != parent:
            raise BuilderExecutionPolicyError("native_agent_owner_mismatch")
    loader.load(ref=ref)
    return parent
