"""Resume an Agent run after a dify.ask_human HITL form reaches a terminal state.

ENG-638. When the outer workflow resumes (the human submitted the form, or it
timed out), graphon re-executes the Agent node's ``_run``. This module reads the
correlated HITL form (by ``pending_form_id``) and maps it back into the
agent-side ``dify.ask_human`` contract so the node can start a *second* Agent run
that carries the human's answer:

* submitted  -> AskHumanToolResult(status="submitted", action, values)
* timeout / expired -> AskHumanToolResult(status="timeout")
* still waiting (defensive: the host resumed us early) -> re-emit the same
  HumanInputRequired pause rebuilt from the stored form definition.

It only *reads* existing HITL form state — it never mutates the form or the HITL
submission flow. The DB read (``resolve_ask_human_form``) is kept thin so the
mapping (``map_form_to_outcome``) stays pure and unit-testable.
"""

from __future__ import annotations

import json
from dataclasses import dataclass

from dify_agent.layers.ask_human import (
    AskHumanResultStatus,
    AskHumanSelectedAction,
    AskHumanToolResult,
)
from dify_agent.protocol import DeferredToolResultsPayload
from pydantic import JsonValue
from sqlalchemy import select

from core.db.session_factory import session_factory
from core.workflow.nodes.human_input.entities import FormDefinition
from core.workflow.nodes.human_input.enums import HumanInputFormStatus
from core.workflow.nodes.human_input.pause_reason import HumanInputRequired
from models.human_input import HumanInputForm

# A WAITING form has not been answered yet; the other terminal states map onto
# the agent-facing result status. EXPIRED (global timeout) and TIMEOUT
# (node-level) both surface to the model as "timeout" so it can react.
_FORM_STATUS_TO_RESULT: dict[HumanInputFormStatus, AskHumanResultStatus] = {
    HumanInputFormStatus.SUBMITTED: "submitted",
    HumanInputFormStatus.TIMEOUT: "timeout",
    HumanInputFormStatus.EXPIRED: "timeout",
}


@dataclass(frozen=True, slots=True)
class AskHumanResumeOutcome:
    """Result of inspecting a correlated ask_human form on workflow resume.

    Exactly one of ``deferred_result`` / ``repause`` is set:
    * ``deferred_result`` — the form reached a terminal state; start the second run.
    * ``repause`` — the form is still waiting; re-emit this pause defensively.
    """

    deferred_result: AskHumanToolResult | None = None
    repause: HumanInputRequired | None = None


def resolve_ask_human_form(*, form_id: str, tenant_id: str, node_id: str) -> AskHumanResumeOutcome | None:
    """Load the correlated form and map it to a resume outcome.

    Returns ``None`` when the form no longer exists (correlation lost) — the
    caller should fall back to a normal (non-resume) Agent run.
    """
    with session_factory.create_session() as session:
        form = session.scalar(
            select(HumanInputForm).where(
                HumanInputForm.id == form_id,
                HumanInputForm.tenant_id == tenant_id,
            )
        )
        if form is None:
            return None
        return map_form_to_outcome(
            status=form.status,
            selected_action_id=form.selected_action_id,
            submitted_data=form.submitted_data,
            rendered_content=form.rendered_content,
            form_definition=form.form_definition,
            form_id=form.id,
            node_id=node_id,
        )


def map_form_to_outcome(
    *,
    status: HumanInputFormStatus,
    selected_action_id: str | None,
    submitted_data: str | None,
    rendered_content: str,
    form_definition: str,
    form_id: str,
    node_id: str,
) -> AskHumanResumeOutcome:
    """Map a terminal (or still-waiting) HITL form to a resume outcome. Pure."""
    definition = FormDefinition.model_validate_json(form_definition)
    if status == HumanInputFormStatus.WAITING:
        return AskHumanResumeOutcome(repause=_rebuild_pause(definition=definition, form_id=form_id, node_id=node_id))

    result_status = _FORM_STATUS_TO_RESULT.get(status, "unavailable")
    if result_status != "submitted":
        return AskHumanResumeOutcome(deferred_result=AskHumanToolResult(status=result_status))
    return AskHumanResumeOutcome(
        deferred_result=AskHumanToolResult(
            status="submitted",
            action=_selected_action(selected_action_id=selected_action_id, definition=definition),
            values=_submitted_values(submitted_data),
            rendered_content=rendered_content,
        )
    )


def build_deferred_tool_results(*, tool_call_id: str, result: AskHumanToolResult) -> DeferredToolResultsPayload:
    """Wrap an ask_human result as the deferred-tool-results payload for resume."""
    return DeferredToolResultsPayload(calls={tool_call_id: result.model_dump(mode="json")})


def _submitted_values(submitted_data: str | None) -> dict[str, JsonValue]:
    if not submitted_data:
        return {}
    parsed = json.loads(submitted_data)
    if not isinstance(parsed, dict):
        return {}
    return {str(key): value for key, value in parsed.items()}


def _selected_action(*, selected_action_id: str | None, definition: FormDefinition) -> AskHumanSelectedAction | None:
    if selected_action_id is None:
        return None
    # The form's user_action title is the verbatim ask_human action label set at
    # form-build time; fall back to the id only if the action is somehow missing.
    label = next(
        (action.title for action in definition.user_actions if action.id == selected_action_id),
        selected_action_id,
    )
    return AskHumanSelectedAction(id=selected_action_id, label=label)


def _rebuild_pause(*, definition: FormDefinition, form_id: str, node_id: str) -> HumanInputRequired:
    return HumanInputRequired(
        form_id=form_id,
        form_content=definition.rendered_content or definition.form_content,
        inputs=list(definition.inputs),
        actions=list(definition.user_actions),
        node_id=node_id,
        node_title=definition.node_title or node_id,
        resolved_default_values=dict(definition.default_values),
    )


__all__ = [
    "AskHumanResumeOutcome",
    "build_deferred_tool_results",
    "map_form_to_outcome",
    "resolve_ask_human_form",
]
