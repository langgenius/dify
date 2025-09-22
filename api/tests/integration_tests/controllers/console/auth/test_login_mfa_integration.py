import json
import sys
from unittest.mock import Mock, patch

from flask import Flask


class TestLoginMFAIntegration:
    @patch("controllers.console.auth.login.FeatureService.get_system_features")
    @patch("controllers.console.auth.login.dify_config")
    @patch("controllers.console.auth.login.BillingService.is_email_in_freeze")
    @patch("controllers.console.auth.login.AccountService.is_login_error_rate_limit")
    @patch("controllers.console.auth.login.AccountService.authenticate")
    @patch("controllers.console.auth.login.MFAService.is_mfa_required")
    @patch("controllers.console.auth.login.TenantService.get_join_tenants")
    @patch("controllers.console.auth.login.AccountService.login")
    @patch("controllers.console.auth.login.AccountService.reset_login_error_rate_limit")
    @patch("controllers.console.auth.login.extract_remote_ip")
    def test_login_without_mfa_success(
        self,
        mock_extract_ip,
        mock_reset_limit,
        mock_login_service,
        mock_get_tenants,
        mock_is_mfa_required,
        mock_authenticate,
        mock_rate_limit,
        mock_freeze_check,
        mock_dify_config,
        mock_system_features,
        test_client,
        setup_account,
    ):
        """Test successful login without MFA enabled."""
        # Setup mocks
        mock_dify_config.BILLING_ENABLED = False
        mock_freeze_check.return_value = False
        mock_rate_limit.return_value = False
        mock_authenticate.return_value = setup_account
        mock_is_mfa_required.return_value = False
        mock_get_tenants.return_value = [Mock()]  # At least one tenant
        mock_extract_ip.return_value = "127.0.0.1"

        token_pair_mock = Mock()
        token_pair_mock.model_dump.return_value = {
            "access_token": "test_access_token",
            "refresh_token": "test_refresh_token",
        }
        mock_login_service.return_value = token_pair_mock

        with (
            patch("controllers.console.auth.login.setup_required") as mock_setup,
            patch("controllers.console.auth.login.email_password_login_enabled") as mock_email_enabled,
        ):
            mock_setup.return_value = lambda f: f
            mock_email_enabled.return_value = lambda f: f

            response = test_client.post(
                "/console/api/login", json={"email": setup_account.email, "password": "TestPassword123"}
            )


            assert response.status_code == 200
            data = json.loads(response.data)
            assert data["result"] == "success"
            assert "access_token" in data["data"]

    @patch("controllers.console.auth.login.FeatureService.get_system_features")
    @patch("controllers.console.auth.login.dify_config")
    @patch("controllers.console.auth.login.BillingService.is_email_in_freeze")
    @patch("controllers.console.auth.login.AccountService.is_login_error_rate_limit")
    @patch("controllers.console.auth.login.AccountService.authenticate")
    @patch("controllers.console.auth.login.MFAService.is_mfa_required")
    def test_login_with_mfa_required_no_token(
        self,
        mock_is_mfa_required,
        mock_authenticate,
        mock_rate_limit,
        mock_freeze_check,
        mock_dify_config,
        mock_system_features,
        test_client,
        setup_account,
    ):
        """Test login returns mfa_required when MFA is enabled but no token provided."""
        # Setup mocks
        mock_dify_config.BILLING_ENABLED = False
        mock_freeze_check.return_value = False
        mock_rate_limit.return_value = False
        mock_authenticate.return_value = setup_account
        mock_is_mfa_required.return_value = True

        with (
            patch("controllers.console.auth.login.setup_required") as mock_setup,
            patch("controllers.console.auth.login.email_password_login_enabled") as mock_email_enabled,
        ):
            mock_setup.return_value = lambda f: f
            mock_email_enabled.return_value = lambda f: f

            response = test_client.post(
                "/console/api/login", json={"email": "test@example.com", "password": "TestPassword123"}
            )

            assert response.status_code == 200
            data = json.loads(response.data)
            assert data["result"] == "fail"
            assert data["code"] == "mfa_required"

    @patch("controllers.console.auth.login.FeatureService.get_system_features")
    @patch("controllers.console.auth.login.dify_config")
    @patch("controllers.console.auth.login.BillingService.is_email_in_freeze")
    @patch("controllers.console.auth.login.AccountService.is_login_error_rate_limit")
    @patch("controllers.console.auth.login.AccountService.authenticate")
    @patch("controllers.console.auth.login.MFAService.is_mfa_required")
    @patch("controllers.console.auth.login.MFAService.authenticate_with_mfa")
    def test_login_with_mfa_invalid_token(
        self,
        mock_auth_mfa,
        mock_is_mfa_required,
        mock_authenticate,
        mock_rate_limit,
        mock_freeze_check,
        mock_dify_config,
        mock_system_features,
        test_client,
        setup_account,
    ):
        """Test login fails with invalid MFA token."""
        # Setup mocks
        mock_dify_config.BILLING_ENABLED = False
        mock_freeze_check.return_value = False
        mock_rate_limit.return_value = False
        mock_authenticate.return_value = setup_account
        mock_is_mfa_required.return_value = True
        mock_auth_mfa.return_value = False  # Invalid token

        with (
            patch("controllers.console.auth.login.setup_required") as mock_setup,
            patch("controllers.console.auth.login.email_password_login_enabled") as mock_email_enabled,
        ):
            mock_setup.return_value = lambda f: f
            mock_email_enabled.return_value = lambda f: f

            response = test_client.post(
                "/console/api/login",
                json={"email": "test@example.com", "password": "TestPassword123", "mfa_code": "invalid_token"},
            )

            assert response.status_code == 200
            data = json.loads(response.data)
            assert data["result"] == "fail"
            assert data["code"] == "mfa_token_invalid"
            assert data["data"] == "The MFA token is invalid or expired."

    @patch("controllers.console.auth.login.FeatureService.get_system_features")
    @patch("controllers.console.auth.login.dify_config")
    @patch("controllers.console.auth.login.BillingService.is_email_in_freeze")
    @patch("controllers.console.auth.login.AccountService.is_login_error_rate_limit")
    @patch("controllers.console.auth.login.AccountService.authenticate")
    @patch("controllers.console.auth.login.MFAService.is_mfa_required")
    @patch("controllers.console.auth.login.MFAService.authenticate_with_mfa")
    @patch("controllers.console.auth.login.TenantService.get_join_tenants")
    @patch("controllers.console.auth.login.AccountService.login")
    @patch("controllers.console.auth.login.AccountService.reset_login_error_rate_limit")
    @patch("controllers.console.auth.login.extract_remote_ip")
    def test_login_with_mfa_valid_token_success(
        self,
        mock_extract_ip,
        mock_reset_limit,
        mock_login_service,
        mock_get_tenants,
        mock_auth_mfa,
        mock_is_mfa_required,
        mock_authenticate,
        mock_rate_limit,
        mock_freeze_check,
        mock_dify_config,
        mock_system_features,
        test_client,
        setup_account,
    ):
        """Test successful login with valid MFA token."""
        # Setup mocks
        mock_dify_config.BILLING_ENABLED = False
        mock_freeze_check.return_value = False
        mock_rate_limit.return_value = False
        mock_authenticate.return_value = setup_account
        mock_is_mfa_required.return_value = True
        mock_auth_mfa.return_value = True  # Valid token
        mock_get_tenants.return_value = [Mock()]  # At least one tenant
        mock_extract_ip.return_value = "127.0.0.1"

        token_pair_mock = Mock()
        token_pair_mock.model_dump.return_value = {
            "access_token": "test_access_token",
            "refresh_token": "test_refresh_token",
        }
        mock_login_service.return_value = token_pair_mock

        with (
            patch("controllers.console.auth.login.setup_required") as mock_setup,
            patch("controllers.console.auth.login.email_password_login_enabled") as mock_email_enabled,
        ):
            mock_setup.return_value = lambda f: f
            mock_email_enabled.return_value = lambda f: f

            response = test_client.post(
                "/console/api/login",
                json={"email": "test@example.com", "password": "TestPassword123", "mfa_code": "123456"},
            )

            assert response.status_code == 200
            data = json.loads(response.data)
            assert data["result"] == "success"
            assert "access_token" in data["data"]

            # Verify MFA authentication was called
            mock_auth_mfa.assert_called_once_with(setup_account, "123456")

    @patch("controllers.console.auth.login.FeatureService.get_system_features")
    @patch("controllers.console.auth.login.dify_config")
    @patch("controllers.console.auth.login.BillingService.is_email_in_freeze")
    @patch("controllers.console.auth.login.AccountService.is_login_error_rate_limit")
    @patch("controllers.console.auth.login.AccountService.authenticate")
    @patch("controllers.console.auth.login.MFAService.is_mfa_required")
    @patch("controllers.console.auth.login.MFAService.authenticate_with_mfa")
    @patch("controllers.console.auth.login.TenantService.get_join_tenants")
    @patch("controllers.console.auth.login.AccountService.login")
    @patch("controllers.console.auth.login.AccountService.reset_login_error_rate_limit")
    @patch("controllers.console.auth.login.extract_remote_ip")
    def test_login_with_mfa_backup_code_success(
        self,
        mock_extract_ip,
        mock_reset_limit,
        mock_login_service,
        mock_get_tenants,
        mock_auth_mfa,
        mock_is_mfa_required,
        mock_authenticate,
        mock_rate_limit,
        mock_freeze_check,
        mock_dify_config,
        mock_system_features,
        test_client,
        setup_account,
    ):
        """Test successful login with valid backup code."""
        # Setup mocks
        mock_dify_config.BILLING_ENABLED = False
        mock_freeze_check.return_value = False
        mock_rate_limit.return_value = False
        mock_authenticate.return_value = setup_account
        mock_is_mfa_required.return_value = True
        mock_auth_mfa.return_value = True  # Valid backup code
        mock_get_tenants.return_value = [Mock()]  # At least one tenant
        mock_extract_ip.return_value = "127.0.0.1"

        token_pair_mock = Mock()
        token_pair_mock.model_dump.return_value = {
            "access_token": "test_access_token",
            "refresh_token": "test_refresh_token",
        }
        mock_login_service.return_value = token_pair_mock

        with (
            patch("controllers.console.auth.login.setup_required") as mock_setup,
            patch("controllers.console.auth.login.email_password_login_enabled") as mock_email_enabled,
        ):
            mock_setup.return_value = lambda f: f
            mock_email_enabled.return_value = lambda f: f

            response = test_client.post(
                "/console/api/login",
                json={
                    "email": "test@example.com",
                    "password": "TestPassword123",
                    "mfa_code": "BACKUP123",  # Backup code format
                },
            )

            assert response.status_code == 200
            data = json.loads(response.data)
            assert data["result"] == "success"
            assert "access_token" in data["data"]

            # Verify MFA authentication was called with backup code
            mock_auth_mfa.assert_called_once_with(setup_account, "BACKUP123")

    @patch("controllers.console.auth.login.FeatureService.get_system_features")
    @patch("controllers.console.auth.login.dify_config")
    @patch("controllers.console.auth.login.BillingService.is_email_in_freeze")
    @patch("controllers.console.auth.login.AccountService.is_login_error_rate_limit")
    @patch("controllers.console.auth.login.AccountService.authenticate")
    @patch("controllers.console.auth.login.MFAService.is_mfa_required")
    def test_login_mfa_flow_order(
        self,
        mock_is_mfa_required,
        mock_authenticate,
        mock_rate_limit,
        mock_freeze_check,
        mock_dify_config,
        mock_system_features,
        test_client,
    ):
        """Test that MFA check happens after password authentication."""
        # Setup mocks - password auth fails
        mock_dify_config.BILLING_ENABLED = False
        mock_freeze_check.return_value = False
        mock_rate_limit.return_value = False

        # Mock password authentication failure
        from services.errors.account import AccountPasswordError

        mock_authenticate.side_effect = AccountPasswordError()

        with (
            patch("controllers.console.auth.login.setup_required") as mock_setup,
            patch("controllers.console.auth.login.email_password_login_enabled") as mock_email_enabled,
            patch("controllers.console.auth.login.AccountService.add_login_error_rate_limit") as mock_add_limit,
        ):
            mock_setup.return_value = lambda f: f
            mock_email_enabled.return_value = lambda f: f

            response = test_client.post(
                "/console/api/login",
                json={"email": "test@example.com", "password": "WrongPassword123", "mfa_code": "123456"},
            )

            # Password error should trigger EmailOrPasswordMismatchError
            assert response.status_code == 400

            # MFA check should not be called if password auth fails
            mock_is_mfa_required.assert_not_called()


