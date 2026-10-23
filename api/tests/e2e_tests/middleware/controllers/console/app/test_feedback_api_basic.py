"""Basic integration tests for Feedback API endpoints."""

import uuid

from flask.testing import FlaskClient


class TestFeedbackApiBasic:
    """Basic tests for feedback API endpoints."""

    def test_feedback_summary_endpoint_exists(self, test_client: FlaskClient, auth_header):
        """Test that feedback summary endpoint exists and handles basic requests."""

        app_id = str(uuid.uuid4())

        # Test endpoint exists
        response = test_client.get(f"/console/api/apps/{app_id}/feedbacks/summary", headers=auth_header)

        # Should not return 404 (endpoint exists)
        assert response.status_code != 404

        # Should return authentication or permission error
        assert response.status_code in [401, 403, 500]
