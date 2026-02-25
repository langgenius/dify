"""
Comprehensive integration tests for DatasetService retrieval/list methods.

This test suite covers:
- get_datasets - pagination, search, filtering, permissions
- get_dataset - single dataset retrieval
- get_datasets_by_ids - bulk retrieval
- get_process_rules - dataset processing rules
- get_dataset_queries - dataset query history
- get_related_apps - apps using the dataset
"""

import json
from uuid import uuid4

from extensions.ext_database import db
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.dataset import (
    AppDatasetJoin,
    Dataset,
    DatasetPermission,
    DatasetPermissionEnum,
    DatasetProcessRule,
    DatasetQuery,
)
from models.model import Tag, TagBinding
from services.dataset_service import DatasetService, DocumentService


class DatasetRetrievalTestDataFactory:
    """Factory class for creating database-backed test data for dataset retrieval integration tests."""

    @staticmethod
    def create_account_with_tenant(role: TenantAccountRole = TenantAccountRole.NORMAL) -> tuple[Account, Tenant]:
        """Create an account and tenant with the specified role."""
        account = Account(
            email=f"{uuid4()}@example.com",
            name=f"user-{uuid4()}",
            interface_language="en-US",
            status="active",
        )
        tenant = Tenant(
            name=f"tenant-{uuid4()}",
            status="normal",
        )
        db.session.add_all([account, tenant])
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
    def create_account_in_tenant(tenant: Tenant, role: TenantAccountRole = TenantAccountRole.OWNER) -> Account:
        """Create an account and add it to an existing tenant."""
        account = Account(
            email=f"{uuid4()}@example.com",
            name=f"user-{uuid4()}",
            interface_language="en-US",
            status="active",
        )
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
        return account

    @staticmethod
    def create_dataset(
        tenant_id: str,
        created_by: str,
        name: str = "Test Dataset",
        permission: DatasetPermissionEnum = DatasetPermissionEnum.ONLY_ME,
    ) -> Dataset:
        """Create a dataset."""
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
    def create_dataset_permission(dataset_id: str, tenant_id: str, account_id: str) -> DatasetPermission:
        """Create a dataset permission."""
        permission = DatasetPermission(
            dataset_id=dataset_id,
            tenant_id=tenant_id,
            account_id=account_id,
            has_permission=True,
        )
        db.session.add(permission)
        db.session.commit()
        return permission

    @staticmethod
    def create_process_rule(dataset_id: str, created_by: str, mode: str, rules: dict) -> DatasetProcessRule:
        """Create a dataset process rule."""
        process_rule = DatasetProcessRule(
            dataset_id=dataset_id,
            created_by=created_by,
            mode=mode,
            rules=json.dumps(rules),
        )
        db.session.add(process_rule)
        db.session.commit()
        return process_rule

    @staticmethod
    def create_dataset_query(dataset_id: str, created_by: str, content: str) -> DatasetQuery:
        """Create a dataset query."""
        dataset_query = DatasetQuery(
            dataset_id=dataset_id,
            content=content,
            source="web",
            source_app_id=None,
            created_by_role="account",
            created_by=created_by,
        )
        db.session.add(dataset_query)
        db.session.commit()
        return dataset_query

    @staticmethod
    def create_app_dataset_join(dataset_id: str) -> AppDatasetJoin:
        """Create an app-dataset join."""
        join = AppDatasetJoin(
            app_id=str(uuid4()),
            dataset_id=dataset_id,
        )
        db.session.add(join)
        db.session.commit()
        return join

    @staticmethod
    def create_tag_binding(tenant_id: str, created_by: str, target_id: str) -> Tag:
        """Create a knowledge tag and bind it to the target dataset."""
        tag = Tag(
            tenant_id=tenant_id,
            type="knowledge",
            name=f"tag-{uuid4()}",
            created_by=created_by,
        )
        db.session.add(tag)
        db.session.flush()

        binding = TagBinding(
            tenant_id=tenant_id,
            tag_id=tag.id,
            target_id=target_id,
            created_by=created_by,
        )
        db.session.add(binding)
        db.session.commit()
        return tag


