import logging
from collections.abc import Callable
from typing import Annotated, cast

from flask import Request as FlaskRequest
from pydantic import UUID4, BaseModel, Field, ValidationError

from core.db.session_factory import session_factory
from extensions.ext_application_services import application_services
from extensions.ext_socketio import sio
from extensions.otel.workflow_collaboration import observe_workflow_event
from libs.passport import PassportService
from libs.token import extract_access_token
from repositories.workflow_collaboration_repository import WorkflowCollaborationRepository
from services.errors.billing import BillingUpstreamError
from services.workflow_collaboration_service import (
    WorkflowCollaborationNotEntitledError,
    WorkflowCollaborationService,
    WorkflowPageResume,
)

repository = WorkflowCollaborationRepository()
collaboration_service = WorkflowCollaborationService(repository, sio)


class WorkflowPageResumePayload(BaseModel):
    page_id: UUID4
    sequence: Annotated[int, Field(strict=True, ge=1)]


def _sio_on(event: str) -> Callable[[Callable[..., object]], Callable[..., object]]:
    return cast(Callable[[Callable[..., object]], Callable[..., object]], sio.on(event))


@_sio_on("connect")
@observe_workflow_event("connect", sio)
def socket_connect(sid, environ, auth=None):
    """
    Authenticate a connect with optional Socket.IO auth data; preserve token-based admission.
    """
    try:
        request_environ = FlaskRequest(environ)
        token = extract_access_token(request_environ)
    except Exception:
        logging.exception("Failed to extract token")
        token = None

    if not token:
        logging.warning("Socket connect rejected: missing token (sid=%s)", sid)
        return False

    try:
        decoded = PassportService().verify(token)
        user_id = decoded.get("user_id")
        if not user_id:
            logging.warning("Socket connect rejected: missing user_id (sid=%s)", sid)
            return False

        with sio.app.app_context():
            user = application_services().accounts.identity.load_user(user_id)
            if not user:
                logging.warning("Socket connect rejected: user not found (user_id=%s, sid=%s)", user_id, sid)
                return False
            if not user.has_edit_permission:
                logging.warning("Socket connect rejected: no edit permission (user_id=%s, sid=%s)", user_id, sid)
                return False

            collaboration_service.save_socket_identity(sid, user)
            return True

    except Exception:
        logging.exception("Socket authentication failed")
        return False


@_sio_on("user_connect")
@observe_workflow_event("user_connect", sio)
def handle_user_connect(sid: str, data: object) -> dict[str, object] | tuple[dict[str, str], int]:
    """Validate an optional page resume before admitting an authenticated socket to the room.

    Legacy clients may send the workflow ID alone. Invalid payloads return a 400 ACK
    before any room state is changed.
    """
    if not isinstance(data, dict) or not isinstance(workflow_id := data.get("workflow_id"), str) or not workflow_id:
        return {"msg": "workflow_id is required"}, 400

    resume = None
    if (raw_resume := data.get("resume")) is not None:
        try:
            payload = WorkflowPageResumePayload.model_validate(raw_resume)
        except ValidationError:
            return {"msg": "invalid resume"}, 400
        resume = WorkflowPageResume(payload.page_id.hex, payload.sequence)

    try:
        with sio.app.app_context(), session_factory.create_session() as session:
            result = collaboration_service.authorize_and_join_workflow_room(
                workflow_id, sid, session=session, resume=resume
            )
    except BillingUpstreamError:
        logging.exception("Failed to check collaboration entitlement (workflow_id=%s)", workflow_id)
        return {"msg": "collaboration_unavailable"}, 503
    except WorkflowCollaborationNotEntitledError:
        return {"msg": "not_entitled"}, 403
    if not result:
        return {"msg": "unauthorized"}, 401

    user_id, is_leader = result
    return {"msg": "connected", "user_id": user_id, "sid": sid, "isLeader": is_leader}


@_sio_on("get_online_user_avatars")
def handle_get_online_user_avatars(sid: str, _data: object = None) -> dict[str, str]:
    """Return avatar URLs to the requesting socket using its server-side room membership."""
    with sio.app.app_context():
        return collaboration_service.get_online_user_avatars(sid, avatar_service=application_services().accounts.avatar)


@observe_workflow_event("disconnect", sio)
def _handle_disconnect(sid):
    """Remove the session from online users and observe the result."""
    collaboration_service.disconnect_session(sid)


@_sio_on("disconnect")
def handle_disconnect(sid):
    """Let Socket.IO discard its reason before starting observable cleanup.

    A cleanup TypeError must propagate without Socket.IO retrying the cleanup.
    """
    _handle_disconnect(sid)


@_sio_on("collaboration_event")
@observe_workflow_event("collaboration_event", sio)
def handle_collaboration_event(sid, data):
    """
    Handle general collaboration events, include:
    1. mouse_move
    2. vars_and_features_update
    3. sync_request (ask leader to update graph)
    4. workflow_update
    5. comments_update
    6. node_panel_presence
    7. graph_view_state (session reports tab visibility; drives leader election)
    """
    return collaboration_service.relay_collaboration_event(sid, data)


@_sio_on("graph_event")
@observe_workflow_event("graph_event", sio)
def handle_graph_event(sid, data):
    """
    Handle graph events - simple broadcast relay.
    """
    return collaboration_service.relay_graph_event(sid, data)
