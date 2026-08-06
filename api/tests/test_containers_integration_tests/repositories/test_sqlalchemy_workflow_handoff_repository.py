from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier, Event
from uuid import uuid4

from sqlalchemy import Engine, event, func, select
from sqlalchemy.orm import Session, sessionmaker

from graphon.enums import WorkflowExecutionStatus, WorkflowType
from libs.datetime_utils import naive_utc_now
from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
from models.workflow import WorkflowRun
from models.workflow_handoff import (
    WorkflowHandoffResumeRoute,
    WorkflowHandoffSnapshotGC,
    WorkflowHandoffState,
    WorkflowRunHandoff,
)
from repositories.sqlalchemy_workflow_handoff_repository import SQLAlchemyWorkflowRunHandoffRepository
from repositories.workflow_handoff_repository import WorkflowHandoffTerminalScope


def _workflow_run() -> WorkflowRun:
    return WorkflowRun(
        id=str(uuid4()),
        tenant_id=str(uuid4()),
        app_id=str(uuid4()),
        workflow_id=str(uuid4()),
        type=WorkflowType.WORKFLOW,
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        version="1",
        status=WorkflowExecutionStatus.RUNNING,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=str(uuid4()),
        created_at=naive_utc_now(),
    )


def test_postgres_round_trips_snippet_resume_route(db_session_with_containers: Session) -> None:
    engine = db_session_with_containers.get_bind()
    assert isinstance(engine, Engine)
    repository = SQLAlchemyWorkflowRunHandoffRepository(
        sessionmaker(bind=engine, class_=Session, expire_on_commit=False)
    )
    workflow_run = _workflow_run()
    db_session_with_containers.add(workflow_run)
    db_session_with_containers.commit()

    created = repository.create_prepared(
        workflow_run_id=workflow_run.id,
        task_id="task-snippet",
        snapshot_object_key=f"workflow-handoffs/snippet/{uuid4()}.bin",
        snapshot_schema_version="v1",
        snapshot_checksum="snippet-checksum",
        snapshot_size_bytes=64,
        resume_route=WorkflowHandoffResumeRoute.SNIPPET,
        source_worker_id="worker-old",
    )

    persisted = repository.get(created.id, created.generation)
    assert persisted is not None
    assert persisted.resume_route == WorkflowHandoffResumeRoute.SNIPPET


