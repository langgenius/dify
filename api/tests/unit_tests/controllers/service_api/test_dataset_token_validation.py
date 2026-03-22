"""Tests for dataset token validation with dataset-scoped API keys."""

from unittest.mock import MagicMock, patch

import pytest
from werkzeug.exceptions import Forbidden

from controllers.service_api.wraps import validate_dataset_token


class TestDatasetScopedKeyPermission:
    """Test dataset-scoped API key permission checks in validate_dataset_token decorator."""

    @pytest.fixture
    def mock_api_token_tenant_level(self):
        """Create a mock tenant-level API token (app_id is None)."""
        token = MagicMock()
        token.app_id = None
        token.tenant_id = "tenant-123"
        token.type = "dataset"
        return token

    @pytest.fixture
    def mock_api_token_dataset_scoped(self):
        """Create a mock dataset-scoped API token (app_id stores dataset_id)."""
        token = MagicMock()
        token.app_id = "dataset-456"
        token.tenant_id = "tenant-123"
        token.type = "dataset"
        return token

    @pytest.fixture
    def mock_dataset(self):
        """Create a mock dataset."""
        dataset = MagicMock()
        dataset.id = "dataset-456"
        dataset.enable_api = True
        return dataset

    @pytest.fixture
    def mock_tenant_account_join(self):
        """Create mock tenant and account join."""
        tenant = MagicMock()
        tenant.id = "tenant-123"

        ta = MagicMock()
        ta.account_id = "account-789"

        return (tenant, ta)

    @pytest.fixture
    def mock_account(self):
        """Create a mock account."""
        account = MagicMock()
        account.id = "account-789"
        return account

    def test_tenant_level_key_can_access_any_dataset(
        self, mock_api_token_tenant_level, mock_dataset, mock_tenant_account_join, mock_account
    ):
        """Test that tenant-level API key can access any dataset."""

        @validate_dataset_token
        def protected_view(tenant_id, dataset_id):
            return "success"

        with (
            patch("controllers.service_api.wraps.validate_and_get_api_token", return_value=mock_api_token_tenant_level),
            patch("controllers.service_api.wraps.db") as mock_db,
            patch("controllers.service_api.wraps.current_app") as mock_current_app,
            patch("controllers.service_api.wraps.user_logged_in"),
            patch("controllers.service_api.wraps.current_user"),
        ):
            # Setup mock database queries
            mock_db.session.query.return_value.where.return_value.first.return_value = mock_dataset
            query_chain = mock_db.session.query.return_value.where.return_value
            query_chain.where.return_value.where.return_value.where.return_value.one_or_none.return_value = (
                mock_tenant_account_join
            )
            mock_db.session.query.return_value.where.return_value.first.side_effect = [mock_dataset, mock_account]

            result = protected_view(dataset_id="dataset-456")

            assert result == "success"

    def test_dataset_scoped_key_can_access_bound_dataset(
        self, mock_api_token_dataset_scoped, mock_dataset, mock_tenant_account_join, mock_account
    ):
        """Test that dataset-scoped API key can access its bound dataset."""

        @validate_dataset_token
        def protected_view(tenant_id, dataset_id):
            return "success"

        with (
            patch(
                "controllers.service_api.wraps.validate_and_get_api_token", return_value=mock_api_token_dataset_scoped
            ),
            patch("controllers.service_api.wraps.db") as mock_db,
            patch("controllers.service_api.wraps.current_app") as mock_current_app,
            patch("controllers.service_api.wraps.user_logged_in"),
            patch("controllers.service_api.wraps.current_user"),
        ):
            # Setup mock database queries
            mock_db.session.query.return_value.where.return_value.first.return_value = mock_dataset
            query_chain = mock_db.session.query.return_value.where.return_value
            query_chain.where.return_value.where.return_value.where.return_value.one_or_none.return_value = (
                mock_tenant_account_join
            )
            mock_db.session.query.return_value.where.return_value.first.side_effect = [mock_dataset, mock_account]

            # Access the bound dataset (dataset-456)
            result = protected_view(dataset_id="dataset-456")

            assert result == "success"

    def test_dataset_scoped_key_cannot_access_other_dataset(self, mock_api_token_dataset_scoped, mock_dataset):
        """Test that dataset-scoped API key cannot access other datasets."""

        @validate_dataset_token
        def protected_view(tenant_id, dataset_id):
            return "success"

        # Create a different dataset
        other_dataset = MagicMock()
        other_dataset.id = "dataset-999"
        other_dataset.enable_api = True

        with (
            patch(
                "controllers.service_api.wraps.validate_and_get_api_token", return_value=mock_api_token_dataset_scoped
            ),
            patch("controllers.service_api.wraps.db") as mock_db,
        ):
            mock_db.session.query.return_value.where.return_value.first.return_value = other_dataset

            # Try to access a different dataset (dataset-999) with key bound to dataset-456
            with pytest.raises(Forbidden) as exc_info:
                protected_view(dataset_id="dataset-999")

            assert "not authorized for this dataset" in str(exc_info.value.description)

    def test_dataset_scoped_key_cannot_access_tenant_level_endpoints(self, mock_api_token_dataset_scoped):
        """Test that dataset-scoped API key cannot access tenant-level endpoints (no dataset_id)."""

        @validate_dataset_token
        def tenant_level_view(tenant_id):
            return "success"

        with patch(
            "controllers.service_api.wraps.validate_and_get_api_token", return_value=mock_api_token_dataset_scoped
        ):
            # Try to access tenant-level endpoint (no dataset_id)
            with pytest.raises(Forbidden) as exc_info:
                tenant_level_view()

            assert "cannot access tenant-level endpoints" in str(exc_info.value.description)

    def test_tenant_level_key_can_access_tenant_level_endpoints(
        self, mock_api_token_tenant_level, mock_tenant_account_join, mock_account
    ):
        """Test that tenant-level API key can access tenant-level endpoints."""

        @validate_dataset_token
        def tenant_level_view(tenant_id):
            return "success"

        with (
            patch("controllers.service_api.wraps.validate_and_get_api_token", return_value=mock_api_token_tenant_level),
            patch("controllers.service_api.wraps.db") as mock_db,
            patch("controllers.service_api.wraps.current_app") as mock_current_app,
            patch("controllers.service_api.wraps.user_logged_in"),
            patch("controllers.service_api.wraps.current_user"),
        ):
            query_chain = mock_db.session.query.return_value.where.return_value
            query_chain.where.return_value.where.return_value.where.return_value.one_or_none.return_value = (
                mock_tenant_account_join
            )
            mock_db.session.query.return_value.where.return_value.first.return_value = mock_account

            result = tenant_level_view()

            assert result == "success"
