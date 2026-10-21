"""
Integration tests for tenant-scoped dataset read repository functions.

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

from sqlalchemy.orm import Session

from core.rag.index_processor.constant.index_type import IndexTechniqueType
from models import AccountStatus, CreatorUserRole, TenantStatus
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.dataset import (
    AppDatasetJoin,
    Dataset,
    DatasetPermission,
    DatasetPermissionEnum,
    DatasetProcessRule,
    DatasetQuery,
)
from models.enums import DatasetQuerySource, DataSourceType, ProcessRuleMode
from models.model import App
from repositories.knowledge.dataset_read_repository import (
    get_dataset_for_tenant,
    get_dataset_process_rules,
    list_dataset_queries,
    list_datasets_by_ids,
    list_related_apps,
    list_visible_datasets,
)
from services.knowledge.documents.creation_adapters import default_document_process_rules


def _query_visible_datasets(
    session: Session,
    *,
    tenant_id: str,
    actor: Account | None = None,
    keyword: str | None = None,
    target_ids: list[str] | None = None,
    include_all: bool = False,
    page: int = 1,
    per_page: int = 20,
) -> tuple[list[Dataset], int]:
    return list_visible_datasets(
        session,
        tenant_id=tenant_id,
        actor_id=actor.id if actor else None,
        actor_role=actor.current_role if actor else None,
        rbac_enabled=False,
        include_all=include_all,
        accessible_dataset_ids=None,
        include_own_datasets=False,
        keyword=keyword,
        tag_target_ids=target_ids,
        page=page,
        per_page=per_page,
    )


class DatasetRetrievalTestDataFactory:
    """Factory class for creating database-backed test data for dataset retrieval integration tests."""

    @staticmethod
    def create_account_with_tenant(
        db_session_with_containers: Session, role: TenantAccountRole = TenantAccountRole.NORMAL
    ) -> tuple[Account, Tenant]:
        """Create an account and tenant with the specified role."""
        account = Account(
            email=f"{uuid4()}@example.com",
            name=f"user-{uuid4()}",
            interface_language="en-US",
            status=AccountStatus.ACTIVE,
        )
        tenant = Tenant(
            name=f"tenant-{uuid4()}",
            status=TenantStatus.NORMAL,
        )
        db_session_with_containers.add_all([account, tenant])
        db_session_with_containers.flush()

        join = TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            role=role,
            current=True,
        )
        db_session_with_containers.add(join)
        db_session_with_containers.commit()

        account.set_current_tenant_with_session(tenant, session=db_session_with_containers)
        return account, tenant

    @staticmethod
    def create_account_in_tenant(
        db_session_with_containers: Session, tenant: Tenant, role: TenantAccountRole = TenantAccountRole.OWNER
    ) -> Account:
        """Create an account and add it to an existing tenant."""
        account = Account(
            email=f"{uuid4()}@example.com",
            name=f"user-{uuid4()}",
            interface_language="en-US",
            status=AccountStatus.ACTIVE,
        )
        db_session_with_containers.add(account)
        db_session_with_containers.flush()

        join = TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            role=role,
            current=True,
        )
        db_session_with_containers.add(join)
        db_session_with_containers.commit()

        account.set_current_tenant_with_session(tenant, session=db_session_with_containers)
        return account

    @staticmethod
    def create_dataset(
        db_session_with_containers: Session,
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
            data_source_type=DataSourceType.UPLOAD_FILE,
            indexing_technique=IndexTechniqueType.HIGH_QUALITY,
            created_by=created_by,
            maintainer=created_by,
            permission=permission,
            provider="vendor",
            retrieval_model={"top_k": 2},
        )
        db_session_with_containers.add(dataset)
        db_session_with_containers.commit()
        return dataset

    @staticmethod
    def create_dataset_permission(
        db_session_with_containers: Session, dataset_id: str, tenant_id: str, account_id: str
    ) -> DatasetPermission:
        """Create a dataset permission."""
        permission = DatasetPermission(
            dataset_id=dataset_id,
            tenant_id=tenant_id,
            account_id=account_id,
            has_permission=True,
        )
        db_session_with_containers.add(permission)
        db_session_with_containers.commit()
        return permission

    @staticmethod
    def create_process_rule(
        db_session_with_containers: Session, dataset_id: str, created_by: str, mode: ProcessRuleMode, rules: dict
    ) -> DatasetProcessRule:
        """Create a dataset process rule."""
        process_rule = DatasetProcessRule(
            dataset_id=dataset_id,
            created_by=created_by,
            mode=mode,
            rules=json.dumps(rules),
        )
        db_session_with_containers.add(process_rule)
        db_session_with_containers.commit()
        return process_rule

    @staticmethod
    def create_dataset_query(
        db_session_with_containers: Session, dataset_id: str, created_by: str, content: str
    ) -> DatasetQuery:
        """Create a dataset query."""
        dataset_query = DatasetQuery(
            dataset_id=dataset_id,
            content=content,
            source=DatasetQuerySource.APP,
            source_app_id=None,
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=created_by,
        )
        db_session_with_containers.add(dataset_query)
        db_session_with_containers.commit()
        return dataset_query

    @staticmethod
    def create_app_dataset_join(
        db_session_with_containers: Session, dataset_id: str, tenant_id: str, created_by: str
    ) -> AppDatasetJoin:
        """Create a tenant-owned app and its dataset join."""
        app = App(
            tenant_id=tenant_id,
            name=f"app-{uuid4()}",
            mode="chat",
            icon_type="emoji",
            icon="icon",
            icon_background="#FFFFFF",
            enable_site=True,
            enable_api=True,
            created_by=created_by,
        )
        db_session_with_containers.add(app)
        db_session_with_containers.flush()
        join = AppDatasetJoin(
            app_id=app.id,
            dataset_id=dataset_id,
        )
        db_session_with_containers.add(join)
        db_session_with_containers.commit()
        return join


class TestListVisibleDatasets:
    """
    Integration tests for dataset listing filters and legacy permission policy.

    This test suite covers:
    - Pagination
    - Search functionality
    - Tag filtering
    - Permission-based filtering (ONLY_ME, ALL_TEAM, PARTIAL_TEAM)
    - Role-based filtering (OWNER, DATASET_OPERATOR, NORMAL)
    - include_all flag
    """

    # ==================== Basic Retrieval Tests ====================

    def test_get_datasets_basic_pagination(self, db_session_with_containers: Session):
        """Test basic pagination without user or filters."""
        # Arrange
        account, tenant = DatasetRetrievalTestDataFactory.create_account_with_tenant(db_session_with_containers)
        page = 1
        per_page = 20

        for i in range(5):
            DatasetRetrievalTestDataFactory.create_dataset(
                db_session_with_containers,
                tenant_id=tenant.id,
                created_by=account.id,
                name=f"Dataset {i}",
                permission=DatasetPermissionEnum.ALL_TEAM,
            )

        # Act
        datasets, total = _query_visible_datasets(
            db_session_with_containers, tenant_id=tenant.id, page=page, per_page=per_page
        )

        # Assert
        assert len(datasets) == 5
        assert total == 5

    def test_get_datasets_with_search(self, db_session_with_containers: Session):
        """Test get_datasets with search keyword."""
        # Arrange
        account, tenant = DatasetRetrievalTestDataFactory.create_account_with_tenant(db_session_with_containers)
        page = 1
        per_page = 20
        search = "test"

        DatasetRetrievalTestDataFactory.create_dataset(
            db_session_with_containers,
            tenant_id=tenant.id,
            created_by=account.id,
            name="Test Dataset",
            permission=DatasetPermissionEnum.ALL_TEAM,
        )
        DatasetRetrievalTestDataFactory.create_dataset(
            db_session_with_containers,
            tenant_id=tenant.id,
            created_by=account.id,
            name="Another Dataset",
            permission=DatasetPermissionEnum.ALL_TEAM,
        )

        # Act
        datasets, total = _query_visible_datasets(
            db_session_with_containers,
            tenant_id=tenant.id,
            keyword=search,
            page=page,
            per_page=per_page,
        )

        # Assert
        assert len(datasets) == 1
        assert total == 1

    def test_get_datasets_with_tag_filtering(self, db_session_with_containers: Session):
        """Test get_datasets with tag_ids filtering."""
        # Arrange
        account, tenant = DatasetRetrievalTestDataFactory.create_account_with_tenant(db_session_with_containers)
        page = 1
        per_page = 20

        dataset_1 = DatasetRetrievalTestDataFactory.create_dataset(
            db_session_with_containers,
            tenant_id=tenant.id,
            created_by=account.id,
            permission=DatasetPermissionEnum.ALL_TEAM,
        )
        DatasetRetrievalTestDataFactory.create_dataset(
            db_session_with_containers,
            tenant_id=tenant.id,
            created_by=account.id,
            permission=DatasetPermissionEnum.ALL_TEAM,
        )

        # Act
        datasets, total = _query_visible_datasets(
            db_session_with_containers,
            tenant_id=tenant.id,
            target_ids=[dataset_1.id],
            page=page,
            per_page=per_page,
        )

        # Assert
        assert len(datasets) == 1
        assert total == 1
        assert datasets[0].id == dataset_1.id

    def test_get_datasets_with_empty_tag_ids(self, db_session_with_containers: Session):
        """Test get_datasets with empty tag_ids skips tag filtering and returns all matching datasets."""
        # Arrange
        account, tenant = DatasetRetrievalTestDataFactory.create_account_with_tenant(db_session_with_containers)
        page = 1
        per_page = 20
        for i in range(3):
            DatasetRetrievalTestDataFactory.create_dataset(
                db_session_with_containers,
                tenant_id=tenant.id,
                created_by=account.id,
                name=f"dataset-{i}",
                permission=DatasetPermissionEnum.ALL_TEAM,
            )

        # Act
        datasets, total = _query_visible_datasets(
            db_session_with_containers,
            tenant_id=tenant.id,
            page=page,
            per_page=per_page,
        )

        # Assert
        # When tag_ids is empty, tag filtering is skipped, so normal query results are returned
        assert len(datasets) == 3
        assert total == 3

    # ==================== Permission-Based Filtering Tests ====================

    def test_get_datasets_without_user_shows_only_all_team(self, db_session_with_containers: Session):
        """Test that without user, only ALL_TEAM datasets are shown."""
        # Arrange
        account, tenant = DatasetRetrievalTestDataFactory.create_account_with_tenant(db_session_with_containers)
        page = 1
        per_page = 20

        DatasetRetrievalTestDataFactory.create_dataset(
            db_session_with_containers,
            tenant_id=tenant.id,
            created_by=account.id,
            permission=DatasetPermissionEnum.ALL_TEAM,
        )
        DatasetRetrievalTestDataFactory.create_dataset(
            db_session_with_containers,
            tenant_id=tenant.id,
            created_by=account.id,
            permission=DatasetPermissionEnum.ONLY_ME,
        )

        # Act
        datasets, total = _query_visible_datasets(
            db_session_with_containers, tenant_id=tenant.id, page=page, per_page=per_page
        )

        # Assert
        assert len(datasets) == 1
        assert total == 1

    def test_get_datasets_owner_with_include_all(self, db_session_with_containers: Session):
        """Test that OWNER with include_all=True sees all datasets."""
        # Arrange
        owner, tenant = DatasetRetrievalTestDataFactory.create_account_with_tenant(
            db_session_with_containers, role=TenantAccountRole.OWNER
        )

        for i, permission in enumerate(
            [DatasetPermissionEnum.ONLY_ME, DatasetPermissionEnum.ALL_TEAM, DatasetPermissionEnum.PARTIAL_TEAM]
        ):
            DatasetRetrievalTestDataFactory.create_dataset(
                db_session_with_containers,
                tenant_id=tenant.id,
                created_by=owner.id,
                name=f"dataset-{i}",
                permission=permission,
            )

        # Act
        datasets, total = _query_visible_datasets(
            db_session_with_containers,
            tenant_id=tenant.id,
            actor=owner,
            include_all=True,
            page=1,
            per_page=20,
        )

        # Assert
        assert len(datasets) == 3
        assert total == 3

    def test_get_datasets_normal_user_only_me_permission(self, db_session_with_containers: Session):
        """Test that normal user sees ONLY_ME datasets they created."""
        # Arrange
        user, tenant = DatasetRetrievalTestDataFactory.create_account_with_tenant(
            db_session_with_containers, role=TenantAccountRole.NORMAL
        )

        DatasetRetrievalTestDataFactory.create_dataset(
            db_session_with_containers,
            tenant_id=tenant.id,
            created_by=user.id,
            permission=DatasetPermissionEnum.ONLY_ME,
        )

        # Act
        datasets, total = _query_visible_datasets(
            db_session_with_containers,
            tenant_id=tenant.id,
            actor=user,
            page=1,
            per_page=20,
        )

        # Assert
        assert len(datasets) == 1
        assert total == 1

    def test_get_datasets_normal_user_all_team_permission(self, db_session_with_containers: Session):
        """Test that normal user sees ALL_TEAM datasets."""
        # Arrange
        user, tenant = DatasetRetrievalTestDataFactory.create_account_with_tenant(
            db_session_with_containers, role=TenantAccountRole.NORMAL
        )
        owner = DatasetRetrievalTestDataFactory.create_account_in_tenant(
            db_session_with_containers, tenant, role=TenantAccountRole.OWNER
        )

        DatasetRetrievalTestDataFactory.create_dataset(
            db_session_with_containers,
            tenant_id=tenant.id,
            created_by=owner.id,
            permission=DatasetPermissionEnum.ALL_TEAM,
        )

        # Act
        datasets, total = _query_visible_datasets(
            db_session_with_containers,
            tenant_id=tenant.id,
            actor=user,
            page=1,
            per_page=20,
        )

        # Assert
        assert len(datasets) == 1
        assert total == 1

    def test_get_datasets_normal_user_partial_team_with_permission(self, db_session_with_containers: Session):
        """Test that normal user sees PARTIAL_TEAM datasets they have permission for."""
        # Arrange
        user, tenant = DatasetRetrievalTestDataFactory.create_account_with_tenant(
            db_session_with_containers, role=TenantAccountRole.NORMAL
        )
        owner = DatasetRetrievalTestDataFactory.create_account_in_tenant(
            db_session_with_containers, tenant, role=TenantAccountRole.OWNER
        )

        dataset = DatasetRetrievalTestDataFactory.create_dataset(
            db_session_with_containers,
            tenant_id=tenant.id,
            created_by=owner.id,
            permission=DatasetPermissionEnum.PARTIAL_TEAM,
        )
        DatasetRetrievalTestDataFactory.create_dataset_permission(
            db_session_with_containers, dataset.id, tenant.id, user.id
        )

        # Act
        datasets, total = _query_visible_datasets(
            db_session_with_containers,
            tenant_id=tenant.id,
            actor=user,
            page=1,
            per_page=20,
        )

        # Assert
        assert len(datasets) == 1
        assert total == 1

    def test_get_datasets_dataset_operator_with_permissions(self, db_session_with_containers: Session):
        """Test that DATASET_OPERATOR only sees datasets they have explicit permission for."""
        # Arrange
        operator, tenant = DatasetRetrievalTestDataFactory.create_account_with_tenant(
            db_session_with_containers, role=TenantAccountRole.DATASET_OPERATOR
        )
        owner = DatasetRetrievalTestDataFactory.create_account_in_tenant(
            db_session_with_containers, tenant, role=TenantAccountRole.OWNER
        )

        dataset = DatasetRetrievalTestDataFactory.create_dataset(
            db_session_with_containers,
            tenant_id=tenant.id,
            created_by=owner.id,
            permission=DatasetPermissionEnum.ONLY_ME,
        )
        DatasetRetrievalTestDataFactory.create_dataset_permission(
            db_session_with_containers, dataset.id, tenant.id, operator.id
        )

        # Act
        datasets, total = _query_visible_datasets(
            db_session_with_containers,
            tenant_id=tenant.id,
            actor=operator,
            page=1,
            per_page=20,
        )

        # Assert
        assert len(datasets) == 1
        assert total == 1

    def test_get_datasets_dataset_operator_without_permissions(self, db_session_with_containers: Session):
        """Test that DATASET_OPERATOR without permissions returns empty result."""
        # Arrange
        operator, tenant = DatasetRetrievalTestDataFactory.create_account_with_tenant(
            db_session_with_containers, role=TenantAccountRole.DATASET_OPERATOR
        )
        owner = DatasetRetrievalTestDataFactory.create_account_in_tenant(
            db_session_with_containers, tenant, role=TenantAccountRole.OWNER
        )
        DatasetRetrievalTestDataFactory.create_dataset(
            db_session_with_containers,
            tenant_id=tenant.id,
            created_by=owner.id,
            permission=DatasetPermissionEnum.ALL_TEAM,
        )

        # Act
        datasets, total = _query_visible_datasets(
            db_session_with_containers,
            tenant_id=tenant.id,
            actor=operator,
            page=1,
            per_page=20,
        )

        # Assert
        assert datasets == []
        assert total == 0


class TestGetDatasetForTenant:
    def test_get_dataset_success(self, db_session_with_containers: Session):
        """Test successful retrieval of a single dataset."""
        # Arrange
        account, tenant = DatasetRetrievalTestDataFactory.create_account_with_tenant(db_session_with_containers)
        dataset = DatasetRetrievalTestDataFactory.create_dataset(
            db_session_with_containers, tenant_id=tenant.id, created_by=account.id
        )

        # Act
        result = get_dataset_for_tenant(db_session_with_containers, tenant_id=tenant.id, dataset_id=dataset.id)

        # Assert
        assert result is not None
        assert result.id == dataset.id

    def test_get_dataset_not_found(self, db_session_with_containers: Session):
        """Test retrieval when dataset doesn't exist."""
        # Arrange
        tenant_id = str(uuid4())
        dataset_id = str(uuid4())

        # Act
        result = get_dataset_for_tenant(db_session_with_containers, tenant_id=tenant_id, dataset_id=dataset_id)

        # Assert
        assert result is None


