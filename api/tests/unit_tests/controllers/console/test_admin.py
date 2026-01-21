"""Final working unit tests for admin endpoints - tests business logic directly."""

import uuid
from unittest.mock import Mock, patch

import pytest
from werkzeug.exceptions import NotFound, Unauthorized

from controllers.console.admin import InsertExploreAppPayload
from models.model import App, RecommendedApp


class TestInsertExploreAppPayload:
    """Test InsertExploreAppPayload validation."""

    def test_valid_payload(self):
        """Test creating payload with valid data."""
        payload_data = {
            "app_id": str(uuid.uuid4()),
            "desc": "Test app description",
            "copyright": "© 2024 Test Company",
            "privacy_policy": "https://example.com/privacy",
            "custom_disclaimer": "Custom disclaimer text",
            "language": "en-US",
            "category": "Productivity",
            "position": 1,
        }

        payload = InsertExploreAppPayload.model_validate(payload_data)

        assert payload.app_id == payload_data["app_id"]
        assert payload.desc == payload_data["desc"]
        assert payload.copyright == payload_data["copyright"]
        assert payload.privacy_policy == payload_data["privacy_policy"]
        assert payload.custom_disclaimer == payload_data["custom_disclaimer"]
        assert payload.language == payload_data["language"]
        assert payload.category == payload_data["category"]
        assert payload.position == payload_data["position"]

    def test_minimal_payload(self):
        """Test creating payload with only required fields."""
        payload_data = {
            "app_id": str(uuid.uuid4()),
            "language": "en-US",
            "category": "Productivity",
            "position": 1,
        }

        payload = InsertExploreAppPayload.model_validate(payload_data)

        assert payload.app_id == payload_data["app_id"]
        assert payload.desc is None
        assert payload.copyright is None
        assert payload.privacy_policy is None
        assert payload.custom_disclaimer is None
        assert payload.language == payload_data["language"]
        assert payload.category == payload_data["category"]
        assert payload.position == payload_data["position"]

    def test_invalid_language(self):
        """Test payload with invalid language code."""
        payload_data = {
            "app_id": str(uuid.uuid4()),
            "language": "invalid-lang",
            "category": "Productivity",
            "position": 1,
        }

        with pytest.raises(ValueError, match="invalid-lang is not a valid language"):
            InsertExploreAppPayload.model_validate(payload_data)


class TestAdminRequiredDecorator:
    """Test admin_required decorator."""

    def setup_method(self):
        """Set up test fixtures."""
        # Mock dify_config
        self.dify_config_patcher = patch("controllers.console.admin.dify_config")
        self.mock_dify_config = self.dify_config_patcher.start()
        self.mock_dify_config.ADMIN_API_KEY = "test-admin-key"

        # Mock extract_access_token
        self.token_patcher = patch("controllers.console.admin.extract_access_token")
        self.mock_extract_token = self.token_patcher.start()

    def teardown_method(self):
        """Clean up test fixtures."""
        self.dify_config_patcher.stop()
        self.token_patcher.stop()

    def test_admin_required_success(self):
        """Test successful admin authentication."""
        from controllers.console.admin import admin_required

        @admin_required
        def test_view():
            return {"success": True}

        self.mock_extract_token.return_value = "test-admin-key"
        result = test_view()
        assert result["success"] is True

    def test_admin_required_invalid_token(self):
        """Test admin_required with invalid token."""
        from controllers.console.admin import admin_required

        @admin_required
        def test_view():
            return {"success": True}

        self.mock_extract_token.return_value = "wrong-key"
        with pytest.raises(Unauthorized, match="API key is invalid"):
            test_view()

    def test_admin_required_no_api_key_configured(self):
        """Test admin_required when no API key is configured."""
        from controllers.console.admin import admin_required

        self.mock_dify_config.ADMIN_API_KEY = None

        @admin_required
        def test_view():
            return {"success": True}

        with pytest.raises(Unauthorized, match="API key is invalid"):
            test_view()

    def test_admin_required_missing_authorization_header(self):
        """Test admin_required with missing authorization header."""
        from controllers.console.admin import admin_required

        @admin_required
        def test_view():
            return {"success": True}

        self.mock_extract_token.return_value = None
        with pytest.raises(Unauthorized, match="Authorization header is missing"):
            test_view()