def test_postgres_serializes_shared_snapshot_gc_and_handles_never_uploaded_intent(
    db_session_with_containers: Session,
) -> None:
    engine = db_session_with_containers.get_bind()
    assert isinstance(engine, Engine)
    factory = sessionmaker(bind=engine, class_=Session, expire_on_commit=False)
    repository = SQLAlchemyWorkflowRunHandoffRepository(factory)
    runs = [_workflow_run(), _workflow_run()]
    run_ids = [run.id for run in runs]
    db_session_with_containers.add_all(runs)
    db_session_with_containers.commit()

    shared_key = f"workflow-handoffs/shared/{uuid4()}.bin"
    barrier = Barrier(2)

    def prepare(index: int) -> WorkflowRunHandoff:
        barrier.wait()
        return repository.create_preparing(
            workflow_run_id=run_ids[index],
            task_id=f"task-{index}",
            snapshot_object_key=shared_key,
            snapshot_schema_version="v1",
            snapshot_checksum="same-content-checksum",
            snapshot_size_bytes=42,
            resume_route=WorkflowHandoffResumeRoute.WORKFLOW,
            source_worker_id=f"worker-{index}",
        )

    with ThreadPoolExecutor(max_workers=2) as executor:
        handoffs = list(executor.map(prepare, range(2)))

    with factory() as session:
        assert (
            session.scalar(
                select(func.count())
                .select_from(WorkflowHandoffSnapshotGC)
                .where(WorkflowHandoffSnapshotGC.snapshot_object_key == shared_key)
            )
            == 1
        )

    for handoff in handoffs:
        assert repository.finish_preparing(handoff_id=handoff.id, generation=handoff.generation) is not None

    terminal_at = naive_utc_now()
    with factory.begin() as session:
        first = session.get(WorkflowRunHandoff, handoffs[0].id)
        second = session.get(WorkflowRunHandoff, handoffs[1].id)
        second_run = session.get(WorkflowRun, run_ids[1])
        assert first is not None
        assert second is not None
        assert second_run is not None
        first.state = WorkflowHandoffState.RESUMED
        first.resumed_at = terminal_at
        second.state = WorkflowHandoffState.FAILED
        second.failed_at = terminal_at
        second.last_error = "resume attempts exhausted"
        second_run.status = WorkflowExecutionStatus.STOPPED
        second_run.finished_at = terminal_at
        second_run.error = second.last_error

    # A shared object remains blocked until every reference is terminal and the
    # FAILED reference has completed both compensation and terminal delivery.
    assert repository.list_snapshot_gc_candidates(now=terminal_at, limit=10) == []
    assert repository.compensate_failed_terminal(
        handoff_id=handoffs[1].id,
        generation=handoffs[1].generation,
        compensated_at=terminal_at,
    )
    assert repository.mark_terminal_event_published(
        handoff_id=handoffs[1].id,
        generation=handoffs[1].generation,
        published_at=terminal_at,
    )
    assert [
        record.snapshot_object_key
        for record in repository.list_snapshot_gc_candidates(
            now=terminal_at,
            limit=10,
        )
    ] == [shared_key]
    deleted: list[str] = []
    assert (
        repository.delete_snapshot_if_unreferenced(
            snapshot_object_key=shared_key,
            deleted_at=terminal_at,
            delete_object=lambda key: not deleted.append(key),
        ).value
        == "deleted"
    )
    assert deleted == [shared_key]

    never_uploaded_run = _workflow_run()
    never_uploaded_run_id = never_uploaded_run.id
    with factory.begin() as session:
        session.add(never_uploaded_run)
    never_uploaded = repository.create_preparing(
        workflow_run_id=never_uploaded_run_id,
        task_id="task-never-uploaded",
        snapshot_object_key=f"workflow-handoffs/never-uploaded/{uuid4()}.bin",
        snapshot_schema_version="v1",
        snapshot_checksum="never-uploaded-checksum",
        snapshot_size_bytes=64,
        resume_route=WorkflowHandoffResumeRoute.WORKFLOW,
        source_worker_id="worker-old",
    )
    failed_at = never_uploaded.created_at + timedelta(minutes=10)
    assert (
        repository.fail_stale_prepared(
            now=failed_at,
            stale_before=failed_at,
            error="checkpoint upload timed out",
            limit=10,
        )
        == 1
    )
    assert repository.compensate_failed_terminal(
        handoff_id=never_uploaded.id,
        generation=never_uploaded.generation,
        compensated_at=failed_at,
    )
    assert repository.mark_terminal_event_published(
        handoff_id=never_uploaded.id,
        generation=never_uploaded.generation,
        published_at=failed_at,
    )
    assert (
        repository.delete_snapshot_if_unreferenced(
            snapshot_object_key=never_uploaded.snapshot_object_key,
            deleted_at=failed_at,
            delete_object=lambda _key: False,
        ).value
        == "missing"
    )


