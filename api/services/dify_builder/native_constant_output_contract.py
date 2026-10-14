"""Pure bounded context for native constant producers and mutable assignments.

Fresh bindings describe the generation schema, not observed configuration.
Retained bindings require exact native identity; raw absent versions default to
v1, so absence cannot establish assigner v2. Start bindings identify the real
producer only, without establishing input names, types or mutable targets.
"""

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import NamedTuple

_KNOWN_IDENTITIES = frozenset({("start", "1"), ("assigner", "2"), ("template-transform", "1")})
_MAX_NODES = 512
_MAX_EDGES = 1024
_MAX_PLAN_CHARS = 1_000_000
_MAX_CONTEXT_BYTES = 16_000
_HEADING = "# Native constant and mutation producer contracts\n\n"
_SYSTEM_RULES = (
    "# Native constant and mutation generation rules\n\n"
    "Native assigner v2 publishes no own outputs. It updates an existing declared mutable "
    "conversation or loop variable; do not invent the target variable. "
    "An assigned value stays under that existing target selector, not under the assigner node ID. "
    "Native template-transform v1 publishes output:string. A new scalar or branch constant needs "
    "a publishing node; a literal template uses the requested literal text and variables=[] "
    'when it references no inputs. Consumers select [<bound producer ID>,"output"]. '
    "An End output label may name the published result without renaming its producer root. "
    "For End, outputs[].variable is the public workflow output name; preserve the name requested "
    "in the original user request and reflected by the node purpose. "
    "Keep value_selector on the actual upstream producer ID and its published output root. "
    "Do not copy example labels result or output unless requested as the public name. "
    "Preserve existing authored End output names unless the original request explicitly changes them. "
    "Preserve the original user goal and valid authored mutable assignments. "
    "Do not automatically rewrite node types/configuration or invent upstream outputs. "
    "All selectors/placeholders must use the actual bound producer ID. "
    "Node types and labels are not automatic IDs; never substitute literal start for a different Start ID. "
    "If start is the actual bound ID, preserve it. "
    "A Start binding identifies its producer only; "
    "unavailable input declarations establish no variable names or types. "
    "Use only explicitly supplied input declarations. "
    "Fresh planned bindings describe generation schemas, not observed saved configuration. "
    'For assigner v2, emit explicit version="2". '
    "Only qualified native bindings establish these producer facts; unavailable or unknown bindings do not. "
    "Dynamic Code/Tool outputs retain their own declared/provider contracts."
)
_BUILD_CAPABILITY_RULES = (
    "# Native build capability and external resource scope\n\n"
    "The native workflow vocabulary describes built-in draft building blocks. "
    "AVAILABLE lists selected external resources, not every native workflow capability. "
    "The recommendation/selected candidate list is a non-exhaustive subset, not the complete workspace inventory. "
    "An absent named Tool, model, or NewAgent candidate means recommendation/binding coverage is unconfirmed; "
    "it does not establish that the resource is uninstalled, unavailable, or permission denied in the workspace. "
    "An empty selected external resources list does not establish that native building blocks are unavailable. "
    "Preserve explicitly requested named Tool, model, or NewAgent requirements; "
    "do not silently substitute a native node for that identity. "
    "Keep missing identity, action schema, setup and readiness constraints explicit. "
    "Installed tools requiring setup may cover a draft step with that setup requirement; do not claim they are ready. "
    "A native draft building block does not grant runtime admission, network access, "
    "authorization or credential readiness. "
    "Do not invent credentials, endpoints, installed identities or execution permission. "
    "Respect optional and negative resource instructions in the original source."
)


def native_constant_output_system_rules() -> str:
    """Fixed native producer rules; no authored values are interpolated."""
    return _SYSTEM_RULES


def native_build_capability_system_rules() -> str:
    """Keep native draft coverage separate from resources and execution grants."""
    return _BUILD_CAPABILITY_RULES


class _ProducerBinding(NamedTuple):
    node_id: str
    node_type: str
    version: str
    identity_source: str


@dataclass(frozen=True)
class ConstantPlanContext:
    """Immutable identity/topology snapshot taken before caller last-wins maps."""

    producers: tuple[_ProducerBinding, ...]
    node_ids: frozenset[str]
    edges: tuple[tuple[str, str], ...]
    unavailable: bool = False


