"""Pure, client-side graph mutation helpers.

Dify's ``sync_draft_workflow`` has no server-side patch primitive: it always
replaces the whole draft graph. The adapter (``dify_port.py``) therefore
reads the current graph, applies mutations like ``apply_set_node_config``
locally, and writes the whole mutated graph back. These helpers do the local
mutation only — no DB, no services, no I/O.
"""

import copy
import hashlib
import json
from collections.abc import Callable
from typing import Any, NamedTuple

from core.dify_builder.models import Graph, MutationIntent
from core.dify_builder.node_defaults import default_config_or_empty
from core.workflow.graph_normalizers import declared_branch_handles, heal_nodes_for_preflight
from services.dify_builder import credentials

MUTATION_ARG_KEYS: dict[str, tuple[str, ...]] = {
    "set_node_config": ("node_id", "path", "value"),
    "create_node": ("node_type", "config"),
    "delete_node": ("node_id",),
    "connect": ("from_node", "to_node"),
    "insert_between": ("edge", "node_type", "config"),
}

# ReactFlow containment, matching what the generator computes for a child of
# an iteration/loop container (core/workflow/generator/runner.py:1441-1442).
_CHILD_EXTENT = "parent"
_CHILD_Z_INDEX = 1002

# Args that name a node. An LLM occasionally emits these as ints or empty
# strings; unchecked they reach diff_graphs, which drops falsy/non-str ids
# from its node maps, and then crash build_change_set's join (ESQ1-271).
_NODE_ID_ARGS = ("node_id", "from_node", "to_node")

# `path` reaches _resolve_path's str.split; a non-string raises AttributeError
# there, so the rejection reason the repair agent reads is a Python internals
# message instead of an actionable one.
_STRING_ARGS = ("path",)

# The args that carry a node's data into the draft, and so the args through
# which a redaction placeholder could overwrite a real credential:
# set_node_config's `value`, create_node's and insert_between's `config`.
_REDACTABLE_ARGS = ("value", "config")


def validate_intent_args(intent: MutationIntent) -> None:
    """Raise ``ValueError`` if ``intent.args`` is missing a required key for
    ``intent.op``, or if ``intent.op`` isn't one of ``MUTATION_ARG_KEYS``'s
    five recognized verbs. Optional keys (marked ``?`` on ``MutationIntent``)
    are not checked here -- each ``apply_*`` function defaults them itself.

    Also refuses any ``value`` / ``config`` carrying ``credentials.REDACTED``.
    The agents show a node's config with its secrets replaced by that sentinel;
    a model that then rewrites the surrounding field hands the placeholder
    straight back, and writing it would destroy a live credential. Raising
    here is the whole guard: this function is the one chokepoint both the
    ``filter_applicable`` dry run and ``dify_port.apply_repair``'s write loop
    pass every intent through, so a refused value is rejected with a reason
    the corrective re-prompt can read and the stored credential stands
    untouched. Keyed on the exact generated string, never on model prose.
    """
    required = MUTATION_ARG_KEYS.get(intent.op)
    if required is None:
        raise ValueError(f"unknown mutation op: {intent.op!r}")
    missing = [key for key in required if key not in intent.args]
    if missing:
        raise ValueError(f"missing required arg(s) {missing} for op {intent.op!r}")

    for key in _NODE_ID_ARGS:
        if key not in intent.args:
            continue
        value = intent.args[key]
        if not isinstance(value, str) or not value:
            raise ValueError(f"{key} must be a non-empty string for op {intent.op!r}, got {value!r}")

    for key in _STRING_ARGS:
        if key not in intent.args:
            continue
        value = intent.args[key]
        if not isinstance(value, str) or not value:
            raise ValueError(f"{key} must be a non-empty string for op {intent.op!r}, got {value!r}")

    # KNOWN AND ACCEPTED, deliberately not closed here: this stops the model
    # handing the PLACEHOLDER back, not a rewrite that simply OMITS the
    # Authorization line. That write carries no sentinel, passes, and clobbers
    # the credential. The difference is that its failure is LOUD -- the next
    # verify run fails authentication and lands in the repair loop with a real
    # error -- where the leak this guard closes was silent and unrecoverable.
    # Closing it would need merge semantics for a free-text `headers` blob,
    # which is a larger design change and would break legitimate deletion.
    for key in _REDACTABLE_ARGS:
        if key in intent.args and credentials.carries_redaction(intent.args[key]):
            raise ValueError(
                f"{key} for op {intent.op!r} contains the redaction placeholder "
                f"{credentials.REDACTED!r}: that is not the real secret. Leave the field "
                "unchanged, or set it to a real value."
            )