def test_postgres_reconciles_resumed_runtime_failure_before_terminal_outbox(
    db_session_with_containers: Session,
) -> None:
    engine = db_session_with_containers.get_bind()
    assert isinstance(engine, Engine)
    factory = sessionmaker(bind=engine, class_=Session, expire_on_commit=False)
    repository = SQLAlchemyWorkflowRunHandoffRepository(factory)
    workflow_run = _workflow_run()
    db_session_with_containers.add(workflow_run)
    db_session_with_containers.commit()
    handoff = repository.create_prepared(
        workflow_run_id=workflow_run.id,
        task_id="task-runtime-failure",
        snapshot_object_key=f"workflow-handoffs/runtime-failure/{uuid4()}.bin",
        snapshot_schema_version="v1",
        snapshot_checksum="runtime-failure-checksum",
        snapshot_size_bytes=64,
        resume_route=WorkflowHandoffResumeRoute.WORKFLOW,
        source_worker_id="worker-old",
    )
    ready = repository.activate_latest_prepared_by_task_id(
        task_id=handoff.task_id,
        activated_at=naive_utc_now(),
    )
    assert ready is not None
    claim = repository.claim(
        handoff_id=ready.id,
        generation=ready.generation,
        lease_owner="worker-new",
        lease_duration=timedelta(seconds=30),
        max_attempts=3,
        now=naive_utc_now(),
    )
    assert claim is not None
    assert claim.lease_token is not None
    assert repository.mark_resumed(
        handoff_id=claim.id,
        generation=claim.generation,
        lease_owner="worker-new",
        lease_token=claim.lease_token,
        resumed_at=naive_utc_now(),
    )
    failed_at = naive_utc_now()

    event = repository.reconcile_resumed_terminal_failure(
        handoff_id=claim.id,
        generation=claim.generation,
        scope=WorkflowHandoffTerminalScope(
            workflow_run_id=workflow_run.id,
            task_id=handoff.task_id,
            tenant_id=workflow_run.tenant_id,
            app_id=workflow_run.app_id,
            workflow_id=workflow_run.workflow_id,
            resume_route=WorkflowHandoffResumeRoute.WORKFLOW,
        ),
        error="resumed stream failed",
        failed_at=failed_at,
    )

    assert event is not None
    assert event.status == WorkflowExecutionStatus.STOPPED
    with factory() as session:
        persisted_run = session.get(WorkflowRun, workflow_run.id)
        persisted_handoff = session.get(WorkflowRunHandoff, handoff.id)
        assert persisted_run is not None
        assert persisted_run.status == WorkflowExecutionStatus.STOPPED
        assert persisted_run.error == "resumed stream failed"
        assert persisted_handoff is not None
        assert persisted_handoff.state == WorkflowHandoffState.FAILED
        assert persisted_handoff.terminal_compensated_at == failed_at


def test_postgres_retention_prunes_handoff_then_completed_snapshot_gc(
    db_session_with_containers: Session,
) -> None:
    engine = db_session_with_containers.get_bind()
    assert isinstance(engine, Engine)
    factory = sessionmaker(bind=engine, class_=Session, expire_on_commit=False)
    repository = SQLAlchemyWorkflowRunHandoffRepository(factory)
    workflow_run = _workflow_run()
    db_session_with_containers.add(workflow_run)
    db_session_with_containers.commit()

    handoff = repository.create_prepared(
        workflow_run_id=workflow_run.id,
        task_id="task-retention",
        snapshot_object_key=f"workflow-handoffs/retention/{uuid4()}.bin",
        snapshot_schema_version="v1",
        snapshot_checksum="retention-checksum",
        snapshot_size_bytes=64,
        resume_route=WorkflowHandoffResumeRoute.WORKFLOW,
        source_worker_id="worker-old",
    )
    terminal_at = naive_utc_now() - timedelta(days=8)
    ready = repository.activate_latest_prepared_by_task_id(
        task_id=handoff.task_id,
        activated_at=terminal_at,
    )
    assert ready is not None
    claim = repository.claim(
        handoff_id=ready.id,
        generation=ready.generation,
        lease_owner="worker-new",
        lease_duration=timedelta(seconds=30),
        max_attempts=3,
        now=terminal_at,
    )
    assert claim is not None
    assert claim.lease_token is not None
    assert repository.mark_resumed(
        handoff_id=claim.id,
        generation=claim.generation,
        lease_owner="worker-new",
        lease_token=claim.lease_token,
        resumed_at=terminal_at,
    )
    with factory.begin() as session:
        snapshot_gc = session.scalar(
            select(WorkflowHandoffSnapshotGC).where(
                WorkflowHandoffSnapshotGC.snapshot_object_key == handoff.snapshot_object_key
            )
        )
        assert snapshot_gc is not None
        snapshot_gc.deleted_at = terminal_at

    retention_before = naive_utc_now() - timedelta(days=7)
    # Locking/rechecking the parent status keeps an old handoff while the same
    # workflow run can still be mutated by a live worker.
    assert repository.cleanup_terminal_handoffs(terminal_before=retention_before, limit=10) == 0
    with factory.begin() as session:
        persisted_run = session.get(WorkflowRun, workflow_run.id)
        assert persisted_run is not None
        persisted_run.status = WorkflowExecutionStatus.SUCCEEDED
        persisted_run.finished_at = naive_utc_now()

    assert repository.cleanup_terminal_handoffs(terminal_before=retention_before, limit=10) == 1
    # Handoff deletion commits before the completed GC row is considered, so
    # the latter's row lock can prove that no snapshot reference remains.
    assert repository.cleanup_completed_snapshot_gc(deleted_before=retention_before, limit=10) == 1
    with factory() as session:
        assert session.get(WorkflowRunHandoff, handoff.id) is None
        assert (
            session.scalar(
                select(WorkflowHandoffSnapshotGC).where(
                    WorkflowHandoffSnapshotGC.snapshot_object_key == handoff.snapshot_object_key
                )
            )
            is None
        )


