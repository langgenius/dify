"""Test Dataset API Token permissions fix."""

from unittest.mock import MagicMock, Mock, patch

import pytest
from flask import Flask

from controllers.service_api.wraps import validate_dataset_token
from models.account import Account, Tenant, TenantStatus
from models.model import ApiToken


class TestDatasetTokenPermissions:
    """Test that Dataset API tokens use the correct user context."""

    @pytest.fixture
    def app(self):
        """Create a Flask app for testing."""
        app = Flask(__name__)
        app.config["TESTING"] = True
        return app

    @pytest.fixture
    def mock_db(self):
        """Mock database session."""
        with patch("controllers.service_api.wraps.db") as mock_db:
            yield mock_db

    @pytest.fixture
    def mock_tenant(self):
        """Create a mock tenant."""
        tenant = Mock(spec=Tenant)
        tenant.id = "tenant-123"
        tenant.status = TenantStatus.NORMAL
        return tenant

    @pytest.fixture
    def mock_owner_account(self):
        """Create a mock owner account."""
        account = Mock(spec=Account)
        account.id = "owner-456"
        account.current_role = "owner"
        account.current_tenant = None
        account.current_tenant_id = None
        return account

    @pytest.fixture
    def mock_admin_account(self):
        """Create a mock admin account."""
        account = Mock(spec=Account)
        account.id = "admin-789"
        account.current_role = "admin"
        account.current_tenant = None
        account.current_tenant_id = None
        return account

    @pytest.fixture
    def mock_dataset_operator_account(self):
        """Create a mock dataset operator account."""
        account = Mock(spec=Account)
        account.id = "operator-012"
        account.current_role = "dataset_operator"
        account.current_tenant = None
        account.current_tenant_id = None
        return account

    def test_owner_token_uses_owner_context(self, app, mock_db, mock_tenant, mock_owner_account):
        """Test that a token created by owner uses owner's context."""
        # Arrange
        api_token = Mock(spec=ApiToken)
        api_token.tenant_id = "tenant-123"
        api_token.created_by_account_id = "owner-456"
        api_token.created_by_role = "owner"

        mock_db.session.query.side_effect = [
            # First query for Tenant
            Mock(where=Mock(return_value=Mock(first=Mock(return_value=mock_tenant)))),
            # Second query for Account
            Mock(where=Mock(return_value=Mock(first=Mock(return_value=mock_owner_account)))),
        ]

        with app.app_context():
            with patch("controllers.service_api.wraps.validate_and_get_api_token", return_value=api_token):
                with patch("controllers.service_api.wraps.current_app") as mock_current_app:
                    mock_login_manager = MagicMock()
                    mock_current_app.login_manager = mock_login_manager

                    # Create a decorated function
                    @validate_dataset_token
                    def test_view(tenant_id):
                        return "success"

                    # Act
                    result = test_view()

                    # Assert
                    assert result == "success"
                    # Verify that the owner account was used
                    mock_login_manager._update_request_context_with_user.assert_called_once_with(mock_owner_account)
                    # Verify that tenant was set correctly
                    assert mock_owner_account.current_tenant == mock_tenant
                    assert mock_owner_account.current_tenant_id == "tenant-123"

    def test_admin_token_uses_admin_context(self, app, mock_db, mock_tenant, mock_admin_account):
        """Test that a token created by admin uses admin's context."""
        # Arrange
        api_token = Mock(spec=ApiToken)
        api_token.tenant_id = "tenant-123"
        api_token.created_by_account_id = "admin-789"
        api_token.created_by_role = "admin"

        mock_db.session.query.side_effect = [
            # First query for Tenant
            Mock(where=Mock(return_value=Mock(first=Mock(return_value=mock_tenant)))),
            # Second query for Account
            Mock(where=Mock(return_value=Mock(first=Mock(return_value=mock_admin_account)))),
        ]

        with app.app_context():
            with patch("controllers.service_api.wraps.validate_and_get_api_token", return_value=api_token):
                with patch("controllers.service_api.wraps.current_app") as mock_current_app:
                    mock_login_manager = MagicMock()
                    mock_current_app.login_manager = mock_login_manager

                    # Create a decorated function
                    @validate_dataset_token
                    def test_view(tenant_id):
                        return "success"

                    # Act
                    result = test_view()

                    # Assert
                    assert result == "success"
                    # Verify that the admin account was used (not owner)
                    mock_login_manager._update_request_context_with_user.assert_called_once_with(mock_admin_account)
                    # Verify that tenant was set correctly
                    assert mock_admin_account.current_tenant == mock_tenant
                    assert mock_admin_account.current_tenant_id == "tenant-123"

    def test_dataset_operator_token_uses_operator_context(
        self, app, mock_db, mock_tenant, mock_dataset_operator_account
    ):
        """Test that a token created by dataset_operator uses operator's context."""
        # Arrange
        api_token = Mock(spec=ApiToken)
        api_token.tenant_id = "tenant-123"
        api_token.created_by_account_id = "operator-012"
        api_token.created_by_role = "dataset_operator"

        mock_db.session.query.side_effect = [
            # First query for Tenant
            Mock(where=Mock(return_value=Mock(first=Mock(return_value=mock_tenant)))),
            # Second query for Account
            Mock(where=Mock(return_value=Mock(first=Mock(return_value=mock_dataset_operator_account)))),
        ]

        with app.app_context():
            with patch("controllers.service_api.wraps.validate_and_get_api_token", return_value=api_token):
                with patch("controllers.service_api.wraps.current_app") as mock_current_app:
                    mock_login_manager = MagicMock()
                    mock_current_app.login_manager = mock_login_manager

                    # Create a decorated function
                    @validate_dataset_token
                    def test_view(tenant_id):
                        return "success"

                    # Act
                    result = test_view()

                    # Assert
                    assert result == "success"
                    # Verify that the dataset operator account was used (not owner)
                    mock_login_manager._update_request_context_with_user.assert_called_once_with(
                        mock_dataset_operator_account
                    )
                    # Verify that tenant was set correctly
                    assert mock_dataset_operator_account.current_tenant == mock_tenant
                    assert mock_dataset_operator_account.current_tenant_id == "tenant-123"

    def test_missing_account_raises_unauthorized(self, app, mock_db, mock_tenant):
        """Test that missing creator account raises Unauthorized."""
        # Arrange
        api_token = Mock(spec=ApiToken)
        api_token.tenant_id = "tenant-123"
        api_token.created_by_account_id = "missing-account"
        api_token.created_by_role = "admin"

        mock_db.session.query.side_effect = [
            # First query for Tenant
            Mock(where=Mock(return_value=Mock(first=Mock(return_value=mock_tenant)))),
            # Second query for Account (returns None)
            Mock(where=Mock(return_value=Mock(first=Mock(return_value=None)))),
        ]

        with app.app_context():
            with patch("controllers.service_api.wraps.validate_and_get_api_token", return_value=api_token):
                # Import the exception here to avoid import issues
                from werkzeug.exceptions import Unauthorized

                # Create a decorated function
                @validate_dataset_token
                def test_view(tenant_id):
                    return "success"

                # Act & Assert
                with pytest.raises(Unauthorized, match="Token creator account does not exist"):
                    test_view()

    def test_missing_tenant_raises_unauthorized(self, app, mock_db):
        """Test that missing tenant raises Unauthorized."""
        # Arrange
        api_token = Mock(spec=ApiToken)
        api_token.tenant_id = "tenant-123"
        api_token.created_by_account_id = "owner-456"
        api_token.created_by_role = "owner"

        mock_db.session.query.side_effect = [
            # First query for Tenant (returns None)
            Mock(where=Mock(return_value=Mock(first=Mock(return_value=None)))),
        ]

        with app.app_context():
            with patch("controllers.service_api.wraps.validate_and_get_api_token", return_value=api_token):
                # Import the exception here to avoid import issues
                from werkzeug.exceptions import Unauthorized

                # Create a decorated function
                @validate_dataset_token
                def test_view(tenant_id):
                    return "success"

                # Act & Assert
                with pytest.raises(Unauthorized, match="Tenant does not exist"):
                    test_view()


