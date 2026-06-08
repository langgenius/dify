from core.entities.document_task import DocumentTask


def test_document_task_keeps_indexing_identifiers() -> None:
    # Arrange
    document_ids = ("doc-1", "doc-2")

    # Act
    task = DocumentTask(
        tenant_id="tenant-1",
        dataset_id="dataset-1",
        document_ids=document_ids,
    )

    # Assert
    assert task.tenant_id == "tenant-1"
    assert task.dataset_id == "dataset-1"
    assert task.document_ids == document_ids
