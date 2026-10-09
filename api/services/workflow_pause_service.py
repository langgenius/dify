"""Resolve paused-run presentation from the persisted graph checkpoint."""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from sqlalchemy.orm import Session, sessionmaker

from core.app.layers.pause_state_persist_layer import WorkflowResumptionContext
from core.workflow.nodes.human_input.pause_reason import HumanInputRequired, PauseReason
from core.workflow.nodes.human_input.session_binding import default_session_binding
from core.workflow.nodes.human_input_v2.presentation import build_human_input_v2_pause_reason
from core.workflow.nodes.human_input_v2.runtime import PreparedForm
from graphon.entities.pause_reason import HitlRequired
from graphon.runtime import GraphRuntimeState
from repositories.entities.workflow_pause import WorkflowPauseEntity
from repositories.factory import DifyAPIRepositoryFactory
from services.human_input_v2.form_service import load_prepared_forms


@dataclass(frozen=True)
class WorkflowPauseSnapshot:
    runtime_state: GraphRuntimeState
    reasons: Sequence[PauseReason]
    v2_forms: Mapping[str, PreparedForm]


def load_workflow_pause_snapshot(
    pause: WorkflowPauseEntity,
    *,
    session_factory: sessionmaker[Session],
    context: WorkflowResumptionContext | None = None,
) -> WorkflowPauseSnapshot:
    """The authorized pause's graph determines which approvals are still pending.

    Only a v1 reference may consult the legacy reason table. A missing or invalid
    v2 checkpoint must not fall back to that table or to all forms in the run.
    """
    if context is None:
        context = WorkflowResumptionContext.loads(pause.get_state().decode())
    state = GraphRuntimeState.from_snapshot(context.serialized_graph_runtime_state)
    graph_reasons = state.graph_execution.pause_reasons
    v2_ids: list[str] = []
    has_v1 = False
    for reason in graph_reasons:
        if not isinstance(reason, HitlRequired):
            continue
        version, form_id = default_session_binding.resolve_form_id_from_session_id(session_id=reason.session_id)
        if version == "2":
            v2_ids.append(form_id)
        else:
            has_v1 = True
    legacy: dict[str, HumanInputRequired] = {}
    if has_v1:
        repository = DifyAPIRepositoryFactory.create_api_workflow_run_repository(session_factory)
        with session_factory() as session:
            legacy = {
                reason.form_id: reason
                for reason in repository.get_legacy_pause_reasons(session, pause.id)
                if isinstance(reason, HumanInputRequired)
            }
    forms: Mapping[str, PreparedForm] = {}
    if v2_ids:
        forms = load_prepared_forms(
            workflow_run_id=pause.workflow_execution_id, form_ids=v2_ids, session_factory=session_factory
        )
    reasons: list[PauseReason] = []
    for reason in graph_reasons:
        if not isinstance(reason, HitlRequired):
            reasons.append(reason)
            continue
        version, form_id = default_session_binding.resolve_form_id_from_session_id(session_id=reason.session_id)
        if version == "1":
            reasons.append(legacy[form_id])
            continue
        prepared = forms.get(form_id)
        if prepared is None:
            raise ValueError(f"Human Input v2 form is missing from its paused run: {form_id}")
        reasons.append(
            build_human_input_v2_pause_reason(prepared.form.resolved_form, form_id=form_id, node_id=reason.node_id)
        )
    return WorkflowPauseSnapshot(state, tuple(reasons), forms)
