from core.entities.embedding_type import EmbeddingInputType


def test_embedding_input_type_values_are_stable() -> None:
    # Arrange / Act / Assert
    assert EmbeddingInputType.DOCUMENT.value == "document"
    assert EmbeddingInputType.QUERY.value == "query"
