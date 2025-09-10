from events.app_event import app_draft_workflow_was_synced
from models.model import App, AppMode
from models.workflow import Workflow
from services.webhook_service import WebhookService


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

    # sync webhook relationships in DB
    WebhookService.sync_webhook_relationships(app, synced_draft_workflow)
