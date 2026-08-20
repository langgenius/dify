from core.rag.graph.entities import (
    UNKNOWN_ENTITY_TYPE,
    normalize_display_name,
    normalize_entity_name,
)
from core.rag.graph.entity_extractor import EntityRelationExtractor


class TestNormalizeEntityName:
    def test_casefolds_and_collapses_whitespace(self) -> None:
        assert normalize_entity_name("  Acme   Corp ") == "acme corp"

    def test_strips_edge_punctuation(self) -> None:
        assert normalize_entity_name('"Acme Corp."') == "acme corp"

    def test_spelling_variants_merge_to_one_key(self) -> None:
        assert normalize_entity_name("ACME Corp") == normalize_entity_name("acme corp")

    def test_display_name_keeps_original_casing(self) -> None:
        assert normalize_display_name("  Acme   Corp. ") == "Acme Corp"

    def test_unicode_is_normalized(self) -> None:
        # Full-width characters must fold onto their ASCII equivalents so the
        # same company does not become two nodes.
        assert normalize_entity_name("ＡＣＭＥ") == "acme"


class TestParseExtraction:
    def test_parses_plain_json(self) -> None:
        raw = """
        {
          "entities": [
            {"name": "Acme Corp", "type": "ORGANIZATION", "description": "A manufacturer."},
            {"name": "Jane Roe", "type": "PERSON", "description": "The CEO."}
          ],
          "relations": [
            {"source": "Jane Roe", "target": "Acme Corp", "predicate": "leads", "description": "Jane leads Acme."}
          ]
        }
        """
        result = EntityRelationExtractor.parse_extraction(raw)

        assert {entity.name for entity in result.entities} == {"acme corp", "jane roe"}
        assert len(result.relations) == 1
        relation = result.relations[0]
        assert relation.source == "jane roe"
        assert relation.target == "acme corp"
        assert relation.predicate == "leads"

    def test_parses_json_inside_code_fence(self) -> None:
        raw = '```json\n{"entities": [{"name": "Acme", "type": "ORGANIZATION"}], "relations": []}\n```'
        result = EntityRelationExtractor.parse_extraction(raw)

        assert [entity.name for entity in result.entities] == ["acme"]

    def test_malformed_output_yields_empty_extraction(self) -> None:
        result = EntityRelationExtractor.parse_extraction("I could not find any entities, sorry!")

        assert result.entities == []
        assert result.relations == []

    def test_relation_endpoints_are_backfilled_as_entities(self) -> None:
        # The model routinely names a relation endpoint it forgot to list; the
        # edge is worth more than the missing type annotation.
        raw = """
        {
          "entities": [{"name": "Acme", "type": "ORGANIZATION"}],
          "relations": [{"source": "Acme", "target": "Globex", "predicate": "acquired"}]
        }
        """
        result = EntityRelationExtractor.parse_extraction(raw)

        by_name = {entity.name: entity for entity in result.entities}
        assert set(by_name) == {"acme", "globex"}
        assert by_name["globex"].entity_type == UNKNOWN_ENTITY_TYPE
        assert len(result.relations) == 1

    def test_duplicate_entities_merge_keeping_richest_description(self) -> None:
        raw = """
        {
          "entities": [
            {"name": "Acme", "type": "UNKNOWN", "description": "short"},
            {"name": "ACME", "type": "ORGANIZATION", "description": "a much longer description"}
          ],
          "relations": []
        }
        """
        result = EntityRelationExtractor.parse_extraction(raw)

        assert len(result.entities) == 1
        entity = result.entities[0]
        assert entity.description == "a much longer description"
        assert entity.entity_type == "ORGANIZATION"

    def test_self_referential_relations_are_dropped(self) -> None:
        raw = """
        {
          "entities": [{"name": "Acme", "type": "ORGANIZATION"}],
          "relations": [{"source": "Acme", "target": "acme", "predicate": "is"}]
        }
        """
        result = EntityRelationExtractor.parse_extraction(raw)

        assert result.relations == []

    def test_predicate_is_normalized_to_snake_case(self) -> None:
        raw = """
        {
          "entities": [],
          "relations": [{"source": "A", "target": "B", "predicate": "Reports To"}]
        }
        """
        result = EntityRelationExtractor.parse_extraction(raw)

        assert result.relations[0].predicate == "reports_to"

    def test_missing_predicate_falls_back_to_related_to(self) -> None:
        raw = """
        {
          "entities": [],
          "relations": [{"source": "A", "target": "B"}]
        }
        """
        result = EntityRelationExtractor.parse_extraction(raw)

        assert result.relations[0].predicate == "related_to"

    def test_non_dict_items_are_ignored(self) -> None:
        raw = '{"entities": ["just a string", {"name": "Acme"}], "relations": [42]}'
        result = EntityRelationExtractor.parse_extraction(raw)

        assert [entity.name for entity in result.entities] == ["acme"]
        assert result.relations == []

    def test_duplicate_relations_are_deduplicated(self) -> None:
        raw = """
        {
          "entities": [],
          "relations": [
            {"source": "A", "target": "B", "predicate": "owns"},
            {"source": "a", "target": "b", "predicate": "owns"}
          ]
        }
        """
        result = EntityRelationExtractor.parse_extraction(raw)

        assert len(result.relations) == 1
