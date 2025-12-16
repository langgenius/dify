import time
import uuid
from unittest.mock import patch

import pytest
from faker import Faker
from werkzeug.exceptions import NotFound, Unauthorized

from libs.password import hash_password
from models import Account, AccountStatus, Tenant, TenantAccountJoin, TenantAccountRole
from models.model import App, Site
from services.errors.account import AccountLoginError, AccountNotFoundError, AccountPasswordError
from services.webapp_auth_service import WebAppAuthService, WebAppAuthType


class TestWebAppAuthService:
    """Integration tests for WebAppAuthService using testcontainers."""

    @pytest.fixture
    def mock_external_service_dependencies(self):
        """Mock setup for external service dependencies."""
        with (
            patch("services.webapp_auth_service.PassportService") as mock_passport_service,
            patch("services.webapp_auth_service.TokenManager") as mock_token_manager,
            patch("services.webapp_auth_service.send_email_code_login_mail_task") as mock_mail_task,
            patch("services.webapp_auth_service.AppService") as mock_app_service,
            patch("services.webapp_auth_service.EnterpriseService") as mock_enterprise_service,
        ):
            # Setup default mock returns
            mock_passport_service.return_value.issue.return_value = "mock_jwt_token"
            mock_token_manager.generate_token.return_value = "mock_token"
            mock_token_manager.get_token_data.return_value = {"code": "123456"}
            mock_mail_task.delay.return_value = None
            mock_app_service.get_app_id_by_code.return_value = "mock_app_id"
            mock_enterprise_service.WebAppAuth.get_app_access_mode_by_id.return_value = type(
                "MockWebAppAuth", (), {"access_mode": "private"}
            )()
            # Note: get_app_access_mode_by_code method was removed in refactoring

            yield {
                "passport_service": mock_passport_service,
                "token_manager": mock_token_manager,
                "mail_task": mock_mail_task,
                "app_service": mock_app_service,
                "enterprise_service": mock_enterprise_service,
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
        import uuid

        # Create account with unique email to avoid collisions
        unique_email = f"test_{uuid.uuid4().hex[:8]}@example.com"
        account = Account(
            email=unique_email,
            name=fake.name(),
            interface_language="en-US",
            status="active",
        )

        from extensions.ext_database import db

        db.session.add(account)
        db.session.commit()

        # Create tenant for the account
        tenant = Tenant(
            name=fake.company(),
            status="normal",
        )
        db.session.add(tenant)
        db.session.commit()

        # Create tenant-account join
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

    def _create_test_account_with_password(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Helper method to create a test account with password for testing.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            mock_external_service_dependencies: Mock dependencies

        Returns:
            tuple: (account, tenant, password) - Created account, tenant and password
        """
        fake = Faker()
        password = fake.password(length=12)

        # Create account with password
        import uuid

        unique_email = f"test_{uuid.uuid4().hex[:8]}@example.com"
        account = Account(
            email=unique_email,
            name=fake.name(),
            interface_language="en-US",
            status="active",
        )

        # Hash password
        salt = b"test_salt_16_bytes"
        password_hash = hash_password(password, salt)

        # Convert to base64 for storage
        import base64

        account.password = base64.b64encode(password_hash).decode()
        account.password_salt = base64.b64encode(salt).decode()

        from extensions.ext_database import db

        db.session.add(account)
        db.session.commit()

        # Create tenant for the account
        tenant = Tenant(
            name=fake.company(),
            status="normal",
        )
        db.session.add(tenant)
        db.session.commit()

        # Create tenant-account join
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

        return account, tenant, password

    def _create_test_app_and_site(self, db_session_with_containers, mock_external_service_dependencies, tenant):
        """
        Helper method to create a test app and site for testing.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            mock_external_service_dependencies: Mock dependencies
            tenant: Tenant instance to associate with

        Returns:
            tuple: (app, site) - Created app and site instances
        """
        fake = Faker()

        # Create app
        app = App(
            tenant_id=tenant.id,
            name=fake.company(),
            description=fake.text(max_nb_chars=100),
            mode="chat",
            icon_type="emoji",
            icon="🤖",
            icon_background="#FF6B6B",
            api_rph=100,
            api_rpm=10,
            enable_site=True,
            enable_api=True,
        )

        from extensions.ext_database import db

        db.session.add(app)
        db.session.commit()

        # Create site
        site = Site(
            app_id=app.id,
            title=fake.company(),
            code=fake.unique.lexify(text="??????"),
            description=fake.text(max_nb_chars=100),
            default_language="en-US",
            status="normal",
            customize_token_strategy="not_allow",
        )
        db.session.add(site)
        db.session.commit()

        return app, site

    def test_authenticate_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful authentication with valid email and password.

        This test verifies:
        - Proper authentication with valid credentials
        - Correct account return
        - Database state consistency
        """
        # Arrange: Create test data
        account, tenant, password = self._create_test_account_with_password(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Act: Execute authentication
        result = WebAppAuthService.authenticate(account.email, password)

        # Assert: Verify successful authentication
        assert result is not None
        assert result.id == account.id
        assert result.email == account.email
        assert result.name == account.name
        assert result.status == AccountStatus.ACTIVE

        # Verify database state
        from extensions.ext_database import db

        db.session.refresh(result)
        assert result.id is not None
        assert result.password is not None
        assert result.password_salt is not None

    def test_authenticate_account_not_found(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test authentication with non-existent email.

        This test verifies:
        - Proper error handling for non-existent accounts
        - Correct exception type and message
        """
        # Arrange: Generate a guaranteed non-existent email
        # Use UUID and timestamp to ensure uniqueness
        unique_id = str(uuid.uuid4()).replace("-", "")
        timestamp = str(int(time.time() * 1000000))  # microseconds
        non_existent_email = f"nonexistent_{unique_id}_{timestamp}@test-domain-that-never-exists.invalid"

        # Double-check this email doesn't exist in the database
        existing_account = db_session_with_containers.query(Account).filter_by(email=non_existent_email).first()
        assert existing_account is None, f"Test email {non_existent_email} already exists in database"

        # Act & Assert: Verify proper error handling
        with pytest.raises(AccountNotFoundError):
            WebAppAuthService.authenticate(non_existent_email, "any_password")

    def test_authenticate_account_banned(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test authentication with banned account.

        This test verifies:
        - Proper error handling for banned accounts
        - Correct exception type and message
        """
        # Arrange: Create banned account
        fake = Faker()
        password = fake.password(length=12)

        account = Account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            status=AccountStatus.BANNED,
        )

        # Hash password
        salt = b"test_salt_16_bytes"
        password_hash = hash_password(password, salt)

        # Convert to base64 for storage
        import base64

        account.password = base64.b64encode(password_hash).decode()
        account.password_salt = base64.b64encode(salt).decode()

        from extensions.ext_database import db

        db.session.add(account)
        db.session.commit()

        # Act & Assert: Verify proper error handling
        with pytest.raises(AccountLoginError) as exc_info:
            WebAppAuthService.authenticate(account.email, password)

        assert "Account is banned." in str(exc_info.value)

    def test_authenticate_invalid_password(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test authentication with invalid password.

        This test verifies:
        - Proper error handling for invalid passwords
        - Correct exception type and message
        """
        # Arrange: Create account with password
        account, tenant, correct_password = self._create_test_account_with_password(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Act & Assert: Verify proper error handling with wrong password
        with pytest.raises(AccountPasswordError) as exc_info:
            WebAppAuthService.authenticate(account.email, "wrong_password")

        assert "Invalid email or password." in str(exc_info.value)

    def test_authenticate_account_without_password(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test authentication for account without password.

        This test verifies:
        - Proper error handling for accounts without password
        - Correct exception type and message
        """
        # Arrange: Create account without password
        fake = Faker()
        import uuid

        unique_email = f"test_{uuid.uuid4().hex[:8]}@example.com"

        account = Account(
            email=unique_email,
            name=fake.name(),
            interface_language="en-US",
            status="active",
        )

        from extensions.ext_database import db

        db.session.add(account)
        db.session.commit()

        # Act & Assert: Verify proper error handling
        with pytest.raises(AccountPasswordError) as exc_info:
            WebAppAuthService.authenticate(account.email, "any_password")

        assert "Invalid email or password." in str(exc_info.value)

    def test_login_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful login and JWT token generation.

        This test verifies:
        - Proper JWT token generation
        - Correct token format and content
        - Mock service integration
        """
        # Arrange: Create test account
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Act: Execute login
        result = WebAppAuthService.login(account)

        # Assert: Verify successful login
        assert result is not None
        assert result == "mock_jwt_token"

        # Verify mock service was called correctly
        mock_external_service_dependencies["passport_service"].return_value.issue.assert_called_once()
        call_args = mock_external_service_dependencies["passport_service"].return_value.issue.call_args[0][0]

        assert call_args["sub"] == "Web API Passport"
        assert call_args["user_id"] == account.id
        assert call_args["session_id"] == account.email
        assert call_args["token_source"] == "webapp_login_token"
        assert call_args["auth_type"] == "internal"
        assert "exp" in call_args

    def test_get_user_through_email_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful user retrieval through email.

        This test verifies:
        - Proper user retrieval by email
        - Correct account return
        - Database state consistency
        """
        # Arrange: Create test data
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Act: Execute user retrieval
        result = WebAppAuthService.get_user_through_email(account.email)

        # Assert: Verify successful retrieval
        assert result is not None
        assert result.id == account.id
        assert result.email == account.email
        assert result.name == account.name
        assert result.status == AccountStatus.ACTIVE

        # Verify database state
        from extensions.ext_database import db

        db.session.refresh(result)
        assert result.id is not None

    def test_get_user_through_email_not_found(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test user retrieval with non-existent email.

        This test verifies:
        - Proper handling for non-existent users
        - Correct return value (None)
        """
        # Arrange: Use non-existent email
        fake = Faker()
        non_existent_email = fake.email()

        # Act: Execute user retrieval
        result = WebAppAuthService.get_user_through_email(non_existent_email)

        # Assert: Verify proper handling
        assert result is None

    def test_get_user_through_email_banned(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test user retrieval with banned account.

        This test verifies:
        - Proper error handling for banned accounts
        - Correct exception type and message
        """
        # Arrange: Create banned account
        fake = Faker()
        import uuid

        unique_email = f"test_{uuid.uuid4().hex[:8]}@example.com"

        account = Account(
            email=unique_email,
            name=fake.name(),
            interface_language="en-US",
            status=AccountStatus.BANNED,
        )

        from extensions.ext_database import db

        db.session.add(account)
        db.session.commit()

        # Act & Assert: Verify proper error handling
        with pytest.raises(Unauthorized) as exc_info:
            WebAppAuthService.get_user_through_email(account.email)

        assert "Account is banned." in str(exc_info.value)

    def test_send_email_code_login_email_with_account(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test sending email code login email with account.

        This test verifies:
        - Proper email code generation
        - Token generation with correct data
        - Mail task scheduling
        - Mock service integration
        """
        # Arrange: Create test account
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Act: Execute email code login email sending
        result = WebAppAuthService.send_email_code_login_email(account=account, language="en-US")

        # Assert: Verify successful email sending
        assert result is not None
        assert result == "mock_token"

        # Verify mock services were called correctly
        mock_external_service_dependencies["token_manager"].generate_token.assert_called_once()
        mock_external_service_dependencies["mail_task"].delay.assert_called_once()

        # Verify token generation parameters
        token_call_args = mock_external_service_dependencies["token_manager"].generate_token.call_args
        assert token_call_args[1]["account"] == account
        assert token_call_args[1]["email"] == account.email
        assert token_call_args[1]["token_type"] == "email_code_login"
        assert "code" in token_call_args[1]["additional_data"]

        # Verify mail task parameters
        mail_call_args = mock_external_service_dependencies["mail_task"].delay.call_args
        assert mail_call_args[1]["language"] == "en-US"
        assert mail_call_args[1]["to"] == account.email
        assert "code" in mail_call_args[1]

    def test_send_email_code_login_email_with_email_only(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test sending email code login email with email only.

        This test verifies:
        - Proper email code generation without account
        - Token generation with email only
        - Mail task scheduling
        - Mock service integration
        """
        # Arrange: Use test email
        fake = Faker()
        test_email = fake.email()

        # Act: Execute email code login email sending
        result = WebAppAuthService.send_email_code_login_email(email=test_email, language="zh-Hans")

        # Assert: Verify successful email sending
        assert result is not None
        assert result == "mock_token"

        # Verify mock services were called correctly
        mock_external_service_dependencies["token_manager"].generate_token.assert_called_once()
        mock_external_service_dependencies["mail_task"].delay.assert_called_once()

        # Verify token generation parameters
        token_call_args = mock_external_service_dependencies["token_manager"].generate_token.call_args
        assert token_call_args[1]["account"] is None
        assert token_call_args[1]["email"] == test_email
        assert token_call_args[1]["token_type"] == "email_code_login"
        assert "code" in token_call_args[1]["additional_data"]

        # Verify mail task parameters
        mail_call_args = mock_external_service_dependencies["mail_task"].delay.call_args
        assert mail_call_args[1]["language"] == "zh-Hans"
        assert mail_call_args[1]["to"] == test_email
        assert "code" in mail_call_args[1]

    def test_send_email_code_login_email_no_email_provided(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test sending email code login email without providing email.

        This test verifies:
        - Proper error handling when no email is provided
        - Correct exception type and message
        """
        # Arrange: No email provided

        # Act & Assert: Verify proper error handling
        with pytest.raises(ValueError) as exc_info:
            WebAppAuthService.send_email_code_login_email()

        assert "Email must be provided." in str(exc_info.value)

    def test_get_email_code_login_data_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful retrieval of email code login data.

        This test verifies:
        - Proper token data retrieval
        - Correct data format
        - Mock service integration
        """
        # Arrange: Setup mock return
        expected_data = {"code": "123456", "email": "test@example.com"}
        mock_external_service_dependencies["token_manager"].get_token_data.return_value = expected_data

        # Act: Execute data retrieval
        result = WebAppAuthService.get_email_code_login_data("mock_token")

        # Assert: Verify successful retrieval
        assert result is not None
        assert result == expected_data
        assert result["code"] == "123456"
        assert result["email"] == "test@example.com"

        # Verify mock service was called correctly
        mock_external_service_dependencies["token_manager"].get_token_data.assert_called_once_with(
            "mock_token", "email_code_login"
        )

    def test_get_email_code_login_data_no_data(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test email code login data retrieval when no data exists.

        This test verifies:
        - Proper handling when no token data exists
        - Correct return value (None)
        - Mock service integration
        """
        # Arrange: Setup mock return for no data
        mock_external_service_dependencies["token_manager"].get_token_data.return_value = None

        # Act: Execute data retrieval
        result = WebAppAuthService.get_email_code_login_data("invalid_token")

        # Assert: Verify proper handling
        assert result is None

        # Verify mock service was called correctly
        mock_external_service_dependencies["token_manager"].get_token_data.assert_called_once_with(
            "invalid_token", "email_code_login"
        )

    def test_revoke_email_code_login_token_success(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test successful revocation of email code login token.

        This test verifies:
        - Proper token revocation
        - Mock service integration
        """
        # Arrange: Setup mock

        # Act: Execute token revocation
        WebAppAuthService.revoke_email_code_login_token("mock_token")

        # Assert: Verify mock service was called correctly
        mock_external_service_dependencies["token_manager"].revoke_token.assert_called_once_with(
            "mock_token", "email_code_login"
        )

    def test_create_end_user_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful end user creation.

        This test verifies:
        - Proper end user creation with valid app code
        - Correct database state after creation
        - Proper relationship establishment
        - Mock service integration
        """
        # Arrange: Create test data
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )
        app, site = self._create_test_app_and_site(
            db_session_with_containers, mock_external_service_dependencies, tenant
        )

        # Act: Execute end user creation
        result = WebAppAuthService.create_end_user(site.code, "test@example.com")

        # Assert: Verify successful creation
        assert result is not None
        assert result.tenant_id == app.tenant_id
        assert result.app_id == app.id
        assert result.type == "browser"
        assert result.is_anonymous is False
        assert result.session_id == "test@example.com"
        assert result.name == "enterpriseuser"
        assert result.external_user_id == "enterpriseuser"

        # Verify database state
        from extensions.ext_database import db

        db.session.refresh(result)
        assert result.id is not None
        assert result.created_at is not None
        assert result.updated_at is not None

    def test_create_end_user_site_not_found(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test end user creation with non-existent site code.

        This test verifies:
        - Proper error handling for non-existent sites
        - Correct exception type and message
        """
        # Arrange: Use non-existent site code
        fake = Faker()
        non_existent_code = fake.unique.lexify(text="??????")

        # Act & Assert: Verify proper error handling
        with pytest.raises(NotFound) as exc_info:
            WebAppAuthService.create_end_user(non_existent_code, "test@example.com")

        assert "Site not found." in str(exc_info.value)

    def test_create_end_user_app_not_found(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test end user creation when app is not found.

        This test verifies:
        - Proper error handling when app is missing
        - Correct exception type and message
        """
        # Arrange: Create site without app
        fake = Faker()
        tenant = Tenant(
            name=fake.company(),
            status="normal",
        )

        from extensions.ext_database import db

        db.session.add(tenant)
        db.session.commit()

        site = Site(
            app_id="00000000-0000-0000-0000-000000000000",
            title=fake.company(),
            code=fake.unique.lexify(text="??????"),
            description=fake.text(max_nb_chars=100),
            default_language="en-US",
            status="normal",
            customize_token_strategy="not_allow",
        )
        db.session.add(site)
        db.session.commit()

        # Act & Assert: Verify proper error handling
        with pytest.raises(NotFound) as exc_info:
            WebAppAuthService.create_end_user(site.code, "test@example.com")

        assert "App not found." in str(exc_info.value)

    def test_is_app_require_permission_check_with_access_mode_private(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test permission check requirement for private access mode.

        This test verifies:
        - Proper permission check requirement for private mode
        - Correct return value
        - Mock service integration
        """
        # Arrange: Setup test with private access mode

        # Act: Execute permission check requirement test
        result = WebAppAuthService.is_app_require_permission_check(access_mode="private")

        # Assert: Verify correct result
        assert result is True

    def test_is_app_require_permission_check_with_access_mode_public(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test permission check requirement for public access mode.

        This test verifies:
        - Proper permission check requirement for public mode
        - Correct return value
        - Mock service integration
        """
        # Arrange: Setup test with public access mode

        # Act: Execute permission check requirement test
        result = WebAppAuthService.is_app_require_permission_check(access_mode="public")

        # Assert: Verify correct result
        assert result is False

    def test_is_app_require_permission_check_with_app_code(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test permission check requirement using app code.

        This test verifies:
        - Proper permission check requirement using app code
        - Correct return value
        - Mock service integration
        """
        # Arrange: Setup mock for app service
        mock_external_service_dependencies["app_service"].get_app_id_by_code.return_value = "mock_app_id"

        # Act: Execute permission check requirement test
        result = WebAppAuthService.is_app_require_permission_check(app_code="mock_app_code")

        # Assert: Verify correct result
        assert result is True

        # Verify mock service was called correctly
        mock_external_service_dependencies["app_service"].get_app_id_by_code.assert_called_once_with("mock_app_code")
        mock_external_service_dependencies[
            "enterprise_service"
        ].WebAppAuth.get_app_access_mode_by_id.assert_called_once_with("mock_app_id")

    def test_is_app_require_permission_check_no_parameters(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test permission check requirement with no parameters.

        This test verifies:
        - Proper error handling when no parameters provided
        - Correct exception type and message
        """
        # Arrange: No parameters provided

        # Act & Assert: Verify proper error handling
        with pytest.raises(ValueError) as exc_info:
            WebAppAuthService.is_app_require_permission_check()

        assert "Either app_code or app_id must be provided." in str(exc_info.value)

    def test_get_app_auth_type_with_access_mode_public(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test app authentication type for public access mode.

        This test verifies:
        - Proper authentication type determination for public mode
        - Correct return value
        - Mock service integration
        """
        # Arrange: Setup test with public access mode

        # Act: Execute authentication type determination
        result = WebAppAuthService.get_app_auth_type(access_mode="public")

        # Assert: Verify correct result
        assert result == WebAppAuthType.PUBLIC

    def test_get_app_auth_type_with_access_mode_private(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test app authentication type for private access mode.

        This test verifies:
        - Proper authentication type determination for private mode
        - Correct return value
        - Mock service integration
        """
        # Arrange: Setup test with private access mode

        # Act: Execute authentication type determination
        result = WebAppAuthService.get_app_auth_type(access_mode="private")

        # Assert: Verify correct result
        assert result == WebAppAuthType.INTERNAL

    def test_get_app_auth_type_with_app_code(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test app authentication type using app code.

        This test verifies:
        - Proper authentication type determination using app code
        - Correct return value
        - Mock service integration
        """
        # Arrange: Setup mock for enterprise service
        mock_external_service_dependencies["app_service"].get_app_id_by_code.return_value = "mock_app_id"
        setting = type("MockWebAppAuth", (), {"access_mode": "sso_verified"})()
        mock_external_service_dependencies[
            "enterprise_service"
        ].WebAppAuth.get_app_access_mode_by_id.return_value = setting

        # Act: Execute authentication type determination
        result: WebAppAuthType = WebAppAuthService.get_app_auth_type(app_code="mock_app_code")

        # Assert: Verify correct result
        assert result == WebAppAuthType.EXTERNAL

        # Verify mock service was called correctly
        mock_external_service_dependencies[
            "enterprise_service"
        ].WebAppAuth.get_app_access_mode_by_id.assert_called_once_with(app_id="mock_app_id")

    def test_get_app_auth_type_no_parameters(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test app authentication type with no parameters.

        This test verifies:
        - Proper error handling when no parameters provided
        - Correct exception type and message
        """
        # Arrange: No parameters provided

        # Act & Assert: Verify proper error handling
        with pytest.raises(ValueError) as exc_info:
            WebAppAuthService.get_app_auth_type()

        assert "Either app_code or access_mode must be provided." in str(exc_info.value)
