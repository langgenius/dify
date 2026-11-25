from collections.abc import Iterator
from unittest.mock import MagicMock, Mock, patch
from uuid import uuid4

import pytest
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker

from core.rbac import RBACPermission, RBACResourceScope
from enums import CloudPlan, DeploymentEdition
from extensions.ext_redis import RedisClientWrapper
from graphon.file import helpers as file_helpers
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.base import TypeBase
from models.model import App, AppMode
from repositories.account.repository import SQLAlchemyAccountRepository
from repositories.workflow_collaboration_repository import WorkflowCollaborationRepository
from services.account_avatar_service import AccountAvatarService
from services.workflow_collaboration_service import (
    WorkflowCollaborationForbiddenError,
    WorkflowCollaborationNotEntitledError,
    WorkflowCollaborationService,
)
from tests.helpers.unit.config_override import config_overrides_context
from tests.helpers.unit.model_factories import make_account, make_app, make_upload_file
from tests.helpers.unit.services.workflow_collaboration_fixtures import RedisState, seed_session, seed_sessions

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

    TypeBase.metadata.create_all(sqlite_engine, tables=[App.__table__, TenantAccountJoin.__table__])
    with Session(sqlite_engine, expire_on_commit=False) as session:
        session.add(TenantAccountJoin(tenant_id="t-1", account_id="u-1", role=TenantAccountRole.EDITOR))
        session.commit()
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
    @pytest.mark.parametrize(
        ("edition", "plan", "enabled", "allowed"),
        [
            (DeploymentEdition.CLOUD, CloudPlan.SANDBOX, True, False),
            (DeploymentEdition.CLOUD, CloudPlan.PROFESSIONAL, True, True),
            (DeploymentEdition.CLOUD, CloudPlan.TEAM, True, True),
            (DeploymentEdition.COMMUNITY, CloudPlan.SANDBOX, True, True),
            (DeploymentEdition.ENTERPRISE, CloudPlan.SANDBOX, True, True),
            (DeploymentEdition.CLOUD, CloudPlan.TEAM, False, False),
            (DeploymentEdition.COMMUNITY, CloudPlan.SANDBOX, False, False),
        ],
    )
    def test_join_respects_workspace_entitlement(
        self,
        real_service: ServiceFixture,
        db_session: Session,
        edition: DeploymentEdition,
        plan: CloudPlan,
        enabled: bool,
        allowed: bool,
    ) -> None:
        service, repository, socketio = real_service
        socketio.get_session.return_value = {"user_id": "u-1", "tenant_id": "t-1"}
        db_session.add(_app(app_id="wf-1", tenant_id="t-1"))
        db_session.commit()

        with (
            config_overrides_context(DEPLOYMENT_EDITION=edition, ENABLE_COLLABORATION_MODE=enabled, RBAC_ENABLED=False),
            patch(
                "services.workflow_collaboration_service.FeatureService.get_workspace_plan", return_value=plan
            ) as get_plan,
        ):
            if allowed:
                result = service.authorize_and_join_workflow_room("wf-1", "sid-1", session=db_session)
                assert result is not None
            else:
                with pytest.raises(WorkflowCollaborationNotEntitledError):
                    service.authorize_and_join_workflow_room("wf-1", "sid-1", session=db_session)

        if edition == DeploymentEdition.CLOUD and enabled:
            get_plan.assert_called_once_with("t-1")
        else:
            get_plan.assert_not_called()
        assert bool(repository.list_sessions("wf-1")) is allowed
        assert socketio.enter_room.called is allowed
        assert socketio.start_background_task.called is allowed
        assert repository.server_heartbeat_exists("server-1") is allowed
        if not allowed:
            socketio.emit.assert_not_called()

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
            config_overrides_context(RBAC_ENABLED=True, DEPLOYMENT_EDITION=DeploymentEdition.CLOUD),
            patch(
                "services.workflow_collaboration_service.RBACService.CheckAccess.check", return_value=False
            ) as check_access,
            patch("services.workflow_collaboration_service.FeatureService.get_workspace_plan") as get_plan,
            patch.object(collaboration_service, "broadcast_online_users") as broadcast_online_users,
        ):
            with pytest.raises(WorkflowCollaborationForbiddenError):
                collaboration_service.authorize_and_join_workflow_room("wf-1", "sid-1", session=db_session)

        get_plan.assert_not_called()
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

        result = collaboration_service.relay_collaboration_event("sid-1", {"data": {"x": 1}})

        assert result == ({"msg": "invalid event type"}, 400)

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
            patch.object(collaboration_service, "broadcast_online_users") as broadcast_online_users,
        ):
            # Act
            collaboration_service.disconnect_session("sid-1")

        # Assert
        assert not repository.session_exists("wf-1", "sid-1")
        assert repository.get_sid_mapping("sid-1") is None
        broadcast_online_users.assert_called_once_with("wf-1")

        collaboration_service, repository, socketio = real_service
        seed_sessions(
            repository,
            [
                {"user_id": "u-1", "username": "A", "avatar": None, "sid": "sid-1", "connected_at": 3},
                {"user_id": "u-2", "username": "B", "avatar": None, "sid": "sid-2", "connected_at": 1},
            ],
        )

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
            },
            room="wf-1",
        )

    def test_online_user_avatars_use_current_profiles_for_active_room_sessions(
        self, real_service: ServiceFixture, sqlite_session_factory: sessionmaker[Session]
    ) -> None:
        service, repository, socketio = real_service
        stale_avatar_id, owner_avatar_id, assigned_later_avatar_id = (str(uuid4()) for _ in range(3))
        owner_id, assigned_later_id, other_id, outside_id = (str(uuid4()) for _ in range(4))
        with sqlite_session_factory.begin() as session:
            owner = make_account(account_id=owner_id, email="owner@example.com")
            owner.avatar = owner_avatar_id
            assigned_later = make_account(account_id=assigned_later_id, email="later@example.com")
            assigned_later.avatar = assigned_later_avatar_id
            other = make_account(account_id=other_id, email="other@example.com")
            other.avatar = stale_avatar_id
            outside = make_account(account_id=outside_id, email="outside@example.com")
            outside.avatar = "https://example.com/other-avatar.png"
            session.add_all(
                [
                    owner,
                    assigned_later,
                    other,
                    outside,
                    make_upload_file(
                        file_id=stale_avatar_id, created_by=owner_id, extension="png", mime_type="image/png"
                    ),
                    make_upload_file(
                        file_id=owner_avatar_id, created_by=owner_id, extension="png", mime_type="image/png"
                    ),
                    make_upload_file(
                        file_id=assigned_later_avatar_id,
                        created_by=assigned_later_id,
                        extension="png",
                        mime_type="image/png",
                    ),
                ]
            )
        avatar_service = AccountAvatarService(
            avatars=SQLAlchemyAccountRepository(session_factory=sqlite_session_factory),
            sign_file_url=file_helpers.get_signed_file_url,
            console_api_url="https://console.example.com",
        )
        seed_session(repository, "viewer")
        seed_sessions(
            repository,
            [
                {
                    "sid": "owner",
                    "user_id": owner_id,
                    "username": "Owner",
                    "avatar": stale_avatar_id,
                    "connected_at": 1,
                },
                {
                    "sid": "assigned-later",
                    "user_id": assigned_later_id,
                    "username": "Later",
                    "avatar": None,
                    "connected_at": 1,
                },
                {
                    "sid": "unowned",
                    "user_id": other_id,
                    "username": "Other",
                    "avatar": stale_avatar_id,
                    "connected_at": 1,
                },
                {"sid": "invalid", "user_id": "invalid", "username": "Invalid", "avatar": "invalid", "connected_at": 1},
                {
                    "sid": "offline",
                    "user_id": owner_id,
                    "username": "Owner",
                    "avatar": stale_avatar_id,
                    "connected_at": 1,
                },
            ],
        )
        repository.set_session_info(
            "other-room",
            {
                "sid": "outside",
                "user_id": outside_id,
                "username": "Outside",
                "avatar": None,
                "connected_at": 1,
            },
        )
        socketio.manager.is_connected.side_effect = lambda sid, _namespace: sid != "offline"

        assert service.get_online_user_avatars("unjoined", avatar_service=avatar_service) == {}
        assert service.get_online_user_avatars("outside", avatar_service=avatar_service) == {
            "outside": "https://example.com/other-avatar.png"
        }
        assert service.get_online_user_avatars("viewer", avatar_service=avatar_service) == {
            "owner": f"https://console.example.com/console/api/accounts/{owner_id}/avatars/{owner_avatar_id}",
            "assigned-later": (
                "https://console.example.com/console/api/accounts/"
                f"{assigned_later_id}/avatars/{assigned_later_avatar_id}"
            ),
        }

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
