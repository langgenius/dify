from unittest.mock import patch

import pytest
from faker import Faker

from services.feature_service import FeatureModel, FeatureService, KnowledgeRateLimitModel, SystemFeatureModel


class TestFeatureService:
    """Integration tests for FeatureService using testcontainers."""

    @pytest.fixture
    def mock_external_service_dependencies(self):
        """Mock setup for external service dependencies."""
        with (
            patch("services.feature_service.BillingService") as mock_billing_service,
            patch("services.feature_service.EnterpriseService") as mock_enterprise_service,
        ):
            # Setup default mock returns for BillingService
            mock_billing_service.get_info.return_value = {
                "enabled": True,
                "subscription": {"plan": "pro", "interval": "monthly", "education": True},
                "members": {"size": 5, "limit": 10},
                "apps": {"size": 3, "limit": 20},
                "vector_space": {"size": 2, "limit": 10},
                "documents_upload_quota": {"size": 15, "limit": 100},
                "annotation_quota_limit": {"size": 8, "limit": 50},
                "docs_processing": "enhanced",
                "can_replace_logo": True,
                "model_load_balancing_enabled": True,
                "knowledge_rate_limit": {"limit": 100},
            }

            mock_billing_service.get_knowledge_rate_limit.return_value = {"limit": 100, "subscription_plan": "pro"}

            # Setup default mock returns for EnterpriseService
            mock_enterprise_service.get_workspace_info.return_value = {
                "WorkspaceMembers": {"used": 5, "limit": 10, "enabled": True}
            }

            mock_enterprise_service.get_info.return_value = {
                "SSOEnforcedForSignin": True,
                "SSOEnforcedForSigninProtocol": "saml",
                "EnableEmailCodeLogin": True,
                "EnableEmailPasswordLogin": False,
                "IsAllowRegister": False,
                "IsAllowCreateWorkspace": False,
                "Branding": {
                    "applicationTitle": "Test Enterprise",
                    "loginPageLogo": "https://example.com/logo.png",
                    "workspaceLogo": "https://example.com/workspace.png",
                    "favicon": "https://example.com/favicon.ico",
                },
                "WebAppAuth": {"allowSso": True, "allowEmailCodeLogin": True, "allowEmailPasswordLogin": False},
                "SSOEnforcedForWebProtocol": "oidc",
                "License": {
                    "status": "active",
                    "expiredAt": "2025-12-31",
                    "workspaces": {"enabled": True, "limit": 5, "used": 2},
                },
                "PluginInstallationPermission": {
                    "pluginInstallationScope": "official_only",
                    "restrictToMarketplaceOnly": True,
                },
            }

            yield {
                "billing_service": mock_billing_service,
                "enterprise_service": mock_enterprise_service,
            }

    def _create_test_tenant_id(self):
        """Helper method to create a test tenant ID."""
        fake = Faker()
        return fake.uuid4()

    def test_get_features_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful feature retrieval with billing and enterprise enabled.

        This test verifies:
        - Proper feature model creation with all required fields
        - Correct integration with billing service
        - Proper enterprise workspace information handling
        - Return value correctness and structure
        """
        # Arrange: Setup test data with proper config mocking
        tenant_id = self._create_test_tenant_id()

        with patch("services.feature_service.dify_config") as mock_config:
            mock_config.BILLING_ENABLED = True
            mock_config.ENTERPRISE_ENABLED = True
            mock_config.CAN_REPLACE_LOGO = True
            mock_config.MODEL_LB_ENABLED = True
            mock_config.DATASET_OPERATOR_ENABLED = True
            mock_config.EDUCATION_ENABLED = True

            # Act: Execute the method under test
            result = FeatureService.get_features(tenant_id)

            # Assert: Verify the expected outcomes
            assert result is not None
            assert isinstance(result, FeatureModel)

            # Verify billing features
            assert result.billing.enabled is True
            assert result.billing.subscription.plan == "pro"
            assert result.billing.subscription.interval == "monthly"
            assert result.education.activated is True

            # Verify member limitations
            assert result.members.size == 5
            assert result.members.limit == 10

            # Verify app limitations
            assert result.apps.size == 3
            assert result.apps.limit == 20

            # Verify vector space limitations
            assert result.vector_space.size == 2
            assert result.vector_space.limit == 10

            # Verify document upload quota
            assert result.documents_upload_quota.size == 15
            assert result.documents_upload_quota.limit == 100

            # Verify annotation quota
            assert result.annotation_quota_limit.size == 8
            assert result.annotation_quota_limit.limit == 50

            # Verify other features
            assert result.docs_processing == "enhanced"
            assert result.can_replace_logo is True
            assert result.model_load_balancing_enabled is True
            assert result.knowledge_rate_limit == 100

            # Verify enterprise features
            assert result.workspace_members.enabled is True
            assert result.workspace_members.size == 5
            assert result.workspace_members.limit == 10

            # Verify webapp copyright is enabled for non-sandbox plans
            assert result.webapp_copyright_enabled is True
            assert result.is_allow_transfer_workspace is True

            # Verify mock interactions
            mock_external_service_dependencies["billing_service"].get_info.assert_called_once_with(tenant_id)
            mock_external_service_dependencies["enterprise_service"].get_workspace_info.assert_called_once_with(
                tenant_id
            )

    def test_get_features_sandbox_plan(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test feature retrieval for sandbox plan with specific limitations.

        This test verifies:
        - Proper handling of sandbox plan limitations
        - Correct webapp copyright settings for sandbox
        - Transfer workspace restrictions for sandbox plans
        - Proper billing service integration
        """
        # Arrange: Setup sandbox plan mock with proper config
        tenant_id = self._create_test_tenant_id()

        with patch("services.feature_service.dify_config") as mock_config:
            mock_config.BILLING_ENABLED = True
            mock_config.ENTERPRISE_ENABLED = False
            mock_config.CAN_REPLACE_LOGO = False
            mock_config.MODEL_LB_ENABLED = False
            mock_config.DATASET_OPERATOR_ENABLED = False
            mock_config.EDUCATION_ENABLED = False

            # Set mock return value inside the patch context
            mock_external_service_dependencies["billing_service"].get_info.return_value = {
                "enabled": True,
                "subscription": {"plan": "sandbox", "interval": "monthly", "education": False},
                "members": {"size": 1, "limit": 3},
                "apps": {"size": 1, "limit": 5},
                "vector_space": {"size": 1, "limit": 2},
                "documents_upload_quota": {"size": 5, "limit": 20},
                "annotation_quota_limit": {"size": 2, "limit": 10},
                "docs_processing": "standard",
                "can_replace_logo": False,
                "model_load_balancing_enabled": False,
                "knowledge_rate_limit": {"limit": 10},
            }

            # Act: Execute the method under test
            result = FeatureService.get_features(tenant_id)

        # Assert: Verify sandbox-specific limitations
        assert result.billing.subscription.plan == "sandbox"
        assert result.education.activated is False

        # Verify sandbox limitations
        assert result.members.size == 1
        assert result.members.limit == 3
        assert result.apps.size == 1
        assert result.apps.limit == 5
        assert result.vector_space.size == 1
        assert result.vector_space.limit == 2
        assert result.documents_upload_quota.size == 5
        assert result.documents_upload_quota.limit == 20
        assert result.annotation_quota_limit.size == 2
        assert result.annotation_quota_limit.limit == 10

        # Verify sandbox-specific restrictions
        assert result.webapp_copyright_enabled is False
        assert result.is_allow_transfer_workspace is False
        assert result.can_replace_logo is False
        assert result.model_load_balancing_enabled is False
        assert result.docs_processing == "standard"
        assert result.knowledge_rate_limit == 10

        # Verify mock interactions
        mock_external_service_dependencies["billing_service"].get_info.assert_called_once_with(tenant_id)

    def test_get_knowledge_rate_limit_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful knowledge rate limit retrieval with billing enabled.

        This test verifies:
        - Proper knowledge rate limit model creation
        - Correct integration with billing service
        - Proper rate limit configuration
        - Return value correctness and structure
        """
        # Arrange: Setup test data with proper config
        tenant_id = self._create_test_tenant_id()

        with patch("services.feature_service.dify_config") as mock_config:
            mock_config.BILLING_ENABLED = True

            # Act: Execute the method under test
            result = FeatureService.get_knowledge_rate_limit(tenant_id)

            # Assert: Verify the expected outcomes
            assert result is not None
            assert isinstance(result, KnowledgeRateLimitModel)

            # Verify rate limit configuration
            assert result.enabled is True
            assert result.limit == 100
            assert result.subscription_plan == "pro"

            # Verify mock interactions
            mock_external_service_dependencies["billing_service"].get_knowledge_rate_limit.assert_called_once_with(
                tenant_id
            )

    def test_get_system_features_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful system features retrieval with enterprise and marketplace enabled.

        This test verifies:
        - Proper system feature model creation
        - Correct integration with enterprise service
        - Proper marketplace configuration
        - Return value correctness and structure
        """
        # Arrange: Setup test data with proper config
        tenant_id = self._create_test_tenant_id()

        with patch("services.feature_service.dify_config") as mock_config:
            mock_config.ENTERPRISE_ENABLED = True
            mock_config.MARKETPLACE_ENABLED = True
            mock_config.ENABLE_EMAIL_CODE_LOGIN = True
            mock_config.ENABLE_EMAIL_PASSWORD_LOGIN = True
            mock_config.ENABLE_SOCIAL_OAUTH_LOGIN = False
            mock_config.ALLOW_REGISTER = False
            mock_config.ALLOW_CREATE_WORKSPACE = False
            mock_config.MAIL_TYPE = "smtp"
            mock_config.PLUGIN_MAX_PACKAGE_SIZE = 100

            # Act: Execute the method under test
            result = FeatureService.get_system_features()

        # Assert: Verify the expected outcomes
        assert result is not None
        assert isinstance(result, SystemFeatureModel)

        # Verify enterprise features
        assert result.branding.enabled is True
        assert result.webapp_auth.enabled is True
        assert result.enable_change_email is False

        # Verify SSO configuration
        assert result.sso_enforced_for_signin is True
        assert result.sso_enforced_for_signin_protocol == "saml"

        # Verify authentication settings
        assert result.enable_email_code_login is True
        assert result.enable_email_password_login is False
        assert result.is_allow_register is False
        assert result.is_allow_create_workspace is False

        # Verify branding configuration
        assert result.branding.application_title == "Test Enterprise"
        assert result.branding.login_page_logo == "https://example.com/logo.png"
        assert result.branding.workspace_logo == "https://example.com/workspace.png"
        assert result.branding.favicon == "https://example.com/favicon.ico"

        # Verify webapp auth configuration
        assert result.webapp_auth.allow_sso is True
        assert result.webapp_auth.allow_email_code_login is True
        assert result.webapp_auth.allow_email_password_login is False
        assert result.webapp_auth.sso_config.protocol == "oidc"

        # Verify license configuration
        assert result.license.status.value == "active"
        assert result.license.expired_at == "2025-12-31"
        assert result.license.workspaces.enabled is True
        assert result.license.workspaces.limit == 5
        assert result.license.workspaces.size == 2

        # Verify plugin installation permission
        assert result.plugin_installation_permission.plugin_installation_scope == "official_only"
        assert result.plugin_installation_permission.restrict_to_marketplace_only is True

        # Verify marketplace configuration
        assert result.enable_marketplace is True

        # Verify mock interactions
        mock_external_service_dependencies["enterprise_service"].get_info.assert_called_once()

    def test_get_system_features_basic_config(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test system features retrieval with basic configuration (no enterprise).

        This test verifies:
        - Proper system feature model creation without enterprise
        - Correct environment variable handling
        - Default configuration values
        - Return value correctness and structure
        """
        # Arrange: Setup basic config mock (no enterprise)
        with patch("services.feature_service.dify_config") as mock_config:
            mock_config.ENTERPRISE_ENABLED = False
            mock_config.MARKETPLACE_ENABLED = False
            mock_config.ENABLE_EMAIL_CODE_LOGIN = True
            mock_config.ENABLE_EMAIL_PASSWORD_LOGIN = True
            mock_config.ENABLE_SOCIAL_OAUTH_LOGIN = False
            mock_config.ALLOW_REGISTER = True
            mock_config.ALLOW_CREATE_WORKSPACE = True
            mock_config.MAIL_TYPE = "smtp"
            mock_config.PLUGIN_MAX_PACKAGE_SIZE = 100

            # Act: Execute the method under test
            result = FeatureService.get_system_features()

            # Assert: Verify the expected outcomes
            assert result is not None
            assert isinstance(result, SystemFeatureModel)

            # Verify basic configuration
            assert result.branding.enabled is False
            assert result.webapp_auth.enabled is False
            assert result.enable_change_email is True

            # Verify authentication settings from config
            assert result.enable_email_code_login is True
            assert result.enable_email_password_login is True
            assert result.enable_social_oauth_login is False
            assert result.is_allow_register is True
            assert result.is_allow_create_workspace is True
            assert result.is_email_setup is True

            # Verify marketplace configuration
            assert result.enable_marketplace is False

            # Verify plugin package size (uses default value from dify_config)
            assert result.max_plugin_package_size == 15728640

    def test_get_features_billing_disabled(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test feature retrieval when billing is disabled.

        This test verifies:
        - Proper feature model creation without billing
        - Correct environment variable handling
        - Default configuration values
        - Return value correctness and structure
        """
        # Arrange: Setup billing disabled mock
        with patch("services.feature_service.dify_config") as mock_config:
            mock_config.BILLING_ENABLED = False
            mock_config.ENTERPRISE_ENABLED = False
            mock_config.CAN_REPLACE_LOGO = True
            mock_config.MODEL_LB_ENABLED = True
            mock_config.DATASET_OPERATOR_ENABLED = True
            mock_config.EDUCATION_ENABLED = True

            tenant_id = self._create_test_tenant_id()

            # Act: Execute the method under test
            result = FeatureService.get_features(tenant_id)

            # Assert: Verify the expected outcomes
            assert result is not None
            assert isinstance(result, FeatureModel)

            # Verify billing is disabled
            assert result.billing.enabled is False

            # Verify environment-based features
            assert result.can_replace_logo is True
            assert result.model_load_balancing_enabled is True
            assert result.dataset_operator_enabled is True
            assert result.education.enabled is True

            # Verify default limitations
            assert result.members.size == 0
            assert result.members.limit == 1
            assert result.apps.size == 0
            assert result.apps.limit == 10
            assert result.vector_space.size == 0
            assert result.vector_space.limit == 5
            assert result.documents_upload_quota.size == 0
            assert result.documents_upload_quota.limit == 50
            assert result.annotation_quota_limit.size == 0
            assert result.annotation_quota_limit.limit == 10
            assert result.knowledge_rate_limit == 10
            assert result.docs_processing == "standard"

            # Verify no enterprise features
            assert result.workspace_members.enabled is False
            assert result.webapp_copyright_enabled is False

    def test_get_knowledge_rate_limit_billing_disabled(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test knowledge rate limit retrieval when billing is disabled.

        This test verifies:
        - Proper knowledge rate limit model creation without billing
        - Default rate limit configuration
        - Return value correctness and structure
        """
        # Arrange: Setup billing disabled mock
        with patch("services.feature_service.dify_config") as mock_config:
            mock_config.BILLING_ENABLED = False

            tenant_id = self._create_test_tenant_id()

            # Act: Execute the method under test
            result = FeatureService.get_knowledge_rate_limit(tenant_id)

            # Assert: Verify the expected outcomes
            assert result is not None
            assert isinstance(result, KnowledgeRateLimitModel)

            # Verify default configuration
            assert result.enabled is False
            assert result.limit == 10
            assert result.subscription_plan == ""  # Empty string when billing is disabled

            # Verify no billing service calls
            mock_external_service_dependencies["billing_service"].get_knowledge_rate_limit.assert_not_called()

    def test_get_features_enterprise_only(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test feature retrieval with enterprise enabled but billing disabled.

        This test verifies:
        - Proper feature model creation with enterprise only
        - Correct enterprise service integration
        - Proper workspace member handling
        - Return value correctness and structure
        """
        # Arrange: Setup enterprise only mock
        with patch("services.feature_service.dify_config") as mock_config:
            mock_config.BILLING_ENABLED = False
            mock_config.ENTERPRISE_ENABLED = True
            mock_config.CAN_REPLACE_LOGO = False
            mock_config.MODEL_LB_ENABLED = False
            mock_config.DATASET_OPERATOR_ENABLED = False
            mock_config.EDUCATION_ENABLED = False

            tenant_id = self._create_test_tenant_id()

            # Act: Execute the method under test
            result = FeatureService.get_features(tenant_id)

            # Assert: Verify the expected outcomes
            assert result is not None
            assert isinstance(result, FeatureModel)

            # Verify billing is disabled
            assert result.billing.enabled is False

            # Verify enterprise features
            assert result.webapp_copyright_enabled is True

            # Verify workspace members from enterprise
            assert result.workspace_members.enabled is True
            assert result.workspace_members.size == 5
            assert result.workspace_members.limit == 10

            # Verify environment-based features
            assert result.can_replace_logo is False
            assert result.model_load_balancing_enabled is False
            assert result.dataset_operator_enabled is False
            assert result.education.enabled is False

            # Verify default limitations
            assert result.members.size == 0
            assert result.members.limit == 1
            assert result.apps.size == 0
            assert result.apps.limit == 10
            assert result.vector_space.size == 0
            assert result.vector_space.limit == 5

            # Verify mock interactions
            mock_external_service_dependencies["enterprise_service"].get_workspace_info.assert_called_once_with(
                tenant_id
            )
            mock_external_service_dependencies["billing_service"].get_info.assert_not_called()

    def test_get_system_features_enterprise_disabled(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test system features retrieval when enterprise is disabled.

        This test verifies:
        - Proper system feature model creation without enterprise
        - Correct environment variable handling
        - Default configuration values
        - Return value correctness and structure
        """
        # Arrange: Setup enterprise disabled mock
        with patch("services.feature_service.dify_config") as mock_config:
            mock_config.ENTERPRISE_ENABLED = False
            mock_config.MARKETPLACE_ENABLED = True
            mock_config.ENABLE_EMAIL_CODE_LOGIN = False
            mock_config.ENABLE_EMAIL_PASSWORD_LOGIN = True
            mock_config.ENABLE_SOCIAL_OAUTH_LOGIN = True
            mock_config.ALLOW_REGISTER = False
            mock_config.ALLOW_CREATE_WORKSPACE = False
            mock_config.MAIL_TYPE = None
            mock_config.PLUGIN_MAX_PACKAGE_SIZE = 50

            # Act: Execute the method under test
            result = FeatureService.get_system_features()

            # Assert: Verify the expected outcomes
            assert result is not None
            assert isinstance(result, SystemFeatureModel)

            # Verify enterprise features are disabled
            assert result.branding.enabled is False
            assert result.webapp_auth.enabled is False
            assert result.enable_change_email is True

            # Verify authentication settings from config
            assert result.enable_email_code_login is False
            assert result.enable_email_password_login is True
            assert result.enable_social_oauth_login is True
            assert result.is_allow_register is False
            assert result.is_allow_create_workspace is False
            assert result.is_email_setup is False

            # Verify marketplace configuration
            assert result.enable_marketplace is True

            # Verify plugin package size (uses default value from dify_config)
            assert result.max_plugin_package_size == 15728640

            # Verify default license status
            assert result.license.status.value == "none"
            assert result.license.expired_at == ""
            assert result.license.workspaces.enabled is False

            # Verify no enterprise service calls
            mock_external_service_dependencies["enterprise_service"].get_info.assert_not_called()

    def test_get_features_no_tenant_id(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test feature retrieval without tenant ID (billing disabled).

        This test verifies:
        - Proper feature model creation without tenant ID
        - Correct handling when billing is disabled
        - Default configuration values
        - Return value correctness and structure
        """
        # Arrange: Setup no tenant ID scenario
        with patch("services.feature_service.dify_config") as mock_config:
            mock_config.BILLING_ENABLED = True
            mock_config.ENTERPRISE_ENABLED = False
            mock_config.CAN_REPLACE_LOGO = True
            mock_config.MODEL_LB_ENABLED = False
            mock_config.DATASET_OPERATOR_ENABLED = True
            mock_config.EDUCATION_ENABLED = False

            # Act: Execute the method under test
            result = FeatureService.get_features("")

            # Assert: Verify the expected outcomes
            assert result is not None
            assert isinstance(result, FeatureModel)

            # Verify billing is disabled due to no tenant ID
            assert result.billing.enabled is False

            # Verify environment-based features
            assert result.can_replace_logo is True
            assert result.model_load_balancing_enabled is False
            assert result.dataset_operator_enabled is True
            assert result.education.enabled is False

            # Verify default limitations
            assert result.members.size == 0
            assert result.members.limit == 1
            assert result.apps.size == 0
            assert result.apps.limit == 10
            assert result.vector_space.size == 0
            assert result.vector_space.limit == 5

            # Verify no billing service calls
            mock_external_service_dependencies["billing_service"].get_info.assert_not_called()

    def test_get_features_partial_billing_info(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test feature retrieval with partial billing information.

        This test verifies:
        - Proper handling of partial billing data
        - Correct fallback to default values
        - Proper billing service integration
        - Return value correctness and structure
        """
        # Arrange: Setup partial billing info mock with proper config
        tenant_id = self._create_test_tenant_id()

        with patch("services.feature_service.dify_config") as mock_config:
            mock_config.BILLING_ENABLED = True
            mock_config.ENTERPRISE_ENABLED = False
            mock_config.CAN_REPLACE_LOGO = True
            mock_config.MODEL_LB_ENABLED = False
            mock_config.DATASET_OPERATOR_ENABLED = True
            mock_config.EDUCATION_ENABLED = False

            mock_external_service_dependencies["billing_service"].get_info.return_value = {
                "enabled": True,
                "subscription": {"plan": "basic", "interval": "yearly"},
                # Missing members, apps, vector_space, etc.
            }

            # Act: Execute the method under test
            result = FeatureService.get_features(tenant_id)

        # Assert: Verify the expected outcomes
        assert result is not None
        assert isinstance(result, FeatureModel)

        # Verify billing features
        assert result.billing.enabled is True
        assert result.billing.subscription.plan == "basic"
        assert result.billing.subscription.interval == "yearly"

        # Verify default values for missing billing info
        assert result.members.size == 0
        assert result.members.limit == 1
        assert result.apps.size == 0
        assert result.apps.limit == 10
        assert result.vector_space.size == 0
        assert result.vector_space.limit == 5
        assert result.documents_upload_quota.size == 0
        assert result.documents_upload_quota.limit == 50
        assert result.annotation_quota_limit.size == 0
        assert result.annotation_quota_limit.limit == 10
        assert result.knowledge_rate_limit == 10
        assert result.docs_processing == "standard"

        # Verify basic plan restrictions (non-sandbox plans have webapp copyright enabled)
        assert result.webapp_copyright_enabled is True
        assert result.is_allow_transfer_workspace is True

        # Verify mock interactions
        mock_external_service_dependencies["billing_service"].get_info.assert_called_once_with(tenant_id)

    def test_get_features_edge_case_vector_space(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test feature retrieval with edge case vector space configuration.

        This test verifies:
        - Proper handling of vector space quota limits
        - Correct integration with billing service
        - Proper fallback to default values
        - Return value correctness and structure
        """
        # Arrange: Setup edge case vector space mock with proper config
        tenant_id = self._create_test_tenant_id()

        with patch("services.feature_service.dify_config") as mock_config:
            mock_config.BILLING_ENABLED = True
            mock_config.ENTERPRISE_ENABLED = False
            mock_config.CAN_REPLACE_LOGO = True
            mock_config.MODEL_LB_ENABLED = False
            mock_config.DATASET_OPERATOR_ENABLED = True
            mock_config.EDUCATION_ENABLED = False

            mock_external_service_dependencies["billing_service"].get_info.return_value = {
                "enabled": True,
                "subscription": {"plan": "pro", "interval": "monthly"},
                "vector_space": {"size": 0, "limit": 0},
                "apps": {"size": 5, "limit": 10},
            }

            # Act: Execute the method under test
            result = FeatureService.get_features(tenant_id)

        # Assert: Verify the expected outcomes
        assert result is not None
        assert isinstance(result, FeatureModel)

        # Verify vector space configuration
        assert result.vector_space.size == 0
        assert result.vector_space.limit == 0

        # Verify apps configuration
        assert result.apps.size == 5
        assert result.apps.limit == 10

        # Verify pro plan features
        assert result.webapp_copyright_enabled is True
        assert result.is_allow_transfer_workspace is True

        # Verify default values for missing billing info
        assert result.members.size == 0
        assert result.members.limit == 1
        assert result.documents_upload_quota.size == 0
        assert result.documents_upload_quota.limit == 50
        assert result.annotation_quota_limit.size == 0
        assert result.annotation_quota_limit.limit == 10
        assert result.knowledge_rate_limit == 10
        assert result.docs_processing == "standard"

        # Verify mock interactions
        mock_external_service_dependencies["billing_service"].get_info.assert_called_once_with(tenant_id)

    def test_get_system_features_edge_case_webapp_auth(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test system features retrieval with edge case webapp auth configuration.

        This test verifies:
        - Proper handling of webapp auth configuration
        - Correct enterprise service integration
        - Proper fallback to default values
        - Return value correctness and structure
        """
        # Arrange: Setup edge case webapp auth mock with proper config
        with patch("services.feature_service.dify_config") as mock_config:
            mock_config.ENTERPRISE_ENABLED = True
            mock_config.MARKETPLACE_ENABLED = False
            mock_config.ENABLE_EMAIL_CODE_LOGIN = False
            mock_config.ENABLE_EMAIL_PASSWORD_LOGIN = True
            mock_config.ENABLE_SOCIAL_OAUTH_LOGIN = False
            mock_config.ALLOW_REGISTER = False
            mock_config.ALLOW_CREATE_WORKSPACE = False
            mock_config.MAIL_TYPE = "smtp"
            mock_config.PLUGIN_MAX_PACKAGE_SIZE = 100

            mock_external_service_dependencies["enterprise_service"].get_info.return_value = {
                "WebAppAuth": {"allowSso": False, "allowEmailCodeLogin": True, "allowEmailPasswordLogin": False}
            }

            # Act: Execute the method under test
            result = FeatureService.get_system_features()

        # Assert: Verify the expected outcomes
        assert result is not None
        assert isinstance(result, SystemFeatureModel)

        # Verify webapp auth configuration
        assert result.webapp_auth.allow_sso is False
        assert result.webapp_auth.allow_email_code_login is True
        assert result.webapp_auth.allow_email_password_login is False
        assert result.webapp_auth.sso_config.protocol == ""

        # Verify enterprise features
        assert result.branding.enabled is True
        assert result.webapp_auth.enabled is True
        assert result.enable_change_email is False

        # Verify default values for missing enterprise info
        assert result.sso_enforced_for_signin is False
        assert result.sso_enforced_for_signin_protocol == ""
        assert result.enable_email_code_login is False
        assert result.enable_email_password_login is True
        assert result.is_allow_register is False
        assert result.is_allow_create_workspace is False

        # Verify mock interactions
        mock_external_service_dependencies["enterprise_service"].get_info.assert_called_once()

    def test_get_features_edge_case_members_quota(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test feature retrieval with edge case members quota configuration.

        This test verifies:
        - Proper handling of members quota limits
        - Correct integration with billing service
        - Proper fallback to default values
        - Return value correctness and structure
        """
        # Arrange: Setup edge case members quota mock with proper config
        tenant_id = self._create_test_tenant_id()

        with patch("services.feature_service.dify_config") as mock_config:
            mock_config.BILLING_ENABLED = True
            mock_config.ENTERPRISE_ENABLED = False
            mock_config.CAN_REPLACE_LOGO = True
            mock_config.MODEL_LB_ENABLED = False
            mock_config.DATASET_OPERATOR_ENABLED = True
            mock_config.EDUCATION_ENABLED = False

            mock_external_service_dependencies["billing_service"].get_info.return_value = {
                "enabled": True,
                "subscription": {"plan": "basic", "interval": "yearly"},
                "members": {"size": 10, "limit": 10},
                "vector_space": {"size": 3, "limit": 5},
            }

            # Act: Execute the method under test
            result = FeatureService.get_features(tenant_id)

        # Assert: Verify the expected outcomes
        assert result is not None
        assert isinstance(result, FeatureModel)

        # Verify members configuration
        assert result.members.size == 10
        assert result.members.limit == 10

        # Verify vector space configuration
        assert result.vector_space.size == 3
        assert result.vector_space.limit == 5

        # Verify basic plan features (non-sandbox plans have webapp copyright enabled)
        assert result.webapp_copyright_enabled is True
        assert result.is_allow_transfer_workspace is True

        # Verify default values for missing billing info
        assert result.apps.size == 0
        assert result.apps.limit == 10
        assert result.documents_upload_quota.size == 0
        assert result.documents_upload_quota.limit == 50
        assert result.annotation_quota_limit.size == 0
        assert result.annotation_quota_limit.limit == 10
        assert result.knowledge_rate_limit == 10
        assert result.docs_processing == "standard"

        # Verify mock interactions
        mock_external_service_dependencies["billing_service"].get_info.assert_called_once_with(tenant_id)

    def test_plugin_installation_permission_scopes(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test system features retrieval with different plugin installation permission scopes.

        This test verifies:
        - Proper handling of different plugin installation scopes
        - Correct enterprise service integration
        - Proper permission configuration
        - Return value correctness and structure
        """

        # Test case 1: Official only scope
        with patch("services.feature_service.dify_config") as mock_config:
            mock_config.ENTERPRISE_ENABLED = True
            mock_config.MARKETPLACE_ENABLED = False
            mock_config.ENABLE_EMAIL_CODE_LOGIN = False
            mock_config.ENABLE_EMAIL_PASSWORD_LOGIN = True
            mock_config.ENABLE_SOCIAL_OAUTH_LOGIN = False
            mock_config.ALLOW_REGISTER = False
            mock_config.ALLOW_CREATE_WORKSPACE = False
            mock_config.MAIL_TYPE = "smtp"
            mock_config.PLUGIN_MAX_PACKAGE_SIZE = 100

            mock_external_service_dependencies["enterprise_service"].get_info.return_value = {
                "PluginInstallationPermission": {
                    "pluginInstallationScope": "official_only",
                    "restrictToMarketplaceOnly": True,
                }
            }

            result = FeatureService.get_system_features()
            assert result.plugin_installation_permission.plugin_installation_scope == "official_only"
            assert result.plugin_installation_permission.restrict_to_marketplace_only is True

        # Test case 2: All plugins scope
        with patch("services.feature_service.dify_config") as mock_config:
            mock_config.ENTERPRISE_ENABLED = True
            mock_config.MARKETPLACE_ENABLED = False
            mock_config.ENABLE_EMAIL_CODE_LOGIN = False
            mock_config.ENABLE_EMAIL_PASSWORD_LOGIN = True
            mock_config.ENABLE_SOCIAL_OAUTH_LOGIN = False
            mock_config.ALLOW_REGISTER = False
            mock_config.ALLOW_CREATE_WORKSPACE = False
            mock_config.MAIL_TYPE = "smtp"
            mock_config.PLUGIN_MAX_PACKAGE_SIZE = 100

            mock_external_service_dependencies["enterprise_service"].get_info.return_value = {
                "PluginInstallationPermission": {"pluginInstallationScope": "all", "restrictToMarketplaceOnly": False}
            }

            result = FeatureService.get_system_features()
            assert result.plugin_installation_permission.plugin_installation_scope == "all"
            assert result.plugin_installation_permission.restrict_to_marketplace_only is False

        # Test case 3: Specific partners scope
        with patch("services.feature_service.dify_config") as mock_config:
            mock_config.ENTERPRISE_ENABLED = True
            mock_config.MARKETPLACE_ENABLED = False
            mock_config.ENABLE_EMAIL_CODE_LOGIN = False
            mock_config.ENABLE_EMAIL_PASSWORD_LOGIN = True
            mock_config.ENABLE_SOCIAL_OAUTH_LOGIN = False
            mock_config.ALLOW_REGISTER = False
            mock_config.ALLOW_CREATE_WORKSPACE = False
            mock_config.MAIL_TYPE = "smtp"
            mock_config.PLUGIN_MAX_PACKAGE_SIZE = 100

            mock_external_service_dependencies["enterprise_service"].get_info.return_value = {
                "PluginInstallationPermission": {
                    "pluginInstallationScope": "official_and_specific_partners",
                    "restrictToMarketplaceOnly": False,
                }
            }

            result = FeatureService.get_system_features()
            assert result.plugin_installation_permission.plugin_installation_scope == "official_and_specific_partners"
            assert result.plugin_installation_permission.restrict_to_marketplace_only is False

        # Test case 4: None scope
        with patch("services.feature_service.dify_config") as mock_config:
            mock_config.ENTERPRISE_ENABLED = True
            mock_config.MARKETPLACE_ENABLED = False
            mock_config.ENABLE_EMAIL_CODE_LOGIN = False
            mock_config.ENABLE_EMAIL_PASSWORD_LOGIN = True
            mock_config.ENABLE_SOCIAL_OAUTH_LOGIN = False
            mock_config.ALLOW_REGISTER = False
            mock_config.ALLOW_CREATE_WORKSPACE = False
            mock_config.MAIL_TYPE = "smtp"
            mock_config.PLUGIN_MAX_PACKAGE_SIZE = 100

            mock_external_service_dependencies["enterprise_service"].get_info.return_value = {
                "PluginInstallationPermission": {"pluginInstallationScope": "none", "restrictToMarketplaceOnly": True}
            }

            result = FeatureService.get_system_features()
            assert result.plugin_installation_permission.plugin_installation_scope == "none"
            assert result.plugin_installation_permission.restrict_to_marketplace_only is True

    def test_get_features_workspace_members_missing(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test feature retrieval when workspace members info is missing from enterprise.

        This test verifies:
        - Proper handling of missing workspace members data
        - Correct enterprise service integration
        - Proper fallback to default values
        - Return value correctness and structure
        """
        # Arrange: Setup missing workspace members mock
        tenant_id = self._create_test_tenant_id()
        mock_external_service_dependencies["enterprise_service"].get_workspace_info.return_value = {
            # Missing WorkspaceMembers key
        }

        with patch("services.feature_service.dify_config") as mock_config:
            mock_config.BILLING_ENABLED = False
            mock_config.ENTERPRISE_ENABLED = True

            # Act: Execute the method under test
            result = FeatureService.get_features(tenant_id)

            # Assert: Verify the expected outcomes
            assert result is not None
            assert isinstance(result, FeatureModel)

            # Verify workspace members use default values
            assert result.workspace_members.enabled is False
            assert result.workspace_members.size == 0
            assert result.workspace_members.limit == 0

            # Verify enterprise features
            assert result.webapp_copyright_enabled is True

            # Verify mock interactions
            mock_external_service_dependencies["enterprise_service"].get_workspace_info.assert_called_once_with(
                tenant_id
            )

    def test_get_system_features_license_inactive(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test system features retrieval with inactive license.

        This test verifies:
        - Proper handling of inactive license status
        - Correct enterprise service integration
        - Proper license status handling
        - Return value correctness and structure
        """
        # Arrange: Setup inactive license mock with proper config
        with patch("services.feature_service.dify_config") as mock_config:
            mock_config.ENTERPRISE_ENABLED = True
            mock_config.MARKETPLACE_ENABLED = False
            mock_config.ENABLE_EMAIL_CODE_LOGIN = False
            mock_config.ENABLE_EMAIL_PASSWORD_LOGIN = True
            mock_config.ENABLE_SOCIAL_OAUTH_LOGIN = False
            mock_config.ALLOW_REGISTER = False
            mock_config.ALLOW_CREATE_WORKSPACE = False
            mock_config.MAIL_TYPE = "smtp"
            mock_config.PLUGIN_MAX_PACKAGE_SIZE = 100

            mock_external_service_dependencies["enterprise_service"].get_info.return_value = {
                "License": {
                    "status": "inactive",
                    "expiredAt": "",
                    "workspaces": {"enabled": False, "limit": 0, "used": 0},
                }
            }

            # Act: Execute the method under test
            result = FeatureService.get_system_features()

        # Assert: Verify the expected outcomes
        assert result is not None
        assert isinstance(result, SystemFeatureModel)

        # Verify license status
        assert result.license.status == "inactive"
        assert result.license.expired_at == ""
        assert result.license.workspaces.enabled is False
        assert result.license.workspaces.size == 0
        assert result.license.workspaces.limit == 0

        # Verify enterprise features
        assert result.branding.enabled is True
        assert result.webapp_auth.enabled is True
        assert result.enable_change_email is False

        # Verify mock interactions
        mock_external_service_dependencies["enterprise_service"].get_info.assert_called_once()

    def test_get_system_features_partial_enterprise_info(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test system features retrieval with partial enterprise information.

        This test verifies:
        - Proper handling of partial enterprise data
        - Correct fallback to default values
        - Proper enterprise service integration
        - Return value correctness and structure
        """
        # Arrange: Setup partial enterprise info mock with proper config
        with patch("services.feature_service.dify_config") as mock_config:
            mock_config.ENTERPRISE_ENABLED = True
            mock_config.MARKETPLACE_ENABLED = False
            mock_config.ENABLE_EMAIL_CODE_LOGIN = False
            mock_config.ENABLE_EMAIL_PASSWORD_LOGIN = True
            mock_config.ENABLE_SOCIAL_OAUTH_LOGIN = False
            mock_config.ALLOW_REGISTER = False
            mock_config.ALLOW_CREATE_WORKSPACE = False
            mock_config.MAIL_TYPE = "smtp"
            mock_config.PLUGIN_MAX_PACKAGE_SIZE = 100

            mock_external_service_dependencies["enterprise_service"].get_info.return_value = {
                "SSOEnforcedForSignin": True,
                "Branding": {"applicationTitle": "Partial Enterprise"},
                # Missing WebAppAuth, License, PluginInstallationPermission, etc.
            }

            # Act: Execute the method under test
            result = FeatureService.get_system_features()

        # Assert: Verify the expected outcomes
        assert result is not None
        assert isinstance(result, SystemFeatureModel)

        # Verify enterprise features
        assert result.branding.enabled is True
        assert result.webapp_auth.enabled is True
        assert result.enable_change_email is False

        # Verify SSO configuration
        assert result.sso_enforced_for_signin is True
        assert result.sso_enforced_for_signin_protocol == ""

        # Verify branding configuration (partial)
        assert result.branding.application_title == "Partial Enterprise"
        assert result.branding.login_page_logo == ""
        assert result.branding.workspace_logo == ""
        assert result.branding.favicon == ""

        # Verify default values for missing enterprise info
        assert result.webapp_auth.allow_sso is False
        assert result.webapp_auth.allow_email_code_login is False
        assert result.webapp_auth.allow_email_password_login is False
        assert result.webapp_auth.sso_config.protocol == ""

        # Verify default license status
        assert result.license.status == "none"
        assert result.license.expired_at == ""
        assert result.license.workspaces.enabled is False

        # Verify default plugin installation permission
        assert result.plugin_installation_permission.plugin_installation_scope == "all"
        assert result.plugin_installation_permission.restrict_to_marketplace_only is False

        # Verify mock interactions
        mock_external_service_dependencies["enterprise_service"].get_info.assert_called_once()

    def test_get_features_edge_case_limits(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test feature retrieval with edge case limit values.

        This test verifies:
        - Proper handling of zero and negative limits
        - Correct handling of very large limits
        - Proper fallback to default values
        - Return value correctness and structure
        """
        # Arrange: Setup edge case limits mock with proper config
        tenant_id = self._create_test_tenant_id()

        with patch("services.feature_service.dify_config") as mock_config:
            mock_config.BILLING_ENABLED = True
            mock_config.ENTERPRISE_ENABLED = False
            mock_config.CAN_REPLACE_LOGO = True
            mock_config.MODEL_LB_ENABLED = False
            mock_config.DATASET_OPERATOR_ENABLED = True
            mock_config.EDUCATION_ENABLED = False

            mock_external_service_dependencies["billing_service"].get_info.return_value = {
                "enabled": True,
                "subscription": {"plan": "enterprise", "interval": "yearly"},
                "members": {"size": 0, "limit": 0},
                "apps": {"size": 0, "limit": -1},
                "vector_space": {"size": 0, "limit": 999999},
                "documents_upload_quota": {"size": 0, "limit": 0},
                "annotation_quota_limit": {"size": 0, "limit": 1},
            }

            # Act: Execute the method under test
            result = FeatureService.get_features(tenant_id)

        # Assert: Verify the expected outcomes
        assert result is not None
        assert isinstance(result, FeatureModel)

        # Verify edge case limits
        assert result.members.size == 0
        assert result.members.limit == 0
        assert result.apps.size == 0
        assert result.apps.limit == -1
        assert result.vector_space.size == 0
        assert result.vector_space.limit == 999999
        assert result.documents_upload_quota.size == 0
        assert result.documents_upload_quota.limit == 0
        assert result.annotation_quota_limit.size == 0
        assert result.annotation_quota_limit.limit == 1

        # Verify enterprise plan features
        assert result.webapp_copyright_enabled is True
        assert result.is_allow_transfer_workspace is True

        # Verify mock interactions
        mock_external_service_dependencies["billing_service"].get_info.assert_called_once_with(tenant_id)

    def test_get_system_features_edge_case_protocols(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test system features retrieval with edge case protocol values.

        This test verifies:
        - Proper handling of empty protocol strings
        - Correct handling of special protocol values
        - Proper fallback to default values
        - Return value correctness and structure
        """
        # Arrange: Setup edge case protocols mock with proper config
        with patch("services.feature_service.dify_config") as mock_config:
            mock_config.ENTERPRISE_ENABLED = True
            mock_config.MARKETPLACE_ENABLED = False
            mock_config.ENABLE_EMAIL_CODE_LOGIN = False
            mock_config.ENABLE_EMAIL_PASSWORD_LOGIN = True
            mock_config.ENABLE_SOCIAL_OAUTH_LOGIN = False
            mock_config.ALLOW_REGISTER = False
            mock_config.ALLOW_CREATE_WORKSPACE = False
            mock_config.MAIL_TYPE = "smtp"
            mock_config.PLUGIN_MAX_PACKAGE_SIZE = 100

            mock_external_service_dependencies["enterprise_service"].get_info.return_value = {
                "SSOEnforcedForSigninProtocol": "",
                "SSOEnforcedForWebProtocol": "   ",
                "WebAppAuth": {"allowSso": True, "allowEmailCodeLogin": False, "allowEmailPasswordLogin": True},
            }

            # Act: Execute the method under test
            result = FeatureService.get_system_features()

        # Assert: Verify the expected outcomes
        assert result is not None
        assert isinstance(result, SystemFeatureModel)

        # Verify edge case protocols
        assert result.sso_enforced_for_signin_protocol == ""
        assert result.webapp_auth.sso_config.protocol == "   "

        # Verify webapp auth configuration
        assert result.webapp_auth.allow_sso is True
        assert result.webapp_auth.allow_email_code_login is False
        assert result.webapp_auth.allow_email_password_login is True

        # Verify enterprise features
        assert result.branding.enabled is True
        assert result.webapp_auth.enabled is True
        assert result.enable_change_email is False

        # Verify mock interactions
        mock_external_service_dependencies["enterprise_service"].get_info.assert_called_once()

    def test_get_features_edge_case_education(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test feature retrieval with edge case education configuration.

        This test verifies:
        - Proper handling of education feature flags
        - Correct integration with billing service
        - Proper fallback to default values
        - Return value correctness and structure
        """
        # Arrange: Setup edge case education mock
        tenant_id = self._create_test_tenant_id()
        mock_external_service_dependencies["billing_service"].get_info.return_value = {
            "enabled": True,
            "subscription": {"plan": "education", "interval": "semester", "education": True},
            "members": {"size": 100, "limit": 200},
            "apps": {"size": 50, "limit": 100},
            "vector_space": {"size": 20, "limit": 50},
            "documents_upload_quota": {"size": 500, "limit": 1000},
            "annotation_quota_limit": {"size": 200, "limit": 500},
        }

        with patch("services.feature_service.dify_config") as mock_config:
            mock_config.EDUCATION_ENABLED = True

            # Act: Execute the method under test
            result = FeatureService.get_features(tenant_id)

            # Assert: Verify the expected outcomes
            assert result is not None
            assert isinstance(result, FeatureModel)

            # Verify education features
            assert result.education.enabled is True
            assert result.education.activated is True

            # Verify education plan limits
            assert result.members.size == 100
            assert result.members.limit == 200
            assert result.apps.size == 50
            assert result.apps.limit == 100
            assert result.vector_space.size == 20
            assert result.vector_space.limit == 50
            assert result.documents_upload_quota.size == 500
            assert result.documents_upload_quota.limit == 1000
            assert result.annotation_quota_limit.size == 200
            assert result.annotation_quota_limit.limit == 500

            # Verify education plan features
            assert result.webapp_copyright_enabled is True
            assert result.is_allow_transfer_workspace is True

            # Verify mock interactions
            mock_external_service_dependencies["billing_service"].get_info.assert_called_once_with(tenant_id)

    def test_license_limitation_model_is_available(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test LicenseLimitationModel.is_available method with various scenarios.

        This test verifies:
        - Proper quota availability calculation
        - Correct handling of unlimited limits
        - Proper handling of disabled limits
        - Return value correctness for different scenarios
        """
        from services.feature_service import LicenseLimitationModel

        # Test case 1: Limit disabled
        disabled_limit = LicenseLimitationModel(enabled=False, size=5, limit=10)
        assert disabled_limit.is_available(3) is True
        assert disabled_limit.is_available(10) is True

        # Test case 2: Unlimited limit
        unlimited_limit = LicenseLimitationModel(enabled=True, size=5, limit=0)
        assert unlimited_limit.is_available(3) is True
        assert unlimited_limit.is_available(100) is True

        # Test case 3: Available quota
        available_limit = LicenseLimitationModel(enabled=True, size=5, limit=10)
        assert available_limit.is_available(3) is True
        assert available_limit.is_available(5) is True
        assert available_limit.is_available(1) is True

        # Test case 4: Insufficient quota
        insufficient_limit = LicenseLimitationModel(enabled=True, size=8, limit=10)
        assert insufficient_limit.is_available(3) is False
        assert insufficient_limit.is_available(2) is True
        assert insufficient_limit.is_available(1) is True

        # Test case 5: Exact quota usage
        exact_limit = LicenseLimitationModel(enabled=True, size=7, limit=10)
        assert exact_limit.is_available(3) is True
        assert exact_limit.is_available(3) is True

    def test_get_features_workspace_members_disabled(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test feature retrieval when workspace members are disabled in enterprise.

        This test verifies:
        - Proper handling of disabled workspace members
        - Correct enterprise service integration
        - Proper fallback to default values
        - Return value correctness and structure
        """
        # Arrange: Setup workspace members disabled mock
        tenant_id = self._create_test_tenant_id()
        mock_external_service_dependencies["enterprise_service"].get_workspace_info.return_value = {
            "WorkspaceMembers": {"used": 0, "limit": 0, "enabled": False}
        }

        with patch("services.feature_service.dify_config") as mock_config:
            mock_config.BILLING_ENABLED = False
            mock_config.ENTERPRISE_ENABLED = True

            # Act: Execute the method under test
            result = FeatureService.get_features(tenant_id)

            # Assert: Verify the expected outcomes
        assert result is not None
        assert isinstance(result, FeatureModel)

        # Verify workspace members are disabled
        assert result.workspace_members.enabled is False
        assert result.workspace_members.size == 0
        assert result.workspace_members.limit == 0

        # Verify enterprise features
        assert result.webapp_copyright_enabled is True

        # Verify mock interactions
        mock_external_service_dependencies["enterprise_service"].get_workspace_info.assert_called_once_with(tenant_id)

    def test_get_system_features_license_expired(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test system features retrieval with expired license.

        This test verifies:
        - Proper handling of expired license status
        - Correct enterprise service integration
        - Proper license status handling
        - Return value correctness and structure
        """
        # Arrange: Setup expired license mock with proper config
        with patch("services.feature_service.dify_config") as mock_config:
            mock_config.ENTERPRISE_ENABLED = True
            mock_config.MARKETPLACE_ENABLED = False
            mock_config.ENABLE_EMAIL_CODE_LOGIN = False
            mock_config.ENABLE_EMAIL_PASSWORD_LOGIN = True
            mock_config.ENABLE_SOCIAL_OAUTH_LOGIN = False
            mock_config.ALLOW_REGISTER = False
            mock_config.ALLOW_CREATE_WORKSPACE = False
            mock_config.MAIL_TYPE = "smtp"
            mock_config.PLUGIN_MAX_PACKAGE_SIZE = 100

            mock_external_service_dependencies["enterprise_service"].get_info.return_value = {
                "License": {
                    "status": "expired",
                    "expiredAt": "2023-12-31",
                    "workspaces": {"enabled": False, "limit": 0, "used": 0},
                }
            }

            # Act: Execute the method under test
            result = FeatureService.get_system_features()

        # Assert: Verify the expected outcomes
        assert result is not None
        assert isinstance(result, SystemFeatureModel)

        # Verify license status
        assert result.license.status == "expired"
        assert result.license.expired_at == "2023-12-31"
        assert result.license.workspaces.enabled is False
        assert result.license.workspaces.size == 0
        assert result.license.workspaces.limit == 0

        # Verify enterprise features
        assert result.branding.enabled is True
        assert result.webapp_auth.enabled is True
        assert result.enable_change_email is False

        # Verify mock interactions
        mock_external_service_dependencies["enterprise_service"].get_info.assert_called_once()

    def test_get_features_edge_case_docs_processing(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test feature retrieval with edge case document processing configuration.

        This test verifies:
        - Proper handling of different document processing modes
        - Correct integration with billing service
        - Proper fallback to default values
        - Return value correctness and structure
        """
        # Arrange: Setup edge case docs processing mock with proper config
        tenant_id = self._create_test_tenant_id()

        with patch("services.feature_service.dify_config") as mock_config:
            mock_config.BILLING_ENABLED = True
            mock_config.ENTERPRISE_ENABLED = False
            mock_config.CAN_REPLACE_LOGO = True
            mock_config.MODEL_LB_ENABLED = True
            mock_config.DATASET_OPERATOR_ENABLED = True
            mock_config.EDUCATION_ENABLED = False

            mock_external_service_dependencies["billing_service"].get_info.return_value = {
                "enabled": True,
                "subscription": {"plan": "premium", "interval": "monthly"},
                "docs_processing": "advanced",
                "can_replace_logo": True,
                "model_load_balancing_enabled": True,
            }

            # Act: Execute the method under test
            result = FeatureService.get_features(tenant_id)

        # Assert: Verify the expected outcomes
        assert result is not None
        assert isinstance(result, FeatureModel)

        # Verify docs processing configuration
        assert result.docs_processing == "advanced"
        assert result.can_replace_logo is True
        assert result.model_load_balancing_enabled is True

        # Verify premium plan features
        assert result.webapp_copyright_enabled is True
        assert result.is_allow_transfer_workspace is True

        # Verify default limitations (no specific billing info)
        assert result.members.size == 0
        assert result.members.limit == 1
        assert result.apps.size == 0
        assert result.apps.limit == 10
        assert result.vector_space.size == 0
        assert result.vector_space.limit == 5

        # Verify mock interactions
        mock_external_service_dependencies["billing_service"].get_info.assert_called_once_with(tenant_id)

    def test_get_system_features_edge_case_branding(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test system features retrieval with edge case branding configuration.

        This test verifies:
        - Proper handling of partial branding information
        - Correct enterprise service integration
        - Proper fallback to default values
        - Return value correctness and structure
        """
        # Arrange: Setup edge case branding mock with proper config
        with patch("services.feature_service.dify_config") as mock_config:
            mock_config.ENTERPRISE_ENABLED = True
            mock_config.MARKETPLACE_ENABLED = False
            mock_config.ENABLE_EMAIL_CODE_LOGIN = False
            mock_config.ENABLE_EMAIL_PASSWORD_LOGIN = True
            mock_config.ENABLE_SOCIAL_OAUTH_LOGIN = False
            mock_config.ALLOW_REGISTER = False
            mock_config.ALLOW_CREATE_WORKSPACE = False
            mock_config.MAIL_TYPE = "smtp"
            mock_config.PLUGIN_MAX_PACKAGE_SIZE = 100

            mock_external_service_dependencies["enterprise_service"].get_info.return_value = {
                "Branding": {
                    "applicationTitle": "Edge Case App",
                    "loginPageLogo": None,
                    "workspaceLogo": "",
                    "favicon": "https://example.com/favicon.ico",
                }
            }

            # Act: Execute the method under test
            result = FeatureService.get_system_features()

        # Assert: Verify the expected outcomes
        assert result is not None
        assert isinstance(result, SystemFeatureModel)

        # Verify branding configuration (edge cases)
        assert result.branding.application_title == "Edge Case App"
        assert result.branding.login_page_logo is None  # None value from mock
        assert result.branding.workspace_logo == ""
        assert result.branding.favicon == "https://example.com/favicon.ico"

        # Verify enterprise features
        assert result.branding.enabled is True
        assert result.webapp_auth.enabled is True
        assert result.enable_change_email is False

        # Verify default values for missing enterprise info
        assert result.sso_enforced_for_signin is False
        assert result.sso_enforced_for_signin_protocol == ""
        assert result.enable_email_code_login is False
        assert result.enable_email_password_login is True
        assert result.is_allow_register is False
        assert result.is_allow_create_workspace is False

        # Verify mock interactions
        mock_external_service_dependencies["enterprise_service"].get_info.assert_called_once()

    def test_get_features_edge_case_annotation_quota(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test feature retrieval with edge case annotation quota configuration.

        This test verifies:
        - Proper handling of annotation quota limits
        - Correct integration with billing service
        - Proper fallback to default values
        - Return value correctness and structure
        """
        # Arrange: Setup edge case annotation quota mock with proper config
        tenant_id = self._create_test_tenant_id()

        with patch("services.feature_service.dify_config") as mock_config:
            mock_config.BILLING_ENABLED = True
            mock_config.ENTERPRISE_ENABLED = False
            mock_config.CAN_REPLACE_LOGO = True
            mock_config.MODEL_LB_ENABLED = False
            mock_config.DATASET_OPERATOR_ENABLED = True
            mock_config.EDUCATION_ENABLED = False

            mock_external_service_dependencies["billing_service"].get_info.return_value = {
                "enabled": True,
                "subscription": {"plan": "enterprise", "interval": "yearly"},
                "annotation_quota_limit": {"size": 999, "limit": 1000},
                "knowledge_rate_limit": {"limit": 500},
            }

            # Act: Execute the method under test
            result = FeatureService.get_features(tenant_id)

        # Assert: Verify the expected outcomes
        assert result is not None
        assert isinstance(result, FeatureModel)

        # Verify annotation quota configuration
        assert result.annotation_quota_limit.size == 999
        assert result.annotation_quota_limit.limit == 1000

        # Verify knowledge rate limit
        assert result.knowledge_rate_limit == 500

        # Verify enterprise plan features
        assert result.webapp_copyright_enabled is True
        assert result.is_allow_transfer_workspace is True

        # Verify default values for missing billing info
        assert result.members.size == 0
        assert result.members.limit == 1
        assert result.apps.size == 0
        assert result.apps.limit == 10
        assert result.vector_space.size == 0
        assert result.vector_space.limit == 5
        assert result.documents_upload_quota.size == 0
        assert result.documents_upload_quota.limit == 50
        assert result.docs_processing == "standard"

        # Verify mock interactions
        mock_external_service_dependencies["billing_service"].get_info.assert_called_once_with(tenant_id)

    def test_get_features_edge_case_documents_upload(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test feature retrieval with edge case documents upload settings.

        This test verifies:
        - Proper handling of edge case documents upload configuration
        - Correct integration with billing service
        - Proper fallback to default values
        - Return value correctness and structure
        """
        # Arrange: Setup edge case documents upload mock with proper config
        tenant_id = self._create_test_tenant_id()

        with patch("services.feature_service.dify_config") as mock_config:
            mock_config.BILLING_ENABLED = True
            mock_config.ENTERPRISE_ENABLED = False
            mock_config.CAN_REPLACE_LOGO = True
            mock_config.MODEL_LB_ENABLED = False
            mock_config.DATASET_OPERATOR_ENABLED = True
            mock_config.EDUCATION_ENABLED = False

            mock_external_service_dependencies["billing_service"].get_info.return_value = {
                "enabled": True,
                "subscription": {"plan": "pro", "interval": "monthly"},
                "documents_upload_quota": {
                    "size": 0,  # Edge case: zero current size
                    "limit": 0,  # Edge case: zero limit
                },
                "knowledge_rate_limit": {"limit": 100},
            }

            # Act: Execute the method under test
            result = FeatureService.get_features(tenant_id)

        # Assert: Verify the expected outcomes
        assert result is not None
        assert isinstance(result, FeatureModel)

        # Verify documents upload quota configuration (edge cases)
        assert result.documents_upload_quota.size == 0
        assert result.documents_upload_quota.limit == 0

        # Verify knowledge rate limit
        assert result.knowledge_rate_limit == 100

        # Verify pro plan features
        assert result.webapp_copyright_enabled is True
        assert result.is_allow_transfer_workspace is True

        # Verify default values for missing billing info
        assert result.members.size == 0
        assert result.members.limit == 1
        assert result.apps.size == 0
        assert result.apps.limit == 10
        assert result.vector_space.size == 0
        assert result.vector_space.limit == 5
        assert result.annotation_quota_limit.size == 0
        assert result.annotation_quota_limit.limit == 10  # Default value when not provided
        assert result.docs_processing == "standard"

        # Verify mock interactions
        mock_external_service_dependencies["billing_service"].get_info.assert_called_once_with(tenant_id)

    def test_get_system_features_edge_case_license_lost(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test system features with lost license status.

        This test verifies:
        - Proper handling of lost license status
        - Correct enterprise service integration
        - Proper fallback to default values
        - Return value correctness and structure
        """
        # Arrange: Setup lost license mock with proper config
        with patch("services.feature_service.dify_config") as mock_config:
            mock_config.ENTERPRISE_ENABLED = True
            mock_config.MARKETPLACE_ENABLED = False
            mock_config.ENABLE_EMAIL_CODE_LOGIN = False
            mock_config.ENABLE_EMAIL_PASSWORD_LOGIN = True
            mock_config.ENABLE_SOCIAL_OAUTH_LOGIN = False
            mock_config.ALLOW_REGISTER = False
            mock_config.ALLOW_CREATE_WORKSPACE = False
            mock_config.MAIL_TYPE = "smtp"
            mock_config.PLUGIN_MAX_PACKAGE_SIZE = 100

            mock_external_service_dependencies["enterprise_service"].get_info.return_value = {
                "license": {"status": "lost", "expired_at": None, "plan": None}
            }

            # Act: Execute the method under test
            result = FeatureService.get_system_features()

        # Assert: Verify the expected outcomes
        assert result is not None
        assert isinstance(result, SystemFeatureModel)

        # Verify enterprise features
        assert result.branding.enabled is True
        assert result.webapp_auth.enabled is True
        assert result.enable_change_email is False

        # Verify default values for missing enterprise info
        assert result.sso_enforced_for_signin is False
        assert result.sso_enforced_for_signin_protocol == ""
        assert result.enable_email_code_login is False
        assert result.enable_email_password_login is True
        assert result.is_allow_register is False
        assert result.is_allow_create_workspace is False

        # Verify mock interactions
        mock_external_service_dependencies["enterprise_service"].get_info.assert_called_once()

    def test_get_features_edge_case_education_disabled(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test feature retrieval with education feature disabled.

        This test verifies:
        - Proper handling of disabled education features
        - Correct integration with billing service
        - Proper fallback to default values
        - Return value correctness and structure
        """
        # Arrange: Setup education disabled mock with proper config
        tenant_id = self._create_test_tenant_id()

        with patch("services.feature_service.dify_config") as mock_config:
            mock_config.BILLING_ENABLED = True
            mock_config.ENTERPRISE_ENABLED = False
            mock_config.CAN_REPLACE_LOGO = True
            mock_config.MODEL_LB_ENABLED = False
            mock_config.DATASET_OPERATOR_ENABLED = True
            mock_config.EDUCATION_ENABLED = False

            mock_external_service_dependencies["billing_service"].get_info.return_value = {
                "enabled": True,
                "subscription": {
                    "plan": "pro",
                    "interval": "monthly",
                    "education": False,  # Education explicitly disabled
                },
                "knowledge_rate_limit": {"limit": 100},
            }

            # Act: Execute the method under test
            result = FeatureService.get_features(tenant_id)

        # Assert: Verify the expected outcomes
        assert result is not None
        assert isinstance(result, FeatureModel)

        # Verify education configuration
        assert result.education.activated is False

        # Verify knowledge rate limit
        assert result.knowledge_rate_limit == 100

        # Verify pro plan features
        assert result.webapp_copyright_enabled is True
        assert result.is_allow_transfer_workspace is True

        # Verify default values for missing billing info
        assert result.members.size == 0
        assert result.members.limit == 1
        assert result.apps.size == 0
        assert result.apps.limit == 10
        assert result.vector_space.size == 0
        assert result.vector_space.limit == 5
        assert result.documents_upload_quota.size == 0
        assert result.documents_upload_quota.limit == 50
        assert result.annotation_quota_limit.size == 0
        assert result.annotation_quota_limit.limit == 10  # Default value when not provided
        assert result.docs_processing == "standard"

        # Verify mock interactions
        mock_external_service_dependencies["billing_service"].get_info.assert_called_once_with(tenant_id)
