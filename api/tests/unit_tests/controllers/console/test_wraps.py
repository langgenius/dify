from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from flask_login import LoginManager, UserMixin

from controllers.console.error import NotInitValidateError, NotSetupError, UnauthorizedAndForceLogout
from controllers.console.workspace.error import AccountNotInitializedError
from controllers.console.wraps import (
    account_initialization_required,
    cloud_edition_billing_rate_limit_check,
    cloud_edition_billing_resource_check,
    enterprise_license_required,
    only_edition_cloud,
    only_edition_enterprise,
    only_edition_self_hosted,
    setup_required,
)
from models.account import AccountStatus
from services.feature_service import LicenseStatus


class MockUser(UserMixin):
    """Simple User class for testing."""

    def __init__(self, user_id: str):
        self.id = user_id
        self.current_tenant_id = "tenant123"

    def get_id(self) -> str:
        return self.id


def create_app_with_login():
    """Create a Flask app with LoginManager configured."""
    app = Flask(__name__)
    app.config["SECRET_KEY"] = "test-secret-key"

    login_manager = LoginManager()
    login_manager.init_app(app)

    @login_manager.user_loader
    def load_user(user_id: str):
        return MockUser(user_id)

    return app


class TestAccountInitialization:
    """Test account initialization decorator"""

    def test_should_allow_initialized_account(self):
        """Test that initialized accounts can access protected views"""
        # Arrange
        mock_user = MagicMock()
        mock_user.status = AccountStatus.ACTIVE

        @account_initialization_required
        def protected_view():
            return "success"

        # Act
        with patch("controllers.console.wraps.current_account_with_tenant", return_value=(mock_user, "tenant123")):
            result = protected_view()

        # Assert
        assert result == "success"

    def test_should_reject_uninitialized_account(self):
        """Test that uninitialized accounts raise AccountNotInitializedError"""
        # Arrange
        mock_user = MagicMock()
        mock_user.status = AccountStatus.UNINITIALIZED

        @account_initialization_required
        def protected_view():
            return "success"

        # Act & Assert
        with patch("controllers.console.wraps.current_account_with_tenant", return_value=(mock_user, "tenant123")):
            with pytest.raises(AccountNotInitializedError):
                protected_view()


class TestEditionChecks:
    """Test edition-specific decorators"""

    def test_only_edition_cloud_allows_cloud_edition(self):
        """Test cloud edition decorator allows CLOUD edition"""

        # Arrange
        @only_edition_cloud
        def cloud_view():
            return "cloud_success"

        # Act
        with patch("controllers.console.wraps.dify_config.EDITION", "CLOUD"):
            result = cloud_view()

        # Assert
        assert result == "cloud_success"

    def test_only_edition_cloud_rejects_other_editions(self):
        """Test cloud edition decorator rejects non-CLOUD editions"""
        # Arrange
        app = Flask(__name__)

        @only_edition_cloud
        def cloud_view():
            return "cloud_success"

        # Act & Assert
        with app.test_request_context():
            with patch("controllers.console.wraps.dify_config.EDITION", "SELF_HOSTED"):
                with pytest.raises(Exception) as exc_info:
                    cloud_view()
                assert exc_info.value.code == 404

    def test_only_edition_enterprise_allows_when_enabled(self):
        """Test enterprise edition decorator allows when ENTERPRISE_ENABLED is True"""

        # Arrange
        @only_edition_enterprise
        def enterprise_view():
            return "enterprise_success"

        # Act
        with patch("controllers.console.wraps.dify_config.ENTERPRISE_ENABLED", True):
            result = enterprise_view()

        # Assert
        assert result == "enterprise_success"

    def test_only_edition_self_hosted_allows_self_hosted(self):
        """Test self-hosted edition decorator allows SELF_HOSTED edition"""

        # Arrange
        @only_edition_self_hosted
        def self_hosted_view():
            return "self_hosted_success"

        # Act
        with patch("controllers.console.wraps.dify_config.EDITION", "SELF_HOSTED"):
            result = self_hosted_view()

        # Assert
        assert result == "self_hosted_success"


