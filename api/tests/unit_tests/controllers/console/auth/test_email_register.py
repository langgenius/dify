"""Unit tests for email register controller endpoints."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from flask import Flask

from controllers.console.auth.email_register import (
    EmailRegisterCheckApi,
    EmailRegisterResetApi,
    EmailRegisterSendEmailApi,
)
from controllers.console.error import AccountInFreezeError, EmailDomainSuspendedError
from enums import DeploymentEdition
from models.account import Account
from services.entities.feature_entities import SystemFeatureModel
from services.errors.account import (
    AccountRegisterError,
)
from services.errors.account import (
    EmailDomainSuspendedError as EmailDomainSuspendedRegistrationError,
)


class TestEmailRegisterSendEmailApi:
    @patch("controllers.console.auth.email_register.AccountService.get_account_by_email_with_case_fallback")
    @patch("controllers.console.auth.email_register.AccountService.send_email_register_email")
    @patch("controllers.console.auth.email_register.BillingService.get_email_freeze_type")
    @patch("controllers.console.auth.email_register.AccountService.is_email_send_ip_limit", return_value=False)
    @patch("controllers.console.auth.email_register.extract_remote_ip", return_value="127.0.0.1")
    def test_send_email_normalizes_and_falls_back(
        self,
        mock_extract_ip,
        mock_is_email_send_ip_limit,
        mock_is_freeze,
        mock_send_mail,
        mock_get_account,
        app: Flask,
    ):
        mock_send_mail.return_value = "token-123"
        mock_is_freeze.return_value = False
        account = Account(name="Invitee", email="invitee@example.com")
        mock_get_account.return_value = account

        feature_flags = SystemFeatureModel(
            deployment_edition=DeploymentEdition.COMMUNITY,
            enable_email_password_login=True,
            is_allow_register=True,
        )
        with (
            patch("controllers.console.auth.email_register.dify_config.DEPLOYMENT_EDITION", DeploymentEdition.CLOUD),
            patch("controllers.console.wraps.dify_config.DEPLOYMENT_EDITION", DeploymentEdition.CLOUD),
            patch("controllers.console.wraps.FeatureService.get_system_features", return_value=feature_flags),
        ):
            with app.test_request_context(
                "/email-register/send-email",
                method="POST",
                json={"email": "Invitee@Example.com", "language": "en-US"},
            ):
                response = EmailRegisterSendEmailApi().post()

        assert response == {"result": "success", "data": "token-123"}
        mock_is_freeze.assert_called_once_with("invitee@example.com")
        mock_send_mail.assert_called_once_with(email="invitee@example.com", account=account, language="en-US")
        mock_extract_ip.assert_called_once()
        mock_is_email_send_ip_limit.assert_called_once_with("127.0.0.1")

    @pytest.mark.parametrize(
        ("freeze_type", "expected_error"),
        [
            ("freeze", AccountInFreezeError),
            ("email_domain_suspended", EmailDomainSuspendedError),
        ],
    )
    @patch("controllers.console.auth.email_register.BillingService.get_email_freeze_type")
    @patch("controllers.console.auth.email_register.AccountService.is_email_send_ip_limit", return_value=False)
    @patch("controllers.console.auth.email_register.extract_remote_ip", return_value="127.0.0.1")
    def test_send_email_rejects_frozen_email(
        self,
        mock_extract_ip,
        mock_is_email_send_ip_limit,
        mock_get_freeze_type,
        app: Flask,
        freeze_type,
        expected_error,
    ):
        mock_get_freeze_type.return_value = freeze_type
        feature_flags = SystemFeatureModel(
            deployment_edition=DeploymentEdition.COMMUNITY,
            enable_email_password_login=True,
            is_allow_register=True,
        )

        with (
            patch("controllers.console.auth.email_register.dify_config.DEPLOYMENT_EDITION", DeploymentEdition.CLOUD),
            patch("controllers.console.wraps.dify_config.DEPLOYMENT_EDITION", DeploymentEdition.CLOUD),
            patch("controllers.console.wraps.FeatureService.get_system_features", return_value=feature_flags),
        ):
            with app.test_request_context(
                "/email-register/send-email",
                method="POST",
                json={"email": "Invitee@Example.com"},
            ):
                with pytest.raises(expected_error):
                    EmailRegisterSendEmailApi().post()

        mock_get_freeze_type.assert_called_once_with("invitee@example.com")
        mock_is_email_send_ip_limit.assert_called_once_with("127.0.0.1")
        mock_extract_ip.assert_called_once()


class TestEmailRegisterCheckApi:
    @patch("controllers.console.auth.email_register.AccountService.reset_email_register_error_rate_limit")
    @patch("controllers.console.auth.email_register.AccountService.generate_email_register_token")
    @patch("controllers.console.auth.email_register.AccountService.revoke_email_register_token")
    @patch("controllers.console.auth.email_register.AccountService.add_email_register_error_rate_limit")
    @patch("controllers.console.auth.email_register.AccountService.get_email_register_data")
    @patch("controllers.console.auth.email_register.AccountService.is_email_register_error_rate_limit")
    def test_validity_normalizes_email_before_checks(
        self,
        mock_rate_limit_check,
        mock_get_data,
        mock_add_rate,
        mock_revoke,
        mock_generate_token,
        mock_reset_rate,
        app: Flask,
    ):
        mock_rate_limit_check.return_value = False
        mock_get_data.return_value = {"email": "User@Example.com", "code": "4321"}
        mock_generate_token.return_value = (None, "new-token")

        feature_flags = SystemFeatureModel(
            deployment_edition=DeploymentEdition.COMMUNITY,
            enable_email_password_login=True,
            is_allow_register=True,
        )
        with (
            patch("controllers.console.wraps.dify_config.DEPLOYMENT_EDITION", DeploymentEdition.CLOUD),
            patch("controllers.console.wraps.FeatureService.get_system_features", return_value=feature_flags),
        ):
            with app.test_request_context(
                "/email-register/validity",
                method="POST",
                json={"email": "User@Example.com", "code": "4321", "token": "token-123"},
            ):
                response = EmailRegisterCheckApi().post()

        assert response == {"is_valid": True, "email": "user@example.com", "token": "new-token"}
        mock_rate_limit_check.assert_called_once_with("user@example.com")
        mock_generate_token.assert_called_once_with(
            "user@example.com", code="4321", additional_data={"phase": "register"}
        )
        mock_reset_rate.assert_called_once_with("user@example.com")
        mock_add_rate.assert_not_called()
        mock_revoke.assert_called_once_with("token-123")


class TestEmailRegisterResetApi:
    @pytest.mark.parametrize(
        ("service_error", "expected_error"),
        [
            (EmailDomainSuspendedRegistrationError(), EmailDomainSuspendedError),
            (AccountRegisterError("frozen"), AccountInFreezeError),
        ],
    )
    @patch("controllers.console.auth.email_register.AccountService.create_account_and_tenant")
    def test_create_new_account_translates_freeze_errors(
        self,
        mock_create_account,
        service_error,
        expected_error,
    ):
        mock_create_account.side_effect = service_error

        with pytest.raises(expected_error):
            EmailRegisterResetApi()._create_new_account(
                email="user@example.com",
                password="ValidPass123!",
            )

    @patch("controllers.console.auth.email_register.AccountService.reset_login_error_rate_limit")
    @patch("controllers.console.auth.email_register.AccountService.login")
    @patch("controllers.console.auth.email_register.EmailRegisterResetApi._create_new_account")
    @patch("controllers.console.auth.email_register.AccountService.get_account_by_email_with_case_fallback")
    @patch("controllers.console.auth.email_register.AccountService.revoke_email_register_token")
    @patch("controllers.console.auth.email_register.AccountService.get_email_register_data")
    @patch("controllers.console.auth.email_register.extract_remote_ip", return_value="127.0.0.1")
    def test_reset_creates_account_with_normalized_email(
        self,
        mock_extract_ip,
        mock_get_data,
        mock_revoke_token,
        mock_get_account,
        mock_create_account,
        mock_login,
        mock_reset_login_rate,
        app: Flask,
    ):
        mock_get_data.return_value = {"phase": "register", "email": "Invitee@Example.com"}
        mock_create_account.return_value = Account(name="Invitee", email="invitee@example.com")
        token_pair = MagicMock()
        token_pair.model_dump.return_value = {"access_token": "a", "refresh_token": "r"}
        mock_login.return_value = token_pair
        mock_get_account.return_value = None

        feature_flags = SystemFeatureModel(
            deployment_edition=DeploymentEdition.COMMUNITY,
            enable_email_password_login=True,
            is_allow_register=True,
        )
        with (
            patch("controllers.console.wraps.dify_config.DEPLOYMENT_EDITION", DeploymentEdition.CLOUD),
            patch("controllers.console.wraps.FeatureService.get_system_features", return_value=feature_flags),
        ):
            with app.test_request_context(
                "/email-register",
                method="POST",
                json={"token": "token-123", "new_password": "ValidPass123!", "password_confirm": "ValidPass123!"},
            ):
                response = EmailRegisterResetApi().post()

        assert response == {"result": "success", "data": {"access_token": "a", "refresh_token": "r"}}
        mock_create_account.assert_called_once_with(
            email="invitee@example.com",
            password="ValidPass123!",
            timezone=None,
            language=None,
            ip_address="127.0.0.1",
        )
        mock_reset_login_rate.assert_called_once_with("invitee@example.com")
        mock_revoke_token.assert_called_once_with("token-123")
        mock_extract_ip.assert_called_once()

    @patch("controllers.console.auth.email_register.AccountService.reset_login_error_rate_limit")
    @patch("controllers.console.auth.email_register.AccountService.login")
    @patch("controllers.console.auth.email_register.EmailRegisterResetApi._create_new_account")
    @patch("controllers.console.auth.email_register.AccountService.get_account_by_email_with_case_fallback")
    @patch("controllers.console.auth.email_register.AccountService.revoke_email_register_token")
    @patch("controllers.console.auth.email_register.AccountService.get_email_register_data")
    @patch("controllers.console.auth.email_register.extract_remote_ip", return_value="127.0.0.1")
    def test_reset_passes_timezone_to_new_account(
        self,
        mock_extract_ip,
        mock_get_data,
        mock_revoke_token,
        mock_get_account,
        mock_create_account,
        mock_login,
        mock_reset_login_rate,
        app: Flask,
    ):
        mock_get_data.return_value = {"phase": "register", "email": "Invitee@Example.com"}
        mock_create_account.return_value = Account(name="Invitee", email="invitee@example.com")
        token_pair = MagicMock()
        token_pair.model_dump.return_value = {"access_token": "a", "refresh_token": "r"}
        mock_login.return_value = token_pair
        mock_get_account.return_value = None

        feature_flags = SystemFeatureModel(
            deployment_edition=DeploymentEdition.COMMUNITY,
            enable_email_password_login=True,
            is_allow_register=True,
        )
        with (
            patch("controllers.console.wraps.dify_config.DEPLOYMENT_EDITION", DeploymentEdition.CLOUD),
            patch("controllers.console.wraps.FeatureService.get_system_features", return_value=feature_flags),
        ):
            with app.test_request_context(
                "/email-register",
                method="POST",
                json={
                    "token": "token-123",
                    "new_password": "ValidPass123!",
                    "password_confirm": "ValidPass123!",
                    "timezone": "Asia/Shanghai",
                },
            ):
                response = EmailRegisterResetApi().post()

        assert response == {"result": "success", "data": {"access_token": "a", "refresh_token": "r"}}
        mock_create_account.assert_called_once_with(
            email="invitee@example.com",
            password="ValidPass123!",
            timezone="Asia/Shanghai",
            language=None,
            ip_address="127.0.0.1",
        )
        mock_reset_login_rate.assert_called_once_with("invitee@example.com")
        mock_revoke_token.assert_called_once_with("token-123")
        mock_extract_ip.assert_called_once()

    @patch("controllers.console.auth.email_register.AccountService.reset_login_error_rate_limit")
    @patch("controllers.console.auth.email_register.AccountService.login")
    @patch("controllers.console.auth.email_register.EmailRegisterResetApi._create_new_account")
    @patch("controllers.console.auth.email_register.AccountService.get_account_by_email_with_case_fallback")
    @patch("controllers.console.auth.email_register.AccountService.revoke_email_register_token")
    @patch("controllers.console.auth.email_register.AccountService.get_email_register_data")
    @patch("controllers.console.auth.email_register.extract_remote_ip", return_value="127.0.0.1")
    def test_reset_passes_language_to_new_account(
        self,
        mock_extract_ip,
        mock_get_data,
        mock_revoke_token,
        mock_get_account,
        mock_create_account,
        mock_login,
        mock_reset_login_rate,
        app: Flask,
    ):
        mock_get_data.return_value = {"phase": "register", "email": "Invitee@Example.com"}
        mock_create_account.return_value = Account(name="Invitee", email="invitee@example.com")
        token_pair = MagicMock()
        token_pair.model_dump.return_value = {"access_token": "a", "refresh_token": "r"}
        mock_login.return_value = token_pair
        mock_get_account.return_value = None

        feature_flags = SystemFeatureModel(
            deployment_edition=DeploymentEdition.COMMUNITY,
            enable_email_password_login=True,
            is_allow_register=True,
        )
        with (
            patch("controllers.console.wraps.dify_config.DEPLOYMENT_EDITION", DeploymentEdition.CLOUD),
            patch("controllers.console.wraps.FeatureService.get_system_features", return_value=feature_flags),
        ):
            with app.test_request_context(
                "/email-register",
                method="POST",
                json={
                    "token": "token-123",
                    "new_password": "ValidPass123!",
                    "password_confirm": "ValidPass123!",
                    "language": "zh-Hans",
                },
            ):
                response = EmailRegisterResetApi().post()

        assert response == {"result": "success", "data": {"access_token": "a", "refresh_token": "r"}}
        mock_create_account.assert_called_once_with(
            email="invitee@example.com",
            password="ValidPass123!",
            timezone=None,
            language="zh-Hans",
            ip_address="127.0.0.1",
        )
        mock_reset_login_rate.assert_called_once_with("invitee@example.com")
        mock_revoke_token.assert_called_once_with("token-123")
        mock_extract_ip.assert_called_once()
