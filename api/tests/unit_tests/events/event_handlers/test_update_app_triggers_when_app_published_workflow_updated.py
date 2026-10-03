from types import SimpleNamespace
from typing import cast

from sqlalchemy import Table, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from events.event_handlers.update_app_triggers_when_app_published_workflow_updated import handle
from models.base import TypeBase
from models.model import App, AppMode
from models.trigger import AppTrigger
from models.workflow import Workflow


def test_published_app_triggers_use_publish_session(sqlite_engine: Engine) -> None:
    app_trigger_table = cast(Table, AppTrigger.__table__)
    TypeBase.metadata.create_all(sqlite_engine, tables=[app_trigger_table])
    app = cast(
        App,
        SimpleNamespace(
            id="app-1",
            tenant_id="tenant-1",
            mode=AppMode.WORKFLOW.value,
        ),
    )
    published_workflow = cast(
        Workflow,
        SimpleNamespace(
            graph_dict={
                "nodes": [
                    {
                        "id": "webhook-node",
                        "data": {"type": "trigger-webhook", "title": "Webhook"},
                    }
                ]
            }
        ),
    )

    with Session(sqlite_engine) as session:
        handle(app, published_workflow=published_workflow, session=session)

        trigger = session.scalar(select(AppTrigger))
        assert trigger is not None
        assert trigger.app_id == app.id
        assert trigger.node_id == "webhook-node"

        session.rollback()

    with Session(sqlite_engine) as session:
        assert session.scalar(select(AppTrigger)) is None
