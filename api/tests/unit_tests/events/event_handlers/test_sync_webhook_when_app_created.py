from unittest.mock import patch

from events.event_handlers.sync_webhook_when_app_created import handle
from models.model import AppMode
from tests.unit_tests.model_factories import make_app, make_workflow


def test_draft_sync_preserves_stale_webhook_relationships() -> None:
    app = make_app(mode=AppMode.WORKFLOW)
    workflow = make_workflow()

    with patch(
        "events.event_handlers.sync_webhook_when_app_created.WebhookService.sync_webhook_relationships"
    ) as sync_webhook_relationships:
        handle(app, synced_draft_workflow=workflow)

    sync_webhook_relationships.assert_called_once_with(app, workflow, remove_stale=False, session_factory=None)
