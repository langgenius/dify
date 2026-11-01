"""Independent conversation controls, without workflow reads or cognition.

The repository owns the durable fence and public history boundary. Cancellation
settles outside SQL; a receipt acknowledges revocation, never physical cleanup.
"""

from typing import Literal

from core.dify_builder.contract import Phase, RunStatus, SessionView
from core.dify_builder.errors import BadRequestError, ConflictError
from core.dify_builder.models import Actor, DifyBuilderContext, Session
from services.dify_builder.task_control_service import _settle_stop


def is_conversation_cleared(context: DifyBuilderContext) -> bool:
    return bool(context.task_control.get("conversation_clear"))


def lifecycle_settlement(context: DifyBuilderContext) -> Literal["settled", "pending", "unknown"] | None:
    """Project only the current clear/abandon's known execution state.

    This is not physical cleanup proof. Clear retains its durable acknowledgment
    state; no missing execution references or later Run can upgrade it.
    """
    if not is_conversation_cleared(context) and context.task_status != "abandoned":
        return None
    controls = context.task_control
    receipt = controls.get("lifecycle_receipt")
    if not isinstance(receipt, dict) or not context.last_command_id or receipt.get("id") != context.last_command_id:
        return "unknown"
    settlement = controls.get("settlement")
    return settlement if isinstance(settlement, str) and settlement in {"settled", "pending", "unknown"} else "unknown"


def cleared_session_view(session: Session, context: DifyBuilderContext) -> SessionView:
    """Empty projection: deliberately no repository, workflow or Run lookup."""
    return SessionView(
        session_id=session.id,
        app_id=session.app_id,
        version=session.version,
        state=str(session.current_state),
        canvas_read_only=False,
        run_status=RunStatus.COMPLETE,
        interrupted=False,
        conversation_last_seq=-1,
        entry_mode=session.entry_mode,
        phase=Phase.UNDERSTAND,
        last_command_id=context.last_command_id,
        task_status="abandoned",
        conversation_cleared=True,
        lifecycle_settlement=lifecycle_settlement(context),
    )


def _release(service, session_id: str, old_owner: str | None, generation: int) -> None:
    service._repo.release_workflow_writer(session_id, generation=generation)
    if old_owner and (not old_owner.startswith("g") or old_owner.startswith(f"g{generation}:")):
        service._session_lock.release(session_id, old_owner)
    from services.dify_builder.progress_bus import publish_native_change

    publish_native_change(session_id)


def _validate(base_version: int, client_action_id: str, expected_task_id: str) -> None:
    if type(base_version) is not int or base_version < 1:
        raise BadRequestError("base_version must be a positive integer")
    if not isinstance(client_action_id, str) or not client_action_id.strip() or len(client_action_id) > 128:
        raise BadRequestError("client_action_id is required")
    if not isinstance(expected_task_id, str):
        raise BadRequestError("expected_task_id must be a string")


def _control(service, session_id, actor, *, operation, base_version, client_action_id, expected_task_id):
    _validate(base_version, client_action_id, expected_task_id)
    session, context = service._get_authorized_session(session_id, actor)
    if operation == "abandon" and context.test_input_ref:
        from services.dify_builder.service import AppAccess

        service._authorize_app(session.app_id, actor, AppAccess.TEST_AND_RUN)
    old_owner = service._session_lock.current_owner(session_id)
    session, context, receipt, old_generation = service._repo.conversation_lifecycle(
        session_id,
        actor,
        operation=operation,
        base_version=base_version,
        client_action_id=client_action_id,
        expected_task_id=expected_task_id,
    )
    if context.last_command_id != client_action_id:
        return receipt
    _release(service, session_id, old_owner, old_generation)
    if operation == "abandon":
        observe_task_stop(service, session_id, actor, client_action_id=client_action_id, deliver=True)
    return receipt


def clear(
    service,
    session_id: str,
    actor: Actor,
    *,
    base_version: int,
    client_action_id: str,
    expected_task_id: str = "",
    confirmed: bool = False,
) -> dict:
    if confirmed is not True:
        raise BadRequestError("clear requires explicit confirmation")
    return _control(
        service,
        session_id,
        actor,
        operation="clear",
        base_version=base_version,
        client_action_id=client_action_id,
        expected_task_id=expected_task_id,
    )


def abandon(
    service, session_id: str, actor: Actor, *, base_version: int, client_action_id: str, expected_task_id: str = ""
) -> dict:
    return _control(
        service,
        session_id,
        actor,
        operation="abandon",
        base_version=base_version,
        client_action_id=client_action_id,
        expected_task_id=expected_task_id,
    )


def stop_task_for_switch(
    service, session_id: str, actor: Actor, *, expected_task_id: str, client_action_id: str
) -> tuple[Session, DifyBuilderContext]:
    """Persist Stop and settle its exact identity, without building a SessionView."""
    _validate(1, client_action_id, expected_task_id)
    session, context = service._get_authorized_session(session_id, actor)
    if context.test_input_ref:
        from services.dify_builder.service import AppAccess

        service._authorize_app(session.app_id, actor, AppAccess.TEST_AND_RUN)
    old_owner = service._session_lock.current_owner(session_id)
    session, context, old_generation = service._repo.stop_task_for_switch(
        session_id, actor, expected_task_id=expected_task_id, client_action_id=client_action_id
    )
    if not context.paused or context.task_control.get("receipt", {}).get("id") != client_action_id:
        return session, context
    _release(service, session_id, old_owner, old_generation)
    observe_task_stop(service, session_id, actor, client_action_id=client_action_id, deliver=True)
    return service._repo.get_session(session_id)


def observe_task_stop(
    service, session_id: str, actor: Actor, *, client_action_id: str, deliver: bool = False
) -> Literal["settled", "pending", "unknown"]:
    _, context = service._get_authorized_session(session_id, actor)
    if is_conversation_cleared(context):
        raise ConflictError("conversation has been cleared")
    if context.task_control.get("receipt", {}).get("id") != client_action_id:
        raise ConflictError("task stop was superseded")
    _settle_stop(service._repo, service._test_actions, session_id, actor, client_action_id, deliver=deliver)
    _, context = service._repo.get_session(session_id)
    settlement = context.task_control.get("settlement", "settled")
    return settlement if settlement in {"pending", "unknown"} else "settled"
