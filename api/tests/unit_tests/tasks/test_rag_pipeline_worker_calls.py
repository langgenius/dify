import json
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from datetime import datetime
from threading import Event, Thread
from types import ModuleType, TracebackType
from typing import Protocol, cast

import pytest

from core.app.apps.pipeline.pipeline_config_manager import PipelineConfig
from core.app.entities.app_invoke_entities import InvokeFrom, RagPipelineGenerateEntity
from models.model import AppMode
from services.knowledge.indexing.adapters.execution import PipelineIndexProcessor
from services.knowledge.indexing.contracts import DocumentIndexingExecution
from services.knowledge.indexing.locks import KnowledgeIndexingLockBusyError
from services.knowledge.resource_scope import DatasetRef, DocumentRef
from services.rag_pipeline.entities import (
    RagPipelineInvokeBatch,
    RagPipelineInvokeEntity,
    RagPipelineWorkflowSnapshot,
)
from services.rag_pipeline.tenant_task_queue import RagPipelinePermanentTaskError
from tasks.rag_pipeline import priority_rag_pipeline_run_task as priority_worker
from tasks.rag_pipeline import rag_pipeline_run_task as regular_worker


@dataclass(frozen=True, slots=True)
class _Account:
    id: str
    name: str = "Pipeline User"

    def set_current_tenant_with_session(self, tenant: object, *, session: object) -> None:
        del tenant, session


@dataclass(frozen=True, slots=True)
class _Tenant:
    id: str


@dataclass(frozen=True, slots=True)
class _Pipeline:
    id: str
    tenant_id: str
    workflow_id: str


@dataclass(frozen=True, slots=True)
class _Workflow:
    id: str


@dataclass(slots=True)
class _RecordingSession:
    scalar_results: list[object]
    statements: list[object] = field(default_factory=list)
    entered: bool = False
    exited: bool = False

    def __enter__(self) -> "_RecordingSession":
        self.entered = True
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        del exc_type, exc_value, traceback
        self.exited = True

    def scalar(self, statement: object) -> object:
        self.statements.append(statement)
        return self.scalar_results.pop(0)


@dataclass(frozen=True, slots=True)
class _RecordingSessionFactory:
    session: _RecordingSession

    def begin(self) -> _RecordingSession:
        return self.session


@dataclass(frozen=True, slots=True)
class _Database:
    engine: object = field(default_factory=object)


@dataclass(slots=True)
class _FlaskGlobals:
    _login_user: object | None = None


class _AppContext:
    def __enter__(self) -> "_AppContext":
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        del exc_type, exc_value, traceback


class _FlaskApp:
    def app_context(self) -> _AppContext:
        return _AppContext()

    def _get_current_object(self) -> "_FlaskApp":
        return self


@dataclass(frozen=True, slots=True)
class _CredentialServices:
    providers: object = field(default_factory=object)


@dataclass(slots=True)
class _Lease:
    assertions: int = 0

    @property
    def token(self) -> str:
        return "lease-token"

    def assert_owned(self) -> None:
        self.assertions += 1

    def renew(self) -> bool:
        return True

    def release(self) -> bool:
        return True


@dataclass(frozen=True, slots=True)
class _LeaseContext:
    lease: _Lease

    def __enter__(self) -> _Lease:
        return self.lease

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        del exc_type, exc_value, traceback


@dataclass(frozen=True, slots=True)
class _IndexingLock:
    lease: _Lease

    def hold(self, *_args: object, **_kwargs: object) -> _LeaseContext:
        return _LeaseContext(self.lease)