class TestListDatasetsByIds:
    def test_get_datasets_by_ids_success(self, db_session_with_containers: Session):
        """Test successful bulk retrieval of datasets by IDs."""
        # Arrange
        account, tenant = DatasetRetrievalTestDataFactory.create_account_with_tenant(db_session_with_containers)
        datasets = [
            DatasetRetrievalTestDataFactory.create_dataset(
                db_session_with_containers, tenant_id=tenant.id, created_by=account.id
            )
            for _ in range(3)
        ]
        dataset_ids = [dataset.id for dataset in datasets]

        # Act
        result_datasets, total = list_datasets_by_ids(
            db_session_with_containers, tenant_id=tenant.id, dataset_ids=dataset_ids
        )

        # Assert
        assert len(result_datasets) == 3
        assert total == 3
        assert all(dataset.id in dataset_ids for dataset in result_datasets)

    def test_get_datasets_by_ids_empty_list(self, db_session_with_containers: Session):
        """Test get_datasets_by_ids with empty list returns empty result."""
        # Arrange
        tenant_id = str(uuid4())
        dataset_ids = []

        # Act
        datasets, total = list_datasets_by_ids(db_session_with_containers, tenant_id=tenant_id, dataset_ids=dataset_ids)

        # Assert
        assert datasets == []
        assert total == 0


