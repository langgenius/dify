"""
Comprehensive unit tests for DatasetService retrieval/list methods.

This test suite covers:
- get_datasets - pagination, search, filtering, permissions
- get_dataset - single dataset retrieval
- get_datasets_by_ids - bulk retrieval
- get_process_rules - dataset processing rules
- get_dataset_queries - dataset query history
- get_related_apps - apps using the dataset
"""

from unittest.mock import Mock, create_autospec, patch
from uuid import uuid4

import pytest

from models.account import Account, TenantAccountRole
from models.dataset import (
    AppDatasetJoin,
    Dataset,
    DatasetPermission,
    DatasetPermissionEnum,
    DatasetProcessRule,
    DatasetQuery,
)
from services.dataset_service import DatasetService, DocumentService


class DatasetRetrievalTestDataFactory:
    """Factory class for creating test data and mock objects for dataset retrieval tests."""

    @staticmethod
    def create_dataset_mock(
        dataset_id: str = "dataset-123",
        name: str = "Test Dataset",
        tenant_id: str = "tenant-123",
        created_by: str = "user-123",
        permission: DatasetPermissionEnum = DatasetPermissionEnum.ONLY_ME,
        **kwargs,
    ) -> Mock:
        """Create a mock dataset with specified attributes."""
        dataset = Mock(spec=Dataset)
        dataset.id = dataset_id
        dataset.name = name
        dataset.tenant_id = tenant_id
        dataset.created_by = created_by
        dataset.permission = permission
        for key, value in kwargs.items():
            setattr(dataset, key, value)
        return dataset

    @staticmethod
    def create_account_mock(
        account_id: str = "account-123",
        tenant_id: str = "tenant-123",
        role: TenantAccountRole = TenantAccountRole.NORMAL,
        **kwargs,
    ) -> Mock:
        """Create a mock account."""
        account = create_autospec(Account, instance=True)
        account.id = account_id
        account.current_tenant_id = tenant_id
        account.current_role = role
        for key, value in kwargs.items():
            setattr(account, key, value)
        return account

    @staticmethod
    def create_dataset_permission_mock(
        dataset_id: str = "dataset-123",
        account_id: str = "account-123",
        **kwargs,
    ) -> Mock:
        """Create a mock dataset permission."""
        permission = Mock(spec=DatasetPermission)
        permission.dataset_id = dataset_id
        permission.account_id = account_id
        for key, value in kwargs.items():
            setattr(permission, key, value)
        return permission

    @staticmethod
    def create_process_rule_mock(
        dataset_id: str = "dataset-123",
        mode: str = "automatic",
        rules: dict | None = None,
        **kwargs,
    ) -> Mock:
        """Create a mock dataset process rule."""
        process_rule = Mock(spec=DatasetProcessRule)
        process_rule.dataset_id = dataset_id
        process_rule.mode = mode
        process_rule.rules_dict = rules or {}
        for key, value in kwargs.items():
            setattr(process_rule, key, value)
        return process_rule

    @staticmethod
    def create_dataset_query_mock(
        dataset_id: str = "dataset-123",
        query_id: str = "query-123",
        **kwargs,
    ) -> Mock:
        """Create a mock dataset query."""
        dataset_query = Mock(spec=DatasetQuery)
        dataset_query.id = query_id
        dataset_query.dataset_id = dataset_id
        for key, value in kwargs.items():
            setattr(dataset_query, key, value)
        return dataset_query

    @staticmethod
    def create_app_dataset_join_mock(
        app_id: str = "app-123",
        dataset_id: str = "dataset-123",
        **kwargs,
    ) -> Mock:
        """Create a mock app-dataset join."""
        join = Mock(spec=AppDatasetJoin)
        join.app_id = app_id
        join.dataset_id = dataset_id
        for key, value in kwargs.items():
            setattr(join, key, value)
        return join


