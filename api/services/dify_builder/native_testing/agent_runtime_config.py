"""Inert native config composition. No ordinary session, credentials or model schema calls.

The bound public node and protected graph own selectors. Stored published Soul and
node-job config own declarations; the workspace service alone owns allocation.
"""

from dataclasses import dataclass
from typing import TYPE_CHECKING, Literal

from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig
from dify_agent.protocol.schemas import CreateRunRequest
from pydantic import JsonValue, TypeAdapter
from sqlalchemy import select

from clients.agent_backend.request_builder import (
    AgentBackendModelConfig,
    AgentBackendOutputConfig,
    AgentBackendRunRequestBuilder,
    AgentBackendWorkflowNodeRunInput,
)
from models.agent import (
    Agent,
    AgentConfigSnapshot,
    WorkflowAgentBindingType,
    WorkflowAgentNodeBinding,
)
from models.agent_config_entities import AgentSoulConfig, WorkflowNodeJobConfig
from services.dify_builder.execution_contracts import (
    BuilderExecutionPolicyError,
    canonical_digest,
    canonical_json,
)
from services.dify_builder.native_testing.agent_binding import (
    AgentBindingService,
    native_node_data,
)
from services.dify_builder.native_testing.agent_contracts import (
    AgentParentNodeRef,
    AgentTestWorkspaceRef,
)
from services.dify_builder.native_testing.agent_tool_declarations import (
    AgentToolDeclarationService,
)
from services.dify_builder.native_testing.contracts import FiniteJSON
from services.dify_builder.native_testing.private_reads import (
    validate_invocation_workflow,
)

if TYPE_CHECKING:
    from services.dify_builder.native_testing.repository import OwnedNativeTestLoader
    from services.dify_builder.native_testing.runtime_bridge import (
        NativeNodePreparation,
    )
    from services.dify_builder.native_testing.runtime_contracts import (
        ResolvedNativeTestContext,
    )


@dataclass(frozen=True)
class NativeAgentDefinition:
    node_id: str
    agent_id: str
    snapshot_id: str
    soul: AgentSoulConfig
    node_job: WorkflowNodeJobConfig
    stamp: str


