import logging
from collections.abc import Iterator
from contextlib import contextmanager
from unittest.mock import MagicMock, Mock, patch

import pytest
from socketio.exceptions import TimeoutError as SocketIOTimeoutError
from sqlalchemy import Engine
from sqlalchemy.orm import Session

from core.rbac import RBACPermission, RBACResourceScope
from extensions.ext_redis import RedisClientWrapper
from models.account import Account, Tenant
from models.base import TypeBase
from models.model import App, AppMode
from repositories.workflow.collaboration_repository import WorkflowCollaborationRepository
from services.workflow_collaboration_service import SYNC_REQUEST_TIMEOUT_SECONDS, WorkflowCollaborationService
from tests.unit_tests.config_override import config_overrides_context
from tests.unit_tests.model_factories import make_app
from tests.unit_tests.services.workflow_collaboration_fixtures import RedisState, seed_session, seed_sessions

ServiceFixture = tuple[WorkflowCollaborationService, WorkflowCollaborationRepository, Mock]


@pytest.fixture
def collaboration_redis(
    redis_transport: tuple[RedisClientWrapper, MagicMock], monkeypatch: pytest.MonkeyPatch
) -> RedisClientWrapper:
    client, commands = redis_transport
    commands.side_effect = RedisState().execute
    monkeypatch.setattr("repositories.workflow_collaboration_repository.redis_client", client)
    return client


@pytest.fixture
def real_service(collaboration_redis: RedisClientWrapper) -> ServiceFixture:
    assert collaboration_redis._require_client() is not None
    repository = WorkflowCollaborationRepository()
    socketio = Mock()
    return WorkflowCollaborationService(repository, socketio, server_id="server-1"), repository, socketio


@pytest.fixture
def db_session(sqlite_engine: Engine) -> Iterator[Session]:
    """Provide a real session for tenant-scoped workflow app access checks."""

    TypeBase.metadata.create_all(sqlite_engine, tables=[App.__table__])
    with Session(sqlite_engine, expire_on_commit=False) as session:
        yield session


def _app(*, app_id: str, tenant_id: str, maintainer: str | None = None) -> App:
    return make_app(
        app_id=app_id,
        tenant_id=tenant_id,
        name="Workflow app",
        mode=AppMode.WORKFLOW,
        icon_background="#ffffff",
        enable_site=False,
        enable_api=False,
        maintainer=maintainer,
    )


