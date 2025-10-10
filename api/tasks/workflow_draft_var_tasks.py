"""
Celery tasks for asynchronous workflow execution storage operations.

These tasks provide asynchronous storage capabilities for workflow execution data,
improving performance by offloading storage operations to background workers.
"""

from celery import shared_task  # type: ignore[import-untyped]
from sqlalchemy.orm import Session

from extensions.ext_database import db
from services.workflow_draft_variable_service import DraftVarFileDeletion, WorkflowDraftVariableService


@shared_task(queue="workflow_draft_var", bind=True, max_retries=3, default_retry_delay=60)
def save_workflow_execution_task(
    self,
    deletions: list[DraftVarFileDeletion],
):
    with Session(bind=db.engine) as session, session.begin():
        srv = WorkflowDraftVariableService(session=session)
        srv.delete_workflow_draft_variable_file(deletions=deletions)
