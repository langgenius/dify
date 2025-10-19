from unittest.mock import patch

import pytest
from faker import Faker

from models.api_based_extension import APIBasedExtension
from services.account_service import AccountService, TenantService
from services.api_based_extension_service import APIBasedExtensionService


class TestAPIBasedExtensionService:
    """Integration tests for APIBasedExtensionService using testcontainers."""

    @pytest.fixture
    def mock_external_service_dependencies(self):
        """Mock setup for external service dependencies."""
        with (
            patch("services.account_service.FeatureService") as mock_account_feature_service,
            patch("services.api_based_extension_service.APIBasedExtensionRequestor") as mock_requestor,
        ):
            # Setup default mock returns
            mock_account_feature_service.get_features.return_value.billing.enabled = False

            # Mock successful ping response
            mock_requestor_instance = mock_requestor.return_value
            mock_requestor_instance.request.return_value = {"result": "pong"}

            yield {
                "account_feature_service": mock_account_feature_service,
                "requestor": mock_requestor,
                "requestor_instance": mock_requestor_instance,
            }

    def _create_test_account_and_tenant(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Helper method to create a test account and tenant for testing.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            mock_external_service_dependencies: Mock dependencies

        Returns:
            tuple: (account, tenant) - Created account and tenant instances
        """
        fake = Faker()

        # Setup mocks for account creation
        mock_external_service_dependencies[
            "account_feature_service"
        ].get_system_features.return_value.is_allow_register = True

        # Create account and tenant
        account = AccountService.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=fake.password(length=12),
        )
        TenantService.create_owner_tenant_if_not_exist(account, name=fake.company())
        tenant = account.current_tenant

        return account, tenant

    def test_save_extension_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful saving of API-based extension.
        """
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Setup extension data
        extension_data = APIBasedExtension()
        extension_data.tenant_id = tenant.id
        extension_data.name = fake.company()
        extension_data.api_endpoint = f"https://{fake.domain_name()}/api"
        extension_data.api_key = fake.password(length=20)

        # Save extension
        saved_extension = APIBasedExtensionService.save(extension_data)

        # Verify extension was saved correctly
        assert saved_extension.id is not None
        assert saved_extension.tenant_id == tenant.id
        assert saved_extension.name == extension_data.name
        assert saved_extension.api_endpoint == extension_data.api_endpoint
        assert saved_extension.api_key == extension_data.api_key  # Should be decrypted when retrieved
        assert saved_extension.created_at is not None

        # Verify extension was saved to database
        from extensions.ext_database import db

        db.session.refresh(saved_extension)
        assert saved_extension.id is not None

        # Verify ping connection was called
        mock_external_service_dependencies["requestor_instance"].request.assert_called_once()

    def test_save_extension_validation_errors(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test validation errors when saving extension with invalid data.
        """
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Test empty name
        extension_data = APIBasedExtension()
        extension_data.tenant_id = tenant.id
        extension_data.name = ""
        extension_data.api_endpoint = f"https://{fake.domain_name()}/api"
        extension_data.api_key = fake.password(length=20)

        with pytest.raises(ValueError, match="name must not be empty"):
            APIBasedExtensionService.save(extension_data)

        # Test empty api_endpoint
        extension_data.name = fake.company()
        extension_data.api_endpoint = ""

        with pytest.raises(ValueError, match="api_endpoint must not be empty"):
            APIBasedExtensionService.save(extension_data)

        # Test empty api_key
        extension_data.api_endpoint = f"https://{fake.domain_name()}/api"
        extension_data.api_key = ""

        with pytest.raises(ValueError, match="api_key must not be empty"):
            APIBasedExtensionService.save(extension_data)

    def test_get_all_by_tenant_id_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful retrieval of all extensions by tenant ID.
        """
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create multiple extensions
        extensions = []
        for i in range(3):
            extension_data = APIBasedExtension()
            extension_data.tenant_id = tenant.id
            extension_data.name = f"Extension {i}: {fake.company()}"
            extension_data.api_endpoint = f"https://{fake.domain_name()}/api"
            extension_data.api_key = fake.password(length=20)

            saved_extension = APIBasedExtensionService.save(extension_data)
            extensions.append(saved_extension)

        # Get all extensions for tenant
        extension_list = APIBasedExtensionService.get_all_by_tenant_id(tenant.id)

        # Verify results
        assert len(extension_list) == 3

        # Verify all extensions belong to the correct tenant and are ordered by created_at desc
        for i, extension in enumerate(extension_list):
            assert extension.tenant_id == tenant.id
            assert extension.api_key is not None  # Should be decrypted
            if i > 0:
                # Verify descending order (newer first)
                assert extension.created_at <= extension_list[i - 1].created_at

    def test_get_with_tenant_id_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful retrieval of extension by tenant ID and extension ID.
        """
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create an extension
        extension_data = APIBasedExtension()
        extension_data.tenant_id = tenant.id
        extension_data.name = fake.company()
        extension_data.api_endpoint = f"https://{fake.domain_name()}/api"
        extension_data.api_key = fake.password(length=20)

        created_extension = APIBasedExtensionService.save(extension_data)

        # Get extension by ID
        retrieved_extension = APIBasedExtensionService.get_with_tenant_id(tenant.id, created_extension.id)

        # Verify extension was retrieved correctly
        assert retrieved_extension is not None
        assert retrieved_extension.id == created_extension.id
        assert retrieved_extension.tenant_id == tenant.id
        assert retrieved_extension.name == extension_data.name
        assert retrieved_extension.api_endpoint == extension_data.api_endpoint
        assert retrieved_extension.api_key == extension_data.api_key  # Should be decrypted
        assert retrieved_extension.created_at is not None

    def test_get_with_tenant_id_not_found(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test retrieval of extension when extension is not found.
        """
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )
        non_existent_extension_id = fake.uuid4()

        # Try to get non-existent extension
        with pytest.raises(ValueError, match="API based extension is not found"):
            APIBasedExtensionService.get_with_tenant_id(tenant.id, non_existent_extension_id)

    def test_delete_extension_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful deletion of extension.
        """
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create an extension first
        extension_data = APIBasedExtension()
        extension_data.tenant_id = tenant.id
        extension_data.name = fake.company()
        extension_data.api_endpoint = f"https://{fake.domain_name()}/api"
        extension_data.api_key = fake.password(length=20)

        created_extension = APIBasedExtensionService.save(extension_data)
        extension_id = created_extension.id

        # Delete the extension
        APIBasedExtensionService.delete(created_extension)

        # Verify extension was deleted
        from extensions.ext_database import db

        deleted_extension = db.session.query(APIBasedExtension).where(APIBasedExtension.id == extension_id).first()
        assert deleted_extension is None

    def test_save_extension_duplicate_name(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test validation error when saving extension with duplicate name.
        """
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create first extension
        extension_data1 = APIBasedExtension()
        extension_data1.tenant_id = tenant.id
        extension_data1.name = "Test Extension"
        extension_data1.api_endpoint = f"https://{fake.domain_name()}/api"
        extension_data1.api_key = fake.password(length=20)

        APIBasedExtensionService.save(extension_data1)

        # Try to create second extension with same name
        extension_data2 = APIBasedExtension()
        extension_data2.tenant_id = tenant.id
        extension_data2.name = "Test Extension"  # Same name
        extension_data2.api_endpoint = f"https://{fake.domain_name()}/api"
        extension_data2.api_key = fake.password(length=20)

        with pytest.raises(ValueError, match="name must be unique, it is already existed"):
            APIBasedExtensionService.save(extension_data2)

    def test_save_extension_update_existing(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful update of existing extension.
        """
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create initial extension
        extension_data = APIBasedExtension()
        extension_data.tenant_id = tenant.id
        extension_data.name = fake.company()
        extension_data.api_endpoint = f"https://{fake.domain_name()}/api"
        extension_data.api_key = fake.password(length=20)

        created_extension = APIBasedExtensionService.save(extension_data)

        # Save original values for later comparison
        original_name = created_extension.name
        original_endpoint = created_extension.api_endpoint

        # Update the extension
        new_name = fake.company()
        new_endpoint = f"https://{fake.domain_name()}/api"
        new_api_key = fake.password(length=20)

        created_extension.name = new_name
        created_extension.api_endpoint = new_endpoint
        created_extension.api_key = new_api_key

        updated_extension = APIBasedExtensionService.save(created_extension)

        # Verify extension was updated correctly
        assert updated_extension.id == created_extension.id
        assert updated_extension.tenant_id == tenant.id
        assert updated_extension.name == new_name
        assert updated_extension.api_endpoint == new_endpoint

        # Verify original values were changed
        assert updated_extension.name != original_name
        assert updated_extension.api_endpoint != original_endpoint

        # Verify ping connection was called for both create and update
        assert mock_external_service_dependencies["requestor_instance"].request.call_count == 2

        # Verify the update by retrieving the extension again
        retrieved_extension = APIBasedExtensionService.get_with_tenant_id(tenant.id, created_extension.id)
        assert retrieved_extension.name == new_name
        assert retrieved_extension.api_endpoint == new_endpoint
        assert retrieved_extension.api_key == new_api_key  # Should be decrypted when retrieved

    def test_save_extension_connection_error(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test connection error when saving extension with invalid endpoint.
        """
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Mock connection error
        mock_external_service_dependencies["requestor_instance"].request.side_effect = ValueError(
            "connection error: request timeout"
        )

        # Setup extension data
        extension_data = APIBasedExtension()
        extension_data.tenant_id = tenant.id
        extension_data.name = fake.company()
        extension_data.api_endpoint = "https://invalid-endpoint.com/api"
        extension_data.api_key = fake.password(length=20)

        # Try to save extension with connection error
        with pytest.raises(ValueError, match="connection error: request timeout"):
            APIBasedExtensionService.save(extension_data)

    def test_save_extension_invalid_api_key_length(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test validation error when saving extension with API key that is too short.
        """
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Setup extension data with short API key
        extension_data = APIBasedExtension()
        extension_data.tenant_id = tenant.id
        extension_data.name = fake.company()
        extension_data.api_endpoint = f"https://{fake.domain_name()}/api"
        extension_data.api_key = "1234"  # Less than 5 characters

        # Try to save extension with short API key
        with pytest.raises(ValueError, match="api_key must be at least 5 characters"):
            APIBasedExtensionService.save(extension_data)

    def test_save_extension_empty_fields(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test validation errors when saving extension with empty required fields.
        """
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Test with None values
        extension_data = APIBasedExtension()
        extension_data.tenant_id = tenant.id
        extension_data.name = None
        extension_data.api_endpoint = f"https://{fake.domain_name()}/api"
        extension_data.api_key = fake.password(length=20)

        with pytest.raises(ValueError, match="name must not be empty"):
            APIBasedExtensionService.save(extension_data)

        # Test with None api_endpoint
        extension_data.name = fake.company()
        extension_data.api_endpoint = None

        with pytest.raises(ValueError, match="api_endpoint must not be empty"):
            APIBasedExtensionService.save(extension_data)

        # Test with None api_key
        extension_data.api_endpoint = f"https://{fake.domain_name()}/api"
        extension_data.api_key = None

        with pytest.raises(ValueError, match="api_key must not be empty"):
            APIBasedExtensionService.save(extension_data)

    def test_get_all_by_tenant_id_empty_list(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test retrieval of extensions when no extensions exist for tenant.
        """
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Get all extensions for tenant (none exist)
        extension_list = APIBasedExtensionService.get_all_by_tenant_id(tenant.id)

        # Verify empty list is returned
        assert len(extension_list) == 0
        assert extension_list == []

    def test_save_extension_invalid_ping_response(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test validation error when ping response is invalid.
        """
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Mock invalid ping response
        mock_external_service_dependencies["requestor_instance"].request.return_value = {"result": "invalid"}

        # Setup extension data
        extension_data = APIBasedExtension()
        extension_data.tenant_id = tenant.id
        extension_data.name = fake.company()
        extension_data.api_endpoint = f"https://{fake.domain_name()}/api"
        extension_data.api_key = fake.password(length=20)

        # Try to save extension with invalid ping response
        with pytest.raises(ValueError, match="{'result': 'invalid'}"):
            APIBasedExtensionService.save(extension_data)

    def test_save_extension_missing_ping_result(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test validation error when ping response is missing result field.
        """
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Mock ping response without result field
        mock_external_service_dependencies["requestor_instance"].request.return_value = {"status": "ok"}

        # Setup extension data
        extension_data = APIBasedExtension()
        extension_data.tenant_id = tenant.id
        extension_data.name = fake.company()
        extension_data.api_endpoint = f"https://{fake.domain_name()}/api"
        extension_data.api_key = fake.password(length=20)

        # Try to save extension with missing ping result
        with pytest.raises(ValueError, match="{'status': 'ok'}"):
            APIBasedExtensionService.save(extension_data)

    def test_get_with_tenant_id_wrong_tenant(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test retrieval of extension when tenant ID doesn't match.
        """
        fake = Faker()
        account1, tenant1 = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create second account and tenant
        account2, tenant2 = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create extension in first tenant
        extension_data = APIBasedExtension()
        extension_data.tenant_id = tenant1.id
        extension_data.name = fake.company()
        extension_data.api_endpoint = f"https://{fake.domain_name()}/api"
        extension_data.api_key = fake.password(length=20)

        created_extension = APIBasedExtensionService.save(extension_data)

        # Try to get extension with wrong tenant ID
        with pytest.raises(ValueError, match="API based extension is not found"):
            APIBasedExtensionService.get_with_tenant_id(tenant2.id, created_extension.id)