@dataclass(slots=True)
class _DocumentRepository:
    claims: list[tuple[DocumentRef, str | None, str]] = field(default_factory=list)
    assertions: list[tuple[DocumentRef, str | None, str]] = field(default_factory=list)
    failures: list[tuple[DocumentRef, str]] = field(default_factory=list)
    repairs: list[tuple[DatasetRef, tuple[str, ...], str | None]] = field(default_factory=list)

    def claim_pipeline_indexing_execution(
        self,
        ref: DocumentRef,
        *,
        execution_id: str,
        expected_generation: str | None,
    ) -> bool:
        self.claims.append((ref, expected_generation, execution_id))
        return True

    def assert_pipeline_indexing_execution(
        self,
        ref: DocumentRef,
        *,
        execution_id: str,
        expected_generation: str | None,
    ) -> None:
        self.assertions.append((ref, expected_generation, execution_id))

    def fail_indexing(
        self,
        ref: DocumentRef,
        error: str,
        *,
        execution: DocumentIndexingExecution,
    ) -> None:
        execution.assert_owned()
        self.failures.append((ref, error))

    def enqueue_current_indexing_repairs(
        self,
        ref: DatasetRef,
        document_ids: list[str],
        *,
        actor_id: str | None = None,
    ) -> bool:
        self.repairs.append((ref, tuple(document_ids), actor_id))
        return True


@dataclass(slots=True)
class _RecordingGenerator:
    preparation_session: _RecordingSession
    expected_workflow_id: str
    calls: list[dict[str, object]] = field(default_factory=list)
    started: Event = field(default_factory=Event)
    release: Event = field(default_factory=Event)
    completed: Event = field(default_factory=Event)

    def run(self, **kwargs: object) -> Mapping[str, object]:
        assert self.preparation_session.exited is True
        workflow = cast("_WorkflowView", kwargs["workflow"])
        assert workflow.id == self.expected_workflow_id
        assert workflow.graph_dict == {"nodes": [{"id": "snapshotted"}], "edges": []}
        assert kwargs["streaming"] is False
        self.calls.append(dict(kwargs))
        self.started.set()
        assert self.release.wait(timeout=5)
        self.completed.set()
        return {"status": "executed"}


@dataclass(frozen=True, slots=True)
class _WorkerTarget:
    module: ModuleType
    run: Callable[..., None]
    uses_direct_session: bool

    @property
    def legacy_batch_task(self) -> Callable[[str, str], None]:
        if self.uses_direct_session:
            return cast("Callable[[str, str], None]", priority_worker.priority_rag_pipeline_run_task.run)
        return cast("Callable[[str, str], None]", regular_worker.rag_pipeline_run_task.run)

    @property
    def v2_batch_task(self) -> Callable[[str, str], None]:
        if self.uses_direct_session:
            return cast("Callable[[str, str], None]", priority_worker.priority_rag_pipeline_run_task_v2.run)
        return cast("Callable[[str, str], None]", regular_worker.rag_pipeline_run_task_v2.run)


class _WorkflowView(Protocol):
    id: str
    graph_dict: Mapping[str, object]


def _invoke_payload() -> Mapping[str, object]:
    config = PipelineConfig(
        tenant_id="tenant-1",
        app_id="pipeline-1",
        app_mode=AppMode.RAG_PIPELINE,
        workflow_id="workflow-1",
    )
    generate_entity = RagPipelineGenerateEntity(
        task_id="task-1",
        app_config=config,
        pipeline_config=config,
        datasource_type="local_file",
        datasource_info={"name": "source.txt"},
        dataset_id="dataset-1",
        document_id="document-1",
        batch="batch-1",
        inputs={"query": "hello"},
        files=[],
        user_id="user-1",
        stream=True,
        invoke_from=InvokeFrom.PUBLISHED_PIPELINE,
        workflow_execution_id="execution-1",
    )
    return cast(
        "Mapping[str, object]",
        RagPipelineInvokeEntity(
            pipeline_id="pipeline-1",
            application_generate_entity=generate_entity.model_dump(),
            user_id="user-1",
            tenant_id="tenant-1",
            workflow_id="workflow-1",
            workflow_snapshot=RagPipelineWorkflowSnapshot(
                id="workflow-1",
                tenant_id="tenant-1",
                app_id="pipeline-1",
                type="rag-pipeline",
                kind="standard",
                version="published-v1",
                version_number=1,
                marked_name="V1",
                marked_comment="queued",
                graph='{"nodes": [{"id": "snapshotted"}], "edges": []}',
                features="{}",
                created_by="user-1",
                created_at=datetime(2026, 1, 1),
                updated_by=None,
                updated_at=datetime(2026, 1, 1),
                environment_variables="[]",
                conversation_variables="[]",
                rag_pipeline_variables="[]",
            ),
            streaming=True,
            workflow_execution_id="execution-1",
            workflow_thread_pool_id="pool-1",
            indexing_generation="generation-1",
        ).model_dump(),
    )


