import uuid
from unittest.mock import create_autospec, patch

import pytest
from faker import Faker
from sqlalchemy.orm import Session, sessionmaker

from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from graphon.model_runtime.entities.llm_entities import LLMUsage
from models.dataset import Dataset, Document
from models.enums import DataSourceType, DocumentCreatedFrom, IndexingStatus
from repositories.knowledge.external_repository import SQLAlchemyExternalKnowledgeRepository
from repositories.knowledge.retrieval_source_repository import SQLAlchemyRetrievalRepository
from services.knowledge.admission.application import DatasetAdmissionLimits
from services.knowledge.entities.retrieval import KnowledgeRetrievalRequest
from services.knowledge.external.adapters import ExternalKnowledgeGateway
from services.knowledge.external.application import ExternalDatasetRetrievalService
from services.knowledge.retrieval.adapters import DataPostProcessorReranker, DatasetCandidateRetriever
from services.knowledge.retrieval.application import KnowledgeRetrievalApplicationService
from services.knowledge.retrieval.candidate_search import CandidateSearch, CandidateSearchResult
from services.knowledge.retrieval.finalization import KnowledgeRetrievalFinalizer
from services.knowledge.retrieval.metadata_filtering import MetadataFilterPlanner
from tests.test_containers_integration_tests.helpers import accounts as account_fixtures
from tests.test_containers_integration_tests.helpers import generate_valid_password


class _NoopLimits:
    def check(
        self,
        workspace_id: str,
        *,
        rate_limit: bool,
        billing_resources: tuple[str, ...],
        require_paid_segments: bool,
    ) -> None:
        pass


def _session_factory(session: Session) -> sessionmaker[Session]:
    return sessionmaker(bind=session.get_bind(), expire_on_commit=False)


def _retrieval_repository(session: Session) -> SQLAlchemyRetrievalRepository:
    return SQLAlchemyRetrievalRepository(session_factory=_session_factory(session))


def _dataset_retrieval(
    session: Session, *, limits: DatasetAdmissionLimits | None = None
) -> KnowledgeRetrievalApplicationService:
    session_factory = _session_factory(session)
    repository = SQLAlchemyRetrievalRepository(session_factory=session_factory)
    candidate_search = CandidateSearch(
        internal_retrieval=DatasetCandidateRetriever(),
        external_retrieval=ExternalDatasetRetrievalService(
            repository=SQLAlchemyExternalKnowledgeRepository(session_factory=session_factory),
            gateway=ExternalKnowledgeGateway(),
        ),
        reranker=DataPostProcessorReranker(session_factory=session_factory),
    )
    return KnowledgeRetrievalApplicationService(
        repository=repository,
        candidate_search=candidate_search,
        metadata_filters=MetadataFilterPlanner(repository=repository),
        finalizer=KnowledgeRetrievalFinalizer(session_factory=session_factory),
        limits=limits or _NoopLimits(),
    )


