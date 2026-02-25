"""
Comprehensive integration tests for DatasetPermissionService and DatasetService permission methods.

This module contains extensive testcontainers-backed integration tests for dataset
permission management, including partial member list operations, permission
validation, and permission enum handling.
"""

from uuid import uuid4

import pytest

from extensions.ext_database import db
from models import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.dataset import (
    Dataset,
    DatasetPermission,
    DatasetPermissionEnum,
)
from services.dataset_service import DatasetPermissionService, DatasetService
from services.errors.account import NoPermissionError


class DatasetPermissionTestDataFactory:
    """
    Factory class for creating test data and mock objects for dataset permission tests.

    This factory provides static methods to create mock objects for:
    - Dataset instances with various permission configurations
    - User/Account instances with different roles and permissions
    - DatasetPermission instances
    - Permission enum values
    - Database query results

    The factory methods help maintain consistency across tests and reduce
    code duplication when setting up test scenarios.
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
        permission: DatasetPermissionEnum = DatasetPermissionEnum.ONLY_ME,
        name: str = "Test Dataset",
    ) -> Dataset:
        """Create a real dataset with specified attributes."""
        dataset = Dataset(
            tenant_id=tenant_id,
            name=name,
            description="desc",
            data_source_type="upload_file",
            indexing_technique="high_quality",
            created_by=created_by,
            permission=permission,
            provider="vendor",
            retrieval_model={"top_k": 2},
        )
        db.session.add(dataset)
        db.session.commit()
        return dataset

    @staticmethod
    def create_dataset_permission(
        dataset_id: str,
        account_id: str,
        tenant_id: str,
        has_permission: bool = True,
    ) -> DatasetPermission:
        """Create a real DatasetPermission instance."""
        permission = DatasetPermission(
            dataset_id=dataset_id,
            account_id=account_id,
            tenant_id=tenant_id,
            has_permission=has_permission,
        )
        db.session.add(permission)
        db.session.commit()
        return permission

    @staticmethod
    def create_user_list_mock(user_ids: list[str]) -> list[dict[str, str]]:
        """
        Create a list of user dictionaries for partial member list operations.

        Args:
            user_ids: List of user IDs to include

        Returns:
            List of user dictionaries with "user_id" keys
        """
        return [{"user_id": user_id} for user_id in user_ids]


class TestDatasetPermissionServiceGetPartialMemberList:
    """
    Comprehensive integration tests for DatasetPermissionService.get_dataset_partial_member_list method.
    """

    def test_get_dataset_partial_member_list_with_members(self, db_session_with_containers):
        """
        Test retrieving partial member list with multiple members.
        """
        # Arrange
        owner, tenant = DatasetPermissionTestDataFactory.create_account_with_tenant(role=TenantAccountRole.OWNER)
        user_1, _ = DatasetPermissionTestDataFactory.create_account_with_tenant(role=TenantAccountRole.NORMAL)
        user_2, _ = DatasetPermissionTestDataFactory.create_account_with_tenant(role=TenantAccountRole.NORMAL)
        user_3, _ = DatasetPermissionTestDataFactory.create_account_with_tenant(role=TenantAccountRole.NORMAL)
        dataset = DatasetPermissionTestDataFactory.create_dataset(tenant.id, owner.id)

        expected_account_ids = [user_1.id, user_2.id, user_3.id]
        for account_id in expected_account_ids:
            DatasetPermissionTestDataFactory.create_dataset_permission(dataset.id, account_id, tenant.id)

        # Act
        result = DatasetPermissionService.get_dataset_partial_member_list(dataset.id)

        # Assert
        assert set(result) == set(expected_account_ids)
        assert len(result) == 3

    def test_get_dataset_partial_member_list_with_single_member(self, db_session_with_containers):
        """
        Test retrieving partial member list with single member.
        """
        # Arrange
        owner, tenant = DatasetPermissionTestDataFactory.create_account_with_tenant(role=TenantAccountRole.OWNER)
        user, _ = DatasetPermissionTestDataFactory.create_account_with_tenant(role=TenantAccountRole.NORMAL)
        dataset = DatasetPermissionTestDataFactory.create_dataset(tenant.id, owner.id)

        expected_account_ids = [user.id]
        DatasetPermissionTestDataFactory.create_dataset_permission(dataset.id, user.id, tenant.id)

        # Act
        result = DatasetPermissionService.get_dataset_partial_member_list(dataset.id)

        # Assert
        assert result == expected_account_ids
        assert len(result) == 1

    def test_get_dataset_partial_member_list_empty(self, db_session_with_containers):
        """
        Test retrieving partial member list when no members exist.
        """
        # Arrange
        owner, tenant = DatasetPermissionTestDataFactory.create_account_with_tenant(role=TenantAccountRole.OWNER)
        dataset = DatasetPermissionTestDataFactory.create_dataset(tenant.id, owner.id)

        # Act
        result = DatasetPermissionService.get_dataset_partial_member_list(dataset.id)

        # Assert
        assert result == []
        assert len(result) == 0


class TestDatasetPermissionServiceUpdatePartialMemberList:
    """
    Comprehensive unit tests for DatasetPermissionService.update_partial_member_list method.
    """

    def test_update_partial_member_list_add_new_members(self, db_session_with_containers):
        """
        Test adding new partial members to a dataset.
        """
        # Arrange
        owner, tenant = DatasetPermissionTestDataFactory.create_account_with_tenant(role=TenantAccountRole.OWNER)
        dataset = DatasetPermissionTestDataFactory.create_dataset(tenant.id, owner.id)
        user_list = DatasetPermissionTestDataFactory.create_user_list_mock([str(uuid4()), str(uuid4())])

        # Act
        DatasetPermissionService.update_partial_member_list(tenant.id, dataset.id, user_list)

        # Assert
        result = DatasetPermissionService.get_dataset_partial_member_list(dataset.id)
        assert set(result) == {user["user_id"] for user in user_list}

    def test_update_partial_member_list_replace_existing(self, db_session_with_containers):
        """
        Test replacing existing partial members with new ones.
        """
        # Arrange
        owner, tenant = DatasetPermissionTestDataFactory.create_account_with_tenant(role=TenantAccountRole.OWNER)
        dataset = DatasetPermissionTestDataFactory.create_dataset(tenant.id, owner.id)

        old_users = DatasetPermissionTestDataFactory.create_user_list_mock([str(uuid4()), str(uuid4())])
        DatasetPermissionService.update_partial_member_list(tenant.id, dataset.id, old_users)

        new_users = DatasetPermissionTestDataFactory.create_user_list_mock([str(uuid4()), str(uuid4())])

        # Act
        DatasetPermissionService.update_partial_member_list(tenant.id, dataset.id, new_users)

        # Assert
        result = DatasetPermissionService.get_dataset_partial_member_list(dataset.id)
        assert set(result) == {user["user_id"] for user in new_users}

    def test_update_partial_member_list_empty_list(self, db_session_with_containers):
        """
        Test updating with empty member list (clearing all members).
        """
        # Arrange
        owner, tenant = DatasetPermissionTestDataFactory.create_account_with_tenant(role=TenantAccountRole.OWNER)
        dataset = DatasetPermissionTestDataFactory.create_dataset(tenant.id, owner.id)
        users = DatasetPermissionTestDataFactory.create_user_list_mock([str(uuid4()), str(uuid4())])
        DatasetPermissionService.update_partial_member_list(tenant.id, dataset.id, users)

        # Act
        DatasetPermissionService.update_partial_member_list(tenant.id, dataset.id, [])

        # Assert
        result = DatasetPermissionService.get_dataset_partial_member_list(dataset.id)
        assert result == []

    def test_update_partial_member_list_database_error_rollback(self, db_session_with_containers):
        """
        Test error handling and rollback on database error.
        """
        # Arrange
        owner, tenant = DatasetPermissionTestDataFactory.create_account_with_tenant(role=TenantAccountRole.OWNER)
        dataset = DatasetPermissionTestDataFactory.create_dataset(tenant.id, owner.id)
        user_list = DatasetPermissionTestDataFactory.create_user_list_mock([str(uuid4())])
        rollback_called = {"called": False}

        # Act & Assert
        with pytest.MonkeyPatch.context() as mp:

            def _raise_commit():
                raise Exception("Database connection error")

            def _mark_rollback():
                rollback_called["called"] = True

            mp.setattr("services.dataset_service.db.session.commit", _raise_commit)
            mp.setattr("services.dataset_service.db.session.rollback", _mark_rollback)
            with pytest.raises(Exception, match="Database connection error"):
                DatasetPermissionService.update_partial_member_list(tenant.id, dataset.id, user_list)

        assert rollback_called["called"] is True


class TestDatasetPermissionServiceClearPartialMemberList:
    """
    Comprehensive unit tests for DatasetPermissionService.clear_partial_member_list method.
    """

    def test_clear_partial_member_list_success(self, db_session_with_containers):
        """
        Test successful clearing of partial member list.
        """
        # Arrange
        owner, tenant = DatasetPermissionTestDataFactory.create_account_with_tenant(role=TenantAccountRole.OWNER)
        dataset = DatasetPermissionTestDataFactory.create_dataset(tenant.id, owner.id)
        users = DatasetPermissionTestDataFactory.create_user_list_mock([str(uuid4()), str(uuid4())])
        DatasetPermissionService.update_partial_member_list(tenant.id, dataset.id, users)

        # Act
        DatasetPermissionService.clear_partial_member_list(dataset.id)

        # Assert
        result = DatasetPermissionService.get_dataset_partial_member_list(dataset.id)
        assert result == []

    def test_clear_partial_member_list_empty_list(self, db_session_with_containers):
        """
        Test clearing partial member list when no members exist.
        """
        # Arrange
        owner, tenant = DatasetPermissionTestDataFactory.create_account_with_tenant(role=TenantAccountRole.OWNER)
        dataset = DatasetPermissionTestDataFactory.create_dataset(tenant.id, owner.id)

        # Act
        DatasetPermissionService.clear_partial_member_list(dataset.id)

        # Assert
        result = DatasetPermissionService.get_dataset_partial_member_list(dataset.id)
        assert result == []

    def test_clear_partial_member_list_database_error_rollback(self, db_session_with_containers):
        """
        Test error handling and rollback on database error.
        """
        # Arrange
        owner, tenant = DatasetPermissionTestDataFactory.create_account_with_tenant(role=TenantAccountRole.OWNER)
        dataset = DatasetPermissionTestDataFactory.create_dataset(tenant.id, owner.id)
        rollback_called = {"called": False}

        # Act & Assert
        with pytest.MonkeyPatch.context() as mp:

            def _raise_commit():
                raise Exception("Database connection error")

            def _mark_rollback():
                rollback_called["called"] = True

            mp.setattr("services.dataset_service.db.session.commit", _raise_commit)
            mp.setattr("services.dataset_service.db.session.rollback", _mark_rollback)
            with pytest.raises(Exception, match="Database connection error"):
                DatasetPermissionService.clear_partial_member_list(dataset.id)

        assert rollback_called["called"] is True


class TestDatasetServiceCheckDatasetPermission:
    """
    Comprehensive unit tests for DatasetService.check_dataset_permission method.
    """

    def test_check_dataset_permission_partial_members_with_permission_success(self, db_session_with_containers):
        """
        Test that user with explicit permission can access partial_members dataset.
        """
        # Arrange
        owner, tenant = DatasetPermissionTestDataFactory.create_account_with_tenant(role=TenantAccountRole.OWNER)
        user, _ = DatasetPermissionTestDataFactory.create_account_with_tenant(
            role=TenantAccountRole.NORMAL,
            tenant=tenant,
        )

        dataset = DatasetPermissionTestDataFactory.create_dataset(
            tenant.id,
            owner.id,
            permission=DatasetPermissionEnum.PARTIAL_TEAM,
        )
        DatasetPermissionTestDataFactory.create_dataset_permission(dataset.id, user.id, tenant.id)

        # Act (should not raise)
        DatasetService.check_dataset_permission(dataset, user)

        # Assert
        permissions = DatasetPermissionService.get_dataset_partial_member_list(dataset.id)
        assert user.id in permissions

    def test_check_dataset_permission_partial_members_without_permission_error(self, db_session_with_containers):
        """
        Test error when user without permission tries to access partial_members dataset.
        """
        # Arrange
        owner, tenant = DatasetPermissionTestDataFactory.create_account_with_tenant(role=TenantAccountRole.OWNER)
        user, _ = DatasetPermissionTestDataFactory.create_account_with_tenant(
            role=TenantAccountRole.NORMAL,
            tenant=tenant,
        )

        dataset = DatasetPermissionTestDataFactory.create_dataset(
            tenant.id,
            owner.id,
            permission=DatasetPermissionEnum.PARTIAL_TEAM,
        )

        # Act & Assert
        with pytest.raises(NoPermissionError, match="You do not have permission to access this dataset"):
            DatasetService.check_dataset_permission(dataset, user)


class TestDatasetServiceCheckDatasetOperatorPermission:
    """
    Comprehensive unit tests for DatasetService.check_dataset_operator_permission method.
    """

    def test_check_dataset_operator_permission_partial_members_with_permission_success(
        self, db_session_with_containers
    ):
        """
        Test that user with explicit permission can access partial_members dataset.
        """
        # Arrange
        owner, tenant = DatasetPermissionTestDataFactory.create_account_with_tenant(role=TenantAccountRole.OWNER)
        user, _ = DatasetPermissionTestDataFactory.create_account_with_tenant(
            role=TenantAccountRole.NORMAL,
            tenant=tenant,
        )

        dataset = DatasetPermissionTestDataFactory.create_dataset(
            tenant.id,
            owner.id,
            permission=DatasetPermissionEnum.PARTIAL_TEAM,
        )
        DatasetPermissionTestDataFactory.create_dataset_permission(dataset.id, user.id, tenant.id)

        # Act (should not raise)
        DatasetService.check_dataset_operator_permission(user=user, dataset=dataset)

        # Assert
        permissions = DatasetPermissionService.get_dataset_partial_member_list(dataset.id)
        assert user.id in permissions

    def test_check_dataset_operator_permission_partial_members_without_permission_error(
        self, db_session_with_containers
    ):
        """
        Test error when user without permission tries to access partial_members dataset.
        """
        # Arrange
        owner, tenant = DatasetPermissionTestDataFactory.create_account_with_tenant(role=TenantAccountRole.OWNER)
        user, _ = DatasetPermissionTestDataFactory.create_account_with_tenant(
            role=TenantAccountRole.NORMAL,
            tenant=tenant,
        )

        dataset = DatasetPermissionTestDataFactory.create_dataset(
            tenant.id,
            owner.id,
            permission=DatasetPermissionEnum.PARTIAL_TEAM,
        )

        # Act & Assert
        with pytest.raises(NoPermissionError, match="You do not have permission to access this dataset"):
            DatasetService.check_dataset_operator_permission(user=user, dataset=dataset)
