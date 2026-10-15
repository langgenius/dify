from __future__ import annotations

from collections.abc import Iterable, Sequence

from core.repositories.human_input_repository import HumanInputFormSubmissionRepository
from core.workflow.human_input_policy import resolve_variable_select_input_options
from core.workflow.system_variables import SystemVariableKey, get_system_text
from graphon.entities.pause_reason import HitlRequired, SchedulingPause
from graphon.enums import BuiltinNodeTypes
from graphon.filters import GraphEventFilterContext
from graphon.graph_events import (
    GraphEngineEvent,
    NodeRunHumanInputFormFilledEvent,
    NodeRunHumanInputFormTimeoutEvent,
    NodeRunStartedEvent,
    NodeRunSucceededEvent,
)
from graphon.runtime.graph_runtime_state_protocol import ReadOnlyVariablePool

from .constants import OUTPUT_FIELD_ACTION_ID, OUTPUT_FIELD_ACTION_VALUE, OUTPUT_FIELD_RENDERED_CONTENT, TIMEOUT_HANDLE
from .pause_reason import HumanInputRequired, PauseReason
from .session_binding import default_session_binding


class HumanInputPauseReasonResolutionError(LookupError):
    """Raised when a graph pause reason cannot be resolved into Dify-owned form state."""


class HumanInputFormEventFilter:
    """Adapt HITL callback results into Dify's form lifecycle event stream."""

    def __init__(self, *, form_repository: HumanInputFormSubmissionRepository) -> None:
        self._form_repository = form_repository
        self._node_titles: dict[str, str] = {}
        self._app_id: str | None = None

    @property
    def filter_id(self) -> str:
        return "dify-human-input-form-events"

    def initialize(self, context: GraphEventFilterContext) -> None:
        self._node_titles.clear()
        self._app_id = get_system_text(context.runtime_state.variable_pool, SystemVariableKey.APP_ID)

    def on_event(self, event: GraphEngineEvent) -> Iterable[GraphEngineEvent]:
        if isinstance(event, NodeRunStartedEvent) and event.node_type == BuiltinNodeTypes.HUMAN_INPUT:
            self._node_titles[event.id] = event.node_title
        elif isinstance(event, NodeRunSucceededEvent) and event.node_type == BuiltinNodeTypes.HUMAN_INPUT:
            yield self._completion_event(event)

        yield event

    def flush(self) -> Iterable[GraphEngineEvent]:
        return ()

    def _completion_event(
        self, event: NodeRunSucceededEvent
    ) -> NodeRunHumanInputFormFilledEvent | NodeRunHumanInputFormTimeoutEvent:
        # Titles are present only on start events. Key by execution ID so loop
        # iterations and concurrent executions do not share completion metadata.
        node_title = self._node_titles.pop(event.id)
        result = event.node_run_result
        if result.edge_source_handle == TIMEOUT_HANDLE:
            # The callback's timeout result omits the deadline. Resolve the form
            # by its bound execution ID rather than choosing a form by node ID.
            form = self._form_repository.get_by_form_id(event.id)
            if form is None or form.app_id != self._app_id or form.node_id != event.node_id:
                raise ValueError(f"Cannot resolve timed-out human input form for node execution {event.id}")
            return NodeRunHumanInputFormTimeoutEvent(
                id=event.id,
                node_id=event.node_id,
                node_type=event.node_type,
                node_title=node_title,
                node_version=event.node_version,
                in_iteration_id=event.in_iteration_id,
                in_loop_id=event.in_loop_id,
                expiration_time=form.expiration_time,
            )

        return NodeRunHumanInputFormFilledEvent(
            id=event.id,
            node_id=event.node_id,
            node_type=event.node_type,
            node_title=node_title,
            node_version=event.node_version,
            in_iteration_id=event.in_iteration_id,
            in_loop_id=event.in_loop_id,
            rendered_content=result.outputs[OUTPUT_FIELD_RENDERED_CONTENT].text,
            action_id=result.outputs[OUTPUT_FIELD_ACTION_ID].text,
            action_text=result.outputs[OUTPUT_FIELD_ACTION_VALUE].text,
            submitted_data=result.inputs,
        )


def enrich_graph_pause_reasons(
    *,
    reasons: Sequence[HitlRequired | PauseReason],
    form_repository: HumanInputFormSubmissionRepository,
    variable_pool: ReadOnlyVariablePool | None,
) -> list[PauseReason]:
    enriched: list[PauseReason] = []
    for reason in reasons:
        if isinstance(reason, HitlRequired):
            enriched_reason = _enrich_hitl_required(
                reason=reason,
                form_repository=form_repository,
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
    variable_pool: ReadOnlyVariablePool | None,
) -> HumanInputRequired:
    form_id = default_session_binding.resolve_form_id_from_session_id(session_id=reason.session_id)
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