@pytest.mark.parametrize(
    "target",
    [
        pytest.param(
            _WorkerTarget(
                module=regular_worker,
                run=cast("Callable[[Mapping[str, object], object], None]", regular_worker.run_single_rag_pipeline_task),
                uses_direct_session=False,
            ),
            id="regular",
        ),
        pytest.param(
            _WorkerTarget(
                module=priority_worker,
                run=cast(
                    "Callable[[Mapping[str, object], object], None]",
                    priority_worker.run_single_rag_pipeline_task,
                ),
                uses_direct_session=True,
            ),
            id="priority",
        ),
    ],
)
@pytest.mark.parametrize("queued_generation", [None, "generation-1"])
def test_published_pipeline_worker_executes_after_preparation_session_closes(
    monkeypatch: pytest.MonkeyPatch,
    target: _WorkerTarget,
    queued_generation: str | None,
) -> None:
    account = _Account("user-1")
    tenant = _Tenant("tenant-1")
    pipeline = _Pipeline(id="pipeline-1", tenant_id=tenant.id, workflow_id="newer-workflow")
    session = _RecordingSession([account, tenant, pipeline])
    session_factory = _RecordingSessionFactory(session)
    generator = _RecordingGenerator(preparation_session=session, expected_workflow_id="workflow-1")
    flask_globals = _FlaskGlobals()

    def create_session_factory(*_args: object, **_kwargs: object) -> _RecordingSessionFactory:
        return session_factory

    def create_session(*_args: object, **_kwargs: object) -> _RecordingSession:
        return session

    def create_repository(**_kwargs: object) -> object:
        return object()

    documents = _DocumentRepository()

    def create_document_repository(**_kwargs: object) -> _DocumentRepository:
        return documents

    def create_credentials(**_kwargs: object) -> _CredentialServices:
        return _CredentialServices()

    def create_generator(**_kwargs: object) -> _RecordingGenerator:
        return generator

    monkeypatch.setattr(target.module, "db", _Database())
    monkeypatch.setattr(target.module, "g", flask_globals)
    monkeypatch.setattr(target.module, "sessionmaker", create_session_factory)
    if target.uses_direct_session:
        monkeypatch.setattr(target.module, "Session", create_session)
    monkeypatch.setattr(target.module, "get_session_maker", lambda: session_factory)
    monkeypatch.setattr(target.module, "SQLAlchemyDocumentRepository", create_document_repository)
    monkeypatch.setattr(target.module, "build_data_source_credentials", create_credentials)
    monkeypatch.setattr(target.module, "PipelineGenerator", create_generator)
    document_lease = _Lease()
    dataset_lease = _Lease()
    monkeypatch.setattr(
        target.module,
        "RedisKnowledgeIndexingLock",
        lambda **_kwargs: _IndexingLock(document_lease),
    )
    monkeypatch.setattr(
        target.module.DifyCoreRepositoryFactory,
        "create_workflow_execution_repository",
        staticmethod(create_repository),
    )
    monkeypatch.setattr(
        target.module.DifyCoreRepositoryFactory,
        "create_workflow_node_execution_repository",
        staticmethod(create_repository),
    )

    errors: list[BaseException] = []

    def run_worker() -> None:
        try:
            payload = dict(_invoke_payload())
            if queued_generation is None:
                payload.pop("indexing_generation")
            target.run(payload, _FlaskApp(), None, dataset_lease, "claim-1")
        except BaseException as error:
            errors.append(error)

    worker_thread = Thread(target=run_worker)
    worker_thread.start()
    assert generator.started.wait(timeout=5)
    assert worker_thread.is_alive()
    assert generator.completed.is_set() is False
    generator.release.set()
    worker_thread.join(timeout=5)

    assert worker_thread.is_alive() is False
    assert errors == []
    assert session.entered is True
    assert session.exited is True
    assert len(generator.calls) == 1
    assert generator.completed.is_set() is True
    call = generator.calls[0]
    assert call["pipeline"] is pipeline
    assert cast("_WorkflowView", call["workflow"]).id == "workflow-1"
    assert call["user"] is account
    assert call["invoke_from"] == InvokeFrom.PUBLISHED_PIPELINE
    assert call["streaming"] is False
    assert "session" not in call
    assert "workflow_id" not in call
    assert isinstance(call["application_generate_entity"], RagPipelineGenerateEntity)
    processor = call["index_processor"]
    assert isinstance(processor, PipelineIndexProcessor)
    assert processor.expected_generation == queued_generation
    failure_handler = call["document_failure_handler"]
    assert callable(failure_handler)
    failure_handler("pipeline failed")
    document_ref = DatasetRef("tenant-1", "dataset-1").document("document-1")
    assert documents.claims == [(document_ref, queued_generation, "claim-1")]
    assert documents.assertions == [
        (document_ref, queued_generation, "claim-1"),
        (document_ref, queued_generation, "claim-1"),
    ]
    assert documents.failures == [(DatasetRef("tenant-1", "dataset-1").document("document-1"), "pipeline failed")]
    assert dataset_lease.assertions >= 2
    assert document_lease.assertions >= 2
    assert flask_globals._login_user is account


