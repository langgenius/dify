"""Executable ownership, queue-budget, and lease checks without external services."""

import logging
from concurrent.futures import ThreadPoolExecutor
from contextlib import nullcontext
from datetime import timedelta
from tempfile import TemporaryDirectory
from threading import Barrier
from unittest.mock import Mock
from uuid import uuid4

import pytest
import sqlalchemy as sa
from flask import Flask
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from core.ops.trace_data import (
    CompletedTrace,
    ParentSpanReference,
    QueuedTrace,
    TraceProviderSettings,
    TraceSource,
    TraceSpan,
)
from core.ops.trace_queue import TraceQueue
from models.ops_trace import OpsTraceDelivery
from repositories.ops_trace_delivery_repository import OpsTraceDeliveryRepository


def make_queued_trace(tenant_id=None, *, parent=None):
    source = TraceSource(tenant_id=tenant_id or str(uuid4()), operation_id=str(uuid4()), app_id=str(uuid4()))
    root_span_id = str(uuid4())
    completed_trace = CompletedTrace(
        source=source,
        trace_id=str(uuid4()),
        root_span_id=root_span_id,
        spans=(TraceSpan(span_id=root_span_id, span_name="Workflow"),),
        parent=parent,
    )
    settings = TraceProviderSettings(
        tenant_id=source.tenant_id,
        app_id=source.app_id,
        provider_name="langfuse",
        config_id=str(uuid4()),
    )
    return QueuedTrace.from_trace(completed_trace, settings)


def make_repository(engine=None):
    engine = engine or sa.create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    OpsTraceDelivery.__table__.create(engine)
    return OpsTraceDeliveryRepository(sessionmaker(engine, expire_on_commit=False))


def test_claim_is_tenant_scoped_and_stale_attempt_cannot_complete():
    repository = make_repository()
    queued_trace = make_queued_trace()
    reserved, owns_upload = repository.reserve_delivery(queued_trace)
    assert owns_upload
    assert not repository.claim_delivery(reserved.tenant_id, reserved.id)
    assert repository.accept_upload(reserved)
    assert repository.claim_delivery(str(uuid4()), reserved.id) is None
    first_attempt = repository.claim_delivery(reserved.tenant_id, reserved.id)
    assert first_attempt
    assert first_attempt.attempt_count == 1
    assert repository.claim_delivery(reserved.tenant_id, reserved.id) is None
    with repository.session_factory() as session:
        session.execute(
            sa.update(OpsTraceDelivery).values(
                lease_expires_at=repository.database_time(session) - timedelta(seconds=1)
            )
        )
        session.commit()
    second_attempt = repository.claim_delivery(reserved.tenant_id, reserved.id)
    assert second_attempt
    assert second_attempt.attempt_token != first_attempt.attempt_token
    assert not repository.extend_attempt_lease(first_attempt)
    assert repository.extend_attempt_lease(second_attempt)
    assert not repository.finish_attempt(first_attempt, "succeeded")
    assert repository.finish_attempt(second_attempt, "succeeded")
    duplicate, owns_upload = repository.reserve_delivery(queued_trace)
    assert not owns_upload
    assert duplicate.id == reserved.id
    assert duplicate.status == "succeeded"


def test_two_workers_claim_one_delivery():
    with TemporaryDirectory() as directory:
        repository = make_repository(sa.create_engine(f"sqlite:///{directory}/trace.db"))
        reserved, _ = repository.reserve_delivery(make_queued_trace())
        assert repository.accept_upload(reserved)
        barrier = Barrier(2)

        def claim():
            barrier.wait(timeout=3)
            return repository.claim_delivery(reserved.tenant_id, reserved.id)

        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(claim) for _ in range(2)]
            assert sum(future.result() is not None for future in futures) == 1


def test_expired_writer_cannot_accept_after_cleanup_cancellation():
    repository = make_repository()
    queued_trace = make_queued_trace()
    reserved, _ = repository.reserve_delivery(queued_trace)
    with repository.session_factory() as session:
        session.execute(
            sa.update(OpsTraceDelivery).values(
                lease_expires_at=repository.database_time(session) - timedelta(seconds=1)
            )
        )
        session.commit()
    repository.cancel_expired_uploads()
    assert not repository.accept_upload(reserved)
    cancelled, owns_upload = repository.reserve_delivery(queued_trace)
    assert not owns_upload
    assert cancelled.status == "cancelled"
    assert repository.get_delivery(str(uuid4()), reserved.id) is None


def test_conflicting_duplicate_never_replaces_accepted_trace():
    repository = make_repository()
    queued_trace = make_queued_trace()
    reserved, _ = repository.reserve_delivery(queued_trace)
    assert repository.accept_upload(reserved)
    changed = CompletedTrace.model_validate_json(queued_trace.trace_json).model_copy(update={"links": ("changed",)})
    duplicate = QueuedTrace.from_trace(changed, queued_trace.provider_settings)
    with pytest.raises(ValueError, match="conflicting_export"):
        repository.reserve_delivery(duplicate)