class TestGetAvailableDatasetsIntegration:
    def test_returns_datasets_with_available_documents(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):
        # Arrange
        fake = Faker()

        # Create account and tenant
        account = account_fixtures.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=generate_valid_password(fake),
            session=db_session_with_containers,
        )
        account_fixtures.create_owner_workspace(account, name=fake.company(), session=db_session_with_containers)
        tenant = account.current_tenant

        # Create dataset
        dataset = Dataset(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            name=fake.company(),
            description=fake.text(max_nb_chars=100),
            provider="dify",
            data_source_type=DataSourceType.UPLOAD_FILE,
            created_by=account.id,
            indexing_technique=IndexTechniqueType.HIGH_QUALITY,
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
                data_source_type=DataSourceType.UPLOAD_FILE,
                batch=str(uuid.uuid4()),  # Required field
                name=f"Document {i}",
                created_from=DocumentCreatedFrom.WEB,
                created_by=account.id,
                doc_form=IndexStructureType.PARAGRAPH_INDEX,
                doc_language="en",
                indexing_status=IndexingStatus.COMPLETED,
                enabled=True,
                archived=False,
            )
            db_session_with_containers.add(document)

        db_session_with_containers.commit()

        # Act
        repository = _retrieval_repository(db_session_with_containers)
        result = repository.list_available_datasets(tenant_id=tenant.id, dataset_ids=[dataset.id])

        # Assert
        assert len(result) == 1
        assert result[0].id == dataset.id
        assert result[0].tenant_id == tenant.id
        assert result[0].name == dataset.name

    def test_filters_out_datasets_with_only_archived_documents(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):
        # Arrange
        fake = Faker()

        account = account_fixtures.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=generate_valid_password(fake),
            session=db_session_with_containers,
        )
        account_fixtures.create_owner_workspace(account, name=fake.company(), session=db_session_with_containers)
        tenant = account.current_tenant

        dataset = Dataset(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            name=fake.company(),
            provider="dify",
            data_source_type=DataSourceType.UPLOAD_FILE,
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
                data_source_type=DataSourceType.UPLOAD_FILE,
                batch=str(uuid.uuid4()),  # Required field
                created_from=DocumentCreatedFrom.WEB,
                name=f"Archived Document {i}",
                created_by=account.id,
                doc_form=IndexStructureType.PARAGRAPH_INDEX,
                indexing_status=IndexingStatus.COMPLETED,
                enabled=True,
                archived=True,  # Archived
            )
            db_session_with_containers.add(document)

        db_session_with_containers.commit()

        # Act
        repository = _retrieval_repository(db_session_with_containers)
        result = repository.list_available_datasets(tenant_id=tenant.id, dataset_ids=[dataset.id])

        # Assert
        assert len(result) == 0

    def test_filters_out_datasets_with_only_disabled_documents(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):
        # Arrange
        fake = Faker()

        account = account_fixtures.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=generate_valid_password(fake),
            session=db_session_with_containers,
        )
        account_fixtures.create_owner_workspace(account, name=fake.company(), session=db_session_with_containers)
        tenant = account.current_tenant

        dataset = Dataset(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            name=fake.company(),
            provider="dify",
            data_source_type=DataSourceType.UPLOAD_FILE,
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
                data_source_type=DataSourceType.UPLOAD_FILE,
                batch=str(uuid.uuid4()),  # Required field
                created_from=DocumentCreatedFrom.WEB,
                name=f"Disabled Document {i}",
                created_by=account.id,
                doc_form=IndexStructureType.PARAGRAPH_INDEX,
                indexing_status=IndexingStatus.COMPLETED,
                enabled=False,  # Disabled
                archived=False,
            )
            db_session_with_containers.add(document)

        db_session_with_containers.commit()

        # Act
        repository = _retrieval_repository(db_session_with_containers)
        result = repository.list_available_datasets(tenant_id=tenant.id, dataset_ids=[dataset.id])

        # Assert
        assert len(result) == 0

    def test_filters_out_datasets_with_non_completed_documents(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):
        # Arrange
        fake = Faker()

        account = account_fixtures.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=generate_valid_password(fake),
            session=db_session_with_containers,
        )
        account_fixtures.create_owner_workspace(account, name=fake.company(), session=db_session_with_containers)
        tenant = account.current_tenant

        dataset = Dataset(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            name=fake.company(),
            provider="dify",
            data_source_type=DataSourceType.UPLOAD_FILE,
            created_by=account.id,
        )
        db_session_with_containers.add(dataset)

        # Create documents with non-completed status
        for i, status in enumerate([IndexingStatus.INDEXING, IndexingStatus.PARSING, IndexingStatus.SPLITTING]):
            document = Document(
                id=str(uuid.uuid4()),
                tenant_id=tenant.id,
                dataset_id=dataset.id,
                position=i,
                data_source_type=DataSourceType.UPLOAD_FILE,
                batch=str(uuid.uuid4()),  # Required field
                created_from=DocumentCreatedFrom.WEB,
                name=f"Document {status}",
                created_by=account.id,
                doc_form=IndexStructureType.PARAGRAPH_INDEX,
                indexing_status=status,  # Not completed
                enabled=True,
                archived=False,
            )
            db_session_with_containers.add(document)

        db_session_with_containers.commit()

        # Act
        repository = _retrieval_repository(db_session_with_containers)
        result = repository.list_available_datasets(tenant_id=tenant.id, dataset_ids=[dataset.id])

        # Assert
        assert len(result) == 0

    def test_includes_external_datasets_without_documents(
        self, db_session_with_containers: Session, mock_external_service_dependencies
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

        account = account_fixtures.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=generate_valid_password(fake),
            session=db_session_with_containers,
        )
        account_fixtures.create_owner_workspace(account, name=fake.company(), session=db_session_with_containers)
        tenant = account.current_tenant

        dataset = Dataset(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            name=fake.company(),
            provider="external",  # External provider
            data_source_type=DataSourceType.UPLOAD_FILE,
            created_by=account.id,
        )
        db_session_with_containers.add(dataset)
        db_session_with_containers.commit()

        # Act
        repository = _retrieval_repository(db_session_with_containers)
        result = repository.list_available_datasets(tenant_id=tenant.id, dataset_ids=[dataset.id])

        # Assert
        assert len(result) == 1
        assert result[0].id == dataset.id
        assert result[0].provider == "external"

    def test_filters_by_tenant_id(self, db_session_with_containers: Session, mock_external_service_dependencies):
        # Arrange
        fake = Faker()

        # Create two accounts/tenants
        account1 = account_fixtures.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=generate_valid_password(fake),
            session=db_session_with_containers,
        )
        account_fixtures.create_owner_workspace(account1, name=fake.company(), session=db_session_with_containers)
        tenant1 = account1.current_tenant

        account2 = account_fixtures.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=generate_valid_password(fake),
            session=db_session_with_containers,
        )
        account_fixtures.create_owner_workspace(account2, name=fake.company(), session=db_session_with_containers)
        tenant2 = account2.current_tenant

        # Create dataset for tenant1
        dataset1 = Dataset(
            id=str(uuid.uuid4()),
            tenant_id=tenant1.id,
            name="Tenant 1 Dataset",
            provider="dify",
            data_source_type=DataSourceType.UPLOAD_FILE,
            created_by=account1.id,
        )
        db_session_with_containers.add(dataset1)

        # Create dataset for tenant2
        dataset2 = Dataset(
            id=str(uuid.uuid4()),
            tenant_id=tenant2.id,
            name="Tenant 2 Dataset",
            provider="dify",
            data_source_type=DataSourceType.UPLOAD_FILE,
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
                data_source_type=DataSourceType.UPLOAD_FILE,
                batch=str(uuid.uuid4()),  # Required field
                created_from=DocumentCreatedFrom.WEB,
                name=f"Document for {dataset.name}",
                created_by=account.id,
                doc_form=IndexStructureType.PARAGRAPH_INDEX,
                indexing_status=IndexingStatus.COMPLETED,
                enabled=True,
                archived=False,
            )
            db_session_with_containers.add(document)

        db_session_with_containers.commit()

        # Act - request from tenant1, should only get tenant1's dataset
        repository = _retrieval_repository(db_session_with_containers)
        result = repository.list_available_datasets(
            tenant_id=tenant1.id,
            dataset_ids=[dataset1.id, dataset2.id],
        )

        # Assert
        assert len(result) == 1
        assert result[0].id == dataset1.id
        assert result[0].tenant_id == tenant1.id

    def test_returns_empty_list_when_no_datasets_found(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):
        # Arrange
        fake = Faker()

        account = account_fixtures.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=generate_valid_password(fake),
            session=db_session_with_containers,
        )
        account_fixtures.create_owner_workspace(account, name=fake.company(), session=db_session_with_containers)
        tenant = account.current_tenant

        # Don't create any datasets

        # Act
        repository = _retrieval_repository(db_session_with_containers)
        result = repository.list_available_datasets(
            tenant_id=tenant.id,
            dataset_ids=[str(uuid.uuid4())],
        )

        # Assert
        assert result == []

    def test_returns_only_requested_dataset_ids(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):
        # Arrange
        fake = Faker()

        account = account_fixtures.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=generate_valid_password(fake),
            session=db_session_with_containers,
        )
        account_fixtures.create_owner_workspace(account, name=fake.company(), session=db_session_with_containers)
        tenant = account.current_tenant

        # Create multiple datasets
        datasets = []
        for i in range(3):
            dataset = Dataset(
                id=str(uuid.uuid4()),
                tenant_id=tenant.id,
                name=f"Dataset {i}",
                provider="dify",
                data_source_type=DataSourceType.UPLOAD_FILE,
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
                data_source_type=DataSourceType.UPLOAD_FILE,
                batch=str(uuid.uuid4()),  # Required field
                created_from=DocumentCreatedFrom.WEB,
                name=f"Document {i}",
                created_by=account.id,
                doc_form=IndexStructureType.PARAGRAPH_INDEX,
                indexing_status=IndexingStatus.COMPLETED,
                enabled=True,
                archived=False,
            )
            db_session_with_containers.add(document)

        db_session_with_containers.commit()

        # Act - request only dataset 0 and 2, not dataset 1
        repository = _retrieval_repository(db_session_with_containers)
        requested_ids = [datasets[0].id, datasets[2].id]
        result = repository.list_available_datasets(tenant_id=tenant.id, dataset_ids=requested_ids)

        # Assert
        assert len(result) == 2
        returned_ids = {d.id for d in result}
        assert returned_ids == {datasets[0].id, datasets[2].id}


