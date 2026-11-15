"""Publishing rules of AppMCPServerService, isolated from persistence by an in-memory store."""

import datetime
from dataclasses import replace

import pytest

from machinery.context import RequestContext
from services.app.mcp_server_service import (
    AppMCPServerAlreadyExistsError,
    AppMCPServerAppNotFoundError,
    AppMCPServerDraft,
    AppMCPServerNotFoundError,
    AppMCPServerRecord,
    AppMCPServerService,
    AppMCPServerStatus,
    AppMCPServerStore,
    AppMCPServerUpdate,
    PublishedApp,
)

CONTEXT = RequestContext("request", None, "account", "workspace")
APP_ID = "app-1"
NOW = datetime.datetime(2024, 1, 1, tzinfo=datetime.UTC)


def _assert_scope(workspace_id: str, app_id: str) -> None:
    assert (workspace_id, app_id) == (CONTEXT.active_workspace_id, APP_ID)


class InMemoryStore(AppMCPServerStore):
    def __init__(self, app: PublishedApp | None) -> None:
        self.app = app
        self.server: AppMCPServerRecord | None = None
        self.writes: list[AppMCPServerDraft | AppMCPServerUpdate] = []

    def find_app(self, *, workspace_id: str, app_id: str) -> PublishedApp | None:
        _assert_scope(workspace_id, app_id)
        return self.app

    def find_server(self, *, workspace_id: str, app_id: str) -> AppMCPServerRecord | None:
        _assert_scope(workspace_id, app_id)
        return self.server

    def insert_server(self, *, workspace_id: str, app_id: str, draft: AppMCPServerDraft) -> AppMCPServerRecord:
        _assert_scope(workspace_id, app_id)
        self.writes.append(draft)
        self.server = AppMCPServerRecord(
            id="server-1",
            server_code="code-1",
            name=draft.name,
            description=draft.description,
            status=draft.status,
            parameters="{}",
            created_at=NOW,
            updated_at=NOW,
        )
        return self.server

    def update_server(
        self, *, workspace_id: str, app_id: str, server_id: str, update: AppMCPServerUpdate
    ) -> AppMCPServerRecord:
        _assert_scope(workspace_id, app_id)
        if self.server is None or server_id != self.server.id:
            raise AppMCPServerNotFoundError
        self.writes.append(update)
        self.server = replace(
            self.server,
            name=update.name,
            description=update.description,
            status=self.server.status if update.status is None else update.status,
        )
        return self.server

    def rotate_server_code(self, *, workspace_id: str, app_id: str) -> AppMCPServerRecord:
        _assert_scope(workspace_id, app_id)
        if self.server is None:
            raise AppMCPServerNotFoundError
        self.server = replace(self.server, server_code=f"{self.server.server_code}-rotated")
        return self.server


@pytest.fixture
def store() -> InMemoryStore:
    return InMemoryStore(PublishedApp(name="App name", description="App description"))


@pytest.fixture
def service(store: InMemoryStore) -> AppMCPServerService:
    return AppMCPServerService(servers=store)


@pytest.mark.parametrize(
    ("description", "expected"), [(None, "App description"), ("", "App description"), ("own", "own")]
)
def test_create_mirrors_app_and_starts_active(
    service: AppMCPServerService, store: InMemoryStore, description: str | None, expected: str
) -> None:
    service.create(CONTEXT, APP_ID, description=description, parameters={"k": "v"})

    expected_draft = AppMCPServerDraft(
        name="App name", description=expected, parameters={"k": "v"}, status=AppMCPServerStatus.ACTIVE
    )
    assert store.writes == [expected_draft]


def test_create_rejects_second_server(service: AppMCPServerService, store: InMemoryStore) -> None:
    service.create(CONTEXT, APP_ID, description=None, parameters={})

    with pytest.raises(AppMCPServerAlreadyExistsError):
        service.create(CONTEXT, APP_ID, description=None, parameters={})
    assert len(store.writes) == 1


def test_update_resyncs_name_and_keeps_status_unless_requested(
    service: AppMCPServerService, store: InMemoryStore
) -> None:
    created = service.create(CONTEXT, APP_ID, description=None, parameters={})
    store.app = PublishedApp(name="Renamed app", description="New app description")

    kept = service.update(CONTEXT, APP_ID, server_id=created.id, description=None, parameters={}, status=None)
    assert store.writes[-1].status is None
    assert (kept.name, kept.description, kept.status) == (
        "Renamed app",
        "New app description",
        AppMCPServerStatus.ACTIVE,
    )

    changed = service.update(
        CONTEXT, APP_ID, server_id=created.id, description="own", parameters={}, status=AppMCPServerStatus.INACTIVE
    )
    assert (changed.description, changed.status) == ("own", AppMCPServerStatus.INACTIVE)


def test_update_rejects_server_id_not_owned_by_app(service: AppMCPServerService, store: InMemoryStore) -> None:
    service.create(CONTEXT, APP_ID, description=None, parameters={})

    with pytest.raises(AppMCPServerNotFoundError):
        service.update(CONTEXT, APP_ID, server_id="other-server", description=None, parameters={}, status=None)
    assert len(store.writes) == 1


def test_refresh_rotates_the_apps_server(service: AppMCPServerService) -> None:
    created = service.create(CONTEXT, APP_ID, description=None, parameters={})

    refreshed = service.refresh(CONTEXT, APP_ID)
    assert (refreshed.id, refreshed.server_code) == (created.id, "code-1-rotated")


def test_missing_server_is_not_found(service: AppMCPServerService) -> None:
    assert service.get(CONTEXT, APP_ID) is None
    with pytest.raises(AppMCPServerNotFoundError):
        service.refresh(CONTEXT, APP_ID)
    with pytest.raises(AppMCPServerNotFoundError):
        service.update(CONTEXT, APP_ID, server_id="server-1", description=None, parameters={}, status=None)


def test_unaddressable_app_rejects_every_command(store: InMemoryStore) -> None:
    store.app = None
    service = AppMCPServerService(servers=store)

    commands = [
        lambda: service.get(CONTEXT, APP_ID),
        lambda: service.create(CONTEXT, APP_ID, description=None, parameters={}),
        lambda: service.update(CONTEXT, APP_ID, server_id="server-1", description=None, parameters={}, status=None),
        lambda: service.refresh(CONTEXT, APP_ID),
    ]
    for command in commands:
        with pytest.raises(AppMCPServerAppNotFoundError):
            command()
    assert store.writes == []
