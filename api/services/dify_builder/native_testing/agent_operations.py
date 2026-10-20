"""Confirmed Agent operations at the existing API physical tool boundary.

Control endpoints never consume dispatch permission. This owner claims once at
its actual synchronous native invocation and records its real result before the
HTTP response; response loss therefore cannot turn a completed effect unknown.
"""

from collections.abc import Callable
from dataclasses import dataclass

from dify_agent.adapters.native_testing.client import AgentPhysicalDispatchPayload
from dify_agent.protocol.native_testing import AgentEffectIntent, AgentNativeTestRef, AgentOperationKey
from flask import current_app, g
from pydantic import Field, JsonValue, StrictBool
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from core.dify_builder.models import Actor
from core.tools.entities.tool_entities import ToolProviderType
from extensions.ext_database import db
from models.agent import Agent, AgentConfigSnapshot
from models.agent_config_entities import AgentSoulConfig
from models.dify_builder_native_tests import (
    NativeEffectDispatchClaim,
    NativeEffectOperation,
    NativeEffectOutcome,
    NativeInvocationState,
    NativePayloadObject,
    NativePendingAction,
    NativeTestInvocation,
)
from runtime_contracts.builder.execution import BuilderExecutionPolicyError, canonical_digest, canonical_json
from runtime_contracts.builder.native.approval_contracts import NativeApprovalProposal, NativeApprovalTerms
from runtime_contracts.builder.native.contracts import (
    EffectIntent,
    FiniteJSON,
    FrozenDTO,
    NativeTestContextRef,
    OperationKey,
    operation_digest,
)
from services.dify_builder.native_testing.agent_bridge import (
    AgentNativeTestingBridge,
    NativeAgentCredentialMaterializer,
    api_intent,
    api_permit,
    api_ref,
)
from services.dify_builder.native_testing.agent_lineage import NativeAgentEndpointContext
from services.dify_builder.native_testing.agent_runtime_config import NativeAgentRuntimeConfigBuilder
from services.dify_builder.native_testing.agent_tool_declarations import AgentToolMetadata, _metadata
from services.dify_builder.native_testing.authorization import EffectAuthorizationService
from services.dify_builder.native_testing.private_reads import validate_invocation_workflow
from services.dify_builder.native_testing.public_contracts import PendingActionDisclosure
from services.dify_builder.native_testing.repository import (
    NativeBinding,
    OwnedNativeTestLoader,
    admitted_workflow_revision,
    native_workflow_revision,
)
from services.dify_builder.native_testing.state_store import NativeExecutionStateStore, ObjectReceipt, owner_query
from services.tools.builtin_tools_manage_service import BuiltinToolManageService


@dataclass
class AgentToolDispatchOwner:
    authorization: EffectAuthorizationService
    state_store: NativeExecutionStateStore
    revalidate: Callable

    def invoke(self, *, envelope: AgentPhysicalDispatchPayload, invoke: Callable[[], JsonValue]) -> JsonValue:
        ref, intent, permit = api_ref(envelope.ref), api_intent(envelope.intent), api_permit(envelope.permit)
        self.authorization.validate_dispatch(ref=ref, intent=intent, permit=permit)
        self.revalidate(ref=ref, intent=intent)
        self.authorization.claim_dispatch(ref=ref, intent=intent, permit=permit)
        try:
            result = invoke()
            result_ref = self.state_store.store_result(ref=ref, key=intent.key, result=result)
        except BaseException:
            self.authorization.record_outcome(permit=permit, outcome="unknown", result_ref=None)
            raise
        self.authorization.record_outcome(permit=permit, outcome="completed", result_ref=result_ref)
        return result


class AgentCallAssessment(FrozenDTO):
    """Builder reasoning describes a call; it has no approval or permission field."""

    action: str = Field(min_length=1, max_length=1024)
    account_label: str | None
    target_summary: FiniteJSON
    parameters_summary: FiniteJSON
    risk_notice: str = Field(min_length=1, max_length=8192)
    destructive: StrictBool


_SHELL_BOUNDARIES = frozenset({"shell_run", "shell_wait", "shell_input", "shell_interrupt", "bootstrap", "config_pull"})


@dataclass(frozen=True)
class AgentShellCapability:
    tool_name: str
    provider_id: str
    capability_description: str
    account_ref: str | None = None
    account_label: str | None = None


@dataclass(frozen=True)
class _ShellWorkspaceContext:
    ref: NativeTestContextRef
    tenant_id: str
    actor_id: str
    app_id: str
    workflow_id: str
    native_run_id: str | None
    graph: dict


_RESOURCE_KEY = "_agent_operations_v1"
_OPACITY = "Approval covers one bounded tool invocation. Provider internal effects remain opaque."


@dataclass(frozen=True)
class AgentResolvedTool:
    """Inert current configured declaration and explicit account, never credentials."""

    provider_type: str
    provider_id: str
    tool_name: str
    credential_id: str | None
    metadata: AgentToolMetadata
    runtime_parameters: dict
    account_ref: str | None
    credential_version: str | None
    verified_plugin: bool
    account_label: str | None = None


def _resource_key(key: OperationKey) -> str:
    return "agent-intent:" + operation_digest(key)


def _sql_resource(*, session, owned, descriptor):
    """SQL-only current pin/account recheck inside the existing C02 transaction."""
    workflow = validate_invocation_workflow(
        session, tenant_id=owned.tenant_id, app_id=owned.app_id, workflow_id=owned.workflow_id
    )
    revision_context = getattr(owned, "revision_context", None)
    revision = (
        admitted_workflow_revision(workflow, revision_context)
        if revision_context
        else native_workflow_revision(workflow)
    )
    if revision != descriptor["graph_revision"]:
        raise BuilderExecutionPolicyError("native_revision_drift")
    snapshot = session.get(AgentConfigSnapshot, descriptor["snapshot_id"])
    agent = session.get(Agent, descriptor["agent_id"])
    if (
        snapshot is None
        or agent is None
        or (
            snapshot.tenant_id,
            snapshot.agent_id,
            agent.tenant_id,
            agent.active_config_snapshot_id,
            canonical_digest(AgentSoulConfig.model_validate(snapshot.config_snapshot_dict).model_dump(mode="json")),
        )
        != (
            owned.tenant_id,
            descriptor["agent_id"],
            owned.tenant_id,
            descriptor["snapshot_id"],
            descriptor["snapshot_digest"],
        )
    ):
        raise BuilderExecutionPolicyError("native_agent_pin_mismatch")
    if "shell_boundary" in descriptor:
        from services.dify_builder.native_testing.agent_confirmed_workspace import (
            ALLOCATION,
            current_confirmed_workspace,
        )

        allocation = owned.bindings.get(ALLOCATION)
        if allocation != descriptor["workspace_allocation"]:
            raise BuilderExecutionPolicyError("native_workspace_owner_mismatch")
        workspace, stamp = current_confirmed_workspace(
            session=session,
            owned=owned,
            context=_ShellWorkspaceContext(
                owned.ref,
                owned.tenant_id,
                owned.actor_id,
                owned.app_id,
                owned.workflow_id,
                descriptor["workflow_native_run_id"],
                {"nodes": [descriptor["graph_node"]]},
            ),
            allocation=allocation,
        )
        if stamp != descriptor["workspace_stamp"] or workspace.model_dump(mode="json") != descriptor["workspace"]:
            raise BuilderExecutionPolicyError("native_workspace_owner_mismatch")
    if descriptor["credential_id"] is not None:
        from configs import dify_config
        from services.tools.builder_credential_reference import select_builder_credential

        selected = select_builder_credential(
            session,
            actor=Actor(account_id=owned.actor_id, tenant_id=owned.tenant_id),
            provider_id=descriptor["provider_id"],
            credential_id=descriptor["credential_id"],
            verified_plugin=descriptor["verified_plugin"],
            revision_key=dify_config.SECRET_KEY.encode(),
        )
        if canonical_digest(selected.reference.model_dump(mode="json")) != descriptor["account_ref"]:
            raise BuilderExecutionPolicyError("native_credential_drift")


