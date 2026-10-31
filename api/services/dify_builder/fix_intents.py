"""Explicit unrelated-Fix intake; preparation never stops the current task.

Persistence ports lock and revalidate task identity. Cancellation, DSL reads and
queue delivery happen outside their SQL transactions. Unknown acknowledgements
are evidence to observe, never permission to dispatch again.
"""

import hashlib
import json
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Protocol

from core.dify_builder.contract import Action as UiAction
from core.dify_builder.contract import (
    ActionKind,
    CardOption,
    Decision,
    PreflightContextCard,
    PreflightIssue,
    RunContextCard,
    SessionView,
)
from core.dify_builder.errors import BadRequestError, ConflictError
from core.dify_builder.models import Action, Actor, DifyBuilderContext, Session
from core.dify_builder.state import is_terminal

if TYPE_CHECKING:
    from services.dify_builder.service import DifyBuilderService


@dataclass(frozen=True)
class FixIntent:
    id: str
    session_id: str
    app_id: str
    target_task_id: str
    source: dict[str, Any]
    model_config: dict[str, Any]
    status: str
    decision_id: str = ""
    decision_kind: str = ""
    enqueue: str = "unreserved"
    command_id: str = ""
    activated_version: int | None = None
    response: dict[str, Any] | None = None


@dataclass
class FixIntentReceipt:
    fix_intent_id: str
    status: str
    session: SessionView


class FixIntentRepository(Protocol):
    """Owner-scoped, Session-locked operations over independent intake rows.

    Prepare serializes key/source uniqueness without changing the Session head.
    Decide binds one explicit choice to its replay identity. Activate atomically
    writes the new task, original failed Run, context card, Session CAS and queue
    reservation, refusing stale tasks or unsettled outcomes. Queue reservation is
    one-way; unknown/dispatched delivery is never claimable again. All operations
    reject foreign owners and cleared sessions. No operation performs external I/O.
    """

    def select_conversation(self, actor: Actor, app_id: str, requested_session_id: str | None = None) -> str | None: ...
    def validate_source(self, actor: Actor, app_id: str, source: dict[str, Any]) -> None: ...
    def find(self, actor: Actor, session_id: str, client_action_id: str) -> FixIntent | None: ...
    def prepare(
        self,
        actor: Actor,
        session_id: str,
        *,
        client_action_id: str,
        expected_task_id: str,
        source: dict[str, Any],
        model_config: dict[str, Any],
    ) -> FixIntent: ...
    def get(self, actor: Actor, session_id: str, intent_id: str) -> FixIntent: ...
    def pending(self, actor: Actor, session_id: str) -> FixIntent | None: ...
    def decide(
        self, actor: Actor, session_id: str, intent_id: str, *, expected_task_id: str, kind: str, client_action_id: str
    ) -> FixIntent: ...
    def activate(self, actor: Actor, session_id: str, intent_id: str, *, dsl: dict, revision: str) -> FixIntent: ...
    def reserve_dispatch(self, actor: Actor, session_id: str, intent_id: str) -> bool: ...
    def finish_dispatch(self, actor: Actor, session_id: str, intent_id: str, *, outcome: str) -> None: ...
    def save_response(self, actor: Actor, session_id: str, intent_id: str, response: dict) -> None: ...


def digest(value: object) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    ).hexdigest()


def needs_stop(session: Session, context: DifyBuilderContext) -> bool:
    return not is_terminal(session.current_state) and context.task_status not in {"completed", "idle", "abandoned"}


def prepare_fix_intent(
    service: "DifyBuilderService",
    session_id: str,
    actor: Actor,
    *,
    failed_run_id: str | None,
    checklist_errors=None,
    model_config=None,
    client_action_id: str,
    attachments: list[str] | None = None,
) -> FixIntentReceipt:
    from dataclasses import asdict

    from services.dify_builder.task_lifecycle import task_identity

    session, context = service._get_authorized_session(session_id, actor)
    errors = service._parse_checklist_errors(checklist_errors)
    if failed_run_id is not None and not isinstance(failed_run_id, str):
        raise BadRequestError("failed_run_id must be a string")
    failed_run_id = (failed_run_id or "").strip()
    if not failed_run_id and not errors:
        raise BadRequestError("failed_run_id or checklist_errors is required")
    if not isinstance(client_action_id, str) or not client_action_id.strip() or len(client_action_id) > 128:
        raise BadRequestError("client_action_id is required")
    source = (
        {"kind": "checklist", "checklist_errors": [asdict(error) for error in errors]}
        if errors
        else {
            "kind": "run",
            "failed_run_id": failed_run_id,
        }
    )
    repository = service._fix_intent_repo
    if repository is None:
        raise BadRequestError("Fix intake is unavailable")
    intent = repository.prepare(
        actor,
        session_id,
        client_action_id=client_action_id,
        expected_task_id=task_identity(session, context),
        source={**source, "attachments": service._validate_create_material(actor, attachments)},
        model_config=service._validate_model_config(actor, model_config) if model_config else {},
    )
    # A completed/idle task needs no stop confirmation. Active tasks only stage.
    session, context = service._repo.get_session(session_id)
    if intent.status == "awaiting_confirmation" and not needs_stop(session, context):
        _activate(service, actor, intent)
        intent = repository.get(actor, session_id, intent.id)
    elif intent.status == "activated":
        # An explicit retry may finish an unattempted reservation; an unknown
        # acknowledgement never makes that reservation claimable again.
        _activate(service, actor, intent)
    if intent.status == "related":
        service._seed_material(
            session,
            context,
            actor,
            intent.source.get("attachments", []),
            client_turn_id="fix:" + intent.id,
        )
    return FixIntentReceipt(intent.id, intent.status, service.get_session_view(session_id, actor))


