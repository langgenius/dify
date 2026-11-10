"""Pure mapping from a Dify workflow-run result into the dify_builder domain.

``AppGenerateService.generate(..., streaming=True)`` yields a stream of
*SSE-formatted strings*; ``stream_chunk_as_mapping`` turns one back into the
event mapping it carries, and that mapping plus the run's per-node execution
rows are all these functions need to build a dify_builder ``Run`` /
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

import json
from collections.abc import Mapping, Sequence
from dataclasses import replace
from enum import Enum
from typing import Any

from core.dify_builder.models import NodeEvent, NodeOutput, Run, RunVerification
from models.workflow import WorkflowRun

_FAILED_NODE_STATUSES = {"failed", "exception"}

# Workflow-run statuses that mean "not over yet" (``WorkflowExecutionStatus``);
# "" covers a row we could not read at all.
_UNFINISHED_RUN_STATUSES = {"", "scheduled", "running"}

# What a truncated stream reports instead of a fabricated failure. Kept in the
# domain ``Run.error`` so the reason reaches the user rather than a bare status.
TRUNCATED_STREAM_ERROR = "the workflow run's progress stream ended before the run did, so its outcome is unknown"

# ``BaseAppGenerator.convert_to_event_stream`` (the tail of every streaming
# ``AppGenerateService.generate``) emits ``f"data: {json}\n\n"`` for an event
# mapping and ``f"event: {msg}\n\n"`` for a bare keep-alive such as ``"ping"``.
_STREAM_DATA_PREFIX = "data: "

# ``node_started`` carries no status yet, so it reports ``running``; the empty
# string means "take the status off the chunk itself" (``node_finished``).
_NODE_STREAM_EVENTS = {"node_started": "running", "node_finished": ""}

# The two events that end a stream (``streaming_utils._normalize_terminal_events``).
_TERMINAL_STREAM_EVENTS = {"workflow_finished", "workflow_paused"}

# Events whose ``data["id"]`` is the RUN id. On a node frame ``data["id"]`` is
# the node-execution id instead, so it must never be read as a run id.
_RUN_ID_DATA_EVENTS = {"workflow_started", "workflow_finished", "workflow_paused"}

# The frame ``ErrorStreamResponse`` becomes on the wire (see
# ``WorkflowAppGenerateResponseConverter.convert_stream_full_response``):
# top-level ``message`` / ``code`` / ``status`` and NO ``data``. It ends the
# stream but carries no run status, so it is not a terminal frame. ``run_draft``
# keeps it aside and consults it only when no terminal frame arrived --
# precedence is terminal frame > error frame > nothing (unknown). Chatflow
# emits ``workflow_finished(failed)`` AND an error frame for one failure, so
# the terminal frame must win when both are present.
_ERROR_STREAM_EVENT = "error"


def error_from_stream_chunk(chunk: Mapping[str, Any]) -> dict[str, str] | None:
    """The ``message`` / ``code`` an ``event: error`` frame carries, else ``None``."""
    if str(chunk.get("event") or "") != _ERROR_STREAM_EVENT:
        return None
    return {"message": str(chunk.get("message") or ""), "code": str(chunk.get("code") or "")}


def map_error_frame_run(error: Mapping[str, str], run_id: str, node_execs: Sequence[Any]) -> Run:
    """A run whose stream ended on an explicit ``error`` frame: FAILED, with the
    frame's message (and code) as ``Run.error``.

    ``per_node`` is whatever rows exist for ``run_id``: empty for a launch
    failure (the ESQ1-302 frame arrives before ``workflow_started``, so there is
    no run id and no row) and populated for a mid-run error. Whitespace is
    collapsed so the text is a stable repair-breaker signature
    (``handlers_build._failure_signature``).
    """
    message = " ".join((error.get("message") or "").split())
    code = (error.get("code") or "").strip()
    if not message:
        message = f"workflow run failed ({code})" if code else "workflow run failed"
    elif code and code not in message:
        message = f"{message} [{code}]"
    return map_run_result({"id": run_id, "status": "failed", "error": message}, node_execs)


def _status_value(status: Any) -> Any:
    """Unwrap a ``StrEnum``'s ``.value`` if present, else pass through as-is.

    Accepts either a real ``graphon`` enum member or a plain string (or
    ``None``), so callers don't need to import ``graphon`` to use this
    module.
    """
    return status.value if isinstance(status, Enum) else status


def _is_paused_shape(data: Mapping[str, Any]) -> bool:
    """A paused (human-input node) response carries these keys instead of
    a normal ``status``/``outputs``/``error`` shape."""
    return "paused_nodes" in data or "reasons" in data


def stream_chunk_as_mapping(chunk: Any) -> Mapping[str, Any] | None:
    """One ``AppGenerateService.generate(streaming=True)`` item as its event
    mapping, or ``None`` when it carries no event.

    The streaming stack hands back SSE-formatted strings, not dicts: the
    workflow app generator's ``convert_stream_full_response`` builds the event
    dicts, but ``convert_to_event_stream`` then wraps each one as
    ``"data: {json}\\n\\n"`` and every keep-alive as ``"event: ping\\n\\n"``.
    Plain mappings are still accepted so callers stay correct if that last
    wrapping layer is ever removed.
    """
    if isinstance(chunk, Mapping):
        return chunk
    if not isinstance(chunk, str):
        return None
    text = chunk.strip()
    if not text.startswith(_STREAM_DATA_PREFIX):
        return None  # "ping" / "event: ping\n\n" keep-alives
    try:
        payload = json.loads(text[len(_STREAM_DATA_PREFIX) :])
    except ValueError:
        return None
    return payload if isinstance(payload, Mapping) else None


def node_event_from_stream_chunk(chunk: Mapping[str, Any]) -> NodeEvent | None:
    """One streaming chunk as a ``NodeEvent``, or ``None`` when it is not
    about a node (ping frames, workflow-level frames, ...)."""
    event = str(chunk.get("event") or "")
    if event not in _NODE_STREAM_EVENTS:
        return None
    data = chunk.get("data") or {}
    status = _NODE_STREAM_EVENTS[event] or _status_value(data.get("status"))
    return NodeEvent(
        node_id=str(data.get("node_id") or ""),
        title=str(data.get("title") or ""),
        status=str(status or ""),
        error=str(data.get("error") or ""),
        run_id=run_id_from_stream_chunk(chunk),
    )


def run_id_from_stream_chunk(chunk: Mapping[str, Any]) -> str:
    """The workflow run id a chunk carries, or ``""``.

    ``convert_stream_full_response`` stamps ``workflow_run_id`` on *every*
    non-ping frame, so the run id is known from the first frame onwards --
    long before the terminal frame that may never arrive. That is what lets a
    truncated stream still ask the database how the run actually went.
    """
    direct = chunk.get("workflow_run_id")
    if direct:
        return str(direct)
    data = chunk.get("data")
    if not isinstance(data, Mapping):
        return ""
    if data.get("workflow_run_id"):
        return str(data["workflow_run_id"])
    if str(chunk.get("event") or "") in _RUN_ID_DATA_EVENTS:
        return str(data.get("id") or "")
    return ""


def run_result_data_from_run_row(run_row: WorkflowRun) -> dict[str, Any]:
    """A ``WorkflowRun`` row shaped the way ``map_run_result`` expects it.

    The stream is the fast path, not the authority: when it ends without a
    terminal frame the row is what actually says how the run went. Read only declared native WorkflowRun fields.
    """
    return {
        "id": str(run_row.id or ""),
        "status": _status_value(run_row.status) or "",
        "outputs": run_row.outputs_dict if run_row.outputs is not None else None,
        "error": run_row.error or "",
        "elapsed_time": run_row.elapsed_time or 0,
        "total_tokens": run_row.total_tokens or 0,
    }


def is_unfinished_run_status(status: Any) -> bool:
    """True while a workflow run has not reached any final state."""
    return str(_status_value(status) or "") in _UNFINISHED_RUN_STATUSES


def map_unknown_run_outcome(data: Mapping[str, Any], node_execs: Sequence[Any]) -> Run:
    """A run whose outcome nothing could establish -- NOT a failed run.

    ``map_run_result`` is deliberately conservative: anything that is not a
    clean ``succeeded`` reads as ``failed``. That is right for a run we watched
    end, and wrong for one we merely lost sight of -- a fabricated ``failed``
    sends a build that may well have succeeded straight into the repair loop.
    ``Run.status`` documents ``running`` alongside ``succeeded``/``failed``
    exactly for this "not over / not known" case, and ``Run.error`` carries the
    reason so it is visible instead of silent.
    """
    return replace(map_run_result(data, node_execs), status="running", error=TRUNCATED_STREAM_ERROR)


def run_result_data_from_terminal_chunk(chunk: Mapping[str, Any]) -> dict[str, Any] | None:
    """The ``data`` a terminal streaming chunk carries, shaped the way
    ``map_run_result`` expects it, or ``None`` for a non-terminal chunk.

    ``map_run_result`` was written against the *blocking* response, whose
    ``data`` always carries ``id`` (``WorkflowAppBlockingResponse.Data`` and
    ``WorkflowAppPausedBlockingResponse.Data`` both declare it). The streaming
    ``workflow_finished`` frame matches that shape, but the streaming
    ``workflow_paused`` frame (``WorkflowPauseStreamResponse.Data``) carries
    ``workflow_run_id`` instead of ``id``. Rather than loosen
    ``map_run_result`` — the fix/edit flows share it — the run id is backfilled
    here, at the call site's edge.
    """
    if str(chunk.get("event") or "") not in _TERMINAL_STREAM_EVENTS:
        return None
    data = dict(chunk.get("data") or {})
    if not data.get("id"):
        data["id"] = str(data.get("workflow_run_id") or chunk.get("workflow_run_id") or "")
    return data


def map_run_result(data: Mapping[str, Any], node_execs: Sequence[Any]) -> Run:
    """Map a ``AppGenerateService.generate`` run result into a ``Run``.

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
            inputs=dict(node.inputs_dict) if isinstance(node.inputs_dict, Mapping) else {},
            outputs=dict(node.outputs_dict) if isinstance(node.outputs_dict, Mapping) else {},
            outputs_available=isinstance(node.outputs_dict, Mapping) and not node.outputs_truncated,
        )
        for node in node_execs
    ]

    culprit_node_id = next((n.node_id for n in per_node if n.status in _FAILED_NODE_STATUSES), "")

    return Run(
        kind="verify",
        verification=RunVerification(
            execution_revision="",
            executed_graph_revision="",
            terminal_outputs=dict(data["outputs"]) if isinstance(data.get("outputs"), Mapping) else None,
            output_findings=[],
            executed_node_ids=list(dict.fromkeys(n.node_id for n in per_node)),
            no_output_dead_branch=False,
        ),
        immutable=True,
        dify_run_id=data["id"],
        status=status,
        per_node=per_node,
        culprit_node_id=culprit_node_id,
        # The engine's run-level error text. A succeeded run never carries one;
        # a launch failure has no rows at all, so this is then the only
        # evidence the repair breaker and diagnose have.
        error="" if status == "succeeded" else str(data.get("error") or ""),
        tokens=data.get("total_tokens", 0),
        elapsed_ms=int(data.get("elapsed_time", 0) * 1000),
    )