class TestGetDatasetProcessRules:
    def test_get_process_rules_with_existing_rule(self, db_session_with_containers: Session):
        """Test retrieval of process rules when rule exists."""
        # Arrange
        account, tenant = DatasetRetrievalTestDataFactory.create_account_with_tenant(db_session_with_containers)
        dataset = DatasetRetrievalTestDataFactory.create_dataset(
            db_session_with_containers, tenant_id=tenant.id, created_by=account.id
        )

        rules_data = {
            "pre_processing_rules": [{"id": "remove_extra_spaces", "enabled": True}],
            "segmentation": {"delimiter": "\n", "max_tokens": 500},
        }
        DatasetRetrievalTestDataFactory.create_process_rule(
            db_session_with_containers,
            dataset_id=dataset.id,
            created_by=account.id,
            mode=ProcessRuleMode.CUSTOM,
            rules=rules_data,
        )

        # Act
        mode, rules = get_dataset_process_rules(db_session_with_containers, tenant_id=tenant.id, dataset_id=dataset.id)

        # Assert
        assert mode == ProcessRuleMode.CUSTOM
        assert rules == rules_data

    def test_get_process_rules_without_existing_rule(self, db_session_with_containers: Session):
        """Test retrieval of process rules when no rule exists (returns defaults)."""
        # Arrange
        account, tenant = DatasetRetrievalTestDataFactory.create_account_with_tenant(db_session_with_containers)
        dataset = DatasetRetrievalTestDataFactory.create_dataset(
            db_session_with_containers, tenant_id=tenant.id, created_by=account.id
        )

        # Act
        mode, rules = get_dataset_process_rules(db_session_with_containers, tenant_id=tenant.id, dataset_id=dataset.id)

        # Assert
        defaults = default_document_process_rules()
        assert mode == defaults["mode"]
        assert rules == defaults["rules"]


