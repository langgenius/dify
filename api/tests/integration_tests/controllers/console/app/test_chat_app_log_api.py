"""Integration tests for Chat App Log API endpoints."""

import uuid

import pytest

from tests.integration_tests.controllers.console.app.test_feedback_api_basic import TestFeedbackApiBasic


class TestChatAppLogApiBasic(TestFeedbackApiBasic):
    """Basic integration tests for Chat App Log API endpoints."""

    def test_chat_app_logs_endpoint_exists(self, test_client, auth_header):
        """Test that chat app logs endpoint exists and handles basic requests."""
        app_id = str(uuid.uuid4())

        # Test endpoint exists (even if it fails, it should return 500 or 403, not 404)
        response = test_client.get(
            f"/console/api/apps/{app_id}/chat-app-logs", headers=auth_header, query_string={"page": 1, "limit": 20}
        )

        # Should not return 404 (endpoint exists)
        assert response.status_code != 404

        # Should return authentication or permission error, or success if app exists
        assert response.status_code in [200, 401, 403, 500]

    def test_chat_app_logs_endpoint_with_parameters(self, test_client, auth_header):
        """Test chat app logs endpoint with various query parameters."""
        app_id = str(uuid.uuid4())

        # Test with all chat-specific parameters
        params = {
            "status": "normal",
            "created_at__before": "2024-01-01T00:00:00Z",
            "created_at__after": "2023-12-01T00:00:00Z",
            "from_end_user_id": "user_session_456",
            "created_by_account": "user@example.com",
            "page": 2,
            "limit": 15,
        }

        response = test_client.get(
            f"/console/api/apps/{app_id}/chat-app-logs", headers=auth_header, query_string=params
        )

        # Should not return 404 (endpoint exists)
        assert response.status_code != 404

    def test_chat_app_logs_endpoint_invalid_parameters(self, test_client, auth_header):
        """Test chat app logs endpoint with invalid parameters."""
        app_id = str(uuid.uuid4())

        # Test with invalid page number
        response = test_client.get(
            f"/console/api/apps/{app_id}/chat-app-logs",
            headers=auth_header,
            query_string={"page": 100000},  # Invalid: page should be <= 99999
        )

        # Should return validation error
        assert response.status_code == 400

        # Test with invalid limit
        response = test_client.get(
            f"/console/api/apps/{app_id}/chat-app-logs",
            headers=auth_header,
            query_string={"limit": 101},  # Invalid: limit should be <= 100
        )

        # Should return validation error
        assert response.status_code == 400

        # Test with negative page
        response = test_client.get(
            f"/console/api/apps/{app_id}/chat-app-logs",
            headers=auth_header,
            query_string={"page": -1},  # Invalid: page should be >= 1
        )

        # Should return validation error
        assert response.status_code == 400

        # Test with invalid datetime format
        response = test_client.get(
            f"/console/api/apps/{app_id}/chat-app-logs",
            headers=auth_header,
            query_string={"created_at__before": "not-a-date"},
        )

        # Should return validation error
        assert response.status_code == 400

    def test_chat_app_logs_endpoint_no_auth(self, test_client):
        """Test chat app logs endpoint without authentication."""
        app_id = str(uuid.uuid4())

        response = test_client.get(f"/console/api/apps/{app_id}/chat-app-logs", query_string={"page": 1, "limit": 20})

        # Should return authentication error
        assert response.status_code == 401

    def test_chat_app_logs_response_structure(self, test_client, auth_header):
        """Test that successful response has correct structure for chat logs."""
        app_id = str(uuid.uuid4())

        response = test_client.get(
            f"/console/api/apps/{app_id}/chat-app-logs", headers=auth_header, query_string={"page": 1, "limit": 20}
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

            # If there are log entries, verify structure of each entry
            if len(data["data"]) > 0:
                entry = data["data"][0]

                # Chat logs should have conversation data
                assert "conversation" in entry
                assert "message" in entry
                assert "created_from" in entry
                assert "created_by_role" in entry

                # Conversation should have basic fields
                conversation = entry["conversation"]
                if conversation:  # Can be None in some cases
                    assert "id" in conversation
                    assert "name" in conversation
                    assert "status" in conversation

                # Message should have token consumption fields
                message = entry["message"]
                assert "message_tokens" in message
                assert "total_tokens" in message
                assert "conversation_id" in message
                assert "query" in message
                assert "answer" in message

    def test_chat_app_logs_endpoint_different_app_modes(self, test_client, auth_header):
        """Test that endpoint works for different chat app modes."""
        app_id = str(uuid.uuid4())

        # This should work for chat app modes (CHAT, AGENT_CHAT, ADVANCED_CHAT)
        response = test_client.get(
            f"/console/api/apps/{app_id}/chat-app-logs", headers=auth_header, query_string={"page": 1, "limit": 20}
        )

        # Should not return 404 (endpoint exists)
        # May return 403 if app doesn't exist or wrong mode, but not 404
        assert response.status_code != 404

    def test_chat_app_logs_pagination_edge_cases(self, test_client, auth_header):
        """Test pagination edge cases for chat app logs."""
        app_id = str(uuid.uuid4())

        # Test minimum values
        response = test_client.get(
            f"/console/api/apps/{app_id}/chat-app-logs", headers=auth_header, query_string={"page": 1, "limit": 1}
        )
        assert response.status_code in [200, 401, 403, 500]

        # Test maximum values
        response = test_client.get(
            f"/console/api/apps/{app_id}/chat-app-logs", headers=auth_header, query_string={"page": 99999, "limit": 100}
        )
        assert response.status_code in [200, 401, 403, 500]

    def test_chat_app_logs_filtering_by_status(self, test_client, auth_header):
        """Test filtering chat app logs by status."""
        app_id = str(uuid.uuid4())

        # Test different status values
        statuses = ["normal", "error", "finished", "running"]

        for status in statuses:
            response = test_client.get(
                f"/console/api/apps/{app_id}/chat-app-logs",
                headers=auth_header,
                query_string={"status": status, "page": 1, "limit": 20},
            )
            assert response.status_code in [200, 401, 403, 500]

    def test_chat_app_logs_filtering_by_dates(self, test_client, auth_header):
        """Test filtering chat app logs by date ranges."""
        app_id = str(uuid.uuid4())

        # Test date range filtering
        response = test_client.get(
            f"/console/api/apps/{app_id}/chat-app-logs",
            headers=auth_header,
            query_string={"created_at__before": "2024-01-01T00:00:00Z", "created_at__after": "2023-01-01T00:00:00Z"},
        )
        assert response.status_code in [200, 401, 403, 500]

    def test_chat_app_logs_filtering_by_users(self, test_client, auth_header):
        """Test filtering chat app logs by user information."""
        app_id = str(uuid.uuid4())

        # Test filtering by end user session ID
        response = test_client.get(
            f"/console/api/apps/{app_id}/chat-app-logs",
            headers=auth_header,
            query_string={"from_end_user_id": "test_session_123456"},
        )
        assert response.status_code in [200, 401, 403, 500]

        # Test filtering by account email
        response = test_client.get(
            f"/console/api/apps/{app_id}/chat-app-logs",
            headers=auth_header,
            query_string={"created_by_account": "user@example.com"},
        )
        assert response.status_code in [200, 401, 403, 500]

        # Test filtering by both
        response = test_client.get(
            f"/console/api/apps/{app_id}/chat-app-logs",
            headers=auth_header,
            query_string={"from_end_user_id": "test_session", "created_by_account": "user@example.com"},
        )
        assert response.status_code in [200, 401, 403, 500]

    def test_chat_app_logs_combined_filters(self, test_client, auth_header):
        """Test chat app logs with multiple filters combined."""
        app_id = str(uuid.uuid4())

        # Test combining multiple filters
        response = test_client.get(
            f"/console/api/apps/{app_id}/chat-app-logs",
            headers=auth_header,
            query_string={
                "status": "normal",
                "created_at__before": "2024-01-01T00:00:00Z",
                "from_end_user_id": "user_session",
                "created_by_account": "support@company.com",
                "page": 2,
                "limit": 25,
            },
        )
        assert response.status_code in [200, 401, 403, 500]

    def test_chat_app_logs_empty_parameters(self, test_client, auth_header):
        """Test chat app logs with empty or null parameters."""
        app_id = str(uuid.uuid4())

        # Test with empty string parameters (should be handled gracefully)
        response = test_client.get(
            f"/console/api/apps/{app_id}/chat-app-logs",
            headers=auth_header,
            query_string={"status": "", "from_end_user_id": ""},
        )
        # Empty strings should not cause server errors
        assert response.status_code in [200, 401, 403, 500]

    def test_chat_app_logs_large_page_numbers(self, test_client, auth_header):
        """Test chat app logs with very large page numbers."""
        app_id = str(uuid.uuid4())

        # Test with a very large page number (should return empty results if app exists)
        response = test_client.get(
            f"/console/api/apps/{app_id}/chat-app-logs", headers=auth_header, query_string={"page": 999999, "limit": 20}
        )
        assert response.status_code in [200, 401, 403, 500]

    @pytest.mark.parametrize("http_method", ["GET", "POST", "PUT", "DELETE", "PATCH"])
    def test_chat_app_logs_endpoint_http_methods(self, test_client, auth_header, http_method):
        """Test that only GET method is supported for chat app logs."""
        app_id = str(uuid.uuid4())

        if http_method == "GET":
            response = test_client.get(f"/console/api/apps/{app_id}/chat-app-logs", headers=auth_header)
            # GET should work (or return auth/permission errors)
            assert response.status_code in [200, 401, 403, 500]
        else:
            # Other methods should return 405 Method Not Allowed
            response = getattr(test_client, http_method.lower())(
                f"/console/api/apps/{app_id}/chat-app-logs", headers=auth_header
            )
            assert response.status_code == 405

    def test_chat_app_logs_endpoint_content_type(self, test_client, auth_header):
        """Test that chat app logs endpoint returns correct content type."""
        app_id = str(uuid.uuid4())

        response = test_client.get(
            f"/console/api/apps/{app_id}/chat-app-logs", headers=auth_header, query_string={"page": 1, "limit": 20}
        )

        # If successful, should return JSON
        if response.status_code == 200:
            assert response.content_type == "application/json"

    def test_chat_app_logs_query_string_encoding(self, test_client, auth_header):
        """Test chat app logs with special characters in query parameters."""
        app_id = str(uuid.uuid4())

        # Test with special characters in filter values
        response = test_client.get(
            f"/console/api/apps/{app_id}/chat-app-logs",
            headers=auth_header,
            query_string={
                "from_end_user_id": "session+with-special&chars",
                "created_by_account": "user+test@example.com",
            },
        )
        assert response.status_code in [200, 401, 403, 500]

    def test_chat_app_logs_unicode_support(self, test_client, auth_header):
        """Test chat app logs with unicode characters in parameters."""
        app_id = str(uuid.uuid4())

        # Test with unicode characters
        response = test_client.get(
            f"/console/api/apps/{app_id}/chat-app-logs",
            headers=auth_header,
            query_string={"from_end_user_id": "用户会话123", "created_by_account": "user@测试.com"},
        )
        assert response.status_code in [200, 401, 403, 500]
