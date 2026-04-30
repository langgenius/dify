"""
Container-backed integration tests for dataset permission services on the real SQL path.

This module exercises persisted DatasetPermission rows and dataset permission
checks with testcontainers-backed infrastructure instead of database-chain mocks.
"""

from uuid import uuid4

import pytest
from sqlalchemy.orm import Session

from core.rag.index_processor.constant.index_type import IndexTechniqueType
from extensions.ext_database import db
from models import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.dataset import (
    Dataset,
    DatasetPermission,
    DatasetPermissionEnum,
)
from models.enums import DataSourceType
from services.dataset_service import DatasetPermissionService, DatasetService
from services.errors.account import NoPermissionError


class DatasetPermissionTestDataFactory:
    """Create persisted entities and request payloads for dataset permission integration tests."""

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
        if tenant is None:
            tenant = Tenant(name=f"tenant-{uuid4()}", status="normal")
            db.session.add_all([account, tenant])
        else:
            db.session.add(account)

        db.session.flush()

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
            data_source_type=DataSourceType.UPLOAD_FILE,
            indexing_technique=IndexTechniqueType.HIGH_QUALITY,
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
    def build_user_list_payload(user_ids: list[str]) -> list[dict[str, str]]:
        """Build the request payload shape used by partial-member list updates."""
        return [{"user_id": user_id} for user_id in user_ids]


