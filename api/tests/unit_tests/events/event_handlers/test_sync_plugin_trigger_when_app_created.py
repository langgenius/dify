from types import SimpleNamespace
from typing import cast
from unittest.mock import patch

from events.app_event import app_draft_workflow_was_synced, app_published_workflow_was_updated
from events.event_handlers.sync_plugin_trigger_when_app_created import handle
from models.model import AppMode
from models.workflow import Workflow


def test_syncs_plugin_trigger_relationships_from_published_workflow() -> None:
    app = SimpleNamespace(mode=AppMode.WORKFLOW.value)
    published_workflow = cast(Workflow, object())

    with patch(
        "events.event_handlers.sync_plugin_trigger_when_app_created.TriggerService.sync_plugin_trigger_relationships"
    ) as sync_relationships:
        handle(app, published_workflow=published_workflow)

    sync_relationships.assert_called_once_with(app, published_workflow)


def test_draft_workflow_sync_does_not_register_plugin_trigger_handler() -> None:
    sender = object()

    assert handle not in app_draft_workflow_was_synced.receivers_for(sender)
    assert handle in app_published_workflow_was_updated.receivers_for(sender)
