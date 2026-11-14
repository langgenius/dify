import logging
from collections.abc import Callable
from typing import cast

from flask import Request as FlaskRequest
from pydantic import BaseModel, Field

from configs import dify_config
from core.db.session_factory import session_factory
from events.app_event import app_draft_loro_epoch_was_replaced
from extensions.ext_application_services import application_services
from extensions.ext_socketio import sio
from extensions.otel.workflow_collaboration import observe_workflow_event
from libs.passport import PassportService
from libs.token import extract_access_token
from repositories.workflow_collaboration_repository import WorkflowCollaborationRepository
from services.errors.app import WorkflowNotFoundError
from services.errors.billing import BillingUpstreamError
from services.workflow_collaboration_service import WorkflowCollaborationNotEntitledError, WorkflowCollaborationService
from services.workflow_loro_document import LoroDraftEmptyGraphError, LoroDraftEpochChangedError
from services.workflow_service import WorkflowService

repository = WorkflowCollaborationRepository()
collaboration_service = WorkflowCollaborationService(repository, sio)


class LoroDraftSyncPayload(BaseModel):
    epoch: str = Field(min_length=36, max_length=36)
    version: bytes | None = Field(default=None, strict=True, max_length=1024 * 1024)
    update: bytes | None = Field(default=None, strict=True, max_length=dify_config.WEBSOCKET_MAX_HTTP_BUFFER_SIZE)
    allow_empty: bool = Field(default=False, strict=True)


def _sio_on(event: str) -> Callable[[Callable[..., object]], Callable[..., object]]:
    return cast(Callable[[Callable[..., object]], Callable[..., object]], sio.on(event))


@app_draft_loro_epoch_was_replaced.connect
def notify_draft_replacement(app_id: str, *, epoch: str) -> None:
    """Ask all editors to reconcile after the replacement transaction has committed."""
    try:
        sio.emit("loro_draft_changed", {"epoch": epoch}, room=app_id)
    except Exception:
        logging.exception("Failed to notify collaborators about replaced Loro draft %s", app_id)


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
def handle_user_connect(sid, data):
    """
    Handle user connect event. Each session (tab) is treated as an independent collaborator.
    """
    workflow_id = data.get("workflow_id")
    if not workflow_id:
        return {"msg": "workflow_id is required"}, 400

    try:
        with sio.app.app_context(), session_factory.create_session() as session:
            result = collaboration_service.authorize_and_join_workflow_room(workflow_id, sid, session=session)
    except BillingUpstreamError:
        logging.exception("Failed to check collaboration entitlement (workflow_id=%s)", workflow_id)
        return {"msg": "collaboration_unavailable"}, 503
    except WorkflowCollaborationNotEntitledError:
        return {"msg": "not_entitled"}, 403
    if not result:
        return {"msg": "unauthorized"}, 401

    user_id, is_leader = result
    return {"msg": "connected", "user_id": user_id, "sid": sid, "isLeader": is_leader}


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


@_sio_on("loro_draft_sync")
@observe_workflow_event("loro_draft_sync", sio)
def handle_loro_draft_sync(sid: str, data: object) -> tuple[dict[str, object], int]:
    """Confirm only versions that were applied and committed; notify peers to pull their delta."""
    try:
        payload = LoroDraftSyncPayload.model_validate(data)
        with sio.app.app_context(), session_factory.create_session() as session:
            admitted = collaboration_service.authorize_loro_draft_sync(sid, session=session)
            if admitted is None:
                return {"msg": "unauthorized"}, 401
            app, account_id = admitted
            app_id = app.id
            result = WorkflowService().sync_loro_draft(
                app_model=app,
                account_id=account_id,
                epoch=payload.epoch,
                version=payload.version,
                update=payload.update,
                allow_empty=payload.allow_empty,
                session=session,
            )
    except LoroDraftEpochChangedError:
        return {"msg": "epoch_changed"}, 409
    except WorkflowNotFoundError:
        return {"msg": "draft_workflow_not_exist"}, 404
    except LoroDraftEmptyGraphError:
        return {"msg": "empty_graph_confirmation_required"}, 409
    except ValueError:
        return {"msg": "invalid_loro_update"}, 400
    except WorkflowCollaborationNotEntitledError:
        return {"msg": "not_entitled"}, 403
    except BillingUpstreamError:
        return {"msg": "collaboration_unavailable"}, 503

    if result.changed:
        try:
            sio.emit("loro_draft_changed", {"epoch": result.epoch}, room=app_id, skip_sid=sid)
        except Exception:
            logging.exception("Failed to notify collaborators about committed Loro draft %s", app_id)
    return {
        "epoch": result.epoch,
        "version": result.version,
        "update": result.update,
        "hash": result.hash,
        "updatedAt": result.updated_at,
    }, 200