class TestDatasetPermissionServiceGetPartialMemberList:
    """Verify partial-member list reads against persisted DatasetPermission rows."""

    def test_get_dataset_partial_member_list_with_members(self, db_session_with_containers: Session):
        """
        Test retrieving partial member list with multiple members.
        """
        # Arrange
        owner, tenant = DatasetPermissionTestDataFactory.create_account_with_tenant(role=TenantAccountRole.OWNER)
        user_1, _ = DatasetPermissionTestDataFactory.create_account_with_tenant(
            role=TenantAccountRole.NORMAL,
            tenant=tenant,
        )
        user_2, _ = DatasetPermissionTestDataFactory.create_account_with_tenant(
            role=TenantAccountRole.NORMAL,
            tenant=tenant,
        )
        user_3, _ = DatasetPermissionTestDataFactory.create_account_with_tenant(
            role=TenantAccountRole.NORMAL,
            tenant=tenant,
        )
        dataset = DatasetPermissionTestDataFactory.create_dataset(tenant.id, owner.id)

        expected_account_ids = [user_1.id, user_2.id, user_3.id]
        for account_id in expected_account_ids:
            DatasetPermissionTestDataFactory.create_dataset_permission(dataset.id, account_id, tenant.id)

        # Act
        result = DatasetPermissionService.get_dataset_partial_member_list(dataset.id)

        # Assert
        assert set(result) == set(expected_account_ids)
        assert len(result) == 3

    def test_get_dataset_partial_member_list_with_single_member(self, db_session_with_containers: Session):
        """
        Test retrieving partial member list with single member.
        """
        # Arrange
        owner, tenant = DatasetPermissionTestDataFactory.create_account_with_tenant(role=TenantAccountRole.OWNER)
        user, _ = DatasetPermissionTestDataFactory.create_account_with_tenant(
            role=TenantAccountRole.NORMAL,
            tenant=tenant,
        )
        dataset = DatasetPermissionTestDataFactory.create_dataset(tenant.id, owner.id)

        expected_account_ids = [user.id]
        DatasetPermissionTestDataFactory.create_dataset_permission(dataset.id, user.id, tenant.id)

        # Act
        result = DatasetPermissionService.get_dataset_partial_member_list(dataset.id)

        # Assert
        assert set(result) == set(expected_account_ids)
        assert len(result) == 1

    def test_get_dataset_partial_member_list_empty(self, db_session_with_containers: Session):
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
    """Verify partial-member list updates against persisted DatasetPermission rows."""

    def test_update_partial_member_list_add_new_members(self, db_session_with_containers: Session):
        """
        Test adding new partial members to a dataset.
        """
        # Arrange
        owner, tenant = DatasetPermissionTestDataFactory.create_account_with_tenant(role=TenantAccountRole.OWNER)
        member_1, _ = DatasetPermissionTestDataFactory.create_account_with_tenant(
            role=TenantAccountRole.NORMAL,
            tenant=tenant,
        )
        member_2, _ = DatasetPermissionTestDataFactory.create_account_with_tenant(
            role=TenantAccountRole.NORMAL,
            tenant=tenant,
        )
        dataset = DatasetPermissionTestDataFactory.create_dataset(tenant.id, owner.id)
        user_list = DatasetPermissionTestDataFactory.build_user_list_payload([member_1.id, member_2.id])

        # Act
        DatasetPermissionService.update_partial_member_list(tenant.id, dataset.id, user_list)

        # Assert
        result = DatasetPermissionService.get_dataset_partial_member_list(dataset.id)
        assert set(result) == {member_1.id, member_2.id}

    def test_update_partial_member_list_replace_existing(self, db_session_with_containers: Session):
        """
        Test replacing existing partial members with new ones.
        """
        # Arrange
        owner, tenant = DatasetPermissionTestDataFactory.create_account_with_tenant(role=TenantAccountRole.OWNER)
        old_member_1, _ = DatasetPermissionTestDataFactory.create_account_with_tenant(
            role=TenantAccountRole.NORMAL,
            tenant=tenant,
        )
        old_member_2, _ = DatasetPermissionTestDataFactory.create_account_with_tenant(
            role=TenantAccountRole.NORMAL,
            tenant=tenant,
        )
        new_member_1, _ = DatasetPermissionTestDataFactory.create_account_with_tenant(
            role=TenantAccountRole.NORMAL,
            tenant=tenant,
        )
        new_member_2, _ = DatasetPermissionTestDataFactory.create_account_with_tenant(
            role=TenantAccountRole.NORMAL,
            tenant=tenant,
        )
        dataset = DatasetPermissionTestDataFactory.create_dataset(tenant.id, owner.id)

        old_users = DatasetPermissionTestDataFactory.build_user_list_payload([old_member_1.id, old_member_2.id])
        DatasetPermissionService.update_partial_member_list(tenant.id, dataset.id, old_users)

        new_users = DatasetPermissionTestDataFactory.build_user_list_payload([new_member_1.id, new_member_2.id])

        # Act
        DatasetPermissionService.update_partial_member_list(tenant.id, dataset.id, new_users)

        # Assert
        result = DatasetPermissionService.get_dataset_partial_member_list(dataset.id)
        assert set(result) == {new_member_1.id, new_member_2.id}

    def test_update_partial_member_list_empty_list(self, db_session_with_containers: Session):
        """
        Test updating with empty member list (clearing all members).
        """
        # Arrange
        owner, tenant = DatasetPermissionTestDataFactory.create_account_with_tenant(role=TenantAccountRole.OWNER)
        member_1, _ = DatasetPermissionTestDataFactory.create_account_with_tenant(
            role=TenantAccountRole.NORMAL,
            tenant=tenant,
        )
        member_2, _ = DatasetPermissionTestDataFactory.create_account_with_tenant(
            role=TenantAccountRole.NORMAL,
            tenant=tenant,
        )
        dataset = DatasetPermissionTestDataFactory.create_dataset(tenant.id, owner.id)
        users = DatasetPermissionTestDataFactory.build_user_list_payload([member_1.id, member_2.id])
        DatasetPermissionService.update_partial_member_list(tenant.id, dataset.id, users)

        # Act
        DatasetPermissionService.update_partial_member_list(tenant.id, dataset.id, [])

        # Assert
        result = DatasetPermissionService.get_dataset_partial_member_list(dataset.id)
        assert result == []

    def test_update_partial_member_list_database_error_rollback(self, db_session_with_containers: Session):
        """
        Test error handling and rollback on database error.
        """
        # Arrange
        owner, tenant = DatasetPermissionTestDataFactory.create_account_with_tenant(role=TenantAccountRole.OWNER)
        existing_member, _ = DatasetPermissionTestDataFactory.create_account_with_tenant(
            role=TenantAccountRole.NORMAL,
            tenant=tenant,
        )
        replacement_member, _ = DatasetPermissionTestDataFactory.create_account_with_tenant(
            role=TenantAccountRole.NORMAL,
            tenant=tenant,
        )
        dataset = DatasetPermissionTestDataFactory.create_dataset(tenant.id, owner.id)
        DatasetPermissionService.update_partial_member_list(
            tenant.id,
            dataset.id,
            DatasetPermissionTestDataFactory.build_user_list_payload([existing_member.id]),
        )
        user_list = DatasetPermissionTestDataFactory.build_user_list_payload([replacement_member.id])
        rollback_called = {"count": 0}
        original_rollback = db.session.rollback

        # Act / Assert
        with pytest.MonkeyPatch.context() as mp:

            def _raise_commit():
                raise Exception("Database connection error")

            def _rollback_and_mark():
                rollback_called["count"] += 1
                original_rollback()

            mp.setattr("services.dataset_service.db.session.commit", _raise_commit)
            mp.setattr("services.dataset_service.db.session.rollback", _rollback_and_mark)
            with pytest.raises(Exception, match="Database connection error"):
                DatasetPermissionService.update_partial_member_list(tenant.id, dataset.id, user_list)

        # Assert
        result = DatasetPermissionService.get_dataset_partial_member_list(dataset.id)
        assert rollback_called["count"] == 1
        assert result == [existing_member.id]
        assert db_session_with_containers.query(DatasetPermission).filter_by(dataset_id=dataset.id).count() == 1