def _unique_nodes(nodes: Sequence[object]) -> dict[str, Mapping[str, object]]:
    counts: dict[str, int] = {}
    by_id: dict[str, Mapping[str, object]] = {}
    for node in nodes:
        if not isinstance(node, Mapping):
            continue
        node_id = node.get("id")
        if isinstance(node_id, str) and node_id:
            counts[node_id] = counts.get(node_id, 0) + 1
            by_id[node_id] = node
    return {node_id: node for node_id, node in by_id.items() if counts[node_id] == 1}


def snapshot_native_constant_plan_context(
    plan_nodes: Sequence[object], plan_edges: Sequence[object], current_nodes: Sequence[object]
) -> ConstantPlanContext:
    """Qualify fresh schema intent and retained actual type/version independently."""
    unavailable = ConstantPlanContext((), frozenset(), (), True)
    if len(plan_nodes) > _MAX_NODES or len(current_nodes) > _MAX_NODES or len(plan_edges) > _MAX_EDGES:
        return unavailable
    try:
        if len(json.dumps([plan_nodes, plan_edges], ensure_ascii=False)) > _MAX_PLAN_CHARS:
            return unavailable
    except (TypeError, ValueError):
        return unavailable
    plan, current = _unique_nodes(plan_nodes), _unique_nodes(current_nodes)
    if len(plan) != len(plan_nodes) or len(current) != len(current_nodes):
        return unavailable
    producers: list[_ProducerBinding] = []
    for node_id, node in plan.items():
        if node.get("action") == "keep" and node_id in current:
            data = current[node_id].get("data")
            identity_source = "retained-config"
        else:
            node_type = node.get("node_type")
            data = {"type": node_type, "version": "2" if node_type == "assigner" else "1"}
            identity_source = "planned-schema"
        if not isinstance(data, Mapping):
            continue
        node_type, version = data.get("type"), data.get("version", "1")
        if isinstance(node_type, str) and isinstance(version, str) and (node_type, version) in _KNOWN_IDENTITIES:
            producers.append(_ProducerBinding(node_id, node_type, version, identity_source))
    edges = tuple(
        (edge["source"], edge["target"])
        for edge in plan_edges
        if isinstance(edge, Mapping)
        and isinstance(edge.get("source"), str)
        and isinstance(edge.get("target"), str)
        and edge["source"] in plan
        and edge["target"] in plan
    )
    return ConstantPlanContext(tuple(producers), frozenset(plan), edges)


def format_native_constant_output_context(context: ConstantPlanContext | None, target_node_id: str) -> tuple[str, str]:
    """Return fixed SYSTEM rules and bounded escaped USER producer bindings."""
    if context is None:
        return "", ""
    unavailable = _HEADING + '{"state":"unavailable","producers":[]}\n\n'
    if context.unavailable or target_node_id not in context.node_ids:
        return _SYSTEM_RULES, unavailable
    parents: dict[str, set[str]] = {}
    for source, target in context.edges:
        parents.setdefault(target, set()).add(source)
    relevant, pending = {target_node_id}, [target_node_id]
    while pending:
        for parent in parents.get(pending.pop(), ()):
            if parent not in relevant:
                relevant.add(parent)
                pending.append(parent)
    producers: list[dict[str, object]] = []
    for binding in context.producers:
        if binding.node_id not in relevant:
            continue
        item: dict[str, object] = {
            "node_id": binding.node_id,
            "node_type": binding.node_type,
            "version": binding.version,
            "identity_source": binding.identity_source,
        }
        if binding.node_type == "start":
            item["output_declarations"] = "not_asserted"
        else:
            item["output_roots"] = {"output": "string"} if binding.node_type == "template-transform" else {}
        producers.append(item)
    if not producers:
        return "", ""
    user = (
        _HEADING
        + json.dumps({"state": "known", "producers": producers}, ensure_ascii=True, separators=(",", ":"))
        + "\n\n"
    )
    if len(user.encode()) + len(_SYSTEM_RULES.encode()) > _MAX_CONTEXT_BYTES:
        return _SYSTEM_RULES, unavailable
    return _SYSTEM_RULES, user