class TestDatasetServiceGetDatasets:
    """
    Comprehensive unit tests for DatasetService.get_datasets method.

    This test suite covers:
    - Pagination
    - Search functionality
    - Tag filtering
    - Permission-based filtering (ONLY_ME, ALL_TEAM, PARTIAL_TEAM)
    - Role-based filtering (OWNER, DATASET_OPERATOR, NORMAL)
    - include_all flag
    """

    @pytest.fixture
    def mock_dependencies(self):
        """Common mock setup for get_datasets tests."""
        with (
            patch("services.dataset_service.db.session") as mock_db,
            patch("services.dataset_service.db.paginate") as mock_paginate,
            patch("services.dataset_service.TagService") as mock_tag_service,
        ):
            yield {
                "db_session": mock_db,
                "paginate": mock_paginate,
                "tag_service": mock_tag_service,
            }

    # ==================== Basic Retrieval Tests ====================

    def test_get_datasets_basic_pagination(self, mock_dependencies):
        """Test basic pagination without user or filters."""
        # Arrange
        tenant_id = str(uuid4())
        page = 1
        per_page = 20

        # Mock pagination result
        mock_paginate_result = Mock()
        mock_paginate_result.items = [
            DatasetRetrievalTestDataFactory.create_dataset_mock(
                dataset_id=f"dataset-{i}", name=f"Dataset {i}", tenant_id=tenant_id
            )
            for i in range(5)
        ]
        mock_paginate_result.total = 5
        mock_dependencies["paginate"].return_value = mock_paginate_result

        # Act
        datasets, total = DatasetService.get_datasets(page, per_page, tenant_id=tenant_id)

        # Assert
        assert len(datasets) == 5
        assert total == 5
        mock_dependencies["paginate"].assert_called_once()

    def test_get_datasets_with_search(self, mock_dependencies):
        """Test get_datasets with search keyword."""
        # Arrange
        tenant_id = str(uuid4())
        page = 1
        per_page = 20
        search = "test"

        # Mock pagination result
        mock_paginate_result = Mock()
        mock_paginate_result.items = [
            DatasetRetrievalTestDataFactory.create_dataset_mock(
                dataset_id="dataset-1", name="Test Dataset", tenant_id=tenant_id
            )
        ]
        mock_paginate_result.total = 1
        mock_dependencies["paginate"].return_value = mock_paginate_result

        # Act
        datasets, total = DatasetService.get_datasets(page, per_page, tenant_id=tenant_id, search=search)

        # Assert
        assert len(datasets) == 1
        assert total == 1
        mock_dependencies["paginate"].assert_called_once()

    def test_get_datasets_with_tag_filtering(self, mock_dependencies):
        """Test get_datasets with tag_ids filtering."""
        # Arrange
        tenant_id = str(uuid4())
        page = 1
        per_page = 20
        tag_ids = ["tag-1", "tag-2"]

        # Mock tag service
        target_ids = ["dataset-1", "dataset-2"]
        mock_dependencies["tag_service"].get_target_ids_by_tag_ids.return_value = target_ids

        # Mock pagination result
        mock_paginate_result = Mock()
        mock_paginate_result.items = [
            DatasetRetrievalTestDataFactory.create_dataset_mock(dataset_id=dataset_id, tenant_id=tenant_id)
            for dataset_id in target_ids
        ]
        mock_paginate_result.total = 2
        mock_dependencies["paginate"].return_value = mock_paginate_result

        # Act
        datasets, total = DatasetService.get_datasets(page, per_page, tenant_id=tenant_id, tag_ids=tag_ids)

        # Assert
        assert len(datasets) == 2
        assert total == 2
        mock_dependencies["tag_service"].get_target_ids_by_tag_ids.assert_called_once_with(
            "knowledge", tenant_id, tag_ids
        )

    def test_get_datasets_with_empty_tag_ids(self, mock_dependencies):
        """Test get_datasets with empty tag_ids skips tag filtering and returns all matching datasets."""
        # Arrange
        tenant_id = str(uuid4())
        page = 1
        per_page = 20
        tag_ids = []

        # Mock pagination result - when tag_ids is empty, tag filtering is skipped
        mock_paginate_result = Mock()
        mock_paginate_result.items = [
            DatasetRetrievalTestDataFactory.create_dataset_mock(dataset_id=f"dataset-{i}", tenant_id=tenant_id)
            for i in range(3)
        ]
        mock_paginate_result.total = 3
        mock_dependencies["paginate"].return_value = mock_paginate_result

        # Act
        datasets, total = DatasetService.get_datasets(page, per_page, tenant_id=tenant_id, tag_ids=tag_ids)

        # Assert
        # When tag_ids is empty, tag filtering is skipped, so normal query results are returned
        assert len(datasets) == 3
        assert total == 3
        # Tag service should not be called when tag_ids is empty
        mock_dependencies["tag_service"].get_target_ids_by_tag_ids.assert_not_called()
        mock_dependencies["paginate"].assert_called_once()

    # ==================== Permission-Based Filtering Tests ====================

    def test_get_datasets_without_user_shows_only_all_team(self, mock_dependencies):
        """Test that without user, only ALL_TEAM datasets are shown."""
        # Arrange
        tenant_id = str(uuid4())
        page = 1
        per_page = 20

        # Mock pagination result
        mock_paginate_result = Mock()
        mock_paginate_result.items = [
            DatasetRetrievalTestDataFactory.create_dataset_mock(
                dataset_id="dataset-1",
                tenant_id=tenant_id,
                permission=DatasetPermissionEnum.ALL_TEAM,
            )
        ]
        mock_paginate_result.total = 1
        mock_dependencies["paginate"].return_value = mock_paginate_result

        # Act
        datasets, total = DatasetService.get_datasets(page, per_page, tenant_id=tenant_id, user=None)

        # Assert
        assert len(datasets) == 1
        mock_dependencies["paginate"].assert_called_once()

    def test_get_datasets_owner_with_include_all(self, mock_dependencies):
        """Test that OWNER with include_all=True sees all datasets."""
        # Arrange
        tenant_id = str(uuid4())
        user = DatasetRetrievalTestDataFactory.create_account_mock(
            account_id="owner-123", tenant_id=tenant_id, role=TenantAccountRole.OWNER
        )

        # Mock dataset permissions query (empty - owner doesn't need explicit permissions)
        mock_query = Mock()
        mock_query.filter_by.return_value.all.return_value = []
        mock_dependencies["db_session"].query.return_value = mock_query

        # Mock pagination result
        mock_paginate_result = Mock()
        mock_paginate_result.items = [
            DatasetRetrievalTestDataFactory.create_dataset_mock(dataset_id=f"dataset-{i}", tenant_id=tenant_id)
            for i in range(3)
        ]
        mock_paginate_result.total = 3
        mock_dependencies["paginate"].return_value = mock_paginate_result

        # Act
        datasets, total = DatasetService.get_datasets(
            page=1, per_page=20, tenant_id=tenant_id, user=user, include_all=True
        )

        # Assert
        assert len(datasets) == 3
        assert total == 3

    def test_get_datasets_normal_user_only_me_permission(self, mock_dependencies):
        """Test that normal user sees ONLY_ME datasets they created."""
        # Arrange
        tenant_id = str(uuid4())
        user_id = "user-123"
        user = DatasetRetrievalTestDataFactory.create_account_mock(
            account_id=user_id, tenant_id=tenant_id, role=TenantAccountRole.NORMAL
        )

        # Mock dataset permissions query (no explicit permissions)
        mock_query = Mock()
        mock_query.filter_by.return_value.all.return_value = []
        mock_dependencies["db_session"].query.return_value = mock_query

        # Mock pagination result
        mock_paginate_result = Mock()
        mock_paginate_result.items = [
            DatasetRetrievalTestDataFactory.create_dataset_mock(
                dataset_id="dataset-1",
                tenant_id=tenant_id,
                created_by=user_id,
                permission=DatasetPermissionEnum.ONLY_ME,
            )
        ]
        mock_paginate_result.total = 1
        mock_dependencies["paginate"].return_value = mock_paginate_result

        # Act
        datasets, total = DatasetService.get_datasets(page=1, per_page=20, tenant_id=tenant_id, user=user)

        # Assert
        assert len(datasets) == 1
        assert total == 1

    def test_get_datasets_normal_user_all_team_permission(self, mock_dependencies):
        """Test that normal user sees ALL_TEAM datasets."""
        # Arrange
        tenant_id = str(uuid4())
        user = DatasetRetrievalTestDataFactory.create_account_mock(
            account_id="user-123", tenant_id=tenant_id, role=TenantAccountRole.NORMAL
        )

        # Mock dataset permissions query (no explicit permissions)
        mock_query = Mock()
        mock_query.filter_by.return_value.all.return_value = []
        mock_dependencies["db_session"].query.return_value = mock_query

        # Mock pagination result
        mock_paginate_result = Mock()
        mock_paginate_result.items = [
            DatasetRetrievalTestDataFactory.create_dataset_mock(
                dataset_id="dataset-1",
                tenant_id=tenant_id,
                permission=DatasetPermissionEnum.ALL_TEAM,
            )
        ]
        mock_paginate_result.total = 1
        mock_dependencies["paginate"].return_value = mock_paginate_result

        # Act
        datasets, total = DatasetService.get_datasets(page=1, per_page=20, tenant_id=tenant_id, user=user)

        # Assert
        assert len(datasets) == 1
        assert total == 1

    def test_get_datasets_normal_user_partial_team_with_permission(self, mock_dependencies):
        """Test that normal user sees PARTIAL_TEAM datasets they have permission for."""
        # Arrange
        tenant_id = str(uuid4())
        user_id = "user-123"
        dataset_id = "dataset-1"
        user = DatasetRetrievalTestDataFactory.create_account_mock(
            account_id=user_id, tenant_id=tenant_id, role=TenantAccountRole.NORMAL
        )

        # Mock dataset permissions query - user has permission
        permission = DatasetRetrievalTestDataFactory.create_dataset_permission_mock(
            dataset_id=dataset_id, account_id=user_id
        )
        mock_query = Mock()
        mock_query.filter_by.return_value.all.return_value = [permission]
        mock_dependencies["db_session"].query.return_value = mock_query

        # Mock pagination result
        mock_paginate_result = Mock()
        mock_paginate_result.items = [
            DatasetRetrievalTestDataFactory.create_dataset_mock(
                dataset_id=dataset_id,
                tenant_id=tenant_id,
                permission=DatasetPermissionEnum.PARTIAL_TEAM,
            )
        ]
        mock_paginate_result.total = 1
        mock_dependencies["paginate"].return_value = mock_paginate_result

        # Act
        datasets, total = DatasetService.get_datasets(page=1, per_page=20, tenant_id=tenant_id, user=user)

        # Assert
        assert len(datasets) == 1
        assert total == 1

    def test_get_datasets_dataset_operator_with_permissions(self, mock_dependencies):
        """Test that DATASET_OPERATOR only sees datasets they have explicit permission for."""
        # Arrange
        tenant_id = str(uuid4())
        user_id = "operator-123"
        dataset_id = "dataset-1"
        user = DatasetRetrievalTestDataFactory.create_account_mock(
            account_id=user_id, tenant_id=tenant_id, role=TenantAccountRole.DATASET_OPERATOR
        )

        # Mock dataset permissions query - operator has permission
        permission = DatasetRetrievalTestDataFactory.create_dataset_permission_mock(
            dataset_id=dataset_id, account_id=user_id
        )
        mock_query = Mock()
        mock_query.filter_by.return_value.all.return_value = [permission]
        mock_dependencies["db_session"].query.return_value = mock_query

        # Mock pagination result
        mock_paginate_result = Mock()
        mock_paginate_result.items = [
            DatasetRetrievalTestDataFactory.create_dataset_mock(dataset_id=dataset_id, tenant_id=tenant_id)
        ]
        mock_paginate_result.total = 1
        mock_dependencies["paginate"].return_value = mock_paginate_result

        # Act
        datasets, total = DatasetService.get_datasets(page=1, per_page=20, tenant_id=tenant_id, user=user)

        # Assert
        assert len(datasets) == 1
        assert total == 1

    def test_get_datasets_dataset_operator_without_permissions(self, mock_dependencies):
        """Test that DATASET_OPERATOR without permissions returns empty result."""
        # Arrange
        tenant_id = str(uuid4())
        user_id = "operator-123"
        user = DatasetRetrievalTestDataFactory.create_account_mock(
            account_id=user_id, tenant_id=tenant_id, role=TenantAccountRole.DATASET_OPERATOR
        )

        # Mock dataset permissions query - no permissions
        mock_query = Mock()
        mock_query.filter_by.return_value.all.return_value = []
        mock_dependencies["db_session"].query.return_value = mock_query

        # Act
        datasets, total = DatasetService.get_datasets(page=1, per_page=20, tenant_id=tenant_id, user=user)

        # Assert
        assert datasets == []
        assert total == 0


