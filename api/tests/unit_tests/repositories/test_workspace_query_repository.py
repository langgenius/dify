"""Workspace names are materialized by the discovery repository."""

from sqlalchemy.orm import Session, sessionmaker

from models.account import Tenant, TenantStatus
from repositories.workspace_query_repository import WorkspaceQueryRepository


def test_names_by_ids_returns_only_existing_requested_workspaces(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    first = Tenant(name="Workspace 1")
    second = Tenant(name="Workspace 2")
    archived = Tenant(name="Archived Workspace", status=TenantStatus.ARCHIVE)
    with sqlite_session_factory.begin() as session:
        session.add_all([first, second, archived])

    repository = WorkspaceQueryRepository(sqlite_session_factory)
    assert repository.names_by_ids([first.id, archived.id, "missing", first.id]) == {
        first.id: "Workspace 1",
        archived.id: "Archived Workspace",
    }
    assert repository.names_by_ids(["missing"]) == {}


def test_names_by_ids_short_circuits_empty_input(unbound_session_factory: sessionmaker[Session]) -> None:
    repository = WorkspaceQueryRepository(unbound_session_factory)
    assert repository.names_by_ids([]) == {}
