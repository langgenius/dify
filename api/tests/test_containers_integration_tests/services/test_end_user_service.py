from __future__ import annotations

from unittest.mock import patch
from uuid import uuid4

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom
from models.account import Account, Tenant, TenantAccountJoin
from models.model import App, DefaultEndUserSessionID, EndUser
from services.end_user_service import EndUserService


class TestEndUserServiceFactory:
    """Factory class for creating test data and mock objects for end user service tests."""

    @staticmethod
    def create_app_and_account(db_session_with_containers):
        tenant = Tenant(name=f"Tenant {uuid4()}")
        db_session_with_containers.add(tenant)
        db_session_with_containers.flush()

        account = Account(
            name=f"Account {uuid4()}",
            email=f"end_user_{uuid4()}@example.com",
            password="hashed-password",
            password_salt="salt",
            interface_language="en-US",
            timezone="UTC",
        )
        db_session_with_containers.add(account)
        db_session_with_containers.flush()

        tenant_join = TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            role="owner",
            current=True,
        )
        db_session_with_containers.add(tenant_join)
        db_session_with_containers.flush()

        app = App(
            tenant_id=tenant.id,
            name=f"App {uuid4()}",
            description="",
            mode="chat",
            icon_type="emoji",
            icon="bot",
            icon_background="#FFFFFF",
            enable_site=False,
            enable_api=True,
            api_rpm=100,
            api_rph=100,
            is_demo=False,
            is_public=False,
            is_universal=False,
            created_by=account.id,
            updated_by=account.id,
        )
        db_session_with_containers.add(app)
        db_session_with_containers.commit()
        return app

    @staticmethod
    def create_end_user(
        db_session_with_containers,
        *,
        tenant_id: str,
        app_id: str,
        session_id: str,
        invoke_type: InvokeFrom,
        is_anonymous: bool = False,
    ):
        end_user = EndUser(
            tenant_id=tenant_id,
            app_id=app_id,
            type=invoke_type,
            external_user_id=session_id,
            name=f"User-{uuid4()}",
            is_anonymous=is_anonymous,
            session_id=session_id,
        )
        db_session_with_containers.add(end_user)
        db_session_with_containers.commit()
        return end_user


class TestEndUserServiceGetOrCreateEndUser:
    """
    Unit tests for EndUserService.get_or_create_end_user method.

    This test suite covers:
    - Creating new end users
    - Retrieving existing end users
    - Default session ID handling
    - Anonymous user creation
    """

    @pytest.fixture
    def factory(self):
        """Provide test data factory."""
        return TestEndUserServiceFactory()

    def test_get_or_create_end_user_with_custom_user_id(self, db_session_with_containers, factory):
        """Test getting or creating end user with custom user_id."""
        # Arrange
        app = factory.create_app_and_account(db_session_with_containers)
        user_id = "custom-user-123"

        # Act
        result = EndUserService.get_or_create_end_user(app_model=app, user_id=user_id)

        # Assert
        assert result.tenant_id == app.tenant_id
        assert result.app_id == app.id
        assert result.session_id == user_id
        assert result.type == InvokeFrom.SERVICE_API
        assert result.is_anonymous is False

    def test_get_or_create_end_user_without_user_id(self, db_session_with_containers, factory):
        """Test getting or creating end user without user_id uses default session."""
        # Arrange
        app = factory.create_app_and_account(db_session_with_containers)

        # Act
        result = EndUserService.get_or_create_end_user(app_model=app, user_id=None)

        # Assert
        assert result.session_id == DefaultEndUserSessionID.DEFAULT_SESSION_ID
        # Verify _is_anonymous is set correctly (property always returns False)
        assert result._is_anonymous is True

    def test_get_existing_end_user(self, db_session_with_containers, factory):
        """Test retrieving an existing end user."""
        # Arrange
        app = factory.create_app_and_account(db_session_with_containers)
        user_id = "existing-user-123"
        existing_user = factory.create_end_user(
            db_session_with_containers,
            tenant_id=app.tenant_id,
            app_id=app.id,
            session_id=user_id,
            invoke_type=InvokeFrom.SERVICE_API,
        )

        # Act
        result = EndUserService.get_or_create_end_user(app_model=app, user_id=user_id)

        # Assert
        assert result.id == existing_user.id