class TestDatasetServiceGetDataset:
    """Comprehensive unit tests for DatasetService.get_dataset method."""

    @pytest.fixture
    def mock_dependencies(self):
        """Common mock setup for get_dataset tests."""
        with patch("services.dataset_service.db.session") as mock_db:
            yield {"db_session": mock_db}

    def test_get_dataset_success(self, mock_dependencies):
        """Test successful retrieval of a single dataset."""
        # Arrange
        dataset_id = str(uuid4())
        dataset = DatasetRetrievalTestDataFactory.create_dataset_mock(dataset_id=dataset_id)

        # Mock database query
        mock_query = Mock()
        mock_query.filter_by.return_value.first.return_value = dataset
        mock_dependencies["db_session"].query.return_value = mock_query

        # Act
        result = DatasetService.get_dataset(dataset_id)

        # Assert
        assert result is not None
        assert result.id == dataset_id
        mock_query.filter_by.assert_called_once_with(id=dataset_id)

    def test_get_dataset_not_found(self, mock_dependencies):
        """Test retrieval when dataset doesn't exist."""
        # Arrange
        dataset_id = str(uuid4())

        # Mock database query returning None
        mock_query = Mock()
        mock_query.filter_by.return_value.first.return_value = None
        mock_dependencies["db_session"].query.return_value = mock_query

        # Act
        result = DatasetService.get_dataset(dataset_id)

        # Assert
        assert result is None


