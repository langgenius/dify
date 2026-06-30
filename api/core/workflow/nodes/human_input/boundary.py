from __future__ import annotations

from collections.abc import Sequence

from graphon.entities.pause_reason import HitlRequired, SchedulingPause
from graphon.runtime.graph_runtime_state_protocol import ReadOnlyVariablePool

from core.repositories.human_input_repository import HumanInputFormSubmissionRepository
from core.workflow.human_input_policy import resolve_variable_select_input_options

from .pause_reason import HumanInputRequired, PauseReason
from .session_binding import SessionBinding


def enrich_graph_pause_reasons(
    *,
    reasons: Sequence[object],
    form_repository: HumanInputFormSubmissionRepository,
    session_binding: SessionBinding,
    variable_pool: ReadOnlyVariablePool | None,
) -> list[PauseReason]:
    enriched: list[PauseReason] = []
    for reason in reasons:
        if isinstance(reason, HitlRequired):
            enriched_reason = _enrich_hitl_required(
                reason=reason,
                form_repository=form_repository,
                session_binding=session_binding,
                variable_pool=variable_pool,
            )
            if enriched_reason is not None:
                enriched.append(enriched_reason)
            continue
        if isinstance(reason, HumanInputRequired | SchedulingPause):
            enriched.append(reason)
    return enriched


def _enrich_hitl_required(
    *,
    reason: HitlRequired,
    form_repository: HumanInputFormSubmissionRepository,
    session_binding: SessionBinding,
    variable_pool: ReadOnlyVariablePool | None,
) -> HumanInputRequired | None:
    form_id = session_binding.resolve_form_id_from_session_id(session_id=reason.session_id)
    record = form_repository.get_by_form_id(form_id)
    if record is None:
        return None

    return HumanInputRequired(
        form_id=record.form_id,
        form_content=record.rendered_content,
        inputs=resolve_variable_select_input_options(record.definition.inputs, variable_pool=variable_pool),
        actions=list(record.definition.user_actions),
        node_id=reason.node_id,
        node_title=reason.node_title or record.definition.node_title or record.node_id,
        resolved_default_values=dict(record.definition.default_values),
    )
