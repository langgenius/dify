from collections.abc import Generator
from contextlib import contextmanager, nullcontext
from datetime import datetime
from unittest.mock import ANY, MagicMock, create_autospec, patch
from uuid import uuid4

import pytest
from celery.exceptions import Retry
from flask import Flask
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from enums import DeploymentEdition
from enums.creator import CreatorUserRole
from extensions.ext_application_services import ApplicationServices
from extensions.storage.storage_type import StorageType
from models import Account, Tenant, TenantAccountJoin
from models.account import TenantAccountRole
from models.dataset import Dataset, Document, DocumentSegment
from models.enums import DatasetRuntimeMode, DataSourceType, DocumentCreatedFrom, IndexingStatus
from models.model import UploadFile
from services.knowledge.indexing.locks import (
    KnowledgeIndexingLease,
    KnowledgeIndexingLeaseLostError,
    KnowledgeIndexingLock,
    KnowledgeIndexingLockBusyError,
    document_index_lock_name,
)
from tasks.retry_document_indexing_task import retry_document_indexing_task
from tests.unit_tests.config_override import config_overrides_context


@config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
@pytest.mark.parametrize("runtime_mode", [DatasetRuntimeMode.GENERAL, DatasetRuntimeMode.RAG_PIPELINE])
@pytest.mark.parametrize("recovery_status", [IndexingStatus.SPLITTING, IndexingStatus.INDEXING])
def test_retry_uses_dataset_runtime(
    sqlite_session: Session,
    runtime_mode: DatasetRuntimeMode,
    recovery_status: IndexingStatus,
    app: Flask,
    account_application_services: ApplicationServices,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setitem(app.extensions, "application_services", account_application_services)
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
        indexing_status=IndexingStatus.WAITING,
        processing_started_at=datetime(2026, 10, 19, 12, 0),
        enabled=True,
        archived=False,
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
    )
    old_image = UploadFile(
        tenant_id=tenant.id,
        storage_type=StorageType.LOCAL,
        key="old-excel-image",
        name="old.png",
        size=10,
        extension="png",
        mime_type="image/png",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=user.id,
        created_at=datetime(2026, 10, 19, 12, 0),
        used=False,
    )
    new_image = UploadFile(
        tenant_id=tenant.id,
        storage_type=StorageType.LOCAL,
        key="new-excel-image",
        name="new.png",
        size=10,
        extension="png",
        mime_type="image/png",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=user.id,
        created_at=datetime(2026, 10, 19, 12, 0),
        used=False,
    )
    old_segment = DocumentSegment(
        tenant_id=tenant.id,
        dataset_id=dataset.id,
        document_id=document.id,
        position=1,
        content=f"![old](/files/{old_image.id}/image-preview)",
        word_count=1,
        tokens=1,
        created_by=user.id,
        index_node_id="old-node",
    )
    sqlite_session.add_all([tenant, user, membership, dataset, document, old_image, new_image, old_segment])
    sqlite_session.commit()
    old_image_id = old_image.id
    new_image_id = new_image.id
    document_id = document.id
    features = MagicMock()
    lease = create_autospec(KnowledgeIndexingLease, instance=True, spec_set=True)
    lease.token = "worker-token"
    indexing_locks = create_autospec(KnowledgeIndexingLock, instance=True, spec_set=True)
    indexing_locks.hold_handoff.return_value = nullcontext(lease)

    with (
        patch("tasks.retry_document_indexing_task.FeatureService.get_features", return_value=features),
        patch("tasks.retry_document_indexing_task.IndexProcessorFactory"),
        patch("tasks.retry_document_indexing_task.build_document_indexing_service") as indexing_runner,
        patch("tasks.retry_document_indexing_task.build_rag_pipeline_service") as pipeline_service,
        patch(
            "tasks.retry_document_indexing_task.RedisKnowledgeIndexingLock",
            return_value=indexing_locks,
        ),
        patch("tasks.retry_document_indexing_task.redis_client") as redis,
        patch("services.file_adapters.storage.delete") as delete_blob,
    ):
        retry_document_indexing_task.run(dataset.id, [document.id], user.id)

        # Late-ack redelivery after worker loss may observe a later in-progress
        # phase. The unchanged DB generation is still safe to restart.
        sqlite_session.expire_all()
        interrupted_document = sqlite_session.get_one(Document, document.id)
        interrupted_document.indexing_status = recovery_status
        sqlite_session.commit()
        retry_document_indexing_task.run(dataset.id, [document.id], user.id)

        # The unchanged message is intentionally a wake-up. If a same-actor
        # producer admitted a newer generation before claim, this delivery may
        # execute that current generation instead of its original request.
        sqlite_session.expire_all()
        replaced_document = sqlite_session.get_one(Document, document.id)
        replaced_document.indexing_status = IndexingStatus.WAITING
        replaced_document.processing_started_at = datetime(2026, 10, 29, 12, 30, 45, 654321)
        sqlite_session.commit()
        retry_document_indexing_task.run(dataset.id, [document.id], user.id)

        # Terminal documents are dropped before Redis ownership is touched.
        sqlite_session.expire_all()
        completed_document = sqlite_session.get_one(Document, document.id)
        completed_document.indexing_status = IndexingStatus.COMPLETED
        sqlite_session.commit()
        retry_document_indexing_task.run(dataset.id, [document.id], user.id)

    assert indexing_locks.hold_handoff.call_count == 3
    indexing_locks.hold_handoff.assert_called_with(
        document_index_lock_name(document.id),
        timeout=600,
        owner_id=user.id,
        blocking_timeout=5,
    )
    assert lease.assert_owned.call_count >= 3
    redis.delete.assert_not_called()

    sqlite_session.expire_all()
    remaining_file_ids = set(
        sqlite_session.scalars(select(UploadFile.id).where(UploadFile.id.in_((old_image_id, new_image_id)))).all()
    )
    assert remaining_file_ids == {old_image_id, new_image_id}
    assert sqlite_session.scalars(select(DocumentSegment).where(DocumentSegment.document_id == document_id)).all()
    delete_blob.assert_not_called()

    if runtime_mode == DatasetRuntimeMode.GENERAL:
        pipeline_service.assert_not_called()
        assert indexing_runner.call_count == 3
        indexing_runner.assert_called_with(session_factory=ANY, enforce_vector_space_admission=True)
        (run_documents,) = indexing_runner.return_value.run.call_args.args
        assert [item.document_id for item in run_documents] == [document.id]
        assert run_documents[0].dataset.tenant_id == dataset.tenant_id
        assert indexing_runner.return_value.run.call_args.kwargs["owned_leases"] == {document.id: lease}
    else:
        indexing_runner.assert_not_called()
        assert pipeline_service.call_count == 3
        pipeline_service.assert_called_with(session=ANY)
        retry = pipeline_service.return_value.retry_error_document
        assert retry.call_count == 3
        retry_dataset, retry_document, retry_user = retry.call_args.args
        assert retry_dataset.id == dataset.id
        assert retry.call_args.kwargs["generator"] is account_application_services.knowledge.pipeline_generator
        assert (retry_document.id, retry_user.id) == (document.id, user.id)


