from core.entities.knowledge_entities import (
    PipelineDataset,
    PipelineDocument,
    PipelineGenerateResponse,
)


def test_pipeline_dataset_normalizes_none_description() -> None:
    # Arrange / Act
    dataset = PipelineDataset(
        id="dataset-1",
        name="Dataset",
        description=None,
        chunk_structure="parent-child",
    )

    # Assert
    assert dataset.description == ""


def test_pipeline_generate_response_builds_nested_models() -> None:
    # Arrange
    dataset = PipelineDataset(
        id="dataset-1",
        name="Dataset",
        description="Knowledge base",
        chunk_structure="parent-child",
    )
    document = PipelineDocument(
        id="doc-1",
        position=1,
        data_source_type="file",
        data_source_info={"name": "spec.pdf"},
        name="spec.pdf",
        indexing_status="completed",
        enabled=True,
    )

    # Act
    response = PipelineGenerateResponse(batch="batch-1", dataset=dataset, documents=[document])

    # Assert
    assert response.batch == "batch-1"
    assert response.dataset.id == "dataset-1"
    assert response.documents[0].id == "doc-1"
