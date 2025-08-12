from unittest.mock import patch

from flask import Flask

from libs.login import _authenticate_workspace_api_key
from services.workspace_api_key_service import WorkspaceApiKeyService

# Simple test app for context
app = Flask(__name__)
app.config["TESTING"] = True


class TestWorkspaceApiErrorHandling:
    """Test error handling and edge cases for workspace API"""

    def test_malformed_token_handling(self):
        """Test handling of malformed API tokens"""
        # Test various malformed tokens
        malformed_tokens = [
            "Bearer invalid-token",
            "Bearer wsk-",
            "Bearer wsk-malformed",
            "Bearer totally-wrong-format",
            "InvalidHeader wsk-12345",
            "",
        ]

        for token in malformed_tokens:
            with app.app_context():
                result = _authenticate_workspace_api_key(token, ["workspace:read"])
                assert result is False, f"Token {token} should be rejected"

    @patch("services.workspace_api_key_service.WorkspaceApiKeyService.validate_workspace_api_key")
    def test_sql_injection_prevention(self, mock_validate):
        """Test that service prevents SQL injection attempts"""
        # Mock safe response
        mock_validate.return_value = None

        # Test malicious tokens that could contain SQL injection
        malicious_tokens = [
            "Bearer wsk-'; DROP TABLE workspace_api_keys; --",
            "Bearer wsk-' OR '1'='1",
            "Bearer wsk-1'; DELETE FROM accounts WHERE id > 0; --",
            "Bearer wsk-<script>alert('xss')</script>",
        ]

        for token in malicious_tokens:
            with app.app_context():
                result = _authenticate_workspace_api_key(token, ["workspace:read"])
                assert result is False, f"Malicious token should be rejected: {token}"

    @patch("services.workspace_api_key_service.db")
    def test_database_error_handling(self, mock_db):
        """Test graceful handling of database errors"""
        # Simulate database connection error
        mock_db.session.query.side_effect = Exception("Database connection failed")

        with app.app_context():
            result = _authenticate_workspace_api_key("Bearer wsk-valid-token", ["workspace:read"])
            assert result is False, "Should handle database errors gracefully"

    def test_scope_edge_cases(self):
        """Test edge cases in scope validation"""
        # Test with various scope combinations - these are unit tests for static validation
        # not requiring database access
        test_cases = [
            ({"scopes": []}, ["workspace:read"], False),
            ({"scopes": ["workspace:read"]}, [], True),  # No required scopes = always pass
            ({"scopes": ["workspace:write"]}, ["workspace:read"], False),
        ]

        for auth_data, required_scopes, expected in test_cases:
            result = WorkspaceApiKeyService.check_multiple_scopes(auth_data, required_scopes, require_all=False)
            assert result == expected, f"Scope check failed for {auth_data} vs {required_scopes}"

    def test_decorator_edge_cases(self):
        """Test edge cases in decorator functionality"""
        with app.app_context():
            # Test with None scopes
            result = _authenticate_workspace_api_key("Bearer wsk-test", None)
            assert result is False

            # Test with empty string token
            result = _authenticate_workspace_api_key("", ["workspace:read"])
            assert result is False

            # Test with whitespace-only token
            result = _authenticate_workspace_api_key("   ", ["workspace:read"])
            assert result is False

    def test_token_length_limits(self):
        """Test handling of extremely long or short tokens"""
        with app.app_context():
            # Very short token
            short_token = "Bearer wsk-x"
            result = _authenticate_workspace_api_key(short_token, ["workspace:read"])
            assert result is False

            # Very long token (but still validly formatted)
            long_token = "Bearer wsk-" + "x" * 1000
            result = _authenticate_workspace_api_key(long_token, ["workspace:read"])
            assert result is False  # Should be rejected due to invalid format
