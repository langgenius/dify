"""
Integration tests for DatasetService update and delete operations using a real database.

This module contains comprehensive integration tests for the DatasetService class,
specifically focusing on update and delete operations for datasets backed by Testcontainers.
"""

import datetime
from unittest.mock import patch
from uuid import uuid4

import pytest
from werkzeug.exceptions import NotFound

from extensions.ext_database import db
from models import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.dataset import AppDatasetJoin, Dataset, DatasetPermissionEnum
from models.model import App
from services.dataset_service import DatasetService
from services.errors.account import NoPermissionError


class DatasetUpdateDeleteTestDataFactory:
    """
    Factory class for creating test data and mock objects for dataset update/delete tests.
    """

    @staticmethod
    def create_account_with_tenant(
        role: TenantAccountRole = TenantAccountRole.NORMAL,
        tenant: Tenant | None = None,
    ) -> tuple[Account, Tenant]:
        """Create a real account and tenant with specified role."""
        account = Account(
            email=f"{uuid4()}@example.com",
            name=f"user-{uuid4()}",
            interface_language="en-US",
            status="active",
        )
        db.session.add(account)
        db.session.commit()

        if tenant is None:
            tenant = Tenant(name=f"tenant-{uuid4()}", status="normal")
            db.session.add(tenant)
            db.session.commit()

        join = TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            role=role,
            current=True,
        )
        db.session.add(join)
        db.session.commit()

        account.current_tenant = tenant
        return account, tenant

    @staticmethod
    def create_dataset(
        tenant_id: str,
        created_by: str,
        name: str = "Test Dataset",
        enable_api: bool = True,
        permission: DatasetPermissionEnum = DatasetPermissionEnum.ONLY_ME,
    ) -> Dataset:
        """Create a real dataset with specified attributes."""
        dataset = Dataset(
            tenant_id=tenant_id,
            name=name,
            description="Test description",
            data_source_type="upload_file",
            indexing_technique="high_quality",
            created_by=created_by,
            permission=permission,
            provider="vendor",
            retrieval_model={"top_k": 2},
            enable_api=enable_api,
        )
        db.session.add(dataset)
        db.session.commit()
        return dataset

    @staticmethod
    def create_app(tenant_id: str, created_by: str, name: str = "Test App") -> App:
        """Create a real app for AppDatasetJoin."""
        app = App(
            tenant_id=tenant_id,
            name=name,
            mode="chat",
            icon_type="emoji",
            icon="icon",
            icon_background="#FFFFFF",
            enable_site=True,
            enable_api=True,
            created_by=created_by,
        )
        db.session.add(app)
        db.session.commit()
        return app

    @staticmethod
    def create_app_dataset_join(app_id: str, dataset_id: str) -> AppDatasetJoin:
        """Create a real AppDatasetJoin record."""
        join = AppDatasetJoin(app_id=app_id, dataset_id=dataset_id)
        db.session.add(join)
        db.session.commit()
        return join


class TestDatasetServiceDeleteDataset:
    """
    Comprehensive integration tests for DatasetService.delete_dataset method.
    """

    def test_delete_dataset_success(self, db_session_with_containers):
        """
        Test successful deletion of a dataset.

        Verifies that when all validation passes, a dataset is deleted
        correctly with proper event signaling and database cleanup.

        This test ensures:
        - Dataset is retrieved correctly
        - Permission is checked
        - Event is sent for cleanup
        - Dataset is deleted from database
        - Transaction is committed
        - Method returns True
        """
        # Arrange
        owner, tenant = DatasetUpdateDeleteTestDataFactory.create_account_with_tenant(role=TenantAccountRole.OWNER)
        dataset = DatasetUpdateDeleteTestDataFactory.create_dataset(tenant.id, owner.id)

        # Act
        with patch("services.dataset_service.dataset_was_deleted") as mock_dataset_was_deleted:
            result = DatasetService.delete_dataset(dataset.id, owner)

        # Assert
        assert result is True
        assert db.session.get(Dataset, dataset.id) is None
        mock_dataset_was_deleted.send.assert_called_once_with(dataset)

    def test_delete_dataset_not_found(self, db_session_with_containers):
        """
        Test handling when dataset is not found.

        Verifies that when the dataset ID doesn't exist, the method
        returns False without performing any operations.

        This test ensures:
        - Method returns False when dataset not found
        - No permission checks are performed
        - No events are sent
        - No database operations are performed
        """
        # Arrange
        owner, _ = DatasetUpdateDeleteTestDataFactory.create_account_with_tenant(role=TenantAccountRole.OWNER)
        dataset_id = str(uuid4())

        # Act
        result = DatasetService.delete_dataset(dataset_id, owner)

        # Assert
        assert result is False

    def test_delete_dataset_permission_denied_error(self, db_session_with_containers):
        """
        Test error handling when user lacks permission.

        Verifies that when the user doesn't have permission to delete
        the dataset, a NoPermissionError is raised.

        This test ensures:
        - Permission validation works correctly
        - Error is raised before deletion
        - No database operations are performed
        """
        # Arrange
        owner, tenant = DatasetUpdateDeleteTestDataFactory.create_account_with_tenant(role=TenantAccountRole.OWNER)
        normal_user, _ = DatasetUpdateDeleteTestDataFactory.create_account_with_tenant(
            role=TenantAccountRole.NORMAL,
            tenant=tenant,
        )
        dataset = DatasetUpdateDeleteTestDataFactory.create_dataset(tenant.id, owner.id)

        # Act & Assert
        with pytest.raises(NoPermissionError):
            DatasetService.delete_dataset(dataset.id, normal_user)

        # Verify no deletion was attempted
        assert db.session.get(Dataset, dataset.id) is not None