class TestDatasetPermissionServiceClearPartialMemberList:
    """Verify partial-member clearing against persisted DatasetPermission rows."""

    def test_clear_partial_member_list_success(self, db_session_with_containers: Session):
        """
        Test successful clearing of partial member list.
        """
        # Arrange
        owner, tenant = DatasetPermissionTestDataFactory.create_account_with_tenant(role=TenantAccountRole.OWNER)
        member_1, _ = DatasetPermissionTestDataFactory.create_account_with_tenant(
            role=TenantAccountRole.NORMAL,
            tenant=tenant,
        )
        member_2, _ = DatasetPermissionTestDataFactory.create_account_with_tenant(
            role=TenantAccountRole.NORMAL,
            tenant=tenant,
        )
        dataset = DatasetPermissionTestDataFactory.create_dataset(tenant.id, owner.id)
        users = DatasetPermissionTestDataFactory.build_user_list_payload([member_1.id, member_2.id])
        DatasetPermissionService.update_partial_member_list(tenant.id, dataset.id, users)

        # Act
        DatasetPermissionService.clear_partial_member_list(dataset.id)

        # Assert
        result = DatasetPermissionService.get_dataset_partial_member_list(dataset.id)
        assert result == []

    def test_clear_partial_member_list_empty_list(self, db_session_with_containers: Session):
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

    def test_clear_partial_member_list_database_error_rollback(self, db_session_with_containers: Session):
        """
        Test error handling and rollback on database error.
        """
        # Arrange
        owner, tenant = DatasetPermissionTestDataFactory.create_account_with_tenant(role=TenantAccountRole.OWNER)
        member_1, _ = DatasetPermissionTestDataFactory.create_account_with_tenant(
            role=TenantAccountRole.NORMAL,
            tenant=tenant,
        )
        member_2, _ = DatasetPermissionTestDataFactory.create_account_with_tenant(
            role=TenantAccountRole.NORMAL,
            tenant=tenant,
        )
        dataset = DatasetPermissionTestDataFactory.create_dataset(tenant.id, owner.id)
        users = DatasetPermissionTestDataFactory.build_user_list_payload([member_1.id, member_2.id])
        DatasetPermissionService.update_partial_member_list(tenant.id, dataset.id, users)
        rollback_called = {"count": 0}
        original_rollback = db.session.rollback

        # Act / Assert
        with pytest.MonkeyPatch.context() as mp:

            def _raise_commit():
                raise Exception("Database connection error")

            def _rollback_and_mark():
                rollback_called["count"] += 1
                original_rollback()

            mp.setattr("services.dataset_service.db.session.commit", _raise_commit)
            mp.setattr("services.dataset_service.db.session.rollback", _rollback_and_mark)
            with pytest.raises(Exception, match="Database connection error"):
                DatasetPermissionService.clear_partial_member_list(dataset.id)

        # Assert
        result = DatasetPermissionService.get_dataset_partial_member_list(dataset.id)
        assert rollback_called["count"] == 1
        assert set(result) == {member_1.id, member_2.id}
        assert db_session_with_containers.query(DatasetPermission).filter_by(dataset_id=dataset.id).count() == 2


