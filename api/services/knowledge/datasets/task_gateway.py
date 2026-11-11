"""Celery delivery owned by dataset application adapters."""

import logging

from sqlalchemy import event
from sqlalchemy.orm import Session

from services.knowledge.datasets.contracts import DatasetIndexAction
from services.knowledge.entities.datasets import DatasetCleanupRecord

logger = logging.getLogger(__name__)


def dispatch_dataset_cleanup(cleanup: DatasetCleanupRecord) -> None:
    """Publish the established dataset cleanup message after deletion commits."""

    from tasks.clean_dataset_task import clean_dataset_task

    clean_dataset_task.delay(
        cleanup.id,
        cleanup.workspace_id,
        cleanup.indexing_technique,
        cleanup.index_struct,
        cleanup.collection_binding_id,
        cleanup.doc_form,
        cleanup.pipeline_id,
    )


def dispatch_dataset_index_update_after_commit(
    session: Session,
    *,
    dataset_id: str,
    action: DatasetIndexAction | None,
    from_rag_pipeline: bool,
) -> None:
    """Publish legacy dataset indexing work after the owning transaction commits."""

    if action is None:
        return
    action_value = action.value

    def dispatch(_committed_session: Session) -> None:
        try:
            if from_rag_pipeline:
                from tasks.deal_dataset_index_update_task import deal_dataset_index_update_task

                deal_dataset_index_update_task.delay(dataset_id, action_value)
                return

            from tasks.deal_dataset_vector_index_task import deal_dataset_vector_index_task

            deal_dataset_vector_index_task.delay(dataset_id, action_value)
            if action is DatasetIndexAction.UPDATE:
                from tasks.regenerate_summary_index_task import regenerate_summary_index_task

                regenerate_summary_index_task.delay(
                    dataset_id,
                    regenerate_reason="embedding_model_changed",
                    regenerate_vectors_only=True,
                )
        except Exception:
            logger.exception("Failed to dispatch dataset index update for dataset %s", dataset_id)
            raise

    event.listen(session, "after_commit", dispatch, once=True)
