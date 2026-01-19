import logging
from collections.abc import Callable
from typing import cast

from flask import Request as FlaskRequest

from extensions.ext_socketio import sio
from libs.passport import PassportService
from libs.token import extract_access_token
from repositories.workflow_collaboration_repository import WorkflowCollaborationRepository
from services.account_service import AccountService
from services.workflow_collaboration_service import WorkflowCollaborationService

repository = WorkflowCollaborationRepository()
collaboration_service = WorkflowCollaborationService(repository, sio)


def _sio_on(event: str) -> Callable[[Callable[..., object]], Callable[..., object]]:
    return cast(Callable[[Callable[..., object]], Callable[..., object]], sio.on(event))


@_sio_on("connect")
def socket_connect(sid, environ, auth):
    """
    WebSocket connect event, do authentication here.
    """
    token = None
    if auth and isinstance(auth, dict):
        token = auth.get("token")

    if not token:
        try:
            request_environ = FlaskRequest(environ)
            token = extract_access_token(request_environ)
        except Exception:
            logging.exception("Failed to extract token")
            token = None

    if not token:
        return False

    try:
        decoded = PassportService().verify(token)
        user_id = decoded.get("user_id")
        if not user_id:
            return False

        with sio.app.app_context():
            user = AccountService.load_logged_in_account(account_id=user_id)
            if not user:
                return False

            collaboration_service.save_session(sid, user)
            return True

    except Exception:
        logging.exception("Socket authentication failed")
        return False


@_sio_on("user_connect")
def handle_user_connect(sid, data):
    """
    Handle user connect event. Each session (tab) is treated as an independent collaborator.
    """
    workflow_id = data.get("workflow_id")
    if not workflow_id:
        return {"msg": "workflow_id is required"}, 400

    result = collaboration_service.register_session(workflow_id, sid)
    if not result:
        return {"msg": "unauthorized"}, 401

    user_id, is_leader = result
    return {"msg": "connected", "user_id": user_id, "sid": sid, "isLeader": is_leader}


@_sio_on("disconnect")
def handle_disconnect(sid):
    """
    Handle session disconnect event. Remove the specific session from online users.
    """
    collaboration_service.disconnect_session(sid)


@_sio_on("collaboration_event")
def handle_collaboration_event(sid, data):
    """
    Handle general collaboration events, include:
    1. mouse_move
    2. vars_and_features_update
    3. sync_request (ask leader to update graph)
    4. app_state_update
    5. mcp_server_update
    6. workflow_update
    7. comments_update
    8. node_panel_presence
    """
    return collaboration_service.relay_collaboration_event(sid, data)


@_sio_on("graph_event")
def handle_graph_event(sid, data):
    """
    Handle graph events - simple broadcast relay.
    """
    return collaboration_service.relay_graph_event(sid, data)
