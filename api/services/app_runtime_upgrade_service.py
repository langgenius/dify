"""Service for upgrading Classic runtime apps to Sandboxed runtime via clone-and-convert.

The upgrade flow:
1. Clone the source app via DSL export/import
2. On the cloned app's draft workflow, convert Agent nodes to LLM nodes
3. Rewrite variable references for all LLM nodes (old output names → new generation-based names)
4. Enable sandbox feature flag

The original app is never modified; the user gets a new sandboxed copy.
"""

import json
import logging
import re
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from models import App, Workflow
from models.workflow_features import WorkflowFeatures
from services.app_dsl_service import AppDslService, ImportMode

logger = logging.getLogger(__name__)

_VAR_REWRITES: dict[str, list[str]] = {
    "text": ["generation", "content"],
    "reasoning_content": ["generation", "reasoning_content"],
}

_PASSTHROUGH_KEYS = (
    "version",
    "error_strategy",
    "default_value",
    "retry_config",
    "parent_node_id",
    "isInLoop",
    "loop_id",
    "isInIteration",
    "iteration_id",
)


class AppRuntimeUpgradeService:
    """Upgrades a Classic-runtime app to Sandboxed runtime by cloning and converting.

    Holds an active SQLAlchemy session; the caller is responsible for commit/rollback.
    """

    session: Session

    def __init__(self, session: Session) -> None:
        self.session = session

    def upgrade(self, app_model: App, account: Any) -> dict[str, Any]:
        """Clone *app_model* and upgrade the clone to sandboxed runtime.

        Returns:
            dict with keys: result, new_app_id, converted_agents, skipped_agents.
        """
        workflow = self._get_draft_workflow(app_model)
        if not workflow:
            return {"result": "no_draft"}

        if workflow.get_feature(WorkflowFeatures.SANDBOX).enabled:
            return {"result": "already_sandboxed"}

        new_app = self._clone_app(app_model, account)
        new_workflow = self._get_draft_workflow(new_app)
        if not new_workflow:
            return {"result": "no_draft"}

        graph = json.loads(new_workflow.graph) if new_workflow.graph else {}
        nodes = graph.get("nodes", [])

        converted, skipped = _convert_agent_nodes(nodes)

        llm_node_ids = {n["id"] for n in nodes if n.get("data", {}).get("type") == "llm"}
        _rewrite_variable_references(nodes, llm_node_ids)

        new_workflow.graph = json.dumps(graph)

        features = json.loads(new_workflow.features) if new_workflow.features else {}
        features.setdefault("sandbox", {})["enabled"] = True
        new_workflow.features = json.dumps(features)

        return {
            "result": "success",
            "new_app_id": str(new_app.id),
            "converted_agents": converted,
            "skipped_agents": skipped,
        }

    def _get_draft_workflow(self, app_model: App) -> Workflow | None:
        stmt = select(Workflow).where(
            Workflow.tenant_id == app_model.tenant_id,
            Workflow.app_id == app_model.id,
            Workflow.version == "draft",
        )
        return self.session.scalar(stmt)

    def _clone_app(self, app_model: App, account: Any) -> App:
        dsl_service = AppDslService(self.session)
        yaml_content = dsl_service.export_dsl(app_model=app_model, include_secret=True)
        result = dsl_service.import_app(
            account=account,
            import_mode=ImportMode.YAML_CONTENT,
            yaml_content=yaml_content,
            name=f"{app_model.name} (Sandboxed)",
        )
        stmt = select(App).where(App.id == result.app_id)
        new_app = self.session.scalar(stmt)
        if not new_app:
            raise RuntimeError(f"Cloned app not found: {result.app_id}")
        return new_app


# ---------------------------------------------------------------------------
# Pure conversion functions (no DB access)
# ---------------------------------------------------------------------------


def _convert_agent_nodes(nodes: list[dict[str, Any]]) -> tuple[int, int]:
    """Convert Agent nodes to LLM nodes in-place. Returns (converted_count, skipped_count)."""
    converted = 0
    skipped = 0

    for node in nodes:
        data = node.get("data", {})
        if data.get("type") != "agent":
            continue

        node_id = node.get("id", "?")
        llm_data = _agent_data_to_llm_data(data)
        if llm_data is None:
            logger.warning("Skipped agent node %s: cannot extract model config", node_id)
            skipped += 1
            continue

        node["data"] = llm_data
        logger.info("Converted agent node %s to LLM", node_id)
        converted += 1

    return converted, skipped


