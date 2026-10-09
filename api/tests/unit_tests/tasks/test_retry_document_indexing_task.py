from unittest.mock import ANY, MagicMock, patch
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session

from core.app.apps.pipeline.pipeline_generator import PipelineGenerator
from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from enums import DeploymentEdition
from models import Account, Tenant, TenantAccountJoin
from models.account import TenantAccountRole
from models.dataset import Dataset, Document
from models.enums import DatasetRuntimeMode, DataSourceType, DocumentCreatedFrom, IndexingStatus
from tasks.retry_document_indexing_task import retry_document_indexing_task
from tests.unit_tests.config_override import config_overrides_context


@config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
@pytest.mark.parametrize("runtime_mode", [DatasetRuntimeMode.GENERAL, DatasetRuntimeMode.RAG_PIPELINE])
def test_retry_uses_dataset_runtime(sqlite_session: Session, runtime_mode: DatasetRuntimeMode) -> None:
    tenant = Tenant(name="Retry tenant")
    user = Account(name="Retry user", email=f"retry-{uuid4()}@example.com")
    membership = TenantAccountJoin(
        tenant_id=tenant.id,
        account_id=user.id,
        current=True,
        role=TenantAccountRole.OWNER,
    )
    dataset = Dataset(
        id=str(uuid4()),
        tenant_id=tenant.id,
        name="Retry dataset",
        created_by=user.id,
        data_source_type=DataSourceType.UPLOAD_FILE,
        indexing_technique=IndexTechniqueType.ECONOMY,
        chunk_structure=IndexStructureType.PARAGRAPH_INDEX,
        runtime_mode=runtime_mode,
    )
    document = Document(
        id=str(uuid4()),
        tenant_id=tenant.id,
        dataset_id=dataset.id,
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        data_source_info="{}",
        batch="retry-batch",
        name="Retry document",
        created_from=DocumentCreatedFrom.WEB,
        created_by=user.id,
        indexing_status=IndexingStatus.COMPLETED,
        enabled=True,
        archived=False,
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
    )
    sqlite_session.add_all([tenant, user, membership, dataset, document])
    sqlite_session.commit()
    features = MagicMock()

    with (
        patch("tasks.retry_document_indexing_task.FeatureService.get_features", return_value=features),
        patch("tasks.retry_document_indexing_task.IndexProcessorFactory"),
        patch("tasks.retry_document_indexing_task.build_document_indexing_service") as indexing_runner,
        patch("tasks.retry_document_indexing_task.RagPipelineService") as pipeline_service,
        patch("tasks.retry_document_indexing_task.redis_client"),
    ):
        retry_document_indexing_task.run(dataset.id, [document.id], user.id)

    if runtime_mode == DatasetRuntimeMode.GENERAL:
        pipeline_service.assert_not_called()
        indexing_runner.assert_called_once_with(session_factory=ANY, enforce_vector_space_admission=True)
        (run_documents,) = indexing_runner.return_value.run.call_args.args
        assert [item.document_id for item in run_documents] == [document.id]
        assert run_documents[0].dataset.tenant_id == dataset.tenant_id
    else:
        indexing_runner.assert_not_called()
        retry = pipeline_service.return_value.retry_error_document
        retry.assert_called_once()
        retry_dataset, retry_document, retry_user = retry.call_args.args
        assert (retry_dataset.id, retry_document.id, retry_user.id) == (dataset.id, document.id, user.id)
        assert isinstance(retry.call_args.kwargs["generator"], PipelineGenerator)