def test_postgres_completed_gc_cleanup_rechecks_concurrent_snapshot_reuse(
    db_session_with_containers: Session,
) -> None:
    engine = db_session_with_containers.get_bind()
    assert isinstance(engine, Engine)
    factory = sessionmaker(bind=engine, class_=Session, expire_on_commit=False)
    repository = SQLAlchemyWorkflowRunHandoffRepository(factory)
    workflow_run = _workflow_run()
    snapshot_key = f"workflow-handoffs/retention-race/{uuid4()}.bin"
    deleted_at = naive_utc_now() - timedelta(days=8)
    with factory.begin() as session:
        session.add(workflow_run)
        gc_record = WorkflowHandoffSnapshotGC(snapshot_object_key=snapshot_key)
        gc_record.deleted_at = deleted_at
        session.add(gc_record)

    candidate_selected = Event()
    allow_cleanup_to_lock = Event()

    def pause_after_candidate_query(
        _connection: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        if "SELECT workflow_handoff_snapshot_gc.id" not in statement or candidate_selected.is_set():
            return
        candidate_selected.set()
        if not allow_cleanup_to_lock.wait(timeout=10):
            raise TimeoutError("retention cleanup test did not release candidate query")

    event.listen(engine, "after_cursor_execute", pause_after_candidate_query)
    executor = ThreadPoolExecutor(max_workers=1)
    future = executor.submit(
        repository.cleanup_completed_snapshot_gc,
        deleted_before=naive_utc_now() - timedelta(days=7),
        limit=10,
    )
    try:
        assert candidate_selected.wait(timeout=10)
        handoff = repository.create_preparing(
            workflow_run_id=workflow_run.id,
            task_id="task-retention-race",
            snapshot_object_key=snapshot_key,
            snapshot_schema_version="v1",
            snapshot_checksum="retention-race-checksum",
            snapshot_size_bytes=64,
            resume_route=WorkflowHandoffResumeRoute.WORKFLOW,
            source_worker_id="worker-old",
        )
        allow_cleanup_to_lock.set()
        assert future.result(timeout=10) == 0
    finally:
        allow_cleanup_to_lock.set()
        event.remove(engine, "after_cursor_execute", pause_after_candidate_query)
        executor.shutdown(wait=True)

    with factory() as session:
        persisted_gc = session.scalar(
            select(WorkflowHandoffSnapshotGC).where(WorkflowHandoffSnapshotGC.snapshot_object_key == snapshot_key)
        )
        assert session.get(WorkflowRunHandoff, handoff.id) is not None
        assert persisted_gc is not None
        assert persisted_gc.deleted_at is None
