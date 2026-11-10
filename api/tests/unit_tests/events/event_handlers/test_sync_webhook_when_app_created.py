"""Webhook listeners use real application wiring and caller-owned publication SQL."""

import json
from collections.abc import Iterator
from flask import Flask
from redis import Redis
from enums import DeploymentEdition
from extensions.ext_application_services import build_application_services
from extensions.ext_redis import RedisClientWrapper
from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from events.app_event import app_draft_workflow_was_synced, app_published_workflow_was_updated
from events.event_handlers.sync_webhook_when_app_created import handle, handle_published
from models.model import App, AppMode
from models.trigger import WorkflowWebhookTrigger
from models.workflow import Workflow
from tests.unit_tests.repositories.trigger.test_webhook_runtime import WebhookSeed
from tests.unit_tests.repositories.trigger.test_webhook_runtime import webhook_seed as _webhook_seed

webhook_seed = _webhook_seed


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


def _workflow(app: App, node_ids: list[str]) -> Workflow:
    return Workflow.new(
        tenant_id=app.tenant_id,
        app_id=app.id,
        type="workflow",
        version="published",
        graph=json.dumps(
            {"nodes": [{"id": node_id, "data": {"type": "trigger-webhook"}} for node_id in node_ids], "edges": []}
        ),
        features="{}",
        created_by=str(uuid4()),
        environment_variables=[],
        conversation_variables=[],
        rag_pipeline_variables=[],
    )


def _bindings(session: Session, app_id: str) -> dict[str, str]:
    return {
        binding.node_id: binding.webhook_id
        for binding in session.scalars(select(WorkflowWebhookTrigger).where(WorkflowWebhookTrigger.app_id == app_id))
    }


def test_draft_listener_preserves_url_for_undo(
    sqlite_session_factory: sessionmaker[Session], webhook_seed: WebhookSeed
) -> None:
    with sqlite_session_factory() as session:
        app = session.get(App, webhook_seed.app_id)
        assert app is not None
        session.expunge(app)
    handle(app, synced_draft_workflow=_workflow(app, ["new"]))
    with sqlite_session_factory() as session:
        bindings = _bindings(session, app.id)
        assert bindings["hook"] == webhook_seed.webhook_id
        assert len(bindings["new"]) == 24
    handle(app, synced_draft_workflow=_workflow(app, ["hook"]))
    with sqlite_session_factory() as session:
        assert _bindings(session, app.id) == bindings


@pytest.mark.parametrize("commit", [True, False], ids=["commit", "rollback"])
def test_published_listener_removes_stale_bindings_in_publishers_transaction(
    sqlite_session_factory: sessionmaker[Session], webhook_seed: WebhookSeed, commit: bool
) -> None:
    with sqlite_session_factory() as session:
        app = session.get(App, webhook_seed.app_id)
        assert app is not None
        published = _workflow(app, ["new"])
        session.add(published)
        app.workflow_id = published.id
        handle_published(app, published_workflow=published, session=session)
        assert set(_bindings(session, app.id)) == {"new"}
        if commit:
            session.commit()
        else:
            session.rollback()
    with sqlite_session_factory() as session:
        app = session.get(App, webhook_seed.app_id)
        assert app is not None
        assert app.workflow_id == (published.id if commit else webhook_seed.workflow_id)
        bindings = _bindings(session, app.id)
        assert set(bindings) == ({"new"} if commit else {"hook"})
        if not commit:
            assert bindings["hook"] == webhook_seed.webhook_id


def test_non_workflow_app_is_ignored(sqlite_session_factory: sessionmaker[Session], webhook_seed: WebhookSeed) -> None:
    with sqlite_session_factory() as session:
        app = session.get(App, webhook_seed.app_id)
        assert app is not None
        app.mode = AppMode.CHAT
        workflow = _workflow(app, ["new"])
        handle(app, synced_draft_workflow=workflow)
        handle_published(app, published_workflow=workflow, session=session)
        assert _bindings(session, app.id) == {"hook": webhook_seed.webhook_id}


def test_webhook_listeners_are_registered() -> None:
    assert handle in app_draft_workflow_was_synced.receivers_for(App())
    assert handle_published in app_published_workflow_was_updated.receivers_for(App())
