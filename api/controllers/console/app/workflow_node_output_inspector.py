"""Console REST endpoints for the Node Output Inspector (Stage 4 §8 / §10.3).

PRD §Node Output Inspector replaces the consumer-organized Variable Inspector
with a producer-organized view of each node's declared outputs and their
per-run status. This module exposes two parallel sets of three read-only
endpoints — one for ``/workflows/draft/runs/...`` (Composer test runs) and one
for ``/workflows/published/runs/...`` (real App API / webapp / webhook /
schedule / plugin triggers). Both sets share the same service code, the same
response shapes, and the same error codes; the URL is the *only* difference,
so the frontend can pick the right prefix based on which run-detail page the
user is on.

Decision D-1 (published Inspector deferred) was lifted 2026-05-26 — the
``published_run_inspector_not_implemented`` 404 code is therefore no longer
produced.

URLs follow the design doc and reuse the existing
``/apps/<uuid:app_id>/workflows/draft/...`` prefix from
:mod:`controllers.console.app.workflow_draft_variable`. The
``published`` prefix mirrors it shape-for-shape.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Iterator
from uuid import UUID

from flask import Response
from flask_restx import Resource

from controllers.common.fields import EventStreamResponse
from controllers.common.schema import register_response_schema_models
from controllers.console import console_ns
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import (
    RBACPermission,
    RBACResourceScope,
    account_initialization_required,
    rbac_permission_required,
    setup_required,
)
from libs.exception import BaseHTTPException
from libs.login import login_required
from models import App, AppMode
from services.workflow import inspector_events
from services.workflow.node_output_inspector_service import (
    CheckResultView,
    NodeOutputInspectorError,
    NodeOutputInspectorService,
    NodeOutputsView,
    NodeOutputView,
    OutputPreviewView,
    WorkflowRunSnapshotView,
)

logger = logging.getLogger(__name__)


# Heartbeat cadence — every N empty subscribe ticks emit a SSE comment so
# intervening proxies (nginx, ingress) don't reap the idle connection.
# ``inspector_events.subscribe`` ticks at 1s, so 15 → 15s heartbeat.
_HEARTBEAT_EVERY_TICKS = 15
# Hard ceiling on a single stream — if we never see a terminal workflow
# event (engine crashed, redis dropped the message), force-close after this
# many ticks (= seconds).
_STREAM_HARD_TIMEOUT_TICKS = 1800  # 30 min

register_response_schema_models(
    console_ns,
    EventStreamResponse,
    CheckResultView,
    NodeOutputView,
    NodeOutputsView,
    WorkflowRunSnapshotView,
    OutputPreviewView,
)


def _service() -> NodeOutputInspectorService:
    """One-line factory so tests can monkeypatch a stub if needed."""
    return NodeOutputInspectorService()


def _serve_snapshot(app_model: App, run_id: UUID) -> dict:
    """Resource-body shared by draft + published snapshot endpoints.

    Pulled out so the 6 REST routes don't duplicate the same 6-line try/except
    + ``model_dump`` ritual — the routes shrink to one-liners and the actual
    behaviour lives here, where unit tests can hit it without spinning up
    Flask request context.
    """
    try:
        snapshot = _service().snapshot_workflow_run(app_model=app_model, workflow_run_id=str(run_id))
    except NodeOutputInspectorError as error:
        raise _InspectorNotFound(error) from error
    return snapshot.model_dump(mode="json")


def _serve_node_detail(app_model: App, run_id: UUID, node_id: str) -> dict:
    """Resource-body shared by draft + published node-detail endpoints."""
    try:
        view = _service().node_detail(
            app_model=app_model,
            workflow_run_id=str(run_id),
            node_id=node_id,
        )
    except NodeOutputInspectorError as error:
        raise _InspectorNotFound(error) from error
    return view.model_dump(mode="json")


def _serve_output_preview(app_model: App, run_id: UUID, node_id: str, output_name: str) -> dict:
    """Resource-body shared by draft + published output-preview endpoints."""
    try:
        preview = _service().output_preview(
            app_model=app_model,
            workflow_run_id=str(run_id),
            node_id=node_id,
            output_name=output_name,
        )
    except NodeOutputInspectorError as error:
        raise _InspectorNotFound(error) from error
    return preview.model_dump(mode="json")


class _InspectorNotFound(BaseHTTPException):
    """404 that preserves the inspector's specific error code.

    Without this the response body collapses to a generic ``not_found`` code
    and clients lose the ability to distinguish, e.g.,
    ``workflow_run_not_found`` from ``published_run_inspector_not_implemented``.
    """

    code = 404

    def __init__(self, error: NodeOutputInspectorError) -> None:
        self.error_code = error.code
        super().__init__(description=str(error))


@console_ns.route("/apps/<uuid:app_id>/workflows/draft/runs/<uuid:run_id>/node-outputs")
class WorkflowDraftRunNodeOutputsApi(Resource):
    """Whole-run snapshot organized by producer node."""

    @console_ns.doc("get_workflow_draft_run_node_outputs")
    @console_ns.doc(description="Snapshot of every node's declared outputs for a draft workflow run.")
    @console_ns.doc(params={"app_id": "Application ID", "run_id": "Workflow run ID"})
    @console_ns.response(200, "Workflow run node outputs", console_ns.models[WorkflowRunSnapshotView.__name__])
    @console_ns.response(404, "Workflow run not found")
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_VIEW_LAYOUT)
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    def get(self, app_model: App, run_id: UUID):
        return _serve_snapshot(app_model, run_id)


@console_ns.route("/apps/<uuid:app_id>/workflows/draft/runs/<uuid:run_id>/node-outputs/<string:node_id>")
class WorkflowDraftRunNodeOutputDetailApi(Resource):
    """One node's declared outputs + per-output status."""

    @console_ns.doc("get_workflow_draft_run_node_output_detail")
    @console_ns.doc(description="One node's declared outputs for a draft workflow run.")
    @console_ns.doc(
        params={
            "app_id": "Application ID",
            "run_id": "Workflow run ID",
            "node_id": "Node ID inside the workflow graph",
        }
    )
    @console_ns.response(200, "Workflow run node output detail", console_ns.models[NodeOutputsView.__name__])
    @console_ns.response(404, "Workflow run / node not found")
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_VIEW_LAYOUT)
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    def get(self, app_model: App, run_id: UUID, node_id: str):
        return _serve_node_detail(app_model, run_id, node_id)