class TestMFAEndToEndFlow:
    """End-to-end tests for complete MFA flow."""

    def setup_method(self):
        self.app = Flask(__name__)
        self.app.config["TESTING"] = True
        self.client = self.app.test_client()

    @patch("services.mfa_service.MFAService.generate_secret")
    @patch("services.mfa_service.MFAService.generate_qr_code")
    @patch("services.mfa_service.MFAService.verify_totp")
    @patch("services.mfa_service.MFAService.generate_backup_codes")
    @patch("services.mfa_service.db.session")
    def test_complete_mfa_setup_flow(self, mock_session, mock_gen_codes, mock_verify, mock_gen_qr, mock_gen_secret):
        """Test complete MFA setup flow from init to completion."""
        from models.account import Account
        from services.mfa_service import MFAService

        # Mock account
        account = Mock(spec=Account)
        account.id = "test-id"
        account.email = "test@example.com"

        # Setup mocks
        mock_gen_secret.return_value = "TESTSECRET123"
        mock_gen_qr.return_value = "data:image/png;base64,test"
        mock_verify.return_value = True
        mock_gen_codes.return_value = ["CODE1", "CODE2", "CODE3"]

        # Step 1: Initialize MFA setup
        with patch("services.mfa_service.MFAService.get_or_create_mfa_settings") as mock_get_settings:
            mfa_settings = Mock()
            mfa_settings.enabled = False
            mfa_settings.secret = None
            mock_get_settings.return_value = mfa_settings

            setup_data = MFAService.generate_mfa_setup_data(account)

            assert setup_data["secret"] == "TESTSECRET123"
            assert setup_data["qr_code"] == "data:image/png;base64,test"
            assert mfa_settings.secret == "TESTSECRET123"

        # Step 2: Complete MFA setup
        with patch("services.mfa_service.MFAService.get_or_create_mfa_settings") as mock_get_settings:
            mfa_settings.secret = "TESTSECRET123"
            mock_get_settings.return_value = mfa_settings

            result = MFAService.setup_mfa(account, "123456")

            assert mfa_settings.enabled is True
            assert result["backup_codes"] == ["CODE1", "CODE2", "CODE3"]
            assert mfa_settings.setup_at is not None
