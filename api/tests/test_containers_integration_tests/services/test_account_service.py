import json
from hashlib import sha256
from unittest.mock import patch

import pytest
from faker import Faker
from werkzeug.exceptions import Unauthorized

from configs import dify_config
from controllers.console.error import AccountNotFound, NotAllowedCreateWorkspace
from models import AccountStatus, TenantAccountJoin
from services.account_service import AccountService, RegisterService, TenantService, TokenPair
from services.errors.account import (
    AccountAlreadyInTenantError,
    AccountLoginError,
    AccountPasswordError,
    AccountRegisterError,
    CurrentPasswordIncorrectError,
    TenantNotFoundError,
)
from services.errors.workspace import WorkSpaceNotAllowedCreateError, WorkspacesLimitExceededError


class TestAccountService:
    """Integration tests for AccountService using testcontainers."""

    @pytest.fixture
    def mock_external_service_dependencies(self):
        """Mock setup for external service dependencies."""
        with (
            patch("services.account_service.FeatureService") as mock_feature_service,
            patch("services.account_service.BillingService") as mock_billing_service,
            patch("services.account_service.PassportService") as mock_passport_service,
        ):
            # Setup default mock returns
            mock_feature_service.get_system_features.return_value.is_allow_register = True
            mock_feature_service.get_system_features.return_value.is_allow_create_workspace = True
            mock_feature_service.get_system_features.return_value.license.workspaces.is_available.return_value = True
            mock_billing_service.is_email_in_freeze.return_value = False
            mock_passport_service.return_value.issue.return_value = "mock_jwt_token"

            yield {
                "feature_service": mock_feature_service,
                "billing_service": mock_billing_service,
                "passport_service": mock_passport_service,
            }

    def test_create_account_and_login(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test account creation and login with correct password.
        """
        fake = Faker()
        email = fake.email()
        name = fake.name()
        password = fake.password(length=12)
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False

        account = AccountService.create_account(
            email=email,
            name=name,
            interface_language="en-US",
            password=password,
        )
        assert account.email == email
        assert account.status == AccountStatus.ACTIVE

        # Login with correct password
        logged_in = AccountService.authenticate(email, password)
        assert logged_in.id == account.id

    def test_create_account_without_password(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test account creation without password (for OAuth users).
        """
        fake = Faker()
        email = fake.email()
        name = fake.name()
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False

        account = AccountService.create_account(
            email=email,
            name=name,
            interface_language="en-US",
            password=None,
        )
        assert account.email == email
        assert account.password is None
        assert account.password_salt is None

    def test_create_account_password_invalid_new_password(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test account create with invalid new password format.
        """
        fake = Faker()
        email = fake.email()
        name = fake.name()
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False

        # Test with too short password (assuming minimum length validation)
        with pytest.raises(ValueError):  # Password validation error
            AccountService.create_account(
                email=email,
                name=name,
                interface_language="en-US",
                password="invalid_new_password",
            )

    def test_create_account_registration_disabled(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test account creation when registration is disabled.
        """
        fake = Faker()
        email = fake.email()
        name = fake.name()
        # Setup mocks to disable registration
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = False

        with pytest.raises(AccountNotFound):  # AccountNotFound exception
            AccountService.create_account(
                email=email,
                name=name,
                interface_language="en-US",
                password=fake.password(length=12),
            )

    def test_create_account_email_in_freeze(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test account creation when email is in freeze period.
        """
        fake = Faker()
        email = fake.email()
        name = fake.name()
        password = fake.password(length=12)
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = True
        dify_config.BILLING_ENABLED = True

        with pytest.raises(AccountRegisterError):
            AccountService.create_account(
                email=email,
                name=name,
                interface_language="en-US",
                password=password,
            )

        dify_config.BILLING_ENABLED = False  # Reset config for other tests

    def test_authenticate_account_not_found(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test authentication with non-existent account.
        """
        fake = Faker()
        email = fake.email()
        password = fake.password(length=12)
        with pytest.raises(AccountPasswordError):
            AccountService.authenticate(email, password)

    def test_authenticate_banned_account(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test authentication with banned account.
        """
        fake = Faker()
        email = fake.email()
        name = fake.name()
        password = fake.password(length=12)
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False

        # Create account first
        account = AccountService.create_account(
            email=email,
            name=name,
            interface_language="en-US",
            password=password,
        )

        # Ban the account
        account.status = AccountStatus.BANNED
        from extensions.ext_database import db

        db.session.commit()

        with pytest.raises(AccountLoginError):
            AccountService.authenticate(email, password)

    def test_authenticate_wrong_password(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test authentication with wrong password.
        """
        fake = Faker()
        email = fake.email()
        name = fake.name()
        correct_password = fake.password(length=12)
        wrong_password = fake.password(length=12)
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False

        # Create account first
        AccountService.create_account(
            email=email,
            name=name,
            interface_language="en-US",
            password=correct_password,
        )

        with pytest.raises(AccountPasswordError):
            AccountService.authenticate(email, wrong_password)

    def test_authenticate_with_invite_token(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test authentication with invite token to set password for account without password.
        """
        fake = Faker()
        email = fake.email()
        name = fake.name()
        new_password = fake.password(length=12)
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False

        # Create account without password
        account = AccountService.create_account(
            email=email,
            name=name,
            interface_language="en-US",
            password=None,
        )

        # Authenticate with invite token to set password
        authenticated_account = AccountService.authenticate(
            email,
            new_password,
            invite_token="valid_invite_token",
        )

        assert authenticated_account.id == account.id
        assert authenticated_account.password is not None
        assert authenticated_account.password_salt is not None

    def test_authenticate_pending_account_activation(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test authentication activates pending account.
        """
        fake = Faker()
        email = fake.email()
        name = fake.name()
        password = fake.password(length=12)
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False

        # Create account with pending status
        account = AccountService.create_account(
            email=email,
            name=name,
            interface_language="en-US",
            password=password,
        )
        account.status = AccountStatus.PENDING
        from extensions.ext_database import db

        db.session.commit()

        # Authenticate should activate the account
        authenticated_account = AccountService.authenticate(email, password)
        assert authenticated_account.status == AccountStatus.ACTIVE
        assert authenticated_account.initialized_at is not None

    def test_update_account_password_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful password update.
        """
        fake = Faker()
        email = fake.email()
        name = fake.name()
        old_password = fake.password(length=12)
        new_password = fake.password(length=12)
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False

        # Create account
        account = AccountService.create_account(
            email=email,
            name=name,
            interface_language="en-US",
            password=old_password,
        )

        # Update password
        updated_account = AccountService.update_account_password(account, old_password, new_password)

        # Verify new password works
        authenticated_account = AccountService.authenticate(email, new_password)
        assert authenticated_account.id == account.id

    def test_update_account_password_wrong_current_password(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test password update with wrong current password.
        """
        fake = Faker()
        email = fake.email()
        name = fake.name()
        old_password = fake.password(length=12)
        wrong_password = fake.password(length=12)
        new_password = fake.password(length=12)
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False

        # Create account
        account = AccountService.create_account(
            email=email,
            name=name,
            interface_language="en-US",
            password=old_password,
        )

        with pytest.raises(CurrentPasswordIncorrectError):
            AccountService.update_account_password(account, wrong_password, new_password)

    def test_update_account_password_invalid_new_password(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test password update with invalid new password format.
        """
        fake = Faker()
        email = fake.email()
        name = fake.name()
        old_password = fake.password(length=12)
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False

        # Create account
        account = AccountService.create_account(
            email=email,
            name=name,
            interface_language="en-US",
            password=old_password,
        )

        # Test with too short password (assuming minimum length validation)
        with pytest.raises(ValueError):  # Password validation error
            AccountService.update_account_password(account, old_password, "123")

    def test_create_account_and_tenant(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test account creation with automatic tenant creation.
        """
        fake = Faker()
        email = fake.email()
        name = fake.name()
        password = fake.password(length=12)
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies[
            "feature_service"
        ].get_system_features.return_value.is_allow_create_workspace = True
        mock_external_service_dependencies[
            "feature_service"
        ].get_system_features.return_value.license.workspaces.is_available.return_value = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False
        account = AccountService.create_account_and_tenant(
            email=email,
            name=name,
            interface_language="en-US",
            password=password,
        )

        assert account.email == email

        # Verify tenant was created and linked
        from extensions.ext_database import db

        tenant_join = db.session.query(TenantAccountJoin).filter_by(account_id=account.id).first()
        assert tenant_join is not None
        assert tenant_join.role == "owner"

    def test_create_account_and_tenant_workspace_creation_disabled(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test account creation when workspace creation is disabled.
        """
        fake = Faker()
        email = fake.email()
        name = fake.name()
        password = fake.password(length=12)
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies[
            "feature_service"
        ].get_system_features.return_value.is_allow_create_workspace = False
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False

        with pytest.raises(WorkSpaceNotAllowedCreateError):
            AccountService.create_account_and_tenant(
                email=email,
                name=name,
                interface_language="en-US",
                password=password,
            )

    def test_create_account_and_tenant_workspace_limit_exceeded(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test account creation when workspace limit is exceeded.
        """
        fake = Faker()
        email = fake.email()
        name = fake.name()
        password = fake.password(length=12)
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies[
            "feature_service"
        ].get_system_features.return_value.is_allow_create_workspace = True
        mock_external_service_dependencies[
            "feature_service"
        ].get_system_features.return_value.license.workspaces.is_available.return_value = False
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False

        with pytest.raises(WorkspacesLimitExceededError):
            AccountService.create_account_and_tenant(
                email=email,
                name=name,
                interface_language="en-US",
                password=password,
            )

    def test_link_account_integrate_new_provider(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test linking account with new OAuth provider.
        """
        fake = Faker()
        email = fake.email()
        name = fake.name()
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False

        # Create account
        account = AccountService.create_account(
            email=email,
            name=name,
            interface_language="en-US",
            password=None,
        )

        # Link with new provider
        AccountService.link_account_integrate("new-google", "google_open_id_123", account)

        # Verify integration was created
        from extensions.ext_database import db
        from models import AccountIntegrate

        integration = db.session.query(AccountIntegrate).filter_by(account_id=account.id, provider="new-google").first()
        assert integration is not None
        assert integration.open_id == "google_open_id_123"

    def test_link_account_integrate_existing_provider(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test linking account with existing provider (should update).
        """
        fake = Faker()
        email = fake.email()
        name = fake.name()
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False

        # Create account
        account = AccountService.create_account(
            email=email,
            name=name,
            interface_language="en-US",
            password=None,
        )

        # Link with provider first time
        AccountService.link_account_integrate("exists-google", "google_open_id_123", account)

        # Link with same provider but different open_id (should update)
        AccountService.link_account_integrate("exists-google", "google_open_id_456", account)

        # Verify integration was updated
        from extensions.ext_database import db
        from models import AccountIntegrate

        integration = (
            db.session.query(AccountIntegrate).filter_by(account_id=account.id, provider="exists-google").first()
        )
        assert integration.open_id == "google_open_id_456"

    def test_close_account(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test closing an account.
        """
        fake = Faker()
        email = fake.email()
        name = fake.name()
        password = fake.password(length=12)
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False

        # Create account
        account = AccountService.create_account(
            email=email,
            name=name,
            interface_language="en-US",
            password=password,
        )

        # Close account
        AccountService.close_account(account)

        # Verify account status changed
        from extensions.ext_database import db

        db.session.refresh(account)
        assert account.status == AccountStatus.CLOSED

    def test_update_account_fields(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test updating account fields.
        """
        fake = Faker()
        email = fake.email()
        name = fake.name()
        password = fake.password(length=12)
        updated_name = fake.name()
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False

        # Create account
        account = AccountService.create_account(
            email=email,
            name=name,
            interface_language="en-US",
            password=password,
        )

        # Update account fields
        updated_account = AccountService.update_account(account, name=updated_name, interface_theme="dark")

        assert updated_account.name == updated_name
        assert updated_account.interface_theme == "dark"

    def test_update_account_invalid_field(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test updating account with invalid field.
        """
        fake = Faker()
        email = fake.email()
        name = fake.name()
        password = fake.password(length=12)
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False

        # Create account
        account = AccountService.create_account(
            email=email,
            name=name,
            interface_language="en-US",
            password=password,
        )

        with pytest.raises(AttributeError):
            AccountService.update_account(account, invalid_field="value")

    def test_update_login_info(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test updating login information.
        """
        fake = Faker()
        email = fake.email()
        name = fake.name()
        password = fake.password(length=12)
        ip_address = fake.ipv4()
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False

        # Create account
        account = AccountService.create_account(
            email=email,
            name=name,
            interface_language="en-US",
            password=password,
        )

        # Update login info
        AccountService.update_login_info(account, ip_address=ip_address)

        # Verify login info was updated
        from extensions.ext_database import db

        db.session.refresh(account)
        assert account.last_login_ip == ip_address
        assert account.last_login_at is not None

    def test_login_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful login with token generation.
        """
        fake = Faker()
        email = fake.email()
        name = fake.name()
        password = fake.password(length=12)
        ip_address = fake.ipv4()
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False
        mock_external_service_dependencies["passport_service"].return_value.issue.return_value = "mock_access_token"

        # Create account
        account = AccountService.create_account(
            email=email,
            name=name,
            interface_language="en-US",
            password=password,
        )

        # Login
        token_pair = AccountService.login(account, ip_address=ip_address)

        assert isinstance(token_pair, TokenPair)
        assert token_pair.access_token == "mock_access_token"
        assert token_pair.refresh_token is not None

        # Verify passport service was called with correct parameters
        mock_passport = mock_external_service_dependencies["passport_service"].return_value
        mock_passport.issue.assert_called_once()
        call_args = mock_passport.issue.call_args[0][0]
        assert call_args["user_id"] == account.id
        assert call_args["iss"] is not None
        assert call_args["sub"] == "Console API Passport"

    def test_login_pending_account_activation(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test login activates pending account.
        """
        fake = Faker()
        email = fake.email()
        name = fake.name()
        password = fake.password(length=12)
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False
        mock_external_service_dependencies["passport_service"].return_value.issue.return_value = "mock_access_token"

        # Create account with pending status
        account = AccountService.create_account(
            email=email,
            name=name,
            interface_language="en-US",
            password=password,
        )
        account.status = AccountStatus.PENDING
        from extensions.ext_database import db

        db.session.commit()

        # Login should activate the account
        token_pair = AccountService.login(account)

        db.session.refresh(account)
        assert account.status == AccountStatus.ACTIVE

    def test_logout(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test logout functionality.
        """
        fake = Faker()
        email = fake.email()
        name = fake.name()
        password = fake.password(length=12)
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False
        mock_external_service_dependencies["passport_service"].return_value.issue.return_value = "mock_access_token"

        # Create account
        account = AccountService.create_account(
            email=email,
            name=name,
            interface_language="en-US",
            password=password,
        )

        # Login first to get refresh token
        token_pair = AccountService.login(account)

        # Logout
        AccountService.logout(account=account)

        # Verify refresh token was deleted from Redis
        from extensions.ext_redis import redis_client

        refresh_token_key = f"account_refresh_token:{account.id}"
        assert redis_client.get(refresh_token_key) is None

    def test_refresh_token_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful token refresh.
        """
        fake = Faker()
        email = fake.email()
        name = fake.name()
        password = fake.password(length=12)
        tenant_name = fake.company()
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False
        mock_external_service_dependencies["passport_service"].return_value.issue.return_value = "new_mock_access_token"

        # Create account
        account = AccountService.create_account(
            email=email,
            name=name,
            interface_language="en-US",
            password=password,
        )
        # Create associated Tenant
        TenantService.create_owner_tenant_if_not_exist(account=account, name=tenant_name, is_setup=True)

        # Login to get initial tokens
        initial_token_pair = AccountService.login(account)

        # Refresh token
        new_token_pair = AccountService.refresh_token(initial_token_pair.refresh_token)

        assert isinstance(new_token_pair, TokenPair)
        assert new_token_pair.access_token == "new_mock_access_token"
        assert new_token_pair.refresh_token != initial_token_pair.refresh_token

    def test_refresh_token_invalid_token(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test refresh token with invalid token.
        """
        fake = Faker()
        invalid_token = fake.uuid4()
        with pytest.raises(ValueError, match="Invalid refresh token"):
            AccountService.refresh_token(invalid_token)

    def test_refresh_token_invalid_account(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test refresh token with valid token but invalid account.
        """
        fake = Faker()
        email = fake.email()
        name = fake.name()
        password = fake.password(length=12)
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False
        mock_external_service_dependencies["passport_service"].return_value.issue.return_value = "mock_access_token"

        # Create account
        account = AccountService.create_account(
            email=email,
            name=name,
            interface_language="en-US",
            password=password,
        )

        # Login to get tokens
        token_pair = AccountService.login(account)

        # Delete account
        from extensions.ext_database import db

        db.session.delete(account)
        db.session.commit()

        # Try to refresh token with deleted account
        with pytest.raises(ValueError, match="Invalid account"):
            AccountService.refresh_token(token_pair.refresh_token)

    def test_load_user_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test loading user by ID successfully.
        """
        fake = Faker()
        email = fake.email()
        name = fake.name()
        password = fake.password(length=12)
        tenant_name = fake.company()
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False

        # Create account
        account = AccountService.create_account(
            email=email,
            name=name,
            interface_language="en-US",
            password=password,
        )
        # Create associated Tenant
        TenantService.create_owner_tenant_if_not_exist(account=account, name=tenant_name, is_setup=True)

        # Load user
        loaded_user = AccountService.load_user(account.id)

        assert loaded_user is not None
        assert loaded_user.id == account.id
        assert loaded_user.email == account.email

    def test_load_user_not_found(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test loading non-existent user.
        """
        fake = Faker()
        non_existent_user_id = fake.uuid4()
        loaded_user = AccountService.load_user(non_existent_user_id)
        assert loaded_user is None

    def test_load_user_banned_account(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test loading banned user raises Unauthorized.
        """
        fake = Faker()
        email = fake.email()
        name = fake.name()
        password = fake.password(length=12)
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False

        # Create account
        account = AccountService.create_account(
            email=email,
            name=name,
            interface_language="en-US",
            password=password,
        )

        # Ban the account
        account.status = AccountStatus.BANNED
        from extensions.ext_database import db

        db.session.commit()

        with pytest.raises(Unauthorized):  # Unauthorized exception
            AccountService.load_user(account.id)

    def test_get_account_jwt_token(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test JWT token generation for account.
        """
        fake = Faker()
        email = fake.email()
        name = fake.name()
        password = fake.password(length=12)
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False
        mock_external_service_dependencies["passport_service"].return_value.issue.return_value = "mock_jwt_token"

        # Create account
        account = AccountService.create_account(
            email=email,
            name=name,
            interface_language="en-US",
            password=password,
        )

        # Generate JWT token
        token = AccountService.get_account_jwt_token(account)

        assert token == "mock_jwt_token"

        # Verify passport service was called with correct parameters
        mock_passport = mock_external_service_dependencies["passport_service"].return_value
        mock_passport.issue.assert_called_once()
        call_args = mock_passport.issue.call_args[0][0]
        assert call_args["user_id"] == account.id
        assert call_args["iss"] is not None
        assert call_args["sub"] == "Console API Passport"

    def test_load_logged_in_account(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test loading logged in account by ID.
        """
        fake = Faker()
        email = fake.email()
        name = fake.name()
        password = fake.password(length=12)
        tenant_name = fake.company()
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False

        # Create account
        account = AccountService.create_account(
            email=email,
            name=name,
            interface_language="en-US",
            password=password,
        )
        # Create associated Tenant
        TenantService.create_owner_tenant_if_not_exist(account=account, name=tenant_name, is_setup=True)

        # Load logged in account
        loaded_account = AccountService.load_logged_in_account(account_id=account.id)

        assert loaded_account is not None
        assert loaded_account.id == account.id

    def test_get_user_through_email_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test getting user through email successfully.
        """
        fake = Faker()
        email = fake.email()
        name = fake.name()
        password = fake.password(length=12)
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False

        # Create account
        account = AccountService.create_account(
            email=email,
            name=name,
            interface_language="en-US",
            password=password,
        )

        # Get user through email
        found_user = AccountService.get_user_through_email(email)

        assert found_user is not None
        assert found_user.id == account.id

    def test_get_user_through_email_not_found(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test getting user through non-existent email.
        """
        fake = Faker()
        domain = f"test-{fake.random_letters(10)}.com"
        non_existent_email = fake.email(domain=domain)
        found_user = AccountService.get_user_through_email(non_existent_email)
        assert found_user is None

    def test_get_user_through_email_banned_account(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test getting banned user through email raises Unauthorized.
        """
        fake = Faker()
        email = fake.email()
        name = fake.name()
        password = fake.password(length=12)
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False

        # Create account
        account = AccountService.create_account(
            email=email,
            name=name,
            interface_language="en-US",
            password=password,
        )

        # Ban the account
        account.status = AccountStatus.BANNED
        from extensions.ext_database import db

        db.session.commit()

        with pytest.raises(Unauthorized):  # Unauthorized exception
            AccountService.get_user_through_email(email)

    def test_get_user_through_email_in_freeze(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test getting user through email that is in freeze period.
        """
        fake = Faker()
        email_in_freeze = fake.email()
        # Setup mocks
        dify_config.BILLING_ENABLED = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = True

        with pytest.raises(AccountRegisterError):
            AccountService.get_user_through_email(email_in_freeze)

        # Reset config
        dify_config.BILLING_ENABLED = False

    def test_delete_account(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test account deletion (should add task to queue).
        """
        fake = Faker()
        email = fake.email()
        name = fake.name()
        password = fake.password(length=12)
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False

        # Create account
        account = AccountService.create_account(
            email=email,
            name=name,
            interface_language="en-US",
            password=password,
        )

        with patch("services.account_service.delete_account_task") as mock_delete_task:
            # Delete account
            AccountService.delete_account(account)

            # Verify task was added to queue
            mock_delete_task.delay.assert_called_once_with(account.id)

    def test_generate_account_deletion_verification_code(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test generating account deletion verification code.
        """
        fake = Faker()
        email = fake.email()
        name = fake.name()
        password = fake.password(length=12)
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False

        # Create account
        account = AccountService.create_account(
            email=email,
            name=name,
            interface_language="en-US",
            password=password,
        )

        # Generate verification code
        token, code = AccountService.generate_account_deletion_verification_code(account)

        assert token is not None
        assert code is not None
        assert len(code) == 6
        assert code.isdigit()

    def test_verify_account_deletion_code_valid(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test verifying valid account deletion code.
        """
        fake = Faker()
        email = fake.email()
        name = fake.name()
        password = fake.password(length=12)
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False

        # Create account
        account = AccountService.create_account(
            email=email,
            name=name,
            interface_language="en-US",
            password=password,
        )

        # Generate verification code
        token, code = AccountService.generate_account_deletion_verification_code(account)

        # Verify code
        is_valid = AccountService.verify_account_deletion_code(token, code)
        assert is_valid is True

    def test_verify_account_deletion_code_invalid(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test verifying invalid account deletion code.
        """
        fake = Faker()
        email = fake.email()
        name = fake.name()
        password = fake.password(length=12)
        wrong_code = fake.numerify(text="######")
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False

        # Create account
        account = AccountService.create_account(
            email=email,
            name=name,
            interface_language="en-US",
            password=password,
        )

        # Generate verification code
        token, code = AccountService.generate_account_deletion_verification_code(account)

        # Verify with wrong code
        is_valid = AccountService.verify_account_deletion_code(token, wrong_code)
        assert is_valid is False

    def test_verify_account_deletion_code_invalid_token(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test verifying account deletion code with invalid token.
        """
        fake = Faker()
        invalid_token = fake.uuid4()
        invalid_code = fake.numerify(text="######")
        is_valid = AccountService.verify_account_deletion_code(invalid_token, invalid_code)
        assert is_valid is False


class TestTenantService:
    """Integration tests for TenantService using testcontainers."""

    @pytest.fixture
    def mock_external_service_dependencies(self):
        """Mock setup for external service dependencies."""
        with (
            patch("services.account_service.FeatureService") as mock_feature_service,
            patch("services.account_service.BillingService") as mock_billing_service,
        ):
            # Setup default mock returns
            mock_feature_service.get_system_features.return_value.is_allow_create_workspace = True
            mock_feature_service.get_system_features.return_value.license.workspaces.is_available.return_value = True
            mock_billing_service.is_email_in_freeze.return_value = False

            yield {
                "feature_service": mock_feature_service,
                "billing_service": mock_billing_service,
            }

    def test_create_tenant_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful tenant creation with default settings.
        """
        fake = Faker()
        tenant_name = fake.company()
        # Setup mocks
        mock_external_service_dependencies[
            "feature_service"
        ].get_system_features.return_value.is_allow_create_workspace = True

        # Create tenant
        tenant = TenantService.create_tenant(name=tenant_name)

        assert tenant.name == tenant_name
        assert tenant.plan == "basic"
        assert tenant.status == "normal"
        assert tenant.encrypt_public_key is not None

    def test_create_tenant_workspace_creation_disabled(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test tenant creation when workspace creation is disabled.
        """
        fake = Faker()
        tenant_name = fake.company()
        # Setup mocks to disable workspace creation
        mock_external_service_dependencies[
            "feature_service"
        ].get_system_features.return_value.is_allow_create_workspace = False

        with pytest.raises(NotAllowedCreateWorkspace):  # NotAllowedCreateWorkspace exception
            TenantService.create_tenant(name=tenant_name)

    def test_create_tenant_with_custom_name(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test tenant creation with custom name and setup flag.
        """
        fake = Faker()
        custom_tenant_name = fake.company()
        # Setup mocks
        mock_external_service_dependencies[
            "feature_service"
        ].get_system_features.return_value.is_allow_create_workspace = False

        # Create tenant with setup flag (should bypass workspace creation restriction)
        tenant = TenantService.create_tenant(name=custom_tenant_name, is_setup=True, is_from_dashboard=True)

        assert tenant.name == custom_tenant_name
        assert tenant.plan == "basic"
        assert tenant.status == "normal"
        assert tenant.encrypt_public_key is not None

    def test_create_tenant_member_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful tenant member creation.
        """
        fake = Faker()
        tenant_name = fake.company()
        email = fake.email()
        name = fake.name()
        password = fake.password(length=12)
        # Setup mocks
        mock_external_service_dependencies[
            "feature_service"
        ].get_system_features.return_value.is_allow_create_workspace = True

        # Create tenant and account
        tenant = TenantService.create_tenant(name=tenant_name)
        account = AccountService.create_account(
            email=email,
            name=name,
            interface_language="en-US",
            password=password,
        )

        # Create tenant member
        tenant_member = TenantService.create_tenant_member(tenant, account, role="admin")

        assert tenant_member.tenant_id == tenant.id
        assert tenant_member.account_id == account.id
        assert tenant_member.role == "admin"

    def test_create_tenant_member_duplicate_owner(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test creating duplicate owner for a tenant (should fail).
        """
        fake = Faker()
        tenant_name = fake.company()
        email1 = fake.email()
        name1 = fake.name()
        password1 = fake.password(length=12)
        email2 = fake.email()
        name2 = fake.name()
        password2 = fake.password(length=12)
        # Setup mocks
        mock_external_service_dependencies[
            "feature_service"
        ].get_system_features.return_value.is_allow_create_workspace = True

        # Create tenant and accounts
        tenant = TenantService.create_tenant(name=tenant_name)
        account1 = AccountService.create_account(
            email=email1,
            name=name1,
            interface_language="en-US",
            password=password1,
        )
        account2 = AccountService.create_account(
            email=email2,
            name=name2,
            interface_language="en-US",
            password=password2,
        )

        # Create first owner
        TenantService.create_tenant_member(tenant, account1, role="owner")

        # Try to create second owner (should fail)
        with pytest.raises(Exception, match="Tenant already has an owner"):
            TenantService.create_tenant_member(tenant, account2, role="owner")

    def test_create_tenant_member_existing_member(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test updating role for existing tenant member.
        """
        fake = Faker()
        tenant_name = fake.company()
        email = fake.email()
        name = fake.name()
        password = fake.password(length=12)
        # Setup mocks
        mock_external_service_dependencies[
            "feature_service"
        ].get_system_features.return_value.is_allow_create_workspace = True

        # Create tenant and account
        tenant = TenantService.create_tenant(name=tenant_name)
        account = AccountService.create_account(
            email=email,
            name=name,
            interface_language="en-US",
            password=password,
        )

        # Create member with initial role
        tenant_member1 = TenantService.create_tenant_member(tenant, account, role="normal")
        assert tenant_member1.role == "normal"

        # Update member role
        tenant_member2 = TenantService.create_tenant_member(tenant, account, role="editor")
        assert tenant_member2.tenant_id == tenant_member1.tenant_id
        assert tenant_member2.account_id == tenant_member1.account_id
        assert tenant_member2.role == "editor"

    def test_get_join_tenants_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test getting join tenants for an account.
        """
        fake = Faker()
        email = fake.email()
        name = fake.name()
        password = fake.password(length=12)
        tenant1_name = fake.company()
        tenant2_name = fake.company()
        # Setup mocks
        mock_external_service_dependencies[
            "feature_service"
        ].get_system_features.return_value.is_allow_create_workspace = True

        # Create account and tenants
        account = AccountService.create_account(
            email=email,
            name=name,
            interface_language="en-US",
            password=password,
        )
        tenant1 = TenantService.create_tenant(name=tenant1_name)
        tenant2 = TenantService.create_tenant(name=tenant2_name)

        # Add account to both tenants
        TenantService.create_tenant_member(tenant1, account, role="normal")
        TenantService.create_tenant_member(tenant2, account, role="admin")

        # Get join tenants
        join_tenants = TenantService.get_join_tenants(account)

        assert len(join_tenants) == 2
        tenant_names = [tenant.name for tenant in join_tenants]
        assert tenant1_name in tenant_names
        assert tenant2_name in tenant_names

    def test_get_current_tenant_by_account_success(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test getting current tenant by account successfully.
        """
        fake = Faker()
        email = fake.email()
        name = fake.name()
        password = fake.password(length=12)
        tenant_name = fake.company()
        # Setup mocks
        mock_external_service_dependencies[
            "feature_service"
        ].get_system_features.return_value.is_allow_create_workspace = True

        # Create account and tenant
        account = AccountService.create_account(
            email=email,
            name=name,
            interface_language="en-US",
            password=password,
        )
        tenant = TenantService.create_tenant(name=tenant_name)

        # Add account to tenant and set as current
        TenantService.create_tenant_member(tenant, account, role="owner")
        account.current_tenant = tenant
        from extensions.ext_database import db

        db.session.commit()

        # Get current tenant
        current_tenant = TenantService.get_current_tenant_by_account(account)

        assert current_tenant.id == tenant.id
        assert current_tenant.name == tenant.name
        assert current_tenant.role == "owner"

    def test_get_current_tenant_by_account_not_found(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test getting current tenant when account has no current tenant.
        """
        fake = Faker()
        email = fake.email()
        name = fake.name()
        password = fake.password(length=12)
        # Setup mocks
        mock_external_service_dependencies[
            "feature_service"
        ].get_system_features.return_value.is_allow_create_workspace = True

        # Create account without setting current tenant
        account = AccountService.create_account(
            email=email,
            name=name,
            interface_language="en-US",
            password=password,
        )

        # Try to get current tenant (should fail)
        with pytest.raises((AttributeError, TenantNotFoundError)):
            TenantService.get_current_tenant_by_account(account)

    def test_switch_tenant_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful tenant switching.
        """
        fake = Faker()
        email = fake.email()
        name = fake.name()
        password = fake.password(length=12)
        tenant1_name = fake.company()
        tenant2_name = fake.company()
        # Setup mocks
        mock_external_service_dependencies[
            "feature_service"
        ].get_system_features.return_value.is_allow_create_workspace = True

        # Create account and tenants
        account = AccountService.create_account(
            email=email,
            name=name,
            interface_language="en-US",
            password=password,
        )
        tenant1 = TenantService.create_tenant(name=tenant1_name)
        tenant2 = TenantService.create_tenant(name=tenant2_name)

        # Add account to both tenants
        TenantService.create_tenant_member(tenant1, account, role="owner")
        TenantService.create_tenant_member(tenant2, account, role="admin")

        # Set initial current tenant
        account.current_tenant = tenant1
        from extensions.ext_database import db

        db.session.commit()

        # Switch to second tenant
        TenantService.switch_tenant(account, tenant2.id)

        # Verify tenant was switched
        db.session.refresh(account)
        assert account.current_tenant_id == tenant2.id

    def test_switch_tenant_no_tenant_id(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test tenant switching without providing tenant ID.
        """
        fake = Faker()
        email = fake.email()
        name = fake.name()
        password = fake.password(length=12)
        # Setup mocks
        mock_external_service_dependencies[
            "feature_service"
        ].get_system_features.return_value.is_allow_create_workspace = True

        # Create account
        account = AccountService.create_account(
            email=email,
            name=name,
            interface_language="en-US",
            password=password,
        )

        # Try to switch tenant without providing tenant ID
        with pytest.raises(ValueError, match="Tenant ID must be provided"):
            TenantService.switch_tenant(account, None)

    def test_switch_tenant_account_not_member(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test switching to a tenant where account is not a member.
        """
        fake = Faker()
        email = fake.email()
        name = fake.name()
        password = fake.password(length=12)
        tenant_name = fake.company()
        # Setup mocks
        mock_external_service_dependencies[
            "feature_service"
        ].get_system_features.return_value.is_allow_create_workspace = True

        # Create account and tenant
        account = AccountService.create_account(
            email=email,
            name=name,
            interface_language="en-US",
            password=password,
        )
        tenant = TenantService.create_tenant(name=tenant_name)

        # Try to switch to tenant where account is not a member
        with pytest.raises(Exception, match="Tenant not found or account is not a member of the tenant"):
            TenantService.switch_tenant(account, tenant.id)

    def test_has_roles_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test checking if tenant has specific roles.
        """
        fake = Faker()
        tenant_name = fake.company()
        owner_email = fake.email()
        owner_name = fake.name()
        owner_password = fake.password(length=12)
        admin_email = fake.email()
        admin_name = fake.name()
        admin_password = fake.password(length=12)
        # Setup mocks
        mock_external_service_dependencies[
            "feature_service"
        ].get_system_features.return_value.is_allow_create_workspace = True

        # Create tenant and accounts
        tenant = TenantService.create_tenant(name=tenant_name)
        owner_account = AccountService.create_account(
            email=owner_email,
            name=owner_name,
            interface_language="en-US",
            password=owner_password,
        )
        admin_account = AccountService.create_account(
            email=admin_email,
            name=admin_name,
            interface_language="en-US",
            password=admin_password,
        )

        # Add members with different roles
        TenantService.create_tenant_member(tenant, owner_account, role="owner")
        TenantService.create_tenant_member(tenant, admin_account, role="admin")

        # Check if tenant has owner role
        from models.account import TenantAccountRole

        has_owner = TenantService.has_roles(tenant, [TenantAccountRole.OWNER])
        assert has_owner is True

        # Check if tenant has admin role
        has_admin = TenantService.has_roles(tenant, [TenantAccountRole.ADMIN])
        assert has_admin is True

        # Check if tenant has normal role (should be False)
        has_normal = TenantService.has_roles(tenant, [TenantAccountRole.NORMAL])
        assert has_normal is False

    def test_has_roles_invalid_role_type(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test checking roles with invalid role type.
        """
        fake = Faker()
        tenant_name = fake.company()
        invalid_role = fake.word()
        # Setup mocks
        mock_external_service_dependencies[
            "feature_service"
        ].get_system_features.return_value.is_allow_create_workspace = True

        # Create tenant
        tenant = TenantService.create_tenant(name=tenant_name)

        # Try to check roles with invalid role type
        with pytest.raises(ValueError, match="all roles must be TenantAccountRole"):
            TenantService.has_roles(tenant, [invalid_role])

    def test_get_user_role_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test getting user role in a tenant.
        """
        fake = Faker()
        tenant_name = fake.company()
        email = fake.email()
        name = fake.name()
        password = fake.password(length=12)
        # Setup mocks
        mock_external_service_dependencies[
            "feature_service"
        ].get_system_features.return_value.is_allow_create_workspace = True

        # Create tenant and account
        tenant = TenantService.create_tenant(name=tenant_name)
        account = AccountService.create_account(
            email=email,
            name=name,
            interface_language="en-US",
            password=password,
        )

        # Add account to tenant with specific role
        TenantService.create_tenant_member(tenant, account, role="editor")

        # Get user role
        user_role = TenantService.get_user_role(account, tenant)

        assert user_role == "editor"

    def test_check_member_permission_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test checking member permission successfully.
        """
        fake = Faker()
        tenant_name = fake.company()
        owner_email = fake.email()
        owner_name = fake.name()
        owner_password = fake.password(length=12)
        member_email = fake.email()
        member_name = fake.name()
        member_password = fake.password(length=12)
        # Setup mocks
        mock_external_service_dependencies[
            "feature_service"
        ].get_system_features.return_value.is_allow_create_workspace = True

        # Create tenant and accounts
        tenant = TenantService.create_tenant(name=tenant_name)
        owner_account = AccountService.create_account(
            email=owner_email,
            name=owner_name,
            interface_language="en-US",
            password=owner_password,
        )
        member_account = AccountService.create_account(
            email=member_email,
            name=member_name,
            interface_language="en-US",
            password=member_password,
        )

        # Add members with different roles
        TenantService.create_tenant_member(tenant, owner_account, role="owner")
        TenantService.create_tenant_member(tenant, member_account, role="normal")

        # Check owner permission to add member (should succeed)
        TenantService.check_member_permission(tenant, owner_account, member_account, "add")

    def test_check_member_permission_invalid_action(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test checking member permission with invalid action.
        """
        fake = Faker()
        tenant_name = fake.company()
        email = fake.email()
        name = fake.name()
        password = fake.password(length=12)
        invalid_action = "invalid_action_that_doesnt_exist"
        # Setup mocks
        mock_external_service_dependencies[
            "feature_service"
        ].get_system_features.return_value.is_allow_create_workspace = True

        # Create tenant and account
        tenant = TenantService.create_tenant(name=tenant_name)
        account = AccountService.create_account(
            email=email,
            name=name,
            interface_language="en-US",
            password=password,
        )

        # Add account to tenant
        TenantService.create_tenant_member(tenant, account, role="owner")

        # Try to check permission with invalid action
        with pytest.raises(Exception, match="Invalid action"):
            TenantService.check_member_permission(tenant, account, None, invalid_action)

    def test_check_member_permission_operate_self(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test checking member permission when trying to operate self.
        """
        fake = Faker()
        tenant_name = fake.company()
        email = fake.email()
        name = fake.name()
        password = fake.password(length=12)
        # Setup mocks
        mock_external_service_dependencies[
            "feature_service"
        ].get_system_features.return_value.is_allow_create_workspace = True

        # Create tenant and account
        tenant = TenantService.create_tenant(name=tenant_name)
        account = AccountService.create_account(
            email=email,
            name=name,
            interface_language="en-US",
            password=password,
        )

        # Add account to tenant
        TenantService.create_tenant_member(tenant, account, role="owner")

        # Try to check permission to operate self
        with pytest.raises(Exception, match="Cannot operate self"):
            TenantService.check_member_permission(tenant, account, account, "remove")

    def test_remove_member_from_tenant_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful member removal from tenant.
        """
        fake = Faker()
        tenant_name = fake.company()
        owner_email = fake.email()
        owner_name = fake.name()
        owner_password = fake.password(length=12)
        member_email = fake.email()
        member_name = fake.name()
        member_password = fake.password(length=12)
        # Setup mocks
        mock_external_service_dependencies[
            "feature_service"
        ].get_system_features.return_value.is_allow_create_workspace = True

        # Create tenant and accounts
        tenant = TenantService.create_tenant(name=tenant_name)
        owner_account = AccountService.create_account(
            email=owner_email,
            name=owner_name,
            interface_language="en-US",
            password=owner_password,
        )
        member_account = AccountService.create_account(
            email=member_email,
            name=member_name,
            interface_language="en-US",
            password=member_password,
        )

        # Add members with different roles
        TenantService.create_tenant_member(tenant, owner_account, role="owner")
        TenantService.create_tenant_member(tenant, member_account, role="normal")

        # Remove member
        TenantService.remove_member_from_tenant(tenant, member_account, owner_account)

        # Verify member was removed
        from extensions.ext_database import db
        from models.account import TenantAccountJoin

        member_join = (
            db.session.query(TenantAccountJoin).filter_by(tenant_id=tenant.id, account_id=member_account.id).first()
        )
        assert member_join is None

    def test_remove_member_from_tenant_operate_self(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test removing member when trying to operate self.
        """
        fake = Faker()
        tenant_name = fake.company()
        email = fake.email()
        name = fake.name()
        password = fake.password(length=12)
        # Setup mocks
        mock_external_service_dependencies[
            "feature_service"
        ].get_system_features.return_value.is_allow_create_workspace = True

        # Create tenant and account
        tenant = TenantService.create_tenant(name=tenant_name)
        account = AccountService.create_account(
            email=email,
            name=name,
            interface_language="en-US",
            password=password,
        )

        # Add account to tenant
        TenantService.create_tenant_member(tenant, account, role="owner")

        # Try to remove self
        with pytest.raises(Exception, match="Cannot operate self"):
            TenantService.remove_member_from_tenant(tenant, account, account)

    def test_remove_member_from_tenant_not_member(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test removing member who is not in the tenant.
        """
        fake = Faker()
        tenant_name = fake.company()
        owner_email = fake.email()
        owner_name = fake.name()
        owner_password = fake.password(length=12)
        non_member_email = fake.email()
        non_member_name = fake.name()
        non_member_password = fake.password(length=12)
        # Setup mocks
        mock_external_service_dependencies[
            "feature_service"
        ].get_system_features.return_value.is_allow_create_workspace = True

        # Create tenant and accounts
        tenant = TenantService.create_tenant(name=tenant_name)
        owner_account = AccountService.create_account(
            email=owner_email,
            name=owner_name,
            interface_language="en-US",
            password=owner_password,
        )
        non_member_account = AccountService.create_account(
            email=non_member_email,
            name=non_member_name,
            interface_language="en-US",
            password=non_member_password,
        )

        # Add only owner to tenant
        TenantService.create_tenant_member(tenant, owner_account, role="owner")

        # Try to remove non-member
        with pytest.raises(Exception, match="Member not in tenant"):
            TenantService.remove_member_from_tenant(tenant, non_member_account, owner_account)

    def test_update_member_role_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful member role update.
        """
        fake = Faker()
        tenant_name = fake.company()
        owner_email = fake.email()
        owner_name = fake.name()
        owner_password = fake.password(length=12)
        member_email = fake.email()
        member_name = fake.name()
        member_password = fake.password(length=12)
        # Setup mocks
        mock_external_service_dependencies[
            "feature_service"
        ].get_system_features.return_value.is_allow_create_workspace = True

        # Create tenant and accounts
        tenant = TenantService.create_tenant(name=tenant_name)
        owner_account = AccountService.create_account(
            email=owner_email,
            name=owner_name,
            interface_language="en-US",
            password=owner_password,
        )
        member_account = AccountService.create_account(
            email=member_email,
            name=member_name,
            interface_language="en-US",
            password=member_password,
        )

        # Add members with different roles
        TenantService.create_tenant_member(tenant, owner_account, role="owner")
        TenantService.create_tenant_member(tenant, member_account, role="normal")

        # Update member role
        TenantService.update_member_role(tenant, member_account, "admin", owner_account)

        # Verify role was updated
        from extensions.ext_database import db
        from models.account import TenantAccountJoin

        member_join = (
            db.session.query(TenantAccountJoin).filter_by(tenant_id=tenant.id, account_id=member_account.id).first()
        )
        assert member_join.role == "admin"

    def test_update_member_role_to_owner(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test updating member role to owner (should change current owner to admin).
        """
        fake = Faker()
        tenant_name = fake.company()
        owner_email = fake.email()
        owner_name = fake.name()
        owner_password = fake.password(length=12)
        member_email = fake.email()
        member_name = fake.name()
        member_password = fake.password(length=12)
        # Setup mocks
        mock_external_service_dependencies[
            "feature_service"
        ].get_system_features.return_value.is_allow_create_workspace = True

        # Create tenant and accounts
        tenant = TenantService.create_tenant(name=tenant_name)
        owner_account = AccountService.create_account(
            email=owner_email,
            name=owner_name,
            interface_language="en-US",
            password=owner_password,
        )
        member_account = AccountService.create_account(
            email=member_email,
            name=member_name,
            interface_language="en-US",
            password=member_password,
        )

        # Add members with different roles
        TenantService.create_tenant_member(tenant, owner_account, role="owner")
        TenantService.create_tenant_member(tenant, member_account, role="admin")

        # Update member role to owner
        TenantService.update_member_role(tenant, member_account, "owner", owner_account)

        # Verify roles were updated correctly
        from extensions.ext_database import db
        from models.account import TenantAccountJoin

        owner_join = (
            db.session.query(TenantAccountJoin).filter_by(tenant_id=tenant.id, account_id=owner_account.id).first()
        )
        member_join = (
            db.session.query(TenantAccountJoin).filter_by(tenant_id=tenant.id, account_id=member_account.id).first()
        )
        assert owner_join.role == "admin"
        assert member_join.role == "owner"

    def test_update_member_role_already_assigned(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test updating member role to already assigned role.
        """
        fake = Faker()
        tenant_name = fake.company()
        owner_email = fake.email()
        owner_name = fake.name()
        owner_password = fake.password(length=12)
        member_email = fake.email()
        member_name = fake.name()
        member_password = fake.password(length=12)
        # Setup mocks
        mock_external_service_dependencies[
            "feature_service"
        ].get_system_features.return_value.is_allow_create_workspace = True

        # Create tenant and accounts
        tenant = TenantService.create_tenant(name=tenant_name)
        owner_account = AccountService.create_account(
            email=owner_email,
            name=owner_name,
            interface_language="en-US",
            password=owner_password,
        )
        member_account = AccountService.create_account(
            email=member_email,
            name=member_name,
            interface_language="en-US",
            password=member_password,
        )

        # Add members with different roles
        TenantService.create_tenant_member(tenant, owner_account, role="owner")
        TenantService.create_tenant_member(tenant, member_account, role="admin")

        # Try to update member role to already assigned role
        with pytest.raises(Exception, match="The provided role is already assigned to the member"):
            TenantService.update_member_role(tenant, member_account, "admin", owner_account)

    def test_get_tenant_count_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test getting tenant count successfully.
        """
        fake = Faker()
        tenant1_name = fake.company()
        tenant2_name = fake.company()
        tenant3_name = fake.company()
        # Setup mocks
        mock_external_service_dependencies[
            "feature_service"
        ].get_system_features.return_value.is_allow_create_workspace = True

        # Create multiple tenants
        tenant1 = TenantService.create_tenant(name=tenant1_name)
        tenant2 = TenantService.create_tenant(name=tenant2_name)
        tenant3 = TenantService.create_tenant(name=tenant3_name)

        # Get tenant count
        tenant_count = TenantService.get_tenant_count()

        # Should have at least 3 tenants (may be more from other tests)
        assert tenant_count >= 3

    def test_create_owner_tenant_if_not_exist_new_user(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test creating owner tenant for new user without existing tenants.
        """
        fake = Faker()
        email = fake.email()
        name = fake.name()
        password = fake.password(length=12)
        workspace_name = fake.company()
        # Setup mocks
        mock_external_service_dependencies[
            "feature_service"
        ].get_system_features.return_value.is_allow_create_workspace = True
        mock_external_service_dependencies[
            "feature_service"
        ].get_system_features.return_value.license.workspaces.is_available.return_value = True

        # Create account
        account = AccountService.create_account(
            email=email,
            name=name,
            interface_language="en-US",
            password=password,
        )

        # Create owner tenant
        TenantService.create_owner_tenant_if_not_exist(account, name=workspace_name)

        # Verify tenant was created and linked
        from extensions.ext_database import db
        from models.account import TenantAccountJoin

        tenant_join = db.session.query(TenantAccountJoin).filter_by(account_id=account.id).first()
        assert tenant_join is not None
        assert tenant_join.role == "owner"
        assert account.current_tenant is not None
        assert account.current_tenant.name == workspace_name

    def test_create_owner_tenant_if_not_exist_existing_tenant(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test creating owner tenant when user already has a tenant.
        """
        fake = Faker()
        email = fake.email()
        name = fake.name()
        password = fake.password(length=12)
        existing_tenant_name = fake.company()
        new_workspace_name = fake.company()
        # Setup mocks
        mock_external_service_dependencies[
            "feature_service"
        ].get_system_features.return_value.is_allow_create_workspace = True
        mock_external_service_dependencies[
            "feature_service"
        ].get_system_features.return_value.license.workspaces.is_available.return_value = True

        # Create account and existing tenant
        account = AccountService.create_account(
            email=email,
            name=name,
            interface_language="en-US",
            password=password,
        )
        existing_tenant = TenantService.create_tenant(name=existing_tenant_name)
        TenantService.create_tenant_member(existing_tenant, account, role="owner")
        account.current_tenant = existing_tenant
        from extensions.ext_database import db

        db.session.commit()

        # Try to create owner tenant again (should not create new one)
        TenantService.create_owner_tenant_if_not_exist(account, name=new_workspace_name)

        # Verify no new tenant was created
        tenant_joins = db.session.query(TenantAccountJoin).filter_by(account_id=account.id).all()
        assert len(tenant_joins) == 1
        assert account.current_tenant.id == existing_tenant.id

    def test_create_owner_tenant_if_not_exist_workspace_disabled(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test creating owner tenant when workspace creation is disabled.
        """
        fake = Faker()
        email = fake.email()
        name = fake.name()
        password = fake.password(length=12)
        workspace_name = fake.company()
        # Setup mocks to disable workspace creation
        mock_external_service_dependencies[
            "feature_service"
        ].get_system_features.return_value.is_allow_create_workspace = False

        # Create account
        account = AccountService.create_account(
            email=email,
            name=name,
            interface_language="en-US",
            password=password,
        )

        # Try to create owner tenant (should fail)
        with pytest.raises(WorkSpaceNotAllowedCreateError):  # WorkSpaceNotAllowedCreateError exception
            TenantService.create_owner_tenant_if_not_exist(account, name=workspace_name)

    def test_get_tenant_members_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test getting tenant members successfully.
        """
        fake = Faker()
        tenant_name = fake.company()
        owner_email = fake.email()
        owner_name = fake.name()
        owner_password = fake.password(length=12)
        admin_email = fake.email()
        admin_name = fake.name()
        admin_password = fake.password(length=12)
        normal_email = fake.email()
        normal_name = fake.name()
        normal_password = fake.password(length=12)
        # Setup mocks
        mock_external_service_dependencies[
            "feature_service"
        ].get_system_features.return_value.is_allow_create_workspace = True

        # Create tenant and accounts
        tenant = TenantService.create_tenant(name=tenant_name)
        owner_account = AccountService.create_account(
            email=owner_email,
            name=owner_name,
            interface_language="en-US",
            password=owner_password,
        )
        admin_account = AccountService.create_account(
            email=admin_email,
            name=admin_name,
            interface_language="en-US",
            password=admin_password,
        )
        normal_account = AccountService.create_account(
            email=normal_email,
            name=normal_name,
            interface_language="en-US",
            password=normal_password,
        )

        # Add members with different roles
        TenantService.create_tenant_member(tenant, owner_account, role="owner")
        TenantService.create_tenant_member(tenant, admin_account, role="admin")
        TenantService.create_tenant_member(tenant, normal_account, role="normal")

        # Get tenant members
        members = TenantService.get_tenant_members(tenant)

        assert len(members) == 3
        member_emails = [member.email for member in members]
        assert owner_email in member_emails
        assert admin_email in member_emails
        assert normal_email in member_emails

        # Verify roles are set correctly
        for member in members:
            if member.email == owner_email:
                assert member.role == "owner"
            elif member.email == admin_email:
                assert member.role == "admin"
            elif member.email == normal_email:
                assert member.role == "normal"

    def test_get_dataset_operator_members_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test getting dataset operator members successfully.
        """
        fake = Faker()
        tenant_name = fake.company()
        owner_email = fake.email()
        owner_name = fake.name()
        owner_password = fake.password(length=12)
        operator_email = fake.email()
        operator_name = fake.name()
        operator_password = fake.password(length=12)
        normal_email = fake.email()
        normal_name = fake.name()
        normal_password = fake.password(length=12)
        # Setup mocks
        mock_external_service_dependencies[
            "feature_service"
        ].get_system_features.return_value.is_allow_create_workspace = True

        # Create tenant and accounts
        tenant = TenantService.create_tenant(name=tenant_name)
        owner_account = AccountService.create_account(
            email=owner_email,
            name=owner_name,
            interface_language="en-US",
            password=owner_password,
        )
        dataset_operator_account = AccountService.create_account(
            email=operator_email,
            name=operator_name,
            interface_language="en-US",
            password=operator_password,
        )
        normal_account = AccountService.create_account(
            email=normal_email,
            name=normal_name,
            interface_language="en-US",
            password=normal_password,
        )

        # Add members with different roles
        TenantService.create_tenant_member(tenant, owner_account, role="owner")
        TenantService.create_tenant_member(tenant, dataset_operator_account, role="dataset_operator")
        TenantService.create_tenant_member(tenant, normal_account, role="normal")

        # Get dataset operator members
        dataset_operators = TenantService.get_dataset_operator_members(tenant)

        assert len(dataset_operators) == 1
        assert dataset_operators[0].email == operator_email
        assert dataset_operators[0].role == "dataset_operator"

    def test_get_custom_config_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test getting custom config successfully.
        """
        fake = Faker()
        tenant_name = fake.company()
        theme = fake.random_element(elements=("dark", "light"))
        language = fake.random_element(elements=("zh-CN", "en-US"))
        # Setup mocks
        mock_external_service_dependencies[
            "feature_service"
        ].get_system_features.return_value.is_allow_create_workspace = True

        # Create tenant with custom config
        tenant = TenantService.create_tenant(name=tenant_name)

        # Set custom config
        custom_config = {"theme": theme, "language": language, "feature_flags": {"beta": True}}
        tenant.custom_config_dict = custom_config
        from extensions.ext_database import db

        db.session.commit()

        # Get custom config
        retrieved_config = TenantService.get_custom_config(tenant.id)

        assert retrieved_config == custom_config
        assert retrieved_config["theme"] == theme
        assert retrieved_config["language"] == language
        assert retrieved_config["feature_flags"]["beta"] is True


class TestRegisterService:
    """Integration tests for RegisterService using testcontainers."""

    @pytest.fixture
    def mock_external_service_dependencies(self):
        """Mock setup for external service dependencies."""
        with (
            patch("services.account_service.FeatureService") as mock_feature_service,
            patch("services.account_service.BillingService") as mock_billing_service,
            patch("services.account_service.PassportService") as mock_passport_service,
        ):
            # Setup default mock returns
            mock_feature_service.get_system_features.return_value.is_allow_register = True
            mock_feature_service.get_system_features.return_value.is_allow_create_workspace = True
            mock_feature_service.get_system_features.return_value.license.workspaces.is_available.return_value = True
            mock_billing_service.is_email_in_freeze.return_value = False
            mock_passport_service.return_value.issue.return_value = "mock_jwt_token"

            yield {
                "feature_service": mock_feature_service,
                "billing_service": mock_billing_service,
                "passport_service": mock_passport_service,
            }

    def test_setup_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful system setup with account creation and tenant setup.
        """
        fake = Faker()
        admin_email = fake.email()
        admin_name = fake.name()
        admin_password = fake.password(length=12)
        ip_address = fake.ipv4()
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False

        # Execute setup
        RegisterService.setup(
            email=admin_email,
            name=admin_name,
            password=admin_password,
            ip_address=ip_address,
            language="en-US",
        )

        # Verify account was created
        from extensions.ext_database import db
        from models import Account
        from models.model import DifySetup

        account = db.session.query(Account).filter_by(email=admin_email).first()
        assert account is not None
        assert account.name == admin_name
        assert account.last_login_ip == ip_address
        assert account.initialized_at is not None
        assert account.status == "active"

        # Verify DifySetup was created
        dify_setup = db.session.query(DifySetup).first()
        assert dify_setup is not None

        # Verify tenant was created and linked
        from models.account import TenantAccountJoin

        tenant_join = db.session.query(TenantAccountJoin).filter_by(account_id=account.id).first()
        assert tenant_join is not None
        assert tenant_join.role == "owner"

    def test_setup_failure_rollback(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test setup failure with proper rollback of all created entities.
        """
        fake = Faker()
        admin_email = fake.email()
        admin_name = fake.name()
        admin_password = fake.password(length=12)
        ip_address = fake.ipv4()
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False

        # Mock AccountService.create_account to raise exception
        with patch("services.account_service.AccountService.create_account") as mock_create_account:
            mock_create_account.side_effect = Exception("Database error")

            # Execute setup and verify exception
            with pytest.raises(ValueError, match="Setup failed: Database error"):
                RegisterService.setup(
                    email=admin_email,
                    name=admin_name,
                    password=admin_password,
                    ip_address=ip_address,
                    language="en-US",
                )

            # Verify no entities were created (rollback worked)
            from extensions.ext_database import db
            from models import Account, Tenant, TenantAccountJoin
            from models.model import DifySetup

            account = db.session.query(Account).filter_by(email=admin_email).first()
            tenant_count = db.session.query(Tenant).count()
            tenant_join_count = db.session.query(TenantAccountJoin).count()
            dify_setup_count = db.session.query(DifySetup).count()

            assert account is None
            assert tenant_count == 0
            assert tenant_join_count == 0
            assert dify_setup_count == 0

    def test_register_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful account registration with workspace creation.
        """
        fake = Faker()
        email = fake.email()
        name = fake.name()
        password = fake.password(length=12)
        language = fake.random_element(elements=("en-US", "zh-CN"))
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies[
            "feature_service"
        ].get_system_features.return_value.is_allow_create_workspace = True
        mock_external_service_dependencies[
            "feature_service"
        ].get_system_features.return_value.license.workspaces.is_available.return_value = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False

        # Execute registration
        account = RegisterService.register(
            email=email,
            name=name,
            password=password,
            language=language,
        )

        # Verify account was created
        assert account.email == email
        assert account.name == name
        assert account.status == "active"
        assert account.initialized_at is not None

        # Verify tenant was created and linked
        from extensions.ext_database import db
        from models.account import TenantAccountJoin

        tenant_join = db.session.query(TenantAccountJoin).filter_by(account_id=account.id).first()
        assert tenant_join is not None
        assert tenant_join.role == "owner"
        assert account.current_tenant is not None
        assert account.current_tenant.name == f"{name}'s Workspace"

    def test_register_with_oauth(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test account registration with OAuth integration.
        """
        fake = Faker()
        email = fake.email()
        name = fake.name()
        open_id = fake.uuid4()
        provider = fake.random_element(elements=("google", "github", "microsoft"))
        language = fake.random_element(elements=("en-US", "zh-CN"))
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies[
            "feature_service"
        ].get_system_features.return_value.is_allow_create_workspace = True
        mock_external_service_dependencies[
            "feature_service"
        ].get_system_features.return_value.license.workspaces.is_available.return_value = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False

        # Execute registration with OAuth
        account = RegisterService.register(
            email=email,
            name=name,
            password=None,
            open_id=open_id,
            provider=provider,
            language=language,
        )

        # Verify account was created
        assert account.email == email
        assert account.name == name
        assert account.status == "active"
        assert account.initialized_at is not None

        # Verify OAuth integration was created
        from extensions.ext_database import db
        from models import AccountIntegrate

        integration = db.session.query(AccountIntegrate).filter_by(account_id=account.id, provider=provider).first()
        assert integration is not None
        assert integration.open_id == open_id

    def test_register_with_pending_status(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test account registration with pending status.
        """
        fake = Faker()
        email = fake.email()
        name = fake.name()
        password = fake.password(length=12)
        language = fake.random_element(elements=("en-US", "zh-CN"))
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies[
            "feature_service"
        ].get_system_features.return_value.is_allow_create_workspace = True
        mock_external_service_dependencies[
            "feature_service"
        ].get_system_features.return_value.license.workspaces.is_available.return_value = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False

        # Execute registration with pending status
        from models import AccountStatus

        account = RegisterService.register(
            email=email,
            name=name,
            password=password,
            language=language,
            status=AccountStatus.PENDING,
        )

        # Verify account was created with pending status
        assert account.email == email
        assert account.name == name
        assert account.status == "pending"
        assert account.initialized_at is not None

        # Verify tenant was created and linked
        from extensions.ext_database import db
        from models.account import TenantAccountJoin

        tenant_join = db.session.query(TenantAccountJoin).filter_by(account_id=account.id).first()
        assert tenant_join is not None
        assert tenant_join.role == "owner"

    def test_register_workspace_creation_disabled(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test account registration when workspace creation is disabled.
        """
        fake = Faker()
        email = fake.email()
        name = fake.name()
        password = fake.password(length=12)
        language = fake.random_element(elements=("en-US", "zh-CN"))
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies[
            "feature_service"
        ].get_system_features.return_value.is_allow_create_workspace = False
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False

        # with pytest.raises(AccountRegisterError, match="Workspace is not allowed to create."):
        account = RegisterService.register(
            email=email,
            name=name,
            password=password,
            language=language,
        )

        # Verify account was created with no tenant
        assert account.email == email
        assert account.name == name
        assert account.status == "active"
        assert account.initialized_at is not None

        # Verify tenant was created and linked
        from extensions.ext_database import db
        from models.account import TenantAccountJoin

        tenant_join = db.session.query(TenantAccountJoin).filter_by(account_id=account.id).first()
        assert tenant_join is None

    def test_register_workspace_limit_exceeded(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test account registration when workspace limit is exceeded.
        """
        fake = Faker()
        email = fake.email()
        name = fake.name()
        password = fake.password(length=12)
        language = fake.random_element(elements=("en-US", "zh-CN"))
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies[
            "feature_service"
        ].get_system_features.return_value.is_allow_create_workspace = True
        mock_external_service_dependencies[
            "feature_service"
        ].get_system_features.return_value.license.workspaces.is_available.return_value = False
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False

        # with pytest.raises(AccountRegisterError, match="Workspace is not allowed to create."):
        account = RegisterService.register(
            email=email,
            name=name,
            password=password,
            language=language,
        )

        # Verify account was created with no tenant
        assert account.email == email
        assert account.name == name
        assert account.status == "active"
        assert account.initialized_at is not None

        # Verify tenant was created and linked
        from extensions.ext_database import db
        from models.account import TenantAccountJoin

        tenant_join = db.session.query(TenantAccountJoin).filter_by(account_id=account.id).first()
        assert tenant_join is None

    def test_register_without_workspace(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test account registration without workspace creation.
        """
        fake = Faker()
        email = fake.email()
        name = fake.name()
        password = fake.password(length=12)
        language = fake.random_element(elements=("en-US", "zh-CN"))
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False

        # Execute registration without workspace creation
        account = RegisterService.register(
            email=email,
            name=name,
            password=password,
            language=language,
            create_workspace_required=False,
        )

        # Verify account was created
        assert account.email == email
        assert account.name == name
        assert account.status == "active"
        assert account.initialized_at is not None

        # Verify no tenant was created
        from extensions.ext_database import db
        from models.account import TenantAccountJoin

        tenant_join = db.session.query(TenantAccountJoin).filter_by(account_id=account.id).first()
        assert tenant_join is None

    def test_invite_new_member_new_account(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test inviting a new member who doesn't have an account yet.
        """
        fake = Faker()
        tenant_name = fake.company()
        inviter_email = fake.email()
        inviter_name = fake.name()
        inviter_password = fake.password(length=12)
        new_member_email = fake.email()
        language = fake.random_element(elements=("en-US", "zh-CN"))
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies[
            "feature_service"
        ].get_system_features.return_value.is_allow_create_workspace = True
        mock_external_service_dependencies[
            "feature_service"
        ].get_system_features.return_value.license.workspaces.is_available.return_value = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False

        # Create tenant and inviter account
        tenant = TenantService.create_tenant(name=tenant_name)
        inviter = AccountService.create_account(
            email=inviter_email,
            name=inviter_name,
            interface_language="en-US",
            password=inviter_password,
        )
        TenantService.create_tenant_member(tenant, inviter, role="owner")

        # Mock the email task
        with patch("services.account_service.send_invite_member_mail_task") as mock_send_mail:
            mock_send_mail.delay.return_value = None

            # Execute invitation
            token = RegisterService.invite_new_member(
                tenant=tenant,
                email=new_member_email,
                language=language,
                role="normal",
                inviter=inviter,
            )

            # Verify token was generated
            assert token is not None
            assert len(token) > 0

            # Verify email task was called
            mock_send_mail.delay.assert_called_once()

        # Verify new account was created with pending status
        from extensions.ext_database import db
        from models import Account, TenantAccountJoin

        new_account = db.session.query(Account).filter_by(email=new_member_email).first()
        assert new_account is not None
        assert new_account.name == new_member_email.split("@")[0]  # Default name from email
        assert new_account.status == "pending"

        # Verify tenant member was created
        tenant_join = (
            db.session.query(TenantAccountJoin).filter_by(tenant_id=tenant.id, account_id=new_account.id).first()
        )
        assert tenant_join is not None
        assert tenant_join.role == "normal"

    def test_invite_new_member_existing_account(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test inviting an existing member who is not in the tenant yet.
        """
        fake = Faker()
        tenant_name = fake.company()
        inviter_email = fake.email()
        inviter_name = fake.name()
        inviter_password = fake.password(length=12)
        existing_member_email = fake.email()
        existing_member_name = fake.name()
        existing_member_password = fake.password(length=12)
        language = fake.random_element(elements=("en-US", "zh-CN"))
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False

        # Create tenant and inviter account
        tenant = TenantService.create_tenant(name=tenant_name)
        inviter = AccountService.create_account(
            email=inviter_email,
            name=inviter_name,
            interface_language="en-US",
            password=inviter_password,
        )
        TenantService.create_tenant_member(tenant, inviter, role="owner")

        # Create existing account
        existing_account = AccountService.create_account(
            email=existing_member_email,
            name=existing_member_name,
            interface_language="en-US",
            password=existing_member_password,
        )

        # Mock the email task
        with patch("services.account_service.send_invite_member_mail_task") as mock_send_mail:
            mock_send_mail.delay.return_value = None
            with pytest.raises(AccountAlreadyInTenantError, match="Account already in tenant."):
                # Execute invitation
                token = RegisterService.invite_new_member(
                    tenant=tenant,
                    email=existing_member_email,
                    language=language,
                    role="admin",
                    inviter=inviter,
                )

            # Verify email task was not called
            mock_send_mail.delay.assert_not_called()

        # Verify tenant member was created for existing account
        from extensions.ext_database import db
        from models.account import TenantAccountJoin

        tenant_join = (
            db.session.query(TenantAccountJoin).filter_by(tenant_id=tenant.id, account_id=existing_account.id).first()
        )
        assert tenant_join is not None
        assert tenant_join.role == "admin"

    def test_invite_new_member_existing_member(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test inviting a member who is already in the tenant with pending status.
        """
        fake = Faker()
        tenant_name = fake.company()
        inviter_email = fake.email()
        inviter_name = fake.name()
        inviter_password = fake.password(length=12)
        existing_pending_member_email = fake.email()
        existing_pending_member_name = fake.name()
        existing_pending_member_password = fake.password(length=12)
        language = fake.random_element(elements=("en-US", "zh-CN"))
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False

        # Create tenant and inviter account
        tenant = TenantService.create_tenant(name=tenant_name)
        inviter = AccountService.create_account(
            email=inviter_email,
            name=inviter_name,
            interface_language="en-US",
            password=inviter_password,
        )
        TenantService.create_tenant_member(tenant, inviter, role="owner")

        # Create existing account with pending status
        existing_account = AccountService.create_account(
            email=existing_pending_member_email,
            name=existing_pending_member_name,
            interface_language="en-US",
            password=existing_pending_member_password,
        )
        existing_account.status = "pending"
        from extensions.ext_database import db

        db.session.commit()

        # Add existing account to tenant
        TenantService.create_tenant_member(tenant, existing_account, role="normal")

        # Mock the email task
        with patch("services.account_service.send_invite_member_mail_task") as mock_send_mail:
            mock_send_mail.delay.return_value = None

            # Execute invitation (should resend email for pending member)
            token = RegisterService.invite_new_member(
                tenant=tenant,
                email=existing_pending_member_email,
                language=language,
                role="normal",
                inviter=inviter,
            )

            # Verify token was generated
            assert token is not None
            assert len(token) > 0

            # Verify email task was called
            mock_send_mail.delay.assert_called_once()

    def test_invite_new_member_no_inviter(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test inviting a member without providing an inviter.
        """
        fake = Faker()
        tenant_name = fake.company()
        new_member_email = fake.email()
        language = fake.random_element(elements=("en-US", "zh-CN"))
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False

        # Create tenant
        tenant = TenantService.create_tenant(name=tenant_name)

        # Execute invitation without inviter (should fail)
        with pytest.raises(ValueError, match="Inviter is required"):
            RegisterService.invite_new_member(
                tenant=tenant,
                email=new_member_email,
                language=language,
                role="normal",
                inviter=None,
            )

    def test_invite_new_member_account_already_in_tenant(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test inviting a member who is already in the tenant with active status.
        """
        fake = Faker()
        tenant_name = fake.company()
        inviter_email = fake.email()
        inviter_name = fake.name()
        inviter_password = fake.password(length=12)
        already_in_tenant_email = fake.email()
        already_in_tenant_name = fake.name()
        already_in_tenant_password = fake.password(length=12)
        language = fake.random_element(elements=("en-US", "zh-CN"))
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False

        # Create tenant and inviter account
        tenant = TenantService.create_tenant(name=tenant_name)
        inviter = AccountService.create_account(
            email=inviter_email,
            name=inviter_name,
            interface_language="en-US",
            password=inviter_password,
        )
        TenantService.create_tenant_member(tenant, inviter, role="owner")

        # Create existing account with active status
        existing_account = AccountService.create_account(
            email=already_in_tenant_email,
            name=already_in_tenant_name,
            interface_language="en-US",
            password=already_in_tenant_password,
        )
        existing_account.status = "active"
        from extensions.ext_database import db

        db.session.commit()

        # Add existing account to tenant
        TenantService.create_tenant_member(tenant, existing_account, role="normal")

        # Execute invitation (should fail for active member)
        with pytest.raises(AccountAlreadyInTenantError, match="Account already in tenant."):
            RegisterService.invite_new_member(
                tenant=tenant,
                email=already_in_tenant_email,
                language=language,
                role="normal",
                inviter=inviter,
            )

    def test_generate_invite_token_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful generation of invite token.
        """
        fake = Faker()
        tenant_name = fake.company()
        email = fake.email()
        name = fake.name()
        password = fake.password(length=12)
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False

        # Create tenant and account
        tenant = TenantService.create_tenant(name=tenant_name)
        account = AccountService.create_account(
            email=email,
            name=name,
            interface_language="en-US",
            password=password,
        )

        # Execute token generation
        token = RegisterService.generate_invite_token(tenant, account)

        # Verify token was generated
        assert token is not None
        assert len(token) > 0

        # Verify token was stored in Redis
        from extensions.ext_redis import redis_client

        token_key = RegisterService._get_invitation_token_key(token)
        stored_data = redis_client.get(token_key)
        assert stored_data is not None

        # Verify stored data contains correct information
        import json

        invitation_data = json.loads(stored_data.decode("utf-8"))
        assert invitation_data["account_id"] == str(account.id)
        assert invitation_data["email"] == account.email
        assert invitation_data["workspace_id"] == tenant.id

    def test_is_valid_invite_token_valid(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test validation of valid invite token.
        """
        fake = Faker()
        tenant_name = fake.company()
        email = fake.email()
        name = fake.name()
        password = fake.password(length=12)
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False

        # Create tenant and account
        tenant = TenantService.create_tenant(name=tenant_name)
        account = AccountService.create_account(
            email=email,
            name=name,
            interface_language="en-US",
            password=password,
        )

        # Generate a real token
        token = RegisterService.generate_invite_token(tenant, account)

        # Execute validation
        is_valid = RegisterService.is_valid_invite_token(token)

        # Verify token is valid
        assert is_valid is True

    def test_is_valid_invite_token_invalid(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test validation of invalid invite token.
        """
        fake = Faker()
        invalid_token = fake.uuid4()
        # Execute validation with non-existent token
        is_valid = RegisterService.is_valid_invite_token(invalid_token)

        # Verify token is invalid
        assert is_valid is False

    def test_revoke_token_with_workspace_and_email(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test revoking token with workspace ID and email.
        """
        fake = Faker()
        tenant_name = fake.company()
        email = fake.email()
        name = fake.name()
        password = fake.password(length=12)
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False

        # Create tenant and account
        tenant = TenantService.create_tenant(name=tenant_name)
        account = AccountService.create_account(
            email=email,
            name=name,
            interface_language="en-US",
            password=password,
        )

        # Generate a real token
        token = RegisterService.generate_invite_token(tenant, account)

        # Verify token exists in Redis before revocation
        from extensions.ext_redis import redis_client

        token_key = RegisterService._get_invitation_token_key(token)
        assert redis_client.get(token_key) is not None

        # Execute token revocation
        RegisterService.revoke_token(
            workspace_id=tenant.id,
            email=account.email,
            token=token,
        )

        # Verify token was not deleted from Redis
        assert redis_client.get(token_key) is not None

    def test_revoke_token_without_workspace_and_email(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test revoking token without workspace ID and email.
        """
        fake = Faker()
        tenant_name = fake.company()
        email = fake.email()
        name = fake.name()
        password = fake.password(length=12)
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False

        # Create tenant and account
        tenant = TenantService.create_tenant(name=tenant_name)
        account = AccountService.create_account(
            email=email,
            name=name,
            interface_language="en-US",
            password=password,
        )

        # Generate a real token
        token = RegisterService.generate_invite_token(tenant, account)

        # Verify token exists in Redis before revocation
        from extensions.ext_redis import redis_client

        token_key = RegisterService._get_invitation_token_key(token)
        assert redis_client.get(token_key) is not None

        # Execute token revocation without workspace and email
        RegisterService.revoke_token(
            workspace_id="",
            email="",
            token=token,
        )

        # Verify token was deleted from Redis
        assert redis_client.get(token_key) is None

    def test_get_invitation_if_token_valid_success(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test getting invitation data with valid token.
        """
        fake = Faker()
        tenant_name = fake.company()
        email = fake.email()
        name = fake.name()
        password = fake.password(length=12)
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False

        # Create tenant and account
        tenant = TenantService.create_tenant(name=tenant_name)
        account = AccountService.create_account(
            email=email,
            name=name,
            interface_language="en-US",
            password=password,
        )
        TenantService.create_tenant_member(tenant, account, role="normal")

        # Generate a real token
        token = RegisterService.generate_invite_token(tenant, account)

        email_hash = sha256(account.email.encode()).hexdigest()
        cache_key = f"member_invite_token:{tenant.id}, {email_hash}:{token}"
        from extensions.ext_redis import redis_client

        redis_client.setex(cache_key, 24 * 60 * 60, account.id)

        # Execute invitation retrieval
        result = RegisterService.get_invitation_if_token_valid(
            workspace_id=tenant.id,
            email=account.email,
            token=token,
        )

        # Verify result contains expected data
        assert result is not None
        assert result["account"].id == account.id
        assert result["tenant"].id == tenant.id
        assert result["data"]["account_id"] == str(account.id)
        assert result["data"]["email"] == account.email
        assert result["data"]["workspace_id"] == tenant.id

    def test_get_invitation_if_token_valid_invalid_token(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test getting invitation data with invalid token.
        """
        fake = Faker()
        workspace_id = fake.uuid4()
        email = fake.email()
        invalid_token = fake.uuid4()
        # Execute invitation retrieval with invalid token
        result = RegisterService.get_invitation_if_token_valid(
            workspace_id=workspace_id,
            email=email,
            token=invalid_token,
        )

        # Verify result is None
        assert result is None

    def test_get_invitation_if_token_valid_invalid_tenant(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test getting invitation data with invalid tenant.
        """
        fake = Faker()
        email = fake.email()
        name = fake.name()
        password = fake.password(length=12)
        invalid_tenant_id = fake.uuid4()
        token = fake.uuid4()
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False

        # Create account
        account = AccountService.create_account(
            email=email,
            name=name,
            interface_language="en-US",
            password=password,
        )

        # Create a real token but with non-existent tenant ID
        from extensions.ext_redis import redis_client

        invitation_data = {
            "account_id": str(account.id),
            "email": account.email,
            "workspace_id": invalid_tenant_id,
        }
        token_key = RegisterService._get_invitation_token_key(token)
        import json

        redis_client.setex(token_key, 24 * 60 * 60, json.dumps(invitation_data))

        # Execute invitation retrieval
        result = RegisterService.get_invitation_if_token_valid(
            workspace_id=invalid_tenant_id,
            email=account.email,
            token=token,
        )

        # Verify result is None (tenant not found)
        assert result is None

        # Clean up
        redis_client.delete(token_key)

    def test_get_invitation_if_token_valid_account_mismatch(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test getting invitation data with account ID mismatch.
        """
        fake = Faker()
        tenant_name = fake.company()
        email = fake.email()
        name = fake.name()
        password = fake.password(length=12)
        token = fake.uuid4()
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False

        # Create tenant and account
        tenant = TenantService.create_tenant(name=tenant_name)
        account = AccountService.create_account(
            email=email,
            name=name,
            interface_language="en-US",
            password=password,
        )
        TenantService.create_tenant_member(tenant, account, role="normal")

        # Create a real token but with mismatched account ID
        from extensions.ext_redis import redis_client

        invitation_data = {
            "account_id": "different-account-id",  # Different from actual account ID
            "email": account.email,
            "workspace_id": tenant.id,
        }
        token_key = RegisterService._get_invitation_token_key(token)
        redis_client.setex(token_key, 24 * 60 * 60, json.dumps(invitation_data))

        # Execute invitation retrieval
        result = RegisterService.get_invitation_if_token_valid(
            workspace_id=tenant.id,
            email=account.email,
            token=token,
        )

        # Verify result is None (account ID mismatch)
        assert result is None

        # Clean up
        redis_client.delete(token_key)

    def test_get_invitation_if_token_valid_tenant_not_normal(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test getting invitation data with tenant not in normal status.
        """
        fake = Faker()
        tenant_name = fake.company()
        email = fake.email()
        name = fake.name()
        password = fake.password(length=12)
        token = fake.uuid4()
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False

        # Create tenant and account
        tenant = TenantService.create_tenant(name=tenant_name)
        account = AccountService.create_account(
            email=email,
            name=name,
            interface_language="en-US",
            password=password,
        )
        TenantService.create_tenant_member(tenant, account, role="normal")

        # Change tenant status to non-normal
        tenant.status = "suspended"
        from extensions.ext_database import db

        db.session.commit()

        # Create a real token
        from extensions.ext_redis import redis_client

        invitation_data = {
            "account_id": str(account.id),
            "email": account.email,
            "workspace_id": tenant.id,
        }
        token_key = RegisterService._get_invitation_token_key(token)
        import json

        redis_client.setex(token_key, 24 * 60 * 60, json.dumps(invitation_data))

        # Execute invitation retrieval
        result = RegisterService.get_invitation_if_token_valid(
            workspace_id=tenant.id,
            email=account.email,
            token=token,
        )

        # Verify result is None (tenant not in normal status)
        assert result is None

        # Clean up
        redis_client.delete(token_key)

    def test_get_invitation_by_token_with_workspace_and_email(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test getting invitation by token with workspace ID and email.
        """
        fake = Faker()
        token = fake.uuid4()
        workspace_id = fake.uuid4()
        email = fake.email()

        # Create the cache key as the service does
        from hashlib import sha256

        from extensions.ext_redis import redis_client

        email_hash = sha256(email.encode()).hexdigest()
        cache_key = f"member_invite_token:{workspace_id}, {email_hash}:{token}"

        # Store account ID in Redis
        account_id = fake.uuid4()
        redis_client.setex(cache_key, 24 * 60 * 60, account_id)

        # Execute invitation retrieval
        result = RegisterService.get_invitation_by_token(
            token=token,
            workspace_id=workspace_id,
            email=email,
        )

        # Verify result contains expected data
        assert result is not None
        assert result["account_id"] == account_id
        assert result["email"] == email
        assert result["workspace_id"] == workspace_id

        # Clean up
        redis_client.delete(cache_key)

    def test_get_invitation_by_token_without_workspace_and_email(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test getting invitation by token without workspace ID and email.
        """
        fake = Faker()
        token = fake.uuid4()
        invitation_data = {
            "account_id": fake.uuid4(),
            "email": fake.email(),
            "workspace_id": fake.uuid4(),
        }

        # Store invitation data in Redis using standard token key
        from extensions.ext_redis import redis_client

        token_key = RegisterService._get_invitation_token_key(token)
        import json

        redis_client.setex(token_key, 24 * 60 * 60, json.dumps(invitation_data))

        # Execute invitation retrieval
        result = RegisterService.get_invitation_by_token(token=token)

        # Verify result contains expected data
        assert result is not None
        assert result["account_id"] == invitation_data["account_id"]
        assert result["email"] == invitation_data["email"]
        assert result["workspace_id"] == invitation_data["workspace_id"]

        # Clean up
        redis_client.delete(token_key)

    def test_get_invitation_token_key(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test getting invitation token key.
        """
        fake = Faker()
        token = fake.uuid4()
        # Execute token key generation
        token_key = RegisterService._get_invitation_token_key(token)

        # Verify token key format
        assert token_key == f"member_invite:token:{token}"
