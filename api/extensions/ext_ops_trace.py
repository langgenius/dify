"""Construct trace queues only when the owning server/worker starts."""

import atexit
from typing import Any

from celery.signals import worker_process_init, worker_process_shutdown, worker_ready, worker_shutdown
from flask import Flask
from sqlalchemy.orm import sessionmaker

from core.ops.trace_queue import TraceQueue
from extensions.ext_database import db
from extensions.ext_storage import storage
from repositories.ops_trace_delivery_repository import OpsTraceDeliveryRepository
from tasks.ops_trace_maintenance_task import delete_expired_traces, enqueue_due_traces
from tasks.ops_trace_task import export_trace_delivery


def init_app(app: Flask) -> None:
    celery_app = app.extensions["celery"]
    export_task = celery_app.task(
        name="tasks.ops_trace_task.export_trace_delivery",
        queue="ops_trace",
        soft_time_limit=110,
        time_limit=120,
        acks_late=True,
        reject_on_worker_lost=True,
    )(export_trace_delivery)
    celery_app.task(name="tasks.ops_trace_maintenance_task.enqueue_due_traces", queue="ops_trace")(enqueue_due_traces)
    celery_app.task(name="tasks.ops_trace_maintenance_task.delete_expired_traces", queue="ops_trace")(
        delete_expired_traces
    )

    def publish_delivery(tenant_id: str, delivery_id: str) -> None:
        export_task.apply_async(
            args=(tenant_id, delivery_id),
            retry=True,
            retry_policy={
                "max_retries": 3,
                "interval_start": 0,
                "interval_step": 1,
                "interval_max": 2,
            },
        )

    def start_ops_tracing(**_: Any) -> None:
        # Lifecycle hooks run before requests/tasks; never a first-request race.
        if "ops_trace_queue" in app.extensions:
            return
        with app.app_context():
            repository = OpsTraceDeliveryRepository(sessionmaker(bind=db.engine, expire_on_commit=False))
        trace_queue = TraceQueue(
            storage=storage,
            delivery_repository=repository,
            publish_delivery=publish_delivery,
            open_app_context=app.app_context,
            logger=app.logger,
        )
        app.extensions["ops_trace_storage"] = storage
        app.extensions["ops_trace_delivery_repository"] = repository
        app.extensions["ops_trace_queue"] = trace_queue
        trace_queue.start()

    def close_ops_tracing(**_: Any) -> None:
        # Keep a closed queue on its host: a timed-out writer must not overlap a replacement.
        trace_queue = app.extensions.get("ops_trace_queue")
        if trace_queue:
            trace_queue.close()

    def start_nonfork_worker(sender: Any, **_: Any) -> None:
        from celery.concurrency.prefork import TaskPool

        if sender.app is celery_app and not isinstance(sender.pool, TaskPool):
            start_ops_tracing()

    app.extensions["start_ops_tracing"] = start_ops_tracing
    app.extensions["close_ops_tracing"] = close_ops_tracing
    worker_process_init.connect(start_ops_tracing, weak=False)
    worker_process_shutdown.connect(close_ops_tracing, weak=False)
    worker_ready.connect(start_nonfork_worker, weak=False)
    worker_shutdown.connect(close_ops_tracing, weak=False)
    atexit.register(close_ops_tracing)
