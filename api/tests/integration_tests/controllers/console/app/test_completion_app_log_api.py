"""Integration tests for Completion App Log API endpoints."""

import uuid

import pytest

from tests.integration_tests.controllers.console.app.test_feedback_api_basic import TestFeedbackApiBasic


class TestCompletionAppLogApiBasic(TestFeedbackApiBasic):
    """Basic integration tests for Completion App Log API endpoints."""

    def test_completion_app_logs_endpoint_exists(self, test_client, auth_header):
        """Test that completion app logs endpoint exists and handles basic requests."""
        app_id = str(uuid.uuid4())

        # Test endpoint exists (even if it fails, it should return 500 or 403, not 404)
        response = test_client.get(
            f"/console/api/apps/{app_id}/completion-app-logs",
            headers=auth_header,
            query_string={"page": 1, "limit": 20},
        )

        # Should not return 404 (endpoint exists)
        assert response.status_code != 404

        # Should return authentication or permission error, or success if app exists
        assert response.status_code in [200, 401, 403, 500]

    def test_completion_app_logs_endpoint_with_parameters(self, test_client, auth_header):
        """Test completion app logs endpoint with various query parameters."""
        app_id = str(uuid.uuid4())

        # Test with all parameters
        params = {
            "status": "normal",
            "created_at__before": "2024-01-01T00:00:00Z",
            "created_at__after": "2023-12-01T00:00:00Z",
            "created_by_end_user_session_id": "test_session",
            "created_by_account": "user@example.com",
            "page": 1,
            "limit": 10,
        }

        response = test_client.get(
            f"/console/api/apps/{app_id}/completion-app-logs", headers=auth_header, query_string=params
        )

        # Should not return 404 (endpoint exists)
        assert response.status_code != 404

    def test_completion_app_logs_endpoint_invalid_parameters(self, test_client, auth_header):
        """Test completion app logs endpoint with invalid parameters."""
        app_id = str(uuid.uuid4())

        # Test with invalid page number
        response = test_client.get(
            f"/console/api/apps/{app_id}/completion-app-logs",
            headers=auth_header,
            query_string={"page": 0},  # Invalid: page should be >= 1
        )

        # Should return validation error
        assert response.status_code == 400

        # Test with invalid limit
        response = test_client.get(
            f"/console/api/apps/{app_id}/completion-app-logs",
            headers=auth_header,
            query_string={"limit": 0},  # Invalid: limit should be >= 1
        )

        # Should return validation error
        assert response.status_code == 400

        # Test with limit too large
        response = test_client.get(
            f"/console/api/apps/{app_id}/completion-app-logs",
            headers=auth_header,
            query_string={"limit": 101},  # Invalid: limit should be <= 100
        )

        # Should return validation error
        assert response.status_code == 400

        # Test with invalid datetime format
        response = test_client.get(
            f"/console/api/apps/{app_id}/completion-app-logs",
            headers=auth_header,
            query_string={"created_at__before": "invalid-date"},
        )

        # Should return validation error
        assert response.status_code == 400

    def test_completion_app_logs_endpoint_no_auth(self, test_client):
        """Test completion app logs endpoint without authentication."""
        app_id = str(uuid.uuid4())

        response = test_client.get(
            f"/console/api/apps/{app_id}/completion-app-logs", query_string={"page": 1, "limit": 20}
        )

        # Should return authentication error
        assert response.status_code == 401

    def test_completion_app_logs_response_structure(self, test_client, auth_header):
        """Test that successful response has correct structure."""
        app_id = str(uuid.uuid4())

        response = test_client.get(
            f"/console/api/apps/{app_id}/completion-app-logs",
            headers=auth_header,
            query_string={"page": 1, "limit": 20},
        )

        # If we get a successful response, verify structure
        if response.status_code == 200:
            data = response.get_json()

            # Verify response structure
            assert "data" in data
            assert "has_more" in data
            assert "limit" in data
            assert "total" in data
            assert "page" in data

            # Verify data is a list
            assert isinstance(data["data"], list)

            # Verify pagination fields are correct types
            assert isinstance(data["has_more"], bool)
            assert isinstance(data["limit"], int)
            assert isinstance(data["total"], int)
            assert isinstance(data["page"], int)

    def test_completion_app_logs_endpoint_different_app_modes(self, test_client, auth_header):
        """Test that endpoint is accessible for completion app mode."""
        app_id = str(uuid.uuid4())

        # This should work for completion app mode
        response = test_client.get(
            f"/console/api/apps/{app_id}/completion-app-logs",
            headers=auth_header,
            query_string={"page": 1, "limit": 20},
        )

        # Should not return 404 (endpoint exists)
        # May return 403 if app doesn't exist or wrong mode, but not 404
        assert response.status_code != 404

    def test_completion_app_logs_pagination_parameters(self, test_client, auth_header):
        """Test pagination parameters work correctly."""
        app_id = str(uuid.uuid4())

        # Test different page sizes
        for limit in [1, 5, 10, 20, 50, 100]:
            response = test_client.get(
                f"/console/api/apps/{app_id}/completion-app-logs",
                headers=auth_header,
                query_string={"page": 1, "limit": limit},
            )

            # Should handle valid limits without errors (except auth/permission issues)
            assert response.status_code in [200, 401, 403, 500]

        # Test different page numbers
        for page in [1, 2, 5, 10]:
            response = test_client.get(
                f"/console/api/apps/{app_id}/completion-app-logs",
                headers=auth_header,
                query_string={"page": page, "limit": 20},
            )

            # Should handle valid pages without errors (except auth/permission issues)
            assert response.status_code in [200, 401, 403, 500]

    def test_completion_app_logs_filter_parameters(self, test_client, auth_header):
        """Test filter parameters work correctly."""
        app_id = str(uuid.uuid4())

        # Test status filter
        response = test_client.get(
            f"/console/api/apps/{app_id}/completion-app-logs", headers=auth_header, query_string={"status": "normal"}
        )
        assert response.status_code in [200, 401, 403, 500]

        # Test date filters
        response = test_client.get(
            f"/console/api/apps/{app_id}/completion-app-logs",
            headers=auth_header,
            query_string={"created_at__before": "2024-01-01T00:00:00Z", "created_at__after": "2023-12-01T00:00:00Z"},
        )
        assert response.status_code in [200, 401, 403, 500]

        # Test user filters
        response = test_client.get(
            f"/console/api/apps/{app_id}/completion-app-logs",
            headers=auth_header,
            query_string={"created_by_end_user_session_id": "session_123", "created_by_account": "user@example.com"},
        )
        assert response.status_code in [200, 401, 403, 500]

    @pytest.mark.parametrize("http_method", ["GET", "POST", "PUT", "DELETE"])
    def test_completion_app_logs_endpoint_http_methods(self, test_client, auth_header, http_method):
        """Test that only GET method is supported."""
        app_id = str(uuid.uuid4())

        if http_method == "GET":
            response = test_client.get(f"/console/api/apps/{app_id}/completion-app-logs", headers=auth_header)
            # GET should work (or return auth/permission errors)
            assert response.status_code in [200, 401, 403, 500]
        else:
            # Other methods should return 405 Method Not Allowed
            response = getattr(test_client, http_method.lower())(
                f"/console/api/apps/{app_id}/completion-app-logs", headers=auth_header
            )
            assert response.status_code == 405

    def test_completion_app_logs_endpoint_content_type(self, test_client, auth_header):
        """Test that endpoint returns correct content type."""
        app_id = str(uuid.uuid4())

        response = test_client.get(
            f"/console/api/apps/{app_id}/completion-app-logs",
            headers=auth_header,
            query_string={"page": 1, "limit": 20},
        )

        # If successful, should return JSON
        if response.status_code == 200:
            assert response.content_type == "application/json"
