from __future__ import annotations

from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime
from typing import cast, override
from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from enums import DeploymentEdition
from models import Account, Tenant, TenantAccountJoin
from models.account import TenantAccountRole
from models.dataset import Dataset, Document, DocumentPipelineExecutionLog, Pipeline
from models.enums import DatasetRuntimeMode, DataSourceType, DocumentCreatedFrom, IndexingStatus
from models.knowledge_task import KnowledgeTaskOutbox
from models.model import EndUser
from models.workflow import Workflow, WorkflowType
from services.knowledge.indexing.contracts import DocumentIndexingExecution
from services.knowledge.rag_pipeline import adapters as pipeline_adapters
from services.knowledge.rag_pipeline.adapters import PreparedPipelineRun, SQLAlchemyPipelineRunPreparer
from services.rag_pipeline.entities import RagPipelineDocumentRecovery
from services.rag_pipeline.tenant_task_queue import (
    RagPipelineTaskCompletion,
    RagPipelineTaskExecutionBudgetExhaustedError,
    RagPipelineTaskTarget,
    RagPipelineTenantTask,
)
from tasks import retry_document_indexing_task as retry_task_module
from tasks.rag_pipeline import rag_pipeline_run_task as pipeline_worker
from tests.unit_tests.config_override import config_overrides_context


class _BudgetExhaustedQueue:
    def __init__(self, task: RagPipelineTenantTask) -> None:
        self.task = task
        self.dead_letters: list[str] = []

    @contextmanager
    def maintain(self, receipt: str) -> Generator[None]:
        raise RagPipelineTaskExecutionBudgetExhaustedError(receipt)
        yield

    def get_claimed_task(self, _receipt: str) -> RagPipelineTenantTask:
        return self.task

    def dead_letter(self, receipt: str, *, concurrency: int, error: str) -> RagPipelineTaskCompletion:
        assert concurrency == 1
        assert error == "execution budget exhausted"
        self.dead_letters.append(receipt)
        return RagPipelineTaskCompletion(owned=True, next_claims=())

    def defer_exhausted(
        self,
        _receipt: str,
        *,
        delay_seconds: int,
        error: str,
        refund_attempt: bool = False,
    ) -> bool:
        raise AssertionError(f"unexpected recovery deferral: {delay_seconds=} {error=} {refund_attempt=}")


class _FileService:
    def __init__(self) -> None:
        self.deleted: list[str] = []

    def delete_file(self, file_id: str) -> None:
        self.deleted.append(file_id)


class _SessionFacade:
    def close(self) -> None:
        return None


@dataclass(frozen=True)
class _Database:
    engine: object
    session: _SessionFacade


@dataclass(frozen=True)
class _CredentialServices:
    providers: object = field(default_factory=object)


class _Lease:
    token = "lease-token"

    def assert_owned(self) -> None:
        return None

    def renew(self) -> bool:
        return True

    def release(self) -> bool:
        return True


class _Locks:
    @contextmanager
    def hold(self, *_args: object, **_kwargs: object) -> Generator[_Lease]:
        yield _Lease()


class _SessionFactory:
    def __init__(self, sessions: sessionmaker[Session]) -> None:
        self._sessions = sessions

    def create_session(self) -> Session:
        return self._sessions()

    def get_session_maker(self) -> sessionmaker[Session]:
        return self._sessions


class _IndexProcessor:
    def clean(self, *_args: object, **_kwargs: object) -> None:
        return None


class _IndexProcessorFactory:
    def __init__(self, _document_form: str) -> None:
        return None

    def init_index_processor(self) -> _IndexProcessor:
        return _IndexProcessor()


class _CurrentApp:
    def _get_current_object(self) -> object:
        return object()


class _ObservedPreparer(SQLAlchemyPipelineRunPreparer):
    consumed_inputs: list[dict[str, object]] = []

    @override
    def prepare_retry(
        self,
        document: Document,
        user: Account | EndUser,
        *,
        session: Session,
        execution: DocumentIndexingExecution,
    ) -> PreparedPipelineRun:
        prepared = super().prepare_retry(
            document,
            user,
            session=session,
            execution=execution,
        )
        state = self._pipelines.get_retry_state(
            session,
            tenant_id=document.tenant_id,
            dataset_id=document.dataset_id,
            document_id=document.id,
            indexing_generation=cast("str", document.indexing_generation),
        )
        assert state is not None
        self.consumed_inputs.append(dict(state.input_data))
        return prepared

    @staticmethod
    @override
    def execute(prepared: PreparedPipelineRun) -> dict[str, object]:
        del prepared
        return {}