# Confirmed Builder projections: the native authorized Run keeps message content;
# Builder SSE, cards, per-node rows and terminal outputs carry identities and
# statuses only. Node titles are dropped too: a provider error or body is never
# re-labelled as a title.
_CONFIRMED_FRAME_DATA_KEYS = ("id", "node_id", "node_type", "status")


def sanitize_confirmed_stream_event(payload: Mapping[str, Any]) -> dict[str, Any]:
    """One native stream frame reduced to event, run link, node identity and status."""
    sanitized: dict[str, Any] = {"event": str(payload.get("event") or "")}
    run_id = run_id_from_stream_chunk(payload)
    if run_id:
        sanitized["workflow_run_id"] = run_id
    data = payload.get("data")
    if isinstance(data, Mapping):
        kept = {
            key: str(_status_value(data[key]))
            for key in _CONFIRMED_FRAME_DATA_KEYS
            if isinstance(data.get(key), str) and data.get(key)
        }
        if kept:
            sanitized["data"] = kept
    return sanitized


def sanitize_confirmed_node_event(event: NodeEvent) -> NodeEvent:
    return NodeEvent(node_id=event.node_id, status=event.status, run_id=event.run_id)


def sanitize_confirmed_run(run: Run) -> Run:
    """Keep IDs, statuses and evidence; drop inputs, outputs, titles and error text.

    Output findings were already derived internally from the native rows and
    are kept; terminal outputs are never copied into Builder state.
    """
    verification = replace(run.verification, terminal_outputs=None) if run.verification is not None else None
    return replace(
        run,
        verification=verification,
        error="",
        per_node=[NodeOutput(node_id=node.node_id, status=node.status) for node in run.per_node],
    )


def to_node_event(node_exec: Any) -> NodeEvent:
    """Map one node-execution row into a per-node progress ``NodeEvent``."""
    return NodeEvent(
        node_id=node_exec.node_id,
        title=node_exec.title,
        status=_status_value(node_exec.status),
        error=node_exec.error or "",
    )
