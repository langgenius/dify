from __future__ import annotations

from collections.abc import Iterator, Mapping
from typing import Any

from core.agent.workflow_references import (
    extract_workflow_node_output_selectors,
    workflow_previous_node_output_refs_from_selectors,
)
from core.workflow.graph_topology import WorkflowGraphTopology
from core.workflow.nodes.agent_v2.discriminator import is_dify_agent_node_data
from core.workflow.nodes.agent_v2.entities import DifyAgentNodeData
from enums.agent import WorkflowAgentBindingType
from graphon.enums import BuiltinNodeTypes, ErrorStrategy
from models.agent import AgentStatus
from models.agent_config_entities import (
    AgentFileRefConfig,
    AgentHumanContactConfig,
    AgentSoulConfig,
    WorkflowNodeJobConfig,
    WorkflowPreviousNodeOutputRef,
)
from models.agent_runtime_contracts import WorkflowBindingRecord
from services.agent.knowledge_datasets import list_agent_soul_knowledge_dataset_ids
from services.agent.workflow_contracts import WorkflowAgentBindingStore
from services.workflow.contracts import WorkflowBindingScope


class WorkflowAgentNodeValidationError(ValueError):
    """Raised when a Workflow Agent v2 node cannot be executed or published."""


class WorkflowAgentNodeValidator:
    """Validate Agent v2 workflow nodes against graph topology and persisted bindings."""

    def __init__(self, *, repository: WorkflowAgentBindingStore) -> None:
        self._repository = repository

    _LOCKED_AGENT_SOUL_KEYS = frozenset(
        {
            "agent_soul",
            "soul",
            "prompt",
            "system_prompt",
            "skills",
            "files",
            "tools",
            "dify_tools",
            "cli_tools",
            "knowledge",
            "env",
            "environment",
            "sandbox",
            "sandbox_provider",
            "memory",
            "memory_strategy",
            "model",
            "app_features",
            "app_variables",
            "misc_legacy",
        }
    )
    _SUPPORTED_HUMAN_CONTACT_CHANNELS = frozenset({"email", "slack", "web_app", "webapp", "chat"})
    _AGENTIC_TOOL_CONFIG_KEYS = ("agentic_mode", "agenticMode", "agentic")
    _MANUAL_TOOL_AGENTIC_STATES = frozenset({"manual", "expert", "expert_zone", "exited"})
    _DENIED_PERMISSION_STATUSES = frozenset({"unauthorized", "denied", "forbidden", "invalid", "unavailable"})

    def validate_draft_workflow(self, *, workflow: WorkflowBindingScope) -> None:
        self._validate_workflow(
            workflow=workflow,
            require_binding=False,
            require_agent_model=False,
            validate_previous_node_topology=False,
        )

    def validate_published_workflow(self, *, workflow: WorkflowBindingScope) -> None:
        self._validate_workflow(
            workflow=workflow,
            require_binding=True,
            require_agent_model=True,
            validate_previous_node_topology=True,
        )

    def _validate_workflow(
        self,
        *,
        workflow: WorkflowBindingScope,
        require_binding: bool,
        require_agent_model: bool,
        validate_previous_node_topology: bool,
    ) -> None:
        graph = workflow.graph_dict
        topology = WorkflowGraphTopology.from_graph(graph) if validate_previous_node_topology else None
        for node_id, node_data in self.iter_agent_v2_nodes(graph):
            self._validate_node_schema(node_id=node_id, node_data=node_data)
            binding = self._repository.get_binding(
                tenant_id=workflow.tenant_id,
                app_id=workflow.app_id,
                workflow_id=workflow.id,
                node_id=node_id,
            )
            if binding is None:
                if require_binding:
                    raise WorkflowAgentNodeValidationError(
                        f"Workflow Agent node {node_id} requires a binding before publishing."
                    )
                continue
            if (
                require_binding
                and node_data.get("error_strategy") == ErrorStrategy.DEFAULT_VALUE
                and WorkflowNodeJobConfig.model_validate(binding.node_job_config_dict).output_routes.enabled
            ):
                raise WorkflowAgentNodeValidationError(
                    "Output routes do not support the node-level default-value error strategy."
                )
            self.validate_binding(
                binding=binding,
                topology=topology,
                require_agent_model=require_agent_model,
            )

        if require_binding:
            for node_id, node_data in self.iter_tool_nodes(graph):
                self._validate_tool_node_agentic_mode(node_id=node_id, node_data=node_data)

    def validate_binding(
        self,
        *,
        binding: WorkflowBindingRecord,
        topology: WorkflowGraphTopology | None = None,
        require_agent_model: bool = True,
    ) -> None:
        """Validate binding ownership, publication state, Agent Soul, and node-job references."""

        if binding.agent_id is None:
            raise WorkflowAgentNodeValidationError(f"Workflow Agent node {binding.node_id} is missing agent binding.")

        agent = self._repository.get_agent(
            binding.tenant_id,
            binding.agent_id,
            callable_roster=binding.binding_type == WorkflowAgentBindingType.ROSTER_AGENT,
        )
        if agent is None or agent.status == AgentStatus.ARCHIVED:
            availability = (
                "an unavailable or unpublished roster agent"
                if binding.binding_type == WorkflowAgentBindingType.ROSTER_AGENT
                else "an unavailable agent"
            )
            raise WorkflowAgentNodeValidationError(f"Workflow Agent node {binding.node_id} references {availability}.")

        snapshot_id = (
            agent.active_config_snapshot_id
            if binding.binding_type == WorkflowAgentBindingType.ROSTER_AGENT
            else binding.current_snapshot_id
        )
        if snapshot_id is None:
            raise WorkflowAgentNodeValidationError(
                f"Workflow Agent node {binding.node_id} is missing config snapshot binding."
            )

        snapshot = self._repository.get_snapshot(binding.tenant_id, agent.id, snapshot_id)
        if snapshot is None:
            raise WorkflowAgentNodeValidationError(
                f"Workflow Agent node {binding.node_id} references a missing config snapshot."
            )

        agent_soul = AgentSoulConfig.model_validate(snapshot.config_snapshot_dict)
        if require_agent_model and agent_soul.model is None:
            raise WorkflowAgentNodeValidationError(
                f"Workflow Agent node {binding.node_id} requires Agent Soul model config."
            )
        self._validate_agent_soul_env(binding=binding, agent_soul=agent_soul)
        self._validate_agent_soul_tools(binding=binding, agent_soul=agent_soul)
        self._validate_agent_soul_knowledge(binding=binding, agent_soul=agent_soul)
        node_job = WorkflowNodeJobConfig.model_validate(binding.node_job_config_dict)
        if require_agent_model:
            node_job.output_routes.validate_for_execution()
        self.validate_node_job(binding=binding, node_job=node_job, topology=topology)

    def validate_node_job(
        self,
        *,
        binding: WorkflowBindingRecord,
        node_job: WorkflowNodeJobConfig,
        topology: WorkflowGraphTopology | None = None,
    ) -> None:
        self._validate_locked_agent_soul_not_overridden(binding=binding, node_job=node_job)

        output_names: set[str] = set()
        for output in node_job.declared_outputs:
            if output.name in output_names:
                raise WorkflowAgentNodeValidationError(
                    f"Workflow Agent node {binding.node_id} has duplicate output name {output.name}."
                )
            output_names.add(output.name)
            # Stage 4 §4.3: declared output carries a single optional check, gated by
            # ``check.enabled``. Only enabled checks need their benchmark file resolved.
            if output.check is not None and output.check.enabled and output.check.benchmark_file_ref is not None:
                self._validate_file_ref(
                    binding=binding,
                    file_ref=output.check.benchmark_file_ref,
                    ref_context=f"output {output.name} benchmark file",
                )

        route_refs = (
            workflow_previous_node_output_refs_from_selectors(
                extract_workflow_node_output_selectors("\n".join(route.name for route in node_job.output_routes.routes))
            )
            if node_job.output_routes.enabled
            else []
        )
        for ref in [*node_job.previous_node_output_refs, *route_refs]:
            selector = self.selector_from_ref(ref)
            if selector is None:
                raise WorkflowAgentNodeValidationError(
                    f"Workflow Agent node {binding.node_id} has invalid previous node output ref."
                )
            if len(selector) < 2:
                raise WorkflowAgentNodeValidationError(
                    f"Workflow Agent node {binding.node_id} has incomplete previous node output ref."
                )
            if topology is None:
                continue
            source_node_id = selector[0]
            if not topology.has_node(source_node_id):
                raise WorkflowAgentNodeValidationError(
                    f"Workflow Agent node {binding.node_id} references missing previous node {source_node_id}."
                )
            if not topology.is_upstream(source_node_id=source_node_id, target_node_id=binding.node_id):
                raise WorkflowAgentNodeValidationError(
                    f"Workflow Agent node {binding.node_id} references non-upstream previous node {source_node_id}."
                )

        for human_ref in node_job.human_contacts:
            self._validate_human_ref(binding=binding, human_ref=human_ref)

        file_refs = node_job.metadata.file_refs
        if isinstance(file_refs, list):
            for file_ref in file_refs:
                self._validate_file_ref(
                    binding=binding,
                    file_ref=file_ref,
                    ref_context="metadata file ref",
                )

    @staticmethod
    def iter_agent_v2_nodes(graph_dict: Mapping[str, Any]) -> Iterator[tuple[str, Mapping[str, Any]]]:
        nodes = graph_dict.get("nodes")
        if not isinstance(nodes, list):
            return
        for node in nodes:
            if not isinstance(node, Mapping):
                continue
            node_id = node.get("id")
            node_data = node.get("data")
            if not isinstance(node_id, str) or not isinstance(node_data, Mapping):
                continue
            if is_dify_agent_node_data(node_data):
                yield node_id, node_data

    @staticmethod
    def iter_tool_nodes(graph_dict: Mapping[str, Any]) -> Iterator[tuple[str, Mapping[str, Any]]]:
        nodes = graph_dict.get("nodes")
        if not isinstance(nodes, list):
            return
        for node in nodes:
            if not isinstance(node, Mapping):
                continue
            node_id = node.get("id")
            node_data = node.get("data")
            if not isinstance(node_id, str) or not isinstance(node_data, Mapping):
                continue
            if node_data.get("type") == BuiltinNodeTypes.TOOL:
                yield node_id, node_data

    @staticmethod
    def selector_from_ref(ref: WorkflowPreviousNodeOutputRef) -> list[str] | None:
        for key in ("selector", "variable_selector", "value_selector"):
            value = ref.get(key)
            if isinstance(value, list) and all(isinstance(item, str) for item in value):
                return value
        node_id = ref.get("node_id")
        output_name = ref.get("output") or ref.get("name") or ref.get("variable") or ref.get("key")
        if isinstance(node_id, str) and isinstance(output_name, str):
            return [node_id, output_name]
        return None

    @staticmethod
    def _validate_node_schema(*, node_id: str, node_data: Mapping[str, Any]) -> None:
        try:
            DifyAgentNodeData.model_validate(node_data)
        except ValueError as exc:
            raise WorkflowAgentNodeValidationError(
                f"Workflow Agent node {node_id} has invalid Agent v2 node schema: {exc}"
            ) from exc

    def _validate_locked_agent_soul_not_overridden(
        self,
        *,
        binding: WorkflowBindingRecord,
        node_job: WorkflowNodeJobConfig,
    ) -> None:
        forbidden_paths = self._find_locked_agent_soul_paths(
            node_job.metadata.model_dump(mode="python", exclude_none=True)
        )
        if forbidden_paths:
            raise WorkflowAgentNodeValidationError(
                f"Workflow Agent node {binding.node_id} cannot override locked Agent Soul fields: "
                f"{', '.join(sorted(forbidden_paths))}."
            )

    def _find_locked_agent_soul_paths(self, value: Any, *, path: str = "metadata") -> set[str]:
        if not isinstance(value, Mapping):
            return set()
        forbidden: set[str] = set()
        for key, item in value.items():
            key_text = str(key)
            if key_text in self._LOCKED_AGENT_SOUL_KEYS:
                forbidden.add(f"{path}.{key_text}")
            forbidden.update(self._find_locked_agent_soul_paths(item, path=f"{path}.{key_text}"))
        return forbidden

    def _validate_human_ref(
        self,
        *,
        binding: WorkflowBindingRecord,
        human_ref: AgentHumanContactConfig,
    ) -> None:
        contact_id = human_ref.get("contact_id") or human_ref.get("human_id") or human_ref.get("id")
        if not isinstance(contact_id, str) or not contact_id:
            raise WorkflowAgentNodeValidationError(
                f"Workflow Agent node {binding.node_id} has invalid human contact ref."
            )

        tenant_id = human_ref.get("tenant_id")
        if tenant_id is not None and tenant_id != binding.tenant_id:
            raise WorkflowAgentNodeValidationError(
                f"Workflow Agent node {binding.node_id} references out-of-scope human contact {contact_id}."
            )

        channel = human_ref.get("channel") or human_ref.get("method") or human_ref.get("contact_method")
        if channel is not None and channel not in self._SUPPORTED_HUMAN_CONTACT_CHANNELS:
            raise WorkflowAgentNodeValidationError(
                f"Workflow Agent node {binding.node_id} references unsupported human contact channel {channel}."
            )

    def _validate_agent_soul_tools(
        self,
        *,
        binding: WorkflowBindingRecord,
        agent_soul: AgentSoulConfig,
    ) -> None:
        exposed_names: set[str] = set()
        for tool in agent_soul.tools.dify_tools:
            if not tool.enabled:
                continue
            # Provider-level entries (tool_name omitted = all tools of the
            # provider) are deduped per provider here; the names they expand to
            # are checked at runtime by the plugin tools builder.
            provider_key = tool.provider_id or f"{tool.plugin_id}/{tool.provider}"
            exposed_name = tool.tool_name or f"{provider_key}/*"
            if exposed_name in exposed_names:
                raise WorkflowAgentNodeValidationError(
                    f"Workflow Agent node {binding.node_id} has duplicate Dify Plugin Tool name {exposed_name}."
                )
            exposed_names.add(exposed_name)

        cli_tool_names: set[str] = set()
        for cli_tool in agent_soul.tools.cli_tools:
            if not cli_tool.enabled:
                continue
            if self._permission_denied(cli_tool.model_dump(mode="python", exclude_none=True, exclude_defaults=True)):
                raise WorkflowAgentNodeValidationError(
                    f"Workflow Agent node {binding.node_id} has unauthorized CLI Tool config."
                )
            if cli_tool.pre_authorized is False:
                raise WorkflowAgentNodeValidationError(
                    f"Workflow Agent node {binding.node_id} has unauthorized CLI Tool config."
                )
            if self._dangerous_cli_without_acknowledgement(cli_tool.model_dump(mode="python")):
                raise WorkflowAgentNodeValidationError(
                    f"Workflow Agent node {binding.node_id} has unacknowledged dangerous CLI Tool config."
                )
            name = cli_tool.get("name") or cli_tool.get("tool_name") or cli_tool.get("label")
            if not isinstance(name, str) or not name.strip():
                continue
            normalized_name = name.strip()
            if normalized_name in cli_tool_names:
                raise WorkflowAgentNodeValidationError(
                    f"Workflow Agent node {binding.node_id} has duplicate CLI Tool name {normalized_name}."
                )
            cli_tool_names.add(normalized_name)

    def _validate_agent_soul_knowledge(
        self,
        *,
        binding: WorkflowBindingRecord,
        agent_soul: AgentSoulConfig,
    ) -> None:
        """Validate knowledge set dataset rows against the publishing tenant."""
        missing_ids = self._repository.missing_dataset_ids(
            binding.tenant_id, list_agent_soul_knowledge_dataset_ids(agent_soul)
        )
        if missing_ids:
            raise WorkflowAgentNodeValidationError(
                f"Workflow Agent node {binding.node_id} references missing or out-of-scope knowledge datasets: "
                f"{', '.join(missing_ids)}."
            )

    def _validate_agent_soul_env(
        self,
        *,
        binding: WorkflowBindingRecord,
        agent_soul: AgentSoulConfig,
    ) -> None:
        seen_names: set[str] = set()
        self._validate_env_entries(
            binding=binding,
            seen_names=seen_names,
            variables=agent_soul.env.variables,
            secret_refs=agent_soul.env.secret_refs,
            label="agent",
        )
        for cli_tool in agent_soul.tools.cli_tools:
            if not cli_tool.enabled:
                continue
            name = cli_tool.get("name") or cli_tool.get("tool_name") or cli_tool.get("label") or "<unnamed>"
            self._validate_env_entries(
                binding=binding,
                seen_names=seen_names,
                variables=cli_tool.env.variables,
                secret_refs=cli_tool.env.secret_refs,
                label=f"CLI Tool {name}",
            )

    def _validate_env_entries(
        self,
        *,
        binding: WorkflowBindingRecord,
        seen_names: set[str],
        variables: list[Any],
        secret_refs: list[Any],
        label: str,
    ) -> None:
        for env_var in variables:
            name = self._env_name(env_var)
            if not name:
                continue
            if name in seen_names:
                raise WorkflowAgentNodeValidationError(
                    f"Workflow Agent node {binding.node_id} has duplicate env/secret name {name}."
                )
            seen_names.add(name)
        for secret_ref in secret_refs:
            name = self._env_name(secret_ref)
            if not name:
                continue
            if self._permission_denied(secret_ref.model_dump(mode="python", exclude_none=True, exclude_defaults=True)):
                raise WorkflowAgentNodeValidationError(
                    f"Workflow Agent node {binding.node_id} has unauthorized secret reference {name} in {label}."
                )
            if name in seen_names:
                raise WorkflowAgentNodeValidationError(
                    f"Workflow Agent node {binding.node_id} has duplicate env/secret name {name}."
                )
            seen_names.add(name)

    @staticmethod
    def _env_name(value: Any) -> str | None:
        if hasattr(value, "get"):
            for key in ("name", "key", "env_name", "variable"):
                item = value.get(key)
                if isinstance(item, str) and item.strip():
                    return item.strip()
        return None

    def _validate_tool_node_agentic_mode(self, *, node_id: str, node_data: Mapping[str, Any]) -> None:
        agentic_config = self._extract_tool_agentic_config(node_data)
        if agentic_config is None or agentic_config is False:
            return
        if agentic_config is True:
            raise WorkflowAgentNodeValidationError(
                f"Tool node {node_id} has incomplete agentic mode config for publishing."
            )
        if not isinstance(agentic_config, Mapping):
            raise WorkflowAgentNodeValidationError(f"Tool node {node_id} has invalid agentic mode config.")

        if agentic_config.get("enabled") is False:
            return
        if self._permission_denied(agentic_config):
            raise WorkflowAgentNodeValidationError(f"Tool node {node_id} has unauthorized agentic mode config.")
        if agentic_config.get("complete") is False:
            raise WorkflowAgentNodeValidationError(
                f"Tool node {node_id} has incomplete agentic mode config for publishing."
            )

        state = agentic_config.get("state") or agentic_config.get("mode")
        if isinstance(state, str) and state in self._MANUAL_TOOL_AGENTIC_STATES:
            return

        if self._extract_agentic_parameter_draft(agentic_config) is None and not self._tool_node_has_manual_parameters(
            node_data
        ):
            raise WorkflowAgentNodeValidationError(
                f"Tool node {node_id} has incomplete agentic mode config for publishing."
            )

    def _extract_tool_agentic_config(self, node_data: Mapping[str, Any]) -> object | None:
        for key in self._AGENTIC_TOOL_CONFIG_KEYS:
            if key in node_data:
                return node_data[key]
        return None

    @staticmethod
    def _extract_agentic_parameter_draft(agentic_config: Mapping[str, Any]) -> Mapping[str, Any] | None:
        for key in ("parameter_draft", "parameters_draft", "draft_parameters", "inferred_parameters", "parameters"):
            value = agentic_config.get(key)
            if isinstance(value, Mapping) and value:
                return value
        return None

    @staticmethod
    def _tool_node_has_manual_parameters(node_data: Mapping[str, Any]) -> bool:
        for key in ("tool_parameters", "tool_configurations"):
            value = node_data.get(key)
            if isinstance(value, Mapping) and value:
                return True
        return False

    def _permission_denied(self, value: Mapping[str, Any]) -> bool:
        permission = value.get("permission")
        if isinstance(permission, Mapping):
            allowed = permission.get("allowed")
            if allowed is False:
                return True
            status = permission.get("status") or permission.get("state")
            if isinstance(status, str) and status in self._DENIED_PERMISSION_STATUSES:
                return True
        status = value.get("permission_status") or value.get("authorization_status")
        return isinstance(status, str) and status in self._DENIED_PERMISSION_STATUSES

    @staticmethod
    def _dangerous_cli_without_acknowledgement(value: Mapping[str, Any]) -> bool:
        dangerous = any(value.get(key) is True for key in ("dangerous", "dangerous_command", "requires_confirmation"))
        risk_level = value.get("risk_level")
        if isinstance(risk_level, str) and risk_level == "dangerous":
            dangerous = True
        if not dangerous:
            return False
        return not any(
            value.get(key) is True
            for key in ("dangerous_acknowledged", "dangerous_accepted", "risk_accepted", "approved")
        )

    def _validate_file_ref(
        self,
        *,
        binding: WorkflowBindingRecord,
        file_ref: AgentFileRefConfig,
        ref_context: str,
    ) -> None:
        tenant_id = file_ref.get("tenant_id")
        if tenant_id is not None and tenant_id != binding.tenant_id:
            raise WorkflowAgentNodeValidationError(
                f"Workflow Agent node {binding.node_id} references out-of-scope {ref_context}."
            )

        upload_file_id = (
            file_ref.get("upload_file_id") or file_ref.get("file_id") or file_ref.get("id") or file_ref.get("reference")
        )
        if upload_file_id is None and (file_ref.get("url") or file_ref.get("remote_url")):
            return
        if not isinstance(upload_file_id, str) or not upload_file_id:
            raise WorkflowAgentNodeValidationError(f"Workflow Agent node {binding.node_id} has invalid {ref_context}.")

        if not self._repository.upload_exists(binding.tenant_id, upload_file_id):
            raise WorkflowAgentNodeValidationError(
                f"Workflow Agent node {binding.node_id} references missing or out-of-scope {ref_context}."
            )
