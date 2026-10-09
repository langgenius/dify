from __future__ import annotations

from core.repositories.human_input_repository import HumanInputFormSubmissionRepository
from core.workflow.human_input_policy import resolve_variable_select_input_options
from graphon.entities.pause_reason import HitlRequired
from graphon.runtime.graph_runtime_state_protocol import ReadOnlyVariablePool

from .pause_reason import HumanInputRequired
from .session_binding import default_session_binding


class HumanInputPauseReasonResolutionError(LookupError):
    """Raised when a graph pause reason cannot be resolved into Dify-owned form state."""


def resolve_human_input_v1_pause_reason(
    *,
    reason: HitlRequired,
    form_repository: HumanInputFormSubmissionRepository,
    variable_pool: ReadOnlyVariablePool | None,
) -> HumanInputRequired:
    """Load the legacy form from the V1 submission repository."""
    node_version, form_id = default_session_binding.resolve_form_id_from_session_id(session_id=reason.session_id)
    if node_version != "1":
        raise ValueError("Expected a Human Input v1 session")
    record = form_repository.get_by_form_id(form_id)
    if record is None:
        raise HumanInputPauseReasonResolutionError(
            f"missing human input form while enriching pause reason: form_id={form_id}, session_id={reason.session_id}"
        )

    return HumanInputRequired(
        form_id=record.form_id,
        form_content=record.rendered_content,
        inputs=resolve_variable_select_input_options(record.definition.inputs, variable_pool=variable_pool),
        actions=list(record.definition.user_actions),
        node_id=reason.node_id,
        node_title=reason.node_title or record.definition.node_title or record.node_id,
        resolved_default_values=dict(record.definition.default_values),
    )