@config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
def test_unreadable_pipeline_payload_budget_persists_repair_then_real_retry_consumer_uses_current_log(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tenant = Tenant(name="Pipeline recovery tenant")
    user = Account(name="Pipeline recovery user", email=f"pipeline-recovery-{uuid4()}@example.com")
    membership = TenantAccountJoin(
        tenant_id=tenant.id,
        account_id=user.id,
        current=True,
        role=TenantAccountRole.OWNER,
    )
    pipeline = Pipeline(tenant_id=tenant.id, name="Pipeline", description="", created_by=user.id)
    pipeline.id = str(uuid4())
    workflow = Workflow(
        id=str(uuid4()),
        tenant_id=tenant.id,
        app_id=pipeline.id,
        type=WorkflowType.RAG_PIPELINE,
        version="published",
        graph="{}",
        features="{}",
        created_by=user.id,
    )
    pipeline.workflow_id = workflow.id
    dataset = Dataset(
        id=str(uuid4()),
        tenant_id=tenant.id,
        name="Pipeline recovery dataset",
        created_by=user.id,
        pipeline_id=pipeline.id,
        data_source_type=DataSourceType.UPLOAD_FILE,
        indexing_technique=IndexTechniqueType.ECONOMY,
        chunk_structure=IndexStructureType.PARAGRAPH_INDEX,
        runtime_mode=DatasetRuntimeMode.RAG_PIPELINE,
    )
    generation = str(uuid4())
    document = Document(
        id=str(uuid4()),
        tenant_id=tenant.id,
        dataset_id=dataset.id,
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        data_source_info="{}",
        batch="pipeline-recovery",
        name="Pipeline recovery document",
        created_from=DocumentCreatedFrom.WEB,
        created_by=user.id,
        indexing_status=IndexingStatus.WAITING,
        processing_started_at=datetime(2026, 10, 21, 12, 0),
        indexing_generation=generation,
        enabled=True,
        archived=False,
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
    )
    execution_log = DocumentPipelineExecutionLog(
        pipeline_id=pipeline.id,
        document_id=document.id,
        indexing_generation=generation,
        datasource_type=DataSourceType.LOCAL_FILE,
        datasource_info='{"name":"recoverable.txt"}',
        datasource_node_id="source-start",
        input_data={"query": "recover from database"},
        created_by=user.id,
    )
    sqlite_session.add_all([tenant, user, membership, pipeline, workflow, dataset, document, execution_log])
    sqlite_session.commit()

    queued_task = RagPipelineTenantTask(
        file_id="unreadable-file",
        target=RagPipelineTaskTarget.REGULAR,
        document_recoveries=(
            RagPipelineDocumentRecovery(
                dataset_id=dataset.id,
                document_id=document.id,
                indexing_generation=generation,
                actor_id=user.id,
            ),
        ),
    )
    queue = _BudgetExhaustedQueue(queued_task)
    files = _FileService()
    monkeypatch.setattr(pipeline_worker, "RagPipelineTenantTaskQueue", lambda _tenant_id: queue)
    monkeypatch.setattr(pipeline_worker, "FileService", lambda _engine: files)
    monkeypatch.setattr(
        pipeline_worker,
        "db",
        _Database(engine=sqlite_session.get_bind(), session=_SessionFacade()),
    )
    monkeypatch.setattr(pipeline_worker, "dispatch_rag_pipeline_claims", lambda **_kwargs: 0)
    monkeypatch.setattr(pipeline_worker, "wake_knowledge_task_dispatcher_after_commit", lambda _session: None)

    pipeline_worker.rag_pipeline_run_task.run(
        "unreadable-file",
        tenant.id,
        tenant_queue_receipt="receipt-exhausted",
    )

    sqlite_session.expire_all()
    intent = sqlite_session.scalar(select(KnowledgeTaskOutbox).where(KnowledgeTaskOutbox.dataset_id == dataset.id))
    assert intent is not None
    assert intent.payload["generations"] == {document.id: generation}
    assert queue.dead_letters == ["receipt-exhausted"]
    assert files.deleted == ["unreadable-file"]

    _ObservedPreparer.consumed_inputs.clear()
    monkeypatch.setattr(retry_task_module, "session_factory", _SessionFactory(sqlite_session_factory))
    monkeypatch.setattr(retry_task_module, "RedisKnowledgeIndexingLock", lambda **_kwargs: _Locks())
    monkeypatch.setattr(retry_task_module, "IndexProcessorFactory", _IndexProcessorFactory)
    monkeypatch.setattr(retry_task_module, "SQLAlchemyPipelineRunPreparer", _ObservedPreparer)
    monkeypatch.setattr(
        retry_task_module,
        "build_data_source_credentials",
        lambda **_kwargs: _CredentialServices(),
    )
    monkeypatch.setattr(retry_task_module, "get_session_maker", lambda: sqlite_session_factory)
    monkeypatch.setattr(pipeline_adapters, "current_app", _CurrentApp())
    monkeypatch.setattr(
        pipeline_adapters.DifyCoreRepositoryFactory,
        "create_workflow_execution_repository",
        staticmethod(lambda **_kwargs: object()),
    )
    monkeypatch.setattr(
        pipeline_adapters.DifyCoreRepositoryFactory,
        "create_workflow_node_execution_repository",
        staticmethod(lambda **_kwargs: object()),
    )

    retry_task_module.retry_document_indexing_task.run(
        dataset.id,
        [document.id],
        user.id,
        {},
        {document.id: generation},
        True,
    )

    assert _ObservedPreparer.consumed_inputs == [{"query": "recover from database"}]

    # A recovered legacy retry can omit its generation. That path rotates the
    # document generation, so it must carry the exact current pipeline input
    # before the old generation becomes unreachable.
    with sqlite_session_factory.begin() as session:
        recovered_document = session.get(Document, document.id)
        assert recovered_document is not None
        recovered_document.indexing_status = IndexingStatus.ERROR
    _ObservedPreparer.consumed_inputs.clear()

    retry_task_module.retry_document_indexing_task.run(
        dataset.id,
        [document.id],
        user.id,
        {},
        {},
        True,
    )

    with sqlite_session_factory() as session:
        successor = session.get(Document, document.id)
        assert successor is not None
        successor_generation = successor.indexing_generation
        assert successor_generation not in {None, generation}
        successor_log = session.scalar(
            select(DocumentPipelineExecutionLog).where(
                DocumentPipelineExecutionLog.document_id == document.id,
                DocumentPipelineExecutionLog.indexing_generation == successor_generation,
            )
        )
        assert successor_log is not None
        assert successor_log.input_data == {"query": "recover from database"}
    assert _ObservedPreparer.consumed_inputs == [{"query": "recover from database"}]