def _resolve_path(container: dict[str, Any], path: str) -> tuple[Any, str | int]:
    """Walk ``path``'s parent segments and return ``(parent, last_key)``.

    Segments are dot-separated; an all-digit segment indexes a list, any
    other segment is a mapping key. Only the FINAL segment may be absent --
    that is the key being written. Every intermediate segment must already
    resolve, and a segment that cannot be walked raises ``ValueError``.

    Raising is the point. ``filter_applicable`` dry-runs each intent through
    this function and turns the exception into a rejection reason the repair
    agent sees on its next attempt. Before this existed, a dotted path wrote
    one flat junk key that the workflow engine ignored, so every nested
    repair silently did nothing (ESQ1-285, ESQ1-290).
    """
    segments = path.split(".")
    if not path or any(segment == "" for segment in segments):
        raise ValueError(f"empty segment in path: {path!r}")

    cursor: Any = container
    for depth, segment in enumerate(segments[:-1]):
        walked = ".".join(segments[: depth + 1])
        if segment.isdigit():
            if not isinstance(cursor, list):
                raise ValueError(f"path {path!r}: {walked} indexes a {type(cursor).__name__}, not a list")
            index = int(segment)
            if index >= len(cursor):
                raise ValueError(f"path {path!r}: index {index} out of range at {walked} (len {len(cursor)})")
            cursor = cursor[index]
            continue
        if not isinstance(cursor, dict):
            raise ValueError(f"path {path!r}: {walked} is not a mapping")
        if segment not in cursor:
            raise ValueError(f"path {path!r}: no key {segment!r} at {walked}")
        cursor = cursor[segment]

    last = segments[-1]
    if last.isdigit():
        if not isinstance(cursor, list):
            raise ValueError(f"path {path!r}: final segment indexes a {type(cursor).__name__}, not a list")
        index = int(last)
        if index >= len(cursor):
            raise ValueError(f"path {path!r}: index {index} out of range (len {len(cursor)})")
        return cursor, index
    if not isinstance(cursor, dict):
        raise ValueError(f"path {path!r}: final container is a {type(cursor).__name__}, not a mapping")
    return cursor, last


def value_at_path(data: dict[str, Any], path: str) -> tuple[bool, Any]:
    """``(True, value)`` for the value ``path`` addresses inside a node's
    ``data``, or ``(False, None)`` when nothing is there.

    The read half of ``apply_set_node_config``, through the same
    ``_resolve_path`` walk, so a caller comparing what a path held BEFORE a
    write against what it holds after cannot disagree with the write about
    which slot the path names. ``_resolve_path`` returns the parent for a final
    segment that does not exist yet -- that is the key being created -- so the
    read is attempted and its absence reported rather than raised.
    """
    try:
        parent, key = _resolve_path(data, path)
        return True, parent[key]
    except (ValueError, KeyError, IndexError, TypeError):
        return False, None


def apply_set_node_config(graph: Graph, node_id: str, path: str, value: Any) -> tuple[Graph, list[str]]:
    """Set the value at ``path`` inside ``node["data"]`` for the node whose
    ``id == node_id``. ``path`` is dot-separated (``"code"``,
    ``"cases.0.conditions.1.value"``); see ``_resolve_path``.

    The placeholder agent emits intents shaped ``{node_id, path, value}``
    (e.g. ``path="code"`` to rewrite a Code node's ``data["code"]``); this is
    the mutation that consumes them.

    Returns a ``(new_graph, changed_node_ids)`` tuple. ``graph`` is
    deep-copied first and never mutated. Raises ``ValueError`` if no node in
    ``graph["nodes"]`` has a matching ``id``.

    ``value`` is deep-copied too, so the new graph shares no structure with the
    caller's argument. It is normally ``intent.args["value"]``, and the graph it
    lands in is then healed in place (``heal_nodes_for_preflight`` rewrites
    ``">="`` to ``"≥"`` and ``60`` to ``"60"``): without the copy the caller's
    own intent would change under it, so a dry run would silently rewrite the
    very intents it was asked to judge.
    """
    new_graph = copy.deepcopy(graph)

    for node in new_graph.get("nodes", []):
        if node.get("id") == node_id:
            parent, key = _resolve_path(node.setdefault("data", {}), path)
            parent[key] = copy.deepcopy(value)
            return new_graph, [node_id]

    raise ValueError(f"node not found: {node_id}")


