"""Shared helpers for restoring published workflow snapshots into drafts.

Both app workflows and RAG pipeline workflows restore the same workflow fields
from a published snapshot into a draft. Keeping that field-copy logic in one
place prevents the two restore paths from drifting when we add or adjust draft
state in the future.
"""

from collections.abc import Callable
from datetime import datetime

from models import Account
from models.workflow import Workflow, WorkflowType

UpdatedAtFactory = Callable[[], datetime]


def apply_published_workflow_snapshot_to_draft(
    *,
    tenant_id: str,
    app_id: str,
    source_workflow: Workflow,
    draft_workflow: Workflow | None,
    account: Account,
    updated_at_factory: UpdatedAtFactory,
) -> tuple[Workflow, bool]:
    """Copy a published workflow snapshot into a draft workflow record.

    The caller remains responsible for source lookup, validation, flushing, and
    post-commit side effects. This helper only centralizes the shared draft
    creation/update semantics used by both restore entry points.
    """
    restored_environment_variables = list(source_workflow.environment_variables)
    restored_conversation_variables = list(source_workflow.conversation_variables)
    restored_rag_pipeline_variables = list(source_workflow.rag_pipeline_variables)

    if not draft_workflow:
        workflow_type = (
            source_workflow.type.value if isinstance(source_workflow.type, WorkflowType) else source_workflow.type
        )
        draft_workflow = Workflow(
            tenant_id=tenant_id,
            app_id=app_id,
            type=workflow_type,
            version=Workflow.VERSION_DRAFT,
            graph=source_workflow.graph,
            features=source_workflow.features,
            created_by=account.id,
            environment_variables=restored_environment_variables,
            conversation_variables=restored_conversation_variables,
        )
        draft_workflow.rag_pipeline_variables = restored_rag_pipeline_variables
        return draft_workflow, True

    draft_workflow.graph = source_workflow.graph
    draft_workflow.features = source_workflow.features
    draft_workflow.updated_by = account.id
    draft_workflow.updated_at = updated_at_factory()
    draft_workflow.environment_variables = restored_environment_variables
    draft_workflow.conversation_variables = restored_conversation_variables
    draft_workflow.rag_pipeline_variables = restored_rag_pipeline_variables

    return draft_workflow, False
