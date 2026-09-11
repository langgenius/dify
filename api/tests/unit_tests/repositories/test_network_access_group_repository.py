from unittest.mock import MagicMock

import pytest
from sqlalchemy import event, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker

from models.agent import Agent, AgentScope, AgentSource, AgentStatus
from models.model import App, AppMode, IconType
from repositories.network_access_group_repository import SQLAlchemyNetworkAccessGroupAppRepository
from services.network_access_group_service import NetworkAccessGroupAppQueryError, NetworkAccessGroupAppRecord

_WORKSPACE_ID = "11111111-1111-1111-1111-111111111111"
_OTHER_WORKSPACE_ID = "22222222-2222-2222-2222-222222222222"
_APP_ID = "33333333-3333-3333-3333-333333333333"
_OTHER_APP_ID = "44444444-4444-4444-4444-444444444444"
_DISABLED_APP_ID = "55555555-5555-5555-5555-555555555555"
_UNREQUESTED_APP_ID = "66666666-6666-6666-6666-666666666666"


def _app(
    app_id: str,
    *,
    workspace_id: str = _WORKSPACE_ID,
    mode: AppMode = AppMode.WORKFLOW,
) -> App:
    return App(
        id=app_id,
        tenant_id=workspace_id,
        name=f"App {app_id}",
        description="",
        mode=mode,
        icon_type=IconType.EMOJI,
        icon="robot",
        icon_background="#ffffff",
        enable_site=True,
        enable_api=True,
    )


def _repository(session_factory: sessionmaker[Session]) -> SQLAlchemyNetworkAccessGroupAppRepository:
    return SQLAlchemyNetworkAccessGroupAppRepository(session_factory=session_factory)


