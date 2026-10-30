"""Published graph bindings share the publisher's transaction through real wiring."""

import json
from collections.abc import Iterator
from uuid import uuid4

import pytest
from flask import Flask
from redis import Redis
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.trigger.constants import TRIGGER_PLUGIN_NODE_TYPE
from enums import DeploymentEdition
from events.app_event import app_draft_workflow_was_synced, app_published_workflow_was_updated
from events.event_handlers.sync_plugin_trigger_when_app_created import handle
from extensions.ext_application_services import build_application_services
from extensions.ext_redis import RedisClientWrapper
from models.model import App, AppMode
from models.trigger import WorkflowPluginTrigger
from models.workflow import Workflow, WorkflowType

_PROVIDER = "langgenius/github/github"


@pytest.fixture(autouse=True)
def binding_app(sqlite_session_factory: sessionmaker[Session]) -> Iterator[Flask]:
    app = Flask(__name__)
    # Construction never connects to Redis. Binding synchronization must remain
    # usable with only the caller's SQL transaction, including when Redis is down.
    with Redis() as client:
        redis = RedisClientWrapper()
        redis.initialize(client)
        app.extensions["application_services"] = build_application_services(
            database_client=sqlite_session_factory,
            deployment_edition=DeploymentEdition.COMMUNITY,
            initialization_password="",
            redis=redis,
        )
        with app.app_context():
            yield app


def _app() -> App:
    return App(
        id=str(uuid4()),
        tenant_id=str(uuid4()),
        name="Plugin workflow",
        mode=AppMode.WORKFLOW,
        enable_site=True,
        enable_api=True,
    )


def _node(node_id: str, subscription_id: str = "subscription") -> dict[str, object]:
    return {
        "id": node_id,
        "data": {
            "type": TRIGGER_PLUGIN_NODE_TYPE,
            "provider_id": _PROVIDER,
            "event_name": "push",
            "subscription_id": subscription_id,
        },
    }


def _workflow(app: App, nodes: list[dict[str, object]]) -> Workflow:
    return Workflow.new(
        tenant_id=app.tenant_id,
        app_id=app.id,
        type=WorkflowType.WORKFLOW,
        version="published",
        graph=json.dumps({"nodes": nodes, "edges": []}),
        features="{}",
        created_by=str(uuid4()),
        environment_variables=[],
        conversation_variables=[],
        rag_pipeline_variables=[],
    )


def _bindings(session: Session, app: App) -> list[WorkflowPluginTrigger]:
    return list(
        session.scalars(
            select(WorkflowPluginTrigger)
            .where(WorkflowPluginTrigger.tenant_id == app.tenant_id, WorkflowPluginTrigger.app_id == app.id)
            .order_by(WorkflowPluginTrigger.node_id)
        )
    )


@pytest.mark.parametrize("commit", [True, False], ids=["commit", "rollback"])
def test_binding_and_published_workflow_follow_callers_transaction(
    sqlite_session_factory: sessionmaker[Session], commit: bool
) -> None:
    app = _app()
    with sqlite_session_factory.begin() as session:
        session.add(app)

    workflow = _workflow(app, [_node("trigger")])
    with sqlite_session_factory() as session:
        session.add(workflow)
        stored_app = session.get(App, app.id)
        assert stored_app is not None
        stored_app.workflow_id = workflow.id

        handle(stored_app, session=session, published_workflow=workflow)

        assert session.in_transaction()
        binding = _bindings(session, stored_app)[0]
        assert (binding.node_id, binding.provider_id, binding.event_name, binding.subscription_id) == (
            "trigger",
            _PROVIDER,
            "push",
            "subscription",
        )
        if commit:
            session.commit()
        else:
            session.rollback()

    with sqlite_session_factory() as session:
        stored_app = session.get(App, app.id)
        assert stored_app is not None
        assert stored_app.workflow_id == (workflow.id if commit else None)
        assert (session.get(Workflow, workflow.id) is not None) is commit
        assert bool(_bindings(session, stored_app)) is commit