class NativeAgentRuntimeConfigBuilder:
    def __init__(
        self,
        *,
        loader: "OwnedNativeTestLoader",
        declarations: AgentToolDeclarationService | None = None,
        profile: Literal["isolated", "confirmed"] = "isolated",
    ):
        self.loader = loader
        self.declarations = declarations or AgentToolDeclarationService()
        self.profile = profile

    def load_definition(self, *, context: "ResolvedNativeTestContext", node_id: str) -> NativeAgentDefinition:
        nodes = context.graph.get("nodes", [])
        if not isinstance(nodes, list):
            raise BuilderExecutionPolicyError("native_agent_owner_mismatch")
        selected = [node for node in nodes if isinstance(node, dict) and node.get("id") == node_id]
        if len(selected) != 1 or not isinstance(selected[0].get("data"), dict):
            raise BuilderExecutionPolicyError("native_agent_owner_mismatch")
        data = selected[0]["data"]
        binding = data.get("agent_binding")
        if (
            data.get("type") != "agent"
            or data.get("version") != "2"
            or data.get("agent_node_kind") != "dify_agent"
            or not isinstance(binding, dict)
        ):
            raise BuilderExecutionPolicyError("native_agent_owner_mismatch")
        agent_id, snapshot_id = (
            binding.get("agent_id"),
            binding.get("current_snapshot_id"),
        )
        if not isinstance(agent_id, str) or not agent_id or not isinstance(snapshot_id, str) or not snapshot_id:
            raise BuilderExecutionPolicyError("native_agent_pin_mismatch")
        authorization = AgentBindingService.authorize(
            actor=self.loader.actor,
            app_id=context.app_id,
            agent_ids=frozenset({agent_id}),
        )
        with self.loader.session_factory() as session:
            AgentBindingService(session, authorization=authorization).recheck_access(
                actor=self.loader.actor, app_id=context.app_id, agent_id=agent_id
            )
            workflow = validate_invocation_workflow(
                session,
                tenant_id=context.tenant_id,
                app_id=context.app_id,
                workflow_id=context.workflow_id,
            )
            if workflow._environment_variables not in (None, "[]", "{}", ""):
                raise BuilderExecutionPolicyError("native_agent_environment_requires_owner")
            row = session.scalar(
                select(WorkflowAgentNodeBinding).where(
                    WorkflowAgentNodeBinding.tenant_id == context.tenant_id,
                    WorkflowAgentNodeBinding.app_id == context.app_id,
                    WorkflowAgentNodeBinding.workflow_id == context.workflow_id,
                    WorkflowAgentNodeBinding.workflow_version == workflow.version,
                    WorkflowAgentNodeBinding.node_id == node_id,
                )
            )
            snapshot = session.get(AgentConfigSnapshot, snapshot_id)
            agent = session.get(Agent, agent_id)
            if (
                row is None
                or snapshot is None
                or agent is None
                or (
                    row.agent_id,
                    row.current_snapshot_id,
                    snapshot.tenant_id,
                    snapshot.agent_id,
                    agent.tenant_id,
                    agent.active_config_snapshot_id,
                )
                != (
                    agent_id,
                    snapshot_id,
                    context.tenant_id,
                    agent_id,
                    context.tenant_id,
                    snapshot_id,
                )
            ):
                raise BuilderExecutionPolicyError("native_agent_pin_mismatch")
            if row.binding_type != WorkflowAgentBindingType.ROSTER_AGENT:
                raise BuilderExecutionPolicyError("native_agent_pin_mismatch")
            # Local visibility and publication are current; catalog performs no capability calls.
            from core.agent.publish_visibility import (
                workflow_callable_active_snapshot_filter,
            )
            from services.agent.roster_service import AgentRosterService

            eligible = session.scalar(
                AgentRosterService._build_roster_agents_stmt(tenant_id=context.tenant_id, keyword=None).where(
                    Agent.id == agent_id,
                    Agent.active_config_has_model.is_(True),
                    workflow_callable_active_snapshot_filter(),
                )
            )
            if eligible is None:
                raise BuilderExecutionPolicyError("agent_access_denied")
            soul = AgentSoulConfig.model_validate(snapshot.config_snapshot_dict)
            job = WorkflowNodeJobConfig.model_validate(row.node_job_config_dict)
            expected_data = native_node_data(agent_id=agent_id, snapshot_id=snapshot_id, node_job=job)
            if any(data.get(key) != value for key, value in expected_data.items() if key != "title"):
                raise BuilderExecutionPolicyError("native_agent_config_mismatch")
        stamp = canonical_digest(
            {
                "node": selected[0],
                "soul": soul.model_dump(mode="json"),
                "job": job.model_dump(mode="json"),
            }
        )
        return NativeAgentDefinition(node_id, agent_id, snapshot_id, soul, job, stamp)

    @staticmethod
    def typed_inputs(*, association: "NativeNodePreparation", definition: NativeAgentDefinition) -> dict:
        from core.workflow.system_variables import SystemVariableKey, get_system_value
        from services.agent.prompt_mentions import (
            extract_workflow_node_output_selectors,
            normalize_previous_node_output_selector,
        )

        pool = association.runtime_state.variable_pool
        selectors = list(extract_workflow_node_output_selectors(definition.node_job.workflow_prompt))
        if definition.node_job.output_routes.enabled:
            for route in definition.node_job.output_routes.routes:
                selectors.extend(extract_workflow_node_output_selectors(route.name))
        for ref in definition.node_job.previous_node_output_refs:
            selector = normalize_previous_node_output_selector(ref)
            if selector is None:
                raise BuilderExecutionPolicyError("native_agent_input_unavailable")
            selectors.append(selector)
        values = {}
        for selector in selectors:
            if not selector:
                raise BuilderExecutionPolicyError("native_agent_input_unavailable")
            segment = pool.get(selector)
            if segment is None:
                raise BuilderExecutionPolicyError("native_agent_input_unavailable")
            values[".".join(selector)] = TypeAdapter(FiniteJSON).validate_python(segment.value)
        files = get_system_value(pool, SystemVariableKey.FILES)
        if files:
            raise BuilderExecutionPolicyError("native_input_import_requires_capability")
        query = get_system_value(pool, SystemVariableKey.QUERY)
        from graphon.variables.template_resolution import convert_template

        route_names = (
            {route.id: convert_template(pool, route.name).text for route in definition.node_job.output_routes.routes}
            if definition.node_job.output_routes.enabled
            else {}
        )
        return TypeAdapter(FiniteJSON).validate_python({"query": query, "values": values, "route_names": route_names})

    def compose(
        self,
        *,
        context: "ResolvedNativeTestContext",
        definition: NativeAgentDefinition,
        parent_node: AgentParentNodeRef,
        workspace: AgentTestWorkspaceRef,
        inputs: dict,
    ) -> CreateRunRequest:
        from core.plugin.provider_identity import (
            normalize_plugin_daemon_provider_identity,
        )
        from core.workflow.nodes.agent_v2.runtime_request_builder import (
            WorkflowAgentRuntimeRequestBuilder,
            build_config_layer_config,
            build_knowledge_layer_config,
            build_shell_layer_config,
        )
        from models.provider_ids import ModelProviderID
        from services.agent.prompt_mentions import (
            build_soul_mention_resolver,
            expand_prompt_mentions,
        )

        soul, job = definition.soul, definition.node_job
        if soul.model is None:
            raise BuilderExecutionPolicyError("native_agent_model_unavailable")
        # Every shell env owner must be reference-only before ordinary helpers map
        # name/value pairs (which no recursive dictionary-key filter can identify).
        for env in (soul.env, *(tool.env for tool in soul.tools.cli_tools)):
            if any(item.value is not None or item.default is not None for item in env.variables):
                raise BuilderExecutionPolicyError("native_agent_environment_requires_owner")
            if any(secret.get("value") is not None or secret.get("default") is not None for secret in env.secret_refs):
                raise BuilderExecutionPolicyError("native_agent_config_credentials")
        declarations = self.declarations.prepare(
            tenant_id=context.tenant_id,
            actor_id=context.actor_id,
            app_id=context.app_id,
            tools=soul.tools,
            profile=self.profile,
        )
        plugin_id, provider = normalize_plugin_daemon_provider_identity(
            ModelProviderID(soul.model.model_provider), soul.model.plugin_id
        )
        config, warnings = build_config_layer_config(
            soul, agent_id=definition.agent_id, config_version_id=definition.snapshot_id
        )
        if warnings:
            raise BuilderExecutionPolicyError("native_agent_config_asset_unavailable")
        if self.profile == "confirmed" and (
            soul.tools.cli_tools or soul.config_skills or soul.config_files or soul.config_note
        ):
            raise BuilderExecutionPolicyError("native_agent_shell_preparation_unavailable")
        job.output_routes.validate_for_execution()
        output = WorkflowAgentRuntimeRequestBuilder._build_output_config(job.declared_outputs)
        if job.output_routes.enabled:
            route_names = inputs.get("route_names")
            if not isinstance(route_names, dict) or set(route_names) != {
                route.id for route in job.output_routes.routes
            }:
                raise BuilderExecutionPolicyError("native_agent_input_unavailable")
            schema: dict[str, JsonValue] = (
                output.json_schema if output else {"type": "object", "properties": {"text": {"type": "string"}}}
            )
            properties = schema.get("properties")
            required = schema.get("required", [])
            if not isinstance(properties, dict) or not isinstance(required, list):
                raise BuilderExecutionPolicyError("native_agent_config_mismatch")
            properties["switch"] = {
                "type": "string",
                "enum": [route.id for route in job.output_routes.routes],
                "description": "Select exactly one route ID based on the task result:\n"
                + "\n".join(
                    f"{route.id} ({route.label or route.id}): {route_names[route.id]}"
                    for route in job.output_routes.routes
                ),
            }
            schema["required"] = [*required, "switch"]
            output = AgentBackendOutputConfig(json_schema=schema, description=output.description if output else None)
        request = AgentBackendRunRequestBuilder().build_for_workflow_node(
            AgentBackendWorkflowNodeRunInput(
                model=AgentBackendModelConfig(
                    plugin_id=plugin_id,
                    model_provider=provider,
                    model=soul.model.model,
                    model_settings=soul.model.model_settings.model_dump(mode="json", exclude_none=True),
                ),
                execution_context=DifyExecutionContextLayerConfig(
                    tenant_id=context.tenant_id,
                    user_id=context.actor_id,
                    user_from="account",
                    app_id=context.app_id,
                    workflow_id=context.workflow_id,
                    workflow_run_id=context.native_run_id,
                    node_id=definition.node_id,
                    node_execution_id=parent_node.execution_id,
                    agent_id=definition.agent_id,
                    agent_config_version_id=definition.snapshot_id,
                    agent_config_version_kind="snapshot",
                    agent_mode="workflow_run",
                    invoke_from="debugger",
                ),
                backend_binding_ref=workspace.backend_binding_ref,
                agent_soul_prompt=expand_prompt_mentions(soul.prompt.system_prompt, build_soul_mention_resolver(soul)),
                workflow_node_job_prompt=job.workflow_prompt or "Complete the declared workflow task.",
                user_prompt=canonical_json(inputs).decode(),
                output=output,
                tools=declarations.plugin_tools,
                core_tools=declarations.core_tools,
                knowledge=build_knowledge_layer_config(soul),
                config_layer_config=config if self.profile == "isolated" else None,
                include_shell=self.profile == "isolated",
                shell_config=build_shell_layer_config(soul) if self.profile == "isolated" else None,
            )
        )
        return CreateRunRequest.model_validate(
            {
                **request.model_dump(mode="json"),
                "execution_mode": "builder_test",
                "native_test_profile": self.profile,
                "idempotency_key": canonical_digest(
                    {
                        "parent": parent_node.model_dump(mode="json"),
                        "snapshot": definition.snapshot_id,
                        "profile": self.profile,
                    }
                )
                if self.profile == "confirmed"
                else request.idempotency_key,
                "native_test_ref": parent_node.ref.model_dump(mode="json"),
                "native_parent_node": parent_node.model_dump(mode="json"),
                "native_test_protocol_version": 1,
            }
        )
