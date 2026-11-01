from __future__ import annotations

from collections.abc import Iterable

from core.repositories.human_input_repository import HumanInputFormRecord, HumanInputFormSubmissionRepository
from core.workflow.human_input_policy import resolve_variable_select_input_options
from core.workflow.system_variables import SystemVariableKey, get_system_text
from graphon.engine.filter import EngineEventFilterContext
from graphon.engine_events import (
    EngineEvent,
    NodeRunHumanInputFormFilledEvent,
    NodeRunHumanInputFormTimeoutEvent,
    NodeRunStartedEvent,
    NodeRunSucceededEvent,
)
from graphon.entities.pause_reason import HitlRequired
from graphon.enums import BuiltinNodeTypes
from graphon.runtime.runtime_state_protocol import ReadOnlyVariablePool
from graphon.variables.segments import StringSegment

from .constants import OUTPUT_FIELD_ACTION_ID, OUTPUT_FIELD_ACTION_VALUE, OUTPUT_FIELD_RENDERED_CONTENT, TIMEOUT_HANDLE
from .pause_reason import HumanInputRequired
from .session_binding import default_session_binding


class HumanInputPauseReasonResolutionError(LookupError):
    """Raised when a graph pause reason cannot be resolved into Dify-owned form state."""


class HumanInputFormEventFilter:
    """Adapt V1 callback results; V2 nodes emit their own form lifecycle events."""

    def __init__(self, *, form_repository: HumanInputFormSubmissionRepository) -> None:
        self._form_repository = form_repository
        self._node_titles: dict[str, str] = {}
        self._v1_node_ids: set[str] = set()
        self._app_id: str | None = None

    @property
    def filter_id(self) -> str:
        return "dify-human-input-form-events"

    def initialize(self, context: EngineEventFilterContext) -> None:
        self._node_titles.clear()
        # Graphon completion events can retain the default version. Route by
        # the concrete node in the graph instead of the event's version field.
        self._v1_node_ids = {
            node.id
            for node in (context.graph.root_node, *context.graph.nodes.values())
            if node.node_type == BuiltinNodeTypes.HUMAN_INPUT and node.version() == "1"
        }
        self._app_id = get_system_text(context.runtime_state.variable_pool, SystemVariableKey.APP_ID)

    def on_event(self, event: EngineEvent) -> Iterable[EngineEvent]:
        if isinstance(event, NodeRunStartedEvent | NodeRunSucceededEvent) and event.node_id in self._v1_node_ids:
            if isinstance(event, NodeRunStartedEvent):
                self._node_titles[event.id] = event.node_title
            else:
                yield self._completion_event(event)

        yield event

    def flush(self) -> Iterable[EngineEvent]:
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
                container_id=event.container_id,
                node_run_result=result,
                expiration_time=form.expiration_time,
            )

        return NodeRunHumanInputFormFilledEvent(
            id=event.id,
            node_id=event.node_id,
            node_type=event.node_type,
            node_title=node_title,
            node_version=event.node_version,
            container_id=event.container_id,
            node_run_result=result,
            rendered_content=result.outputs[OUTPUT_FIELD_RENDERED_CONTENT].text,
            action_id=result.outputs[OUTPUT_FIELD_ACTION_ID].text,
            action_text=result.outputs[OUTPUT_FIELD_ACTION_VALUE].text,
            submitted_data=result.inputs,
        )


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

    return build_human_input_pause_reason(reason=reason, record=record, variable_pool=variable_pool)


def human_input_container_selector(form_id: str) -> tuple[str, str]:
    return ("__dify_workflow_tool_hitl__", form_id)


def resolve_human_input_node_id(*, node_id: str, form_id: str, variable_pool: ReadOnlyVariablePool | None) -> str:
    """Project form ownership onto the visible graph without changing engine identity."""
    container = variable_pool.get(human_input_container_selector(form_id)) if variable_pool is not None else None
    return container.value if isinstance(container, StringSegment) else node_id


def build_human_input_pause_reason(
    *, reason: HitlRequired, record: HumanInputFormRecord, variable_pool: ReadOnlyVariablePool | None
) -> HumanInputRequired:
    """Format a materialized form without reading its repository."""
    form_id = record.form_id
    definition = record.definition
    return HumanInputRequired(
        form_id=record.form_id,
        form_content=record.rendered_content,
        inputs=resolve_variable_select_input_options(definition.inputs, variable_pool=variable_pool),
        actions=list(definition.user_actions),
        node_id=resolve_human_input_node_id(node_id=reason.node_id, form_id=form_id, variable_pool=variable_pool),
        node_title=reason.node_title or definition.node_title or record.node_id,
        resolved_default_values=dict(definition.default_values),
    )
