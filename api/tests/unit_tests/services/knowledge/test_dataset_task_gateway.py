from unittest.mock import patch

from sqlalchemy.orm import Session, sessionmaker

from services.knowledge.datasets.contracts import DatasetIndexAction
from services.knowledge.datasets.task_gateway import (
    dispatch_dataset_cleanup,
    dispatch_dataset_index_update_after_commit,
)
from services.knowledge.entities.datasets import DatasetCleanupRecord


def test_dataset_cleanup_preserves_legacy_task_arguments() -> None:
    cleanup = DatasetCleanupRecord(
        "dataset-1",
        "tenant-1",
        "high_quality",
        "index-struct",
        "binding-1",
        "hierarchical_model",
        "pipeline-1",
    )

    with patch("tasks.clean_dataset_task.clean_dataset_task.delay") as task:
        dispatch_dataset_cleanup(cleanup)

    task.assert_called_once_with(
        "dataset-1",
        "tenant-1",
        "high_quality",
        "index-struct",
        "binding-1",
        "hierarchical_model",
        "pipeline-1",
    )


def test_dataset_index_tasks_publish_only_after_commit(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with (
        patch("tasks.deal_dataset_vector_index_task.deal_dataset_vector_index_task.delay") as vector,
        patch("tasks.regenerate_summary_index_task.regenerate_summary_index_task.delay") as summary,
    ):
        with sqlite_session_factory.begin() as session:
            dispatch_dataset_index_update_after_commit(
                session,
                dataset_id="dataset-1",
                action=DatasetIndexAction.UPDATE,
                from_rag_pipeline=False,
            )
            vector.assert_not_called()
            summary.assert_not_called()

        vector.assert_called_once_with("dataset-1", DatasetIndexAction.UPDATE.value)
        summary.assert_called_once_with(
            "dataset-1",
            regenerate_reason="embedding_model_changed",
            regenerate_vectors_only=True,
        )


def test_rag_pipeline_index_task_uses_pipeline_task_owner(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with patch("tasks.deal_dataset_index_update_task.deal_dataset_index_update_task.delay") as task:
        with sqlite_session_factory.begin() as session:
            dispatch_dataset_index_update_after_commit(
                session,
                dataset_id="dataset-1",
                action=DatasetIndexAction.REMOVE,
                from_rag_pipeline=True,
            )
        task.assert_called_once_with("dataset-1", DatasetIndexAction.REMOVE.value)
