"""Unit tests for FilterRuleLoader and EntityExtraction"""

import pytest

from core.rag.filter.filter_rule_loader import EntityExtraction


class TestEntityExtraction:
    """Test EntityExtraction matching logic"""

    def test_exact_attribute_match(self):
        """Test exact attribute matching (case insensitive)"""
        query = EntityExtraction(
            base_entity="e5q", attributes=["75寸", "黑色"], all_entities=["e5q"], is_comparison=False
        )
        doc = EntityExtraction(
            base_entity="e5q", attributes=["75寸", "黑色", "8GB"], all_entities=["e5q"], is_comparison=False
        )
        assert query.matches(doc) is True

    def test_fuzzy_numeric_attribute_match(self):
        """Test fuzzy matching for numeric attributes: '75' should match '75寸'"""
        query = EntityExtraction(base_entity="e5q", attributes=["75寸"], all_entities=["e5q"], is_comparison=False)
        doc = EntityExtraction(base_entity="e5q", attributes=["75"], all_entities=["e5q"], is_comparison=False)
        # Query has "75寸", doc has "75" - should match via fuzzy matching
        assert query.matches(doc) is True

    def test_fuzzy_numeric_attribute_match_gb(self):
        """Test fuzzy matching for GB attributes: '8' should match '8GB'"""
        query = EntityExtraction(base_entity="phone", attributes=["8GB"], all_entities=["phone"], is_comparison=False)
        doc = EntityExtraction(base_entity="phone", attributes=["8"], all_entities=["phone"], is_comparison=False)
        assert query.matches(doc) is True

    def test_fuzzy_numeric_attribute_no_match_different_numbers(self):
        """Test that different numbers don't match"""
        query = EntityExtraction(base_entity="e5q", attributes=["75寸"], all_entities=["e5q"], is_comparison=False)
        doc = EntityExtraction(base_entity="e5q", attributes=["65寸"], all_entities=["e5q"], is_comparison=False)
        assert query.matches(doc) is False

    def test_fuzzy_numeric_attribute_no_match_different_numbers_plain(self):
        """Test that different plain numbers don't match"""
        query = EntityExtraction(base_entity="e5q", attributes=["75寸"], all_entities=["e5q"], is_comparison=False)
        doc = EntityExtraction(base_entity="e5q", attributes=["65"], all_entities=["e5q"], is_comparison=False)
        assert query.matches(doc) is False

    def test_attribute_subset_matching(self):
        """Test that query attributes must be subset of doc attributes"""
        query = EntityExtraction(base_entity="e5q", attributes=["75寸"], all_entities=["e5q"], is_comparison=False)
        doc = EntityExtraction(
            base_entity="e5q", attributes=["75寸", "黑色", "8GB"], all_entities=["e5q"], is_comparison=False
        )
        assert query.matches(doc) is True

    def test_attribute_subset_missing_attribute(self):
        """Test that missing attributes cause no match"""
        query = EntityExtraction(
            base_entity="e5q", attributes=["75寸", "黑色"], all_entities=["e5q"], is_comparison=False
        )
        doc = EntityExtraction(base_entity="e5q", attributes=["75寸"], all_entities=["e5q"], is_comparison=False)
        # Query wants "黑色" but doc doesn't have it
        assert query.matches(doc) is False

    def test_case_insensitive_matching(self):
        """Test case-insensitive attribute matching"""
        query = EntityExtraction(base_entity="E5Q", attributes=["75寸"], all_entities=["E5Q"], is_comparison=False)
        doc = EntityExtraction(base_entity="e5q", attributes=["75寸"], all_entities=["e5q"], is_comparison=False)
        assert query.matches(doc) is True

    def test_no_attributes(self):
        """Test matching when query has no attributes"""
        query = EntityExtraction(base_entity="e5q", attributes=[], all_entities=["e5q"], is_comparison=False)
        doc = EntityExtraction(
            base_entity="e5q", attributes=["75寸", "黑色"], all_entities=["e5q"], is_comparison=False
        )
        assert query.matches(doc) is True

    def test_comparison_mode_match(self):
        """Test comparison mode: doc entity matches one of query entities"""
        query = EntityExtraction(
            base_entity="p20",  # First entity as base
            attributes=[],
            all_entities=["p20", "p20 plus"],
            is_comparison=True,
        )
        doc = EntityExtraction(base_entity="p20", attributes=[], all_entities=["p20"], is_comparison=False)
        assert query.matches(doc) is True

    def test_comparison_mode_no_match(self):
        """Test comparison mode: doc entity doesn't match any query entities"""
        query = EntityExtraction(
            base_entity="p20",
            attributes=[],
            all_entities=["p20", "p20 plus"],
            is_comparison=True,
        )
        doc = EntityExtraction(base_entity="p30", attributes=[], all_entities=["p30"], is_comparison=False)
        assert query.matches(doc) is False

    def test_extract_number_from_attribute(self):
        """Test _extract_number static method"""
        assert EntityExtraction._extract_number("75寸") == "75"
        assert EntityExtraction._extract_number("8GB") == "8"
        assert EntityExtraction._extract_number("512TB") == "512"
        assert EntityExtraction._extract_number("75") == "75"
        assert EntityExtraction._extract_number("黑色") is None
        assert EntityExtraction._extract_number("color") is None

    def test_mixed_fuzzy_and_exact_matching(self):
        """Test combination of fuzzy and exact attribute matching"""
        query = EntityExtraction(
            base_entity="e5q", attributes=["75寸", "黑色"], all_entities=["e5q"], is_comparison=False
        )
        doc = EntityExtraction(
            base_entity="e5q",
            attributes=["75", "黑色"],  # "75" should fuzzy match "75寸"
            all_entities=["e5q"],
            is_comparison=False,
        )
        assert query.matches(doc) is True

    def test_reverse_fuzzy_match(self):
        """Test reverse fuzzy match: doc has '75寸', query has '75'"""
        query = EntityExtraction(base_entity="e5q", attributes=["75"], all_entities=["e5q"], is_comparison=False)
        doc = EntityExtraction(base_entity="e5q", attributes=["75寸"], all_entities=["e5q"], is_comparison=False)
        # Both should match via fuzzy matching (number extraction)
        assert query.matches(doc) is True

    def test_query_e5q_should_not_match_doc_e5q_pro(self):
        """Test that query 'e5q' should NOT match document 'e5q pro'"""
        query = EntityExtraction(base_entity="e5q", attributes=[], all_entities=["e5q"], is_comparison=False)
        doc = EntityExtraction(base_entity="e5q pro", attributes=[], all_entities=["e5q pro"], is_comparison=False)

        # Query "e5q" should NOT match doc "e5q pro" (different products)
        assert query.matches(doc) is False


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
