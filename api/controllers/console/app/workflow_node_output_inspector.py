"""Console REST endpoints for the Node Output Inspector (Stage 4 §8 / §10.3).

PRD §Node Output Inspector replaces the consumer-organized Variable Inspector
with a producer-organized view of each node's declared outputs and their
per-run status. This module exposes three read-only endpoints; the SSE stream
described in design §8.5 is deferred to a follow-up PR so the snapshot APIs
unblock the frontend earlier.

All three endpoints are scoped to *draft* workflow runs (decision D-1) — the
service layer 404s anything else.

URLs follow the design doc and reuse the existing
``/apps/<uuid:app_id>/workflows/draft/...`` prefix from
:mod:`controllers.console.app.workflow_draft_variable`.
"""

from __future__ import annotations

from uuid import UUID

from flask_restx import Resource

from controllers.console import console_ns
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import account_initialization_required, setup_required
from controllers.web.error import NotFoundError
from libs.login import login_required
from models import App, AppMode
from services.workflow.node_output_inspector_service import (
    NodeOutputInspectorError,
    NodeOutputInspectorService,
)


def _service() -> NodeOutputInspectorService:
    """One-line factory so tests can monkeypatch a stub if needed."""
    return NodeOutputInspectorService()


def _to_not_found(error: NodeOutputInspectorError) -> NotFoundError:
    """All service-side conditions surface as 404 with a stable error code."""
    return NotFoundError(error.code)


@console_ns.route("/apps/<uuid:app_id>/workflows/draft/runs/<uuid:run_id>/node-outputs")
class WorkflowDraftRunNodeOutputsApi(Resource):
    """Whole-run snapshot organized by producer node."""

    @console_ns.doc("get_workflow_draft_run_node_outputs")
    @console_ns.doc(description="Snapshot of every node's declared outputs for a draft workflow run.")
    @console_ns.doc(params={"app_id": "Application ID", "run_id": "Workflow run ID"})
    @console_ns.response(404, "Workflow run not found or not a draft run")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    def get(self, app_model: App, run_id: UUID):
        try:
            snapshot = _service().snapshot_workflow_run(
                app_model=app_model,
                workflow_run_id=str(run_id),
            )
        except NodeOutputInspectorError as error:
            raise _to_not_found(error)
        return snapshot.model_dump(mode="json")


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
    @console_ns.response(404, "Workflow run / node not found")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    def get(self, app_model: App, run_id: UUID, node_id: str):
        try:
            view = _service().node_detail(
                app_model=app_model,
                workflow_run_id=str(run_id),
                node_id=node_id,
            )
        except NodeOutputInspectorError as error:
            raise _to_not_found(error)
        return view.model_dump(mode="json")


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
    @console_ns.response(404, "Workflow run / node / output not found")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    def get(self, app_model: App, run_id: UUID, node_id: str, output_name: str):
        try:
            preview = _service().output_preview(
                app_model=app_model,
                workflow_run_id=str(run_id),
                node_id=node_id,
                output_name=output_name,
            )
        except NodeOutputInspectorError as error:
            raise _to_not_found(error)
        return preview.model_dump(mode="json")