def test_retry_requeues_the_unchanged_message_while_a_worker_owner_exists() -> None:
    indexing_locks = create_autospec(KnowledgeIndexingLock, instance=True, spec_set=True)
    indexing_locks.hold_handoff.side_effect = KnowledgeIndexingLockBusyError("owned by another worker")
    generation = datetime(2026, 10, 29, 12, 30, 45, 123456)

    with (
        patch(
            "tasks.retry_document_indexing_task._active_retry_generations",
            return_value={"document-1": generation},
        ),
        patch(
            "tasks.retry_document_indexing_task.RedisKnowledgeIndexingLock",
            return_value=indexing_locks,
        ),
        patch("tasks.retry_document_indexing_task._run_retry_document_indexing") as run_retry,
        patch.object(retry_document_indexing_task, "retry", side_effect=Retry()) as retry,
    ):
        with pytest.raises(Retry):
            retry_document_indexing_task.run("dataset-1", ["document-1"], "actor-1")

    run_retry.assert_not_called()
    retry.assert_called_once()
    assert retry.call_args.kwargs["exc"].args == ("owned by another worker",)
    assert retry_document_indexing_task.acks_late is True
    assert retry_document_indexing_task.reject_on_worker_lost is True
    assert retry_document_indexing_task.max_retries == 12