class AgentOperationBindingResolver:
    """Current SQL resources; no decryption, OAuth, runtime schema or business I/O."""

    def resolve_binding(self, *, session, owned, key):
        identity = operation_digest(key)
        descriptor = owned.bindings.get(_RESOURCE_KEY, {}).get(identity)
        if descriptor is None:
            from services.dify_builder.native_testing.http_binding import NativeHttpBindingResolver

            return NativeHttpBindingResolver().resolve_binding(session=session, owned=owned, key=key)
        frozen = NativeBinding.model_validate(owned.bindings[identity])
        if key.invocation_id != owned.ref.invocation_id or key.occurrence_path[:1] != (frozen.execution_id,):
            raise BuilderExecutionPolicyError("native_binding_mismatch")
        _sql_resource(session=session, owned=owned, descriptor=descriptor)
        return frozen

    def resolve_pending(self, **_kwargs):
        raise BuilderExecutionPolicyError("native_pending_requires_resolution")


class AgentOperationService:
    """One existing SQL operation ledger, with encrypted actual call/proposal data."""

    def __init__(self, *, loader, state_store, assessor):
        self.loader, self.state_store, self.assessor = loader, state_store, assessor
        self.bridge = AgentNativeTestingBridge(
            authorization=EffectAuthorizationService(loader), readiness=None, materializer=None, fence=None
        )
        self.bridge.fence = self.bridge.authorization
        self.bridge.settlement = self.settle
        self.bridge.validate_call = self.validate_call
        self.disclosure = self

    def _endpoint(self, ref):
        endpoint = getattr(g, "agent_runtime_context", None)
        if not isinstance(endpoint, NativeAgentEndpointContext) or api_ref(endpoint.ref) != ref:
            raise BuilderExecutionPolicyError("native_endpoint_owner_mismatch")
        if endpoint.native_test_profile != "confirmed":
            raise BuilderExecutionPolicyError("native_agent_profile_mismatch")
        from models.dify_builder import DifyBuilderExecutionRequest

        self.loader.load(ref=ref)
        with self.loader.session_factory() as session:
            request = session.get(DifyBuilderExecutionRequest, ref.request_id)
            if request is None or request.context.get("profile", {}).get("profile_id") != "builder-agent-confirmed-v1":
                raise BuilderExecutionPolicyError("native_agent_profile_mismatch")
        return endpoint

    def _definition(self, *, ref, descriptor=None):
        context = self.state_store.load_context(ref=ref)
        if descriptor is None:
            endpoint = self._endpoint(ref)
            config = endpoint.config.config
            if not isinstance(config, dict) or not isinstance(config.get("composition"), dict):
                raise BuilderExecutionPolicyError("native_agent_config_mismatch")
            composition = config["composition"]
            assert isinstance(composition, dict)
            layers = composition.get("layers")
            if not isinstance(layers, list):
                raise BuilderExecutionPolicyError("native_agent_config_mismatch")
            contexts = [
                item["config"]
                for item in layers
                if isinstance(item, dict)
                and item.get("name") == "execution_context"
                and isinstance(item.get("config"), dict)
            ]
            if len(contexts) != 1:
                raise BuilderExecutionPolicyError("native_agent_config_mismatch")
            node_id = contexts[0].get("node_id")
        else:
            node_id = descriptor["node_id"]
        if not isinstance(node_id, str) or not node_id:
            raise BuilderExecutionPolicyError("native_agent_config_mismatch")
        definition = NativeAgentRuntimeConfigBuilder(loader=self.loader).load_definition(
            context=context, node_id=node_id
        )
        return context, definition

    def _tool(self, *, ref, target, descriptor=None):
        context, definition = self._definition(ref=ref, descriptor=descriptor)
        if not isinstance(target, dict) or set(target) != {"provider_type", "provider_id", "tool_name"}:
            raise BuilderExecutionPolicyError("native_agent_target_mismatch")
        selected = [
            item
            for item in definition.soul.tools.dify_tools
            if item.enabled
            and item.provider_type.value == target["provider_type"]
            and (item.provider_id or f"{item.plugin_id}/{item.provider}") == target["provider_id"]
            and item.tool_name in (None, target["tool_name"])
        ]
        if len(selected) != 1:
            raise BuilderExecutionPolicyError("agent_tool_declaration_not_found")
        configured = selected[0]
        if configured.provider_type not in {ToolProviderType.PLUGIN, ToolProviderType.BUILT_IN}:
            # Their dynamic runtime/configuration owners need separate effect phases.
            raise BuilderExecutionPolicyError("native_agent_tool_preparation_unavailable")
        declarations = _metadata(
            tenant_id=context.tenant_id,
            provider_type=configured.provider_type,
            provider_id=target["provider_id"],
            tool_name=target["tool_name"],
        )
        if len(declarations) != 1 or declarations[0].entity.has_runtime_parameters:
            raise BuilderExecutionPolicyError("native_agent_tool_preparation_unavailable")
        metadata = declarations[0]
        credential_id = configured.credential_ref.id if configured.credential_ref else None
        selected_account = None
        verified = False
        if metadata.requires_credentials:
            if credential_id is None:
                raise BuilderExecutionPolicyError("needs_setup")
            from core.plugin.plugin_service import PluginService

            verified = PluginService.is_plugin_verified(context.tenant_id, metadata.implementation_revision) is True
            selected_account = BuiltinToolManageService.load_builder_credential(
                actor=self.loader.actor,
                provider_id=target["provider_id"],
                credential_id=credential_id,
                verified_plugin=verified,
            )
        elif credential_id is not None:
            raise BuilderExecutionPolicyError("native_credential_drift")
        account = (
            NativeAgentCredentialMaterializer.account_ref(selected_account) if selected_account is not None else None
        )
        tool = AgentResolvedTool(
            configured.provider_type.value,
            target["provider_id"],
            target["tool_name"],
            credential_id,
            metadata,
            dict(configured.runtime_parameters),
            account,
            account,
            verified,
            selected_account.snapshot.reference.alias if selected_account is not None else None,
        )
        return context, definition, tool, selected_account

    def prepare_intent(
        self, *, ref: AgentNativeTestRef, key: AgentOperationKey, boundary: str, target, parameters
    ) -> AgentEffectIntent:
        native_ref = api_ref(ref)
        native_key = OperationKey.model_validate(key.model_dump(mode="json"))
        if (
            boundary not in {"core_tool", "model", *_SHELL_BOUNDARIES}
            or native_key.invocation_id != native_ref.invocation_id
            or not isinstance(parameters, dict)
        ):
            raise BuilderExecutionPolicyError("native_agent_boundary_unavailable")
        endpoint = self._endpoint(native_ref)
        parent = endpoint.config.parent_node
        if native_key.occurrence_path[:1] != (parent.execution_id,):
            raise BuilderExecutionPolicyError("native_agent_owner_mismatch")
        existing = self.loader.load(ref=native_ref)
        if operation_digest(native_key) in existing.bindings:
            saved, _proposal, _assessment = self.snapshot(ref=native_ref, key=native_key)
            if canonical_json(saved.target) != canonical_json(target) or canonical_json(
                saved.parameters
            ) != canonical_json(parameters):
                raise BuilderExecutionPolicyError("native_intent_conflict")
            self.revalidate(ref=native_ref, intent=saved)
            return AgentEffectIntent.model_validate(saved.model_dump(mode="json"))
        if boundary in _SHELL_BOUNDARIES:
            return self._prepare_shell(
                ref=native_ref, key=native_key, boundary=boundary, target=target, parameters=parameters, parent=parent
            )
        if boundary == "model":
            return self._prepare_model(
                ref=native_ref, key=native_key, target=target, parameters=parameters, parent=parent
            )
        context, definition, tool, selected_account = self._tool(ref=native_ref, target=target)
        # Expiry inspection is metadata only. Never let ordinary runtime silently refresh.
        if selected_account is not None and NativeAgentCredentialMaterializer.refresh_due(selected_account):
            raise BuilderExecutionPolicyError("native_refresh_continuation_required")
        if any(
            parameter.type.value == "secret-input" and parameter.name in tool.runtime_parameters
            for parameter in tool.metadata.entity.parameters or []
        ):
            raise BuilderExecutionPolicyError("native_agent_tool_preparation_unavailable")
        assessment = AgentCallAssessment.model_validate(
            self.assessor(context=context, definition=definition, tool=tool, target=target, parameters=parameters)
        )
        intent = EffectIntent(
            key=native_key,
            kind="tool",
            resource_ref=canonical_digest(
                {"snapshot": definition.snapshot_id, "target": target, "credential": tool.credential_id}
            ),
            implementation_revision=tool.metadata.implementation_revision,
            account_ref=tool.account_ref,
            target=target,
            parameters=parameters,
            input_digest=parent.input_digest,
            capability_digest=canonical_digest(
                {
                    "definition": definition.stamp,
                    "declaration": tool.metadata.entity.model_dump(mode="json"),
                    "runtime": tool.runtime_parameters,
                }
            ),
        )
        owned = self.loader.load(ref=native_ref)
        proposal = NativeApprovalProposal(
            key=native_key,
            terms=NativeApprovalTerms(
                max_calls=1, max_dispatches=1, max_cost_units=1, expires_at=owned.expires_at.isoformat()
            ),
        )
        descriptor = {
            "node_id": definition.node_id,
            "agent_id": definition.agent_id,
            "snapshot_id": definition.snapshot_id,
            "snapshot_digest": canonical_digest(definition.soul.model_dump(mode="json")),
            "graph_revision": context.graph_revision,
            "credential_id": tool.credential_id,
            "provider_id": tool.provider_id,
            "account_ref": tool.account_ref,
            "verified_plugin": tool.verified_plugin,
        }
        binding = NativeBinding(
            intent_digest=canonical_digest(intent.model_dump(mode="json")),
            kind="tool",
            resource_ref=intent.resource_ref,
            implementation_revision=intent.implementation_revision,
            account_ref=intent.account_ref,
            capability_digest=intent.capability_digest,
            resource_version=definition.stamp,
            credential_version=tool.credential_version,
            isolated=False,
            egress=True,
            new_data=True,
            destructive=assessment.destructive,
            approval_scope="operation",
            cost_units=1,
            budget={},
            execution_id=parent.execution_id,
            invocation_digest=canonical_digest(intent.model_dump(mode="json")),
        )
        return self._persist(
            ref=native_ref,
            intent=intent,
            proposal=proposal,
            assessment=assessment,
            descriptor=descriptor,
            binding=binding,
        )

    def _shell(self, *, ref, boundary, target, parameters, descriptor=None):
        """Read immutable composition and recheck current complete workspace ownership."""
        from services.dify_builder.native_testing.agent_confirmed_workspace import (
            ALLOCATION,
            current_confirmed_workspace,
        )

        context, definition = self._definition(ref=ref, descriptor=descriptor)
        if descriptor is None:
            endpoint = self._endpoint(ref)
            prepared = self.state_store.load_prepared_config(
                ref=ref, parent_node=endpoint.config.parent_node, config_ref=endpoint.config.config_ref
            )
            if prepared != endpoint.config:
                raise BuilderExecutionPolicyError("native_agent_owner_mismatch")
        else:
            # Public approval reads have no runtime HTTP request. Reconstruct
            # only from the persisted descriptor and the protected state owner.
            from runtime_contracts.builder.native.agent_contracts import AgentParentNodeRef

            parent = AgentParentNodeRef.model_validate(descriptor["parent_node"])
            if parent.ref != ref:
                raise BuilderExecutionPolicyError("native_agent_owner_mismatch")
            prepared = self.state_store.load_prepared_config(
                ref=ref, parent_node=parent, config_ref=descriptor["config_ref"]
            )
            endpoint = NativeAgentEndpointContext(
                ref=AgentNativeTestRef.model_validate(ref.model_dump(mode="json")),
                config=prepared,
                association=None,
                native_test_profile="confirmed",
            )
        composition = prepared.config.get("composition") if isinstance(prepared.config, dict) else None
        layers = composition.get("layers") if isinstance(composition, dict) else None
        if not isinstance(layers, list):
            raise BuilderExecutionPolicyError("native_agent_config_mismatch")
        configs = {}
        for name in ("shell", "runtime", "config"):
            selected = [item.get("config") for item in layers if isinstance(item, dict) and item.get("name") == name]
            if len(selected) != 1 or not isinstance(selected[0], dict):
                raise BuilderExecutionPolicyError("native_agent_config_mismatch")
            configs[name] = selected[0]
        if configs["runtime"].get("backend_binding_ref") != prepared.workspace.backend_binding_ref:
            raise BuilderExecutionPolicyError("native_workspace_owner_mismatch")
        expected = {"shell": "shell"}
        if boundary == "bootstrap":
            expected["runtime"] = configs["shell"].get("runtime")
        elif boundary == "config_pull":
            if not isinstance(target, dict) or target.get("kind") not in {"skill", "file"}:
                raise BuilderExecutionPolicyError("native_agent_target_mismatch")
            expected["kind"] = target["kind"]
            if not configs["config"].get("mentioned_" + target["kind"] + "_names"):
                raise BuilderExecutionPolicyError("native_agent_config_asset_unavailable")
        if target != expected or boundary not in _SHELL_BOUNDARIES:
            raise BuilderExecutionPolicyError("native_agent_target_mismatch")
        if boundary in {"bootstrap", "config_pull", "shell_run"} and not isinstance(parameters.get("script"), str):
            raise BuilderExecutionPolicyError("native_agent_target_mismatch")
        with self.loader.locked(ref=ref) as (session, owned, _scope):
            workspace, stamp = current_confirmed_workspace(
                session=session, owned=owned, context=context, allocation=owned.bindings.get(ALLOCATION)
            )
        if workspace != prepared.workspace:
            raise BuilderExecutionPolicyError("native_workspace_owner_mismatch")
        configs["workspace_stamp"] = stamp
        return context, definition, endpoint, configs

    def _prepare_shell(self, *, ref, key, boundary, target, parameters, parent):
        from services.dify_builder.native_testing.agent_confirmed_workspace import ALLOCATION

        context, definition, endpoint, configs = self._shell(
            ref=ref, boundary=boundary, target=target, parameters=parameters
        )
        owned = self.loader.load(ref=ref)
        assessment = AgentCallAssessment.model_validate(
            self.assessor(
                context=context,
                definition=definition,
                tool=AgentShellCapability(
                    boundary,
                    "workspace-shell",
                    "Execute a bounded shell operation in the Agent workspace. "
                    "Configured CLI tools, skills and files: "
                    + canonical_json({"shell": configs["shell"], "config": configs.get("config")}).decode(),
                ),
                target=target,
                parameters=parameters,
            )
        )
        workspace = endpoint.config.workspace.model_dump(mode="json")
        intent = EffectIntent(
            key=key,
            kind="bootstrap" if boundary == "bootstrap" else "shell",
            resource_ref=endpoint.config.workspace.binding_id,
            implementation_revision=definition.snapshot_id,
            account_ref=None,
            target=target,
            parameters=parameters,
            input_digest=parent.input_digest,
            capability_digest=canonical_digest(
                {
                    "definition": definition.stamp,
                    "workspace": workspace,
                    "composition": endpoint.config.config_digest,
                    "boundary": boundary,
                }
            ),
        )
        descriptor = {
            "node_id": definition.node_id,
            "agent_id": definition.agent_id,
            "snapshot_id": definition.snapshot_id,
            "snapshot_digest": canonical_digest(definition.soul.model_dump(mode="json")),
            "graph_revision": context.graph_revision,
            "credential_id": None,
            "provider_id": "workspace-shell",
            "account_ref": None,
            "verified_plugin": False,
            "shell_boundary": boundary,
            "workspace": workspace,
            "workspace_allocation": owned.bindings.get(ALLOCATION),
            "workspace_stamp": configs.get("workspace_stamp"),
            "workflow_native_run_id": context.native_run_id,
            "graph_node": next(node for node in context.graph["nodes"] if node["id"] == definition.node_id),
            "composition_digest": endpoint.config.config_digest,
            "parent_node": parent.model_dump(mode="json"),
            "config_ref": endpoint.config.config_ref,
        }
        binding = NativeBinding(
            intent_digest=canonical_digest(intent.model_dump(mode="json")),
            kind=intent.kind,
            resource_ref=intent.resource_ref,
            implementation_revision=intent.implementation_revision,
            account_ref=None,
            capability_digest=intent.capability_digest,
            resource_version=definition.stamp,
            credential_version=None,
            isolated=False,
            egress=True,
            new_data=True,
            destructive=assessment.destructive,
            approval_scope="operation",
            cost_units=1,
            budget={},
            execution_id=parent.execution_id,
            invocation_digest=canonical_digest(intent.model_dump(mode="json")),
        )
        proposal = NativeApprovalProposal(
            key=key,
            terms=NativeApprovalTerms(
                max_calls=1, max_dispatches=1, max_cost_units=1, expires_at=owned.expires_at.isoformat()
            ),
        )
        return self._persist(
            ref=ref, intent=intent, proposal=proposal, assessment=assessment, descriptor=descriptor, binding=binding
        )

    def claim_shell_dispatch(self, *, envelope):
        """The run-bound runtime spends once immediately before its leased command."""
        ref, intent, permit = api_ref(envelope.ref), api_intent(envelope.intent), api_permit(envelope.permit)
        self._endpoint(ref)
        if intent.kind not in {"shell", "bootstrap"}:
            raise BuilderExecutionPolicyError("native_agent_boundary_unavailable")
        self.revalidate(ref=ref, intent=intent)
        self.bridge.authorization.claim_dispatch(ref=ref, intent=intent, permit=permit)

    def validate_claimed_shell(self, *, envelope):
        """Subordinate config reads require an active claimed parent shell operation."""
        ref, intent, permit = api_ref(envelope.ref), api_intent(envelope.intent), api_permit(envelope.permit)
        endpoint = self._endpoint(ref)
        if intent.kind not in {"shell", "bootstrap"}:
            raise BuilderExecutionPolicyError("native_agent_boundary_unavailable")
        self.revalidate(ref=ref, intent=intent)
        self.bridge.authorization.validate_dispatch(ref=ref, intent=intent, permit=permit)
        owned = self.loader.load(ref=ref)
        with self.loader.session_factory() as session:
            claim = session.scalar(
                owner_query(NativeEffectDispatchClaim, ref, owned.tenant_id).where(
                    NativeEffectDispatchClaim.operation_id == permit.operation_id,
                    NativeEffectDispatchClaim.attempt_id == permit.attempt_id,
                )
            )
            outcome = session.scalar(
                owner_query(NativeEffectOutcome, ref, owned.tenant_id).where(
                    NativeEffectOutcome.operation_id == permit.operation_id,
                    NativeEffectOutcome.attempt_id == permit.attempt_id,
                )
            )
            if claim is None or outcome is not None:
                raise BuilderExecutionPolicyError("invalid_dispatch_permit")
        return endpoint

    @staticmethod
    def _model_target(definition):
        from core.plugin.provider_identity import normalize_plugin_daemon_provider_identity
        from models.provider_ids import ModelProviderID

        model = definition.soul.model
        if model is None:
            raise BuilderExecutionPolicyError("native_agent_model_unavailable")
        plugin_id, provider = normalize_plugin_daemon_provider_identity(
            ModelProviderID(model.model_provider), model.plugin_id
        )
        return {
            "plugin_id": plugin_id,
            "provider": provider if provider.count("/") == 2 else f"{plugin_id}/{provider}",
            "model": model.model,
        }

    def _prepare_model(self, *, ref, key, target, parameters, parent):
        context, definition = self._definition(ref=ref)
        if target != self._model_target(definition):
            raise BuilderExecutionPolicyError("native_agent_model_mismatch")
        owned = self.loader.load(ref=ref)
        intent = EffectIntent(
            key=key,
            kind="model",
            resource_ref=definition.agent_id,
            implementation_revision=definition.snapshot_id,
            account_ref=None,
            target=target,
            parameters=parameters,
            input_digest=parent.input_digest,
            capability_digest=definition.stamp,
        )
        descriptor = {
            "node_id": definition.node_id,
            "agent_id": definition.agent_id,
            "snapshot_id": definition.snapshot_id,
            "snapshot_digest": canonical_digest(definition.soul.model_dump(mode="json")),
            "graph_revision": context.graph_revision,
            "credential_id": None,
            "provider_id": target["provider"],
            "account_ref": None,
            "verified_plugin": False,
            "task_model": True,
            "model_target": target,
        }
        binding = NativeBinding(
            intent_digest=canonical_digest(intent.model_dump(mode="json")),
            kind="model",
            resource_ref=intent.resource_ref,
            implementation_revision=intent.implementation_revision,
            account_ref=None,
            capability_digest=intent.capability_digest,
            resource_version=definition.stamp,
            credential_version=None,
            isolated=False,
            egress=True,
            new_data=True,
            destructive=False,
            approval_scope="operation",
            cost_units=1,
            budget={},
            execution_id=parent.execution_id,
            invocation_digest=canonical_digest(intent.model_dump(mode="json")),
        )
        proposal = NativeApprovalProposal(
            key=key,
            terms=NativeApprovalTerms(
                max_calls=1, max_dispatches=1, max_cost_units=1, expires_at=owned.expires_at.isoformat()
            ),
        )
        assessment = AgentCallAssessment(
            action="Invoke selected Agent model",
            account_label=None,
            target_summary=target,
            parameters_summary={"input_digest": canonical_digest(parameters)},
            risk_notice="Uses the published Agent model within the bounded outer confirmed Test Run.",
            destructive=False,
        )
        return self._persist(
            ref=ref, intent=intent, proposal=proposal, assessment=assessment, descriptor=descriptor, binding=binding
        )

    def validate_caller(self, *, ref, caller):
        endpoint = self._endpoint(ref)
        context = self.state_store.load_context(ref=ref)
        for field, value in (
            ("tenant_id", context.tenant_id),
            ("app_id", context.app_id),
            ("user_id", context.actor_id),
            ("user_from", "account"),
            ("workflow_id", context.workflow_id),
            ("workflow_run_id", context.native_run_id),
            ("node_execution_id", endpoint.config.parent_node.execution_id),
        ):
            if getattr(caller, field, None) != value:
                raise BuilderExecutionPolicyError("native_endpoint_owner_mismatch")

    def validate_model(self, *, envelope):
        self.bridge.authorization.validate_dispatch(
            ref=api_ref(envelope.ref), intent=api_intent(envelope.intent), permit=api_permit(envelope.permit)
        )
        self.revalidate(ref=api_ref(envelope.ref), intent=api_intent(envelope.intent))

    def validate_model_request(self, *, request):
        envelope = request.native_dispatch
        if envelope is None:
            raise BuilderExecutionPolicyError("native_endpoint_owner_mismatch")
        self.validate_caller(ref=api_ref(envelope.ref), caller=request.caller)
        target = {
            "plugin_id": "/".join(request.target.provider.split("/")[:2]),
            "provider": request.target.provider,
            "model": request.target.model,
        }
        parameters = {**request.target.model_dump(mode="json", exclude={"provider", "model"}), "stream": True}
        if (
            envelope.intent.kind != "model"
            or canonical_json(envelope.intent.target) != canonical_json(target)
            or canonical_json(envelope.intent.parameters) != canonical_json(parameters)
        ):
            raise BuilderExecutionPolicyError("native_endpoint_arguments_mismatch")
        self.validate_model(envelope=envelope)

    def invoke_model(self, *, envelope, invoke):
        from dify_agent.adapters.llm.provider import ProtectedModelChunkReceipt

        ref, intent, permit = api_ref(envelope.ref), api_intent(envelope.intent), api_permit(envelope.permit)
        self.validate_model(envelope=envelope)
        self.bridge.authorization.claim_dispatch(ref=ref, intent=intent, permit=permit)
        complete = False
        receipt = ProtectedModelChunkReceipt()
        try:
            for chunk in invoke():
                # Share the SDK's bounded canonical receipt before exposing a chunk.
                receipt.append(chunk)
                yield chunk
            result_ref = self.state_store.store_result(ref=ref, key=intent.key, result=receipt.value)
            self.bridge.authorization.record_outcome(permit=permit, outcome="completed", result_ref=result_ref)
            complete = True
        finally:
            if not complete:
                self.bridge.authorization.record_outcome(permit=permit, outcome="unknown", result_ref=None)

    def _persist(self, *, ref, intent, proposal, assessment, descriptor, binding):
        owned = self.loader.load(ref=ref)
        receipt = self.state_store.prepare_object(
            ref=ref,
            tenant_id=owned.tenant_id,
            kind="result",
            logical_key=_resource_key(intent.key),
            payload={
                "intent": intent.model_dump(mode="json"),
                "proposal": proposal.model_dump(mode="json"),
                "assessment": assessment.model_dump(mode="json"),
            },
        )
        with self.loader.locked(ref=ref) as (session, current, _scope):
            _sql_resource(session=session, owned=current, descriptor=descriptor)
            invocation = session.scalar(
                select(NativeTestInvocation).where(
                    NativeTestInvocation.tenant_id == current.tenant_id,
                    NativeTestInvocation.request_id == ref.request_id,
                    NativeTestInvocation.invocation_id == ref.invocation_id,
                    NativeTestInvocation.active.is_(True),
                )
            )
            if invocation is None:
                raise BuilderExecutionPolicyError("native_invocation_mismatch")
            identity = operation_digest(intent.key)
            existing = invocation.bindings.get(identity)
            if existing is not None and NativeBinding.model_validate(existing) != binding:
                raise BuilderExecutionPolicyError("native_intent_conflict")
            self.state_store.acknowledge_object(session, receipt)
            invocation.bindings = {
                **invocation.bindings,
                identity: binding.model_dump(mode="json"),
                _RESOURCE_KEY: {**invocation.bindings.get(_RESOURCE_KEY, {}), identity: descriptor},
            }
        return AgentEffectIntent.model_validate(intent.model_dump(mode="json"))

    def snapshot(self, *, ref, key):
        native_ref = api_ref(ref) if isinstance(ref, AgentNativeTestRef) else ref
        native_key = OperationKey.model_validate(key.model_dump(mode="json"))
        owned = self.loader.load(ref=native_ref)
        with self.loader.session_factory() as session:
            row = session.scalar(
                select(NativePayloadObject).where(
                    NativePayloadObject.tenant_id == owned.tenant_id,
                    NativePayloadObject.request_id == native_ref.request_id,
                    NativePayloadObject.invocation_id == native_ref.invocation_id,
                    NativePayloadObject.kind == "result",
                    NativePayloadObject.logical_key == _resource_key(native_key),
                )
            )
            if row is None:
                raise BuilderExecutionPolicyError("native_agent_intent_unavailable")
            receipt = ObjectReceipt(**{name: getattr(row, name) for name in ObjectReceipt.__dataclass_fields__})
        payload = self.state_store._read_object(receipt)
        self.loader.load(ref=native_ref)
        return (
            EffectIntent.model_validate(payload["intent"]),
            NativeApprovalProposal.model_validate(payload["proposal"]),
            AgentCallAssessment.model_validate(payload["assessment"]),
        )

    def revalidate(self, *, ref, intent):
        owned = self.loader.load(ref=ref)
        descriptor = owned.bindings.get(_RESOURCE_KEY, {}).get(operation_digest(intent.key))
        if descriptor is None:
            raise BuilderExecutionPolicyError("native_agent_intent_unavailable")
        if "shell_boundary" in descriptor:
            saved, _proposal, assessment = self.snapshot(ref=ref, key=intent.key)
            if assessment.destructive:
                raise BuilderExecutionPolicyError("destructive_effect_forbidden")
            if saved != intent or intent.key.occurrence_path[1:2] != (descriptor["shell_boundary"],):
                raise BuilderExecutionPolicyError("native_binding_drift")
            _context, definition, endpoint, _configs = self._shell(
                ref=ref,
                boundary=descriptor["shell_boundary"],
                target=intent.target,
                parameters=intent.parameters,
                descriptor=descriptor,
            )
            if (
                definition.snapshot_id,
                endpoint.config.config_digest,
                endpoint.config.workspace.model_dump(mode="json"),
            ) != (intent.implementation_revision, descriptor["composition_digest"], descriptor["workspace"]):
                raise BuilderExecutionPolicyError("native_binding_drift")
            return None
        if intent.kind == "model":
            _context, definition = self._definition(ref=ref, descriptor=descriptor)
            if intent.implementation_revision != definition.snapshot_id or intent.target != self._model_target(
                definition
            ):
                raise BuilderExecutionPolicyError("native_binding_drift")
            return None
        current, definition, tool, selected_account = self._tool(ref=ref, target=intent.target, descriptor=descriptor)
        saved, _proposal, assessment = self.snapshot(ref=ref, key=intent.key)
        if assessment.destructive:
            raise BuilderExecutionPolicyError("destructive_effect_forbidden")
        if canonical_json(saved.model_dump(mode="json")) != canonical_json(intent.model_dump(mode="json")) or (
            tool.account_ref,
            tool.metadata.implementation_revision,
            canonical_digest(
                {
                    "definition": definition.stamp,
                    "declaration": tool.metadata.entity.model_dump(mode="json"),
                    "runtime": tool.runtime_parameters,
                }
            ),
        ) != (intent.account_ref, intent.implementation_revision, intent.capability_digest):
            raise BuilderExecutionPolicyError("native_binding_drift")
        if selected_account is not None and NativeAgentCredentialMaterializer.refresh_due(selected_account):
            raise BuilderExecutionPolicyError("native_refresh_continuation_required")
        return tool

    def invoke_tool(self, *, request, session, invoke):
        envelope = request.native_dispatch
        if envelope is None:
            raise BuilderExecutionPolicyError("native_endpoint_owner_mismatch")
        self.validate_caller(ref=api_ref(envelope.ref), caller=request.caller)
        target = {
            "provider_type": request.tool.provider_type,
            "provider_id": request.tool.provider_id,
            "tool_name": request.tool.tool_name,
        }
        if canonical_json(envelope.intent.target) != canonical_json(target) or canonical_json(
            envelope.intent.parameters
        ) != canonical_json({**request.tool.runtime_parameters, **request.tool.tool_parameters}):
            raise BuilderExecutionPolicyError("native_endpoint_arguments_mismatch")
        runtime = _native_tool_runtime(self, envelope=envelope, request=request)
        response = None

        def business():
            nonlocal response
            response = invoke(request, session=session, prepared_runtime=runtime)
            return response.observation

        # Runtime construction above is inert except authorized credential decryption.
        # The SQL dispatch claim is committed immediately before ToolEngine's owner.
        AgentToolDispatchOwner(
            authorization=self.bridge.authorization, state_store=self.state_store, revalidate=self.revalidate
        ).invoke(envelope=envelope, invoke=business)
        assert response is not None
        return response

    def store_result(self, *, ref, key, result, native_dispatch=None):
        if native_dispatch is not None:
            try:
                envelope = AgentPhysicalDispatchPayload.model_validate(native_dispatch)
            except ValueError:
                raise BuilderExecutionPolicyError("native_endpoint_owner_mismatch") from None
            if envelope.ref != ref or envelope.intent.key != key:
                raise BuilderExecutionPolicyError("native_endpoint_owner_mismatch")
            self.validate_claimed_shell(envelope=envelope)
            result_ref = self.state_store.store_result(
                ref=api_ref(ref), key=api_intent(envelope.intent).key, result=result
            )
            self.bridge.authorization.record_outcome(
                permit=api_permit(envelope.permit), outcome="completed", result_ref=result_ref
            )
            return result_ref
        native_ref = api_ref(ref)
        self._endpoint(native_ref)
        native_key = OperationKey.model_validate(key.model_dump(mode="json"))
        owned = self.loader.load(ref=native_ref)
        with self.loader.session_factory() as session:
            operation = session.scalar(
                select(NativeEffectOperation).where(
                    NativeEffectOperation.tenant_id == owned.tenant_id,
                    NativeEffectOperation.request_id == native_ref.request_id,
                    NativeEffectOperation.invocation_id == native_ref.invocation_id,
                    NativeEffectOperation.operation_digest == operation_digest(native_key),
                    NativeEffectOperation.state == "completed",
                )
            )
            if operation is None or operation.result_ref is None:
                raise BuilderExecutionPolicyError("native_result_unavailable")
            result_ref = operation.result_ref
        actual = self.state_store.load_result(ref=native_ref, result_ref=result_ref)
        if canonical_json(actual) != canonical_json(result):
            raise BuilderExecutionPolicyError("native_result_conflict")
        return result_ref

    def read_result(self, *, ref, result_ref):
        native_ref = api_ref(ref)
        self._endpoint(native_ref)
        return self.state_store.load_result(ref=native_ref, result_ref=result_ref)

    def validate_call(self, *, ref, intent):
        native_ref, effect = api_ref(ref), api_intent(intent)
        self._endpoint(native_ref)
        self.revalidate(ref=native_ref, intent=effect)

    def settle(self, *, ref, permit, outcome, result_ref):
        from dify_agent.protocol.native_testing import AgentEffectReceipt

        native_ref, native_permit = api_ref(ref), api_permit(permit)
        if self.bridge.authorization._permit_ref(native_permit) != native_ref:
            raise BuilderExecutionPolicyError("invalid_dispatch_permit")
        with self.loader.session_factory() as session:
            existing = session.scalar(
                select(NativeEffectOutcome).where(
                    NativeEffectOutcome.tenant_id == self.loader.actor.tenant_id,
                    NativeEffectOutcome.request_id == native_ref.request_id,
                    NativeEffectOutcome.invocation_id == native_ref.invocation_id,
                    NativeEffectOutcome.operation_id == native_permit.operation_id,
                    NativeEffectOutcome.attempt_id == native_permit.attempt_id,
                )
            )
            if existing is not None:
                # A backend lost-response report cannot downgrade an API-owned
                # completed result. Exact permit proof above remains mandatory.
                if (outcome, result_ref) != (existing.outcome, existing.result_ref) and not (
                    outcome == "unknown" and result_ref is None and existing.outcome == "completed"
                ):
                    raise BuilderExecutionPolicyError("outcome_conflict")
                return AgentEffectReceipt(
                    operation_id=existing.operation_id,
                    attempt_id=existing.attempt_id,
                    outcome=existing.outcome,
                    result_ref=existing.result_ref,
                )
        if outcome == "completed":
            raise BuilderExecutionPolicyError("native_result_unavailable")
        receipt = self.bridge.authorization.record_outcome(permit=native_permit, outcome=outcome, result_ref=result_ref)
        return AgentEffectReceipt.model_validate(receipt.model_dump(mode="json"))

    def describe(self, *, actor, resolved):
        if actor != self.loader.actor:
            raise BuilderExecutionPolicyError("native_owner_mismatch")
        intent, proposal, assessment = self.snapshot(ref=resolved.ref, key=resolved.intent.key)
        if intent != resolved.intent:
            raise BuilderExecutionPolicyError("native_pending_conflict")
        self.revalidate(ref=resolved.ref, intent=intent)
        with self.loader.session_factory() as session:
            owned, _scope = self.loader._load(session, ref=resolved.ref, lock=False)
            pending = session.scalar(
                select(NativePendingAction)
                .join(NativeEffectOperation, NativeEffectOperation.id == NativePendingAction.operation_id)
                .where(
                    NativePendingAction.tenant_id == owned.tenant_id,
                    NativePendingAction.request_id == resolved.ref.request_id,
                    NativePendingAction.invocation_id == resolved.ref.invocation_id,
                    NativePendingAction.category == "approval",
                    NativeEffectOperation.operation_digest == operation_digest(intent.key),
                    NativeEffectOperation.intent_digest == canonical_digest(intent.model_dump(mode="json")),
                )
            )
            if pending is None or pending.generation != resolved.generation:
                raise BuilderExecutionPolicyError("native_pending_conflict")
            return PendingActionDisclosure(
                pending_operation_id=pending.id,
                wait_reason="approval",
                version=resolved.generation + 1,
                scope_digest=pending.owner_version,
                account_label=assessment.account_label,
                action=assessment.action,
                target=assessment.target_summary,
                parameters_summary=assessment.parameters_summary,
                risk_notice=assessment.risk_notice + " " + _OPACITY,
                required_configuration=(),
                native_form_ref=None,
                approval_limits=proposal.terms,
            )