def test_queue_is_bounded_per_tenant_and_releases_all_budgets():
    repository = Mock()
    storage = Mock()
    publish = Mock()
    trace_queue = TraceQueue(
        storage=storage,
        delivery_repository=repository,
        publish_delivery=publish,
        open_app_context=nullcontext,
        logger=logging.getLogger(__name__),
        max_items=4,
        max_recording_bytes=100,
    )
    first = make_queued_trace()
    tenant_id = first.provider_settings.tenant_id
    assert trace_queue.reserve_recording_bytes(tenant_id, 50)
    assert not trace_queue.reserve_recording_bytes(tenant_id, 1)
    trace_queue.release_recording_bytes(tenant_id, 50)
    assert trace_queue.recording_bytes == 0
    assert not trace_queue.tenant_recording_bytes
    assert trace_queue.submit_trace(first)
    assert trace_queue.submit_trace(make_queued_trace(tenant_id))
    assert not trace_queue.submit_trace(make_queued_trace(tenant_id))
    assert trace_queue.submit_trace(make_queued_trace())
    repository.reserve_delivery.side_effect = ValueError("bad_item")
    trace_queue.start()
    trace_queue.close()
    assert trace_queue.queued_bytes == 0
    assert not trace_queue.tenant_queued_items
    assert repository.reserve_delivery.call_count == 3
    assert not trace_queue.submit_trace(first)


def test_publish_failure_preserves_accepted_row_and_other_tenant_drains():
    repository = make_repository()
    saved = {}
    storage = Mock()
    storage.save.side_effect = lambda key, trace_json: saved.setdefault(key, trace_json)
    trace_queue = TraceQueue(
        storage=storage,
        delivery_repository=repository,
        publish_delivery=Mock(side_effect=OSError("broker offline")),
        open_app_context=nullcontext,
        logger=logging.getLogger(__name__),
    )
    assert trace_queue.submit_trace(make_queued_trace())
    assert trace_queue.submit_trace(make_queued_trace())
    trace_queue.start()
    trace_queue.close()
    assert len(saved) == len(repository.due_deliveries()) == 2
    assert trace_queue.queued_bytes == 0


def test_parent_wait_does_not_claim_or_increment_attempts():
    repository = make_repository()
    queued = make_queued_trace(parent=ParentSpanReference(export_id=str(uuid4()), span_id=str(uuid4())))
    delivery, _ = repository.reserve_delivery(queued)
    assert repository.accept_upload(delivery)
    delivery = repository.get_delivery(delivery.tenant_id, delivery.id)
    ready, receipt = repository.read_parent_reference(delivery)
    assert not ready
    assert receipt is None
    waiting = repository.get_delivery(delivery.tenant_id, delivery.id)
    assert waiting.status == "pending"
    assert waiting.attempt_count == 0
    assert repository.claim_delivery(waiting.tenant_id, waiting.id) is None


def test_worker_rejects_wrong_digest_before_credentials(monkeypatch):
    from services import ops_trace_service
    from tasks.ops_trace_task import export_trace_delivery

    repository = make_repository()
    queued = make_queued_trace()
    delivery, _ = repository.reserve_delivery(queued)
    assert repository.accept_upload(delivery)
    load_config = Mock()
    monkeypatch.setattr(ops_trace_service, "load_trace_provider_config", load_config)
    app = Flask(__name__)
    app.extensions["ops_trace_delivery_repository"] = repository
    app.extensions["ops_trace_storage"] = Mock(load_stream=Mock(return_value=iter((b"bad",))))
    with app.app_context():
        export_trace_delivery(delivery.tenant_id, delivery.id)
    load_config.assert_not_called()
    failed = repository.get_delivery(delivery.tenant_id, delivery.id)
    assert failed.status == "failed"
    assert failed.error_code == "invalid_trace_digest"


def test_expired_parent_exports_a_linked_root(monkeypatch):
    from core.ops import provider_export
    from core.ops.trace_data import ExportedParentSpans
    from services import ops_trace_service
    from tasks.ops_trace_task import export_trace_delivery

    repository = make_repository()
    parent_export_id = str(uuid4())
    queued = make_queued_trace(parent=ParentSpanReference(export_id=parent_export_id, span_id=str(uuid4())))
    delivery, _ = repository.reserve_delivery(queued)
    assert repository.accept_upload(delivery)
    with repository.session_factory() as session:
        session.execute(
            sa.update(OpsTraceDelivery).values(created_at=repository.database_time(session) - timedelta(hours=2))
        )
        session.commit()
    monkeypatch.setattr(repository, "validate_trace_owner", Mock())
    monkeypatch.setattr(ops_trace_service, "load_trace_provider_config", Mock(return_value={}))
    export = Mock(return_value=ExportedParentSpans())
    monkeypatch.setattr(provider_export, "export_trace", export)
    app = Flask(__name__)
    app.extensions["ops_trace_delivery_repository"] = repository
    app.extensions["ops_trace_storage"] = Mock(load_stream=Mock(return_value=iter((queued.trace_json,))))
    with app.app_context():
        export_trace_delivery(delivery.tenant_id, delivery.id)
    exported_trace = export.call_args.args[0]
    assert exported_trace.parent is None
    assert exported_trace.links == (parent_export_id,)
    assert exported_trace.spans[0].attributes["dify.parent_status"] == "parent_wait_expired"
    assert repository.get_delivery(delivery.tenant_id, delivery.id).status == "succeeded"