class TestDatasetServiceGetDatasets:
    """
    Comprehensive integration tests for DatasetService.get_datasets method.

    This test suite covers:
    - Pagination
    - Search functionality
    - Tag filtering
    - Permission-based filtering (ONLY_ME, ALL_TEAM, PARTIAL_TEAM)
    - Role-based filtering (OWNER, DATASET_OPERATOR, NORMAL)
    - include_all flag
    """

    # ==================== Basic Retrieval Tests ====================

    def test_get_datasets_basic_pagination(self, db_session_with_containers):
        """Test basic pagination without user or filters."""
        # Arrange
        account, tenant = DatasetRetrievalTestDataFactory.create_account_with_tenant()
        page = 1
        per_page = 20

        for i in range(5):
            DatasetRetrievalTestDataFactory.create_dataset(
                tenant_id=tenant.id,
                created_by=account.id,
                name=f"Dataset {i}",
                permission=DatasetPermissionEnum.ALL_TEAM,
            )

        # Act
        datasets, total = DatasetService.get_datasets(page, per_page, tenant_id=tenant.id)

        # Assert
        assert len(datasets) == 5
        assert total == 5

    def test_get_datasets_with_search(self, db_session_with_containers):
        """Test get_datasets with search keyword."""
        # Arrange
        account, tenant = DatasetRetrievalTestDataFactory.create_account_with_tenant()
        page = 1
        per_page = 20
        search = "test"

        DatasetRetrievalTestDataFactory.create_dataset(
            tenant_id=tenant.id,
            created_by=account.id,
            name="Test Dataset",
            permission=DatasetPermissionEnum.ALL_TEAM,
        )
        DatasetRetrievalTestDataFactory.create_dataset(
            tenant_id=tenant.id,
            created_by=account.id,
            name="Another Dataset",
            permission=DatasetPermissionEnum.ALL_TEAM,
        )

        # Act
        datasets, total = DatasetService.get_datasets(page, per_page, tenant_id=tenant.id, search=search)

        # Assert
        assert len(datasets) == 1
        assert total == 1

    def test_get_datasets_with_tag_filtering(self, db_session_with_containers):
        """Test get_datasets with tag_ids filtering."""
        # Arrange
        account, tenant = DatasetRetrievalTestDataFactory.create_account_with_tenant()
        page = 1
        per_page = 20

        dataset_1 = DatasetRetrievalTestDataFactory.create_dataset(
            tenant_id=tenant.id,
            created_by=account.id,
            permission=DatasetPermissionEnum.ALL_TEAM,
        )
        dataset_2 = DatasetRetrievalTestDataFactory.create_dataset(
            tenant_id=tenant.id,
            created_by=account.id,
            permission=DatasetPermissionEnum.ALL_TEAM,
        )

        tag_1 = DatasetRetrievalTestDataFactory.create_tag_binding(tenant.id, account.id, dataset_1.id)
        tag_2 = DatasetRetrievalTestDataFactory.create_tag_binding(tenant.id, account.id, dataset_2.id)
        tag_ids = [tag_1.id, tag_2.id]

        # Act
        datasets, total = DatasetService.get_datasets(page, per_page, tenant_id=tenant.id, tag_ids=tag_ids)

        # Assert
        assert len(datasets) == 2
        assert total == 2

    def test_get_datasets_with_empty_tag_ids(self, db_session_with_containers):
        """Test get_datasets with empty tag_ids skips tag filtering and returns all matching datasets."""
        # Arrange
        account, tenant = DatasetRetrievalTestDataFactory.create_account_with_tenant()
        page = 1
        per_page = 20
        tag_ids = []

        for i in range(3):
            DatasetRetrievalTestDataFactory.create_dataset(
                tenant_id=tenant.id,
                created_by=account.id,
                name=f"dataset-{i}",
                permission=DatasetPermissionEnum.ALL_TEAM,
            )

        # Act
        datasets, total = DatasetService.get_datasets(page, per_page, tenant_id=tenant.id, tag_ids=tag_ids)

        # Assert
        # When tag_ids is empty, tag filtering is skipped, so normal query results are returned
        assert len(datasets) == 3
        assert total == 3

    # ==================== Permission-Based Filtering Tests ====================

    def test_get_datasets_without_user_shows_only_all_team(self, db_session_with_containers):
        """Test that without user, only ALL_TEAM datasets are shown."""
        # Arrange
        account, tenant = DatasetRetrievalTestDataFactory.create_account_with_tenant()
        page = 1
        per_page = 20

        DatasetRetrievalTestDataFactory.create_dataset(
            tenant_id=tenant.id,
            created_by=account.id,
            permission=DatasetPermissionEnum.ALL_TEAM,
        )
        DatasetRetrievalTestDataFactory.create_dataset(
            tenant_id=tenant.id,
            created_by=account.id,
            permission=DatasetPermissionEnum.ONLY_ME,
        )

        # Act
        datasets, total = DatasetService.get_datasets(page, per_page, tenant_id=tenant.id, user=None)

        # Assert
        assert len(datasets) == 1
        assert total == 1

    def test_get_datasets_owner_with_include_all(self, db_session_with_containers):
        """Test that OWNER with include_all=True sees all datasets."""
        # Arrange
        owner, tenant = DatasetRetrievalTestDataFactory.create_account_with_tenant(role=TenantAccountRole.OWNER)

        for i, permission in enumerate(
            [DatasetPermissionEnum.ONLY_ME, DatasetPermissionEnum.ALL_TEAM, DatasetPermissionEnum.PARTIAL_TEAM]
        ):
            DatasetRetrievalTestDataFactory.create_dataset(
                tenant_id=tenant.id,
                created_by=owner.id,
                name=f"dataset-{i}",
                permission=permission,
            )

        # Act
        datasets, total = DatasetService.get_datasets(
            page=1,
            per_page=20,
            tenant_id=tenant.id,
            user=owner,
            include_all=True,
        )

        # Assert
        assert len(datasets) == 3
        assert total == 3

    def test_get_datasets_normal_user_only_me_permission(self, db_session_with_containers):
        """Test that normal user sees ONLY_ME datasets they created."""
        # Arrange
        user, tenant = DatasetRetrievalTestDataFactory.create_account_with_tenant(role=TenantAccountRole.NORMAL)

        DatasetRetrievalTestDataFactory.create_dataset(
            tenant_id=tenant.id,
            created_by=user.id,
            permission=DatasetPermissionEnum.ONLY_ME,
        )

        # Act
        datasets, total = DatasetService.get_datasets(page=1, per_page=20, tenant_id=tenant.id, user=user)

        # Assert
        assert len(datasets) == 1
        assert total == 1

    def test_get_datasets_normal_user_all_team_permission(self, db_session_with_containers):
        """Test that normal user sees ALL_TEAM datasets."""
        # Arrange
        user, tenant = DatasetRetrievalTestDataFactory.create_account_with_tenant(role=TenantAccountRole.NORMAL)
        owner = DatasetRetrievalTestDataFactory.create_account_in_tenant(tenant, role=TenantAccountRole.OWNER)

        DatasetRetrievalTestDataFactory.create_dataset(
            tenant_id=tenant.id,
            created_by=owner.id,
            permission=DatasetPermissionEnum.ALL_TEAM,
        )

        # Act
        datasets, total = DatasetService.get_datasets(page=1, per_page=20, tenant_id=tenant.id, user=user)

        # Assert
        assert len(datasets) == 1
        assert total == 1

    def test_get_datasets_normal_user_partial_team_with_permission(self, db_session_with_containers):
        """Test that normal user sees PARTIAL_TEAM datasets they have permission for."""
        # Arrange
        user, tenant = DatasetRetrievalTestDataFactory.create_account_with_tenant(role=TenantAccountRole.NORMAL)
        owner = DatasetRetrievalTestDataFactory.create_account_in_tenant(tenant, role=TenantAccountRole.OWNER)

        dataset = DatasetRetrievalTestDataFactory.create_dataset(
            tenant_id=tenant.id,
            created_by=owner.id,
            permission=DatasetPermissionEnum.PARTIAL_TEAM,
        )
        DatasetRetrievalTestDataFactory.create_dataset_permission(dataset.id, tenant.id, user.id)

        # Act
        datasets, total = DatasetService.get_datasets(page=1, per_page=20, tenant_id=tenant.id, user=user)

        # Assert
        assert len(datasets) == 1
        assert total == 1

    def test_get_datasets_dataset_operator_with_permissions(self, db_session_with_containers):
        """Test that DATASET_OPERATOR only sees datasets they have explicit permission for."""
        # Arrange
        operator, tenant = DatasetRetrievalTestDataFactory.create_account_with_tenant(
            role=TenantAccountRole.DATASET_OPERATOR
        )
        owner = DatasetRetrievalTestDataFactory.create_account_in_tenant(tenant, role=TenantAccountRole.OWNER)

        dataset = DatasetRetrievalTestDataFactory.create_dataset(
            tenant_id=tenant.id,
            created_by=owner.id,
            permission=DatasetPermissionEnum.ONLY_ME,
        )
        DatasetRetrievalTestDataFactory.create_dataset_permission(dataset.id, tenant.id, operator.id)

        # Act
        datasets, total = DatasetService.get_datasets(page=1, per_page=20, tenant_id=tenant.id, user=operator)

        # Assert
        assert len(datasets) == 1
        assert total == 1

    def test_get_datasets_dataset_operator_without_permissions(self, db_session_with_containers):
        """Test that DATASET_OPERATOR without permissions returns empty result."""
        # Arrange
        operator, tenant = DatasetRetrievalTestDataFactory.create_account_with_tenant(
            role=TenantAccountRole.DATASET_OPERATOR
        )
        owner = DatasetRetrievalTestDataFactory.create_account_in_tenant(tenant, role=TenantAccountRole.OWNER)
        DatasetRetrievalTestDataFactory.create_dataset(
            tenant_id=tenant.id,
            created_by=owner.id,
            permission=DatasetPermissionEnum.ALL_TEAM,
        )

        # Act
        datasets, total = DatasetService.get_datasets(page=1, per_page=20, tenant_id=tenant.id, user=operator)

        # Assert
        assert datasets == []
        assert total == 0