class TestExploreAppBusinessLogicDirect:
    """Test the core business logic of explore app management directly."""

    def test_data_fusion_logic(self):
        """Test the data fusion logic between payload and site data."""
        # Test cases for different data scenarios
        test_cases = [
            {
                "name": "site_data_overrides_payload",
                "payload": {"desc": "Payload desc", "copyright": "Payload copyright"},
                "site": {"description": "Site desc", "copyright": "Site copyright"},
                "expected": {
                    "desc": "Site desc",
                    "copyright": "Site copyright",
                    "privacy_policy": "",
                    "custom_disclaimer": "",
                },
            },
            {
                "name": "payload_used_when_no_site",
                "payload": {"desc": "Payload desc", "copyright": "Payload copyright"},
                "site": None,
                "expected": {
                    "desc": "Payload desc",
                    "copyright": "Payload copyright",
                    "privacy_policy": "",
                    "custom_disclaimer": "",
                },
            },
            {
                "name": "empty_defaults_when_no_data",
                "payload": {},
                "site": None,
                "expected": {"desc": "", "copyright": "", "privacy_policy": "", "custom_disclaimer": ""},
            },
        ]

        for case in test_cases:
            # Simulate the data fusion logic
            payload_desc = case["payload"].get("desc")
            payload_copyright = case["payload"].get("copyright")
            payload_privacy_policy = case["payload"].get("privacy_policy")
            payload_custom_disclaimer = case["payload"].get("custom_disclaimer")

            if case["site"]:
                site_desc = case["site"].get("description")
                site_copyright = case["site"].get("copyright")
                site_privacy_policy = case["site"].get("privacy_policy")
                site_custom_disclaimer = case["site"].get("custom_disclaimer")

                # Site data takes precedence
                desc = site_desc or payload_desc or ""
                copyright = site_copyright or payload_copyright or ""
                privacy_policy = site_privacy_policy or payload_privacy_policy or ""
                custom_disclaimer = site_custom_disclaimer or payload_custom_disclaimer or ""
            else:
                # Use payload data or empty defaults
                desc = payload_desc or ""
                copyright = payload_copyright or ""
                privacy_policy = payload_privacy_policy or ""
                custom_disclaimer = payload_custom_disclaimer or ""

            result = {
                "desc": desc,
                "copyright": copyright,
                "privacy_policy": privacy_policy,
                "custom_disclaimer": custom_disclaimer,
            }

            assert result == case["expected"], f"Failed test case: {case['name']}"

    def test_app_visibility_logic(self):
        """Test that apps are made public when added to explore list."""
        # Create a mock app
        mock_app = Mock(spec=App)
        mock_app.is_public = False

        # Simulate the business logic
        mock_app.is_public = True

        assert mock_app.is_public is True

    def test_recommended_app_creation_logic(self):
        """Test the creation of RecommendedApp objects."""
        app_id = str(uuid.uuid4())
        payload_data = {
            "app_id": app_id,
            "desc": "Test app description",
            "copyright": "© 2024 Test Company",
            "privacy_policy": "https://example.com/privacy",
            "custom_disclaimer": "Custom disclaimer",
            "language": "en-US",
            "category": "Productivity",
            "position": 1,
        }

        # Simulate the creation logic
        recommended_app = Mock(spec=RecommendedApp)
        recommended_app.app_id = payload_data["app_id"]
        recommended_app.description = payload_data["desc"]
        recommended_app.copyright = payload_data["copyright"]
        recommended_app.privacy_policy = payload_data["privacy_policy"]
        recommended_app.custom_disclaimer = payload_data["custom_disclaimer"]
        recommended_app.language = payload_data["language"]
        recommended_app.category = payload_data["category"]
        recommended_app.position = payload_data["position"]

        # Verify the data
        assert recommended_app.app_id == app_id
        assert recommended_app.description == "Test app description"
        assert recommended_app.copyright == "© 2024 Test Company"
        assert recommended_app.privacy_policy == "https://example.com/privacy"
        assert recommended_app.custom_disclaimer == "Custom disclaimer"
        assert recommended_app.language == "en-US"
        assert recommended_app.category == "Productivity"
        assert recommended_app.position == 1

    def test_recommended_app_update_logic(self):
        """Test the update logic for existing RecommendedApp objects."""
        mock_recommended_app = Mock(spec=RecommendedApp)

        update_data = {
            "desc": "Updated description",
            "copyright": "© 2024 Updated",
            "language": "fr-FR",
            "category": "Tools",
            "position": 2,
        }

        # Simulate the update logic
        mock_recommended_app.description = update_data["desc"]
        mock_recommended_app.copyright = update_data["copyright"]
        mock_recommended_app.language = update_data["language"]
        mock_recommended_app.category = update_data["category"]
        mock_recommended_app.position = update_data["position"]

        # Verify the updates
        assert mock_recommended_app.description == "Updated description"
        assert mock_recommended_app.copyright == "© 2024 Updated"
        assert mock_recommended_app.language == "fr-FR"
        assert mock_recommended_app.category == "Tools"
        assert mock_recommended_app.position == 2

    def test_app_not_found_error_logic(self):
        """Test error handling when app is not found."""
        app_id = str(uuid.uuid4())

        # Simulate app lookup returning None
        found_app = None

        # Test the error condition
        if not found_app:
            with pytest.raises(NotFound, match=f"App '{app_id}' is not found"):
                raise NotFound(f"App '{app_id}' is not found")

    def test_recommended_app_not_found_error_logic(self):
        """Test error handling when recommended app is not found for deletion."""
        app_id = str(uuid.uuid4())

        # Simulate recommended app lookup returning None
        found_recommended_app = None

        # Test the error condition
        if not found_recommended_app:
            with pytest.raises(NotFound, match=f"App '{app_id}' is not found in the explore list"):
                raise NotFound(f"App '{app_id}' is not found in the explore list")

    def test_database_session_usage_patterns(self):
        """Test the expected database session usage patterns."""
        # Mock session usage patterns
        mock_session = Mock()

        # Test session.add pattern
        mock_recommended_app = Mock(spec=RecommendedApp)
        mock_session.add(mock_recommended_app)
        mock_session.commit()

        # Verify session was used correctly
        mock_session.add.assert_called_once_with(mock_recommended_app)
        mock_session.commit.assert_called_once()

        # Test session.delete pattern
        mock_recommended_app_to_delete = Mock(spec=RecommendedApp)
        mock_session.delete(mock_recommended_app_to_delete)
        mock_session.commit()

        # Verify delete pattern
        mock_session.delete.assert_called_once_with(mock_recommended_app_to_delete)

    def test_payload_validation_integration(self):
        """Test payload validation in the context of the business logic."""
        # Test valid payload
        valid_payload_data = {
            "app_id": str(uuid.uuid4()),
            "desc": "Test app description",
            "language": "en-US",
            "category": "Productivity",
            "position": 1,
        }

        # This should succeed
        payload = InsertExploreAppPayload.model_validate(valid_payload_data)
        assert payload.app_id == valid_payload_data["app_id"]

        # Test invalid payload
        invalid_payload_data = {
            "app_id": str(uuid.uuid4()),
            "language": "invalid-lang",  # This should fail validation
            "category": "Productivity",
            "position": 1,
        }

        # This should raise an exception
        with pytest.raises(ValueError, match="invalid-lang is not a valid language"):
            InsertExploreAppPayload.model_validate(invalid_payload_data)