def _activate(service: "DifyBuilderService", actor: Actor, intent: FixIntent) -> None:
    repository = service._fix_intent_repo
    assert repository is not None
    if intent.status not in {"activated", "related", "dismissed"}:
        dsl, revision = service._read_task_dsl_fn(intent.app_id, actor)
        intent = repository.activate(actor, intent.session_id, intent.id, dsl=dsl, revision=revision)
    if intent.status != "activated" or not repository.reserve_dispatch(actor, intent.session_id, intent.id):
        return
    assert intent.activated_version is not None
    session, context = service._repo.get_session_at_version(intent.session_id, intent.activated_version)
    from services.dify_builder.task_controls import generation

    action = Action(
        kind="request_fix",
        base_version=session.version,
        base_app_revision=context.last_snapshot_hash,
        command_id=intent.command_id,
        execution_generation=generation(context),
    )
    try:
        service._seed_material(
            session,
            context,
            actor,
            intent.source.get("attachments", []),
            client_turn_id="fix:" + intent.id,
        )
        service.dispatch(intent.session_id, action, actor)
    except Exception as error:
        from services.dify_builder.errors import EnqueueAcknowledgementError

        repository.finish_dispatch(
            actor,
            intent.session_id,
            intent.id,
            outcome="unknown" if isinstance(error, EnqueueAcknowledgementError) else "pending",
        )
        raise
    repository.finish_dispatch(actor, intent.session_id, intent.id, outcome="dispatched")


def submit_fix_intent(service: "DifyBuilderService", session_id: str, actor: Actor, action: Action) -> SessionView:
    from services.dify_builder.conversation_lifecycle import observe_task_stop, stop_task_for_switch
    from services.dify_builder.task_lifecycle import task_identity

    repository = service._fix_intent_repo
    if repository is None:
        raise BadRequestError("Fix intake is unavailable")
    if action.kind not in {"dismiss_fix", "stop_and_switch_fix"}:
        raise BadRequestError("Invalid Fix decision")
    intent_id, expected = action.payload.get("fix_intent_id"), action.payload.get("expected_task_id")
    if not isinstance(intent_id, str) or not isinstance(expected, str) or not action.command_id:
        raise BadRequestError("Fix decision identity is required")
    service._get_authorized_session(session_id, actor)
    intent = repository.decide(
        actor,
        session_id,
        intent_id,
        expected_task_id=expected,
        kind=action.kind,
        client_action_id=action.command_id,
    )
    if intent.status not in {"dismissed", "related", "activated"}:
        session, context = service._repo.get_session(session_id)
        if task_identity(session, context) != expected:
            latest = repository.get(actor, session_id, intent.id)
            if latest.status == "activated":
                _activate(service, actor, latest)
                return service.get_session_view(session_id, actor)
            raise ConflictError("Fix intent targets a superseded task")
        if needs_stop(session, context):
            key = "fix-stop:" + intent.id
            try:
                _, stopped = stop_task_for_switch(
                    service,
                    session_id,
                    actor,
                    expected_task_id=expected,
                    client_action_id=key,
                )
                if (
                    stopped.paused
                    and stopped.task_control.get("receipt", {}).get("id") == key
                    and observe_task_stop(service, session_id, actor, client_action_id=key) != "settled"
                ):
                    return service.get_session_view(session_id, actor)
            except ConflictError:
                # Another delivery of this same decision may have activated
                # while this request was observing the previous stop receipt.
                latest = repository.get(actor, session_id, intent.id)
                if latest.status != "activated":
                    raise
                _activate(service, actor, latest)
                return service.get_session_view(session_id, actor)
        _activate(service, actor, intent)
    elif intent.status == "activated":
        _activate(service, actor, intent)
    return service.get_session_view(session_id, actor)


def pending_fix_projection(
    service: "DifyBuilderService", session: Session, context: DifyBuilderContext, actor: Actor
) -> tuple[list[UiAction], Decision, RunContextCard | PreflightContextCard] | None:
    repository = service._fix_intent_repo
    if repository is None:
        return None
    intent = repository.pending(actor, session.id)
    if intent is None:
        return None
    payload = {"fix_intent_id": intent.id, "expected_task_id": intent.target_task_id}
    actions = [
        UiAction(id="dismiss_fix", label="Keep the current task", kind=ActionKind.SECONDARY, payload=payload),
        UiAction(
            id="stop_and_switch_fix", label="Stop and fix this error", kind=ActionKind.DESTRUCTIVE, payload=payload
        ),
    ]
    if intent.status == "stopping":
        actions = actions[1:]
    decision = Decision(
        title="Switch to fixing this error?",
        description="The current task must safely stop before this repair starts.",
        options=[
            CardOption(id=a.id, label=a.label, tone="destructive" if a.id == "stop_and_switch_fix" else "neutral")
            for a in actions
        ],
        submit=UiAction(id="confirm", label="Submit", kind=ActionKind.PRIMARY),
        default_option_id="dismiss_fix" if intent.status == "awaiting_confirmation" else "",
    )
    if intent.source["kind"] == "run":
        card = RunContextCard(
            run_id=intent.source["failed_run_id"],
            title="",
            error_code="",
            message="",
            trace_ref="",
        )
    else:
        issues = [PreflightIssue(**error) for error in intent.source["checklist_errors"]]
        card = PreflightContextCard(
            node_count=len({issue.node_id for issue in issues if issue.node_id}),
            issue_count=len(issues),
            issues=issues,
        )
    return actions, decision, card
