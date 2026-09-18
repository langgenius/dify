import logging

from events.app_event import app_draft_workflow_was_synced, app_published_workflow_was_updated
from models.model import App, AppMode
from models.workflow import Workflow
from services.trigger.webhook_service import WebhookService

logger = logging.getLogger(__name__)


@app_draft_workflow_was_synced.connect
def handle(sender, synced_draft_workflow: Workflow, **kwargs):
    """
    While creating a workflow or updating a workflow, we may need to sync
    its webhook relationships in DB.
    """
    app: App = sender
    if app.mode != AppMode.WORKFLOW.value:
        # only handle workflow app, chatflow is not supported yet
        return

    WebhookService.sync_webhook_relationships(app, synced_draft_workflow, remove_stale=False)


@app_published_workflow_was_updated.connect
def handle_published(sender, published_workflow: Workflow, **kwargs):
    """Remove stale webhook relationships after their node deletion is published."""
    app: App = sender
    if app.mode != AppMode.WORKFLOW.value:
        return

    WebhookService.sync_webhook_relationships(app, published_workflow, remove_stale=True)
