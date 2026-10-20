"""Ways an existing App row becomes unaddressable from Console, shared by app repository tests."""

from collections.abc import Callable

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

from models.agent import Agent, AgentScope, AgentSource, AgentStatus
from models.model import App, AppMode

MakeUnaddressable = Callable[[Session, str], None]


def disable(session: Session, app_id: str) -> None:
    # AppStatus only models "normal"; legacy rows may carry other values.
    session.execute(text("UPDATE apps SET status = 'disabled' WHERE id = :id"), {"id": app_id})


def hide_behind_workflow_agent(status: AgentStatus) -> MakeUnaddressable:
    def hide(session: Session, app_id: str) -> None:
        app = session.get_one(App, app_id)
        app.mode = AppMode.AGENT
        session.add(
            Agent(
                tenant_id=app.tenant_id,
                name="hidden",
                scope=AgentScope.WORKFLOW_ONLY,
                source=AgentSource.WORKFLOW,
                status=status,
                backing_app_id=app_id,
            )
        )

    return hide


UNADDRESSABLE_IN_WORKSPACE = [
    pytest.param(disable, id="disabled-app"),
    pytest.param(hide_behind_workflow_agent(AgentStatus.ACTIVE), id="hidden-active-agent"),
    pytest.param(hide_behind_workflow_agent(AgentStatus.ARCHIVED), id="hidden-archived-agent"),
]
