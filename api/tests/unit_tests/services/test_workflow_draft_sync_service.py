import base64
import json
from datetime import datetime
from unittest.mock import MagicMock, Mock, patch

import pytest
from socketio.exceptions import TimeoutError as SocketIOTimeoutError
from sqlalchemy.orm import Session

from models.workflow import Workflow
from repositories.workflow_collaboration_repository import WorkflowCollaborationRepository
from repositories.workflow_draft_sync_repository import ServerDraftChange, WorkflowDraftSyncRepository
from services.workflow_collaboration_service import WorkflowCollaborationService
from services.workflow_draft_sync_service import WorkflowDraftSyncService, notify_workflow_draft_changed
from tests.unit_tests.config_override import config_overrides_context


@pytest.fixture
def workflow() -> Workflow:
    return Workflow(
        app_id="app-1",
        tenant_id="tenant-1",
        version=Workflow.VERSION_DRAFT,
        graph=json.dumps({"nodes": [{"id": "new"}], "edges": []}),
        features="{}",
        updated_at=datetime(2026, 9, 20, 12, 0, 0),
    )


@pytest.fixture
def setup(workflow: Workflow):
    repository = Mock(spec=WorkflowDraftSyncRepository)
    repository.announce.return_value = False
    repository.claim.return_value = True
    repository.accept.return_value = True
    change = ServerDraftChange(
        revision="revision-2",
        hash=workflow.unique_hash,
        updated_at=2,
        graph=workflow.graph_dict,
        previous_graph={"nodes": [{"id": "old"}], "edges": []},
    )
    repository.get.return_value = change
    collaboration_repository = Mock(spec=WorkflowCollaborationRepository)
    collaboration_repository.get_sid_mapping.return_value = {"workflow_id": "app-1", "user_id": "u-1"}
    collaboration_repository.get_current_leader.return_value = "leader"
    collaboration_repository.get_session_sids.return_value = ["follower", "leader"]
    collaboration = Mock(spec=WorkflowCollaborationService)
    collaboration.is_session_active.return_value = True
    socketio = Mock()
    socketio.get_session.return_value = {"tenant_id": "tenant-1"}
    socketio.call.return_value = {"revision": change.revision, "update": b"accepted-update"}
    session = MagicMock(spec=Session)
    session.scalar.return_value = workflow
    service = WorkflowDraftSyncService(repository, collaboration_repository, collaboration, socketio)
    return service, repository, collaboration_repository, socketio, session, change


def test_broadcasts_one_accepted_update_including_the_writer_and_replays_it_on_retry(setup):
    service, repository, _collaboration_repository, socketio, session, change = setup
    first, status = service.sync("follower", session=session)
    assert status == 200
    assert first["update"] == b"accepted-update"
    socketio.emit.assert_called_once_with("server_draft_update", first, room="app-1")
    assert socketio.call.call_args.kwargs["to"] == "leader"
    assert session.begin.return_value.__exit__.call_count == 1

    repository.get.return_value = change.model_copy(update={"update": base64.b64encode(b"accepted-update").decode()})
    second, status = service.sync("follower", session=session)
    assert status == 200
    assert second == first
    socketio.call.assert_called_once()
    repository.accept.assert_called_once()


def test_retries_another_ready_client_after_the_selected_writer_times_out(setup):
    service, _repository, _collaboration_repository, socketio, session, change = setup
    socketio.call.side_effect = [SocketIOTimeoutError(), {"revision": change.revision, "update": b"replacement"}]

    result, status = service.sync("follower", session=session)

    assert status == 200
    assert result["update"] == b"replacement"
    assert [call.kwargs["to"] for call in socketio.call.call_args_list] == ["leader", "follower"]
    socketio.emit.assert_called_once_with("server_draft_update", result, room="app-1")


def test_drops_a_proposal_when_its_lease_or_draft_version_was_superseded(setup):
    service, repository, _collaboration_repository, socketio, session, _change = setup
    repository.accept.return_value = False

    result, status = service.sync("follower", session=session)

    assert status == 409
    assert result["msg"] == "draft_sync_superseded"
    socketio.emit.assert_not_called()
    repository.release.assert_called_once()


