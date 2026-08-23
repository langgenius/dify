"""Pure mapping from a Dify workflow-run result into the dify_builder domain.

``AppGenerateService.generate(..., streaming=False)`` returns a blocking
response dict; its ``["data"]`` sub-mapping plus the run's per-node
execution rows are all these functions need to build a dify_builder ``Run`` /
``NodeEvent``. No DB, no services, no I/O — node-execution rows are
duck-typed (``node_id``, ``node_type``, ``title``, ``status``, ``error``,
``.outputs_dict``/``.inputs_dict``) rather than importing the real
``WorkflowNodeExecutionModel``, so tests can pass lightweight stand-ins
(e.g. ``SimpleNamespace``).

Status mapping is intentionally conservative: only a clean ``SUCCEEDED``
finish counts as a dify_builder-domain "succeeded" run. ``FAILED``,
``PARTIAL_SUCCEEDED``, ``STOPPED``, and ``PAUSED`` all map to "failed", as
does the distinct *paused-shape* response (human-input node — carries
``paused_nodes``/``reasons`` instead of a clean ``status``/``outputs``/
``error`` shape). A verify run that didn't cleanly succeed should never
read as green to the user, even if it's technically "still running"
(paused) or "mostly fine" (partial success) rather than an outright error.
"""

from collections.abc import Mapping, Sequence
from typing import Any

from core.dify_builder.models import NodeEvent, NodeOutput, Run

_FAILED_NODE_STATUSES = {"failed", "exception"}


def _status_value(status: Any) -> Any:
    """Unwrap a ``StrEnum``'s ``.value`` if present, else pass through as-is.

    Accepts either a real ``graphon`` enum member or a plain string (or
    ``None``), so callers don't need to import ``graphon`` to use this
    module.
    """
    return getattr(status, "value", status)


def _is_paused_shape(data: Mapping[str, Any]) -> bool:
    """A paused (human-input node) response carries these keys instead of
    a normal ``status``/``outputs``/``error`` shape."""
    return "paused_nodes" in data or "reasons" in data


def map_run_result(data: Mapping[str, Any], node_execs: Sequence[Any]) -> Run:
    """Map a blocking ``AppGenerateService.generate`` result into a ``Run``.

    ``Run.id`` is deliberately left ``""`` — the caller (``handle_verify``)
    assigns the id and sets ``DifyBuilderContext.verify_run_id``, not this function.
    """
    if _is_paused_shape(data):
        status = "failed"
    else:
        status = "succeeded" if _status_value(data.get("status")) == "succeeded" else "failed"

    per_node = [
        NodeOutput(
            node_id=node.node_id,
            title=node.title,
            status=_status_value(node.status),
            error=node.error or "",
            outputs=node.outputs_dict,
        )
        for node in node_execs
    ]

    culprit_node_id = next((n.node_id for n in per_node if n.status in _FAILED_NODE_STATUSES), "")

    return Run(
        kind="verify",
        immutable=True,
        dify_run_id=data["id"],
        status=status,
        per_node=per_node,
        culprit_node_id=culprit_node_id,
        tokens=data.get("total_tokens", 0),
        elapsed_ms=int(data.get("elapsed_time", 0) * 1000),
    )


def to_node_event(node_exec: Any) -> NodeEvent:
    """Map one node-execution row into a per-node progress ``NodeEvent``."""
    return NodeEvent(
        node_id=node_exec.node_id,
        title=node_exec.title,
        status=_status_value(node_exec.status),
        error=node_exec.error or "",
    )