class TestBillingResourceLimits:
    """Test billing resource limit decorators"""

    def test_should_allow_when_under_resource_limit(self):
        """Test that requests are allowed when under resource limits"""
        # Arrange
        mock_features = MagicMock()
        mock_features.billing.enabled = True
        mock_features.members.limit = 10
        mock_features.members.size = 5

        @cloud_edition_billing_resource_check("members")
        def add_member():
            return "member_added"

        # Act
        with patch(
            "controllers.console.wraps.current_account_with_tenant", return_value=(MockUser("test_user"), "tenant123")
        ):
            with patch("controllers.console.wraps.FeatureService.get_features", return_value=mock_features):
                result = add_member()

        # Assert
        assert result == "member_added"

    def test_should_reject_when_over_resource_limit(self):
        """Test that requests are rejected when over resource limits"""
        # Arrange
        app = create_app_with_login()
        mock_features = MagicMock()
        mock_features.billing.enabled = True
        mock_features.members.limit = 10
        mock_features.members.size = 10

        @cloud_edition_billing_resource_check("members")
        def add_member():
            return "member_added"

        # Act & Assert
        with app.test_request_context():
            with patch(
                "controllers.console.wraps.current_account_with_tenant",
                return_value=(MockUser("test_user"), "tenant123"),
            ):
                with patch("controllers.console.wraps.FeatureService.get_features", return_value=mock_features):
                    with pytest.raises(Exception) as exc_info:
                        add_member()
                    assert exc_info.value.code == 403
                    assert "members has reached the limit" in str(exc_info.value.description)

    def test_should_check_source_for_documents_limit(self):
        """Test document limit checks request source"""
        # Arrange
        app = create_app_with_login()
        mock_features = MagicMock()
        mock_features.billing.enabled = True
        mock_features.documents_upload_quota.limit = 100
        mock_features.documents_upload_quota.size = 100

        @cloud_edition_billing_resource_check("documents")
        def upload_document():
            return "document_uploaded"

        # Test 1: Should reject when source is datasets
        with app.test_request_context("/?source=datasets"):
            with patch(
                "controllers.console.wraps.current_account_with_tenant",
                return_value=(MockUser("test_user"), "tenant123"),
            ):
                with patch("controllers.console.wraps.FeatureService.get_features", return_value=mock_features):
                    with pytest.raises(Exception) as exc_info:
                        upload_document()
                    assert exc_info.value.code == 403

        # Test 2: Should allow when source is not datasets
        with app.test_request_context("/?source=other"):
            with patch(
                "controllers.console.wraps.current_account_with_tenant",
                return_value=(MockUser("test_user"), "tenant123"),
            ):
                with patch("controllers.console.wraps.FeatureService.get_features", return_value=mock_features):
                    result = upload_document()
                    assert result == "document_uploaded"


class TestRateLimiting:
    """Test rate limiting decorator"""

    @patch("controllers.console.wraps.redis_client")
    @patch("controllers.console.wraps.db")
    def test_should_allow_requests_within_rate_limit(self, mock_db, mock_redis):
        """Test that requests within rate limit are allowed"""
        # Arrange
        mock_rate_limit = MagicMock()
        mock_rate_limit.enabled = True
        mock_rate_limit.limit = 10
        mock_redis.zcard.return_value = 5  # 5 requests in window

        @cloud_edition_billing_rate_limit_check("knowledge")
        def knowledge_request():
            return "knowledge_success"

        # Act
        with patch(
            "controllers.console.wraps.current_account_with_tenant", return_value=(MockUser("test_user"), "tenant123")
        ):
            with patch(
                "controllers.console.wraps.FeatureService.get_knowledge_rate_limit", return_value=mock_rate_limit
            ):
                result = knowledge_request()

        # Assert
        assert result == "knowledge_success"
        mock_redis.zadd.assert_called_once()
        mock_redis.zremrangebyscore.assert_called_once()

    @patch("controllers.console.wraps.redis_client")
    @patch("controllers.console.wraps.db")
    def test_should_reject_requests_over_rate_limit(self, mock_db, mock_redis):
        """Test that requests over rate limit are rejected and logged"""
        # Arrange
        app = create_app_with_login()
        mock_rate_limit = MagicMock()
        mock_rate_limit.enabled = True
        mock_rate_limit.limit = 10
        mock_rate_limit.subscription_plan = "pro"
        mock_redis.zcard.return_value = 11  # Over limit

        mock_session = MagicMock()
        mock_db.session = mock_session

        @cloud_edition_billing_rate_limit_check("knowledge")
        def knowledge_request():
            return "knowledge_success"

        # Act & Assert
        with app.test_request_context():
            with patch(
                "controllers.console.wraps.current_account_with_tenant",
                return_value=(MockUser("test_user"), "tenant123"),
            ):
                with patch(
                    "controllers.console.wraps.FeatureService.get_knowledge_rate_limit", return_value=mock_rate_limit
                ):
                    with pytest.raises(Exception) as exc_info:
                        knowledge_request()

                    # Verify error
                    assert exc_info.value.code == 403
                    assert "rate limit" in str(exc_info.value.description)

                    # Verify rate limit log was created
                    mock_session.add.assert_called_once()
                    mock_session.commit.assert_called_once()


