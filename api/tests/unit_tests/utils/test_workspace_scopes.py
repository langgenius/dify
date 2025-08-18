"""
Unit tests for workspace scope utilities.

Tests pure functions and constants related to workspace scopes.
No external dependencies or database access.
"""

import pytest

from constants.workspace_scopes import (
    SCOPE_CATEGORIES,
    WORKSPACE_API_SCOPES,
    get_scope_description,
    get_valid_scopes,
    validate_scopes,
)


class TestWorkspaceScopes:
    """Unit tests for workspace scope utility functions."""

    def test_get_valid_scopes_returns_all_defined_scopes(self):
        """Test that get_valid_scopes() returns all scopes defined in WORKSPACE_API_SCOPES."""
        # Act
        valid_scopes = get_valid_scopes()

        # Assert
        assert isinstance(valid_scopes, list)
        assert set(valid_scopes) == set(WORKSPACE_API_SCOPES.keys())
        assert len(valid_scopes) == len(WORKSPACE_API_SCOPES)

    def test_get_scope_description_returns_correct_descriptions(self):
        """Test that get_scope_description() returns correct descriptions for all scopes."""
        # Arrange
        valid_scopes = get_valid_scopes()

        for scope in valid_scopes:
            # Act
            description = get_scope_description(scope)

            # Assert
            assert description == WORKSPACE_API_SCOPES[scope]
            assert isinstance(description, str)
            assert len(description) > 0

    def test_get_scope_description_with_invalid_scope(self):
        """Test get_scope_description() with invalid scope."""
        # Act
        description = get_scope_description("invalid:scope")

        # Assert
        assert description == ""  # Returns empty string, not None

    def test_get_scope_description_with_empty_scope(self):
        """Test get_scope_description() with empty scope."""
        # Act
        description = get_scope_description("")

        # Assert
        assert description == ""  # Returns empty string, not None

    def test_get_scope_description_with_none_scope(self):
        """Test get_scope_description() with None scope."""
        # Act
        description = get_scope_description(None)

        # Assert
        assert description == ""  # Returns empty string, not None

    @pytest.mark.parametrize(
        ("scope_list", "expected_valid", "expected_invalid"),
        [
            # Valid cases
            ([], True, []),
            (["workspace:read"], True, []),
            (["workspace:read", "apps:write"], True, []),
            (["workspace:read", "workspace:write"], True, []),  # workspace:admin doesn't exist
            (["apps:read", "apps:write", "apps:admin"], True, []),
            (["members:read", "members:write", "members:admin"], True, []),
            # Invalid cases
            (["invalid:scope"], False, ["invalid:scope"]),
            (["workspace:invalid"], False, ["workspace:invalid"]),
            (["invalid:read"], False, ["invalid:read"]),
            ([""], False, [""]),
            # Mixed cases
            (["workspace:read", "invalid:scope"], False, ["invalid:scope"]),
            (["workspace:read", "apps:write", "invalid:scope", "members:admin"], False, ["invalid:scope"]),
            (["invalid1:scope", "workspace:read", "invalid2:scope"], False, ["invalid1:scope", "invalid2:scope"]),
        ],
    )
    def test_validate_scopes_with_various_inputs(self, scope_list, expected_valid, expected_invalid):
        """Test validate_scopes() with various input combinations."""
        # Act
        is_valid, invalid_scopes = validate_scopes(scope_list)

        # Assert
        assert is_valid == expected_valid
        assert invalid_scopes == expected_invalid

    def test_validate_scopes_with_none_input(self):
        """Test validate_scopes() with None input."""
        # Act & Assert - should raise TypeError
        with pytest.raises(TypeError):
            validate_scopes(None)

    def test_validate_scopes_with_non_list_input(self):
        """Test validate_scopes() with non-list input."""
        # Test with string input - should work as strings are iterable
        is_valid, invalid_scopes = validate_scopes("workspace:read")
        # Each character becomes a scope, so all will be invalid
        assert is_valid is False
        assert len(invalid_scopes) > 0

        # Test with integer input
        with pytest.raises(TypeError):
            validate_scopes(123)

    def test_validate_scopes_with_duplicate_scopes(self):
        """Test validate_scopes() with duplicate scopes in the list."""
        # Act
        is_valid, invalid_scopes = validate_scopes(["workspace:read", "workspace:read", "apps:write"])

        # Assert - duplicates should not affect validation
        assert is_valid is True
        assert invalid_scopes == []

    def test_validate_scopes_with_whitespace_scopes(self):
        """Test validate_scopes() with scopes containing whitespace."""
        # Act
        is_valid, invalid_scopes = validate_scopes([" workspace:read ", "apps:write", "  "])

        # Assert - whitespace should be treated as invalid
        assert is_valid is False
        assert " workspace:read " in invalid_scopes
        assert "  " in invalid_scopes
        assert "apps:write" not in invalid_scopes

    def test_validate_scopes_with_case_sensitivity(self):
        """Test validate_scopes() with different case variations."""
        # Act
        is_valid, invalid_scopes = validate_scopes(["WORKSPACE:READ", "workspace:READ", "Workspace:Read"])

        # Assert - should be case sensitive
        assert is_valid is False
        assert "WORKSPACE:READ" in invalid_scopes
        assert "workspace:READ" in invalid_scopes
        assert "Workspace:Read" in invalid_scopes

    def test_validate_scopes_with_large_scope_list(self):
        """Test validate_scopes() with a large number of scopes."""
        # Arrange - create a large list with valid scopes
        valid_scopes = get_valid_scopes()
        large_scope_list = valid_scopes * 100  # 100 copies of all valid scopes

        # Act
        is_valid, invalid_scopes = validate_scopes(large_scope_list)

        # Assert
        assert is_valid is True
        assert invalid_scopes == []

    def test_workspace_api_scopes_constant_structure(self):
        """Test that WORKSPACE_API_SCOPES constant has expected structure."""
        # Assert
        assert isinstance(WORKSPACE_API_SCOPES, dict)
        assert len(WORKSPACE_API_SCOPES) > 0

        # Check that all keys follow expected format
        for scope, description in WORKSPACE_API_SCOPES.items():
            assert isinstance(scope, str)
            assert isinstance(description, str)
            assert ":" in scope  # Should have resource:permission format
            assert len(description) > 0

            # Check scope format
            parts = scope.split(":")
            assert len(parts) == 2
            resource, permission = parts
            assert resource in ["workspace", "apps", "members"]
            assert permission in ["read", "write", "admin"]

    def test_scope_categories_constant_structure(self):
        """Test that SCOPE_CATEGORIES constant has expected structure."""
        # Assert - SCOPE_CATEGORIES is a dict, not a list
        assert isinstance(SCOPE_CATEGORIES, dict)
        assert len(SCOPE_CATEGORIES) > 0

        # Check structure of each category
        for category_key, category in SCOPE_CATEGORIES.items():
            assert isinstance(category, dict)
            assert "name" in category
            assert "scopes" in category
            assert isinstance(category["name"], str)
            assert isinstance(category["scopes"], list)
            assert len(category["name"]) > 0
            assert len(category["scopes"]) > 0

            # Check that all scopes in category are valid
            for scope in category["scopes"]:
                assert scope in WORKSPACE_API_SCOPES

    def test_all_scopes_covered_by_categories(self):
        """Test that all scopes in WORKSPACE_API_SCOPES are covered by SCOPE_CATEGORIES."""
        # Arrange
        all_categorized_scopes = set()
        for category_key, category in SCOPE_CATEGORIES.items():
            all_categorized_scopes.update(category["scopes"])

        all_defined_scopes = set(WORKSPACE_API_SCOPES.keys())

        # Assert
        assert all_categorized_scopes == all_defined_scopes

    def test_no_duplicate_scopes_in_categories(self):
        """Test that no scope appears in multiple categories."""
        # Arrange
        all_categorized_scopes = []
        for category_key, category in SCOPE_CATEGORIES.items():
            all_categorized_scopes.extend(category["scopes"])

        # Assert
        assert len(all_categorized_scopes) == len(set(all_categorized_scopes))

    def test_scope_hierarchy_consistency(self):
        """Test that scope hierarchy is consistent (read < write < admin)."""
        # Check that for each resource, if admin exists, write and read should exist
        resources = set()
        for scope in WORKSPACE_API_SCOPES:
            resource = scope.split(":")[0]
            resources.add(resource)

        for resource in resources:
            resource_scopes = [s for s in WORKSPACE_API_SCOPES if s.startswith(f"{resource}:")]
            permissions = [s.split(":")[1] for s in resource_scopes]

            # If admin exists, write and read should exist
            if "admin" in permissions:
                assert "write" in permissions, f"Resource {resource} has admin but no write permission"
                assert "read" in permissions, f"Resource {resource} has admin but no read permission"

            # If write exists, read should exist
            if "write" in permissions:
                assert "read" in permissions, f"Resource {resource} has write but no read permission"

    def test_scope_descriptions_are_meaningful(self):
        """Test that all scope descriptions are meaningful and not empty."""
        for scope, description in WORKSPACE_API_SCOPES.items():
            # Assert
            assert len(description.strip()) > 10  # Should be more than just a few words
            assert description != scope  # Description should not be the same as scope
            assert not description.isupper()  # Should not be all caps
            assert not description.islower()  # Should have proper capitalization

    def test_get_valid_scopes_returns_consistent_results(self):
        """Test that get_valid_scopes() returns consistent results across multiple calls."""
        # Act
        result1 = get_valid_scopes()
        result2 = get_valid_scopes()
        result3 = get_valid_scopes()

        # Assert
        assert result1 == result2 == result3
        assert id(result1) != id(result2)  # Should return new list each time, not same object

    def test_get_valid_scopes_returns_list_type(self):
        """Test that get_valid_scopes() returns a list type."""
        # Act
        result = get_valid_scopes()

        # Assert
        assert isinstance(result, list)
        assert not isinstance(result, tuple)
        assert not isinstance(result, set)

    def test_get_valid_scopes_immutability(self):
        """Test that modifying the returned list doesn't affect the original data."""
        # Act
        result = get_valid_scopes()
        original_length = len(result)
        result.append("test:scope")

        # Get a fresh copy
        fresh_result = get_valid_scopes()

        # Assert
        assert len(fresh_result) == original_length
        assert "test:scope" not in fresh_result

    def test_get_scope_description_return_type_consistency(self):
        """Test that get_scope_description() always returns string type."""
        # Test with valid scope
        valid_scope = get_valid_scopes()[0]
        result = get_scope_description(valid_scope)
        assert isinstance(result, str)

        # Test with invalid scope
        result = get_scope_description("invalid:scope")
        assert isinstance(result, str)

        # Test with None
        result = get_scope_description(None)
        assert isinstance(result, str)

        # Test with empty string
        result = get_scope_description("")
        assert isinstance(result, str)

    def test_get_scope_description_with_special_characters(self):
        """Test get_scope_description() with special characters in scope names."""
        # Act & Assert
        assert get_scope_description("scope:with:colons") == ""
        assert get_scope_description("scope with spaces") == ""
        assert get_scope_description("scope@with#symbols") == ""
        assert get_scope_description("scope/with/slashes") == ""

    def test_all_valid_scopes_have_descriptions(self):
        """Test that every scope returned by get_valid_scopes() has a non-empty description."""
        # Arrange
        valid_scopes = get_valid_scopes()

        # Act & Assert
        for scope in valid_scopes:
            description = get_scope_description(scope)
            assert description != "", f"Scope '{scope}' has empty description"
            assert len(description.strip()) > 0, f"Scope '{scope}' has whitespace-only description"

    def test_scope_description_format_consistency(self):
        """Test that all scope descriptions follow consistent format."""
        # Arrange
        valid_scopes = get_valid_scopes()

        # Act & Assert
        for scope in valid_scopes:
            description = get_scope_description(scope)

            # Should start with capital letter
            assert description[0].isupper(), f"Description for '{scope}' should start with capital letter"

            # Should not end with period (based on current format)
            assert not description.endswith("."), f"Description for '{scope}' should not end with period"

            # Should not be exactly the same as the scope name
            assert description.lower() != scope.lower(), f"Description for '{scope}' is identical to scope name"

            # Should contain meaningful words (not just single characters)
            words = description.split()
            assert len(words) >= 2, f"Description for '{scope}' should contain at least 2 words"


class TestWorkspaceApiKeyScopesController:
    """Unit tests for workspace API key scopes controller."""

    def test_workspace_api_key_scopes_api_returns_correct_structure(self):
        """Test that the scopes API returns the correct data structure."""
        from controllers.console.workspace.api_keys import WorkspaceApiKeyScopesApi

        # Unwrap decorators to test the core logic
        raw_get = WorkspaceApiKeyScopesApi.get.__wrapped__.__wrapped__.__wrapped__
        result = raw_get(WorkspaceApiKeyScopesApi())

        # Assert
        assert isinstance(result, dict)
        assert result.get("categories") == SCOPE_CATEGORIES
        assert result.get("scopes") == WORKSPACE_API_SCOPES

        # Verify structure
        assert "categories" in result
        assert "scopes" in result
        assert isinstance(result["categories"], dict)
        assert isinstance(result["scopes"], dict)