def _next_unique_id(base: str, existing_ids: set) -> str:
    """Return ``base`` if unused, else ``base_2``, ``base_3``, ... on
    collision with ``existing_ids``. Shared bump sequence for node ids
    (``_next_node_id``) and edge ids (``_make_edge``)."""
    candidate = base
    suffix = 1
    while candidate in existing_ids:
        suffix += 1
        candidate = f"{base}_{suffix}"
    return candidate


def _next_node_id(prefix: str, existing_ids: set) -> str:
    """Return a short, human-readable node id not present in ``existing_ids``.

    Mirrors ``core.workflow.generator.runner._next_generated_node_id``'s
    prefix, then prefix_2, prefix_3, ... collision scheme -- reimplemented
    locally so this module stays free of any dependency on the generator
    subsystem.
    """
    return _next_unique_id(prefix, existing_ids)


def _default_position(graph: Graph) -> dict[str, float]:
    """Place a new node to the right of the rightmost existing node.

    Slice 1 uses simple deterministic rightward placement, not the
    generator's topology-aware layout (``_layout_top_level_nodes``) --
    good enough for one node at a time; a smarter layout is Slice 2/3's
    concern if the canvas ever needs it.
    """
    nodes = graph.get("nodes", [])
    if not nodes:
        return {"x": 100.0, "y": 100.0}
    max_x = max(float(n.get("position", {}).get("x", 0.0)) for n in nodes)
    return {"x": max_x + 260.0, "y": 100.0}


def _build_node(
    graph: Graph,
    node_type: str,
    config: dict[str, Any],
    position: dict[str, float] | None,
    node_id: str | None,
    parent_id: str | None = None,
    flow_type: str | None = None,
) -> dict[str, Any]:
    """Construct one ``GraphNodeDict``-shaped node, generating an id/position
    when omitted (mirrors the generator's ``_fill_node_defaults``,
    ``core/workflow/generator/runner.py:2387-2394``). Raises ``ValueError``
    if a caller-supplied ``node_id`` already exists in ``graph["nodes"]``.

    ``flow_type`` is the node-level ReactFlow type. Almost every node is the
    generic ``"custom"`` (the default), but iteration/loop start markers carry
    ``"custom-iteration-start"`` / ``"custom-loop-start"`` and the canvas has
    no component for them under ``"custom"`` (React error #130, ESQ1-288).

    ``node_type``'s registered defaults (``core.dify_builder.node_defaults``)
    are merged UNDER ``config``: a key the caller supplied always wins, and a
    key it omitted is filled with the value Dify's own editor would have
    created the node with. Several node types have engine-required fields with
    no default -- a ``template-transform`` without ``variables`` makes the draft
    preflight refuse the whole repair batch -- and an LLM writes only the fields
    it was thinking about. This is the one chokepoint every created node passes
    through, so it covers Build, Edit and Fix, ``create_node`` and
    ``insert_between``, and the ``filter_applicable`` dry run alike.
    """
    existing_ids = {n.get("id") for n in graph.get("nodes", [])}
    if node_id is not None:
        if node_id in existing_ids:
            raise ValueError(f"node id already exists: {node_id}")
        new_id = node_id
    else:
        new_id = _next_node_id(node_type, existing_ids)

    data = {**default_config_or_empty(node_type), **copy.deepcopy(config)}
    data["type"] = node_type  # data.type is the real node type -- never overridden by config
    data.setdefault("title", new_id)
    data.setdefault("desc", "")
    data.setdefault("selected", False)

    node: dict[str, Any] = {
        "id": new_id,
        "type": flow_type or "custom",
        "position": position if position is not None else _default_position(graph),
        "data": data,
    }
    if parent_id:
        # Containment lives at node level, NOT inside data. Without these the
        # child renders outside its container and the container does not run
        # it -- the data-level isInIteration/iteration_id markers are not
        # enough on their own.
        node["parentId"] = parent_id
        node["extent"] = _CHILD_EXTENT
        node["zIndex"] = _CHILD_Z_INDEX
    return node