@pytest.mark.parametrize(
    "target",
    [
        pytest.param(
            _WorkerTarget(
                module=regular_worker,
                run=cast("Callable[[Mapping[str, object], object], None]", regular_worker.run_single_rag_pipeline_task),
                uses_direct_session=False,
            ),
            id="regular",
        ),
        pytest.param(
            _WorkerTarget(
                module=priority_worker,
                run=cast(
                    "Callable[[Mapping[str, object], object], None]",
                    priority_worker.run_single_rag_pipeline_task,
                ),
                uses_direct_session=True,
            ),
            id="priority",
        ),
    ],
)
@pytest.mark.parametrize("missing", ["account", "pipeline", "workflow"])
def test_deleted_pipeline_owner_is_permanent_and_fails_only_the_queued_document_generation(
    monkeypatch: pytest.MonkeyPatch,
    target: _WorkerTarget,
    missing: str,
) -> None:
    account = _Account("user-1")
    tenant = _Tenant("tenant-1")
    pipeline = _Pipeline(id="pipeline-1", tenant_id=tenant.id, workflow_id="workflow-1")
    if missing == "account":
        scalar_results: list[object] = [None]
    elif missing == "pipeline":
        scalar_results = [account, tenant, None]
    else:
        scalar_results = [account, tenant, pipeline, None]
    session = _RecordingSession(scalar_results)
    session_factory = _RecordingSessionFactory(session)
    documents = _DocumentRepository()
    document_lease = _Lease()
    dataset_lease = _Lease()

    monkeypatch.setattr(target.module, "db", _Database())
    monkeypatch.setattr(target.module, "sessionmaker", lambda *_args, **_kwargs: session_factory)
    if target.uses_direct_session:
        monkeypatch.setattr(target.module, "Session", lambda *_args, **_kwargs: session)
    monkeypatch.setattr(target.module, "SQLAlchemyDocumentRepository", lambda **_kwargs: documents)
    monkeypatch.setattr(target.module, "RedisKnowledgeIndexingLock", lambda **_kwargs: _IndexingLock(document_lease))

    payload = dict(_invoke_payload())
    if missing == "workflow":
        payload.pop("workflow_snapshot")

    with pytest.raises(RagPipelinePermanentTaskError, match=f"{missing.title()} .* not found"):
        target.run(payload, _FlaskApp(), None, dataset_lease, "claim-1")

    document_ref = DatasetRef("tenant-1", "dataset-1").document("document-1")
    missing_id = payload.get(f"{missing}_id", "user-1")
    assert documents.claims == [(document_ref, "generation-1", "claim-1")]
    assert documents.assertions == [(document_ref, "generation-1", "claim-1")]
    assert documents.failures == [(document_ref, f"{missing.title()} {missing_id} not found")]


