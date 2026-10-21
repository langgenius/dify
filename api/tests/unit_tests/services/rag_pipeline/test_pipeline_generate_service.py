import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import cast
from unittest.mock import Mock

import pytest
from pytest_mock import MockerFixture
from sqlalchemy import select
from sqlalchemy.dialects import postgresql
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import QueuePool

from core.app.apps.pipeline.pipeline_generator import PipelineGenerator
from core.app.entities.app_invoke_entities import InvokeFrom, RagPipelineGenerateEntity
from core.datasource.entities.datasource_entities import DatasourceProviderType
from core.rag.index_processor.constant.index_type import IndexStructureType
from models.dataset import Dataset, Document, DocumentPipelineExecutionLog, Pipeline
from models.enums import DataSourceType, DocumentCreatedFrom, IndexingStatus
from models.model import Account
from models.workflow import Workflow, WorkflowType
from repositories.knowledge.document_repository import SQLAlchemyDocumentRepository
from services.knowledge.documents.contracts import DocumentCreationEnvironment, DocumentCreationLimits
from services.knowledge.indexing.adapters.execution import PipelineIndexProcessor
from services.knowledge.indexing.contracts import DocumentIndexingExecution
from services.knowledge.rag_pipeline import adapters as pipeline_adapters
from services.knowledge.rag_pipeline.adapters import SQLAlchemyPipelineRunPreparer
from services.knowledge.resource_scope import DatasetRef
from services.rag_pipeline.entities import RagPipelineInvokeEntity
from services.rag_pipeline.pipeline_generate_service import PipelineGenerateService


@pytest.fixture
def pipeline_generator(mocker: MockerFixture) -> PipelineGenerator:
    return cast("PipelineGenerator", mocker.create_autospec(PipelineGenerator, instance=True, spec_set=True))


def _make_pipeline(*, tenant_id: str = "tenant-1") -> Pipeline:
    pipeline = Pipeline(tenant_id=tenant_id, name="Pipeline", description="")
    pipeline.id = "pipeline-1"
    return pipeline


def _make_account(*, account_id: str = "user-1") -> Account:
    account = Account(name="Pipeline User", email=f"{account_id}@example.com")
    account.id = account_id
    return account


def _make_workflow(*, workflow_id: str = "wf-1") -> Workflow:
    return Workflow(
        id=workflow_id,
        tenant_id="tenant-1",
        app_id="pipeline-1",
        type=WorkflowType.RAG_PIPELINE,
        version=Workflow.VERSION_DRAFT,
        graph="{}",
        features="{}",
        created_by="user-1",
    )


def _make_dataset(*, dataset_id: str = "dataset-1", tenant_id: str = "tenant-1") -> Dataset:
    return Dataset(
        id=dataset_id,
        tenant_id=tenant_id,
        name="Dataset",
        created_by="user-1",
        pipeline_id="pipeline-1",
    )


def _make_document(
    *, document_id: str = "doc-1", dataset_id: str = "dataset-1", tenant_id: str = "tenant-1"
) -> Document:
    return Document(
        id=document_id,
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        position=1,
        data_source_type=DataSourceType.LOCAL_FILE,
        batch="batch",
        name="Document",
        created_from=DocumentCreatedFrom.API,
        created_by="user-1",
        indexing_status=IndexingStatus.COMPLETED,
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
    )


@dataclass(slots=True)
class _CurrentAppStub:
    app: object = field(default_factory=object)

    def _get_current_object(self) -> object:
        return self.app