def _agent_data_to_llm_data(agent_data: dict[str, Any]) -> dict[str, Any] | None:
    """Map an Agent node's data dict to an LLM node's data dict.

    Returns None if the conversion cannot be performed (e.g. missing model config).
    """
    params = agent_data.get("agent_parameters", {})

    model_param = params.get("model", {})
    model_value = model_param.get("value") if isinstance(model_param, dict) else None

    if not isinstance(model_value, dict) or not model_value.get("provider") or not model_value.get("model"):
        return None

    model_config = {
        "provider": model_value["provider"],
        "name": model_value["model"],
        "mode": model_value.get("mode", "chat"),
        "completion_params": model_value.get("completion_params", {}),
    }

    tools_param = params.get("tools", {})
    tools_value = tools_param.get("value", []) if isinstance(tools_param, dict) else []
    tools_meta, tool_settings = _convert_tools(tools_value if isinstance(tools_value, list) else [])

    instruction_param = params.get("instruction", {})
    instruction = instruction_param.get("value", "") if isinstance(instruction_param, dict) else ""

    query_param = params.get("query", {})
    query_value = query_param.get("value", "") if isinstance(query_param, dict) else ""

    has_tools = bool(tools_meta)
    prompt_template = _build_prompt_template(
        instruction,
        query_value,
        skill=has_tools,
        tools=tools_value if has_tools else None,
    )

    max_iter_param = params.get("maximum_iterations", {})
    max_iterations = max_iter_param.get("value", 100) if isinstance(max_iter_param, dict) else 100

    llm_data: dict[str, Any] = {
        "type": "llm",
        "title": agent_data.get("title", "LLM"),
        "desc": agent_data.get("desc", ""),
        "model": model_config,
        "prompt_template": prompt_template,
        "prompt_config": {"jinja2_variables": []},
        "memory": agent_data.get("memory"),
        "context": {"enabled": False},
        "vision": {"enabled": False},
        "computer_use": bool(tools_meta),
        "structured_output_switch_on": False,
        "reasoning_format": "separated",
        "tools": tools_meta,
        "tool_settings": tool_settings,
        "max_iterations": max_iterations,
    }

    for key in _PASSTHROUGH_KEYS:
        if key in agent_data:
            llm_data[key] = agent_data[key]

    return llm_data


