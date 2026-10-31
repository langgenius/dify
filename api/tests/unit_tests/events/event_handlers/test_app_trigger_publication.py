"""Application trigger registration shares publication's real SQL transaction."""

from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from events.event_handlers.update_app_triggers_when_app_published_workflow_updated import handle
from models.enums import AppTriggerStatus, AppTriggerType
from models.model import App, AppMode
from models.trigger import AppTrigger
from models.workflow import Workflow
from tests.unit_tests.events.event_handlers.test_sync_plugin_trigger_when_app_created import (
    _app,
    _workflow,
    binding_app,
)

__all__ = ["binding_app"]


def _node(
    node_id: str,
    *,
    title: str = "Published trigger",
    kind: str = AppTriggerType.TRIGGER_PLUGIN,
    provider: str = "github",
) -> dict[str, object]:
    return {"id": node_id, "data": {"type": kind, "title": title, "provider_name": provider}}


def _records(session: Session, app: App) -> list[AppTrigger]:
    return list(
        session.scalars(
            select(AppTrigger)
            .where(AppTrigger.tenant_id == app.tenant_id, AppTrigger.app_id == app.id)
            .order_by(AppTrigger.node_id)
        )
    )


@pytest.mark.parametrize("commit", [True, False], ids=["commit", "rollback"])
def test_publication_and_registration_share_callers_transaction(
    sqlite_session_factory: sessionmaker[Session], commit: bool
) -> None:
    app = _app()
    with sqlite_session_factory.begin() as session:
        session.add(app)
    workflow = _workflow(app, [_node("trigger")])
    with sqlite_session_factory() as session:
        session.add(workflow)
        stored = session.get_one(App, app.id)
        stored.workflow_id = workflow.id
        handle(stored, session=session, published_workflow=workflow)
        registered = _records(session, stored)
        assert len(registered) == 1
        assert registered[0].status == AppTriggerStatus.ENABLED
        assert session.in_transaction()
        if commit:
            session.commit()
        else:
            session.rollback()
    with sqlite_session_factory() as session:
        assert (session.get(Workflow, workflow.id) is not None) == commit
        assert session.get_one(App, app.id).workflow_id == (workflow.id if commit else None)
        assert len(_records(session, app)) == int(commit)


def test_sync_preserves_existing_status_and_metadata_and_updates_nonempty_titles(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    app = _app()
    with sqlite_session_factory.begin() as session:
        session.add(app)
        records = [
            AppTrigger(
                tenant_id=app.tenant_id,
                app_id=app.id,
                node_id=node_id,
                trigger_type=AppTriggerType.TRIGGER_WEBHOOK,
                title=f"Existing {node_id}",
                provider_name="original",
                status=status,
            )
            for node_id, status in [
                ("renamed", AppTriggerStatus.DISABLED),
                ("blank", AppTriggerStatus.RATE_LIMITED),
                ("removed", AppTriggerStatus.ENABLED),
            ]
        ]
        session.add_all(records)
        session.flush()
        ids = {record.node_id: record.id for record in records}
    workflow = _workflow(app, [_node("renamed", title="New name"), _node("blank", title=""), _node("added")])
    with sqlite_session_factory.begin() as session:
        handle(app, session=session, published_workflow=workflow)
    with sqlite_session_factory() as session:
        stored = {record.node_id: record for record in _records(session, app)}
        assert set(stored) == {"renamed", "blank", "added"}
        assert stored["renamed"].id == ids["renamed"]
        assert stored["renamed"].title == "New name"
        assert stored["renamed"].status == AppTriggerStatus.DISABLED
        assert stored["renamed"].trigger_type == AppTriggerType.TRIGGER_WEBHOOK
        assert stored["renamed"].provider_name == "original"
        assert stored["blank"].title == "Existing blank"
        assert stored["blank"].status == AppTriggerStatus.RATE_LIMITED
        assert stored["added"].status == AppTriggerStatus.ENABLED
        assert stored["added"].trigger_type == AppTriggerType.TRIGGER_PLUGIN
        assert stored["added"].provider_name == "github"


@pytest.mark.parametrize("foreign_field", ["tenant_id", "app_id"])
def test_sync_does_not_delete_or_modify_foreign_trigger(
    sqlite_session_factory: sessionmaker[Session], foreign_field: str
) -> None:
    app = _app()
    foreign = AppTrigger(
        tenant_id=str(uuid4()) if foreign_field == "tenant_id" else app.tenant_id,
        app_id=str(uuid4()) if foreign_field == "app_id" else app.id,
        node_id="foreign",
        trigger_type=AppTriggerType.TRIGGER_PLUGIN,
        title="Foreign trigger",
        status=AppTriggerStatus.DISABLED,
    )
    with sqlite_session_factory.begin() as session:
        session.add_all([app, foreign])
    with sqlite_session_factory.begin() as session:
        handle(app, session=session, published_workflow=_workflow(app, []))
    with sqlite_session_factory() as session:
        stored = session.get_one(AppTrigger, foreign.id)
        assert stored.title == "Foreign trigger"
        assert stored.status == AppTriggerStatus.DISABLED


def test_only_trigger_nodes_are_registered(sqlite_session_factory: sessionmaker[Session]) -> None:
    app = _app()
    nodes = [_node("start", kind="start"), _node("llm", kind="llm")]
    nodes.extend(
        _node(str(index), kind=kind)
        for index, kind in enumerate(
            [AppTriggerType.TRIGGER_PLUGIN, AppTriggerType.TRIGGER_WEBHOOK, AppTriggerType.TRIGGER_SCHEDULE]
        )
    )
    with sqlite_session_factory.begin() as session:
        session.add(app)
        handle(app, session=session, published_workflow=_workflow(app, nodes))
    with sqlite_session_factory() as session:
        records = _records(session, app)
        assert {record.node_id for record in records} == {"0", "1", "2"}
        assert {record.status for record in records} == {AppTriggerStatus.ENABLED}


@pytest.mark.parametrize("mode", [AppMode.CHAT, AppMode.COMPLETION])
def test_non_workflow_app_is_ignored(sqlite_session_factory: sessionmaker[Session], mode: AppMode) -> None:
    app = _app()
    app.mode = mode
    with sqlite_session_factory.begin() as session:
        handle(app, session=session, published_workflow=_workflow(app, [_node("trigger")]))
        assert _records(session, app) == []


def test_missing_published_workflow_is_ignored(sqlite_session_factory: sessionmaker[Session]) -> None:
    app = _app()
    with sqlite_session_factory.begin() as session:
        handle(app, session=session)
        assert _records(session, app) == []