def apply_create_node(
    graph: Graph,
    node_type: str,
    config: dict[str, Any],
    position: dict[str, float] | None = None,
    node_id: str | None = None,
    parent_id: str | None = None,
    flow_type: str | None = None,
) -> tuple[Graph, list[str]]:
    """Append a new ``GraphNodeDict``-shaped node to the graph.

    ``node_id`` is optional (not part of spec Sec 9's terse args list) --
    when omitted a short id is generated from ``node_type``; when supplied,
    a collision with an existing node id raises ``ValueError`` (the Slice 1
    duplicate-id validation). ``parent_id``, when truthy, nests the new node
    inside an existing iteration/loop container and adds the matching
    ``extent``/``zIndex`` wrapper keys. ``flow_type``, when truthy, overrides
    the node-level ReactFlow type (defaults to ``"custom"``); container start
    markers need their own. Returns ``(new_graph, [new_node_id])``.
    """
    new_graph = copy.deepcopy(graph)
    node = _build_node(new_graph, node_type, config, position, node_id, parent_id, flow_type)
    new_graph.setdefault("nodes", []).append(node)
    return new_graph, [node["id"]]


def apply_delete_node(graph: Graph, node_id: str) -> tuple[Graph, list[str]]:
    """Remove the node with ``id == node_id`` and every edge touching it.

    Raises ``ValueError`` if no node in ``graph["nodes"]`` has a matching
    ``id`` (mirrors ``apply_set_node_config``'s not-found behavior).
    Returns ``(new_graph, [node_id])``.
    """
    new_graph = copy.deepcopy(graph)
    nodes = new_graph.get("nodes", [])
    if not any(n.get("id") == node_id for n in nodes):
        raise ValueError(f"node not found: {node_id}")

    new_graph["nodes"] = [n for n in nodes if n.get("id") != node_id]
    new_graph["edges"] = [
        e for e in new_graph.get("edges", []) if e.get("source") != node_id and e.get("target") != node_id
    ]
    return new_graph, [node_id]


def _make_edge(
    source: str, target: str, source_handle: str | None, target_handle: str | None, existing_edge_ids: set
) -> dict:
    """Build one ``GraphEdgeDict``-shaped edge dict with a fresh
    collision-free id (``source-target``, then ``source-target_2``, ... on
    collision with ``existing_edge_ids``). Handles default to
    "source"/"target" (mirrors the generator's ``_fill_edge_defaults``)."""
    return {
        "id": _next_unique_id(f"{source}-{target}", existing_edge_ids),
        "source": source,
        "target": target,
        "type": "custom",
        "sourceHandle": source_handle or "source",
        "targetHandle": target_handle or "target",
    }


def apply_connect(
    graph: Graph,
    from_node: str,
    to_node: str,
    source_handle: str | None = None,
    target_handle: str | None = None,
) -> tuple[Graph, list[str]]:
    """Add a ``GraphEdgeDict``-shaped edge between two existing nodes.

    Raises ``ValueError`` if either ``from_node`` or ``to_node`` is not a
    node id present in ``graph["nodes"]`` (the Slice 1 dangling-ref
    validation), or if ``from_node`` is a branch node (if-else /
    question-classifier / human-input / fail-branch) and ``source_handle``
    (or the default "source") is not one of its declared handles. Handles
    default to "source"/"target" (mirrors the generator's
    ``_fill_edge_defaults``). Returns ``(new_graph, [from_node, to_node])``.
    """
    new_graph = copy.deepcopy(graph)
    nodes_by_id = {n.get("id"): n for n in new_graph.get("nodes", [])}
    if from_node not in nodes_by_id:
        raise ValueError(f"node not found: {from_node}")
    if to_node not in nodes_by_id:
        raise ValueError(f"node not found: {to_node}")

    # A branch node (if-else / question-classifier / human-input / fail-branch)
    # only routes along the handles it declares. An edge on any other handle
    # -- including the default "source" -- hangs off nothing: its arm never
    # runs and the run still reports "succeeded" (ESQ1-303). Reject it here
    # like a dangling node ref; the caller's ``except ValueError`` shows it.
    declared = declared_branch_handles(nodes_by_id[from_node])
    handle = source_handle or "source"
    if declared and handle not in declared:
        raise ValueError(f"branch node {from_node!r} has no handle {handle!r}; it declares {declared}")

    existing_edge_ids = {e.get("id") for e in new_graph.get("edges", [])}
    edge = _make_edge(from_node, to_node, source_handle, target_handle, existing_edge_ids)
    new_graph.setdefault("edges", []).append(edge)
    return new_graph, [from_node, to_node]


