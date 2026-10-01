"""Exercise App MCP server persistence with real short-lived Sessions."""

import json
from dataclasses import replace
from typing import Literal

import pytest
from sqlalchemy import Select, event
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import ORMExecuteState, Session, sessionmaker

from machinery.context import RequestContext
from models.model import App, AppMCPServer
from repositories.app.mcp_server_repository import AppMCPServerRepository
from services.app.mcp_server_service import (
    AppMCPServerAlreadyExistsError,
    AppMCPServerDraft,
    AppMCPServerNotFoundError,
    AppMCPServerRecord,
    AppMCPServerService,
    AppMCPServerStatus,
    AppMCPServerUpdate,
    PublishedApp,
)
from tests.unit_tests.model_factories import make_app
from tests.unit_tests.repositories.app.console_visibility import UNADDRESSABLE_IN_WORKSPACE, MakeUnaddressable

WORKSPACE_ID = "tenant-1"
DRAFT = AppMCPServerDraft(
    name="Server", description="Described", parameters={"label": "中文"}, status=AppMCPServerStatus.ACTIVE
)


@pytest.fixture
def configured_app(sqlite_session: Session) -> App:
    app = make_app(tenant_id=WORKSPACE_ID, name="App name", description="App description")
    sqlite_session.add(app)
    sqlite_session.commit()
    return app


@pytest.fixture
def other_app(sqlite_session: Session) -> App:
    app = make_app(app_id="app-2", tenant_id=WORKSPACE_ID)
    sqlite_session.add(app)
    sqlite_session.commit()
    return app


@pytest.fixture
def repository(sqlite_session_factory: sessionmaker[Session]) -> AppMCPServerRepository:
    return AppMCPServerRepository(session_factory=sqlite_session_factory)


def test_lifecycle_writes_drafts_verbatim(configured_app: App, repository: AppMCPServerRepository) -> None:
    scope: dict[str, str] = {"workspace_id": WORKSPACE_ID, "app_id": configured_app.id}
    assert repository.find_server(**scope) is None

    created = repository.insert_server(**scope, draft=DRAFT)
    assert (created.name, created.description, created.status) == ("Server", "Described", AppMCPServerStatus.ACTIVE)
    assert json.loads(created.parameters) == {"label": "中文"}
    assert len(created.server_code) == 16
    assert repository.find_server(**scope) == created

    changed = AppMCPServerUpdate(name="Renamed", description="", parameters={}, status=AppMCPServerStatus.INACTIVE)
    updated = repository.update_server(**scope, server_id=created.id, update=changed)
    assert (updated.name, updated.description, updated.status) == ("Renamed", "", AppMCPServerStatus.INACTIVE)
    assert updated.server_code == created.server_code

    rotated = repository.rotate_server_code(**scope)
    assert rotated.id == created.id
    assert rotated.server_code != created.server_code
    assert repository.find_server(**scope) == rotated


@pytest.mark.parametrize("status", list(AppMCPServerStatus))
def test_repository_maps_stored_status_to_application_enum(
    configured_app: App,
    repository: AppMCPServerRepository,
    sqlite_session_factory: sessionmaker[Session],
    status: AppMCPServerStatus,
) -> None:
    scope: dict[str, str] = {"workspace_id": WORKSPACE_ID, "app_id": configured_app.id}
    created = repository.insert_server(**scope, draft=replace(DRAFT, status=status))
    assert created.status is status

    with sqlite_session_factory() as session:
        assert session.get_one(AppMCPServer, created.id).status == status.value

    found = repository.find_server(**scope)
    assert found is not None
    assert found.status is status