def test_get_manageable_app_returns_detached_projection_and_enforces_workspace_and_status_scope(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory() as session:
        session.add_all(
            [
                _app(_APP_ID),
                _app(_OTHER_APP_ID, workspace_id=_OTHER_WORKSPACE_ID),
                _app(_DISABLED_APP_ID),
            ]
        )
        session.commit()
        session.execute(
            text("UPDATE apps SET status = 'disabled' WHERE id = :app_id"),
            {"app_id": _DISABLED_APP_ID},
        )
        session.commit()

    repository = _repository(sqlite_session_factory)

    result = repository.get_manageable_app(workspace_id=_WORKSPACE_ID, app_id=_APP_ID)

    assert result == NetworkAccessGroupAppRecord(
        id=_APP_ID,
        mode=AppMode.WORKFLOW.value,
        name=f"App {_APP_ID}",
        icon="robot",
        icon_type=IconType.EMOJI.value,
        icon_background="#ffffff",
    )
    assert repository.get_manageable_app(workspace_id=_OTHER_WORKSPACE_ID, app_id=_APP_ID) is None
    assert repository.get_manageable_app(workspace_id=_WORKSPACE_ID, app_id=_OTHER_APP_ID) is None
    assert repository.get_manageable_app(workspace_id=_WORKSPACE_ID, app_id=_DISABLED_APP_ID) is None
    assert repository.get_manageable_app(workspace_id=_WORKSPACE_ID, app_id=_UNREQUESTED_APP_ID) is None


def test_list_apps_returns_only_normal_apps_in_the_requested_workspace(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory() as session:
        session.add_all(
            [
                _app(_APP_ID),
                _app(_OTHER_APP_ID, workspace_id=_OTHER_WORKSPACE_ID),
                _app(_DISABLED_APP_ID),
                _app(_UNREQUESTED_APP_ID),
            ]
        )
        session.commit()
        session.execute(
            text("UPDATE apps SET status = 'disabled' WHERE id = :app_id"),
            {"app_id": _DISABLED_APP_ID},
        )
        session.commit()

    result = _repository(sqlite_session_factory).list_apps(
        workspace_id=_WORKSPACE_ID,
        app_ids=[_APP_ID, _OTHER_APP_ID, _DISABLED_APP_ID],
    )

    assert result == (
        NetworkAccessGroupAppRecord(
            id=_APP_ID,
            mode=AppMode.WORKFLOW.value,
            name=f"App {_APP_ID}",
            icon="robot",
            icon_type=IconType.EMOJI.value,
            icon_background="#ffffff",
        ),
    )


@pytest.mark.parametrize(
    ("scope", "source", "status", "expected_visible"),
    [
        (AgentScope.WORKFLOW_ONLY, AgentSource.WORKFLOW, AgentStatus.ACTIVE, False),
        (AgentScope.WORKFLOW_ONLY, AgentSource.WORKFLOW, AgentStatus.ARCHIVED, False),
        (AgentScope.ROSTER, AgentSource.AGENT_APP, AgentStatus.ACTIVE, True),
    ],
)
def test_get_manageable_app_applies_agent_scope_and_lifecycle_visibility(
    sqlite_session_factory: sessionmaker[Session],
    scope: AgentScope,
    source: AgentSource,
    status: AgentStatus,
    expected_visible: bool,
) -> None:
    app = _app(_APP_ID, mode=AppMode.AGENT)
    with sqlite_session_factory() as session:
        session.add_all(
            [
                app,
                Agent(
                    id="77777777-7777-7777-7777-777777777777",
                    tenant_id=_WORKSPACE_ID,
                    name="Bound agent",
                    description="",
                    role="",
                    scope=scope,
                    source=source,
                    status=status,
                    app_id=app.id if scope == AgentScope.ROSTER else "88888888-8888-8888-8888-888888888888",
                    backing_app_id=app.id if scope == AgentScope.WORKFLOW_ONLY else None,
                    workflow_id=("99999999-9999-9999-9999-999999999999" if scope == AgentScope.WORKFLOW_ONLY else None),
                    workflow_node_id="agent-node" if scope == AgentScope.WORKFLOW_ONLY else None,
                ),
            ]
        )
        session.commit()

    result = _repository(sqlite_session_factory).get_manageable_app(
        workspace_id=_WORKSPACE_ID,
        app_id=_APP_ID,
    )

    assert (result is not None) is expected_visible
    if result is not None:
        assert result.bound_agent_id == "77777777-7777-7777-7777-777777777777"


def test_list_apps_batch_loads_agent_routes_and_excludes_hidden_workflow_backing_apps(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    agent_app_id = _APP_ID
    second_agent_app_id = _UNREQUESTED_APP_ID
    hidden_app_id = _DISABLED_APP_ID
    with sqlite_session_factory() as session:
        session.add_all(
            [
                _app(agent_app_id, mode=AppMode.AGENT),
                _app(second_agent_app_id, mode=AppMode.AGENT),
                _app(hidden_app_id, mode=AppMode.AGENT),
                Agent(
                    id="77777777-7777-7777-7777-777777777777",
                    tenant_id=_WORKSPACE_ID,
                    name="First roster agent",
                    description="",
                    role="",
                    scope=AgentScope.ROSTER,
                    source=AgentSource.AGENT_APP,
                    status=AgentStatus.ACTIVE,
                    app_id=agent_app_id,
                    backing_app_id=agent_app_id,
                ),
                Agent(
                    id="88888888-8888-8888-8888-888888888888",
                    tenant_id=_WORKSPACE_ID,
                    name="Second roster agent",
                    description="",
                    role="",
                    scope=AgentScope.ROSTER,
                    source=AgentSource.IMPORTED,
                    status=AgentStatus.ACTIVE,
                    app_id=second_agent_app_id,
                    backing_app_id=second_agent_app_id,
                ),
                Agent(
                    id="99999999-9999-9999-9999-999999999999",
                    tenant_id=_WORKSPACE_ID,
                    name="Workflow-only agent",
                    description="",
                    role="",
                    scope=AgentScope.WORKFLOW_ONLY,
                    source=AgentSource.WORKFLOW,
                    status=AgentStatus.ACTIVE,
                    app_id=_OTHER_APP_ID,
                    backing_app_id=hidden_app_id,
                    workflow_id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                    workflow_node_id="agent-node",
                ),
            ]
        )
        session.commit()
        engine = session.get_bind()

    agent_selects: list[str] = []

    def record_agent_select(_conn, _cursor, statement: str, _parameters, _context, _executemany) -> None:
        if "FROM agents" in statement:
            agent_selects.append(statement)

    event.listen(engine, "before_cursor_execute", record_agent_select)
    try:
        result = _repository(sqlite_session_factory).list_apps(
            workspace_id=_WORKSPACE_ID,
            app_ids=[agent_app_id, second_agent_app_id, hidden_app_id],
        )
    finally:
        event.remove(engine, "before_cursor_execute", record_agent_select)

    assert [(app.id, app.bound_agent_id) for app in result] == [
        (agent_app_id, "77777777-7777-7777-7777-777777777777"),
        (second_agent_app_id, "88888888-8888-8888-8888-888888888888"),
    ]
    assert len(agent_selects) == 1


def test_list_apps_maps_database_failures_to_query_error() -> None:
    session_factory = MagicMock()
    session = session_factory.return_value.__enter__.return_value
    session.scalars.side_effect = SQLAlchemyError("database unavailable")

    with pytest.raises(NetworkAccessGroupAppQueryError):
        _repository(session_factory).list_apps(workspace_id=_WORKSPACE_ID, app_ids=[_APP_ID])