def build_native_agent_operations(*, actor: Actor, assessor: Callable) -> AgentOperationService:
    loader = OwnedNativeTestLoader(
        sessionmaker(bind=db.engine, expire_on_commit=False), actor=actor, resolver=AgentOperationBindingResolver()
    )
    return AgentOperationService(loader=loader, state_store=NativeExecutionStateStore(loader), assessor=assessor)


def agent_operations_for_ref(ref):
    from services.dify_builder.native_testing.agent_bridge import agent_bridge_for_ref

    bridge = agent_bridge_for_ref(ref)
    factory = current_app.extensions.get("native_agent_operation_factory")
    if factory is None:
        from services.dify_builder.wiring import build_native_agent_operation_service

        factory = build_native_agent_operation_service
    service = factory(actor=bridge.authorization.loader.actor)
    if not isinstance(service, AgentOperationService) or service.loader.actor != bridge.authorization.loader.actor:
        raise BuilderExecutionPolicyError("native_agent_operation_unavailable")
    return service


def _native_tool_runtime(service, *, envelope, request):
    """Build static plugin runtime after approval; business phase cannot refresh."""
    from core.app.entities.app_invoke_entities import InvokeFrom
    from core.plugin.entities.plugin_daemon import CredentialType
    from core.tools.__base.tool_runtime import ToolRuntime
    from core.tools.entities.tool_entities import ToolInvokeFrom
    from core.tools.plugin_tool.tool import PluginTool
    from services.dify_builder.native_testing.agent_bridge import AgentCredentialBinding

    ref, intent, permit = api_ref(envelope.ref), api_intent(envelope.intent), api_permit(envelope.permit)
    service.bridge.authorization.validate_dispatch(ref=ref, intent=intent, permit=permit)
    tool = service.revalidate(ref=ref, intent=intent)
    if request.tool.credential_id != tool.credential_id or canonical_json(
        request.tool.runtime_parameters
    ) != canonical_json(tool.runtime_parameters):
        raise BuilderExecutionPolicyError("native_credential_drift")
    if tool.provider_type not in {"plugin", "builtin"} or tool.provider_id.count("/") != 2:
        raise BuilderExecutionPolicyError("native_agent_tool_preparation_unavailable")
    materializer = NativeAgentCredentialMaterializer(
        authorization=service.bridge.authorization,
        resolve_binding=lambda **_kwargs: AgentCredentialBinding(
            actor=service.loader.actor,
            tool_ref=intent.resource_ref,
            provider_id=tool.provider_id,
            credential_id=tool.credential_id,
            verified_plugin=tool.verified_plugin,
            implementation_revision=tool.metadata.implementation_revision,
            requirements_ref=intent.resource_ref,
        ),
    )
    if tool.credential_id is None:
        credentials, credential_type = {}, CredentialType.UNAUTHORIZED
    else:
        materialized = materializer.materialize(
            ref=ref, intent=intent, permit=permit, tool_ref=intent.resource_ref, phase="business"
        )
        credentials, credential_type = materialized.credentials, CredentialType.of(materialized.credential_type)
    return PluginTool(
        entity=tool.metadata.entity,
        runtime=ToolRuntime(
            tenant_id=request.caller.tenant_id,
            user_id=request.caller.user_id,
            credentials=credentials,
            credential_type=credential_type,
            runtime_parameters=dict(tool.runtime_parameters),
            invoke_from=InvokeFrom.value_of(request.caller.invoke_from),
            tool_invoke_from=ToolInvokeFrom.AGENT,
        ),
        tenant_id=request.caller.tenant_id,
        icon="",
        plugin_unique_identifier=tool.metadata.implementation_revision,
    )


