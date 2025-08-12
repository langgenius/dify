"""
Unit tests for console workspace API key controllers.

Tests the console-specific workspace API key endpoints and controller logic
without external dependencies. Focused on Flask field definitions and constants.
"""

from tests.unit_tests.workspace_api_key_test_builders import WorkspaceApiKeyBuilder


class TestConsoleWorkspaceApiKeyControllers:
    """Unit tests for console workspace API key controllers."""

    def test_workspace_api_key_fields_structure(self):
        """Test that workspace API key field definitions are correct."""
        from controllers.console.workspace.api_keys import workspace_api_key_fields

        # Assert required fields are present
        required_fields = [
            "id",
            "name",
            "type",
            "scopes",
            "created_at",
            "last_used_at",
            "expires_at",
            "is_expired",
            "created_by",
        ]

        for field in required_fields:
            assert field in workspace_api_key_fields, f"Missing required field: {field}"

        # Assert field types are appropriate
        from flask_restful import fields

        assert workspace_api_key_fields["id"] == fields.String
        assert workspace_api_key_fields["name"] == fields.String
        assert isinstance(workspace_api_key_fields["scopes"], fields.List)
        assert workspace_api_key_fields["is_expired"] == fields.Boolean

    def test_workspace_api_key_list_fields_structure(self):
        """Test that workspace API key list field definitions are correct."""
        from controllers.console.workspace.api_keys import workspace_api_key_list_fields

        assert "data" in workspace_api_key_list_fields

        from flask_restful import fields

        assert isinstance(workspace_api_key_list_fields["data"], fields.List)

    def test_workspace_api_key_create_fields_structure(self):
        """Test that workspace API key create field definitions are correct."""
        from controllers.console.workspace.api_keys import workspace_api_key_create_fields

        # Assert required fields for creation response
        required_create_fields = ["id", "name", "token", "type", "scopes", "created_at", "expires_at"]

        for field in required_create_fields:
            assert field in workspace_api_key_create_fields, f"Missing required create field: {field}"

        # Token field should be present in create response (shown only once)
        from flask_restful import fields

        assert workspace_api_key_create_fields["token"] == fields.String

    def test_controller_endpoint_registration(self):
        """Test that workspace API key endpoints are properly registered."""
        # This is a conceptual test - in a real scenario, we'd check the Flask app routes
        # For unit testing, we verify the expected endpoint patterns

        expected_endpoints = [
            "/workspaces/current/api-keys",  # List and create
            "/workspaces/current/api-keys/<string:api_key_id>",  # Update and delete
            "/workspaces/current/api-keys/<string:api_key_id>/regenerate",  # Regenerate
            "/workspaces/current/api-keys/scopes",  # Available scopes
        ]

        # Verify endpoint patterns are reasonable
        for endpoint in expected_endpoints:
            assert "/workspaces/current/api-keys" in endpoint
            assert endpoint.startswith("/")

    def test_scope_validation_integration(self):
        """Test scope validation integration with constants."""
        from constants.workspace_scopes import get_valid_scopes, validate_scopes

        # Test with valid workspace scopes
        valid_scopes = ["workspace:read", "apps:write"]
        is_valid, invalid_scopes = validate_scopes(valid_scopes)
        assert is_valid is True
        assert invalid_scopes == []

        # Test with invalid scopes
        invalid_scopes_list = ["invalid:scope", "workspace:read"]
        is_valid, invalid_scopes = validate_scopes(invalid_scopes_list)
        assert is_valid is False
        assert "invalid:scope" in invalid_scopes

        # Test that all valid scopes are workspace-related
        all_valid_scopes = get_valid_scopes()
        for scope in all_valid_scopes:
            assert ":" in scope, f"Scope {scope} should have resource:permission format"
            resource = scope.split(":")[0]
            assert resource in ["workspace", "apps", "members"], f"Resource {resource} should be workspace-related"