class TestDatasetServiceGetDatasetsByIds:
    """Comprehensive unit tests for DatasetService.get_datasets_by_ids method."""

    @pytest.fixture
    def mock_dependencies(self):
        """Common mock setup for get_datasets_by_ids tests."""
        with patch("services.dataset_service.db.paginate") as mock_paginate:
            yield {"paginate": mock_paginate}

    def test_get_datasets_by_ids_success(self, mock_dependencies):
        """Test successful bulk retrieval of datasets by IDs."""
        # Arrange
        tenant_id = str(uuid4())
        dataset_ids = [str(uuid4()), str(uuid4()), str(uuid4())]

        # Mock pagination result
        mock_paginate_result = Mock()
        mock_paginate_result.items = [
            DatasetRetrievalTestDataFactory.create_dataset_mock(dataset_id=dataset_id, tenant_id=tenant_id)
            for dataset_id in dataset_ids
        ]
        mock_paginate_result.total = len(dataset_ids)
        mock_dependencies["paginate"].return_value = mock_paginate_result

        # Act
        datasets, total = DatasetService.get_datasets_by_ids(dataset_ids, tenant_id)

        # Assert
        assert len(datasets) == 3
        assert total == 3
        assert all(dataset.id in dataset_ids for dataset in datasets)
        mock_dependencies["paginate"].assert_called_once()

    def test_get_datasets_by_ids_empty_list(self, mock_dependencies):
        """Test get_datasets_by_ids with empty list returns empty result."""
        # Arrange
        tenant_id = str(uuid4())
        dataset_ids = []

        # Act
        datasets, total = DatasetService.get_datasets_by_ids(dataset_ids, tenant_id)

        # Assert
        assert datasets == []
        assert total == 0
        mock_dependencies["paginate"].assert_not_called()

    def test_get_datasets_by_ids_none_list(self, mock_dependencies):
        """Test get_datasets_by_ids with None returns empty result."""
        # Arrange
        tenant_id = str(uuid4())

        # Act
        datasets, total = DatasetService.get_datasets_by_ids(None, tenant_id)

        # Assert
        assert datasets == []
        assert total == 0
        mock_dependencies["paginate"].assert_not_called()