@console_ns.route(
    "/apps/<uuid:app_id>/workflows/draft/runs/<uuid:run_id>/node-outputs/<string:node_id>/<string:output_name>/preview"
)
class WorkflowDraftRunNodeOutputPreviewApi(Resource):
    """Full value for one declared output (with signed URL for file refs)."""

    @console_ns.doc("get_workflow_draft_run_node_output_preview")
    @console_ns.doc(description="Full value for one declared output, including signed download URL for files.")
    @console_ns.doc(
        params={
            "app_id": "Application ID",
            "run_id": "Workflow run ID",
            "node_id": "Node ID inside the workflow graph",
            "output_name": "Declared output name as exposed by Composer",
        }
    )
    @console_ns.response(200, "Workflow run node output preview", console_ns.models[OutputPreviewView.__name__])
    @console_ns.response(404, "Workflow run / node / output not found")
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_VIEW_LAYOUT)
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    def get(self, app_model: App, run_id: UUID, node_id: str, output_name: str):
        return _serve_output_preview(app_model, run_id, node_id, output_name)


# ──────────────────────────────────────────────────────────────────────────────
# SSE event stream — shared generator used by draft + published variants
# ──────────────────────────────────────────────────────────────────────────────


def _sse_envelope(event: str, data: dict | str, event_id: int) -> str:
    """Format one SSE record per D-5 ``{event, data, id}`` envelope.

    ``data`` is JSON-serialized when given as a dict; raw strings are
    forwarded unchanged so we can also emit ``:keepalive`` comment lines.
    """
    payload = data if isinstance(data, str) else json.dumps(data, ensure_ascii=False)
    return f"event: {event}\nid: {event_id}\ndata: {payload}\n\n"


