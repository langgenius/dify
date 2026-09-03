from types import SimpleNamespace
from unittest.mock import patch

from events.event_handlers.sync_plugin_trigger_when_app_created import handle
from models.model import AppMode


def test_syncs_plugin_trigger_relationships_from_published_workflow() -> None:
    app = SimpleNamespace(mode=AppMode.WORKFLOW.value)
    published_workflow = object()

    with patch(
        "events.event_handlers.sync_plugin_trigger_when_app_created.TriggerService.sync_plugin_trigger_relationships"
    ) as sync_relationships:
        handle(app, published_workflow=published_workflow)

    sync_relationships.assert_called_once_with(app, published_workflow)


def test_keeps_draft_workflow_relationship_sync() -> None:
    app = SimpleNamespace(mode=AppMode.WORKFLOW.value)
    draft_workflow = object()

    with patch(
        "events.event_handlers.sync_plugin_trigger_when_app_created.TriggerService.sync_plugin_trigger_relationships"
    ) as sync_relationships:
        handle(app, synced_draft_workflow=draft_workflow)

    sync_relationships.assert_called_once_with(app, draft_workflow)
