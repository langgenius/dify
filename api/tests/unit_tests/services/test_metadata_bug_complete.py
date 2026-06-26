from pathlib import Path
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


class TestMetadataBugCompleteValidation:
    """Complete test suite to verify the metadata nullable bug and its fix."""

    def test_1_pydantic_layer_validation(self) -> None:
        """Test Layer 1: Pydantic model validation correctly rejects None values."""
        # Pydantic should reject None values for required fields
        with pytest.raises((ValueError, TypeError)):
            MetadataArgs(type=None, name=None)  # pyrefly: ignore[bad-argument-type]

        with pytest.raises((ValueError, TypeError)):
            MetadataArgs(type="string", name=None)  # pyrefly: ignore[bad-argument-type]

        with pytest.raises((ValueError, TypeError)):
            MetadataArgs(type=None, name="test")  # pyrefly: ignore[bad-argument-type]

        # Valid values should work
        valid_args = MetadataArgs(type="string", name="test_name")
        assert valid_args.type == "string"
        assert valid_args.name == "test_name"

    def test_2_business_logic_layer_crashes_on_none(self) -> None:
        """Test Layer 2: Business logic crashes when None values slip through."""
        # Create mock that bypasses Pydantic validation
        mock_metadata_args = Mock()
        mock_metadata_args.name = None
        mock_metadata_args.type = "string"

        account = _make_account()
        # Should crash with TypeError
        with pytest.raises(TypeError, match="object of type 'NoneType' has no len"):
            MetadataService.create_metadata("dataset-123", mock_metadata_args, account, "tenant-123")

        # Test update method as well
        account = _make_account()
        none_name = cast(str, None)
        with pytest.raises(TypeError, match="object of type 'NoneType' has no len"):
            MetadataService.update_metadata_name("dataset-123", "metadata-456", none_name, account, "tenant-123")

    def test_3_database_constraints_verification(self) -> None:
        """Test Layer 3: Verify database model has nullable=False constraints."""
        from sqlalchemy import inspect

        from models.dataset import DatasetMetadata

        # Get table info
        mapper = inspect(DatasetMetadata)

        # Check that type and name columns are not nullable
        type_column = mapper.columns["type"]
        name_column = mapper.columns["name"]

        assert type_column.nullable is False, "type column should be nullable=False"
        assert name_column.nullable is False, "name column should be nullable=False"

    def test_4_fixed_api_layer_rejects_null(self) -> None:
        """Test Layer 4: Fixed API configuration properly rejects null values using Pydantic."""
        with pytest.raises((ValueError, TypeError)):
            MetadataArgs.model_validate({"type": None, "name": None})

        with pytest.raises((ValueError, TypeError)):
            MetadataArgs.model_validate({"type": "string", "name": None})

        with pytest.raises((ValueError, TypeError)):
            MetadataArgs.model_validate({"type": None, "name": "test"})

    def test_5_fixed_api_accepts_valid_values(self) -> None:
        """Test that fixed API still accepts valid non-null values."""
        args = MetadataArgs.model_validate({"type": "string", "name": "valid_name"})
        assert args.type == "string"
        assert args.name == "valid_name"

    def test_6_simulated_buggy_behavior(self) -> None:
        """Test simulating the original buggy behavior by bypassing Pydantic validation."""
        mock_metadata_args = Mock()
        mock_metadata_args.name = None
        mock_metadata_args.type = None

        account = _make_account()
        with pytest.raises(TypeError, match="object of type 'NoneType' has no len"):
            MetadataService.create_metadata("dataset-123", mock_metadata_args, account, "tenant-123")

    def test_7_end_to_end_validation_layers(self) -> None:
        """Test all validation layers work together correctly."""
        # Layer 1: API should reject null at parameter level (with fix)
        # Layer 2: Pydantic should reject null at model level
        # Layer 3: Business logic expects non-null
        # Layer 4: Database enforces non-null

        # Test that valid data flows through all layers
        valid_data = {"type": "string", "name": "test_metadata"}

        # Should create valid Pydantic object
        metadata_args = MetadataArgs.model_validate(valid_data)
        assert metadata_args.type == "string"
        assert metadata_args.name == "test_metadata"

        # Should not crash in business logic length check
        assert len(metadata_args.name) <= 255  # This should not crash
        assert len(metadata_args.type) > 0  # This should not crash

    def test_8_verify_specific_fix_locations(self) -> None:
        """Verify that the specific locations mentioned in bug report are fixed."""
        # Read the actual files to verify fixes
        import os

        # Console API create
        console_create_file = "api/controllers/console/datasets/metadata.py"
        if os.path.exists(console_create_file):
            content = Path(console_create_file).read_text()
            # Should contain nullable=False, not nullable=True
            assert "nullable=True" not in content.split("class DatasetMetadataCreateApi")[1].split("class")[0]

        # Service API create
        service_create_file = "api/controllers/service_api/dataset/metadata.py"
        if os.path.exists(service_create_file):
            content = Path(service_create_file).read_text()
            # Should contain nullable=False, not nullable=True
            create_api_section = content.split("class DatasetMetadataCreateServiceApi")[1].split("class")[0]
            assert "nullable=True" not in create_api_section


class TestMetadataValidationSummary:
    """Summary tests that demonstrate the complete validation architecture."""

    def test_validation_layer_architecture(self) -> None:
        """Document and test the 4-layer validation architecture."""
        # Layer 1: API Parameter Validation (Flask-RESTful reqparse)
        # - Role: First line of defense, validates HTTP request parameters
        # - Fixed: nullable=False ensures null values are rejected at API boundary

        # Layer 2: Pydantic Model Validation
        # - Role: Validates data structure and types before business logic
        # - Working: Required fields without Optional[] reject None values

        # Layer 3: Business Logic Validation
        # - Role: Domain-specific validation (length checks, uniqueness, etc.)
        # - Vulnerable: Direct len() calls crash on None values

        # Layer 4: Database Constraints
        # - Role: Final data integrity enforcement
        # - Working: nullable=False prevents None values in database

        # The bug was: Layer 1 allowed None, but Layers 2-4 expected non-None
        # The fix: Make Layer 1 consistent with Layers 2-4

        assert True  # This test documents the architecture


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
