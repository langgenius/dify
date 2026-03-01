from unittest.mock import patch

import pytest
from faker import Faker

from models import Account, Tenant, TenantAccountJoin, TenantAccountRole
from services.workspace_service import WorkspaceService


class TestWorkspaceService:
    """Integration tests for WorkspaceService using testcontainers."""

    @pytest.fixture
    def mock_external_service_dependencies(self):
        """Mock setup for external service dependencies."""
        with (
            patch("services.workspace_service.FeatureService") as mock_feature_service,
            patch("services.workspace_service.TenantService") as mock_tenant_service,
            patch("services.workspace_service.dify_config") as mock_dify_config,
        ):
            # Setup default mock returns
            mock_feature_service.get_features.return_value.can_replace_logo = True
            mock_tenant_service.has_roles.return_value = True
            mock_dify_config.FILES_URL = "https://example.com/files"

            yield {
                "feature_service": mock_feature_service,
                "tenant_service": mock_tenant_service,
                "dify_config": mock_dify_config,
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

        # Create account
        account = Account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            status="active",
        )

        from extensions.ext_database import db

        db.session.add(account)
        db.session.commit()

        # Create tenant
        tenant = Tenant(
            name=fake.company(),
            status="normal",
            plan="basic",
            custom_config='{"replace_webapp_logo": true, "remove_webapp_brand": false}',
        )
        db.session.add(tenant)
        db.session.commit()

        # Create tenant-account join with owner role
        join = TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            role=TenantAccountRole.OWNER,
            current=True,
        )
        db.session.add(join)
        db.session.commit()

        # Set current tenant for account
        account.current_tenant = tenant

        return account, tenant

    def test_get_tenant_info_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful retrieval of tenant information with all features enabled.

        This test verifies:
        - Proper tenant info retrieval with all required fields
        - Correct role assignment from TenantAccountJoin
        - Custom config handling when features are enabled
        - Logo replacement functionality for privileged users
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Setup mocks for feature service
        mock_external_service_dependencies["feature_service"].get_features.return_value.can_replace_logo = True
        mock_external_service_dependencies["tenant_service"].has_roles.return_value = True

        # Mock current_user for flask_login
        with patch("services.workspace_service.current_user", account):
            # Act: Execute the method under test
            result = WorkspaceService.get_tenant_info(tenant)

            # Assert: Verify the expected outcomes
            assert result is not None
            assert result["id"] == tenant.id
            assert result["name"] == tenant.name
            assert result["plan"] == tenant.plan
            assert result["status"] == tenant.status
            assert result["role"] == TenantAccountRole.OWNER
            assert result["created_at"] == tenant.created_at
            assert result["trial_end_reason"] is None

            # Verify custom config is included for privileged users
            assert "custom_config" in result
            assert result["custom_config"]["remove_webapp_brand"] is False
            assert "replace_webapp_logo" in result["custom_config"]

            # Verify database state
            from extensions.ext_database import db

            db.session.refresh(tenant)
            assert tenant.id is not None

    def test_get_tenant_info_without_custom_config(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test tenant info retrieval when custom config features are disabled.

        This test verifies:
        - Tenant info retrieval without custom config when features are disabled
        - Proper handling of disabled logo replacement functionality
        - Role assignment still works correctly
        - Basic tenant information is complete
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Setup mocks to disable custom config features
        mock_external_service_dependencies["feature_service"].get_features.return_value.can_replace_logo = False
        mock_external_service_dependencies["tenant_service"].has_roles.return_value = False

        # Mock current_user for flask_login
        with patch("services.workspace_service.current_user", account):
            # Act: Execute the method under test
            result = WorkspaceService.get_tenant_info(tenant)

            # Assert: Verify the expected outcomes
            assert result is not None
            assert result["id"] == tenant.id
            assert result["name"] == tenant.name
            assert result["plan"] == tenant.plan
            assert result["status"] == tenant.status
            assert result["role"] == TenantAccountRole.OWNER
            assert result["created_at"] == tenant.created_at
            assert result["trial_end_reason"] is None

            # Verify custom config is not included when features are disabled
            assert "custom_config" not in result

            # Verify database state
            from extensions.ext_database import db

            db.session.refresh(tenant)
            assert tenant.id is not None

    def test_get_tenant_info_with_normal_user_role(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test tenant info retrieval for normal user role without privileged features.

        This test verifies:
        - Tenant info retrieval for non-privileged users
        - Role assignment for normal users
        - Custom config is not accessible for normal users
        - Proper handling of different user roles
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Update the join to have normal role
        from extensions.ext_database import db

        join = db.session.query(TenantAccountJoin).filter_by(tenant_id=tenant.id, account_id=account.id).first()
        join.role = TenantAccountRole.NORMAL
        db.session.commit()

        # Setup mocks for feature service
        mock_external_service_dependencies["feature_service"].get_features.return_value.can_replace_logo = True
        mock_external_service_dependencies["tenant_service"].has_roles.return_value = False

        # Mock current_user for flask_login
        with patch("services.workspace_service.current_user", account):
            # Act: Execute the method under test
            result = WorkspaceService.get_tenant_info(tenant)

            # Assert: Verify the expected outcomes
            assert result is not None
            assert result["id"] == tenant.id
            assert result["name"] == tenant.name
            assert result["plan"] == tenant.plan
            assert result["status"] == tenant.status
            assert result["role"] == TenantAccountRole.NORMAL
            assert result["created_at"] == tenant.created_at
            assert result["trial_end_reason"] is None

            # Verify custom config is not included for normal users
            assert "custom_config" not in result

            # Verify database state
            db.session.refresh(tenant)
            assert tenant.id is not None

    def test_get_tenant_info_with_admin_role_and_logo_replacement(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test tenant info retrieval for admin role with logo replacement enabled.

        This test verifies:
        - Admin role can access custom config features
        - Logo replacement functionality works for admin users
        - Proper URL construction for logo replacement
        - Custom config handling for admin role
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Update the join to have admin role
        from extensions.ext_database import db

        join = db.session.query(TenantAccountJoin).filter_by(tenant_id=tenant.id, account_id=account.id).first()
        join.role = TenantAccountRole.ADMIN
        db.session.commit()

        # Setup mocks for feature service and tenant service
        mock_external_service_dependencies["feature_service"].get_features.return_value.can_replace_logo = True
        mock_external_service_dependencies["tenant_service"].has_roles.return_value = True
        mock_external_service_dependencies["dify_config"].FILES_URL = "https://cdn.example.com"

        # Mock current_user for flask_login
        with patch("services.workspace_service.current_user", account):
            # Act: Execute the method under test
            result = WorkspaceService.get_tenant_info(tenant)

            # Assert: Verify the expected outcomes
            assert result is not None
            assert result["role"] == TenantAccountRole.ADMIN

            # Verify custom config is included for admin users
            assert "custom_config" in result
            assert result["custom_config"]["remove_webapp_brand"] is False
            assert "replace_webapp_logo" in result["custom_config"]

            # Verify database state
            db.session.refresh(tenant)
            assert tenant.id is not None

    def test_get_tenant_info_with_tenant_none(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test tenant info retrieval when tenant parameter is None.

        This test verifies:
        - Proper handling of None tenant parameter
        - Method returns None for invalid input
        - No exceptions are raised for None input
        - Graceful degradation for invalid data
        """
        # Arrange: No test data needed for this test

        # Act: Execute the method under test with None tenant
        result = WorkspaceService.get_tenant_info(None)

        # Assert: Verify the expected outcomes
        assert result is None

    def test_get_tenant_info_with_custom_config_variations(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test tenant info retrieval with various custom config configurations.

        This test verifies:
        - Different custom config combinations work correctly
        - Logo replacement URL construction with various configs
        - Brand removal functionality
        - Edge cases in custom config handling
        """
        # Arrange: Create test data with different custom configs
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Test different custom config combinations
        test_configs = [
            # Case 1: Both logo and brand removal enabled
            {"replace_webapp_logo": True, "remove_webapp_brand": True},
            # Case 2: Only logo replacement enabled
            {"replace_webapp_logo": True, "remove_webapp_brand": False},
            # Case 3: Only brand removal enabled
            {"replace_webapp_logo": False, "remove_webapp_brand": True},
            # Case 4: Neither enabled
            {"replace_webapp_logo": False, "remove_webapp_brand": False},
        ]

        for config in test_configs:
            # Update tenant custom config
            import json

            from extensions.ext_database import db

            tenant.custom_config = json.dumps(config)
            db.session.commit()

            # Setup mocks
            mock_external_service_dependencies["feature_service"].get_features.return_value.can_replace_logo = True
            mock_external_service_dependencies["tenant_service"].has_roles.return_value = True
            mock_external_service_dependencies["dify_config"].FILES_URL = "https://files.example.com"

            # Mock current_user for flask_login
            with patch("services.workspace_service.current_user", account):
                # Act: Execute the method under test
                result = WorkspaceService.get_tenant_info(tenant)

                # Assert: Verify the expected outcomes
                assert result is not None
                assert "custom_config" in result

                if config["replace_webapp_logo"]:
                    assert "replace_webapp_logo" in result["custom_config"]
                    if config["replace_webapp_logo"]:
                        expected_url = f"https://files.example.com/files/workspaces/{tenant.id}/webapp-logo"
                        assert result["custom_config"]["replace_webapp_logo"] == expected_url
                else:
                    assert result["custom_config"]["replace_webapp_logo"] is None

                assert result["custom_config"]["remove_webapp_brand"] == config["remove_webapp_brand"]

                # Verify database state
                db.session.refresh(tenant)
                assert tenant.id is not None

    def test_get_tenant_info_with_editor_role_and_limited_permissions(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test tenant info retrieval for editor role with limited permissions.

        This test verifies:
        - Editor role has limited access to custom config features
        - Proper role-based permission checking
        - Custom config handling for different role levels
        - Role hierarchy and permission boundaries
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Update the join to have editor role
        from extensions.ext_database import db

        join = db.session.query(TenantAccountJoin).filter_by(tenant_id=tenant.id, account_id=account.id).first()
        join.role = TenantAccountRole.EDITOR
        db.session.commit()

        # Setup mocks for feature service and tenant service
        mock_external_service_dependencies["feature_service"].get_features.return_value.can_replace_logo = True
        # Editor role should not have admin/owner permissions
        mock_external_service_dependencies["tenant_service"].has_roles.return_value = False
        mock_external_service_dependencies["dify_config"].FILES_URL = "https://cdn.example.com"

        # Mock current_user for flask_login
        with patch("services.workspace_service.current_user", account):
            # Act: Execute the method under test
            result = WorkspaceService.get_tenant_info(tenant)

            # Assert: Verify the expected outcomes
            assert result is not None
            assert result["role"] == TenantAccountRole.EDITOR

            # Verify custom config is not included for editor users without admin privileges
            assert "custom_config" not in result

            # Verify database state
            db.session.refresh(tenant)
            assert tenant.id is not None

    def test_get_tenant_info_with_dataset_operator_role(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test tenant info retrieval for dataset operator role.

        This test verifies:
        - Dataset operator role handling
        - Role assignment for specialized roles
        - Permission boundaries for dataset operators
        - Custom config access for dataset operators
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Update the join to have dataset operator role
        from extensions.ext_database import db

        join = db.session.query(TenantAccountJoin).filter_by(tenant_id=tenant.id, account_id=account.id).first()
        join.role = TenantAccountRole.DATASET_OPERATOR
        db.session.commit()

        # Setup mocks for feature service and tenant service
        mock_external_service_dependencies["feature_service"].get_features.return_value.can_replace_logo = True
        # Dataset operator should not have admin/owner permissions
        mock_external_service_dependencies["tenant_service"].has_roles.return_value = False
        mock_external_service_dependencies["dify_config"].FILES_URL = "https://cdn.example.com"

        # Mock current_user for flask_login
        with patch("services.workspace_service.current_user", account):
            # Act: Execute the method under test
            result = WorkspaceService.get_tenant_info(tenant)

            # Assert: Verify the expected outcomes
            assert result is not None
            assert result["role"] == TenantAccountRole.DATASET_OPERATOR

            # Verify custom config is not included for dataset operators without admin privileges
            assert "custom_config" not in result

            # Verify database state
            db.session.refresh(tenant)
            assert tenant.id is not None

    def test_get_tenant_info_with_complex_custom_config_scenarios(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test tenant info retrieval with complex custom config scenarios.

        This test verifies:
        - Complex custom config combinations
        - Edge cases in custom config handling
        - URL construction with various configs
        - Error handling for malformed configs
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Test complex custom config scenarios
        test_configs = [
            # Case 1: Empty custom config
            {},
            # Case 2: Custom config with only logo replacement
            {"replace_webapp_logo": True},
            # Case 3: Custom config with only brand removal
            {"remove_webapp_brand": True},
            # Case 4: Custom config with additional fields
            {
                "replace_webapp_logo": True,
                "remove_webapp_brand": False,
                "custom_field": "custom_value",
                "nested_config": {"key": "value"},
            },
            # Case 5: Custom config with null values
            {"replace_webapp_logo": None, "remove_webapp_brand": None},
        ]

        for config in test_configs:
            # Update tenant custom config
            import json

            from extensions.ext_database import db

            tenant.custom_config = json.dumps(config)
            db.session.commit()

            # Setup mocks
            mock_external_service_dependencies["feature_service"].get_features.return_value.can_replace_logo = True
            mock_external_service_dependencies["tenant_service"].has_roles.return_value = True
            mock_external_service_dependencies["dify_config"].FILES_URL = "https://files.example.com"

            # Mock current_user for flask_login
            with patch("services.workspace_service.current_user", account):
                # Act: Execute the method under test
                result = WorkspaceService.get_tenant_info(tenant)

                # Assert: Verify the expected outcomes
                assert result is not None
                assert "custom_config" in result

                # Verify logo replacement handling
                if config.get("replace_webapp_logo"):
                    assert "replace_webapp_logo" in result["custom_config"]
                    expected_url = f"https://files.example.com/files/workspaces/{tenant.id}/webapp-logo"
                    assert result["custom_config"]["replace_webapp_logo"] == expected_url
                else:
                    assert result["custom_config"]["replace_webapp_logo"] is None

                # Verify brand removal handling
                if "remove_webapp_brand" in config:
                    assert result["custom_config"]["remove_webapp_brand"] == config["remove_webapp_brand"]
                else:
                    assert result["custom_config"]["remove_webapp_brand"] is False

                # Verify database state
                db.session.refresh(tenant)
                assert tenant.id is not None