class TestSystemSetup:
    """Test system setup decorator"""

    @patch("controllers.console.wraps.db")
    def test_should_allow_when_setup_complete(self, mock_db):
        """Test that requests are allowed when setup is complete"""
        # Arrange
        mock_db.session.query.return_value.first.return_value = MagicMock()  # Setup exists

        @setup_required
        def admin_view():
            return "admin_success"

        # Act
        with patch("controllers.console.wraps.dify_config.EDITION", "SELF_HOSTED"):
            result = admin_view()

        # Assert
        assert result == "admin_success"

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.wraps.os.environ.get")
    def test_should_raise_not_init_validate_error_with_init_password(self, mock_environ_get, mock_db):
        """Test NotInitValidateError when INIT_PASSWORD is set but setup not complete"""
        # Arrange
        mock_db.session.query.return_value.first.return_value = None  # No setup
        mock_environ_get.return_value = "some_password"

        @setup_required
        def admin_view():
            return "admin_success"

        # Act & Assert
        with patch("controllers.console.wraps.dify_config.EDITION", "SELF_HOSTED"):
            with pytest.raises(NotInitValidateError):
                admin_view()

    @patch("controllers.console.wraps.db")
    @patch("controllers.console.wraps.os.environ.get")
    def test_should_raise_not_setup_error_without_init_password(self, mock_environ_get, mock_db):
        """Test NotSetupError when no INIT_PASSWORD and setup not complete"""
        # Arrange
        mock_db.session.query.return_value.first.return_value = None  # No setup
        mock_environ_get.return_value = None  # No INIT_PASSWORD

        @setup_required
        def admin_view():
            return "admin_success"

        # Act & Assert
        with patch("controllers.console.wraps.dify_config.EDITION", "SELF_HOSTED"):
            with pytest.raises(NotSetupError):
                admin_view()


class TestEnterpriseLicense:
    """Test enterprise license decorator"""

    def test_should_allow_with_valid_license(self):
        """Test that valid licenses allow access"""
        # Arrange
        mock_settings = MagicMock()
        mock_settings.license.status = LicenseStatus.ACTIVE

        @enterprise_license_required
        def enterprise_feature():
            return "enterprise_success"

        # Act
        with patch("controllers.console.wraps.FeatureService.get_system_features", return_value=mock_settings):
            result = enterprise_feature()

        # Assert
        assert result == "enterprise_success"

    @pytest.mark.parametrize("invalid_status", [LicenseStatus.INACTIVE, LicenseStatus.EXPIRED, LicenseStatus.LOST])
    def test_should_reject_with_invalid_license(self, invalid_status):
        """Test that invalid licenses raise UnauthorizedAndForceLogout"""
        # Arrange
        mock_settings = MagicMock()
        mock_settings.license.status = invalid_status

        @enterprise_license_required
        def enterprise_feature():
            return "enterprise_success"

        # Act & Assert
        with patch("controllers.console.wraps.FeatureService.get_system_features", return_value=mock_settings):
            with pytest.raises(UnauthorizedAndForceLogout) as exc_info:
                enterprise_feature()
            assert "license is invalid" in str(exc_info.value)
