from __future__ import annotations

from collections.abc import Iterable, Iterator, Sequence

from core.repositories.human_input_repository import HumanInputFormSubmissionRepository
from core.workflow.human_input_policy import resolve_variable_select_input_options
from graphon.entities.pause_reason import HitlRequired, SchedulingPause
from graphon.enums import BuiltinNodeTypes
from graphon.graph_events import (
    GraphEdgeTakenEvent,
    GraphEngineEvent,
    NodeRunExceptionEvent,
    NodeRunStartedEvent,
    NodeRunSucceededEvent,
)
from graphon.runtime.graph_runtime_state_protocol import ReadOnlyVariablePool

from .pause_reason import HumanInputRequired, PauseReason
from .session_binding import default_session_binding


class HumanInputPauseReasonResolutionError(LookupError):
    """Raised when a graph pause reason cannot be resolved into Dify-owned form state."""


def defer_human_input_edges_until_completion(events: Iterable[GraphEngineEvent]) -> Iterator[GraphEngineEvent]:
    """Keep Human Input completion ahead of dependent response text.

    Graphon's dispatcher collects taken edges before their source node's result.
    ResponseStreamFilter can turn those edges into Answer text immediately, so
    defer Human Input's taken edges until the runner can publish its form and
    node completion events. Other branches continue streaming independently.

    Traversal events have no execution ID. The dispatcher processes each result
    and its edges serially, so a source node ID identifies the pending batch even
    across repeated executions in containers. An interrupted batch is discarded:
    it must not activate a response without its source node's completion.
    """
    human_input_nodes: set[str] = set()
    pending_edges: dict[str, list[GraphEdgeTakenEvent]] = {}
    for event in events:
        if isinstance(event, NodeRunStartedEvent) and event.node_type == BuiltinNodeTypes.HUMAN_INPUT:
            human_input_nodes.add(event.node_id)
        if isinstance(event, GraphEdgeTakenEvent) and event.source_node_id in human_input_nodes:
            pending_edges.setdefault(event.source_node_id, []).append(event)
            continue

        yield event
        if isinstance(event, NodeRunSucceededEvent | NodeRunExceptionEvent):
            yield from pending_edges.pop(event.node_id, [])


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