@pytest.mark.parametrize("operation", ["update", "refresh"])
def test_service_mutations_read_server_at_most_once(
    configured_app: App,
    repository: AppMCPServerRepository,
    sqlite_session_factory: sessionmaker[Session],
    operation: Literal["update", "refresh"],
) -> None:
    created = repository.insert_server(workspace_id=WORKSPACE_ID, app_id=configured_app.id, draft=DRAFT)
    service = AppMCPServerService(servers=repository)
    context = RequestContext("request", None, "account", WORKSPACE_ID)
    server_read_count = 0

    def capture_reads(state: ORMExecuteState) -> None:
        nonlocal server_read_count
        if state.is_select and isinstance(state.statement, Select):
            # Count full server reads, excluding code uniqueness checks and generated timestamp reloads.
            if not state.is_column_load and any(
                column["expr"] is AppMCPServer for column in state.statement.column_descriptions
            ):
                server_read_count += 1

    event.listen(sqlite_session_factory, "do_orm_execute", capture_reads)
    try:
        if operation == "update":
            result = service.update(
                context, configured_app.id, server_id=created.id, description="Edited", parameters={}, status=None
            )
            assert result.description == "Edited"
        else:
            result = service.refresh(context, configured_app.id)
            assert result.server_code != created.server_code
    finally:
        event.remove(sqlite_session_factory, "do_orm_execute", capture_reads)

    assert result.id == created.id
    assert result.status is created.status
    assert server_read_count <= 1
    with sqlite_session_factory() as session:
        persisted = session.get_one(AppMCPServer, created.id)
        assert persisted.description == result.description
        assert persisted.parameters == result.parameters
        assert persisted.server_code == result.server_code
        assert persisted.status == created.status.value


def test_service_mutations_preserve_server_ownership(
    configured_app: App, other_app: App, repository: AppMCPServerRepository
) -> None:
    scope: dict[str, str] = {"workspace_id": WORKSPACE_ID, "app_id": configured_app.id}
    owned = repository.insert_server(**scope, draft=DRAFT)
    foreign = repository.insert_server(workspace_id=WORKSPACE_ID, app_id=other_app.id, draft=DRAFT)
    service = AppMCPServerService(servers=repository)
    context = RequestContext("request", None, "account", WORKSPACE_ID)

    with pytest.raises(AppMCPServerNotFoundError):
        service.update(
            context, configured_app.id, server_id=foreign.id, description="Wrong server", parameters={}, status=None
        )
    assert repository.find_server(**scope) == owned

    refreshed = service.refresh(context, configured_app.id)
    assert refreshed.id == owned.id
    assert refreshed.server_code != owned.server_code
    assert repository.find_server(workspace_id=WORKSPACE_ID, app_id=other_app.id) == foreign


def test_service_mutations_report_missing_server(configured_app: App, repository: AppMCPServerRepository) -> None:
    service = AppMCPServerService(servers=repository)
    context = RequestContext("request", None, "account", WORKSPACE_ID)

    with pytest.raises(AppMCPServerNotFoundError):
        service.update(
            context, configured_app.id, server_id="missing", description="Edited", parameters={}, status=None
        )
    with pytest.raises(AppMCPServerNotFoundError):
        service.refresh(context, configured_app.id)
    assert repository.find_server(workspace_id=WORKSPACE_ID, app_id=configured_app.id) is None


@pytest.mark.parametrize("status", [None, AppMCPServerStatus.ACTIVE, AppMCPServerStatus.INACTIVE])
def test_update_inactive_server_changes_status_only_when_requested(
    configured_app: App,
    repository: AppMCPServerRepository,
    sqlite_session_factory: sessionmaker[Session],
    status: AppMCPServerStatus | None,
) -> None:
    scope: dict[str, str] = {"workspace_id": WORKSPACE_ID, "app_id": configured_app.id}
    created = repository.insert_server(
        **scope,
        draft=AppMCPServerDraft(name="Server", description="", parameters={}, status=AppMCPServerStatus.INACTIVE),
    )
    update = AppMCPServerUpdate(name="Renamed", description="Edited", parameters={}, status=status)

    updated = repository.update_server(**scope, server_id=created.id, update=update)

    expected_status = AppMCPServerStatus.INACTIVE if status is None else status
    assert updated.status == expected_status
    with sqlite_session_factory() as session:
        persisted = session.get_one(AppMCPServer, created.id)
        assert (persisted.name, persisted.description, persisted.status) == ("Renamed", "Edited", expected_status)


def test_concurrent_insert_loser_gets_domain_error(configured_app: App, repository: AppMCPServerRepository) -> None:
    # The service pre-check can miss a row another request commits meanwhile; the constraint is the last word.
    scope: dict[str, str] = {"workspace_id": WORKSPACE_ID, "app_id": configured_app.id}
    winner = repository.insert_server(**scope, draft=DRAFT)

    with pytest.raises(AppMCPServerAlreadyExistsError):
        repository.insert_server(**scope, draft=DRAFT)
    assert repository.find_server(**scope) == winner


