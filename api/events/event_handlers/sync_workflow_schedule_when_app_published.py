"""Synchronize scheduled execution in the caller's publication transaction."""

import json

from sqlalchemy.orm import Session

from core.workflow.nodes.trigger_schedule.exc import ScheduleConfigError
from events.app_event import app_published_workflow_was_updated
from extensions.ext_application_services import application_services
from models.model import App, AppMode
from models.workflow import Workflow


@app_published_workflow_was_updated.connect
def handle(sender: App, *, session: Session, published_workflow: Workflow | None = None, **kwargs: object) -> None:
    if sender.mode != AppMode.WORKFLOW or published_workflow is None:
        return
    try:
        graph = published_workflow.graph_dict
    except (json.JSONDecodeError, TypeError, AttributeError) as exc:
        raise ScheduleConfigError(f"Failed to parse workflow graph: {exc}") from exc
    application_services().triggers.create_schedule_publication_service(session).sync(
        tenant_id=sender.tenant_id, app_id=sender.id, graph=graph
    )