def _stream_inspector_events(app_model: App, run_id: UUID) -> Iterator[str]:
    """Yield SSE-framed strings for one workflow run.

    The stream begins with a full ``snapshot`` event so the client has a
    starting state without needing a separate REST GET. Then for every
    ``node_changed`` message from the pub/sub channel we re-read that node
    from DB and push a fresh ``node_changed`` event. When the workflow run
    reaches a terminal state we push one final ``workflow_run_completed``
    event and close the stream.

    Failures inside the loop are caught and surfaced as ``error`` events so
    the frontend can show a banner rather than seeing the connection drop
    silently. The Inspector never raises across the SSE boundary.
    """
    service = _service()
    run_id_str = str(run_id)

    # Initial snapshot — also flushes a 404 back at the client right away
    # if the run is gone (raised before yielding any bytes, so Flask turns it
    # into the normal HTTP 404 path).
    try:
        snapshot = service.snapshot_workflow_run(app_model=app_model, workflow_run_id=run_id_str)
    except NodeOutputInspectorError as error:
        raise _InspectorNotFound(error) from error

    event_id = 0
    yield _sse_envelope("snapshot", snapshot.model_dump(mode="json"), event_id)

    # If the run already finished by the time the client connected, emit
    # the terminal envelope synchronously and close — no point subscribing.
    # The enum value for partial success is the hyphenated ``partial-succeeded``
    # (graphon.enums.WorkflowExecutionStatus), not ``partial_succeeded``.
    if snapshot.workflow_run_status.value in {"succeeded", "failed", "stopped", "partial-succeeded"}:
        event_id += 1
        yield _sse_envelope(
            "workflow_run_completed",
            {"workflow_run_id": run_id_str, "workflow_run_status": snapshot.workflow_run_status.value},
            event_id,
        )
        return

    # Live subscription
    ticks_since_heartbeat = 0
    total_ticks = 0
    for message in inspector_events.subscribe(run_id_str, timeout_seconds=1.0):
        total_ticks += 1
        if total_ticks > _STREAM_HARD_TIMEOUT_TICKS:
            logger.warning(
                "Inspector SSE: forcing close after %ds without terminal event for run %s",
                _STREAM_HARD_TIMEOUT_TICKS,
                run_id_str,
            )
            return

        # Heartbeat sentinel — ``inspector_events.subscribe`` synthesizes a
        # ``node_changed`` message with both fields ``None`` on every redis
        # timeout. Real ``workflow_completed`` messages keep their kind even
        # when status couldn't be resolved (publisher race), so checking kind
        # first makes the heartbeat branch safe.
        if message.kind == "node_changed" and message.node_id is None and message.status is None:
            ticks_since_heartbeat += 1
            if ticks_since_heartbeat >= _HEARTBEAT_EVERY_TICKS:
                yield ":keepalive\n\n"
                ticks_since_heartbeat = 0
            continue
        ticks_since_heartbeat = 0

        if message.kind == "workflow_completed":
            event_id += 1
            yield _sse_envelope(
                "workflow_run_completed",
                {"workflow_run_id": run_id_str, "workflow_run_status": message.status or "unknown"},
                event_id,
            )
            return

        # node_changed: recompute the node slice from DB
        if not message.node_id:
            continue
        try:
            node_view = service.node_detail(
                app_model=app_model,
                workflow_run_id=run_id_str,
                node_id=message.node_id,
            )
        except NodeOutputInspectorError:
            # Node may not appear in the graph yet (race with persistence); skip.
            continue
        except Exception:
            logger.warning(
                "Inspector SSE: node_detail failed for run %s node %s",
                run_id_str,
                message.node_id,
                exc_info=True,
            )
            event_id += 1
            yield _sse_envelope(
                "error",
                {"node_id": message.node_id, "message": "failed to refresh node detail"},
                event_id,
            )
            continue

        event_id += 1
        yield _sse_envelope("node_changed", node_view.model_dump(mode="json"), event_id)


@console_ns.route("/apps/<uuid:app_id>/workflows/draft/runs/<uuid:run_id>/node-outputs/events")
class WorkflowDraftRunNodeOutputEventsApi(Resource):
    """SSE stream of inspector deltas for a draft run."""

    @console_ns.doc("stream_workflow_draft_run_node_output_events")
    @console_ns.doc(description="Server-Sent Events stream of inspector deltas for a draft workflow run.")
    @console_ns.doc(params={"app_id": "Application ID", "run_id": "Workflow run ID"})
    @console_ns.response(
        200,
        "Workflow run node output event stream",
        console_ns.models[EventStreamResponse.__name__],
    )
    @console_ns.response(404, "Workflow run not found")
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_VIEW_LAYOUT)
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    def get(self, app_model: App, run_id: UUID):
        return Response(
            _stream_inspector_events(app_model, run_id),
            mimetype="text/event-stream",
            headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
        )


