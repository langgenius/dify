"""Register published trigger nodes in the publisher's transaction."""

from sqlalchemy.orm import Session

from events.app_event import app_published_workflow_was_updated
from extensions.ext_application_services import application_services
from models.model import App, AppMode
from models.workflow import Workflow


@app_published_workflow_was_updated.connect
def handle(sender: App, *, session: Session, published_workflow: Workflow | None = None, **kwargs: object) -> None:
    if sender.mode != AppMode.WORKFLOW or published_workflow is None:
        return
    graph = published_workflow.graph_dict
    application_services().apps.create_trigger_publication_service(session).sync(
        tenant_id=sender.tenant_id,
        app_id=sender.id,
        nodes=graph.get("nodes", []),
    )