class TestDatasetServiceGetProcessRules:
    """Comprehensive unit tests for DatasetService.get_process_rules method."""

    @pytest.fixture
    def mock_dependencies(self):
        """Common mock setup for get_process_rules tests."""
        with patch("services.dataset_service.db.session") as mock_db:
            yield {"db_session": mock_db}

    def test_get_process_rules_with_existing_rule(self, mock_dependencies):
        """Test retrieval of process rules when rule exists."""
        # Arrange
        dataset_id = str(uuid4())
        rules_data = {
            "pre_processing_rules": [{"id": "remove_extra_spaces", "enabled": True}],
            "segmentation": {"delimiter": "\n", "max_tokens": 500},
        }
        process_rule = DatasetRetrievalTestDataFactory.create_process_rule_mock(
            dataset_id=dataset_id, mode="custom", rules=rules_data
        )

        # Mock database query
        mock_query = Mock()
        mock_query.where.return_value.order_by.return_value.limit.return_value.one_or_none.return_value = process_rule
        mock_dependencies["db_session"].query.return_value = mock_query

        # Act
        result = DatasetService.get_process_rules(dataset_id)

        # Assert
        assert result["mode"] == "custom"
        assert result["rules"] == rules_data

    def test_get_process_rules_without_existing_rule(self, mock_dependencies):
        """Test retrieval of process rules when no rule exists (returns defaults)."""
        # Arrange
        dataset_id = str(uuid4())

        # Mock database query returning None
        mock_query = Mock()
        mock_query.where.return_value.order_by.return_value.limit.return_value.one_or_none.return_value = None
        mock_dependencies["db_session"].query.return_value = mock_query

        # Act
        result = DatasetService.get_process_rules(dataset_id)

        # Assert
        assert result["mode"] == DocumentService.DEFAULT_RULES["mode"]
        assert "rules" in result
        assert result["rules"] == DocumentService.DEFAULT_RULES["rules"]


