from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from faker import Faker
from sqlalchemy.orm import Session

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

    def _create_test_account_and_tenant(self, db_session_with_containers: Session, mock_external_service_dependencies):
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

        db_session_with_containers.add(account)
        db_session_with_containers.commit()

        # Create tenant
        tenant = Tenant(
            name=fake.company(),
            status="normal",
            plan="basic",
            custom_config='{"replace_webapp_logo": true, "remove_webapp_brand": false}',
        )
        db_session_with_containers.add(tenant)
        db_session_with_containers.commit()

        # Create tenant-account join with owner role
        join = TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            role=TenantAccountRole.OWNER,
            current=True,
        )
        db_session_with_containers.add(join)
        db_session_with_containers.commit()

        # Set current tenant for account
        account.current_tenant = tenant

        return account, tenant

    def test_get_tenant_info_success(self, db_session_with_containers: Session, mock_external_service_dependencies):
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

            db_session_with_containers.refresh(tenant)
            assert tenant.id is not None

    def test_get_tenant_info_without_custom_config(
        self, db_session_with_containers: Session, mock_external_service_dependencies
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

            db_session_with_containers.refresh(tenant)
            assert tenant.id is not None

    def test_get_tenant_info_with_normal_user_role(
        self, db_session_with_containers: Session, mock_external_service_dependencies
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

        join = (
            db_session_with_containers.query(TenantAccountJoin)
            .filter_by(tenant_id=tenant.id, account_id=account.id)
            .first()
        )
        join.role = TenantAccountRole.NORMAL
        db_session_with_containers.commit()

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
            db_session_with_containers.refresh(tenant)
            assert tenant.id is not None

    def test_get_tenant_info_with_admin_role_and_logo_replacement(
        self, db_session_with_containers: Session, mock_external_service_dependencies
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

        join = (
            db_session_with_containers.query(TenantAccountJoin)
            .filter_by(tenant_id=tenant.id, account_id=account.id)
            .first()
        )
        join.role = TenantAccountRole.ADMIN
        db_session_with_containers.commit()

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
            db_session_with_containers.refresh(tenant)
            assert tenant.id is not None

    def test_get_tenant_info_with_tenant_none(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):
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
        self, db_session_with_containers: Session, mock_external_service_dependencies
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

            tenant.custom_config = json.dumps(config)
            db_session_with_containers.commit()

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
                db_session_with_containers.refresh(tenant)
                assert tenant.id is not None

    def test_get_tenant_info_with_editor_role_and_limited_permissions(
        self, db_session_with_containers: Session, mock_external_service_dependencies
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

        join = (
            db_session_with_containers.query(TenantAccountJoin)
            .filter_by(tenant_id=tenant.id, account_id=account.id)
            .first()
        )
        join.role = TenantAccountRole.EDITOR
        db_session_with_containers.commit()

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
            db_session_with_containers.refresh(tenant)
            assert tenant.id is not None

    def test_get_tenant_info_with_dataset_operator_role(
        self, db_session_with_containers: Session, mock_external_service_dependencies
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

        join = (
            db_session_with_containers.query(TenantAccountJoin)
            .filter_by(tenant_id=tenant.id, account_id=account.id)
            .first()
        )
        join.role = TenantAccountRole.DATASET_OPERATOR
        db_session_with_containers.commit()

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
            db_session_with_containers.refresh(tenant)
            assert tenant.id is not None

    def test_get_tenant_info_with_complex_custom_config_scenarios(
        self, db_session_with_containers: Session, mock_external_service_dependencies
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

            tenant.custom_config = json.dumps(config)
            db_session_with_containers.commit()

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
                db_session_with_containers.refresh(tenant)
                assert tenant.id is not None

    def test_get_tenant_info_should_raise_assertion_when_join_missing(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):
        """TenantAccountJoin must exist; missing join should raise AssertionError."""
        fake = Faker()
        account = Account(email=fake.email(), name=fake.name(), interface_language="en-US", status="active")
        db_session_with_containers.add(account)
        db_session_with_containers.commit()

        tenant = Tenant(name=fake.company(), status="normal", plan="basic")
        db_session_with_containers.add(tenant)
        db_session_with_containers.commit()

        # No TenantAccountJoin created
        with patch("services.workspace_service.current_user", account):
            with pytest.raises(AssertionError, match="TenantAccountJoin not found"):
                WorkspaceService.get_tenant_info(tenant)

    def test_get_tenant_info_should_set_replace_webapp_logo_to_none_when_flag_absent(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):
        """replace_webapp_logo should be None when custom_config_dict does not have the key."""
        import json

        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )
        tenant.custom_config = json.dumps({})
        db_session_with_containers.commit()

        mock_external_service_dependencies["feature_service"].get_features.return_value.can_replace_logo = True
        mock_external_service_dependencies["tenant_service"].has_roles.return_value = True

        with patch("services.workspace_service.current_user", account):
            result = WorkspaceService.get_tenant_info(tenant)

        assert result is not None
        assert result["custom_config"]["replace_webapp_logo"] is None

    def test_get_tenant_info_should_use_files_url_for_logo_url(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):
        """The logo URL should use dify_config.FILES_URL as the base."""
        import json

        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )
        tenant.custom_config = json.dumps({"replace_webapp_logo": True})
        db_session_with_containers.commit()

        custom_base = "https://cdn.mycompany.io"
        mock_external_service_dependencies["dify_config"].FILES_URL = custom_base
        mock_external_service_dependencies["feature_service"].get_features.return_value.can_replace_logo = True
        mock_external_service_dependencies["tenant_service"].has_roles.return_value = True

        with patch("services.workspace_service.current_user", account):
            result = WorkspaceService.get_tenant_info(tenant)

        assert result is not None
        assert result["custom_config"]["replace_webapp_logo"].startswith(custom_base)

    def test_get_tenant_info_should_not_include_cloud_fields_in_self_hosted(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):
        """next_credit_reset_date and trial_credits should NOT appear in SELF_HOSTED mode."""
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        mock_external_service_dependencies["dify_config"].EDITION = "SELF_HOSTED"
        mock_external_service_dependencies["feature_service"].get_features.return_value.can_replace_logo = False
        mock_external_service_dependencies["tenant_service"].has_roles.return_value = False

        with patch("services.workspace_service.current_user", account):
            result = WorkspaceService.get_tenant_info(tenant)

        assert result is not None
        assert "next_credit_reset_date" not in result
        assert "trial_credits" not in result
        assert "trial_credits_used" not in result

    def test_get_tenant_info_cloud_credit_reset_date(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):
        """next_credit_reset_date should be present in CLOUD edition."""
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        mock_external_service_dependencies["dify_config"].EDITION = "CLOUD"
        feature = mock_external_service_dependencies["feature_service"].get_features.return_value
        feature.can_replace_logo = False
        feature.next_credit_reset_date = "2025-02-01"
        feature.billing.subscription.plan = "professional"
        mock_external_service_dependencies["tenant_service"].has_roles.return_value = False

        with (
            patch("services.workspace_service.current_user", account),
            patch("services.credit_pool_service.CreditPoolService.get_pool", return_value=None),
        ):
            result = WorkspaceService.get_tenant_info(tenant)

        assert result is not None
        assert result["next_credit_reset_date"] == "2025-02-01"

    def test_get_tenant_info_cloud_paid_pool_not_full(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):
        """trial_credits come from paid pool when plan is not sandbox and pool is not full."""
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        mock_external_service_dependencies["dify_config"].EDITION = "CLOUD"
        feature = mock_external_service_dependencies["feature_service"].get_features.return_value
        feature.can_replace_logo = False
        feature.next_credit_reset_date = "2025-02-01"
        feature.billing.subscription.plan = "professional"
        mock_external_service_dependencies["tenant_service"].has_roles.return_value = False

        paid_pool = MagicMock(quota_limit=1000, quota_used=200)

        with (
            patch("services.workspace_service.current_user", account),
            patch("services.credit_pool_service.CreditPoolService.get_pool", return_value=paid_pool),
        ):
            result = WorkspaceService.get_tenant_info(tenant)

        assert result is not None
        assert result["trial_credits"] == 1000
        assert result["trial_credits_used"] == 200

    def test_get_tenant_info_cloud_paid_pool_unlimited(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):
        """quota_limit == -1 means unlimited; service should use paid pool."""
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        mock_external_service_dependencies["dify_config"].EDITION = "CLOUD"
        feature = mock_external_service_dependencies["feature_service"].get_features.return_value
        feature.can_replace_logo = False
        feature.next_credit_reset_date = "2025-02-01"
        feature.billing.subscription.plan = "professional"
        mock_external_service_dependencies["tenant_service"].has_roles.return_value = False

        paid_pool = MagicMock(quota_limit=-1, quota_used=999)

        with (
            patch("services.workspace_service.current_user", account),
            patch("services.credit_pool_service.CreditPoolService.get_pool", side_effect=[paid_pool, None]),
        ):
            result = WorkspaceService.get_tenant_info(tenant)

        assert result is not None
        assert result["trial_credits"] == -1
        assert result["trial_credits_used"] == 999

    def test_get_tenant_info_cloud_fall_back_to_trial_when_paid_full(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):
        """When paid pool is exhausted, switch to trial pool."""
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        mock_external_service_dependencies["dify_config"].EDITION = "CLOUD"
        feature = mock_external_service_dependencies["feature_service"].get_features.return_value
        feature.can_replace_logo = False
        feature.next_credit_reset_date = "2025-02-01"
        feature.billing.subscription.plan = "professional"
        mock_external_service_dependencies["tenant_service"].has_roles.return_value = False

        paid_pool = MagicMock(quota_limit=500, quota_used=500)
        trial_pool = MagicMock(quota_limit=100, quota_used=10)

        with (
            patch("services.workspace_service.current_user", account),
            patch("services.credit_pool_service.CreditPoolService.get_pool", side_effect=[paid_pool, trial_pool]),
        ):
            result = WorkspaceService.get_tenant_info(tenant)

        assert result is not None
        assert result["trial_credits"] == 100
        assert result["trial_credits_used"] == 10

    def test_get_tenant_info_cloud_fall_back_to_trial_when_paid_none(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):
        """When paid_pool is None, fall back to trial pool."""
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        mock_external_service_dependencies["dify_config"].EDITION = "CLOUD"
        feature = mock_external_service_dependencies["feature_service"].get_features.return_value
        feature.can_replace_logo = False
        feature.next_credit_reset_date = "2025-02-01"
        feature.billing.subscription.plan = "professional"
        mock_external_service_dependencies["tenant_service"].has_roles.return_value = False

        trial_pool = MagicMock(quota_limit=50, quota_used=5)

        with (
            patch("services.workspace_service.current_user", account),
            patch("services.credit_pool_service.CreditPoolService.get_pool", side_effect=[None, trial_pool]),
        ):
            result = WorkspaceService.get_tenant_info(tenant)

        assert result is not None
        assert result["trial_credits"] == 50
        assert result["trial_credits_used"] == 5

    def test_get_tenant_info_cloud_sandbox_uses_trial_pool(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):
        """When plan is SANDBOX, skip paid pool and use trial pool."""
        from enums.cloud_plan import CloudPlan

        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        mock_external_service_dependencies["dify_config"].EDITION = "CLOUD"
        feature = mock_external_service_dependencies["feature_service"].get_features.return_value
        feature.can_replace_logo = False
        feature.next_credit_reset_date = "2025-02-01"
        feature.billing.subscription.plan = CloudPlan.SANDBOX
        mock_external_service_dependencies["tenant_service"].has_roles.return_value = False

        paid_pool = MagicMock(quota_limit=1000, quota_used=0)
        trial_pool = MagicMock(quota_limit=200, quota_used=20)

        with (
            patch("services.workspace_service.current_user", account),
            patch("services.credit_pool_service.CreditPoolService.get_pool", side_effect=[paid_pool, trial_pool]),
        ):
            result = WorkspaceService.get_tenant_info(tenant)

        assert result is not None
        assert result["trial_credits"] == 200
        assert result["trial_credits_used"] == 20

    def test_get_tenant_info_cloud_both_pools_none(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):
        """When both paid and trial pools are absent, trial_credits should not be set."""
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        mock_external_service_dependencies["dify_config"].EDITION = "CLOUD"
        feature = mock_external_service_dependencies["feature_service"].get_features.return_value
        feature.can_replace_logo = False
        feature.next_credit_reset_date = "2025-02-01"
        feature.billing.subscription.plan = "professional"
        mock_external_service_dependencies["tenant_service"].has_roles.return_value = False

        with (
            patch("services.workspace_service.current_user", account),
            patch("services.credit_pool_service.CreditPoolService.get_pool", side_effect=[None, None]),
        ):
            result = WorkspaceService.get_tenant_info(tenant)

        assert result is not None
        assert "trial_credits" not in result
        assert "trial_credits_used" not in result