class TestEndUserServiceGetOrCreateEndUserByType:
    """
    Unit tests for EndUserService.get_or_create_end_user_by_type method.

    This test suite covers:
    - Creating end users with different InvokeFrom types
    - Type migration for legacy users
    - Query ordering and prioritization
    - Session management
    """

    @pytest.fixture
    def factory(self):
        """Provide test data factory."""
        return TestEndUserServiceFactory()

    def test_create_end_user_service_api_type(self, db_session_with_containers, factory):
        """Test creating new end user with SERVICE_API type."""
        # Arrange
        app = factory.create_app_and_account(db_session_with_containers)
        tenant_id = app.tenant_id
        app_id = app.id
        user_id = "user-789"

        # Act
        result = EndUserService.get_or_create_end_user_by_type(
            type=InvokeFrom.SERVICE_API,
            tenant_id=tenant_id,
            app_id=app_id,
            user_id=user_id,
        )

        # Assert
        assert result.type == InvokeFrom.SERVICE_API
        assert result.tenant_id == tenant_id
        assert result.app_id == app_id
        assert result.session_id == user_id

    def test_create_end_user_web_app_type(self, db_session_with_containers, factory):
        """Test creating new end user with WEB_APP type."""
        # Arrange
        app = factory.create_app_and_account(db_session_with_containers)
        tenant_id = app.tenant_id
        app_id = app.id
        user_id = "user-789"

        # Act
        result = EndUserService.get_or_create_end_user_by_type(
            type=InvokeFrom.WEB_APP,
            tenant_id=tenant_id,
            app_id=app_id,
            user_id=user_id,
        )

        # Assert
        assert result.type == InvokeFrom.WEB_APP

    @patch("services.end_user_service.logger")
    def test_upgrade_legacy_end_user_type(self, mock_logger, db_session_with_containers, factory):
        """Test upgrading legacy end user with different type."""
        # Arrange
        app = factory.create_app_and_account(db_session_with_containers)
        tenant_id = app.tenant_id
        app_id = app.id
        user_id = "user-789"

        # Existing user with old type
        existing_user = factory.create_end_user(
            db_session_with_containers,
            tenant_id=tenant_id,
            app_id=app_id,
            session_id=user_id,
            invoke_type=InvokeFrom.SERVICE_API,
        )

        # Act - Request with different type
        result = EndUserService.get_or_create_end_user_by_type(
            type=InvokeFrom.WEB_APP,
            tenant_id=tenant_id,
            app_id=app_id,
            user_id=user_id,
        )

        # Assert
        assert result.id == existing_user.id
        assert result.type == InvokeFrom.WEB_APP  # Type should be updated
        mock_logger.info.assert_called_once()
        # Verify log message contains upgrade info
        log_call = mock_logger.info.call_args[0][0]
        assert "Upgrading legacy EndUser" in log_call

    @patch("services.end_user_service.logger")
    def test_get_existing_end_user_matching_type(self, mock_logger, db_session_with_containers, factory):
        """Test retrieving existing end user with matching type."""
        # Arrange
        app = factory.create_app_and_account(db_session_with_containers)
        tenant_id = app.tenant_id
        app_id = app.id
        user_id = "user-789"

        existing_user = factory.create_end_user(
            db_session_with_containers,
            tenant_id=tenant_id,
            app_id=app_id,
            session_id=user_id,
            invoke_type=InvokeFrom.SERVICE_API,
        )

        # Act - Request with same type
        result = EndUserService.get_or_create_end_user_by_type(
            type=InvokeFrom.SERVICE_API,
            tenant_id=tenant_id,
            app_id=app_id,
            user_id=user_id,
        )

        # Assert
        assert result.id == existing_user.id
        assert result.type == InvokeFrom.SERVICE_API
        mock_logger.info.assert_not_called()

    def test_create_anonymous_user_with_default_session(self, db_session_with_containers, factory):
        """Test creating anonymous user when user_id is None."""
        # Arrange
        app = factory.create_app_and_account(db_session_with_containers)
        tenant_id = app.tenant_id
        app_id = app.id

        # Act
        result = EndUserService.get_or_create_end_user_by_type(
            type=InvokeFrom.SERVICE_API,
            tenant_id=tenant_id,
            app_id=app_id,
            user_id=None,
        )

        # Assert
        assert result.session_id == DefaultEndUserSessionID.DEFAULT_SESSION_ID
        # Verify _is_anonymous is set correctly (property always returns False)
        assert result._is_anonymous is True
        assert result.external_user_id == DefaultEndUserSessionID.DEFAULT_SESSION_ID

    def test_query_ordering_prioritizes_matching_type(self, db_session_with_containers, factory):
        """Test that query ordering prioritizes records with matching type."""
        # Arrange
        app = factory.create_app_and_account(db_session_with_containers)
        tenant_id = app.tenant_id
        app_id = app.id
        user_id = "user-789"

        non_matching = factory.create_end_user(
            db_session_with_containers,
            tenant_id=tenant_id,
            app_id=app_id,
            session_id=user_id,
            invoke_type=InvokeFrom.WEB_APP,
        )
        matching = factory.create_end_user(
            db_session_with_containers,
            tenant_id=tenant_id,
            app_id=app_id,
            session_id=user_id,
            invoke_type=InvokeFrom.SERVICE_API,
        )

        # Act
        result = EndUserService.get_or_create_end_user_by_type(
            type=InvokeFrom.SERVICE_API,
            tenant_id=tenant_id,
            app_id=app_id,
            user_id=user_id,
        )

        # Assert
        assert result.id == matching.id
        assert result.id != non_matching.id

    def test_external_user_id_matches_session_id(self, db_session_with_containers, factory):
        """Test that external_user_id is set to match session_id."""
        # Arrange
        app = factory.create_app_and_account(db_session_with_containers)
        tenant_id = app.tenant_id
        app_id = app.id
        user_id = "custom-external-id"

        # Act
        result = EndUserService.get_or_create_end_user_by_type(
            type=InvokeFrom.SERVICE_API,
            tenant_id=tenant_id,
            app_id=app_id,
            user_id=user_id,
        )

        # Assert
        assert result.external_user_id == user_id
        assert result.session_id == user_id

    @pytest.mark.parametrize(
        "invoke_type",
        [
            InvokeFrom.SERVICE_API,
            InvokeFrom.WEB_APP,
            InvokeFrom.EXPLORE,
            InvokeFrom.DEBUGGER,
        ],
    )
    def test_create_end_user_with_different_invoke_types(self, db_session_with_containers, invoke_type, factory):
        """Test creating end users with different InvokeFrom types."""
        # Arrange
        app = factory.create_app_and_account(db_session_with_containers)
        tenant_id = app.tenant_id
        app_id = app.id
        user_id = f"user-{uuid4()}"

        # Act
        result = EndUserService.get_or_create_end_user_by_type(
            type=invoke_type,
            tenant_id=tenant_id,
            app_id=app_id,
            user_id=user_id,
        )

        # Assert
        assert result.type == invoke_type


class TestEndUserServiceGetEndUserById:
    """Unit tests for EndUserService.get_end_user_by_id."""

    @pytest.fixture
    def factory(self):
        """Provide test data factory."""
        return TestEndUserServiceFactory()

    def test_get_end_user_by_id_returns_end_user(self, db_session_with_containers, factory):
        app = factory.create_app_and_account(db_session_with_containers)
        existing_user = factory.create_end_user(
            db_session_with_containers,
            tenant_id=app.tenant_id,
            app_id=app.id,
            session_id=f"session-{uuid4()}",
            invoke_type=InvokeFrom.SERVICE_API,
        )

        result = EndUserService.get_end_user_by_id(
            tenant_id=app.tenant_id,
            app_id=app.id,
            end_user_id=existing_user.id,
        )

        assert result is not None
        assert result.id == existing_user.id

    def test_get_end_user_by_id_returns_none(self, db_session_with_containers, factory):
        app = factory.create_app_and_account(db_session_with_containers)

        result = EndUserService.get_end_user_by_id(
            tenant_id=app.tenant_id,
            app_id=app.id,
            end_user_id=str(uuid4()),
        )

        assert result is None