# ──────────────────────────────────────────────────────────────────────────────
# Published-run endpoints — symmetric to the draft trio above
# ──────────────────────────────────────────────────────────────────────────────


@console_ns.route("/apps/<uuid:app_id>/workflows/published/runs/<uuid:run_id>/node-outputs")
class WorkflowPublishedRunNodeOutputsApi(Resource):
    """Whole-run snapshot for a *published* workflow run.

    Same response shape as the ``/draft/`` variant — frontend can multiplex
    based on which page (Composer test-run vs. Run History) is mounted.
    """

    @console_ns.doc("get_workflow_published_run_node_outputs")
    @console_ns.doc(description="Snapshot of every node's declared outputs for a published workflow run.")
    @console_ns.doc(params={"app_id": "Application ID", "run_id": "Workflow run ID"})
    @console_ns.response(200, "Workflow run node outputs", console_ns.models[WorkflowRunSnapshotView.__name__])
    @console_ns.response(404, "Workflow run not found")
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_VIEW_LAYOUT)
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    def get(self, app_model: App, run_id: UUID):
        return _serve_snapshot(app_model, run_id)


@console_ns.route("/apps/<uuid:app_id>/workflows/published/runs/<uuid:run_id>/node-outputs/<string:node_id>")
class WorkflowPublishedRunNodeOutputDetailApi(Resource):
    """One node's declared outputs + per-output status (published run)."""

    @console_ns.doc("get_workflow_published_run_node_output_detail")
    @console_ns.doc(description="One node's declared outputs for a published workflow run.")
    @console_ns.doc(
        params={
            "app_id": "Application ID",
            "run_id": "Workflow run ID",
            "node_id": "Node ID inside the workflow graph",
        }
    )
    @console_ns.response(200, "Workflow run node output detail", console_ns.models[NodeOutputsView.__name__])
    @console_ns.response(404, "Workflow run / node not found")
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_VIEW_LAYOUT)
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    def get(self, app_model: App, run_id: UUID, node_id: str):
        return _serve_node_detail(app_model, run_id, node_id)


@console_ns.route(
    "/apps/<uuid:app_id>/workflows/published/runs/<uuid:run_id>"
    "/node-outputs/<string:node_id>/<string:output_name>/preview"
)
class WorkflowPublishedRunNodeOutputPreviewApi(Resource):
    """Full value for one declared output of a published run."""

    @console_ns.doc("get_workflow_published_run_node_output_preview")
    @console_ns.doc(description="Full value for one declared output of a published run.")
    @console_ns.doc(
        params={
            "app_id": "Application ID",
            "run_id": "Workflow run ID",
            "node_id": "Node ID inside the workflow graph",
            "output_name": "Declared output name as exposed by Composer",
        }
    )
    @console_ns.response(200, "Workflow run node output preview", console_ns.models[OutputPreviewView.__name__])
    @console_ns.response(404, "Workflow run / node / output not found")
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_VIEW_LAYOUT)
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    def get(self, app_model: App, run_id: UUID, node_id: str, output_name: str):
        return _serve_output_preview(app_model, run_id, node_id, output_name)


@console_ns.route("/apps/<uuid:app_id>/workflows/published/runs/<uuid:run_id>/node-outputs/events")
class WorkflowPublishedRunNodeOutputEventsApi(Resource):
    """SSE stream of inspector deltas for a published run."""

    @console_ns.doc("stream_workflow_published_run_node_output_events")
    @console_ns.doc(description="Server-Sent Events stream of inspector deltas for a published workflow run.")
    @console_ns.doc(params={"app_id": "Application ID", "run_id": "Workflow run ID"})
    @console_ns.response(
        200,
        "Workflow run node output event stream",
        console_ns.models[EventStreamResponse.__name__],
    )
    @console_ns.response(404, "Workflow run not found")
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_VIEW_LAYOUT)
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    def get(self, app_model: App, run_id: UUID):
        return Response(
            _stream_inspector_events(app_model, run_id),
            mimetype="text/event-stream",
            headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
        )