class TestDatasetApiTokenCreation:
    """Test that Dataset API tokens are created with correct fields."""

    def test_token_creation_populates_creator_fields(self):
        """Test that creating a token populates created_by_account_id and created_by_role."""
        with patch("controllers.console.datasets.datasets.db") as mock_db:
            with patch("controllers.console.datasets.datasets.current_account_with_tenant") as mock_current:
                # Setup mocks
                mock_user = Mock()
                mock_user.id = "user-123"
                mock_user.current_role = "admin"
                mock_user.is_admin_or_owner = True

                mock_current.return_value = (mock_user, "tenant-456")

                # Mock the query count
                mock_db.session.query.return_value.where.return_value.count.return_value = 0

                # Import the class
                from controllers.console.datasets.datasets import DatasetApiKeyApi

                # Create an instance
                api_instance = DatasetApiKeyApi()

                # Act
                with patch.object(ApiToken, "generate_api_key", return_value="dataset-test-key"):
                    # Capture the ApiToken instance that would be created
                    api_token_instance = None

                    def capture_add(token):
                        nonlocal api_token_instance
                        api_token_instance = token

                    mock_db.session.add.side_effect = capture_add

                    # Call the post method
                    result, status_code = api_instance.post()

                    # Assert
                    assert status_code == 200
                    assert api_token_instance is not None
                    assert api_token_instance.created_by_account_id == "user-123"
                    assert api_token_instance.created_by_role == "admin"
                    assert api_token_instance.tenant_id == "tenant-456"
                    assert api_token_instance.type == "dataset"