@dataclass(slots=True)
class _BatchFileService:
    content: bytes
    deleted: list[str] = field(default_factory=list)

    def get_file_content(self, _file_id: str) -> bytes:
        return self.content

    def delete_file(self, file_id: str) -> None:
        self.deleted.append(file_id)


@dataclass(slots=True)
class _BatchQueue:
    cleared: bool = False

    def pull_tasks(self, *, count: int) -> list[str]:
        del count
        return []

    def delete_task_key(self) -> None:
        self.cleared = True


@dataclass(slots=True)
class _ClosableSession:
    closed: bool = False

    def close(self) -> None:
        self.closed = True


@pytest.mark.parametrize(
    "target",
    [
        pytest.param(
            _WorkerTarget(
                priority_worker,
                cast("Callable[[Mapping[str, object], object], None]", priority_worker.run_single_rag_pipeline_task),
                True,
            ),
            id="priority",
        ),
        pytest.param(
            _WorkerTarget(
                regular_worker,
                cast("Callable[[Mapping[str, object], object], None]", regular_worker.run_single_rag_pipeline_task),
                False,
            ),
            id="regular",
        ),
    ],
)
def test_new_worker_consumes_head_list_payload_from_legacy_queue(
    monkeypatch: pytest.MonkeyPatch,
    target: _WorkerTarget,
) -> None:
    legacy_payload = dict(_invoke_payload())
    legacy_payload.pop("workflow_snapshot")
    legacy_payload.pop("indexing_generation")
    input_file = _BatchFileService(json.dumps([legacy_payload]).encode())
    queue = _BatchQueue()
    session = _ClosableSession()
    calls: list[Mapping[str, object]] = []

    def run_legacy(
        payload: Mapping[str, object],
        _app: object,
        batch_snapshot: RagPipelineWorkflowSnapshot | None,
        _dataset_lease: object,
        _execution_id: str,
    ) -> None:
        assert batch_snapshot is None
        assert payload.get("indexing_generation") is None
        calls.append(payload)

    monkeypatch.setattr(target.module, "FileService", lambda _engine: input_file)
    monkeypatch.setattr(target.module, "TenantIsolatedTaskQueue", lambda *_args: queue)
    monkeypatch.setattr(target.module, "run_single_rag_pipeline_task", run_legacy)
    monkeypatch.setattr(target.module, "current_app", _FlaskApp())
    monkeypatch.setattr(target.module, "db", type("Database", (), {"engine": object(), "session": session})())

    target.legacy_batch_task("input-file", "tenant-1")

    assert len(calls) == 1
    assert calls[0]["pipeline_id"] == "pipeline-1"
    assert input_file.deleted == ["input-file"]
    assert queue.cleared is True
    assert session.closed is True