class TestDatasetServiceGetDataset:
    """Comprehensive integration tests for DatasetService.get_dataset method."""

    def test_get_dataset_success(self, db_session_with_containers):
        """Test successful retrieval of a single dataset."""
        # Arrange
        account, tenant = DatasetRetrievalTestDataFactory.create_account_with_tenant()
        dataset = DatasetRetrievalTestDataFactory.create_dataset(tenant_id=tenant.id, created_by=account.id)

        # Act
        result = DatasetService.get_dataset(dataset.id)

        # Assert
        assert result is not None
        assert result.id == dataset.id

    def test_get_dataset_not_found(self, db_session_with_containers):
        """Test retrieval when dataset doesn't exist."""
        # Arrange
        dataset_id = str(uuid4())

        # Act
        result = DatasetService.get_dataset(dataset_id)

        # Assert
        assert result is None


class TestDatasetServiceGetDatasetsByIds:
    """Comprehensive integration tests for DatasetService.get_datasets_by_ids method."""

    def test_get_datasets_by_ids_success(self, db_session_with_containers):
        """Test successful bulk retrieval of datasets by IDs."""
        # Arrange
        account, tenant = DatasetRetrievalTestDataFactory.create_account_with_tenant()
        datasets = [
            DatasetRetrievalTestDataFactory.create_dataset(tenant_id=tenant.id, created_by=account.id) for _ in range(3)
        ]
        dataset_ids = [dataset.id for dataset in datasets]

        # Act
        result_datasets, total = DatasetService.get_datasets_by_ids(dataset_ids, tenant.id)

        # Assert
        assert len(result_datasets) == 3
        assert total == 3
        assert all(dataset.id in dataset_ids for dataset in result_datasets)

    def test_get_datasets_by_ids_empty_list(self, db_session_with_containers):
        """Test get_datasets_by_ids with empty list returns empty result."""
        # Arrange
        tenant_id = str(uuid4())
        dataset_ids = []

        # Act
        datasets, total = DatasetService.get_datasets_by_ids(dataset_ids, tenant_id)

        # Assert
        assert datasets == []
        assert total == 0

    def test_get_datasets_by_ids_none_list(self, db_session_with_containers):
        """Test get_datasets_by_ids with None returns empty result."""
        # Arrange
        tenant_id = str(uuid4())

        # Act
        datasets, total = DatasetService.get_datasets_by_ids(None, tenant_id)

        # Assert
        assert datasets == []
        assert total == 0