def test_republish_updates_retained_node_and_removes_absent_bindings(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    app = _app()
    with sqlite_session_factory.begin() as session:
        session.add(app)
        handle(app, session=session, published_workflow=_workflow(app, [_node("keep"), _node("remove")]))
        original_id = _bindings(session, app)[0].id

    replacement: dict[str, object] = {
        "id": "keep",
        "data": {
            "type": TRIGGER_PLUGIN_NODE_TYPE,
            "provider_id": "langgenius/gitlab/gitlab",
            "event_name": "merge",
            "subscription_id": "replacement-subscription",
        },
    }
    with sqlite_session_factory.begin() as session:
        handle(app, session=session, published_workflow=_workflow(app, [replacement, _node("new")]))

    with sqlite_session_factory() as session:
        bindings = _bindings(session, app)
        assert [binding.node_id for binding in bindings] == ["keep", "new"]
        assert bindings[0].id == original_id
        assert (bindings[0].provider_id, bindings[0].event_name, bindings[0].subscription_id) == (
            "langgenius/gitlab/gitlab",
            "merge",
            "replacement-subscription",
        )


@pytest.mark.parametrize("mode", [AppMode.CHAT, AppMode.ADVANCED_CHAT, AppMode.COMPLETION])
def test_non_workflow_apps_do_not_sync_plugin_bindings(
    sqlite_session_factory: sessionmaker[Session], mode: AppMode
) -> None:
    app = _app()
    app.mode = mode
    with sqlite_session_factory.begin() as session:
        handle(app, session=session, published_workflow=_workflow(app, [_node("trigger")]))
        assert _bindings(session, app) == []


def test_missing_published_workflow_does_not_clear_existing_bindings(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    app = _app()
    with sqlite_session_factory.begin() as session:
        session.add(app)
        handle(app, session=session, published_workflow=_workflow(app, [_node("trigger")]))
        handle(app, session=session)
        assert [binding.node_id for binding in _bindings(session, app)] == ["trigger"]


def test_only_subscribed_plugin_nodes_count_toward_limit(sqlite_session_factory: sessionmaker[Session]) -> None:
    app = _app()
    nodes = [_node(f"trigger-{index}") for index in range(5)]
    nodes.extend(_node(f"unconfigured-{index}", "") for index in range(6))
    nodes.append({"id": "start", "data": {"type": "start"}})
    with sqlite_session_factory.begin() as session:
        session.add(app)
        handle(app, session=session, published_workflow=_workflow(app, nodes))
        assert [binding.node_id for binding in _bindings(session, app)] == [f"trigger-{index}" for index in range(5)]


def test_exceeding_plugin_node_limit_preserves_existing_bindings(sqlite_session_factory: sessionmaker[Session]) -> None:
    app = _app()
    with sqlite_session_factory.begin() as session:
        session.add(app)
        handle(app, session=session, published_workflow=_workflow(app, [_node("original")]))

    with sqlite_session_factory.begin() as session:
        with pytest.raises(ValueError, match="^Workflow exceeds maximum plugin trigger node limit") as error:
            handle(
                app,
                session=session,
                published_workflow=_workflow(app, [_node(f"trigger-{index}") for index in range(6)]),
            )
        assert str(error.value) == (
            "Workflow exceeds maximum plugin trigger node limit. Found 6 plugin trigger nodes, maximum allowed is 5"
        )
        assert [binding.node_id for binding in _bindings(session, app)] == ["original"]


def test_publishing_no_subscribed_plugin_nodes_clears_bindings(sqlite_session_factory: sessionmaker[Session]) -> None:
    app = _app()
    with sqlite_session_factory.begin() as session:
        session.add(app)
        handle(app, session=session, published_workflow=_workflow(app, [_node("trigger")]))
    with sqlite_session_factory.begin() as session:
        handle(app, session=session, published_workflow=_workflow(app, [_node("trigger", "")]))
    with sqlite_session_factory() as session:
        assert _bindings(session, app) == []


def test_draft_workflow_sync_does_not_register_plugin_trigger_handler() -> None:
    sender = object()

    assert handle not in app_draft_workflow_was_synced.receivers_for(sender)
    assert handle in app_published_workflow_was_updated.receivers_for(sender)
