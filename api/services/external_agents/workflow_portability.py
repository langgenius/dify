"""Versioned External graph references without connection or execution material."""

import copy
from collections.abc import Callable, Iterator, Mapping
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from .io_contracts import JsonObject
from .workflow_runtime import ExternalNodeJob, is_external_node


class ExternalReference(BaseModel):
    """Opaque source identity; names/URLs are never used to resolve another asset."""

    model_config = ConfigDict(extra="forbid", frozen=True, hide_input_in_errors=True)
    schema_version: Literal[1] = 1
    workspace_id: str = Field(min_length=1, max_length=255, pattern=r"^[A-Za-z0-9_-]+$")
    agent_id: str = Field(min_length=1, max_length=255, pattern=r"^[A-Za-z0-9_-]+$")
    display_name: str = Field(default="", max_length=255)


def iter_external_nodes(graph: Mapping[str, Any]) -> Iterator[tuple[str, dict[str, Any]]]:
    for node in graph.get("nodes", []):
        if isinstance(node, dict) and isinstance(node.get("data"), dict) and is_external_node(node["data"]):
            identifier = node.get("id")
            if not isinstance(identifier, str) or not identifier:
                raise ValueError("External workflow node requires an ID.")
            yield identifier, node["data"]


def reference_value(*, workspace_id: str, agent_id: str, name: str) -> JsonObject:
    return ExternalReference(workspace_id=workspace_id, agent_id=agent_id, display_name=name).model_dump(mode="json")


def portable_node(data: Mapping[str, Any], *, reference: JsonObject | None) -> dict[str, Any]:
    """Allowlist author configuration; include_secret cannot change this boundary.

    Endpoint/auth/revision/context/task/lease/testing fields and Native Soul
    packages have no serialization path. Graph edges and outer layout remain
    owned by the enclosing workflow serializer. Explicit default presence is
    preserved instead of introducing null defaults during a round trip.
    """
    keys = (
        "type",
        "version",
        "agent_node_kind",
        "title",
        "desc",
        "error_strategy",
        "default_value",
        "retry_config",
        "_isInIteration",
        "_isInLoop",
        "iteration_id",
        "loop_id",
    )
    result = {key: copy.deepcopy(data[key]) for key in keys if key in data}
    result.update(ExternalNodeJob.parse_graph(data).model_dump(mode="json", exclude_unset=True))
    result.pop("schema_version", None)
    normalized = ExternalReference.model_validate(reference).model_dump(mode="json") if reference else None
    result["agent_binding"] = {"binding_type": "roster_agent", "original_reference": normalized}
    return result


def import_graph(
    graph: Mapping[str, Any], *, workspace_id: str, selectable: Callable[[str], bool], new_epoch: Callable[[], str]
) -> tuple[dict[str, Any], tuple[str, ...]]:
    """Restore only an exact accessible source identity in the same workspace.

    Disabled assets can retain a reference. Cross-workspace, unavailable and
    unauthorized identities remain editable unconnected nodes. No name/URL
    matching or business I/O occurs, and old contexts/epochs never migrate.
    """
    result = copy.deepcopy(dict(graph))
    missing: list[str] = []
    for node_id, data in iter_external_nodes(result):
        raw_binding = data.get("agent_binding")
        raw_reference = raw_binding.get("original_reference") if isinstance(raw_binding, Mapping) else None
        reference = ExternalReference.model_validate(raw_reference) if raw_reference else None
        safe = portable_node(data, reference=reference.model_dump(mode="json") if reference else None)
        binding = safe["agent_binding"]
        if reference and reference.workspace_id == workspace_id and selectable(reference.agent_id):
            binding["agent_id"] = reference.agent_id
            binding["binding_epoch"] = new_epoch()
        else:
            missing.append(node_id)
        data.clear()
        data.update(safe)
    return result, tuple(missing)


def rebind_graph(
    graph: Mapping[str, Any],
    *,
    node_id: str,
    target: ExternalReference,
    include_matching: bool,
    new_epoch: Callable[[], str],
) -> tuple[dict[str, Any], tuple[str, ...]]:
    """Preflight the complete selection then replace only binding identities.

    Other connected nodes and references are excluded. Author jobs, error
    handling, downstream selectors and edges remain byte-for-byte values;
    incompatibility belongs to Checklist, never an implicit clearing/rollback.
    """
    result = copy.deepcopy(dict(graph))
    nodes = dict(iter_external_nodes(result))
    if node_id not in nodes:
        raise ValueError("The selected External workflow node is absent.")
    selected = nodes[node_id].get("agent_binding") or {}
    if not isinstance(selected, Mapping):
        raise ValueError("The selected External binding is invalid.")
    source = selected.get("original_reference")
    source_ref = ExternalReference.model_validate(source) if source else None
    candidates = [node_id]
    if include_matching and source_ref is not None:
        for identifier, data in nodes.items():
            binding = data.get("agent_binding") or {}
            if not isinstance(binding, Mapping):
                raise ValueError("An External binding is invalid.")
            reference = binding.get("original_reference")
            if identifier != node_id and not binding.get("agent_id") and reference:
                other = ExternalReference.model_validate(reference)
                if (other.workspace_id, other.agent_id) == (source_ref.workspace_id, source_ref.agent_id):
                    candidates.append(identifier)
    # Every selected structural reference is validated before any replacement.
    for identifier in candidates:
        binding = nodes[identifier].get("agent_binding") or {}
        epoch = binding.get("binding_epoch") if binding.get("agent_id") == target.agent_id else None
        nodes[identifier]["agent_binding"] = {
            "binding_type": "roster_agent",
            "agent_id": target.agent_id,
            "binding_epoch": epoch or new_epoch(),
            "original_reference": target.model_dump(mode="json"),
        }
    return result, tuple(candidates)
