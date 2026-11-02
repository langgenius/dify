import logging

from events.app_event import app_published_workflow_was_updated
from models.model import App, AppMode
from models.workflow import Workflow
from services.trigger.trigger_service import TriggerService

logger = logging.getLogger(__name__)


@app_published_workflow_was_updated.connect
def handle(
    sender,
    published_workflow: Workflow | None = None,
    **kwargs,
):
    """
    Sync plugin trigger relationships when a workflow is published.

    Production trigger dispatch relies on these relationships; debug dispatch
    uses the workflow graph directly.
    """
    app: App = sender
    if app.mode != AppMode.WORKFLOW.value:
        # only handle workflow app, chatflow is not supported yet
        return

    if published_workflow is None:
        return

    TriggerService.sync_plugin_trigger_relationships(app, published_workflow)