class TestKnowledgeRetrievalIntegration:
    def test_knowledge_retrieval_with_available_datasets(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):
        # Arrange
        fake = Faker()

        account = account_fixtures.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=generate_valid_password(fake),
            session=db_session_with_containers,
        )
        account_fixtures.create_owner_workspace(account, name=fake.company(), session=db_session_with_containers)
        tenant = account.current_tenant

        dataset = Dataset(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            name=fake.company(),
            provider="dify",
            data_source_type=DataSourceType.UPLOAD_FILE,
            created_by=account.id,
            indexing_technique=IndexTechniqueType.HIGH_QUALITY,
        )
        db_session_with_containers.add(dataset)

        document = Document(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            position=0,
            data_source_type=DataSourceType.UPLOAD_FILE,
            batch=str(uuid.uuid4()),  # Required field
            created_from=DocumentCreatedFrom.WEB,
            name=fake.sentence(),
            created_by=account.id,
            indexing_status=IndexingStatus.COMPLETED,
            enabled=True,
            archived=False,
            doc_form=IndexStructureType.PARAGRAPH_INDEX,
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

        dataset_retrieval = _dataset_retrieval(db_session_with_containers)

        with patch.object(
            CandidateSearch,
            "search_multiple",
            return_value=CandidateSearchResult(
                candidates=(),
                top_k=5,
                queried_dataset_ids=(),
                timer={},
                usage=LLMUsage.empty_usage(),
            ),
        ):
            result = dataset_retrieval.retrieve(request, request_metadata=None)

        assert result.sources == []

    def test_knowledge_retrieval_no_available_datasets(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):
        # Arrange
        fake = Faker()

        account = account_fixtures.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=generate_valid_password(fake),
            session=db_session_with_containers,
        )
        account_fixtures.create_owner_workspace(account, name=fake.company(), session=db_session_with_containers)
        tenant = account.current_tenant

        # Create dataset but no documents
        dataset = Dataset(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            name=fake.company(),
            provider="dify",
            data_source_type=DataSourceType.UPLOAD_FILE,
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

        dataset_retrieval = _dataset_retrieval(db_session_with_containers)

        result = dataset_retrieval.retrieve(request, request_metadata=None)

        assert result.sources == []

    def test_knowledge_retrieval_rate_limit_exceeded(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):
        # Arrange
        fake = Faker()

        account = account_fixtures.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=generate_valid_password(fake),
            session=db_session_with_containers,
        )
        account_fixtures.create_owner_workspace(account, name=fake.company(), session=db_session_with_containers)
        tenant = account.current_tenant

        dataset = Dataset(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            name=fake.company(),
            provider="dify",
            data_source_type=DataSourceType.UPLOAD_FILE,
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

        limits = create_autospec(DatasetAdmissionLimits, instance=True, spec_set=True)
        limits.check.side_effect = Exception("Rate limit exceeded")
        dataset_retrieval = _dataset_retrieval(db_session_with_containers, limits=limits)

        with pytest.raises(Exception, match="Rate limit exceeded"):
            dataset_retrieval.retrieve(request, request_metadata=None)


@pytest.fixture
def mock_external_service_dependencies():
    with (
        patch("services.account.login_adapters.SystemFeatureService") as mock_account_feature_service,
    ):
        # Setup default mock returns for account service
        mock_account_feature_service.is_registration_allowed.return_value = True

        yield {
            "account_feature_service": mock_account_feature_service,
        }