@dataclass(slots=True)
class _SessionBoundaryGenerator:
    pool: QueuePool
    executions: list[dict[str, object]] = field(default_factory=list)
    index_processors: list[object] = field(default_factory=list)
    document_failure_handlers: list[object] = field(default_factory=list)
    document_positions: list[int] = field(default_factory=list)

    def prepare_user_inputs(
        self,
        *,
        user_inputs: Mapping[str, object] | None,
        variables: Sequence[object],
        tenant_id: str,
        strict_type_validation: bool = False,
    ) -> Mapping[str, object]:
        del variables, tenant_id, strict_type_validation
        return dict(user_inputs or {})

    def build_document(
        self,
        tenant_id: str,
        dataset_id: str,
        built_in_field_enabled: bool,
        datasource_type: DatasourceProviderType,
        datasource_info: Mapping[str, object],
        created_from: str,
        position: int,
        account: Account,
        batch: str,
        document_form: str,
    ) -> Document:
        del built_in_field_enabled
        self.document_positions.append(position)
        return Document(
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            position=position,
            data_source_type=datasource_type,
            data_source_info=json.dumps(datasource_info),
            batch=batch,
            name=str(datasource_info.get("name", "untitled")),
            created_from=created_from,
            created_by=account.id,
            doc_form=document_form,
        )

    def run(self, **kwargs: object) -> Mapping[str, object]:
        assert self.pool.checkedout() == 0
        self.index_processors.append(kwargs.get("index_processor"))
        self.document_failure_handlers.append(kwargs.get("document_failure_handler"))
        pipeline = cast("Pipeline", kwargs["pipeline"])
        workflow = cast("Workflow", kwargs["workflow"])
        user = cast("Account", kwargs["user"])
        entity = cast("RagPipelineGenerateEntity", kwargs["application_generate_entity"])
        observation: dict[str, object] = {
            "pipeline_id": pipeline.id,
            "tenant_id": pipeline.tenant_id,
            "workflow_id": workflow.id,
            "workflow_graph": workflow.graph_dict,
            "user_id": user.id,
            "user_name": user.name,
            "dataset_id": entity.dataset_id,
            "datasource_info": dict(entity.datasource_info),
            "inputs": dict(entity.inputs),
        }
        self.executions.append(observation)
        return observation


