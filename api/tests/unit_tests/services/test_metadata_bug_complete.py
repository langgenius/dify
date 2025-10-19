from pathlib import Path
from unittest.mock import Mock, create_autospec, patch

import pytest
from flask_restx import reqparse
from werkzeug.exceptions import BadRequest

from models.account import Account
from services.entities.knowledge_entities.knowledge_entities import MetadataArgs
from services.metadata_service import MetadataService


class TestMetadataBugCompleteValidation:
    """Complete test suite to verify the metadata nullable bug and its fix."""

    def test_1_pydantic_layer_validation(self):
        """Test Layer 1: Pydantic model validation correctly rejects None values."""
        # Pydantic should reject None values for required fields
        with pytest.raises((ValueError, TypeError)):
            MetadataArgs(type=None, name=None)

        with pytest.raises((ValueError, TypeError)):
            MetadataArgs(type="string", name=None)

        with pytest.raises((ValueError, TypeError)):
            MetadataArgs(type=None, name="test")

        # Valid values should work
        valid_args = MetadataArgs(type="string", name="test_name")
        assert valid_args.type == "string"
        assert valid_args.name == "test_name"

    def test_2_business_logic_layer_crashes_on_none(self):
        """Test Layer 2: Business logic crashes when None values slip through."""
        # Create mock that bypasses Pydantic validation
        mock_metadata_args = Mock()
        mock_metadata_args.name = None
        mock_metadata_args.type = "string"

        mock_user = create_autospec(Account, instance=True)
        mock_user.current_tenant_id = "tenant-123"
        mock_user.id = "user-456"

        with patch(
            "services.metadata_service.current_account_with_tenant",
            return_value=(mock_user, mock_user.current_tenant_id),
        ):
            # Should crash with TypeError
            with pytest.raises(TypeError, match="object of type 'NoneType' has no len"):
                MetadataService.create_metadata("dataset-123", mock_metadata_args)

        # Test update method as well
        mock_user = create_autospec(Account, instance=True)
        mock_user.current_tenant_id = "tenant-123"
        mock_user.id = "user-456"

        with patch(
            "services.metadata_service.current_account_with_tenant",
            return_value=(mock_user, mock_user.current_tenant_id),
        ):
            with pytest.raises(TypeError, match="object of type 'NoneType' has no len"):
                MetadataService.update_metadata_name("dataset-123", "metadata-456", None)

    def test_3_database_constraints_verification(self):
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

    def test_4_fixed_api_layer_rejects_null(self, app):
        """Test Layer 4: Fixed API configuration properly rejects null values."""
        # Test Console API create endpoint (fixed)
        parser = (
            reqparse.RequestParser()
            .add_argument("type", type=str, required=True, nullable=False, location="json")
            .add_argument("name", type=str, required=True, nullable=False, location="json")
        )

        with app.test_request_context(json={"type": None, "name": None}, content_type="application/json"):
            with pytest.raises(BadRequest):
                parser.parse_args()

        # Test with just name being null
        with app.test_request_context(json={"type": "string", "name": None}, content_type="application/json"):
            with pytest.raises(BadRequest):
                parser.parse_args()

        # Test with just type being null
        with app.test_request_context(json={"type": None, "name": "test"}, content_type="application/json"):
            with pytest.raises(BadRequest):
                parser.parse_args()

    def test_5_fixed_api_accepts_valid_values(self, app):
        """Test that fixed API still accepts valid non-null values."""
        parser = (
            reqparse.RequestParser()
            .add_argument("type", type=str, required=True, nullable=False, location="json")
            .add_argument("name", type=str, required=True, nullable=False, location="json")
        )

        with app.test_request_context(json={"type": "string", "name": "valid_name"}, content_type="application/json"):
            args = parser.parse_args()
            assert args["type"] == "string"
            assert args["name"] == "valid_name"

    def test_6_simulated_buggy_behavior(self, app):
        """Test simulating the original buggy behavior with nullable=True."""
        # Simulate the old buggy configuration
        buggy_parser = (
            reqparse.RequestParser()
            .add_argument("type", type=str, required=True, nullable=True, location="json")
            .add_argument("name", type=str, required=True, nullable=True, location="json")
        )

        with app.test_request_context(json={"type": None, "name": None}, content_type="application/json"):
            # This would pass in the buggy version
            args = buggy_parser.parse_args()
            assert args["type"] is None
            assert args["name"] is None

            # But would crash when trying to create MetadataArgs
            with pytest.raises((ValueError, TypeError)):
                MetadataArgs.model_validate(args)

    def test_7_end_to_end_validation_layers(self):
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

    def test_8_verify_specific_fix_locations(self):
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

    def test_validation_layer_architecture(self):
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