def apply_insert_between(
    graph: Graph,
    edge: dict[str, str],
    node_type: str,
    config: dict[str, Any],
    position: dict[str, float] | None = None,
    node_id: str | None = None,
) -> tuple[Graph, list[str]]:
    """Split an existing edge with a new node: remove the old edge, add
    ``old_source -> new_node`` and ``new_node -> old_target``.

    ``edge`` identifies the edge to split by ``{"source": ..., "target": ...}``
    (matching Dify's own edge fields, not a caller-known internal edge id).
    Raises ``ValueError`` if no edge in ``graph["edges"]`` matches (the
    Slice 1 dangling-ref validation). Returns ``(new_graph, [new_node_id])``.
    """
    old_source = edge.get("source")
    old_target = edge.get("target")
    new_graph = copy.deepcopy(graph)
    edges = new_graph.get("edges", [])
    matched = next((e for e in edges if e.get("source") == old_source and e.get("target") == old_target), None)
    if matched is None:
        raise ValueError(f"edge not found: {old_source} -> {old_target}")

    node = _build_node(new_graph, node_type, config, position, node_id)
    new_id = node["id"]
    new_graph.setdefault("nodes", []).append(node)

    remaining_edges = [e for e in edges if e is not matched]
    existing_edge_ids = {e.get("id") for e in remaining_edges}
    incoming = _make_edge(old_source, new_id, matched.get("sourceHandle"), "target", existing_edge_ids)
    existing_edge_ids.add(incoming["id"])
    outgoing = _make_edge(new_id, old_target, "source", matched.get("targetHandle"), existing_edge_ids)
    new_graph["edges"] = [*remaining_edges, incoming, outgoing]
    return new_graph, [new_id]


def diff_graphs(before: Graph, after: Graph) -> tuple[list[str], str]:
    """Compare two graphs and return ``(changes, scope)``.

    ``scope`` is ``"structure"`` if any node or edge was added or removed,
    else ``"configuration"`` if any surviving node's ``data`` changed, else
    ``"configuration"`` with an empty ``changes`` list if nothing differs.
    ``changes`` is human-readable lines (e.g. ``"added node knowledge-1"``,
    ``"added knowledge-1 → llm-1"``, ``"llm-1: prompt_template updated"``)
    -- not bare ids.
    """
    before_nodes = {n.get("id"): n for n in before.get("nodes", []) if n.get("id")}
    after_nodes = {n.get("id"): n for n in after.get("nodes", []) if n.get("id")}

    def _edge_key(e: dict[str, Any]) -> tuple[str, str, str, str]:
        return (
            str(e.get("source")),
            str(e.get("target")),
            str(e.get("sourceHandle") or "source"),
            str(e.get("targetHandle") or "target"),
        )

    before_edges = {_edge_key(e) for e in before.get("edges", [])}
    after_edges = {_edge_key(e) for e in after.get("edges", [])}

    added_nodes = sorted(after_nodes.keys() - before_nodes.keys())
    removed_nodes = sorted(before_nodes.keys() - after_nodes.keys())
    added_edges = sorted(after_edges - before_edges)
    removed_edges = sorted(before_edges - after_edges)

    changes: list[str] = []
    changes.extend(f"added node {node_id}" for node_id in added_nodes)
    changes.extend(f"removed node {node_id}" for node_id in removed_nodes)
    changes.extend(f"added {source} → {target}" for source, target, _sh, _th in added_edges)
    changes.extend(f"removed {source} → {target}" for source, target, _sh, _th in removed_edges)

    for node_id in sorted(before_nodes.keys() & after_nodes.keys()):
        before_data = before_nodes[node_id].get("data", {})
        after_data = after_nodes[node_id].get("data", {})
        changed_keys = sorted(
            key for key in set(before_data) | set(after_data) if before_data.get(key) != after_data.get(key)
        )
        changes.extend(f"{node_id}: {key} updated" for key in changed_keys)

    structural = bool(added_nodes or removed_nodes or added_edges or removed_edges)
    return changes, "structure" if structural else "configuration"


