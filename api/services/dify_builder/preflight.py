"""Dry ``Graph.init`` for a draft graph: the node-data validation the engine
performs before it starts a run, without the run.

Both ESQ1-302 (an http-request body item without ``type``) and ESQ1-303 (an
if-else ``value`` written as a JSON number) died at ``Graph.init`` -- before
``workflow_started``, so the Builder saw an error frame with no run id and no
rows, and spent runs and approvals discovering what a validation pass could
have said up front. ``preflight_errors`` runs that pass over a graph dict.

Pure with respect to the Builder: no session, no DB, no engine state. It
imports ``core.workflow.node_factory`` (the same validation ``create_node``
does), which is why it lives in ``services/dify_builder`` and not in the
I/O-free ``core/dify_builder``.
"""

from collections.abc import Mapping

from core.dify_builder.models import Graph
from core.workflow.node_factory import validate_node_config

# graphon's ``Graph._filter_canvas_only_nodes`` drops persisted note widgets
# (top-level ``type == "custom-note"``, empty ``data.type``) before validating
# node configs. Mirror it, or every draft with a note would fail preflight.
_CANVAS_ONLY_NODE_TYPE = "custom-note"


def preflight_errors(graph: Graph) -> list[str]:
    """Every node of ``graph`` that ``Graph.init`` would reject, one message
    each, in node order. Each message starts with ``node '<id>' (<type>):``
    (see ``core.workflow.node_factory.validate_node_config``). Empty when the
    draft would start.

    A validation step must never crash the Builder: a node whose validation
    raises something OTHER than ``ValueError`` (graphon's
    ``HttpRequestNodeAuthorization.check_config`` raises ``KeyError`` for an
    ``authorization`` with no ``type``, and pydantic does not wrap it) is
    reported as ``node '<id>' (<type>): <ExcName>: <message>`` -- the engine
    would not start that draft either -- and the next node is still checked.
    """
    errors: list[str] = []
    for node in graph.get("nodes") or []:
        if not isinstance(node, Mapping) or node.get("type") == _CANVAS_ONLY_NODE_TYPE:
            continue
        try:
            validate_node_config(node)
        except ValueError as exc:
            errors.append(str(exc))
        except Exception as exc:
            errors.append(f"{_node_label(node)}: {type(exc).__name__}: {exc}")
    return errors


def _node_label(node: Mapping) -> str:
    """``node '<id>' (<type>)``, the prefix ``validate_node_config`` gives its
    own ``ValueError`` messages."""
    data = node.get("data")
    node_type = str(data.get("type") or "") if isinstance(data, Mapping) else ""
    return f"node {str(node.get('id') or '')!r} ({node_type or 'unknown type'})"
