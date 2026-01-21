import logging

from events.app_event import app_draft_workflow_was_synced
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

    WebhookService.sync_webhook_relationships(app, synced_draft_workflow)
