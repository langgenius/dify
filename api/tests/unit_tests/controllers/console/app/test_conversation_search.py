import uuid

import sqlalchemy as sa

from controllers.console.app.conversation import _build_conversation_id_search_condition


class TestBuildConversationIdSearchCondition:
    """Test suite for _build_conversation_id_search_condition helper function.

    These tests focus on behavior rather than implementation details.
    They verify that the function returns the correct type of condition
    and that it would match the expected values.
    """

    def test_valid_uuid_creates_equality_condition(self):
        """Test that a valid UUID creates an equality condition (not a pattern match)."""
        test_uuid = "123e4567-e89b-12d3-a456-426614174000"
        keyword_filter = f"%{test_uuid}%"

        condition = _build_conversation_id_search_condition(test_uuid, keyword_filter)

        # Should be a binary expression (comparison)
        assert isinstance(condition, sa.sql.elements.BinaryExpression)

        # The operator should be equality (==), not ILIKE
        # We can check this by verifying the operator type
        assert condition.operator.__name__ == "eq"

    def test_uppercase_uuid_normalized_to_lowercase(self):
        """Test that uppercase UUIDs are normalized to lowercase for comparison."""
        test_uuid_upper = "123E4567-E89B-12D3-A456-426614174000"
        test_uuid_lower = test_uuid_upper.lower()
        keyword_filter = f"%{test_uuid_upper}%"

        condition = _build_conversation_id_search_condition(test_uuid_upper, keyword_filter)

        # Should use equality operator
        assert condition.operator.__name__ == "eq"

        # The right side of the comparison should be the lowercase UUID
        # Access the bound value from the condition
        compiled = condition.compile(compile_kwargs={"literal_binds": True})
        compiled_str = str(compiled)

        # Should contain lowercase UUID, not uppercase
        assert test_uuid_lower in compiled_str.lower()
        assert test_uuid_upper not in compiled_str  # Uppercase should not appear as-is

    def test_mixed_case_uuid_normalized_to_lowercase(self):
        """Test that mixed-case UUIDs are normalized to lowercase."""
        test_uuid_mixed = "123e4567-E89B-12d3-A456-426614174000"
        keyword_filter = f"%{test_uuid_mixed}%"

        condition = _build_conversation_id_search_condition(test_uuid_mixed, keyword_filter)

        # Should use equality operator
        assert condition.operator.__name__ == "eq"

    def test_invalid_uuid_creates_pattern_match_condition(self):
        """Test that an invalid UUID creates a pattern matching condition (ILIKE)."""
        invalid_uuid = "not-a-valid-uuid"
        keyword_filter = f"%{invalid_uuid}%"

        condition = _build_conversation_id_search_condition(invalid_uuid, keyword_filter)

        # Should be a binary expression
        assert isinstance(condition, sa.sql.elements.BinaryExpression)

        # The operator should be ILIKE (case-insensitive pattern match)
        # ILIKE operator name varies by dialect, but it's not equality
        assert condition.operator.__name__ != "eq"

    def test_partial_uuid_uses_pattern_matching(self):
        """Test that a partial UUID string uses pattern matching, not exact match."""
        partial_uuid = "123e4567"
        keyword_filter = f"%{partial_uuid}%"

        condition = _build_conversation_id_search_condition(partial_uuid, keyword_filter)

        # Should NOT use equality operator (since it's not a valid UUID)
        assert condition.operator.__name__ != "eq"

    def test_empty_string_uses_pattern_matching(self):
        """Test that an empty string uses pattern matching."""
        empty_string = ""
        keyword_filter = f"%{empty_string}%"

        condition = _build_conversation_id_search_condition(empty_string, keyword_filter)

        # Should NOT use equality operator
        assert condition.operator.__name__ != "eq"

    def test_special_characters_use_pattern_matching(self):
        """Test that strings with special characters use pattern matching."""
        special_chars = "test%search_"
        keyword_filter = f"%{special_chars}%"

        condition = _build_conversation_id_search_condition(special_chars, keyword_filter)

        # Should NOT use equality operator
        assert condition.operator.__name__ != "eq"

    def test_uuid_with_braces_creates_equality_condition(self):
        """Test that a UUID with braces is recognized as valid and uses equality."""
        uuid_with_braces = "{123e4567-e89b-12d3-a456-426614174000}"
        keyword_filter = f"%{uuid_with_braces}%"

        condition = _build_conversation_id_search_condition(uuid_with_braces, keyword_filter)

        # Python's UUID class accepts braces, so should use equality
        assert condition.operator.__name__ == "eq"

    def test_uuid_without_hyphens_creates_equality_condition(self):
        """Test that a UUID without hyphens (hex format) uses equality."""
        uuid_no_hyphens = "123e4567e89b12d3a456426614174000"
        keyword_filter = f"%{uuid_no_hyphens}%"

        condition = _build_conversation_id_search_condition(uuid_no_hyphens, keyword_filter)

        # Python's UUID class accepts hex format, so should use equality
        assert condition.operator.__name__ == "eq"

    def test_none_uses_pattern_matching(self):
        """Test that None is handled gracefully and uses pattern matching."""
        keyword_filter = "%%"

        condition = _build_conversation_id_search_condition(None, keyword_filter)

        # Should NOT use equality operator (None is not a valid UUID)
        assert condition.operator.__name__ != "eq"

    def test_random_valid_uuid_creates_equality_condition(self):
        """Test with a randomly generated valid UUID."""
        test_uuid = str(uuid.uuid4())
        keyword_filter = f"%{test_uuid}%"

        condition = _build_conversation_id_search_condition(test_uuid, keyword_filter)

        # Should use equality operator
        assert condition.operator.__name__ == "eq"

    def test_single_character_uses_pattern_matching(self):
        """Test that a single character search uses pattern matching."""
        single_char = "a"
        keyword_filter = f"%{single_char}%"

        condition = _build_conversation_id_search_condition(single_char, keyword_filter)

        # Should NOT use equality operator
        assert condition.operator.__name__ != "eq"

    def test_partial_uuid_with_sql_wildcards_uses_pattern_matching(self):
        """Test that partial UUIDs with SQL wildcard characters use pattern matching."""
        partial_with_wildcards = "123e%567"
        keyword_filter = f"%{partial_with_wildcards}%"

        condition = _build_conversation_id_search_condition(partial_with_wildcards, keyword_filter)

        # Should NOT use equality operator (not a valid UUID)
        assert condition.operator.__name__ != "eq"

    def test_partial_uuid_with_underscore_uses_pattern_matching(self):
        """Test that partial UUIDs with underscore use pattern matching."""
        partial_with_underscore = "123e_567"
        keyword_filter = f"%{partial_with_underscore}%"

        condition = _build_conversation_id_search_condition(partial_with_underscore, keyword_filter)

        # Should NOT use equality operator
        assert condition.operator.__name__ != "eq"

    def test_case_insensitive_uuid_comparison(self):
        """Test that uppercase and lowercase UUIDs both use equality with lowercase normalization."""
        test_uuid = "123e4567-e89b-12d3-a456-426614174000"
        test_uuid_upper = test_uuid.upper()
        keyword_filter_lower = f"%{test_uuid}%"
        keyword_filter_upper = f"%{test_uuid_upper}%"

        condition_lower = _build_conversation_id_search_condition(test_uuid, keyword_filter_lower)
        condition_upper = _build_conversation_id_search_condition(test_uuid_upper, keyword_filter_upper)

        # Both should use equality operator
        assert condition_lower.operator.__name__ == "eq"
        assert condition_upper.operator.__name__ == "eq"

        # Both should normalize to lowercase
        compiled_lower = str(condition_lower.compile(compile_kwargs={"literal_binds": True}))
        compiled_upper = str(condition_upper.compile(compile_kwargs={"literal_binds": True}))

        # Both should contain the lowercase UUID
        assert test_uuid.lower() in compiled_lower.lower()
        assert test_uuid.lower() in compiled_upper.lower()

    def test_uuid_with_urn_prefix_creates_equality_condition(self):
        """Test that a UUID with URN prefix uses equality."""
        uuid_with_urn = "urn:uuid:123e4567-e89b-12d3-a456-426614174000"
        keyword_filter = f"%{uuid_with_urn}%"

        condition = _build_conversation_id_search_condition(uuid_with_urn, keyword_filter)

        # Python's UUID class accepts URN format, so should use equality
        assert condition.operator.__name__ == "eq"

    def test_very_short_partial_uuid_uses_pattern_matching(self):
        """Test that very short partial UUIDs use pattern matching."""
        short_partial = "12"
        keyword_filter = f"%{short_partial}%"

        condition = _build_conversation_id_search_condition(short_partial, keyword_filter)

        # Should NOT use equality operator
        assert condition.operator.__name__ != "eq"

    def test_uuid_like_but_invalid_length_uses_pattern_matching(self):
        """Test that UUID-like strings with invalid length use pattern matching."""
        invalid_length = "123e4567-e89b-12d3-a456-42661417400"  # One digit short
        keyword_filter = f"%{invalid_length}%"

        condition = _build_conversation_id_search_condition(invalid_length, keyword_filter)

        # Should NOT use equality operator (not a valid UUID)
        assert condition.operator.__name__ != "eq"

    def test_very_long_invalid_string_uses_pattern_matching(self):
        """Test that very long invalid strings use pattern matching."""
        long_string = "a" * 100
        keyword_filter = f"%{long_string}%"

        condition = _build_conversation_id_search_condition(long_string, keyword_filter)

        # Should NOT use equality operator
        assert condition.operator.__name__ != "eq"

    def test_condition_references_conversation_id_column(self):
        """Test that the condition references the Conversation.id column."""
        test_uuid = str(uuid.uuid4())
        keyword_filter = f"%{test_uuid}%"

        condition = _build_conversation_id_search_condition(test_uuid, keyword_filter)

        # The left side should reference Conversation.id
        # This verifies we're comparing against the right column
        assert hasattr(condition.left, "key") or hasattr(condition.left, "name")
        # For cast expressions, we need to check the inner element
        if hasattr(condition.left, "clause"):
            # It's a cast expression
            assert condition.left.clause.key == "id" or str(condition.left.clause).endswith(".id")
        else:
            # It's a direct column reference
            assert condition.left.key == "id" or str(condition.left).endswith(".id")
