"""Slash-menu candidates assembly (ENG-615).

Pure assembly over injected loaders so the upstream-graph computation and the
per-source mapping are unit-testable without a database. IO wiring (draft
workflow / bindings / draft variables / datasets / workspace tools) lives in
``AgentComposerService.get_*_candidates``.

``previous_node_outputs`` entries are emitted in the stored
``WorkflowPreviousNodeOutputRef`` shape (``selector``/``node_id``/``output``/
``name``) so the frontend can write a selected candidate back into
``node_job.previous_node_output_refs`` verbatim; display extras
(``node_title``/``node_kind``/``value_type``/``inferred``) ride along via the
flexible config schema. Output enumeration follows the Node Output Inspector:
start variables + recorded ``sys.*`` variables are static, Agent v2 nodes use
their binding's declared outputs, and every other node kind is inferred from
the latest draft-run variables (``inferred: true``).
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any

from models.agent_config_entities import (
    AgentSoulConfig,
    DeclaredOutputConfig,
)

MAX_CANDIDATES_PER_LIST = 200

_SYSTEM_NODE_ID = "sys"

# loader signatures injected by the service layer
DeclaredOutputsLoader = Callable[[str], list[DeclaredOutputConfig] | None]
DraftVariablesLoader = Callable[[str], list[tuple[str, str | None]]]
SystemVariablesLoader = Callable[[], list[tuple[str, str | None]]]
DatasetLookup = Callable[[list[str]], Mapping[str, Any]]
WorkspaceToolsLoader = Callable[[], list[dict[str, Any]]]


def previous_node_output_candidates(
    *,
    graph: Mapping[str, Any],
    node_id: str,
    declared_outputs_loader: DeclaredOutputsLoader,
    draft_variables_loader: DraftVariablesLoader,
    system_variables_loader: SystemVariablesLoader,
) -> tuple[list[dict[str, Any]], bool]:
    """Enumerate upstream node outputs for ``node_id`` as writable ref candidates."""
    from core.workflow.graph_topology import WorkflowGraphTopology

    topology = WorkflowGraphTopology.from_graph(graph)
    upstream = topology.upstream_node_ids(node_id)

    entries: list[dict[str, Any]] = []
    for name, value_type in system_variables_loader():
        entries.append(
            _ref_entry(
                node_id=_SYSTEM_NODE_ID,
                output=name,
                node_title="System",
                node_kind="system",
                value_type=value_type,
                inferred=True,
            )
        )

    nodes = graph.get("nodes")
    for node in nodes if isinstance(nodes, list) else []:
        if not isinstance(node, Mapping):
            continue
        nid = node.get("id")
        if not isinstance(nid, str) or nid not in upstream:
            continue
        raw_data = node.get("data")
        data: Mapping[str, Any] = raw_data if isinstance(raw_data, Mapping) else {}
        kind = str(data.get("type") or "unknown")
        title = str(data.get("title") or nid)

        if kind == "start":
            for variable in data.get("variables") or []:
                if not isinstance(variable, Mapping):
                    continue
                var_name = variable.get("variable")
                if isinstance(var_name, str) and var_name:
                    entries.append(
                        _ref_entry(
                            node_id=nid,
                            output=var_name,
                            node_title=title,
                            node_kind=kind,
                            value_type=variable.get("type") if isinstance(variable.get("type"), str) else None,
                            inferred=False,
                        )
                    )
            continue

        declared: list[DeclaredOutputConfig] | None = None
        if kind == "agent" and str(data.get("version", "")) == "2":
            declared = declared_outputs_loader(nid)
        if declared is not None:
            for output in declared:
                entries.append(
                    _ref_entry(
                        node_id=nid,
                        output=output.name,
                        node_title=title,
                        node_kind=kind,
                        value_type=output.type.value,
                        inferred=False,
                    )
                )
            continue

        for var_name, value_type in draft_variables_loader(nid):
            entries.append(
                _ref_entry(
                    node_id=nid,
                    output=var_name,
                    node_title=title,
                    node_kind=kind,
                    value_type=value_type,
                    inferred=True,
                )
            )

    return _capped(entries)


def soul_candidates(
    *,
    agent_soul: AgentSoulConfig | None,
    dataset_lookup: DatasetLookup,
    workspace_tools_loader: WorkspaceToolsLoader,
) -> tuple[dict[str, list[dict[str, Any]]], bool]:
    """Assemble the soul-surface candidate lists (design §3.2)."""
    soul = agent_soul or AgentSoulConfig()
    truncated = False

    skills_files = [{"kind": "skill", **skill.model_dump(exclude_none=True)} for skill in soul.skills_files.skills]
    skills_files += [{"kind": "file", **file.model_dump(exclude_none=True)} for file in soul.skills_files.files]

    cli_tools = [tool.model_dump(exclude_none=True) for tool in soul.tools.cli_tools if tool.enabled]

    dataset_ids = [dataset.id for dataset in soul.knowledge.datasets if dataset.id]
    dataset_rows = dataset_lookup(dataset_ids) if dataset_ids else {}
    knowledge_datasets: list[dict[str, Any]] = []
    for dataset in soul.knowledge.datasets:
        if not dataset.id:
            continue
        row = dataset_rows.get(dataset.id)
        knowledge_datasets.append(
            {
                "id": dataset.id,
                "name": (getattr(row, "name", None) or dataset.name or dataset.id),
                "description": getattr(row, "description", None) or dataset.description,
                "missing": row is None,
            }
        )

    human_contacts = [contact.model_dump(exclude_none=True) for contact in soul.human.contacts]
    dify_tools = workspace_tools_loader()

    lists = {
        "skills_files": skills_files,
        "dify_tools": dify_tools,
        "cli_tools": cli_tools,
        "knowledge_datasets": knowledge_datasets,
        "human_contacts": human_contacts,
    }
    capped: dict[str, list[dict[str, Any]]] = {}
    for key, values in lists.items():
        clipped, was_clipped = _capped(values)
        truncated = truncated or was_clipped
        capped[key] = clipped
    return capped, truncated


def _ref_entry(
    *,
    node_id: str,
    output: str,
    node_title: str,
    node_kind: str,
    value_type: str | None,
    inferred: bool,
) -> dict[str, Any]:
    return {
        "selector": [node_id, output],
        "node_id": node_id,
        "output": output,
        "name": f"{node_title}/{output}",
        "node_title": node_title,
        "node_kind": node_kind,
        "value_type": value_type,
        "inferred": inferred,
    }


def _capped(values: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], bool]:
    if len(values) > MAX_CANDIDATES_PER_LIST:
        return values[:MAX_CANDIDATES_PER_LIST], True
    return values, False


__all__ = [
    "MAX_CANDIDATES_PER_LIST",
    "previous_node_output_candidates",
    "soul_candidates",
]
