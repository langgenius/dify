from sqlalchemy import select
from sqlalchemy.orm import Session

from constants.trigger import TRIGGER_WEBHOOK_NODE_TYPE
from core.db.session_factory import session_factory
from events.app_event import app_draft_workflow_was_synced, app_published_workflow_was_updated
from extensions.ext_application_services import application_services
from models.model import App, AppMode
from models.workflow import Workflow
from services.trigger.webhook_service import WebhookNotFoundError


def _current_draft_webhook_node_ids(app: App, workflow_id: str) -> list[str] | None:
    """Return webhook node ids of the app's current draft row, or None when the app or draft is gone."""
    with session_factory.create_session() as session:
        current = session.scalar(
            select(Workflow)
            .join(App, App.id == Workflow.app_id)
            .where(
                App.id == app.id,
                App.tenant_id == app.tenant_id,
                Workflow.id == workflow_id,
                Workflow.app_id == app.id,
                Workflow.tenant_id == app.tenant_id,
                Workflow.version == Workflow.VERSION_DRAFT,
            )
        )
        if current is None:
            return None
        return [node_id for node_id, _ in current.walk_nodes(TRIGGER_WEBHOOK_NODE_TYPE)]


@app_draft_workflow_was_synced.connect
def handle(sender: App, synced_draft_workflow: Workflow, **kwargs: object) -> None:
    if sender.mode != AppMode.WORKFLOW.value:
        return
    reconcile_current_draft = bool(kwargs.get("reconcile_current_draft"))
    if reconcile_current_draft:
        # Durable draft coordination can deliver after later edits or after deletion.
        # Sync the draft row as it is now; a vanished app or draft is already reconciled.
        node_ids = _current_draft_webhook_node_ids(sender, synced_draft_workflow.id)
        if node_ids is None:
            return
    else:
        node_ids = [node_id for node_id, _ in synced_draft_workflow.walk_nodes(TRIGGER_WEBHOOK_NODE_TYPE)]
    try:
        application_services().triggers.webhook_draft_bindings.sync(
            tenant_id=sender.tenant_id,
            app_id=sender.id,
            created_by=sender.created_by,
            node_ids=node_ids,
        )
    except WebhookNotFoundError:
        # The app can be deleted between the re-read and the locked sync; retrying cannot succeed.
        if not reconcile_current_draft:
            raise


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