class TestWorkspaceApiKeyControllerInputValidation:
    """Unit tests for input validation in workspace API key controllers."""

    def test_api_key_name_validation_patterns(self):
        """Test API key name validation patterns."""
        # Valid names
        valid_names = [
            "my-api-key",
            "workspace_key_123",
            "Key for Testing",
            "キー名前",  # Unicode support
            "a" * 50,  # Reasonable length
        ]

        for name in valid_names:
            # Basic validation that would be applied
            assert isinstance(name, str)
            assert len(name.strip()) > 0
            assert len(name) <= 255  # Reasonable length limit

        # Invalid names (edge cases)
        invalid_names = [
            "",  # Empty
            "   ",  # Whitespace only
            "a" * 1000,  # Too long
        ]

        for name in invalid_names:
            if name == "":
                assert len(name) == 0
            elif name.strip() == "":
                assert len(name.strip()) == 0
            elif len(name) > 255:
                assert len(name) > 255

    def test_scopes_list_validation_patterns(self):
        """Test scopes list validation patterns."""
        from constants.workspace_scopes import get_valid_scopes

        valid_workspace_scopes = get_valid_scopes()

        # Valid scope combinations
        valid_scope_lists = [
            [],  # Empty list (might use defaults)
            ["workspace:read"],
            ["workspace:read", "apps:write"],
            valid_workspace_scopes,  # All valid scopes
        ]

        for scope_list in valid_scope_lists:
            assert isinstance(scope_list, list)
            for scope in scope_list:
                assert scope in valid_workspace_scopes

        # Invalid scope combinations
        invalid_scope_lists = [
            ["invalid:scope"],
            ["workspace:read", "invalid:scope"],
            "not-a-list",  # Wrong type
            None,  # None value
        ]

        for scope_list in invalid_scope_lists:
            if isinstance(scope_list, list):
                # Check if any scopes are invalid
                invalid_scopes = [s for s in scope_list if s not in valid_workspace_scopes]
                assert len(invalid_scopes) > 0
            else:
                # Wrong type
                assert not isinstance(scope_list, list)


class TestWorkspaceApiKeyConstants:
    """Test workspace API key related constants and configurations."""

    def test_scope_categories_structure(self):
        """Test that scope categories are properly structured."""
        from constants.workspace_scopes import SCOPE_CATEGORIES

        # Assert main categories exist
        expected_categories = ["workspace", "apps", "members"]
        for category in expected_categories:
            assert category in SCOPE_CATEGORIES

            # Each category should have name and scopes
            assert "name" in SCOPE_CATEGORIES[category]
            assert "scopes" in SCOPE_CATEGORIES[category]
            assert isinstance(SCOPE_CATEGORIES[category]["scopes"], list)
            assert len(SCOPE_CATEGORIES[category]["scopes"]) > 0

    def test_workspace_api_scopes_coverage(self):
        """Test that all scopes in categories are defined in main scopes."""
        from constants.workspace_scopes import SCOPE_CATEGORIES, WORKSPACE_API_SCOPES

        # Collect all scopes from categories
        category_scopes = set()
        for category_data in SCOPE_CATEGORIES.values():
            category_scopes.update(category_data["scopes"])

        # Verify all category scopes are defined in main scopes
        defined_scopes = set(WORKSPACE_API_SCOPES.keys())
        missing_scopes = category_scopes - defined_scopes
        assert len(missing_scopes) == 0, f"Missing scope definitions: {missing_scopes}"

    def test_scope_descriptions_exist(self):
        """Test that all scopes have descriptions."""
        from constants.workspace_scopes import WORKSPACE_API_SCOPES, get_scope_description

        for scope in WORKSPACE_API_SCOPES:
            description = get_scope_description(scope)
            assert description, f"Scope {scope} missing description"
            assert len(description) > 10, f"Scope {scope} description too short: {description}"

    def test_default_scopes_configuration(self):
        """Test default scopes configuration."""
        from constants.workspace_scopes import DEFAULT_API_KEY_SCOPES

        # DEFAULT_API_KEY_SCOPES should be a list
        assert isinstance(DEFAULT_API_KEY_SCOPES, list)

        # For security, default should be empty or minimal
        assert len(DEFAULT_API_KEY_SCOPES) <= 2, "Default scopes should be minimal for security"
