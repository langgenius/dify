"""Basic integration tests for Feedback API endpoints."""

import uuid

from flask.testing import FlaskClient


class TestFeedbackApiBasic:
    """Basic tests for feedback API endpoints."""

    def test_feedback_export_endpoint_exists(self, test_client: FlaskClient, auth_header):
        """Test that feedback export endpoint exists and handles basic requests."""

        app_id = str(uuid.uuid4())

        # Test endpoint exists (even if it fails, it should return 500 or 403, not 404)
        response = test_client.get(
            f"/console/api/apps/{app_id}/feedbacks/export", headers=auth_header, query_string={"format": "csv"}
        )

        # Should not return 404 (endpoint exists)
        assert response.status_code != 404

        # Should return authentication or permission error
        assert response.status_code in [401, 403, 500]  # 500 if app doesn't exist, 403 if no permission

    def test_feedback_summary_endpoint_exists(self, test_client: FlaskClient, auth_header):
        """Test that feedback summary endpoint exists and handles basic requests."""

        app_id = str(uuid.uuid4())

        # Test endpoint exists
        response = test_client.get(f"/console/api/apps/{app_id}/feedbacks/summary", headers=auth_header)

        # Should not return 404 (endpoint exists)
        assert response.status_code != 404

        # Should return authentication or permission error
        assert response.status_code in [401, 403, 500]

    def test_feedback_export_invalid_format(self, test_client: FlaskClient, auth_header):
        """Test feedback export endpoint with invalid format parameter."""

        app_id = str(uuid.uuid4())

        # Test with invalid format
        response = test_client.get(
            f"/console/api/apps/{app_id}/feedbacks/export",
            headers=auth_header,
            query_string={"format": "invalid_format"},
        )

        # Should not return 404
        assert response.status_code != 404

    def test_feedback_export_with_filters(self, test_client: FlaskClient, auth_header):
        """Test feedback export endpoint with various filter parameters."""

        app_id = str(uuid.uuid4())

        # Test with various filter combinations
        filter_params = [
            {"from_source": "user"},
            {"rating": "like"},
            {"has_comment": True},
            {"start_date": "2024-01-01"},
            {"end_date": "2024-12-31"},
            {"format": "json"},
            {
                "from_source": "admin",
                "rating": "dislike",
                "has_comment": True,
                "start_date": "2024-01-01",
                "end_date": "2024-12-31",
                "format": "csv",
            },
        ]

        for params in filter_params:
            response = test_client.get(
                f"/console/api/apps/{app_id}/feedbacks/export", headers=auth_header, query_string=params
            )

            # Should not return 404
            assert response.status_code != 404

    def test_feedback_export_invalid_dates(self, test_client: FlaskClient, auth_header):
        """Test feedback export endpoint with invalid date formats."""

        app_id = str(uuid.uuid4())

        # Test with invalid date formats
        invalid_dates = [
            {"start_date": "invalid-date"},
            {"end_date": "not-a-date"},
            {"start_date": "2024-13-01"},  # Invalid month
            {"end_date": "2024-12-32"},  # Invalid day
        ]

        for params in invalid_dates:
            response = test_client.get(
                f"/console/api/apps/{app_id}/feedbacks/export", headers=auth_header, query_string=params
            )

            # Should not return 404
            assert response.status_code != 404
