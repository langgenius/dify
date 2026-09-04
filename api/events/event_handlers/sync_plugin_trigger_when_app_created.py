import logging

from events.app_event import app_draft_workflow_was_synced, app_published_workflow_was_updated
from models.model import App, AppMode
from models.workflow import Workflow
from services.trigger.trigger_service import TriggerService

logger = logging.getLogger(__name__)


@app_draft_workflow_was_synced.connect
@app_published_workflow_was_updated.connect
def handle(
    sender,
    synced_draft_workflow: Workflow | None = None,
    published_workflow: Workflow | None = None,
    **kwargs,
):
    """
    Sync plugin trigger relationships when a draft changes or is published.

    The published workflow must be reconciled as well because production trigger
    dispatch relies on these relationships, while debug dispatch does not.
    """
    app: App = sender
    if app.mode != AppMode.WORKFLOW.value:
        # only handle workflow app, chatflow is not supported yet
        return

    workflow = published_workflow if published_workflow is not None else synced_draft_workflow
    if workflow is None:
        return

    TriggerService.sync_plugin_trigger_relationships(app, workflow)
