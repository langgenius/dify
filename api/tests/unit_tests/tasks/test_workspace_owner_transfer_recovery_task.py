import pytest

from tasks import workspace_owner_transfer_recovery_task as recovery_task


def test_recovery_task_composes_transfer_and_notification_recovery(monkeypatch: pytest.MonkeyPatch) -> None:
    session_maker = object()
    repository = object()
    notification_service = object()
    access = object()
    gateway = object()
    calls: list[tuple[str, object]] = []

    class RecoveryService:
        def recover(self) -> int:
            calls.append(("recover", self))
            return 1

    recovery_service = RecoveryService()

    def get_session_maker() -> object:
        calls.append(("session_maker", session_maker))
        return session_maker

    def repository_factory(*, session_factory: object) -> object:
        calls.append(("repository", session_factory))
        return repository

    def gateway_factory(*, redis: object) -> object:
        calls.append(("gateway", redis))
        return gateway

    def access_factory() -> object:
        calls.append(("access", access))
        return access

    def notification_service_factory(*, workspaces: object, gateway: object) -> object:
        calls.append(("notifications", (workspaces, gateway)))
        return notification_service

    def recovery_service_factory(*, workspaces: object, access: object, notifications: object) -> RecoveryService:
        calls.append(("recovery_service", (workspaces, access, notifications)))
        return recovery_service

    monkeypatch.setattr(recovery_task.session_factory, "get_session_maker", get_session_maker)
    monkeypatch.setattr(recovery_task, "WorkspaceRepository", repository_factory)
    monkeypatch.setattr(recovery_task, "WorkspaceOwnerTransferGateway", gateway_factory)
    monkeypatch.setattr(recovery_task, "DeploymentWorkspaceMemberAccessGateway", access_factory)
    monkeypatch.setattr(recovery_task, "WorkspaceOwnerTransferNotificationService", notification_service_factory)
    monkeypatch.setattr(recovery_task, "WorkspaceOwnerTransferRecoveryService", recovery_service_factory)

    recovery_task.recover_workspace_owner_transfer_operations.run()

    assert calls == [
        ("session_maker", session_maker),
        ("repository", session_maker),
        ("gateway", recovery_task.redis_client),
        ("notifications", (repository, gateway)),
        ("access", access),
        ("recovery_service", (repository, access, notification_service)),
        ("recover", recovery_service),
    ]
