"""Contract coverage for the legacy batch-clean message adapter."""

from unittest.mock import patch

import pytest

from tasks.batch_clean_document_task import batch_clean_document_task


def test_batch_clean_document_task_preserves_four_field_message() -> None:
    with patch("tasks.batch_clean_document_task._clean_documents", autospec=True) as clean_documents:
        batch_clean_document_task(
            document_ids=["document-1", "document-2"],
            dataset_id="dataset-1",
            doc_form="text_model",
            file_ids=["file-1"],
        )

    clean_documents.assert_called_once_with(
        document_ids=["document-1", "document-2"],
        dataset_id="dataset-1",
        doc_form="text_model",
        file_ids=["file-1"],
    )


def test_batch_clean_document_task_rejects_missing_document_form() -> None:
    with (
        patch("tasks.batch_clean_document_task._clean_documents", autospec=True) as clean_documents,
        pytest.raises(ValueError, match="doc_form is required"),
    ):
        batch_clean_document_task(
            document_ids=["document-1"],
            dataset_id="dataset-1",
            doc_form=None,
            file_ids=[],
        )

    clean_documents.assert_not_called()