def _convert_tools(
    tools_input: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Convert agent tool dicts to (ToolMetadata[], ToolSetting[]).

    Agent tools in graph JSON already use provider_name/settings/parameters —
    the same field names as LLM ToolMetadata. We pass them through with defaults
    for any missing fields.
    """
    tools_meta: list[dict[str, Any]] = []
    tool_settings: list[dict[str, Any]] = []

    for ts in tools_input:
        if not isinstance(ts, dict):
            continue

        provider_name = ts.get("provider_name", "")
        tool_name = ts.get("tool_name", "")
        tool_type = ts.get("type", "builtin")

        tools_meta.append(
            {
                "enabled": True,
                "type": tool_type,
                "provider_name": provider_name,
                "tool_name": tool_name,
                "plugin_unique_identifier": ts.get("plugin_unique_identifier"),
                "credential_id": ts.get("credential_id"),
                "parameters": ts.get("parameters", {}),
                "settings": ts.get("settings", {}) or ts.get("tool_configuration", {}),
                "extra": ts.get("extra", {}),
            }
        )

        tool_settings.append(
            {
                "type": tool_type,
                "provider": provider_name,
                "tool_name": tool_name,
                "enabled": True,
            }
        )

    return tools_meta, tool_settings


def _build_prompt_template(
    instruction: Any,
    query: Any,
    *,
    skill: bool = False,
    tools: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Build LLM prompt_template from Agent instruction and query values.

    When *skill* is True each message gets ``"skill": True`` so the sandbox
    engine treats the prompt as a skill document.

    When *tools* is provided, tool reference placeholders
    (``§[tool].[provider].[name].[uuid]§``) are appended to the system
    message and the corresponding ``ToolReference`` entries are placed in the
    message's ``metadata.tools`` dict so the skill assembler can resolve them.
    Tools from the same provider are grouped into a single token list.
    """
    messages: list[dict[str, Any]] = []

    system_text = instruction if isinstance(instruction, str) else (str(instruction) if instruction else "")
    metadata: dict[str, Any] | None = None

    if tools:
        tool_refs: dict[str, dict[str, Any]] = {}
        provider_groups: dict[str, list[str]] = {}
        for ts in tools:
            if not isinstance(ts, dict):
                continue
            tool_uuid = str(uuid.uuid4())
            provider_id = ts.get("provider_name", "")
            tool_name = ts.get("tool_name", "")
            tool_type = ts.get("type", "builtin")

            token = f"§[tool].[{provider_id}].[{tool_name}].[{tool_uuid}]§"
            provider_groups.setdefault(provider_id, []).append(token)
            tool_refs[tool_uuid] = {
                "type": tool_type,
                "configuration": {"fields": []},
                "enabled": True,
                **({"credential_id": ts.get("credential_id")} if ts.get("credential_id") else {}),
            }

        if provider_groups:
            group_texts: list[str] = []
            for tokens in provider_groups.values():
                if len(tokens) == 1:
                    group_texts.append(tokens[0])
                else:
                    group_texts.append("[" + ",".join(tokens) + "]")
            all_tools_text = " ".join(group_texts)
            system_text = f"{system_text}\n\n{all_tools_text}" if system_text else all_tools_text
            metadata = {"tools": tool_refs, "files": []}

    if system_text:
        msg: dict[str, Any] = {"role": "system", "text": system_text, "skill": skill}
        if metadata:
            msg["metadata"] = metadata
        messages.append(msg)

    if isinstance(query, list) and len(query) >= 2:
        template_ref = "{{#" + ".".join(str(s) for s in query) + "#}}"
        messages.append({"role": "user", "text": template_ref, "skill": skill})
    elif query:
        messages.append({"role": "user", "text": str(query), "skill": skill})

    if not messages:
        messages.append({"role": "user", "text": "", "skill": skill})

    return messages


def _rewrite_variable_references(nodes: list[dict[str, Any]], llm_ids: set[str]) -> None:
    """Recursively walk all node data and rewrite variable references for LLM nodes.

    Handles two forms:
    - Structured selectors: [node_id, "text"] → [node_id, "generation", "content"]
    - Template strings: {{#node_id.text#}} → {{#node_id.generation.content#}}
    """
    if not llm_ids:
        return

    escaped_ids = [re.escape(nid) for nid in llm_ids]
    patterns: list[tuple[re.Pattern[str], str]] = []
    for old_name, new_path in _VAR_REWRITES.items():
        pattern = re.compile(r"\{\{#(" + "|".join(escaped_ids) + r")\." + re.escape(old_name) + r"#\}\}")
        replacement = r"{{#\1." + ".".join(new_path) + r"#}}"
        patterns.append((pattern, replacement))

    for node in nodes:
        data = node.get("data", {})
        _walk_and_rewrite(data, llm_ids, patterns)


def _walk_and_rewrite(
    obj: Any,
    llm_ids: set[str],
    template_patterns: list[tuple[re.Pattern[str], str]],
) -> Any:
    """Recursively rewrite variable references in a nested data structure."""
    if isinstance(obj, dict):
        for key, value in obj.items():
            obj[key] = _walk_and_rewrite(value, llm_ids, template_patterns)
        return obj

    if isinstance(obj, list):
        if _is_variable_selector(obj, llm_ids):
            return _rewrite_selector(obj)
        for i, item in enumerate(obj):
            obj[i] = _walk_and_rewrite(item, llm_ids, template_patterns)
        return obj

    if isinstance(obj, str):
        for pattern, replacement in template_patterns:
            obj = pattern.sub(replacement, obj)
        return obj

    return obj


def _is_variable_selector(lst: list, llm_ids: set[str]) -> bool:
    """Check if a list is a structured variable selector pointing to an LLM node output."""
    if len(lst) < 2:
        return False
    if not all(isinstance(s, str) for s in lst):
        return False
    return lst[0] in llm_ids and lst[1] in _VAR_REWRITES


def _rewrite_selector(selector: list[str]) -> list[str]:
    """Rewrite [node_id, "text"] → [node_id, "generation", "content"]."""
    old_field = selector[1]
    new_path = _VAR_REWRITES[old_field]
    return [selector[0]] + new_path + selector[2:]
