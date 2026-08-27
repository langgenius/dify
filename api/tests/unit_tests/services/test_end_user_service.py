from collections.abc import Sequence
from typing import override

from models.enums import DEFAULT_END_USER_SESSION_ID, EndUserType
from services.app_scoped_end_user_service import AppScopedEndUserRepository, AppScopedEndUserService
from services.entities.app_scoped_end_user_entities import NewAppScopedEndUser, StoredAppScopedEndUser


class RecordingEndUserRepository(AppScopedEndUserRepository[str]):
    def __init__(
        self,
        *,
        session_candidates: Sequence[StoredAppScopedEndUser[str]] = (),
        app_candidates: Sequence[StoredAppScopedEndUser[str]] = (),
    ) -> None:
        self.session_candidates = list(session_candidates)
        self.app_candidates = list(app_candidates)
        self.find_session_calls: list[tuple[str, str, str]] = []
        self.find_apps_calls: list[tuple[str, list[str], str, str]] = []
        self.created: list[NewAppScopedEndUser] = []
        self.updated_types: list[tuple[str, str]] = []

    @override
    def find_by_session(
        self,
        *,
        tenant_id: str,
        app_id: str,
        user_id: str,
    ) -> Sequence[StoredAppScopedEndUser[str]]:
        self.find_session_calls.append((tenant_id, app_id, user_id))
        return self.session_candidates

    @override
    def find_by_apps(
        self,
        *,
        tenant_id: str,
        app_ids: Sequence[str],
        user_id: str,
        type: str,
    ) -> Sequence[StoredAppScopedEndUser[str]]:
        self.find_apps_calls.append((tenant_id, list(app_ids), user_id, type))
        return self.app_candidates

    @override
    def create(self, command: NewAppScopedEndUser) -> StoredAppScopedEndUser[str]:
        self.created.append(command)
        return StoredAppScopedEndUser(
            id=f"new-{command.app_id}",
            app_id=command.app_id,
            type=command.type,
            value="created",
        )

    @override
    def create_batch(
        self,
        commands: Sequence[NewAppScopedEndUser],
    ) -> Sequence[StoredAppScopedEndUser[str]]:
        self.created.extend(commands)
        return [
            StoredAppScopedEndUser(
                id=f"new-{command.app_id}",
                app_id=command.app_id,
                type=command.type,
                value=command.app_id,
            )
            for command in commands
        ]

    @override
    def update_type(self, end_user_id: str, type: str) -> StoredAppScopedEndUser[str]:
        self.updated_types.append((end_user_id, type))
        candidate = next(candidate for candidate in self.session_candidates if candidate.id == end_user_id)
        return StoredAppScopedEndUser(id=candidate.id, app_id=candidate.app_id, type=type, value=candidate.value)


def _stored(*, id: str, app_id: str = "app-1", type: EndUserType, value: str) -> StoredAppScopedEndUser[str]:
    return StoredAppScopedEndUser(id=id, app_id=app_id, type=type.value, value=value)


def _service(repository: RecordingEndUserRepository) -> AppScopedEndUserService[str]:
    return AppScopedEndUserService(end_users=repository)


def test_get_or_create_prioritizes_matching_type_in_service() -> None:
    repository = RecordingEndUserRepository(
        session_candidates=[
            _stored(id="legacy", type=EndUserType.BROWSER, value="legacy"),
            _stored(id="matching", type=EndUserType.OPENAPI, value="matching"),
        ]
    )

    result = _service(repository).get_or_create_end_user_by_type(
        EndUserType.OPENAPI,
        tenant_id="tenant-1",
        app_id="app-1",
        user_id="user-1",
    )

    assert result == "matching"
    assert repository.updated_types == []
    assert repository.created == []


def test_get_or_create_upgrades_legacy_type() -> None:
    repository = RecordingEndUserRepository(
        session_candidates=[_stored(id="legacy", type=EndUserType.BROWSER, value="legacy")]
    )

    result = _service(repository).get_or_create_end_user_by_type(
        EndUserType.SERVICE_API,
        tenant_id="tenant-1",
        app_id="app-1",
        user_id="user-1",
    )

    assert result == "legacy"
    assert repository.updated_types == [("legacy", EndUserType.SERVICE_API.value)]


def test_get_or_create_builds_anonymous_creation_command() -> None:
    repository = RecordingEndUserRepository()

    result = _service(repository).get_or_create_end_user(
        tenant_id="tenant-1",
        app_id="app-1",
    )

    assert result == "created"
    assert repository.find_session_calls == [("tenant-1", "app-1", DEFAULT_END_USER_SESSION_ID)]
    assert repository.created == [
        NewAppScopedEndUser(
            tenant_id="tenant-1",
            app_id="app-1",
            type=EndUserType.SERVICE_API.value,
            is_anonymous=True,
            session_id=DEFAULT_END_USER_SESSION_ID,
            external_user_id=DEFAULT_END_USER_SESSION_ID,
        )
    ]


def test_create_batch_deduplicates_apps_and_creates_only_missing_users() -> None:
    repository = RecordingEndUserRepository(
        app_candidates=[_stored(id="existing", app_id="app-1", type=EndUserType.TRIGGER, value="existing")]
    )

    result = _service(repository).create_end_user_batch(
        EndUserType.TRIGGER,
        tenant_id="tenant-1",
        app_ids=["app-1", "app-2", "app-1"],
        user_id="user-1",
    )

    assert result == {"app-1": "existing", "app-2": "app-2"}
    assert repository.find_apps_calls == [("tenant-1", ["app-1", "app-2"], "user-1", EndUserType.TRIGGER.value)]
    assert repository.created == [
        NewAppScopedEndUser(
            tenant_id="tenant-1",
            app_id="app-2",
            type=EndUserType.TRIGGER.value,
            is_anonymous=False,
            session_id="user-1",
            external_user_id="user-1",
        )
    ]
