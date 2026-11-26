from sqlalchemy.orm import Session

from constants.trigger import TRIGGER_WEBHOOK_NODE_TYPE
from events.app_event import app_draft_workflow_was_synced, app_published_workflow_was_updated
from extensions.ext_application_services import application_services
from models.model import App, AppMode
from models.workflow import Workflow


@app_draft_workflow_was_synced.connect
def handle(sender: App, synced_draft_workflow: Workflow, **kwargs: object) -> None:
    if sender.mode != AppMode.WORKFLOW.value:
        return
    application_services().triggers.webhook_draft_bindings.sync(
        tenant_id=sender.tenant_id,
        app_id=sender.id,
        created_by=sender.created_by,
        node_ids=[node_id for node_id, _ in synced_draft_workflow.walk_nodes(TRIGGER_WEBHOOK_NODE_TYPE)],
    )


@app_published_workflow_was_updated.connect
def handle_published(sender: App, published_workflow: Workflow, *, session: Session, **kwargs: object) -> None:
    if sender.mode != AppMode.WORKFLOW.value:
        return
    application_services().triggers.create_webhook_publication_service(session).sync(
        tenant_id=sender.tenant_id,
        app_id=sender.id,
        created_by=sender.created_by,
        node_ids=[node_id for node_id, _ in published_workflow.walk_nodes(TRIGGER_WEBHOOK_NODE_TYPE)],
    )
