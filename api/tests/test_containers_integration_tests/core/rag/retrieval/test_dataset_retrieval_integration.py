import uuid
from unittest.mock import patch

import pytest
from faker import Faker

from core.rag.retrieval.dataset_retrieval import DatasetRetrieval
from core.workflow.repositories.rag_retrieval_protocol import KnowledgeRetrievalRequest
from models.dataset import Dataset, Document
from services.account_service import AccountService, TenantService


class TestGetAvailableDatasetsIntegration:
    def test_returns_datasets_with_available_documents(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        # Arrange
        fake = Faker()

        # Create account and tenant
        account = AccountService.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=fake.password(length=12),
        )
        TenantService.create_owner_tenant_if_not_exist(account, name=fake.company())
        tenant = account.current_tenant

        # Create dataset
        dataset = Dataset(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            name=fake.company(),
            description=fake.text(max_nb_chars=100),
            provider="dify",
            data_source_type="upload_file",
            created_by=account.id,
            indexing_technique="high_quality",
        )
        db_session_with_containers.add(dataset)
        db_session_with_containers.flush()

        # Create documents with completed status, enabled, not archived
        for i in range(3):
            document = Document(
                id=str(uuid.uuid4()),
                tenant_id=tenant.id,
                dataset_id=dataset.id,
                position=i,
                data_source_type="upload_file",
                batch=str(uuid.uuid4()),  # Required field
                name=f"Document {i}",
                created_from="web",
                created_by=account.id,
                doc_form="text_model",
                doc_language="en",
                indexing_status="completed",
                enabled=True,
                archived=False,
            )
            db_session_with_containers.add(document)

        db_session_with_containers.commit()

        # Act
        dataset_retrieval = DatasetRetrieval()
        result = dataset_retrieval._get_available_datasets(tenant.id, [dataset.id])

        # Assert
        assert len(result) == 1
        assert result[0].id == dataset.id
        assert result[0].tenant_id == tenant.id
        assert result[0].name == dataset.name

    def test_filters_out_datasets_with_only_archived_documents(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        # Arrange
        fake = Faker()

        account = AccountService.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=fake.password(length=12),
        )
        TenantService.create_owner_tenant_if_not_exist(account, name=fake.company())
        tenant = account.current_tenant

        dataset = Dataset(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            name=fake.company(),
            provider="dify",
            data_source_type="upload_file",
            created_by=account.id,
        )
        db_session_with_containers.add(dataset)

        # Create only archived documents
        for i in range(2):
            document = Document(
                id=str(uuid.uuid4()),
                tenant_id=tenant.id,
                dataset_id=dataset.id,
                position=i,
                data_source_type="upload_file",
                batch=str(uuid.uuid4()),  # Required field
                created_from="web",
                name=f"Archived Document {i}",
                created_by=account.id,
                doc_form="text_model",
                indexing_status="completed",
                enabled=True,
                archived=True,  # Archived
            )
            db_session_with_containers.add(document)

        db_session_with_containers.commit()

        # Act
        dataset_retrieval = DatasetRetrieval()
        result = dataset_retrieval._get_available_datasets(tenant.id, [dataset.id])

        # Assert
        assert len(result) == 0

    def test_filters_out_datasets_with_only_disabled_documents(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        # Arrange
        fake = Faker()

        account = AccountService.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=fake.password(length=12),
        )
        TenantService.create_owner_tenant_if_not_exist(account, name=fake.company())
        tenant = account.current_tenant

        dataset = Dataset(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            name=fake.company(),
            provider="dify",
            data_source_type="upload_file",
            created_by=account.id,
        )
        db_session_with_containers.add(dataset)

        # Create only disabled documents
        for i in range(2):
            document = Document(
                id=str(uuid.uuid4()),
                tenant_id=tenant.id,
                dataset_id=dataset.id,
                position=i,
                data_source_type="upload_file",
                batch=str(uuid.uuid4()),  # Required field
                created_from="web",
                name=f"Disabled Document {i}",
                created_by=account.id,
                doc_form="text_model",
                indexing_status="completed",
                enabled=False,  # Disabled
                archived=False,
            )
            db_session_with_containers.add(document)

        db_session_with_containers.commit()

        # Act
        dataset_retrieval = DatasetRetrieval()
        result = dataset_retrieval._get_available_datasets(tenant.id, [dataset.id])

        # Assert
        assert len(result) == 0

    def test_filters_out_datasets_with_non_completed_documents(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        # Arrange
        fake = Faker()

        account = AccountService.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=fake.password(length=12),
        )
        TenantService.create_owner_tenant_if_not_exist(account, name=fake.company())
        tenant = account.current_tenant

        dataset = Dataset(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            name=fake.company(),
            provider="dify",
            data_source_type="upload_file",
            created_by=account.id,
        )
        db_session_with_containers.add(dataset)

        # Create documents with non-completed status
        for i, status in enumerate(["indexing", "parsing", "splitting"]):
            document = Document(
                id=str(uuid.uuid4()),
                tenant_id=tenant.id,
                dataset_id=dataset.id,
                position=i,
                data_source_type="upload_file",
                batch=str(uuid.uuid4()),  # Required field
                created_from="web",
                name=f"Document {status}",
                created_by=account.id,
                doc_form="text_model",
                indexing_status=status,  # Not completed
                enabled=True,
                archived=False,
            )
            db_session_with_containers.add(document)

        db_session_with_containers.commit()

        # Act
        dataset_retrieval = DatasetRetrieval()
        result = dataset_retrieval._get_available_datasets(tenant.id, [dataset.id])

        # Assert
        assert len(result) == 0

    def test_includes_external_datasets_without_documents(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test that external datasets are returned even with no available documents.

        External datasets (e.g., from external knowledge bases) don't have
        documents stored in Dify's database, so they should always be available.

        Verifies:
        - External datasets are included in results
        - No document count check for external datasets
        """
        # Arrange
        fake = Faker()

        account = AccountService.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=fake.password(length=12),
        )
        TenantService.create_owner_tenant_if_not_exist(account, name=fake.company())
        tenant = account.current_tenant

        dataset = Dataset(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            name=fake.company(),
            provider="external",  # External provider
            data_source_type="external",
            created_by=account.id,
        )
        db_session_with_containers.add(dataset)
        db_session_with_containers.commit()

        # Act
        dataset_retrieval = DatasetRetrieval()
        result = dataset_retrieval._get_available_datasets(tenant.id, [dataset.id])

        # Assert
        assert len(result) == 1
        assert result[0].id == dataset.id
        assert result[0].provider == "external"

    def test_filters_by_tenant_id(self, db_session_with_containers, mock_external_service_dependencies):
        # Arrange
        fake = Faker()

        # Create two accounts/tenants
        account1 = AccountService.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=fake.password(length=12),
        )
        TenantService.create_owner_tenant_if_not_exist(account1, name=fake.company())
        tenant1 = account1.current_tenant

        account2 = AccountService.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=fake.password(length=12),
        )
        TenantService.create_owner_tenant_if_not_exist(account2, name=fake.company())
        tenant2 = account2.current_tenant

        # Create dataset for tenant1
        dataset1 = Dataset(
            id=str(uuid.uuid4()),
            tenant_id=tenant1.id,
            name="Tenant 1 Dataset",
            provider="dify",
            data_source_type="upload_file",
            created_by=account1.id,
        )
        db_session_with_containers.add(dataset1)

        # Create dataset for tenant2
        dataset2 = Dataset(
            id=str(uuid.uuid4()),
            tenant_id=tenant2.id,
            name="Tenant 2 Dataset",
            provider="dify",
            data_source_type="upload_file",
            created_by=account2.id,
        )
        db_session_with_containers.add(dataset2)

        # Add documents to both datasets
        for dataset, account in [(dataset1, account1), (dataset2, account2)]:
            document = Document(
                id=str(uuid.uuid4()),
                tenant_id=dataset.tenant_id,
                dataset_id=dataset.id,
                position=0,
                data_source_type="upload_file",
                batch=str(uuid.uuid4()),  # Required field
                created_from="web",
                name=f"Document for {dataset.name}",
                created_by=account.id,
                doc_form="text_model",
                indexing_status="completed",
                enabled=True,
                archived=False,
            )
            db_session_with_containers.add(document)

        db_session_with_containers.commit()

        # Act - request from tenant1, should only get tenant1's dataset
        dataset_retrieval = DatasetRetrieval()
        result = dataset_retrieval._get_available_datasets(tenant1.id, [dataset1.id, dataset2.id])

        # Assert
        assert len(result) == 1
        assert result[0].id == dataset1.id
        assert result[0].tenant_id == tenant1.id

    def test_returns_empty_list_when_no_datasets_found(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        # Arrange
        fake = Faker()

        account = AccountService.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=fake.password(length=12),
        )
        TenantService.create_owner_tenant_if_not_exist(account, name=fake.company())
        tenant = account.current_tenant

        # Don't create any datasets

        # Act
        dataset_retrieval = DatasetRetrieval()
        result = dataset_retrieval._get_available_datasets(tenant.id, [str(uuid.uuid4())])

        # Assert
        assert result == []

    def test_returns_only_requested_dataset_ids(self, db_session_with_containers, mock_external_service_dependencies):
        # Arrange
        fake = Faker()

        account = AccountService.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=fake.password(length=12),
        )
        TenantService.create_owner_tenant_if_not_exist(account, name=fake.company())
        tenant = account.current_tenant

        # Create multiple datasets
        datasets = []
        for i in range(3):
            dataset = Dataset(
                id=str(uuid.uuid4()),
                tenant_id=tenant.id,
                name=f"Dataset {i}",
                provider="dify",
                data_source_type="upload_file",
                created_by=account.id,
            )
            db_session_with_containers.add(dataset)
            datasets.append(dataset)

            # Add document
            document = Document(
                id=str(uuid.uuid4()),
                tenant_id=tenant.id,
                dataset_id=dataset.id,
                position=0,
                data_source_type="upload_file",
                batch=str(uuid.uuid4()),  # Required field
                created_from="web",
                name=f"Document {i}",
                created_by=account.id,
                doc_form="text_model",
                indexing_status="completed",
                enabled=True,
                archived=False,
            )
            db_session_with_containers.add(document)

        db_session_with_containers.commit()

        # Act - request only dataset 0 and 2, not dataset 1
        dataset_retrieval = DatasetRetrieval()
        requested_ids = [datasets[0].id, datasets[2].id]
        result = dataset_retrieval._get_available_datasets(tenant.id, requested_ids)

        # Assert
        assert len(result) == 2
        returned_ids = {d.id for d in result}
        assert returned_ids == {datasets[0].id, datasets[2].id}


class TestKnowledgeRetrievalIntegration:
    def test_knowledge_retrieval_with_available_datasets(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        # Arrange
        fake = Faker()

        account = AccountService.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=fake.password(length=12),
        )
        TenantService.create_owner_tenant_if_not_exist(account, name=fake.company())
        tenant = account.current_tenant

        dataset = Dataset(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            name=fake.company(),
            provider="dify",
            data_source_type="upload_file",
            created_by=account.id,
            indexing_technique="high_quality",
        )
        db_session_with_containers.add(dataset)

        document = Document(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            position=0,
            data_source_type="upload_file",
            batch=str(uuid.uuid4()),  # Required field
            created_from="web",
            name=fake.sentence(),
            created_by=account.id,
            indexing_status="completed",
            enabled=True,
            archived=False,
            doc_form="text_model",
        )
        db_session_with_containers.add(document)
        db_session_with_containers.commit()

        # Create request
        request = KnowledgeRetrievalRequest(
            tenant_id=tenant.id,
            user_id=account.id,
            app_id=str(uuid.uuid4()),
            user_from="web",
            dataset_ids=[dataset.id],
            query="test query",
            retrieval_mode="multiple",
            top_k=5,
        )

        dataset_retrieval = DatasetRetrieval()

        # Mock rate limit check and retrieval
        with patch.object(dataset_retrieval, "_check_knowledge_rate_limit"):
            with patch.object(dataset_retrieval, "get_metadata_filter_condition", return_value=(None, None)):
                with patch.object(dataset_retrieval, "multiple_retrieve", return_value=[]):
                    # Act
                    result = dataset_retrieval.knowledge_retrieval(request)

                    # Assert
                    assert isinstance(result, list)

    def test_knowledge_retrieval_no_available_datasets(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        # Arrange
        fake = Faker()

        account = AccountService.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=fake.password(length=12),
        )
        TenantService.create_owner_tenant_if_not_exist(account, name=fake.company())
        tenant = account.current_tenant

        # Create dataset but no documents
        dataset = Dataset(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            name=fake.company(),
            provider="dify",
            data_source_type="upload_file",
            created_by=account.id,
        )
        db_session_with_containers.add(dataset)
        db_session_with_containers.commit()

        request = KnowledgeRetrievalRequest(
            tenant_id=tenant.id,
            user_id=account.id,
            app_id=str(uuid.uuid4()),
            user_from="web",
            dataset_ids=[dataset.id],
            query="test query",
            retrieval_mode="multiple",
            top_k=5,
        )

        dataset_retrieval = DatasetRetrieval()

        # Mock rate limit check
        with patch.object(dataset_retrieval, "_check_knowledge_rate_limit"):
            # Act
            result = dataset_retrieval.knowledge_retrieval(request)

            # Assert
            assert result == []

    def test_knowledge_retrieval_rate_limit_exceeded(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        # Arrange
        fake = Faker()

        account = AccountService.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=fake.password(length=12),
        )
        TenantService.create_owner_tenant_if_not_exist(account, name=fake.company())
        tenant = account.current_tenant

        dataset = Dataset(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            name=fake.company(),
            provider="dify",
            data_source_type="upload_file",
            created_by=account.id,
        )
        db_session_with_containers.add(dataset)
        db_session_with_containers.commit()

        request = KnowledgeRetrievalRequest(
            tenant_id=tenant.id,
            user_id=account.id,
            app_id=str(uuid.uuid4()),
            user_from="web",
            dataset_ids=[dataset.id],
            query="test query",
            retrieval_mode="multiple",
            top_k=5,
        )

        dataset_retrieval = DatasetRetrieval()

        # Mock rate limit check to raise exception
        with patch.object(
            dataset_retrieval,
            "_check_knowledge_rate_limit",
            side_effect=Exception("Rate limit exceeded"),
        ):
            # Act & Assert
            with pytest.raises(Exception, match="Rate limit exceeded"):
                dataset_retrieval.knowledge_retrieval(request)


@pytest.fixture
def mock_external_service_dependencies():
    with (
        patch("services.account_service.FeatureService") as mock_account_feature_service,
    ):
        # Setup default mock returns for account service
        mock_account_feature_service.get_system_features.return_value.is_allow_register = True

        yield {
            "account_feature_service": mock_account_feature_service,
        }