@config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
def test_retry_redelivery_recovers_after_lease_loss_with_parsing_committed(
    sqlite_session: Session,
    app: Flask,
) -> None:
    tenant = Tenant(name="Lease recovery tenant")
    user = Account(name="Lease recovery user", email=f"lease-recovery-{uuid4()}@example.com")
    membership = TenantAccountJoin(
        tenant_id=tenant.id,
        account_id=user.id,
        current=True,
        role=TenantAccountRole.OWNER,
    )
    dataset = Dataset(
        id=str(uuid4()),
        tenant_id=tenant.id,
        name="Lease recovery dataset",
        created_by=user.id,
        data_source_type=DataSourceType.UPLOAD_FILE,
        indexing_technique=IndexTechniqueType.ECONOMY,
        chunk_structure=IndexStructureType.PARAGRAPH_INDEX,
        runtime_mode=DatasetRuntimeMode.GENERAL,
    )
    generation = datetime(2026, 10, 29, 12, 30, 45, 123456)
    document = Document(
        id=str(uuid4()),
        tenant_id=tenant.id,
        dataset_id=dataset.id,
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        data_source_info="{}",
        batch="lease-recovery-batch",
        name="Lease recovery document",
        created_from=DocumentCreatedFrom.WEB,
        created_by=user.id,
        indexing_status=IndexingStatus.WAITING,
        processing_started_at=generation,
        enabled=True,
        archived=False,
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
    )
    sqlite_session.add_all([tenant, user, membership, dataset, document])
    sqlite_session.commit()

    lost_lease = create_autospec(KnowledgeIndexingLease, instance=True, spec_set=True)
    lost_lease.assert_owned.side_effect = [None, None, KnowledgeIndexingLeaseLostError("redis unavailable")]
    recovered_lease = create_autospec(KnowledgeIndexingLease, instance=True, spec_set=True)
    indexing_locks = create_autospec(KnowledgeIndexingLock, instance=True, spec_set=True)
    indexing_locks.hold_handoff.side_effect = [nullcontext(lost_lease), nullcontext(recovered_lease)]

    with (
        app.app_context(),
        patch("tasks.retry_document_indexing_task.IndexProcessorFactory"),
        patch("tasks.retry_document_indexing_task.build_document_indexing_service") as indexing_runner,
        patch(
            "tasks.retry_document_indexing_task.RedisKnowledgeIndexingLock",
            return_value=indexing_locks,
        ),
        patch.object(retry_document_indexing_task, "retry", side_effect=Retry()) as retry,
    ):
        with pytest.raises(Retry):
            retry_document_indexing_task.run(dataset.id, [document.id], user.id)

        sqlite_session.expire_all()
        interrupted = sqlite_session.get_one(Document, document.id)
        assert interrupted.indexing_status == IndexingStatus.PARSING
        assert interrupted.processing_started_at == generation
        retry.assert_called_once()
        assert isinstance(retry.call_args.kwargs["exc"], KnowledgeIndexingLeaseLostError)

        retry_document_indexing_task.run(dataset.id, [document.id], user.id)

    indexing_runner.return_value.run.assert_called_once()
    assert indexing_runner.return_value.run.call_args.kwargs["owned_leases"] == {document.id: recovered_lease}
    assert indexing_locks.hold_handoff.call_count == 2


def test_retry_message_claims_the_server_side_actor_handoff() -> None:
    lease = create_autospec(KnowledgeIndexingLease, instance=True, spec_set=True)
    indexing_locks = create_autospec(KnowledgeIndexingLock, instance=True, spec_set=True)
    indexing_locks.hold_handoff.return_value = nullcontext(lease)
    generation = datetime(2026, 10, 29, 12, 30, 45, 123456)

    with (
        patch(
            "tasks.retry_document_indexing_task._active_retry_generations",
            return_value={"document-1": generation},
        ),
        patch(
            "tasks.retry_document_indexing_task.RedisKnowledgeIndexingLock",
            return_value=indexing_locks,
        ),
        patch("tasks.retry_document_indexing_task._run_retry_document_indexing") as run_retry,
    ):
        retry_document_indexing_task.run("dataset-1", ["document-1"], "actor-1")

    indexing_locks.hold_handoff.assert_called_once_with(
        document_index_lock_name("document-1"),
        timeout=600,
        owner_id="actor-1",
        blocking_timeout=5,
    )
    run_retry.assert_called_once_with(
        "dataset-1",
        ["document-1"],
        "actor-1",
        {"document-1": lease},
        {"document-1": generation},
    )


def test_retry_batch_requeues_without_processing_a_partial_claim() -> None:
    first = create_autospec(KnowledgeIndexingLease, instance=True, spec_set=True)
    indexing_locks = create_autospec(KnowledgeIndexingLock, instance=True, spec_set=True)
    exited: list[KnowledgeIndexingLease] = []

    @contextmanager
    def hold(name: str, **_kwargs: object) -> Generator[KnowledgeIndexingLease]:
        if name == document_index_lock_name("document-2"):
            raise KnowledgeIndexingLockBusyError("replacement owner")
        try:
            yield first
        finally:
            exited.append(first)

    indexing_locks.hold_handoff.side_effect = hold
    generation = datetime(2026, 10, 29, 12, 30, 45, 123456)
    generations = dict.fromkeys(("document-1", "document-2", "document-3"), generation)
    with (
        patch(
            "tasks.retry_document_indexing_task._active_retry_generations",
            return_value=generations,
        ),
        patch(
            "tasks.retry_document_indexing_task.RedisKnowledgeIndexingLock",
            return_value=indexing_locks,
        ),
        patch("tasks.retry_document_indexing_task._run_retry_document_indexing") as run_retry,
        patch.object(retry_document_indexing_task, "retry", side_effect=Retry()) as retry,
    ):
        with pytest.raises(Retry):
            retry_document_indexing_task.run(
                "dataset-1",
                ["document-1", "document-2", "document-3"],
                "actor-1",
            )

    run_retry.assert_not_called()
    assert exited == [first]
    retry.assert_called_once()