class TestDatasetServiceCheckDatasetPermission:
    """Verify dataset access checks against persisted partial-member permissions."""

    def test_check_dataset_permission_different_tenant_should_fail(self, db_session_with_containers: Session):
        """Test that users from different tenants cannot access dataset."""
        owner, tenant = DatasetPermissionTestDataFactory.create_account_with_tenant(role=TenantAccountRole.OWNER)
        other_user, _ = DatasetPermissionTestDataFactory.create_account_with_tenant(role=TenantAccountRole.EDITOR)

        dataset = DatasetPermissionTestDataFactory.create_dataset(
            tenant.id, owner.id, permission=DatasetPermissionEnum.ALL_TEAM
        )

        with pytest.raises(NoPermissionError):
            DatasetService.check_dataset_permission(dataset, other_user)

    def test_check_dataset_permission_owner_can_access_any_dataset(self, db_session_with_containers: Session):
        """Test that tenant owners can access any dataset regardless of permission level."""
        owner, tenant = DatasetPermissionTestDataFactory.create_account_with_tenant(role=TenantAccountRole.OWNER)
        creator, _ = DatasetPermissionTestDataFactory.create_account_with_tenant(
            role=TenantAccountRole.NORMAL, tenant=tenant
        )

        dataset = DatasetPermissionTestDataFactory.create_dataset(
            tenant.id, creator.id, permission=DatasetPermissionEnum.ONLY_ME
        )

        DatasetService.check_dataset_permission(dataset, owner)

    def test_check_dataset_permission_only_me_creator_can_access(self, db_session_with_containers: Session):
        """Test ONLY_ME permission allows only the dataset creator to access."""
        creator, tenant = DatasetPermissionTestDataFactory.create_account_with_tenant(role=TenantAccountRole.EDITOR)

        dataset = DatasetPermissionTestDataFactory.create_dataset(
            tenant.id, creator.id, permission=DatasetPermissionEnum.ONLY_ME
        )

        DatasetService.check_dataset_permission(dataset, creator)

    def test_check_dataset_permission_only_me_others_cannot_access(self, db_session_with_containers: Session):
        """Test ONLY_ME permission denies access to non-creators."""
        creator, tenant = DatasetPermissionTestDataFactory.create_account_with_tenant(role=TenantAccountRole.NORMAL)
        other, _ = DatasetPermissionTestDataFactory.create_account_with_tenant(
            role=TenantAccountRole.NORMAL, tenant=tenant
        )

        dataset = DatasetPermissionTestDataFactory.create_dataset(
            tenant.id, creator.id, permission=DatasetPermissionEnum.ONLY_ME
        )

        with pytest.raises(NoPermissionError):
            DatasetService.check_dataset_permission(dataset, other)

    def test_check_dataset_permission_all_team_allows_access(self, db_session_with_containers: Session):
        """Test ALL_TEAM permission allows any team member to access the dataset."""
        creator, tenant = DatasetPermissionTestDataFactory.create_account_with_tenant(role=TenantAccountRole.NORMAL)
        member, _ = DatasetPermissionTestDataFactory.create_account_with_tenant(
            role=TenantAccountRole.NORMAL, tenant=tenant
        )

        dataset = DatasetPermissionTestDataFactory.create_dataset(
            tenant.id, creator.id, permission=DatasetPermissionEnum.ALL_TEAM
        )

        DatasetService.check_dataset_permission(dataset, member)

    def test_check_dataset_permission_partial_members_with_permission_success(
        self, db_session_with_containers: Session
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
        DatasetService.check_dataset_permission(dataset, user)

        # Assert
        permissions = DatasetPermissionService.get_dataset_partial_member_list(dataset.id)
        assert user.id in permissions

    def test_check_dataset_permission_partial_members_without_permission_error(
        self, db_session_with_containers: Session
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
            DatasetService.check_dataset_permission(dataset, user)

    def test_check_dataset_permission_partial_team_creator_can_access(self, db_session_with_containers: Session):
        """Test PARTIAL_TEAM permission allows creator to access without explicit permission."""
        creator, tenant = DatasetPermissionTestDataFactory.create_account_with_tenant(role=TenantAccountRole.EDITOR)

        dataset = DatasetPermissionTestDataFactory.create_dataset(
            tenant.id, creator.id, permission=DatasetPermissionEnum.PARTIAL_TEAM
        )

        DatasetService.check_dataset_permission(dataset, creator)


class TestDatasetServiceCheckDatasetOperatorPermission:
    """Verify operator permission checks against persisted partial-member permissions."""

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