def structural_fingerprint(graph: Graph) -> str:
    """Stable hash of a graph's STRUCTURE only -- node identity+type and edge
    topology -- EXCLUDING node ``data`` config. Two graphs with the same
    nodes/edges but different node configs share a fingerprint; adding,
    removing, or reconnecting a node changes it. Used by recovery (C-1) to
    tell a config-only hand-edit from a structural one. Order-independent
    (nodes and edges are sorted before hashing)."""
    nodes = sorted((str(n.get("id", "")), str((n.get("data") or {}).get("type", ""))) for n in graph.get("nodes", []))
    edges = sorted(
        (
            str(e.get("source", "")),
            str(e.get("target", "")),
            str(e.get("sourceHandle", "")),
            str(e.get("targetHandle", "")),
        )
        for e in graph.get("edges", [])
    )
    canonical = json.dumps({"nodes": nodes, "edges": edges}, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def node_ids(graph: Graph) -> list[str]:
    """The ids of every node in ``graph``, in document order (missing-id
    nodes skipped). Used by recovery's target-presence check."""
    return [str(n["id"]) for n in graph.get("nodes", []) if n.get("id") is not None]


STRUCTURAL_OPS: frozenset[str] = frozenset({"create_node", "delete_node", "connect", "insert_between"})

APPLY_FNS: dict[str, Any] = {
    "set_node_config": apply_set_node_config,
    "create_node": apply_create_node,
    "delete_node": apply_delete_node,
    "connect": apply_connect,
    "insert_between": apply_insert_between,
}


def already_present_predicate(graph: Graph, intents: list[MutationIntent]) -> Callable[[MutationIntent], bool]:
    """The idempotent-re-entry rule: ``True`` for an intent ``graph`` already
    satisfies.

    An interrupted step's Retry re-sends the same batch against an
    already-mutated draft, so a ``create_node`` for an id that is now present and
    a ``connect`` for an edge that is now present are clean no-ops rather than
    errors. ``dify_port.apply_repair`` drops them before its apply loop, and
    ``filter_applicable`` skips them in its dry run for the same reason: without
    this the dry run rejects a duplicate ``create_node`` ("node id already
    exists") that the port would have quietly dropped, and burns the one
    corrective re-prompt on a batch that was going to apply cleanly.

    Ids targeted by a ``delete_node`` in THIS SAME batch do not count as present:
    a from-scratch build sends ``delete_node(placeholder_start)`` +
    ``create_node(same id)`` in one batch, and without the exclusion the create
    would be dropped as already-present while the delete still ran.
    """
    deleted_ids = {i.args.get("node_id") for i in intents if i.op == "delete_node"}
    present_node_ids = {n.get("id") for n in graph.get("nodes") or []} - deleted_ids
    present_edges = {
        (e.get("source"), e.get("target"))
        for e in graph.get("edges") or []
        if e.get("source") not in deleted_ids and e.get("target") not in deleted_ids
    }

    def already_present(intent: MutationIntent) -> bool:
        if intent.op == "create_node":
            return intent.args.get("node_id") in present_node_ids
        if intent.op == "connect":
            return (intent.args.get("from_node"), intent.args.get("to_node")) in present_edges
        return False

    return already_present


class DryRun(NamedTuple):
    """What ``filter_applicable`` learned from dry-running a batch of intents.

    ``applicable`` and ``rejected`` are the pair this function has always
    returned. ``graph`` is the working copy those applicable intents produced --
    the graph ``dify_port.apply_repair`` would be about to write, healed the same
    way. It is returned rather than discarded so ``preflight.vet_intents`` can
    put it through the node-data validation the port's own preflight performs,
    while there is still a corrective re-prompt left to spend on the answer.

    ``changed_nodes`` is the ids those applicable intents wrote NODE DATA to, in
    order, which is what ``preflight.new_preflight_problems`` needs to tell a
    node this batch is answerable for from one it merely left alone. It is
    narrower than a change set in two deliberate ways, and both matter because
    a node in it loses its pre-existing-defect exemption entirely:

    * ``connect`` is EXCLUDED. ``apply_connect`` reports both endpoints as
      changed -- correct for a diff, wrong here: adding an edge cannot change
      either endpoint's ``validate_node_config`` verdict, so counting them would
      let merely WIRING an already-broken node make that node's pre-existing
      defect veto the whole batch. Nothing is given up by leaving it out.
    * the heal is not folded in. ``heal_nodes_for_preflight`` scans EVERY node,
      not only the ones the intents named, so its ids would make an unrelated
      node the healer normalized count as written by this batch. Same pre-heal
      point in the sequence as ``dify_port.apply_repair``'s own copy.
    """

    applicable: list[MutationIntent]
    rejected: list[tuple[MutationIntent, str]]
    graph: Graph
    changed_nodes: list[str]


def filter_applicable(
    graph: Graph,
    intents: list[MutationIntent],
    allowed_node_types: set[str] | None = None,
) -> DryRun:
    """Dry-run each intent through the real validate_intent_args + apply_* on a
    working deep copy, in order (so a connect sees a node an earlier create_node
    added). Returns a ``DryRun``: ``(applicable, rejected, graph, changed_nodes)``,
    where each rejected entry is ``(intent, reason)``, ``graph`` is the mutated
    working copy and ``changed_nodes`` is the ids whose node DATA those intents
    wrote (see ``DryRun``).

    Catches every failure the live apply_repair would hit -- unknown op, missing
    required arg / extra arg key, dangling node/edge ref, duplicate id -- and
    additionally rejects a create_node / insert_between whose node_type is not in
    allowed_node_types (a check apply_* does not do). Applicable intents advance
    the working copy; a rejected intent does not.

    An intent the graph already satisfies is neither applied nor rejected, and
    stays in ``applicable`` for the port to drop the same way
    (``already_present_predicate``, which the port runs before its own apply
    loop). The working copy already reflects it -- that is what "already
    present" means -- so the graph returned here is still what the port would
    write.

    The working copy then goes through the shared deterministic heal set
    (``core.workflow.graph_normalizers.heal_nodes_for_preflight``), exactly as
    ``dify_port.apply_repair`` runs it over the real draft after its own apply
    loop. Same normalizers, same place in the sequence, one definition: a dry run
    that healed less than the write chokepoint would report a defect the write
    was going to fix, and one that healed more would pass a batch the write would
    refuse. Both make the answer this function gives about the port a guess.
    """
    working = copy.deepcopy(graph)
    is_already_present = already_present_predicate(graph, intents)
    applicable: list[MutationIntent] = []
    rejected: list[tuple[MutationIntent, str]] = []
    changed_nodes: list[str] = []
    for intent in intents:
        # Before validate_intent_args, exactly where the port drops it.
        if is_already_present(intent):
            applicable.append(intent)
            continue
        try:
            validate_intent_args(intent)
            if allowed_node_types is not None and intent.op in ("create_node", "insert_between"):
                node_type = intent.args.get("node_type")
                if node_type not in allowed_node_types:
                    rejected.append((intent, f"node_type not allowed: {node_type!r}"))
                    continue
            working, changed = APPLY_FNS[intent.op](working, **intent.args)
        except Exception as exc:
            rejected.append((intent, str(exc)))
            continue
        # A connect writes an EDGE; its endpoints' node data is untouched (see
        # ``DryRun.changed_nodes``). Mirrored in ``dify_port.apply_repair``.
        if intent.op != "connect":
            changed_nodes.extend(changed)
        applicable.append(intent)
    heal_nodes_for_preflight(working.get("nodes") or [])
    return DryRun(applicable, rejected, working, changed_nodes)
