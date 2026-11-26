"""Select one browser to translate a committed draft change into CRDT operations."""

import base64
import logging
import time
import uuid
from datetime import UTC

from pydantic import BaseModel, ValidationError
from socketio import Server  # type: ignore[reportMissingTypeStubs]
from socketio.exceptions import TimeoutError as SocketIOTimeoutError  # type: ignore[reportMissingTypeStubs]
from sqlalchemy import select
from sqlalchemy.orm import Session

from configs import dify_config
from extensions.ext_socketio import sio
from models.workflow import Workflow
from repositories.workflow_collaboration_repository import WorkflowCollaborationRepository
from repositories.workflow_draft_sync_repository import ServerDraftChange, WorkflowDraftSyncRepository
from services.workflow_collaboration_service import WorkflowCollaborationService

logger = logging.getLogger(__name__)
DRAFT_PROPOSAL_TIMEOUT_SECONDS = 5


class DraftGraphProposal(BaseModel):
    revision: str
    update: bytes


def _change_from_workflow(workflow: Workflow, previous_graph: dict[str, object] | None = None) -> ServerDraftChange:
    updated_at = workflow.updated_at.replace(tzinfo=UTC)
    return ServerDraftChange(
        revision=f"{updated_at.isoformat(timespec='microseconds')}:{workflow.unique_hash}",
        hash=workflow.unique_hash,
        updated_at=int(updated_at.timestamp()),
        graph=dict(workflow.graph_dict),
        previous_graph=previous_graph,
    )


def notify_workflow_draft_changed(workflow: Workflow, *, previous_graph: dict[str, object] | None = None) -> None:
    """Call after commit; a notification failure must not undo a successful write.

    An explicit canvas refresh also requests the latest committed draft, allowing
    the browser to recover when this notification or its delivery fails.
    """
    if not dify_config.ENABLE_COLLABORATION_MODE:
        return
    try:
        if not WorkflowCollaborationRepository().get_session_sids(workflow.app_id):
            return
        change = _change_from_workflow(workflow, previous_graph)
        if WorkflowDraftSyncRepository().announce(workflow.app_id, change):
            sio.emit(
                "server_draft_changed",
                {"revision": change.revision},
                room=workflow.app_id,
            )
    except Exception:
        logger.exception("Failed to notify collaborators about draft change: app_id=%s", workflow.app_id)


class WorkflowDraftSyncService:
    def __init__(
        self,
        repository: WorkflowDraftSyncRepository,
        collaboration_repository: WorkflowCollaborationRepository,
        collaboration: WorkflowCollaborationService,
        socketio: Server,
    ) -> None:
        self._repository = repository
        self._collaboration_repository = collaboration_repository
        self._collaboration = collaboration
        self._socketio = socketio

    def sync(self, sid: str, *, session: Session) -> tuple[dict[str, object], int]:
        mapping = self._collaboration_repository.get_sid_mapping(sid)
        if not mapping:
            return {"msg": "unauthorized"}, 401
        identity = self._socketio.get_session(sid)
        if not identity.get("tenant_id"):
            return {"msg": "unauthorized"}, 401
        app_id = mapping["workflow_id"]
        # End the database transaction before waiting for a browser response.
        with session.begin():
            workflow = session.scalar(
                select(Workflow).where(
                    Workflow.app_id == app_id,
                    Workflow.tenant_id == identity["tenant_id"],
                    Workflow.version == Workflow.VERSION_DRAFT,
                )
            )
            if workflow is None:
                return {"msg": "draft_not_found"}, 404
            latest = _change_from_workflow(workflow)

        if self._repository.announce(app_id, latest):
            self._socketio.emit("server_draft_changed", {"revision": latest.revision}, room=app_id)
        change = self._repository.get(app_id)
        if change is None:
            return {"msg": "draft_sync_expired"}, 409
        if change.update is not None:
            return self._result(change), 200

        token = uuid.uuid4().hex
        if not self._repository.claim(app_id, token):
            return {"msg": "draft_sync_pending"}, 202
        try:
            leader = self._collaboration_repository.get_current_leader(app_id)
            candidates = self._collaboration_repository.get_session_sids(app_id)
            if leader in candidates:
                candidates.remove(leader)
                candidates.insert(0, leader)
            active = [candidate for candidate in candidates if self._collaboration.is_session_active(app_id, candidate)]
            # Keep retries inside the lease, but skip unready browsers without
            # preventing a later candidate from responding. A timed-out browser
            # has only edited a fork, so its late response is harmless.
            deadline = time.monotonic() + 2 * DRAFT_PROPOSAL_TIMEOUT_SECONDS
            for target in active:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    break
                try:
                    response = self._socketio.call(
                        "server_draft_request",
                        change.model_dump(exclude={"update"}),
                        to=target,
                        timeout=min(DRAFT_PROPOSAL_TIMEOUT_SECONDS, remaining),
                    )
                    proposal = DraftGraphProposal.model_validate(response, strict=True)
                except (SocketIOTimeoutError, ValidationError):
                    continue
                if proposal.revision != change.revision:
                    continue
                encoded_update = base64.b64encode(proposal.update).decode("ascii")
                if not self._repository.accept(app_id, token, change.revision, encoded_update):
                    return {"msg": "draft_sync_superseded"}, 409
                change.update = encoded_update
                result = self._result(change)
                self._socketio.emit("server_draft_update", result, room=app_id)
                return result, 200
            return {"msg": "no_ready_draft_writer"}, 503
        finally:
            self._repository.release(app_id, token)

    @staticmethod
    def _result(change: ServerDraftChange) -> dict[str, object]:
        assert change.update is not None
        return {
            "revision": change.revision,
            "hash": change.hash,
            "updated_at": change.updated_at,
            "update": base64.b64decode(change.update),
        }
