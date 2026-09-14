"""Emit ``human_input_required`` SSE for Agent App ask_human pauses.

Agent App chat turns reuse the existing HITL webapp contract (``HumanInputFormList``
+ ``/form/human_input/<form_token>``) instead of degrading to plain-text confirmation.
There is no workflow run for standalone Agent apps, so ``workflow_run_id`` in the SSE
payload is the owning message id — a stable correlation token for the paused turn.
"""

from __future__ import annotations

import json
from collections.abc import Mapping

from sqlalchemy import select

from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.entities.queue_entities import QueueHumanInputRequiredEvent
from core.app.entities.task_entities import HumanInputRequiredResponse
from core.db.session_factory import session_factory
from core.workflow.human_input_forms import load_form_dispositions_by_form_id
from core.workflow.human_input_policy import HumanInputSurface
from core.workflow.nodes.agent_v2.ask_human_hitl import AskHumanFormCreated
from libs.datetime_utils import to_utc_timestamp
from models.human_input import HumanInputForm

_INVOKE_FROM_TO_HITL_SURFACE: Mapping[InvokeFrom, HumanInputSurface] = {
    InvokeFrom.SERVICE_API: HumanInputSurface.SERVICE_API,
    InvokeFrom.OPENAPI: HumanInputSurface.OPENAPI,
}


def build_human_input_required_stream_response(
    *,
    task_id: str,
    message_id: str,
    created: AskHumanFormCreated,
    invoke_from: InvokeFrom,
) -> HumanInputRequiredResponse:
    """Build the shared ``human_input_required`` SSE payload for an ask_human pause."""
    hitl_surface = _INVOKE_FROM_TO_HITL_SURFACE.get(invoke_from)
    with session_factory.create_session() as session:
        row = session.execute(
            select(
                HumanInputForm.id,
                HumanInputForm.expiration_time,
                HumanInputForm.form_definition,
            ).where(HumanInputForm.id == created.form_id)
        ).one()
        form_id, expiration_time, form_definition = row
        try:
            definition_payload = json.loads(form_definition) if form_definition else {}
        except (TypeError, json.JSONDecodeError):
            definition_payload = {}
        display_in_ui = bool(definition_payload.get("display_in_ui"))
        dispositions = load_form_dispositions_by_form_id(
            [str(form_id)],
            session=session,
            surface=hitl_surface,
        )

    disposition = dispositions.get(created.form_id)
    return HumanInputRequiredResponse(
        task_id=task_id,
        # Agent App chat has no workflow run; reuse the message id as the public
        # correlation token expected by the shared HITL client contract.
        workflow_run_id=message_id,
        data=HumanInputRequiredResponse.Data(
            form_id=created.form_id,
            node_id=message_id,
            node_title=created.node_title,
            form_content=created.node_data.form_content,
            inputs=list(created.node_data.inputs),
            actions=list(created.node_data.user_actions),
            display_in_ui=display_in_ui,
            form_token=disposition.form_token if disposition else None,
            approval_channels=list(disposition.approval_channels) if disposition else [],
            resolved_default_values=created.resolved_default_values,
            expiration_time=to_utc_timestamp(expiration_time),
        ),
    )


def build_human_input_required_stream_response_from_queue_event(
    *,
    task_id: str,
    message_id: str,
    event: QueueHumanInputRequiredEvent,
    invoke_from: InvokeFrom,
) -> HumanInputRequiredResponse:
    """Build ``human_input_required`` SSE from a queued Agent App ask_human pause."""
    hitl_surface = _INVOKE_FROM_TO_HITL_SURFACE.get(invoke_from)
    with session_factory.create_session() as session:
        row = session.execute(
            select(
                HumanInputForm.id,
                HumanInputForm.expiration_time,
                HumanInputForm.form_definition,
            ).where(HumanInputForm.id == event.form_id)
        ).one()
        form_id, expiration_time, form_definition = row
        try:
            definition_payload = json.loads(form_definition) if form_definition else {}
        except (TypeError, json.JSONDecodeError):
            definition_payload = {}
        display_in_ui = bool(definition_payload.get("display_in_ui", event.display_in_ui))
        dispositions = load_form_dispositions_by_form_id(
            [str(form_id)],
            session=session,
            surface=hitl_surface,
        )

    disposition = dispositions.get(event.form_id)
    return HumanInputRequiredResponse(
        task_id=task_id,
        workflow_run_id=message_id,
        data=HumanInputRequiredResponse.Data(
            form_id=event.form_id,
            node_id=event.node_id,
            node_title=event.node_title,
            form_content=event.form_content,
            inputs=list(event.inputs),
            actions=list(event.actions),
            display_in_ui=display_in_ui,
            form_token=disposition.form_token if disposition else None,
            approval_channels=list(disposition.approval_channels) if disposition else [],
            resolved_default_values=event.resolved_default_values,
            expiration_time=to_utc_timestamp(expiration_time),
        ),
    )


__all__ = [
    "build_human_input_required_stream_response",
    "build_human_input_required_stream_response_from_queue_event",
]
