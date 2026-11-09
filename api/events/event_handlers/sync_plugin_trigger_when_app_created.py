from sqlalchemy.orm import Session

from core.trigger.constants import TRIGGER_PLUGIN_NODE_TYPE
from events.app_event import app_published_workflow_was_updated
from extensions.ext_application_services import application_services
from models.model import App, AppMode
from models.workflow import Workflow


@app_published_workflow_was_updated.connect
def handle(
    sender: App,
    *,
    session: Session,
    published_workflow: Workflow | None = None,
    **kwargs: object,
) -> None:
    """Sync production bindings in the same transaction as the published workflow.

    Debug dispatch reads the draft graph directly and does not need these bindings.
    """
    if sender.mode != AppMode.WORKFLOW.value or published_workflow is None:
        return

    application_services().workspaces.create_trigger_binding_service(session).sync(
        tenant_id=sender.tenant_id,
        app_id=sender.id,
        nodes=published_workflow.walk_nodes(TRIGGER_PLUGIN_NODE_TYPE),
    )