def test_foreign_parent_is_rejected_even_after_wait_expiry():
    repository = make_repository()
    parent, _ = repository.reserve_delivery(make_queued_trace())
    assert repository.accept_upload(parent)
    parent_attempt = repository.claim_delivery(parent.tenant_id, parent.id)
    assert repository.finish_attempt(
        parent_attempt, "succeeded", parent_references={parent.root_span_id: {"span_id": parent.root_span_id}}
    )
    queued = make_queued_trace(
        parent.tenant_id, parent=ParentSpanReference(export_id=parent.export_id, span_id=parent.root_span_id)
    )
    child, _ = repository.reserve_delivery(queued)
    assert repository.accept_upload(child)
    with repository.session_factory() as session:
        session.execute(
            sa.update(OpsTraceDelivery)
            .where(OpsTraceDelivery.id == child.id)
            .values(
                created_at=repository.database_time(session) - timedelta(hours=2),
            )
        )
        session.commit()
    child = repository.get_delivery(child.tenant_id, child.id)
    ready, _ = repository.read_parent_reference(child)
    assert not ready
    rejected = repository.get_delivery(child.tenant_id, child.id)
    assert rejected.status == "cancelled"
    assert rejected.error_code == "parent_owner_mismatch"


def test_application_startup_constructs_independent_queues(monkeypatch):
    from extensions import ext_ops_trace

    for name in ("worker_process_init", "worker_process_shutdown", "worker_ready", "worker_shutdown"):
        monkeypatch.setattr(ext_ops_trace, name, Mock())
    monkeypatch.setattr(ext_ops_trace.atexit, "register", Mock())
    monkeypatch.setattr(ext_ops_trace, "db", Mock(engine=sa.create_engine("sqlite://")))
    first, second = Flask("first_trace_host"), Flask("second_trace_host")
    for app in (first, second):
        app.extensions["celery"] = Mock()
        ext_ops_trace.init_app(app)
        assert "ops_trace_queue" not in app.extensions
        app.extensions["start_ops_tracing"]()
    try:
        first_queue, second_queue = first.extensions["ops_trace_queue"], second.extensions["ops_trace_queue"]
        first.extensions["start_ops_tracing"]()
        assert first.extensions["ops_trace_queue"] is first_queue
        assert first_queue is not second_queue
        assert first_queue.pending_traces is not second_queue.pending_traces
        assert first_queue.queue_lock is not second_queue.queue_lock
        assert first_queue.reserve_recording_bytes(str(uuid4()), 4096)
        assert second_queue.recording_bytes == 0
        first.extensions["close_ops_tracing"]()
        assert first_queue.closed.is_set()
        assert not second_queue.closed.is_set()
    finally:
        for app in (first, second):
            app.extensions["close_ops_tracing"]()


def test_migration_rejects_conflicting_configs_before_schema_changes():
    import importlib.util
    from pathlib import Path

    from alembic.migration import MigrationContext
    from alembic.operations import Operations

    migration_file = (
        Path(__file__).resolve().parents[4]
        / "migrations/versions/2026_09_09_1200-74f13a2c08b9_add_ops_trace_deliveries.py"
    )
    specification = importlib.util.spec_from_file_location("ops_delivery_migration", migration_file)
    migration = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(migration)
    engine = sa.create_engine("sqlite://")
    with engine.begin() as connection:
        connection.execute(sa.text("CREATE TABLE apps (id VARCHAR(36) PRIMARY KEY)"))
        connection.execute(
            sa.text(
                "CREATE TABLE trace_app_config (id VARCHAR(36) PRIMARY KEY, app_id VARCHAR(36), "
                "tracing_provider VARCHAR(255), tracing_config JSON, is_active BOOLEAN)"
            )
        )
        app_id = str(uuid4())
        connection.execute(sa.text("INSERT INTO apps (id) VALUES (:id)"), {"id": app_id})
        connection.execute(
            sa.text("INSERT INTO trace_app_config VALUES (:id, :app, 'langfuse', :config, 1)"),
            [
                {"id": str(uuid4()), "app": app_id, "config": '{"secret":"one"}'},
                {"id": str(uuid4()), "app": app_id, "config": '{"secret":"two"}'},
            ],
        )
        with Operations.context(MigrationContext.configure(connection)):
            with pytest.raises(RuntimeError, match="Conflicting trace configurations"):
                migration.upgrade()
            assert "tracing_revision" not in {column["name"] for column in sa.inspect(connection).get_columns("apps")}
            connection.execute(
                sa.text("UPDATE trace_app_config SET tracing_config = :config"), {"config": '{"secret":"one"}'}
            )
            migration.upgrade()
            assert connection.scalar(sa.text("SELECT count(*) FROM trace_app_config")) == 1
            assert "ops_trace_deliveries" in sa.inspect(connection).get_table_names()
            migration.downgrade()
            assert "ops_trace_deliveries" not in sa.inspect(connection).get_table_names()
