import pytest

from core.rag.index_processor.constant.index_type import IndexTechniqueType
from services.knowledge.entities.knowledge_entities import KnowledgeConfig


@pytest.mark.parametrize(
    ("technique", "wire_value"),
    [(IndexTechniqueType.ECONOMY, "economy"), (IndexTechniqueType.HIGH_QUALITY, "high_quality")],
)
def test_indexing_technique_preserves_enum_and_json(technique: IndexTechniqueType, wire_value: str) -> None:
    """Given either supported technique, retain the enum and preserve its public JSON value."""
    config = KnowledgeConfig(indexing_technique=technique)

    assert config.indexing_technique is technique
    assert config.model_dump(mode="json")["indexing_technique"] == wire_value
    assert KnowledgeConfig.model_validate({"indexing_technique": wire_value}).indexing_technique is technique
    assert KnowledgeConfig.model_validate_json(config.model_dump_json()).indexing_technique is technique