def confirmed_task_model(*, session, owned, intent) -> bool:
    if intent.kind != "model":
        return False
    from models.dify_builder import DifyBuilderExecutionRequest

    request = session.get(DifyBuilderExecutionRequest, owned.ref.request_id)
    descriptor = owned.bindings.get(_RESOURCE_KEY, {}).get(operation_digest(intent.key))
    return bool(
        request is not None
        and request.context.get("profile", {}).get("profile_id") == "builder-agent-confirmed-v1"
        and descriptor is not None
        and descriptor.get("task_model") is True
        and descriptor.get("model_target") == intent.target
        and descriptor.get("snapshot_id") == intent.implementation_revision
    )


def confirmed_deferred_tool_approval(*, session, owned, intent, binding, fence) -> bool:
    """Register another actual call behind this Agent's own approval fence only.

    The current exact binding was already revalidated by C02. This returns no
    execution authority; the caller must return the new call's pending approval.
    """
    if (
        intent.kind != "tool"
        or binding.approval_scope != "operation"
        or intent.key.occurrence_path[:1] != (binding.execution_id,)
        or fence.category != "approval"
        or fence.invocation_id != owned.ref.invocation_id
    ):
        return False
    descriptor = owned.bindings.get(_RESOURCE_KEY, {}).get(operation_digest(intent.key))
    if descriptor is None or descriptor.get("task_model") is True:
        return False
    from models.dify_builder import DifyBuilderExecutionRequest

    request = session.get(DifyBuilderExecutionRequest, owned.ref.request_id)
    if request is None or request.context.get("profile", {}).get("profile_id") != "builder-agent-confirmed-v1":
        return False
    state = session.scalar(owner_query(NativeInvocationState, owned.ref, owned.tenant_id))
    if state is None or state.wait_reason != "approval" or fence.generation != state.generation:
        return False
    rows = session.execute(
        select(NativePendingAction, NativeEffectOperation)
        .join(NativeEffectOperation, NativeEffectOperation.id == NativePendingAction.operation_id)
        .where(
            NativePendingAction.tenant_id == owned.tenant_id,
            NativePendingAction.request_id == owned.ref.request_id,
            NativePendingAction.id.in_(state.pending_ids),
        )
    ).all()
    if len(rows) != len(state.pending_ids):
        return False
    for pending, operation in rows:
        previous = owned.bindings.get(_RESOURCE_KEY, {}).get(operation.operation_digest)
        previous_binding = owned.bindings.get(operation.operation_digest)
        if (
            (pending.invocation_id, pending.generation, pending.category)
            != (owned.ref.invocation_id, state.generation, "approval")
            or (operation.tenant_id, operation.request_id, operation.invocation_id, operation.state)
            != (owned.tenant_id, owned.ref.request_id, owned.ref.invocation_id, "pending")
            or previous is None
            or previous.get("task_model") is True
            or previous_binding is None
            or previous_binding.get("execution_id") != binding.execution_id
            or previous_binding.get("approval_scope") != "operation"
            or any(
                not descriptor.get(field) or previous.get(field) != descriptor[field]
                for field in ("node_id", "agent_id", "snapshot_id", "snapshot_digest", "graph_revision")
            )
        ):
            return False
    return True