class TestListDatasetQueries:
    def test_get_dataset_queries_success(self, db_session_with_containers: Session):
        """Test successful retrieval of dataset queries."""
        # Arrange
        account, tenant = DatasetRetrievalTestDataFactory.create_account_with_tenant(db_session_with_containers)
        dataset = DatasetRetrievalTestDataFactory.create_dataset(
            db_session_with_containers, tenant_id=tenant.id, created_by=account.id
        )
        page = 1
        per_page = 20

        for i in range(3):
            DatasetRetrievalTestDataFactory.create_dataset_query(
                db_session_with_containers,
                dataset_id=dataset.id,
                created_by=account.id,
                content=f"query-{i}",
            )

        # Act
        queries, total = list_dataset_queries(
            db_session_with_containers,
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            page=page,
            per_page=per_page,
        )

        # Assert
        assert len(queries) == 3
        assert total == 3
        assert all(query.dataset_id == dataset.id for query in queries)

    def test_get_dataset_queries_empty_result(self, db_session_with_containers: Session):
        """Test retrieval when no queries exist."""
        # Arrange
        account, tenant = DatasetRetrievalTestDataFactory.create_account_with_tenant(db_session_with_containers)
        dataset = DatasetRetrievalTestDataFactory.create_dataset(
            db_session_with_containers, tenant_id=tenant.id, created_by=account.id
        )
        page = 1
        per_page = 20

        # Act
        queries, total = list_dataset_queries(
            db_session_with_containers,
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            page=page,
            per_page=per_page,
        )

        # Assert
        assert queries == []
        assert total == 0