class TestDatasetServiceGetProcessRules:
    """Comprehensive integration tests for DatasetService.get_process_rules method."""

    def test_get_process_rules_with_existing_rule(self, db_session_with_containers):
        """Test retrieval of process rules when rule exists."""
        # Arrange
        account, tenant = DatasetRetrievalTestDataFactory.create_account_with_tenant()
        dataset = DatasetRetrievalTestDataFactory.create_dataset(tenant_id=tenant.id, created_by=account.id)

        rules_data = {
            "pre_processing_rules": [{"id": "remove_extra_spaces", "enabled": True}],
            "segmentation": {"delimiter": "\n", "max_tokens": 500},
        }
        DatasetRetrievalTestDataFactory.create_process_rule(
            dataset_id=dataset.id,
            created_by=account.id,
            mode="custom",
            rules=rules_data,
        )

        # Act
        result = DatasetService.get_process_rules(dataset.id)

        # Assert
        assert result["mode"] == "custom"
        assert result["rules"] == rules_data

    def test_get_process_rules_without_existing_rule(self, db_session_with_containers):
        """Test retrieval of process rules when no rule exists (returns defaults)."""
        # Arrange
        account, tenant = DatasetRetrievalTestDataFactory.create_account_with_tenant()
        dataset = DatasetRetrievalTestDataFactory.create_dataset(tenant_id=tenant.id, created_by=account.id)

        # Act
        result = DatasetService.get_process_rules(dataset.id)

        # Assert
        assert result["mode"] == DocumentService.DEFAULT_RULES["mode"]
        assert "rules" in result
        assert result["rules"] == DocumentService.DEFAULT_RULES["rules"]


