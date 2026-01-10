from unittest.mock import Mock, create_autospec, patch

import pytest

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

    def test_api_layer_now_uses_pydantic_validation(self):
        """Verify that API layer relies on Pydantic validation instead of reqparse."""
        invalid_payload = {"type": None, "name": None}
        with pytest.raises((ValueError, TypeError)):
            MetadataArgs.model_validate(invalid_payload)

        valid_payload = {"type": "string", "name": "valid"}
        args = MetadataArgs.model_validate(valid_payload)
        assert args.type == "string"
        assert args.name == "valid"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