class TestDatasetServiceGetDatasetQueries:
    """Comprehensive unit tests for DatasetService.get_dataset_queries method."""

    @pytest.fixture
    def mock_dependencies(self):
        """Common mock setup for get_dataset_queries tests."""
        with patch("services.dataset_service.db.paginate") as mock_paginate:
            yield {"paginate": mock_paginate}

    def test_get_dataset_queries_success(self, mock_dependencies):
        """Test successful retrieval of dataset queries."""
        # Arrange
        dataset_id = str(uuid4())
        page = 1
        per_page = 20

        # Mock pagination result
        mock_paginate_result = Mock()
        mock_paginate_result.items = [
            DatasetRetrievalTestDataFactory.create_dataset_query_mock(dataset_id=dataset_id, query_id=f"query-{i}")
            for i in range(3)
        ]
        mock_paginate_result.total = 3
        mock_dependencies["paginate"].return_value = mock_paginate_result

        # Act
        queries, total = DatasetService.get_dataset_queries(dataset_id, page, per_page)

        # Assert
        assert len(queries) == 3
        assert total == 3
        assert all(query.dataset_id == dataset_id for query in queries)
        mock_dependencies["paginate"].assert_called_once()

    def test_get_dataset_queries_empty_result(self, mock_dependencies):
        """Test retrieval when no queries exist."""
        # Arrange
        dataset_id = str(uuid4())
        page = 1
        per_page = 20

        # Mock pagination result (empty)
        mock_paginate_result = Mock()
        mock_paginate_result.items = []
        mock_paginate_result.total = 0
        mock_dependencies["paginate"].return_value = mock_paginate_result

        # Act
        queries, total = DatasetService.get_dataset_queries(dataset_id, page, per_page)

        # Assert
        assert queries == []
        assert total == 0


class TestDatasetServiceGetRelatedApps:
    """Comprehensive unit tests for DatasetService.get_related_apps method."""

    @pytest.fixture
    def mock_dependencies(self):
        """Common mock setup for get_related_apps tests."""
        with patch("services.dataset_service.db.session") as mock_db:
            yield {"db_session": mock_db}

    def test_get_related_apps_success(self, mock_dependencies):
        """Test successful retrieval of related apps."""
        # Arrange
        dataset_id = str(uuid4())

        # Mock app-dataset joins
        app_joins = [
            DatasetRetrievalTestDataFactory.create_app_dataset_join_mock(app_id=f"app-{i}", dataset_id=dataset_id)
            for i in range(2)
        ]

        # Mock database query
        mock_query = Mock()
        mock_query.where.return_value.order_by.return_value.all.return_value = app_joins
        mock_dependencies["db_session"].query.return_value = mock_query

        # Act
        result = DatasetService.get_related_apps(dataset_id)

        # Assert
        assert len(result) == 2
        assert all(join.dataset_id == dataset_id for join in result)
        mock_query.where.assert_called_once()
        mock_query.where.return_value.order_by.assert_called_once()

    def test_get_related_apps_empty_result(self, mock_dependencies):
        """Test retrieval when no related apps exist."""
        # Arrange
        dataset_id = str(uuid4())

        # Mock database query returning empty list
        mock_query = Mock()
        mock_query.where.return_value.order_by.return_value.all.return_value = []
        mock_dependencies["db_session"].query.return_value = mock_query

        # Act
        result = DatasetService.get_related_apps(dataset_id)

        # Assert
        assert result == []