class TestDatasetServiceGetDatasetQueries:
    """Comprehensive integration tests for DatasetService.get_dataset_queries method."""

    def test_get_dataset_queries_success(self, db_session_with_containers):
        """Test successful retrieval of dataset queries."""
        # Arrange
        account, tenant = DatasetRetrievalTestDataFactory.create_account_with_tenant()
        dataset = DatasetRetrievalTestDataFactory.create_dataset(tenant_id=tenant.id, created_by=account.id)
        page = 1
        per_page = 20

        for i in range(3):
            DatasetRetrievalTestDataFactory.create_dataset_query(
                dataset_id=dataset.id,
                created_by=account.id,
                content=f"query-{i}",
            )

        # Act
        queries, total = DatasetService.get_dataset_queries(dataset.id, page, per_page)

        # Assert
        assert len(queries) == 3
        assert total == 3
        assert all(query.dataset_id == dataset.id for query in queries)

    def test_get_dataset_queries_empty_result(self, db_session_with_containers):
        """Test retrieval when no queries exist."""
        # Arrange
        account, tenant = DatasetRetrievalTestDataFactory.create_account_with_tenant()
        dataset = DatasetRetrievalTestDataFactory.create_dataset(tenant_id=tenant.id, created_by=account.id)
        page = 1
        per_page = 20

        # Act
        queries, total = DatasetService.get_dataset_queries(dataset.id, page, per_page)

        # Assert
        assert queries == []
        assert total == 0


class TestDatasetServiceGetRelatedApps:
    """Comprehensive integration tests for DatasetService.get_related_apps method."""

    def test_get_related_apps_success(self, db_session_with_containers):
        """Test successful retrieval of related apps."""
        # Arrange
        account, tenant = DatasetRetrievalTestDataFactory.create_account_with_tenant()
        dataset = DatasetRetrievalTestDataFactory.create_dataset(tenant_id=tenant.id, created_by=account.id)

        for _ in range(2):
            DatasetRetrievalTestDataFactory.create_app_dataset_join(dataset.id)

        # Act
        result = DatasetService.get_related_apps(dataset.id)

        # Assert
        assert len(result) == 2
        assert all(join.dataset_id == dataset.id for join in result)

    def test_get_related_apps_empty_result(self, db_session_with_containers):
        """Test retrieval when no related apps exist."""
        # Arrange
        account, tenant = DatasetRetrievalTestDataFactory.create_account_with_tenant()
        dataset = DatasetRetrievalTestDataFactory.create_dataset(tenant_id=tenant.id, created_by=account.id)

        # Act
        result = DatasetService.get_related_apps(dataset.id)

        # Assert
        assert result == []
