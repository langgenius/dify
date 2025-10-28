from unittest.mock import Mock, create_autospec, patch

import pytest
from flask_restx import reqparse

from models.account import Account
from services.entities.knowledge_entities.knowledge_entities import MetadataArgs
from services.metadata_service import MetadataService


class TestMetadataNullableBug:
    """Test case to reproduce the metadata nullable validation bug."""

    def test_metadata_args_with_none_values_should_fail(self):
        """Test that MetadataArgs validation should reject None values."""
        # This test demonstrates the expected behavior - should fail validation
        with pytest.raises((ValueError, TypeError)):
            # This should fail because Pydantic expects non-None values
            MetadataArgs(type=None, name=None)

    def test_metadata_service_create_with_none_name_crashes(self):
        """Test that MetadataService.create_metadata crashes when name is None."""
        # Mock the MetadataArgs to bypass Pydantic validation
        mock_metadata_args = Mock()
        mock_metadata_args.name = None  # This will cause len() to crash
        mock_metadata_args.type = "string"

        mock_user = create_autospec(Account, instance=True)
        mock_user.current_tenant_id = "tenant-123"
        mock_user.id = "user-456"

        with patch(
            "services.metadata_service.current_account_with_tenant",
            return_value=(mock_user, mock_user.current_tenant_id),
        ):
            # This should crash with TypeError when calling len(None)
            with pytest.raises(TypeError, match="object of type 'NoneType' has no len"):
                MetadataService.create_metadata("dataset-123", mock_metadata_args)

    def test_metadata_service_update_with_none_name_crashes(self):
        """Test that MetadataService.update_metadata_name crashes when name is None."""
        mock_user = create_autospec(Account, instance=True)
        mock_user.current_tenant_id = "tenant-123"
        mock_user.id = "user-456"

        with patch(
            "services.metadata_service.current_account_with_tenant",
            return_value=(mock_user, mock_user.current_tenant_id),
        ):
            # This should crash with TypeError when calling len(None)
            with pytest.raises(TypeError, match="object of type 'NoneType' has no len"):
                MetadataService.update_metadata_name("dataset-123", "metadata-456", None)

    def test_api_parser_accepts_null_values(self, app):
        """Test that API parser configuration incorrectly accepts null values."""
        # Simulate the current API parser configuration
        parser = (
            reqparse.RequestParser()
            .add_argument("type", type=str, required=True, nullable=True, location="json")
            .add_argument("name", type=str, required=True, nullable=True, location="json")
        )

        # Simulate request data with null values
        with app.test_request_context(json={"type": None, "name": None}, content_type="application/json"):
            # This should parse successfully due to nullable=True
            args = parser.parse_args()

            # Verify that null values are accepted
            assert args["type"] is None
            assert args["name"] is None

            # This demonstrates the bug: API accepts None but business logic will crash

    def test_integration_bug_scenario(self, app):
        """Test the complete bug scenario from API to service layer."""
        # Step 1: API parser accepts null values (current buggy behavior)
        parser = (
            reqparse.RequestParser()
            .add_argument("type", type=str, required=True, nullable=True, location="json")
            .add_argument("name", type=str, required=True, nullable=True, location="json")
        )

        with app.test_request_context(json={"type": None, "name": None}, content_type="application/json"):
            args = parser.parse_args()

            # Step 2: Try to create MetadataArgs with None values
            # This should fail at Pydantic validation level
            with pytest.raises((ValueError, TypeError)):
                metadata_args = MetadataArgs.model_validate(args)

        # Step 3: If we bypass Pydantic (simulating the bug scenario)
        # Move this outside the request context to avoid Flask-Login issues
        mock_metadata_args = Mock()
        mock_metadata_args.name = None  # From args["name"]
        mock_metadata_args.type = None  # From args["type"]

        mock_user = create_autospec(Account, instance=True)
        mock_user.current_tenant_id = "tenant-123"
        mock_user.id = "user-456"

        with patch(
            "services.metadata_service.current_account_with_tenant",
            return_value=(mock_user, mock_user.current_tenant_id),
        ):
            # Step 4: Service layer crashes on len(None)
            with pytest.raises(TypeError, match="object of type 'NoneType' has no len"):
                MetadataService.create_metadata("dataset-123", mock_metadata_args)

    def test_correct_nullable_false_configuration_works(self, app):
        """Test that the correct nullable=False configuration works as expected."""
        # This tests the FIXED configuration
        parser = (
            reqparse.RequestParser()
            .add_argument("type", type=str, required=True, nullable=False, location="json")
            .add_argument("name", type=str, required=True, nullable=False, location="json")
        )

        with app.test_request_context(json={"type": None, "name": None}, content_type="application/json"):
            # This should fail with BadRequest due to nullable=False
            from werkzeug.exceptions import BadRequest

            with pytest.raises(BadRequest):
                parser.parse_args()


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