@pytest.mark.parametrize(
    "target",
    [
        pytest.param(
            _WorkerTarget(
                priority_worker,
                cast("Callable[[Mapping[str, object], object], None]", priority_worker.run_single_rag_pipeline_task),
                True,
            ),
            id="priority",
        ),
        pytest.param(
            _WorkerTarget(
                regular_worker,
                cast("Callable[[Mapping[str, object], object], None]", regular_worker.run_single_rag_pipeline_task),
                False,
            ),
            id="regular",
        ),
    ],
)
def test_pipeline_batch_propagates_all_failures_and_preserves_retry_input(
    monkeypatch: pytest.MonkeyPatch,
    target: _WorkerTarget,
) -> None:
    first_payload = dict(_invoke_payload())
    workflow_snapshot = RagPipelineWorkflowSnapshot.model_validate(first_payload.pop("workflow_snapshot"))
    second_payload = dict(first_payload)
    first_payload["pipeline_id"] = "first"
    second_payload["pipeline_id"] = "second"
    invoke_batch = RagPipelineInvokeBatch(
        workflow_snapshot=workflow_snapshot,
        invoke_entities=[
            RagPipelineInvokeEntity.model_validate(first_payload),
            RagPipelineInvokeEntity.model_validate(second_payload),
        ],
    )
    input_file = _BatchFileService(invoke_batch.model_dump_json(exclude_none=True).encode())
    queue = _BatchQueue()
    session = _ClosableSession()

    def fail_run(
        payload: Mapping[str, object],
        _app: object,
        batch_snapshot: RagPipelineWorkflowSnapshot | None,
        _dataset_lease: object,
        _execution_id: str,
    ) -> None:
        assert batch_snapshot == workflow_snapshot
        raise RuntimeError(cast("str", payload["pipeline_id"]))

    monkeypatch.setattr(target.module, "FileService", lambda _engine: input_file)
    monkeypatch.setattr(target.module, "TenantIsolatedTaskQueue", lambda *_args: queue)
    monkeypatch.setattr(target.module, "run_single_rag_pipeline_task", fail_run)
    monkeypatch.setattr(target.module, "current_app", _FlaskApp())
    monkeypatch.setattr(target.module, "db", type("Database", (), {"engine": object(), "session": session})())

    with pytest.raises(ExceptionGroup) as captured:
        target.v2_batch_task("input-file", "tenant-1")

    assert {str(error) for error in captured.value.exceptions} == {"first", "second"}
    assert input_file.deleted == []
    assert queue.cleared is True
    assert session.closed is True


@pytest.mark.parametrize(
    "target",
    [
        pytest.param(
            _WorkerTarget(
                priority_worker,
                cast("Callable[[Mapping[str, object], object], None]", priority_worker.run_single_rag_pipeline_task),
                True,
            ),
            id="priority",
        ),
        pytest.param(
            _WorkerTarget(
                regular_worker,
                cast("Callable[[Mapping[str, object], object], None]", regular_worker.run_single_rag_pipeline_task),
                False,
            ),
            id="regular",
        ),
    ],
)
def test_self_hosted_batch_surfaces_document_lock_contention_for_celery_retry(
    monkeypatch: pytest.MonkeyPatch,
    target: _WorkerTarget,
) -> None:
    payload = dict(_invoke_payload())
    snapshot = RagPipelineWorkflowSnapshot.model_validate(payload.pop("workflow_snapshot"))
    invoke_batch = RagPipelineInvokeBatch(
        workflow_snapshot=snapshot,
        invoke_entities=[RagPipelineInvokeEntity.model_validate(payload)],
    )
    input_file = _BatchFileService(invoke_batch.model_dump_json(exclude_none=True).encode())
    queue = _BatchQueue()
    session = _ClosableSession()

    def busy_run(*_args: object) -> None:
        raise KnowledgeIndexingLockBusyError("document busy")

    monkeypatch.setattr(target.module, "FileService", lambda _engine: input_file)
    monkeypatch.setattr(target.module, "TenantIsolatedTaskQueue", lambda *_args: queue)
    monkeypatch.setattr(target.module, "run_single_rag_pipeline_task", busy_run)
    monkeypatch.setattr(target.module, "current_app", _FlaskApp())
    monkeypatch.setattr(target.module, "db", type("Database", (), {"engine": object(), "session": session})())

    helper = (
        priority_worker._run_priority_rag_pipeline_batch
        if target.uses_direct_session
        else regular_worker._run_rag_pipeline_batch
    )
    with pytest.raises(KnowledgeIndexingLockBusyError, match="document busy"):
        helper("input-file", "tenant-1", tenant_queue_receipt=None)

    assert input_file.deleted == []
    assert session.closed is True
