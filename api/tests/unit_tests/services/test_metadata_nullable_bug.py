from typing import cast
from unittest.mock import Mock

import pytest

from models import Account, Tenant
from services.entities.knowledge_entities.knowledge_entities import MetadataArgs
from services.metadata_service import MetadataService


def _make_account(account_id: str = "user-456", tenant_id: str = "tenant-123") -> Account:
    account = Account(name="Test User", email=f"{account_id}@example.com")
    account.id = account_id
    tenant = Tenant(name="Test Tenant")
    tenant.id = tenant_id
    account._current_tenant = tenant
    return account


class TestMetadataNullableBug:
    """Test case to reproduce the metadata nullable validation bug."""

    def test_metadata_args_with_none_values_should_fail(self) -> None:
        """Test that MetadataArgs validation should reject None values."""
        # This test demonstrates the expected behavior - should fail validation
        with pytest.raises((ValueError, TypeError)):
            # This should fail because Pydantic expects non-None values
            MetadataArgs(type=None, name=None)  # pyrefly: ignore[bad-argument-type]

    def test_metadata_service_create_with_none_name_crashes(self) -> None:
        """Test that MetadataService.create_metadata crashes when name is None."""
        # Mock the MetadataArgs to bypass Pydantic validation
        mock_metadata_args = Mock()
        mock_metadata_args.name = None  # This will cause len() to crash
        mock_metadata_args.type = "string"

        account = _make_account()
        # This should crash with TypeError when calling len(None)
        with pytest.raises(TypeError, match="object of type 'NoneType' has no len"):
            MetadataService.create_metadata("dataset-123", mock_metadata_args, account, "tenant-123")

    def test_metadata_service_update_with_none_name_crashes(self) -> None:
        """Test that MetadataService.update_metadata_name crashes when name is None."""
        account = _make_account()
        none_name = cast(str, None)
        # This should crash with TypeError when calling len(None)
        with pytest.raises(TypeError, match="object of type 'NoneType' has no len"):
            MetadataService.update_metadata_name("dataset-123", "metadata-456", none_name, account, "tenant-123")

    def test_api_layer_now_uses_pydantic_validation(self) -> None:
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
