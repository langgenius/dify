from types import SimpleNamespace
from typing import cast
from unittest.mock import patch

from events.event_handlers import sync_webhook_when_app_created
from events.event_handlers.sync_webhook_when_app_created import handle
from models.model import App
from models.workflow import Workflow


def test_draft_sync_preserves_stale_webhook_relationships() -> None:
    app = cast(App, SimpleNamespace(mode="workflow"))
    workflow = cast(Workflow, SimpleNamespace())

    with patch(
        "events.event_handlers.sync_webhook_when_app_created.WebhookService.sync_webhook_relationships"
    ) as sync_webhook_relationships:
        handle(app, synced_draft_workflow=workflow)

    sync_webhook_relationships.assert_called_once_with(app, workflow, remove_stale=False)


def test_published_sync_removes_stale_webhook_relationships() -> None:
    app = cast(App, SimpleNamespace(mode="workflow"))
    workflow = cast(Workflow, SimpleNamespace())

    with patch(
        "events.event_handlers.sync_webhook_when_app_created.WebhookService.sync_webhook_relationships"
    ) as sync_webhook_relationships:
        sync_webhook_when_app_created.handle_published(app, published_workflow=workflow)

    sync_webhook_relationships.assert_called_once_with(app, workflow, remove_stale=True)
