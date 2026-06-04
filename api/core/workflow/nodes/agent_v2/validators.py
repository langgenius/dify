from __future__ import annotations

from collections import defaultdict, deque
from collections.abc import Iterator, Mapping, Sequence
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from graphon.enums import BuiltinNodeTypes
from models.agent import Agent, AgentConfigSnapshot, AgentStatus, WorkflowAgentNodeBinding
from models.agent_config_entities import (
    AgentFileRefConfig,
    AgentHumanContactConfig,
    AgentSoulConfig,
    WorkflowNodeJobConfig,
    WorkflowPreviousNodeOutputRef,
)
from models.model import UploadFile
from models.workflow import Workflow

from .entities import DifyAgentNodeData


class WorkflowAgentNodeValidationError(ValueError):
    """Raised when a Workflow Agent v2 node cannot be executed or published."""


class WorkflowAgentNodeValidator:
    """Validate Agent v2 workflow nodes against graph topology and persisted bindings."""

    _LOCKED_AGENT_SOUL_KEYS = frozenset(
        {
            "agent_soul",
            "soul",
            "prompt",
            "system_prompt",
            "skills_files",
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

    @classmethod
    def validate_draft_workflow(cls, *, session: Session, workflow: Workflow) -> None:
        cls._validate_workflow(session=session, workflow=workflow, require_binding=False)

    @classmethod
    def validate_published_workflow(cls, *, session: Session, workflow: Workflow) -> None:
        cls._validate_workflow(session=session, workflow=workflow, require_binding=True)

    @classmethod
    def _validate_workflow(cls, *, session: Session, workflow: Workflow, require_binding: bool) -> None:
        graph = workflow.graph_dict
        topology = _WorkflowGraphTopology.from_graph(graph)
        for node_id, node_data in cls.iter_agent_v2_nodes(graph):
            cls._validate_node_schema(node_id=node_id, node_data=node_data)
            binding = cls._find_binding(
                session=session,
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
            cls.validate_binding(session=session, binding=binding, topology=topology)

        if require_binding:
            for node_id, node_data in cls.iter_tool_nodes(graph):
                cls._validate_tool_node_agentic_mode(node_id=node_id, node_data=node_data)

    @classmethod
    def validate_binding(
        cls,
        *,
        session: Session,
        binding: WorkflowAgentNodeBinding,
        topology: _WorkflowGraphTopology | None = None,
    ) -> None:
        if binding.agent_id is None:
            raise WorkflowAgentNodeValidationError(f"Workflow Agent node {binding.node_id} is missing agent binding.")
        if binding.current_snapshot_id is None:
            raise WorkflowAgentNodeValidationError(
                f"Workflow Agent node {binding.node_id} is missing config snapshot binding."
            )

        agent = session.scalar(
            select(Agent)
            .where(
                Agent.tenant_id == binding.tenant_id,
                Agent.id == binding.agent_id,
            )
            .limit(1)
        )
        if agent is None or agent.status == AgentStatus.ARCHIVED:
            raise WorkflowAgentNodeValidationError(
                f"Workflow Agent node {binding.node_id} references an unavailable agent."
            )

        snapshot = session.scalar(
            select(AgentConfigSnapshot)
            .where(
                AgentConfigSnapshot.tenant_id == binding.tenant_id,
                AgentConfigSnapshot.agent_id == agent.id,
                AgentConfigSnapshot.id == binding.current_snapshot_id,
            )
            .limit(1)
        )
        if snapshot is None:
            raise WorkflowAgentNodeValidationError(
                f"Workflow Agent node {binding.node_id} references a missing config snapshot."
            )

        agent_soul = AgentSoulConfig.model_validate(snapshot.config_snapshot_dict)
        if agent_soul.model is None:
            raise WorkflowAgentNodeValidationError(
                f"Workflow Agent node {binding.node_id} requires Agent Soul model config."
            )
        cls._validate_agent_soul_env(binding=binding, agent_soul=agent_soul)
        cls._validate_agent_soul_tools(binding=binding, agent_soul=agent_soul)
        node_job = WorkflowNodeJobConfig.model_validate(binding.node_job_config_dict)
        cls.validate_node_job(session=session, binding=binding, node_job=node_job, topology=topology)

    @classmethod
    def validate_node_job(
        cls,
        *,
        session: Session,
        binding: WorkflowAgentNodeBinding,
        node_job: WorkflowNodeJobConfig,
        topology: _WorkflowGraphTopology | None = None,
    ) -> None:
        cls._validate_locked_agent_soul_not_overridden(binding=binding, node_job=node_job)

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
                cls._validate_file_ref(
                    session=session,
                    binding=binding,
                    file_ref=output.check.benchmark_file_ref,
                    ref_context=f"output {output.name} benchmark file",
                )

        for ref in node_job.previous_node_output_refs:
            selector = cls.selector_from_ref(ref)
            if selector is None:
                raise WorkflowAgentNodeValidationError(
                    f"Workflow Agent node {binding.node_id} has invalid previous node output ref."
                )
            if topology is None:
                continue
            if len(selector) < 2:
                raise WorkflowAgentNodeValidationError(
                    f"Workflow Agent node {binding.node_id} has incomplete previous node output ref."
                )
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
            cls._validate_human_ref(binding=binding, human_ref=human_ref)

        file_refs = node_job.metadata.file_refs
        if isinstance(file_refs, list):
            for file_ref in file_refs:
                cls._validate_file_ref(
                    session=session,
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
            if node_data.get("type") == BuiltinNodeTypes.AGENT and str(node_data.get("version")) == "2":
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

    @classmethod
    def _validate_locked_agent_soul_not_overridden(
        cls,
        *,
        binding: WorkflowAgentNodeBinding,
        node_job: WorkflowNodeJobConfig,
    ) -> None:
        forbidden_paths = cls._find_locked_agent_soul_paths(node_job.metadata.model_dump(mode="python"))
        if forbidden_paths:
            raise WorkflowAgentNodeValidationError(
                f"Workflow Agent node {binding.node_id} cannot override locked Agent Soul fields: "
                f"{', '.join(sorted(forbidden_paths))}."
            )

    @classmethod
    def _find_locked_agent_soul_paths(cls, value: Any, *, path: str = "metadata") -> set[str]:
        if not isinstance(value, Mapping):
            return set()
        forbidden: set[str] = set()
        for key, item in value.items():
            key_text = str(key)
            if key_text in cls._LOCKED_AGENT_SOUL_KEYS:
                forbidden.add(f"{path}.{key_text}")
            forbidden.update(cls._find_locked_agent_soul_paths(item, path=f"{path}.{key_text}"))
        return forbidden

    @classmethod
    def _validate_human_ref(
        cls,
        *,
        binding: WorkflowAgentNodeBinding,
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
        if channel is not None and channel not in cls._SUPPORTED_HUMAN_CONTACT_CHANNELS:
            raise WorkflowAgentNodeValidationError(
                f"Workflow Agent node {binding.node_id} references unsupported human contact channel {channel}."
            )

    @classmethod
    def _validate_agent_soul_tools(
        cls,
        *,
        binding: WorkflowAgentNodeBinding,
        agent_soul: AgentSoulConfig,
    ) -> None:
        exposed_names: set[str] = set()
        for tool in agent_soul.tools.dify_tools:
            if not tool.enabled:
                continue
            exposed_name = tool.tool_name
            if exposed_name in exposed_names:
                raise WorkflowAgentNodeValidationError(
                    f"Workflow Agent node {binding.node_id} has duplicate Dify Plugin Tool name {exposed_name}."
                )
            exposed_names.add(exposed_name)

        cli_tool_names: set[str] = set()
        for cli_tool in agent_soul.tools.cli_tools:
            if not cli_tool.enabled:
                continue
            if cls._permission_denied(cli_tool.model_dump(mode="python", exclude_none=True, exclude_defaults=True)):
                raise WorkflowAgentNodeValidationError(
                    f"Workflow Agent node {binding.node_id} has unauthorized CLI Tool config."
                )
            if cli_tool.pre_authorized is False:
                raise WorkflowAgentNodeValidationError(
                    f"Workflow Agent node {binding.node_id} has unauthorized CLI Tool config."
                )
            if cls._dangerous_cli_without_acknowledgement(cli_tool.model_dump(mode="python")):
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

    @classmethod
    def _validate_agent_soul_env(
        cls,
        *,
        binding: WorkflowAgentNodeBinding,
        agent_soul: AgentSoulConfig,
    ) -> None:
        seen_names: set[str] = set()
        for env_var in agent_soul.env.variables:
            name = env_var.name
            if not name:
                continue
            if name in seen_names:
                raise WorkflowAgentNodeValidationError(
                    f"Workflow Agent node {binding.node_id} has duplicate env/secret name {name}."
                )
            seen_names.add(name)
        for secret_ref in agent_soul.env.secret_refs:
            name = secret_ref.name
            if not name:
                continue
            if cls._permission_denied(secret_ref.model_dump(mode="python", exclude_none=True, exclude_defaults=True)):
                raise WorkflowAgentNodeValidationError(
                    f"Workflow Agent node {binding.node_id} has unauthorized secret reference {name}."
                )
            if name in seen_names:
                raise WorkflowAgentNodeValidationError(
                    f"Workflow Agent node {binding.node_id} has duplicate env/secret name {name}."
                )
            seen_names.add(name)

    @classmethod
    def _validate_tool_node_agentic_mode(cls, *, node_id: str, node_data: Mapping[str, Any]) -> None:
        agentic_config = cls._extract_tool_agentic_config(node_data)
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
        if cls._permission_denied(agentic_config):
            raise WorkflowAgentNodeValidationError(f"Tool node {node_id} has unauthorized agentic mode config.")
        if agentic_config.get("complete") is False:
            raise WorkflowAgentNodeValidationError(
                f"Tool node {node_id} has incomplete agentic mode config for publishing."
            )

        state = agentic_config.get("state") or agentic_config.get("mode")
        if isinstance(state, str) and state in cls._MANUAL_TOOL_AGENTIC_STATES:
            return

        if cls._extract_agentic_parameter_draft(agentic_config) is None and not cls._tool_node_has_manual_parameters(
            node_data
        ):
            raise WorkflowAgentNodeValidationError(
                f"Tool node {node_id} has incomplete agentic mode config for publishing."
            )

    @classmethod
    def _extract_tool_agentic_config(cls, node_data: Mapping[str, Any]) -> object | None:
        for key in cls._AGENTIC_TOOL_CONFIG_KEYS:
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

    @classmethod
    def _permission_denied(cls, value: Mapping[str, Any]) -> bool:
        permission = value.get("permission")
        if isinstance(permission, Mapping):
            allowed = permission.get("allowed")
            if allowed is False:
                return True
            status = permission.get("status") or permission.get("state")
            if isinstance(status, str) and status in cls._DENIED_PERMISSION_STATUSES:
                return True
        status = value.get("permission_status") or value.get("authorization_status")
        return isinstance(status, str) and status in cls._DENIED_PERMISSION_STATUSES

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

    @staticmethod
    def _validate_file_ref(
        *,
        session: Session,
        binding: WorkflowAgentNodeBinding,
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

        upload_file = session.scalar(
            select(UploadFile)
            .where(
                UploadFile.tenant_id == binding.tenant_id,
                UploadFile.id == upload_file_id,
            )
            .limit(1)
        )
        if upload_file is None:
            raise WorkflowAgentNodeValidationError(
                f"Workflow Agent node {binding.node_id} references missing or out-of-scope {ref_context}."
            )

    @staticmethod
    def _find_binding(
        *,
        session: Session,
        tenant_id: str,
        app_id: str,
        workflow_id: str,
        node_id: str,
    ) -> WorkflowAgentNodeBinding | None:
        return session.scalar(
            select(WorkflowAgentNodeBinding)
            .where(
                WorkflowAgentNodeBinding.tenant_id == tenant_id,
                WorkflowAgentNodeBinding.app_id == app_id,
                WorkflowAgentNodeBinding.workflow_id == workflow_id,
                WorkflowAgentNodeBinding.node_id == node_id,
            )
            .limit(1)
        )


class _WorkflowGraphTopology:
    def __init__(self, *, node_ids: set[str], incoming: Mapping[str, Sequence[str]]) -> None:
        self._node_ids = node_ids
        self._incoming = incoming

    @classmethod
    def from_graph(cls, graph: Mapping[str, Any]) -> _WorkflowGraphTopology:
        node_ids = cls._node_ids_from_graph(graph)
        incoming: dict[str, list[str]] = defaultdict(list)
        edges = graph.get("edges")
        if isinstance(edges, list):
            for edge in edges:
                if not isinstance(edge, Mapping):
                    continue
                source = edge.get("source")
                target = edge.get("target")
                if isinstance(source, str) and isinstance(target, str):
                    incoming[target].append(source)
        return cls(node_ids=node_ids, incoming=incoming)

    def has_node(self, node_id: str) -> bool:
        return node_id in self._node_ids

    def is_upstream(self, *, source_node_id: str, target_node_id: str) -> bool:
        if source_node_id == target_node_id:
            return False
        visited: set[str] = set()
        queue: deque[str] = deque(self._incoming.get(target_node_id, ()))
        while queue:
            candidate = queue.popleft()
            if candidate == source_node_id:
                return True
            if candidate in visited:
                continue
            visited.add(candidate)
            queue.extend(self._incoming.get(candidate, ()))
        return False

    @staticmethod
    def _node_ids_from_graph(graph: Mapping[str, Any]) -> set[str]:
        node_ids: set[str] = set()
        nodes = graph.get("nodes")
        if not isinstance(nodes, list):
            return node_ids
        for node in nodes:
            if not isinstance(node, Mapping):
                continue
            node_id = node.get("id")
            if isinstance(node_id, str):
                node_ids.add(node_id)
        return node_ids