class TestDatasetServiceDatasetUseCheck:
    """
    Comprehensive integration tests for DatasetService.dataset_use_check method.
    """

    def test_dataset_use_check_in_use(self, db_session_with_containers):
        """
        Test detection when dataset is in use.

        Verifies that when a dataset has associated AppDatasetJoin records,
        the method returns True.

        This test ensures:
        - Query is constructed correctly
        - True is returned when dataset is in use
        - Database query is executed
        """
        # Arrange
        owner, tenant = DatasetUpdateDeleteTestDataFactory.create_account_with_tenant(role=TenantAccountRole.OWNER)
        dataset = DatasetUpdateDeleteTestDataFactory.create_dataset(tenant.id, owner.id)
        app = DatasetUpdateDeleteTestDataFactory.create_app(tenant.id, owner.id)
        DatasetUpdateDeleteTestDataFactory.create_app_dataset_join(app.id, dataset.id)

        # Act
        result = DatasetService.dataset_use_check(dataset.id)

        # Assert
        assert result is True

    def test_dataset_use_check_not_in_use(self, db_session_with_containers):
        """
        Test detection when dataset is not in use.

        Verifies that when a dataset has no associated AppDatasetJoin records,
        the method returns False.

        This test ensures:
        - Query is constructed correctly
        - False is returned when dataset is not in use
        - Database query is executed
        """
        # Arrange
        owner, tenant = DatasetUpdateDeleteTestDataFactory.create_account_with_tenant(role=TenantAccountRole.OWNER)
        dataset = DatasetUpdateDeleteTestDataFactory.create_dataset(tenant.id, owner.id)

        # Act
        result = DatasetService.dataset_use_check(dataset.id)

        # Assert
        assert result is False


class TestDatasetServiceUpdateDatasetApiStatus:
    """
    Comprehensive integration tests for DatasetService.update_dataset_api_status method.
    """

    def test_update_dataset_api_status_enable_success(self, db_session_with_containers):
        """
        Test successful enabling of dataset API access.

        Verifies that when all validation passes, the dataset's API
        access is enabled and the update is committed.

        This test ensures:
        - Dataset is retrieved correctly
        - enable_api is set to True
        - updated_by and updated_at are set
        - Transaction is committed
        """
        # Arrange
        owner, tenant = DatasetUpdateDeleteTestDataFactory.create_account_with_tenant(role=TenantAccountRole.OWNER)
        dataset = DatasetUpdateDeleteTestDataFactory.create_dataset(tenant.id, owner.id, enable_api=False)
        current_time = datetime.datetime(2023, 1, 1, 12, 0, 0)

        # Act
        with (
            patch("services.dataset_service.current_user", owner),
            patch("services.dataset_service.naive_utc_now", return_value=current_time),
        ):
            DatasetService.update_dataset_api_status(dataset.id, True)

        # Assert
        db.session.refresh(dataset)
        assert dataset.enable_api is True
        assert dataset.updated_by == owner.id
        assert dataset.updated_at == current_time

    def test_update_dataset_api_status_disable_success(self, db_session_with_containers):
        """
        Test successful disabling of dataset API access.

        Verifies that when all validation passes, the dataset's API
        access is disabled and the update is committed.

        This test ensures:
        - Dataset is retrieved correctly
        - enable_api is set to False
        - updated_by and updated_at are set
        - Transaction is committed
        """
        # Arrange
        owner, tenant = DatasetUpdateDeleteTestDataFactory.create_account_with_tenant(role=TenantAccountRole.OWNER)
        dataset = DatasetUpdateDeleteTestDataFactory.create_dataset(tenant.id, owner.id, enable_api=True)
        current_time = datetime.datetime(2023, 1, 1, 12, 0, 0)

        # Act
        with (
            patch("services.dataset_service.current_user", owner),
            patch("services.dataset_service.naive_utc_now", return_value=current_time),
        ):
            DatasetService.update_dataset_api_status(dataset.id, False)

        # Assert
        db.session.refresh(dataset)
        assert dataset.enable_api is False
        assert dataset.updated_by == owner.id

    def test_update_dataset_api_status_not_found_error(self, db_session_with_containers):
        """
        Test error handling when dataset is not found.

        Verifies that when the dataset ID doesn't exist, a NotFound
        exception is raised.

        This test ensures:
        - NotFound exception is raised
        - No updates are performed
        - Error message is appropriate
        """
        # Arrange
        dataset_id = str(uuid4())

        # Act & Assert
        with pytest.raises(NotFound, match="Dataset not found"):
            DatasetService.update_dataset_api_status(dataset_id, True)

    def test_update_dataset_api_status_missing_current_user_error(self, db_session_with_containers):
        """
        Test error handling when current_user is missing.

        Verifies that when current_user is None or has no ID, a ValueError
        is raised.

        This test ensures:
        - ValueError is raised when current_user is None
        - Error message is clear
        - No updates are committed
        """
        # Arrange
        owner, tenant = DatasetUpdateDeleteTestDataFactory.create_account_with_tenant(role=TenantAccountRole.OWNER)
        dataset = DatasetUpdateDeleteTestDataFactory.create_dataset(tenant.id, owner.id, enable_api=False)

        # Act & Assert
        with (
            patch("services.dataset_service.current_user", None),
            pytest.raises(ValueError, match="Current user or current user id not found"),
        ):
            DatasetService.update_dataset_api_status(dataset.id, True)

        # Verify no commit was attempted
        db.session.rollback()
        db.session.refresh(dataset)
        assert dataset.enable_api is False