class TestListRelatedApps:
    def test_get_related_apps_success(self, db_session_with_containers: Session):
        """Test successful retrieval of related apps."""
        # Arrange
        account, tenant = DatasetRetrievalTestDataFactory.create_account_with_tenant(db_session_with_containers)
        dataset = DatasetRetrievalTestDataFactory.create_dataset(
            db_session_with_containers, tenant_id=tenant.id, created_by=account.id
        )

        for _ in range(2):
            DatasetRetrievalTestDataFactory.create_app_dataset_join(
                db_session_with_containers, dataset.id, tenant.id, account.id
            )

        # Act
        result = list_related_apps(db_session_with_containers, tenant_id=tenant.id, dataset_id=dataset.id)

        # Assert
        assert len(result) == 2
        assert all(join.dataset_id == dataset.id for join in result)

    def test_get_related_apps_empty_result(self, db_session_with_containers: Session):
        """Test retrieval when no related apps exist."""
        # Arrange
        account, tenant = DatasetRetrievalTestDataFactory.create_account_with_tenant(db_session_with_containers)
        dataset = DatasetRetrievalTestDataFactory.create_dataset(
            db_session_with_containers, tenant_id=tenant.id, created_by=account.id
        )

        # Act
        result = list_related_apps(db_session_with_containers, tenant_id=tenant.id, dataset_id=dataset.id)

        # Assert
        assert result == []
