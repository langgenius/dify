from unittest.mock import patch

from app_fixture import mock_user  # type: ignore


def test_post_requires_login(app):
    with app.test_client() as client:
        with patch("flask_login.utils._get_user", mock_user):
            response = client.get("/console/api/data-source/integrates")
            assert response.status_code == 200