def test_skips_unready_browsers_to_reach_a_ready_writer(setup):
    service, _repository, collaboration_repository, socketio, session, change = setup
    collaboration_repository.get_session_sids.return_value = ["leader", "reconnecting", "ready"]
    socketio.call.side_effect = [
        {"error": "graph_not_ready"},
        {"error": "graph_not_ready"},
        {"revision": change.revision, "update": b"ready-update"},
    ]

    result, status = service.sync("ready", session=session)

    assert status == 200
    assert result["update"] == b"ready-update"
    assert [call.kwargs["to"] for call in socketio.call.call_args_list] == ["leader", "reconnecting", "ready"]


def test_does_not_choose_another_writer_while_a_request_is_in_flight(setup):
    service, repository, _collaboration_repository, socketio, session, _change = setup
    repository.claim.return_value = False

    assert service.sync("follower", session=session)[1] == 202

    socketio.call.assert_not_called()
    repository.accept.assert_not_called()


def test_rejects_unjoined_clients_and_scopes_draft_reads_to_the_socket_tenant(setup):
    service, _repository, collaboration_repository, socketio, session, _change = setup
    collaboration_repository.get_sid_mapping.return_value = None
    assert service.sync("unjoined", session=session)[1] == 401
    session.scalar.assert_not_called()
    socketio.get_session.assert_not_called()

    collaboration_repository.get_sid_mapping.return_value = {"workflow_id": "app-1", "user_id": "u-1"}
    session.scalar.return_value = None
    assert service.sync("follower", session=session)[1] == 404
    statement = session.scalar.call_args.args[0]
    assert set(statement.compile().params.values()) == {"app-1", "tenant-1", "draft"}
    socketio.call.assert_not_called()


def test_notification_carries_a_version_and_preserves_the_patch_baseline(workflow: Workflow):
    before = {"nodes": [], "edges": []}
    with (
        config_overrides_context(ENABLE_COLLABORATION_MODE=True),
        patch("services.workflow_draft_sync_service.WorkflowCollaborationRepository") as collaborators,
        patch("services.workflow_draft_sync_service.WorkflowDraftSyncRepository") as repository,
        patch("services.workflow_draft_sync_service.sio") as socketio,
    ):
        collaborators.return_value.get_session_sids.return_value = ["leader"]
        repository.return_value.announce.return_value = True
        notify_workflow_draft_changed(workflow, previous_graph=before)

    app_id, change = repository.return_value.announce.call_args.args
    assert app_id == "app-1"
    assert change.previous_graph == before
    assert change.graph == workflow.graph_dict
    assert change.hash == workflow.unique_hash
    socketio.emit.assert_called_once_with("server_draft_changed", {"revision": change.revision}, room="app-1")


def test_notification_failure_does_not_turn_a_committed_write_into_a_failure(workflow: Workflow):
    with (
        config_overrides_context(ENABLE_COLLABORATION_MODE=True),
        patch("services.workflow_draft_sync_service.WorkflowCollaborationRepository") as collaborators,
        patch("services.workflow_draft_sync_service.WorkflowDraftSyncRepository") as repository,
        patch("services.workflow_draft_sync_service.logger") as logger,
    ):
        collaborators.return_value.get_session_sids.return_value = ["leader"]
        repository.return_value.announce.side_effect = RuntimeError("redis unavailable")
        notify_workflow_draft_changed(workflow)
    logger.exception.assert_called_once()


def test_disabled_collaboration_does_not_access_redis_or_emit_notifications(workflow: Workflow):
    with (
        config_overrides_context(ENABLE_COLLABORATION_MODE=False),
        patch("services.workflow_draft_sync_service.WorkflowCollaborationRepository") as collaborators,
        patch("services.workflow_draft_sync_service.WorkflowDraftSyncRepository") as repository,
        patch("services.workflow_draft_sync_service.sio") as socketio,
    ):
        notify_workflow_draft_changed(workflow, previous_graph={"nodes": [], "edges": []})

    collaborators.assert_not_called()
    repository.assert_not_called()
    socketio.emit.assert_not_called()