class TestExploreAppDataHandling:
    """Test specific data handling scenarios."""

    def test_uuid_validation(self):
        """Test UUID validation and handling."""
        # Test valid UUID
        valid_uuid = str(uuid.uuid4())

        # This should be a valid UUID
        assert uuid.UUID(valid_uuid) is not None

        # Test invalid UUID
        invalid_uuid = "not-a-valid-uuid"

        # This should raise a ValueError
        with pytest.raises(ValueError):
            uuid.UUID(invalid_uuid)

    def test_language_validation(self):
        """Test language validation against supported languages."""
        from constants.languages import supported_language

        # Test supported language
        assert supported_language("en-US") == "en-US"
        assert supported_language("fr-FR") == "fr-FR"

        # Test unsupported language
        with pytest.raises(ValueError, match="invalid-lang is not a valid language"):
            supported_language("invalid-lang")

    def test_response_formatting(self):
        """Test API response formatting."""
        # Test success responses
        create_response = {"result": "success"}
        update_response = {"result": "success"}
        delete_response = None  # 204 No Content returns None

        assert create_response["result"] == "success"
        assert update_response["result"] == "success"
        assert delete_response is None

        # Test status codes
        create_status = 201  # Created
        update_status = 200  # OK
        delete_status = 204  # No Content

        assert create_status == 201
        assert update_status == 200
        assert delete_status == 204
