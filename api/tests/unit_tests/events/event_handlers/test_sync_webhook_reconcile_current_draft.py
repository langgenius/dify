"""Durable draft coordination re-reads the current draft before syncing webhook bindings.

The coordination sweeper sends ``reconcile_current_draft=True`` and can deliver after later
edits or after the app or draft was deleted. The listener must sync the draft row as it is now
and treat a vanished app or draft as already reconciled, so the durable row stops retrying.
"""

import json

import pytest
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session, sessionmaker

from events.event_handlers import sync_webhook_when_app_created
from events.event_handlers.sync_webhook_when_app_created import handle
from models.model import App
from models.trigger import WorkflowWebhookTrigger
from models.workflow import Workflow
from services.trigger.webhook_service import WebhookNotFoundError
from tests.unit_tests.events.event_handlers.test_sync_plugin_trigger_when_app_created import binding_app  # noqa: F401
from tests.unit_tests.repositories.trigger.test_webhook_runtime import WebhookSeed
from tests.unit_tests.repositories.trigger.test_webhook_runtime import webhook_seed as _webhook_seed

webhook_seed = _webhook_seed


def _graph(node_ids: list[str]) -> str:
    return json.dumps(
        {"nodes": [{"id": node_id, "data": {"type": "trigger-webhook"}} for node_id in node_ids], "edges": []}
    )


def _detached(factory: sessionmaker[Session], seed: WebhookSeed) -> tuple[App, Workflow]:
    with factory() as session:
        app = session.get(App, seed.app_id)
        draft = session.get(Workflow, seed.draft_id)
        assert app is not None
        assert draft is not None
        session.expunge_all()
    return app, draft


def _bindings(factory: sessionmaker[Session], app_id: str) -> dict[str, str]:
    with factory() as session:
        return {
            row.node_id: row.webhook_id
            for row in session.scalars(select(WorkflowWebhookTrigger).where(WorkflowWebhookTrigger.app_id == app_id))
        }


def test_reconcile_syncs_the_current_draft_row_instead_of_the_signal_payload(
    sqlite_session_factory: sessionmaker[Session], webhook_seed: WebhookSeed
) -> None:
    app, stale_draft = _detached(sqlite_session_factory, webhook_seed)
    stale_draft.graph = _graph(["stale"])
    with sqlite_session_factory.begin() as session:
        session.execute(update(Workflow).where(Workflow.id == webhook_seed.draft_id).values(graph=_graph(["current"])))

    handle(app, synced_draft_workflow=stale_draft, reconcile_current_draft=True)

    bindings = _bindings(sqlite_session_factory, app.id)
    assert set(bindings) == {"hook", "current"}
    assert bindings["hook"] == webhook_seed.webhook_id


def test_without_reconcile_the_signal_payload_is_synced(
    sqlite_session_factory: sessionmaker[Session], webhook_seed: WebhookSeed
) -> None:
    app, draft = _detached(sqlite_session_factory, webhook_seed)
    draft.graph = _graph(["payload"])

    handle(app, synced_draft_workflow=draft)

    assert set(_bindings(sqlite_session_factory, app.id)) == {"hook", "payload"}


@pytest.mark.parametrize("deleted", [Workflow, App])
def test_reconcile_treats_a_deleted_app_or_draft_as_reconciled(
    sqlite_session_factory: sessionmaker[Session], webhook_seed: WebhookSeed, deleted: type[Workflow] | type[App]
) -> None:
    app, draft = _detached(sqlite_session_factory, webhook_seed)
    draft.graph = _graph(["new"])
    with sqlite_session_factory.begin() as session:
        target_id = webhook_seed.draft_id if deleted is Workflow else webhook_seed.app_id
        session.execute(delete(deleted).where(deleted.id == target_id))

    handle(app, synced_draft_workflow=draft, reconcile_current_draft=True)

    assert set(_bindings(sqlite_session_factory, app.id)) == {"hook"}


def test_reconcile_swallows_an_app_deleted_after_the_draft_re_read(
    sqlite_session_factory: sessionmaker[Session], webhook_seed: WebhookSeed, monkeypatch: pytest.MonkeyPatch
) -> None:
    app, draft = _detached(sqlite_session_factory, webhook_seed)
    with sqlite_session_factory.begin() as session:
        session.execute(delete(App).where(App.id == webhook_seed.app_id))
    # The draft re-read happened before the deletion committed.
    monkeypatch.setattr(sync_webhook_when_app_created, "_current_draft_webhook_node_ids", lambda *_args: ["new"])

    handle(app, synced_draft_workflow=draft, reconcile_current_draft=True)

    with pytest.raises(WebhookNotFoundError):
        handle(app, synced_draft_workflow=draft)


@pytest.mark.parametrize("current_nodes", [["hook"], []], ids=["all-bound", "no-webhook"])
def test_reconcile_skips_the_locking_writer_when_no_binding_is_missing(
    sqlite_session_factory: sessionmaker[Session],
    webhook_seed: WebhookSeed,
    monkeypatch: pytest.MonkeyPatch,
    current_nodes: list[str],
) -> None:
    """An existing-draft save whose webhook nodes are all bound must not enter the App-locking writer."""
    app, draft = _detached(sqlite_session_factory, webhook_seed)
    with sqlite_session_factory.begin() as session:
        session.execute(
            update(Workflow).where(Workflow.id == webhook_seed.draft_id).values(graph=_graph(current_nodes))
        )

    def unexpected_application_services() -> object:
        raise AssertionError("the binding writer locks the App row and must not run when nothing is missing")

    monkeypatch.setattr(sync_webhook_when_app_created, "application_services", unexpected_application_services)

    handle(app, synced_draft_workflow=draft, reconcile_current_draft=True)

    assert _bindings(sqlite_session_factory, app.id) == {"hook": webhook_seed.webhook_id}