def test_description_edit_preserves_concurrent_deactivation(
    configured_app: App,
    repository: AppMCPServerRepository,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    scope: dict[str, str] = {"workspace_id": WORKSPACE_ID, "app_id": configured_app.id}
    created = repository.insert_server(**scope, draft=DRAFT)
    update_server = repository.update_server

    def deactivate_then_update(
        *, workspace_id: str, app_id: str, server_id: str, update: AppMCPServerUpdate
    ) -> AppMCPServerRecord:
        # Another request deactivates the server after the edit is prepared, before its write transaction.
        with sqlite_session_factory.begin() as session:
            server = session.get_one(AppMCPServer, created.id)
            assert server.status == AppMCPServerStatus.ACTIVE
            server.status = AppMCPServerStatus.INACTIVE.value
        return update_server(workspace_id=workspace_id, app_id=app_id, server_id=server_id, update=update)

    monkeypatch.setattr(repository, "update_server", deactivate_then_update)
    service = AppMCPServerService(servers=repository)
    updated = service.update(
        RequestContext("request", None, "account", WORKSPACE_ID),
        configured_app.id,
        server_id=created.id,
        description="Edited description",
        parameters={"edited": True},
        status=None,
    )

    assert updated.status == AppMCPServerStatus.INACTIVE
    with sqlite_session_factory() as session:
        persisted = session.get_one(AppMCPServer, created.id)
        assert persisted.status == AppMCPServerStatus.INACTIVE
        assert persisted.description == "Edited description"
        assert json.loads(persisted.parameters) == {"edited": True}


def test_server_code_collision_is_not_reported_as_duplicate(
    configured_app: App, other_app: App, repository: AppMCPServerRepository, monkeypatch: pytest.MonkeyPatch
) -> None:
    taken = repository.insert_server(workspace_id=WORKSPACE_ID, app_id=other_app.id, draft=DRAFT)
    monkeypatch.setattr(AppMCPServer, "generate_server_code", staticmethod(lambda _n, **_kwargs: taken.server_code))

    with pytest.raises(IntegrityError):
        repository.insert_server(workspace_id=WORKSPACE_ID, app_id=configured_app.id, draft=DRAFT)
    assert repository.find_server(workspace_id=WORKSPACE_ID, app_id=configured_app.id) is None


@pytest.mark.parametrize(("tenant_id", "app_id"), [("tenant-2", None), (WORKSPACE_ID, "app-2")])
def test_foreign_servers_are_invisible(
    configured_app: App,
    repository: AppMCPServerRepository,
    sqlite_session_factory: sessionmaker[Session],
    tenant_id: str,
    app_id: str | None,
) -> None:
    foreign = AppMCPServer(
        tenant_id=tenant_id,
        app_id=app_id or configured_app.id,
        name="foreign",
        description="private",
        server_code="foreign-code",
        status=AppMCPServerStatus.ACTIVE.value,
        parameters="{}",
    )
    with sqlite_session_factory.begin() as session:
        session.add(foreign)
    scope: dict[str, str] = {"workspace_id": WORKSPACE_ID, "app_id": configured_app.id}

    assert repository.find_server(**scope) is None
    with pytest.raises(AppMCPServerNotFoundError):
        repository.update_server(
            **scope,
            server_id=foreign.id,
            update=AppMCPServerUpdate(name="Server", description="Edited", parameters={}, status=None),
        )
    with pytest.raises(AppMCPServerNotFoundError):
        repository.rotate_server_code(**scope)
    with sqlite_session_factory() as session:
        persisted = session.get_one(AppMCPServer, foreign.id)
        assert (persisted.description, persisted.server_code) == ("private", "foreign-code")


def test_find_app_returns_mirrored_fields(configured_app: App, repository: AppMCPServerRepository) -> None:
    found = repository.find_app(workspace_id=WORKSPACE_ID, app_id=configured_app.id)
    assert found == PublishedApp(name="App name", description="App description")


def test_find_app_is_scoped_to_workspace(configured_app: App, repository: AppMCPServerRepository) -> None:
    assert repository.find_app(workspace_id="other-workspace", app_id=configured_app.id) is None


@pytest.mark.parametrize("make_unaddressable", UNADDRESSABLE_IN_WORKSPACE)
def test_find_app_hides_unaddressable_apps(
    configured_app: App,
    repository: AppMCPServerRepository,
    sqlite_session_factory: sessionmaker[Session],
    make_unaddressable: MakeUnaddressable,
) -> None:
    with sqlite_session_factory.begin() as session:
        make_unaddressable(session, configured_app.id)

    assert repository.find_app(workspace_id=WORKSPACE_ID, app_id=configured_app.id) is None