def _patch_preparation_runtime(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(pipeline_adapters, "current_app", _CurrentAppStub())

    def repository_factory(**_kwargs: object) -> object:
        return object()

    monkeypatch.setattr(
        pipeline_adapters.DifyCoreRepositoryFactory,
        "create_workflow_execution_repository",
        staticmethod(repository_factory),
    )
    monkeypatch.setattr(
        pipeline_adapters.DifyCoreRepositoryFactory,
        "create_workflow_node_execution_repository",
        staticmethod(repository_factory),
    )


def test_prepared_pipeline_executes_with_detached_orm_state_after_connection_release(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_engine: Engine,
) -> None:
    pool = sqlite_engine.pool
    assert isinstance(pool, QueuePool)
    sessions = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    _patch_preparation_runtime(monkeypatch)
    runtime = _SessionBoundaryGenerator(pool)
    preparer = SQLAlchemyPipelineRunPreparer(
        session_factory=sessions,
        generator=cast("PipelineGenerator", runtime),
    )

    with sessions.begin() as session:
        session.add_all([_make_pipeline(), _make_dataset(), _make_workflow(), _make_account()])

    with sessions() as session:
        pipeline = session.get(Pipeline, "pipeline-1")
        user = session.get(Account, "user-1")
        workflow = session.get(Workflow, "wf-1")
        assert pipeline is not None
        assert user is not None
        assert workflow is not None
        prepared = preparer.prepare(
            pipeline=pipeline,
            workflow=preparer.snapshot_workflow(workflow),
            user=user,
            args={
                "inputs": {"query": "hello"},
                "start_node_id": "start",
                "datasource_type": DataSourceType.LOCAL_FILE,
                "datasource_info_list": [{"name": "source.txt", "credential_id": "actor-visible"}],
            },
            invoke_from=InvokeFrom.DEBUGGER,
            streaming=False,
            session=session,
            datasource_info_list=[{"name": "source.txt", "credential_id": "actor-visible"}],
            document_creation_environment=None,
        )
        session.commit()

    assert pool.checkedout() == 0
    result = cast("Mapping[str, object]", preparer.execute(prepared))

    assert result == {
        "pipeline_id": "pipeline-1",
        "tenant_id": "tenant-1",
        "workflow_id": "wf-1",
        "workflow_graph": {},
        "user_id": "user-1",
        "user_name": "Pipeline User",
        "dataset_id": "dataset-1",
        "datasource_info": {"name": "source.txt", "credential_id": "actor-visible"},
        "inputs": {"query": "hello"},
    }
    assert runtime.executions == [result]
    assert pool.checkedout() == 0


def test_published_batch_allocates_sequential_positions_from_one_locked_baseline(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_engine: Engine,
) -> None:
    pool = sqlite_engine.pool
    assert isinstance(pool, QueuePool)
    sessions = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    _patch_preparation_runtime(monkeypatch)
    runtime = _SessionBoundaryGenerator(pool)
    position_reads: list[str] = []
    next_document_position = pipeline_adapters.SQLAlchemyRagPipelineRepository.next_document_position

    def record_position_read(session: Session, *, dataset: Dataset) -> int:
        position_reads.append(dataset.id)
        return next_document_position(session, dataset=dataset)

    monkeypatch.setattr(
        pipeline_adapters.SQLAlchemyRagPipelineRepository,
        "next_document_position",
        staticmethod(record_position_read),
    )
    preparer = SQLAlchemyPipelineRunPreparer(
        session_factory=sessions,
        generator=cast("PipelineGenerator", runtime),
    )
    pipeline = _make_pipeline()
    workflow = _make_workflow()
    workflow.version = "published"
    pipeline.workflow_id = workflow.id
    dataset = _make_dataset()
    dataset.chunk_structure = IndexStructureType.PARAGRAPH_INDEX
    existing = _make_document(document_id="existing")
    existing.position = 7
    environment = DocumentCreationEnvironment(
        limits=DocumentCreationLimits(
            enabled=False,
            sandbox=False,
            batch_upload_limit=10,
            upload_quota_limit=0,
            upload_quota_size=0,
        ),
        priority_indexing=False,
        initial_permission="only_me",
    )
    datasource_info: list[Mapping[str, object]] = [{"name": "first.txt"}, {"name": "second.txt"}]

    with sessions.begin() as session:
        session.add_all([pipeline, dataset, workflow, _make_account(), existing])

    with sessions.begin() as session:
        persisted_pipeline = session.get(Pipeline, pipeline.id)
        persisted_workflow = session.get(Workflow, workflow.id)
        user = session.get(Account, "user-1")
        assert persisted_pipeline is not None
        assert persisted_workflow is not None
        assert user is not None
        preparer.prepare(
            pipeline=persisted_pipeline,
            workflow=persisted_workflow,
            user=user,
            args={
                "inputs": {},
                "start_node_id": "start",
                "datasource_type": DataSourceType.LOCAL_FILE,
                "datasource_info_list": datasource_info,
            },
            invoke_from=InvokeFrom.PUBLISHED_PIPELINE,
            streaming=False,
            session=session,
            datasource_info_list=datasource_info,
            document_creation_environment=environment,
        )

    with sessions() as session:
        positions = list(
            session.scalars(
                select(Document.position).where(Document.dataset_id == dataset.id).order_by(Document.position)
            ).all()
        )

    assert positions == [7, 8, 9]
    assert runtime.document_positions == [8, 9]
    assert position_reads == ["dataset-1"]


def test_pipeline_position_allocator_locks_dataset_parent_for_concurrent_writers() -> None:
    dataset = _make_dataset()
    pipeline = _make_pipeline()
    statements: list[str] = []

    class RecordingScalarSession:
        def scalar(self, statement: object) -> object:
            statements.append(str(statement.compile(dialect=postgresql.dialect())))  # type: ignore[attr-defined]
            return dataset if len(statements) == 1 else 7

    session = cast("Session", RecordingScalarSession())
    locked = pipeline_adapters.SQLAlchemyRagPipelineRepository.lock_pipeline_dataset(
        session,
        pipeline=pipeline,
    )
    position = pipeline_adapters.SQLAlchemyRagPipelineRepository.next_document_position(session, dataset=dataset)

    assert locked is dataset
    assert position == 8
    assert len(statements) == 2
    assert "FOR UPDATE" in statements[0]
    assert "pipelines.id" not in statements[0]
    assert "datasets.pipeline_id" in statements[0]
    assert "ORDER BY documents.position DESC" in statements[1]
    assert "FOR UPDATE" in statements[1]


def test_retry_preparation_executes_once_after_connection_release(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_engine: Engine,
) -> None:
    pool = sqlite_engine.pool
    assert isinstance(pool, QueuePool)
    sessions = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    _patch_preparation_runtime(monkeypatch)
    runtime = _SessionBoundaryGenerator(pool)
    preparer = SQLAlchemyPipelineRunPreparer(
        session_factory=sessions,
        generator=cast("PipelineGenerator", runtime),
    )
    pipeline = _make_pipeline()
    workflow = _make_workflow()
    workflow.version = "published"
    pipeline.workflow_id = workflow.id
    document = _make_document()
    document.indexing_generation = "generation-1"
    execution_log = DocumentPipelineExecutionLog(
        pipeline_id=pipeline.id,
        document_id=document.id,
        indexing_generation="generation-1",
        datasource_type=DataSourceType.LOCAL_FILE,
        datasource_info=json.dumps({"name": "source.txt"}),
        datasource_node_id="start",
        input_data={"query": "retry"},
        created_by="user-1",
    )
    historical_log = DocumentPipelineExecutionLog(
        pipeline_id=pipeline.id,
        document_id=document.id,
        indexing_generation="superseded-generation",
        datasource_type=DataSourceType.LOCAL_FILE,
        datasource_info=json.dumps({"name": "old-source.txt"}),
        datasource_node_id="old-start",
        input_data={"query": "superseded"},
        created_by="user-1",
    )

    with sessions.begin() as session:
        session.add_all([pipeline, _make_dataset(), workflow, _make_account(), document, historical_log, execution_log])

    with sessions() as session:
        persisted_document = session.get(Document, "doc-1")
        user = session.get(Account, "user-1")
        assert persisted_document is not None
        assert user is not None
        prepared = preparer.prepare_retry(
            persisted_document,
            user,
            session=session,
            execution=DocumentIndexingExecution(
                expected_generation="generation-1",
                assert_owned=lambda: None,
            ),
        )
        assert runtime.executions == []
        session.commit()

    assert pool.checkedout() == 0
    result = cast("Mapping[str, object]", preparer.execute(prepared))

    assert result["inputs"] == {"query": "retry"}
    assert result["dataset_id"] == "dataset-1"
    assert len(runtime.executions) == 1
    processor = runtime.index_processors[0]
    assert isinstance(processor, PipelineIndexProcessor)
    assert processor.expected_generation == "generation-1"
    failure_handler = runtime.document_failure_handlers[0]
    assert callable(failure_handler)
    failure_handler("pipeline failed")
    with sessions() as session:
        failed_document = session.get(Document, "doc-1")
        assert failed_document is not None
        assert failed_document.indexing_status == IndexingStatus.ERROR
        assert failed_document.error == "pipeline failed"
    assert pool.checkedout() == 0


def test_retry_preparation_rejects_document_without_current_generation_execution_log(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_engine: Engine,
) -> None:
    sessions = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    _patch_preparation_runtime(monkeypatch)
    preparer = SQLAlchemyPipelineRunPreparer(
        session_factory=sessions,
        generator=cast("PipelineGenerator", _SessionBoundaryGenerator(cast("QueuePool", sqlite_engine.pool))),
    )
    pipeline = _make_pipeline()
    workflow = _make_workflow()
    workflow.version = "published"
    pipeline.workflow_id = workflow.id
    document = _make_document()
    document.indexing_generation = "current-generation"
    historical_log = DocumentPipelineExecutionLog(
        pipeline_id=pipeline.id,
        document_id=document.id,
        indexing_generation="superseded-generation",
        datasource_type=DataSourceType.LOCAL_FILE,
        datasource_info=json.dumps({"name": "old-source.txt"}),
        datasource_node_id="old-start",
        input_data={"query": "superseded"},
        created_by="user-1",
    )

    with sessions.begin() as session:
        session.add_all([pipeline, _make_dataset(), workflow, _make_account(), document, historical_log])

    with sessions() as session:
        persisted_document = session.get(Document, document.id)
        user = session.get(Account, "user-1")
        assert persisted_document is not None
        assert user is not None
        with pytest.raises(ValueError, match="Document pipeline execution log not found"):
            preparer.prepare_retry(
                persisted_document,
                user,
                session=session,
                execution=DocumentIndexingExecution(
                    expected_generation="current-generation",
                    assert_owned=lambda: None,
                ),
            )


def test_pipeline_execution_input_binding_carries_latest_exact_legacy_log(
    sqlite_engine: Engine,
) -> None:
    sessions = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    pipeline = _make_pipeline()
    document = _make_document()
    document.indexing_generation = "successor-generation"
    older = DocumentPipelineExecutionLog(
        pipeline_id=pipeline.id,
        document_id=document.id,
        indexing_generation=None,
        datasource_type=DataSourceType.LOCAL_FILE,
        datasource_info=json.dumps({"name": "older.txt"}),
        datasource_node_id="older-start",
        input_data={"query": "older"},
        created_by="user-1",
    )
    newer = DocumentPipelineExecutionLog(
        pipeline_id=pipeline.id,
        document_id=document.id,
        indexing_generation=None,
        datasource_type=DataSourceType.LOCAL_FILE,
        datasource_info=json.dumps({"name": "current.txt"}),
        datasource_node_id="current-start",
        input_data={"query": "current"},
        created_by="user-1",
    )
    older.created_at = datetime(2025, 1, 1)
    newer.created_at = older.created_at + timedelta(days=1)

    with sessions.begin() as session:
        session.add_all([pipeline, _make_dataset(), document, older, newer])
    with sessions.begin() as session:
        assert (
            pipeline_adapters.SQLAlchemyRagPipelineRepository.copy_document_pipeline_execution_binding(
                session,
                tenant_id=document.tenant_id,
                dataset_id=document.dataset_id,
                document_id=document.id,
                source_generation=None,
                target_generation="successor-generation",
            )
            is True
        )
        assert (
            pipeline_adapters.SQLAlchemyRagPipelineRepository.copy_document_pipeline_execution_binding(
                session,
                tenant_id=document.tenant_id,
                dataset_id=document.dataset_id,
                document_id=document.id,
                source_generation=None,
                target_generation="successor-generation",
            )
            is False
        )

    with sessions() as session:
        carried = session.scalar(
            select(DocumentPipelineExecutionLog).where(
                DocumentPipelineExecutionLog.document_id == document.id,
                DocumentPipelineExecutionLog.indexing_generation == "successor-generation",
            )
        )
        assert carried is not None
        assert carried.datasource_node_id == "current-start"
        assert carried.input_data == {"query": "current"}


def test_document_retry_rotation_carries_pipeline_input_to_real_retry_preparer(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_engine: Engine,
) -> None:
    sessions = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    _patch_preparation_runtime(monkeypatch)
    runtime = _SessionBoundaryGenerator(cast("QueuePool", sqlite_engine.pool))
    preparer = SQLAlchemyPipelineRunPreparer(
        session_factory=sessions,
        generator=cast("PipelineGenerator", runtime),
    )
    pipeline = _make_pipeline()
    workflow = _make_workflow()
    workflow.version = "published"
    pipeline.workflow_id = workflow.id
    document = _make_document()
    document.indexing_status = IndexingStatus.ERROR
    document.indexing_generation = "failed-generation"
    document.enabled = True
    document.archived = False
    source_log = DocumentPipelineExecutionLog(
        pipeline_id=pipeline.id,
        document_id=document.id,
        indexing_generation="failed-generation",
        datasource_type=DataSourceType.LOCAL_FILE,
        datasource_info=json.dumps({"name": "retry-source.txt"}),
        datasource_node_id="source-start",
        input_data={"query": "retry-current-source"},
        created_by="user-1",
    )
    with sessions.begin() as session:
        session.add_all([pipeline, _make_dataset(), workflow, _make_account(), document, source_log])

    documents = SQLAlchemyDocumentRepository(session_factory=sessions, wake_after_commit=lambda _session: None)
    assert documents.retry_documents(
        DatasetRef(document.tenant_id, document.dataset_id),
        [document.id],
        actor_id="user-1",
        generation="retry-generation",
        lock_tokens={document.id: "lock-token"},
    ) == (document.id,)

    with sessions() as session:
        retried_document = session.get(Document, document.id)
        user = session.get(Account, "user-1")
        assert retried_document is not None
        assert user is not None
        assert retried_document.indexing_generation == "retry-generation"
        prepared = preparer.prepare_retry(
            retried_document,
            user,
            session=session,
            execution=DocumentIndexingExecution(
                expected_generation="retry-generation",
                assert_owned=lambda: None,
            ),
        )
        session.commit()

    result = cast("Mapping[str, object]", preparer.execute(prepared))
    assert result["inputs"] == {"query": "retry-current-source"}
    assert result["datasource_info"] == {"name": "retry-source.txt"}


@pytest.mark.parametrize("recovery", ["current_repair", "legacy_delivery"])
def test_null_generation_recovery_carries_latest_legacy_input_to_real_retry_preparer(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_engine: Engine,
    recovery: str,
) -> None:
    sessions = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    _patch_preparation_runtime(monkeypatch)
    runtime = _SessionBoundaryGenerator(cast("QueuePool", sqlite_engine.pool))
    preparer = SQLAlchemyPipelineRunPreparer(
        session_factory=sessions,
        generator=cast("PipelineGenerator", runtime),
    )
    pipeline = _make_pipeline()
    workflow = _make_workflow()
    workflow.version = "published"
    pipeline.workflow_id = workflow.id
    document = _make_document()
    document.indexing_status = IndexingStatus.PARSING if recovery == "current_repair" else IndexingStatus.ERROR
    document.indexing_generation = None
    document.enabled = True
    document.archived = False
    older = DocumentPipelineExecutionLog(
        pipeline_id=pipeline.id,
        document_id=document.id,
        indexing_generation=None,
        datasource_type=DataSourceType.LOCAL_FILE,
        datasource_info=json.dumps({"name": "older.txt"}),
        datasource_node_id="older-start",
        input_data={"query": "older"},
        created_by="user-1",
    )
    current = DocumentPipelineExecutionLog(
        pipeline_id=pipeline.id,
        document_id=document.id,
        indexing_generation=None,
        datasource_type=DataSourceType.LOCAL_FILE,
        datasource_info=json.dumps({"name": "current.txt"}),
        datasource_node_id="current-start",
        input_data={"query": "current"},
        created_by="user-1",
    )
    older.created_at = datetime(2025, 1, 1)
    current.created_at = older.created_at + timedelta(days=1)
    with sessions.begin() as session:
        session.add_all([pipeline, _make_dataset(), workflow, _make_account(), document, older, current])

    documents = SQLAlchemyDocumentRepository(session_factory=sessions, wake_after_commit=lambda _session: None)
    if recovery == "current_repair":
        assert documents.enqueue_current_indexing_repairs(
            DatasetRef(document.tenant_id, document.dataset_id),
            [document.id],
            actor_id="user-1",
        )
    else:
        assert documents.convert_legacy_indexing_deliveries(
            document.dataset_id,
            [document.id],
            actor_id="user-1",
        )

    with sessions() as session:
        recovered_document = session.get(Document, document.id)
        user = session.get(Account, "user-1")
        assert recovered_document is not None
        assert user is not None
        recovered_generation = recovered_document.indexing_generation
        assert recovered_generation is not None
        carried = session.scalars(
            select(DocumentPipelineExecutionLog).where(
                DocumentPipelineExecutionLog.document_id == document.id,
                DocumentPipelineExecutionLog.indexing_generation == recovered_generation,
            )
        ).all()
        legacy_logs = session.scalars(
            select(DocumentPipelineExecutionLog)
            .where(
                DocumentPipelineExecutionLog.document_id == document.id,
                DocumentPipelineExecutionLog.indexing_generation.is_(None),
            )
            .order_by(DocumentPipelineExecutionLog.created_at, DocumentPipelineExecutionLog.id)
        ).all()
        assert len(carried) == 1
        assert carried[0].datasource_node_id == "current-start"
        assert [log.datasource_node_id for log in legacy_logs] == ["older-start", "current-start"]
        prepared = preparer.prepare_retry(
            recovered_document,
            user,
            session=session,
            execution=DocumentIndexingExecution(
                expected_generation=recovered_generation,
                assert_owned=lambda: None,
            ),
        )
        session.commit()

    result = cast("Mapping[str, object]", preparer.execute(prepared))
    assert result["inputs"] == {"query": "current"}
    assert result["datasource_info"] == {"name": "current.txt"}


def test_published_replacement_assigns_and_queues_a_new_generation(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_engine: Engine,
) -> None:
    sessions = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    runtime = _SessionBoundaryGenerator(cast("QueuePool", sqlite_engine.pool))
    preparer = SQLAlchemyPipelineRunPreparer(
        session_factory=sessions,
        generator=cast("PipelineGenerator", runtime),
    )
    pipeline = _make_pipeline()
    workflow = _make_workflow()
    workflow.version = "published"
    pipeline.workflow_id = workflow.id
    document = _make_document()
    document.indexing_generation = "retry-generation"
    dataset = _make_dataset()
    dataset.chunk_structure = IndexStructureType.PARAGRAPH_INDEX
    queued: list[RagPipelineInvokeEntity] = []

    class RecordingTaskProxy:
        def __init__(
            self,
            _tenant_id: str,
            _user_id: str,
            invoke_entities: list[RagPipelineInvokeEntity],
            **_kwargs: object,
        ) -> None:
            queued.extend(invoke_entities)

        def delay(self) -> None:
            return None

    monkeypatch.setattr(pipeline_adapters, "RagPipelineTaskProxy", RecordingTaskProxy)
    with sessions.begin() as session:
        session.add_all([pipeline, dataset, workflow, _make_account(), document])

    with sessions() as session:
        persisted_pipeline = session.get(Pipeline, pipeline.id)
        persisted_workflow = session.get(Workflow, workflow.id)
        user = session.get(Account, "user-1")
        assert persisted_pipeline is not None
        assert persisted_workflow is not None
        assert user is not None
        prepared = preparer.prepare(
            pipeline=persisted_pipeline,
            workflow=persisted_workflow,
            user=user,
            args={
                "inputs": {"query": "replace"},
                "start_node_id": "start",
                "datasource_type": DataSourceType.LOCAL_FILE,
                "datasource_info_list": [{"name": "replacement.txt"}],
                "original_document_id": document.id,
            },
            invoke_from=InvokeFrom.PUBLISHED_PIPELINE,
            streaming=False,
            session=session,
            datasource_info_list=[{"name": "replacement.txt"}],
            document_creation_environment=None,
        )
        session.commit()
        successor_generation = cast("Document", session.get(Document, document.id)).indexing_generation

    assert successor_generation is not None
    assert successor_generation != "retry-generation"
    preparer.execute(prepared)
    assert len(queued) == 1
    assert queued[0].indexing_generation == successor_generation


@pytest.mark.parametrize(
    ("invoke_from", "workflow", "expected_error"),
    [
        (InvokeFrom.DEBUGGER, None, "Workflow not initialized"),
        (InvokeFrom.WEB_APP, None, "Workflow not published"),
        (InvokeFrom.DEBUGGER, _make_workflow(), None),
    ],
)
def test_get_workflow(
    mocker: MockerFixture,
    invoke_from: InvokeFrom,
    workflow: Workflow | None,
    expected_error: str | None,
    sqlite_session: Session,
) -> None:
    rag_pipeline_service_cls = mocker.patch("services.rag_pipeline.pipeline_generate_service.RagPipelineService")
    rag_pipeline_service = rag_pipeline_service_cls.return_value
    rag_pipeline_service.get_draft_workflow.return_value = workflow
    rag_pipeline_service.get_published_workflow.return_value = workflow

    pipeline = _make_pipeline()
    session = sqlite_session

    if expected_error:
        with pytest.raises(ValueError, match=expected_error):
            PipelineGenerateService.get_workflow(pipeline, invoke_from, session)
    else:
        result = PipelineGenerateService.get_workflow(pipeline, invoke_from, session)
        assert result == workflow


# --- generate_single_iteration ---


def test_generate_single_iteration_delegates(
    mocker: MockerFixture, sqlite_session: Session, pipeline_generator: PipelineGenerator
) -> None:
    mocker.patch.object(PipelineGenerateService, "get_workflow", return_value=_make_workflow())

    generator_cls = mocker.patch("services.rag_pipeline.pipeline_generate_service.PipelineGenerator")
    generator_instance = pipeline_generator
    single_iteration_generate = cast("Mock", generator_instance.single_iteration_generate)
    single_iteration_generate.return_value = "raw-iter"
    generator_cls.convert_to_event_stream.return_value = "stream-iter"

    pipeline = _make_pipeline()
    pipeline.id = "p1"
    user = _make_account(account_id="u1")
    session = sqlite_session

    result = PipelineGenerateService.generate_single_iteration(
        pipeline, user, "node-1", {"key": "val"}, session, generator=pipeline_generator
    )

    assert result == "stream-iter"
    single_iteration_generate.assert_called_once()
    assert single_iteration_generate.call_args.kwargs["session"] is session


# --- generate_single_loop ---


def test_generate_single_loop_delegates(
    mocker: MockerFixture, sqlite_session: Session, pipeline_generator: PipelineGenerator
) -> None:
    mocker.patch.object(PipelineGenerateService, "get_workflow", return_value=_make_workflow())

    generator_cls = mocker.patch("services.rag_pipeline.pipeline_generate_service.PipelineGenerator")
    generator_instance = pipeline_generator
    single_loop_generate = cast("Mock", generator_instance.single_loop_generate)
    single_loop_generate.return_value = "raw-loop"
    generator_cls.convert_to_event_stream.return_value = "stream-loop"

    pipeline = _make_pipeline()
    pipeline.id = "p1"
    user = _make_account(account_id="u1")
    session = sqlite_session

    result = PipelineGenerateService.generate_single_loop(
        pipeline, user, "node-1", {"key": "val"}, session, generator=pipeline_generator
    )

    assert result == "stream-loop"
    single_loop_generate.assert_called_once()
    assert single_loop_generate.call_args.kwargs["session"] is session