def admit_confirmed_agent_execution(
    *, actor, session_id, test_input_id, expected_version, native_run_id, idempotency_key, limits
):
    """Reserve existing C02/C03 owners for one ordinary confirmed Workflow Run.

    Caller has validated the outer Test Run confirmation and owns the Run ID.
    This never launches a generator, qualifies isolation, or authorizes tool I/O.
    Admission may precede the WorkflowRun row; actual private effects require it.
    """
    from datetime import timedelta
    from uuid import NAMESPACE_URL, uuid5

    from models.dify_builder import DifyBuilderExecutionRequest, DifyBuilderSession
    from models.dify_builder_native_tests import NativeTestScope
    from services.dify_builder.native_testing.context_binding import NativeAdmissionCompiler, NativeRuntimeProfile
    from services.dify_builder.native_testing.repository import utc_now

    sessions = sessionmaker(bind=db.engine, expire_on_commit=False)
    profile = NativeRuntimeProfile(
        profile_id="builder-agent-confirmed-v1", implementation_revision="builder-agent-confirmed-v1", limits=limits
    )
    if not {"calls", "dispatches", "cost_units"}.issubset(limits):
        raise BuilderExecutionPolicyError("native_profile_unavailable")

    def resources(*, actor, app_id, workflow_id, graph, profile):
        result = []
        with sessions() as session:
            for node in graph.get("nodes", []):
                data = node.get("data", {})
                if data.get("type") != "agent" or data.get("version") != "2":
                    continue
                pin = data.get("agent_binding", {})
                snapshot = session.get(AgentConfigSnapshot, pin.get("current_snapshot_id"))
                agent = session.get(Agent, pin.get("agent_id"))
                if (
                    snapshot is None
                    or agent is None
                    or (snapshot.tenant_id, snapshot.agent_id, agent.tenant_id, agent.active_config_snapshot_id)
                    != (actor.tenant_id, agent.id, actor.tenant_id, snapshot.id)
                ):
                    raise BuilderExecutionPolicyError("native_agent_pin_mismatch")
                soul = AgentSoulConfig.model_validate(snapshot.config_snapshot_dict)
                result.append(
                    {
                        "kind": "agent",
                        "app_id": app_id,
                        "workflow_id": workflow_id,
                        "node_id": node["id"],
                        "agent_id": agent.id,
                        "snapshot_id": snapshot.id,
                        "snapshot_digest": canonical_digest(soul.model_dump(mode="json")),
                    }
                )
        return tuple(result)

    compiler = NativeAdmissionCompiler(session_factory=sessions, resources=resources)
    request_id = str(
        uuid5(
            NAMESPACE_URL,
            canonical_digest(
                {
                    "profile": profile.profile_id,
                    "tenant": actor.tenant_id,
                    "actor": actor.account_id,
                    "session": session_id,
                    "key": idempotency_key,
                }
            ),
        )
    )
    invocation_id = str(uuid5(NAMESPACE_URL, request_id + ":root"))
    compilation = compiler.compile(
        actor=actor,
        session_id=session_id,
        test_input_id=test_input_id,
        expected_version=expected_version,
        mode="native",
        request_id=request_id,
        invocation_id=invocation_id,
        native_run_id=native_run_id,
        profile=profile,
        revision_basis="confirmed-canvas-v1",
    )
    context = compilation.context
    with sessions.begin() as session:
        session.scalar(
            select(DifyBuilderSession)
            .where(
                DifyBuilderSession.id == session_id,
                DifyBuilderSession.tenant_id == actor.tenant_id,
                DifyBuilderSession.owner_account_id == actor.account_id,
            )
            .with_for_update()
        )
        compiler.recheck_local(session=session, actor=actor, compilation=compilation)
        existing = session.get(DifyBuilderExecutionRequest, request_id)
        if existing is not None:
            if (
                existing.tenant_id,
                existing.actor_id,
                existing.session_id,
                existing.test_input_id,
                existing.context_digest,
                existing.context,
            ) != (
                actor.tenant_id,
                actor.account_id,
                session_id,
                test_input_id,
                context.ref.context_digest,
                compilation.request_context,
            ):
                raise BuilderExecutionPolicyError("native_idempotency_conflict")
        else:
            session.add(
                DifyBuilderExecutionRequest(
                    id=request_id,
                    tenant_id=actor.tenant_id,
                    actor_id=actor.account_id,
                    app_id=context.app_id,
                    workflow_id=context.workflow_id,
                    session_id=session_id,
                    test_input_id=test_input_id,
                    context=compilation.request_context,
                    context_digest=context.ref.context_digest,
                    state="running",
                    native_run_id=None,
                    observations=[],
                )
            )
            session.add(
                NativeTestScope(
                    request_id=request_id,
                    tenant_id=actor.tenant_id,
                    generation=0,
                    task_approved=True,
                    cancelled=False,
                    expires_at=utc_now() + timedelta(minutes=15),
                    max_calls=limits["calls"],
                    max_dispatches=limits["dispatches"],
                    max_cost_units=limits["cost_units"],
                    spent_calls=0,
                    spent_dispatches=0,
                    spent_cost_units=0,
                    budget_limits=limits,
                    budget_spent={},
                    profile=dict(limits),
                )
            )
            session.add(
                NativeTestInvocation(
                    tenant_id=actor.tenant_id,
                    request_id=request_id,
                    invocation_id=invocation_id,
                    active=True,
                    bindings={},
                )
            )
    loader = OwnedNativeTestLoader(sessions, actor=actor, resolver=AgentOperationBindingResolver())
    NativeExecutionStateStore(loader).initialize_context(context=context)
    return context
