"""Publishing an app's draft workflow for openapi, as the console publish route does."""

from __future__ import annotations

import json
import logging

from sqlalchemy.orm import Session

from libs.datetime_utils import naive_utc_now
from models import Account, App
from models.workflow import Workflow
from services.workflow_service import WorkflowService
from services.workflow_variable_reference_validator import (
    format_variable_reference_errors,
    validate_variable_references,
)

logger = logging.getLogger(__name__)


def publish_app_workflow(
    *, session: Session, app_model: App, account: Account, marked_name: str, marked_comment: str
) -> Workflow:
    """Publish the draft as a new version and make the app use it."""
    workflow = WorkflowService().publish_workflow(
        session=session,
        app_model=app_model,
        account=account,
        marked_name=marked_name,
        marked_comment=marked_comment,
    )
    app_in_session = session.get(App, app_model.id)
    if app_in_session:
        app_in_session.workflow_id = workflow.id
        app_in_session.updated_by = account.id
        app_in_session.updated_at = naive_utc_now()
    return workflow


def variable_reference_warning(graph_text: str | None) -> str | None:
    """A non-blocking publish warning. A checker failure must not fail publish."""
    if not graph_text:
        return None
    try:
        graph = json.loads(graph_text)
        if not isinstance(graph, dict):
            return None
        issues = validate_variable_references(graph)
        return format_variable_reference_errors(issues) if issues else None
    except Exception:
        logger.warning("Skipped advisory variable reference check", exc_info=True)
        return None