class TestWorkflowCollaborationService:
    def test_authorize_and_join_workflow_room_returns_leader_status(
        self, real_service: ServiceFixture, db_session: Session
    ) -> None:
        # Arrange
        collaboration_service, repository, socketio = real_service
        socketio.get_session.return_value = {
            "user_id": "u-1",
            "username": "Jane",
            "avatar": None,
            "tenant_id": "t-1",
        }
        db_session.add(_app(app_id="wf-1", tenant_id="t-1", maintainer="owner-1"))
        db_session.commit()

        with (
            config_overrides_context(RBAC_ENABLED=True),
            patch(
                "services.workflow_collaboration_service.RBACService.CheckAccess.check", return_value=True
            ) as check_access,
            patch.object(collaboration_service, "get_or_set_leader", return_value="sid-1") as get_leader,
            patch.object(collaboration_service, "broadcast_online_users") as broadcast_online_users,
        ):
            # Act
            result = collaboration_service.authorize_and_join_workflow_room("wf-1", "sid-1", session=db_session)

        # Assert
        assert result == ("u-1", True)
        check_access.assert_called_once_with(
            "t-1",
            "u-1",
            scene=RBACPermission.APP_EDIT,
            resource_type=RBACResourceScope.APP,
            resource_id="wf-1",
        )
        session_info = repository.get_session_info("wf-1", "sid-1")
        assert session_info is not None
        assert session_info["server_id"] == "server-1"
        assert repository.server_heartbeat_exists("server-1")
        socketio.start_background_task.assert_called_once()
        get_leader.assert_called_once_with("wf-1", "sid-1")
        socketio.enter_room.assert_called_once_with("sid-1", "wf-1")
        broadcast_online_users.assert_called_once_with("wf-1")
        socketio.emit.assert_called_once_with("status", {"isLeader": True}, room="sid-1")

    def test_authorize_and_join_workflow_room_returns_none_when_missing_user(
        self, real_service: ServiceFixture, db_session: Session
    ) -> None:
        # Arrange
        collaboration_service, _repository, socketio = real_service
        socketio.get_session.return_value = {}

        # Act
        result = collaboration_service.authorize_and_join_workflow_room("wf-1", "sid-1", session=db_session)

        # Assert
        assert result is None

    def test_authorize_and_join_workflow_room_returns_none_when_missing_tenant(
        self, real_service: ServiceFixture, db_session: Session
    ) -> None:
        collaboration_service, repository, socketio = real_service
        socketio.get_session.return_value = {"user_id": "u-1", "username": "Jane", "avatar": None}

        result = collaboration_service.authorize_and_join_workflow_room("wf-1", "sid-1", session=db_session)

        assert result is None
        assert repository.list_sessions("wf-1") == []
        socketio.enter_room.assert_not_called()
        socketio.emit.assert_not_called()

    def test_authorize_and_join_workflow_room_returns_none_when_workflow_is_not_accessible(
        self, real_service: ServiceFixture, db_session: Session
    ) -> None:
        collaboration_service, repository, socketio = real_service
        socketio.get_session.return_value = {
            "user_id": "u-1",
            "username": "Jane",
            "avatar": None,
            "tenant_id": "t-1",
        }
        db_session.add(_app(app_id="wf-1", tenant_id="t-1", maintainer="owner-1"))
        db_session.commit()

        with (
            config_overrides_context(RBAC_ENABLED=True),
            patch(
                "services.workflow_collaboration_service.RBACService.CheckAccess.check", return_value=False
            ) as check_access,
            patch.object(collaboration_service, "get_or_set_leader") as get_leader,
            patch.object(collaboration_service, "broadcast_online_users") as broadcast_online_users,
        ):
            result = collaboration_service.authorize_and_join_workflow_room("wf-1", "sid-1", session=db_session)

        assert result is None
        check_access.assert_called_once_with(
            "t-1",
            "u-1",
            scene=RBACPermission.APP_EDIT,
            resource_type=RBACResourceScope.APP,
            resource_id="wf-1",
        )
        assert not repository.server_heartbeat_exists("server-1")
        assert repository.list_sessions("wf-1") == []
        socketio.start_background_task.assert_not_called()
        get_leader.assert_not_called()
        socketio.enter_room.assert_not_called()
        broadcast_online_users.assert_not_called()
        socketio.emit.assert_not_called()

    def test_repr_and_save_socket_identity(self, real_service: ServiceFixture) -> None:
        collaboration_service, _repository, socketio = real_service
        user = Account(name="Jane", email="jane@example.com")
        user.id = "u-1"
        user.avatar = "avatar.png"
        tenant = Tenant(name="Tenant")
        tenant.id = "t-1"
        user._current_tenant = tenant

        assert "WorkflowCollaborationService" in repr(collaboration_service)

        collaboration_service.save_socket_identity("sid-1", user)

        socketio.save_session.assert_called_once_with(
            "sid-1",
            {"user_id": "u-1", "username": "Jane", "avatar": "avatar.png", "tenant_id": "t-1"},
        )

    def test_can_access_workflow_uses_session(self, real_service: ServiceFixture, db_session: Session) -> None:
        collaboration_service, _repository, _socketio = real_service
        db_session.add_all(
            [
                _app(app_id="wf-1", tenant_id="tenant-1"),
                _app(app_id="wf-other", tenant_id="tenant-other"),
            ]
        )
        db_session.commit()

        with config_overrides_context(RBAC_ENABLED=False):
            result = collaboration_service._can_access_workflow("wf-1", "tenant-1", "user-1", session=db_session)

            assert result is True
            assert (
                collaboration_service._can_access_workflow("wf-1", "tenant-other", "user-1", session=db_session)
                is False
            )
            assert (
                collaboration_service._can_access_workflow("wf-other", "tenant-other", "user-1", session=db_session)
                is True
            )

    def test_can_access_workflow_allows_maintainer_without_rbac_call(
        self, real_service: ServiceFixture, db_session: Session
    ) -> None:
        collaboration_service, _repository, _socketio = real_service
        db_session.add(_app(app_id="wf-1", tenant_id="tenant-1", maintainer="owner-1"))
        db_session.commit()

        with (
            config_overrides_context(RBAC_ENABLED=True),
            patch("services.workflow_collaboration_service.RBACService.CheckAccess.check") as check_access,
        ):
            result = collaboration_service._can_access_workflow("wf-1", "tenant-1", "owner-1", session=db_session)

        assert result is True
        check_access.assert_not_called()

    def test_relay_collaboration_event_unauthorized(self, real_service: ServiceFixture) -> None:
        # Arrange
        collaboration_service, repository, _socketio = real_service
        assert repository.get_sid_mapping("sid-1") is None

        # Act
        result = collaboration_service.relay_collaboration_event("sid-1", {})

        # Assert
        assert result == ({"msg": "unauthorized"}, 401)

    def test_relay_collaboration_event_emits_update(self, real_service: ServiceFixture) -> None:
        # Arrange
        collaboration_service, repository, socketio = real_service
        seed_session(repository, "sid-1")
        repository.set_leader("wf-1", "sid-1")
        payload = {"type": "mouse_move", "data": {"x": 1}, "timestamp": 123}

        # Act
        result = collaboration_service.relay_collaboration_event("sid-1", payload)

        # Assert
        assert result == ({"msg": "event_broadcasted"}, 200)
        socketio.emit.assert_called_once_with(
            "collaboration_update",
            {"type": "mouse_move", "userId": "u-1", "data": {"x": 1}, "timestamp": 123},
            room="wf-1",
            skip_sid="sid-1",
        )

    def test_relay_collaboration_event_requires_event_type(self, real_service: ServiceFixture) -> None:
        collaboration_service, repository, _socketio = real_service
        seed_session(repository, "sid-1")
        repository.set_leader("wf-1", "sid-1")

        result = collaboration_service.relay_collaboration_event("sid-1", {"data": {"x": 1}})

        assert result == ({"msg": "invalid event type"}, 400)

    def test_relay_collaboration_event_graph_resync_request_forwards_to_active_leader(
        self, real_service: ServiceFixture
    ) -> None:
        collaboration_service, repository, socketio = real_service
        seed_session(repository, "sid-1")
        repository.set_leader("wf-1", "sid-leader")
        payload = {"type": "graph_resync_request", "data": {"reason": "reconnect"}, "timestamp": 123}

        with (
            patch.object(collaboration_service, "refresh_session_state"),
            patch.object(collaboration_service, "is_session_active", return_value=True),
        ):
            result = collaboration_service.relay_collaboration_event("sid-1", payload)

        assert result == ({"msg": "graph_resync_request_forwarded"}, 200)
        socketio.emit.assert_called_once_with(
            "collaboration_update",
            {
                "type": "graph_resync_request",
                "userId": "u-1",
                "data": {"reason": "reconnect"},
                "timestamp": 123,
            },
            to="sid-leader",
        )
        assert repository.get_current_leader("wf-1") == "sid-leader"

    def test_relay_collaboration_event_graph_resync_request_reelects_when_leader_is_inactive(
        self, real_service: ServiceFixture
    ) -> None:
        collaboration_service, repository, socketio = real_service
        seed_session(repository, "sid-1")
        repository.set_leader("wf-1", "sid-old")
        payload = {"type": "graph_resync_request", "data": None, "timestamp": 123}

        with (
            patch.object(collaboration_service, "refresh_session_state"),
            patch.object(collaboration_service, "is_session_active", return_value=False),
            patch.object(collaboration_service, "_select_graph_leader", return_value="sid-1") as select_leader,
            patch.object(collaboration_service, "broadcast_leader_change") as broadcast_leader_change,
        ):
            result = collaboration_service.relay_collaboration_event("sid-1", payload)

        assert result == ({"msg": "graph_resync_request_forwarded"}, 200)
        select_leader.assert_called_once_with("wf-1", preferred_sid="sid-1")
        assert repository.get_current_leader("wf-1") == "sid-1"
        broadcast_leader_change.assert_called_once_with("wf-1", "sid-1")
        socketio.emit.assert_called_once_with(
            "collaboration_update",
            {"type": "graph_resync_request", "userId": "u-1", "data": None, "timestamp": 123},
            to="sid-1",
        )

    def test_relay_collaboration_event_graph_resync_request_returns_503_without_active_leader(
        self, real_service: ServiceFixture
    ) -> None:
        collaboration_service, repository, socketio = real_service
        seed_session(repository, "sid-1")
        repository.set_leader("wf-1", "sid-old")
        payload = {"type": "graph_resync_request", "data": None, "timestamp": 123}

        with (
            patch.object(collaboration_service, "refresh_session_state"),
            patch.object(collaboration_service, "is_session_active", return_value=False),
            patch.object(collaboration_service, "_select_graph_leader", return_value=None),
        ):
            result = collaboration_service.relay_collaboration_event("sid-1", payload)

        assert result == ({"msg": "no_active_leader"}, 503)
        assert repository.get_current_leader("wf-1") is None
        socketio.emit.assert_not_called()

    @pytest.mark.parametrize(
        ("graph_active", "sequence"),
        [
            ("false", 1),
            (0, 1),
            (None, 1),
            (False, True),
            (False, -1),
            (False, "1"),
            (False, None),
        ],
    )
    def test_relay_collaboration_event_rejects_invalid_graph_view_state(
        self,
        real_service: ServiceFixture,
        graph_active: object,
        sequence: object,
    ) -> None:
        collaboration_service, repository, _socketio = real_service
        seed_session(repository, "sid-1")
        payload = {
            "type": "graph_view_state",
            "data": {"graphActive": graph_active, "sequence": sequence},
            "timestamp": 123,
        }

        with patch.object(collaboration_service, "refresh_session_state"):
            result = collaboration_service.relay_collaboration_event("sid-1", payload)

        assert result == ({"msg": "invalid graph_view_state"}, 400)
        session_info = repository.get_session_info("wf-1", "sid-1")
        assert session_info is not None
        assert "graph_active" not in session_info

    def test_relay_collaboration_event_requires_sync_request_id(self, real_service: ServiceFixture) -> None:
        collaboration_service, repository, socketio = real_service
        seed_session(repository, "sid-1")

        with patch.object(collaboration_service, "refresh_session_state"):
            result = collaboration_service.relay_collaboration_event(
                "sid-1", {"type": "sync_request", "data": {"requestId": " "}, "timestamp": 123}
            )

        assert result == ({"msg": "invalid sync_request"}, 400)
        socketio.call.assert_not_called()

    def test_relay_collaboration_event_sync_request_forwards_to_active_leader(
        self, real_service: ServiceFixture
    ) -> None:
        collaboration_service, repository, socketio = real_service
        seed_session(repository, "sid-1")
        repository.set_leader("wf-1", "sid-leader")
        repository.set_session_info(
            "wf-1",
            {
                "user_id": "u-2",
                "username": "B",
                "avatar": None,
                "sid": "sid-leader",
                "connected_at": 1,
                "graph_active": True,
            },
        )
        socketio.call.return_value = {"success": True, "hash": "hash-2", "updatedAt": 456}
        payload = {
            "type": "sync_request",
            "data": {"reason": "join", "requestId": "req-1"},
            "timestamp": 123,
        }

        with (
            patch.object(collaboration_service, "refresh_session_state"),
            patch.object(collaboration_service, "is_session_active", return_value=True),
        ):
            result = collaboration_service.relay_collaboration_event("sid-1", payload)

        assert result == (
            {
                "msg": "workflow_synced",
                "requestId": "req-1",
                "success": True,
                "hash": "hash-2",
                "updatedAt": 456,
            },
            200,
        )
        socketio.call.assert_called_once_with(
            "collaboration_update",
            {
                "type": "sync_request",
                "userId": "u-1",
                "data": {"reason": "join", "requestId": "req-1"},
                "timestamp": 123,
            },
            to="sid-leader",
            timeout=SYNC_REQUEST_TIMEOUT_SECONDS,
        )
        assert repository.get_current_leader("wf-1") == "sid-leader"

    def test_relay_collaboration_event_sync_request_returns_target_failure(self, real_service: ServiceFixture) -> None:
        collaboration_service, repository, socketio = real_service
        seed_session(repository, "sid-1")
        repository.set_leader("wf-1", "sid-leader")
        repository.set_session_info(
            "wf-1",
            {
                "user_id": "u-2",
                "username": "B",
                "avatar": None,
                "sid": "sid-leader",
                "connected_at": 1,
                "graph_active": True,
            },
        )
        socketio.call.return_value = {"success": False, "error": "draft_workflow_not_sync"}
        payload = {"type": "sync_request", "data": {"requestId": "req-1"}, "timestamp": 123}

        with (
            patch.object(collaboration_service, "refresh_session_state"),
            patch.object(collaboration_service, "is_session_active", return_value=True),
        ):
            result = collaboration_service.relay_collaboration_event("sid-1", payload)

        assert result == (
            {
                "msg": "workflow_sync_failed",
                "requestId": "req-1",
                "success": False,
                "error": "draft_workflow_not_sync",
            },
            502,
        )

    def test_relay_collaboration_event_sync_request_returns_timeout(self, real_service: ServiceFixture) -> None:
        collaboration_service, repository, socketio = real_service
        seed_session(repository, "sid-1")
        repository.set_leader("wf-1", "sid-leader")
        repository.set_session_info(
            "wf-1",
            {
                "user_id": "u-2",
                "username": "B",
                "avatar": None,
                "sid": "sid-leader",
                "connected_at": 1,
                "graph_active": True,
            },
        )
        socketio.call.side_effect = SocketIOTimeoutError()
        payload = {"type": "sync_request", "data": {"requestId": "req-1"}, "timestamp": 123}

        with (
            patch.object(collaboration_service, "refresh_session_state"),
            patch.object(collaboration_service, "is_session_active", return_value=True),
        ):
            result = collaboration_service.relay_collaboration_event("sid-1", payload)

        assert result == ({"msg": "sync_request_timeout", "requestId": "req-1"}, 504)

    @pytest.mark.parametrize(
        "target_result",
        [
            None,
            {"success": "true", "hash": "hash-2", "updatedAt": 456},
            {"success": True, "hash": "", "updatedAt": 456},
            {"success": True, "hash": "hash-2", "updatedAt": True},
        ],
    )
    def test_relay_collaboration_event_sync_request_rejects_invalid_target_response(
        self, real_service: ServiceFixture, target_result: object
    ) -> None:
        collaboration_service, repository, socketio = real_service
        seed_session(repository, "sid-1")
        repository.set_leader("wf-1", "sid-leader")
        repository.set_session_info(
            "wf-1",
            {
                "user_id": "u-2",
                "username": "B",
                "avatar": None,
                "sid": "sid-leader",
                "connected_at": 1,
                "graph_active": True,
            },
        )
        socketio.call.return_value = target_result
        payload = {"type": "sync_request", "data": {"requestId": "req-1"}, "timestamp": 123}

        with (
            patch.object(collaboration_service, "refresh_session_state"),
            patch.object(collaboration_service, "is_session_active", return_value=True),
        ):
            result = collaboration_service.relay_collaboration_event("sid-1", payload)

        assert result[1] == 502

    def test_relay_collaboration_event_sync_request_reroutes_from_hidden_leader(
        self, real_service: ServiceFixture
    ) -> None:
        # Leader is connected but its tab is hidden; the visible requester takes over.
        collaboration_service, repository, socketio = real_service
        seed_session(repository, "sid-1")
        repository.set_leader("wf-1", "sid-leader")
        repository.set_session_info(
            "wf-1",
            {
                "user_id": "u-2",
                "username": "B",
                "avatar": None,
                "sid": "sid-leader",
                "connected_at": 1,
                "graph_active": False,
            },
        )
        seed_sessions(
            repository,
            [
                {
                    "user_id": "u-2",
                    "username": "B",
                    "avatar": None,
                    "sid": "sid-leader",
                    "connected_at": 1,
                    "graph_active": False,
                },
                {
                    "user_id": "u-1",
                    "username": "A",
                    "avatar": None,
                    "sid": "sid-1",
                    "connected_at": 2,
                    "graph_active": True,
                },
            ],
        )
        socketio.call.return_value = {"success": True, "hash": "hash-2", "updatedAt": 456}
        payload = {
            "type": "sync_request",
            "data": {"reason": "edit", "requestId": "req-1"},
            "timestamp": 123,
        }

        with (
            patch.object(collaboration_service, "refresh_session_state"),
            patch.object(collaboration_service, "broadcast_leader_change") as broadcast_leader_change,
            patch.object(collaboration_service, "is_session_active", return_value=True),
        ):
            result = collaboration_service.relay_collaboration_event("sid-1", payload)

        assert result[1] == 200
        assert result[0]["success"] is True
        assert repository.get_current_leader("wf-1") == "sid-1"
        broadcast_leader_change.assert_called_once_with("wf-1", "sid-1")
        socketio.call.assert_called_once_with(
            "collaboration_update",
            {
                "type": "sync_request",
                "userId": "u-1",
                "data": {"reason": "edit", "requestId": "req-1"},
                "timestamp": 123,
            },
            to="sid-1",
            timeout=SYNC_REQUEST_TIMEOUT_SECONDS,
        )

    def test_relay_collaboration_event_sync_request_all_hidden_falls_back_to_requester(
        self, real_service: ServiceFixture
    ) -> None:
        # Every tab hidden: the requester still becomes leader so the save is not dropped.
        collaboration_service, repository, socketio = real_service
        seed_session(repository, "sid-1")
        repository.set_leader("wf-1", "sid-leader")
        repository.set_session_info(
            "wf-1",
            {
                "user_id": "u-2",
                "username": "B",
                "avatar": None,
                "sid": "sid-leader",
                "connected_at": 1,
                "graph_active": False,
            },
        )
        seed_sessions(
            repository,
            [
                {
                    "user_id": "u-2",
                    "username": "B",
                    "avatar": None,
                    "sid": "sid-leader",
                    "connected_at": 1,
                    "graph_active": False,
                },
                {
                    "user_id": "u-1",
                    "username": "A",
                    "avatar": None,
                    "sid": "sid-1",
                    "connected_at": 2,
                    "graph_active": False,
                },
            ],
        )
        socketio.call.return_value = {"success": True, "hash": "hash-2", "updatedAt": 456}
        payload = {
            "type": "sync_request",
            "data": {"reason": "edit", "requestId": "req-1"},
            "timestamp": 123,
        }

        with (
            patch.object(collaboration_service, "refresh_session_state"),
            patch.object(collaboration_service, "broadcast_leader_change") as broadcast_leader_change,
            patch.object(collaboration_service, "is_session_active", return_value=True),
        ):
            result = collaboration_service.relay_collaboration_event("sid-1", payload)

        assert result[1] == 200
        assert result[0]["success"] is True
        assert repository.get_current_leader("wf-1") == "sid-1"
        broadcast_leader_change.assert_called_once_with("wf-1", "sid-1")
        socketio.call.assert_called_once_with(
            "collaboration_update",
            {
                "type": "sync_request",
                "userId": "u-1",
                "data": {"reason": "edit", "requestId": "req-1"},
                "timestamp": 123,
            },
            to="sid-1",
            timeout=SYNC_REQUEST_TIMEOUT_SECONDS,
        )

    def test_relay_collaboration_event_graph_view_state_updates_without_broadcast(
        self, real_service: ServiceFixture
    ) -> None:
        collaboration_service, repository, socketio = real_service
        seed_session(repository, "sid-1")
        repository.set_leader("wf-1", "sid-other")
        payload = {
            "type": "graph_view_state",
            "data": {"graphActive": False, "sequence": 3},
            "timestamp": 123,
        }

        with patch.object(collaboration_service, "refresh_session_state"):
            result = collaboration_service.relay_collaboration_event("sid-1", payload)

        assert result == ({"msg": "graph_view_state_updated"}, 200)
        session_info = repository.get_session_info("wf-1", "sid-1")
        assert session_info is not None
        assert session_info["graph_active"] is False
        socketio.emit.assert_not_called()
        assert repository.get_current_leader("wf-1") == "sid-other"

    def test_graph_view_state_serializes_visibility_write_with_leader_demotion(
        self, real_service: ServiceFixture
    ) -> None:
        collaboration_service, repository, _socketio = real_service
        seed_session(repository, "sid-1")
        events: list[str] = []

        @contextmanager
        def graph_view_lock() -> Iterator[None]:
            events.append("lock_enter")
            yield
            events.append("lock_exit")

        update_visibility = repository.update_session_graph_active

        def record_visibility(workflow_id: str, sid: str, active: bool, sequence: int) -> bool:
            events.append("visibility_write")
            return update_visibility(workflow_id, sid, active, sequence)

        payload = {
            "type": "graph_view_state",
            "data": {"graphActive": False, "sequence": 4},
            "timestamp": 123,
        }

        with (
            patch.object(repository, "graph_view_state_lock", return_value=graph_view_lock()),
            patch.object(repository, "update_session_graph_active", side_effect=record_visibility),
            patch.object(collaboration_service, "refresh_session_state"),
            patch.object(
                collaboration_service,
                "_demote_leader_if_hidden",
                side_effect=lambda *_args: events.append("leader_demotion"),
            ),
        ):
            result = collaboration_service.relay_collaboration_event("sid-1", payload)

        assert result == ({"msg": "graph_view_state_updated"}, 200)
        assert events == ["lock_enter", "visibility_write", "leader_demotion", "lock_exit"]

    def test_relay_collaboration_event_graph_view_state_ignores_stale_update_without_demotion(
        self, real_service: ServiceFixture
    ) -> None:
        collaboration_service, repository, _socketio = real_service
        seed_session(repository, "sid-1")
        assert repository.update_session_graph_active("wf-1", "sid-1", True, 3)
        payload = {
            "type": "graph_view_state",
            "data": {"graphActive": False, "sequence": 2},
            "timestamp": 123,
        }

        with (
            patch.object(collaboration_service, "refresh_session_state"),
            patch.object(collaboration_service, "_demote_leader_if_hidden") as demote_leader,
        ):
            result = collaboration_service.relay_collaboration_event("sid-1", payload)

        assert result == ({"msg": "graph_view_state_ignored"}, 200)
        session_info = repository.get_session_info("wf-1", "sid-1")
        assert session_info is not None
        assert session_info["graph_active"] is True
        demote_leader.assert_not_called()

    def test_relay_collaboration_event_graph_view_state_demotes_hidden_leader(
        self, real_service: ServiceFixture
    ) -> None:
        collaboration_service, repository, _socketio = real_service
        seed_session(repository, "sid-1")
        repository.set_leader("wf-1", "sid-1")
        seed_sessions(
            repository,
            [
                {
                    "user_id": "u-1",
                    "username": "A",
                    "avatar": None,
                    "sid": "sid-1",
                    "connected_at": 1,
                    "graph_active": False,
                },
                {
                    "user_id": "u-2",
                    "username": "B",
                    "avatar": None,
                    "sid": "sid-2",
                    "connected_at": 2,
                    "graph_active": True,
                },
            ],
        )
        payload = {
            "type": "graph_view_state",
            "data": {"graphActive": False, "sequence": 3},
            "timestamp": 123,
        }

        with (
            patch.object(collaboration_service, "refresh_session_state"),
            patch.object(collaboration_service, "broadcast_leader_change") as broadcast_leader_change,
            patch.object(collaboration_service, "is_session_active", return_value=True),
        ):
            result = collaboration_service.relay_collaboration_event("sid-1", payload)

        assert result == ({"msg": "graph_view_state_updated"}, 200)
        session_info = repository.get_session_info("wf-1", "sid-1")
        assert session_info is not None
        assert session_info["graph_active"] is False
        assert repository.get_current_leader("wf-1") == "sid-2"
        broadcast_leader_change.assert_called_once_with("wf-1", "sid-2")

    def test_relay_collaboration_event_graph_view_state_keeps_leader_when_all_hidden(
        self, real_service: ServiceFixture
    ) -> None:
        collaboration_service, repository, _socketio = real_service
        seed_session(repository, "sid-1")
        repository.set_leader("wf-1", "sid-1")
        seed_sessions(
            repository,
            [
                {
                    "user_id": "u-1",
                    "username": "A",
                    "avatar": None,
                    "sid": "sid-1",
                    "connected_at": 1,
                    "graph_active": False,
                },
            ],
        )
        payload = {
            "type": "graph_view_state",
            "data": {"graphActive": False, "sequence": 3},
            "timestamp": 123,
        }

        with (
            patch.object(collaboration_service, "refresh_session_state"),
            patch.object(collaboration_service, "broadcast_leader_change") as broadcast_leader_change,
            patch.object(collaboration_service, "is_session_active", return_value=True),
        ):
            result = collaboration_service.relay_collaboration_event("sid-1", payload)

        assert result == ({"msg": "graph_view_state_updated"}, 200)
        assert repository.get_current_leader("wf-1") == "sid-1"
        broadcast_leader_change.assert_not_called()

    def test_relay_collaboration_event_graph_view_state_non_leader_no_demotion(
        self, real_service: ServiceFixture
    ) -> None:
        collaboration_service, repository, _socketio = real_service
        seed_session(repository, "sid-1")
        repository.set_leader("wf-1", "sid-leader")
        payload = {
            "type": "graph_view_state",
            "data": {"graphActive": False, "sequence": 3},
            "timestamp": 123,
        }

        with (
            patch.object(collaboration_service, "refresh_session_state"),
            patch.object(collaboration_service, "broadcast_leader_change") as broadcast_leader_change,
        ):
            result = collaboration_service.relay_collaboration_event("sid-1", payload)

        assert result == ({"msg": "graph_view_state_updated"}, 200)
        session_info = repository.get_session_info("wf-1", "sid-1")
        assert session_info is not None
        assert session_info["graph_active"] is False
        assert repository.get_current_leader("wf-1") == "sid-leader"
        broadcast_leader_change.assert_not_called()

    def test_relay_collaboration_event_sync_request_reelects_active_leader(self, real_service: ServiceFixture) -> None:
        collaboration_service, repository, socketio = real_service
        seed_session(repository, "sid-2")
        repository.set_leader("wf-1", "sid-old")
        seed_sessions(
            repository,
            [
                {
                    "user_id": "u-2",
                    "username": "B",
                    "avatar": None,
                    "sid": "sid-2",
                    "connected_at": 1,
                    "graph_active": True,
                },
                {
                    "user_id": "u-3",
                    "username": "C",
                    "avatar": None,
                    "sid": "sid-3",
                    "connected_at": 2,
                    "graph_active": True,
                },
            ],
        )
        socketio.call.return_value = {"success": True, "hash": "hash-2", "updatedAt": 456}
        payload = {
            "type": "sync_request",
            "data": {"reason": "join", "requestId": "req-1"},
            "timestamp": 123,
        }

        def _is_session_active(_workflow_id: str, session_sid: str) -> bool:
            return session_sid != "sid-old"

        with (
            patch.object(collaboration_service, "refresh_session_state"),
            patch.object(collaboration_service, "broadcast_leader_change") as broadcast_leader_change,
            patch.object(collaboration_service, "is_session_active", side_effect=_is_session_active),
        ):
            result = collaboration_service.relay_collaboration_event("sid-2", payload)

        assert result[1] == 200
        assert result[0]["success"] is True
        assert repository.get_current_leader("wf-1") == "sid-2"
        broadcast_leader_change.assert_called_once_with("wf-1", "sid-2")
        socketio.call.assert_called_once_with(
            "collaboration_update",
            {
                "type": "sync_request",
                "userId": "u-2",
                "data": {"reason": "join", "requestId": "req-1"},
                "timestamp": 123,
            },
            to="sid-2",
            timeout=SYNC_REQUEST_TIMEOUT_SECONDS,
        )

    def test_relay_collaboration_event_sync_request_returns_when_no_active_leader(
        self, real_service: ServiceFixture
    ) -> None:
        collaboration_service, repository, socketio = real_service
        seed_session(repository, "sid-2")
        repository.set_leader("wf-1", "sid-old")
        seed_sessions(repository, [])
        payload = {
            "type": "sync_request",
            "data": {"reason": "join", "requestId": "req-1"},
            "timestamp": 123,
        }

        with (
            patch.object(collaboration_service, "refresh_session_state"),
            patch.object(collaboration_service, "is_session_active", return_value=False),
        ):
            result = collaboration_service.relay_collaboration_event("sid-2", payload)

        assert result == ({"msg": "no_active_leader", "requestId": "req-1"}, 503)
        assert repository.get_current_leader("wf-1") is None
        socketio.call.assert_not_called()

    def test_relay_graph_event_unauthorized(self, real_service: ServiceFixture) -> None:
        # Arrange
        collaboration_service, repository, _socketio = real_service
        assert repository.get_sid_mapping("sid-1") is None

        # Act
        result = collaboration_service.relay_graph_event("sid-1", {"nodes": []})

        # Assert
        assert result == ({"msg": "unauthorized"}, 401)

    def test_disconnect_session_no_mapping(self, real_service: ServiceFixture) -> None:
        # Arrange
        collaboration_service, repository, _socketio = real_service
        assert repository.get_sid_mapping("sid-1") is None

        # Act
        collaboration_service.disconnect_session("sid-1")

        # Assert
        assert repository.list_sessions("wf-1") == []

    def test_disconnect_session_cleans_up(self, real_service: ServiceFixture) -> None:
        # Arrange
        collaboration_service, repository, _socketio = real_service
        seed_session(repository, "sid-1")

        with (
            patch.object(collaboration_service, "handle_leader_disconnect") as handle_leader_disconnect,
            patch.object(collaboration_service, "broadcast_online_users") as broadcast_online_users,
        ):
            # Act
            collaboration_service.disconnect_session("sid-1")

        # Assert
        assert not repository.session_exists("wf-1", "sid-1")
        assert repository.get_sid_mapping("sid-1") is None
        handle_leader_disconnect.assert_called_once_with("wf-1", "sid-1")
        broadcast_online_users.assert_called_once_with("wf-1")

    def test_get_or_set_leader_returns_active_leader(self, real_service: ServiceFixture) -> None:
        # Arrange
        collaboration_service, repository, _socketio = real_service
        repository.set_leader("wf-1", "sid-1")

        with patch.object(collaboration_service, "is_session_active", return_value=True):
            # Act
            result = collaboration_service.get_or_set_leader("wf-1", "sid-2")

        # Assert
        assert result == "sid-1"
        assert repository.get_current_leader("wf-1") == "sid-1"

    def test_get_or_set_leader_replaces_dead_leader(self, real_service: ServiceFixture) -> None:
        # Arrange
        collaboration_service, repository, _socketio = real_service
        repository.set_leader("wf-1", "sid-1")
        seed_sessions(
            repository,
            [
                {
                    "user_id": "u-2",
                    "username": "B",
                    "avatar": None,
                    "sid": "sid-2",
                    "connected_at": 1,
                    "graph_active": True,
                }
            ],
        )

        with (
            patch.object(collaboration_service, "is_session_active", side_effect=lambda _wf, sid: sid != "sid-1"),
            patch.object(collaboration_service, "broadcast_leader_change") as broadcast_leader_change,
        ):
            # Act
            result = collaboration_service.get_or_set_leader("wf-1", "sid-2")

        # Assert
        assert result == "sid-2"
        assert not repository.session_exists("wf-1", "sid-1")
        broadcast_leader_change.assert_called_once_with("wf-1", "sid-2")

        assert repository.get_current_leader("wf-1") == "sid-2"

    def test_get_or_set_leader_falls_back_to_existing(self, real_service: ServiceFixture) -> None:
        # Arrange
        collaboration_service, repository, _socketio = real_service
        set_if_absent = repository.set_leader_if_absent

        def competing_leader(workflow_id: str, sid: str) -> bool:
            repository.set_leader(workflow_id, "sid-3")
            return set_if_absent(workflow_id, sid)

        seed_sessions(
            repository,
            [
                {
                    "user_id": "u-2",
                    "username": "B",
                    "avatar": None,
                    "sid": "sid-2",
                    "connected_at": 1,
                    "graph_active": True,
                }
            ],
        )

        # Act
        with patch.object(repository, "set_leader_if_absent", side_effect=competing_leader):
            result = collaboration_service.get_or_set_leader("wf-1", "sid-2")

        # Assert
        assert result == "sid-3"

    def test_get_or_set_leader_returns_sid_when_leader_still_missing(self, real_service: ServiceFixture) -> None:
        collaboration_service, repository, _socketio = real_service
        set_if_absent = repository.set_leader_if_absent

        def disappearing_leader(workflow_id: str, sid: str) -> bool:
            repository.set_leader(workflow_id, "sid-3")
            acquired = set_if_absent(workflow_id, sid)
            repository.delete_leader(workflow_id)
            return acquired

        with patch.object(repository, "set_leader_if_absent", side_effect=disappearing_leader):
            result = collaboration_service.get_or_set_leader("wf-1", "sid-2")

        assert result == "sid-2"

    def test_handle_leader_disconnect_elects_new(self, real_service: ServiceFixture) -> None:
        # Arrange
        collaboration_service, repository, _socketio = real_service
        repository.set_leader("wf-1", "sid-1")
        seed_sessions(
            repository,
            [
                {
                    "user_id": "u-2",
                    "username": "B",
                    "avatar": None,
                    "sid": "sid-2",
                    "connected_at": 1,
                    "graph_active": True,
                }
            ],
        )

        with (
            patch.object(collaboration_service, "is_session_active", return_value=True),
            patch.object(collaboration_service, "broadcast_leader_change") as broadcast_leader_change,
        ):
            # Act
            collaboration_service.handle_leader_disconnect("wf-1", "sid-1")

        # Assert
        assert repository.get_current_leader("wf-1") == "sid-2"
        broadcast_leader_change.assert_called_once_with("wf-1", "sid-2")

    def test_handle_leader_disconnect_clears_when_empty(self, real_service: ServiceFixture) -> None:
        # Arrange
        collaboration_service, repository, _socketio = real_service
        repository.set_leader("wf-1", "sid-1")
        seed_sessions(repository, [])

        # Act
        collaboration_service.handle_leader_disconnect("wf-1", "sid-1")

        # Assert

        assert repository.get_current_leader("wf-1") is None

    def test_handle_leader_disconnect_ignores_non_leader_or_missing_leader(self, real_service: ServiceFixture) -> None:
        collaboration_service, repository, _socketio = real_service

        assert repository.get_current_leader("wf-1") is None
        collaboration_service.handle_leader_disconnect("wf-1", "sid-1")

        repository.set_leader("wf-1", "sid-leader")
        collaboration_service.handle_leader_disconnect("wf-1", "sid-other")

        assert repository.get_current_leader("wf-1") == "sid-leader"

    def test_broadcast_leader_change_logs_emit_errors(
        self,
        real_service: ServiceFixture,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        collaboration_service, repository, socketio = real_service
        seed_session(repository, "sid-1")
        seed_session(repository, "sid-2")
        socketio.emit.side_effect = [RuntimeError("boom"), None]

        with caplog.at_level(logging.ERROR):
            collaboration_service.broadcast_leader_change("wf-1", "sid-2")

        error_records = [record for record in caplog.records if record.levelno == logging.ERROR]
        assert len(error_records) == 1
        assert "Failed to emit leader status to session sid-1" in error_records[0].getMessage()

    def test_broadcast_online_users_sorts_and_emits(self, real_service: ServiceFixture) -> None:
        # Arrange
        collaboration_service, repository, socketio = real_service
        seed_sessions(
            repository,
            [
                {"user_id": "u-1", "username": "A", "avatar": None, "sid": "sid-1", "connected_at": 3},
                {"user_id": "u-2", "username": "B", "avatar": None, "sid": "sid-2", "connected_at": 1},
            ],
        )
        repository.set_leader("wf-1", "sid-1")

        with patch.object(collaboration_service, "is_session_active", return_value=True):
            # Act
            collaboration_service.broadcast_online_users("wf-1")

        # Assert
        socketio.emit.assert_called_once_with(
            "online_users",
            {
                "workflow_id": "wf-1",
                "users": [
                    {"user_id": "u-2", "username": "B", "avatar": None, "sid": "sid-2", "connected_at": 1},
                    {"user_id": "u-1", "username": "A", "avatar": None, "sid": "sid-1", "connected_at": 3},
                ],
                "leader": "sid-1",
            },
            room="wf-1",
        )

    def test_broadcast_online_users_reassigns_missing_leader(self, real_service: ServiceFixture) -> None:
        collaboration_service, repository, socketio = real_service
        users = [{"user_id": "u-2", "username": "B", "avatar": None, "sid": "sid-2", "connected_at": 1}]
        repository.set_leader("wf-1", "sid-old")

        with (
            patch.object(collaboration_service, "_prune_inactive_sessions", return_value=users),
            patch.object(collaboration_service, "_select_graph_leader", return_value="sid-2"),
            patch.object(collaboration_service, "broadcast_leader_change") as broadcast_leader_change,
        ):
            collaboration_service.broadcast_online_users("wf-1")

        assert repository.get_current_leader("wf-1") == "sid-2"
        broadcast_leader_change.assert_called_once_with("wf-1", "sid-2")
        socketio.emit.assert_called_once_with(
            "online_users",
            {"workflow_id": "wf-1", "users": users, "leader": "sid-2"},
            room="wf-1",
        )

    def test_refresh_session_state_expires_active_leader(
        self, real_service: ServiceFixture, collaboration_redis: RedisClientWrapper
    ) -> None:
        # Arrange
        collaboration_service, repository, _socketio = real_service
        seed_session(repository, "sid-1")
        repository.set_leader("wf-1", "sid-1")
        collaboration_redis.expire(repository.leader_key("wf-1"), 1)

        with patch.object(collaboration_service, "is_session_active", return_value=True):
            # Act
            collaboration_service.refresh_session_state("wf-1", "sid-1")

        # Assert
        assert repository.server_heartbeat_exists("server-1")
        assert collaboration_redis.ttl(repository.leader_key("wf-1")) == 3600
        assert repository.get_current_leader("wf-1") == "sid-1"

    def test_refresh_session_state_sets_leader_when_missing(self, real_service: ServiceFixture) -> None:
        # Arrange
        collaboration_service, repository, _socketio = real_service
        assert repository.get_current_leader("wf-1") is None
        seed_sessions(
            repository,
            [
                {
                    "user_id": "u-2",
                    "username": "B",
                    "avatar": None,
                    "sid": "sid-2",
                    "connected_at": 1,
                    "graph_active": True,
                }
            ],
        )

        with (
            patch.object(collaboration_service, "is_session_active", return_value=True),
            patch.object(collaboration_service, "broadcast_leader_change") as broadcast_leader_change,
        ):
            # Act
            collaboration_service.refresh_session_state("wf-1", "sid-2")

        # Assert
        assert repository.get_current_leader("wf-1") == "sid-2"
        broadcast_leader_change.assert_called_once_with("wf-1", "sid-2")

    def test_refresh_session_state_replaces_inactive_existing_leader(self, real_service: ServiceFixture) -> None:
        collaboration_service, repository, _socketio = real_service
        repository.set_leader("wf-1", "sid-old")

        with (
            patch.object(collaboration_service, "is_session_active", return_value=False),
            patch.object(collaboration_service, "broadcast_leader_change") as broadcast_leader_change,
        ):
            collaboration_service.refresh_session_state("wf-1", "sid-new")

        assert repository.get_current_leader("wf-1") == "sid-new"
        broadcast_leader_change.assert_called_once_with("wf-1", "sid-new")

    def test_relay_graph_event_emits_update(self, real_service: ServiceFixture) -> None:
        # Arrange
        collaboration_service, repository, socketio = real_service
        seed_session(repository, "sid-1")
        repository.set_leader("wf-1", "sid-1")

        # Act
        result = collaboration_service.relay_graph_event("sid-1", {"nodes": []})

        # Assert
        assert result == ({"msg": "graph_update_broadcasted"}, 200)
        assert repository.server_heartbeat_exists("server-1")
        socketio.emit.assert_called_once_with("graph_update", {"nodes": []}, room="wf-1", skip_sid="sid-1")

    def test_prune_inactive_sessions_handles_empty_and_removes_stale(self, real_service: ServiceFixture) -> None:
        collaboration_service, repository, _socketio = real_service
        seed_sessions(repository, [])
        assert collaboration_service._prune_inactive_sessions("wf-1") == []

        active = {"sid": "sid-1", "user_id": "u-1", "username": "A", "avatar": None, "connected_at": 1}
        stale = {"sid": "sid-2", "user_id": "u-2", "username": "B", "avatar": None, "connected_at": 2}
        seed_sessions(repository, [active, stale])

        with patch.object(
            collaboration_service,
            "is_session_active",
            side_effect=lambda _workflow_id, sid: sid == "sid-1",
        ):
            users = collaboration_service._prune_inactive_sessions("wf-1")

        assert users == [active]
        assert not repository.session_exists("wf-1", "sid-2")

    def test_is_session_active_guard_branches(
        self, real_service: ServiceFixture, collaboration_redis: RedisClientWrapper
    ) -> None:
        collaboration_service, repository, socketio = real_service
        info = {
            "sid": "sid-1",
            "user_id": "u-1",
            "username": "A",
            "avatar": None,
            "connected_at": 1,
            "server_id": "server-1",
        }
        repository.set_session_info("wf-1", info)
        assert collaboration_service.is_session_active("wf-1", "") is False
        socketio.manager.is_connected.return_value = False
        assert collaboration_service.is_session_active("wf-1", "sid-1") is False
        socketio.manager.is_connected.return_value = True
        assert collaboration_service.is_session_active("wf-1", "sid-1") is True
        socketio.manager.is_connected.side_effect = AttributeError("missing manager")
        assert collaboration_service.is_session_active("wf-1", "sid-1") is False
        socketio.manager.is_connected.side_effect = None

        collaboration_redis.hdel(repository.workflow_key("wf-1"), "sid-1")
        assert collaboration_service.is_session_active("wf-1", "sid-1") is False
        repository.set_session_info("wf-1", info)
        collaboration_redis.delete(repository.sid_key("sid-1"))
        assert collaboration_service.is_session_active("wf-1", "sid-1") is False

    def test_is_session_active_accepts_remote_session_with_live_server(self, real_service: ServiceFixture) -> None:
        collaboration_service, repository, socketio = real_service
        repository.set_session_info(
            "wf-1",
            {
                "sid": "sid-remote",
                "user_id": "u-1",
                "username": "A",
                "avatar": None,
                "connected_at": 1,
                "server_id": "server-2",
            },
        )
        repository.refresh_server_heartbeat("server-2")
        socketio.manager.is_connected.return_value = False
        assert collaboration_service.is_session_active("wf-1", "sid-remote") is True

    def test_is_session_active_rejects_remote_session_with_dead_server(self, real_service: ServiceFixture) -> None:
        collaboration_service, repository, socketio = real_service
        repository.set_session_info(
            "wf-1",
            {
                "sid": "sid-remote",
                "user_id": "u-1",
                "username": "A",
                "avatar": None,
                "connected_at": 1,
                "server_id": "server-2",
            },
        )
        socketio.manager.is_connected.return_value = False
        assert collaboration_service.is_session_active("wf-1", "sid-remote") is False

    @staticmethod
    def _session(sid: str, connected_at: int, graph_active: bool) -> dict:
        return {
            "user_id": f"u-{sid}",
            "username": sid,
            "avatar": None,
            "sid": sid,
            "connected_at": connected_at,
            "graph_active": graph_active,
        }

    def test_select_graph_leader_prefers_visible_preferred(self, real_service: ServiceFixture) -> None:
        collaboration_service, repository, _socketio = real_service
        seed_sessions(
            repository,
            [
                self._session("sid-1", 1, graph_active=True),
                self._session("sid-2", 2, graph_active=True),
            ],
        )

        with patch.object(collaboration_service, "is_session_active", return_value=True):
            result = collaboration_service._select_graph_leader("wf-1", preferred_sid="sid-2")

        assert result == "sid-2"

    def test_select_graph_leader_visible_beats_hidden_preferred(self, real_service: ServiceFixture) -> None:
        collaboration_service, repository, _socketio = real_service
        seed_sessions(
            repository,
            [
                self._session("sid-1", 1, graph_active=False),
                self._session("sid-2", 2, graph_active=True),
            ],
        )

        with patch.object(collaboration_service, "is_session_active", return_value=True):
            result = collaboration_service._select_graph_leader("wf-1", preferred_sid="sid-1")

        assert result == "sid-2"

    def test_select_graph_leader_all_hidden_falls_back_to_preferred(self, real_service: ServiceFixture) -> None:
        collaboration_service, repository, _socketio = real_service
        seed_sessions(
            repository,
            [
                self._session("sid-1", 1, graph_active=False),
                self._session("sid-2", 2, graph_active=False),
            ],
        )

        with patch.object(collaboration_service, "is_session_active", return_value=True):
            result = collaboration_service._select_graph_leader("wf-1", preferred_sid="sid-2")

        assert result == "sid-2"

    def test_select_graph_leader_all_hidden_without_preference_picks_first(self, real_service: ServiceFixture) -> None:
        collaboration_service, repository, _socketio = real_service
        seed_sessions(
            repository,
            [
                self._session("sid-1", 1, graph_active=False),
                self._session("sid-2", 2, graph_active=False),
            ],
        )

        with patch.object(collaboration_service, "is_session_active", return_value=True):
            result = collaboration_service._select_graph_leader("wf-1")

        assert result == "sid-1"

    def test_select_graph_leader_require_graph_active_returns_none_when_all_hidden(
        self, real_service: ServiceFixture
    ) -> None:
        collaboration_service, repository, _socketio = real_service
        seed_sessions(
            repository,
            [
                self._session("sid-1", 1, graph_active=False),
            ],
        )

        with patch.object(collaboration_service, "is_session_active", return_value=True):
            result = collaboration_service._select_graph_leader("wf-1", require_graph_active=True)

        assert result is None

    def test_select_graph_leader_no_sessions_returns_none(self, real_service: ServiceFixture) -> None:
        collaboration_service, repository, _socketio = real_service
        seed_sessions(repository, [])

        with patch.object(collaboration_service, "is_session_active", return_value=True):
            result = collaboration_service._select_graph_leader("wf-1")

        assert result is None

    def test_handle_leader_disconnect_elects_hidden_session_when_no_visible_remains(
        self, real_service: ServiceFixture
    ) -> None:
        collaboration_service, repository, _socketio = real_service
        repository.set_leader("wf-1", "sid-old")
        seed_sessions(
            repository,
            [
                self._session("sid-2", 2, graph_active=False),
            ],
        )

        with (
            patch.object(collaboration_service, "is_session_active", return_value=True),
            patch.object(collaboration_service, "broadcast_leader_change") as broadcast_leader_change,
        ):
            collaboration_service.handle_leader_disconnect("wf-1", "sid-old")

        assert repository.get_current_leader("wf-1") == "sid-2"
        broadcast_leader_change.assert_called_once_with("wf-1", "sid-2")
